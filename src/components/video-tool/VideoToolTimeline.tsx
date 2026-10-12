import React from 'react'
import { getTimelineDuration, useVideoToolStore } from '../../store/useVideoToolStore'
import { useI18n } from '../../i18n'

function formatTime(value: number): string {
  const minutes = Math.floor(Math.max(0, value) / 60)
  const seconds = Math.floor(Math.max(0, value) % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const VideoToolTimeline: React.FC = () => {
  const t = useI18n((state) => state.t)
  const manifest = useVideoToolStore((state) => state.manifest)
  const playhead = useVideoToolStore((state) => state.playhead)
  const selectedClipId = useVideoToolStore((state) => state.selectedClipId)
  const selectClip = useVideoToolStore((state) => state.selectClip)
  const setPlayhead = useVideoToolStore((state) => state.setPlayhead)
  if (!manifest) return null
  const duration = getTimelineDuration(manifest)
  return (
    <section className="h-48 shrink-0 border-t border-outline-variant/40 bg-surface-container p-4 overflow-auto">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">{t('videoTool.timeline')}</span>
        <span className="text-xs font-mono text-outline">{formatTime(playhead)} / {formatTime(duration)}</span>
      </div>
      <div className="relative min-w-[480px] h-20 rounded-lg bg-surface-variant/60 border border-outline-variant/40 overflow-hidden" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPlayhead(((event.clientX - rect.left) / rect.width) * duration) }}>
        <div className="absolute inset-x-0 top-0 h-5 flex text-[10px] text-outline pointer-events-none">{[0, .25, .5, .75, 1].map((mark) => <span key={mark} className="absolute" style={{ left: `${mark * 100}%`, transform: 'translateX(-50%)' }}>{formatTime(duration * mark)}</span>)}</div>
        <div className="absolute inset-x-2 bottom-2 h-10 flex gap-1">
          {manifest.timeline.videoTrack.map((clip) => {
            const width = duration > 0 ? ((clip.sourceEnd - clip.sourceStart) / duration) * 100 : 100
            return <button key={clip.id} type="button" onClick={(event) => { event.stopPropagation(); selectClip(clip.id) }} className={`h-full rounded border text-left px-2 truncate text-[11px] font-mono transition-colors ${selectedClipId === clip.id ? 'bg-primary/30 border-primary text-primary' : 'bg-surface-container-high border-outline-variant text-on-surface-variant hover:border-primary'}`} style={{ width: `${width}%` }} title={`${formatTime(clip.sourceStart)} - ${formatTime(clip.sourceEnd)}`}>{formatTime(clip.sourceStart)}–{formatTime(clip.sourceEnd)}</button>
          })}
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-error pointer-events-none" style={{ left: `${duration > 0 ? (playhead / duration) * 100 : 0}%` }}><div className="w-2 h-2 rounded-full bg-error -translate-x-[3px]" /></div>
      </div>
    </section>
  )
}
