import React, { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../i18n'
import type { ExportResolution } from '../preload'

interface ExportDialogProps {
  open: boolean
  videoTitle: string
  sourcePath: string
  onClose: () => void
}

const RESOLUTIONS: { value: ExportResolution; labelKey: string }[] = [
  { value: 'original', labelKey: 'export.resOriginal' },
  { value: '1080p', labelKey: 'export.res1080p' },
  { value: '720p', labelKey: 'export.res720p' },
  { value: '480p', labelKey: 'export.res480p' },
]

export const ExportDialog: React.FC<ExportDialogProps> = ({ open, videoTitle, sourcePath, onClose }) => {
  const t = useI18n((s) => s.t)
  const [resolution, setResolution] = useState<ExportResolution>('original')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setExporting(false)
      setProgress(0)
      setStage('')
      setError(null)
      return
    }
  }, [open])

  useEffect(() => {
    if (!exporting) return
    const cleanup = window.electronAPI.onExportProgress((data) => {
      setProgress(data.percent)
      setStage(data.stage)
    })
    return cleanup
  }, [exporting])

  const handleExport = useCallback(async () => {
    const suffix = resolution === 'original' ? '' : `_${resolution}`
    const baseName = videoTitle.replace(/[<>:"/\\|?*]/g, '_')
    const defaultName = `${baseName}${suffix}.mp4`

    const targetPath = await window.electronAPI.saveFileDialog(defaultName)
    if (!targetPath) return

    setExporting(true)
    setProgress(0)
    setError(null)

    try {
      await window.electronAPI.exportVideo(sourcePath, targetPath, resolution)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('cancelled')) {
        // User cancelled — just reset state
        setExporting(false)
        setProgress(0)
      } else {
        setError(msg)
        setExporting(false)
      }
    }
  }, [resolution, videoTitle, sourcePath, onClose])

  const handleCancel = useCallback(() => {
    if (exporting) {
      window.electronAPI.cancelExport()
    } else {
      onClose()
    }
  }, [exporting, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !exporting) onClose()
  }, [exporting, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={exporting ? undefined : onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-surface-container rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px]">movie_edit</span>
            {t('export.title')}
          </h3>
          <p className="text-sm text-on-surface-variant mt-1 line-clamp-1" title={videoTitle}>
            {videoTitle}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {!exporting && !error && (
            <div>
              <label className="text-sm text-outline block mb-2">{t('export.resolution')}</label>
              <div className="grid grid-cols-2 gap-2">
                {RESOLUTIONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setResolution(r.value)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                      resolution === r.value
                        ? 'bg-primary text-on-primary border-primary'
                        : 'bg-surface-variant text-on-surface border-surface-variant hover:border-outline-variant'
                    }`}
                  >
                    {t(r.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {exporting && (
            <div className="py-2">
              <div className="flex justify-between text-sm text-on-surface-variant mb-2">
                <span>{stage === 'copying' ? t('export.copying') : t('export.encoding')}</span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-variant rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="py-2 text-sm text-error">
              {t('export.error')}: {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2 flex justify-end gap-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-on-surface hover:bg-surface-variant transition-colors"
          >
            {exporting ? t('export.cancelExport') : t('confirm.cancel')}
          </button>
          {!exporting && !error && (
            <button
              onClick={handleExport}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity"
            >
              {t('export.startExport')}
            </button>
          )}
          {error && (
            <button
              onClick={() => setError(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity"
            >
              {t('export.retry')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
