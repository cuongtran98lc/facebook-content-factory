import { Prisma } from '@prisma/client'
import type { IdeaDTO, SeriesDTO } from '../../shared/types'
import { getPrisma } from './database'

function toDTO(row: {
  id: string
  name: string
  pillarId: string | null
  description: string | null
  createdAt: Date
}): SeriesDTO {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

function toIdeaDTO(row: {
  id: string
  projectId: string
  title: string
  hook: string | null
  description: string | null
  score: number | null
  selected: boolean
  pillarId: string | null
  seriesId: string | null
  episodeNumber: number | null
  createdAt: Date
}): IdeaDTO {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

/** Lỗi rõ ràng cho race condition khi 2 lần bấm "tiếp tục tập" chạm cùng
 * lúc — @@unique([seriesId, episodeNumber]) ở tầng DB sẽ chặn dòng thứ 2,
 * đây chỉ là lớp dịch lỗi Prisma đó thành thông báo user hiểu được thay vì
 * để crash. Xem test CRITICAL #2 trong Test Plan. */
export class SeriesConflictError extends Error {
  constructor() {
    super('Tập này vừa được tạo bởi một thao tác khác — tải lại danh sách và thử lại.')
    this.name = 'SeriesConflictError'
  }
}

export class SeriesService {
  async list(): Promise<SeriesDTO[]> {
    const rows = await getPrisma().series.findMany({ orderBy: { createdAt: 'desc' } })
    return rows.map(toDTO)
  }

  async listEpisodes(seriesId: string): Promise<IdeaDTO[]> {
    const rows = await getPrisma().idea.findMany({
      where: { seriesId },
      orderBy: { episodeNumber: 'asc' }
    })
    return rows.map(toIdeaDTO)
  }

  /**
   * Tạo tập tiếp theo (N+1) nối từ 1 Idea đã có. Nếu Idea đó chưa thuộc
   * series nào, tự tạo Series mới và gán Idea đó thành tập 1. Prefill hook
   * của tập mới lấy từ `hook` của prevIdea — KHÔNG prefill "nhân vật/cốt
   * truyện" vì app hiện không lưu dữ liệu đó ở đâu cả (xem design doc).
   */
  async continueAsEpisode(prevIdeaId: string): Promise<IdeaDTO> {
    const prisma = getPrisma()
    const prevIdea = await prisma.idea.findUniqueOrThrow({ where: { id: prevIdeaId } })

    try {
      return await prisma.$transaction(async (tx) => {
        let seriesId = prevIdea.seriesId
        let prevEpisodeNumber = prevIdea.episodeNumber

        if (!seriesId) {
          const series = await tx.series.create({
            data: { name: prevIdea.title, pillarId: prevIdea.pillarId }
          })
          seriesId = series.id
          prevEpisodeNumber = 1
          await tx.idea.update({ where: { id: prevIdea.id }, data: { seriesId, episodeNumber: 1 } })
        }

        const nextEpisodeNumber = (prevEpisodeNumber ?? 1) + 1
        const newIdea = await tx.idea.create({
          data: {
            projectId: prevIdea.projectId,
            title: `${prevIdea.title} — Tập ${nextEpisodeNumber}`,
            hook: prevIdea.hook,
            pillarId: prevIdea.pillarId,
            seriesId,
            episodeNumber: nextEpisodeNumber
          }
        })
        return toIdeaDTO(newIdea)
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new SeriesConflictError()
      }
      throw error
    }
  }
}
