import type {
  GenerateReelsInput,
  GenerateStoryInput,
  RewriteScriptInput,
  ScriptDTO,
  ScriptType,
  UpdateScriptInput
} from '../../shared/types'
import { AIService } from './ai'
import { getPrisma } from './database'

function toDTO(row: {
  id: string
  projectId: string
  type: string
  title: string | null
  content: string
  version: number
  approved: boolean
  score: number | null
  review: string | null
  sourceScriptId: string | null
  createdAt: Date
}): ScriptDTO {
  return {
    ...row,
    type: row.type as ScriptType,
    createdAt: row.createdAt.toISOString()
  }
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) } catch {}
  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(cleaned.slice(objectStart, objectEnd + 1))
  throw new Error('AI output không phải JSON hợp lệ.')
}

export class ScriptService {
  constructor(private readonly ai = new AIService()) {}

  async list(projectId: string): Promise<ScriptDTO[]> {
    const rows = await getPrisma().script.findMany({
      where: { projectId },
      orderBy: [{ type: 'asc' }, { version: 'desc' }, { createdAt: 'desc' }]
    })
    return rows.map(toDTO)
  }

  async generateStory(input: GenerateStoryInput): Promise<ScriptDTO> {
    const prisma = getPrisma()
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
      include: { ideas: { where: { selected: true }, take: 1 } }
    })
    const idea = project.ideas[0]
    if (!idea) throw new Error('Hãy chọn một idea trước khi Generate Story.')

    const targetWords = Math.min(Math.max(input.targetWords ?? 2200, 800), 4500)
    const job = await prisma.job.create({
      data: { type: 'GENERATE_STORY', projectId: project.id, status: 'RUNNING', progress: 10 }
    })
    await prisma.project.update({ where: { id: project.id }, data: { status: 'GENERATING_SCRIPT' } })

    try {
      const provider = this.ai.provider()
      const content = await provider.generateText({
        system: [
          'Bạn là biên kịch Facebook storytelling bằng tiếng Việt.',
          'Nội dung phải nguyên bản, tự nhiên, tránh câu chữ sáo rỗng và không sao chép tác phẩm có bản quyền.',
          'Ưu tiên retention: hook sớm, xung đột rõ, diễn biến mới liên tục, twist hợp lý và kết thúc có payoff.'
        ].join(' '),
        prompt: [
          `Viết một câu chuyện dài khoảng ${targetWords} từ.`,
          `Niche: ${project.niche ?? 'general'}`,
          `Idea: ${idea.title}`,
          `Hook gợi ý: ${idea.hook ?? 'tự tạo hook mạnh'}`,
          `Mô tả: ${idea.description ?? ''}`,
          '',
          'Yêu cầu:',
          '- 2 câu đầu phải tạo tò mò.',
          '- Xung đột chính xuất hiện sớm.',
          '- Chia nhịp bằng các đoạn ngắn, phù hợp đọc TTS.',
          '- Có ít nhất một twist nhưng phải logic.',
          '- Kết thúc có cảm xúc và một bài học ngắn.',
          '- Không thêm markdown heading kiểu #, không giải thích ngoài câu chuyện.'
        ].join('\n')
      })

      const latest = await prisma.script.findFirst({
        where: { projectId: project.id, type: 'LONG_STORY' },
        orderBy: { version: 'desc' }
      })
      const row = await prisma.script.create({
        data: {
          projectId: project.id,
          type: 'LONG_STORY',
          title: idea.title,
          content: content.trim(),
          version: (latest?.version ?? 0) + 1
        }
      })
      await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', progress: 100 } })
      await prisma.project.update({ where: { id: project.id }, data: { status: 'SCRIPT_READY' } })
      return toDTO(row)
    } catch (error) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) } })
      await prisma.project.update({ where: { id: project.id }, data: { status: 'FAILED' } })
      throw error
    }
  }

  async review(scriptId: string): Promise<ScriptDTO> {
    const prisma = getPrisma()
    const script = await prisma.script.findUniqueOrThrow({ where: { id: scriptId } })
    const project = await prisma.project.findUniqueOrThrow({ where: { id: script.projectId } })
    await prisma.project.update({ where: { id: project.id }, data: { status: 'SCRIPT_REVIEW' } })

    const text = await this.ai.provider().generateText({
      json: true,
      system: 'Bạn là editor chuyên đánh giá Facebook storytelling. Chấm thực tế, không tâng bốc.',
      prompt: [
        'Đánh giá story dưới đây và trả JSON thuần:',
        '{"score":8.2,"summary":"...","strengths":["..."],"issues":["..."],"rewriteInstruction":"..."}',
        'Score 1-10 dựa trên hook, retention, logic, cảm xúc, twist và khả năng kể bằng voice.',
        '',
        script.content
      ].join('\n')
    })
    const parsed = extractJson(text) as Record<string, unknown>
    const score = Number(parsed.score)
    const normalizedScore = Number.isFinite(score) ? Math.max(1, Math.min(10, score)) : null
    const review = JSON.stringify(parsed, null, 2)
    const updated = await prisma.script.update({
      where: { id: script.id },
      data: { score: normalizedScore, review }
    })
    await prisma.project.update({ where: { id: project.id }, data: { status: 'SCRIPT_READY' } })
    return toDTO(updated)
  }

  async rewrite(input: RewriteScriptInput): Promise<ScriptDTO> {
    const prisma = getPrisma()
    const script = await prisma.script.findUniqueOrThrow({ where: { id: input.scriptId } })
    if (script.type !== 'LONG_STORY') throw new Error('Rewrite hiện chỉ áp dụng cho LONG_STORY.')

    let reviewInstruction = input.instruction?.trim() ?? ''
    if (!reviewInstruction && script.review) {
      try {
        const review = JSON.parse(script.review) as Record<string, unknown>
        reviewInstruction = String(review.rewriteInstruction ?? '')
      } catch {}
    }
    if (!reviewInstruction) reviewInstruction = 'Tăng sức mạnh hook, retention và logic nhưng giữ nguyên tinh thần câu chuyện.'

    const rewritten = await this.ai.provider().generateText({
      system: 'Bạn là senior editor. Viết lại toàn bộ story theo feedback, giữ tiếng Việt tự nhiên và chỉ trả nội dung story hoàn chỉnh.',
      prompt: `Feedback:\n${reviewInstruction}\n\nSTORY HIỆN TẠI:\n${script.content}`
    })

    const latest = await prisma.script.findFirst({
      where: { projectId: script.projectId, type: 'LONG_STORY' },
      orderBy: { version: 'desc' }
    })
    await prisma.script.updateMany({ where: { projectId: script.projectId, type: 'LONG_STORY' }, data: { approved: false } })
    const row = await prisma.script.create({
      data: {
        projectId: script.projectId,
        type: 'LONG_STORY',
        title: script.title,
        content: rewritten.trim(),
        version: (latest?.version ?? script.version) + 1,
        sourceScriptId: script.id
      }
    })
    await prisma.project.update({ where: { id: script.projectId }, data: { status: 'SCRIPT_READY' } })
    return toDTO(row)
  }

  async update(input: UpdateScriptInput): Promise<ScriptDTO> {
    const row = await getPrisma().script.update({
      where: { id: input.scriptId },
      data: { title: input.title?.trim() || undefined, content: input.content.trim() }
    })
    return toDTO(row)
  }

  async approve(scriptId: string): Promise<ScriptDTO> {
    const prisma = getPrisma()
    const script = await prisma.script.findUniqueOrThrow({ where: { id: scriptId }, include: { project: true } })
    if (script.type !== 'LONG_STORY') throw new Error('Chỉ approve LONG_STORY ở v0.3.')
    if (!script.project.voiceId) throw new Error('Hãy test và chọn giọng đọc trước khi approve story.')
    await prisma.$transaction([
      prisma.script.updateMany({ where: { projectId: script.projectId, type: 'LONG_STORY' }, data: { approved: false } }),
      prisma.script.update({ where: { id: script.id }, data: { approved: true } }),
      prisma.project.update({ where: { id: script.projectId }, data: { status: 'SCRIPT_READY' } })
    ])
    return toDTO(await prisma.script.findUniqueOrThrow({ where: { id: script.id } }))
  }

  async generateReels(input: GenerateReelsInput): Promise<ScriptDTO[]> {
    const prisma = getPrisma()
    const count = Math.min(Math.max(input.count ?? 5, 1), 10)
    const story = await prisma.script.findFirst({
      where: { projectId: input.projectId, type: 'LONG_STORY', approved: true },
      orderBy: { version: 'desc' }
    })
    if (!story) throw new Error('Hãy Approve một LONG_STORY trước khi Generate Reels.')

    await prisma.project.update({ where: { id: input.projectId }, data: { status: 'GENERATING_REELS' } })
    try {
      const text = await this.ai.provider().generateText({
        json: true,
        system: 'Bạn là editor chuyên cắt Facebook Reel từ long-form storytelling. Mỗi reel phải đứng độc lập và có hook ngay lập tức.',
        prompt: [
          `Tạo ${count} Reel scripts khác nhau từ story dưới đây.`,
          'Trả JSON thuần: {"reels":[{"title":"...","hook":"...","content":"..."}]}',
          'Mỗi reel khoảng 130-260 từ, đọc được trong khoảng 45-100 giây tùy tốc độ voice.',
          'Không dùng CTA ép tương tác. Không viết "phần 1/phần 2" nếu reel không tự đứng độc lập.',
          '',
          story.content
        ].join('\n')
      })
      const parsed = extractJson(text) as { reels?: unknown[] } | unknown[]
      const reels = Array.isArray(parsed) ? parsed : parsed.reels
      if (!Array.isArray(reels) || reels.length === 0) throw new Error('AI không trả về reels hợp lệ.')

      await prisma.script.deleteMany({ where: { projectId: input.projectId, type: 'REEL' } })
      const created: ScriptDTO[] = []
      for (const [index, raw] of reels.slice(0, count).entries()) {
        const item = raw as Record<string, unknown>
        const body = String(item.content ?? '').trim()
        if (!body) continue
        const hook = String(item.hook ?? '').trim()
        const content = hook && !body.startsWith(hook) ? `${hook}\n\n${body}` : body
        const row = await prisma.script.create({
          data: {
            projectId: input.projectId,
            type: 'REEL',
            title: String(item.title ?? `Reel ${index + 1}`).trim(),
            content,
            version: index + 1,
            sourceScriptId: story.id
          }
        })
        created.push(toDTO(row))
      }
      await prisma.project.update({ where: { id: input.projectId }, data: { status: 'REELS_READY' } })
      return created
    } catch (error) {
      await prisma.project.update({ where: { id: input.projectId }, data: { status: 'FAILED' } })
      throw error
    }
  }
}
