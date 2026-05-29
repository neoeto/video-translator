import React, { useState, useEffect, useCallback } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'
import { getLanguageDisplayName, type TranslationLanguage } from '../types'
import type { HistoryEntry } from '../preload'
import { ConfirmDialog } from './ConfirmDialog'

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

interface ResultViewProps {
  onNavigate: (view: string, params?: { entryId?: string }) => void
}

export const ResultView: React.FC<ResultViewProps> = ({ onNavigate }) => {
  const { state, config, reset } = usePipelineStore()
  const t = useI18n((s) => s.t)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [confirmAction, setConfirmAction] = useState<{ message: string; action: () => void } | null>(null)

  const requestConfirm = useCallback((message: string, action: () => void) => {
    setConfirmAction({ message, action })
  }, [])

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
                  onClick={() => requestConfirm(t('result.confirmDelete'), () => handleDeleteHistory(entry.id))}
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
                onClick={() => onNavigate('detail', { entryId: entry.id })}
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

      <ConfirmDialog
        open={!!confirmAction}
        message={confirmAction?.message ?? ''}
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
