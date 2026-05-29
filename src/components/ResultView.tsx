import React, { useState, useEffect } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'
import { getLanguageDisplayName, type TranslationLanguage } from '../types'
import type { HistoryEntry } from '../preload'

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `[${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}]`
}

function formatCompletedAt(timestamp: number | undefined): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '--:--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function getSourceLabel(sourceType: string | undefined, t: (key: string) => string): string {
  switch (sourceType) {
    case 'youtube': return t('result.detail.sourceYoutube')
    case 'bilibili': return t('result.detail.sourceBilibili')
    case 'local-file': return t('result.detail.sourceLocalFile')
    default: return '--'
  }
}

function isRemoteSource(sourceType: string | undefined): boolean {
  return sourceType === 'youtube' || sourceType === 'bilibili'
}

function getOriginalLink(sourceType: string | undefined, sourceUrl: string | undefined): string | null {
  if (!isRemoteSource(sourceType)) return null
  const url = sourceUrl?.trim()
  return url ? url : null
}

function generateSummary(segments: { sourceText: string }[] | undefined): string {
  if (!segments || segments.length === 0) return ''
  const text = segments.map(s => s.sourceText).join(' ')
  return text.length > 200 ? text.slice(0, 200) + '...' : text
}

export const ResultView: React.FC = () => {
  const { state, config, reset } = usePipelineStore()
  const t = useI18n((s) => s.t)
  const [showSegments, setShowSegments] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null)

  useEffect(() => {
    window.electronAPI.getHistory().then(setHistory).catch(() => {})
  }, [state.stage])

  const handleDeleteHistory = async (id: string) => {
    await window.electronAPI.deleteHistory(id)
    setHistory((prev) => prev.filter((e) => e.id !== id))
  }

  const handleOpenVideo = (filePath: string) => {
    window.electronAPI.openPath(filePath)
  }

  const handleShowInFolder = (filePath: string) => {
    window.electronAPI.showItemInFolder(filePath).catch((err) => {
      console.error('Failed to show in folder:', err)
    })
  }

  const handleOpenOriginalLink = (url: string) => {
    window.electronAPI.openExternal(url).catch((error) => {
      console.error('Failed to open original link', { url, error })
    })
  }

  const selectedEntryOriginalLink = selectedEntry
    ? getOriginalLink(selectedEntry.sourceType, selectedEntry.sourceUrl)
    : null

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
        {history.map((entry) => (
          <div
            key={entry.id}
            className="bg-surface-container rounded-xl border border-surface-variant overflow-hidden group hover:border-outline-variant transition-colors sharp-shadow flex flex-col"
          >
            <div className="aspect-video bg-surface-variant relative overflow-hidden">
              {entry.thumbnailDataUrl ? (
                <img src={entry.thumbnailDataUrl} alt={entry.videoTitle} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[48px] text-outline opacity-50 group-hover:scale-110 transition-transform duration-500">movie</span>
                </div>
              )}

              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                <button
                  onClick={() => handleOpenVideo(entry.outputPath)}
                  className="w-12 h-12 rounded-full bg-primary text-on-primary flex items-center justify-center hover:scale-105 transition-transform"
                  title={t('result.playVideo')}
                >
                  <span className="material-symbols-outlined text-[24px]">play_arrow</span>
                </button>
                <button
                  onClick={() => handleShowInFolder(entry.outputPath)}
                  className="w-12 h-12 rounded-full bg-surface-variant text-on-surface flex items-center justify-center hover:scale-105 transition-transform"
                  title={t('result.showInFolder')}
                >
                  <span className="material-symbols-outlined text-[24px]">folder_open</span>
                </button>
                <button
                  onClick={() => handleDeleteHistory(entry.id)}
                  className="w-12 h-12 rounded-full bg-surface-variant text-on-surface flex items-center justify-center hover:bg-error-container transition-colors"
                  title={t('result.delete')}
                >
                  <span className="material-symbols-outlined text-[24px]">delete</span>
                </button>
              </div>

              <div className="absolute bottom-2 right-2 px-2 py-1 bg-surface-container-highest/80 rounded text-[11px] font-mono text-on-surface-variant">
                {formatCompletedAt(entry.completedAt)}
              </div>

              {entry.duration != null && entry.duration > 0 && (
                <div className="absolute bottom-2 left-2 px-2 py-1 bg-surface-container-highest/80 rounded text-[11px] font-mono text-on-surface-variant">
                  {formatDuration(entry.duration)}
                </div>
              )}
            </div>

            <div className="p-4 flex flex-col gap-2">
              <h3
                className="font-bold text-on-surface line-clamp-2 leading-tight cursor-pointer hover:text-primary transition-colors"
                title={entry.videoTitle}
                onClick={() => setSelectedEntry(entry)}
              >
                {entry.videoTitle}
              </h3>
              {entry.translatedTitle && (
                <p className="text-sm text-on-surface-variant line-clamp-1" title={entry.translatedTitle}>
                  {entry.translatedTitle}
                </p>
              )}
              <div className="flex items-center justify-between mt-auto pt-2">
                <span className="px-2 py-0.5 bg-surface-variant rounded text-xs font-mono text-outline">
                  {getLanguageDisplayName((entry.sourceLanguage || config.sourceLanguage) as TranslationLanguage, config.locale)} → {getLanguageDisplayName((entry.targetLanguage || config.targetLanguage) as TranslationLanguage, config.locale)}
                </span>
              </div>
            </div>
          </div>
        ))}

        {history.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16 text-outline">
            <span className="material-symbols-outlined text-[48px] mb-4 opacity-50">video_library</span>
            <p className="text-sm">{t('result.noHistory')}</p>
          </div>
        )}
      </div>

      {showSegments && state.translatedSegments && (
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
                      <span>{segment.sourceText}</span>
                    </div>
                    <div className="flex gap-4 text-on-surface">
                      <span className="text-outline shrink-0 opacity-0">{formatTime(segment.start)}</span>
                      <span className="text-primary-fixed-dim">{segment.targetText}</span>
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

      {selectedEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedEntry(null)}>
          <div
            className="bg-surface-container rounded-xl border border-surface-variant w-full max-w-2xl max-h-[80vh] overflow-y-auto sharp-shadow mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-surface-variant">
              <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined">info</span>
                {t('result.detail.title')}
              </h2>
              <button onClick={() => setSelectedEntry(null)} className="text-outline hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6 border-b border-surface-variant">
              <h3 className="text-xl font-bold text-on-surface mb-1">{selectedEntry.videoTitle}</h3>
              {selectedEntry.translatedTitle && (
                <p className="text-sm text-on-surface-variant">{selectedEntry.translatedTitle}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 p-6 border-b border-surface-variant text-sm">
              <div>
                <span className="text-outline block mb-1">{t('result.detail.source')}</span>
                <span className="text-on-surface">{getSourceLabel(selectedEntry.sourceType, t)}</span>
              </div>
              <div>
                <span className="text-outline block mb-1">{t('result.detail.originalLink')}</span>
                {selectedEntryOriginalLink ? (
                  <button
                    type="button"
                    onClick={() => handleOpenOriginalLink(selectedEntryOriginalLink)}
                    className="text-primary hover:underline text-left break-all"
                  >
                    {selectedEntryOriginalLink}
                  </button>
                ) : (
                  <span className="text-on-surface">--</span>
                )}
              </div>
              <div>
                <span className="text-outline block mb-1">{t('result.detail.duration')}</span>
                <span className="text-on-surface font-mono">{formatDuration(selectedEntry.duration)}</span>
              </div>
              <div>
                <span className="text-outline block mb-1">{t('result.detail.fileSize')}</span>
                <span className="text-on-surface font-mono">{formatFileSize(selectedEntry.fileSize)}</span>
              </div>
              <div>
                <span className="text-outline block mb-1">{t('result.detail.language')}</span>
                <span className="text-on-surface">
                  {getLanguageDisplayName((selectedEntry.sourceLanguage || config.sourceLanguage) as TranslationLanguage, config.locale)} → {getLanguageDisplayName((selectedEntry.targetLanguage || config.targetLanguage) as TranslationLanguage, config.locale)}
                </span>
              </div>
              <div>
                <span className="text-outline block mb-1">{t('result.detail.generatedAt')}</span>
                <span className="text-on-surface font-mono">{formatCompletedAt(selectedEntry.completedAt)}</span>
              </div>
              <div>
                <span className="text-outline block mb-1">{t('result.detail.pipelineMode')}</span>
                <span className="text-on-surface">
                  {selectedEntry.pipelineMode === 'subtitleOnly' ? t('result.detail.modeSubtitleOnly') : t('result.detail.modeFull')}
                </span>
              </div>
            </div>

            {(selectedEntry.summary || (selectedEntry.translatedSegments && selectedEntry.translatedSegments.length > 0)) && (
              <div className="p-6 border-b border-surface-variant">
                <h4 className="text-sm text-outline mb-2">{t('result.detail.summary')}</h4>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  {selectedEntry.summary || generateSummary(selectedEntry.translatedSegments)}
                </p>
              </div>
            )}

            <div className="p-6">
              <h4 className="text-sm text-outline mb-3">{t('result.detail.subtitles')}</h4>
              {selectedEntry.translatedSegments && selectedEntry.translatedSegments.length > 0 ? (
                <div className="bg-surface-container-lowest rounded-lg p-4 max-h-[300px] overflow-y-auto font-mono text-sm border border-outline-variant">
                  <div className="flex flex-col gap-2">
                    {selectedEntry.translatedSegments.map((segment, index) => (
                      <div
                        key={index}
                        className={`py-2 px-3 rounded flex flex-col gap-1 ${index % 2 === 0 ? 'bg-surface-variant/50' : 'bg-transparent'}`}
                      >
                        <div className="flex gap-4 text-on-surface-variant">
                          <span className="text-outline shrink-0">{formatTime(segment.start)}</span>
                          <span>{segment.sourceText}</span>
                        </div>
                        <div className="flex gap-4 text-on-surface">
                          <span className="text-outline shrink-0 opacity-0">{formatTime(segment.start)}</span>
                          <span className="text-primary-fixed-dim">{segment.targetText}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-outline italic">{t('result.detail.noSubtitles')}</p>
              )}
            </div>

            <div className="p-6 border-t border-surface-variant flex gap-3">
              <button
                onClick={() => handleOpenVideo(selectedEntry.outputPath)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                {t('result.playVideo')}
              </button>
              <button
                onClick={() => handleShowInFolder(selectedEntry.outputPath)}
                className="flex items-center gap-2 px-4 py-2 bg-surface-variant text-on-surface rounded-lg hover:bg-surface-container-highest transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">folder_open</span>
                {t('result.showInFolder')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
