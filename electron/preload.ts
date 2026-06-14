import { contextBridge, ipcRenderer } from 'electron'
import type { PipelineState, AppConfig, DepInstallProgress, MissingDep, SpeakerProfile, VideoSourceType } from './services/types.js'
import type { HistoryEntry } from './services/history.js'

const electronAPI = {
  pipelineStart: (url: string, outputDir: string, sourceType: VideoSourceType = 'youtube'): Promise<void> =>
    ipcRenderer.invoke('pipeline:start', url, outputDir, sourceType),
  pipelineCancel: (): Promise<void> =>
    ipcRenderer.invoke('pipeline:cancel'),
  pipelineSkipError: (): Promise<void> =>
    ipcRenderer.invoke('pipeline:skip-error'),
  pipelineRemoveQueued: (taskId: string): Promise<void> =>
    ipcRenderer.invoke('pipeline:remove-queued', taskId),
  submitSpeakerLabels: (profiles: SpeakerProfile[]): Promise<void> =>
    ipcRenderer.invoke('pipeline:submit-speaker-labels', profiles),
  submitManualReview: (result: { segments: { start: number; end: number; sourceText: string; targetText: string; speaker: string }[] }): Promise<void> =>
    ipcRenderer.invoke('pipeline:submit-manual-review', result),
  cancelManualReview: (): Promise<void> =>
    ipcRenderer.invoke('pipeline:cancel-manual-review'),
  onProgress: (callback: (state: PipelineState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PipelineState) => callback(state)
    ipcRenderer.on('pipeline:progress', handler)
    return () => ipcRenderer.removeListener('pipeline:progress', handler)
  },
  onQueueState: (callback: (state: { active: unknown; pending: unknown[] }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { active: unknown; pending: unknown[] }) => callback(state)
    ipcRenderer.on('pipeline:queue-state', handler)
    return () => ipcRenderer.removeListener('pipeline:queue-state', handler)
  },
  getConfig: (): Promise<AppConfig> =>
    ipcRenderer.invoke('config:get'),
  setConfig: (config: Partial<AppConfig>): Promise<void> =>
    ipcRenderer.invoke('config:set', config),
  depsCheck: (sourceType: VideoSourceType): Promise<MissingDep[]> =>
    ipcRenderer.invoke('deps:check', sourceType),
  depsInstall: (missingDeps: MissingDep[]): Promise<MissingDep[]> =>
    ipcRenderer.invoke('deps:install', missingDeps),
  onDepsProgress: (callback: (progress: DepInstallProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DepInstallProgress) => callback(progress)
    ipcRenderer.on('deps:progress', handler)
    return () => ipcRenderer.removeListener('deps:progress', handler)
  },
  getHistory: (): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke('history:get'),
  deleteHistory: (id: string): Promise<void> =>
    ipcRenderer.invoke('history:delete', id),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory'),
  selectVideoFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectVideoFile'),
  openPath: (path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openPath', path),
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke('shell:showItemInFolder', path),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  exportVideo: (sourcePath: string, targetPath: string, resolution: string): Promise<void> =>
    ipcRenderer.invoke('export:start', sourcePath, targetPath, resolution),
  cancelExport: (): Promise<void> =>
    ipcRenderer.invoke('export:cancel'),
  onExportProgress: (callback: (data: { percent: number; stage: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { percent: number; stage: string }) => callback(data)
    ipcRenderer.on('export:progress', handler)
    return () => ipcRenderer.removeListener('export:progress', handler)
  },
  saveFileDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),
  getVideoDimensions: (videoPath: string): Promise<{ width: number; height: number } | null> =>
    ipcRenderer.invoke('video:getDimensions', videoPath),
  getAudioWaveform: (audioPath: string, samples: number): Promise<number[]> =>
    ipcRenderer.invoke('audio:getWaveform', audioPath, samples),
  getMediaServerPort: (): Promise<number> =>
    ipcRenderer.invoke('media:getServerPort'),
}

// 使用 contextBridge 暴露白名单 API，隔离渲染进程与 ipcRenderer，避免直接挂载 Node/Electron 能力。
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
