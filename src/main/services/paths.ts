import { app } from 'electron'
import { join, resolve } from 'node:path'
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

export function getOutputRoot(): string {
  const configured = process.env.CONTENT_FACTORY_OUTPUT_DIR?.trim()
  const dir = configured
    ? resolve(configured)
    : app.isPackaged
      ? join(app.getPath('documents'), 'Content Factory Output')
      : join(app.getAppPath(), 'output')
  mkdirSync(dir, { recursive: true })
  return dir
}
