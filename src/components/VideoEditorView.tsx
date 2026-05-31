import React, { useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { usePipelineStore } from '../store/usePipelineStore'
import { useI18n } from '../i18n'
import { VideoPreview } from './editor/VideoPreview'
import { SubtitlePanel } from './editor/SubtitlePanel'
import { TimelinePanel } from './editor/TimelinePanel'

interface VideoEditorViewProps {
  onNavigate: (view: string) => void
}

export const VideoEditorView: React.FC<VideoEditorViewProps> = ({ onNavigate }) => {
  const pipelineState = usePipelineStore(s => s.state)
  const submitManualReview = usePipelineStore(s => s.submitManualReview)
  const cancelManualReview = usePipelineStore(s => s.cancelManualReview)

  const init = useEditorStore(s => s.init)
  const cleanup = useEditorStore(s => s.cleanup)
  const initialized = useEditorStore(s => s.initialized)
  const sidePanel = useEditorStore(s => s.sidePanel)
  const setSidePanel = useEditorStore(s => s.setSidePanel)
  const undo = useEditorStore(s => s.undo)
  const redo = useEditorStore(s => s.redo)
  const undoStack = useEditorStore(s => s.undoStack)
  const redoStack = useEditorStore(s => s.redoStack)
  const getResult = useEditorStore(s => s.getResult)
  const setWaveformData = useEditorStore(s => s.setWaveformData)

  const t = useI18n(s => s.t)

  // Initialize editor with pipeline data
  useEffect(() => {
    if (pipelineState.manualReview && !initialized) {
      init(pipelineState.manualReview)

      // Load waveform data async
      const waveformAudioPath = pipelineState.manualReview.synthesizedAudioPath || pipelineState.manualReview.originalAudioPath
      if (waveformAudioPath) {
        window.electronAPI.getAudioWaveform(waveformAudioPath, 2000)
          .then(data => {
            setWaveformData(data)
          })
          .catch((err) => console.warn('[Editor] Waveform load failed:', err))
      }
    }
  }, [pipelineState.manualReview, initialized, init, setWaveformData])

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  const handleConfirm = useCallback(() => {
    const result = getResult()
    submitManualReview(result)
    cleanup()
    onNavigate('processing')
  }, [getResult, submitManualReview, cleanup, onNavigate])

  const handleCancel = useCallback(() => {
    cancelManualReview()
    cleanup()
    onNavigate('processing')
  }, [cancelManualReview, cleanup, onNavigate])

  if (!initialized) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-outline flex flex-col items-center">
          <span className="material-symbols-outlined text-[48px] mb-4 opacity-50 animate-pulse">hourglass_empty</span>
          <p className="text-sm">Loading editor...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-outline-variant/30 flex items-center justify-between px-6 bg-surface shrink-0 z-10">
        <div className="flex items-center">
          <span className="material-symbols-outlined text-on-surface-variant mr-3">movie</span>
          <h2 className="text-lg font-semibold text-on-surface">{t('editor.title')}</h2>
          {pipelineState.videoTitle && (
            <>
              <span className="mx-3 text-outline-variant">·</span>
              <span className="text-sm text-on-surface-variant truncate max-w-xs">{pipelineState.videoTitle}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
              undoStack.length > 0 ? 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant' : 'text-outline/30 cursor-not-allowed'
            }`}
            onClick={undo}
            disabled={undoStack.length === 0}
            title={t('editor.undo')}
          >
            <span className="material-symbols-outlined">undo</span>
          </button>
          <button
            className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
              redoStack.length > 0 ? 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant' : 'text-outline/30 cursor-not-allowed'
            }`}
            onClick={redo}
            disabled={redoStack.length === 0}
            title={t('editor.redo')}
          >
            <span className="material-symbols-outlined">redo</span>
          </button>
          <div className="w-px h-6 bg-outline-variant/50 mx-1" />
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-on-surface-variant border border-outline-variant rounded-lg text-sm hover:bg-surface-variant transition-colors"
          >
            {t('editor.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:bg-primary-fixed-dim transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">check</span>
            {t('editor.confirm')}
          </button>
        </div>
      </header>

      {/* Workspace */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top: Preview + Side Panel */}
        <div className="flex-1 flex min-h-[300px]">
          <VideoPreview />

          {/* Side panel */}
          <div className="w-80 bg-surface-container border-l border-outline-variant/30 flex flex-col shrink-0">
            {/* Panel tabs */}
            <div className="p-4 border-b border-outline-variant/30 flex gap-2">
              <button
                className={`flex-1 py-1.5 border-b-2 text-sm font-semibold transition-colors ${
                  sidePanel === 'subtitles'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
                onClick={() => setSidePanel('subtitles')}
              >
                {t('editor.subtitles')}
              </button>
              <button
                className={`flex-1 py-1.5 border-b-2 text-sm font-semibold transition-colors ${
                  sidePanel === 'audio'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface'
                }`}
                onClick={() => setSidePanel('audio')}
              >
                {t('editor.audio')}
              </button>
            </div>

            {/* Panel content */}
            {sidePanel === 'subtitles' && <SubtitlePanel />}
            {sidePanel === 'audio' && (
              <div className="flex-1 flex items-center justify-center p-4">
                <p className="text-sm text-outline text-center">
                  Audio segments are displayed on the timeline.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Timeline */}
        <TimelinePanel />
      </div>
    </div>
  )
}
