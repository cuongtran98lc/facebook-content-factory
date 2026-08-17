import { useEffect, useRef, useState } from 'react'
import type { PrivacyStatus, ScheduledPostDTO, UploadProgress, YouTubeAuthStatus } from '../../../shared/types'

const STATUS_LABELS: Record<string, string> = {
  PENDING: '⏳ Đã lên lịch', UPLOADING: '📤 Đang upload',
  DONE: '✅ Đã đăng', FAILED: '❌ Thất bại', CANCELLED: '🚫 Đã huỷ'
}
const STATUS_COLORS: Record<string, string> = {
  PENDING: '#e4ae5a', UPLOADING: '#7b8cff', DONE: '#56d58a', FAILED: '#e05555', CANCELLED: '#777'
}

export function SchedulerView() {
  const [posts, setPosts] = useState<ScheduledPostDTO[]>([])
  const [ytStatus, setYtStatus] = useState<YouTubeAuthStatus>({ connected: false, channelId: null, channelTitle: null })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'DONE' | 'FAILED'>('ALL')
  const [uploadPct, setUploadPct] = useState<Record<string, number>>({})
  const [schedDate, setSchedDate] = useState<Record<string, string>>({})
  const [privacy, setPrivacy] = useState<Record<string, PrivacyStatus>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load() {
    const [list, status] = await Promise.all([window.contentFactory.scheduler.list(), window.contentFactory.youtube.getStatus()])
    setPosts(list)
    setYtStatus(status)
  }

  useEffect(() => {
    void load()
    pollRef.current = setInterval(() => void load(), 30_000)
    const unsubProgress = window.contentFactory.scheduler.onUploadProgress((p: UploadProgress) => {
      setUploadPct(prev => ({ ...prev, [p.renderId]: p.percent }))
      if (p.stage !== 'UPLOADING') { void load(); setTimeout(() => setUploadPct(prev => { const n = { ...prev }; delete n[p.renderId]; return n }), 3000) }
    })
    const unsubUpdated = window.contentFactory.scheduler.onPostUpdated(() => void load())
    return () => { if (pollRef.current) clearInterval(pollRef.current); unsubProgress(); unsubUpdated() }
  }, [])

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) return setMsg('Hãy nhập đủ Client ID và Client Secret.')
    setBusy(true); setMsg('')
    try { await window.contentFactory.youtube.saveCredentials({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }); setMsg('✓ Đã lưu credentials. Bây giờ bấm Connect.') }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function connect() {
    setBusy(true); setMsg('Đang mở trình duyệt để xác thực YouTube...')
    try { const s = await window.contentFactory.youtube.beginAuth(); setYtStatus(s); setMsg(`✓ Kết nối thành công: ${s.channelTitle ?? 'Channel'}`) }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function disconnect() {
    if (!window.confirm('Ngắt kết nối YouTube? Các scheduled post sẽ thất bại nếu chưa upload.')) return
    await window.contentFactory.youtube.revoke(); setYtStatus({ connected: false, channelId: null, channelTitle: null }); setMsg('Đã ngắt kết nối YouTube.')
  }

  async function schedulePost(post: ScheduledPostDTO) {
    setBusy(true); setMsg('')
    try {
      const updated = await window.contentFactory.scheduler.schedule({
        renderId: post.renderId,
        scheduledAt: schedDate[post.renderId] || null,
        privacyStatus: privacy[post.renderId] ?? 'private'
      })
      setPosts(prev => prev.map(p => p.renderId === updated.renderId ? updated : p))
      setMsg(`✓ Đã lên lịch upload cho video "${updated.publishTitle ?? updated.renderId}".`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function uploadNow(post: ScheduledPostDTO) {
    if (!ytStatus.connected) return setMsg('Hãy kết nối YouTube trước.')
    setBusy(true); setMsg(`Đang bắt đầu upload "${post.publishTitle ?? post.renderId}"...`)
    try {
      const updated = await window.contentFactory.scheduler.uploadNow(post.renderId)
      setPosts(prev => prev.map(p => p.renderId === updated.renderId ? updated : p))
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function cancelPost(post: ScheduledPostDTO) {
    if (!post.id) return
    const updated = await window.contentFactory.scheduler.cancel(post.id)
    setPosts(prev => prev.map(p => p.renderId === updated.renderId ? updated : p))
  }

  const filtered = posts.filter(p => filter === 'ALL' || (filter === 'PENDING' && (p.status === 'PENDING' || !p.status)) || p.status === filter)

  return <div className="scheduler-view">
    {/* YouTube connect section */}
    <div className="scheduler-header card">
      {ytStatus.connected
        ? <div className="yt-connected"><span className="dot ok" /><strong>YouTube: {ytStatus.channelTitle}</strong><button className="secondary" onClick={() => void disconnect()}>Ngắt kết nối</button></div>
        : <details className="yt-connect-form"><summary>🔗 Kết nối YouTube để upload video</summary>
            <div className="yt-fields">
              <p className="yt-help">Tạo <strong>OAuth 2.0 Client ID</strong> (Desktop app) tại <a href="#" onClick={e => { e.preventDefault(); void window.contentFactory.app.openExternal('https://console.cloud.google.com/apis/credentials') }}>Google Cloud Console ↗</a> → enable YouTube Data API v3.</p>
              <div className="yt-creds"><label>Client ID<input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="xxx.apps.googleusercontent.com" /></label><label>Client Secret<input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="GOCSPX-..." /></label></div>
              <div className="button-row"><button className="secondary" onClick={() => void saveCredentials()} disabled={busy}>Lưu credentials</button><button className="primary" onClick={() => void connect()} disabled={busy}>Connect YouTube →</button></div>
            </div>
          </details>}
    </div>

    {msg && <div className="banner">{msg}</div>}

    {/* Filter bar */}
    <div className="sched-filter">
      {(['ALL', 'PENDING', 'DONE', 'FAILED'] as const).map(f => <button key={f} className={`secondary ${filter === f ? 'sched-filter-active' : ''}`} onClick={() => setFilter(f)}>{f === 'ALL' ? `Tất cả (${posts.length})` : f === 'PENDING' ? `Chờ upload (${posts.filter(p => p.status === 'PENDING' || !p.status).length})` : f === 'DONE' ? `Đã đăng (${posts.filter(p => p.status === 'DONE').length})` : `Lỗi (${posts.filter(p => p.status === 'FAILED').length})`}</button>)}
    </div>

    {/* Post list */}
    <div className="sched-list">
      {!filtered.length && <div className="empty" style={{ padding: '40px 0' }}>Chưa có video nào{filter !== 'ALL' ? ' ở trạng thái này' : '. Hãy render video trước trong tab Scripts.'}.</div>}
      {filtered.map(post => {
        const pct = uploadPct[post.renderId]
        const isUploading = post.status === 'UPLOADING' || pct !== undefined
        return <div key={post.renderId} className="post-card card">
          <div className="post-card-top">
            <div className="post-info">
              <span className="post-type">{post.renderType === 'STORY_VIDEO' ? '🎬 Story' : '📹 Reel'}</span>
              <strong className="post-title">{post.publishTitle ?? '(Chưa có metadata)'}</strong>
              <span className="post-project">{post.projectName}</span>
            </div>
            {post.status && <span className="status-badge" style={{ background: STATUS_COLORS[post.status] ?? '#555' }}>{STATUS_LABELS[post.status] ?? post.status}</span>}
            {!post.status && <span className="status-badge" style={{ background: '#333' }}>Chưa lên lịch</span>}
          </div>

          {isUploading && <div className="upload-progress"><div className="progress-track"><i style={{ width: `${pct ?? 0}%`, background: '#7b8cff' }} /></div><span>{pct ?? 0}%</span></div>}

          {post.status === 'DONE' && post.youtubeUrl && <div className="post-url">📺 <a href="#" onClick={e => { e.preventDefault(); void window.contentFactory.app.openExternal(post.youtubeUrl!) }}>{post.youtubeUrl}</a></div>}
          {post.status === 'FAILED' && post.error && <div className="post-error">❌ {post.error}</div>}

          {(!post.status || post.status === 'CANCELLED' || post.status === 'FAILED') && !isUploading && <div className="post-actions">
            <div className="post-sched-row">
              <label>Lên lịch<input type="datetime-local" value={schedDate[post.renderId] ?? ''} onChange={e => setSchedDate(prev => ({ ...prev, [post.renderId]: e.target.value }))} /></label>
              <label>Quyền truy cập<select value={privacy[post.renderId] ?? 'private'} onChange={e => setPrivacy(prev => ({ ...prev, [post.renderId]: e.target.value as PrivacyStatus }))}><option value="private">🔒 Private</option><option value="unlisted">🔗 Unlisted</option><option value="public">🌐 Public</option></select></label>
            </div>
            <div className="button-row" style={{ gap: '8px', marginTop: '10px' }}>
              <button className="secondary" onClick={() => void schedulePost(post)} disabled={busy}>📅 Lên lịch</button>
              <button className="primary" onClick={() => void uploadNow(post)} disabled={busy || !ytStatus.connected}>⬆ Upload ngay</button>
            </div>
          </div>}

          {post.status === 'PENDING' && !isUploading && <div className="post-actions">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ color: '#a0a8b4', fontSize: '13px' }}>{post.scheduledAt ? `Sẽ upload lúc ${new Date(post.scheduledAt).toLocaleString('vi-VN')}` : 'Sẽ upload trong ≤60 giây...'}</span>
              <div className="button-row" style={{ gap: '8px' }}>
                <button className="secondary" onClick={() => void uploadNow(post)} disabled={busy || !ytStatus.connected}>⬆ Upload ngay</button>
                {post.id && <button className="secondary" style={{ color: '#d48080' }} onClick={() => void cancelPost(post)}>Huỷ</button>}
              </div>
            </div>
          </div>}
        </div>
      })}
    </div>
  </div>
}
