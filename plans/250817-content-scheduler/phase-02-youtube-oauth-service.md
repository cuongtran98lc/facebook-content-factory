# Phase 02 — YouTube OAuth Service

## Files to Create
- `src/main/services/youtube.ts`

## Files to Modify
- `src/main/services/settings.ts` — add YouTube credentials (OAuth tokens, client credentials)
- `src/shared/types.ts` — add YouTubeSettingsDTO, ScheduledPostDTO, etc.

## YouTube OAuth2 Flow
1. User provides OAuth2 Client ID + Client Secret (from Google Cloud Console)
2. App opens browser to Google consent URL
3. User authorizes → Google redirects to localhost callback with auth code
4. App exchanges code for access_token + refresh_token
5. Tokens stored encrypted in settings.json via safeStorage

## YouTubeService API

```typescript
class YouTubeService {
  // Auth
  getAuthUrl(): string
  exchangeCode(code: string): Promise<void>
  refreshTokenIfNeeded(): Promise<void>
  revokeAuth(): Promise<void>
  getStatus(): YouTubeAuthStatus

  // Upload (resumable for large files)
  uploadVideo(params: {
    videoPath: string
    title: string
    description: string
    privacyStatus: 'public' | 'private' | 'unlisted'
    onProgress?: (percent: number) => void
  }): Promise<{ videoId: string; url: string }>

  // Channel info
  getChannelInfo(): Promise<{ id: string; title: string; thumbnail: string }>
}
```

## Resumable Upload Strategy
- Use `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable`
- Init upload → get session URI → stream file in chunks (5MB each)
- Track progress via chunk offsets

## Settings Schema Extension (settings.json)
```json
{
  "youtube": {
    "clientId": "<plain>",
    "clientSecret": "<safeStorage encrypted>",
    "accessToken": "<safeStorage encrypted>",
    "refreshToken": "<safeStorage encrypted>",
    "tokenExpiry": 1234567890,
    "channelId": "UCxxx",
    "channelTitle": "My Channel"
  }
}
```

## New Types (shared/types.ts)
```typescript
type ScheduleStatus = 'PENDING' | 'UPLOADING' | 'DONE' | 'FAILED' | 'CANCELLED'
type PrivacyStatus = 'public' | 'private' | 'unlisted'

interface ScheduledPostDTO {
  id: string
  renderId: string
  platform: string
  status: ScheduleStatus
  scheduledAt: string | null
  uploadedAt: string | null
  youtubeVideoId: string | null
  youtubeUrl: string | null
  privacyStatus: PrivacyStatus
  titleOverride: string | null
  descOverride: string | null
  error: string | null
  // Render info
  renderType: string
  renderPath: string | null
  projectName: string
  publishTitle: string | null
  publishDescription: string | null
  createdAt: string
}

interface YouTubeAuthStatus {
  connected: boolean
  channelId: string | null
  channelTitle: string | null
  channelThumbnail: string | null
}

interface SchedulePostInput {
  renderId: string
  scheduledAt?: string // ISO date string, null = upload now
  privacyStatus?: PrivacyStatus
  titleOverride?: string
  descOverride?: string
}
```

## Todo
- [ ] Create `src/main/services/youtube.ts` with OAuth2 + resumable upload
- [ ] Extend `settings.ts` with YouTube credential storage
- [ ] Add new types to `src/shared/types.ts`
- [ ] Test OAuth flow manually
