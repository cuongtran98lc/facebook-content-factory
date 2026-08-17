import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bridgeDir = join(root, 'tools', 'capcut_bridge')
const pythonCandidates = process.platform === 'win32'
  ? [join(bridgeDir, '.venv', 'Scripts', 'python.exe'), 'python']
  : [join(bridgeDir, '.venv', 'bin', 'python'), 'python3']
const python = pythonCandidates.find(candidate => candidate === 'python' || candidate === 'python3' || existsSync(candidate))

if (!python) {
  console.error('Không tìm thấy Python cho CapCut bridge.')
  process.exit(1)
}

if (!existsSync(join(bridgeDir, 'capcut.local.json'))) {
  console.error('Thiếu tools/capcut_bridge/capcut.local.json. Hãy tạo config bridge trước.')
  process.exit(1)
}

const children = []
let stopping = false

function start(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: 'inherit' })
  children.push(child)
  child.once('error', error => {
    console.error(`Không thể chạy ${command}:`, error.message)
    stop(1)
  })
  child.once('exit', code => {
    if (!stopping) stop(code ?? 1)
  })
  return child
}

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(exitCode), 300).unref()
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

console.log('▶ Starting CapCut bridge: http://127.0.0.1:8000')
start(python, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8000'], { cwd: bridgeDir })

console.log('▶ Starting Content Factory...')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
start(npm, ['run', 'dev'], {
  cwd: root,
  env: { ...process.env, TTS_PROVIDER: 'capcut', CAPCUT_TTS_BRIDGE_URL: 'http://127.0.0.1:8000' }
})
