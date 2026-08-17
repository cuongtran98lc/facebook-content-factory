# Phase 03 — Scheduler Service + IPC

## Files to Create
- `src/main/services/scheduler.ts`

## Files to Modify
- `src/main/ipc/index.ts` — register new IPC channels
- `src/preload/index.ts` — expose new API
- `src/shared/types.ts` — extend ContentFactoryAPI

## SchedulerService

```typescript
class SchedulerService {
  // Called once at app startup
  start(): void   // setInterval every 60s, checks for due posts

  // CRUD
  list(): Promise<ScheduledPostDTO[]>
  schedule(input: SchedulePostInput): Promise<ScheduledPostDTO>
  update(id: string, input: Partial<SchedulePostInput>): Promise<ScheduledPostDTO>
  cancel(id: string): Promise<ScheduledPostDTO>
  remove(id: string): Promise<void>

  // Actions
  uploadNow(id: string): Promise<ScheduledPostDTO>

  // Internal
  private checkDuePosts(): Promise<void>
  private doUpload(post: ScheduledPost): Promise<void>
}
```

## IPC Channels

### scheduler namespace
| Channel | Handler |
|---------|---------|
| `scheduler:list` | schedulerService.list() |
| `scheduler:schedule` | schedulerService.schedule(input) |
| `scheduler:update` | schedulerService.update(id, input) |
| `scheduler:cancel` | schedulerService.cancel(id) |
| `scheduler:remove` | schedulerService.remove(id) |
| `scheduler:upload-now` | schedulerService.uploadNow(id) |

### youtube namespace
| Channel | Handler |
|---------|---------|
| `youtube:auth-url` | youtubeService.getAuthUrl() |
| `youtube:exchange-code` | youtubeService.exchangeCode(code) |
| `youtube:status` | youtubeService.getStatus() |
| `youtube:revoke` | youtubeService.revokeAuth() |

### Push events (renderer ← main)
| Event | Data |
|-------|------|
| `scheduler:upload-progress` | `{ postId, percent, stage }` |
| `scheduler:post-updated` | `ScheduledPostDTO` |

## ContentFactoryAPI Extension (types.ts)
```typescript
scheduler: {
  list(): Promise<ScheduledPostDTO[]>
  schedule(input: SchedulePostInput): Promise<ScheduledPostDTO>
  update(id: string, input: Partial<SchedulePostInput>): Promise<ScheduledPostDTO>
  cancel(id: string): Promise<ScheduledPostDTO>
  remove(id: string): Promise<void>
  uploadNow(id: string): Promise<ScheduledPostDTO>
  onUploadProgress(cb: (p: UploadProgress) => void): () => void
  onPostUpdated(cb: (post: ScheduledPostDTO) => void): () => void
}
youtube: {
  getAuthUrl(): Promise<string>
  exchangeCode(code: string): Promise<YouTubeAuthStatus>
  getStatus(): Promise<YouTubeAuthStatus>
  revoke(): Promise<void>
}
```

## Auto-check Logic
```
setInterval(60_000)
  → find all ScheduledPost WHERE status=PENDING AND scheduledAt <= now()
  → for each: set status=UPLOADING → doUpload() → set status=DONE/FAILED
```

## Todo
- [ ] Create `src/main/services/scheduler.ts`
- [ ] Register IPC channels in `src/main/ipc/index.ts`
- [ ] Expose API via `src/preload/index.ts`
- [ ] Extend ContentFactoryAPI in `src/shared/types.ts`
- [ ] Call `schedulerService.start()` in main `index.ts`
