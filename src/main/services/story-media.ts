import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { nativeImage } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import type { BackgroundKind, FitMode, ReelVideoProgress, SoundEffectOptions, StoryMediaDTO, StoryVideoProgress, VideoFormat } from '../../shared/types'
import { getPrisma } from './database'
import { DEFAULT_SOUND_EFFECT_OPTIONS, SFX_RENDER_VERSION, concatMp3Parts, normalizeSoundEffectOptions, probeDuration, renderLoopedVideo, resolveSoundEffectPreset, extractVideoFrame } from './ffmpeg'
import { ProjectStorageService } from './storage'
import { VoiceService } from './voices'
import { ThumbnailService } from './thumbnails'
import { PublishingMetadataService, type PublishMetadata, type PublishMode, type PublishTarget } from './video-metadata'

const TTS_CHUNK_ATTEMPTS = 4
const STORY_SHORT_MAX_MS = 180_000
const STORY_VIDEO_PRESET_SCHEMA = 1
const CTA_TEXT = 'Hãy nhấn like và đăng ký kênh để mình có thêm động lực làm truyện tiếp cho các bạn nghe nha.'
const PUBLISH_METADATA_ASSET_TYPE = 'VIDEO_PUBLISH_METADATA'
const PUBLISH_METADATA_SCHEMA = 1

interface StoryVideoSegment {
  part: number
  totalParts: number
  startMs: number
  durationMs: number
}

interface StoryVideoPreset extends StoryVideoSegment {
  kind: 'story-video'
  schema: number
  runId: string
  format: VideoFormat
  fitMode: FitMode
  sfxRenderVersion: number
  soundEffect: SoundEffectOptions
  scriptId?: string
  audioAssetId?: string
}

interface StoredPublishMetadata extends PublishMetadata {
  schemaVersion: number
  scope: 'STORY' | 'REELS'
  mode: PublishMode
  renderId: string
  scriptId: string
  reelId?: string
  part?: number
  totalParts?: number
  videoFile: string
  generatedAt: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function chunks(text: string, max = 1800): string[] {
  const clean = text.replace(/\r/g, '').trim()
  if (!clean) return []
  if (clean.length <= max) return [clean]
  const paragraphs = clean.split(/\n{2,}/).map(x => x.trim()).filter(Boolean)
  const result: string[] = []
  let current = ''
  const push = () => { if (current.trim()) result.push(current.trim()); current = '' }
  for (const paragraph of paragraphs) {
    if (paragraph.length > max) {
      push()
      const sentences = paragraph.split(/(?<=[.!?…])\s+/)
      for (const sentence of sentences) {
        if ((current + ' ' + sentence).trim().length > max) push()
        if (sentence.length > max) {
          for (let i = 0; i < sentence.length; i += max) result.push(sentence.slice(i, i + max))
        } else current = (current ? `${current} ` : '') + sentence
      }
    } else {
      if ((current + '\n\n' + paragraph).trim().length > max) push()
      current = current ? `${current}\n\n${paragraph}` : paragraph
    }
  }
  push()
  return result
}

function mediaUrl(path?: string | null, version?: Date | string | number | null): string | null {
  if (!path) return null
  const cacheVersion = version instanceof Date ? version.getTime() : version || Date.now()
  return `local-media://file/${encodeURIComponent(path)}?v=${encodeURIComponent(String(cacheVersion))}`
}

function parseMeta(meta?: string | null): Record<string, unknown> {
  if (!meta) return {}
  try { return JSON.parse(meta) as Record<string, unknown> } catch { return {} }
}

function parsePublishMetadata(meta?: string | null): StoredPublishMetadata | null {
  const parsed = parseMeta(meta) as Partial<StoredPublishMetadata>
  if (parsed.schemaVersion !== PUBLISH_METADATA_SCHEMA || typeof parsed.renderId !== 'string' || typeof parsed.title !== 'string' || typeof parsed.description !== 'string') return null
  if (parsed.source !== 'AI' && parsed.source !== 'FALLBACK') return null
  return parsed as StoredPublishMetadata
}

function storyTextPart(content: string, part: number, totalParts: number): string {
  const words = content.replace(/\r/g, '').trim().split(/\s+/).filter(Boolean)
  if (totalParts <= 1 || words.length < 2) return words.join(' ')
  const start = Math.floor((words.length * Math.max(0, part - 1)) / totalParts)
  const end = part >= totalParts ? words.length : Math.floor((words.length * part) / totalParts)
  return words.slice(start, Math.max(start + 1, end)).join(' ')
}

function publishSidecar(metadata: StoredPublishMetadata): string {
  return [
    `TIÊU ĐỀ (${metadata.mode})`,
    metadata.title,
    '',
    'MÔ TẢ',
    metadata.description,
    '',
    `VIDEO: ${metadata.videoFile}`,
    `NGUỒN: ${metadata.source}${metadata.provider ? ` · ${metadata.provider}` : ''}`
  ].join('\n') + '\n'
}

export function planStoryVideoSegments(durationSeconds: number, format: VideoFormat): StoryVideoSegment[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Story MP3 không có duration hợp lệ.')
  const totalMs = Math.max(1, Math.round(durationSeconds * 1000))
  const totalParts = format === 'REEL' ? Math.max(1, Math.ceil(totalMs / STORY_SHORT_MAX_MS)) : 1
  return Array.from({ length: totalParts }, (_, index) => {
    const startMs = Math.round((totalMs * index) / totalParts)
    const endMs = Math.round((totalMs * (index + 1)) / totalParts)
    return { part: index + 1, totalParts, startMs, durationMs: endMs - startMs }
  })
}

function parseStoryVideoPreset(value?: string | null): StoryVideoPreset | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<StoryVideoPreset>
    if (parsed.kind !== 'story-video' || typeof parsed.runId !== 'string' || typeof parsed.part !== 'number' || typeof parsed.totalParts !== 'number' || typeof parsed.startMs !== 'number' || typeof parsed.durationMs !== 'number') return null
    return parsed as StoryVideoPreset
  } catch {
    return null
  }
}

function storyRenderFormat(path: string | null, preset?: StoryVideoPreset | null): VideoFormat {
  if (preset?.format) return preset.format
  const name = basename(path ?? '').toLowerCase()
  if (name.includes('reel') || name.includes('short')) return 'REEL'
  if (name.includes('square')) return 'SQUARE'
  return 'LANDSCAPE'
}

function normalizeThumbnail(bytes: Buffer): Buffer {
  const source = nativeImage.createFromBuffer(bytes)
  if (source.isEmpty()) throw new Error('Provider trả về dữ liệu ảnh không hợp lệ.')
  const { width, height } = source.getSize()
  const targetRatio = 16 / 9
  const sourceRatio = width / height
  const cropWidth = sourceRatio > targetRatio ? Math.round(height * targetRatio) : width
  const cropHeight = sourceRatio > targetRatio ? height : Math.round(width / targetRatio)
  const cropped = source.crop({
    x: Math.max(0, Math.floor((width - cropWidth) / 2)),
    y: Math.max(0, Math.floor((height - cropHeight) / 2)),
    width: cropWidth,
    height: cropHeight
  })
  return cropped.resize({ width: 1280, height: 720, quality: 'best' }).toPNG()
}

function episodeThumbnail(bytes: Buffer, episode: number): Buffer {
  const encoded = bytes.toString('base64')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><image width="1280" height="720" href="data:image/png;base64,${encoded}" preserveAspectRatio="xMidYMid slice"/><rect x="42" y="42" width="240" height="92" rx="18" fill="#e11d48"/><text x="162" y="108" text-anchor="middle" font-family="Arial, sans-serif" font-size="56" font-weight="900" fill="white">TẬP ${episode}</text></svg>`
  const result = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  if (result.isEmpty()) throw new Error(`Không tạo được thumbnail TẬP ${episode}.`)
  return result.toPNG()
}

export class StoryMediaService {
  private readonly storage = new ProjectStorageService()
  constructor(
    private readonly voices = new VoiceService(),
    private readonly thumbnails = new ThumbnailService(),
    private readonly publishing = new PublishingMetadataService()
  ) {}

  private async synthesizeChunk(voiceId: string, text: string, chunkIndex: number, total: number): Promise<Buffer> {
    let lastError: unknown
    for (let attempt = 1; attempt <= TTS_CHUNK_ATTEMPTS; attempt++) {
      try {
        return await this.voices.synthesize(voiceId, text)
      } catch (error) {
        lastError = error
        const reason = error instanceof Error ? error.message : String(error)
        if (/shark block|ret=-6|security blocked/i.test(reason)) {
          throw new Error('CapCut đang chặn session/device bởi risk-control (ret=-6: shark block only). Hãy đóng CapCut, chờ cooldown, đăng nhập lại và capture request mới vào capcut.local.json. Các chunk đã xong vẫn được giữ để resume.')
        }
        if (attempt < TTS_CHUNK_ATTEMPTS) await sleep(1200 * attempt)
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`Generate voice thất bại ở chunk ${chunkIndex + 1}/${total} sau ${TTS_CHUNK_ATTEMPTS} lần thử: ${reason}`)
  }

  private async makeCta(voiceId: string, projectId: string, forceRegen = false): Promise<string> {
    const ctaPath = this.storage.getProjectPath(projectId, 'audio', '.parts', 'cta.mp3')
    if (!forceRegen) {
      try { if ((await stat(ctaPath)).size > 0) return ctaPath } catch {}
    }
    const bytes = await this.synthesizeChunk(voiceId, CTA_TEXT, 0, 1)
    await this.storage.writeBuffer(projectId, 'audio/.parts/cta.mp3', bytes)
    return ctaPath
  }

  async resumePending(onProgress?: (progress: ReelVideoProgress) => void): Promise<StoryMediaDTO | null> {
    const prisma = getPrisma()
    let resumedMedia: StoryMediaDTO | null = null
    const audioJob = await prisma.job.findFirst({ where: { type: 'GENERATE_STORY_AUDIO', status: 'RUNNING' }, orderBy: { updatedAt: 'asc' } })
    if (audioJob?.projectId && audioJob.payload) {
      const payload = parseMeta(audioJob.payload)
      if (typeof payload.scriptId === 'string') resumedMedia = await this.generateStoryAudio(audioJob.projectId, payload.scriptId)
    }
    const job = await prisma.job.findFirst({ where: { type: 'GENERATE_REEL_VIDEOS', status: 'RUNNING' }, orderBy: { updatedAt: 'asc' } })
    if (!job?.projectId || !job.payload) return resumedMedia
    const payload = parseMeta(job.payload)
    const fitMode: FitMode = payload.fitMode === 'FIT' ? 'FIT' : 'CROP'
    const soundEffect = normalizeSoundEffectOptions(typeof payload.soundEffect === 'object' ? payload.soundEffect as Partial<SoundEffectOptions> : undefined)
    return this.generateReelVideos(job.projectId, fitMode, soundEffect, onProgress)
  }

  async get(projectId: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [thumbnail, audio, background, storyRenders, reelScripts, reelRenders, reelThumbnails, reelAudios, publishAssets] = await Promise.all([
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.render.findMany({ where: { projectId, type: 'STORY_VIDEO', status: { not: 'STALE' } }, orderBy: { createdAt: 'desc' } }),
      prisma.script.findMany({ where: { projectId, type: 'REEL' }, orderBy: { version: 'asc' } }),
      prisma.render.findMany({ where: { projectId, type: 'REEL_VIDEO', status: 'DONE' }, orderBy: { createdAt: 'asc' } }),
      prisma.asset.findMany({ where: { projectId, type: 'REEL_THUMBNAIL' }, orderBy: { createdAt: 'asc' } }),
      prisma.asset.findMany({ where: { projectId, type: 'REEL_AUDIO' }, orderBy: { createdAt: 'asc' } }),
      prisma.asset.findMany({ where: { projectId, type: PUBLISH_METADATA_ASSET_TYPE }, orderBy: { createdAt: 'desc' } })
    ])
    const audioMeta = parseMeta(audio?.metadata)
    const bgMeta = parseMeta(background?.metadata)
    const thumbnailMeta = parseMeta(thumbnail?.metadata)
    const publishByRenderId = new Map<string, { path: string; data: StoredPublishMetadata }>()
    for (const asset of publishAssets) {
      const data = parsePublishMetadata(asset.metadata)
      if (data && !publishByRenderId.has(data.renderId)) publishByRenderId.set(data.renderId, { path: asset.path, data })
    }
    const seenFormats = new Set<VideoFormat>()
    const storyVideoOutputs = storyRenders.flatMap((latestRow) => {
      const latestPreset = parseStoryVideoPreset(latestRow.preset)
      const format = storyRenderFormat(latestRow.path, latestPreset)
      if (seenFormats.has(format)) return []
      seenFormats.add(format)
      const runRows = (latestPreset
        ? storyRenders.filter(row => parseStoryVideoPreset(row.preset)?.runId === latestPreset.runId)
        : [latestRow]
      ).sort((left, right) => (parseStoryVideoPreset(left.preset)?.part ?? 1) - (parseStoryVideoPreset(right.preset)?.part ?? 1))
      const parts = runRows.map((row) => {
        const preset = parseStoryVideoPreset(row.preset)
        const done = row.status === 'DONE'
        const publish = publishByRenderId.get(row.id)
        return {
          part: preset?.part ?? 1,
          totalParts: preset?.totalParts ?? 1,
          format,
          startSeconds: (preset?.startMs ?? 0) / 1000,
          duration: preset ? preset.durationMs / 1000 : null,
          path: done ? row.path : null,
          url: done ? mediaUrl(row.path, row.updatedAt) : null,
          status: row.status,
          publishTitle: publish?.data.title ?? null,
          publishDescription: publish?.data.description ?? null,
          publishMetadataPath: publish?.path ?? null,
          publishSource: publish?.data.source ?? null
        }
      })
      const expectedParts = latestPreset?.totalParts ?? (runRows.length ? 1 : 0)
      const status = runRows.some(row => row.status === 'FAILED')
        ? 'FAILED'
        : runRows.length === expectedParts && runRows.every(row => row.status === 'DONE')
          ? 'DONE'
          : runRows[0]?.status ?? null
      return [{ format, status, parts }]
    })
    const storyVideoParts = storyVideoOutputs[0]?.parts ?? []
    const firstStoryVideo = storyVideoParts.find(part => part.status === 'DONE')
    const renderStatus = storyVideoOutputs[0]?.status ?? null
    return {
      thumbnailPath: thumbnail?.path ?? null,
      thumbnailUrl: mediaUrl(thumbnail?.path, thumbnail?.createdAt),
      thumbnailPrompt: typeof thumbnailMeta.prompt === 'string' ? thumbnailMeta.prompt : null,
      thumbnailProvider: thumbnailMeta.provider === 'openai' || thumbnailMeta.provider === 'gemini' ? thumbnailMeta.provider : null,
      audioPath: audio?.path ?? null,
      audioUrl: mediaUrl(audio?.path, audio?.createdAt),
      audioDuration: typeof audioMeta.duration === 'number' ? audioMeta.duration : null,
      backgroundPath: background?.path ?? null,
      backgroundUrl: mediaUrl(background?.path, background?.createdAt),
      backgroundName: background?.path ? basename(background.path) : null,
      backgroundDuration: typeof bgMeta.duration === 'number' ? bgMeta.duration : null,
      backgroundKind: bgMeta.kind === 'IMAGE' ? 'IMAGE' : background ? 'VIDEO' : null,
      renderPath: firstStoryVideo?.path ?? null,
      renderUrl: firstStoryVideo?.url ?? null,
      renderStatus,
      storyVideoParts,
      storyVideoOutputs,
      reels: reelScripts.map((script, index) => {
        const episode = index + 1
        const match = (rows: Array<{ path: string; metadata: string | null; createdAt: Date }>) => rows.find(row => parseMeta(row.metadata).reelId === script.id)
        const reelRender = reelRenders.find(row => row.preset === script.id)
        const reelThumbnail = match(reelThumbnails)
        const reelAudio = match(reelAudios)
        const publish = reelRender ? publishByRenderId.get(reelRender.id) : undefined
        return {
          reelId: script.id,
          episode,
          title: script.title,
          audioPath: reelAudio?.path ?? null,
          videoPath: reelRender?.path ?? null,
          videoUrl: mediaUrl(reelRender?.path, reelRender?.updatedAt),
          thumbnailPath: reelThumbnail?.path ?? null,
          thumbnailUrl: mediaUrl(reelThumbnail?.path, reelThumbnail?.createdAt),
          status: reelRender?.status ?? null,
          publishTitle: publish?.data.title ?? null,
          publishDescription: publish?.data.description ?? null,
          publishMetadataPath: publish?.path ?? null,
          publishSource: publish?.data.source ?? null
        }
      })
    }
  }

  async generateMetadata(projectId: string, scope: 'ALL' | 'STORY' | 'REELS' = 'ALL', onProgress?: (progress: StoryVideoProgress) => void): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
    const targets: Array<{
      input: PublishTarget
      scope: 'STORY' | 'REELS'
      renderId: string
      renderPath: string
      scriptId: string
      reelId?: string
      part?: number
      totalParts?: number
    }> = []

    if (scope !== 'REELS') {
      const [audio, storyRenders] = await Promise.all([
        prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
        prisma.render.findMany({ where: { projectId, type: 'STORY_VIDEO', status: 'DONE', path: { not: null } }, orderBy: { createdAt: 'desc' } })
      ])
      const audioMeta = parseMeta(audio?.metadata)
      const fallbackScriptId = typeof audioMeta.scriptId === 'string' ? audioMeta.scriptId : null
      const seenStoryFormats = new Set<VideoFormat>()
      const activeRuns = storyRenders.flatMap((latestRow) => {
        const latestPreset = parseStoryVideoPreset(latestRow.preset)
        const format = storyRenderFormat(latestRow.path, latestPreset)
        if (seenStoryFormats.has(format)) return []
        seenStoryFormats.add(format)
        const rows = (latestPreset
          ? storyRenders.filter(row => parseStoryVideoPreset(row.preset)?.runId === latestPreset.runId)
          : [latestRow]
        ).sort((left, right) => (parseStoryVideoPreset(left.preset)?.part ?? 1) - (parseStoryVideoPreset(right.preset)?.part ?? 1))
        return [{ format, rows, scriptId: latestPreset?.scriptId ?? fallbackScriptId }]
      })
      const latestFallbackStory = await prisma.script.findFirst({ where: { projectId, type: 'LONG_STORY' }, orderBy: { version: 'desc' } })
      for (const run of activeRuns) {
        const story = run.scriptId
          ? await prisma.script.findFirst({ where: { id: run.scriptId, projectId, type: 'LONG_STORY' } })
          : latestFallbackStory
        if (!story) continue
        for (const render of run.rows) {
          if (!render.path) continue
          const preset = parseStoryVideoPreset(render.preset)
          const format = run.format
          const part = preset?.part ?? 1
          const totalParts = preset?.totalParts ?? 1
          const mode: PublishMode = format === 'REEL' ? 'STORY_SHORT_9_16' : format === 'SQUARE' ? 'STORY_LONG_1_1' : 'STORY_LONG_16_9'
          targets.push({
            input: {
              key: render.id,
              mode,
              storyTitle: story.title?.trim() || project.name,
              content: format === 'REEL' ? storyTextPart(story.content, part, totalParts) : story.content,
              part: format === 'REEL' ? part : undefined,
              totalParts: format === 'REEL' ? totalParts : undefined
            },
            scope: 'STORY',
            renderId: render.id,
            renderPath: render.path,
            scriptId: story.id,
            part: format === 'REEL' ? part : undefined,
            totalParts: format === 'REEL' ? totalParts : undefined
          })
        }
      }
    }

    if (scope !== 'STORY') {
      const [reels, renders] = await Promise.all([
        prisma.script.findMany({ where: { projectId, type: 'REEL' }, orderBy: { version: 'asc' } }),
        prisma.render.findMany({ where: { projectId, type: 'REEL_VIDEO', status: 'DONE', path: { not: null } }, orderBy: { createdAt: 'asc' } })
      ])
      for (const [index, reel] of reels.entries()) {
        const render = renders.find(row => row.preset === reel.id)
        if (!render?.path) continue
        const episode = index + 1
        targets.push({
          input: {
            key: render.id,
            mode: 'REEL_SHORT_9_16',
            storyTitle: reel.title?.trim() || `${project.name} · Tập ${episode}`,
            content: reel.content,
            part: episode,
            totalParts: reels.length
          },
          scope: 'REELS',
          renderId: render.id,
          renderPath: render.path,
          scriptId: reel.id,
          reelId: reel.id,
          part: episode,
          totalParts: reels.length
        })
      }
    }

    if (!targets.length) throw new Error('Chưa có video hoàn chỉnh để tạo title và description.')
    const reportMetadata = (current: number, percent: number, message: string) => onProgress?.({ current, total: targets.length, percent: Math.round(percent), stage: 'METADATA', message })
    reportMetadata(0, 5, `Đang phân tích nội dung của ${targets.length} video...`)
    const generated = new Map((await this.publishing.generate(targets.map(target => target.input))).map(item => [item.key, item]))
    reportMetadata(0, 60, 'Đã tạo nội dung, đang lưu metadata cạnh từng video...')
    const oldAssets = await prisma.asset.findMany({ where: { projectId, type: PUBLISH_METADATA_ASSET_TYPE } })

    for (const [index, target] of targets.entries()) {
      const result = generated.get(target.input.key)
      if (!result) continue
      const videoFile = basename(target.renderPath)
      const publishedVideoPath = await this.storage.copyToOutput(projectId, `videos/${videoFile}`, target.renderPath)
      if (publishedVideoPath !== target.renderPath) {
        await prisma.render.update({ where: { id: target.renderId }, data: { path: publishedVideoPath } })
      }
      const stored: StoredPublishMetadata = {
        ...result,
        schemaVersion: PUBLISH_METADATA_SCHEMA,
        scope: target.scope,
        mode: target.input.mode,
        renderId: target.renderId,
        scriptId: target.scriptId,
        reelId: target.reelId,
        part: target.part,
        totalParts: target.totalParts,
        videoFile,
        generatedAt: new Date().toISOString()
      }
      const stem = videoFile.replace(/\.[^.]+$/, '')
      const metadataPath = await this.storage.writeOutputText(projectId, `videos/${stem}.metadata.txt`, publishSidecar(stored))
      await prisma.asset.create({
        data: {
          projectId,
          type: PUBLISH_METADATA_ASSET_TYPE,
          path: metadataPath,
          metadata: JSON.stringify(stored)
        }
      })
      const replacedIds = oldAssets.filter(asset => parsePublishMetadata(asset.metadata)?.renderId === target.renderId).map(asset => asset.id)
      if (replacedIds.length) await prisma.asset.deleteMany({ where: { id: { in: replacedIds } } })
      reportMetadata(index + 1, 60 + ((index + 1) / targets.length) * 38, `Đã lưu title/description ${index + 1}/${targets.length}.`)
    }
    const activeRenderIds = new Set(targets.map(target => target.renderId))
    const staleMetadataIds = oldAssets.filter(asset => {
      const metadata = parsePublishMetadata(asset.metadata)
      if (!metadata || activeRenderIds.has(metadata.renderId)) return false
      return scope === 'ALL' || metadata.scope === scope
    }).map(asset => asset.id)
    if (staleMetadataIds.length) await prisma.asset.deleteMany({ where: { id: { in: staleMetadataIds } } })
    reportMetadata(targets.length, 100, `Hoàn tất metadata cho ${targets.length}/${targets.length} video.`)
    return this.get(projectId)
  }

  async generateReelVideos(projectId: string, fitMode: FitMode, soundEffectInput: SoundEffectOptions = DEFAULT_SOUND_EFFECT_OPTIONS, onProgress?: (progress: ReelVideoProgress) => void): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const soundEffect = normalizeSoundEffectOptions(soundEffectInput)
    const soundEffectKey = JSON.stringify(soundEffect)
    const [project, reels, background, baseThumbnail] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findMany({ where: { projectId, type: 'REEL' }, orderBy: { version: 'asc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } })
    ])
    let job = await prisma.job.findFirst({ where: { projectId, type: 'GENERATE_REEL_VIDEOS', status: 'RUNNING' }, orderBy: { createdAt: 'desc' } })
    const jobMeta = parseMeta(job?.payload)
    const savedSoundEffect = normalizeSoundEffectOptions(typeof jobMeta.soundEffect === 'object' ? jobMeta.soundEffect as Partial<SoundEffectOptions> : undefined)
    const resuming = Boolean(job && jobMeta.voiceId === project.voiceId && jobMeta.sfxRenderVersion === SFX_RENDER_VERSION && JSON.stringify(savedSoundEffect) === soundEffectKey)
    if (job && !resuming) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'Voice hoặc cấu hình SFX đã thay đổi; không resume video cũ.' } })
      job = null
    }
    if (!job) job = await prisma.job.create({ data: { projectId, type: 'GENERATE_REEL_VIDEOS', status: 'RUNNING', progress: 0, payload: JSON.stringify({ projectId, fitMode, voiceId: project.voiceId, soundEffect, sfxRenderVersion: SFX_RENDER_VERSION }) } })
    if (!reels.length) throw new Error('Chưa có Reel scripts để tạo video.')
    if (!project.voiceId) throw new Error('Hãy chọn voice trước khi tạo Reel videos.')
    if (!background) throw new Error('Hãy chọn video hoặc ảnh background trước.')
    if (!baseThumbnail) throw new Error('Hãy Generate Thumbnail Truyện trước để tạo thumbnail từng tập.')
    const backgroundKind: BackgroundKind = parseMeta(background.metadata).kind === 'IMAGE' ? 'IMAGE' : 'VIDEO'
    if (!resuming) await prisma.render.deleteMany({ where: { projectId, type: 'REEL_VIDEO' } })
    const totalUnits = reels.length * 4
    let completedUnits = 0
    const report = (current: number, stage: ReelVideoProgress['stage'], message: string, forcePercent?: number) => {
      const progress = forcePercent ?? Math.round((completedUnits / totalUnits) * 100)
      onProgress?.({ current, total: reels.length, percent: progress, stage, message })
      void prisma.job.update({ where: { id: job.id }, data: { progress, payload: JSON.stringify({ projectId, fitMode, voiceId: project.voiceId, soundEffect, sfxRenderVersion: SFX_RENDER_VERSION, current, stage, message }) } })
    }
    report(0, 'STARTING', `Đang chuẩn bị ${reels.length} tập...`, 0)
    // Pre-generate CTA once; reuse the same file for every reel
    const ctaPath = await this.makeCta(project.voiceId, projectId, !resuming)
    const publishedBaseThumbnail = await this.storage.copyToOutput(projectId, 'images/thumbnail.png', baseThumbnail.path)
    if (publishedBaseThumbnail !== baseThumbnail.path) {
      await prisma.asset.update({ where: { id: baseThumbnail.id }, data: { path: publishedBaseThumbnail } })
    }
    const thumbnailBytes = await readFile(publishedBaseThumbnail)
    await prisma.project.update({ where: { id: projectId }, data: { status: 'RENDERING' } })
    try {
      for (const [index, reel] of reels.entries()) {
        const episode = index + 1
        const slug = `reel-${String(episode).padStart(2, '0')}`
        const existingAudio = await prisma.asset.findMany({ where: { projectId, type: 'REEL_AUDIO' } }).then(rows => rows.find(row => {
          const meta = parseMeta(row.metadata)
          return meta.reelId === reel.id && meta.voiceId === project.voiceId
        }))
        let audioPath: string | undefined
        if (existingAudio) {
          audioPath = await this.storage.copyToOutput(projectId, `audio/reels/${slug}.mp3`, existingAudio.path)
          if (audioPath !== existingAudio.path) await prisma.asset.update({ where: { id: existingAudio.id }, data: { path: audioPath } })
        }
        if (!audioPath) {
          const reelChunks = chunks(reel.content, this.voices.getMaxTextLength())
          if (!reelChunks.length) throw new Error(`Reel ${episode} đang trống.`)
          const partPaths: string[] = []
          for (const [chunkIndex, text] of reelChunks.entries()) {
            report(episode, 'AUDIO', `Tập ${episode}/${reels.length}: voice đoạn ${chunkIndex + 1}/${reelChunks.length}...`)
            const audioBytes = await this.synthesizeChunk(project.voiceId, text, chunkIndex, reelChunks.length)
            partPaths.push(await this.storage.writeBuffer(projectId, `audio/reels/.parts/${slug}-${String(chunkIndex + 1).padStart(2, '0')}.mp3`, audioBytes))
          }
          partPaths.push(ctaPath)
          audioPath = await this.storage.getOutputPath(projectId, 'audio', 'reels', `${slug}.mp3`)
          await concatMp3Parts(partPaths, audioPath, this.storage.getProjectPath(projectId, 'audio', 'reels', '.parts', `${slug}-concat.txt`))
          const duration = await probeDuration(audioPath)
          await prisma.asset.create({ data: { projectId, type: 'REEL_AUDIO', path: audioPath, metadata: JSON.stringify({ reelId: reel.id, episode, duration, voiceId: project.voiceId }) } })
        }
        completedUnits++
        report(episode, 'THUMBNAIL', `Tập ${episode}/${reels.length}: đang tạo thumbnail...`)
        const existingThumbs = await prisma.asset.findMany({ where: { projectId, type: 'REEL_THUMBNAIL' } })
        const existingThumb = existingThumbs.find(row => parseMeta(row.metadata).reelId === reel.id)
        if (existingThumb) {
          const thumbPath = await this.storage.copyToOutput(projectId, `images/${slug}-thumbnail.png`, existingThumb.path)
          if (thumbPath !== existingThumb.path) await prisma.asset.update({ where: { id: existingThumb.id }, data: { path: thumbPath } })
        } else {
          const thumbPath = await this.storage.writeOutputBuffer(projectId, `images/${slug}-thumbnail.png`, episodeThumbnail(thumbnailBytes, episode))
          await prisma.asset.create({ data: { projectId, type: 'REEL_THUMBNAIL', path: thumbPath, metadata: JSON.stringify({ reelId: reel.id, episode }) } })
        }
        completedUnits++
        const resolvedSfx = resolveSoundEffectPreset(soundEffect.preset, episode)
        report(episode, 'VIDEO', `Tập ${episode}/${reels.length}: trộn ${resolvedSfx.toLowerCase()} SFX ${soundEffect.volume}% + render video...`)
        const videoPath = await this.storage.getOutputPath(projectId, 'videos', `${slug}.mp4`)
        const existingRender = await prisma.render.findFirst({ where: { projectId, type: 'REEL_VIDEO', preset: reel.id, status: 'DONE' } })
        if (existingRender?.path) {
          const publishedVideo = await this.storage.copyToOutput(projectId, `videos/${slug}.mp4`, existingRender.path)
          if (publishedVideo !== existingRender.path) await prisma.render.update({ where: { id: existingRender.id }, data: { path: publishedVideo } })
        } else {
          const render = await prisma.render.create({ data: { projectId, type: 'REEL_VIDEO', path: videoPath, status: 'RUNNING', preset: reel.id } })
          await renderLoopedVideo({ backgroundPath: background.path, backgroundKind, audioPath, outputPath: videoPath, format: 'REEL', fitMode, soundEffectSeed: episode, soundEffect })
          await prisma.render.update({ where: { id: render.id }, data: { status: 'DONE' } })
        }
        try {
          await extractVideoFrame(videoPath, videoPath.replace(/\.mp4$/i, '.jpg'))
        } catch (err) {
          console.error('Failed to extract reel video thumbnail:', err)
        }
        completedUnits++
      }
      report(reels.length, 'METADATA', `Đang tạo title + description riêng cho ${reels.length} video...`)
      let metadataWarning = ''
      try {
        await this.generateMetadata(projectId, 'REELS', progress => report(reels.length, 'METADATA', progress.message, 75 + progress.percent * 0.25))
      } catch (error) {
        metadataWarning = error instanceof Error ? error.message : String(error)
      }
      completedUnits += reels.length
      await prisma.project.update({ where: { id: projectId }, data: { status: 'READY' } })
      await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', progress: 100 } })
      report(reels.length, 'DONE', metadataWarning ? `Đã xong video; metadata cần thử lại: ${metadataWarning}` : `Hoàn tất ${reels.length}/${reels.length} Reel videos + title/description.`, 100)
      return this.get(projectId)
    } catch (error) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }

  async generateThumbnail(projectId: string, scriptId: string, customPrompt?: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [project, script] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findUniqueOrThrow({ where: { id: scriptId } })
    ])
    if (script.projectId !== projectId || script.type !== 'LONG_STORY') throw new Error('Script không hợp lệ để tạo thumbnail.')
    const context = script.content.replace(/\s+/g, ' ').trim().slice(0, 3500)
    if (!context) throw new Error('Story đang trống, không thể tạo thumbnail.')
    const prompt = [
      'Create a cinematic, emotionally compelling YouTube/Facebook story thumbnail in 16:9 landscape format.',
      'Use one clear focal subject, expressive emotion, dramatic lighting, strong color contrast, and uncluttered composition.',
      'Leave intentional negative space for a title overlay. Do not render any words, captions, logos, watermarks, borders, or UI.',
      `Story title: ${script.title || project.name}.`,
      `Story topic: ${project.topic || 'not specified'}.`,
      `Story context: ${context}`,
      customPrompt?.trim() ? `Additional art direction: ${customPrompt.trim()}` : ''
    ].filter(Boolean).join('\n')
    const image = await this.thumbnails.generate(prompt)
    if (!image.bytes.length) throw new Error('Provider trả về thumbnail rỗng.')
    const thumbnailBytes = normalizeThumbnail(image.bytes)
    const path = await this.storage.writeOutputBuffer(projectId, 'images/thumbnail.png', thumbnailBytes)
    await prisma.asset.deleteMany({ where: { projectId, type: 'THUMBNAIL' } })
    await prisma.asset.create({ data: {
      projectId,
      type: 'THUMBNAIL',
      path,
      metadata: JSON.stringify({ prompt: customPrompt?.trim() || null, generatedPrompt: prompt, provider: image.provider, model: image.model, mimeType: 'image/png', sourceMimeType: image.mimeType, width: 1280, height: 720, scriptId })
    } })
    return this.get(projectId)
  }

  async generateStoryAudio(projectId: string, scriptId: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [project, script] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findUniqueOrThrow({ where: { id: scriptId } })
    ])
    let job = await prisma.job.findFirst({ where: { projectId, type: 'GENERATE_STORY_AUDIO', status: 'RUNNING' }, orderBy: { createdAt: 'desc' } })
    const jobMeta = parseMeta(job?.payload)
    const resuming = Boolean(job && jobMeta.scriptId === scriptId && jobMeta.voiceId === project.voiceId)
    if (job && !resuming) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'Script hoặc voice đã thay đổi; không resume chunk audio cũ.' } })
    }
    if (!resuming) job = await prisma.job.create({ data: { projectId, type: 'GENERATE_STORY_AUDIO', status: 'RUNNING', progress: 0, payload: JSON.stringify({ projectId, scriptId, voiceId: project.voiceId }) } })
    if (script.projectId !== projectId || script.type !== 'LONG_STORY') throw new Error('Script không hợp lệ cho Story MP3.')
    if (!project.voiceId) throw new Error('Hãy chọn voice trước khi Generate Story MP3.')

    const chunkSize = this.voices.getMaxTextLength()
    const pieces = chunks(script.content, chunkSize)
    if (!pieces.length) throw new Error('Story đang trống, không thể generate voice.')

    await prisma.project.update({ where: { id: projectId }, data: { status: 'GENERATING_MEDIA' } })
    const partPaths: string[] = []
    try {
      for (let i = 0; i < pieces.length; i++) {
        const relativePath = `audio/.parts/story-${String(i + 1).padStart(3, '0')}.mp3`
        const path = this.storage.getProjectPath(projectId, 'audio', '.parts', `story-${String(i + 1).padStart(3, '0')}.mp3`)
        let reusable = false
        if (resuming) {
          try { reusable = (await stat(path)).size > 0 } catch {}
        }
        if (!reusable) {
          const bytes = await this.synthesizeChunk(project.voiceId, pieces[i], i, pieces.length)
          if (!bytes.length) throw new Error(`CapCut trả audio rỗng ở chunk ${i + 1}/${pieces.length}.`)
          await this.storage.writeBuffer(projectId, relativePath, bytes)
        }
        partPaths.push(path)
        await prisma.job.update({ where: { id: job!.id }, data: { progress: Math.round(((i + 1) / pieces.length) * 90), payload: JSON.stringify({ projectId, scriptId, voiceId: project.voiceId, chunk: i + 1, total: pieces.length }) } })
      }

      // We no longer append CTA directly to the raw story.mp3 file because CTA is now dynamically
      // appended at the rendering stage to both long videos and all short video segments.
      // partPaths.push(await this.makeCta(project.voiceId, projectId, !resuming))

      const output = await this.storage.getOutputPath(projectId, 'audio', 'story.mp3')
      const listFile = this.storage.getProjectPath(projectId, 'audio', '.parts', 'concat.txt')
      await concatMp3Parts(partPaths, output, listFile)
      const duration = await probeDuration(output)
      if (duration <= 0) throw new Error('Story MP3 đã tạo nhưng duration không hợp lệ.')

      await prisma.asset.deleteMany({ where: { projectId, type: 'STORY_AUDIO' } })
      await prisma.render.updateMany({ where: { projectId, type: 'STORY_VIDEO' }, data: { status: 'STALE' } })
      await prisma.asset.create({ data: { projectId, type: 'STORY_AUDIO', path: output, metadata: JSON.stringify({ duration, scriptId, voiceId: project.voiceId, chunks: pieces.length, chunkSize }) } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'MEDIA_READY' } })
      await prisma.job.update({ where: { id: job!.id }, data: { status: 'DONE', progress: 100 } })
      return this.get(projectId)
    } catch (error) {
      await prisma.job.update({ where: { id: job!.id }, data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }

  async setBackground(projectId: string, sourcePath: string, kind: BackgroundKind = 'VIDEO'): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    if (kind === 'IMAGE' && nativeImage.createFromPath(sourcePath).isEmpty()) throw new Error('File ảnh background không hợp lệ hoặc không đọc được.')
    const copied = await this.storage.copyBackgroundMedia(projectId, sourcePath)
    let duration: number | null = null
    if (kind === 'VIDEO') {
      try {
        duration = await probeDuration(copied)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await prisma.asset.deleteMany({ where: { projectId, type: 'BACKGROUND_VIDEO' } })
    await prisma.render.updateMany({ where: { projectId, type: { in: ['STORY_VIDEO', 'REEL_VIDEO'] } }, data: { status: 'STALE' } })
    await prisma.asset.create({ data: { projectId, type: 'BACKGROUND_VIDEO', path: copied, metadata: JSON.stringify({ duration, sourceName: basename(sourcePath), kind }) } })
    return this.get(projectId)
  }

  async render(projectId: string, format: VideoFormat, fitMode: FitMode, soundEffectInput: SoundEffectOptions = DEFAULT_SOUND_EFFECT_OPTIONS, onProgress?: (progress: StoryVideoProgress) => void): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const soundEffect = normalizeSoundEffectOptions(soundEffectInput)
    const [project, audio, background, thumbnail] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!audio) throw new Error('Chưa có story.mp3. Generate Story MP3 trước.')
    if (!background) throw new Error('Chưa chọn video hoặc ảnh background.')
    const backgroundKind: BackgroundKind = parseMeta(background.metadata).kind === 'IMAGE' ? 'IMAGE' : 'VIDEO'
    const sourceAudioMeta = parseMeta(audio.metadata)
    const sourceScriptId = typeof sourceAudioMeta.scriptId === 'string' ? sourceAudioMeta.scriptId : undefined
    const audioPath = await this.storage.copyToOutput(projectId, 'audio/story.mp3', audio.path)
    if (audioPath !== audio.path) await prisma.asset.update({ where: { id: audio.id }, data: { path: audioPath } })
    if (thumbnail) {
      const thumbnailPath = await this.storage.copyToOutput(projectId, 'images/thumbnail.png', thumbnail.path)
      if (thumbnailPath !== thumbnail.path) await prisma.asset.update({ where: { id: thumbnail.id }, data: { path: thumbnailPath } })
    }
    const audioDuration = await probeDuration(audioPath)
    const segments = planStoryVideoSegments(audioDuration, format)
    const runId = randomUUID()
    const digits = Math.max(2, String(segments.length).length)
    const report = (current: number, percent: number, stage: StoryVideoProgress['stage'], message: string) => {
      onProgress?.({ current, total: segments.length, percent: Math.min(100, Math.max(0, Math.round(percent))), stage, message })
    }

    await prisma.project.update({ where: { id: projectId }, data: { status: 'RENDERING' } })
    const previousFormatRenders = await prisma.render.findMany({
      where: { projectId, type: 'STORY_VIDEO', status: { not: 'STALE' } },
      select: { id: true, path: true, preset: true }
    })
    const previousFormatIds = previousFormatRenders
      .filter(row => storyRenderFormat(row.path, parseStoryVideoPreset(row.preset)) === format)
      .map(row => row.id)
    if (previousFormatIds.length) await prisma.render.updateMany({ where: { id: { in: previousFormatIds } }, data: { status: 'STALE' } })
    report(0, 0, 'STARTING', format === 'REEL' ? `Đang chuẩn bị ${segments.length} video Short 9:16...` : 'Đang chuẩn bị Story video...')
    const ctaPath = project.voiceId ? await this.makeCta(project.voiceId, projectId) : undefined
    let currentRenderId: string | null = null
    try {
      for (const [index, segment] of segments.entries()) {
        const output = format === 'REEL'
          ? await this.storage.getOutputPath(projectId, 'videos', `story-reel-short-${String(segment.part).padStart(digits, '0')}-of-${String(segment.totalParts).padStart(digits, '0')}.mp4`)
          : await this.storage.getOutputPath(projectId, 'videos', `story-${format.toLowerCase()}.mp4`)
        const preset: StoryVideoPreset = { ...segment, kind: 'story-video', schema: STORY_VIDEO_PRESET_SCHEMA, runId, format, fitMode, sfxRenderVersion: SFX_RENDER_VERSION, soundEffect, scriptId: sourceScriptId, audioAssetId: audio.id }
        const render = await prisma.render.create({ data: { projectId, type: 'STORY_VIDEO', path: output, status: 'RUNNING', preset: JSON.stringify(preset) } })
        currentRenderId = render.id
        const label = format === 'REEL' ? `Short ${segment.part}/${segment.totalParts}` : 'Story video'
        report(segment.part, (index / segments.length) * 92, 'VIDEO', `${label}: render ${Math.round(segment.durationMs / 1000)} giây + SFX...`)
        await renderLoopedVideo({
          backgroundPath: background.path,
          backgroundKind,
          audioPath,
          outputPath: output,
          format,
          fitMode,
          soundEffectSeed: format === 'REEL' ? segment.part : 0,
          soundEffect,
          audioStartSeconds: segment.startMs / 1000,
          audioDurationSeconds: segment.durationMs / 1000,
          ctaPath,
          onProgress: partPercent => report(segment.part, ((index + partPercent / 100) / segments.length) * 92, 'VIDEO', `${label}: ${partPercent}% · ${Math.round(segment.durationMs / 1000)} giây + SFX`)
        })
        const ctaDuration = ctaPath ? await probeDuration(ctaPath) : 0
        const expectedDuration = segment.durationMs / 1000 + ctaDuration
        const renderedDuration = await probeDuration(output)
        if (Math.abs(renderedDuration - expectedDuration) > 1) throw new Error(`${label} có duration không hợp lệ sau khi render.`)
        await prisma.render.update({ where: { id: render.id }, data: { status: 'DONE' } })
        try {
          await extractVideoFrame(output, output.replace(/\.mp4$/i, '.jpg'))
        } catch (err) {
          console.error('Failed to extract story video thumbnail:', err)
        }
        currentRenderId = null
      }
      report(segments.length, 94, 'METADATA', `Đang tạo title + description cho ${segments.length} video...`)
      let metadataWarning = ''
      try {
        await this.generateMetadata(projectId, 'STORY', progress => report(segments.length, 94 + progress.percent * 0.05, 'METADATA', progress.message))
      } catch (error) {
        metadataWarning = error instanceof Error ? error.message : String(error)
      }
      await prisma.project.update({ where: { id: projectId }, data: { status: 'READY' } })
      report(segments.length, 100, 'DONE', metadataWarning
        ? `Video đã xong; metadata cần thử lại: ${metadataWarning}`
        : format === 'REEL' ? `Hoàn tất ${segments.length}/${segments.length} video Short 9:16 + title/description.` : 'Story video + title/description đã hoàn tất.')
      return this.get(projectId)
    } catch (error) {
      if (currentRenderId) await prisma.render.update({ where: { id: currentRenderId }, data: { status: 'FAILED' } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }
}
