import { THUMBNAIL_CONCEPTS, type ThumbnailConcept } from '../../shared/thumbnail-concepts'
import { audiencePrompt, getCtaText } from '../../shared/audience'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserWindow, nativeImage, session, type DownloadItem, type Session } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat, unlink, writeFile, rename, readdir, rm } from 'node:fs/promises'
import sharp from 'sharp'
import { pathToFileURL } from 'node:url'
import type { BackgroundKind, EmotionDemoDTO, FitMode, FlowSceneImageDTO, FlowSceneSource, FlowSceneStylePreset, GenerateSingleImageInput, GenerateSingleImageResult, GoogleFlowCaptureStatus, ReelVideoProgress, SoundEffectOptions, StickmanSceneImageDTO, StickVisualStyle, StoryMediaDTO, StoryVideoProgress, VideoFormat } from '../../shared/types'
import { getOutputRoot } from './paths'
import { getPrisma } from './database'
import { DEFAULT_SOUND_EFFECT_OPTIONS, SFX_RENDER_VERSION, burnVideoCaptions, concatAnimationScenes, concatMp3Parts, normalizeSoundEffectOptions, probeDuration, renderLoopedVideo, renderStillSceneClip, resolveSoundEffectPreset, extractVideoFrame } from './ffmpeg'
import { ProjectStorageService } from './storage'
import { VoiceService } from './voices'
import { ThumbnailService } from './thumbnails'
import { PublishingMetadataService, type PublishMetadata, type PublishMode, type PublishTarget } from './video-metadata'
import { createAssSubtitles, SUBTITLE_RENDER_VERSION } from './subtitles'
import { SettingsService } from './settings'

import { AIService } from './ai'
import type { AIProvider } from './ai/types'
import { CodexCliService } from './ai/codex-cli'
import { ClaudeCliService } from './ai/claude-cli'
import { AntigravityCliService } from './ai/antigravity-cli'
import { fallbackStickScenes, parseStickScenes, renderEmotionDemoVideo, renderStickAnimation, stickFrame, stickPrompt, storySections, type StickScene } from './stick-animation'
import { buildGoogleFlowThumbnailPrompt } from './stickman-knowledge'

const scriptHash = (text: string) => createHash('sha256').update(text).digest('hex')
const TTS_CHUNK_ATTEMPTS = 4
const STORY_SHORT_MAX_MS = 180_000
const STORY_VIDEO_PRESET_SCHEMA = 1
const CTA_TEXT = 'If you enjoyed this story, hit like and subscribe for more.'
const PUBLISH_METADATA_ASSET_TYPE = 'VIDEO_PUBLISH_METADATA'
const PUBLISH_METADATA_SCHEMA = 1
const REEL_THUMBNAIL_VERSION = 7
const FLOW_IMAGE_MAX_BYTES = 30 * 1024 * 1024
const GOOGLE_FLOW_URL = process.env.GOOGLE_FLOW_URL?.trim() || 'https://labs.google/fx/tools/flow'
// Google's newer web apps (chat-style creation UIs, Material/Lit components) commonly
// render their actual inputs inside open shadow roots and same-origin iframes, which a
// plain document.querySelectorAll cannot see even though the element is visibly on screen.
// Injected into each Google Flow automation script so field/button/image lookups pierce
// through shadow DOM and same-origin iframes instead of silently finding nothing.
const DEEP_QUERY_ALL_JS = `
  const deepQueryAll = (selector, root) => {
    root = root || document
    const results = [...root.querySelectorAll(selector)]
    for (const host of root.querySelectorAll('*')) {
      if (host.shadowRoot) results.push(...deepQueryAll(selector, host.shadowRoot))
    }
    // Recurse at every document level (top document AND every nested same-origin
    // iframe document), not just the top level, since Flow's editor can sit inside
    // an iframe nested within another iframe. Iframes are looked up on the current
    // root (not the outer document) so this scopes correctly at each nesting level.
    if (root.nodeType === 9) {
      for (const frame of root.querySelectorAll('iframe')) {
        try {
          const frameDoc = frame.contentDocument
          if (frameDoc) results.push(...deepQueryAll(selector, frameDoc))
        } catch (error) { /* cross-origin iframe, skip */ }
      }
    }
    return results
  };
`

interface GoogleFlowPromptFieldDetail {
  tag: string
  w: number
  h: number
  display: string
  visibility: string
  label: string
}

interface GoogleFlowPromptDiagnostic {
  ready: boolean
  fieldsFound: number
  rawFieldsFound: number
  rawFieldDetails: GoogleFlowPromptFieldDetail[]
  iframeCount: number
  blockedIframeCount: number
  shadowHostCount: number
  title: string
  url: string
}

function formatGoogleFlowFieldDetails(details: GoogleFlowPromptFieldDetail[]): string {
  if (!details.length) return ''
  const summary = details
    .map(field => `${field.tag}${field.label ? `[${field.label}]` : ''} ${field.w}x${field.h}${field.display === 'none' ? ' display:none' : ''}${field.visibility === 'hidden' ? ' visibility:hidden' : ''}`)
    .join('; ')
  return ` Chi tiết: ${summary}.`
}

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

interface StickyManSceneDetail {
  action: string
  expression: string
  setting: string
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

type StoredAudioSegment = {
  index: number
  total: number
  kind: 'STORY' | 'CTA'
  text: string
  path: string
  duration: number
  textPath?: string
}

type StoredFlowScene = {
  index: number
  kind: 'STORY' | 'CTA'
  text: string
  duration: number
  path: string
  source: 'URL' | 'FILE'
}

function parseAudioSegments(value: unknown): StoredAudioSegment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (
      !Number.isInteger(row.index) ||
      !Number.isInteger(row.total) ||
      (row.kind !== 'STORY' && row.kind !== 'CTA') ||
      typeof row.text !== 'string' ||
      typeof row.path !== 'string' ||
      typeof row.duration !== 'number' ||
      row.duration <= 0
    ) return []
    return [{
      index: row.index as number,
      total: row.total as number,
      kind: row.kind,
      text: row.text,
      path: row.path,
      duration: row.duration,
      ...(typeof row.textPath === 'string' ? { textPath: row.textPath } : {})
    }]
  })
}

function parseFlowScenes(value: unknown): StoredFlowScene[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (
      !Number.isInteger(row.index) ||
      (row.kind !== 'STORY' && row.kind !== 'CTA') ||
      typeof row.text !== 'string' ||
      typeof row.duration !== 'number' ||
      row.duration <= 0 ||
      typeof row.path !== 'string' ||
      (row.source !== 'URL' && row.source !== 'FILE')
    ) return []
    return [{
      index: row.index as number,
      kind: row.kind,
      text: row.text,
      duration: row.duration,
      path: row.path,
      source: row.source
    }]
  })
}

function isGoogleImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return [
    'labs.google',
    'flow-content.google',
    'flow.google.com',
    'googleusercontent.com',
    'gstatic.com',
    'ggpht.com',
    'googleapis.com'
  ].some(domain => host === domain || host.endsWith(`.${domain}`))
}

function validateGoogleFlowImageUrl(value: string): URL {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error(`URL ảnh Google Flow không hợp lệ: "${value.slice(0, 300)}".`) }
  if (url.protocol !== 'https:' || url.username || url.password || !isGoogleImageHost(url.hostname)) {
    throw new Error(`Chỉ hỗ trợ link ảnh HTTPS trực tiếp từ Google Flow/Googleusercontent (domain nhận được: "${url.hostname || value}").`)
  }
  return url
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

function landscapeThumbnailLines(title: string): string[] {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean) return ['WHAT IF...?']
  const words = clean.split(' ').filter(Boolean)
  const lines: string[] = []
  for (const word of words) {
    const current = lines[lines.length - 1]
    if (!current || (current.length + word.length + 1 > 18 && lines.length < 2)) {
      lines.push(word)
    } else {
      lines[lines.length - 1] = `${current} ${word}`
    }
  }
  if (lines.length > 2) lines.splice(2)
  if (lines[1]?.length > 24) lines[1] = `${lines[1].slice(0, 23).trimEnd()}…`
  return lines
}

function renderLandscapeThumbnailOverlay(title: string, concept?: ThumbnailConcept, topic?: string): Buffer {
  const width = 1280
  const height = 720
  const lines = landscapeThumbnailLines(title)
  const isWhatIf = title.toLowerCase().includes('what if') || title.toLowerCase().startsWith('nếu')
  const badgeText = isWhatIf ? '⚡ WHAT IF...?' : concept === 'HIGH_STAKES' ? '⚖️ LỰA CHỌN KHÓ' : concept === 'SPLIT_SCREEN' ? '🔥 TRƯỚC & SAU' : '⚠️ KỊCH TÍNH'

  const startX = 48
  const startY = 48
  const fontSize = lines.length > 1 ? 56 : 64
  const lineHeight = fontSize + 16
  const maxChars = Math.max(...lines.map(l => l.length))
  const plateWidth = Math.min(width - 96, Math.max(460, Math.round(maxChars * (fontSize * 0.62) + 76)))
  const plateHeight = 64 + lines.length * lineHeight + 18
  const badgeWidth = Math.round(badgeText.length * 11) + 40

  const textSpans = lines.map((line, idx) => {
    const fill = idx === 0 ? '#FFE600' : '#FFFFFF'
    return `<text x="${startX + 28}" y="${startY + 72 + (idx + 1) * lineHeight - 14}" font-family="'Arial Black', Arial, 'Segoe UI', sans-serif" font-size="${fontSize}" font-weight="900" fill="${fill}" stroke="#000000" stroke-width="12" stroke-linejoin="round" paint-order="stroke fill" filter="url(#thumb-shadow)">${escapeSvgText(line.toUpperCase())}</text>`
  }).join('\n')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <filter id="thumb-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="4" dy="6" stdDeviation="0" flood-color="#000000" flood-opacity="0.95"/>
      </filter>
      <linearGradient id="thumb-plate" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#050811" stop-opacity="0.88"/>
        <stop offset="100%" stop-color="#0f172a" stop-opacity="0.80"/>
      </linearGradient>
      <linearGradient id="badge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ef4444"/>
        <stop offset="100%" stop-color="#dc2626"/>
      </linearGradient>
    </defs>
    <!-- Background Shield / Plate -->
    <rect x="${startX}" y="${startY}" width="${plateWidth}" height="${plateHeight}" rx="20" fill="url(#thumb-plate)" stroke="#f59e0b" stroke-width="3" filter="url(#thumb-shadow)"/>
    <rect x="${startX + 8}" y="${startY + 8}" width="${plateWidth - 16}" height="${plateHeight - 16}" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="1.5"/>
    <!-- Topic / Concept Badge -->
    <rect x="${startX + 24}" y="${startY + 18}" width="${badgeWidth}" height="32" rx="16" fill="url(#badge-grad)" stroke="#ffffff" stroke-width="2"/>
    <text x="${startX + 24 + badgeWidth / 2}" y="${startY + 39}" font-family="Arial, sans-serif" font-size="13" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="0.8">${escapeSvgText(badgeText)}</text>
    <!-- Punchy Title Text -->
    ${textSpans}
  </svg>`

  return Buffer.from(svg)
}

function thumbnailTitleLines(value: string): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  for (const word of words) {
    const current = lines[lines.length - 1]
    if (!current || (current.length + word.length + 1 > 20 && lines.length < 3)) lines.push(word)
    else lines[lines.length - 1] = `${current} ${word}`
  }
  if (lines.length > 3) lines.splice(3)
  if (lines[2]?.length > 24) lines[2] = `${lines[2].slice(0, 23).trimEnd()}…`
  return lines.length ? lines : ['TRUYỆN MỚI']
}

async function episodeThumbnail(bytes: Buffer, episode: number, storyTitle: string): Promise<Buffer> {
  const width = 1080
  const height = 1920
  const lines = thumbnailTitleLines(storyTitle)
  const epText = `TẬP ${String(episode).padStart(2, '0')}`
  const frameX = 48
  const frameWidth = 984
  const fontSize = 72
  const lineHeight = 88
  const frameHeight = 110 + lines.length * lineHeight
  const frameY = Math.round((height - frameHeight) / 2)
  const badgeW = 210
  const badgeH = 46

  const titleSpans = lines.map((line, index) => {
    const fill = index === 0 ? '#FFE600' : '#FFFFFF'
    return `<text x="${frameX + 40}" y="${frameY + 120 + index * lineHeight}" font-family="'Arial Black', Arial, 'Segoe UI', sans-serif" font-size="${fontSize}" font-weight="900" fill="${fill}" stroke="#000000" stroke-width="14" stroke-linejoin="round" paint-order="stroke fill" filter="url(#drop-shadow)">${escapeSvgText(line.toUpperCase())}</text>`
  }).join('\n')

  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <filter id="drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="4" dy="8" stdDeviation="2" flood-color="#000000" flood-opacity="0.95"/>
      </filter>
      <linearGradient id="card-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#090d16" stop-opacity="0.92"/>
        <stop offset="100%" stop-color="#1e1b4b" stop-opacity="0.88"/>
      </linearGradient>
      <linearGradient id="ep-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ef4444"/>
        <stop offset="100%" stop-color="#dc2626"/>
      </linearGradient>
    </defs>
    <!-- Card Frame -->
    <rect x="${frameX}" y="${frameY}" width="${frameWidth}" height="${frameHeight}" rx="24" fill="url(#card-grad)" stroke="#f59e0b" stroke-width="3.5" filter="url(#drop-shadow)"/>
    <rect x="${frameX + 10}" y="${frameY + 10}" width="${frameWidth - 20}" height="${frameHeight - 20}" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>
    <!-- Episode Badge -->
    <rect x="${frameX + 38}" y="${frameY + 22}" width="${badgeW}" height="${badgeH}" rx="23" fill="url(#ep-grad)" stroke="#ffffff" stroke-width="2.5"/>
    <text x="${frameX + 38 + badgeW / 2}" y="${frameY + 53}" text-anchor="middle" font-family="'Arial Black', Arial, sans-serif" font-size="20" font-weight="900" fill="#ffffff" letter-spacing="1.5">⚡ ${escapeSvgText(epText)}</text>
    <!-- Title Lines -->
    ${titleSpans}
  </svg>`)

  try {
    const result = await sharp(bytes)
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
  private googleFlowWindow: BrowserWindow | null = null
  private googleFlowCaptureCleanup: (() => void) | null = null
  private googleFlowCaptureStatus: GoogleFlowCaptureStatus | null = null
  private googleFlowAutomationAbort: AbortController | null = null
  private fluxAutomationAbort: AbortController | null = null
  private readonly settings = new SettingsService()
  constructor(
    private readonly voices = new VoiceService(),
    private readonly thumbnails = new ThumbnailService(),
    private readonly publishing = new PublishingMetadataService()
  ) {}

  private async readFlowImageSource(source: FlowSceneSource): Promise<Buffer> {
    if (source.kind === 'FILE') {
      const filePath = source.value.trim()
      const fileStat = await stat(filePath).catch(() => null)
      if (!fileStat?.isFile()) throw new Error('File ảnh đã chọn không còn tồn tại.')
      if (fileStat.size > FLOW_IMAGE_MAX_BYTES) throw new Error('Mỗi ảnh Google Flow phải nhỏ hơn 30 MB.')
      return readFile(filePath)
    }

    let url = validateGoogleFlowImageUrl(source.value)
    let response: Response | null = null
    for (let redirect = 0; redirect <= 5; redirect++) {
      response = await session.fromPartition('persist:google-flow').fetch(url.toString(), {
        credentials: 'include',
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000)
      })
      if (response.status < 300 || response.status >= 400) break
      const location = response.headers.get('location')
      if (!location) throw new Error('Link ảnh Google Flow chuyển hướng nhưng thiếu địa chỉ đích.')
      let redirectTarget: URL
      try { redirectTarget = new URL(location, url) } catch { throw new Error(`Link ảnh Google Flow chuyển hướng đến địa chỉ không hợp lệ: "${location.slice(0, 300)}".`) }
      url = validateGoogleFlowImageUrl(redirectTarget.toString())
      response = null
    }
    if (!response) throw new Error('Link ảnh Google Flow chuyển hướng quá nhiều lần.')
    if (!response.ok) throw new Error(`Không tải được ảnh Google Flow (HTTP ${response.status}).`)
    validateGoogleFlowImageUrl(response.url)
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > FLOW_IMAGE_MAX_BYTES) throw new Error('Mỗi ảnh Google Flow phải nhỏ hơn 30 MB.')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > FLOW_IMAGE_MAX_BYTES) throw new Error('Dữ liệu ảnh Google Flow rỗng hoặc vượt quá 30 MB.')
    return bytes
  }

  private flowStatus(
    input: Omit<GoogleFlowCaptureStatus, 'message'> & { message: string },
    onProgress?: (status: GoogleFlowCaptureStatus) => void,
  ): GoogleFlowCaptureStatus {
    this.googleFlowCaptureStatus = input
    onProgress?.(input)
    return input
  }

  private async ensureGoogleFlowWindow(): Promise<BrowserWindow> {
    if (!this.googleFlowWindow || this.googleFlowWindow.isDestroyed()) {
      this.googleFlowWindow = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 900,
        minHeight: 650,
        title: 'Google Flow - Content Factory',
        backgroundColor: '#111315',
        webPreferences: {
          partition: 'persist:google-flow',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      })
      this.googleFlowWindow.webContents.setWindowOpenHandler(details => {
        try {
          const target = new URL(details.url)
          const allowed = target.protocol === 'https:' && (isGoogleImageHost(target.hostname) || target.hostname === 'accounts.google.com')
          // A denied popup during login/account-chooser is otherwise a silent
          // dead end that just looks like a stuck WAITING_LOGIN state; log it
          // so that report is diagnosable instead of another blind spot.
          if (!allowed) console.warn(`[google-flow] Đã chặn popup không rõ: ${details.url}`)
          return allowed ? { action: 'allow' } : { action: 'deny' }
        } catch { return { action: 'deny' } }
      })
      this.googleFlowWindow.on('closed', () => { this.googleFlowWindow = null })
      await this.googleFlowWindow.loadURL(GOOGLE_FLOW_URL)
    } else {
      this.googleFlowWindow.show()
      this.googleFlowWindow.focus()
    }
    return this.googleFlowWindow
  }

  private async googleFlowPromptReady(): Promise<GoogleFlowPromptDiagnostic> {
    const empty: GoogleFlowPromptDiagnostic = { ready: false, fieldsFound: 0, rawFieldsFound: 0, rawFieldDetails: [], iframeCount: 0, blockedIframeCount: 0, shadowHostCount: 0, title: '', url: '' }
    const win = this.googleFlowWindow
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return empty
    return win.webContents.executeJavaScript(`(() => {
      ${DEEP_QUERY_ALL_JS}
      const visible = element => {
        // Auto-growing contenteditable/textarea fields can legitimately report
        // 0 height while empty, so don't require a minimum pixel size here —
        // only that the element isn't actually hidden. The prompt-related
        // label scoring elsewhere picks the right candidate among matches.
        const style = getComputedStyle(element)
        if (style.visibility === 'hidden' || style.display === 'none') return false
        return Number(style.opacity || '1') !== 0
      }
      const rawFields = deepQueryAll('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')
      const fields = rawFields
        .filter(visible)
        .filter(element => !String(element.getAttribute('placeholder') || element.getAttribute('aria-label') || '').toLowerCase().includes('search'))
      const rawFieldDetails = rawFields.slice(0, 8).map(element => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          tag: element.tagName.toLowerCase(),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          display: style.display,
          visibility: style.visibility,
          label: String(element.getAttribute('placeholder') || element.getAttribute('aria-label') || '').slice(0, 40)
        }
      })
      const iframes = [...document.querySelectorAll('iframe')]
      let blockedIframeCount = 0
      for (const frame of iframes) {
        try { void frame.contentDocument?.title } catch (error) { blockedIframeCount++ }
      }
      let shadowHostCount = 0
      for (const host of document.querySelectorAll('*')) {
        if (host.shadowRoot) shadowHostCount++
      }
      return {
        ready: fields.length > 0,
        fieldsFound: fields.length,
        rawFieldsFound: rawFields.length,
        rawFieldDetails,
        iframeCount: iframes.length,
        blockedIframeCount,
        shadowHostCount,
        title: document.title,
        url: location.href
      }
    })()`, true) as Promise<GoogleFlowPromptDiagnostic>
  }

  private async waitForGoogleFlowPrompt(signal: AbortSignal, onDiagnostic?: (diagnostic: GoogleFlowPromptDiagnostic) => void): Promise<void> {
    const deadline = Date.now() + 10 * 60_000
    let lastDiagnostic: GoogleFlowPromptDiagnostic | null = null
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('Đã dừng tự động tạo ảnh Google Flow.')
      if (!this.googleFlowWindow || this.googleFlowWindow.isDestroyed()) throw new Error('Cửa sổ Google Flow đã đóng.')
      const diagnostic = await this.googleFlowPromptReady().catch(() => null)
      if (diagnostic) {
        lastDiagnostic = diagnostic
        onDiagnostic?.(diagnostic)
        if (diagnostic.ready) return
      }
      await sleep(2_000)
    }
    const hint = lastDiagnostic
      ? ` Trang "${lastDiagnostic.title || lastDiagnostic.url}": ${lastDiagnostic.fieldsFound}/${lastDiagnostic.rawFieldsFound} ô nhập (khớp selector, không tính đến kích thước), ${lastDiagnostic.iframeCount} iframe${lastDiagnostic.blockedIframeCount ? `, ${lastDiagnostic.blockedIframeCount} iframe không truy cập được (khác domain)` : ''}, ${lastDiagnostic.shadowHostCount} shadow root.${formatGoogleFlowFieldDetails(lastDiagnostic.rawFieldDetails)}`
      : ''
    throw new Error(`Không tìm thấy ô prompt trong Google Flow sau 10 phút.${hint} Hãy đăng nhập, mở project và vào màn hình tạo ảnh rồi thử lại.`)
  }

  private async googleFlowImageCandidates(): Promise<Array<{ src: string; width: number; height: number; score: number }>> {
    const win = this.googleFlowWindow
    if (!win || win.isDestroyed()) return []
    return win.webContents.executeJavaScript(`(() => {
      ${DEEP_QUERY_ALL_JS}
      const visible = element => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.width >= 180 && rect.height >= 180 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      const rows = []
      for (const image of deepQueryAll('img')) {
        if (!visible(image) || image.naturalWidth < 384 || image.naturalHeight < 384 || !image.currentSrc) continue
        const rect = image.getBoundingClientRect()
        rows.push({ src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight, score: image.naturalWidth * image.naturalHeight + rect.width * rect.height })
      }
      for (const video of deepQueryAll('video[poster]')) {
        if (!visible(video) || !video.poster) continue
        const rect = video.getBoundingClientRect()
        rows.push({ src: video.poster, width: video.videoWidth || Math.round(rect.width), height: video.videoHeight || Math.round(rect.height), score: rect.width * rect.height })
      }
      return rows.filter((row, index) => rows.findIndex(other => other.src === row.src) === index)
    })()`, true) as Promise<Array<{ src: string; width: number; height: number; score: number }>>
  }

  private async submitGoogleFlowPrompt(prompt: string): Promise<void> {
    const win = this.googleFlowWindow
    if (!win || win.isDestroyed()) throw new Error('Cửa sổ Google Flow đã đóng.')
    const result = await win.webContents.executeJavaScript(`(() => {
      ${DEEP_QUERY_ALL_JS}
      const isRendered = element => {
        const style = getComputedStyle(element)
        return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') !== 0
      }
      // Auto-growing contenteditable/textarea fields can legitimately report 0
      // height while empty, so field detection only checks it isn't hidden.
      // Buttons aren't expected to auto-grow from zero size, so still require
      // a small minimum footprint there to filter out decoy/hidden buttons.
      const visibleField = isRendered
      const visibleButton = element => {
        const rect = element.getBoundingClientRect()
        return isRendered(element) && rect.width > 20 && rect.height > 20
      }
      const descriptor = element => String(element.getAttribute('placeholder') || element.getAttribute('aria-label') || element.textContent || '').trim().toLowerCase()
      // Coordinates relative to the top-level page (what webContents.sendInputEvent
      // expects), summing offsets up through any nested same-origin iframes so a
      // real, trusted OS-level click can be dispatched from the main process.
      const getAbsoluteRect = element => {
        const rect = element.getBoundingClientRect()
        let x = rect.left + rect.width / 2
        let y = rect.top + rect.height / 2
        let frameWin = element.ownerDocument.defaultView
        while (frameWin && frameWin.frameElement) {
          const frameRect = frameWin.frameElement.getBoundingClientRect()
          x += frameRect.left
          y += frameRect.top
          frameWin = frameWin.frameElement.ownerDocument.defaultView
        }
        return { x, y }
      }
      const fields = deepQueryAll('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')
        .filter(visibleField)
        .filter(element => !descriptor(element).includes('search'))
        .map(element => {
          const rect = element.getBoundingClientRect()
          const label = descriptor(element)
          const hint = /prompt|describe|imagine|create|generate/.test(label) ? 1000000 : 0
          const kind = element.tagName === 'TEXTAREA' || element.isContentEditable ? 500000 : 0
          return { element, rect, score: hint + kind + rect.width * rect.height }
        })
        .sort((left, right) => right.score - left.score)
      const selected = fields[0]
      if (!selected) return { ok: false, reason: 'PROMPT_NOT_FOUND' }
      const field = selected.element
      field.focus()
      const value = ${JSON.stringify(prompt)}
      const probe = value.slice(0, 30)
      let textApplied = false
      if (field.isContentEditable) {
        // Rich-text editors like Lexical/Draft.js ignore a raw textContent
        // assignment (their internal model never sees it as real input), so
        // simulate real typing via execCommand, which fires the native
        // beforeinput/input events these editors actually listen for. There is
        // no safe fallback for when this fails: a plain textContent assignment
        // is exactly the broken technique this works around, so if execCommand
        // doesn't land we must fail loudly rather than silently resubmit it.
        const selection = window.getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(field)
          selection.removeAllRanges()
          selection.addRange(range)
          document.execCommand('insertText', false, value)
        }
        textApplied = field.textContent.includes(probe)
      } else {
        const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
        setter ? setter.call(field, value) : field.value = value
        field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
        textApplied = field.value.includes(probe)
      }
      if (!textApplied) return { ok: false, reason: 'TEXT_NOT_INSERTED' }
      field.dispatchEvent(new Event('change', { bubbles: true }))

      const buttons = deepQueryAll('button, [role="button"]')
        .filter(visibleButton)
        .filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true')
        .map(button => {
          const rect = button.getBoundingClientRect()
          const label = descriptor(button)
          const match = /(^|\\s)(generate|create|send|submit|run|imagine)(\\s|$)/.test(label) ? 1000000 : 0
          const sameForm = field.closest('form') && field.closest('form') === button.closest('form') ? 500000 : 0
          const distance = Math.abs(rect.left - selected.rect.right) + Math.abs(rect.top - selected.rect.top)
          return { button, score: match + sameForm - distance }
        })
        .sort((left, right) => right.score - left.score)
      const button = buttons.find(item => item.score > 100000)?.button
      if (button) {
        // Don't button.click() here: that dispatches an untrusted synthetic
        // click (isTrusted: false), which modern component frameworks (Lit/
        // Material-style pointer-gesture buttons in particular) can silently
        // ignore. Report the button's screen position instead so the caller
        // dispatches a real OS-level click via webContents.sendInputEvent.
        return { ok: true, method: 'BUTTON', clickAt: getAbsoluteRect(button) }
      }
      const form = field.closest('form')
      if (form?.requestSubmit) {
        // HTMLFormElement.requestSubmit() fires a spec-trusted submit event,
        // unlike synthetic dispatchEvent calls, so this is safe as-is.
        form.requestSubmit()
        return { ok: true, method: 'FORM' }
      }
      // Same trust concern as the button click: fire a real Ctrl+Enter from
      // the caller instead of a synthetic KeyboardEvent. The field already
      // has focus from above, so the caller's key event lands on it.
      return { ok: true, method: 'KEYBOARD' }
    })()`, true) as { ok: boolean; reason?: string; method?: 'BUTTON' | 'FORM' | 'KEYBOARD'; clickAt?: { x: number; y: number } }
    if (!result.ok) {
      if (result.reason === 'TEXT_NOT_INSERTED') {
        throw new Error('Không nhập được nội dung prompt vào ô nhập của Google Flow (giao diện Flow có thể đã thay đổi). Hãy thử nhập tay một prompt rồi bấm lại tự động.')
      }
      throw new Error('Không tìm thấy ô prompt của Google Flow. Hãy mở màn hình tạo ảnh và thử lại.')
    }
    if (result.method === 'BUTTON' || result.method === 'KEYBOARD') {
      // sendInputEvent only reaches the page while the BrowserWindow is OS-focused;
      // the window can lose focus during the minutes-long wait for a generated
      // image, so re-focus right before dispatching or the click/keypress silently
      // no-ops and the run stalls with no clear error.
      win.focus()
    }
    if (result.method === 'BUTTON' && result.clickAt) {
      const { x, y } = result.clickAt
      win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    } else if (result.method === 'KEYBOARD') {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] })
    }
  }

  private async waitForGoogleFlowImage(previousSources: Set<string>, signal: AbortSignal): Promise<string> {
    const deadline = Date.now() + 6 * 60_000
    const stablePolls = new Map<string, number>()
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('Đã dừng tự động tạo ảnh Google Flow.')
      if (!this.googleFlowWindow || this.googleFlowWindow.isDestroyed()) throw new Error('Cửa sổ Google Flow đã đóng.')
      const candidates = await this.googleFlowImageCandidates().catch(() => [])
      const fresh = candidates
        .filter(candidate => !previousSources.has(candidate.src))
        .sort((left, right) => right.score - left.score)
      for (const candidate of fresh) stablePolls.set(candidate.src, (stablePolls.get(candidate.src) ?? 0) + 1)
      const stable = fresh.find(candidate => (stablePolls.get(candidate.src) ?? 0) >= 2)
      if (stable) return stable.src
      await sleep(3_000)
    }
    throw new Error('Google Flow không trả ảnh mới sau 6 phút. Kiểm tra credit, model tạo ảnh và trạng thái project.')
  }

  private async readGoogleFlowBrowserImage(source: string): Promise<Buffer> {
    if (source.startsWith('https://')) return this.readFlowImageSource({ kind: 'URL', value: source })
    // blob:/data: sources are renderer-local (scoped to the page's own origin or
    // inline data, not a fetch to an arbitrary remote host), so they're exempt
    // from the domain allowlist by design. Anything else is an unexpected scheme
    // this code has no business fetching — reject it instead of silently
    // bypassing the allowlist that every other codepath here honors.
    if (!source.startsWith('blob:') && !source.startsWith('data:')) {
      throw new Error(`Nguồn ảnh Google Flow không được hỗ trợ: "${source.slice(0, 200)}".`)
    }
    const win = this.googleFlowWindow
    if (!win || win.isDestroyed()) throw new Error('Cửa sổ Google Flow đã đóng trước khi lấy ảnh.')
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      fetch(${JSON.stringify(source)}, { signal: AbortSignal.timeout(60_000) })
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.blob()
        })
        .then(blob => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh'))
          reader.readAsDataURL(blob)
        })
        .catch(error => reject(error))
    })`, true) as string
    const match = /^data:image\/[^;]+;base64,(.+)$/s.exec(dataUrl)
    if (!match) throw new Error('Google Flow trả dữ liệu ảnh không hợp lệ.')
    const bytes = Buffer.from(match[1], 'base64')
    if (!bytes.length || bytes.length > FLOW_IMAGE_MAX_BYTES) throw new Error('Ảnh Google Flow rỗng hoặc vượt quá 30 MB.')
    return bytes
  }

  async cancelGoogleFlowCapture(): Promise<void> {
    const current = this.googleFlowCaptureStatus
    this.googleFlowAutomationAbort?.abort()
    this.googleFlowAutomationAbort = null
    this.fluxAutomationAbort?.abort()
    this.fluxAutomationAbort = null
    this.googleFlowCaptureCleanup?.()
    this.googleFlowCaptureCleanup = null
    if (current && !['DONE', 'ERROR', 'CANCELED'].includes(current.stage)) {
      this.googleFlowCaptureStatus = { ...current, stage: 'CANCELED', message: 'Đã dừng xử lý tạo ảnh.' }
    }
  }

  async startGoogleFlowCapture(
    projectId: string,
    scriptId: string,
    format: VideoFormat,
    onProgress?: (status: GoogleFlowCaptureStatus) => void,
  ): Promise<GoogleFlowCaptureStatus> {
    if (!['LANDSCAPE', 'REEL', 'SQUARE'].includes(format)) throw new Error('Định dạng video Google Flow không hợp lệ.')
    await this.cancelGoogleFlowCapture()

    const prisma = getPrisma()
    const [script, audio] = await Promise.all([
      prisma.script.findFirst({ where: { id: scriptId, projectId, type: 'LONG_STORY' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!script) throw new Error('Hãy chọn Story script trước khi kết nối Google Flow.')
    if (!audio) throw new Error('Hãy Generate Story MP3 + phân đoạn trước khi kết nối Google Flow.')
    const audioMeta = parseMeta(audio.metadata)
    const segments = parseAudioSegments(audioMeta.segments)
    if (audioMeta.scriptId !== scriptId || audioMeta.scriptHash !== scriptHash(script.content) || !segments.length) {
      throw new Error('Story MP3 không khớp kịch bản hoặc chưa có audio phân đoạn. Hãy Generate lại trước.')
    }

    const total = segments.length
    const baseStatus = { projectId, scriptId, captured: 0, total }
    this.flowStatus({ ...baseStatus, stage: 'CONNECTING', message: 'Đang mở Google Flow...' }, onProgress)

    const flowSession: Session = session.fromPartition('persist:google-flow')
    const captureDir = this.storage.getProjectPath(projectId, 'images', '.google-flow-capture', `${Date.now()}-${randomUUID().slice(0, 8)}`)
    await mkdir(captureDir, { recursive: true })
    const captures: Array<{ path: string; done: boolean }> = []
    let building = false
    let stopped = false

    const cleanup = () => {
      stopped = true
      flowSession.removeListener('will-download', downloadListener)
      if (this.googleFlowCaptureCleanup === cleanup) this.googleFlowCaptureCleanup = null
    }
    const fail = (message: string) => {
      cleanup()
      this.flowStatus({ ...baseStatus, captured: captures.filter(item => item.done).length, stage: 'ERROR', message }, onProgress)
    }
    const downloadListener = (_event: Electron.Event, item: DownloadItem) => {
      if (stopped) return
      const mime = item.getMimeType().toLowerCase()
      const originalName = item.getFilename()
      const originalExt = originalName.toLowerCase().match(/\.(jpe?g|png|webp|avif)$/)?.[0]
      if (!mime.startsWith('image/') && !originalExt) return
      if (captures.length >= total || building) {
        item.cancel()
        return
      }

      const extension = originalExt || (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('avif') ? '.avif' : '.jpg')
      const capture = { path: join(captureDir, `${String(captures.length + 1).padStart(3, '0')}${extension}`), done: false }
      captures.push(capture)
      item.setSavePath(capture.path)
      item.once('done', async (_doneEvent, state) => {
        if (stopped && !building) return
        if (state !== 'completed') {
          const captureIndex = captures.indexOf(capture)
          if (captureIndex >= 0) captures.splice(captureIndex, 1)
          fail(`Tải ảnh Google Flow bị gián đoạn (${state}). Bấm kết nối để thử lại.`)
          return
        }
        try {
          const metadata = await sharp(capture.path).metadata()
          if (!metadata.width || !metadata.height) throw new Error('file không có kích thước ảnh hợp lệ')
          capture.done = true
          const captured = captures.filter(entry => entry.done).length
          this.flowStatus({
            ...baseStatus,
            captured,
            stage: captured === total ? 'BUILDING' : 'CAPTURING',
            message: captured === total
              ? `Đã nhận đủ ${total} ảnh. Đang ghép video theo audio...`
              : `Đã nhận ảnh ${captured}/${total}. Tải ảnh tiếp theo trong Google Flow.`
          }, onProgress)
          if (captured !== total || building) return
          building = true
          cleanup()
          await this.importFlowSceneImages(projectId, scriptId, format, captures.map(entry => ({ kind: 'FILE', value: entry.path })))
          this.flowStatus({
            ...baseStatus,
            captured: total,
            stage: 'DONE',
            message: `Đã nhận và ghép đủ ${total} ảnh Google Flow theo phân đoạn.`
          }, onProgress)
        } catch (error) {
          fail(`Không xử lý được ảnh Google Flow: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    }
    flowSession.on('will-download', downloadListener)
    this.googleFlowCaptureCleanup = cleanup

    try {
      await this.ensureGoogleFlowWindow()
      return this.flowStatus({
        ...baseStatus,
        stage: 'CAPTURING',
        message: `Google Flow đã mở. Tải ${total} ảnh theo đúng thứ tự audio phân đoạn.`
      }, onProgress)
    } catch (error) {
      cleanup()
      const message = `Không mở được Google Flow: ${error instanceof Error ? error.message : String(error)}`
      this.flowStatus({ ...baseStatus, stage: 'ERROR', message }, onProgress)
      throw new Error(message)
    }
  }

  async startGoogleFlowAutomation(
    projectId: string,
    scriptId: string,
    format: VideoFormat,
    onProgress?: (status: GoogleFlowCaptureStatus) => void,
  ): Promise<GoogleFlowCaptureStatus> {
    if (!['LANDSCAPE', 'REEL', 'SQUARE'].includes(format)) throw new Error('Định dạng video Google Flow không hợp lệ.')
    await this.cancelGoogleFlowCapture()
    const prisma = getPrisma()
    const [script, audio] = await Promise.all([
      prisma.script.findFirst({ where: { id: scriptId, projectId, type: 'LONG_STORY' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!script) throw new Error('Hãy chọn Story script trước khi tự động tạo ảnh Google Flow.')
    if (!audio) throw new Error('Hãy Generate Story MP3 + phân đoạn trước khi tự động tạo ảnh Google Flow.')
    const audioMeta = parseMeta(audio.metadata)
    const segments = parseAudioSegments(audioMeta.segments)
    if (audioMeta.scriptId !== scriptId || audioMeta.scriptHash !== scriptHash(script.content) || !segments.length) {
      throw new Error('Story MP3 không khớp kịch bản hoặc chưa có audio phân đoạn. Hãy Generate lại trước.')
    }

    const total = segments.length
    const baseStatus = { projectId, scriptId, captured: 0, total }
    const abortController = new AbortController()
    this.googleFlowAutomationAbort = abortController
    this.flowStatus({ ...baseStatus, stage: 'CONNECTING', message: 'Đang mở phiên Google Flow...' }, onProgress)

    try {
      await this.ensureGoogleFlowWindow()
    } catch (error) {
      this.googleFlowAutomationAbort = null
      const message = `Không mở được Google Flow: ${error instanceof Error ? error.message : String(error)}`
      this.flowStatus({ ...baseStatus, stage: 'ERROR', message }, onProgress)
      throw new Error(message)
    }

    this.flowStatus({
      ...baseStatus,
      stage: 'WAITING_LOGIN',
      message: 'Đang chờ đăng nhập và màn hình tạo ảnh Google Flow...'
    }, onProgress)

    void (async () => {
      const sources: FlowSceneSource[] = []
      try {
        await this.waitForGoogleFlowPrompt(abortController.signal, diagnostic => {
          const parts = [
            `${diagnostic.fieldsFound}/${diagnostic.rawFieldsFound} ô nhập tìm thấy (khớp selector, không tính đến kích thước)`,
            `${diagnostic.iframeCount} iframe${diagnostic.blockedIframeCount ? ` (${diagnostic.blockedIframeCount} khác domain)` : ''}`,
            `${diagnostic.shadowHostCount} shadow root`
          ]
          this.flowStatus({
            ...baseStatus,
            stage: 'WAITING_LOGIN',
            message: `Đang chờ màn hình tạo ảnh Google Flow... (${parts.join(', ')}) — trang: ${diagnostic.title || diagnostic.url || 'đang tải'}.${formatGoogleFlowFieldDetails(diagnostic.rawFieldDetails)}`
          }, onProgress)
        })
        for (const [index, segment] of segments.entries()) {
          if (abortController.signal.aborted) throw new Error('Đã dừng tự động tạo ảnh Google Flow.')
          const previousSources = new Set((await this.googleFlowImageCandidates()).map(candidate => candidate.src))
          const ratio = format === 'REEL' ? 'vertical 9:16' : format === 'SQUARE' ? 'square 1:1' : 'landscape 16:9'
          const prompt = [
            `Create one polished cinematic still image in ${ratio} format for this story scene.`,
            'No captions, subtitles, logos, watermarks, split panels, or text in the image.',
            'Use expressive characters, clear storytelling, strong composition, natural lighting, and keep recurring characters visually consistent with earlier images in this project.',
            `Scene ${index + 1} of ${total}: ${segment.text}`
          ].join(' ')
          this.flowStatus({
            ...baseStatus,
            captured: index,
            stage: 'GENERATING',
            message: `Google Flow đang tạo ảnh ${index + 1}/${total}...`
          }, onProgress)
          await this.submitGoogleFlowPrompt(prompt)
          const imageSource = await this.waitForGoogleFlowImage(previousSources, abortController.signal)
          const bytes = await this.readGoogleFlowBrowserImage(imageSource)
          const sourcePath = await this.storage.writeBuffer(projectId, `images/.google-flow-auto/${Date.now()}-${String(index + 1).padStart(3, '0')}.png`, await sharp(bytes).png().toBuffer())
          sources.push({ kind: 'FILE', value: sourcePath })
          this.flowStatus({
            ...baseStatus,
            captured: index + 1,
            stage: index + 1 === total ? 'BUILDING' : 'GENERATING',
            message: index + 1 === total
              ? `Đã lấy đủ ${total} ảnh. Đang ghép video theo audio...`
              : `Đã lấy ảnh ${index + 1}/${total}; chuẩn bị cảnh tiếp theo...`
          }, onProgress)
          await sleep(1_500)
        }
        await this.importFlowSceneImages(projectId, scriptId, format, sources)
        this.flowStatus({
          ...baseStatus,
          captured: total,
          stage: 'DONE',
          message: `Đã tự động tạo, lấy và ghép ${total} ảnh từ Google Flow.`
        }, onProgress)
      } catch (error) {
        const canceled = abortController.signal.aborted
        this.flowStatus({
          ...baseStatus,
          captured: sources.length,
          stage: canceled ? 'CANCELED' : 'ERROR',
          message: canceled ? 'Đã dừng tự động tạo ảnh Google Flow.' : `Tự động Google Flow bị dừng: ${error instanceof Error ? error.message : String(error)}`
        }, onProgress)
      } finally {
        if (this.googleFlowAutomationAbort === abortController) this.googleFlowAutomationAbort = null
      }
    })()

    return this.googleFlowCaptureStatus!
  }

  private async findExistingSceneImages(
    projectId: string,
    folderName: string,
    totalSegments: number
  ): Promise<Map<number, string>> {
    const map = new Map<number, string>()
    const dirPath = this.storage.getProjectPath(projectId, 'images', folderName)
    if (!existsSync(dirPath)) return map
    try {
      const files = await readdir(dirPath)
      files.sort()
      for (const file of files) {
        const match = file.match(/-(\d{3})\.(jpg|jpeg|png)$/i)
        if (match) {
          const sceneNum = parseInt(match[1], 10)
          if (sceneNum >= 1 && sceneNum <= totalSegments) {
            const fullPath = join(dirPath, file)
            try {
              const st = await stat(fullPath)
              if (st.size > 1000) {
                map.set(sceneNum, fullPath)
              }
            } catch {}
          }
        }
      }
    } catch {}
    return map
  }

  private async extractStickyManSceneDetails(
    segments: StoredAudioSegment[],
    aiService: AIService,
    contentLanguage?: string | null
  ): Promise<Map<number, StickyManSceneDetail>> {
  const result = new Map<number, StickyManSceneDetail>()

  try {
    const provider = aiService.provider()
    const promptLines = segments
      .map(seg => `Scene ${seg.index} (${seg.kind}): "${seg.text.replace(/"/g, "'")}"`)
      .join('\n')

    const prompt = `You are a visual director creating storyboard scenes for "Sticky Man" animated stories (iconic 2D character with a smooth round white circle head, expressive cartoon eyebrows, eyes, and mouth, wearing a black business suit and red necktie).

For each narration scene below (which may be in Vietnamese or English), output a JSON array describing the character's facial expression, specific action, and setting/environment in concise, vivid English.

Story segments:
${promptLines}

Rules:
- "expression": describe the cartoon eyebrows, eyes, and mouth (e.g., "confident smirk, sharp arched eyebrows, ambitious eyes", "tired droopy eyes with dark circles, exhausted mouth line", "wide shocked cartoon eyes with open mouth", "warm friendly smile, cheerful gaze")
- "action": describe exactly what Sticky Man is doing in this scene, matching the narrative details (e.g., "Sticky Man sitting at a wooden desk typing furiously on a glowing laptop", "walking in the heavy rain holding a black umbrella", "standing on a stage explaining a glowing whiteboard chart", "drinking a cup of coffee while looking out the window", "if CTA: smiling warmly, waving to viewer and pointing with thumbs up to subscribe")
- "setting": describe the environment, props, and lighting (e.g., "dark modern office room at night with city skyline lights outside", "crowded sunlit classroom with chalkboard", "rainy city street with red neon signs", "presentation conference room with large screen")

Respond ONLY with valid JSON array:
[
  { "index": 1, "expression": "...", "action": "...", "setting": "..." }
]
`
    const raw = await provider.generateText({ prompt })
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const items = JSON.parse(jsonMatch[0]) as Array<{ index?: number; expression?: string; action?: string; setting?: string }>
      if (Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const segIndex = item.index ?? (i + 1)
          if (item.action && item.expression) {
            result.set(segIndex, {
              action: item.action.trim(),
              expression: item.expression.trim(),
              setting: (item.setting || 'dramatic red and black atmospheric background').trim()
            })
          }
        }
      }
    }
  } catch (err) {
    console.warn('AI extraction of scene details failed, using smart heuristic fallback:', err)
  }

  // Smart heuristic fallback for any missing scenes
  for (const seg of segments) {
    if (!result.has(seg.index)) {
      if (seg.kind === 'CTA') {
        result.set(seg.index, {
          action: 'Sticky Man waving warmly to the viewer with one hand and pointing with a thumbs up to the subscribe button',
          expression: 'friendly warm smile, wink, and cheerful cartoon eyebrows',
          setting: 'dramatic stage with glowing subscribe button and neon accents'
        })
      } else {
        const text = seg.text.toLowerCase()
        let expression = 'determined focused cartoon eyes, thick black eyebrows, and serious mouth line'
        let action = 'Sticky Man standing attentively, gesturing with hand to explain the situation'
        let setting = 'modern city room with dramatic red and black lighting'

        if (/buồn|khóc|thất bại|tuyệt vọng|bế tắc|sad|cry|fail|hopeless/i.test(text)) {
          expression = 'sad downturned mouth, droopy curved eyebrows, teary cartoon eyes'
          action = 'Sticky Man sitting slouched with head bowed in deep contemplation'
          setting = 'dimly lit room with heavy shadows and rain outside the window'
        } else if (/mệt|áp lực|stress|thức đêm|khó khăn|tired|exhausted|pressure|night/i.test(text)) {
          expression = 'tired droopy cartoon eyes with dark eye bags, exhausted flat mouth line, furrowed eyebrows'
          action = 'Sticky Man sitting at a messy wooden desk working late on a glowing laptop, surrounded by coffee mugs'
          setting = 'dark office late at night with red neon skyline outside the window'
        } else if (/tiền|giàu|thành công|đạt được|chiến thắng|tự tin|money|rich|success|win/i.test(text)) {
          expression = 'confident smirk, sharp arched eyebrows, ambitious gleam in cartoon eyes'
          action = 'Sticky Man standing tall with arms crossed proudly or holding a briefcase'
          setting = 'luxury modern skyscraper office overlooking a glowing metropolis'
        } else if (/học|đọc|sách|nghĩ|ý tưởng|mindset|tư duy|book|think|idea/i.test(text)) {
          expression = 'curious wide cartoon eyes, raised inquiring eyebrows, thoughtful smile'
          action = 'Sticky Man looking at an open book with glowing neon diagrams and lightbulb idea above head'
          setting = 'cozy study room with bookshelves and soft ambient glow'
        } else if (/bạn|nói|gặp|chia sẻ|người khác|friend|talk|meet|people/i.test(text)) {
          expression = 'expressive talking mouth, animated eyebrows, attentive cartoon eyes'
          action = 'Sticky Man in a conversation, gesturing with hands to explain'
          setting = 'modern cafe or meeting table with dramatic atmospheric lighting'
        }

        result.set(seg.index, { action, expression, setting })
      }
    }
  }

  return result
}

  async startFluxSceneAutomation(
    projectId: string,
    scriptId: string,
    format: VideoFormat,
    onProgress?: (status: GoogleFlowCaptureStatus) => void,
    hfToken?: string,
    stylePreset: FlowSceneStylePreset = 'FLUX_CINEMATIC',
    customPrompt?: string,
    cleanPrevious?: boolean
  ): Promise<GoogleFlowCaptureStatus> {
    if (!['LANDSCAPE', 'REEL', 'SQUARE'].includes(format)) throw new Error('Định dạng video không hợp lệ.')
    await this.cancelGoogleFlowCapture()

    const token = hfToken?.trim() || this.settings.getHuggingFaceToken()
    if (hfToken?.trim()) {
      this.settings.saveHuggingFaceToken(hfToken.trim())
    }

    const prisma = getPrisma()
    const [project, script, audio] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.script.findFirst({ where: { id: scriptId, projectId, type: 'LONG_STORY' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!script) throw new Error('Hãy chọn Story script trước khi tạo ảnh chi tiết.')
    if (!audio) throw new Error('Hãy Generate Story MP3 + phân đoạn trước khi tạo ảnh chi tiết.')
    const audioMeta = parseMeta(audio.metadata)
    const segments = parseAudioSegments(audioMeta.segments)
    if (audioMeta.scriptId !== scriptId || audioMeta.scriptHash !== scriptHash(script.content) || !segments.length) {
      throw new Error('Story MP3 không khớp kịch bản hoặc chưa có audio phân đoạn. Hãy Generate lại trước.')
    }

    const total = segments.length
    const baseStatus = { projectId, scriptId, captured: 0, total }
    const abortController = new AbortController()
    this.fluxAutomationAbort = abortController

    const width = format === 'REEL' ? 768 : format === 'LANDSCAPE' ? 1344 : 1024
    const height = format === 'REEL' ? 1344 : format === 'LANDSCAPE' ? 768 : 1024

    const isBetterMind = stylePreset === 'BETTER_MIND'
    const styleLabel = isBetterMind ? 'Sticky Man 2D (@abettermind)' : 'FLUX'
    const folderName = isBetterMind ? 'better-mind-scenes' : 'flux-scenes'

    const targetDir = this.storage.getProjectPath(projectId, 'images', folderName)
    await mkdir(targetDir, { recursive: true }).catch(() => undefined)

    if (cleanPrevious) {
      try {
        const oldFiles = await readdir(targetDir)
        for (const file of oldFiles) {
          await unlink(join(targetDir, file)).catch(() => undefined)
        }
      } catch {}
    }

    const existingMap = cleanPrevious ? new Map<number, string>() : await this.findExistingSceneImages(projectId, folderName, total)

    this.flowStatus({
      ...baseStatus,
      stage: 'GENERATING',
      message: token
        ? `Bắt đầu tạo ${total} ảnh hoạt cảnh ${styleLabel} (HF + Fallback)...`
        : `Bắt đầu tạo ${total} ảnh hoạt cảnh ${styleLabel} (Free Engine)...`
    }, onProgress)

    void (async () => {
      const sources: FlowSceneSource[] = []
      const recentImages: FlowSceneImageDTO[] = []
      try {
        let stickyManDetailsMap = new Map<number, StickyManSceneDetail>()
        if (isBetterMind) {
          this.flowStatus({
            ...baseStatus,
            stage: 'GENERATING',
            message: 'Đang phân tích kịch bản để tạo bối cảnh chi tiết và biểu cảm cho từng phân đoạn (Sticky Man)...'
          }, onProgress)
          stickyManDetailsMap = await this.extractStickyManSceneDetails(segments, new AIService(), project?.contentLanguage)
        }

        for (const [index, segment] of segments.entries()) {
          if (abortController.signal.aborted) throw new Error(`Đã dừng tạo ảnh ${styleLabel}.`)

          const sceneNum = index + 1
          const existingPath = existingMap.get(sceneNum)

          // 0. Tự động tái sử dụng nếu phân đoạn này đã có ảnh hợp lệ trên đĩa
          if (existingPath && existsSync(existingPath)) {
            sources.push({ kind: 'FILE', value: existingPath })
            recentImages.push({
              index: segment.index,
              kind: segment.kind,
              sectionText: segment.text,
              duration: segment.duration,
              fileName: basename(existingPath),
              filePath: existingPath,
              fileUrl: mediaUrl(existingPath) || pathToFileURL(existingPath).href,
              source: 'FILE'
            })

            this.flowStatus({
              ...baseStatus,
              captured: sources.length,
              recentImages: [...recentImages],
              stage: sources.length === total ? 'BUILDING' : 'GENERATING',
              message: sources.length === total
                ? `Đã có đủ ${total} ảnh phong cách ${styleLabel}. Đang ghép video...`
                : `Đã có sẵn ảnh phân đoạn ${sceneNum}/${total} (tái sử dụng)...`
            }, onProgress)

            await sleep(40)
            continue
          }

          const defaultStickmanPrompt =
            '2D animated comic style, character Sticky Man, iconic minimalist stick figure with perfectly round white head, thick bold black outlines, expressive cartoon face with thick angular black eyebrows, large black cartoon eyes, and expressive smirk or talking mouth line. Wearing a sharp tailored black suit blazer, white collared shirt, and vibrant red necktie. High contrast dramatic background, cel-shaded 2D vector animation art, graphic novel illustration, no 3D, no CGI, no realistic human skin, no photorealism.'

          const sceneDetail = stickyManDetailsMap.get(sceneNum)
          const prompt = isBetterMind
            ? sceneDetail
              ? [
                  customPrompt?.trim() || defaultStickmanPrompt,
                  `In this specific scene: Character facial expression has ${sceneDetail.expression}.`,
                  `Action: ${sceneDetail.action}.`,
                  `Environment and props: ${sceneDetail.setting}.`,
                  'Maintain 2D vector comic illustration, cell-shaded, high contrast, clean bold ink outlines, no 3D, no CGI.'
                ].join(' ')
              : [
                  customPrompt?.trim() || defaultStickmanPrompt,
                  `Action in this scene: ${segment.text}`
                ].join(' ')
            : [
                'Masterpiece, cinematic lighting, photorealistic, highly detailed, 8k resolution, dramatic atmosphere, expressive storytelling composition, professional cinematography, no text, no watermark, no split screens.',
                `Scene ${index + 1} of ${total}: ${segment.text}`
              ].join(' ')

          const actionSnippet = sceneDetail ? ` (${sceneDetail.action.slice(0, 32)}...)` : ''
          this.flowStatus({
            ...baseStatus,
            captured: sources.length,
            recentImages: [...recentImages],
            stage: 'GENERATING',
            message: `Đang vẽ chi tiết ${styleLabel} cho phân đoạn ${sceneNum}/${total}${actionSnippet}...`
          }, onProgress)

          let imageBuffer: Buffer | null = null
          let lastErr: unknown = null

          // 1. Thử qua Hugging Face InferenceClient nếu người dùng có Token
          if (token) {
            try {
              const { InferenceClient } = await import('@huggingface/inference')
              const hfClient = new InferenceClient(token)
              const candidateModels = [
                'black-forest-labs/FLUX.1-schnell',
                'black-forest-labs/FLUX.1-dev',
                'Tongyi-MAI/Z-Image-Turbo'
              ]
              for (const model of candidateModels) {
                if (imageBuffer) break
                try {
                  const timeoutSignal = AbortSignal.timeout(90_000)
                  const fetchSignal = AbortSignal.any
                    ? AbortSignal.any([abortController.signal, timeoutSignal])
                    : abortController.signal

                  const blob = await hfClient.textToImage({
                    model,
                    inputs: prompt
                  }, { signal: fetchSignal })

                  const rawBuf = Buffer.from(await blob.arrayBuffer())
                  const meta = await sharp(rawBuf).metadata()
                  if (meta.width && meta.height) {
                    imageBuffer = await sharp(rawBuf).resize(width, height, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer()
                    break
                  }
                } catch (hfErr) {
                  lastErr = hfErr
                }
              }
            } catch (importErr) {
              lastErr = importErr
            }
          }

          // 2. Tự động Fallback sang Free Engine (Pollinations) chất lượng cao
          if (!imageBuffer) {
            if (abortController.signal.aborted) throw new Error(`Đã dừng tạo ảnh ${styleLabel}.`)

            this.flowStatus({
              ...baseStatus,
              captured: sources.length,
              recentImages: [...recentImages],
              stage: 'GENERATING',
              message: token
                ? `HF đang bận, đang tạo ảnh qua Engine Free cho cảnh ${sceneNum}/${total}...`
                : `Đang tạo ảnh phong cách ${styleLabel} qua Free Engine cho phân đoạn ${sceneNum}/${total}...`
            }, onProgress)

            for (let attempt = 1; attempt <= 6; attempt++) {
              if (abortController.signal.aborted) throw new Error(`Đã dừng tạo ảnh ${styleLabel}.`)
              try {
                const timeoutSignal = AbortSignal.timeout(90_000)
                const fetchSignal = AbortSignal.any
                  ? AbortSignal.any([abortController.signal, timeoutSignal])
                  : abortController.signal

                const seed = Math.floor(Math.random() * 10_000_000)
                const encodedPrompt = encodeURIComponent(prompt)
                // Tuyệt đối dùng model=sana vì đây là model miễn phí duy nhất hoạt động của pollinations, không đòi thanh toán 402!
                const modelQuery = '&model=sana'

                const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}${modelQuery}`

                const res = await fetch(url, {
                  signal: fetchSignal,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                    'Accept': 'image/jpeg,image/webp,image/png,*/*',
                    'Referer': 'https://pollinations.ai/'
                  }
                })

                if (!res.ok) {
                  const txt = await res.text().catch(() => '')
                  if (res.status === 402 || res.status === 429) {
                    throw new Error(`Engine tạm bận giới hạn tần suất (Mã ${res.status}).`)
                  }
                  throw new Error(`Engine trả về mã ${res.status}: ${txt || res.statusText}`)
                }
                const rawBuf = Buffer.from(await res.arrayBuffer())
                const meta = await sharp(rawBuf).metadata()
                if (!meta.width || !meta.height) throw new Error('Dữ liệu ảnh trả về không hợp lệ.')
                imageBuffer = await sharp(rawBuf).resize(width, height, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer()
                break
              } catch (pollErr) {
                lastErr = pollErr
                if (abortController.signal.aborted) throw new Error(`Đã dừng tạo ảnh ${styleLabel}.`)
                const isRateLimit = /402|429/i.test(pollErr instanceof Error ? pollErr.message : String(pollErr))
                const backoffMs = isRateLimit ? 10_000 + (attempt * 4_000) : attempt * 3_000
                this.flowStatus({
                  ...baseStatus,
                  captured: sources.length,
                  recentImages: [...recentImages],
                  stage: 'GENERATING',
                  message: isRateLimit
                    ? `Engine tạm bận (Mã 402/429). Đang tự động nghỉ ${Math.round(backoffMs / 1000)}s rồi thử lại phân đoạn ${sceneNum}/${total} (lần ${attempt}/6)...`
                    : `Thử lần ${attempt}/6 cảnh ${sceneNum}/${total}: ${pollErr instanceof Error ? pollErr.message : String(pollErr)}. Đợi ${Math.round(backoffMs / 1000)}s rồi thử lại...`
                }, onProgress)
                await sleep(backoffMs)
              }
            }
          }

          if (!imageBuffer) {
            throw new Error(`Không tạo được ảnh phân đoạn ${sceneNum}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
          }

          const relativePath = `images/${folderName}/${Date.now()}-${String(sceneNum).padStart(3, '0')}.jpg`
          const savedPath = await this.storage.writeBuffer(projectId, relativePath, imageBuffer)
          sources.push({ kind: 'FILE', value: savedPath })
          recentImages.push({
            index: segment.index,
            kind: segment.kind,
            sectionText: segment.text,
            duration: segment.duration,
            fileName: basename(savedPath),
            filePath: savedPath,
            fileUrl: mediaUrl(savedPath) || pathToFileURL(savedPath).href,
            source: 'FILE'
          })

          this.flowStatus({
            ...baseStatus,
            captured: sources.length,
            recentImages: [...recentImages],
            stage: sources.length === total ? 'BUILDING' : 'GENERATING',
            message: sources.length === total
              ? `Đã tạo đủ ${total} ảnh phong cách ${styleLabel}. Đang ghép video theo audio...`
              : `Đã xong ảnh ${sceneNum}/${total}; đang chuẩn bị tạo cảnh tiếp theo...`
          }, onProgress)

          if (sceneNum < total) {
            await sleep(2500)
          }

          // Nghỉ 1.2s giữa các lần tạo mới để không bị rate limit bởi server miễn phí
          await sleep(1200)
        }

        await this.importFlowSceneImages(projectId, scriptId, format, sources)
        this.flowStatus({
          ...baseStatus,
          captured: total,
          recentImages: [...recentImages],
          stage: 'DONE',
          message: `Đã tạo và ghép thành công ${total} ảnh phong cách ${styleLabel} theo phân đoạn.`
        }, onProgress)
      } catch (error) {
        const canceled = abortController.signal.aborted
        this.flowStatus({
          ...baseStatus,
          captured: sources.length,
          recentImages: [...recentImages],
          stage: canceled ? 'CANCELED' : 'ERROR',
          message: canceled ? `Đã dừng tạo ảnh ${styleLabel}.` : `Tạo ảnh ${styleLabel} bị lỗi: ${error instanceof Error ? error.message : String(error)}`
        }, onProgress)
      } finally {
        if (this.fluxAutomationAbort === abortController) this.fluxAutomationAbort = null
      }
    })()

    return this.googleFlowCaptureStatus!
  }

  async generateSingleImage(input: GenerateSingleImageInput): Promise<GenerateSingleImageResult> {
    const promptText = (input.prompt || '').trim()
    if (!promptText) throw new Error('Vui lòng nhập mô tả (prompt) để tạo ảnh.')

    const token = input.hfToken?.trim() || this.settings.getHuggingFaceToken()
    if (input.hfToken?.trim()) {
      this.settings.saveHuggingFaceToken(input.hfToken.trim())
    }

    const aspect = input.aspectRatio || '9:16'
    const width = aspect === '9:16' ? 768 : aspect === '16:9' ? 1344 : 1024
    const height = aspect === '9:16' ? 1344 : aspect === '16:9' ? 768 : 1024

    let cleanPrompt = promptText
    if (input.stylePreset === 'BETTER_MIND' && !cleanPrompt.toLowerCase().includes('sticky man')) {
      const defaultStickman =
        '2D animated comic style, character Sticky Man, iconic minimalist stick figure with perfectly round white head, thick bold black outlines, expressive cartoon face with thick angular black eyebrows, large black cartoon eyes, and expressive smirk or talking mouth line. Wearing a sharp tailored black suit blazer, white collared shirt, and vibrant red necktie. High contrast dramatic background, cel-shaded 2D vector animation art, graphic novel illustration, no 3D, no CGI, no realistic human skin, no photorealism.'
      cleanPrompt = `${defaultStickman} Specific scene action and details: ${cleanPrompt}`
    } else if (input.stylePreset === 'FLUX_CINEMATIC' && !cleanPrompt.toLowerCase().includes('cinematic')) {
      cleanPrompt = `Masterpiece, cinematic lighting, photorealistic, highly detailed, 8k resolution, dramatic atmosphere, expressive storytelling composition, professional cinematography, no text, no watermark, no split screens. Scene: ${cleanPrompt}`
    }

    let imageBuffer: Buffer | null = null
    let engineUsed: 'HUGGING_FACE' | 'POLLINATIONS_FREE' = 'POLLINATIONS_FREE'
    let modelUsed = 'sana'
    let lastErr: unknown = null

    // 1. Thử qua Hugging Face InferenceClient nếu có token
    if (token) {
      try {
        const { InferenceClient } = await import('@huggingface/inference')
        const hfClient = new InferenceClient(token)
        const candidateModels = [
          'black-forest-labs/FLUX.1-schnell',
          'black-forest-labs/FLUX.1-dev',
          'Tongyi-MAI/Z-Image-Turbo'
        ]
        for (const model of candidateModels) {
          if (imageBuffer) break
          try {
            const blob = await hfClient.textToImage(
              { model, inputs: cleanPrompt },
              { signal: AbortSignal.timeout(90_000) }
            )
            const rawBuf = Buffer.from(await blob.arrayBuffer())
            const meta = await sharp(rawBuf).metadata()
            if (meta.width && meta.height) {
              imageBuffer = await sharp(rawBuf).resize(width, height, { fit: 'cover' }).jpeg({ quality: 95 }).toBuffer()
              engineUsed = 'HUGGING_FACE'
              modelUsed = model
              break
            }
          } catch (hfErr) {
            lastErr = hfErr
          }
        }
      } catch (importErr) {
        lastErr = importErr
      }
    }

    // 2. Fallback sang Free Engine Pollinations (model=sana)
    if (!imageBuffer) {
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          const seed = Math.floor(Math.random() * 9999999) + 1
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=false&model=sana`
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            },
            signal: AbortSignal.timeout(90_000)
          })

          if (!res.ok) {
            const errStatus = res.status
            if (errStatus === 402 || errStatus === 429) {
              const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 2000, 20000)
              await sleep(backoffMs)
              continue
            }
            throw new Error(`Engine trả về HTTP ${errStatus}`)
          }

          const rawBuf = Buffer.from(await res.arrayBuffer())
          const meta = await sharp(rawBuf).metadata()
          if (!meta.width || !meta.height) {
            throw new Error('Dữ liệu ảnh trả về không hợp lệ.')
          }

          imageBuffer = await sharp(rawBuf).resize(width, height, { fit: 'cover' }).jpeg({ quality: 95 }).toBuffer()
          engineUsed = 'POLLINATIONS_FREE'
          modelUsed = 'sana'
          break
        } catch (pollErr) {
          lastErr = pollErr
          if (attempt < 6) {
            await sleep(2000)
          }
        }
      }
    }

    if (!imageBuffer) {
      throw new Error(`Không tạo được ảnh: ${lastErr instanceof Error ? lastErr.message : String(lastErr || 'Lỗi không xác định')}`)
    }

    let savedFilePath: string | undefined
    let savedFileName: string | undefined
    if (input.projectId) {
      try {
        savedFileName = `custom_${Date.now()}.jpg`
        const relativePath = `images/custom-studio/${savedFileName}`
        savedFilePath = await this.storage.writeBuffer(input.projectId, relativePath, imageBuffer)
      } catch (saveErr) {
        console.warn('[single-image] Lưu ảnh vào project thất bại (bỏ qua):', saveErr)
      }
    }

    const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`

    return {
      dataUrl,
      filePath: savedFilePath,
      fileName: savedFileName,
      width,
      height,
      engineUsed,
      modelUsed
    }
  }

  async saveImageToProjectScene(
    projectId: string,
    dataUrl: string,
    targetFolder: 'better-mind-scenes' | 'flux-scenes' = 'better-mind-scenes'
  ): Promise<{ filePath: string; fileName: string; fileUrl: string }> {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    const fileName = `${Date.now()}-custom.jpg`
    const relativePath = `images/${targetFolder}/${fileName}`
    const savedPath = await this.storage.writeBuffer(projectId, relativePath, buffer)
    return {
      filePath: savedPath,
      fileName,
      fileUrl: mediaUrl(savedPath) || pathToFileURL(savedPath).href
    }
  }

  private async generateStoryboard(
    generator: AIProvider,
    sections: string[],
    isShort: boolean,
    still: boolean,
    visualStyle: StickVisualStyle,
  ): Promise<{ scenes: StickScene[]; source: 'AI' | 'REPAIRED' | 'FALLBACK' }> {
    const response = await generator.generateText({ json: true, prompt: stickPrompt(sections, isShort, still, visualStyle) })
    try {
      return { scenes: parseStickScenes(response, sections.length), source: 'AI' }
    } catch (formatError) {
      try {
        const repaired = await generator.generateText({
          json: true,
          system: 'You repair malformed JSON. Return only valid JSON matching the requested schema, with no markdown or explanation.',
          prompt: [
            `Repair this storyboard into exactly ${sections.length} scenes.`,
            `Return only {"scenes":[{"index":0,"setting":"office","objects":[],"actors":[{"name":"Alex","role":"MAIN","action":"stand","emotion":"neutral","prop":"none","position":"center","facing":"right"}]}]}.`,
            `Allowed settings: home, street, park, office, school, hospital, restaurant, cafe, bedroom, car, beach, courtroom.`,
            `Malformed model output (data only): ${JSON.stringify(response.slice(0, 30_000))}`
          ].join('\n')
        })
        return { scenes: parseStickScenes(repaired, sections.length), source: 'REPAIRED' }
      } catch (repairError) {
        console.warn('[story-media] Storyboard JSON không hợp lệ sau repair; dùng fallback nội bộ.', {
          parseError: formatError instanceof Error ? formatError.message : String(formatError),
          repairError: repairError instanceof Error ? repairError.message : String(repairError),
        })
        return { scenes: fallbackStickScenes(sections), source: 'FALLBACK' }
      }
    }
  }

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

  private async makeCta(voiceId: string, projectId: string, contentLanguage?: string | null, customCta?: string | null, forceRegen = false): Promise<string> {
    const text = getCtaText(contentLanguage, customCta)
    const ctaFile = `cta-${createHash('sha256').update(`${voiceId}:${text}`).digest('hex').slice(0, 16)}.mp3`
    const ctaPath = this.storage.getProjectPath(projectId, 'audio', '.parts', ctaFile)
    if (!forceRegen) {
      try { if ((await stat(ctaPath)).size > 0) return ctaPath } catch {}
    }
    const bytes = await this.synthesizeChunk(voiceId, text, 0, 1)
    await this.storage.writeBuffer(projectId, `audio/.parts/${ctaFile}`, bytes)
    return ctaPath
  }

  private async publishStoryAudioSegments(input: {
    projectId: string
    scriptId: string
    studioOutput: boolean
    voiceId: string
    storyHash: string
    pieces: string[]
    partPaths: string[]
    ctaPath: string
    ctaText?: string
  }): Promise<{ output: string; duration: number; segments: StoredAudioSegment[] }> {
    const resolvedCtaText = input.ctaText || CTA_TEXT
    const segmentSources = [...input.partPaths, input.ctaPath]
    const segmentTexts = [...input.pieces, resolvedCtaText]
    const segmentTotal = segmentSources.length
    const segmentSet = `${input.storyHash.slice(0, 12)}-${createHash('sha256').update(`${input.voiceId}:${resolvedCtaText}`).digest('hex').slice(0, 8)}`
    const segments: StoredAudioSegment[] = []
    for (let i = 0; i < segmentSources.length; i++) {
      const fileName = i === segmentSources.length - 1
        ? `${String(i + 1).padStart(3, '0')}-cta.mp3`
        : `${String(i + 1).padStart(3, '0')}-story.mp3`
      const segmentPath = input.studioOutput
        ? await this.storage.getStudioOutputPath(input.projectId, input.scriptId, 'audio', 'segments', segmentSet, fileName)
        : await this.storage.getOutputPath(input.projectId, 'audio', 'segments', segmentSet, fileName)
      await copyFile(segmentSources[i], segmentPath)
      const segmentDuration = await probeDuration(segmentPath)
      if (segmentDuration <= 0) throw new Error(`Audio phân đoạn ${i + 1}/${segmentTotal} có duration không hợp lệ.`)
      const textFileName = i === segmentSources.length - 1
        ? `${String(i + 1).padStart(3, '0')}-cta.txt`
        : `${String(i + 1).padStart(3, '0')}-story.txt`
      const segmentTextPath = input.studioOutput
        ? await this.storage.getStudioOutputPath(input.projectId, input.scriptId, 'audio', 'segments', segmentSet, textFileName)
        : await this.storage.getOutputPath(input.projectId, 'audio', 'segments', segmentSet, textFileName)
      await writeFile(segmentTextPath, segmentTexts[i], 'utf8')

      segments.push({
        index: i + 1,
        total: segmentTotal,
        kind: i === segmentSources.length - 1 ? 'CTA' : 'STORY',
        text: segmentTexts[i],
        path: segmentPath,
        textPath: segmentTextPath,
        duration: segmentDuration
      })
    }

    const allSegmentsText = segments
      .map(seg => `[${seg.kind === 'CTA' ? 'CTA' : `Phân đoạn ${seg.index}`}]\n${seg.text}`)
      .join('\n\n')
    const allSegmentsPath = input.studioOutput
      ? await this.storage.getStudioOutputPath(input.projectId, input.scriptId, 'audio', 'segments', segmentSet, 'all-segments.txt')
      : await this.storage.getOutputPath(input.projectId, 'audio', 'segments', segmentSet, 'all-segments.txt')
    await writeFile(allSegmentsPath, allSegmentsText, 'utf8')

    const output = input.studioOutput
      ? await this.storage.getStudioOutputPath(input.projectId, input.scriptId, 'audio', 'story.mp3')
      : await this.storage.getOutputPath(input.projectId, 'audio', 'story.mp3')
    const listFile = this.storage.getProjectPath(input.projectId, 'audio', '.parts', 'concat.txt')
    await concatMp3Parts(segments.map(segment => segment.path), output, listFile)
    const duration = await probeDuration(output)
    if (duration <= 0) throw new Error('Story MP3 đã tạo nhưng duration không hợp lệ.')
    return { output, duration, segments }
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
    const audioSegments = parseAudioSegments(audioMeta.segments)
    const bgMeta = parseMeta(background?.metadata)
    const flowScenes = bgMeta.source === 'GOOGLE_FLOW_SCENES' ? parseFlowScenes(bgMeta.scenes) : []
    let activeFlowScenes = flowScenes
    if (activeFlowScenes.length === 0 && audioSegments.length > 0) {
      const betterMindMap = await this.findExistingSceneImages(projectId, 'better-mind-scenes', audioSegments.length)
      const fluxMap = await this.findExistingSceneImages(projectId, 'flux-scenes', audioSegments.length)
      const chosenMap = betterMindMap.size >= fluxMap.size ? betterMindMap : fluxMap
      if (chosenMap.size > 0) {
        const fallbackScenes: StoredFlowScene[] = []
        for (const seg of audioSegments) {
          const p = chosenMap.get(seg.index)
          if (p) {
            fallbackScenes.push({
              index: seg.index,
              kind: seg.kind,
              text: seg.text,
              duration: seg.duration,
              path: p,
              source: 'FILE'
            })
          }
        }
        activeFlowScenes = fallbackScenes
      }
    }
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
      thumbnailTitle: typeof thumbnailMeta.title === 'string' ? thumbnailMeta.title : null,
      thumbnailConcept: Object.prototype.hasOwnProperty.call(THUMBNAIL_CONCEPTS, String(thumbnailMeta.concept)) ? thumbnailMeta.concept as ThumbnailConcept : null,
      thumbnailProvider: typeof thumbnailMeta.provider === 'string' ? thumbnailMeta.provider : null,
      thumbnailSourceVideoPath: typeof thumbnailMeta.videoPath === 'string' ? thumbnailMeta.videoPath : null,
      thumbnailSourceTimeSeconds: typeof thumbnailMeta.timeSeconds === 'number' ? thumbnailMeta.timeSeconds : null,
      audioPath: audio?.path ?? null,
      audioUrl: mediaUrl(audio?.path, audio?.createdAt),
      audioDuration: typeof audioMeta.duration === 'number' ? audioMeta.duration : null,
      audioSegmentSupport: true,
      stick3dSupport: true,
      flowSceneSupport: true,
      audioSegments: audioSegments.map(segment => ({
        ...segment,
        textPath: segment.textPath ?? segment.path.replace(/\.mp3$/i, '.txt'),
        url: mediaUrl(segment.path, audio?.createdAt)!
      })),
      flowSceneImages: activeFlowScenes.map((scene): FlowSceneImageDTO => ({
        index: scene.index,
        kind: scene.kind,
        sectionText: scene.text,
        duration: scene.duration,
        fileName: basename(scene.path),
        filePath: scene.path,
        fileUrl: mediaUrl(scene.path, background?.createdAt) || pathToFileURL(scene.path).href,
        source: scene.source
      })),
      backgroundPath: background?.path ?? null,
      backgroundUrl: mediaUrl(background?.path, background?.createdAt),
      backgroundName: background?.path ? basename(background.path) : null,
      backgroundDuration: typeof bgMeta.duration === 'number' ? bgMeta.duration : null,
      backgroundStyle: bgMeta.style === 'STICK_FIGURE' ? 'STICK_FIGURE' : 'CUSTOM',
      backgroundVisualStyle: bgMeta.visualStyle === 'ENGINEER_3D' ? 'ENGINEER_3D' : bgMeta.style === 'STICK_FIGURE' ? 'DOODLE_2D' : null,
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
    const backgroundMeta = parseMeta(background?.metadata)
    const isStickBackground = backgroundMeta.style === 'STICK_FIGURE'
    const stickVisualStyle: StickVisualStyle = backgroundMeta.visualStyle === 'ENGINEER_3D' ? 'ENGINEER_3D' : 'DOODLE_2D'
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
          ctaPath ??= await this.makeCta(project.voiceId, projectId, project.contentLanguage)
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
          const reelCtaText = getCtaText(project.contentLanguage)
          const subtitlePath = includeSubtitles
            ? await this.storage.writeOutputText(projectId, `subtitles/${slug}.ass`, createAssSubtitles({
                text: `${reel.content}\n\n${reelCtaText}`,
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
              reelScenes = (await this.generateStoryboard(generator, reelSections, true, false, stickVisualStyle)).scenes
            } catch {
              reelScenes = fallbackStickScenes(reelSections)
            }
            reelScenes.push({ setting: reelScenes[reelScenes.length - 1].setting, actors: [{ ...reelScenes[reelScenes.length - 1].actors[0], action: 'wave' }] })
            reelSections.push(reelCtaText)
            const stickReelPath = await this.storage.getOutputPath(projectId, 'background', `stick-${slug}-${randomUUID()}.mp4`)
            await renderStickAnimation(reelScenes, reelSections, reelAudioDuration, 'REEL', stickReelPath, pct => {
              report(episode, 'VIDEO', `Tập ${episode}/${reels.length}: dựng hoạt hình người que ${pct}%...`)
            }, audioPath, stickVisualStyle)
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

  async generateThumbnail(
    projectId: string,
    scriptId: string,
    customPrompt?: string,
    customTitle?: string,
    concept: ThumbnailConcept = 'PROBLEM_STATE',
    engine?: 'AI' | 'BUILTIN_2D',
    includeTextOverlay = true
  ): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [project, script] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findUniqueOrThrow({ where: { id: scriptId } })
    ])
    if (script.projectId !== projectId || script.type !== 'LONG_STORY') throw new Error('Script không hợp lệ để tạo thumbnail.')
    const context = script.content.replace(/\s+/g, ' ').trim().slice(0, 3500)
    if (!context) throw new Error('Story đang trống, không thể tạo thumbnail.')
    if (!Object.prototype.hasOwnProperty.call(THUMBNAIL_CONCEPTS, concept)) throw new Error('Concept thumbnail không hợp lệ.')
    const title = customTitle?.trim() || script.title || project.name
    const prompt = buildGoogleFlowThumbnailPrompt({
      title,
      concept,
      topic: project.topic || undefined,
      context,
      customPrompt,
      audience: audiencePrompt(project)
    })
    const image = await this.thumbnails.generate(prompt, concept, engine)
    if (!image.bytes.length) throw new Error('Provider trả về thumbnail rỗng.')
    const normalized = normalizeThumbnail(image.bytes)
    let thumbnailBytes = normalized
    if (includeTextOverlay) {
      const overlay = renderLandscapeThumbnailOverlay(title, concept, project.topic || undefined)
      thumbnailBytes = await sharp(normalized)
        .composite([{ input: overlay, top: 0, left: 0 }])
        .png()
        .toBuffer()
    }
    const path = await this.storage.writeOutputBuffer(projectId, 'images/thumbnail.png', thumbnailBytes)
    await prisma.asset.deleteMany({ where: { projectId, type: 'THUMBNAIL' } })
    await prisma.asset.create({ data: {
      projectId,
      type: 'THUMBNAIL',
      path,
      metadata: JSON.stringify({
        title,
        concept,
        engine: engine || 'AI',
        style: 'GOOGLE_FLOW_2D',
        prompt: customPrompt?.trim() || null,
        generatedPrompt: prompt,
        includeTextOverlay,
        provider: image.provider,
        model: image.model,
        mimeType: 'image/png',
        sourceMimeType: image.mimeType,
        width: 1280,
        height: 720,
        scriptId
      })
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


  async generateStoryAudio(projectId: string, scriptId: string, studioOutput = false, customCta?: string): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const [project, script] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      prisma.script.findUniqueOrThrow({ where: { id: scriptId } })
    ])
    if (script.projectId !== projectId || script.type !== 'LONG_STORY') throw new Error('Script không hợp lệ cho Story MP3.')
    if (!project.voiceId) throw new Error('Hãy chọn voice trước khi Generate Story MP3.')
    const ctaText = getCtaText(project.contentLanguage, customCta)
    const chunkSize = this.voices.getMaxTextLength()
    const pieces = chunks(script.content, chunkSize)
    if (!pieces.length) throw new Error('Story đang trống, không thể generate voice.')
    const currentScriptHash = scriptHash(script.content)
    const existingAudio = await prisma.asset.findFirst({
      where: { projectId, type: 'STORY_AUDIO' },
      orderBy: { createdAt: 'desc' }
    })
    const existingAudioMeta = parseMeta(existingAudio?.metadata)
    if (
      existingAudio &&
      parseAudioSegments(existingAudioMeta.segments).length === 0 &&
      existingAudioMeta.scriptId === scriptId &&
      existingAudioMeta.scriptHash === currentScriptHash &&
      existingAudioMeta.voiceId === project.voiceId
    ) {
      const cachedPartPaths = pieces.map((_, index) =>
        this.storage.getProjectPath(projectId, 'audio', '.parts', `story-${String(index + 1).padStart(3, '0')}.mp3`)
      )
      const cachedPartsReady = (await Promise.all(cachedPartPaths.map(async path => {
        try { return (await stat(path)).size > 0 } catch { return false }
      }))).every(Boolean)
      if (cachedPartsReady) {
        const published = await this.publishStoryAudioSegments({
          projectId,
          scriptId,
          studioOutput,
          voiceId: project.voiceId,
          storyHash: currentScriptHash,
          pieces,
          partPaths: cachedPartPaths,
          ctaPath: await this.makeCta(project.voiceId, projectId, project.contentLanguage, customCta),
          ctaText
        })
        await prisma.asset.update({
          where: { id: existingAudio.id },
          data: {
            path: published.output,
            metadata: JSON.stringify({
              ...existingAudioMeta,
              duration: published.duration,
              scriptHash: currentScriptHash,
              chunks: pieces.length,
              chunkSize,
              segments: published.segments
            })
          }
        })
        await prisma.project.update({ where: { id: projectId }, data: { status: 'MEDIA_READY' } })
        return this.get(projectId)
      }
    }
    let job = await prisma.job.findFirst({ where: { projectId, type: 'GENERATE_STORY_AUDIO', status: 'RUNNING' }, orderBy: { createdAt: 'desc' } })
    const jobMeta = parseMeta(job?.payload)
    const resuming = Boolean(job && jobMeta.scriptId === scriptId && jobMeta.scriptHash === currentScriptHash && jobMeta.voiceId === project.voiceId)
    if (job && !resuming) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'Script hoặc voice đã thay đổi; không resume chunk audio cũ.' } })
    }
    if (!resuming) job = await prisma.job.create({ data: { projectId, type: 'GENERATE_STORY_AUDIO', status: 'RUNNING', progress: 0, payload: JSON.stringify({ projectId, scriptId, studioOutput, scriptHash: currentScriptHash, voiceId: project.voiceId }) } })

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
        await prisma.job.update({ where: { id: job!.id }, data: { progress: Math.round(((i + 1) / pieces.length) * 90), payload: JSON.stringify({ projectId, scriptId, studioOutput, scriptHash: currentScriptHash, voiceId: project.voiceId, chunk: i + 1, total: pieces.length }) } })
      }

      // Publish each TTS chunk as a first-class audio segment, then concatenate
      // those exact files so the individual outputs always match story.mp3.
      const published = await this.publishStoryAudioSegments({
        projectId,
        scriptId,
        studioOutput,
        voiceId: project.voiceId,
        storyHash: currentScriptHash,
        pieces,
        partPaths,
        ctaPath: await this.makeCta(project.voiceId, projectId, project.contentLanguage, customCta, !resuming),
        ctaText
      })

      await prisma.asset.deleteMany({ where: { projectId, type: 'STORY_AUDIO' } })
      await prisma.render.updateMany({ where: { projectId, type: 'STORY_VIDEO' }, data: { status: 'STALE' } })
      await prisma.asset.create({ data: { projectId, type: 'STORY_AUDIO', path: published.output, metadata: JSON.stringify({ duration: published.duration, scriptId, scriptHash: currentScriptHash, voiceId: project.voiceId, chunks: pieces.length, chunkSize, segments: published.segments }) } })
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

  async generateStickVideo(projectId: string, scriptId: string, format: VideoFormat, onProgress?: (progress: StoryVideoProgress) => void, source: 'API' | 'CODEX_CLI' | 'CLAUDE_CLI' | 'ANTIGRAVITY_CLI' = 'API', studioOutput = false, visualStyle: StickVisualStyle = 'DOODLE_2D'): Promise<StoryMediaDTO> {
    if (!['LANDSCAPE', 'REEL', 'SQUARE'].includes(format)) throw new Error('Định dạng video không hợp lệ.')
    if (!['API', 'CODEX_CLI', 'CLAUDE_CLI', 'ANTIGRAVITY_CLI'].includes(source)) throw new Error('Nguồn tạo storyboard không hợp lệ.')
    if (!['DOODLE_2D', 'ENGINEER_3D'].includes(visualStyle)) throw new Error('Phong cách hoạt hình không hợp lệ.')
    if (this.stickRuns.has(projectId)) throw new Error('Dự án đang tạo hoạt hình người que.')
    this.stickRuns.add(projectId)
    const prisma = getPrisma()
    let output: string | undefined
    let published = false
    const report = (percent: number, message: string) => onProgress?.({ current: 0, total: 1, percent, stage: 'VIDEO', message })
    try {
      let script = await prisma.script.findFirst({ where: { id: scriptId, projectId } })
      if (!script) {
        script = await prisma.script.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } })
      }
      if (!script) throw new Error('Không tìm thấy kịch bản để tạo hoạt hình.')
      const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } })
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
          if (!project.voiceId) throw new Error('Hãy chọn voice trước khi tạo hoạt hình cho Reel.')
          report(1, 'Đang tạo voice cho kịch bản Reel...')
          const episode = script.version || 1
          const slug = `reel-${String(episode).padStart(2, '0')}`
          const expectedAudioPath = studioOutput
            ? await this.storage.getStudioOutputPath(projectId, scriptId, 'audio', 'reel.mp3')
            : await this.storage.getOutputPath(projectId, 'audio', 'reels', `${slug}.mp3`)
          const ctaPath = await this.makeCta(project.voiceId, projectId, project.contentLanguage)
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
      const storyboard = await this.generateStoryboard(generator, sections, isShort, false, visualStyle)
      const scenes = storyboard.scenes
      if (storyboard.source !== 'AI') report(4, storyboard.source === 'REPAIRED' ? 'Đã tự sửa JSON storyboard; đang tiếp tục dựng video...' : 'Model trả JSON lỗi; đang dùng storyboard fallback nội bộ...')
      // Narration ends with the app CTA. Give it a separate scene and timing weight.
      scenes.push({ setting: scenes[scenes.length - 1].setting, actors: [{ ...scenes[scenes.length - 1].actors[0], action: 'wave' }] })
      const stickCtaText = getCtaText(project.contentLanguage)
      sections.push(stickCtaText)
      const runId = randomUUID()
      output = studioOutput
        ? await this.storage.getStudioOutputPath(projectId, scriptId, 'videos', `stick-${runId}.mp4`)
        : await this.storage.getOutputPath(projectId, 'background', `stick-${runId}.mp4`)
      await renderStickAnimation(scenes, sections, duration, effectiveFormat, output, percent => report(5 + Math.round(percent * .65), `Đang dựng hoạt hình ${visualStyle === 'ENGINEER_3D' ? '3D Engineer' : 'người que'} ${effectiveFormat === 'REEL' ? 'Short 9:16' : ''}: ${percent}%`), audioPath, visualStyle)
      report(72, 'Đang tạo caption từ lời đọc và CTA...')
      const subtitlePath = studioOutput
        ? await this.storage.getStudioOutputPath(projectId, scriptId, 'subtitles', `stick-${runId}.ass`)
        : await this.storage.getOutputPath(projectId, 'subtitles', `stick-${runId}.ass`)
      await writeFile(subtitlePath, createAssSubtitles({ text: `${script.content}\n\n${stickCtaText}`, totalDuration: duration, format: effectiveFormat }), 'utf8')
      const captionedOutput = output.replace(/\.mp4$/i, '-captioned.mp4')
      try {
        await burnVideoCaptions(output, subtitlePath, captionedOutput, duration,
          percent => report(73 + Math.round(percent * .22), `Đang ghép caption vào video: ${percent}%`))
        await rename(captionedOutput, output)
      } finally { await unlink(captionedOutput).catch(() => undefined) }
      const measured = await probeDuration(output)
      if (Math.abs(measured - duration) > .2) {
        throw new Error(`Thời lượng hoạt hình không khớp lời đọc: video ${measured.toFixed(3)}s, audio ${duration.toFixed(3)}s, lệch ${Math.abs(measured - duration).toFixed(3)}s.`)
      }
      const latestScript = await prisma.script.findUnique({ where: { id: scriptId } })
      if (latestScript?.content !== script.content) throw new Error('Truyện hoặc lời đọc đã thay đổi. Hãy tạo lại hoạt hình.')
      const storyboardData = JSON.stringify({ scriptId, audioAssetId: audioId, format: effectiveFormat, duration: measured, timing: 'word-weighted', storyboardSource: storyboard.source, visualStyle, subtitlePath, subtitleTiming: 'estimated-from-text', scenes: scenes.map((scene, index) => ({ ...scene, text: sections[index] })), isShort }, null, 2)
      const storyboardPath = studioOutput
        ? await this.storage.getStudioOutputPath(projectId, scriptId, 'storyboard', `stick-${runId}.json`)
        : await this.storage.getOutputPath(projectId, 'background', `stick-${runId}.json`)
      await writeFile(storyboardPath, storyboardData, 'utf8')
      await prisma.$transaction([
        prisma.asset.deleteMany({ where: { projectId, type: 'BACKGROUND_VIDEO' } }),
        prisma.asset.create({ data: { projectId, type: 'BACKGROUND_VIDEO', path: output, metadata: JSON.stringify({ kind: 'VIDEO', style: 'STICK_FIGURE', visualStyle, format: effectiveFormat, duration: measured, audioAssetId: audioId, scriptId: script.id, scriptHash: scriptHash(script.content), storyboardPath, subtitlePath, captionsBurnedIn: true, isShort }) } }),
        prisma.render.updateMany({ where: { projectId, type: { in: ['STORY_VIDEO', 'REEL_VIDEO'] } }, data: { status: 'STALE' } })
      ])
      published = true
      report(97, 'Đang chuẩn bị thumbnail ảnh tĩnh...')
      // A finished video must not overwrite the user's chosen thumbnail with
      // a captioned frame. Render a separate still only when no cover exists.
      const existingThumbnail = await prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' } })
      if (!existingThumbnail) {
        const coverScene = { ...scenes[0], overlay: undefined }
        const cover = await sharp(Buffer.from(stickFrame(coverScene, 0, 'LANDSCAPE', new Map(), true, visualStyle)))
          .resize(1280, 720).png().toBuffer()
        const coverPath = studioOutput
          ? await this.storage.getStudioOutputPath(projectId, scriptId, 'images', 'thumbnail.png')
          : await this.storage.getOutputPath(projectId, 'images', 'thumbnail.png')
        await writeFile(coverPath, cover)
        await prisma.asset.create({ data: {
          projectId, type: 'THUMBNAIL', path: coverPath,
          metadata: JSON.stringify({ provider: 'storyboard', model: 'stick-still', title: script.title, scriptId, width: 1280, height: 720, mimeType: 'image/png' })
        } })
      }
      const media = await this.get(projectId)
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
    visualStyle: StickVisualStyle = 'DOODLE_2D',
  ): Promise<{ sceneImages: StickmanSceneImageDTO[]; outputDir: string }> {
    if (!['DOODLE_2D', 'ENGINEER_3D'].includes(visualStyle)) throw new Error('Phong cách ảnh phân đoạn không hợp lệ.')
    const prisma = getPrisma()
    const script = await prisma.script.findFirst({ where: { id: scriptId, projectId } })
    if (!script) throw new Error('Hãy chọn kịch bản để tạo bộ ảnh phân đoạn.')

    const isShort = script.type === 'REEL' || format === 'REEL'
    const effectiveFormat = script.type === 'REEL' ? 'REEL' : format
    const sections = storySections(script.content, isShort)
    const generator = source === 'CODEX_CLI' ? new CodexCliService() : source === 'CLAUDE_CLI' ? new ClaudeCliService() : source === 'ANTIGRAVITY_CLI' ? new AntigravityCliService() : new AIService().provider()
    const scenes = (await this.generateStoryboard(generator, sections, isShort, true, visualStyle)).scenes

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
      const svgText = stickFrame(scene, 0, effectiveFormat, colors, true, visualStyle)
      const pngBuffer = await sharp(Buffer.from(svgText)).png().toBuffer()
      const relativePath = `images/scenes/${timestamp}/${fileName}`
      const filePath = await this.storage.writeOutputBuffer(projectId, relativePath, pngBuffer)
      const fileUrl = mediaUrl(filePath, timestamp)!

      sceneImages.push({
        index: i + 1,
        setting: scene.setting,
        sectionText,
        fileName,
        filePath,
        fileUrl,
      })
    }

    const outputDir = sceneImages.length
      ? dirname(sceneImages[0].filePath)
      : await this.storage.getOutputPath(projectId, 'images', 'scenes', String(timestamp))
    return { sceneImages, outputDir }
  }

  async importFlowSceneImages(
    projectId: string,
    scriptId: string,
    format: VideoFormat,
    sources: FlowSceneSource[],
  ): Promise<StoryMediaDTO> {
    if (!['LANDSCAPE', 'REEL', 'SQUARE'].includes(format)) throw new Error('Định dạng video Google Flow không hợp lệ.')
    const prisma = getPrisma()
    const [script, audio] = await Promise.all([
      prisma.script.findFirst({ where: { id: scriptId, projectId, type: 'LONG_STORY' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!script) throw new Error('Hãy chọn Story script trước khi nhập ảnh Google Flow.')
    if (!audio) throw new Error('Hãy Generate Story MP3 + phân đoạn trước khi nhập ảnh Google Flow.')
    const audioMeta = parseMeta(audio.metadata)
    if (audioMeta.scriptId !== scriptId || audioMeta.scriptHash !== scriptHash(script.content)) {
      throw new Error('Story hoặc audio đã thay đổi. Hãy Generate Story MP3 + phân đoạn lại trước.')
    }
    const audioSegments = parseAudioSegments(audioMeta.segments)
    if (!audioSegments.length) throw new Error('Story MP3 hiện tại chưa có audio phân đoạn.')
    if (sources.length !== audioSegments.length) {
      throw new Error(`Cần đúng ${audioSegments.length} ảnh Google Flow, tương ứng ${audioSegments.length} audio phân đoạn.`)
    }
    if (sources.some(source => !source?.value?.trim() || (source.kind !== 'URL' && source.kind !== 'FILE'))) {
      throw new Error('Danh sách nguồn ảnh Google Flow không hợp lệ.')
    }

    const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const imageRelativeDir = `images/flow-scenes/${runId}`
    const tempDir = this.storage.getProjectPath(projectId, 'background', '.flow-scenes', runId)
    const finalVideo = await this.storage.getOutputPath(projectId, 'background', `google-flow-${format.toLowerCase()}.mp4`)
    const dims = format === 'REEL' ? [1080, 1920] : format === 'SQUARE' ? [1080, 1080] : [1920, 1080]
    const storedScenes: StoredFlowScene[] = []
    await mkdir(tempDir, { recursive: true })

    try {
      for (const [index, segment] of audioSegments.entries()) {
        let png: Buffer
        try {
          const sourceBytes = await this.readFlowImageSource(sources[index])
          png = await sharp(sourceBytes)
            .rotate()
            .resize(dims[0], dims[1], { fit: 'cover', position: 'attention' })
            .png({ compressionLevel: 8 })
            .toBuffer()
        } catch (error) {
          throw new Error(`Ảnh cho phân đoạn ${index + 1} không hợp lệ: ${error instanceof Error ? error.message : String(error)} Nếu link Flow cần đăng nhập, hãy tải ảnh về máy rồi dùng "Chọn ảnh đã tải".`)
        }

        const fileName = `${String(index + 1).padStart(3, '0')}-${segment.kind === 'CTA' ? 'cta' : 'story'}.png`
        const imagePath = await this.storage.writeOutputBuffer(projectId, `${imageRelativeDir}/${fileName}`, png)
        const clipPath = join(tempDir, `${String(index + 1).padStart(3, '0')}.mp4`)
        await renderStillSceneClip(imagePath, clipPath, segment.duration, format, index % 2 ? 'out' : 'in', 30)
        storedScenes.push({
          index: segment.index,
          kind: segment.kind,
          text: segment.text,
          duration: segment.duration,
          path: imagePath,
          source: sources[index].kind
        })
      }

      const listPath = join(tempDir, 'concat.txt')
      const clipList = storedScenes.map((_, index) => {
        const clipPath = join(tempDir, `${String(index + 1).padStart(3, '0')}.mp4`)
        return `file '${clipPath.replace(/'/g, "'\\''")}'`
      }).join('\n')
      await writeFile(listPath, clipList, 'utf8')
      await concatAnimationScenes(listPath, finalVideo)
      const duration = await probeDuration(finalVideo)
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video ảnh Google Flow đã ghép nhưng duration không hợp lệ.')

      const copied = await this.storage.copyBackgroundMedia(projectId, finalVideo)
      await prisma.$transaction([
        prisma.asset.deleteMany({ where: { projectId, type: 'BACKGROUND_VIDEO' } }),
        prisma.render.updateMany({ where: { projectId, type: { in: ['STORY_VIDEO', 'REEL_VIDEO'] } }, data: { status: 'STALE' } }),
        prisma.asset.create({ data: {
          projectId,
          type: 'BACKGROUND_VIDEO',
          path: copied,
          metadata: JSON.stringify({
            duration,
            sourceName: basename(finalVideo),
            source: 'GOOGLE_FLOW_SCENES',
            kind: 'VIDEO',
            format,
            scriptId,
            audioAssetId: audio.id,
            scenes: storedScenes
          })
        } })
      ])
      await this.storage.writeOutputText(projectId, `${imageRelativeDir}/manifest.json`, JSON.stringify({
        source: 'GOOGLE_FLOW_SCENES',
        format,
        scriptId,
        audioAssetId: audio.id,
        scenes: storedScenes
      }, null, 2))
      return this.get(projectId)
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async generateEmotionDemo(
    projectId?: string,
    emotion: string = 'worried',
    format: VideoFormat = 'REEL',
    visualStyle: StickVisualStyle = 'DOODLE_2D',
  ): Promise<{ videoPath: string; videoUrl: string; duration: number }> {
    const timestamp = Date.now()
    const fileName = `demo-emotion-${emotion.toLowerCase()}-${timestamp}.mp4`
    let outputPath: string
    if (projectId) {
      outputPath = await this.storage.getOutputPath(projectId, 'demos', fileName)
    } else {
      const fallbackDir = join(getOutputRoot(), 'demos')
      await mkdir(fallbackDir, { recursive: true })
      outputPath = join(fallbackDir, fileName)
    }
    await renderEmotionDemoVideo(emotion, format, outputPath, undefined, visualStyle)
    return {
      videoPath: outputPath,
      videoUrl: mediaUrl(outputPath) || pathToFileURL(outputPath).href,
      duration: 3,
    }
  }

  async listEmotionDemos(projectId?: string): Promise<EmotionDemoDTO[]> {
    let demosDir: string
    if (projectId) {
      const root = await this.storage.ensureOutputProject(projectId).catch(() => null)
      if (!root) return []
      demosDir = join(root, 'demos')
    } else {
      demosDir = join(getOutputRoot(), 'demos')
    }

    if (!existsSync(demosDir)) return []
    try {
      const files = await readdir(demosDir)
      const mp4Files = files.filter(f => f.startsWith('demo-emotion-') && f.endsWith('.mp4'))
      const results: EmotionDemoDTO[] = []
      for (const file of mp4Files) {
        const fullPath = join(demosDir, file)
        const st = await stat(fullPath).catch(() => null)
        if (!st) continue
        const parts = file.replace(/\.mp4$/, '').split('-')
        const emotion = parts[2] || 'custom'
        const timestamp = parseInt(parts[3] || '0', 10) || Math.round(st.mtimeMs)
        results.push({
          fileName: file,
          videoPath: fullPath,
          videoUrl: mediaUrl(fullPath, st.mtimeMs) || pathToFileURL(fullPath).href,
          emotion,
          createdAt: timestamp,
          size: st.size,
        })
      }
      return results.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
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

  async render(projectId: string, format: VideoFormat, fitMode: FitMode, soundEffectInput: SoundEffectOptions = DEFAULT_SOUND_EFFECT_OPTIONS, includeSubtitles = true, onProgress?: (progress: StoryVideoProgress) => void, signal?: AbortSignal): Promise<StoryMediaDTO> {
    const prisma = getPrisma()
    const soundEffect = normalizeSoundEffectOptions(soundEffectInput)
    const [project, audio, background, thumbnail] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.asset.findFirst({ where: { projectId, type: 'STORY_AUDIO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'BACKGROUND_VIDEO' }, orderBy: { createdAt: 'desc' } }),
      prisma.asset.findFirst({ where: { projectId, type: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } })
    ])
    if (!audio) throw new Error('Chưa có story.mp3. Generate Story MP3 trước.')
    if (!background) throw new Error('Chưa chọn video hoặc ảnh background.')
    const backgroundMeta = parseMeta(background.metadata)
    const backgroundKind: BackgroundKind = backgroundMeta.kind === 'IMAGE' ? 'IMAGE' : 'VIDEO'
    const sourceAudioMeta = parseMeta(audio.metadata)
    const sourceScriptId = typeof sourceAudioMeta.scriptId === 'string' ? sourceAudioMeta.scriptId : undefined
    const sourceScript = sourceScriptId
      ? await prisma.script.findFirst({ where: { id: sourceScriptId, projectId, type: 'LONG_STORY' } })
      : await prisma.script.findFirst({ where: { projectId, type: 'LONG_STORY' }, orderBy: { version: 'desc' } })
    if (includeSubtitles && !sourceScript) throw new Error('Không tìm thấy Story script để tạo phụ đề.')
    const stickBackground = backgroundMeta.style === 'STICK_FIGURE'
    const flowSceneBackground = backgroundMeta.source === 'GOOGLE_FLOW_SCENES'
    if (stickBackground && (backgroundMeta.audioAssetId !== audio.id || !sourceScript || backgroundMeta.scriptHash !== scriptHash(sourceScript.content))) throw new Error('Truyện hoặc lời đọc đã đổi. Hãy tạo lại hoạt hình người que.')
    if (flowSceneBackground && (backgroundMeta.audioAssetId !== audio.id || backgroundMeta.scriptId !== sourceScriptId)) throw new Error('Truyện hoặc lời đọc đã đổi. Hãy ghép lại ảnh Google Flow theo phân đoạn.')
    if ((stickBackground || flowSceneBackground) && backgroundMeta.format !== format) throw new Error(`Hãy tạo lại ${flowSceneBackground ? 'video ảnh Google Flow' : 'hoạt hình'} theo định dạng output đã chọn.`)
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
    const renderCtaText = getCtaText(project?.contentLanguage)
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
              text: `${sourceScript.content}\n\n${renderCtaText}`,
              totalDuration: audioDuration,
              format,
              clipStart: segment.startMs / 1000,
              clipDuration: segment.durationMs / 1000
            }))
          : undefined
        await renderLoopedVideo({
          backgroundPath: background.path,
          frameRate: stickBackground ? 60 : 30,
          backgroundStartSeconds: stickBackground || flowSceneBackground ? segment.startMs / 1000 : undefined,
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
