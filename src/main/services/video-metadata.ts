import { AIService } from './ai'

export type PublishMode =
  | 'STORY_LONG_16_9'
  | 'STORY_SHORT_9_16'
  | 'REEL_SHORT_9_16'
  | 'STORY_LONG_1_1'

export interface PublishTarget {
  key: string
  mode: PublishMode
  storyTitle: string
  content: string
  part?: number
  totalParts?: number
}

export interface PublishMetadata {
  key: string
  title: string
  description: string
  source: 'AI' | 'FALLBACK'
  provider: string | null
}

interface PreparedTarget {
  index: number
  requestKey: string
  target: PublishTarget
  context: string
}

const MAX_CONTEXT_CHARS = 9_000
const MAX_BATCH_CONTEXT_CHARS = 36_000
const MAX_BATCH_TARGETS = 6
const MAX_TITLE_CHARS = 100

const SYSTEM_PROMPT = [
  'Bạn là biên tập viên metadata video tiếng Việt cho YouTube và Facebook.',
  'Viết đúng nội dung được cung cấp, không bịa tình tiết, không tiết lộ twist hoặc kết thúc, không clickbait sai sự thật và không viết toàn bộ bằng chữ hoa.',
  'Chỉ trả JSON hợp lệ, không markdown và không giải thích thêm.'
].join(' ')

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanInline(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`*_]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanDescription(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/```(?:json)?/gi, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function clipAtWord(value: string, maxChars: number): string {
  const characters = Array.from(value)
  if (characters.length <= maxChars) return value
  const clipped = characters.slice(0, Math.max(1, maxChars - 1)).join('').trimEnd()
  const wordBoundary = clipped.replace(/\s+\S*$/, '').trimEnd()
  return `${wordBoundary || clipped}…`
}

function compactContext(content: unknown): string {
  const clean = String(content ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (clean.length <= MAX_CONTEXT_CHARS) return clean

  const separator = '\n[…]\n'
  const available = MAX_CONTEXT_CHARS - separator.length * 2
  const headLength = Math.floor(available * 0.44)
  const middleLength = Math.floor(available * 0.2)
  const tailLength = available - headLength - middleLength
  const middleStart = Math.max(headLength, Math.floor((clean.length - middleLength) / 2))
  return [
    clean.slice(0, headLength).trimEnd(),
    clean.slice(middleStart, middleStart + middleLength).trim(),
    clean.slice(-tailLength).trimStart()
  ].join(separator)
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {}

  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(cleaned.slice(objectStart, objectEnd + 1))
    } catch {}
  }

  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
  }
  throw new Error('AI output khong phai JSON hop le.')
}

function parsedItems(value: unknown): Record<string, unknown>[] {
  const items = Array.isArray(value) ? value : isRecord(value) ? value.items : null
  return Array.isArray(items) ? items.filter(isRecord) : []
}

function partSuffix(target: PublishTarget): string {
  if (target.mode !== 'STORY_SHORT_9_16' && target.mode !== 'REEL_SHORT_9_16') return ''
  const part = Number(target.part)
  if (!Number.isFinite(part) || part < 1) return ''
  const total = Number(target.totalParts)
  const label = target.mode === 'STORY_SHORT_9_16' ? 'Phần' : 'Tập'
  return Number.isFinite(total) && total >= part
    ? ` — ${label} ${Math.floor(part)}/${Math.floor(total)}`
    : ` — ${label} ${Math.floor(part)}`
}

function titleWithSuffix(title: string, suffix: string): string {
  if (!suffix) return clipAtWord(title, MAX_TITLE_CHARS)
  const withoutWrongPart = title
    .replace(/\b(?:tập|phần)\s*\d+(?:\s*\/\s*\d+)?\b/giu, ' ')
    .replace(/^[\s:|—–-]+|[\s:|—–-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Chuyện chưa kể'
  const suffixLength = Array.from(suffix).length
  return `${clipAtWord(withoutWrongPart, Math.max(8, MAX_TITLE_CHARS - suffixLength))}${suffix}`
}

function fallbackTitle(target: PublishTarget): string {
  let base = cleanInline(target.storyTitle) || 'Chuyện chưa kể'
  if (Array.from(base).length < 8) base = `Câu chuyện ${base}`
  return titleWithSuffix(base, partSuffix(target))
}

function contentExcerpt(content: string, maxChars: number): string {
  const clean = cleanInline(content)
  if (!clean) return ''
  return clipAtWord(clean, maxChars)
}

function fallbackDescription(target: PublishTarget, title: string): string {
  const isShort = target.mode === 'STORY_SHORT_9_16' || target.mode === 'REEL_SHORT_9_16'
  const excerpt = contentExcerpt(target.content, isShort ? 220 : 560)
  const displayTitle = clipAtWord(cleanInline(target.storyTitle) || title, 140)
  if (isShort) {
    const part = Number(target.part)
    const total = Number(target.totalParts)
    const partLabel = target.mode === 'STORY_SHORT_9_16' ? 'Phần' : 'Tập'
    const episodeLine = Number.isFinite(part) && part >= 1
      ? `${partLabel} ${Math.floor(part)}${Number.isFinite(total) && total >= part ? `/${Math.floor(total)}` : ''} của câu chuyện “${displayTitle}”.`
      : `Một video ngắn từ câu chuyện “${displayTitle}”.`
    return normalizeDescription(target, [
      excerpt || `Một diễn biến đáng chú ý trong câu chuyện “${displayTitle}”.`,
      episodeLine,
      '#Shorts #TruyenNgan #KeChuyen'
    ].join('\n\n'))
  }

  return normalizeDescription(target, [
    `Cùng theo dõi câu chuyện “${displayTitle}”.`,
    excerpt || 'Một câu chuyện tiếng Việt với những diễn biến, lựa chọn và cảm xúc đáng suy ngẫm.',
    '#Truyen #KeChuyen #Story'
  ].join('\n\n'))
}

function descriptionLimit(mode: PublishMode): number {
  return mode === 'STORY_LONG_16_9' ? 900 : mode === 'STORY_LONG_1_1' ? 800 : mode === 'REEL_SHORT_9_16' ? 320 : 450
}

function normalizeDescription(target: PublishTarget, value: string): string {
  const description = cleanDescription(value)
  const hashtagPattern = /#[\p{L}\p{N}_]+/gu
  const defaults = target.mode === 'STORY_SHORT_9_16' || target.mode === 'REEL_SHORT_9_16'
    ? ['#Shorts', '#TruyenNgan', '#KeChuyen']
    : ['#Truyen', '#KeChuyen', '#Story']
  const hashtags: string[] = []
  for (const hashtag of description.match(hashtagPattern) ?? []) {
    if (Array.from(hashtag).length > 50) continue
    if (!hashtags.some(value => value.toLocaleLowerCase() === hashtag.toLocaleLowerCase())) hashtags.push(hashtag)
    if (hashtags.length === 3) break
  }
  for (const hashtag of defaults) {
    if (hashtags.length === 3) break
    if (!hashtags.some(value => value.toLocaleLowerCase() === hashtag.toLocaleLowerCase())) hashtags.push(hashtag)
  }
  const suffix = hashtags.join(' ')
  const limit = descriptionLimit(target.mode)
  const body = description.replace(hashtagPattern, '').replace(/\n{3,}/g, '\n\n').trim()
  const clippedBody = clipAtWord(body, Math.max(40, limit - Array.from(suffix).length - 2))
  return `${clippedBody}\n\n${suffix}`.trim()
}

function fallbackMetadata(target: PublishTarget, provider: string | null): PublishMetadata {
  const title = fallbackTitle(target)
  return {
    key: String(target.key ?? ''),
    title,
    description: fallbackDescription(target, title),
    source: 'FALLBACK',
    provider
  }
}

function normalizeAIItem(target: PublishTarget, item: Record<string, unknown>, provider: string): PublishMetadata | null {
  let title = cleanInline(item.title).replace(/^['"“”]+|['"“”]+$/g, '').trim()
  let description = cleanDescription(item.description)
  if (Array.from(title).length < 8 || Array.from(description).length < 40) return null

  title = titleWithSuffix(title, partSuffix(target))
  description = normalizeDescription(target, description)

  return {
    key: String(target.key ?? ''),
    title,
    description,
    source: 'AI',
    provider
  }
}

function buildPrompt(batch: PreparedTarget[]): string {
  const data = batch.map(({ requestKey, target, context }) => ({
    key: requestKey,
    mode: target.mode,
    storyTitle: clipAtWord(cleanInline(target.storyTitle) || 'Chuyện chưa kể', 180),
    part: Number.isFinite(Number(target.part)) ? Math.floor(Number(target.part)) : null,
    totalParts: Number.isFinite(Number(target.totalParts)) ? Math.floor(Number(target.totalParts)) : null,
    content: context
  }))

  return [
    'Tạo title và description riêng cho từng video trong DỮ LIỆU.',
    '',
    'Quy tắc:',
    '- STORY_LONG_16_9: title 55–80 ký tự; description 450–900 ký tự, 2–3 đoạn, nêu tiền đề nhưng không spoil.',
    '- STORY_SHORT_9_16: title 45–75 ký tự và phải có “Phần {part}/{totalParts}” khi có số phần; description 220–450 ký tự.',
    '- REEL_SHORT_9_16: title 35–70 ký tự và phải có số tập khi được cung cấp; description 140–320 ký tự.',
    '- STORY_LONG_1_1: title 50–75 ký tự; description 350–800 ký tự, phù hợp video vuông dài.',
    '- Mọi title tối đa tuyệt đối 100 ký tự, tự nhiên, không lặp nguyên câu hook và không thêm nhãn tỷ lệ khung hình.',
    '- Description kết thúc bằng đúng 3 hashtag liên quan; chỉ dùng #Shorts cho video SHORT 9:16.',
    '- Mỗi item phải khác nhau và phản ánh đúng nội dung của chính item đó.',
    '- Trả đủ đúng một item cho mỗi key đầu vào và giữ nguyên key.',
    '',
    'Trả đúng schema JSON:',
    '{"items":[{"key":"item-1","title":"...","description":"..."}]}',
    '',
    `DỮ LIỆU:\n${JSON.stringify(data)}`
  ].join('\n')
}

function makeBatches(prepared: PreparedTarget[]): PreparedTarget[][] {
  const batches: PreparedTarget[][] = []
  let current: PreparedTarget[] = []
  let currentChars = 0
  for (const item of prepared) {
    if (current.length && (current.length >= MAX_BATCH_TARGETS || currentChars + item.context.length > MAX_BATCH_CONTEXT_CHARS)) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(item)
    currentChars += item.context.length
  }
  if (current.length) batches.push(current)
  return batches
}

export class PublishingMetadataService {
  constructor(private readonly ai = new AIService()) {}

  async generate(targets: PublishTarget[]): Promise<PublishMetadata[]> {
    if (!targets.length) return []

    let provider: ReturnType<AIService['provider']>
    try {
      provider = this.ai.provider()
    } catch {
      return targets.map(target => fallbackMetadata(target, null))
    }

    const prepared = targets.map((target, index): PreparedTarget => ({
      index,
      requestKey: `item-${index + 1}`,
      target,
      context: compactContext(target.content)
    }))
    const results: Array<PublishMetadata | undefined> = new Array(targets.length)

    for (const batch of makeBatches(prepared)) {
      try {
        const response = await provider.generateText({
          json: true,
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(batch)
        })
        const items = parsedItems(parseJson(response))
        const itemsByKey = new Map<string, Record<string, unknown>>()
        for (const item of items) {
          const key = cleanInline(item.key)
          if (key && !itemsByKey.has(key)) itemsByKey.set(key, item)
        }

        for (const preparedTarget of batch) {
          const item = itemsByKey.get(preparedTarget.requestKey) ?? itemsByKey.get(String(preparedTarget.target.key ?? ''))
          results[preparedTarget.index] = item
            ? normalizeAIItem(preparedTarget.target, item, provider.name) ?? fallbackMetadata(preparedTarget.target, provider.name)
            : fallbackMetadata(preparedTarget.target, provider.name)
        }
      } catch {
        for (const preparedTarget of batch) {
          results[preparedTarget.index] = fallbackMetadata(preparedTarget.target, provider.name)
        }
      }
    }

    return targets.map((target, index) => results[index] ?? fallbackMetadata(target, provider.name))
  }
}
