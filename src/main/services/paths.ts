import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export function getAppDataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDatabasePath(): string {
  if (!app.isPackaged) return join(process.cwd(), 'prisma', 'dev.db')
  return join(getAppDataDir(), 'content-factory.db')
}

export function getStorageRoot(): string {
  const dir = join(getAppDataDir(), 'projects')
  mkdirSync(dir, { recursive: true })
  return dir
}
