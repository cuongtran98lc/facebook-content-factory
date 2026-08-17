import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { open, stat } from 'node:fs/promises'
import { shell } from 'electron'
import type { SettingsService } from './settings'
import type { YouTubeAuthStatus } from '../../shared/types'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3/videos'
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const CHUNK_SIZE = 8 * 1024 * 1024 // 8MB — must be multiple of 256KB

export class YouTubeService {
  constructor(private readonly settings: SettingsService) {}

  getStatus(): YouTubeAuthStatus {
    return this.settings.getYouTubeStatus()
  }

  private buildAuthUrl(redirectUri: string, clientId: string): string {
    return `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent'
    })}`
  }

  async beginAuth(): Promise<YouTubeAuthStatus> {
    const { clientId, clientSecret } = this.settings.getYouTubeClientCredentials()
    if (!clientId || !clientSecret) throw new Error('Chưa nhập Client ID và Client Secret.')

    return new Promise((resolve, reject) => {
      let redirectUri = ''
      const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url?.startsWith('/callback')) { res.end(''); return }
        const url = new URL(req.url, 'http://127.0.0.1')
        const code = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0c0d10;color:#fff"><h1>✅ Đã kết nối YouTube!</h1><p>Quay lại app Content Factory.</p></body></html>')
        server.close()
        if (error || !code) { reject(new Error(`Lỗi OAuth: ${error ?? 'không nhận được code'}`)); return }
        try {
          await this.exchangeCode(code, redirectUri)
          resolve(this.getStatus())
        } catch (err) { reject(err) }
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number }
        redirectUri = `http://127.0.0.1:${addr.port}/callback`
        void shell.openExternal(this.buildAuthUrl(redirectUri, clientId))
      })

      setTimeout(() => { server.close(); reject(new Error('OAuth timeout sau 5 phút.')) }, 300_000)
    })
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<void> {
    const { clientId, clientSecret } = this.settings.getYouTubeClientCredentials()
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    })
    const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
    if (!res.ok || !data.access_token) throw new Error(`Google token error: ${data.error ?? res.status}`)
    const expiry = Date.now() + (data.expires_in ?? 3600) * 1000
    this.settings.saveYouTubeTokens(data.access_token, data.refresh_token ?? '', expiry)
    await this.fetchAndSaveChannel(data.access_token)
  }

  private async fetchAndSaveChannel(accessToken: string): Promise<void> {
    const res = await fetch(`${API_BASE}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const data = await res.json() as { items?: Array<{ id: string; snippet: { title: string } }> }
    const ch = data.items?.[0]
    if (ch) this.settings.saveYouTubeChannelInfo(ch.id, ch.snippet.title)
  }

  revokeAuth(): void {
    this.settings.clearYouTubeTokens()
  }

  async getValidAccessToken(): Promise<string> {
    const tokens = this.settings.getYouTubeTokens()
    if (!tokens) throw new Error('Chưa kết nối YouTube.')
    if (tokens.expiry > Date.now() + 60_000) return tokens.accessToken
    const { clientId, clientSecret } = this.settings.getYouTubeClientCredentials()
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: tokens.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' })
    })
    const data = await res.json() as { access_token?: string; expires_in?: number; error?: string }
    if (!res.ok || !data.access_token) throw new Error(`Token refresh failed: ${data.error ?? res.status}`)
    const expiry = Date.now() + (data.expires_in ?? 3600) * 1000
    this.settings.saveYouTubeTokens(data.access_token, tokens.refreshToken, expiry)
    return data.access_token
  }

  async uploadVideo(params: {
    videoPath: string
    title: string
    description: string
    privacyStatus: string
    onProgress?: (percent: number) => void
  }): Promise<{ videoId: string; url: string }> {
    const accessToken = await this.getValidAccessToken()
    const { size: fileSize } = await stat(params.videoPath)

    const initRes = await fetch(`${UPLOAD_BASE}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(fileSize)
      },
      body: JSON.stringify({
        snippet: { title: params.title, description: params.description, categoryId: '22' },
        status: { privacyStatus: params.privacyStatus, selfDeclaredMadeForKids: false }
      })
    })
    if (!initRes.ok) throw new Error(`Upload init failed: ${initRes.status} ${await initRes.text()}`)
    const sessionUri = initRes.headers.get('location')
    if (!sessionUri) throw new Error('No upload session URI from YouTube')

    const handle = await open(params.videoPath, 'r')
    try {
      let offset = 0
      while (offset < fileSize) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE - 1, fileSize - 1)
        const chunkSize = chunkEnd - offset + 1
        const buf = Buffer.alloc(chunkSize)
        await handle.read(buf, 0, chunkSize, offset)

        const res = await fetch(sessionUri, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${offset}-${chunkEnd}/${fileSize}`,
            'Content-Type': 'video/mp4'
          },
          body: buf
        })

        if (res.status === 200 || res.status === 201) {
          const data = await res.json() as { id?: string }
          if (!data.id) throw new Error('Upload completed but no video ID received')
          return { videoId: data.id, url: `https://youtu.be/${data.id}` }
        }
        if (res.status !== 308) throw new Error(`Upload chunk failed: ${res.status}`)
        const range = res.headers.get('range')
        offset = range ? parseInt(range.split('-')[1]) + 1 : offset + chunkSize
        params.onProgress?.(Math.round((offset / fileSize) * 95))
      }
    } finally {
      await handle.close()
    }
    throw new Error('Upload loop ended without completion')
  }
}
