export type PipelineStage =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'translating'
  | 'synthesizing'
  | 'recombining'
  | 'completed'
  | 'error'

export interface Segment {
  start: number
  end: number
  text: string
  speaker: string
}

export interface TranslatedSegment {
  start: number
  end: number
  sourceText: string
  targetText: string
  speaker: string
}

export interface PipelineState {
  stage: PipelineStage
  progress: number
  overallProgress: number
  videoTitle?: string
  error?: string
  outputPath?: string
  thumbnailDataUrl?: string
  completedAt?: number
  translatedSegments?: TranslatedSegment[]
}

export interface SubtitleStyle {
  enFontSize: number
  cnFontSize: number
  enColor: string
  cnColor: string
  enPosition: 'top' | 'bottom'
  cnPosition: 'top' | 'bottom'
  bgColor: string
  bgOpacity: number
  fontFamily: string
}

export type TranscribeMode = 'openai' | 'local-api' | 'local-cli' | 'whisperx'
export type TranslateMode = 'openai' | 'deepseek' | 'glm'
export type TtsMode = 'edge' | 'openai' | 'indextts'
export type SyncMode = 'natural' | 'strict'
export type PipelineMode = 'full' | 'subtitleOnly'
export type Locale = 'en' | 'zh'

export interface AppConfig {
  locale: Locale
  openaiApiKey: string
  outputDir: string
  subtitleStyle: SubtitleStyle
  proxyEnabled: boolean
  proxyUrl: string
  transcribeMode: TranscribeMode
  localWhisperApiUrl: string
  localWhisperCliPath: string
  whisperxPath: string
  whisperxHfToken: string
  translateMode: TranslateMode
  openaiModel: string
  deepseekApiKey: string
  deepseekModel: string
  glmApiKey: string
  glmModel: string
  ttsMode: TtsMode
  syncMode: SyncMode
  pipelineMode: PipelineMode
  indexttsApiUrl: string
  indexttsReferenceAudio: string
}
