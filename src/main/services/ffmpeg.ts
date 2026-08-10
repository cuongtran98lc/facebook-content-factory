import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let errorText = ''
    child.stderr?.on('data', chunk => { errorText += chunk.toString() })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${errorText.slice(-2500)}`)))
  })
}

export async function hasFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

export async function probeDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { stdio: ['ignore', 'pipe', 'pipe'] })
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
  if (parts.length === 1) {
    await run('ffmpeg', ['-y', '-i', parts[0], '-c:a', 'copy', output])
    return
  }
  const escaped = parts.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n')
  await writeFile(listFile, escaped, 'utf8')
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'copy', output])
}

export type VideoFormat = 'LANDSCAPE' | 'REEL' | 'SQUARE'
export type FitMode = 'CROP' | 'FIT'

export async function renderLoopedVideo(input: {
  backgroundPath: string
  audioPath: string
  outputPath: string
  format: VideoFormat
  fitMode: FitMode
}): Promise<void> {
  const dims = input.format === 'REEL' ? [1080, 1920] : input.format === 'SQUARE' ? [1080, 1080] : [1920, 1080]
  const [w, h] = dims
  const filter = input.fitMode === 'FIT'
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,fps=30`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30`

  await run('ffmpeg', [
    '-y',
    '-stream_loop', '-1',
    '-i', input.backgroundPath,
    '-i', input.audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-vf', filter,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    input.outputPath
  ])
}
