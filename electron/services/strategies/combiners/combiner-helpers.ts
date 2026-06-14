import { createRequire } from 'node:module'
import ffmpeg from 'fluent-ffmpeg'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { resolvePackagedPath } from '../../resolve-packaged-path.js'

const require = createRequire(import.meta.url)
const ffmpegStatic = require('ffmpeg-static') as string | null
const ffprobeStatic = require('ffprobe-static') as { path?: string } | string

export const ffmpegPath = resolvePackagedPath(ffmpegStatic)
export const ffprobePath = resolvePackagedPath(typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic.path)

if (typeof ffmpegPath === 'string') ffmpeg.setFfmpegPath(ffmpegPath)
if (typeof ffprobePath === 'string') ffmpeg.setFfprobePath(ffprobePath)

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function normalizeCombineError(error: unknown): Error {
  const message = toErrorMessage(error)
  console.error(`[ffmpeg-combiner] Raw error: ${message}`)
  const lower = message.toLowerCase()

  if (
    lower.includes('enoent') ||
    lower.includes('ffmpeg binary not found') ||
    lower.includes('ffprobe binary not found') ||
    lower.includes('spawn ffmpeg')
  ) {
    return new Error('ffmpeg binary not found')
  }
  if (
    lower.includes('enospc') ||
    lower.includes('no space left on device') ||
    lower.includes('disk quota exceeded') ||
    lower.includes('insufficient disk space')
  ) {
    return new Error('Insufficient disk space while combining video')
  }
  if (
    lower.includes('eacces') ||
    lower.includes('permission denied') ||
    lower.includes('operation not permitted')
  ) {
    return new Error('Permission denied while combining video')
  }
  if (
    lower.includes('invalid data found when processing input') ||
    lower.includes('moov atom not found') ||
    lower.includes('invalid argument') ||
    lower.includes('could not find codec parameters') ||
    lower.includes('error while opening')
  ) {
    return new Error('Invalid media file provided to combiner')
  }
  if (lower.includes('error reinitializing filters') || lower.includes('subtitle') || lower.includes('encoding')) {
    return new Error(`Video combination failed: ${message}`)
  }

  return error instanceof Error ? error : new Error(message)
}

export function getDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error) {
        reject(normalizeCombineError(error))
        return
      }
      const duration = data.format?.duration
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        reject(new Error('Unable to determine video duration'))
        return
      }
      resolve(duration)
    })
  })
}

export function getDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error) {
        reject(normalizeCombineError(error))
        return
      }
      const videoStream = data.streams.find((s) => s.codec_type === 'video')
      const width = videoStream?.width
      const height = videoStream?.height
      if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
        reject(new Error('Unable to determine video dimensions'))
        return
      }
      resolve({ width, height })
    })
  })
}

export function timeMarkToSeconds(timemark: string): number {
  const parts = timemark.split(':')
  if (parts.length !== 3) return 0
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0
  return hours * 3600 + minutes * 60 + seconds
}

/**
 * ffmpeg MSYS2 版本不识别 filter 中的 \: 转义。
 * 将 Windows 路径转为 POSIX 格式：D:\foo\bar → /d/foo/bar
 * macOS / Linux 路径不变。
 */
function escapeSubtitleFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/'/g, "\\'")
}

function getFontsDir(): string | null {
  // ffmpeg subtitles 滤镜不会自动覆盖所有系统字体路径，按平台补 fontsdir 提升字体命中率。
  const candidates =
    process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts']
      : process.platform === 'win32'
        ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
        : ['/usr/share/fonts', '/usr/local/share/fonts']

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function buildSubtitleFilter(subtitlePath: string, sizePreset?: string): string {
  const filterParts = [`subtitles=${escapeSubtitleFilterPath(subtitlePath)}`]
  if (sizePreset) filterParts.push(`original_size=${sizePreset}`)
  filterParts.push('force_style=Alignment\\=2\\,MarginV\\=60')
  return `[0:v]${filterParts.join(':')}[v]`
}

/**
 * Merges overlapping or nearly-adjacent speech segments into non-overlapping intervals.
 * Segments within `gap` seconds of each other are merged to avoid tiny unmuted windows.
 */
export function mergeOverlappingSegments(
  segments: { start: number; end: number }[],
  gap = 0.06,
): { start: number; end: number }[] {
  if (segments.length === 0) return []

  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]

    if (current.start <= last.end + gap) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}

const FADE_DURATION = 0.03 // 30ms fade at segment boundaries

/**
 * Builds a volume expression that mutes the original audio during speech segments
 * with 30ms linear fades at each boundary to prevent audio pops.
 *
 * The expression creates a trapezoidal envelope per segment:
 *   volume = 1 outside speech, fades to 0 over 30ms at start, stays 0, fades back to 1 over 30ms at end.
 *
 * @returns The full volume filter string, e.g. `volume='<expr>':eval=frame`
 */
export function buildVolumeExpression(segments: { start: number; end: number }[]): string {
  if (segments.length === 0) return "volume=1"

  // Build per-segment trapezoidal gate expressions
  // Gate(t, s, e) = rampUp(t, s-fade, s) * rampDown(t, e, e+fade)
  //   rampUp   = min(1, max(0, (t - (s - fade)) / fade))
  //   rampDown = min(1, max(0, ((e + fade) - t) / fade))
  // Gate is 1 during segment, 0 outside, linear ramp at edges
  const gateExprs = segments.map(({ start, end }) => {
    const fadeInStart = Math.max(0, start - FADE_DURATION).toFixed(4)
    const fadeOutEnd = (end + FADE_DURATION).toFixed(4)
    const invFade = (1 / FADE_DURATION).toFixed(2)
    const rampUp = `min(1,max(0,(t-${fadeInStart})*${invFade}))`
    const rampDown = `min(1,max(0,(${fadeOutEnd}-t)*${invFade}))`
    return `${rampUp}*${rampDown}`
  })

  // Combine gates with nested max() — union of all speech windows
  let combined = gateExprs[0]
  for (let i = 1; i < gateExprs.length; i++) {
    combined = `max(${combined},${gateExprs[i]})`
  }

  // Volume = 1 - gate (invert: mute during speech, pass during non-speech)
  return `volume='1-${combined}':eval=frame`
}

/**
 * Builds the full filter_complex string for mix-gate mode.
 * Mutes original audio during speech, pads TTS to video duration, and mixes both.
 */
export function buildMixGateFilterComplex(
  subtitleFilter: string,
  speechSegments: { start: number; end: number }[],
  duration: number,
): string {
  const merged = mergeOverlappingSegments(speechSegments)
  const volumeFilter = buildVolumeExpression(merged)

  return [
    subtitleFilter,
    `[0:a]${volumeFilter}[bg]`,
    `[1:a]apad=whole_dur=${duration}[tts]`,
    `[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[a]`,
  ].join(';')
}

/**
 * Builds the full filter_complex string for mix-vocal-removal mode.
 * Pads instrumental track and TTS to video duration, then mixes both.
 */
export function buildVocalRemovalFilterComplex(
  subtitleFilter: string,
  duration: number,
): string {
  return [
    subtitleFilter,
    `[2:a]apad=whole_dur=${duration}[bg]`,
    `[1:a]apad=whole_dur=${duration}[tts]`,
    `[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[a]`,
  ].join(';')
}
