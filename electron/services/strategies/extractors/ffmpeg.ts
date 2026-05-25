import ffmpeg from 'fluent-ffmpeg'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppConfig, AudioExtractorStrategy, AudioResult } from '../../types.js'

import { resolvePackagedPath } from '../../resolve-packaged-path.js'

const require = createRequire(import.meta.url)
const ffmpegStatic = require('ffmpeg-static') as string | null
const ffprobeStatic = require('ffprobe-static') as { path?: string } | string

const ffmpegPath = resolvePackagedPath(ffmpegStatic)
const ffprobePath = resolvePackagedPath(typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic.path)

if (!ffmpegPath) throw new Error('ffmpeg binary not found')
if (!ffprobePath) throw new Error('ffprobe binary not found')

ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath)

function normalizeExtractionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (lower.includes('enoent') || lower.includes('ffmpeg not found') || lower.includes('spawn ffmpeg')) {
    return new Error('ffmpeg binary not found')
  }
  if (lower.includes('eacces') || lower.includes('permission denied') || lower.includes('operation not permitted')) {
    return new Error('Permission denied while extracting audio')
  }
  if (
    lower.includes('invalid data found when processing input') ||
    lower.includes('moov atom not found') ||
    lower.includes('invalid argument') ||
    lower.includes('could not find codec parameters')
  ) {
    return new Error('Invalid video file')
  }

  return error instanceof Error ? error : new Error(message)
}

function getDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error) {
        reject(normalizeExtractionError(error))
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

function timeMarkToSeconds(timemark: string): number {
  const parts = timemark.split(':')
  if (parts.length !== 3) return 0
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])
  if (![hours, minutes, seconds].every(Number.isFinite)) return 0
  return hours * 3600 + minutes * 60 + seconds
}

export default class FfmpegExtractor implements AudioExtractorStrategy {
  readonly name = 'ffmpeg'
  constructor(private readonly config: AppConfig) {}

  async extract(input: {
    videoPath: string
    outputDir: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
  }): Promise<AudioResult> {
    const { videoPath, outputDir, onProgress, signal } = input
    const duration = await getDuration(videoPath)
    await fs.mkdir(outputDir, { recursive: true })
    const outputPath = path.join(outputDir, 'audio.wav')

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Pipeline cancelled'))
        return
      }

      const command = ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .on('progress', (progress) => {
          const currentTime = progress.timemark ? timeMarkToSeconds(progress.timemark) : 0
          const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100))
          onProgress(pct)
        })
        .on('end', () => {
          signal?.removeEventListener('abort', onAbort)
          onProgress(100)
          resolve()
        })
        .on('error', (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(normalizeExtractionError(error))
        })
        .save(outputPath)

      const onAbort = () => {
        command.kill('SIGTERM')
        reject(new Error('Pipeline cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })

    return { audioPath: outputPath }
  }
}
