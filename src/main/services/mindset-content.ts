import type { BuildMindsetScriptInput, CrawlMindsetArticleInput, MindsetArticleDTO, MindsetScriptDraftDTO } from '../../shared/types'
import { AIService } from './ai'
import { buildMindsetScriptPrompt, MINDSET_PILLARS, MINDSET_SYSTEM_PROMPT } from './mindset-prompts'
import { extractMainContent, fetchHtml, loggerWarning, pageTitle, renderDynamicHtml } from './web-fetch'

// Ngân sách ký tự nguồn đưa vào prompt AI — đủ để nắm ý chính của một bài
// blog/article, không đẩy chi phí token lên quá cao. Không lưu quá đoạn này
// vào DB; excerpt chỉ tồn tại trong phiên làm việc trên renderer.
const MAX_EXCERPT_CHARS = 6_000
const WORDS_PER_MINUTE = 145
const VALID_PILLAR_NAMES = new Set(MINDSET_PILLARS.map(([name]) => name))

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) } catch {}
  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(cleaned.slice(objectStart, objectEnd + 1))
  throw new Error('AI output không phải JSON hợp lệ.')
}

/**
 * Crawl + AI-draft cho tab "Xây dựng nội dung Mindset". Khác với
 * StoryCrawlerService (dựng cho truyện nhiều chương, dùng thẳng văn bản
 * crawl được làm script), service này KHÔNG lưu gì vào DB: nó chỉ đọc 1
 * trang bài viết đơn và nhờ AI viết một kịch bản hoàn toàn mới lấy cảm hứng
 * từ chủ đề trang đó (xem quy tắc chống đạo văn trong mindset-prompts.ts).
 * Lưu script thật sự dùng lại `scripts.importStory` sẵn có ở renderer, y hệt
 * cách Stickman Studio lưu kịch bản đã viết — không cần thêm DB write ở đây.
 */
export class MindsetContentService {
  constructor(private readonly ai = new AIService()) {}

  async crawlArticle(input: CrawlMindsetArticleInput): Promise<MindsetArticleDTO> {
    const raw = input.url?.trim()
    if (!raw) throw new Error('Hãy nhập URL bài viết cần crawl.')
    const detail = await fetchHtml(raw)
    let html = detail.html
    let url = detail.url
    let extracted: { title: string; content: string }
    try {
      extracted = extractMainContent(html, pageTitle(html))
    } catch (staticError) {
      try {
        const rendered = await renderDynamicHtml(raw)
        html = rendered.html
        url = rendered.url
        extracted = extractMainContent(html, pageTitle(html))
      } catch (dynamicError) {
        loggerWarning('Không render được trang bằng JavaScript', dynamicError)
        const staticMessage = staticError instanceof Error ? staticError.message : String(staticError)
        const dynamicMessage = dynamicError instanceof Error ? dynamicError.message : String(dynamicError)
        throw new Error(`${staticMessage} Fallback JavaScript cũng thất bại: ${dynamicMessage}`)
      }
    }
    const excerpt = extracted.content.length > MAX_EXCERPT_CHARS
      ? `${extracted.content.slice(0, MAX_EXCERPT_CHARS)}…`
      : extracted.content
    return { sourceUrl: url.toString(), title: extracted.title, excerpt }
  }

  async draftScript(input: BuildMindsetScriptInput): Promise<MindsetScriptDraftDTO> {
    // sourceExcerpt là optional: bỏ trống để AI tự tổng hợp hoàn toàn bằng
    // kiến thức của nó (không cần crawl), xem quy tắc chống bịa đặt trong
    // mindset-prompts.ts.
    const forcedPillar = input.pillar?.trim() && VALID_PILLAR_NAMES.has(input.pillar.trim()) ? input.pillar.trim() : undefined
    const targetMinutes = Math.min(Math.max(input.targetMinutes ?? 6, 1), 20)
    const targetWords = Math.min(Math.max(Math.round(targetMinutes * WORDS_PER_MINUTE), 120), 3_000)

    const text = await this.ai.provider().generateText({
      json: true,
      system: MINDSET_SYSTEM_PROMPT,
      prompt: buildMindsetScriptPrompt({
        sourceUrl: input.sourceUrl,
        sourceTitle: input.sourceTitle,
        sourceExcerpt: input.sourceExcerpt,
        pillar: forcedPillar,
        targetMinutes,
        targetWords
      })
    })

    const parsed = extractJson(text) as Record<string, unknown>
    const title = String(parsed.title ?? '').trim()
    const content = String(parsed.content ?? '').trim()
    if (!title || !content) throw new Error('AI không trả về title/content hợp lệ; hãy thử tạo lại.')
    const pillarRaw = String(parsed.pillar ?? '').trim()
    const pillar = forcedPillar ?? (VALID_PILLAR_NAMES.has(pillarRaw) ? pillarRaw : (MINDSET_PILLARS[0]?.[0] ?? pillarRaw))

    return {
      title,
      hook: String(parsed.hook ?? '').trim(),
      pillar,
      content
    }
  }
}
