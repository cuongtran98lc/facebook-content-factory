import { useEffect, useState } from 'react'
import type { RenderQueueItemDTO } from '../../../shared/types'

const STATUS_LABELS: Record<string, string> = {
  PENDING: '⏳ Đang chờ', RUNNING: '🎬 Đang render', DONE: '✅ Xong', FAILED: '❌ Lỗi', CANCELED: '⛔ Đã hủy'
}
const STATUS_COLORS: Record<string, string> = {
  PENDING: '#e4ae5a', RUNNING: '#7b8cff', DONE: '#56d58a', FAILED: '#e05555', CANCELED: '#777d88'
}

export function RenderQueueView() {
  const [items, setItems] = useState<RenderQueueItemDTO[]>([])
  const [msg, setMsg] = useState('')
  const [actionJobId, setActionJobId] = useState<string | null>(null)

  async function load() {
    setItems(await window.contentFactory.renderQueue.list())
  }

  useEffect(() => {
    void load()
    // Progress cập nhật trực tiếp qua jobId — không cần đợi poll để mượt.
    const unsubProgress = window.contentFactory.renderQueue.onProgress((progress) => {
      setItems((prev) => prev.map((item) => (
        item.jobId === progress.jobId && item.status === 'RUNNING' ? { ...item, progress: progress.percent } : item
      )))
    })
    const unsubUpdated = window.contentFactory.renderQueue.onUpdated(() => void load())
    const pollRef = setInterval(() => void load(), 5_000)
    return () => { unsubProgress(); unsubUpdated(); clearInterval(pollRef) }
  }, [])

  async function cancel(jobId: string) {
    setActionJobId(jobId)
    try {
      await window.contentFactory.renderQueue.cancel(jobId)
      setMsg('✓ Đã hủy job. Bạn có thể Resume hoặc Xóa.')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setActionJobId(null)
    }
  }

  async function resume(jobId: string) {
    setActionJobId(jobId)
    try {
      await window.contentFactory.renderQueue.resume(jobId)
      setMsg('✓ Đã đưa job trở lại hàng đợi.')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setActionJobId(null)
    }
  }

  async function remove(jobId: string) {
    const item = items.find(row => row.jobId === jobId)
    const runningNote = item?.status === 'RUNNING' ? ' FFmpeg đang chạy sẽ được dừng.' : ''
    if (!window.confirm(`Xóa job này khỏi Render Queue?${runningNote} Video đã render xong (nếu có) vẫn được giữ lại.`)) return
    setActionJobId(jobId)
    try {
      await window.contentFactory.renderQueue.remove(jobId)
      setMsg('✓ Đã xóa job khỏi hàng đợi.')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setActionJobId(null)
    }
  }

  return (
    <div className="render-queue-view">
      <p className="tiny" style={{ margin: '0 0 12px' }}>
        Render chạy tuần tự trong nền (1 video/lần) — bạn có thể tiếp tục làm việc khác trong khi chờ.
      </p>
      {msg && <div className="banner">{msg}</div>}
      <div className="sched-list">
        {!items.length && <div className="empty" style={{ padding: '40px 0' }}>Chưa có video nào trong hàng đợi.</div>}
        {items.map((item) => (
          <div key={item.jobId} className="post-card card">
            <div className="post-card-top">
              <div className="post-info">
                <span className="post-type">{item.format === 'REEL' ? '📹 Reel' : '🎬 Story'}</span>
                <strong className="post-title">{item.projectName}</strong>
              </div>
              <span className="status-badge" style={{ background: STATUS_COLORS[item.status] ?? '#555' }}>
                {STATUS_LABELS[item.status] ?? item.status}
              </span>
            </div>

            {item.status === 'RUNNING' && (
              <div className="upload-progress">
                <div className="progress-track"><i style={{ width: `${item.progress}%`, background: '#7b8cff' }} /></div>
                <span>{item.progress}%</span>
              </div>
            )}
            {item.status === 'FAILED' && item.error && <div className="post-error">❌ {item.error}</div>}
            <div className="button-row" style={{ marginTop: '8px' }}>
              {['PENDING', 'RUNNING'].includes(item.status) && (
                <button className="secondary" disabled={actionJobId === item.jobId} style={{ color: '#d48080' }} onClick={() => void cancel(item.jobId)}>Hủy</button>
              )}
              {['FAILED', 'CANCELED'].includes(item.status) && (
                <button className="secondary" disabled={actionJobId === item.jobId} onClick={() => void resume(item.jobId)}>Resume</button>
              )}
              <button className="secondary" disabled={actionJobId === item.jobId} style={{ color: '#d48080' }} onClick={() => void remove(item.jobId)}>Xóa</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
