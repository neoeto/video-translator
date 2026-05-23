import { contextBridge, ipcRenderer } from 'electron'
import type { PipelineState, AppConfig, SpeakerProfile, VideoSourceType } from './services/types.js'
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
  pipelineGetQueue: (): Promise<{ active: unknown; pending: unknown[] }> =>
    ipcRenderer.invoke('pipeline:get-queue'),
  submitSpeakerLabels: (profiles: SpeakerProfile[]): Promise<void> =>
    ipcRenderer.invoke('pipeline:submit-speaker-labels', profiles),
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
}

// 使用 contextBridge 暴露白名单 API，隔离渲染进程与 ipcRenderer，避免直接挂载 Node/Electron 能力。
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
