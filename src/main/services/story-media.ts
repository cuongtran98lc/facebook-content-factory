import { audiencePrompt } from '../../shared/audience'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativeImage } from 'electron'
import { readFile, stat, unlink, writeFile, rename } from 'node:fs/promises'
import sharp from 'sharp'
import { pathToFileURL } from 'node:url'
import type { BackgroundKind, FitMode, ReelVideoProgress, SoundEffectOptions, StickmanSceneImageDTO, StoryMediaDTO, StoryVideoProgress, VideoFormat } from '../../shared/types'
import { getPrisma } from './database'
import { DEFAULT_SOUND_EFFECT_OPTIONS, SFX_RENDER_VERSION, burnVideoCaptions, concatMp3Parts, normalizeSoundEffectOptions, probeDuration, renderLoopedVideo, resolveSoundEffectPreset, extractVideoFrame } from './ffmpeg'
import { ProjectStorageService } from './storage'
import { VoiceService } from './voices'
import { ThumbnailService } from './thumbnails'
import { PublishingMetadataService, type PublishMetadata, type PublishMode, type PublishTarget } from './video-metadata'
import { createAssSubtitles, SUBTITLE_RENDER_VERSION } from './subtitles'

import { AIService } from './ai'
import { CodexCliService } from './ai/codex-cli'
import { ClaudeCliService } from './ai/claude-cli'
import { AntigravityCliService } from './ai/antigravity-cli'
import { parseStickScenes, renderStickAnimation, stickFrame, stickPrompt, storySections } from './stick-animation'

const scriptHash = (text: string) => createHash('sha256').update(text).digest('hex')
const TTS_CHUNK_ATTEMPTS = 4
const STORY_SHORT_MAX_MS = 180_000
const STORY_VIDEO_PRESET_SCHEMA = 1
const CTA_TEXT = 'If you enjoyed this story, hit like and subscribe for more.'
const PUBLISH_METADATA_ASSET_TYPE = 'VIDEO_PUBLISH_METADATA'
const PUBLISH_METADATA_SCHEMA = 1
const REEL_THUMBNAIL_VERSION = 7

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
  includeSubtitles: boolean
  subtitleRenderVersion: number
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
  const caption = metadata.caption || (metadata.title ? `${metadata.title}\n\n${metadata.description}` : metadata.description)
  return [
    `TIÊU ĐỀ (${metadata.mode})`,
    metadata.title,
    '',
    'CAPTION ĐĂNG BÀI (REELS / TIKTOK / FB)',
    caption,
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

function escapeSvgText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function thumbnailTitleLines(value: string): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  for (const word of words) {
    const current = lines[lines.length - 1]
    if (!current || (current.length + word.length + 1 > 21 && lines.length < 3)) lines.push(word)
    else lines[lines.length - 1] = `${current} ${word}`
  }
  if (lines.length > 3) lines.splice(3)
  if (lines[2]?.length > 24) lines[2] = `${lines[2].slice(0, 23).trimEnd()}…`
  return lines.length ? lines : ['TRUYỆN MỚI']
}

async function episodeThumbnail(bytes: Buffer, episode: number, storyTitle: string): Promise<Buffer> {
  const width = 1080
  const height = 1920
  const lines = thumbnailTitleLines(`#${episode}: ${storyTitle}`)
  const frameX = 34
  const frameWidth = 996
  const lineHeight = 94
  const frameHeight = 82 + lines.length * lineHeight
  // Center the complete title box vertically on the TikTok thumbnail.
  const frameY = Math.round((height - frameHeight) / 2)
  const titleSpans = lines.map((line, index) => `<tspan x="${frameX + 46}" dy="${index === 0 ? 0 : lineHeight}">${escapeSvgText(line)}</tspan>`).join('')
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${frameX + 18}" y="${frameY + 20}" width="${frameWidth}" height="${frameHeight}" fill="#111827"/><rect x="${frameX}" y="${frameY}" width="${frameWidth}" height="${frameHeight}" fill="#e91e4d" stroke="#ffffff" stroke-width="8"/><rect x="${frameX + 14}" y="${frameY + 14}" width="${frameWidth - 28}" height="${frameHeight - 28}" fill="none" stroke="#ffffff" stroke-opacity="0.42" stroke-width="3"/><text x="${frameX + 46}" y="${frameY + 108}" text-anchor="start" font-family="Arial, sans-serif" font-size="76" font-weight="900" fill="white">${titleSpans}</text></svg>`)
  try {
    const result = await sharp(bytes)
      // Match the Reel canvas. `cover` preserves the source aspect ratio and
      // crops overflow, so the image is never stretched or distorted.
      .resize(width, height, { fit: 'cover', position: 'centre', withoutEnlargement: false })
      .composite([{ input: overlay, top: 0, left: 0 }])
      .png()
      .toBuffer()
    if (!result.length) throw new Error('Sharp trả ảnh rỗng')
    return result
  } catch (error) {
    throw new Error(`Không tạo được thumbnail TẬP ${episode}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export class StoryMediaService {
  private readonly storage = new ProjectStorageService()
  private readonly activeReelProjects = new Set<string>()
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
    const ctaFile = `cta-${createHash('sha256').update(`${voiceId}:${CTA_TEXT}`).digest('hex').slice(0, 16)}.mp3`
    const ctaPath = this.storage.getProjectPath(projectId, 'audio', '.parts', ctaFile)
    if (!forceRegen) {
      try { if ((await stat(ctaPath)).size > 0) return ctaPath } catch {}
    }
    const bytes = await this.synthesizeChunk(voiceId, CTA_TEXT, 0, 1)
    await this.storage.writeBuffer(projectId, `audio/.parts/${ctaFile}`, bytes)
    return ctaPath
  }

  async resumePending(onProgress?: (progress: ReelVideoProgress) => void): Promise<StoryMediaDTO | null> {
    const prisma = getPrisma()
    let resumedMedia: StoryMediaDTO | null = null
    const audioJob = await prisma.job.findFirst({ where: { type: 'GENERATE_STORY_AUDIO', status: 'RUNNING' }, orderBy: { updatedAt: 'asc' } })
    if (audioJob?.projectId && audioJob.payload) {
      const payload = parseMeta(audioJob.payload)
      if (typeof payload.scriptId === 'string') resumedMedia = await this.generateStoryAudio(audioJob.projectId, payload.scriptId, payload.studioOutput === true)
    }
    const job = await prisma.job.findFirst({ where: { type: 'GENERATE_REEL_VIDEOS', status: 'RUNNING' }, orderBy: { updatedAt: 'asc' } })
    if (!job?.projectId || !job.payload) return resumedMedia
    const payload = parseMeta(job.payload)
    const fitMode: FitMode = payload.fitMode === 'FIT' ? 'FIT' : 'CROP'
    const soundEffect = normalizeSoundEffectOptions(typeof payload.soundEffect === 'object' ? payload.soundEffect as Partial<SoundEffectOptions> : undefined)
    const includeSubtitles = payload.includeSubtitles !== false
    return this.generateReelVideos(job.projectId, fitMode, soundEffect, includeSubtitles, onProgress)
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
      prisma.asset.findMany({ where: { projectId, type: 'REEL_THUMBNAIL' }, orderBy: { createdAt: 'desc' } }),
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
          publishCaption: publish?.data.caption ?? (publish?.data.title ? `${publish.data.title}\n\n${publish.data.description}` : null),
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
      thumbnailProvider: typeof thumbnailMeta.provider === 'string' ? thumbnailMeta.provider : null,
      thumbnailSourceVideoPath: typeof thumbnailMeta.videoPath === 'string' ? thumbnailMeta.videoPath : null,
      thumbnailSourceTimeSeconds: typeof thumbnailMeta.timeSeconds === 'number' ? thumbnailMeta.timeSeconds : null,
      audioPath: audio?.path ?? null,
      audioUrl: mediaUrl(audio?.path, audio?.createdAt),
      audioDuration: typeof audioMeta.duration === 'number' ? audioMeta.duration : null,
      backgroundPath: background?.path ?? null,
      backgroundUrl: mediaUrl(background?.path, background?.createdAt),
      backgroundName: background?.path ? basename(background.path) : null,
      backgroundDuration: typeof bgMeta.duration === 'number' ? bgMeta.duration : null,
      backgroundStyle: bgMeta.style === 'STICK_FIGURE' ? 'STICK_FIGURE' : 'CUSTOM',
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
          publishCaption: publish?.data.caption ?? (publish?.data.title ? `${publish.data.title}\n\n${publish.data.description}` : null),
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
    const generated = new Map((await this.publishing.generate(targets.map(target => ({ ...target.input, targetMarket: project.targetMarket, contentLanguage: project.contentLanguage })))).map(item => [item.key, item]))
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

  async generateReelVideos(projectId: string, fitMode: FitMode, soundEffectInput: SoundEffectOptions = DEFAULT_SOUND_EFFECT_OPTIONS, includeSubtitles = true, onProgress?: (progress: ReelVideoProgress) => void): Promise<StoryMediaDTO> {
    if (this.activeReelProjects.has(projectId)) {
      throw new Error('Dự án này đang tạo Reel videos. Vui lòng chờ tiến trình hiện tại hoàn tất hoặc hủy trong Render Queue.')
    }
    this.activeReelProjects.add(projectId)
    try {
      return await this.generateReelVideosInternal(projectId, fitMode, soundEffectInput, includeSubtitles, onProgress)
    } finally {
      this.activeReelProjects.delete(projectId)
    }
  }

  async regenerateReelThumbnails(projectId: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [project, story, reels, renders] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findFirst({ where: { projectId, type: 'LONG_STORY' }, orderBy: [{ approved: 'desc' }, { version: 'desc' }] }),
      prisma.script.findMany({ where: { projectId, type: 'REEL' }, orderBy: { version: 'asc' } }),
      prisma.render.findMany({ where: { projectId, type: 'REEL_VIDEO', status: 'DONE', path: { not: null } } })
    ])
    if (!reels.length) throw new Error('Chưa có Reel scripts để tạo thumbnail.')
    const storyTitle = story?.title?.trim() || project.name
    let generated = 0
    for (const [index, reel] of reels.entries()) {
      const render = renders.find(row => row.preset === reel.id)
      if (!render?.path) continue
      const videoFile = await stat(render.path).catch(() => null)
      if (!videoFile?.isFile() || videoFile.size === 0) continue
      const episode = index + 1
      const slug = `reel-${String(episode).padStart(2, '0')}`
      const tempFrame = join(tmpdir(), `reel-thumb-frame-${randomUUID()}.png`)
      try {
        await extractVideoFrame(render.path, tempFrame, 0.5)
        const frameBytes = await readFile(tempFrame)
        const thumbPath = await this.storage.writeOutputBuffer(projectId, `images/${slug}-thumbnail.png`, await episodeThumbnail(frameBytes, episode, storyTitle))
        const oldThumbs = await prisma.asset.findMany({ where: { projectId, type: 'REEL_THUMBNAIL' } })
        const oldIds = oldThumbs.filter(row => parseMeta(row.metadata).reelId === reel.id).map(row => row.id)
        if (oldIds.length) await prisma.asset.deleteMany({ where: { id: { in: oldIds } } })
        await prisma.asset.create({ data: {
          projectId,
          type: 'REEL_THUMBNAIL',
          path: thumbPath,
          metadata: JSON.stringify({ reelId: reel.id, episode, storyTitle, thumbnailSourceKey: `video:${render.id}:${render.updatedAt.toISOString()}`, sourceVideoPath: render.path, sourceTimeSeconds: 0.5, thumbnailVersion: REEL_THUMBNAIL_VERSION, width: 1080, height: 1920, fit: 'cover' })
        } })
        generated++
      } finally {
        await unlink(tempFrame).catch(() => undefined)
      }
    }
    if (!generated) throw new Error('Không tìm thấy Reel video đã hoàn tất để trích thumbnail.')
    return this.get(projectId)
  }

  private async generateReelVideosInternal(projectId: string, fitMode: FitMode, soundEffectInput: SoundEffectOptions = DEFAULT_SOUND_EFFECT_OPTIONS, includeSubtitles = true, onProgress?: (progress: ReelVideoProgress) => void): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const soundEffect = normalizeSoundEffectOptions(soundEffectInput)
    const soundEffectKey = JSON.stringify(soundEffect)
    const [project, reels, background, baseThumbnail, story] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findMany({ where: { projectId, type: 'REEL' }, orderBy: { version: 'asc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } }),
      prisma.script.findFirst({ where: { projectId, type: 'LONG_STORY' }, orderBy: [{ approved: 'desc' }, { version: 'desc' }] })
    ])
    const isStickBackground = parseMeta(background?.metadata).style === 'STICK_FIGURE'
    let job = await prisma.job.findFirst({ where: { projectId, type: 'GENERATE_REEL_VIDEOS', status: 'RUNNING' }, orderBy: { createdAt: 'desc' } })
    const jobMeta = parseMeta(job?.payload)
    const savedSoundEffect = normalizeSoundEffectOptions(typeof jobMeta.soundEffect === 'object' ? jobMeta.soundEffect as Partial<SoundEffectOptions> : undefined)
    const resuming = Boolean(
      job &&
      jobMeta.voiceId === project.voiceId &&
      jobMeta.sfxRenderVersion === SFX_RENDER_VERSION &&
      jobMeta.subtitleRenderVersion === SUBTITLE_RENDER_VERSION &&
      jobMeta.includeSubtitles !== false === includeSubtitles &&
      JSON.stringify(savedSoundEffect) === soundEffectKey
    )
    if (job && !resuming) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'Voice, SFX hoặc cấu hình phụ đề đã thay đổi; không resume video cũ.' } })
      job = null
    }
    if (!job) job = await prisma.job.create({ data: { projectId, type: 'GENERATE_REEL_VIDEOS', status: 'RUNNING', progress: 0, payload: JSON.stringify({ projectId, fitMode, voiceId: project.voiceId, soundEffect, sfxRenderVersion: SFX_RENDER_VERSION, includeSubtitles, subtitleRenderVersion: SUBTITLE_RENDER_VERSION }) } })
    if (!reels.length) throw new Error('Chưa có Reel scripts để tạo video.')
    if (!project.voiceId) throw new Error('Hãy chọn voice trước khi tạo Reel videos.')
    if (!background) throw new Error('Hãy chọn video hoặc ảnh background trước.')
    const backgroundKind: BackgroundKind = parseMeta(background.metadata).kind === 'IMAGE' ? 'IMAGE' : 'VIDEO'
    // Do not discard completed render records on every button press. Each reel
    // below already decides whether its DONE render can be reused.
    const totalUnits = reels.length * 4
    let completedUnits = 0
    const report = (current: number, stage: ReelVideoProgress['stage'], message: string, forcePercent?: number) => {
      const progress = forcePercent ?? Math.round((completedUnits / totalUnits) * 100)
      onProgress?.({ current, total: reels.length, percent: progress, stage, message })
      void prisma.job.update({ where: { id: job.id }, data: { progress, payload: JSON.stringify({ projectId, fitMode, voiceId: project.voiceId, soundEffect, sfxRenderVersion: SFX_RENDER_VERSION, includeSubtitles, subtitleRenderVersion: SUBTITLE_RENDER_VERSION, current, stage, message }) } })
    }
    report(0, 'STARTING', `Đang chuẩn bị ${reels.length} tập...`, 0)
    // CTA is loaded lazily only when at least one reel is actually missing its
    // audio. A completed project must not contact the TTS provider again.
    let ctaPath: string | undefined
    let thumbnailBytes!: Buffer
    let baseThumbnailAvailable = false
    if (baseThumbnail) {
      try {
        const publishedBaseThumbnail = await this.storage.copyToOutput(projectId, 'images/thumbnail.png', baseThumbnail.path)
        if (publishedBaseThumbnail !== baseThumbnail.path) {
          await prisma.asset.update({ where: { id: baseThumbnail.id }, data: { path: publishedBaseThumbnail } })
        }
        thumbnailBytes = await readFile(publishedBaseThumbnail)
        baseThumbnailAvailable = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        console.warn(`[story-media] Thumbnail asset bị mất tại ${baseThumbnail.path}; tự lấy từ background.`)
      }
    }
    if (!baseThumbnailAvailable) {
      let sourceBytes: Buffer
      if (backgroundKind === 'IMAGE') {
        sourceBytes = await readFile(background.path)
      } else {
        const tempFrame = join(tmpdir(), `reel-thumbnail-source-${randomUUID()}.png`)
        try {
          await extractVideoFrame(background.path, tempFrame, 0)
          sourceBytes = await readFile(tempFrame)
        } finally {
          await unlink(tempFrame).catch(() => undefined)
        }
      }
      thumbnailBytes = await sharp(sourceBytes).png().toBuffer()
      const recoveredPath = await this.storage.writeOutputBuffer(projectId, 'images/thumbnail.png', thumbnailBytes)
      await prisma.asset.deleteMany({ where: { projectId, type: 'THUMBNAIL' } })
      await prisma.asset.create({ data: {
        projectId,
        type: 'THUMBNAIL',
        path: recoveredPath,
        metadata: JSON.stringify({ provider: 'background', model: 'auto-recovery', sourcePath: background.path, mimeType: 'image/png' })
      } })
      report(0, 'THUMBNAIL', 'Thumbnail gốc bị thiếu; đã tự khôi phục từ background.', 1)
    }
    await prisma.project.update({ where: { id: projectId }, data: { status: 'RENDERING' } })
    try {
      for (const [index, reel] of reels.entries()) {
        const episode = index + 1
        const slug = `reel-${String(episode).padStart(2, '0')}`
        const storyTitle = story?.title?.trim() || project.name
        const thumbnailSourceKey = baseThumbnail
          ? `${baseThumbnail.id}:${baseThumbnail.createdAt.toISOString()}`
          : `${background.id}:${background.createdAt.toISOString()}`
        const expectedAudioPath = await this.storage.getOutputPath(projectId, 'audio', 'reels', `${slug}.mp3`)
        const existingAudio = await prisma.asset.findMany({ where: { projectId, type: 'REEL_AUDIO' } }).then(rows => rows.find(row => {
          const meta = parseMeta(row.metadata)
          return meta.reelId === reel.id && meta.voiceId === project.voiceId
        }))
        let audioPath: string | undefined
        if (existingAudio) {
          audioPath = await this.storage.copyToOutput(projectId, `audio/reels/${slug}.mp3`, existingAudio.path)
          if (audioPath !== existingAudio.path) await prisma.asset.update({ where: { id: existingAudio.id }, data: { path: audioPath } })
        }
        // Older runs could leave valid output files behind after their database
        // records were removed. Recover a file only when it is newer than the
        // current reel script, so regenerated scripts still trigger fresh TTS.
        if (!audioPath) {
          const recovered = await stat(expectedAudioPath).catch(() => null)
          if (recovered?.isFile() && recovered.size > 0 && recovered.mtime >= reel.createdAt) {
            const duration = await probeDuration(expectedAudioPath)
            audioPath = expectedAudioPath
            await prisma.asset.create({ data: { projectId, type: 'REEL_AUDIO', path: audioPath, metadata: JSON.stringify({ reelId: reel.id, episode, duration, voiceId: project.voiceId, recoveredFromOutput: true }) } })
          }
        }
        if (!audioPath) {
          ctaPath ??= await this.makeCta(project.voiceId, projectId)
          const reelChunks = chunks(reel.content, this.voices.getMaxTextLength())
          if (!reelChunks.length) throw new Error(`Reel ${episode} đang trống.`)
          const partPaths: string[] = []
          for (const [chunkIndex, text] of reelChunks.entries()) {
            report(episode, 'AUDIO', `Tập ${episode}/${reels.length}: voice đoạn ${chunkIndex + 1}/${reelChunks.length}...`)
            const audioBytes = await this.synthesizeChunk(project.voiceId, text, chunkIndex, reelChunks.length)
            partPaths.push(await this.storage.writeBuffer(projectId, `audio/reels/.parts/${slug}-${String(chunkIndex + 1).padStart(2, '0')}.mp3`, audioBytes))
          }
          partPaths.push(ctaPath)
          audioPath = expectedAudioPath
          await concatMp3Parts(partPaths, audioPath, this.storage.getProjectPath(projectId, 'audio', 'reels', '.parts', `${slug}-concat.txt`))
          const duration = await probeDuration(audioPath)
          await prisma.asset.create({ data: { projectId, type: 'REEL_AUDIO', path: audioPath, metadata: JSON.stringify({ reelId: reel.id, episode, duration, voiceId: project.voiceId }) } })
        }
        completedUnits++
        report(episode, 'THUMBNAIL', `Tập ${episode}/${reels.length}: đang tạo thumbnail...`)
        const existingThumbs = await prisma.asset.findMany({ where: { projectId, type: 'REEL_THUMBNAIL' } })
        const existingThumb = existingThumbs.find(row => {
          const metadata = parseMeta(row.metadata)
          return metadata.reelId === reel.id &&
            metadata.thumbnailVersion === REEL_THUMBNAIL_VERSION &&
            metadata.width === 1080 &&
            metadata.height === 1920 &&
            metadata.storyTitle === storyTitle &&
            metadata.thumbnailSourceKey === thumbnailSourceKey
        })
        if (existingThumb) {
          const thumbPath = await this.storage.copyToOutput(projectId, `images/${slug}-thumbnail.png`, existingThumb.path)
          if (thumbPath !== existingThumb.path) await prisma.asset.update({ where: { id: existingThumb.id }, data: { path: thumbPath } })
        } else {
          const staleThumbIds = existingThumbs
            .filter(row => parseMeta(row.metadata).reelId === reel.id)
            .map(row => row.id)
          if (staleThumbIds.length) await prisma.asset.deleteMany({ where: { id: { in: staleThumbIds } } })
          const thumbPath = await this.storage.writeOutputBuffer(projectId, `images/${slug}-thumbnail.png`, await episodeThumbnail(thumbnailBytes, episode, storyTitle))
          await prisma.asset.create({ data: { projectId, type: 'REEL_THUMBNAIL', path: thumbPath, metadata: JSON.stringify({ reelId: reel.id, episode, storyTitle, thumbnailSourceKey, thumbnailVersion: REEL_THUMBNAIL_VERSION, width: 1080, height: 1920, fit: 'cover' }) } })
        }
        completedUnits++
        const resolvedSfx = resolveSoundEffectPreset(soundEffect.preset, episode)
        report(episode, 'VIDEO', `Tập ${episode}/${reels.length}: trộn ${resolvedSfx.toLowerCase()} SFX ${soundEffect.volume}%${includeSubtitles ? ' + phụ đề' : ''} + render video...`)
        const videoPath = await this.storage.getOutputPath(projectId, 'videos', `${slug}.mp4`)
        let existingRender = await prisma.render.findFirst({ where: { projectId, type: 'REEL_VIDEO', preset: reel.id, status: 'DONE' } })
        if (!existingRender) {
          const [videoFile, audioFile] = await Promise.all([
            stat(videoPath).catch(() => null),
            stat(audioPath).catch(() => null)
          ])
          if (videoFile?.isFile() && videoFile.size > 0 && audioFile && videoFile.mtime >= audioFile.mtime && videoFile.mtime >= reel.createdAt) {
            existingRender = await prisma.render.create({ data: { projectId, type: 'REEL_VIDEO', path: videoPath, status: 'DONE', preset: reel.id } })
          }
        }
        if (existingRender?.path) {
          const publishedVideo = await this.storage.copyToOutput(projectId, `videos/${slug}.mp4`, existingRender.path)
          if (publishedVideo !== existingRender.path) await prisma.render.update({ where: { id: existingRender.id }, data: { path: publishedVideo } })
        } else {
          const render = await prisma.render.create({ data: { projectId, type: 'REEL_VIDEO', path: videoPath, status: 'RUNNING', preset: reel.id } })
          const reelAudioDuration = await probeDuration(audioPath)
          const subtitlePath = includeSubtitles
            ? await this.storage.writeOutputText(projectId, `subtitles/${slug}.ass`, createAssSubtitles({
                text: `${reel.content}\n\n${CTA_TEXT}`,
                totalDuration: reelAudioDuration,
                format: 'REEL'
              }))
            : undefined

          let reelBgPath = background.path
          let reelBgKind = backgroundKind
          let reelFrameRate: 30 | 60 = 30

          if (isStickBackground) {
            report(episode, 'VIDEO', `Tập ${episode}/${reels.length}: đang tạo hoạt hình người que Short 9:16...`)
            const reelSections = storySections(reel.content, true)
            const generator = new AIService().provider()
            let reelScenes: any[] = []
            try {
              const res = await generator.generateText({ json: true, prompt: stickPrompt(reelSections, true) })
              reelScenes = parseStickScenes(res, reelSections.length)
            } catch {
              reelScenes = reelSections.map((_, sIdx) => ({
                setting: sIdx === 0 ? 'home' : sIdx % 2 === 0 ? 'street' : 'office',
                actors: [{ name: 'An', action: sIdx === 0 ? 'wave' : 'talk', role: 'MAIN' }]
              }))
            }
            reelScenes.push({ setting: reelScenes[reelScenes.length - 1].setting, actors: [{ ...reelScenes[reelScenes.length - 1].actors[0], action: 'wave' }] })
            reelSections.push(CTA_TEXT)
            const stickReelPath = await this.storage.getOutputPath(projectId, 'background', `stick-${slug}-${randomUUID()}.mp4`)
            await renderStickAnimation(reelScenes, reelSections, reelAudioDuration, 'REEL', stickReelPath, pct => {
              report(episode, 'VIDEO', `Tập ${episode}/${reels.length}: dựng hoạt hình người que ${pct}%...`)
            }, audioPath)
            reelBgPath = stickReelPath
            reelBgKind = 'VIDEO'
            reelFrameRate = 60
          }

          await renderLoopedVideo({
            backgroundPath: reelBgPath,
            backgroundKind: reelBgKind,
            frameRate: reelFrameRate,
            audioPath,
            outputPath: videoPath,
            format: 'REEL',
            fitMode,
            soundEffectSeed: episode,
            soundEffect,
            subtitlePath
          })
          await prisma.render.update({ where: { id: render.id }, data: { status: 'DONE' } })
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
      audiencePrompt(project),
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

  async extractThumbnailFromVideo(projectId: string, videoPath: string, timeSeconds: number, studioScriptId?: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
    try {
      await stat(videoPath)
    } catch {
      throw new Error(`Video file không tồn tại tại đường dẫn: ${videoPath}`)
    }
    const tempPath = join(tmpdir(), `extracted-frame-${randomUUID()}.png`)
    try {
      await extractVideoFrame(videoPath, tempPath, timeSeconds)
      const frameBytes = await readFile(tempPath)
      // A frame extracted from a video already has the video's native aspect
      // ratio. Keep it intact instead of routing it through the 16:9
      // normalizer used for AI-generated landscape thumbnails.
      const frame = sharp(frameBytes)
      const frameMetadata = await frame.metadata()
      if (!frameMetadata.width || !frameMetadata.height) throw new Error('Không đọc được kích thước frame trích xuất từ video.')
      const thumbnailBytes = await frame.png().toBuffer()
      const path = studioScriptId
        ? await this.storage.getStudioOutputPath(projectId, studioScriptId, 'images', 'thumbnail.png')
        : await this.storage.getOutputPath(projectId, 'images', 'thumbnail.png')
      await writeFile(path, thumbnailBytes)
      await prisma.asset.deleteMany({ where: { projectId, type: 'THUMBNAIL' } })
      await prisma.asset.create({
        data: {
          projectId,
          type: 'THUMBNAIL',
          path,
          metadata: JSON.stringify({
            provider: 'video',
            model: 'ffmpeg',
            videoPath,
            timeSeconds,
            mimeType: 'image/png',
            width: frameMetadata.width,
            height: frameMetadata.height,
            sourceAspectRatio: frameMetadata.width / frameMetadata.height,
            preserveSourceRatio: true
          })
        }
      })
    } finally {
      await unlink(tempPath).catch(() => undefined)
    }
    return this.get(projectId)
  }


  async generateStoryAudio(projectId: string, scriptId: string, studioOutput = false): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [project, script] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findUniqueOrThrow({ where: { id: scriptId } })
    ])
    if (script.projectId !== projectId || script.type !== 'LONG_STORY') throw new Error('Script không hợp lệ cho Story MP3.')
    if (!project.voiceId) throw new Error('Hãy chọn voice trước khi Generate Story MP3.')
    const chunkSize = this.voices.getMaxTextLength()
    const pieces = chunks(script.content, chunkSize)
    if (!pieces.length) throw new Error('Story đang trống, không thể generate voice.')
    let job = await prisma.job.findFirst({ where: { projectId, type: 'GENERATE_STORY_AUDIO', status: 'RUNNING' }, orderBy: { createdAt: 'desc' } })
    const jobMeta = parseMeta(job?.payload)
    const resuming = Boolean(job && jobMeta.scriptId === scriptId && jobMeta.scriptHash === scriptHash(script.content) && jobMeta.voiceId === project.voiceId)
    if (job && !resuming) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'Script hoặc voice đã thay đổi; không resume chunk audio cũ.' } })
    }
    if (!resuming) job = await prisma.job.create({ data: { projectId, type: 'GENERATE_STORY_AUDIO', status: 'RUNNING', progress: 0, payload: JSON.stringify({ projectId, scriptId, studioOutput, scriptHash: scriptHash(script.content), voiceId: project.voiceId }) } })

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
        await prisma.job.update({ where: { id: job!.id }, data: { progress: Math.round(((i + 1) / pieces.length) * 90), payload: JSON.stringify({ projectId, scriptId, studioOutput, voiceId: project.voiceId, chunk: i + 1, total: pieces.length }) } })
      }

      // Append CTA at the end of the story audio
      partPaths.push(await this.makeCta(project.voiceId, projectId, !resuming))

      const output = studioOutput
        ? await this.storage.getStudioOutputPath(projectId, scriptId, 'audio', 'story.mp3')
        : await this.storage.getOutputPath(projectId, 'audio', 'story.mp3')
      const listFile = this.storage.getProjectPath(projectId, 'audio', '.parts', 'concat.txt')
      await concatMp3Parts(partPaths, output, listFile)
      const duration = await probeDuration(output)
      if (duration <= 0) throw new Error('Story MP3 đã tạo nhưng duration không hợp lệ.')

      await prisma.asset.deleteMany({ where: { projectId, type: 'STORY_AUDIO' } })
      await prisma.render.updateMany({ where: { projectId, type: 'STORY_VIDEO' }, data: { status: 'STALE' } })
      await prisma.asset.create({ data: { projectId, type: 'STORY_AUDIO', path: output, metadata: JSON.stringify({ duration, scriptId, scriptHash: scriptHash(script.content), voiceId: project.voiceId, chunks: pieces.length, chunkSize }) } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'MEDIA_READY' } })
      await prisma.job.update({ where: { id: job!.id }, data: { status: 'DONE', progress: 100 } })
      return this.get(projectId)
    } catch (error) {
      await prisma.job.update({ where: { id: job!.id }, data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }

  private readonly stickRuns = new Set<string>()

  async generateStickVideo(projectId: string, scriptId: string, format: VideoFormat, onProgress?: (progress: StoryVideoProgress) => void, source: 'API' | 'CODEX_CLI' | 'CLAUDE_CLI' | 'ANTIGRAVITY_CLI' = 'API', studioOutput = false): Promise<StoryMediaDTO> {
    if (!['LANDSCAPE', 'REEL', 'SQUARE'].includes(format)) throw new Error('Định dạng video không hợp lệ.')
    if (!['API', 'CODEX_CLI', 'CLAUDE_CLI', 'ANTIGRAVITY_CLI'].includes(source)) throw new Error('Nguồn tạo storyboard không hợp lệ.')
    if (this.stickRuns.has(projectId)) throw new Error('Dự án đang tạo hoạt hình người que.')
    this.stickRuns.add(projectId)
    const prisma = getPrisma()
    let output: string | undefined
    let published = false
    const report = (percent: number, message: string) => onProgress?.({ current: 0, total: 1, percent, stage: 'VIDEO', message })
    try {
      const script = await prisma.script.findFirst({ where: { id: scriptId, projectId } })
      if (!script) throw new Error('Không tìm thấy kịch bản để tạo hoạt hình.')
      const isReel = script.type === 'REEL'
      const effectiveFormat = isReel ? 'REEL' : format
      let audioPath: string | undefined
      let audioId: string | undefined

      if (isReel) {
        const reelAudios = await prisma.asset.findMany({ where: { projectId, type: 'REEL_AUDIO' } })
        const existingAudio = reelAudios.find(row => {
          const meta = parseMeta(row.metadata)
          return meta.reelId === script.id && meta.scriptHash === scriptHash(script.content)
        })
        if (existingAudio) {
          audioPath = existingAudio.path
          audioId = existingAudio.id
        } else {
          const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
          if (!project.voiceId) throw new Error('Hãy chọn voice trước khi tạo hoạt hình cho Reel.')
          report(1, 'Đang tạo voice cho kịch bản Reel...')
          const episode = script.version || 1
          const slug = `reel-${String(episode).padStart(2, '0')}`
          const expectedAudioPath = studioOutput
            ? await this.storage.getStudioOutputPath(projectId, scriptId, 'audio', 'reel.mp3')
            : await this.storage.getOutputPath(projectId, 'audio', 'reels', `${slug}.mp3`)
          const ctaPath = await this.makeCta(project.voiceId, projectId)
          const reelChunks = chunks(script.content, this.voices.getMaxTextLength())
          const partPaths: string[] = []
          for (const [chunkIndex, text] of reelChunks.entries()) {
            const audioBytes = await this.synthesizeChunk(project.voiceId, text, chunkIndex, reelChunks.length)
            partPaths.push(await this.storage.writeBuffer(projectId, `audio/reels/.parts/${slug}-${chunkIndex + 1}.mp3`, audioBytes))
          }
          partPaths.push(ctaPath)
          await concatMp3Parts(partPaths, expectedAudioPath, this.storage.getProjectPath(projectId, 'audio', 'reels', '.parts', `${slug}-concat.txt`))
          const reelDuration = await probeDuration(expectedAudioPath)
          const createdAudio = await prisma.asset.create({
            data: { projectId, type: 'REEL_AUDIO', path: expectedAudioPath, metadata: JSON.stringify({ reelId: script.id, scriptHash: scriptHash(script.content), episode, duration: reelDuration, voiceId: project.voiceId }) }
          })
          audioPath = createdAudio.path
          audioId = createdAudio.id
        }
      } else {
        const audio = await prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } })
        if (!audio) throw new Error('Hãy tạo truyện và Story MP3 trước.')
        const audioMeta = parseMeta(audio.metadata)
        if (audioMeta.scriptId !== scriptId || audioMeta.scriptHash !== scriptHash(script.content)) throw new Error('Hãy Generate Story MP3 lại từ truyện hiện tại trước khi tạo hoạt hình.')
        audioPath = audio.path
        audioId = audio.id
      }

      const duration = await probeDuration(audioPath)
      if (studioOutput && isReel && (duration < 30 || duration > 60)) throw new Error(`Voice tập này dài ${duration.toFixed(1)} giây, ngoài mục tiêu 30–60 giây. Hãy chỉnh tốc độ voice hoặc chia lại kịch bản trước khi dựng.`)
      const isShort = isReel || effectiveFormat === 'REEL' || duration <= 90
      const sections = storySections(script.content, isShort)
      const sourceLabel = source === 'CODEX_CLI' ? 'Codex CLI' : source === 'CLAUDE_CLI' ? 'Claude CLI' : source === 'ANTIGRAVITY_CLI' ? 'Antigravity CLI' : 'AI API'
      report(2, `${sourceLabel} đang phân tích ${sections.length} cảnh ${isShort ? 'Short 9:16 ' : ''}từ kịch bản...`)
      const generator = source === 'CODEX_CLI' ? new CodexCliService() : source === 'CLAUDE_CLI' ? new ClaudeCliService() : source === 'ANTIGRAVITY_CLI' ? new AntigravityCliService() : new AIService().provider()
      const response = await generator.generateText({ json: true, prompt: stickPrompt(sections, isShort) })
      const scenes = parseStickScenes(response, sections.length)
      // Narration ends with the app CTA. Give it a separate scene and timing weight.
      scenes.push({ setting: scenes[scenes.length - 1].setting, actors: [{ ...scenes[scenes.length - 1].actors[0], action: 'wave' }] })
      sections.push(CTA_TEXT)
      const runId = randomUUID()
      output = studioOutput
        ? await this.storage.getStudioOutputPath(projectId, scriptId, 'videos', `stick-${runId}.mp4`)
        : await this.storage.getOutputPath(projectId, 'background', `stick-${runId}.mp4`)
      await renderStickAnimation(scenes, sections, duration, effectiveFormat, output, percent => report(5 + Math.round(percent * .65), `Đang dựng hoạt hình người que ${effectiveFormat === 'REEL' ? 'Short 9:16' : ''}: ${percent}%`), audioPath)
      report(72, 'Đang tạo caption từ lời đọc và CTA...')
      const subtitlePath = studioOutput
        ? await this.storage.getStudioOutputPath(projectId, scriptId, 'subtitles', `stick-${runId}.ass`)
        : await this.storage.getOutputPath(projectId, 'subtitles', `stick-${runId}.ass`)
      await writeFile(subtitlePath, createAssSubtitles({ text: `${script.content}\n\n${CTA_TEXT}`, totalDuration: duration, format: effectiveFormat }), 'utf8')
      const captionedOutput = output.replace(/\.mp4$/i, '-captioned.mp4')
      try {
        await burnVideoCaptions(output, subtitlePath, captionedOutput, duration,
          percent => report(73 + Math.round(percent * .22), `Đang ghép caption vào video: ${percent}%`))
        await rename(captionedOutput, output)
      } finally { await unlink(captionedOutput).catch(() => undefined) }
      const measured = await probeDuration(output)
      if (Math.abs(measured - duration) > .2) throw new Error('Thời lượng hoạt hình không khớp lời đọc.')
      const latestScript = await prisma.script.findUnique({ where: { id: scriptId } })
      if (latestScript?.content !== script.content) throw new Error('Truyện hoặc lời đọc đã thay đổi. Hãy tạo lại hoạt hình.')
      const storyboardData = JSON.stringify({ scriptId, audioAssetId: audioId, format: effectiveFormat, duration: measured, timing: 'word-weighted', subtitlePath, subtitleTiming: 'estimated-from-text', scenes: scenes.map((scene, index) => ({ ...scene, text: sections[index] })), isShort }, null, 2)
      const storyboardPath = studioOutput
        ? await this.storage.getStudioOutputPath(projectId, scriptId, 'storyboard', `stick-${runId}.json`)
        : await this.storage.getOutputPath(projectId, 'background', `stick-${runId}.json`)
      await writeFile(storyboardPath, storyboardData, 'utf8')
      await prisma.$transaction([
        prisma.asset.deleteMany({ where: { projectId, type: 'BACKGROUND_VIDEO' } }),
        prisma.asset.create({ data: { projectId, type: 'BACKGROUND_VIDEO', path: output, metadata: JSON.stringify({ kind: 'VIDEO', style: 'STICK_FIGURE', format: effectiveFormat, duration: measured, audioAssetId: audioId, scriptId: script.id, scriptHash: scriptHash(script.content), storyboardPath, subtitlePath, captionsBurnedIn: true, isShort }) } }),
        prisma.render.updateMany({ where: { projectId, type: { in: ['STORY_VIDEO', 'REEL_VIDEO'] } }, data: { status: 'STALE' } })
      ])
      published = true
      report(97, 'Đang lấy thumbnail từ video hoạt hình...')
      const media = await this.extractThumbnailFromVideo(projectId, output, Math.min(1, measured / 2), studioOutput ? scriptId : undefined)
      report(100, `Hoạt hình ${effectiveFormat === 'REEL' ? 'Short 9:16' : ''} có lời đọc, caption và thumbnail đã sẵn sàng.`)
      return media
    } finally {
      this.stickRuns.delete(projectId)
      if (output && !published) await unlink(output).catch(() => undefined)
    }
  }

  async generateStickmanSceneImages(
    projectId: string,
    scriptId: string,
    format: VideoFormat = 'LANDSCAPE',
    source: 'API' | 'CODEX_CLI' | 'CLAUDE_CLI' | 'ANTIGRAVITY_CLI' = 'API',
  ): Promise<{ sceneImages: StickmanSceneImageDTO[]; outputDir: string }> {
    const prisma = getPrisma()
    const script = await prisma.script.findFirst({ where: { id: scriptId, projectId } })
    if (!script) throw new Error('Hãy chọn kịch bản để tạo bộ ảnh phân đoạn.')

    const isShort = script.type === 'REEL' || format === 'REEL'
    const effectiveFormat = script.type === 'REEL' ? 'REEL' : format
    const sections = storySections(script.content, isShort)
    const generator = source === 'CODEX_CLI' ? new CodexCliService() : source === 'CLAUDE_CLI' ? new ClaudeCliService() : source === 'ANTIGRAVITY_CLI' ? new AntigravityCliService() : new AIService().provider()
    const response = await generator.generateText({ json: true, prompt: stickPrompt(sections, isShort) })
    const scenes = parseStickScenes(response, sections.length)

    const colors = new Map<string, string>()
    const palette = ['#334155', '#c45b50', '#397b86', '#8961a5', '#a27025', '#487c46']
    for (const scene of scenes) {
      for (const actor of scene.actors) {
        if (!colors.has(actor.name)) colors.set(actor.name, palette[colors.size % palette.length])
      }
    }

    const sceneImages: StickmanSceneImageDTO[] = []
    const timestamp = Date.now()
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]
      const sectionText = sections[i]
      const fileName = `scene_${String(i + 1).padStart(2, '0')}_${scene.setting}.png`
      const svgText = stickFrame(scene, 0, effectiveFormat, colors)
      const pngBuffer = await sharp(Buffer.from(svgText)).png().toBuffer()
      const relativePath = `images/scenes/${timestamp}/${fileName}`
      const filePath = await this.storage.writeOutputBuffer(projectId, relativePath, pngBuffer)
      const fileUrl = pathToFileURL(filePath).href

      sceneImages.push({
        index: i + 1,
        setting: scene.setting,
        sectionText,
        fileName,
        filePath,
        fileUrl,
      })
    }

    const outputDir = this.storage.getProjectPath(projectId, `images/scenes/${timestamp}`)
    return { sceneImages, outputDir }
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

  async render(projectId: string, format: VideoFormat, fitMode: FitMode, soundEffectInput: SoundEffectOptions = DEFAULT_SOUND_EFFECT_OPTIONS, includeSubtitles = true, onProgress?: (progress: StoryVideoProgress) => void, signal?: AbortSignal): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const soundEffect = normalizeSoundEffectOptions(soundEffectInput)
    const [audio, background, thumbnail] = await Promise.all([
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!audio) throw new Error('Chưa có story.mp3. Generate Story MP3 trước.')
    if (!background) throw new Error('Chưa chọn video hoặc ảnh background.')
    const backgroundKind: BackgroundKind = parseMeta(background.metadata).kind === 'IMAGE' ? 'IMAGE' : 'VIDEO'
    const sourceAudioMeta = parseMeta(audio.metadata)
    const sourceScriptId = typeof sourceAudioMeta.scriptId === 'string' ? sourceAudioMeta.scriptId : undefined
    const sourceScript = sourceScriptId
      ? await prisma.script.findFirst({ where: { id: sourceScriptId, projectId, type: 'LONG_STORY' } })
      : await prisma.script.findFirst({ where: { projectId, type: 'LONG_STORY' }, orderBy: { version: 'desc' } })
    if (includeSubtitles && !sourceScript) throw new Error('Không tìm thấy Story script để tạo phụ đề.')
    const stickBackground = parseMeta(background.metadata).style === 'STICK_FIGURE'
    if (stickBackground && (parseMeta(background.metadata).audioAssetId !== audio.id || !sourceScript || parseMeta(background.metadata).scriptHash !== scriptHash(sourceScript.content))) throw new Error('Truyện hoặc lời đọc đã đổi. Hãy tạo lại hoạt hình người que.')
    if (stickBackground && parseMeta(background.metadata).format !== format) throw new Error('Hãy tạo lại hoạt hình theo định dạng output đã chọn.')
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
    let currentRenderId: string | null = null
    try {
      for (const [index, segment] of segments.entries()) {
        if (signal?.aborted) throw new Error('Render đã bị hủy.')
        const output = format === 'REEL'
          ? await this.storage.getOutputPath(projectId, 'videos', `story-reel-short-${String(segment.part).padStart(digits, '0')}-of-${String(segment.totalParts).padStart(digits, '0')}.mp4`)
          : await this.storage.getOutputPath(projectId, 'videos', `story-${format.toLowerCase()}.mp4`)
        const preset: StoryVideoPreset = { ...segment, kind: 'story-video', schema: STORY_VIDEO_PRESET_SCHEMA, runId, format, fitMode, sfxRenderVersion: SFX_RENDER_VERSION, soundEffect, includeSubtitles, subtitleRenderVersion: SUBTITLE_RENDER_VERSION, scriptId: sourceScriptId, audioAssetId: audio.id }
        const render = await prisma.render.create({ data: { projectId, type: 'STORY_VIDEO', path: output, status: 'RUNNING', preset: JSON.stringify(preset) } })
        currentRenderId = render.id
        const label = format === 'REEL' ? `Short ${segment.part}/${segment.totalParts}` : 'Story video'
        report(segment.part, (index / segments.length) * 92, 'VIDEO', `${label}: render ${Math.round(segment.durationMs / 1000)} giây + SFX${includeSubtitles ? ' + phụ đề' : ''}...`)
        const subtitlePath = includeSubtitles && sourceScript
          ? await this.storage.writeOutputText(projectId, `subtitles/${basename(output).replace(/\.mp4$/i, '.ass')}`, createAssSubtitles({
              text: `${sourceScript.content}\n\n${CTA_TEXT}`,
              totalDuration: audioDuration,
              format,
              clipStart: segment.startMs / 1000,
              clipDuration: segment.durationMs / 1000
            }))
          : undefined
        await renderLoopedVideo({
          backgroundPath: background.path,
          frameRate: stickBackground ? 60 : 30,
          backgroundStartSeconds: stickBackground ? segment.startMs / 1000 : undefined,
          backgroundKind,
          audioPath,
          outputPath: output,
          format,
          fitMode,
          soundEffectSeed: format === 'REEL' ? segment.part : 0,
          soundEffect,
          audioStartSeconds: segment.startMs / 1000,
          audioDurationSeconds: segment.durationMs / 1000,
          subtitlePath,
          signal,
          onProgress: partPercent => report(segment.part, ((index + partPercent / 100) / segments.length) * 92, 'VIDEO', `${label}: ${partPercent}% · ${Math.round(segment.durationMs / 1000)} giây + SFX${includeSubtitles ? ' + phụ đề' : ''}`)
        })
        const renderedDuration = await probeDuration(output)
        if (Math.abs(renderedDuration - segment.durationMs / 1000) > 1) throw new Error(`${label} có duration không hợp lệ sau khi render.`)
        await prisma.render.update({ where: { id: render.id }, data: { status: 'DONE' } })
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
