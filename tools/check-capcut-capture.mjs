import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'tools', 'capcut_bridge', 'capcut.local.json')
try { process.loadEnvFile(join(root, '.env')) } catch {}
const maxAgeHours = Number(process.env.CAPCUT_CAPTURE_MAX_AGE_HOURS || '24')
const captureRequired = /^(1|true|yes)$/i.test(process.env.CAPCUT_CAPTURE_REQUIRED || '')

try {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const explicitTime = typeof config.captured_at === 'string' ? Date.parse(config.captured_at) : Number.NaN
  const capturedAt = Number.isFinite(explicitTime) ? explicitTime : statSync(configPath).mtimeMs
  const ageHours = Math.max(0, (Date.now() - capturedAt) / 3_600_000)

  if (Number.isFinite(maxAgeHours) && maxAgeHours > 0 && ageHours > maxAgeHours) {
    console.warn(`\n⚠ CapCut capture đã ${ageHours.toFixed(1)} giờ (giới hạn ${maxAgeHours} giờ).`)
    console.warn('CapCut TTS có thể không chạy; hãy capture lại create/query request khi cần dùng voice.')
    if (captureRequired) {
      console.error('CAPCUT_CAPTURE_REQUIRED đang bật nên start bị dừng.\n')
      process.exit(1)
    }
    console.warn('App vẫn được khởi động vì capture chưa được đặt là bắt buộc.\n')
    process.exit(0)
  }

  const remaining = maxAgeHours > 0 ? `; còn khoảng ${Math.max(0, maxAgeHours - ageHours).toFixed(1)} giờ` : ''
  console.log(`CapCut capture OK: ${ageHours.toFixed(1)} giờ${remaining}.`)
} catch (error) {
  console.warn('⚠ Chưa có CapCut capture hợp lệ:', error instanceof Error ? error.message : error)
  if (captureRequired) process.exit(1)
  console.warn('App vẫn tiếp tục; CapCut TTS sẽ chưa dùng được.')
}
