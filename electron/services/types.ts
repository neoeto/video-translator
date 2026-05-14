// ─── Pipeline stages ─────────────────────────────────────────────

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

// ─── Node data contracts ────────────────────────────────────────

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  speaker: string
  confidence?: number
}

export interface TranscriptionResult {
  language: string
  segments: TranscriptSegment[]
}

export interface TranslatedSegment {
  start: number
  end: number
  sourceText: string
  targetText: string
  speaker: string
}

export interface TranslationResult {
  sourceLanguage: string
  targetLanguage: string
  segments: TranslatedSegment[]
}

export interface DownloadResult {
  videoPath: string
  title: string
}

export interface AudioResult {
  audioPath: string
}

export interface SynthesisResult {
  audioPath: string
}

export interface CombineResult {
  outputPath: string
}

// ─── Strategy interfaces ────────────────────────────────────────

export interface DownloaderStrategy {
  readonly name: string
  download(input: {
    url: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<DownloadResult>
}

export interface AudioExtractorStrategy {
  readonly name: string
  extract(input: {
    videoPath: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<AudioResult>
}

export interface TranscriberStrategy {
  readonly name: string
  transcribe(input: {
    audioPath: string
    onProgress?: (pct: number) => void
  }): Promise<TranscriptionResult>
}

export interface TranslatorStrategy {
  readonly name: string
  translate(input: {
    segments: TranscriptSegment[]
    sourceLanguage: string
    targetLanguage: string
    onProgress?: (pct: number) => void
  }): Promise<TranslationResult>
}

export interface SynthesizerStrategy {
  readonly name: string
  synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    onProgress: (pct: number) => void
  }): Promise<SynthesisResult>
}

export interface CombinerStrategy {
  readonly name: string
  combine(input: {
    videoPath: string
    audioPath: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
  }): Promise<CombineResult>
}

export interface PipelineStrategies {
  downloader: DownloaderStrategy
  extractor: AudioExtractorStrategy
  transcriber: TranscriberStrategy
  translator: TranslatorStrategy
  synthesizer: SynthesizerStrategy
  combiner: CombinerStrategy
}

// ─── Pipeline state (shared with frontend via IPC) ──────────────

export interface PipelineState {
  stage: PipelineStage
  progress: number
  overallProgress: number
  videoTitle?: string
  error?: string
  outputPath?: string
  translatedSegments?: TranslatedSegment[]
}

// ─── Subtitle style ─────────────────────────────────────────────

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

// ─── Config types ───────────────────────────────────────────────

export type TranscribeMode = 'openai' | 'local-api' | 'local-cli' | 'whisperx'
export type TranslateMode = 'openai' | 'deepseek' | 'glm'
export type TtsMode = 'edge' | 'openai' | 'indextts'
export type Locale = 'en' | 'zh'

export interface ProxyConfig {
  enabled: boolean
  url: string
}

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
  indexttsApiUrl: string
  indexttsReferenceAudio: string
}
