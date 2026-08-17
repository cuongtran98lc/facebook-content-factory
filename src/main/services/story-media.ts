import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { nativeImage } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import type { BackgroundKind, FitMode, ReelVideoProgress, SoundEffectOptions, StoryMediaDTO, StoryVideoProgress, VideoFormat } from '../../shared/types'
import { getPrisma } from './database'
import { DEFAULT_SOUND_EFFECT_OPTIONS, SFX_RENDER_VERSION, concatMp3Parts, normalizeSoundEffectOptions, probeDuration, renderLoopedVideo, resolveSoundEffectPreset } from './ffmpeg'
import { ProjectStorageService } from './storage'
import { VoiceService } from './voices'
import { ThumbnailService } from './thumbnails'

const TTS_CHUNK_ATTEMPTS = 4
const STORY_SHORT_MAX_MS = 180_000
const STORY_VIDEO_PRESET_SCHEMA = 1

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
  constructor(private readonly voices = new VoiceService(), private readonly thumbnails = new ThumbnailService()) {}

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
    const [thumbnail, audio, background, storyRenders, reelScripts, reelRenders, reelThumbnails, reelAudios] = await Promise.all([
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.render.findMany({ where: { projectId, type: 'STORY_VIDEO', status: { not: 'STALE' } }, orderBy: { createdAt: 'desc' } }),
      prisma.script.findMany({ where: { projectId, type: 'REEL' }, orderBy: { version: 'asc' } }),
      prisma.render.findMany({ where: { projectId, type: 'REEL_VIDEO', status: 'DONE' }, orderBy: { createdAt: 'asc' } }),
      prisma.asset.findMany({ where: { projectId, type: 'REEL_THUMBNAIL' }, orderBy: { createdAt: 'asc' } }),
      prisma.asset.findMany({ where: { projectId, type: 'REEL_AUDIO' }, orderBy: { createdAt: 'asc' } })
    ])
    const audioMeta = parseMeta(audio?.metadata)
    const bgMeta = parseMeta(background?.metadata)
    const thumbnailMeta = parseMeta(thumbnail?.metadata)
    const latestStoryPreset = parseStoryVideoPreset(storyRenders[0]?.preset)
    const activeStoryRenders = (latestStoryPreset
      ? storyRenders.filter(row => parseStoryVideoPreset(row.preset)?.runId === latestStoryPreset.runId)
      : storyRenders.slice(0, 1)
    ).sort((left, right) => (parseStoryVideoPreset(left.preset)?.part ?? 1) - (parseStoryVideoPreset(right.preset)?.part ?? 1))
    const storyVideoParts = activeStoryRenders.map((row) => {
      const preset = parseStoryVideoPreset(row.preset)
      const done = row.status === 'DONE'
      return {
        part: preset?.part ?? 1,
        totalParts: preset?.totalParts ?? 1,
        startSeconds: (preset?.startMs ?? 0) / 1000,
        duration: preset ? preset.durationMs / 1000 : null,
        path: done ? row.path : null,
        url: done ? mediaUrl(row.path, row.updatedAt) : null,
        status: row.status
      }
    })
    const firstStoryVideo = activeStoryRenders.find(row => row.status === 'DONE')
    const expectedStoryParts = latestStoryPreset?.totalParts ?? (activeStoryRenders.length ? 1 : 0)
    const renderStatus = activeStoryRenders.some(row => row.status === 'FAILED')
      ? 'FAILED'
      : activeStoryRenders.length === expectedStoryParts && activeStoryRenders.every(row => row.status === 'DONE')
        ? 'DONE'
        : activeStoryRenders[0]?.status ?? null
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
      renderUrl: mediaUrl(firstStoryVideo?.path, firstStoryVideo?.updatedAt),
      renderStatus,
      storyVideoParts,
      reels: reelScripts.map((script, index) => {
        const episode = index + 1
        const match = (rows: Array<{ path: string; metadata: string | null; createdAt: Date }>) => rows.find(row => parseMeta(row.metadata).reelId === script.id)
        const reelRender = reelRenders.find(row => row.preset === script.id)
        const reelThumbnail = match(reelThumbnails)
        const reelAudio = match(reelAudios)
        return { reelId: script.id, episode, title: script.title, audioPath: reelAudio?.path ?? null, videoPath: reelRender?.path ?? null, videoUrl: mediaUrl(reelRender?.path, reelRender?.updatedAt), thumbnailPath: reelThumbnail?.path ?? null, thumbnailUrl: mediaUrl(reelThumbnail?.path, reelThumbnail?.createdAt), status: reelRender?.status ?? null }
      })
    }
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
    const totalUnits = reels.length * 3
    let completedUnits = 0
    const report = (current: number, stage: ReelVideoProgress['stage'], message: string, forcePercent?: number) => {
      const progress = forcePercent ?? Math.round((completedUnits / totalUnits) * 100)
      onProgress?.({ current, total: reels.length, percent: progress, stage, message })
      void prisma.job.update({ where: { id: job.id }, data: { progress, payload: JSON.stringify({ projectId, fitMode, voiceId: project.voiceId, soundEffect, sfxRenderVersion: SFX_RENDER_VERSION, current, stage, message }) } })
    }
    report(0, 'STARTING', `Đang chuẩn bị ${reels.length} tập...`, 0)
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
        completedUnits++
      }
      await prisma.project.update({ where: { id: projectId }, data: { status: 'READY' } })
      await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', progress: 100 } })
      report(reels.length, 'DONE', `Hoàn tất ${reels.length}/${reels.length} Reel videos.`, 100)
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
    const [audio, background, thumbnail] = await Promise.all([
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!audio) throw new Error('Chưa có story.mp3. Generate Story MP3 trước.')
    if (!background) throw new Error('Chưa chọn video hoặc ảnh background.')
    const backgroundKind: BackgroundKind = parseMeta(background.metadata).kind === 'IMAGE' ? 'IMAGE' : 'VIDEO'
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
    await prisma.render.updateMany({ where: { projectId, type: 'STORY_VIDEO' }, data: { status: 'STALE' } })
    report(0, 0, 'STARTING', format === 'REEL' ? `Đang chuẩn bị ${segments.length} video Short 9:16...` : 'Đang chuẩn bị Story video...')
    let currentRenderId: string | null = null
    try {
      for (const [index, segment] of segments.entries()) {
        const output = format === 'REEL'
          ? await this.storage.getOutputPath(projectId, 'videos', `story-reel-short-${String(segment.part).padStart(digits, '0')}-of-${String(segment.totalParts).padStart(digits, '0')}.mp4`)
          : await this.storage.getOutputPath(projectId, 'videos', `story-${format.toLowerCase()}.mp4`)
        const preset: StoryVideoPreset = { ...segment, kind: 'story-video', schema: STORY_VIDEO_PRESET_SCHEMA, runId, format, fitMode, sfxRenderVersion: SFX_RENDER_VERSION, soundEffect }
        const render = await prisma.render.create({ data: { projectId, type: 'STORY_VIDEO', path: output, status: 'RUNNING', preset: JSON.stringify(preset) } })
        currentRenderId = render.id
        const label = format === 'REEL' ? `Short ${segment.part}/${segment.totalParts}` : 'Story video'
        report(segment.part, (index / segments.length) * 100, 'VIDEO', `${label}: render ${Math.round(segment.durationMs / 1000)} giây + SFX...`)
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
          onProgress: partPercent => report(segment.part, ((index + partPercent / 100) / segments.length) * 100, 'VIDEO', `${label}: ${partPercent}% · ${Math.round(segment.durationMs / 1000)} giây + SFX`)
        })
        const renderedDuration = await probeDuration(output)
        if (Math.abs(renderedDuration - segment.durationMs / 1000) > 1) throw new Error(`${label} có duration không hợp lệ sau khi render.`)
        await prisma.render.update({ where: { id: render.id }, data: { status: 'DONE' } })
        currentRenderId = null
      }
      await prisma.project.update({ where: { id: projectId }, data: { status: 'READY' } })
      report(segments.length, 100, 'DONE', format === 'REEL' ? `Hoàn tất ${segments.length}/${segments.length} video Short 9:16.` : 'Story video đã render xong.')
      return this.get(projectId)
    } catch (error) {
      if (currentRenderId) await prisma.render.update({ where: { id: currentRenderId }, data: { status: 'FAILED' } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }
}
