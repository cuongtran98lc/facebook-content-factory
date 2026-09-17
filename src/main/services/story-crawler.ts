import { load } from 'cheerio'
import type { CrawlStoryInput, CrawlStoryResult, CrawlProgress, ScriptDTO } from '../../shared/types'
import { getPrisma } from './database'
import { cleanText, extractMainContent, fetchHtml, loggerWarning, pageTitle, renderDynamicHtml, validatePublicUrl } from './web-fetch'

function discoverChapters(html: string, detailUrl: URL): Array<{ title: string; url: string }> {
  const $ = load(html)
  const candidates = new Map<string, { title: string; url: string; score: number }>()
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const title = cleanText(anchor.text()).slice(0, 250)
    const href = anchor.attr('href')?.trim()
    if (!href || !title || href.startsWith('#') || href.startsWith('javascript:')) return
    if (/^(trang|page|tiếp|sau|trước|next|previous)\s*[-:]?\s*\d*$/i.test(title)) return
    let url: URL
    try { url = new URL(href, detailUrl) } catch { return }
    if (url.origin !== detailUrl.origin || !['http:', 'https:'].includes(url.protocol)) return
    const signal = `${title} ${url.pathname}`.toLocaleLowerCase('vi')
    const parentSignal = `${anchor.parent().attr('class') || ''} ${anchor.closest('[class],[id]').attr('class') || ''} ${anchor.closest('[class],[id]').attr('id') || ''}`.toLowerCase()
    let score = 0
    if (/\b(chương|chuong|chapter|chap|tập|tap|episode)\s*[-:#.]?\s*\d+/i.test(signal)) score += 8
    else if (/chapter|chap|chuong|chương|episode/.test(signal)) score += 4
    if (/chapter|chap|chuong|list|episode|danh-sach|muc-luc/.test(parentSignal)) score += 5
    if (/đọc|doc-truyen|read/.test(signal)) score += 1
    if (score < 4) return
    url.hash = ''
    const key = url.toString()
    if (!candidates.has(key) || candidates.get(key)!.score < score) candidates.set(key, { title, url: key, score })
  })
  const rows = [...candidates.values()]
  const filtered = rows.filter(item => {
    const highScoreCount = rows.filter(row => row.score >= 7).length
    return highScoreCount < 2 || item.score >= 7
  })
  const chapterNumber = (item: { title: string; url: string }): number | null => {
    const match = `${item.title} ${item.url}`.match(/(?:chương|chuong|chapter|chap|tập|tap|episode)[-_\s/:.]*(\d+(?:\.\d+)?)/i)
    return match ? Number(match[1]) : null
  }
  const numbered = filtered.filter(item => chapterNumber(item) !== null)
  if (numbered.length >= Math.max(2, Math.ceil(filtered.length * 0.7))) {
    filtered.sort((a, b) => (chapterNumber(a) ?? Number.MAX_SAFE_INTEGER) - (chapterNumber(b) ?? Number.MAX_SAFE_INTEGER))
  }
  return filtered.map(({ title, url }) => ({ title, url }))
}

function discoverListingPages(html: string, detailUrl: URL): string[] {
  const $ = load(html)
  const urls = new Set<string>()
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')?.trim()
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
    let url: URL
    try { url = new URL(href, detailUrl) } catch { return }
    if (url.origin !== detailUrl.origin || !['http:', 'https:'].includes(url.protocol)) return
    const text = cleanText(anchor.text()).toLocaleLowerCase('vi')
    const rel = (anchor.attr('rel') || '').toLowerCase()
    const parent = `${anchor.parent().attr('class') || ''} ${anchor.closest('[class],[id]').attr('class') || ''} ${anchor.closest('[class],[id]').attr('id') || ''}`.toLowerCase()
    const address = `${url.pathname}${url.search}`.toLowerCase()
    const pagerContainer = /pagination|paging|phan-trang|page-numbers|pager/.test(parent)
    const pagedAddress = /[?&](page|paged|p)=\d+/.test(address) || /\/page\/\d+\/?$/.test(url.pathname)
    const looksLikePager = pagerContainer || pagedAddress ||
      /^(trang|page)\s*\d+$/i.test(text) ||
      (/^(tiếp|sau|trước|next|previous|›|»|‹|«)$/i.test(text) && (pagerContainer || pagedAddress)) ||
      ((rel.includes('next') || rel.includes('prev')) && (pagerContainer || pagedAddress))
    if (!looksLikePager) return
    url.hash = ''
    urls.add(url.toString())
  })
  return [...urls]
}

function discoverNextChapter(html: string, currentUrl: URL): { title: string; url: string } | null {
  const $ = load(html)
  const candidates: Array<{ title: string; url: string; score: number }> = []
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    const href = anchor.attr('href')?.trim()
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
    let url: URL
    try { url = new URL(href, currentUrl) } catch { return }
    if (url.origin !== currentUrl.origin || !['http:', 'https:'].includes(url.protocol)) return
    url.hash = ''
    const current = new URL(currentUrl.toString()); current.hash = ''
    if (url.toString() === current.toString()) return
    const title = cleanText(anchor.text()).slice(0, 250)
    const signal = `${title} ${anchor.attr('title') || ''} ${anchor.attr('aria-label') || ''}`.toLocaleLowerCase('vi')
    const rel = (anchor.attr('rel') || '').toLowerCase()
    const classes = `${anchor.attr('class') || ''} ${anchor.parent().attr('class') || ''}`.toLowerCase()
    let score = 0
    if (rel.split(/\s+/).includes('next')) score += 5
    if (/chương\s*(sau|tiếp|kế)|chuong\s*(sau|tiep|ke)|next\s*(chapter|chap)|chapter\s*next/.test(signal)) score += 10
    if (/next|chapter-next|next-chap|chuong-sau/.test(classes)) score += 4
    // A generic “next” inside the chapter navigation is useful, but a generic
    // paginator on the listing/detail page must not be mistaken for a chapter.
    if (/^(tiếp|sau|next|›|»)$/i.test(title) && /chapter|chap|chuong|reading/.test(classes)) score += 4
    if (score >= 5) candidates.push({ title: title || 'Chương tiếp theo', url: url.toString(), score })
  })
  const result = candidates.sort((a, b) => b.score - a.score)[0]
  return result ? { title: result.title, url: result.url } : null
}


function toDTO(row: { id: string; projectId: string; type: string; title: string | null; content: string; version: number; approved: boolean; score: number | null; review: string | null; sourceScriptId: string | null; createdAt: Date }): ScriptDTO {
  return { ...row, type: row.type as ScriptDTO['type'], createdAt: row.createdAt.toISOString() }
}

export class StoryCrawlerService {
  async crawl(input: CrawlStoryInput, onProgress?: (progress: CrawlProgress) => void): Promise<CrawlStoryResult> {
    const maxEpisodes = Math.min(Math.max(Math.trunc(input.maxEpisodes ?? 100), 1), 100)
    onProgress?.({ current: 0, total: maxEpisodes, percent: 2, stage: 'DISCOVERING', message: 'Đang đọc trang chi tiết và tìm danh sách chương...' })
    const detail = await fetchHtml(input.url.trim())
    let detailHtml = detail.html
    let storyTitle = pageTitle(detailHtml)
    let discovered = discoverChapters(detailHtml, detail.url)
    if (!discovered.length) {
      onProgress?.({ current: 0, total: maxEpisodes, percent: 4, stage: 'DISCOVERING', message: 'HTML tĩnh chưa có chương; đang render JavaScript trong trình duyệt an toàn...' })
      try {
        const rendered = await renderDynamicHtml(detail.url.toString())
        detailHtml = rendered.html
        storyTitle = pageTitle(detailHtml) || storyTitle
        discovered = discoverChapters(detailHtml, rendered.url)
      } catch (error) {
        loggerWarning('Không render được trang detail bằng JavaScript', error)
      }
    }
    // Many story sites paginate their chapter index. Walk those index pages
    // before crawling chapter bodies, with a conservative cap to avoid loops.
    const listingQueue = discoverListingPages(detailHtml, detail.url)
    const visitedListings = new Set<string>([detail.url.toString()])
    for (let index = 0; index < listingQueue.length && visitedListings.size <= 25 && discovered.length < maxEpisodes; index++) {
      const listingUrl = listingQueue[index]
      if (visitedListings.has(listingUrl)) continue
      visitedListings.add(listingUrl)
      onProgress?.({ current: 0, total: maxEpisodes, percent: 4, stage: 'DISCOVERING', message: `Đang đọc trang mục lục ${visitedListings.size} để tìm thêm chương...` })
      try {
        const page = await fetchHtml(listingUrl)
        for (const chapter of discoverChapters(page.html, page.url)) {
          if (!discovered.some(item => item.url === chapter.url)) discovered.push(chapter)
        }
        for (const nextPage of discoverListingPages(page.html, page.url)) {
          if (!visitedListings.has(nextPage) && !listingQueue.includes(nextPage)) listingQueue.push(nextPage)
        }
      } catch (error) {
        loggerWarning(`Không đọc được trang mục lục ${listingUrl}`, error)
      }
    }
    const detailKey = new URL(detail.url.toString())
    detailKey.hash = ''
    discovered = discovered.filter(chapter => {
      const chapterUrl = new URL(chapter.url)
      chapterUrl.hash = ''
      return chapterUrl.toString() !== detailKey.toString()
    })
    if (!discovered.length) {
      throw new Error('Không tìm thấy link chi tiết từng chương trên trang truyện. Crawler sẽ không dùng trang tổng làm một tập. Hãy kiểm tra đây có đúng là link trang danh sách truyện hay gửi URL để thêm adapter cho website này.')
    }
    const chapterLinks = discovered.slice(0, maxEpisodes)
    onProgress?.({ current: 0, total: chapterLinks.length, percent: 5, stage: 'DISCOVERING', message: `Tìm thấy ${discovered.length} chương; sẽ crawl chi tiết ${chapterLinks.length} chương theo thứ tự.` })
    const chapters: Array<{ title: string; content: string; sourceUrl: string }> = []
    for (let index = 0; index < chapterLinks.length && index < maxEpisodes; index++) {
      const chapter = chapterLinks[index]
      onProgress?.({ current: index, total: chapterLinks.length, percent: 5 + Math.round((index / chapterLinks.length) * 78), stage: 'CRAWLING', message: `Đang crawl tập ${index + 1}/${chapterLinks.length}: ${chapter.title}` })
      const page = chapter.url === detail.url.toString() ? { ...detail, html: detailHtml } : await fetchHtml(chapter.url)
      let extracted: { title: string; content: string }
      let chapterHtml = page.html
      try {
        extracted = extractMainContent(page.html, chapter.title)
      } catch (staticError) {
        onProgress?.({ current: index, total: chapterLinks.length, percent: 5 + Math.round((index / chapterLinks.length) * 78), stage: 'CRAWLING', message: `Tập ${index + 1}/${chapterLinks.length}: đang render JavaScript để lấy nội dung...` })
        try {
          const rendered = await renderDynamicHtml(page.url.toString())
          chapterHtml = rendered.html
          extracted = extractMainContent(rendered.html, chapter.title)
        } catch (dynamicError) {
          const staticMessage = staticError instanceof Error ? staticError.message : String(staticError)
          const dynamicMessage = dynamicError instanceof Error ? dynamicError.message : String(dynamicError)
          throw new Error(`${staticMessage} Fallback JavaScript cũng thất bại: ${dynamicMessage}`)
        }
      }
      chapters.push({ ...extracted, sourceUrl: page.url.toString() })
      // Some sites expose only the first/latest chapter on the detail page.
      // Continue through the chapter navigation when the index was incomplete.
      const nextChapter = discoverNextChapter(chapterHtml, page.url)
      if (nextChapter && chapterLinks.length < maxEpisodes && !chapterLinks.some(item => item.url === nextChapter.url)) {
        chapterLinks.push(nextChapter)
      }
      if (index < chapterLinks.length - 1) await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (!chapters.length) throw new Error('Không crawl được tập nào từ link này.')

    onProgress?.({ current: chapters.length, total: chapters.length, percent: 88, stage: 'SAVING', message: `Đang lưu ${chapters.length} tập vào project...` })
    const prisma = getPrisma()
    const project = await prisma.project.findUniqueOrThrow({ where: { id: input.projectId } })
    const latest = await prisma.script.findFirst({ where: { projectId: project.id, type: 'LONG_STORY' }, orderBy: { version: 'desc' } })
    await prisma.$transaction([
      prisma.script.updateMany({ where: { projectId: project.id, type: 'LONG_STORY' }, data: { approved: false } }),
      prisma.script.deleteMany({ where: { projectId: project.id, type: 'REEL' } }),
      prisma.asset.deleteMany({ where: { projectId: project.id, type: { in: ['STORY_AUDIO', 'THUMBNAIL', 'REEL_AUDIO', 'REEL_THUMBNAIL', 'VIDEO_PUBLISH_METADATA'] } } }),
      prisma.render.deleteMany({ where: { projectId: project.id, type: { in: ['STORY_VIDEO', 'REEL_VIDEO'] } } })
    ])
    // LONG_STORY is narration-ready: only chapter body text, without page or
    // chapter headings. Chapter names remain metadata on the child scripts.
    const fullStoryContent = chapters.map(chapter => chapter.content).join('\n\n')
    const parent = await prisma.script.create({
      data: { projectId: project.id, type: 'LONG_STORY', title: storyTitle, content: fullStoryContent, version: (latest?.version ?? 0) + 1, review: JSON.stringify({ sourceUrl: detail.url.toString(), crawledEpisodes: chapters.length, combinedChapterContent: true }) }
    })
    const episodes: ScriptDTO[] = []
    for (const [index, chapter] of chapters.entries()) {
      const row = await prisma.script.create({
        data: { projectId: project.id, type: 'REEL', title: chapter.title || `Tập ${index + 1}`, content: chapter.content, version: index + 1, sourceScriptId: parent.id, review: JSON.stringify({ sourceUrl: chapter.sourceUrl, importedFromWeb: true }) }
      })
      episodes.push(toDTO(row))
    }
    await prisma.project.update({ where: { id: project.id }, data: { status: 'REELS_READY' } })
    onProgress?.({ current: episodes.length, total: episodes.length, percent: 100, stage: 'DONE', message: `Hoàn tất crawl ${episodes.length} tập.` })
    return { story: toDTO(parent), episodes, sourceUrl: detail.url.toString() }
  }
}
