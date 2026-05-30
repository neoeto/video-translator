import React, { useCallback, useRef } from 'react'
import { useEditorStore, type EditableSegment } from '../../store/useEditorStore'
import { useI18n } from '../../i18n'

function formatTimeCode(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export const SubtitlePanel: React.FC = () => {
  const segments = useEditorStore(s => s.segments)
  const currentTime = useEditorStore(s => s.currentTime)
  const selectedSegmentId = useEditorStore(s => s.selectedSegmentId)
  const setSelectedSegment = useEditorStore(s => s.setSelectedSegment)
  const updateSegmentText = useEditorStore(s => s.updateSegmentText)
  const updateSegmentTime = useEditorStore(s => s.updateSegmentTime)
  const deleteSegment = useEditorStore(s => s.deleteSegment)
  const setCurrentTime = useEditorStore(s => s.setCurrentTime)
  const setPlaying = useEditorStore(s => s.setPlaying)
  const t = useI18n(s => s.t)

  const listRef = useRef<HTMLDivElement>(null)

  const handleSegmentClick = useCallback((seg: EditableSegment, e: React.MouseEvent) => {
    setSelectedSegment(seg.id)
    setCurrentTime(seg.start)
    if (e.altKey) {
      setPlaying(false)
    }
  }, [setSelectedSegment, setCurrentTime, setPlaying])

  const handleTimeChange = useCallback((id: string, field: 'start' | 'end', value: string) => {
    const seg = segments.find(s => s.id === id)
    if (!seg) return
    const parts = value.split(':')
    if (parts.length !== 2) return
    const mins = parseInt(parts[0], 10)
    const secs = parseFloat(parts[1])
    if (isNaN(mins) || isNaN(secs)) return
    const time = mins * 60 + secs
    if (field === 'start') {
      updateSegmentTime(id, time, seg.end)
    } else {
      updateSegmentTime(id, seg.start, time)
    }
  }, [segments, updateSegmentTime])

  const visibleSegments = segments.filter(s => !s.deleted)

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={listRef}>
      {visibleSegments.length === 0 && (
        <p className="text-sm text-outline text-center py-8">{t('editor.noSegments')}</p>
      )}
      {visibleSegments.map(seg => {
        const isActive = currentTime >= seg.start && currentTime <= seg.end
        const isSelected = seg.id === selectedSegmentId

        return (
          <div
            key={seg.id}
            onClick={(e) => handleSegmentClick(seg, e)}
            className={`rounded p-3 cursor-pointer transition-colors border-l-2 ${
              isSelected
                ? 'bg-surface-variant border-primary'
                : isActive
                  ? 'bg-surface-container-high border-primary/50'
                  : 'bg-surface-container-high border-transparent hover:bg-surface-variant'
            }`}
          >
            <div className="flex justify-between items-center mb-1">
              <div className="flex gap-1">
                <input
                  type="text"
                  defaultValue={formatTimeCode(seg.start)}
                  onBlur={(e) => handleTimeChange(seg.id, 'start', e.target.value)}
                  className="w-14 bg-transparent text-xs font-mono text-on-surface-variant focus:text-primary focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-xs text-outline">-</span>
                <input
                  type="text"
                  defaultValue={formatTimeCode(seg.end)}
                  onBlur={(e) => handleTimeChange(seg.id, 'end', e.target.value)}
                  className="w-14 bg-transparent text-xs font-mono text-on-surface-variant focus:text-primary focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteSegment(seg.id) }}
                className="p-1 rounded hover:bg-error-container/20 text-outline hover:text-error transition-colors"
                title={t('editor.deleteSegment')}
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            {isSelected ? (
              <textarea
                value={seg.targetText}
                onChange={(e) => updateSegmentText(seg.id, 'targetText', e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-[#181818] border border-[#333333] text-on-surface text-sm rounded p-2 focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none resize-none h-16 mt-1"
                rows={2}
              />
            ) : (
              <p className="text-sm text-on-surface line-clamp-2">{seg.targetText}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
