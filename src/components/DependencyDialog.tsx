import React, { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import type { DepItemStatus, DepInstallProgress, MissingDep } from '../types'

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
  'upgrading-pip': 'deps.progress.upgradingPip',
  installing: 'deps.progress.installing',
  downloading: 'deps.progress.downloading',
  configuring: 'deps.progress.configuring',
  done: 'deps.dialog.complete',
  error: 'deps.dialog.error',
}

function DepStatusIcon({ status }: { status: DepItemStatus }) {
  if (status === 'done') {
    return (
      <span className="material-symbols-outlined text-green-500 text-[20px]">check_circle</span>
    )
  }
  if (status === 'installing') {
    return (
      <span className="material-symbols-outlined text-primary text-[20px] animate-pulse">downloading</span>
    )
  }
  return (
    <span className="material-symbols-outlined text-on-surface-variant/40 text-[20px]">hourglass_empty</span>
  )
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
  const [depStatuses, setDepStatuses] = useState<Record<string, DepItemStatus>>({})

  useEffect(() => {
    if (progress?.stage === 'done') {
      setInstallCompleted(true)
      const allDone: Record<string, DepItemStatus> = {}
      for (const dep of missingDeps) allDone[dep.id] = 'done'
      setDepStatuses(allDone)
      const timer = window.setTimeout(onCancel, 1000)
      return () => window.clearTimeout(timer)
    }
    if (progress?.depStatuses) {
      setDepStatuses(progress.depStatuses)
    }
  }, [missingDeps, onCancel, progress?.stage, progress?.depStatuses])

  const progressMessage = progress
    ? progress.message || t(stageLabelKeys[progress.stage])
    : ''

  const overallPercent = progress?.percent ?? 0

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

        <div className="p-6 space-y-3">
          {missingDeps.map((dep) => {
            const status: DepItemStatus = depStatuses[dep.id] ?? 'pending'
            return (
              <div key={dep.id} className="relative overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest">
                <div className="flex items-start gap-3 p-4">
                  <div className="mt-0.5">
                    <DepStatusIcon status={status} />
                  </div>
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
                {status === 'installing' && (
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-surface-container-lowest">
                    <div
                      className="h-full bg-primary transition-all duration-500 ease-out"
                      style={{ width: `${Math.max(0, Math.min(100, overallPercent))}%` }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {(isInstalling || progress?.stage === 'error') && (
          <div className="px-6 pb-2">
            <div className={`rounded-xl border p-4 ${progress?.stage === 'error' ? 'bg-error-container/20 border-error/30' : 'bg-surface-container-low border-outline-variant/30'}`}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-sm font-semibold text-on-surface">{progressMessage || t('deps.dialog.installing')}</span>
                {progress?.stage !== 'error' && <span className="text-xs text-on-surface-variant">{overallPercent}%</span>}
              </div>
              {progress?.stage !== 'error' && (
                <div className="h-2 bg-surface-container-lowest rounded-full overflow-hidden border border-outline-variant/30">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, overallPercent))}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 px-6 py-4 bg-surface-container-low border-t border-outline-variant/30">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
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
