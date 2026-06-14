import React, { useEffect, useRef, useCallback, useState } from 'react'
import { useEditorStore } from '../../store/useEditorStore'
import { useI18n } from '../../i18n'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
}

function toMediaUrl(filePath: string, port: number): string {
  return `http://127.0.0.1:${port}/${encodeURIComponent(filePath)}`
}

export const VideoPreview: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef<number>(0)
  const [mediaPort, setMediaPort] = useState(0)

  const videoPath = useEditorStore(s => s.videoPath)
  const audioPath = useEditorStore(s => s.audioPath)
  const hasSynthesizedAudio = useEditorStore(s => s.hasSynthesizedAudio)
  const isPlaying = useEditorStore(s => s.isPlaying)
  const currentTime = useEditorStore(s => s.currentTime)
  const segments = useEditorStore(s => s.segments)
  const segmentTimings = useEditorStore(s => s.segmentTimings)
  const setPlaying = useEditorStore(s => s.setPlaying)
  const setCurrentTime = useEditorStore(s => s.setCurrentTime)
  const duration = useEditorStore(s => s.duration)
  const t = useI18n(s => s.t)

  // Fetch media server port on mount
  useEffect(() => {
    window.electronAPI.getMediaServerPort().then(setMediaPort)
  }, [])

  // Map video time to audio time based on segment timings
  const videoTimeToAudioTime = useCallback((vTime: number): number | null => {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg.deleted) continue
      if (i >= segmentTimings.length) continue
      const timing = segmentTimings[i]
      if (vTime >= seg.start && vTime <= seg.end) {
        const segDuration = seg.end - seg.start
        if (segDuration <= 0) return null
        const progress = (vTime - seg.start) / segDuration
        return timing.start + progress * timing.actualDuration
      }
    }
    return null
  }, [segments, segmentTimings])

  // Get active subtitle at current time
  const activeSubtitle = segments.find(
    s => !s.deleted && currentTime >= s.start && currentTime <= s.end
  )

  // Sync video element when currentTime is changed from external sources (timeline, subtitle panel)
  const isPlayingRef = useRef(false)
  isPlayingRef.current = isPlaying

  useEffect(() => {
    const video = videoRef.current
    if (!video || isPlayingRef.current) return
    if (Math.abs(video.currentTime - currentTime) > 0.1) {
      video.currentTime = currentTime
      const audio = audioRef.current
      if (audio) {
        const audioTime = videoTimeToAudioTime(currentTime)
        if (audioTime !== null) audio.currentTime = audioTime
      }
    }
  }, [currentTime, videoTimeToAudioTime])

  // Playback sync loop — runs independently from React render cycle
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let raf = 0
    let lastStoreUpdate = 0

    const loop = () => {
      if (!isPlayingRef.current) return
      const vt = video.currentTime

      // Throttle store updates to ~15fps to avoid re-render storms
      const now = performance.now()
      if (now - lastStoreUpdate > 66) {
        setCurrentTime(vt)
        lastStoreUpdate = now
      }

      // Audio sync — only for separate TTS audio, not when using video's own audio
      if (hasSynthesizedAudio) {
        const audio = audioRef.current
        if (audio && !audio.paused) {
          const audioTime = videoTimeToAudioTime(vt)
          if (audioTime === null) {
            audio.volume = 0
          } else {
            audio.volume = 1
            const drift = Math.abs(audio.currentTime - audioTime)
            if (drift > 0.3) {
              audio.currentTime = audioTime
            }
          }
        }
      }

      raf = requestAnimationFrame(loop)
    }

    // Error listener for debugging
    const onError = () => console.error('[VideoPreview] video error:', video.error?.message, video.error?.code)
    video.addEventListener('error', onError)

    if (isPlaying) {
      // Always sync video position to store's currentTime before playing
      const storeTime = useEditorStore.getState().currentTime
      video.currentTime = storeTime
      if (hasSynthesizedAudio) {
        const audio = audioRef.current
        if (audio) {
          const audioTime = videoTimeToAudioTime(storeTime)
          if (audioTime !== null) audio.currentTime = audioTime
        }
      }
      video.play()
        .catch((err) => {
          console.error('[VideoPreview] play() REJECTED:', err.name, err.message)
          setPlaying(false)
        })
      if (hasSynthesizedAudio) {
        audioRef.current?.play().catch((err) => console.warn('[Editor] Audio play failed:', err))
      }
      raf = requestAnimationFrame(loop)
    } else {
      video.pause()
      if (hasSynthesizedAudio) {
        audioRef.current?.pause()
      }
    }

    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('error', onError)
    }
  }, [isPlaying, hasSynthesizedAudio, setCurrentTime, setPlaying, videoTimeToAudioTime])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const time = pct * duration
    video.currentTime = time
    setCurrentTime(time)

    const audio = audioRef.current
    if (audio) {
      const audioTime = videoTimeToAudioTime(time)
      if (audioTime !== null) {
        audio.currentTime = audioTime
      }
    }
  }, [duration, setCurrentTime, videoTimeToAudioTime])

  const togglePlay = useCallback(() => {
    setPlaying(!isPlaying)
  }, [isPlaying, setPlaying])

  // Space bar to toggle play/pause
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying(!isPlaying)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isPlaying, setPlaying])

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#0B0B0B]">
      <div className="relative w-full max-w-4xl aspect-video bg-black rounded-lg overflow-hidden border border-surface-variant shadow-[0px_4px_12px_rgba(0,0,0,0.5)]">
        <video
          ref={videoRef}
          src={videoPath && mediaPort ? toMediaUrl(videoPath, mediaPort) : undefined}
          className="w-full h-full object-contain"
          muted={hasSynthesizedAudio}
          playsInline
        />
        {hasSynthesizedAudio && audioPath && mediaPort > 0 && (
          <audio
            ref={audioRef}
            src={toMediaUrl(audioPath, mediaPort)}
            preload="auto"
          />
        )}

        {/* Subtitle overlay */}
        {activeSubtitle && (
          <div className="absolute bottom-10 left-0 w-full text-center px-8 pointer-events-none">
            <span className="bg-black/70 text-white px-4 py-2 rounded text-lg inline-block font-medium drop-shadow-md border border-white/10 backdrop-blur-sm">
              {activeSubtitle.targetText}
            </span>
          </div>
        )}

        {/* Controls bar */}
        <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-4 flex flex-col gap-2">
          {/* Scrubber */}
          <div
            className="h-1 bg-white/20 rounded-full w-full relative cursor-pointer"
            onClick={handleSeek}
          >
            <div
              className="absolute left-0 top-0 h-full bg-primary rounded-full"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow"
              style={{ left: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="flex items-center gap-4">
              <button className="text-white hover:text-primary transition-colors" onClick={togglePlay}>
                <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {isPlaying ? 'pause' : 'play_arrow'}
                </span>
              </button>
              <span className="font-mono text-xs text-white/90" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
