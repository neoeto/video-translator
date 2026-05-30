import React, { useRef, useCallback, useEffect, useState } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import { useI18n } from '../../i18n'

function formatTimeRuler(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const WaveformCanvas: React.FC<{ data: number[]; width: number; height: number }> = ({ data, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    // Normalize: find max and scale to fill 90% of height
    const maxVal = Math.max(...data, 0.01)
    const centerY = height / 2

    ctx.fillStyle = '#53e16f'
    ctx.globalAlpha = 0.7

    const barWidth = Math.max(1, width / data.length)
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * width
      const amplitude = (data[i] / maxVal) * centerY * 0.9
      // Draw symmetric bar from center
      ctx.fillRect(x, centerY - amplitude, barWidth, amplitude * 2)
    }
  }, [data, width, height])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ width, height }}
    />
  )
}

export const TimelinePanel: React.FC = () => {
  const segments = useEditorStore(s => s.segments)
  const duration = useEditorStore(s => s.duration)
  const currentTime = useEditorStore(s => s.currentTime)
  const zoomLevel = useEditorStore(s => s.zoomLevel)
  const activeTool = useEditorStore(s => s.activeTool)
  const selectedSegmentId = useEditorStore(s => s.selectedSegmentId)
  const waveformData = useEditorStore(s => s.waveformData)
  const setCurrentTime = useEditorStore(s => s.setCurrentTime)
  const setPlaying = useEditorStore(s => s.setPlaying)
  const setTool = useEditorStore(s => s.setTool)
  const setSelectedSegment = useEditorStore(s => s.setSelectedSegment)
  const deleteSegment = useEditorStore(s => s.deleteSegment)
  const splitAtPlayhead = useEditorStore(s => s.splitAtPlayhead)
  const zoomIn = useEditorStore(s => s.zoomIn)
  const zoomOut = useEditorStore(s => s.zoomOut)
  const undo = useEditorStore(s => s.undo)
  const redo = useEditorStore(s => s.redo)
  const updateSegmentTime = useEditorStore(s => s.updateSegmentTime)
  const t = useI18n(s => s.t)

  const timelineRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<{
    segId: string
    handle: 'left' | 'right'
    startX: number
    origStart: number
    origEnd: number
  } | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)

  const totalWidth = Math.max(800, duration * zoomLevel)
  const playheadX = currentTime * zoomLevel

  // Click on ruler to seek
  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left + (timelineRef.current?.scrollLeft || 0)
    const time = Math.max(0, Math.min(duration, x / zoomLevel))
    setCurrentTime(time)
    setPlaying(false)
  }, [duration, zoomLevel, setCurrentTime, setPlaying])

  // Handle segment click based on active tool
  const handleSegmentClick = useCallback((segId: string, e: React.MouseEvent) => {
    if (e.altKey) {
      // Alt+click: jump to segment start
      const seg = segments.find(s => s.id === segId)
      if (seg) {
        setCurrentTime(seg.start)
        setPlaying(false)
      }
      return
    }
    if (activeTool === 'select') {
      setSelectedSegment(segId)
    } else if (activeTool === 'delete') {
      deleteSegment(segId)
    } else if (activeTool === 'cut') {
      splitAtPlayhead()
    }
  }, [activeTool, segments, setSelectedSegment, deleteSegment, splitAtPlayhead, setCurrentTime, setPlaying])

  // Handle drag for segment resizing
  const handleDragStart = useCallback((e: React.MouseEvent, segId: string, handle: 'left' | 'right') => {
    e.stopPropagation()
    e.preventDefault()
    const seg = segments.find(s => s.id === segId)
    if (!seg) return
    setDragState({
      segId,
      handle,
      startX: e.clientX,
      origStart: seg.start,
      origEnd: seg.end,
    })
  }, [segments])

  // Playhead drag
  const handlePlayheadDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsDraggingPlayhead(true)
    setPlaying(false)
  }, [setPlaying])

  useEffect(() => {
    if (!isDraggingPlayhead) return
    const handleMove = (e: MouseEvent) => {
      const container = timelineRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left + container.scrollLeft
      const time = Math.max(0, Math.min(duration, x / zoomLevel))
      setCurrentTime(time)
    }
    const handleUp = () => setIsDraggingPlayhead(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDraggingPlayhead, duration, zoomLevel, setCurrentTime])

  useEffect(() => {
    if (!dragState) return
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - dragState.startX
      const dt = dx / zoomLevel
      if (dragState.handle === 'left') {
        const newStart = Math.max(0, dragState.origStart + dt)
        if (newStart < dragState.origEnd - 0.1) {
          updateSegmentTime(dragState.segId, newStart, dragState.origEnd)
        }
      } else {
        const newEnd = Math.min(duration, dragState.origEnd + dt)
        if (newEnd > dragState.origStart + 0.1) {
          updateSegmentTime(dragState.segId, dragState.origStart, newEnd)
        }
      }
    }
    const handleUp = () => setDragState(null)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragState, zoomLevel, duration, updateSegmentTime])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedSegmentId } = useEditorStore.getState()
        if (selectedSegmentId) {
          e.preventDefault()
          deleteSegment(selectedSegmentId)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo, deleteSegment])

  // Generate ruler marks
  const rulerMarks: { time: number; x: number }[] = []
  const interval = zoomLevel >= 80 ? 1 : zoomLevel >= 30 ? 5 : zoomLevel >= 15 ? 10 : 30
  for (let t = 0; t <= duration; t += interval) {
    rulerMarks.push({ time: t, x: t * zoomLevel })
  }

  // Auto-scroll timeline to keep playhead in view during playback
  const isPlayingRef = useRef(false)
  const isPlaying = useEditorStore(s => s.isPlaying)
  isPlayingRef.current = isPlaying

  useEffect(() => {
    let raf = 0
    const container = timelineRef.current
    const sync = () => {
      if (!container || !isPlayingRef.current) return
      const { currentTime, zoomLevel } = useEditorStore.getState()
      const px = currentTime * zoomLevel
      const containerWidth = container.clientWidth
      if (containerWidth <= 0) { raf = requestAnimationFrame(sync); return }

      // Continuously keep playhead at ~30% from left using smooth lerp
      const targetScroll = Math.max(0, px - containerWidth * 0.3)
      const currentScroll = container.scrollLeft
      const diff = targetScroll - currentScroll
      // Smooth interpolation — move 15% of the remaining distance each frame
      if (Math.abs(diff) > 1) {
        container.scrollLeft = currentScroll + diff * 0.15
      }
      raf = requestAnimationFrame(sync)
    }
    if (isPlaying) raf = requestAnimationFrame(sync)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying])

  const visibleSegments = segments.filter(s => !s.deleted)

  return (
    <div className="h-72 bg-surface-container-low border-t border-outline-variant/30 flex flex-col shrink-0">
      {/* Toolbar */}
      <div className="h-10 border-b border-outline-variant/30 flex items-center justify-between px-4 bg-surface-container">
        <div className="flex items-center gap-1">
          <button
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              activeTool === 'select' ? 'bg-primary/20 text-primary' : 'text-on-surface hover:bg-surface-variant'
            }`}
            onClick={() => setTool('select')}
            title={t('editor.toolSelect')}
          >
            <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>arrow_selector_tool</span>
          </button>
          <button
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              activeTool === 'cut' ? 'bg-primary/20 text-primary' : 'text-on-surface hover:bg-surface-variant'
            }`}
            onClick={() => setTool('cut')}
            title={t('editor.toolCut')}
          >
            <span className="material-symbols-outlined text-[20px]">content_cut</span>
          </button>
          <button
            className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
              activeTool === 'delete' ? 'bg-error/20 text-error' : 'text-on-surface hover:bg-surface-variant'
            }`}
            onClick={() => setTool('delete')}
            title={t('editor.toolDelete')}
          >
            <span className="material-symbols-outlined text-[20px]">delete</span>
          </button>
          <div className="w-px h-4 bg-outline-variant/50 mx-2" />
          <button
            className="w-8 h-8 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors"
            onClick={zoomIn}
            title={t('editor.zoomIn')}
          >
            <span className="material-symbols-outlined text-[20px]">zoom_in</span>
          </button>
          <button
            className="w-8 h-8 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors"
            onClick={zoomOut}
            title={t('editor.zoomOut')}
          >
            <span className="material-symbols-outlined text-[20px]">zoom_out</span>
          </button>
        </div>
        <div className="font-mono text-xs text-primary border border-primary/30 bg-primary/10 px-2 py-0.5 rounded" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatTimeRuler(currentTime)}
        </div>
      </div>

      {/* Timeline body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track headers */}
        <div className="w-36 bg-surface-container border-r border-outline-variant/30 flex flex-col shrink-0">
          <div className="h-6 bg-[#181818] border-b border-outline-variant/30" />
          <div className="h-20 border-b border-outline-variant/30 p-2 flex items-center bg-surface-container-low">
            <span className="text-[11px] font-semibold text-on-surface flex items-center uppercase tracking-wider">
              <span className="material-symbols-outlined text-[16px] mr-1">videocam</span>
              {t('editor.trackVideo')}
            </span>
          </div>
          <div className="h-16 border-b border-outline-variant/30 p-2 flex items-center bg-surface-container-low">
            <span className="text-[11px] font-semibold text-on-surface flex items-center uppercase tracking-wider">
              <span className="material-symbols-outlined text-[16px] mr-1">mic</span>
              {t('editor.trackAudio')}
            </span>
          </div>
          <div className="h-12 border-b border-outline-variant/30 p-2 flex items-center bg-surface-container-low">
            <span className="text-[11px] font-semibold text-primary flex items-center uppercase tracking-wider">
              <span className="material-symbols-outlined text-[16px] mr-1">subtitles</span>
              {t('editor.trackSubtitle')}
            </span>
          </div>
        </div>

        {/* Track canvas */}
        <div
          ref={timelineRef}
          className="flex-1 relative overflow-x-auto overflow-y-hidden bg-[#121212]"
        >
          {/* Time ruler */}
          <div
            className="h-6 bg-[#181818] border-b border-outline-variant/30 sticky top-0 z-20 relative cursor-pointer"
            style={{ width: totalWidth }}
            onClick={handleRulerClick}
          >
            {rulerMarks.map(mark => (
              <div
                key={mark.time}
                className="absolute bottom-0 border-l border-outline-variant/50 h-3"
                style={{ left: mark.x }}
              >
                <span className="absolute -top-4 -left-3 text-[10px] font-mono text-on-surface-variant">
                  {formatTimeRuler(mark.time)}
                </span>
              </div>
            ))}
          </div>

          {/* Tracks container */}
          <div className="relative" style={{ width: totalWidth, height: 'calc(100% - 24px)' }}>
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-[1px] bg-[#ff3b30] z-50"
              style={{ left: playheadX }}
            >
              <div
                className="absolute top-0 -left-[7px] w-[15px] h-[15px] bg-[#ff3b30] rounded-full cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                onMouseDown={handlePlayheadDragStart}
              />
              {/* Wider invisible hit area for easier grabbing */}
              <div
                className="absolute top-0 bottom-0 -left-[6px] w-[13px] cursor-grab active:cursor-grabbing"
                onMouseDown={handlePlayheadDragStart}
              />
            </div>

            {/* V1 — Video track (placeholder thumbnails) */}
            <div className="h-20 border-b border-outline-variant/20 relative">
              <div
                className="absolute top-1 bottom-1 left-0 bg-surface-variant rounded border border-outline-variant/50 overflow-hidden flex"
                style={{ width: duration * zoomLevel }}
              >
                <div className="w-full h-full bg-surface-variant opacity-50 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[24px] text-outline/30">movie</span>
                </div>
              </div>
            </div>

            {/* A1 — Audio track (waveform) */}
            <div className="h-16 border-b border-outline-variant/20 relative">
              <div
                className="absolute top-1 bottom-1 left-0 bg-surface-container rounded border border-secondary/30 overflow-hidden"
                style={{ width: duration * zoomLevel }}
              >
                {waveformData.length > 0 ? (
                  <WaveformCanvas data={waveformData} width={duration * zoomLevel} height={48} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px] text-outline/30">graphic_eq</span>
                  </div>
                )}
              </div>
            </div>

            {/* T1 — Subtitle track */}
            <div className="h-12 border-b border-outline-variant/20 relative">
              {visibleSegments.map(seg => {
                const left = seg.start * zoomLevel
                const width = Math.max(20, (seg.end - seg.start) * zoomLevel)
                const isActive = currentTime >= seg.start && currentTime <= seg.end
                const isSelected = seg.id === selectedSegmentId

                return (
                  <div
                    key={seg.id}
                    className={`absolute top-2 bottom-2 rounded border overflow-hidden cursor-pointer transition-colors group ${
                      isSelected
                        ? 'bg-primary/20 border-primary shadow-[0_0_8px_rgba(173,198,255,0.2)]'
                        : isActive
                          ? 'bg-primary/10 border-primary/50'
                          : 'bg-surface-container border-outline-variant hover:bg-surface-variant'
                    }`}
                    style={{ left, width }}
                    onClick={(e) => handleSegmentClick(seg.id, e)}
                  >
                    {/* Resize handles */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/10 transition-opacity"
                      onMouseDown={(e) => handleDragStart(e, seg.id, 'left')}
                    />
                    <div
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/10 transition-opacity"
                      onMouseDown={(e) => handleDragStart(e, seg.id, 'right')}
                    />
                    <span className={`text-[10px] whitespace-nowrap truncate px-2 leading-8 ${
                      isSelected ? 'text-primary font-medium' : 'text-on-surface-variant'
                    }`}>
                      {seg.targetText || '...'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
