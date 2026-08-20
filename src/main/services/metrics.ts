import type { DailyMetricDTO, UpsertDailyMetricInput } from '../../shared/types'
import { getPrisma } from './database'

/** Chuẩn hoá 'YYYY-MM-DD' về UTC midnight — đảm bảo submit lại cùng 1 ngày
 * (dù múi giờ máy nào) luôn khớp đúng dòng @@unique([date]) hiện có. */
function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

function toDTO(row: {
  id: string
  date: Date
  subs: number | null
  watchHours: number | null
  shortsViews: number | null
  fbFollowers: number | null
  fbMinutesViewed: number | null
  tiktokFollowers: number | null
  tiktokViews: number | null
  winningPillarId: string | null
  notes: string | null
}): DailyMetricDTO {
  return { ...row, date: row.date.toISOString().slice(0, 10) }
}

/**
 * 1 dòng/ngày, nhập tay hoàn toàn trong tháng 1 (xem design doc — auto-tính
 * pillar thắng từ YouTube Analytics là TODO #2, chưa làm). `upsert()` LUÔN
 * dùng thay vì `create()` — submit lại cùng ngày phải cập nhật đè, không
 * được throw lỗi unique constraint ra UI (outside-voice CM#6).
 */
export class MetricsService {
  async list(days = 30): Promise<DailyMetricDTO[]> {
    const rows = await getPrisma().dailyMetric.findMany({
      orderBy: { date: 'desc' },
      take: days
    })
    // Trả về theo thứ tự cũ → mới, đúng chiều đọc của timeline 30 ngày.
    return rows.map(toDTO).reverse()
  }

  async upsert(input: UpsertDailyMetricInput): Promise<DailyMetricDTO> {
    const date = parseDate(input.date)
    const data = {
      subs: input.subs ?? null,
      watchHours: input.watchHours ?? null,
      shortsViews: input.shortsViews ?? null,
      fbFollowers: input.fbFollowers ?? null,
      fbMinutesViewed: input.fbMinutesViewed ?? null,
      tiktokFollowers: input.tiktokFollowers ?? null,
      tiktokViews: input.tiktokViews ?? null,
      winningPillarId: input.winningPillarId ?? null,
      notes: input.notes ?? null
    }
    const row = await getPrisma().dailyMetric.upsert({
      where: { date },
      create: { date, ...data },
      update: data
    })
    return toDTO(row)
  }
}
