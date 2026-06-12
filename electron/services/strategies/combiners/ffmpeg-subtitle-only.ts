import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppConfig, CombinerStrategy, CombineResult } from '../../types.js'
import {
  ffmpegPath, ffprobePath,
  normalizeCombineError, getDuration, getDimensions, timeMarkToSeconds, buildSubtitleFilter,
} from './combiner-helpers.js'

export default class FfmpegSubtitleOnlyCombiner implements CombinerStrategy {
  readonly name = 'ffmpeg-subtitle-only'
  constructor(private readonly config: AppConfig) {}

  async combine(input: {
    videoPath: string
    audioPath?: string
    subtitlePath?: string
    outputPath: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
  }): Promise<CombineResult> {
    const { videoPath, subtitlePath, outputPath, onProgress, signal } = input

    if (!ffmpegPath || !ffprobePath) throw new Error('ffmpeg binary not found')

    const duration = await getDuration(videoPath)
    const dimensions = await getDimensions(videoPath)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const subtitleFilter = subtitlePath ? buildSubtitleFilter(subtitlePath, dimensions.width, dimensions.height) : null

    const outputOptions: string[] = subtitleFilter
      ? [
          '-filter_complex', subtitleFilter,
          '-map', '[v]',
          '-map', '0:a',
          '-c:v', 'libx264',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'copy',
          '-movflags', '+faststart',
        ]
      : [
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-movflags', '+faststart',
        ]

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Pipeline cancelled'))
        return
      }

      const command = ffmpeg()
        .input(videoPath)
        .outputOptions(outputOptions)
        .on('progress', (info) => {
          const currentTime = info.timemark ? timeMarkToSeconds(info.timemark) : 0
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
          reject(normalizeCombineError(error))
        })
        .save(outputPath)

      const onAbort = () => {
        command.kill('SIGTERM')
        reject(new Error('Pipeline cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })

    return { outputPath }
  }
}
