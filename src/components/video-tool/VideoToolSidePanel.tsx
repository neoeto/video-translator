import React, { useEffect, useRef, useState } from 'react'
import { timelineToSourceTime, useVideoToolStore } from '../../store/useVideoToolStore'
import type { AudioFormat, FrameFormat, ProjectResolution } from '../../../shared/project-types'
import { useI18n } from '../../i18n'

function formatTime(value: number): string {
  const safe = Math.max(0, value)
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const VideoToolSidePanel: React.FC = () => {
  const t = useI18n((state) => state.t)
  const projectId = useVideoToolStore((state) => state.projectId)
  const manifest = useVideoToolStore((state) => state.manifest)
  const sessionGeneration = useVideoToolStore((state) => state.sessionGeneration)
  const selectedClipId = useVideoToolStore((state) => state.selectedClipId)
  const playhead = useVideoToolStore((state) => state.playhead)
  const saveState = useVideoToolStore((state) => state.saveState)
  const saveError = useVideoToolStore((state) => state.saveError)
  const progress = useVideoToolStore((state) => state.progress)
  const error = useVideoToolStore((state) => state.error)
  const setProgress = useVideoToolStore((state) => state.setProgress)
  const mergePersistedManifest = useVideoToolStore((state) => state.mergePersistedManifest)
  const setError = useVideoToolStore((state) => state.setError)
  const splitAtPlayhead = useVideoToolStore((state) => state.splitAtPlayhead)
  const deleteSelected = useVideoToolStore((state) => state.deleteSelected)
  const trimSelected = useVideoToolStore((state) => state.trimSelected)
  const moveSelected = useVideoToolStore((state) => state.moveSelected)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [frameFormat, setFrameFormat] = useState<FrameFormat>('png')
  const [audioFormat, setAudioFormat] = useState<AudioFormat>('wav')
  const [resolution, setResolution] = useState<ProjectResolution>('original')
  const [generatedFrame, setGeneratedFrame] = useState<string | null>(null)
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null)
  const [generatedExport, setGeneratedExport] = useState<string | null>(null)
  const [audioExportMode, setAudioExportMode] = useState<'original' | 'speaker'>('original')
  const [speakerAudio, setSpeakerAudio] = useState<Array<{ speaker: string; url: string; duration: number }>>([])
  const [busyOperation, setBusyOperation] = useState<string | null>(null)
  const activeOperationRef = useRef<string | null>(null)

  const selectedClip = manifest?.timeline.videoTrack.find((clip) => clip.id === selectedClipId)
  const selectedIndex = manifest?.timeline.videoTrack.findIndex((clip) => clip.id === selectedClipId) ?? -1
  const splitOffset = manifest && selectedClip ? playhead - (manifest.timeline.videoTrack.slice(0, selectedIndex).reduce((total, clip) => total + clip.sourceEnd - clip.sourceStart, 0)) : 0
  const canSplit = !!selectedClip && Number.isFinite(splitOffset) && splitOffset > 0 && splitOffset < selectedClip.sourceEnd - selectedClip.sourceStart
  const canMoveUp = selectedIndex > 0
  const canMoveDown = selectedIndex >= 0 && !!manifest && selectedIndex < manifest.timeline.videoTrack.length - 1
  const trimStart = Number(start)
  const trimEnd = Number(end)
  const sourceDuration = manifest?.media?.duration ?? Number.NaN
  const canTrim = !!selectedClip && Number.isFinite(trimStart) && Number.isFinite(trimEnd) && trimStart >= 0 && trimEnd > trimStart && trimEnd <= sourceDuration && (trimStart !== selectedClip.sourceStart || trimEnd !== selectedClip.sourceEnd)
  useEffect(() => {
    setStart(selectedClip ? String(selectedClip.sourceStart) : '')
    setEnd(selectedClip ? String(selectedClip.sourceEnd) : '')
  }, [selectedClip])
  useEffect(() => {
    return () => {
      const operationId = activeOperationRef.current
      if (operationId) {
        if (projectId) void window.electronAPI.projectCancel(projectId, operationId)
        activeOperationRef.current = null
        setBusyOperation(null)
        setProgress(null)
      }
    }
  }, [projectId, setProgress])

  useEffect(() => {
    if (!manifest) return
    const unsubscribe = window.electronAPI.onProjectProgress((event) => {
      if (event.projectId !== manifest.id || event.operationId !== busyOperation) return
      setProgress({ operationId: event.operationId, stage: event.stage, percent: event.percent })
    })
    return unsubscribe
  }, [busyOperation, manifest, setProgress])

  const refreshManifest = async (expectedProjectId: string, expectedGeneration: number) => {
    const refreshed = await window.electronAPI.projectOpen(expectedProjectId)
    return mergePersistedManifest(refreshed, expectedProjectId, expectedGeneration)
  }

  const runOperation = async (operation: string, action: (operationId: string) => Promise<void>) => {
    if (!projectId) return
    const operationId = crypto.randomUUID()
    activeOperationRef.current = operationId
    setBusyOperation(operationId)
    setError(null)
    setProgress({ operationId, stage: operation, percent: 0 })
    try { await action(operationId) } catch (cause) { if (activeOperationRef.current === operationId) setError(cause instanceof Error ? cause.message : String(cause)) } finally {
      if (activeOperationRef.current === operationId) {
        activeOperationRef.current = null
        setBusyOperation(null)
        setProgress(null)
      }
    }
  }

  const captureFrame = () => runOperation('frame', async (operationId) => {
    if (!manifest || !projectId) return
    const expectedGeneration = sessionGeneration
    const result = await window.electronAPI.projectExtractFrame(projectId, { assetPath: manifest.assets.video, timestamp: timelineToSourceTime(manifest, playhead), format: frameFormat }, operationId)
    if (!await refreshManifest(projectId, expectedGeneration)) return
    const current = useVideoToolStore.getState()
    if (current.projectId !== projectId || current.sessionGeneration !== expectedGeneration || activeOperationRef.current !== operationId) return
    const url = await window.electronAPI.projectAssetUrl(projectId, result.assetPath)
    if (useVideoToolStore.getState().projectId === projectId && activeOperationRef.current === operationId) setGeneratedFrame(url)
  })

  const extractAudio = () => runOperation('audio', async (operationId) => {
    if (!projectId) return
    const expectedGeneration = sessionGeneration
    const result = await window.electronAPI.projectExtractAudio(projectId, { format: audioFormat }, operationId)
    if (!await refreshManifest(projectId, expectedGeneration)) return
    const current = useVideoToolStore.getState()
    if (current.projectId !== projectId || current.sessionGeneration !== expectedGeneration || activeOperationRef.current !== operationId) return
    const url = await window.electronAPI.projectAssetUrl(projectId, result.assetPath)
    if (useVideoToolStore.getState().projectId === projectId && useVideoToolStore.getState().sessionGeneration === expectedGeneration && activeOperationRef.current === operationId) setGeneratedAudioUrl(url)
  })

  const extractSpeakerAudio = () => runOperation('speaker-analysis', async (operationId) => {
    if (!projectId) return
    const expectedGeneration = sessionGeneration
    const result = await window.electronAPI.projectExtractSpeakerAudio(projectId, { format: audioFormat }, operationId)
    if (!await refreshManifest(projectId, expectedGeneration)) return
    const current = useVideoToolStore.getState()
    if (current.projectId !== projectId || current.sessionGeneration !== expectedGeneration || activeOperationRef.current !== operationId) return
    const files = await Promise.all(result.files.map(async (file) => ({ speaker: file.speaker, url: await window.electronAPI.projectAssetUrl(projectId, file.assetPath), duration: file.duration })))
    if (useVideoToolStore.getState().projectId === projectId && useVideoToolStore.getState().sessionGeneration === expectedGeneration && activeOperationRef.current === operationId) setSpeakerAudio(files)
  })


  const render = () => runOperation('rendering', async (operationId) => {
    if (!projectId || !manifest) return
    const expectedGeneration = sessionGeneration
    const result = await window.electronAPI.projectRender(projectId, { resolution, timeline: manifest.timeline, outputName: `export-${Date.now()}` }, operationId)
    if (useVideoToolStore.getState().projectId !== projectId || useVideoToolStore.getState().sessionGeneration !== expectedGeneration || activeOperationRef.current !== operationId) return
    const url = await window.electronAPI.projectAssetUrl(projectId, result.assetPath)
    if (useVideoToolStore.getState().projectId === projectId && activeOperationRef.current === operationId) setGeneratedExport(url)
  })

  const cancel = () => {
    if (projectId && busyOperation) void window.electronAPI.projectCancel(projectId, busyOperation)
  }

  return (
    <aside className="w-96 min-w-96 shrink-0 border-l border-outline-variant/40 bg-surface-container p-4 overflow-auto space-y-5">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-on-surface">{t('videoTool.tools')}</h2><span className={`text-xs ${saveState === 'error' ? 'text-error' : 'text-outline'}`}>{saveState === 'saving' ? t('videoTool.saving') : saveState === 'error' ? t('videoTool.saveError') : t('videoTool.saved')}</span></div>
      {saveError && <p className="text-xs text-error break-words">{saveError}</p>}
      {error && <p className="text-xs text-error break-words">{error}</p>}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-outline">{t('videoTool.clipTools')}</p>
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={splitAtPlayhead} disabled={!!busyOperation || !canSplit} className="tool-button">{t('videoTool.split')}</button><button type="button" onClick={deleteSelected} disabled={!!busyOperation || !selectedClip || manifest?.timeline.videoTrack.length === 1} className="tool-button">{t('videoTool.delete')}</button><button type="button" onClick={() => moveSelected(-1)} disabled={!!busyOperation || !canMoveUp} className="tool-button">{t('videoTool.moveUp')}</button><button type="button" onClick={() => moveSelected(1)} disabled={!!busyOperation || !canMoveDown} className="tool-button">{t('videoTool.moveDown')}</button></div>
        <div className="grid grid-cols-2 gap-2"><label className="text-xs text-outline">{t('videoTool.start')}<input type="number" min="0" step="0.01" value={start} onChange={(event) => setStart(event.target.value)} className="tool-input" /></label><label className="text-xs text-outline">{t('videoTool.end')}<input type="number" min="0" step="0.01" value={end} onChange={(event) => setEnd(event.target.value)} className="tool-input" /></label></div><button type="button" onClick={() => trimSelected(trimStart, trimEnd)} disabled={!!busyOperation || !canTrim} className="w-full tool-button">{t('videoTool.applyTrim')}</button>
      </div>
      <div className="space-y-2"><p className="text-xs uppercase tracking-wider text-outline">{t('videoTool.capture')}</p><div className="flex gap-2"><select value={frameFormat} onChange={(event) => setFrameFormat(event.target.value as FrameFormat)} className="tool-input"><option value="png">PNG</option><option value="jpeg">JPEG</option></select><button type="button" onClick={() => void captureFrame()} disabled={!!busyOperation} className="flex-1 tool-button">{t('videoTool.captureFrame')}</button></div>{generatedFrame && <img src={generatedFrame} alt={t('videoTool.generatedFrame')} className="w-full rounded border border-outline-variant" />}</div>
      <div className="space-y-2"><p className="text-xs uppercase tracking-wider text-outline">{t('videoTool.audioExport')}</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setAudioExportMode('original'); setSpeakerAudio([]) }} className={`tool-button ${audioExportMode === 'original' ? 'border-primary text-on-surface' : ''}`}>{t('videoTool.originalTrack')}</button><button type="button" onClick={() => { setAudioExportMode('speaker'); setGeneratedAudioUrl(null) }} className={`tool-button ${audioExportMode === 'speaker' ? 'border-primary text-on-surface' : ''}`}>{t('videoTool.speakerExport')}</button></div>{audioExportMode === 'speaker' && <p className="text-xs text-on-surface-variant">{t('videoTool.speakerAudioDescription')}</p>}<div className="flex gap-2"><select value={audioFormat} onChange={(event) => { setAudioFormat(event.target.value as AudioFormat); setGeneratedAudioUrl(null); setSpeakerAudio([]) }} className="tool-input"><option value="wav">WAV</option><option value="mp3">MP3</option><option value="m4a">M4A</option></select><button type="button" onClick={() => void (audioExportMode === 'original' ? extractAudio() : extractSpeakerAudio())} disabled={!!busyOperation} className="flex-1 tool-button">{audioExportMode === 'original' ? t('videoTool.extractAudio') : t('videoTool.exportSpeakerAudio')}</button></div>{audioExportMode === 'original' && generatedAudioUrl && <audio src={generatedAudioUrl} controls className="w-full" />}{audioExportMode === 'speaker' && speakerAudio.map((file) => <div key={`${file.speaker}-${file.url}`} className="space-y-1"><p className="text-xs text-on-surface-variant">{file.speaker} · {formatTime(file.duration)}</p><audio src={file.url} controls className="w-full" /></div>)}</div>
      <div className="space-y-2"><p className="text-xs uppercase tracking-wider text-outline">{t('videoTool.export')}</p><div className="flex gap-2"><select value={resolution} onChange={(event) => setResolution(event.target.value as ProjectResolution)} className="tool-input"><option value="original">{t('export.resOriginal')}</option><option value="1080p">1080p</option><option value="720p">720p</option><option value="480p">480p</option></select><button type="button" onClick={() => void render()} disabled={!!busyOperation} className="flex-1 tool-button">{t('videoTool.render')}</button></div>{generatedExport && <video src={generatedExport} controls className="w-full rounded border border-outline-variant" />}</div>
      {progress && <div className="rounded-lg bg-surface-container-high p-3 space-y-2"><div className="flex justify-between text-xs text-on-surface-variant"><span>{t(`videoTool.stage.${progress.stage}`)}</span><span>{Math.round(progress.percent)}%</span></div><div className="h-1 rounded-full bg-surface-variant"><div className="h-full bg-primary rounded-full" style={{ width: `${progress.percent}%` }} /></div><button type="button" onClick={cancel} className="text-xs text-error hover:underline">{t('videoTool.cancel')}</button></div>}
    </aside>
  )
}
