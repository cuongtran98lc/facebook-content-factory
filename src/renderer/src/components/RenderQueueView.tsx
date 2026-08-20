import { useEffect, useState } from 'react'
import type { RenderQueueItemDTO } from '../../../shared/types'

const STATUS_LABELS: Record<string, string> = {
  PENDING: '⏳ Đang chờ', RUNNING: '🎬 Đang render', DONE: '✅ Xong', FAILED: '❌ Lỗi'
}
const STATUS_COLORS: Record<string, string> = {
  PENDING: '#e4ae5a', RUNNING: '#7b8cff', DONE: '#56d58a', FAILED: '#e05555'
}

export function RenderQueueView() {
  const [items, setItems] = useState<RenderQueueItemDTO[]>([])
  const [msg, setMsg] = useState('')

  async function load() {
    setItems(await window.contentFactory.renderQueue.list())
  }

  useEffect(() => {
    void load()
    // Progress cập nhật trực tiếp qua jobId — không cần đợi poll để mượt.
    const unsubProgress = window.contentFactory.renderQueue.onProgress((progress) => {
      setItems((prev) => prev.map((item) => (
        item.jobId === progress.jobId ? { ...item, progress: progress.percent, status: 'RUNNING' } : item
      )))
    })
    const unsubUpdated = window.contentFactory.renderQueue.onUpdated(() => void load())
    const pollRef = setInterval(() => void load(), 5_000)
    return () => { unsubProgress(); unsubUpdated(); clearInterval(pollRef) }
  }, [])

  async function cancel(jobId: string) {
    try {
      await window.contentFactory.renderQueue.cancel(jobId)
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
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
            {item.status === 'PENDING' && (
              <div className="button-row" style={{ marginTop: '8px' }}>
                <button className="secondary" style={{ color: '#d48080' }} onClick={() => void cancel(item.jobId)}>Huỷ</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
