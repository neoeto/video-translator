// ─── Pipeline stages ─────────────────────────────────────────────

export type PipelineStage =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'awaiting-speaker-labels'
  | 'translating'
  | 'synthesizing'
  | 'awaiting-manual-review'
  | 'separating-vocals'
  | 'recombining'
  | 'completed'
  | 'error'

// ─── Video source ───────────────────────────────────────────────

export type VideoSourceType = 'youtube' | 'bilibili' | 'local-file'

// ─── Speaker profile ────────────────────────────────────────────

export type SpeakerGender = 'adult-male' | 'adult-female' | 'child-male' | 'child-female'

export interface SpeakerProfile {
  id: string
  gender: SpeakerGender
  samplePath: string
  sampleDataUrl?: string
}

// ─── Node data contracts ────────────────────────────────────────

export interface WordTimestamp {
  word: string
  start: number
  end: number
  score?: number
  speaker?: string
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  speaker: string
  confidence?: number
  words?: WordTimestamp[]
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
  segmentTimings: { start: number; end: number; actualDuration: number }[]
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
    signal?: AbortSignal
  }): Promise<DownloadResult>
}

export interface AudioExtractorStrategy {
  readonly name: string
  extract(input: {
    videoPath: string
    outputDir: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
  }): Promise<AudioResult>
}

export interface TranscriberStrategy {
  readonly name: string
  transcribe(input: {
    audioPath: string
    onProgress?: (pct: number) => void
    signal?: AbortSignal
  }): Promise<TranscriptionResult>
}

export interface TranslatorStrategy {
  readonly name: string
  translate(input: {
    segments: TranscriptSegment[]
    sourceLanguage: string
    targetLanguage: string
    onProgress?: (pct: number) => void
    signal?: AbortSignal
    syncMode?: SyncMode
  }): Promise<TranslationResult>
  translateText?(text: string, targetLanguage: string): Promise<string>
  summarizeText?(text: string, targetLanguage: string): Promise<string>
}

export type IndexTtsReferenceMode = 'speaker-sample' | 'segment-original'

export interface SynthesizerStrategy {
  readonly name: string
  /** When true, the synthesizer uses speaker voice samples directly (voice cloning) and doesn't need gender labeling. */
  readonly supportsVoiceCloning?: boolean
  synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    speakerProfiles?: SpeakerProfile[]
    onProgress: (pct: number) => void
    signal?: AbortSignal
    syncMode?: SyncMode
    /** Path to the source audio used for segment-original reference extraction (vocals preferred, else raw audio). */
    sourceAudioPath?: string
    /** Original transcript segments aligned with `segments` by index; used to infer speaker runs. */
    originalSegments?: TranscriptSegment[]
  }): Promise<SynthesisResult>
}

export interface CombinerStrategy {
  readonly name: string
  combine(input: {
    videoPath: string
    audioPath?: string
    subtitlePath?: string
    outputPath: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
    speechSegments?: { start: number; end: number }[]
    instrumentalPath?: string
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
  translatedTitle?: string
  error?: string
  outputPath?: string
  thumbnailDataUrl?: string
  completedAt?: number
  translatedSegments?: TranslatedSegment[]
  speakerProfiles?: SpeakerProfile[]
  duration?: number
  sourceType?: VideoSourceType
  summary?: string
  manualReview?: ManualReviewData
}

export interface ManualReviewData {
  videoPath: string
  synthesizedAudioPath: string
  originalAudioPath: string
  segments: TranslatedSegment[]
  segmentTimings: { start: number; end: number; actualDuration: number }[]
  duration: number
}

export interface ManualReviewResult {
  segments: TranslatedSegment[]
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
export type SyncMode = 'natural' | 'strict'
export type PipelineMode = 'full' | 'subtitleOnly'
export type AudioMixMode = 'replace' | 'mix-gate' | 'mix-vocal-removal'
export type ThemeMode = 'dark' | 'light' | 'system'
export type Locale = 'en' | 'zh'
export type SubtitleTrack = 'target' | 'source' | 'none'

// 'auto' 仅用于源语言，表示由 Whisper 自动检测。
export type TranslationLanguage =
  | 'auto'
  | 'en' | 'zh' | 'ja' | 'ko'
  | 'fr' | 'de' | 'es' | 'pt' | 'ru'
  | 'ar' | 'it' | 'th' | 'vi' | 'id'
  | 'tr' | 'pl' | 'uk' | 'nl' | 'hi'

export const TRANSLATION_LANGUAGES: Record<Exclude<TranslationLanguage, 'auto'>, { en: string; zh: string; native: string }> = {
  en: { en: 'English', zh: '英语', native: 'English' },
  zh: { en: 'Chinese', zh: '中文', native: '中文' },
  ja: { en: 'Japanese', zh: '日语', native: '日本語' },
  ko: { en: 'Korean', zh: '韩语', native: '한국어' },
  fr: { en: 'French', zh: '法语', native: 'Français' },
  de: { en: 'German', zh: '德语', native: 'Deutsch' },
  es: { en: 'Spanish', zh: '西班牙语', native: 'Español' },
  pt: { en: 'Portuguese', zh: '葡萄牙语', native: 'Português' },
  ru: { en: 'Russian', zh: '俄语', native: 'Русский' },
  ar: { en: 'Arabic', zh: '阿拉伯语', native: 'العربية' },
  it: { en: 'Italian', zh: '意大利语', native: 'Italiano' },
  th: { en: 'Thai', zh: '泰语', native: 'ไทย' },
  vi: { en: 'Vietnamese', zh: '越南语', native: 'Tiếng Việt' },
  id: { en: 'Indonesian', zh: '印尼语', native: 'Bahasa Indonesia' },
  tr: { en: 'Turkish', zh: '土耳其语', native: 'Türkçe' },
  pl: { en: 'Polish', zh: '波兰语', native: 'Polski' },
  uk: { en: 'Ukrainian', zh: '乌克兰语', native: 'Українська' },
  nl: { en: 'Dutch', zh: '荷兰语', native: 'Nederlands' },
  hi: { en: 'Hindi', zh: '印地语', native: 'हिन्दी' },
}

// 将语言代码映射为 LLM 可理解的英文全称，用于构建翻译提示词。
export function getLanguageDisplayName(code: TranslationLanguage): string {
  if (code === 'auto') return 'Auto'
  return TRANSLATION_LANGUAGES[code]?.en ?? code
}

export interface ProxyConfig {
  enabled: boolean
  url: string
}

export interface AppConfig {
  locale: Locale
  themeMode: ThemeMode
  sourceLanguage: TranslationLanguage
  targetLanguage: TranslationLanguage
  openaiApiKey: string
  outputDir: string
  subtitleStyle: SubtitleStyle
  subtitleMinSplitWidth: number
  subtitleMaxSplitWidth: number
  subtitleSourceMinSplitWidth: number
  subtitleSourceMaxSplitWidth: number
  proxyEnabled: boolean
  proxyUrl: string
  proxyBypass: string
  transcribeMode: TranscribeMode
  localWhisperApiUrl: string
  localWhisperCliPath: string
  whisperxPath: string
  whisperxHfToken: string
  hfMirrorEnabled: boolean
  hfMirrorUrl: string
  translateMode: TranslateMode
  openaiModel: string
  deepseekApiKey: string
  deepseekModel: string
  glmApiKey: string
  glmModel: string
  ttsMode: TtsMode
  syncMode: SyncMode
  pipelineMode: PipelineMode
  audioMixMode: AudioMixMode
  indexttsApiUrl: string
  indexttsReferenceAudio: string
  indexttsReferenceMode: IndexTtsReferenceMode
  audioSeparatorPath: string
  subtitleTrack1: SubtitleTrack
  subtitleTrack2: SubtitleTrack
  manualReviewEnabled: boolean
}
