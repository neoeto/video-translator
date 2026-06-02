import type { PipelineState, AppConfig, DepInstallProgress, MissingDep, SpeakerProfile, VideoSourceType, TranslationLanguage, PipelineMode, ManualReviewResult } from './types'

export interface QueueTask {
  id: string
  url: string
  sourceType: string
  title?: string
  sourceLanguage: TranslationLanguage
  targetLanguage: TranslationLanguage
  pipelineMode: PipelineMode
}

export interface QueueState {
  active: QueueTask | null
  pending: QueueTask[]
}

export interface HistoryEntry {
  id: string
  videoTitle: string
  translatedTitle?: string
  outputPath: string
  sourceUrl?: string
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

export type ExportResolution = 'original' | '1080p' | '720p' | '480p'

export interface ElectronAPI {
  pipelineStart: (url: string, outputDir: string, sourceType?: VideoSourceType) => Promise<void>
  pipelineCancel: () => Promise<void>
  pipelineSkipError: () => Promise<void>
  pipelineRemoveQueued: (taskId: string) => Promise<void>
  pipelineGetQueue: () => Promise<QueueState>
  submitSpeakerLabels: (profiles: SpeakerProfile[]) => Promise<void>
  submitManualReview: (result: ManualReviewResult) => Promise<void>
  cancelManualReview: () => Promise<void>
  onProgress: (callback: (state: PipelineState) => void) => () => void
  onQueueState: (callback: (state: QueueState) => void) => () => void
  getConfig: () => Promise<AppConfig>
  setConfig: (config: Partial<AppConfig>) => Promise<void>
  depsCheck: (sourceType: VideoSourceType) => Promise<MissingDep[]>
  depsInstall: (missingDeps: MissingDep[]) => Promise<MissingDep[]>
  onDepsProgress: (callback: (progress: DepInstallProgress) => void) => () => void
  getHistory: () => Promise<HistoryEntry[]>
  deleteHistory: (id: string) => Promise<void>
  selectDirectory: () => Promise<string | null>
  selectVideoFile: () => Promise<string | null>
  openPath: (path: string) => Promise<void>
  showItemInFolder: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  exportVideo: (sourcePath: string, targetPath: string, resolution: ExportResolution) => Promise<void>
  cancelExport: () => Promise<void>
  onExportProgress: (callback: (data: { percent: number; stage: string }) => void) => () => void
  saveFileDialog: (defaultName: string) => Promise<string | null>
  getVideoDimensions: (videoPath: string) => Promise<{ width: number; height: number } | null>
  getAudioWaveform: (audioPath: string, samples: number) => Promise<number[]>
  getVideoFrames: (videoPath: string, timestamps: number[]) => Promise<string[]>
  getMediaServerPort: () => Promise<number>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
