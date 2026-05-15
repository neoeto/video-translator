import type { PipelineState, AppConfig, SpeakerProfile } from './types'

export interface HistoryEntry {
  id: string
  videoTitle: string
  outputPath: string
  thumbnailDataUrl?: string
  completedAt: number
}

export interface ElectronAPI {
  pipelineStart: (url: string, outputDir: string) => Promise<void>
  pipelineCancel: () => Promise<void>
  submitSpeakerLabels: (profiles: SpeakerProfile[]) => Promise<void>
  onProgress: (callback: (state: PipelineState) => void) => () => void
  getConfig: () => Promise<AppConfig>
  setConfig: (config: Partial<AppConfig>) => Promise<void>
  getHistory: () => Promise<HistoryEntry[]>
  deleteHistory: (id: string) => Promise<void>
  selectDirectory: () => Promise<string | null>
  openPath: (path: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
