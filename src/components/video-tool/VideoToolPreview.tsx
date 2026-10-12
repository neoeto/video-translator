import React, { useEffect, useRef } from 'react'
import { getTimelineDuration, timelineToSourceTime, useVideoToolStore } from '../../store/useVideoToolStore'
import { useI18n } from '../../i18n'

function formatTime(value: number): string {
  const safe = Math.max(0, value)
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const VideoToolPreview: React.FC = () => {
  const t = useI18n((state) => state.t)
  const manifest = useVideoToolStore((state) => state.manifest)
  const playhead = useVideoToolStore((state) => state.playhead)
  const setPlayhead = useVideoToolStore((state) => state.setPlayhead)
  const [url, setUrl] = React.useState<string | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [videoReady, setVideoReady] = React.useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentClipIndexRef = useRef(0)
  const handleVideoRef = React.useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
    setVideoReady(Boolean(element))
  }, [])

  useEffect(() => {
    if (!manifest) return
    let active = true
    void window.electronAPI.projectAssetUrl(manifest.id, manifest.assets.video)
      .then((assetUrl) => { if (active) setUrl(assetUrl) })
      .catch(() => { if (active) setUrl(null) })
    return () => { active = false }
  }, [manifest])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !manifest) return
    const clips = manifest.timeline.videoTrack
    if (clips.length === 0) return
    let remaining = Math.max(0, playhead)
    currentClipIndexRef.current = clips.length - 1
    for (let index = 0; index < clips.length; index += 1) {
      const length = Math.max(0, clips[index].sourceEnd - clips[index].sourceStart)
      if (remaining < length || index === clips.length - 1) {
        currentClipIndexRef.current = index
        break
      }
      remaining -= length
    }
    const sourceTime = timelineToSourceTime(manifest, playhead)
    if (Math.abs(video.currentTime - sourceTime) > 0.25) video.currentTime = sourceTime
  }, [manifest, playhead])

 
  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video || !manifest) return
    const clips = manifest.timeline.videoTrack
    if (clips.length === 0) {
      video.pause()
      setPlayhead(0)
      return
    }
    const index = Math.min(currentClipIndexRef.current, clips.length - 1)
    const clip = clips[index]
    let elapsed = 0
    for (let prior = 0; prior < index; prior += 1) elapsed += Math.max(0, clips[prior].sourceEnd - clips[prior].sourceStart)
    if (video.currentTime < clip.sourceStart) {
      video.currentTime = clip.sourceStart
      setPlayhead(elapsed)
      return
    }
    if (video.currentTime >= clip.sourceEnd) {
      if (index < clips.length - 1) {
        const nextIndex = index + 1
        currentClipIndexRef.current = nextIndex
        video.currentTime = clips[nextIndex].sourceStart
        setPlayhead(elapsed + Math.max(0, clip.sourceEnd - clip.sourceStart))
        return
      }
      setPlayhead(getTimelineDuration(manifest))
      video.pause()
      return
    }
    setPlayhead(elapsed + video.currentTime - clip.sourceStart)
  }

  const seek = (event: React.ChangeEvent<HTMLInputElement>) => setPlayhead(Number(event.target.value))
  const togglePlay = async () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) await video.play()
    else video.pause()
  }

  if (!manifest) return <div className="flex-1 flex items-center justify-center text-outline">{t('videoTool.loading')}</div>
  const duration = getTimelineDuration(manifest)
  return (
    <section className="flex-1 min-w-0 flex flex-col bg-black/20 p-5">
      <div className="flex-1 min-h-0 flex items-center justify-center rounded-xl bg-black overflow-hidden">
        {url ? <video ref={handleVideoRef} src={url} className="max-w-full max-h-full" onTimeUpdate={handleTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} preload="metadata" /> : <span className="text-outline">{t('videoTool.previewUnavailable')}</span>}
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs text-on-surface-variant">
        <button type="button" onClick={() => void togglePlay()} disabled={!url || !videoReady || !videoRef.current} className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed" title={playing ? t('videoTool.pause') : t('videoTool.play')}><span className="material-symbols-outlined">{playing ? 'pause' : 'play_arrow'}</span></button>
        <span className="font-mono w-12">{formatTime(playhead)}</span>
        <input type="range" min="0" max={Math.max(0.01, duration)} step="0.01" value={Math.min(playhead, duration)} onChange={seek} className="flex-1 accent-primary" aria-label={t('videoTool.seek')} />
        <span className="font-mono w-12 text-right">{formatTime(duration)}</span>
      </div>
    </section>
  )
}
