import { basename } from 'node:path'
import type { FitMode, StoryMediaDTO, VideoFormat } from '../../shared/types'
import { getPrisma } from './database'
import { concatMp3Parts, probeDuration, renderLoopedVideo } from './ffmpeg'
import { ProjectStorageService } from './storage'
import { VoiceService } from './voices'

const TTS_CHUNK_SIZE = 1800
const TTS_CHUNK_ATTEMPTS = 4

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function chunks(text: string, max = TTS_CHUNK_SIZE): string[] {
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

function mediaUrl(path?: string | null): string | null {
  return path ? `local-media://file/${encodeURIComponent(path)}` : null
}

function parseMeta(meta?: string | null): Record<string, unknown> {
  if (!meta) return {}
  try { return JSON.parse(meta) as Record<string, unknown> } catch { return {} }
}

export class StoryMediaService {
  private readonly storage = new ProjectStorageService()
  constructor(private readonly voices = new VoiceService()) {}

  private async synthesizeChunk(voiceId: string, text: string, chunkIndex: number, total: number): Promise<Buffer> {
    let lastError: unknown
    for (let attempt = 1; attempt <= TTS_CHUNK_ATTEMPTS; attempt++) {
      try {
        return await this.voices.synthesize(voiceId, text)
      } catch (error) {
        lastError = error
        if (attempt < TTS_CHUNK_ATTEMPTS) await sleep(1200 * attempt)
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`Generate voice thất bại ở chunk ${chunkIndex + 1}/${total} sau ${TTS_CHUNK_ATTEMPTS} lần thử: ${reason}`)
  }

  async get(projectId: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [audio, background, render] = await Promise.all([
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.render.findFirst({ where: { projectId, type: 'STORY_VIDEO', status: 'DONE' }, orderBy: { updatedAt: 'desc' } })
    ])
    const audioMeta = parseMeta(audio?.metadata)
    const bgMeta = parseMeta(background?.metadata)
    return {
      audioPath: audio?.path ?? null,
      audioUrl: mediaUrl(audio?.path),
      audioDuration: typeof audioMeta.duration === 'number' ? audioMeta.duration : null,
      backgroundPath: background?.path ?? null,
      backgroundUrl: mediaUrl(background?.path),
      backgroundName: background?.path ? basename(background.path) : null,
      backgroundDuration: typeof bgMeta.duration === 'number' ? bgMeta.duration : null,
      renderPath: render?.path ?? null,
      renderUrl: mediaUrl(render?.path),
      renderStatus: render?.status ?? null
    }
  }

  async generateStoryAudio(projectId: string, scriptId: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [project, script] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findUniqueOrThrow({ where: { id: scriptId } })
    ])
    if (script.projectId !== projectId || script.type !== 'LONG_STORY') throw new Error('Script không hợp lệ cho Story MP3.')
    if (!project.voiceId) throw new Error('Hãy chọn voice trước khi Generate Story MP3.')

    const pieces = chunks(script.content)
    if (!pieces.length) throw new Error('Story đang trống, không thể generate voice.')

    await prisma.project.update({ where: { id: projectId }, data: { status: 'GENERATING_MEDIA' } })
    const partPaths: string[] = []
    try {
      for (let i = 0; i < pieces.length; i++) {
        const bytes = await this.synthesizeChunk(project.voiceId, pieces[i], i, pieces.length)
        if (!bytes.length) throw new Error(`CapCut trả audio rỗng ở chunk ${i + 1}/${pieces.length}.`)
        const path = await this.storage.writeBuffer(projectId, `audio/.parts/story-${String(i + 1).padStart(3, '0')}.mp3`, bytes)
        partPaths.push(path)
      }

      const output = this.storage.getProjectPath(projectId, 'audio', 'story.mp3')
      const listFile = this.storage.getProjectPath(projectId, 'audio', '.parts', 'concat.txt')
      await concatMp3Parts(partPaths, output, listFile)
      const duration = await probeDuration(output)
      if (duration <= 0) throw new Error('Story MP3 đã tạo nhưng duration không hợp lệ.')

      await prisma.asset.deleteMany({ where: { projectId, type: 'STORY_AUDIO' } })
      await prisma.render.updateMany({ where: { projectId, type: 'STORY_VIDEO' }, data: { status: 'STALE' } })
      await prisma.asset.create({ data: { projectId, type: 'STORY_AUDIO', path: output, metadata: JSON.stringify({ duration, scriptId, voiceId: project.voiceId, chunks: pieces.length, chunkSize: TTS_CHUNK_SIZE }) } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'MEDIA_READY' } })
      return this.get(projectId)
    } catch (error) {
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }

  async setBackground(projectId: string, sourcePath: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const copied = await this.storage.copyBackgroundVideo(projectId, sourcePath)
    let duration: number | null = null
    try {
      duration = await probeDuration(copied)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await prisma.asset.deleteMany({ where: { projectId, type: 'BACKGROUND_VIDEO' } })
    await prisma.render.updateMany({ where: { projectId, type: 'STORY_VIDEO' }, data: { status: 'STALE' } })
    await prisma.asset.create({ data: { projectId, type: 'BACKGROUND_VIDEO', path: copied, metadata: JSON.stringify({ duration, sourceName: basename(sourcePath) }) } })
    return this.get(projectId)
  }

  async render(projectId: string, format: VideoFormat, fitMode: FitMode): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [audio, background] = await Promise.all([
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!audio) throw new Error('Chưa có story.mp3. Generate Story MP3 trước.')
    if (!background) throw new Error('Chưa chọn background video.')

    await prisma.project.update({ where: { id: projectId }, data: { status: 'RENDERING' } })
    await prisma.render.updateMany({ where: { projectId, type: 'STORY_VIDEO' }, data: { status: 'STALE' } })
    const output = this.storage.getProjectPath(projectId, 'videos', `story-${format.toLowerCase()}.mp4`)
    const render = await prisma.render.create({ data: { projectId, type: 'STORY_VIDEO', path: output, status: 'RUNNING', preset: `${format}:${fitMode}` } })
    try {
      await renderLoopedVideo({ backgroundPath: background.path, audioPath: audio.path, outputPath: output, format, fitMode })
      const outputDuration = await probeDuration(output)
      await prisma.render.update({ where: { id: render.id }, data: { status: 'DONE' } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'READY' } })
      const result = await this.get(projectId)
      return { ...result, audioDuration: result.audioDuration ?? outputDuration }
    } catch (error) {
      await prisma.render.update({ where: { id: render.id }, data: { status: 'FAILED' } })
      await prisma.project.update({ where: { id: projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }
}
