import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { promises as fsPromises } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { is } from '@electron-toolkit/utils'
import { getConfig, setConfig } from './services/config.js'
import { checkMissingDeps, installMissingDeps } from './services/dependency-manager.js'
import { createPipelineStrategies } from './services/factories.js'
import { buildHistorySourceUrl } from './services/history-source-link.js'
import { addHistoryEntry, deleteHistoryEntry, getHistory, type HistoryEntry } from './services/history.js'
import { cancelExport, exportVideo, type ExportResolution } from './services/export-video.js'
import { PipelineOrchestrator } from './services/pipeline.js'
import { ProjectStore, validateTimeline } from './services/project-store.js'
import { acquireProjectMedia } from './services/project-acquisition.js'
import { extractAudio, extractFrame, probeMedia, renderProject } from './services/project-media.js'
import { exportSpeakerAudio } from './services/project-speaker-audio.js'
import { getProjectDirectories, resolveProjectAssetPath, resolveProjectRelativePath, toProjectRelativePath, assertProjectId } from './services/project-paths.js'
import type { AppConfig, MissingDep, PipelineMode, PipelineState, SpeakerProfile, TranslationLanguage, VideoSourceType } from './services/types.js'
import type { ProjectOperationProgress, ProjectSpeakerAudioResult } from '../shared/project-types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let mediaServer: Server | null = null
let mediaServerPort = 0
const mediaTokens = new Map<string, { filePath: string; extension: string }>()
async function registerMediaFile(filePath: string): Promise<string> {
  const canonical = await fsPromises.realpath(filePath)
  const stat = await fsPromises.stat(canonical)
  if (!stat.isFile()) throw new Error('Media path is not a regular file')
  const outputRoot = await fsPromises.realpath(getConfig().outputDir)
  const rootWithSep = `${outputRoot}${path.sep}`
  if (canonical !== outputRoot && !canonical.startsWith(rootWithSep)) throw new Error('Media path is outside output directory')
  const token = randomUUID()
  mediaTokens.set(token, { filePath: canonical, extension: path.extname(canonical).toLowerCase() })
  return `http://127.0.0.1:${mediaServerPort}/media/${token}`
}
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
type ActiveProjectOperation = { operationId: string; controller: AbortController }
const activeProjectOperations = new Map<string, ActiveProjectOperation>()
const approvedLocalFiles = new Set<string>()
const OPERATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
function validateOperationId(value: unknown): asserts value is string { if (typeof value !== 'string' || !OPERATION_ID_RE.test(value)) throw new Error('Invalid operation id') }
function isIpcRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' }

function beginProjectOperation(projectId: string, operationId: string): AbortController {
  assertProjectId(projectId); validateOperationId(operationId)
  if (activeProjectOperations.has(projectId)) throw new Error('A project operation is already in progress')
  const operation = { operationId, controller: new AbortController() }
  activeProjectOperations.set(projectId, operation)
  return operation.controller
}

function endProjectOperation(projectId: string, operationId: string): void {
  const operation = activeProjectOperations.get(projectId)
  if (operation?.operationId === operationId) activeProjectOperations.delete(projectId)
}

function projectProgress(projectId: string, operationId: string, stage: ProjectOperationProgress['stage'], percent: number): void {
  mainWindow?.webContents.send('project:progress', { projectId, operationId, stage, percent: Math.max(0, Math.min(100, percent)) } satisfies ProjectOperationProgress)
}

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
  ipcMain.handle('media:getFileUrl', async (_event, filePath: string): Promise<string> => registerMediaFile(filePath))
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
    if (result.canceled || result.filePaths.length === 0) return null
    const selected = await fsPromises.realpath(result.filePaths[0])
    approvedLocalFiles.add(selected)
    return selected
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
  // ─── Phase 1 project IPC ────────────────────────────────────────
  ipcMain.handle('project:create', async (_event, request: unknown = {}): Promise<import('../shared/project-types.js').ProjectManifest> => {
    if (!isIpcRecord(request)) throw new Error('Invalid project create request')
    let name: string | undefined
    if ('name' in request) {
      if (typeof request.name !== 'string') throw new Error('Invalid project create request')
      name = request.name
    }
    return new ProjectStore(getConfig().outputDir).create(name)
  })

  ipcMain.handle('project:list', async (): Promise<import('../shared/project-types.js').ProjectListItem[]> => {
    return new ProjectStore(getConfig().outputDir).list()
  })

  ipcMain.handle('project:open', async (_event, projectId: unknown): Promise<import('../shared/project-types.js').ProjectManifest> => {
    assertProjectId(projectId)
    return new ProjectStore(getConfig().outputDir).open(projectId)
  })

  ipcMain.handle('project:save', async (_event, projectId: unknown, manifest: unknown): Promise<import('../shared/project-types.js').ProjectManifest> => {
    assertProjectId(projectId)
    if (activeProjectOperations.has(projectId)) throw new Error('Project operation is in progress')
    if (!manifest || typeof manifest !== 'object') throw new Error('Invalid project manifest')
    return new ProjectStore(getConfig().outputDir).save(projectId, manifest)
  })

  ipcMain.handle('project:delete', async (_event, projectId: unknown): Promise<void> => {
    assertProjectId(projectId)
    if (activeProjectOperations.has(projectId)) throw new Error('Project operation is in progress')
    await new ProjectStore(getConfig().outputDir).delete(projectId)
  })

  ipcMain.handle('project:acquire', async (_event, projectId: unknown, request: import('../shared/project-types.js').ProjectAcquireRequest, operationId: unknown): Promise<import('../shared/project-types.js').ProjectManifest> => {
    assertProjectId(projectId)
    validateOperationId(operationId)
    const config = getConfig()
    if (!request || typeof request !== 'object' || !['youtube', 'bilibili', 'local-file'].includes(request.sourceType) || typeof request.url !== 'string' || !request.url.trim()) throw new Error('Invalid project acquisition request')
    if (request.sourceType === 'local-file') {
      let stat
      let canonical: string
      try { canonical = await fsPromises.realpath(request.url); stat = statSync(canonical) } catch { throw new Error('Local video file not found') }
      if (!stat.isFile() || !path.isAbsolute(request.url)) throw new Error('Local source must be an absolute file path')
      if (!approvedLocalFiles.delete(canonical)) throw new Error('Local video file was not approved by the native file picker')
      request = { ...request, url: canonical }
    }
    const controller = beginProjectOperation(projectId, operationId)
    try {
      const manifest = await new ProjectStore(config.outputDir).open(projectId, true)
      return await acquireProjectMedia(config.outputDir, config, manifest, request, controller.signal, percent => projectProgress(projectId, operationId, 'acquiring', percent))
    } finally {
      endProjectOperation(projectId, operationId)
    }
  })

  ipcMain.handle('project:cancel', (_event, projectId: unknown, operationId: unknown): void => {
    assertProjectId(projectId)
    validateOperationId(operationId)
    const operation = activeProjectOperations.get(projectId)
    if (operation?.operationId === operationId) operation.controller.abort()
  })

  ipcMain.handle('project:asset-url', async (_event, projectId: unknown, assetPath: unknown): Promise<string> => {
    assertProjectId(projectId)
    if (typeof assetPath !== 'string') throw new Error('Invalid asset path')
    const outputDir = getConfig().outputDir
    const manifest = await new ProjectStore(outputDir).open(projectId)
    const absolute = await resolveProjectAssetPath(outputDir, projectId, assetPath, manifest)
    return registerMediaFile(absolute)
  })

  ipcMain.handle('project:metadata', async (_event, projectId: unknown, assetPath?: unknown): Promise<import('../shared/project-types.js').ProjectMediaMetadata> => {
    assertProjectId(projectId)
    if (assetPath !== undefined && typeof assetPath !== 'string') throw new Error('Invalid asset path')
    const outputDir = getConfig().outputDir
    const manifest = await new ProjectStore(outputDir).open(projectId)
    const relative = assetPath || manifest.assets.video
    if (!relative) throw new Error('Project has no video asset')
    const absolute = await resolveProjectAssetPath(outputDir, projectId, relative, manifest)
    const media = await probeMedia(absolute)
    return { ...media, assetPath: relative }
  })

  ipcMain.handle('project:extract-frame', async (_event, projectId: unknown, request: unknown, operationId: unknown): Promise<import('../shared/project-types.js').ProjectFrameResult> => {
    assertProjectId(projectId); validateOperationId(operationId)
    if (!isIpcRecord(request) || typeof request.timestamp !== 'number' || !Number.isFinite(request.timestamp) || request.timestamp < 0 || (request.assetPath !== undefined && typeof request.assetPath !== 'string') || (request.format !== undefined && request.format !== 'png' && request.format !== 'jpeg')) throw new Error('Invalid frame request')
    const outputDir = getConfig().outputDir; const controller = beginProjectOperation(projectId, operationId)
    try {
      const manifest = await new ProjectStore(outputDir).open(projectId); const sourceRelative = request.assetPath || manifest.assets.video
      if (!sourceRelative) throw new Error('Project has no video asset')
      const source = await resolveProjectAssetPath(outputDir, projectId, sourceRelative, manifest); const format = request.format === 'jpeg' ? 'jpeg' : 'png'
      const dirs = getProjectDirectories(outputDir, projectId); const relative = `generated/frames/frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format === 'jpeg' ? 'jpg' : 'png'}`; const absolute = path.join(dirs.root, relative)
      const metadata = await extractFrame(source, request.timestamp, format, absolute, controller.signal)
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); projectProgress(projectId, operationId, 'frame', 100)
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); const current = await new ProjectStore(outputDir).open(projectId)
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); await new ProjectStore(outputDir).save(projectId, { ...current, generated: { ...current.generated, frames: [...current.generated.frames, relative] } })
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); return { assetPath: relative, width: metadata.width, height: metadata.height, timestamp: request.timestamp }
    } finally { endProjectOperation(projectId, operationId) }
  })

  ipcMain.handle('project:extract-audio', async (_event, projectId: unknown, request: unknown, operationId: unknown): Promise<import('../shared/project-types.js').ProjectAudioResult> => {
    assertProjectId(projectId); validateOperationId(operationId); const formats = ['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg'] as const
    if (!isIpcRecord(request) || (request.assetPath !== undefined && typeof request.assetPath !== 'string') || !formats.some(value => value === request.format)) throw new Error('Invalid audio request')
    const format = formats.find(value => value === request.format)!; const outputDir = getConfig().outputDir; const controller = beginProjectOperation(projectId, operationId)
    try {
      const manifest = await new ProjectStore(outputDir).open(projectId); const sourceRelative = request.assetPath || manifest.assets.video
      if (!sourceRelative) throw new Error('Project has no video asset')
      const source = await resolveProjectAssetPath(outputDir, projectId, sourceRelative, manifest); const dirs = getProjectDirectories(outputDir, projectId); const relative = `generated/audio/audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`; const absolute = path.join(dirs.root, relative)
      const result = await extractAudio(source, format, absolute, controller.signal)
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); projectProgress(projectId, operationId, 'audio', 100)
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); const current = await new ProjectStore(outputDir).open(projectId)
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); await new ProjectStore(outputDir).save(projectId, { ...current, generated: { ...current.generated, audio: [...current.generated.audio, relative] } })
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); return { assetPath: relative, format: result.format }
    } finally { endProjectOperation(projectId, operationId) }
  })

  ipcMain.handle('project:extract-speaker-audio', async (_event, projectId: unknown, request: unknown, operationId: unknown): Promise<ProjectSpeakerAudioResult> => {
    assertProjectId(projectId); validateOperationId(operationId)
    const formats = ['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg'] as const
    if (!isIpcRecord(request) || (request.assetPath !== undefined && typeof request.assetPath !== 'string') || !formats.some(value => value === request.format)) throw new Error('Invalid speaker audio request')
    const format = formats.find(value => value === request.format)!
    const outputDir = getConfig().outputDir
    const controller = beginProjectOperation(projectId, operationId)
    let generatedPaths: string[] = []
    let saved = false
    try {
      const config = getConfig()
      const manifest = await new ProjectStore(outputDir).open(projectId)
      const sourceRelative = request.assetPath || manifest.assets.video
      if (!sourceRelative) throw new Error('Project has no video asset')
      const source = await resolveProjectAssetPath(outputDir, projectId, sourceRelative, manifest)
      const dirs = getProjectDirectories(outputDir, projectId)
      const result = await exportSpeakerAudio({
        sourcePath: source,
        tempDir: dirs.temp,
        outputDir: path.join(dirs.generated, 'audio'),
        config,
        format,
        signal: controller.signal,
        onProgress: progress => projectProgress(projectId, operationId, progress.stage, progress.percent),
      })
      if (controller.signal.aborted) throw new Error('Project operation cancelled')
      const relativePaths = result.files.map(file => toProjectRelativePath(outputDir, projectId, file.outputPath))
      generatedPaths = relativePaths
      const files = result.files.map((file, index) => ({
        speaker: file.speaker,
        assetPath: relativePaths[index],
        format: file.format,
        duration: file.duration,
      }))
      if (controller.signal.aborted) throw new Error('Project operation cancelled')
      const current = await new ProjectStore(outputDir).open(projectId)
      const audio = Array.from(new Set([...current.generated.audio, ...generatedPaths]))
      if (controller.signal.aborted) throw new Error('Project operation cancelled')
      await new ProjectStore(outputDir).save(projectId, { ...current, generated: { ...current.generated, audio } })
      saved = true
      if (controller.signal.aborted) throw new Error('Project operation cancelled')
      return { files }
    } catch (error) {
      if (!saved) {
        await Promise.all(generatedPaths.map(relative => {
          try {
            return fsPromises.unlink(resolveProjectRelativePath(outputDir, projectId, relative)).catch(() => {})
          } catch {
            return Promise.resolve()
          }
        }))
      }
      throw error
    } finally { endProjectOperation(projectId, operationId) }
  })

  ipcMain.handle('project:render', async (_event, projectId: unknown, request: unknown, operationId: unknown): Promise<import('../shared/project-types.js').ProjectRenderResult> => {
    assertProjectId(projectId); validateOperationId(operationId)
    if (!isIpcRecord(request) || (request.resolution !== 'original' && request.resolution !== '1080p' && request.resolution !== '720p' && request.resolution !== '480p') || (request.outputName !== undefined && (typeof request.outputName !== 'string' || request.outputName.length > 96))) throw new Error('Invalid render request')
    const resolution = request.resolution === 'original' ? 'original' : request.resolution === '1080p' ? '1080p' : request.resolution === '720p' ? '720p' : '480p'; const outputName = typeof request.outputName === 'string' ? request.outputName : `render-${Date.now()}.mp4`
    const outputDir = getConfig().outputDir; const controller = beginProjectOperation(projectId, operationId)
    try {
      const manifest = await new ProjectStore(outputDir).open(projectId); const timeline = request.timeline || manifest.timeline; validateTimeline(timeline, manifest.media?.duration)
      const sourceRelative = manifest.assets.video; if (!sourceRelative) throw new Error('Project has no video asset')
      const source = await resolveProjectAssetPath(outputDir, projectId, sourceRelative, manifest); const dirs = getProjectDirectories(outputDir, projectId); const requested = path.basename(outputName).slice(0, 96); const basename = requested.replace(/[^a-zA-Z0-9._-]/g, '-') || `render-${Date.now()}.mp4`; let filename = basename.toLowerCase().endsWith('.mp4') ? basename : `${basename}.mp4`; let suffix = 1
      while (await fsPromises.access(path.join(dirs.root, 'generated/exports', filename)).then(() => true).catch(() => false)) filename = `${basename.replace(/\.mp4$/i, '')}-${suffix++}.mp4`
      const relative = `generated/exports/${filename}`; const absolute = path.join(dirs.root, relative); const result = await renderProject(source, timeline, resolution, absolute, dirs.temp, controller.signal, percent => projectProgress(projectId, operationId, 'rendering', percent))
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); const current = await new ProjectStore(outputDir).open(projectId); const exports = Array.from(new Set([...current.generated.exports, relative]))
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); await new ProjectStore(outputDir).save(projectId, { ...current, timeline, generated: { ...current.generated, exports } })
      if (controller.signal.aborted) throw new Error('Project operation cancelled'); return { assetPath: relative, duration: result.duration }
    } finally { endProjectOperation(projectId, operationId) }
  })
}

// Start a local HTTP server for serving media files with proper Range support
function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
      '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
    }

    mediaServer = createServer((req, res) => {
      const match = req.url?.match(/^\/media\/([A-Za-z0-9-]+)$/)
      const entry = match ? mediaTokens.get(match[1]) : undefined
      if (!entry) {
        res.writeHead(404)
        res.end('Media not found')
        return
      }
      const filePath = entry.filePath
      let fileSize: number
      try { fileSize = statSync(filePath).size } catch {
        res.writeHead(404)
        res.end('File not found')
        return
      }
      const contentType = mimeTypes[entry.extension] || 'application/octet-stream'
      const range = req.headers.range
      if (range) {
        const rangeMatch = range.match(/bytes=(\d+)-(\d*)/)
        if (rangeMatch) {
          const start = Number(rangeMatch[1])
          const end = Math.min(rangeMatch[2] ? Number(rangeMatch[2]) : fileSize - 1, fileSize - 1)
          if (start <= end && start < fileSize) {
            res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': contentType })
            createReadStream(filePath, { start, end }).pipe(res)
            return
          }
        }
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' })
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
