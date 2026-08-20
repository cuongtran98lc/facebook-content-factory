import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { SoundEffectOptions, SoundEffectPreset } from '../../shared/types'

function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string {
  const configured = name === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH
  const candidates = [configured, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].filter(Boolean) as string[]
  return candidates.find(candidate => existsSync(candidate)) ?? name
}

function run(command: 'ffmpeg' | 'ffprobe', args: string[], onProgressSeconds?: (seconds: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const binary = resolveBinary(command)
    const child = spawn(binary, args, { stdio: ['ignore', onProgressSeconds ? 'pipe' : 'ignore', 'pipe'] })
    let errorText = ''
    let progressText = ''
    child.stdout?.on('data', chunk => {
      progressText += chunk.toString()
      const lines = progressText.split(/\r?\n/)
      progressText = lines.pop() ?? ''
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)$/)
        if (match) onProgressSeconds?.(Number(match[1]) / 1_000_000)
      }
    })
    child.stderr?.on('data', chunk => { errorText += chunk.toString() })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${binary} failed (${code}): ${errorText.slice(-2500)}`)))
  })
}

export async function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(resolveBinary('ffmpeg'), ['-version'], { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

export async function probeDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveBinary('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', d => { stdout += d.toString() })
    child.stderr?.on('data', d => { stderr += d.toString() })
    child.once('error', reject)
    child.once('exit', code => {
      if (code !== 0) return reject(new Error(`ffprobe failed (${code}): ${stderr}`))
      const duration = Number.parseFloat(stdout.trim())
      if (!Number.isFinite(duration)) return reject(new Error('Không đọc được duration media.'))
      resolve(duration)
    })
  })
}

export async function concatMp3Parts(parts: string[], output: string, listFile: string): Promise<void> {
  if (!parts.length) throw new Error('Không có MP3 chunk để ghép.')

  const escaped = parts.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n')
  await writeFile(listFile, escaped, 'utf8')

  // Re-encode once after concat. CapCut can return MP3 chunks with slightly different
  // timestamps/headers, and stream-copying them may create incorrect duration or seeking.
  await run('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-ar', '44100',
    '-ac', '2',
    output
  ])
}

export type VideoFormat = 'LANDSCAPE' | 'REEL' | 'SQUARE'
export type FitMode = 'CROP' | 'FIT'
export type BackgroundKind = 'VIDEO' | 'IMAGE'

export const SFX_RENDER_VERSION = 2
export const DEFAULT_SOUND_EFFECT_OPTIONS: SoundEffectOptions = { preset: 'DYNAMIC', volume: 70 }

const SOUND_EFFECT_PRESETS: SoundEffectPreset[] = ['DYNAMIC', 'WHOOSH', 'IMPACT', 'CHIME']
type ConcreteSoundEffectPreset = Exclude<SoundEffectPreset, 'DYNAMIC'>

export function normalizeSoundEffectOptions(value?: Partial<SoundEffectOptions> | null): SoundEffectOptions {
  const preset = SOUND_EFFECT_PRESETS.includes(value?.preset as SoundEffectPreset) ? value!.preset as SoundEffectPreset : DEFAULT_SOUND_EFFECT_OPTIONS.preset
  const rawVolume = Number(value?.volume)
  const volume = Number.isFinite(rawVolume) ? Math.min(100, Math.max(10, Math.round(rawVolume))) : DEFAULT_SOUND_EFFECT_OPTIONS.volume
  return { preset, volume }
}

export function resolveSoundEffectPreset(preset: SoundEffectPreset, seed: number): ConcreteSoundEffectPreset {
  if (preset !== 'DYNAMIC') return preset
  const dynamic: ConcreteSoundEffectPreset[] = ['WHOOSH', 'IMPACT', 'CHIME']
  return dynamic[Math.abs(Math.trunc(seed)) % dynamic.length]
}

function soundEffectSource(preset: ConcreteSoundEffectPreset, seed: number): { source: string; filters: string; duration: number; gain: number } {
  const variation = Math.abs(Math.trunc(seed)) % 7
  if (preset === 'IMPACT') {
    const duration = 0.72 + variation * 0.025
    return {
      source: `anoisesrc=color=brown:amplitude=0.88:sample_rate=44100:duration=${duration.toFixed(3)}`,
      filters: `highpass=f=38,lowpass=f=${620 + variation * 24},afade=t=in:st=0:d=0.015,afade=t=out:st=0.04:d=${(duration - 0.04).toFixed(3)}`,
      duration,
      gain: 0.58
    }
  }
  if (preset === 'CHIME') {
    const duration = 0.82 + variation * 0.02
    return {
      source: `sine=frequency=${650 + variation * 35}:sample_rate=44100:duration=${duration.toFixed(3)}`,
      filters: `highpass=f=420,lowpass=f=3600,aecho=0.8:0.55:${70 + variation * 4}:0.24,afade=t=in:st=0:d=0.025,afade=t=out:st=${(duration * 0.48).toFixed(3)}:d=${(duration * 0.52).toFixed(3)}`,
      duration: duration + 0.12,
      gain: 3.4
    }
  }
  const duration = 0.98 + variation * 0.035
  return {
    source: `anoisesrc=color=pink:amplitude=0.65:sample_rate=44100:duration=${duration.toFixed(3)}`,
    filters: `highpass=f=${220 + variation * 18},lowpass=f=${6200 + variation * 80},afade=t=in:st=0:d=0.12,afade=t=out:st=0.24:d=${(duration - 0.24).toFixed(3)}`,
    duration,
    gain: 1
  }
}

export async function renderLoopedVideo(input: {
  backgroundPath: string
  audioPath: string
  outputPath: string
  format: VideoFormat
  fitMode: FitMode
  backgroundKind?: BackgroundKind
  soundEffectSeed?: number
  soundEffect?: SoundEffectOptions
  audioStartSeconds?: number
  audioDurationSeconds?: number
  ctaPath?: string
  onProgress?: (percent: number) => void
}): Promise<void> {
  const dims = input.format === 'REEL' ? [1080, 1920] : input.format === 'SQUARE' ? [1080, 1080] : [1920, 1080]
  const [w, h] = dims
  const sourceAudioDuration = await probeDuration(input.audioPath)
  if (!Number.isFinite(sourceAudioDuration) || sourceAudioDuration <= 0) throw new Error('Story MP3 không có duration hợp lệ.')
  const audioStart = Math.min(Math.max(0, input.audioStartSeconds ?? 0), Math.max(0, sourceAudioDuration - 0.001))
  const availableDuration = sourceAudioDuration - audioStart
  const audioDuration = Math.min(Math.max(0.001, input.audioDurationSeconds ?? availableDuration), availableDuration)

  const ctaDuration = input.ctaPath ? await probeDuration(input.ctaPath) : 0
  const totalAudioDuration = audioDuration + ctaDuration

  const filter = input.fitMode === 'FIT'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,fps=30`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30`

  const seed = Math.abs(Math.trunc(input.soundEffectSeed ?? 0))
  const soundEffect = normalizeSoundEffectOptions(input.soundEffect)
  const resolvedPreset = resolveSoundEffectPreset(soundEffect.preset, seed)
  const effect = soundEffectSource(resolvedPreset, seed)
  const effectRatio = 0.16 + ((seed * 37 + 11) % 35) / 100
  const latestStart = Math.max(0.05, audioDuration - effect.duration - 0.1)
  const effectAt = Math.min(Math.max(0.15, audioDuration * effectRatio), latestStart)
  const effectEnd = Math.min(audioDuration, effectAt + effect.duration + 0.1)
  const effectDelayMs = Math.round(effectAt * 1000)
  const effectGain = (soundEffect.volume / 100) * effect.gain

  const hasCta = Boolean(input.ctaPath)
  const effectIndex = hasCta ? 3 : 2

  const audioMix = hasCta
    ? [
        `[1:a]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo[nar_res]`,
        `[2:a]aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo[cta_res]`,
        `[nar_res][cta_res]concat=n=2:v=0:a=1[combined_nar]`,
        `[${effectIndex}:a]${effect.filters},volume=${effectGain.toFixed(3)},aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,adelay=delays=${effectDelayMs}:all=1[sfx]`,
        `[combined_nar]volume=0.82:enable='between(t,${effectAt.toFixed(3)},${effectEnd.toFixed(3)})'[narration]`,
        '[narration][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]'
      ].join(';')
    : [
        `[2:a]${effect.filters},volume=${effectGain.toFixed(3)},aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,adelay=delays=${effectDelayMs}:all=1[sfx]`,
        `[1:a]atrim=start=0:duration=${audioDuration.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,volume=0.82:enable='between(t,${effectAt.toFixed(3)},${effectEnd.toFixed(3)})'[narration]`,
        '[narration][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]'
      ].join(';')

  const backgroundInput = input.backgroundKind === 'IMAGE'
    ? ['-loop', '1', '-framerate', '30', '-i', input.backgroundPath]
    : ['-stream_loop', '-1', '-i', input.backgroundPath]
  const audioInput = [
    ...(audioStart > 0 ? ['-ss', audioStart.toFixed(3)] : []),
    '-t', audioDuration.toFixed(3),
    '-i', input.audioPath
  ]
  const ctaInput = input.ctaPath ? ['-i', input.ctaPath] : []
  const progressOutput = input.onProgress ? ['-progress', 'pipe:1', '-nostats'] : []

  await run('ffmpeg', [
    '-y',
    ...progressOutput,
    ...backgroundInput,
    ...audioInput,
    ...ctaInput,
    '-f', 'lavfi',
    '-i', effect.source,
    '-filter_complex', audioMix,
    '-map', '0:v:0',
    '-map', '[aout]',
    '-vf', filter,
    '-t', totalAudioDuration.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-shortest',
    '-movflags', '+faststart',
    input.outputPath
  ], seconds => input.onProgress?.(Math.min(99, Math.max(0, Math.round((seconds / totalAudioDuration) * 100)))))
  input.onProgress?.(100)
}

export async function extractVideoFrame(videoPath: string, outputPath: string, timeSeconds = 1): Promise<void> {
  await run('ffmpeg', [
    '-y',
    '-ss', timeSeconds.toFixed(3),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    '-update', '1',
    outputPath
  ])
}
