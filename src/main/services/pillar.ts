import type { CreatePillarInput, PillarDTO, UpdatePillarInput } from '../../shared/types'
import { getPrisma } from './database'

function toDTO(row: {
  id: string
  name: string
  description: string | null
  colorTag: string | null
  active: boolean
  rotationIndex: number
  createdAt: Date
  updatedAt: Date
}): PillarDTO {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

/**
 * Pillar xoay vòng (chủ đề con của kênh, ví dụ 5 pillar cho kênh "Chuyện tình
 * yêu đêm khuya"). Rotation dùng round-robin theo `rotationIndex` — KHÔNG
 * dùng LRU (lastUsedAt) vì ở nhịp ~5 video/ngày đúng bằng số pillar, LRU suy
 * biến (mọi pillar chạm cùng ngày, tie-break không rõ). Xem outside-voice
 * CM#3 trong docs/designs/pillar-series-cross-platform-publishing.md.
 *
 * "Pillar dùng gần nhất" được suy ra trực tiếp từ Idea gần nhất có gắn
 * pillarId — không cần field lastUsedAt riêng: khi user chọn pillar cho 1
 * Idea (dù theo gợi ý hay tự chọn khác), Idea đó chính là tín hiệu duy nhất
 * cần thiết cho lần gợi ý tiếp theo.
 */
export class PillarService {
  async list(): Promise<PillarDTO[]> {
    const rows = await getPrisma().pillar.findMany({ orderBy: { rotationIndex: 'asc' } })
    return rows.map(toDTO)
  }

  async create(input: CreatePillarInput): Promise<PillarDTO> {
    const count = await getPrisma().pillar.count()
    const pillar = await getPrisma().pillar.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        colorTag: input.colorTag ?? null,
        rotationIndex: count
      }
    })
    return toDTO(pillar)
  }

  async update(id: string, input: UpdatePillarInput): Promise<PillarDTO> {
    const pillar = await getPrisma().pillar.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        colorTag: input.colorTag,
        active: input.active
      }
    })
    return toDTO(pillar)
  }

  async remove(id: string): Promise<void> {
    // Idea.pillarId có onDelete: SetNull — xoá pillar không làm crash Idea
    // đang trỏ tới nó (xem Failure modes trong design doc).
    await getPrisma().pillar.delete({ where: { id } })
  }

  /**
   * Pillar tiếp theo trong vòng xoay round-robin. Trả về `null` nếu không có
   * pillar nào đang active — caller (IPC/UI) PHẢI xử lý null bằng cách bỏ
   * qua gợi ý, không throw/crash màn hình tạo idea.
   */
  async getNextInRotation(): Promise<PillarDTO | null> {
    const active = await getPrisma().pillar.findMany({
      where: { active: true },
      orderBy: { rotationIndex: 'asc' }
    })
    if (active.length === 0) return null

    const lastIdeaWithPillar = await getPrisma().idea.findFirst({
      where: { pillarId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { pillar: true }
    })

    if (!lastIdeaWithPillar?.pillar) return toDTO(active[0])

    const lastIndex = active.findIndex((p) => p.id === lastIdeaWithPillar.pillar!.id)
    // Nếu pillar dùng gần nhất đã bị xoá/inactive từ đó tới giờ, lastIndex sẽ
    // là -1 — rơi về pillar đầu tiên trong vòng xoay hiện tại thay vì crash.
    const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % active.length
    return toDTO(active[nextIndex])
  }
}
