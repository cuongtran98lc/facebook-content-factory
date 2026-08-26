import type { VideoFormat } from '../../shared/types'

export const SUBTITLE_RENDER_VERSION = 1

interface SubtitleCue {
  start: number
  end: number
  text: string
}

interface SubtitleLayout {
  width: number
  height: number
  fontSize: number
  marginV: number
  maxWords: number
  maxChars: number
  lineChars: number
}

const LAYOUTS: Record<VideoFormat, SubtitleLayout> = {
  LANDSCAPE: { width: 1920, height: 1080, fontSize: 54, marginV: 74, maxWords: 12, maxChars: 78, lineChars: 39 },
  SQUARE: { width: 1080, height: 1080, fontSize: 48, marginV: 90, maxWords: 10, maxChars: 58, lineChars: 29 },
  REEL: { width: 1080, height: 1920, fontSize: 62, marginV: 250, maxWords: 8, maxChars: 46, lineChars: 23 }
}

function cleanWords(text: string): string[] {
  return text
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

function cueWeight(words: string[]): number {
  const text = words.join(' ')
  const spokenCharacters = Array.from(text.replace(/[^\p{L}\p{N}]/gu, '')).length
  const commaPauses = (text.match(/[,;:]/g) ?? []).length * 2
  const sentencePauses = (text.match(/[.!?…]/g) ?? []).length * 5
  return Math.max(1, spokenCharacters + commaPauses + sentencePauses)
}

function wrapCue(words: string[], lineChars: number): string {
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!line || `${line} ${word}`.length <= lineChars || lines.length === 1) {
      line = line ? `${line} ${word}` : word
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 2).join('\\N')
}

function buildCues(text: string, duration: number, layout: SubtitleLayout): SubtitleCue[] {
  const words = cleanWords(text)
  if (!words.length || !Number.isFinite(duration) || duration <= 0) return []

  const groups: string[][] = []
  let current: string[] = []
  for (const word of words) {
    const candidate = [...current, word]
    const atLimit = candidate.length >= layout.maxWords || candidate.join(' ').length >= layout.maxChars
    const atNaturalBreak = candidate.length >= 4 && /[.!?…;:]$/.test(word)
    current = candidate
    if (atLimit || atNaturalBreak) {
      groups.push(current)
      current = []
    }
  }
  if (current.length) {
    if (current.length <= 2 && groups.length) groups[groups.length - 1].push(...current)
    else groups.push(current)
  }

  const weights = groups.map(cueWeight)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  return groups.map((group, index) => {
    const start = cursor
    cursor = index === groups.length - 1 ? duration : cursor + duration * (weights[index] / totalWeight)
    return { start, end: cursor, text: wrapCue(group, layout.lineChars) }
  })
}

function assTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(centiseconds / 360000)
  const minutes = Math.floor((centiseconds % 360000) / 6000)
  const secs = Math.floor((centiseconds % 6000) / 100)
  const fraction = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}

function escapeAssText(value: string): string {
  return value.replace(/\\(?!N)/g, '\\\\').replace(/[{}]/g, '')
}

export function createAssSubtitles(input: {
  text: string
  totalDuration: number
  format: VideoFormat
  clipStart?: number
  clipDuration?: number
}): string {
  const layout = LAYOUTS[input.format]
  const clipStart = Math.max(0, input.clipStart ?? 0)
  const clipDuration = Math.max(0.01, input.clipDuration ?? input.totalDuration - clipStart)
  const clipEnd = clipStart + clipDuration
  const cues = buildCues(input.text, input.totalDuration, layout)
    .filter(cue => cue.end > clipStart && cue.start < clipEnd)
    .map(cue => ({
      ...cue,
      start: Math.max(0, cue.start - clipStart),
      end: Math.min(clipDuration, cue.end - clipStart)
    }))
    .filter(cue => cue.end - cue.start >= 0.05)

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${layout.width}`,
    `PlayResY: ${layout.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${layout.fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H70000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,${layout.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]
  const events = cues.map(cue => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${escapeAssText(cue.text)}`)
  return [...header, ...events, ''].join('\n')
}
