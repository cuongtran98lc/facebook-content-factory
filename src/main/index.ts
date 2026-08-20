import { app, BrowserWindow, net, protocol } from 'electron'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { registerIpcHandlers, scheduler } from './ipc'
import { closePrisma } from './services/database'
import { getOutputRoot, getStorageRoot } from './services/paths'
import { pathToFileURL } from 'node:url'

// Load environment variables from .env file if present
try {
  const envPath = join(process.cwd(), '.env')
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const index = trimmed.indexOf('=')
        if (index > 0) {
          const key = trimmed.substring(0, index).trim()
          let val = trimmed.substring(index + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.substring(1, val.length - 1)
          }
          if (!(key in process.env)) {
            process.env[key] = val
          }
        }
      }
    }
  }
} catch (e) {
  console.error('Failed to load .env file:', e)
}

protocol.registerSchemesAsPrivileged([
 { scheme: 'local-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function isInsideRoot(path: string, root: string): boolean {
 const child = relative(resolve(root), resolve(path));
 return (
  child === '' ||
  (child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(child))
 );
}

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
   sandbox: false,
  },
 });

 win.once('ready-to-show', () => win.show());

 if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
  void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
 } else {
  void win.loadFile(join(__dirname, '../renderer/index.html'));
 }
}

app.whenReady().then(() => {
 protocol.handle('local-media', request => {
  const url = new URL(request.url);
  const requested = decodeURIComponent(url.pathname.slice(1));
  const allowedRoots = [getStorageRoot(), getOutputRoot()];
  if (!allowedRoots.some(root => isInsideRoot(requested, root))) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(resolve(requested)).toString());
 });
 registerIpcHandlers();
 scheduler.start();
 createWindow();
 app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
 });
});

app.on('window-all-closed', () => {
 if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
 void closePrisma();
});
