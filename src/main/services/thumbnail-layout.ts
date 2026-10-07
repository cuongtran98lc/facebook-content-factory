import { DEFAULT_THUMBNAIL_DESIGN, THUMBNAIL_ACCENTS, type ThumbnailDesign } from './thumbnail-scene'
import sharp from 'sharp'

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

function titleLines(title: string): string[] {
  const text = title.replace(/\s+/g, ' ').trim().toLocaleUpperCase() || 'CÂU CHUYỆN CHƯA KỂ'
  const words = text.split(' ')
  if (text.length <= 32) return [text]
  let split = 1
  let distance = Infinity
  for (let i = 1; i < words.length; i++) {
    const delta = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length)
    if (delta < distance) { distance = delta; split = i }
  }
  return words.length === 1 ? [text] : [words.slice(0, split).join(' '), words.slice(split).join(' ')]
}

/** Headlines occupy reserved top/bottom margins, leaving the illustration at full size. */
export async function composeThumbnail(bytes: Buffer, title: string, includeText: boolean, design: ThumbnailDesign = DEFAULT_THUMBNAIL_DESIGN): Promise<Buffer> {
  const base = sharp(bytes).rotate().resize(1280, 720, { fit: 'cover' })
  if (!includeText) return base.png().toBuffer()
  const accent = THUMBNAIL_ACCENTS[design.accent]
  const lines = titleLines(title)
  const fontSize = Math.max(24, Math.min(lines.length === 1 ? 112 : 78, Math.floor(1180 / (Math.max(...lines.map(line => Array.from(line).length)) * .7))))
  const subtitle = design.subtitle.toLocaleUpperCase()
  const subtitleSize = Math.max(22, Math.min(48, Math.floor(1140 / (Math.max(1, subtitle.length) * .7))))
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <defs>
      <linearGradient id="top" x2="0" y2="1"><stop stop-color="#101518" stop-opacity=".9"/><stop offset="1" stop-color="#101518" stop-opacity="0"/></linearGradient>
      <linearGradient id="bottom" x2="0" y2="1"><stop stop-color="#101518" stop-opacity="0"/><stop offset="1" stop-color="#101518" stop-opacity=".85"/></linearGradient>
    </defs>
    <rect width="1280" height="190" fill="url(#top)"/>
    ${subtitle ? '<rect y="628" width="1280" height="92" fill="url(#bottom)"/>' : ''}
    ${lines.map((line, i) => `<text x="640" y="${lines.length === 1 ? 132 : 82 + i * 82}" text-anchor="middle" fill="${accent}" stroke="#050709" stroke-width="7" paint-order="stroke fill" stroke-linejoin="round" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="900" ${line.length * fontSize * .7 > 1180 ? 'textLength="1180" lengthAdjust="spacingAndGlyphs"' : ''}>${escape(line)}</text>`).join('')}
    ${subtitle ? `<text x="640" y="683" text-anchor="middle" fill="#ffffff" stroke="#050709" stroke-width="6" paint-order="stroke fill" font-family="Arial, sans-serif" font-size="${subtitleSize}" font-weight="900" ${subtitle.length * subtitleSize * .7 > 1140 ? 'textLength="1140" lengthAdjust="spacingAndGlyphs"' : ''}>${escape(subtitle)}</text>` : ''}
  </svg>`)
  return base.composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer()
}
