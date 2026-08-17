import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { load } from 'cheerio'
import type { CrawlStoryInput, CrawlStoryResult, CrawlProgress, ScriptDTO } from '../../shared/types'
import { getPrisma } from './database'

const MAX_HTML_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 25_000

function loggerWarning(message: string, error: unknown): void {
  console.warn(`[story-crawler] ${message}:`, error instanceof Error ? error.message : String(error))
}

function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase().split('%')[0]
  if (normalized === '::' || normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') ||
      normalized.startsWith('2001:db8:')) return true
  if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice('::ffff:'.length))
  const parts = normalized.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) ||
    (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || parts[0] >= 224
}

async function validatePublicUrl(raw: string): Promise<URL> {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Link truyện không hợp lệ.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Link truyện chỉ hỗ trợ HTTP hoặc HTTPS.')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('Không cho phép crawl địa chỉ nội bộ.')
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Không cho phép crawl IP nội bộ.')
  } else {
    const addresses = await lookup(hostname, { all: true })
    if (!addresses.length || addresses.some(item => isPrivateIp(item.address.toLowerCase()))) throw new Error('Domain trỏ tới IP nội bộ hoặc không hợp lệ.')
  }
  return url
}

async function fetchHtml(raw: string): Promise<{ html: string; url: URL }> {
  let url = await validatePublicUrl(raw)
  for (let redirect = 0; redirect <= 5; redirect++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': 'ContentFactoryStoryCrawler/0.3 (+desktop; respectful single-user crawler)',
        Accept: 'text/html,application/xhtml+xml'
      }
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`Website redirect nhưng không trả Location (${response.status}).`)
      url = await validatePublicUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`Website trả HTTP ${response.status} tại ${url.hostname}.`)
    const type = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (type && !type.includes('text/html') && !type.includes('application/xhtml')) throw new Error('URL không trả về trang HTML.')
    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > MAX_HTML_BYTES) throw new Error('Trang HTML vượt giới hạn 5 MB.')
    if (!response.body) throw new Error('Website không trả nội dung HTML.')
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_HTML_BYTES) {
        await reader.cancel()
        throw new Error('Trang HTML vượt giới hạn 5 MB.')
      }
      chunks.push(Buffer.from(value))
    }
    const bytes = Buffer.concat(chunks, total)
    return { html: bytes.toString('utf8'), url }
  }
  throw new Error('Website redirect quá nhiều lần.')
}

async function renderDynamicHtml(raw: string): Promise<{ html: string; url: URL }> {
  const initialUrl = await validatePublicUrl(raw)
  const partition = `crawler-${randomUUID()}`
  const isolatedSession = session.fromPartition(partition, { cache: false })
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  isolatedSession.setPermissionCheckHandler(() => false)
  const hostChecks = new Map<string, Promise<boolean>>()
  let requestCount = 0
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    requestCount++
    if (requestCount > 200 || ['media', 'object', 'ping', 'webSocket'].includes(details.resourceType)) { callback({ cancel: true }); return }
    let requestUrl: URL
    try { requestUrl = new URL(details.url) } catch { callback({ cancel: true }); return }
    if (['data:', 'blob:', 'about:'].includes(requestUrl.protocol)) { callback({ cancel: false }); return }
    if (!['http:', 'https:'].includes(requestUrl.protocol)) { callback({ cancel: true }); return }
    const key = `${requestUrl.protocol}//${requestUrl.hostname}:${requestUrl.port}`
    let check = hostChecks.get(key)
    if (!check) {
      check = validatePublicUrl(requestUrl.toString()).then(() => true).catch(() => false)
      hostChecks.set(key, check)
    }
    void check.then(allowed => callback({ cancel: !allowed })).catch(() => callback({ cancel: true }))
  })

  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false
    }
  })
  window.webContents.setAudioMuted(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  try {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      window.loadURL(initialUrl.toString(), {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36 ContentFactory/0.3'
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Trang JavaScript tải quá 35 giây.')), 35_000)
      })
    ]).finally(() => { if (timer) clearTimeout(timer) })
    const started = Date.now()
    let previousSignature = ''
    let stableChecks = 0
    while (Date.now() - started < 12_000) {
      await new Promise(resolve => setTimeout(resolve, 400))
      const state = await window.webContents.executeJavaScript(`({ text: document.body?.innerText?.length || 0, anchors: document.querySelectorAll('a[href]').length })`, true) as { text: number; anchors: number }
      const signature = `${state.text}:${state.anchors}`
      stableChecks = signature === previousSignature ? stableChecks + 1 : 0
      previousSignature = signature
      if (Date.now() - started >= 2_000 && state.text >= 100 && stableChecks >= 3) break
    }
    const finalUrl = await validatePublicUrl(window.webContents.getURL())
    const html = await window.webContents.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""', true) as string
    if (!html.trim()) throw new Error('Trình duyệt đã render nhưng DOM vẫn trống.')
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('DOM sau khi render vượt giới hạn 5 MB.')
    return { html, url: finalUrl }
  } finally {
    if (!window.isDestroyed()) window.destroy()
    await isolatedSession.clearStorageData().catch(() => undefined)
    await isolatedSession.clearCache().catch(() => undefined)
  }
}

function cleanText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .filter(line => !/^(trang chủ|danh sách chương|chương trước|chương sau|next chapter|previous chapter|quảng cáo)$/i.test(line.trim()))
    .join('\n')
    .trim()
}

function pageTitle(html: string): string {
  const $ = load(html)
  return cleanText($('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text() || 'Truyện từ website').slice(0, 250)
}

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

function extractChapter(html: string, fallbackTitle: string): { title: string; content: string } {
  const $ = load(html)
  $('script,style,noscript,iframe,nav,header,footer,form,button,.ads,.advertisement,[class*="comment"],[id*="comment"],[class*="breadcrumb"]').remove()
  const selectors = [
    '#chapter-content', '.chapter-content', '.reading-content', '.content-chapter',
    '.entry-content', '.post-content', '.story-content', '.novel-content', '.book-content',
    '[id*="chapter-content"]', '[class*="chapter-content"]', '[class*="reading"]',
    '[itemprop="articleBody"]', 'article', 'main', '#content'
  ]
  let content = ''
  for (const selector of selectors) {
    const node = $(selector).first()
    if (!node.length) continue
    const clone = node.clone()
    clone.find('br').replaceWith('\n')
    clone.find('p,div,li,h2,h3').each((_index, element) => { $(element).append('\n') })
    const candidate = cleanText(clone.text())
    if (candidate.length > content.length) content = candidate
    if (content.length >= 300) break
  }
  if (content.length < 100) {
    const jsonCandidates: string[] = []
    const collect = (value: unknown, key = '', depth = 0): void => {
      if (depth > 12 || value == null) return
      if (typeof value === 'string') {
        if (/^(articleBody|chapterContent|chapter_content|content|body|text|description)$/i.test(key) && value.length >= 100) {
          const parsed = cleanText(load(`<main>${value}</main>`)('main').text())
          if (parsed.length >= 100) jsonCandidates.push(parsed)
        }
        return
      }
      if (Array.isArray(value)) return value.forEach(item => collect(item, key, depth + 1))
      if (typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => collect(child, childKey, depth + 1))
    }
    $('script[type="application/ld+json"], script#__NEXT_DATA__, script[type="application/json"]').each((_index, element) => {
      try { collect(JSON.parse($(element).text())) } catch {}
    })
    const inlineStatePatterns = [
      /__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/i,
      /__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;<\/script>/i
    ]
    for (const pattern of inlineStatePatterns) {
      const match = html.match(pattern)
      if (match) try { collect(JSON.parse(match[1])) } catch {}
    }
    jsonCandidates.sort((a, b) => b.length - a.length)
    if (jsonCandidates[0]) content = jsonCandidates[0]
  }
  const title = cleanText($('h1').first().text() || $('.chapter-title').first().text() || fallbackTitle).slice(0, 250)
  if (content.length < 100) throw new Error(`Không tìm thấy nội dung đủ dài cho “${title}”. Trang có thể cần đăng nhập hoặc render bằng JavaScript.`)
  return { title: title || fallbackTitle, content }
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
    for (const [index, chapter] of chapterLinks.entries()) {
      onProgress?.({ current: index, total: chapterLinks.length, percent: 5 + Math.round((index / chapterLinks.length) * 78), stage: 'CRAWLING', message: `Đang crawl tập ${index + 1}/${chapterLinks.length}: ${chapter.title}` })
      const page = chapter.url === detail.url.toString() ? { ...detail, html: detailHtml } : await fetchHtml(chapter.url)
      let extracted: { title: string; content: string }
      try {
        extracted = extractChapter(page.html, chapter.title)
      } catch (staticError) {
        onProgress?.({ current: index, total: chapterLinks.length, percent: 5 + Math.round((index / chapterLinks.length) * 78), stage: 'CRAWLING', message: `Tập ${index + 1}/${chapterLinks.length}: đang render JavaScript để lấy nội dung...` })
        try {
          const rendered = await renderDynamicHtml(page.url.toString())
          extracted = extractChapter(rendered.html, chapter.title)
        } catch (dynamicError) {
          const staticMessage = staticError instanceof Error ? staticError.message : String(staticError)
          const dynamicMessage = dynamicError instanceof Error ? dynamicError.message : String(dynamicError)
          throw new Error(`${staticMessage} Fallback JavaScript cũng thất bại: ${dynamicMessage}`)
        }
      }
      chapters.push({ ...extracted, sourceUrl: page.url.toString() })
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
    const parent = await prisma.script.create({
      data: { projectId: project.id, type: 'LONG_STORY', title: storyTitle, content: chapters[0].content, version: (latest?.version ?? 0) + 1, review: JSON.stringify({ sourceUrl: detail.url.toString(), crawledEpisodes: chapters.length }) }
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
