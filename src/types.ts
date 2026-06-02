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

export type VideoSourceType = 'youtube' | 'bilibili' | 'local-file'

export type SpeakerGender = 'adult-male' | 'adult-female' | 'child-male' | 'child-female'

export interface SpeakerProfile {
  id: string
  gender: SpeakerGender
  samplePath: string
  sampleDataUrl?: string
}

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
export type IndexTtsReferenceMode = 'speaker-sample' | 'segment-original'
export type SyncMode = 'natural' | 'strict'
export type PipelineMode = 'full' | 'subtitleOnly'
export type AudioMixMode = 'replace' | 'mix-gate' | 'mix-vocal-removal'
export type ThemeMode = 'dark' | 'light' | 'system'
export type Locale = 'en' | 'zh'
export type SubtitleTrack = 'target' | 'source' | 'none'

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

export function getLanguageDisplayName(code: TranslationLanguage, uiLocale: Locale = 'en'): string {
  if (code === 'auto') return uiLocale === 'zh' ? '自动检测' : 'Auto Detect'
  return TRANSLATION_LANGUAGES[code]?.[uiLocale] ?? code
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
