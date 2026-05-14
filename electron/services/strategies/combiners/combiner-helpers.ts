import { createRequire } from 'node:module'
import ffmpeg from 'fluent-ffmpeg'
import { existsSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ffmpegStatic = require('ffmpeg-static') as string | null
const ffprobeStatic = require('ffprobe-static') as { path?: string } | string

export const ffmpegPath = ffmpegStatic
export const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic.path

if (typeof ffmpegPath === 'string') ffmpeg.setFfmpegPath(ffmpegPath)
if (typeof ffprobePath === 'string') ffmpeg.setFfprobePath(ffprobePath)

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function normalizeCombineError(error: unknown): Error {
  const message = toErrorMessage(error)
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

export function timeMarkToSeconds(timemark: string): number {
  const parts = timemark.split(':')
  if (parts.length !== 3) return 0
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0
  return hours * 3600 + minutes * 60 + seconds
}

function escapeSubtitleFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '\\\\')
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

export function buildSubtitleFilter(subtitlePath: string): string {
  // subtitles 滤镜参数用冒号分隔，路径中的特殊字符必须先转义，否则会被 ffmpeg 当作选项边界。
  const filterParts = [`subtitles=${escapeSubtitleFilterPath(subtitlePath)}`]
  const fontsDir = getFontsDir()
  if (fontsDir) filterParts.push(`fontsdir=${escapeSubtitleFilterPath(fontsDir)}`)
  filterParts.push("force_style='Alignment=2,MarginV=60'")
  return `[0:v]${filterParts.join(':')}[v]`
}
