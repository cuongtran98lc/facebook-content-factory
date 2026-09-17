import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { load } from 'cheerio'

// SSRF-safe HTML fetching shared by every web crawler in the app (story
// chapters, single articles, ...). Keep this the ONLY place that decides
// which hosts/IPs are reachable — duplicating this logic risks drift between
// crawlers and a silent SSRF hole in whichever copy is forgotten.

export const MAX_HTML_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 25_000

function loggerWarning(message: string, error: unknown): void {
  console.warn(`[web-fetch] ${message}:`, error instanceof Error ? error.message : String(error))
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

export async function validatePublicUrl(raw: string): Promise<URL> {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Link không hợp lệ.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Link chỉ hỗ trợ HTTP hoặc HTTPS.')
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

export async function fetchHtml(raw: string): Promise<{ html: string; url: URL }> {
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

export async function renderDynamicHtml(raw: string): Promise<{ html: string; url: URL }> {
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

export function cleanText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .filter(line => !/^(trang chủ|danh sách chương|chương trước|chương sau|next chapter|previous chapter|quảng cáo)$/i.test(line.trim()))
    .join('\n')
    .trim()
}

export function pageTitle(html: string): string {
  const $ = load(html)
  return cleanText($('h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text() || 'Nội dung từ website').slice(0, 250)
}

/**
 * Generic Readability-style main-content extraction: strips chrome (nav,
 * ads, comments, related-content widgets, ...), scores candidate containers
 * by text length/paragraph density/link ratio and falls back to JSON-LD /
 * framework hydration state (__NEXT_DATA__, __NUXT__, __INITIAL_STATE__)
 * when the static DOM has no usable body. Used both for story chapters and
 * for single blog/article pages — nothing here is chapter-specific.
 */
export function extractMainContent(html: string, fallbackTitle: string): { title: string; content: string } {
  const $ = load(html)
  const title = cleanText($('h1').first().text() || $('.chapter-title').first().text() || fallbackTitle).slice(0, 250)
  $('script,style,noscript,iframe,nav,header,footer,form,button,aside,svg,canvas,' +
    '.ads,.advertisement,.sidebar,.navigation,.pagination,.pager,.toolbar,.social,.share,' +
    '[class*="advert"],[id*="advert"],[class*="comment"],[id*="comment"],' +
    '[class*="breadcrumb"],[class*="related"],[class*="recommend"],[class*="suggest"],' +
    '[class*="chapter-nav"],[class*="chap-nav"],[class*="menu"],[class*="footer"],[class*="header"]').remove()
  const selectors = [
    '#chapter-content', '.chapter-content', '.reading-content', '.content-chapter',
    '.entry-content', '.post-content', '.story-content', '.novel-content', '.book-content',
    '[id*="chapter-content"]', '[class*="chapter-content"]', '[class*="reading"]',
    '[itemprop="articleBody"]', 'article', 'main', '#content'
  ]
  const textCandidates: Array<{ text: string; score: number }> = []
  for (const [selectorIndex, selector] of selectors.entries()) {
    $(selector).each((_nodeIndex, element) => {
      const clone = $(element).clone()
      clone.find('script,style,noscript,iframe,nav,header,footer,form,button,aside,' +
        '.ads,.advertisement,.sidebar,.navigation,.pagination,.pager,.toolbar,.social,.share,' +
        '[class*="advert"],[id*="advert"],[class*="comment"],[id*="comment"],' +
        '[class*="related"],[class*="recommend"],[class*="suggest"],[class*="chapter-nav"],' +
        '[class*="chap-nav"],[class*="menu"],[class*="footer"],[class*="header"]').remove()
      clone.find('a').each((_anchorIndex, anchorElement) => {
        const anchorText = cleanText($(anchorElement).text())
        if (/^(trang chủ|mục lục|danh sách chương|chương (trước|sau|tiếp)|next chapter|previous chapter|đăng nhập|đăng ký)$/i.test(anchorText)) {
          $(anchorElement).remove()
        }
      })
      clone.find('br').replaceWith('\n')
      clone.find('p,blockquote,li,h2,h3,div').each((_index, child) => { $(child).append('\n') })
      const candidate = cleanText(clone.text())
      if (candidate.length < 100) return
      const paragraphCount = clone.find('p,blockquote').length
      const linkTextLength = cleanText(clone.find('a').text()).length
      const linkRatio = linkTextLength / Math.max(candidate.length, 1)
      const preferredSelector = selectorIndex <= 12 ? 120 : selectorIndex === 13 ? 100 : selectorIndex === 14 ? 40 : -30
      const score = preferredSelector + Math.min(candidate.length / 100, 50) + Math.min(paragraphCount, 20) - linkRatio * 100
      textCandidates.push({ text: candidate, score })
    })
  }
  textCandidates.sort((a, b) => b.score - a.score)
  let content = textCandidates[0]?.text ?? ''
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
  if (title) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    content = content.replace(new RegExp(`^${escapedTitle}\\s*`, 'i'), '').trim()
  }
  if (content.length < 100) throw new Error(`Không tìm thấy nội dung đủ dài cho “${title}”. Trang có thể cần đăng nhập hoặc render bằng JavaScript.`)
  return { title: title || fallbackTitle, content }
}

export { loggerWarning }
