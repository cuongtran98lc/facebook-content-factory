import { audiencePrompt } from '../../shared/audience'
import type { GenerateIdeasInput, IdeaDTO } from '../../shared/types';
import { AIService } from './ai';
import { getPrisma } from './database';
import { buildIdeasPrompt, IDEA_SYSTEM_PROMPT, IDEA_THEMES } from './story-prompts';

function toDTO(row: {
  id: string;
  projectId: string;
  title: string;
  hook: string | null;
  description: string | null;
  score: number | null;
  selected: boolean;
  pillarId: string | null;
  seriesId: string | null;
  episodeNumber: number | null;
  createdAt: Date;
}): IdeaDTO {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {}
  const firstArray = cleaned.indexOf('[');
  const lastArray = cleaned.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) return JSON.parse(cleaned.slice(firstArray, lastArray + 1));
  const firstObject = cleaned.indexOf('{');
  const lastObject = cleaned.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) return JSON.parse(cleaned.slice(firstObject, lastObject + 1));
  throw new Error('AI output không phải JSON hợp lệ.');
}

export class IdeaService {
  constructor(private readonly ai = new AIService()) {}

  async list(projectId: string): Promise<IdeaDTO[]> {
    const rows = await getPrisma().idea.findMany({
      where: { projectId },
      orderBy: [{ selected: 'desc' }, { score: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toDTO);
  }

  async generate(input: GenerateIdeasInput): Promise<IdeaDTO[]> {
    const prisma = getPrisma();
    const project = await prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
    const count = Math.min(Math.max(input.count ?? 10, 1), 30);
    const job = await prisma.job.create({
      data: { type: 'GENERATE_IDEAS', projectId: project.id, status: 'RUNNING', progress: 5 },
    });
    await prisma.project.update({ where: { id: project.id }, data: { status: 'GENERATING_IDEAS' } });

    try {
      const previousIdeas = await prisma.idea.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' }, take: 30, select: { title: true } });
      const provider = this.ai.provider();
      const text = await provider.generateText({
        json: true,
        system: IDEA_SYSTEM_PROMPT + '\n' + audiencePrompt(project),
        prompt: buildIdeasPrompt({
          count,
          previousIdeas: previousIdeas.map(idea => idea.title),
          niche: project.niche ?? 'tự chọn ngách truyện đời sống phù hợp',
          topic: project.topic ?? 'tự đề xuất theo ngách'
        }),
      });

      const parsed = extractJson(text) as { ideas?: unknown[] } | unknown[];
      const items = Array.isArray(parsed) ? parsed : parsed.ideas;
      if (!Array.isArray(items) || !items.length) throw new Error('AI không trả về danh sách idea.');

      if (items.length !== count || items.some((raw, index) => !raw || typeof raw !== 'object' || (raw as Record<string, unknown>).category !== IDEA_THEMES[index % IDEA_THEMES.length] || !String((raw as Record<string, unknown>).title ?? '').trim())) throw new Error('AI chưa trả đủ idea theo 10 nhóm yêu cầu. Hãy generate lại; idea cũ vẫn được giữ.');
      await prisma.idea.deleteMany({ where: { projectId: project.id, selected: false } });
      for (const raw of items.slice(0, count)) {
        const item = raw as Record<string, unknown>;
        const title = String(item.title ?? '').trim();
        if (!title) continue;
        const scoreValue = Number(item.score);
        await prisma.idea.create({
          data: {
            projectId: project.id,
            title,
            hook: String(item.hook ?? '').trim() || null,
            description: `NHÓM: ${item.category} || ${String(item.description ?? '').trim()}`,
            score: Number.isFinite(scoreValue) ? Math.max(1, Math.min(10, scoreValue)) : null,
          },
        });
      }

      await prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', progress: 100 } });
      await prisma.project.update({ where: { id: project.id }, data: { status: 'IDEAS_READY' } });
      return this.list(project.id);
    } catch (error) {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
      });
      await prisma.project.update({ where: { id: project.id }, data: { status: 'FAILED' } });
      throw error;
    }
  }

  async select(ideaId: string): Promise<IdeaDTO> {
    const prisma = getPrisma();
    const idea = await prisma.idea.findUniqueOrThrow({ where: { id: ideaId } });
    await prisma.$transaction([
      prisma.idea.updateMany({ where: { projectId: idea.projectId }, data: { selected: false } }),
      prisma.idea.update({ where: { id: ideaId }, data: { selected: true } }),
      prisma.project.update({ where: { id: idea.projectId }, data: { topic: idea.title, status: 'IDEAS_READY' } }),
    ]);
    const selected = await prisma.idea.findUniqueOrThrow({ where: { id: ideaId } });
    return toDTO(selected);
  }

  async assignPillar(ideaId: string, pillarId: string | null): Promise<IdeaDTO> {
    const idea = await getPrisma().idea.update({ where: { id: ideaId }, data: { pillarId } });
    return toDTO(idea);
  }
}
