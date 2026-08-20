# TODOS

## Eng Review (Pillar/Series/Export Queue/Metrics)

### Setup vitest test framework

**What:** Add vitest (already available via `electron-vite`/`@vitejs/plugin-react` in devDependencies) and write tests for `PillarService`, `SeriesService`, and the `SchedulerService` platform status guard.

**Why:** Repo currently has zero automated tests — no test config, no `test` script, no test files. Two CRITICAL tests identified during `/plan-eng-review` (2026-08-20) need a framework to run: (1) seeding a `MANUAL_PENDING`/`FACEBOOK` row and asserting `checkDuePosts()` never calls `YouTubeService.uploadVideo()` — this guards against the real architecture risk found in `scheduler.ts:108` where the due-posts query has no platform branching; (2) double-triggering "tiếp tục tập" and asserting the `@@unique([seriesId, episodeNumber])` conflict surfaces a clear UI error instead of a crash.

**Context:** Deferred deliberately during the Pillar/Series/Export Queue/Metrics design review (see `docs/designs/pillar-series-cross-platform-publishing.md`) so month-1 content production wasn't blocked on test infra setup. **Update (outside-voice cross-model tension CM#4):** a minimal vitest install happens NOW as part of this feature work — just enough to run the 2 CRITICAL tests below. This TODO tracks the remaining full setup (broader config, CI wiring, tests for the rest of the new services). Full test plan (edge cases, coverage diagram) lives at `~/.gstack/projects/mac/mac-main-eng-review-test-plan-20260820-101701.md`.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Auto-compute pillar leaderboard from YouTube Analytics API

**What:** Integrate the YouTube Analytics API and join Render → Idea → Pillar to automatically rank pillars by real view/watch-time data, replacing the manual `winningPillarId` entry in `DailyMetric`.

**Why:** Manual entry (chosen for month 1) works but is subjective and adds daily data-entry friction. Once the channel has enough real performance data, an automated ranking is both more accurate and less work per day.

**Context:** Explicitly out of scope for month 1 in the Pillar/Series design (`docs/designs/pillar-series-cross-platform-publishing.md`) — verified the app currently pulls zero YouTube performance data (`youtube.ts` has no views/watchHours/Analytics references), so this needs a new OAuth scope and a Render→Idea→Pillar join that doesn't exist yet. Revisit once the channel has ~30+ days of real data to compare manual vs. automated ranking.

**Effort:** M
**Priority:** P3
**Depends on:** Pillar model must exist first (this review's Approach B)
