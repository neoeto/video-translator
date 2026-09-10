import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { getConfig, setConfig } from './services/config.js'
import { checkMissingDeps, installMissingDeps } from './services/dependency-manager.js'
import { createPipelineStrategies } from './services/factories.js'
import { buildHistorySourceUrl } from './services/history-source-link.js'
import { addHistoryEntry, deleteHistoryEntry, getHistory, type HistoryEntry } from './services/history.js'
import { cancelExport, exportVideo, type ExportResolution } from './services/export-video.js'
import { PipelineOrchestrator } from './services/pipeline.js'
import type { AppConfig, MissingDep, PipelineMode, PipelineState, SpeakerProfile, TranslationLanguage, VideoSourceType } from './services/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let mediaServer: Server | null = null
let mediaServerPort = 0

// ─── Task Queue ─────────────────────────────────────────────────

interface QueueTask {
  id: string
  url: string
  outputDir: string
  sourceType: VideoSourceType
  title?: string
  config: AppConfig
}

interface BroadcastQueueTask {
  id: string
  url: string
  sourceType: VideoSourceType
  title?: string
  sourceLanguage: TranslationLanguage
  targetLanguage: TranslationLanguage
  pipelineMode: PipelineMode
}

interface BroadcastQueueState {
  active: BroadcastQueueTask | null
  pending: BroadcastQueueTask[]
}

let currentPipeline: PipelineOrchestrator | null = null
let dependencyInstallController: AbortController | null = null
const taskQueue: QueueTask[] = []
let activeTask: QueueTask | null = null
let lastDependencySourceType: VideoSourceType = 'youtube'

function toBroadcastTask(task: QueueTask): BroadcastQueueTask {
  return {
    id: task.id,
    url: task.url,
    sourceType: task.sourceType,
    title: task.title,
    sourceLanguage: task.config.sourceLanguage,
    targetLanguage: task.config.targetLanguage,
    pipelineMode: task.config.pipelineMode,
  }
}

function broadcastQueueState(): void {
  const state: BroadcastQueueState = {
    active: activeTask ? toBroadcastTask(activeTask) : null,
    pending: taskQueue.map(toBroadcastTask),
  }
  mainWindow?.webContents.send('pipeline:queue-state', state)
}

function processNextTask(): void {
  if (activeTask || taskQueue.length === 0) return

  const task = taskQueue.shift()!
  activeTask = task
  broadcastQueueState()

  const strategies = createPipelineStrategies(task.config, task.sourceType)
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
        sourceLanguage: task.config.sourceLanguage,
        targetLanguage: task.config.targetLanguage,
        duration: state.duration,
        sourceType: task.sourceType,
        ...(sourceUrl ? { sourceUrl } : {}),
        fileSize,
        pipelineMode: task.config.pipelineMode,
        summary: state.summary,
        translatedSegments: state.translatedSegments,
      })
    }
  })

  pipeline.start(task.url, task.outputDir, task.sourceType, task.config)
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

  const initialTheme = getConfig().themeMode ?? 'dark'
  nativeTheme.themeSource = initialTheme

  const window = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    icon: nativeImage.createFromPath(iconPath),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131313' : '#f9f9ff',
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
  ipcMain.handle('media:getServerPort', () => mediaServerPort)

  ipcMain.handle('pipeline:start', async (_event, url: string, outputDir: string, sourceType: VideoSourceType = 'youtube'): Promise<void> => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const task: QueueTask = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      outputDir,
      sourceType,
      config: getConfig(),
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

  ipcMain.handle('pipeline:submit-speaker-labels', (_event, profiles: SpeakerProfile[]): void => {
    currentPipeline?.submitSpeakerLabels(profiles)
  })

  ipcMain.handle('pipeline:submit-manual-review', (_event, result: { segments: { start: number; end: number; sourceText: string; targetText: string; speaker: string }[] }): void => {
    // Validate the result from renderer
    if (!result || !Array.isArray(result.segments)) return
    for (const seg of result.segments) {
      if (typeof seg.start !== 'number' || typeof seg.end !== 'number' ||
          !Number.isFinite(seg.start) || !Number.isFinite(seg.end) ||
          seg.start < 0 || seg.end <= seg.start) return
      if (typeof seg.sourceText !== 'string' || typeof seg.targetText !== 'string') return
    }
    currentPipeline?.submitManualReview(result)
  })

  ipcMain.handle('pipeline:cancel-manual-review', (): void => {
    currentPipeline?.cancelManualReview()
  })

  ipcMain.handle('config:get', (): AppConfig => getConfig())

  ipcMain.handle('config:set', (_event, config: Partial<AppConfig>): void => {
    setConfig(config)
    if (config.themeMode) {
      nativeTheme.themeSource = config.themeMode
      mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#131313' : '#f9f9ff')
    }
  })

  ipcMain.handle('deps:check', async (_event, sourceType: VideoSourceType): Promise<MissingDep[]> => {
    lastDependencySourceType = sourceType
    return checkMissingDeps(getConfig(), sourceType)
  })

  ipcMain.handle('deps:install', async (_event, missingDeps: MissingDep[]): Promise<MissingDep[]> => {
    if (dependencyInstallController) {
      throw new Error('Dependency installation is already in progress.')
    }

    const config = getConfig()
    dependencyInstallController = new AbortController()
    try {
      const updatedPaths = await installMissingDeps(missingDeps, config, (progress) => {
        mainWindow?.webContents.send('deps:progress', progress)
      }, dependencyInstallController.signal)
      setConfig(updatedPaths)
      return checkMissingDeps(getConfig(), lastDependencySourceType)
    } finally {
      dependencyInstallController = null
    }
  })

  ipcMain.handle('deps:cancel-install', (): void => {
    dependencyInstallController?.abort()
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

  ipcMain.handle('shell:showItemInFolder', (_event, targetPath: string): void => {
    shell.showItemInFolder(targetPath)
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

  // ─── Export Handlers ────────────────────────────────────────────
  ipcMain.handle('export:start', async (_event, sourcePath: string, targetPath: string, resolution: ExportResolution): Promise<void> => {
    if (!mainWindow) throw new Error('No window available')
    await exportVideo({ sourcePath, targetPath, resolution }, mainWindow)
  })

  ipcMain.handle('export:cancel', (): void => {
    cancelExport()
  })

  ipcMain.handle('dialog:saveFile', async (_event, defaultName: string): Promise<string | null> => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'Video', extensions: ['mp4'] }],
    })
    return result.canceled ? null : result.filePath
  })

  // ─── Video Info Handlers ──────────────────────────────────────────
  ipcMain.handle('video:getDimensions', async (_event, videoPath: string): Promise<{ width: number; height: number } | null> => {
    const { getVideoDimensions } = await import('./services/export-video.js')
    try {
      return await getVideoDimensions(videoPath)
    } catch {
      return null
    }
  })

  // ─── Editor Helpers ──────────────────────────────────────────────
  ipcMain.handle('audio:getWaveform', async (_event, audioPath: string, samples: number): Promise<number[]> => {
   const { promises: fsPromises } = await import('node:fs')
   try {
     await fsPromises.access(audioPath)
   } catch {
     return []
   }
   const ffmpegModule = await import('fluent-ffmpeg')
   const ffmpegFn = ffmpegModule.default
   return new Promise((resolve) => {
     const chunks: Buffer[] = []
     ffmpegFn(audioPath)
       .audioChannels(1)
       .audioFrequency(8000)
       .format('s16le')
       .on('error', () => resolve([]))
       .pipe()
       .on('data', (chunk: Buffer) => chunks.push(chunk))
       .on('end', () => {
         const raw = Buffer.concat(chunks)
         const totalSamples = raw.length / 2
         const step = Math.max(1, Math.floor(totalSamples / samples))
         const waveform: number[] = []
         for (let i = 0; i < totalSamples && waveform.length < samples; i += step) {
           const val = raw.readInt16LE(i * 2)
           waveform.push(Math.abs(val) / 32768)
         }
         resolve(waveform)
       })
   })
  })
}

// Start a local HTTP server for serving media files with proper Range support
function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
      '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
    }

    mediaServer = createServer((req, res) => {
      const filePath = decodeURIComponent(req.url?.slice(1) || '')
      if (!filePath) {
        res.writeHead(400)
        res.end('Missing file path')
        return
      }

      let fileSize: number
      try {
        fileSize = statSync(filePath).size
      } catch {
        res.writeHead(404)
        res.end('File not found')
        return
      }

      const ext = path.extname(filePath).toLowerCase()
      const contentType = mimeTypes[ext] || 'application/octet-stream'
      const range = req.headers.range

      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
          const chunkSize = end - start + 1

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': contentType,
          })
          createReadStream(filePath, { start, end }).pipe(res)
          return
        }
      }

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      })
      createReadStream(filePath).pipe(res)
    })

    mediaServer.listen(0, '127.0.0.1', () => {
      const addr = mediaServer!.address()
      if (addr && typeof addr === 'object') {
        mediaServerPort = addr.port
        console.log(`[MediaServer] Listening on http://127.0.0.1:${mediaServerPort}`)
        resolve(mediaServerPort)
      } else {
        reject(new Error('Failed to get server address'))
      }
    })

    mediaServer.on('error', reject)
  })
}

app.whenReady().then(async () => {
  await startMediaServer()

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
    mediaServer?.close()
    app.quit()
  }
})
