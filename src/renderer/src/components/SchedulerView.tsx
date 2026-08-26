import { useEffect, useRef, useState } from 'react'
import type { PrivacyStatus, ScheduledPostDTO, UploadProgress, YouTubeAuthStatus, Platform } from '../../../shared/types'

const STATUS_LABELS: Record<string, string> = {
  PENDING: '⏳ Đã lên lịch',
  UPLOADING: '📤 Đang upload',
  DONE: '✅ Đã đăng',
  FAILED: '❌ Thất bại',
  CANCELLED: '🚫 Đã huỷ'
}
const STATUS_COLORS: Record<string, string> = {
  PENDING: '#e4ae5a',
  UPLOADING: '#7b8cff',
  DONE: '#56d58a',
  FAILED: '#e05555',
  CANCELLED: '#777'
}

const PLATFORMS: { key: Platform; label: string }[] = [
  { key: 'YOUTUBE', label: '📺 YouTube' },
  { key: 'FACEBOOK', label: '📘 Facebook' }
]

export function SchedulerView() {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('YOUTUBE')
  const [posts, setPosts] = useState<ScheduledPostDTO[]>([])
  
  // YouTube credentials
  const [ytStatus, setYtStatus] = useState<YouTubeAuthStatus>({ connected: false, channelId: null, channelTitle: null })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  // Facebook credentials
  const [fbStatus, setFbStatus] = useState({ connected: false, pageId: null as string | null })
  const [fbPageId, setFbPageId] = useState('')
  const [fbAccessToken, setFbAccessToken] = useState('')
  const [userAccessToken, setUserAccessToken] = useState('')
  const [fetchedPages, setFetchedPages] = useState<{ id: string; name: string; accessToken: string }[]>([])

  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'DONE' | 'FAILED'>('ALL')
  const [uploadPct, setUploadPct] = useState<Record<string, number>>({})
  const [schedDate, setSchedDate] = useState<Record<string, string>>({})
  const [privacy, setPrivacy] = useState<Record<string, PrivacyStatus>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load() {
    const [list, yt, fb] = await Promise.all([
      window.contentFactory.scheduler.list(currentPlatform),
      window.contentFactory.youtube.getStatus(),
      window.contentFactory.facebook.getStatus()
    ])
    setPosts(list)
    setYtStatus(yt)
    setFbStatus(fb)
  }

  useEffect(() => {
    void load()
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => void load(), 30_000)

    const unsubProgress = window.contentFactory.scheduler.onUploadProgress((p: UploadProgress) => {
      setUploadPct(prev => ({ ...prev, [p.renderId]: p.percent }))
      if (p.stage !== 'UPLOADING') {
        void load()
        setTimeout(() => setUploadPct(prev => {
          const n = { ...prev }
          delete n[p.renderId]
          return n
        }), 3000)
      }
    })
    const unsubUpdated = window.contentFactory.scheduler.onPostUpdated(() => void load())

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      unsubProgress()
      unsubUpdated()
    }
  }, [currentPlatform])

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) return setMsg('Hãy nhập đủ Client ID và Client Secret.')
    setBusy(true); setMsg('')
    try {
      await window.contentFactory.youtube.saveCredentials({ clientId: clientId.trim(), clientSecret: clientSecret.trim() })
      setMsg('✓ Đã lưu credentials. Bây giờ bấm Connect.')
    }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function connect() {
    setBusy(true); setMsg('Đang mở trình duyệt để xác thực YouTube...')
    try {
      const s = await window.contentFactory.youtube.beginAuth()
      setYtStatus(s)
      setMsg(`✓ Kết nối thành công: ${s.channelTitle ?? 'Channel'}`)
    }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function disconnect() {
    if (!window.confirm('Ngắt kết nối YouTube? Các scheduled post sẽ thất bại nếu chưa upload.')) return
    await window.contentFactory.youtube.revoke()
    setYtStatus({ connected: false, channelId: null, channelTitle: null })
    setMsg('Đã ngắt kết nối YouTube.')
  }

  async function saveFbCredentials() {
    if (!fbPageId.trim() || !fbAccessToken.trim()) return setMsg('Hãy nhập đủ Page ID và Access Token.')
    setBusy(true); setMsg('')
    try {
      await window.contentFactory.facebook.saveCredentials({ pageId: fbPageId.trim(), accessToken: fbAccessToken.trim() })
      setMsg('✓ Đã lưu cấu hình Facebook Page.')
      void load()
    }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function handleFetchPages() {
    if (!userAccessToken.trim()) return setMsg('Hãy nhập User Access Token.')
    setBusy(true); setMsg('Đang lấy danh sách Page từ Facebook...')
    try {
      const pages = await window.contentFactory.facebook.fetchPages(userAccessToken.trim())
      setFetchedPages(pages)
      if (pages.length === 0) {
        setMsg('Không tìm thấy Page nào. Hãy chắc chắn tài khoản của bạn quản lý Page và token có quyền pages_show_list, pages_read_engagement, pages_manage_posts.')
      } else {
        setMsg(`✓ Đã tìm thấy ${pages.length} Page. Vui lòng chọn Page bên dưới.`)
        setFbPageId(pages[0].id)
        setFbAccessToken(pages[0].accessToken)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function disconnectFb() {
    if (!window.confirm('Ngắt kết nối Facebook? Các bài đăng đã lên lịch sẽ thất bại nếu chưa upload.')) return
    await window.contentFactory.facebook.revoke()
    setFbStatus({ connected: false, pageId: null })
    setMsg('Đã ngắt kết nối Facebook Page.')
    void load()
  }

  async function schedulePost(post: ScheduledPostDTO) {
    setBusy(true); setMsg('')
    try {
      const updated = await window.contentFactory.scheduler.schedule({
        renderId: post.renderId,
        platform: currentPlatform,
        scheduledAt: schedDate[post.renderId] || null,
        privacyStatus: privacy[post.renderId] ?? 'private'
      })
      setPosts(prev => prev.map(p => p.renderId === updated.renderId ? updated : p))
      setMsg(`✓ Đã lên lịch đăng video "${updated.publishTitle ?? updated.renderId}" trên ${currentPlatform}.`)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function uploadNow(post: ScheduledPostDTO) {
    const isConnected = currentPlatform === 'FACEBOOK' ? fbStatus.connected : ytStatus.connected
    if (!isConnected) return setMsg(`Hãy kết nối ${currentPlatform === 'FACEBOOK' ? 'Facebook' : 'YouTube'} trước.`)
    setBusy(true); setMsg(`Đang bắt đầu đăng "${post.publishTitle ?? post.renderId}" lên ${currentPlatform}...`)
    try {
      const updated = await window.contentFactory.scheduler.uploadNow(post.renderId, currentPlatform)
      setPosts(prev => prev.map(p => p.renderId === updated.renderId ? updated : p))
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  async function cancelPost(post: ScheduledPostDTO) {
    if (!post.id) return
    const updated = await window.contentFactory.scheduler.cancel(post.id)
    setPosts(prev => prev.map(p => p.renderId === updated.renderId ? updated : p))
  }

  const filtered = posts.filter(p => filter === 'ALL' || (filter === 'PENDING' && (p.status === 'PENDING' || !p.status)) || p.status === filter)

  return (
    <div className="scheduler-view">
      {/* Platform selection tabs */}
      <div className="sched-platform-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {PLATFORMS.map(p => (
          <button
            key={p.key}
            type="button"
            className={`secondary ${currentPlatform === p.key ? 'sched-filter-active' : ''}`}
            onClick={() => {
              setCurrentPlatform(p.key)
              setFilter('ALL')
              setMsg('')
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Connection Header */}
      {currentPlatform === 'YOUTUBE' ? (
        <div className="scheduler-header card">
          {ytStatus.connected ? (
            <div className="yt-connected">
              <span className="dot ok" />
              <strong>YouTube: {ytStatus.channelTitle}</strong>
              <button className="secondary" onClick={() => void disconnect()}>Ngắt kết nối</button>
            </div>
          ) : (
            <details className="yt-connect-form">
              <summary>🔗 Kết nối YouTube để upload video</summary>
              <div className="yt-fields">
                <p className="yt-help">Tạo <strong>OAuth 2.0 Client ID</strong> (Desktop app) tại <a href="#" onClick={e => { e.preventDefault(); void window.contentFactory.app.openExternal('https://console.cloud.google.com/apis/credentials') }}>Google Cloud Console ↗</a> → enable YouTube Data API v3.</p>
                <div className="yt-creds">
                  <label>Client ID<input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="xxx.apps.googleusercontent.com" /></label>
                  <label>Client Secret<input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="GOCSPX-..." /></label>
                </div>
                <div className="button-row">
                  <button className="secondary" onClick={() => void saveCredentials()} disabled={busy}>Lưu credentials</button>
                  <button className="primary" onClick={() => void connect()} disabled={busy}>Connect YouTube →</button>
                </div>
              </div>
            </details>
          )}
        </div>
      ) : (
        <div className="scheduler-header card">
          {fbStatus.connected ? (
            <div className="yt-connected">
              <span className="dot ok" />
              <strong>Facebook Page ID: {fbStatus.pageId}</strong>
              <button className="secondary" onClick={() => void disconnectFb()}>Ngắt kết nối</button>
            </div>
          ) : (
            <details className="yt-connect-form" open>
              <summary>🔗 Kết nối Facebook Page để đăng video</summary>
              <div className="yt-fields">
                <div className="fb-token-generator-section" style={{ borderBottom: '1px solid #2d3139', paddingBottom: '16px', marginBottom: '16px' }}>
                  <p className="yt-help" style={{ marginBottom: '8px' }}>
                    <strong>Cách 1: Tự động lấy Page ID & Token qua User Access Token</strong>
                    <br />
                    Lấy User Token có quyền <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code> tại{' '}
                    <a href="#" onClick={e => { e.preventDefault(); void window.contentFactory.app.openExternal('https://developers.facebook.com/tools/explorer/') }}>
                      Graph API Explorer ↗
                    </a>
                  </p>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '12px', color: '#a0a8b4', display: 'block', marginBottom: '4px' }}>User Access Token</label>
                      <input
                        type="password"
                        value={userAccessToken}
                        onChange={e => setUserAccessToken(e.target.value)}
                        placeholder="Nhập User Access Token từ Graph Explorer..."
                        style={{ width: '100%', padding: '8px', background: '#1c1d22', color: '#fff', border: '1px solid #333', borderRadius: '4px' }}
                      />
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void handleFetchPages()}
                      disabled={busy || !userAccessToken.trim()}
                      style={{ padding: '8px 16px', height: '36px' }}
                    >
                      Lấy danh sách Page
                    </button>
                  </div>

                  {fetchedPages.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <label style={{ fontSize: '12px', color: '#a0a8b4', display: 'block', marginBottom: '4px' }}>Chọn Page kết nối</label>
                      <select
                        style={{ width: '100%', padding: '8px', background: '#1c1d22', color: '#fff', border: '1px solid #333', borderRadius: '4px' }}
                        value={fbPageId}
                        onChange={e => {
                          const selected = fetchedPages.find(p => p.id === e.target.value)
                          if (selected) {
                            setFbPageId(selected.id)
                            setFbAccessToken(selected.accessToken)
                          }
                        }}
                      >
                        {fetchedPages.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <p className="yt-help"><strong>Cách 2: Nhập thủ công Page ID và Page Access Token</strong></p>
                <div className="yt-creds">
                  <label>Page ID<input value={fbPageId} onChange={e => setFbPageId(e.target.value)} placeholder="Ví dụ: 1029384756..." /></label>
                  <label>Page Access Token<input type="password" value={fbAccessToken} onChange={e => setFbAccessToken(e.target.value)} placeholder="EAAGz..." /></label>
                </div>
                <div className="button-row">
                  <button className="primary" onClick={() => void saveFbCredentials()} disabled={busy}>Lưu cấu hình</button>
                </div>
              </div>
            </details>
          )}
        </div>
      )}

      {msg && <div className="banner">{msg}</div>}

      {/* Filter bar */}
      <div className="sched-filter">
        {(['ALL', 'PENDING', 'DONE', 'FAILED'] as const).map(f => (
          <button
            key={f}
            className={`secondary ${filter === f ? 'sched-filter-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'ALL'
              ? `Tất cả (${posts.length})`
              : f === 'PENDING'
                ? `Chờ đăng (${posts.filter(p => p.status === 'PENDING' || !p.status).length})`
                : f === 'DONE'
                  ? `Đã đăng (${posts.filter(p => p.status === 'DONE').length})`
                  : `Lỗi (${posts.filter(p => p.status === 'FAILED').length})`}
          </button>
        ))}
      </div>

      {/* Post list */}
      <div className="sched-list">
        {!filtered.length && <div className="empty" style={{ padding: '40px 0' }}>Chưa có video nào{filter !== 'ALL' ? ' ở trạng thái này' : '. Hãy render video trước trong tab Scripts.'}.</div>}
        {filtered.map(post => {
          const pct = uploadPct[post.renderId]
          const isUploading = post.status === 'UPLOADING' || pct !== undefined
          const isConnected = currentPlatform === 'FACEBOOK' ? fbStatus.connected : ytStatus.connected
          
          return (
            <div key={post.renderId} className="post-card card">
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

              {post.status === 'DONE' && post.youtubeUrl && (
                <div className="post-url">
                  {currentPlatform === 'FACEBOOK' ? '📘' : '📺'}{' '}
                  <a href="#" onClick={e => { e.preventDefault(); void window.contentFactory.app.openExternal(post.youtubeUrl!) }}>
                    Xem bài đăng
                  </a>
                </div>
              )}
              {post.status === 'FAILED' && post.error && <div className="post-error">❌ {post.error}</div>}

              {(!post.status || post.status === 'CANCELLED' || post.status === 'FAILED') && !isUploading && (
                <div className="post-actions">
                  <div className="post-sched-row">
                    <label>Lên lịch<input type="datetime-local" value={schedDate[post.renderId] ?? ''} onChange={e => setSchedDate(prev => ({ ...prev, [post.renderId]: e.target.value }))} /></label>
                    {currentPlatform === 'YOUTUBE' && (
                      <label>Quyền truy cập<select value={privacy[post.renderId] ?? 'private'} onChange={e => setPrivacy(prev => ({ ...prev, [post.renderId]: e.target.value as PrivacyStatus }))}><option value="private">🔒 Private</option><option value="unlisted">🔗 Unlisted</option><option value="public">🌐 Public</option></select></label>
                    )}
                  </div>
                  <div className="button-row" style={{ gap: '8px', marginTop: '10px' }}>
                    <button className="secondary" onClick={() => void schedulePost(post)} disabled={busy}>📅 Lên lịch</button>
                    <button className="primary" onClick={() => void uploadNow(post)} disabled={busy || !isConnected}>
                      {currentPlatform === 'FACEBOOK' ? '⬆ Đăng ngay' : '⬆ Upload ngay'}
                    </button>
                  </div>
                </div>
              )}

              {post.status === 'PENDING' && !isUploading && (
                <div className="post-actions">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <span style={{ color: '#a0a8b4', fontSize: '13px' }}>{post.scheduledAt ? `Sẽ upload lúc ${new Date(post.scheduledAt).toLocaleString('vi-VN')}` : 'Sẽ upload trong ≤60 giây...'}</span>
                    <div className="button-row" style={{ gap: '8px' }}>
                      <button className="secondary" onClick={() => void uploadNow(post)} disabled={busy || !isConnected}>
                        {currentPlatform === 'FACEBOOK' ? '⬆ Đăng ngay' : '⬆ Upload ngay'}
                      </button>
                      {post.id && <button className="secondary" style={{ color: '#d48080' }} onClick={() => void cancelPost(post)}>Huỷ</button>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
