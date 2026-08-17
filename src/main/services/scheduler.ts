import { readFile } from 'node:fs/promises'
import { BrowserWindow } from 'electron'
import { getPrisma } from './database'
import type { YouTubeService } from './youtube'
import type { PrivacyStatus, ScheduledPostDTO, SchedulePostInput, UploadProgress } from '../../shared/types'

type PostWithRelations = Awaited<ReturnType<typeof findPost>>
type RenderWithRelations = Awaited<ReturnType<typeof findRender>>

async function findPost(id: string) {
  return getPrisma().scheduledPost.findUniqueOrThrow({
    where: { id },
    include: { render: { include: { project: true } } }
  })
}

async function findRender(renderId: string) {
  return getPrisma().render.findUniqueOrThrow({
    where: { id: renderId },
    include: { project: true, scheduledPost: true }
  })
}

async function readMeta(videoPath: string | null): Promise<{ title: string | null; description: string | null }> {
  if (!videoPath) return { title: null, description: null }
  const metaPath = videoPath.replace(/\.[^.]+$/, '.metadata.txt')
  try {
    const text = await readFile(metaPath, 'utf8')
    const data = JSON.parse(text) as Record<string, string>
    return { title: data.title ?? null, description: data.description ?? null }
  } catch {
    return { title: null, description: null }
  }
}

function toDTO(render: RenderWithRelations, meta: { title: string | null; description: string | null }): ScheduledPostDTO {
  const post = render.scheduledPost
  return {
    id: post?.id ?? null,
    renderId: render.id,
    renderType: render.type,
    renderPath: render.path ?? null,
    projectId: render.project.id,
    projectName: render.project.name,
    publishTitle: post?.titleOverride ?? meta.title,
    publishDescription: post?.descOverride ?? meta.description,
    status: (post?.status as ScheduledPostDTO['status']) ?? null,
    scheduledAt: post?.scheduledAt?.toISOString() ?? null,
    uploadedAt: post?.uploadedAt?.toISOString() ?? null,
    youtubeVideoId: post?.youtubeVideoId ?? null,
    youtubeUrl: post?.youtubeUrl ?? null,
    privacyStatus: (post?.privacyStatus as PrivacyStatus) ?? 'private',
    error: post?.error ?? null,
    renderCreatedAt: render.createdAt.toISOString()
  }
}

function sendToRenderer(channel: string, data: unknown): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  }
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly youtube: YouTubeService) {}

  start(): void {
    this.timer = setInterval(() => void this.checkDuePosts(), 60_000)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async list(): Promise<ScheduledPostDTO[]> {
    const renders = await getPrisma().render.findMany({
      where: { status: 'DONE', path: { not: null } },
      include: { project: true, scheduledPost: true },
      orderBy: { createdAt: 'desc' }
    })
    const dtos = await Promise.all(
      renders.map(async (render) => {
        const meta = await readMeta(render.path)
        return toDTO(render as RenderWithRelations, meta)
      })
    )
    return dtos
  }

  async schedule(input: SchedulePostInput): Promise<ScheduledPostDTO> {
    await getPrisma().scheduledPost.upsert({
      where: { renderId: input.renderId },
      create: {
        renderId: input.renderId,
        status: 'PENDING',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        privacyStatus: input.privacyStatus ?? 'private',
        titleOverride: input.titleOverride ?? null,
        descOverride: input.descOverride ?? null
      },
      update: {
        status: 'PENDING',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        privacyStatus: input.privacyStatus ?? 'private',
        titleOverride: input.titleOverride ?? null,
        descOverride: input.descOverride ?? null
      }
    })
    const render = await findRender(input.renderId)
    const meta = await readMeta(render.path)
    return toDTO(render as RenderWithRelations, meta)
  }

  async cancel(id: string): Promise<ScheduledPostDTO> {
    await getPrisma().scheduledPost.update({ where: { id }, data: { status: 'CANCELLED' } })
    const post = await findPost(id)
    const render = await findRender(post.renderId)
    const meta = await readMeta(render.path)
    return toDTO(render as RenderWithRelations, meta)
  }

  async uploadNow(renderId: string): Promise<ScheduledPostDTO> {
    await getPrisma().scheduledPost.upsert({
      where: { renderId },
      create: { renderId, status: 'UPLOADING', privacyStatus: 'private' },
      update: { status: 'UPLOADING', scheduledAt: null, error: null }
    })
    const render = await findRender(renderId)
    const meta = await readMeta(render.path)
    void this.doUpload(render as RenderWithRelations, meta)
    return toDTO(render as RenderWithRelations, meta)
  }

  private async checkDuePosts(): Promise<void> {
    const due = await getPrisma().scheduledPost.findMany({
      where: { status: 'PENDING', OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
      include: { render: { include: { project: true } } }
    })
    for (const post of due) {
      const render = { ...post.render, scheduledPost: post } as unknown as RenderWithRelations
      const meta = await readMeta(post.render.path)
      void this.doUpload(render, meta)
    }
  }

  private async doUpload(render: RenderWithRelations, meta: { title: string | null; description: string | null }): Promise<void> {
    const renderId = render.id
    const post = render.scheduledPost
    if (!post) return
    if (!render.path) {
      await getPrisma().scheduledPost.update({ where: { renderId }, data: { status: 'FAILED', error: 'Video file path missing.' } })
      sendToRenderer('scheduler:post-updated', toDTO(await findRender(renderId) as RenderWithRelations, meta))
      return
    }

    await getPrisma().scheduledPost.update({ where: { renderId }, data: { status: 'UPLOADING', error: null } })

    const progressUpdate = (percent: number): void => {
      const progress: UploadProgress = { renderId, percent, stage: 'UPLOADING', message: `Đang upload ${percent}%...` }
      sendToRenderer('scheduler:upload-progress', progress)
    }

    try {
      const title = post.titleOverride ?? meta.title ?? render.project.name
      const description = post.descOverride ?? meta.description ?? ''
      const { videoId, url } = await this.youtube.uploadVideo({
        videoPath: render.path,
        title,
        description,
        privacyStatus: post.privacyStatus ?? 'private',
        onProgress: progressUpdate
      })

      await getPrisma().scheduledPost.update({
        where: { renderId },
        data: { status: 'DONE', youtubeVideoId: videoId, youtubeUrl: url, uploadedAt: new Date(), error: null }
      })
      sendToRenderer('scheduler:upload-progress', { renderId, percent: 100, stage: 'DONE', message: 'Upload thành công!' } as UploadProgress)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await getPrisma().scheduledPost.update({ where: { renderId }, data: { status: 'FAILED', error: message } })
      sendToRenderer('scheduler:upload-progress', { renderId, percent: 0, stage: 'ERROR', message } as UploadProgress)
    }

    const updatedRender = await findRender(renderId)
    sendToRenderer('scheduler:post-updated', toDTO(updatedRender as RenderWithRelations, meta))
  }
}
