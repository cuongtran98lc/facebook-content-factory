import { BrowserWindow } from 'electron'
import type { RenderQueueItemDTO, RenderStoryVideoInput, StoryVideoProgress } from '../../shared/types'
import { getPrisma } from './database'
import type { StoryMediaService } from './story-media'

const JOB_TYPE = 'RENDER_QUEUE_ITEM'
const POLL_MS = 2_500
const RETAIN_FINISHED_DAYS = 7

function sendToRenderer(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  }
}

function toDTO(row: {
  id: string
  projectId: string | null
  status: string
  progress: number
  error: string | null
  createdAt: Date
  updatedAt: Date
  project: { name: string } | null
  payload: string | null
}): RenderQueueItemDTO {
  let format: RenderQueueItemDTO['format'] = 'LANDSCAPE'
  try {
    const parsed = JSON.parse(row.payload ?? '{}') as { format?: RenderQueueItemDTO['format'] }
    if (parsed.format) format = parsed.format
  } catch {
    // payload hỏng — giữ giá trị mặc định, không chặn hiển thị dòng này trong queue.
  }
  return {
    jobId: row.id,
    projectId: row.projectId ?? '',
    projectName: row.project?.name ?? '(project đã xoá)',
    format,
    status: row.status as RenderQueueItemDTO['status'],
    progress: row.progress,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

/**
 * Xếp hàng render video dài — giải quyết đúng nút thắt đã xác nhận: FFmpeg
 * render (15-25 phút) từng chặn IPC promise, buộc người dùng ngồi canh
 * (docs/designs/render-queue.md). `enqueue()` trả về NGAY; 1 worker nền xử
 * lý đúng 1 job tại 1 thời điểm (concurrency = 1 — xem Approach A trong
 * design doc, Approach B chạy song song để dành cho sau khi có dữ liệu thật
 * về CPU rảnh của máy).
 *
 * Đây KHÔNG phải tái dùng nguyên xi pattern SchedulerService — Scheduler
 * poll bảng ScheduledPost, còn ở đây poll bảng Job (cơ chế mới, chỉ mượn
 * hình dạng poller). Xem "Đã sửa sau spec-review" trong design doc.
 */
export class RenderQueueService {
  private timer: ReturnType<typeof setInterval> | null = null
  private isProcessing = false

  constructor(private readonly storyMedia: StoryMediaService) {}

  /** Gọi 1 lần lúc app khởi động (main/index.ts, giống scheduler.start()).
   * Reset mọi job kẹt RUNNING từ phiên trước (crash/force-quit) về PENDING
   * TRƯỚC khi bắt đầu poll — FFmpeg không resume dở dang được như audio
   * chunk, phải render lại từ đầu. */
  async start(): Promise<void> {
    await getPrisma().job.updateMany({
      where: { type: JOB_TYPE, status: 'RUNNING' },
      data: { status: 'PENDING', progress: 0 }
    })
    this.timer = setInterval(() => void this.tick(), POLL_MS)
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  async enqueue(input: RenderStoryVideoInput): Promise<RenderQueueItemDTO> {
    const prisma = getPrisma()
    const existing = await prisma.job.findFirst({
      where: { type: JOB_TYPE, projectId: input.projectId, status: { in: ['PENDING', 'RUNNING'] } }
    })
    if (existing) throw new Error('Project này đang trong hàng đợi render — đợi xong hoặc huỷ trước khi xếp lại.')

    const job = await prisma.job.create({
      data: {
        type: JOB_TYPE,
        status: 'PENDING',
        projectId: input.projectId,
        payload: JSON.stringify(input)
      },
      include: { project: true }
    })
    return toDTO(job)
  }

  async list(): Promise<RenderQueueItemDTO[]> {
    const cutoff = new Date(Date.now() - RETAIN_FINISHED_DAYS * 24 * 60 * 60 * 1000)
    const rows = await getPrisma().job.findMany({
      where: {
        type: JOB_TYPE,
        OR: [
          { status: { in: ['PENDING', 'RUNNING'] } },
          { status: { in: ['DONE', 'FAILED'] }, updatedAt: { gte: cutoff } }
        ]
      },
      include: { project: true },
      orderBy: { createdAt: 'asc' }
    })
    return rows.map(toDTO)
  }

  async cancel(jobId: string): Promise<void> {
    const job = await getPrisma().job.findUniqueOrThrow({ where: { id: jobId } })
    if (job.status !== 'PENDING') throw new Error('Chỉ huỷ được job đang chờ (chưa bắt đầu render).')
    await getPrisma().job.delete({ where: { id: jobId } })
  }

  private async tick(): Promise<void> {
    if (this.isProcessing) return // 1 job (15-25 phút) tại 1 thời điểm — không dequeue chồng lên.
    const prisma = getPrisma()
    const next = await prisma.job.findFirst({ where: { type: JOB_TYPE, status: 'PENDING' }, orderBy: { createdAt: 'asc' } })
    if (!next || !next.projectId || !next.payload) return

    this.isProcessing = true
    const jobId = next.id
    try {
      const input = JSON.parse(next.payload) as RenderStoryVideoInput
      await prisma.job.update({ where: { id: jobId }, data: { status: 'RUNNING', progress: 0, error: null } })

      const onProgress = (progress: StoryVideoProgress): void => {
        void prisma.job.update({ where: { id: jobId }, data: { progress: progress.percent } }).catch(() => {})
        sendToRenderer('render-queue:progress', { jobId, ...progress })
      }

      await this.storyMedia.render(input.projectId, input.format, input.fitMode, input.soundEffect, onProgress)
      await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', progress: 100 } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', error: message } }).catch(() => {})
    } finally {
      this.isProcessing = false
      sendToRenderer('render-queue:updated', null)
    }
  }
}
