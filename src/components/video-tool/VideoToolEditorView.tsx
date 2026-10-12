import React, { useEffect } from 'react'
import { useVideoToolStore } from '../../store/useVideoToolStore'
import { useI18n } from '../../i18n'
import { VideoToolPreview } from './VideoToolPreview'
import { VideoToolSidePanel } from './VideoToolSidePanel'
import { VideoToolTimeline } from './VideoToolTimeline'

interface VideoToolEditorViewProps {
  projectId: string
  onNavigate: (view: string, params?: { projectId?: string }) => void
}

export const VideoToolEditorView: React.FC<VideoToolEditorViewProps> = ({ projectId, onNavigate }) => {
  const t = useI18n((state) => state.t)
  const load = useVideoToolStore((state) => state.load)
  const clear = useVideoToolStore((state) => state.clear)
  const initialized = useVideoToolStore((state) => state.initialized)
  const loading = useVideoToolStore((state) => state.loading)
  const error = useVideoToolStore((state) => state.error)
  const manifest = useVideoToolStore((state) => state.manifest)
  const undo = useVideoToolStore((state) => state.undo)
  const redo = useVideoToolStore((state) => state.redo)
  const undoStack = useVideoToolStore((state) => state.undoStack)
  const redoStack = useVideoToolStore((state) => state.redoStack)

  useEffect(() => {
    void load(projectId)
    return () => { void clear() }
  }, [clear, load, projectId])

  if (loading || !initialized) return <div className="h-full flex items-center justify-center text-outline"><span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>{t('videoTool.loading')}</div>
  if (error || !manifest) return <div className="h-full flex flex-col items-center justify-center gap-4 text-error"><p>{error || t('videoTool.loadError')}</p><button type="button" onClick={() => onNavigate('video-tool')} className="tool-button">{t('videoTool.back')}</button></div>

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <header className="h-14 shrink-0 border-b border-outline-variant/40 bg-surface flex items-center justify-between px-5">
        <div className="flex items-center gap-3 min-w-0"><button type="button" onClick={() => onNavigate('video-tool')} className="text-on-surface-variant hover:text-on-surface" title={t('videoTool.back')}><span className="material-symbols-outlined">arrow_back</span></button><span className="material-symbols-outlined text-primary">movie_edit</span><h1 className="font-semibold text-on-surface truncate">{manifest.name}</h1></div>
        <div className="flex items-center gap-2"><button type="button" onClick={undo} disabled={undoStack.length === 0} className="tool-button" title={t('videoTool.undo')}><span className="material-symbols-outlined text-[18px]">undo</span></button><button type="button" onClick={redo} disabled={redoStack.length === 0} className="tool-button" title={t('videoTool.redo')}><span className="material-symbols-outlined text-[18px]">redo</span></button></div>
      </header>
      <div className="flex-1 min-h-0 flex"><VideoToolPreview /><VideoToolSidePanel /></div>
      <VideoToolTimeline />
    </div>
  )
}
