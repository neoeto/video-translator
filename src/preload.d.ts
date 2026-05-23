import type { PipelineState, AppConfig, SpeakerProfile, VideoSourceType } from './types'

export interface HistoryEntry {
  id: string
  videoTitle: string
  translatedTitle?: string
  outputPath: string
  thumbnailDataUrl?: string
  completedAt: number
  sourceLanguage?: string
  targetLanguage?: string
  duration?: number
  sourceType?: string
  fileSize?: number
  pipelineMode?: string
  summary?: string
  translatedSegments?: { start: number; end: number; sourceText: string; targetText: string; speaker: string }[]
}

export interface ElectronAPI {
  pipelineStart: (url: string, outputDir: string, sourceType?: VideoSourceType) => Promise<void>
  pipelineCancel: () => Promise<void>
  submitSpeakerLabels: (profiles: SpeakerProfile[]) => Promise<void>
  onProgress: (callback: (state: PipelineState) => void) => () => void
  getConfig: () => Promise<AppConfig>
  setConfig: (config: Partial<AppConfig>) => Promise<void>
  getHistory: () => Promise<HistoryEntry[]>
  deleteHistory: (id: string) => Promise<void>
  selectDirectory: () => Promise<string | null>
  selectVideoFile: () => Promise<string | null>
  openPath: (path: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
