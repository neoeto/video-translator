import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppConfig, CombinerStrategy, CombineResult } from '../../types.js'
import {
  ffmpegPath, ffprobePath,
  normalizeCombineError, getDuration, timeMarkToSeconds, buildSubtitleFilter,
  buildMixGateFilterComplex,
  buildVocalRemovalFilterComplex,
} from './combiner-helpers.js'

export default class FfmpegCombiner implements CombinerStrategy {
  readonly name = 'ffmpeg'
  constructor(private readonly config: AppConfig) {}

  async combine(input: {
    videoPath: string
    audioPath?: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
    speechSegments?: { start: number; end: number }[]
    instrumentalPath?: string
  }): Promise<CombineResult> {
    const { videoPath, audioPath, subtitlePath, outputPath, onProgress, signal, speechSegments, instrumentalPath } = input

    if (!audioPath) throw new Error('FfmpegCombiner requires audioPath for full translation mode')
    if (!ffmpegPath || !ffprobePath) throw new Error('ffmpeg binary not found')

    const duration = await getDuration(videoPath)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const subtitleFilter = buildSubtitleFilter(subtitlePath)

    const useMixGate = this.config.audioMixMode === 'mix-gate' && speechSegments && speechSegments.length > 0
    const useVocalRemoval = this.config.audioMixMode === 'mix-vocal-removal' && !!instrumentalPath

    const filterComplex = useMixGate
      ? buildMixGateFilterComplex(subtitleFilter, speechSegments, duration)
      : useVocalRemoval
        ? buildVocalRemovalFilterComplex(subtitleFilter, duration)
        : `${subtitleFilter};[1:a]apad=whole_dur=${duration}[a]`

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Pipeline cancelled'))
        return
      }

      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)

      if (useVocalRemoval && instrumentalPath) {
        command.input(instrumentalPath)
      }

      command
        .outputOptions([
          '-filter_complex', filterComplex,
          '-map', '[v]',
          '-map', '[a]',
          '-c:v', 'libx264',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
        ])
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
