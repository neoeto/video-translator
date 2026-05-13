import { contextBridge, ipcRenderer } from 'electron'
import type { PipelineState, AppConfig } from './services/types.js'

const electronAPI = {
  pipelineStart: (url: string, outputDir: string): Promise<void> =>
    ipcRenderer.invoke('pipeline:start', url, outputDir),
  pipelineCancel: (): Promise<void> =>
    ipcRenderer.invoke('pipeline:cancel'),
  onProgress: (callback: (state: PipelineState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PipelineState) => callback(state)
    ipcRenderer.on('pipeline:progress', handler)
    // 返回清理函数交给 React/zustand 调用方释放监听，避免重复启动流水线后累积 IPC listener。
    return () => ipcRenderer.removeListener('pipeline:progress', handler)
  },
  getConfig: (): Promise<AppConfig> =>
    ipcRenderer.invoke('config:get'),
  setConfig: (config: Partial<AppConfig>): Promise<void> =>
    ipcRenderer.invoke('config:set', config),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory'),
  openPath: (path: string): Promise<void> =>
    ipcRenderer.invoke('shell:openPath', path),
}

// 使用 contextBridge 暴露白名单 API，隔离渲染进程与 ipcRenderer，避免直接挂载 Node/Electron 能力。
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
