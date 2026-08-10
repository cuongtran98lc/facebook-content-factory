import { app, BrowserWindow, net, protocol } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { closePrisma } from './services/database'
import { getStorageRoot } from './services/paths'
import { pathToFileURL } from 'node:url'

protocol.registerSchemesAsPrivileged([{ scheme: 'local-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: '#101114',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  protocol.handle('local-media', request => {
    const url = new URL(request.url)
    const requested = decodeURIComponent(url.pathname.slice(1))
    const root = getStorageRoot()
    if (!requested.startsWith(root)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(requested).toString())
  })
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void closePrisma()
})
