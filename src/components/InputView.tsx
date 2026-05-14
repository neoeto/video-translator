import React, { useState } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'

const isValidYoutubeUrl = (url: string) => {
  const regex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}/
  return regex.test(url)
}

export interface InputViewProps {
  onNavigate: (view: string) => void
}

export const InputView: React.FC<InputViewProps> = ({ onNavigate }) => {
  const { config, startPipeline, isLoadingConfig } = usePipelineStore()
  const t = useI18n((s) => s.t)
  const [url, setUrl] = useState('')

  const checkValidation = () => {
    if (!isValidYoutubeUrl(url)) return { valid: false, error: t('input.validation.invalidUrl'), isConfigError: false }

    // 只校验当前启用链路需要的 Key，避免未使用服务的空配置阻塞任务启动。
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
    if (config.ttsMode === 'openai' && !config.openaiApiKey) {
      return { valid: false, error: t('input.validation.openaiTtsKeyRequired'), isConfigError: true }
    }
    if (config.ttsMode === 'indextts' && !config.indexttsApiUrl) {
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
      startPipeline(url)
    }
  }

  if (isLoadingConfig) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl mx-auto pt-24 px-6">
      <div className="text-center mb-10">
        <h1 className="text-[32px] font-bold text-on-surface leading-[40px] tracking-tight mb-3">
          {t('input.heading')}
        </h1>
        <p className="text-lg text-outline">
          {t('input.description')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="relative w-full max-w-2xl mx-auto">
        <div className="relative flex items-center w-full bg-[#181818] border border-[#333333] rounded-xl focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all p-1.5 sharp-shadow">
          <div className="pl-4 pr-3 flex items-center justify-center text-outline">
            <span className="material-symbols-outlined">link</span>
          </div>
          
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('input.urlPlaceholder')}
            className="flex-1 bg-transparent border-none text-on-surface text-base py-3 outline-none placeholder:text-outline-variant"
          />
          
          <button
            type="submit"
            disabled={!url}
            className={`ml-2 px-6 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
              url
                ? 'bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container'
                : 'bg-surface-variant text-outline cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-[20px]">translate</span>
            {t('input.translate')}
          </button>
        </div>

        {!isFormValid && url && validationError && (
          <div className="mt-4 px-4 py-3 bg-error-container/20 border border-error-container rounded-lg flex items-start gap-3">
            <span className="material-symbols-outlined text-error text-[20px] mt-0.5">error</span>
            <div className="flex-1 text-sm text-error flex items-center">
              {validationError}
              {isConfigError && (
                <button
                  type="button"
                  onClick={() => onNavigate('settings')}
                  className="ml-2 underline font-medium hover:text-error-container"
                >
                  {t('input.goToSettings')}
                </button>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
