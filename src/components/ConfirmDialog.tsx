import { useCallback, useEffect, useRef } from 'react'
import { useI18n } from '../i18n'

interface ConfirmDialogProps {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useI18n((s) => s.t)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel()
  }, [onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-surface-container rounded-xl border border-surface-variant p-6 max-w-sm w-full mx-4 sharp-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-on-surface text-sm leading-relaxed mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-variant rounded-lg transition-colors"
          >
            {t('confirm.cancel')}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-error text-on-error rounded-lg hover:opacity-90 transition-opacity"
          >
            {t('confirm.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
