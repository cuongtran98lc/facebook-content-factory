import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rename, stat, unlink, writeFile } from 'node:fs/promises'
import type { SoundEffectOptions, SoundEffectPreset } from '../../shared/types'

function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string {
  const configured = name === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH
  const configuredFfmpegSibling = name === 'ffprobe' && process.env.FFMPEG_PATH
    ? process.env.FFMPEG_PATH.replace(/ffmpeg$/, 'ffprobe')
    : undefined
  const candidates = [
    // Prefer the libass-enabled Homebrew build when it exists. Some launch
    // environments retain an old FFMPEG_PATH=/opt/homebrew/bin/ffmpeg; that
    // standard build can render video but cannot burn ASS subtitles.
    `/opt/homebrew/opt/ffmpeg-full/bin/${name}`,
    `/usr/local/opt/ffmpeg-full/bin/${name}`,
    configured,
    configuredFfmpegSibling,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`
  ].filter(Boolean) as string[]
  return candidates.find(candidate => existsSync(candidate)) ?? name
}

function hasFilter(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(resolveBinary('ffmpeg'), ['-hide_banner', '-filters'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.once('error', () => resolve(false))
    child.once('exit', code => {
      // FFmpeg 8 prints three capability columns (e.g. "... ass") while
      // FFmpeg 9 currently prints two (".. ass"). Accept either format.
      const filterPattern = new RegExp(`^\\s*[TSC.]{2,4}\\s+${name}\\s`, 'm')
      resolve(code === 0 && filterPattern.test(stdout))
    })
  })
}

function run(command: 'ffmpeg' | 'ffprobe', args: string[], onProgressSeconds?: (seconds: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Render đã bị hủy.'))
    const binary = resolveBinary(command)
    const child = spawn(binary, args, { stdio: ['ignore', onProgressSeconds ? 'pipe' : 'ignore', 'pipe'] })
    let errorText = ''
    let progressText = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve()
    }
    const abort = () => {
      child.kill('SIGTERM')
      const forceTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
      forceTimer.unref()
      finish(new Error('Render đã bị hủy.'))
    }
    signal?.addEventListener('abort', abort, { once: true })
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
    child.once('error', error => finish(error))
    child.once('exit', code => code === 0 ? finish() : finish(new Error(`${binary} failed (${code}): ${errorText.slice(-2500)}`)))
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

  // Write beside the destination and publish only after FFmpeg has completely
  // closed a non-empty file. This prevents ffprobe (or another resume attempt)
  // from observing a missing/half-written reel audio file.
  const temporaryOutput = `${output}.partial-${process.pid}-${Date.now()}.mp3`
  try {
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
      temporaryOutput
    ])
    const result = await stat(temporaryOutput).catch(() => null)
    if (!result?.isFile() || result.size === 0) {
      throw new Error(`FFmpeg kết thúc nhưng không tạo được file audio: ${output}`)
    }
    await rename(temporaryOutput, output)
    const published = await stat(output).catch(() => null)
    if (!published?.isFile() || published.size === 0) {
      throw new Error(`Không thể xuất bản file audio sau khi ghép: ${output}`)
    }
  } finally {
    await unlink(temporaryOutput).catch(() => undefined)
  }
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
  backgroundStartSeconds?: number
  frameRate?: 30 | 60
  audioDurationSeconds?: number
  subtitlePath?: string
  signal?: AbortSignal
  onProgress?: (percent: number) => void
}): Promise<void> {
  if (input.subtitlePath && !await hasFilter('ass')) {
    const binary = resolveBinary('ffmpeg')
    throw new Error(
      `FFmpeg (${binary}) không có filter "ass" cần để đốt phụ đề. ` +
      'Cài bản có libass (macOS: brew install ffmpeg-full), rồi đặt FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg và khởi động lại app; ' +
      'hoặc tắt tùy chọn phụ đề để render bằng FFmpeg hiện tại.'
    )
  }

  const dims = input.format === 'REEL' ? [1080, 1920] : input.format === 'SQUARE' ? [1080, 1080] : [1920, 1080]
  const [w, h] = dims
  const sourceAudioDuration = await probeDuration(input.audioPath)
  if (!Number.isFinite(sourceAudioDuration) || sourceAudioDuration <= 0) throw new Error('Story MP3 không có duration hợp lệ.')
  const audioStart = Math.min(Math.max(0, input.audioStartSeconds ?? 0), Math.max(0, sourceAudioDuration - 0.001))
  const availableDuration = sourceAudioDuration - audioStart
  const audioDuration = Math.min(Math.max(0.001, input.audioDurationSeconds ?? availableDuration), availableDuration)

  const filter = input.fitMode === 'FIT'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,fps=${input.frameRate === 60 ? 60 : 30}`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${input.frameRate === 60 ? 60 : 30}`

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
  const audioMix = [
    `[2:a]${effect.filters},volume=${effectGain.toFixed(3)},aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,adelay=delays=${effectDelayMs}:all=1[sfx]`,
    `[1:a]atrim=start=0:duration=${audioDuration.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,volume=0.82:enable='between(t,${effectAt.toFixed(3)},${effectEnd.toFixed(3)})'[narration]`,
    '[narration][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]'
  ].join(';')

  const backgroundInput = input.backgroundKind === 'IMAGE'
    ? ['-loop', '1', '-framerate', '30', '-i', input.backgroundPath]
    : ['-stream_loop', '-1', ...(input.backgroundStartSeconds ? ['-ss', input.backgroundStartSeconds.toFixed(3)] : []), '-i', input.backgroundPath]
  const audioInput = [
    ...(audioStart > 0 ? ['-ss', audioStart.toFixed(3)] : []),
    '-t', audioDuration.toFixed(3),
    '-i', input.audioPath
  ]
  const progressOutput = input.onProgress ? ['-progress', 'pipe:1', '-nostats'] : []
  const escapedSubtitlePath = input.subtitlePath
    ?.replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
  const videoFilter = escapedSubtitlePath ? `${filter},ass=filename='${escapedSubtitlePath}'` : filter

  await run('ffmpeg', [
    '-y',
    ...progressOutput,
    ...backgroundInput,
    ...audioInput,
    '-f', 'lavfi',
    '-i', effect.source,
    '-filter_complex', audioMix,
    '-map', '0:v:0',
    '-map', '[aout]',
    '-vf', videoFilter,
    '-t', audioDuration.toFixed(3),
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
  ], seconds => input.onProgress?.(Math.min(99, Math.max(0, Math.round((seconds / audioDuration) * 100)))), input.signal)
  input.onProgress?.(100)
}

export async function extractVideoFrame(videoPath: string, outputPath: string, timeSeconds: number): Promise<void> {
  await run('ffmpeg', [
    '-y',
    '-ss', timeSeconds.toFixed(3),
    '-i', videoPath,
    '-vframes', '1',
    '-f', 'image2',
    outputPath
  ])
}

export async function renderAnimationCycle(pattern: string, output: string, duration: number): Promise<void> {
  await run('ffmpeg', ['-y', '-loop', '1', '-framerate', '60', '-i', pattern,
    '-t', duration.toFixed(6), '-an', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', output])
}

export async function concatAnimationScenes(listFile: string, output: string): Promise<void> {
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', '-movflags', '+faststart', output])
}

export async function addAnimationNarration(video: string, audio: string, output: string): Promise<void> {
  await run('ffmpeg', ['-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output])
}

/** Burn captions into the existing animation while copying its narration unchanged. */
export async function burnVideoCaptions(video: string, subtitlePath: string, output: string, duration: number, onProgress?: (percent: number) => void): Promise<void> {
  if (!await hasFilter('ass')) throw new Error('FFmpeg thiếu libass để ghép caption. Hãy dùng bản ffmpeg-full.');
  const escapedSubtitlePath = subtitlePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
  await run('ffmpeg', ['-y', '-i', video, '-map', '0:v:0', '-map', '0:a:0',
    '-vf', `ass=filename='${escapedSubtitlePath}'`, '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', output], seconds => onProgress?.(Math.min(100, Math.round(seconds / duration * 100))));
}
