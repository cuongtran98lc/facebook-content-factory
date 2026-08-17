# Content Scheduler — Implementation Plan

**Status:** 🔄 In Progress  
**Created:** 2025-08-17  
**Goal:** Schedule và upload video đã gen lên YouTube từ trong app.

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 1 | Database Schema | ⬜ TODO | phase-01-database-schema.md |
| 2 | YouTube OAuth Service | ⬜ TODO | phase-02-youtube-oauth-service.md |
| 3 | Scheduler Service + IPC | ⬜ TODO | phase-03-scheduler-service-ipc.md |
| 4 | Scheduler UI | ⬜ TODO | phase-04-scheduler-ui.md |

## Key Dependencies
- Phase 2 depends on Phase 1 (ScheduledPost model)
- Phase 3 depends on Phase 2 (YouTubeService)
- Phase 4 depends on Phase 3 (IPC channels)

## Architecture Overview
```
SchedulerView (renderer)
  ↓ window.contentFactory.scheduler.*
IPC handlers (main/ipc/index.ts)
  ↓
SchedulerService + YouTubeService (main/services/)
  ↓
Prisma ScheduledPost model + YouTube Data API v3
```
