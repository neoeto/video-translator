import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import type { DepInstallProgress, MissingDep } from '../types'

interface DependencyDialogProps {
  missingDeps: MissingDep[]
  onInstall: () => void
  onCancel: () => void
  isInstalling: boolean
  progress: DepInstallProgress | null
}

const stageLabelKeys: Record<DepInstallProgress['stage'], string> = {
  'detecting-python': 'deps.progress.detectingPython',
  'creating-venv': 'deps.progress.creatingVenv',
  installing: 'deps.progress.installing',
  configuring: 'deps.progress.configuring',
  done: 'deps.dialog.complete',
  error: 'deps.dialog.error',
}

export const DependencyDialog: React.FC<DependencyDialogProps> = ({
  missingDeps,
  onInstall,
  onCancel,
  isInstalling,
  progress,
}) => {
  const t = useI18n((s) => s.t)
  const locale = useI18n((s) => s.locale)
  const [installCompleted, setInstallCompleted] = useState(false)

  useEffect(() => {
    if (progress?.stage !== 'done') return
    setInstallCompleted(true)
    const timer = window.setTimeout(onCancel, 1000)
    return () => window.clearTimeout(timer)
  }, [onCancel, progress?.stage])

  const currentDepName = useMemo(() => {
    if (!progress) return ''
    return missingDeps.find((dep) => dep.id === progress.depId)?.name ?? progress.depId
  }, [missingDeps, progress])

  const progressMessage = progress
    ? t(stageLabelKeys[progress.stage]).replace('{name}', currentDepName)
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-surface-container rounded-2xl border border-outline-variant/50 shadow-2xl overflow-hidden">
        <div className="flex items-start gap-4 p-6 border-b border-outline-variant/30">
          <div className="w-11 h-11 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[24px]">extension</span>
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-on-surface">{t('deps.dialog.title')}</h2>
            <p className="text-sm text-on-surface-variant mt-1 leading-6">
              {installCompleted ? t('deps.dialog.complete') : t('deps.dialog.description')}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {!installCompleted && (
            <div className="space-y-3">
              {missingDeps.map((dep) => (
                <div key={dep.id} className="flex items-start gap-3 bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-4">
                  <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">terminal</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-on-surface">{dep.name}</h3>
                      <span className="text-[11px] font-semibold text-primary bg-primary/10 rounded-full px-2 py-1 shrink-0">
                        {dep.estimatedSize}
                      </span>
                    </div>
                    <p className="text-[13px] text-on-surface-variant mt-1 leading-5">
                      {locale === 'zh' ? dep.descriptionZh : dep.descriptionEn}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {isInstalling && (
            <div className="bg-surface-container-low rounded-xl border border-outline-variant/30 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-sm font-semibold text-on-surface">{progressMessage || t('deps.dialog.installing')}</span>
                <span className="text-xs text-on-surface-variant">{progress?.percent ?? 0}%</span>
              </div>
              <div className="h-2 bg-surface-container-lowest rounded-full overflow-hidden border border-outline-variant/30">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, progress?.percent ?? 0))}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 bg-surface-container-low border-t border-outline-variant/30">
          <button
            type="button"
            onClick={onCancel}
            disabled={isInstalling}
            className="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {installCompleted ? t('deps.dialog.close') : t('deps.dialog.cancel')}
          </button>
          {!installCompleted && (
            <button
              type="button"
              onClick={onInstall}
              disabled={isInstalling}
              className="px-5 py-2 rounded-lg bg-primary text-on-primary font-semibold hover:brightness-110 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isInstalling && <span className="animate-spin rounded-full h-4 w-4 border-2 border-on-primary/30 border-t-on-primary" />}
              {isInstalling ? t('deps.dialog.installing') : t('deps.dialog.install')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
