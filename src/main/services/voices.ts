import type { PreviewVoiceInput, ProjectDTO, SelectVoiceInput, VoiceDTO, VoicePreviewResult } from '../../shared/types'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getPrisma } from './database'
import { projectToDTO } from './projects'
import { SettingsService } from './settings'

type ElevenVoice = {
  voice_id?: string
  name?: string
  category?: string
  description?: string
  preview_url?: string
  labels?: Record<string, string>
}

type CapCutBridgeVoice = {
  voice_type?: string
  resource_id?: string
  lang?: string
  display_name?: string
  gender?: string
  description?: string
}

type CapCutTtsResponse = {
  status?: string
  speech_url?: string
  voice?: string
  display_name?: string
  detail?: string
}

type VieNeuBridgeVoice = {
  id?: string
  display_name?: string
  gender?: string
  region?: string
  style?: string
  description?: string
  custom?: boolean
}

type TtsProvider = 'elevenlabs' | 'capcut'

const CAPCUT_VOICE_PREFIX = 'capcut::'
const SYSTEM_REVIEW_VOICE_ID = 'system::vi_review_female'
const EDGE_HOAIMY_VOICE_ID = 'edge::vi-VN-HoaiMyNeural'
const EDGE_NAMMINH_VOICE_ID = 'edge::vi-VN-NamMinhNeural'
const VIENEU_VOICE_PREFIX = 'vieneu::'

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1000)}`)))
  })
}

async function synthesizeMacOS(cleanText: string, reviewStyle = false): Promise<Buffer> {
  if (process.platform !== 'darwin') throw new Error('System TTS fallback hiện chỉ hỗ trợ macOS.')
  const directory = await mkdtemp(join(tmpdir(), 'content-factory-tts-'))
  const aiff = join(directory, 'voice.aiff')
  const mp3 = join(directory, 'voice.mp3')
  try {
    const rate = reviewStyle ? (process.env.MACOS_REVIEW_TTS_RATE || '188') : (process.env.MACOS_TTS_RATE || '175')
    await run('/usr/bin/say', ['-v', process.env.MACOS_TTS_VOICE || 'Linh', '-r', rate, '-o', aiff, cleanText])
    const pitchSemitones = Number(process.env.MACOS_REVIEW_TTS_PITCH || '0')
    const reviewFilters = [
      'highpass=f=85',
      'lowpass=f=12500',
      'equalizer=f=260:t=q:w=1:g=0.8',
      'equalizer=f=3000:t=q:w=1.1:g=1.2',
      'acompressor=threshold=-18dB:ratio=2:attack=12:release=120:makeup=1.2',
      'loudnorm=I=-17:TP=-1.5:LRA=9'
    ]
    if (Number.isFinite(pitchSemitones) && Math.abs(pitchSemitones) >= 0.1) {
      const pitchRatio = Math.pow(2, pitchSemitones / 12)
      reviewFilters.unshift(`asetrate=44100*${pitchRatio.toFixed(6)}`, 'aresample=44100', `atempo=${(1 / pitchRatio).toFixed(6)}`)
    }
    const filters = reviewStyle ? ['-af', reviewFilters.join(',')] : []
    await run(process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg', ['-y', '-i', aiff, ...filters, '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', mp3])
    return await readFile(mp3)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function synthesizeEdge(cleanText: string, voice: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'content-factory-edge-tts-'))
  const output = join(directory, 'voice.mp3')
  const venvPython = process.platform === 'win32'
    ? join(process.cwd(), 'tools', 'capcut_bridge', '.venv', 'Scripts', 'python.exe')
    : join(process.cwd(), 'tools', 'capcut_bridge', '.venv', 'bin', 'python')
  const python = process.env.EDGE_TTS_PYTHON || (existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3'))
  try {
    await run(python, [
      '-m', 'edge_tts',
      '--voice', voice,
      `--rate=${process.env.EDGE_TTS_RATE || '+5%'}`,
      `--pitch=${process.env.EDGE_TTS_PITCH || '+0Hz'}`,
      '--text', cleanText,
      '--write-media', output
    ])
    return await readFile(output)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function getProvider(): TtsProvider {
  return process.env.TTS_PROVIDER?.trim().toLowerCase() === 'capcut' ? 'capcut' : 'elevenlabs'
}

function getCapCutBridgeUrl(): string {
  const raw = (process.env.CAPCUT_TTS_BRIDGE_URL || 'http://127.0.0.1:8000').trim().replace(/\/$/, '')
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('CAPCUT_TTS_BRIDGE_URL không hợp lệ.')
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('CapCut bridge chỉ được phép chạy local (127.0.0.1/localhost).')
  }
  return parsed.toString().replace(/\/$/, '')
}

function encodeCapCutVoice(voiceType: string, resourceId?: string): string {
  return `${CAPCUT_VOICE_PREFIX}${encodeURIComponent(voiceType)}::${encodeURIComponent(resourceId || '')}`
}

function decodeCapCutVoice(id: string): { voiceType: string; resourceId?: string } | null {
  if (!id.startsWith(CAPCUT_VOICE_PREFIX)) return null
  const [voiceType = '', resourceId = ''] = id.slice(CAPCUT_VOICE_PREFIX.length).split('::')
  if (!voiceType) return null
  return {
    voiceType: decodeURIComponent(voiceType),
    resourceId: resourceId ? decodeURIComponent(resourceId) : undefined
  }
}

function encodeVieNeuVoice(voice: string, style: string): string {
  return `${VIENEU_VOICE_PREFIX}${encodeURIComponent(voice)}::${encodeURIComponent(style)}`
}

function decodeVieNeuVoice(id: string): { voice: string; style: string } | null {
  if (!id.startsWith(VIENEU_VOICE_PREFIX)) return null
  const [voice = '', style = 'doc_truyen'] = id.slice(VIENEU_VOICE_PREFIX.length).split('::')
  if (!voice) return null
  return { voice: decodeURIComponent(voice), style: decodeURIComponent(style) }
}

export class VoiceService {
  constructor(private readonly settings = new SettingsService()) {}

  getMaxTextLength(): number {
    // CapCut's upstream TTS task rejects long SSML payloads with
    // TTSExceededTextLimit. Preview already uses the known-safe 400-char size.
    return getProvider() === 'capcut' ? 400 : 1800
  }

  async list(search?: string): Promise<VoiceDTO[]> {
    return getProvider() === 'capcut' ? this.listCapCut(search) : this.listElevenLabs(search)
  }

  async synthesize(voiceId: string, text: string): Promise<Buffer> {
    const cleanText = text.trim()
    if (!cleanText) throw new Error('Nội dung TTS đang trống.')
    if (decodeVieNeuVoice(voiceId)) return this.synthesizeVieNeu(voiceId, cleanText)
    if (voiceId.startsWith('edge::')) return synthesizeEdge(cleanText, voiceId.slice('edge::'.length))
    if (voiceId === SYSTEM_REVIEW_VOICE_ID) return synthesizeMacOS(cleanText, true)
    if (decodeCapCutVoice(voiceId) || getProvider() === 'capcut') return this.synthesizeCapCut(voiceId, cleanText)
    return this.synthesizeElevenLabs(voiceId, cleanText)
  }

  async preview(input: PreviewVoiceInput): Promise<VoicePreviewResult> {
    const text = input.text.trim().slice(0, 400)
    if (!text) throw new Error('Nhập câu test giọng đọc trước.')
    const bytes = await this.synthesize(input.voiceId, text)
    const mimeType = decodeVieNeuVoice(input.voiceId) ? 'audio/wav' : 'audio/mpeg'
    return { mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
  }

  async select(input: SelectVoiceInput): Promise<ProjectDTO> {
    const prisma = getPrisma()
    const current = await prisma.project.findUniqueOrThrow({ where: { id: input.projectId } })
    if (current.voiceId === input.voiceId) return projectToDTO(current)
    const [, project] = await prisma.$transaction([
      prisma.job.updateMany({
        where: { projectId: input.projectId, status: 'RUNNING', type: { in: ['GENERATE_STORY_AUDIO', 'GENERATE_REEL_VIDEOS'] } },
        data: { status: 'FAILED', error: 'Voice đã thay đổi; job cũ bị hủy để không tái sử dụng audio cũ.' }
      }),
      prisma.project.update({
        where: { id: input.projectId },
        data: { voiceId: input.voiceId, voiceName: input.voiceName, status: 'SCRIPT_READY' }
      }),
      prisma.asset.deleteMany({ where: { projectId: input.projectId, type: { in: ['STORY_AUDIO', 'REEL_AUDIO'] } } }),
      prisma.render.updateMany({ where: { projectId: input.projectId, status: { in: ['DONE', 'RUNNING'] } }, data: { status: 'STALE' } })
    ])
    return projectToDTO(project)
  }

  private async listElevenLabs(search?: string): Promise<VoiceDTO[]> {
    const key = this.settings.getElevenLabsApiKey()
    const params = new URLSearchParams({ page_size: '100', sort: 'name', sort_direction: 'asc' })
    if (search?.trim()) params.set('search', search.trim())
    const response = await fetch(`https://api.elevenlabs.io/v2/voices?${params.toString()}`, {
      headers: { 'xi-api-key': key }
    })
    if (!response.ok) throw new Error(`ElevenLabs voices failed (${response.status}): ${await response.text()}`)
    const payload = await response.json() as { voices?: ElevenVoice[] }
    return (payload.voices ?? []).filter(v => v.voice_id && v.name).map(v => ({
      id: v.voice_id!,
      name: v.name!,
      category: v.category ?? null,
      description: v.description ?? null,
      previewUrl: v.preview_url ?? null,
      labels: v.labels ?? {}
    }))
  }

  private async synthesizeElevenLabs(voiceId: string, cleanText: string): Promise<Buffer> {
    const key = this.settings.getElevenLabsApiKey()
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, model_id: this.settings.getElevenLabsModel() })
    })
    if (!response.ok) throw new Error(`ElevenLabs TTS failed (${response.status}): ${await response.text()}`)
    return Buffer.from(await response.arrayBuffer())
  }

  private async listCapCut(search?: string): Promise<VoiceDTO[]> {
    const bridge = getCapCutBridgeUrl()
    let payload: CapCutBridgeVoice[] = []
    try {
      const response = await fetch(`${bridge}/api/voices`, { signal: AbortSignal.timeout(10000) })
      if (response.ok) payload = await response.json() as CapCutBridgeVoice[]
      else console.warn(`CapCut bridge voices unavailable (${response.status}): ${await response.text()}`)
    } catch (error) {
      throw new Error(`Không kết nối được local TTS bridge tại ${bridge}. Hãy chạy npm start. ${error instanceof Error ? error.message : String(error)}`)
    }
    const needle = search?.trim().toLocaleLowerCase('vi')
    const voices: VoiceDTO[] = payload
      .filter(v => v.voice_type && v.display_name)
      .filter(v => !needle || `${v.display_name} ${v.voice_type} ${v.lang || ''}`.toLocaleLowerCase('vi').includes(needle))
      .map(v => ({
        id: encodeCapCutVoice(v.voice_type!, v.resource_id),
        name: v.display_name!,
        category: 'CapCut (Experimental)',
        description: v.description ?? `${v.lang || 'unknown'} · ${v.voice_type}`,
        previewUrl: null,
        labels: {
          provider: 'capcut',
          voice_type: v.voice_type!,
          resource_id: v.resource_id ?? '',
          lang: v.lang ?? '',
          gender: v.gender ?? ''
        }
      }))
    if (process.platform === 'darwin' && (!needle || 'nữ review phim local macos linh'.includes(needle))) {
      voices.unshift({
        id: SYSTEM_REVIEW_VOICE_ID,
        name: 'Nữ Review Phim · Local',
        category: 'macOS Local',
        description: 'Giọng nữ tiếng Việt, nhịp nhanh, EQ và nén âm cho video review phim.',
        previewUrl: null,
        labels: { provider: 'system', gender: 'female', lang: 'vi-VN', style: 'movie-review' }
      })
    }
    const edgeVoices: VoiceDTO[] = [
      { id: EDGE_HOAIMY_VOICE_ID, name: 'Hoài My Neural · Nữ Việt Nam', category: 'Microsoft Edge TTS', description: 'Giọng nữ neural tiếng Việt, rõ và tự nhiên cho narration.', previewUrl: null, labels: { provider: 'edge-tts', gender: 'female', lang: 'vi-VN' } },
      { id: EDGE_NAMMINH_VOICE_ID, name: 'Nam Minh Neural · Nam Việt Nam', category: 'Microsoft Edge TTS', description: 'Giọng nam neural tiếng Việt.', previewUrl: null, labels: { provider: 'edge-tts', gender: 'male', lang: 'vi-VN' } }
    ].filter(voice => !needle || `${voice.name} ${voice.description}`.toLocaleLowerCase('vi').includes(needle))
    voices.unshift(...edgeVoices)
    try {
      const vieneuResponse = await fetch(`${bridge}/api/vieneu/voices`, { signal: AbortSignal.timeout(10000) })
      if (vieneuResponse.ok) {
        const presets = await vieneuResponse.json() as VieNeuBridgeVoice[]
        const priority = ['Ngọc Linh', 'Mai Anh', 'Trúc Ly', 'Đoan Trang']
        const vieneuVoices = presets
          .filter(v => v.id && v.display_name)
          .filter(v => v.custom || (v.region === 'Bắc' && v.gender === 'female'))
          .filter(v => !needle || `${v.display_name} ${v.description || ''} miền bắc vieneu`.toLocaleLowerCase('vi').includes(needle))
          .sort((a, b) => priority.indexOf(a.id!) - priority.indexOf(b.id!))
          .map(v => ({
            id: encodeVieNeuVoice(v.id!, v.style || 'doc_truyen'),
            name: `${v.display_name} · ${v.style === 'doc_truyen' ? 'Đọc truyện' : v.style === 'tin_tuc' ? 'Tin tức' : 'Tự nhiên'}`,
            category: v.custom ? 'VieNeu Local · Custom Clone' : 'VieNeu Local · Giọng Bắc',
            description: `${v.description || 'Giọng nữ miền Bắc'} · chạy local bằng ONNX`,
            previewUrl: null,
            labels: { provider: 'vieneu', gender: v.gender || 'female', lang: 'vi-VN', region: v.region || 'Bắc', style: v.style || 'doc_truyen' }
          })) satisfies VoiceDTO[]
        voices.unshift(...vieneuVoices)
      }
    } catch (error) {
      console.warn('Không tải được danh sách VieNeu voices:', error)
    }
    return voices
  }

  private async synthesizeVieNeu(voiceId: string, cleanText: string): Promise<Buffer> {
    const voice = decodeVieNeuVoice(voiceId)
    if (!voice) throw new Error('VieNeu voiceId không hợp lệ. Hãy Load voices và chọn lại voice VieNeu.')
    const bridge = getCapCutBridgeUrl()
    const response = await fetch(`${bridge}/api/vieneu/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, voice: voice.voice, style: voice.style }),
      signal: AbortSignal.timeout(15 * 60 * 1000)
    })
    if (!response.ok) throw new Error(`VieNeu local TTS failed (${response.status}): ${await response.text()}`)
    return Buffer.from(await response.arrayBuffer())
  }

  private async synthesizeCapCut(voiceId: string, cleanText: string): Promise<Buffer> {
    const voice = decodeCapCutVoice(voiceId)
    if (!voice) throw new Error('CapCut voiceId không hợp lệ. Hãy Load voices và chọn lại voice CapCut.')

    const bridge = getCapCutBridgeUrl()
    const rate = Number(process.env.CAPCUT_TTS_RATE || '1')
    const response = await fetch(`${bridge}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        voice: voice.voiceType,
        resource_id: voice.resourceId,
        rate: Number.isFinite(rate) ? rate : 1
      }),
      signal: AbortSignal.timeout(120000)
    })
    if (!response.ok) {
      const detail = await response.text()
      const fallbackEnabled = /^(1|true|yes)$/i.test(process.env.CAPCUT_TTS_SYSTEM_FALLBACK || '')
      if (response.status === 403 && /shark block|ret=-6|security blocked/i.test(detail) && fallbackEnabled && process.platform === 'darwin') {
        console.warn('CapCut Shark security blocked TTS; using local macOS voice fallback (Linh).')
        return synthesizeMacOS(cleanText)
      }
      throw new Error(`CapCut bridge TTS failed (${response.status}): ${detail}`)
    }

    const payload = await response.json() as CapCutTtsResponse
    if (!payload.speech_url) throw new Error(`CapCut bridge không trả speech_url: ${payload.detail || JSON.stringify(payload)}`)

    const audioResponse = await fetch(payload.speech_url, { signal: AbortSignal.timeout(60000) })
    if (!audioResponse.ok) throw new Error(`Không tải được MP3 từ CapCut (${audioResponse.status}).`)
    return Buffer.from(await audioResponse.arrayBuffer())
  }
}
