import { useEffect, useState } from 'react'
import type { Platform, ScheduledPostDTO } from '../../../shared/types'

// Chỉ Facebook/TikTok — YouTube đã có tab Scheduler riêng (auto-upload).
const PLATFORMS: { key: Platform; label: string }[] = [
  { key: 'FACEBOOK', label: '📘 Facebook' },
  { key: 'TIKTOK', label: '🎵 TikTok' }
]

export function ExportQueueView() {
  const [platform, setPlatform] = useState<Platform>('FACEBOOK')
  const [posts, setPosts] = useState<ScheduledPostDTO[]>([])
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'POSTED'>('ALL')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    setPosts(await window.contentFactory.scheduler.list(platform))
  }

  useEffect(() => {
    void load()
  }, [platform])

  async function toggleReveal(path: string | null) {
    if (!path) return
    await window.contentFactory.app.revealFile(path)
  }

  async function copyMetadata(post: ScheduledPostDTO) {
    const text = `${post.publishTitle ?? '(chưa có tiêu đề)'}\n\n${post.publishDescription ?? ''}`.trim()
    await window.contentFactory.app.copyText(text)
    setMsg(`✓ Đã copy tiêu đề/mô tả của "${post.publishTitle ?? post.renderId}".`)
  }

  async function togglePosted(post: ScheduledPostDTO) {
    setBusy(post.renderId)
    try {
      const updated = post.status === 'MANUAL_POSTED'
        ? await window.contentFactory.scheduler.markManualPending(post.renderId, platform)
        : await window.contentFactory.scheduler.markManualPosted(post.renderId, platform)
      setPosts((prev) => prev.map((p) => (p.renderId === updated.renderId ? updated : p)))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const filtered = posts.filter((p) => {
    if (filter === 'ALL') return true
    if (filter === 'PENDING') return p.status !== 'MANUAL_POSTED'
    return p.status === 'MANUAL_POSTED'
  })
  const pendingCount = posts.filter((p) => p.status !== 'MANUAL_POSTED').length
  const postedCount = posts.filter((p) => p.status === 'MANUAL_POSTED').length

  return (
    <div className="export-queue-view">
      <div className="sched-filter">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            className={`secondary ${platform === p.key ? 'sched-filter-active' : ''}`}
            onClick={() => setPlatform(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <p className="tiny" style={{ margin: '4px 0 12px' }}>
        Đăng thủ công — mở app {platform === 'FACEBOOK' ? 'Facebook' : 'TikTok'}, dán tiêu đề/mô tả đã copy, chọn video từ Finder, rồi tick "đã đăng".
      </p>

      {msg && <div className="banner">{msg}</div>}

      <div className="sched-filter">
        <button className={`secondary ${filter === 'ALL' ? 'sched-filter-active' : ''}`} onClick={() => setFilter('ALL')}>Tất cả ({posts.length})</button>
        <button className={`secondary ${filter === 'PENDING' ? 'sched-filter-active' : ''}`} onClick={() => setFilter('PENDING')}>Chưa đăng ({pendingCount})</button>
        <button className={`secondary ${filter === 'POSTED' ? 'sched-filter-active' : ''}`} onClick={() => setFilter('POSTED')}>Đã đăng ({postedCount})</button>
      </div>

      <div className="sched-list">
        {!filtered.length && <div className="empty" style={{ padding: '40px 0' }}>Chưa có video nào ở trạng thái này.</div>}
        {filtered.map((post) => {
          const posted = post.status === 'MANUAL_POSTED'
          return (
            <div key={post.renderId} className="post-card card">
              <div className="post-card-top">
                <div className="post-info">
                  <span className="post-type">{post.renderType === 'STORY_VIDEO' ? '🎬 Story' : '📹 Reel'}</span>
                  <strong className="post-title">{post.publishTitle ?? '(Chưa có metadata)'}</strong>
                  <span className="post-project">{post.projectName}</span>
                </div>
                <span className="status-badge" style={{ background: posted ? '#56d58a' : '#e4ae5a' }}>
                  {posted ? '✅ Đã đăng' : '⏳ Chưa đăng'}
                </span>
              </div>

              <div className="button-row" style={{ gap: '8px', marginTop: '10px' }}>
                <button className="secondary" onClick={() => void toggleReveal(post.renderPath)}>📂 Mở trong Finder</button>
                <button className="secondary" onClick={() => void copyMetadata(post)}>📋 Copy tiêu đề/mô tả</button>
                <label className="post-posted-toggle" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="checkbox"
                    checked={posted}
                    disabled={busy === post.renderId}
                    onChange={() => void togglePosted(post)}
                  />
                  Đã đăng
                </label>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
