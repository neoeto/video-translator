import type { PipelineState, AppConfig } from './types'

export interface ElectronAPI {
  pipelineStart: (url: string, outputDir: string) => Promise<void>
  pipelineCancel: () => Promise<void>
  onProgress: (callback: (state: PipelineState) => void) => () => void
  getConfig: () => Promise<AppConfig>
  setConfig: (config: Partial<AppConfig>) => Promise<void>
  selectDirectory: () => Promise<string | null>
  openPath: (path: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
