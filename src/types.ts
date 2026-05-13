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
}

export interface TranslatedSegment extends Segment {
  en: string
  cn: string
}

export interface PipelineState {
  stage: PipelineStage
  progress: number
  overallProgress: number
  videoTitle?: string
  error?: string
  outputPath?: string
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

export type TranscribeMode = 'openai' | 'local-api' | 'local-cli'
export type TranslateMode = 'openai' | 'deepseek' | 'glm'
export type TtsMode = 'edge' | 'openai'
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
  translateMode: TranslateMode
  openaiModel: string
  deepseekApiKey: string
  deepseekModel: string
  glmApiKey: string
  glmModel: string
  ttsMode: TtsMode
}
