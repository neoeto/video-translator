import React, { useState } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `[${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}]`
}

export const ResultView: React.FC = () => {
  const { state, config, reset } = usePipelineStore()
  const t = useI18n((s) => s.t)
  const [showSegments, setShowSegments] = useState(false)

  const handleOpenDir = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (config.outputDir) {
      window.electronAPI.openPath(config.outputDir)
    }
  }

  const handlePlayVideo = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (state.outputPath) {
      window.electronAPI.openPath(state.outputPath)
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto pt-10 px-6 pb-12">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-on-surface">{t('result.heading')}</h1>
        <button
          onClick={reset}
          className="px-5 py-2 bg-surface-variant hover:bg-outline-variant text-on-surface rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          {t('result.newTranslation')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
        <div 
          className="bg-surface-container rounded-xl border border-surface-variant overflow-hidden group hover:border-outline-variant transition-colors sharp-shadow flex flex-col"
        >
          <div className="aspect-video bg-surface-variant relative overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-[48px] text-outline opacity-50 group-hover:scale-110 transition-transform duration-500">movie</span>
            </div>
            
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
              <button 
                onClick={handlePlayVideo}
                disabled={!state.outputPath}
                className="w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
                title={t('result.playVideo')}
              >
                <span className="material-symbols-outlined text-[24px]">play_arrow</span>
              </button>
              <button 
                onClick={handleOpenDir}
                className="w-12 h-12 rounded-full bg-surface-variant text-on-surface flex items-center justify-center hover:bg-outline-variant transition-colors"
                title={t('result.openDirectory')}
              >
                <span className="material-symbols-outlined text-[24px]">folder_open</span>
              </button>
            </div>

            <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 rounded text-[11px] font-mono text-on-surface">
              {t('result.justNow')}
            </div>
          </div>

          <div className="p-4 flex flex-col gap-2">
            <h3 className="font-bold text-on-surface line-clamp-2 leading-tight" title={state.videoTitle || t('result.translatedVideo')}>
              {state.videoTitle || t('result.translatedVideo')}
            </h3>
            
            <div className="flex items-center justify-between mt-auto pt-2">
              <span className="px-2 py-0.5 bg-surface-variant rounded text-xs font-mono text-outline">
                {t('result.languagePair')}
              </span>
              <button 
                onClick={() => setShowSegments(!showSegments)}
                className="text-xs font-semibold text-primary hover:text-primary-container uppercase tracking-wider"
              >
                {showSegments ? t('result.hideDetails') : t('result.viewDetails')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSegments && (
        <div className="bg-surface-container rounded-xl border border-surface-variant p-6 sharp-shadow">
          <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined">subtitles</span>
            {t('result.translatedSegments')}
          </h3>
          <div className="bg-surface-container-lowest rounded-lg p-4 max-h-[400px] overflow-y-auto font-mono text-sm border border-outline-variant">
            {state.translatedSegments && state.translatedSegments.length > 0 ? (
              <div className="flex flex-col gap-2">
                {state.translatedSegments.map((segment, index) => (
                  <div 
                    key={index} 
                    className={`py-3 px-3 rounded flex flex-col gap-1 ${index % 2 === 0 ? 'bg-surface-variant/50' : 'bg-transparent'}`}
                  >
                    <div className="flex gap-4 text-on-surface-variant">
                      <span className="text-outline shrink-0">{formatTime(segment.start)}</span>
                      <span>{segment.en}</span>
                    </div>
                    <div className="flex gap-4 text-on-surface">
                      <span className="text-outline shrink-0 opacity-0">{formatTime(segment.start)}</span>
                      <span className="text-primary-fixed-dim">{segment.cn}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-outline italic">
                {t('result.noSegments')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
