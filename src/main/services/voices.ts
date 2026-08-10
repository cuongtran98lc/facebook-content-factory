import type { PreviewVoiceInput, ProjectDTO, SelectVoiceInput, VoiceDTO, VoicePreviewResult } from '../../shared/types'
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

type TtsProvider = 'elevenlabs' | 'capcut'

const CAPCUT_VOICE_PREFIX = 'capcut::'

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

export class VoiceService {
  constructor(private readonly settings = new SettingsService()) {}

  async list(search?: string): Promise<VoiceDTO[]> {
    return getProvider() === 'capcut' ? this.listCapCut(search) : this.listElevenLabs(search)
  }

  async synthesize(voiceId: string, text: string): Promise<Buffer> {
    const cleanText = text.trim()
    if (!cleanText) throw new Error('Nội dung TTS đang trống.')
    if (decodeCapCutVoice(voiceId) || getProvider() === 'capcut') return this.synthesizeCapCut(voiceId, cleanText)
    return this.synthesizeElevenLabs(voiceId, cleanText)
  }

  async preview(input: PreviewVoiceInput): Promise<VoicePreviewResult> {
    const text = input.text.trim().slice(0, 400)
    if (!text) throw new Error('Nhập câu test giọng đọc trước.')
    const bytes = await this.synthesize(input.voiceId, text)
    return { mimeType: 'audio/mpeg', dataUrl: `data:audio/mpeg;base64,${bytes.toString('base64')}` }
  }

  async select(input: SelectVoiceInput): Promise<ProjectDTO> {
    const project = await getPrisma().project.update({
      where: { id: input.projectId },
      data: { voiceId: input.voiceId, voiceName: input.voiceName }
    })
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
    let response: Response
    try {
      response = await fetch(`${bridge}/api/voices`, { signal: AbortSignal.timeout(10000) })
    } catch (error) {
      throw new Error(`Không kết nối được CapCut TTS bridge tại ${bridge}. Hãy chạy bridge local trước. ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) throw new Error(`CapCut bridge voices failed (${response.status}): ${await response.text()}`)
    const payload = await response.json() as CapCutBridgeVoice[]
    const needle = search?.trim().toLocaleLowerCase('vi')
    return payload
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
    if (!response.ok) throw new Error(`CapCut bridge TTS failed (${response.status}): ${await response.text()}`)

    const payload = await response.json() as CapCutTtsResponse
    if (!payload.speech_url) throw new Error(`CapCut bridge không trả speech_url: ${payload.detail || JSON.stringify(payload)}`)

    const audioResponse = await fetch(payload.speech_url, { signal: AbortSignal.timeout(60000) })
    if (!audioResponse.ok) throw new Error(`Không tải được MP3 từ CapCut (${audioResponse.status}).`)
    return Buffer.from(await audioResponse.arrayBuffer())
  }
}
