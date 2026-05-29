import React, { useState, useEffect, useCallback } from 'react'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'
import { getLanguageDisplayName, type TranslationLanguage } from '../types'
import type { HistoryEntry } from '../preload'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportDialog } from './ExportDialog'

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

interface VideoDetailViewProps {
  entryId: string
  onNavigate: (view: string) => void
}

export const VideoDetailView: React.FC<VideoDetailViewProps> = ({ entryId, onNavigate }) => {
  const { config } = usePipelineStore()
  const t = useI18n((s) => s.t)
  const [entry, setEntry] = useState<HistoryEntry | null>(null)
  const [resolution, setResolution] = useState<string | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ message: string; action: () => void } | null>(null)

  useEffect(() => {
    window.electronAPI.getHistory().then((history) => {
      const found = history.find((e) => e.id === entryId)
      setEntry(found ?? null)
    }).catch(() => {})
  }, [entryId])

  useEffect(() => {
    if (!entry?.outputPath) return
    window.electronAPI.getVideoDimensions(entry.outputPath).then((dims) => {
      if (dims) setResolution(`${dims.width}×${dims.height}`)
    }).catch(() => {})
  }, [entry?.outputPath])

  const handleOpenVideo = useCallback((filePath: string) => {
    window.electronAPI.openPath(filePath)
  }, [])

  const handleShowInFolder = useCallback((filePath: string) => {
    window.electronAPI.showItemInFolder(filePath).catch((err) => {
      console.error('Failed to show in folder:', err)
    })
  }, [])

  const handleOpenOriginalLink = useCallback((url: string) => {
    window.electronAPI.openExternal(url).catch((error) => {
      console.error('Failed to open original link', { url, error })
    })
  }, [])

  const handleDelete = useCallback(async () => {
    await window.electronAPI.deleteHistory(entryId)
    onNavigate('library')
  }, [entryId, onNavigate])

  if (!entry) {
    return (
      <div className="w-full max-w-5xl mx-auto pt-10 px-6 pb-12 flex items-center justify-center min-h-[400px]">
        <span className="text-outline">{t('result.noHistory')}</span>
      </div>
    )
  }

  const originalLink = getOriginalLink(entry.sourceType, entry.sourceUrl)

  return (
    <div className="w-full max-w-5xl mx-auto pt-10 px-6 pb-12">
      {/* Back button */}
      <button
        onClick={() => onNavigate('library')}
        className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors mb-6"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        {t('result.heading')}
      </button>

      {/* Header section */}
      <div className="flex gap-6 mb-8">
        {/* Thumbnail */}
        <div className="w-80 aspect-video rounded-xl overflow-hidden bg-surface-variant shrink-0">
          {entry.thumbnailDataUrl ? (
            <img src={entry.thumbnailDataUrl} alt={entry.videoTitle} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="material-symbols-outlined text-[48px] text-outline opacity-50">movie</span>
            </div>
          )}
        </div>

        {/* Title & actions */}
        <div className="flex flex-col justify-between flex-1 min-w-0">
          <div>
            <h1 className="text-2xl font-bold text-on-surface mb-1 leading-tight">{entry.videoTitle}</h1>
            {entry.translatedTitle && (
              <p className="text-base text-on-surface-variant">{entry.translatedTitle}</p>
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => handleOpenVideo(entry.outputPath)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-opacity text-sm font-medium"
            >
              <span className="material-symbols-outlined text-[18px]">play_arrow</span>
              {t('result.playVideo')}
            </button>
            <button
              onClick={() => handleShowInFolder(entry.outputPath)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-variant text-on-surface rounded-lg hover:bg-surface-container-highest transition-colors text-sm font-medium"
            >
              <span className="material-symbols-outlined text-[18px]">folder_open</span>
              {t('result.showInFolder')}
            </button>
            <button
              onClick={() => setShowExport(true)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-variant text-on-surface rounded-lg hover:bg-surface-container-highest transition-colors text-sm font-medium"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              {t('export.button')}
            </button>
            <button
              onClick={() => setConfirmAction({ message: t('result.confirmDelete'), action: handleDelete })}
              className="flex items-center gap-2 px-4 py-2 bg-surface-variant text-on-surface rounded-lg hover:bg-error-container transition-colors text-sm font-medium ml-auto"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              {t('result.delete')}
            </button>
          </div>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="bg-surface-container rounded-xl border border-surface-variant p-6 mb-6 sharp-shadow">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
          <div>
            <span className="text-outline block mb-1">{t('result.detail.source')}</span>
            <span className="text-on-surface">{getSourceLabel(entry.sourceType, t)}</span>
          </div>
          <div>
            <span className="text-outline block mb-1">{t('result.detail.duration')}</span>
            <span className="text-on-surface font-mono">{formatDuration(entry.duration)}</span>
          </div>
          <div>
            <span className="text-outline block mb-1">{t('result.detail.fileSize')}</span>
            <span className="text-on-surface font-mono">{formatFileSize(entry.fileSize)}</span>
          </div>
          <div>
            <span className="text-outline block mb-1">{t('result.detail.language')}</span>
            <span className="text-on-surface">
              {getLanguageDisplayName((entry.sourceLanguage || config.sourceLanguage) as TranslationLanguage, config.locale)} → {getLanguageDisplayName((entry.targetLanguage || config.targetLanguage) as TranslationLanguage, config.locale)}
            </span>
          </div>
          <div>
            <span className="text-outline block mb-1">{t('result.detail.generatedAt')}</span>
            <span className="text-on-surface font-mono">{formatCompletedAt(entry.completedAt)}</span>
          </div>
          <div>
            <span className="text-outline block mb-1">{t('result.detail.pipelineMode')}</span>
            <span className="text-on-surface">
              {entry.pipelineMode === 'subtitleOnly' ? t('result.detail.modeSubtitleOnly') : t('result.detail.modeFull')}
            </span>
          </div>
          <div>
            <span className="text-outline block mb-1">{t('result.detail.resolution')}</span>
            <span className="text-on-surface font-mono">{resolution ?? '--'}</span>
          </div>
          {originalLink && (
            <div className="col-span-2">
              <span className="text-outline block mb-1">{t('result.detail.originalLink')}</span>
              <button
                type="button"
                onClick={() => handleOpenOriginalLink(originalLink)}
                className="text-primary hover:underline text-left break-all"
              >
                {originalLink}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      {(entry.summary || (entry.translatedSegments && entry.translatedSegments.length > 0)) && (
        <div className="bg-surface-container rounded-xl border border-surface-variant p-6 mb-6 sharp-shadow">
          <h4 className="text-sm text-outline mb-2">{t('result.detail.summary')}</h4>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {entry.summary || generateSummary(entry.translatedSegments)}
          </p>
        </div>
      )}

      {/* Subtitles */}
      <div className="bg-surface-container rounded-xl border border-surface-variant p-6 sharp-shadow">
        <h4 className="text-sm text-outline mb-3">{t('result.detail.subtitles')}</h4>
        {entry.translatedSegments && entry.translatedSegments.length > 0 ? (
          <div className="bg-surface-container-lowest rounded-lg p-4 max-h-[400px] overflow-y-auto font-mono text-sm border border-outline-variant">
            <div className="flex flex-col gap-2">
              {entry.translatedSegments.map((segment, index) => (
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

      {/* Export Dialog */}
      <ExportDialog
        open={showExport}
        videoTitle={entry.videoTitle}
        sourcePath={entry.outputPath}
        onClose={() => setShowExport(false)}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        message={confirmAction?.message ?? ''}
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
