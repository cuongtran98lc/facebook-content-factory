import type { GenerateIdeasInput, IdeaDTO } from '../../shared/types'
import { AIService } from './ai'
import { getPrisma } from './database'

function toDTO(row: {
  id: string
  projectId: string
  title: string
  hook: string | null
  description: string | null
  score: number | null
  selected: boolean
  createdAt: Date
}): IdeaDTO {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) } catch {}
  const firstArray = cleaned.indexOf('[')
  const lastArray = cleaned.lastIndexOf(']')
  if (firstArray >= 0 && lastArray > firstArray) return JSON.parse(cleaned.slice(firstArray, lastArray + 1))
  const firstObject = cleaned.indexOf('{')
  const lastObject = cleaned.lastIndexOf('}')
  if (firstObject >= 0 && lastObject > firstObject) return JSON.parse(cleaned.slice(firstObject, lastObject + 1))
  throw new Error('AI output không phải JSON hợp lệ.')
}

export class IdeaService {
  constructor(private readonly ai = new AIService()) {}

  async list(projectId: string): Promise<IdeaDTO[]> {
    const rows = await getPrisma().idea.findMany({ where: { projectId }, orderBy: [{ selected: 'desc' }, { score: 'desc' }, { createdAt: 'desc' }] })
    return rows.map(toDTO)
  }

  async generate(input: GenerateIdeasInput): Promise<IdeaDTO[]> {
    const prisma = getPrisma()
    const project = await prisma.project.findUniqueOrThrow({ where: { id: input.projectId } })
    const count = Math.min(Math.max(input.count ?? 10, 1), 30)
    const job = await prisma.job.create({ data: { type: 'GENERATE_IDEAS', projectId: project.id, status: 'RUNNING', progress: 5 } })
    await prisma.project.update({ where: { id: project.id }, data: { status: 'GENERATING_IDEAS' } })

    try {
      const provider = this.ai.provider()
      const text = await provider.generateText({
        json: true,
        system: 'Bạn là content strategist Facebook chuyên tạo ý tưởng video nguyên bản, có hook mạnh nhưng không giật tít sai sự thật.',
        prompt: `Tạo ${count} ý tưởng content bằng tiếng Việt cho Facebook.\nNiche: ${project.niche ?? 'general'}\nTopic gốc: ${project.topic ?? 'tự đề xuất theo niche'}\n\nTrả về JSON thuần theo cấu trúc:\n{"ideas":[{"title":"...","hook":"...","description":"...","score":8.5}]}\n\nYêu cầu score từ 1-10, ý tưởng khác nhau rõ ràng, ưu tiên storytelling và khả năng giữ người xem.`
      })

      const parsed = extractJson(text) as { ideas?: unknown[] } | unknown[]
      const items = Array.isArray(parsed) ? parsed : parsed.ideas
      if (!Array.isArray(items) || !items.length) throw new Error('AI không trả về danh sách idea.')

      await prisma.idea.deleteMany({ where: { projectId: project.id, selected: false } })
      for (const raw of items.slice(0, count)) {
        const item = raw as Record<string, unknown>
        const title = String(item.title ?? '').trim()
        if (!title) continue
        const scoreValue = Number(item.score)
        await prisma.idea.create({
          data: {
            projectId: project.id,
            title,
            hook: String(item.hook ?? '').trim() || null,
            description: String(item.description ?? '').trim() || null,
            score: Number.isFinite(scoreValue) ? Math.max(1, Math.min(10, scoreValue)) : null
          }
        })
      }

      await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', progress: 100 } })
      await prisma.project.update({ where: { id: project.id }, data: { status: 'IDEAS_READY' } })
      return this.list(project.id)
    } catch (error) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) } })
      await prisma.project.update({ where: { id: project.id }, data: { status: 'FAILED' } })
      throw error
    }
  }

  async select(ideaId: string): Promise<IdeaDTO> {
    const prisma = getPrisma()
    const idea = await prisma.idea.findUniqueOrThrow({ where: { id: ideaId } })
    await prisma.$transaction([
      prisma.idea.updateMany({ where: { projectId: idea.projectId }, data: { selected: false } }),
      prisma.idea.update({ where: { id: ideaId }, data: { selected: true } }),
      prisma.project.update({ where: { id: idea.projectId }, data: { topic: idea.title, status: 'IDEAS_READY' } })
    ])
    const selected = await prisma.idea.findUniqueOrThrow({ where: { id: ideaId } })
    return toDTO(selected)
  }
}
