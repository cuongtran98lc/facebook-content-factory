import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AIProviderName, AISettingsDTO, SaveAISettingsInput, SaveVoiceSettingsInput, VoiceSettingsDTO, YouTubeAuthStatus } from '../../shared/types'

interface SettingsSchema {
  aiProvider: AIProviderName
  openaiModel: string
  geminiModel: string
  openaiApiKeyEncrypted?: string
  geminiApiKeyEncrypted?: string
  elevenLabsModel: string
  elevenLabsApiKeyEncrypted?: string
  youtubeClientId?: string
  youtubeClientSecretEncrypted?: string
  youtubeAccessTokenEncrypted?: string
  youtubeRefreshTokenEncrypted?: string
  youtubeTokenExpiry?: number
  youtubeChannelId?: string
  youtubeChannelTitle?: string
}

const DEFAULT_SETTINGS: SettingsSchema = {
  aiProvider: 'gemini',
  openaiModel: 'gpt-5.4-mini',
  geminiModel: 'gemini-2.5-flash',
  elevenLabsModel: 'eleven_multilingual_v2'
}

function getSettingsPath(): string {
  // This is intentionally resolved lazily. SettingsService is imported before
  // app.whenReady(), while app.getPath() should only be used once Electron is ready.
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): SettingsSchema {
  const path = getSettingsPath()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SettingsSchema>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettings(settings: SettingsSchema): void {
  const path = getSettingsPath()
  mkdirSync(dirname(path), { recursive: true })

  // Atomic-ish write: don't leave a half-written settings file if the process
  // is interrupted while persisting credentials/preferences.
  const tempPath = `${path}.tmp`
  writeFileSync(tempPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(tempPath, path)
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable. Không thể lưu API key an toàn.')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value?: string): string | null {
  if (!value) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return null
  }
}

export class SettingsService {
  getAI(): AISettingsDTO {
    const settings = readSettings()
    return {
      provider: settings.aiProvider,
      openaiModel: settings.openaiModel,
      geminiModel: settings.geminiModel,
      hasOpenAIKey: Boolean(settings.openaiApiKeyEncrypted),
      hasGeminiKey: Boolean(settings.geminiApiKeyEncrypted)
    }
  }

  saveAI(input: SaveAISettingsInput): AISettingsDTO {
    const settings = readSettings()
    settings.aiProvider = input.provider
    settings.openaiModel = input.openaiModel.trim() || DEFAULT_SETTINGS.openaiModel
    settings.geminiModel = input.geminiModel.trim() || DEFAULT_SETTINGS.geminiModel

    if (input.clearOpenAIKey) delete settings.openaiApiKeyEncrypted
    else if (input.openaiApiKey?.trim()) settings.openaiApiKeyEncrypted = encrypt(input.openaiApiKey.trim())

    if (input.clearGeminiKey) delete settings.geminiApiKeyEncrypted
    else if (input.geminiApiKey?.trim()) settings.geminiApiKeyEncrypted = encrypt(input.geminiApiKey.trim())

    writeSettings(settings)
    return this.getAI()
  }


  getVoice(): VoiceSettingsDTO {
    const settings = readSettings()
    return {
      elevenLabsModel: settings.elevenLabsModel || DEFAULT_SETTINGS.elevenLabsModel,
      hasElevenLabsKey: Boolean(settings.elevenLabsApiKeyEncrypted)
    }
  }

  saveVoice(input: SaveVoiceSettingsInput): VoiceSettingsDTO {
    const settings = readSettings()
    settings.elevenLabsModel = input.elevenLabsModel.trim() || DEFAULT_SETTINGS.elevenLabsModel
    if (input.clearElevenLabsKey) delete settings.elevenLabsApiKeyEncrypted
    else if (input.elevenLabsApiKey?.trim()) settings.elevenLabsApiKeyEncrypted = encrypt(input.elevenLabsApiKey.trim())
    writeSettings(settings)
    return this.getVoice()
  }

  getElevenLabsApiKey(): string {
    const key = decrypt(readSettings().elevenLabsApiKeyEncrypted)
    if (!key) throw new Error('Chưa cấu hình ElevenLabs API key. Vào Settings → Voice/TTS để thêm key.')
    return key
  }

  getElevenLabsModel(): string {
    return readSettings().elevenLabsModel || DEFAULT_SETTINGS.elevenLabsModel
  }

  getProvider(): AIProviderName {
    return readSettings().aiProvider
  }

  getModel(provider: AIProviderName): string {
    const settings = readSettings()
    return provider === 'openai' ? settings.openaiModel : settings.geminiModel
  }

  getApiKey(provider: AIProviderName): string {
    const settings = readSettings()
    const encrypted = provider === 'openai'
      ? settings.openaiApiKeyEncrypted
      : settings.geminiApiKeyEncrypted

    const key = decrypt(encrypted)
    if (!key) throw new Error(`Chưa cấu hình API key cho ${provider}. Vào Settings để thêm key.`)
    return key
  }

  // YouTube credential management
  getYouTubeStatus(): YouTubeAuthStatus {
    const s = readSettings()
    const connected = Boolean(s.youtubeAccessTokenEncrypted && s.youtubeRefreshTokenEncrypted)
    return { connected, channelId: s.youtubeChannelId ?? null, channelTitle: s.youtubeChannelTitle ?? null }
  }

  saveYouTubeClientCredentials(clientId: string, clientSecret: string): void {
    const s = readSettings()
    s.youtubeClientId = clientId.trim()
    s.youtubeClientSecretEncrypted = clientSecret.trim() ? encrypt(clientSecret.trim()) : undefined
    writeSettings(s)
  }

  getYouTubeClientCredentials(): { clientId: string; clientSecret: string } {
    const s = readSettings()
    return { clientId: s.youtubeClientId ?? '', clientSecret: decrypt(s.youtubeClientSecretEncrypted) ?? '' }
  }

  saveYouTubeTokens(accessToken: string, refreshToken: string, expiry: number): void {
    const s = readSettings()
    s.youtubeAccessTokenEncrypted = encrypt(accessToken)
    if (refreshToken) s.youtubeRefreshTokenEncrypted = encrypt(refreshToken)
    s.youtubeTokenExpiry = expiry
    writeSettings(s)
  }

  getYouTubeTokens(): { accessToken: string; refreshToken: string; expiry: number } | null {
    const s = readSettings()
    const accessToken = decrypt(s.youtubeAccessTokenEncrypted)
    const refreshToken = decrypt(s.youtubeRefreshTokenEncrypted)
    if (!accessToken || !refreshToken) return null
    return { accessToken, refreshToken, expiry: s.youtubeTokenExpiry ?? 0 }
  }

  saveYouTubeChannelInfo(channelId: string, channelTitle: string): void {
    const s = readSettings()
    s.youtubeChannelId = channelId
    s.youtubeChannelTitle = channelTitle
    writeSettings(s)
  }

  clearYouTubeTokens(): void {
    const s = readSettings()
    delete s.youtubeAccessTokenEncrypted
    delete s.youtubeRefreshTokenEncrypted
    delete s.youtubeTokenExpiry
    delete s.youtubeChannelId
    delete s.youtubeChannelTitle
    writeSettings(s)
  }
}
