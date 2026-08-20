import { useEffect, useState } from 'react'
import type { DailyMetricDTO, PillarDTO, UpsertDailyMetricInput } from '../../../shared/types'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function MetricsDashboardView() {
  const [rows, setRows] = useState<DailyMetricDTO[]>([])
  const [pillars, setPillars] = useState<PillarDTO[]>([])
  const [date, setDate] = useState(todayStr())
  const [form, setForm] = useState<Record<string, string>>({})
  const [winningPillarId, setWinningPillarId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const [metricRows, pillarRows] = await Promise.all([
      window.contentFactory.metrics.list(30),
      window.contentFactory.pillars.list()
    ])
    setRows(metricRows)
    setPillars(pillarRows)
  }

  useEffect(() => {
    void load()
  }, [])

  // Khi chọn 1 ngày đã có dữ liệu, prefill form để submit lại = update đúng nghĩa.
  useEffect(() => {
    const existing = rows.find((r) => r.date === date)
    if (existing) {
      setForm({
        subs: existing.subs?.toString() ?? '',
        watchHours: existing.watchHours?.toString() ?? '',
        shortsViews: existing.shortsViews?.toString() ?? '',
        fbFollowers: existing.fbFollowers?.toString() ?? '',
        fbMinutesViewed: existing.fbMinutesViewed?.toString() ?? '',
        tiktokFollowers: existing.tiktokFollowers?.toString() ?? '',
        tiktokViews: existing.tiktokViews?.toString() ?? ''
      })
      setWinningPillarId(existing.winningPillarId ?? '')
      setNotes(existing.notes ?? '')
    } else {
      setForm({})
      setWinningPillarId('')
      setNotes('')
    }
  }, [date, rows])

  async function submit() {
    setBusy(true)
    setMsg('')
    try {
      const input: UpsertDailyMetricInput = {
        date,
        subs: numberOrUndefined(form.subs ?? ''),
        watchHours: numberOrUndefined(form.watchHours ?? ''),
        shortsViews: numberOrUndefined(form.shortsViews ?? ''),
        fbFollowers: numberOrUndefined(form.fbFollowers ?? ''),
        fbMinutesViewed: numberOrUndefined(form.fbMinutesViewed ?? ''),
        tiktokFollowers: numberOrUndefined(form.tiktokFollowers ?? ''),
        tiktokViews: numberOrUndefined(form.tiktokViews ?? ''),
        winningPillarId: winningPillarId || null,
        notes: notes.trim() || null
      }
      await window.contentFactory.metrics.upsert(input)
      await load()
      setMsg(`✓ Đã lưu chỉ số cho ngày ${date}.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const field = (key: string, label: string) => (
    <label key={key}>
      {label}
      <input
        type="number"
        value={form[key] ?? ''}
        onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
      />
    </label>
  )

  return (
    <div className="metrics-dashboard-view">
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="button-row" style={{ marginBottom: '10px' }}>
          <label>
            Ngày
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <div className="metrics-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {field('subs', 'Subscriber mới')}
          {field('watchHours', 'Giờ xem (rolling 7 ngày)')}
          {field('shortsViews', 'View Shorts')}
          {field('fbFollowers', 'Follower Facebook')}
          {field('fbMinutesViewed', 'Phút xem Facebook')}
          {field('tiktokFollowers', 'Follower TikTok')}
          {field('tiktokViews', 'View TikTok (30 ngày)')}
          <label>
            Pillar đang thắng
            <select value={winningPillarId} onChange={(e) => setWinningPillarId(e.target.value)}>
              <option value="">— chưa xác định —</option>
              {pillars.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label style={{ display: 'block', marginTop: '10px' }}>
          Ghi chú
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <div className="button-row" style={{ marginTop: '10px' }}>
          <button className="primary" onClick={() => void submit()} disabled={busy}>
            💾 Lưu chỉ số ngày {date}
          </button>
        </div>
        {msg && <div className="banner" style={{ marginTop: '10px' }}>{msg}</div>}
      </div>

      <h3>30 ngày gần nhất</h3>
      {!rows.length && <div className="empty" style={{ padding: '20px 0' }}>Chưa có dữ liệu ngày nào.</div>}
      {rows.length > 0 && (
        <div className="table-scroll" style={{ overflowX: 'auto' }}>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Ngày</th><th>Sub</th><th>Giờ xem</th><th>Shorts</th>
                <th>FB follower</th><th>FB phút</th><th>TikTok follower</th><th>TikTok view</th><th>Pillar thắng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.date === date ? 'metrics-row-active' : ''}>
                  <td>{r.date}</td>
                  <td>{r.subs ?? '—'}</td>
                  <td>{r.watchHours ?? '—'}</td>
                  <td>{r.shortsViews ?? '—'}</td>
                  <td>{r.fbFollowers ?? '—'}</td>
                  <td>{r.fbMinutesViewed ?? '—'}</td>
                  <td>{r.tiktokFollowers ?? '—'}</td>
                  <td>{r.tiktokViews ?? '—'}</td>
                  <td>{pillars.find((p) => p.id === r.winningPillarId)?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
