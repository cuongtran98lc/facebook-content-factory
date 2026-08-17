# Phase 04 — Scheduler UI

## Files to Create

- `src/renderer/src/components/SchedulerView.tsx` (~180 lines)

## Files to Modify

- `src/renderer/src/pages/App.tsx` — add "Scheduler" tab to sidebar, render SchedulerView

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  📅 Content Scheduler                    [▶ Connect YouTube] │
├─────────────────────────────────────────────────────────┤
│  Filter: [All ▼]  [Platform: YouTube ▼]   Sort: [Date ▼] │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🎬 Story: "Cô bé mồ côi"  EP.1  REEL              │ │
│ │ Project: Truyện Ngắn Hay                           │ │
│ │ Title: Cô Bé Mồ Côi - Tập 1                       │ │
│ │ ⏰ Schedule: [2025-08-20] [09:00]  🔒 Private ▼   │ │
│ │                              [Upload Now] [Schedule]│ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🎬 Story: "Cô bé mồ côi"  EP.2  REEL  ✅ DONE    │ │
│ │ 📺 youtube.com/watch?v=xxxxx                       │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Component Structure

```tsx
<SchedulerView>
  <YouTubeConnectBanner /> // shown if not connected
  <FilterBar /> // All | Pending | Done | Failed
  <PostList>
    <PostCard post={post}>
      <VideoInfo /> // title, project, episode
      <ScheduleControls /> // date picker, time, privacy, buttons
      <StatusBadge /> // PENDING | UPLOADING | DONE | FAILED
      <UploadProgressBar /> // shown during upload
    </PostCard>
  </PostList>
</SchedulerView>
```

## Key Behaviors

- Load all DONE renders on mount → for each check if ScheduledPost exists
- DONE renders without a ScheduledPost → show as "unscheduled" (can create)
- Date/time picker: native HTML `<input type="datetime-local">`
- "Upload Now" → skip scheduledAt, upload immediately
- "Schedule" → save scheduledAt, status=PENDING
- Auto-refresh every 30s to pick up status changes from background scheduler
- YouTube Connect: show modal with instructions + auth URL button → user pastes auth code
- Upload progress: shown as % progress bar per card

## Sidebar Addition (App.tsx)

```tsx
// sidebar nav items
{ id: 'scheduler', icon: '📅', label: 'Scheduler' }
```

## CSS classes (styles.css)

- `.scheduler-view` — container
- `.post-card` — each video card
- `.status-badge` — colored pill (pending/uploading/done/failed)
- `.upload-progress` — progress bar inside card
- `.youtube-connect-banner` — top banner if not connected

## Todo

- [ ] Create `src/renderer/src/components/SchedulerView.tsx`
- [ ] Add Scheduler tab to sidebar in `App.tsx`
- [ ] Add CSS styles to `styles.css`
- [ ] Wire up all IPC calls via `window.contentFactory`
- [ ] Test end-to-end upload flow
