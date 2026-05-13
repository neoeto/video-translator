import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { getConfig, setConfig } from './services/config.js'
import { PipelineOrchestrator } from './services/pipeline.js'
import type { AppConfig } from './services/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let currentPipeline: PipelineOrchestrator | null = null

function resolveIconPath(): string {
  if (is.dev) {
    // 开发环境从源码目录取图标，打包后资源会被复制到 process.resourcesPath。
    return path.resolve(__dirname, '..', '..', 'resources', 'icon.png')
  }
  return path.join(process.resourcesPath, 'icon.png')
}

function createWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  const iconPath = resolveIconPath()

  // macOS: set Dock icon via app.dock.setIcon (BrowserWindow icon has no effect on Dock)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }

  const window = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    icon: nativeImage.createFromPath(iconPath),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('pipeline:start', async (_event, url: string, outputDir: string): Promise<void> => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const pipeline = new PipelineOrchestrator()
    currentPipeline = pipeline

    pipeline.onProgress((state) => {
      mainWindow?.webContents.send('pipeline:progress', state)
    })

    try {
      await pipeline.start(url, outputDir)
    } finally {
      currentPipeline = null
    }
  })

  ipcMain.handle('pipeline:cancel', async (): Promise<void> => {
    currentPipeline?.cancel()
  })

  ipcMain.handle('config:get', (): AppConfig => getConfig())

  ipcMain.handle('config:set', (_event, config: Partial<AppConfig>): void => {
    setConfig(config)
  })

  ipcMain.handle('dialog:selectDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('shell:openPath', async (_event, targetPath: string): Promise<void> => {
    const errorMessage = await shell.openPath(targetPath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
