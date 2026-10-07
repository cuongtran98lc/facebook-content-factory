/** Legacy story titles can use a hypothetical hook; thumbnail captions must describe the story directly. */
export function isHypotheticalThumbnailTitle(title: string): boolean {
  return /^(?:[\s"'“”‘’]*)(?:what\s*[-–—]?\s*if\b|điều gì (?:sẽ )?xảy ra nếu(?=\s|[?…,.!]|$)|nếu như(?=\s|[?…,.!]|$)|giả sử(?=\s|[?…,.!]|$))/iu.test(title)
}

export async function resolveThumbnailTitle(
  sourceTitle: string,
  content: string,
  generate: (prompt: string) => Promise<string>
): Promise<string> {
  if (!isHypotheticalThumbnailTitle(sourceTitle)) return sourceTitle.trim()
  const response = await generate([
    'Write a direct thumbnail headline describing the actual story below, not a hypothetical question.',
    'Return JSON only: {"title":"..."}. Use 3-10 words in the language of the story content (or source title if content is empty).',
    'Name the central action, subject or conflict accurately. Preserve the story meaning; do not invent facts or a resolution. Do not start with What if, Nếu như, Giả sử, or Điều gì xảy ra nếu. Do not repeat the old question or mechanically delete its prefix.',
    `SOURCE DATA: ${JSON.stringify({ sourceTitle, content })}`
  ].join('\n'))
  let parsed: unknown
  try { parsed = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('AI chưa tạo được tiêu đề thumbnail trực tiếp từ truyện. Hãy thử lại hoặc nhập tiêu đề ngắn trong ô thumbnail.') }
  const title = parsed && typeof parsed === 'object' && 'title' in parsed && typeof parsed.title === 'string' ? parsed.title.replace(/\s+/g, ' ').trim() : ''
  if (!title || title.length > 120 || isHypotheticalThumbnailTitle(title)) throw new Error('Tiêu đề thumbnail vẫn là câu giả định hoặc quá dài. Hãy thử lại hoặc nhập tiêu đề ngắn mô tả truyện.')
  return title
}
