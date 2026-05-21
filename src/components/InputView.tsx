import React, { useState, useCallback } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'
import { TRANSLATION_LANGUAGES, getLanguageDisplayName, type TranslationLanguage, type VideoSourceType } from '../types'

const URL_PREFIXES: Record<string, string> = {
  youtube: 'https://www.youtube.com/watch?v=',
  bilibili: 'https://www.bilibili.com/video/',
}

/** Extract video ID from a full URL, or return input as-is if it's already just an ID */
function extractVideoId(input: string, sourceType: VideoSourceType): string {
  const trimmed = input.trim()
  if (sourceType === 'youtube') {
    const m = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/)
    if (m) return m[1]
  } else if (sourceType === 'bilibili') {
    const m = trimmed.match(/bilibili\.com\/video\/(BV[\w]+|av\d+)/)
    if (m) return m[1]
  }
  return trimmed
}

/** Build full URL from video ID */
function buildFullUrl(videoId: string, sourceType: VideoSourceType): string {
  const prefix = URL_PREFIXES[sourceType]
  if (!prefix || !videoId) return videoId
  if (videoId.startsWith('http://') || videoId.startsWith('https://')) return videoId
  return prefix + videoId
}

const isValidYoutubeUrl = (url: string) => {
  const regex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}/
  return regex.test(url)
}

const isValidBilibiliUrl = (url: string) => {
  const regex = /^(https?:\/\/)?(www\.)?(bilibili\.com\/video\/)(BV[\w]+|av\d+)/
  return regex.test(url)
}

const SOURCE_LANGUAGE_OPTIONS: TranslationLanguage[] = [
  'auto', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru',
  'ar', 'it', 'th', 'vi', 'id', 'tr', 'pl', 'uk', 'nl', 'hi',
]

const TARGET_LANGUAGE_OPTIONS: Exclude<TranslationLanguage, 'auto'>[] = [
  'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru',
  'ar', 'it', 'th', 'vi', 'id', 'tr', 'pl', 'uk', 'nl', 'hi',
]

const SOURCE_TYPE_OPTIONS: { value: VideoSourceType; icon: string; labelKey: string }[] = [
  { value: 'youtube', icon: 'smart_display', labelKey: 'input.sourceYoutube' },
  { value: 'bilibili', icon: 'play_circle', labelKey: 'input.sourceBilibili' },
  { value: 'local-file', icon: 'folder_open', labelKey: 'input.sourceLocalFile' },
]

export interface InputViewProps {
  onNavigate: (view: string) => void
}

export const InputView: React.FC<InputViewProps> = ({ onNavigate }) => {
  const { config, saveConfig, startPipeline, isLoadingConfig } = usePipelineStore()
  const t = useI18n((s) => s.t)
  const [videoId, setVideoId] = useState('')
  const [localFilePath, setLocalFilePath] = useState('')
  const [sourceType, setSourceType] = useState<VideoSourceType>('youtube')

  const hasInput = sourceType === 'local-file' ? !!localFilePath : !!videoId

  /** Handle paste — auto-extract video ID from full URL */
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim()
    const extracted = extractVideoId(pasted, sourceType)
    if (extracted !== pasted) {
      e.preventDefault()
      setVideoId(extracted)
    }
  }, [sourceType])

  const checkValidation = () => {
    if (sourceType === 'youtube') {
      const fullUrl = buildFullUrl(videoId, sourceType)
      if (!isValidYoutubeUrl(fullUrl)) return { valid: false, error: t('input.validation.invalidUrl'), isConfigError: false }
    } else if (sourceType === 'bilibili') {
      const fullUrl = buildFullUrl(videoId, sourceType)
      if (!isValidBilibiliUrl(fullUrl)) return { valid: false, error: t('input.validation.invalidBilibiliUrl'), isConfigError: false }
    } else if (sourceType === 'local-file') {
      if (!localFilePath) return { valid: false, error: t('input.validation.noFileSelected'), isConfigError: false }
    }

    if (config.transcribeMode === 'openai' && !config.openaiApiKey) {
      return { valid: false, error: t('input.validation.openaiSpeechKeyRequired'), isConfigError: true }
    }
    if (config.translateMode === 'openai' && !config.openaiApiKey) {
      return { valid: false, error: t('input.validation.openaiTranslationKeyRequired'), isConfigError: true }
    }
    if (config.translateMode === 'deepseek' && !config.deepseekApiKey) {
      return { valid: false, error: t('input.validation.deepseekKeyRequired'), isConfigError: true }
    }
    if (config.translateMode === 'glm' && !config.glmApiKey) {
      return { valid: false, error: t('input.validation.glmKeyRequired'), isConfigError: true }
    }
    if (config.pipelineMode !== 'subtitleOnly' && config.ttsMode === 'openai' && !config.openaiApiKey) {
      return { valid: false, error: t('input.validation.openaiTtsKeyRequired'), isConfigError: true }
    }
    if (config.pipelineMode !== 'subtitleOnly' && config.ttsMode === 'indextts' && !config.indexttsApiUrl) {
      return { valid: false, error: t('input.validation.indexttsApiUrlRequired'), isConfigError: true }
    }
    if (config.transcribeMode === 'whisperx') {
      if (!config.whisperxPath) {
        return { valid: false, error: t('input.validation.whisperxPathRequired'), isConfigError: true }
      }
      if (!config.whisperxHfToken) {
        return { valid: false, error: t('input.validation.whisperxHfTokenRequired'), isConfigError: true }
      }
    }

    return { valid: true, error: null, isConfigError: false }
  }

  const { valid: isFormValid, error: validationError, isConfigError } = checkValidation()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isFormValid) {
      if (sourceType === 'local-file') {
        startPipeline(localFilePath, sourceType)
      } else {
        startPipeline(buildFullUrl(videoId, sourceType), sourceType)
      }
    }
  }

  const handleSelectFile = async () => {
    const file = await window.electronAPI.selectVideoFile()
    if (file) {
      setLocalFilePath(file)
    }
  }

  if (isLoadingConfig) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  const getDescription = () => {
    if (sourceType === 'bilibili') return t('input.descriptionBilibili')
    if (sourceType === 'local-file') return t('input.descriptionLocalFile')
    return t('input.descriptionYoutube')
  }

  const getIdPlaceholder = () => {
    if (sourceType === 'bilibili') return t('input.urlPlaceholderBilibili')
    return t('input.urlPlaceholder')
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-6 h-full flex flex-col justify-center">
      <div className="text-center mb-8">
        <h1 className="text-[32px] font-bold text-on-surface leading-[40px] tracking-tight mb-2">
          {t('input.heading')}
        </h1>
        <p className="text-base text-outline">
          {getDescription()}
        </p>
      </div>

      {/* 管道模式 + 语言选择 — 同一行 */}
      <div className="flex justify-center items-center gap-4 mb-6 flex-wrap">
        <div className="inline-flex bg-[#181818] border border-[#333333] rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => saveConfig({ pipelineMode: 'full' })}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
              config.pipelineMode !== 'subtitleOnly'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-outline hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">record_voice_over</span>
            {t('pipeline.modeFull')}
          </button>
          <button
            type="button"
            onClick={() => saveConfig({ pipelineMode: 'subtitleOnly' })}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${
              config.pipelineMode === 'subtitleOnly'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-outline hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">subtitles</span>
            {t('pipeline.modeSubtitleOnly')}
          </button>
        </div>

        <span className="text-[#333333] text-lg select-none">|</span>

        <div className="flex items-center gap-2">
          <select
            value={config.sourceLanguage}
            onChange={(e) => saveConfig({ sourceLanguage: e.target.value as TranslationLanguage })}
            className="bg-[#181818] border border-[#333333] text-on-surface rounded-lg px-2.5 py-1.5 text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none cursor-pointer"
          >
            {SOURCE_LANGUAGE_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code === 'auto'
                  ? t('input.autoDetect')
                  : `${TRANSLATION_LANGUAGES[code].native} (${getLanguageDisplayName(code, config.locale)})`
                }
              </option>
            ))}
          </select>

          <span className="material-symbols-outlined text-primary text-[18px]">arrow_forward</span>

          <select
            value={config.targetLanguage}
            onChange={(e) => saveConfig({ targetLanguage: e.target.value as TranslationLanguage })}
            className="bg-[#181818] border border-[#333333] text-on-surface rounded-lg px-2.5 py-1.5 text-xs focus:border-primary focus:ring-1 focus:ring-primary outline-none cursor-pointer"
          >
            {TARGET_LANGUAGE_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {`${TRANSLATION_LANGUAGES[code].native} (${getLanguageDisplayName(code, config.locale)})`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 输入框 — 来源类型前缀下拉 + URL 前缀 */}
      <form onSubmit={handleSubmit} className="relative w-full max-w-2xl mx-auto">
        <div className="relative flex items-center w-full bg-[#181818] border border-[#333333] rounded-xl focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all p-1.5 sharp-shadow">
          {/* 来源类型前缀下拉 */}
          <div className="relative shrink-0">
            <select
              value={sourceType}
              onChange={(e) => {
                setSourceType(e.target.value as VideoSourceType)
                setVideoId('')
                setLocalFilePath('')
              }}
              className="appearance-none bg-surface-variant text-on-surface rounded-lg pl-3 pr-7 py-3 text-sm font-semibold cursor-pointer outline-none hover:bg-outline-variant transition-colors"
            >
              {SOURCE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
              ))}
            </select>
            <span className="material-symbols-outlined text-[16px] text-outline absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
              expand_more
            </span>
          </div>

          <div className="w-px h-6 bg-[#333333] mx-1.5 shrink-0" />

          {sourceType === 'local-file' ? (
            /* 本地文件选择 */
            <>
              <div
                className="flex-1 py-3 px-2 min-w-0 cursor-pointer"
                onClick={handleSelectFile}
              >
                {localFilePath ? (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-outline">description</span>
                    <span className="text-on-surface text-sm truncate">{localFilePath.split('/').pop()}</span>
                  </div>
                ) : (
                  <span className="text-outline-variant text-sm">{t('input.selectFile')}</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleSelectFile}
                className="shrink-0 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors bg-surface-variant text-on-surface hover:bg-outline-variant flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">folder_open</span>
                {t('input.selectFile')}
              </button>
            </>
          ) : (
            /* URL 输入 — 带固定前缀 */
            <div className="flex-1 flex items-center min-w-0">
              <span className="text-outline text-sm shrink-0 select-none pl-1">{URL_PREFIXES[sourceType]}</span>
              <input
                type="text"
                value={videoId}
                onChange={(e) => setVideoId(e.target.value)}
                onPaste={handlePaste}
                placeholder={getIdPlaceholder()}
                className="flex-1 bg-transparent border-none text-on-surface text-sm py-3 px-1 outline-none placeholder:text-outline-variant min-w-0"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!hasInput}
            className={`shrink-0 ml-1.5 px-5 py-2.5 rounded-lg font-semibold text-sm transition-colors flex items-center gap-1.5 ${
              hasInput
                ? 'bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container'
                : 'bg-surface-variant text-outline cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">translate</span>
            {t('input.translate')}
          </button>
        </div>

        {!isFormValid && hasInput && validationError && (
          <div className="mt-3 px-4 py-2.5 bg-error-container/20 border border-error-container rounded-lg flex items-center gap-2">
            <span className="material-symbols-outlined text-error text-[18px]">error</span>
            <span className="text-sm text-error">{validationError}</span>
            {isConfigError && (
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="ml-auto text-sm underline font-medium text-error hover:text-error-container"
              >
                {t('input.goToSettings')}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  )
}
