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

export class VoiceService {
  constructor(private readonly settings = new SettingsService()) {}

  async list(search?: string): Promise<VoiceDTO[]> {
    const key = this.settings.getElevenLabsApiKey()
    const params = new URLSearchParams({ page_size: '100', sort: 'name', sort_direction: 'asc' })
    if (search?.trim()) params.set('search', search.trim())
    const response = await fetch(`https://api.elevenlabs.io/v2/voices?${params.toString()}`, {
      headers: { 'xi-api-key': key }
    })
    if (!response.ok) throw new Error(`ElevenLabs voices failed (${response.status}): ${await response.text()}`)
    const payload = await response.json() as { voices?: ElevenVoice[] }
    return (payload.voices ?? []).filter(v => v.voice_id && v.name).map(v => ({
      id: v.voice_id!, name: v.name!, category: v.category ?? null,
      description: v.description ?? null, previewUrl: v.preview_url ?? null, labels: v.labels ?? {}
    }))
  }

  async synthesize(voiceId: string, text: string): Promise<Buffer> {
    const key = this.settings.getElevenLabsApiKey()
    const cleanText = text.trim()
    if (!cleanText) throw new Error('Nội dung TTS đang trống.')
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, model_id: this.settings.getElevenLabsModel() })
    })
    if (!response.ok) throw new Error(`ElevenLabs TTS failed (${response.status}): ${await response.text()}`)
    return Buffer.from(await response.arrayBuffer())
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
}
