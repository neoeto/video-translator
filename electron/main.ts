import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { getConfig, setConfig } from './services/config.js'
import { createPipelineStrategies } from './services/factories.js'
import { buildHistorySourceUrl } from './services/history-source-link.js'
import { addHistoryEntry, deleteHistoryEntry, getHistory, type HistoryEntry } from './services/history.js'
import { PipelineOrchestrator } from './services/pipeline.js'
import type { AppConfig, PipelineState, SpeakerProfile, VideoSourceType } from './services/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null

// ─── Task Queue ─────────────────────────────────────────────────

interface QueueTask {
  id: string
  url: string
  outputDir: string
  sourceType: VideoSourceType
  title?: string
}

interface QueueState {
  active: QueueTask | null
  pending: QueueTask[]
}

let currentPipeline: PipelineOrchestrator | null = null
const taskQueue: QueueTask[] = []
let activeTask: QueueTask | null = null

function broadcastQueueState(): void {
  const state: QueueState = { active: activeTask, pending: [...taskQueue] }
  mainWindow?.webContents.send('pipeline:queue-state', state)
}

function processNextTask(): void {
  if (activeTask || taskQueue.length === 0) return

  const task = taskQueue.shift()!
  activeTask = task
  broadcastQueueState()

  const config = getConfig()
  const strategies = createPipelineStrategies(config, task.sourceType)
  const pipeline = new PipelineOrchestrator(strategies)
  currentPipeline = pipeline

  pipeline.onProgress((state: PipelineState) => {
    // Update task title once known
    if (state.videoTitle && activeTask) {
      activeTask.title = state.videoTitle
      broadcastQueueState()
    }

    mainWindow?.webContents.send('pipeline:progress', state)

    if (state.stage === 'completed' && state.outputPath) {
      const currentConfig = getConfig()
      const sourceUrl = buildHistorySourceUrl({
        sourceType: task.sourceType,
        taskUrl: task.url,
      })
      let fileSize: number | undefined
      try {
        fileSize = statSync(state.outputPath).size
      } catch { /* non-critical */ }
      addHistoryEntry({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        videoTitle: state.videoTitle || 'Untitled',
        translatedTitle: state.translatedTitle,
        outputPath: state.outputPath,
        thumbnailDataUrl: state.thumbnailDataUrl,
        completedAt: state.completedAt || Date.now(),
        sourceLanguage: currentConfig.sourceLanguage,
        targetLanguage: currentConfig.targetLanguage,
        duration: state.duration,
        sourceType: task.sourceType,
        ...(sourceUrl ? { sourceUrl } : {}),
        fileSize,
        pipelineMode: currentConfig.pipelineMode,
        summary: state.summary,
        translatedSegments: state.translatedSegments,
      })
    }
  })

  pipeline.start(task.url, task.outputDir, task.sourceType)
    .then(() => {
      activeTask = null
      currentPipeline = null
      broadcastQueueState()
      processNextTask()
    })
    .catch(() => {
      activeTask = null
      currentPipeline = null
      broadcastQueueState()
      // On error, don't auto-start next — let user decide
    })
}

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

  const initialTheme = getConfig().themeMode ?? 'dark'
  nativeTheme.themeSource = initialTheme

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
  ipcMain.handle('pipeline:start', async (_event, url: string, outputDir: string, sourceType: VideoSourceType = 'youtube'): Promise<void> => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const task: QueueTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      outputDir,
      sourceType,
    }

    if (activeTask) {
      // Queue the task if one is already running
      taskQueue.push(task)
      broadcastQueueState()
    } else {
      // Start immediately
      taskQueue.push(task)
      processNextTask()
    }
  })

  ipcMain.handle('pipeline:cancel', async (): Promise<void> => {
    currentPipeline?.cancel()
  })

  ipcMain.handle('pipeline:skip-error', (): void => {
    // After error, reset and start next queued task
    activeTask = null
    currentPipeline = null
    broadcastQueueState()
    processNextTask()
  })

  ipcMain.handle('pipeline:remove-queued', (_event, taskId: string): void => {
    const idx = taskQueue.findIndex(t => t.id === taskId)
    if (idx !== -1) {
      taskQueue.splice(idx, 1)
      broadcastQueueState()
    }
  })

  ipcMain.handle('pipeline:get-queue', (): QueueState => {
    return { active: activeTask, pending: [...taskQueue] }
  })

  ipcMain.handle('pipeline:submit-speaker-labels', (_event, profiles: SpeakerProfile[]): void => {
    currentPipeline?.submitSpeakerLabels(profiles)
  })

  ipcMain.handle('config:get', (): AppConfig => getConfig())

  ipcMain.handle('config:set', (_event, config: Partial<AppConfig>): void => {
    setConfig(config)
    if (config.themeMode) {
      nativeTheme.themeSource = config.themeMode
    }
  })

  ipcMain.handle('history:get', (): HistoryEntry[] => getHistory())

  ipcMain.handle('history:delete', (_event, id: string): void => {
    deleteHistoryEntry(id)
  })

  ipcMain.handle('dialog:selectDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectVideoFile', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'flv', 'wmv', 'ts', 'mts'] },
      ],
    })
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

  ipcMain.handle('shell:openExternal', async (_event, url: string): Promise<void> => {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new Error('Invalid URL')
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Unsupported URL protocol')
    }

    await shell.openExternal(parsedUrl.toString())
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
