import ffmpeg from 'fluent-ffmpeg'
import { existsSync, promises as fs, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppConfig, CombinerStrategy, CombineResult } from '../../types.js'
import {
  ffmpegPath, ffprobePath,
  normalizeCombineError, getDuration, getDimensions, timeMarkToSeconds,
  buildMixGateFilterComplex,
  buildVocalRemovalFilterComplex,
} from './combiner-helpers.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function checkInputFile(label: string, filePath: string | undefined): string | null {
  if (!filePath) return `${label} is not provided`
  if (!existsSync(filePath)) return `${label} not found: ${filePath}`
  try {
    const size = statSync(filePath).size
    if (size === 0) return `${label} is empty: ${filePath}`
    console.log(`[ffmpeg-combiner] ${label}: ${formatBytes(size)} (${filePath})`)
  } catch (err) {
    return `${label} cannot be read: ${err instanceof Error ? err.message : err}`
  }
  return null
}

/**
 * 视频尺寸 → ffmpeg 命名预设。
 * subtitles/ass 滤镜的 original_size 在 filter_complex 中用数字尺寸偶发 Invalid argument，
 * 改用标准命名预设回避。
 */
function toVideoSizePreset(width: number, height: number): string | null {
  const presets: Record<string, string> = {
    '1280x720': 'hd720',
    '1920x1080': 'hd1080',
    '720x480': 'ntsc',
    '720x576': 'pal',
  }
  return presets[`${width}x${height}`] ?? null
}

export default class FfmpegCombiner implements CombinerStrategy {
  readonly name = 'ffmpeg'
  constructor(private readonly config: AppConfig) {}

  async combine(input: {
    videoPath: string
    audioPath?: string
    subtitlePath?: string
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
    const dimensions = await getDimensions(videoPath)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })

    const errors = [
      checkInputFile('Video input', videoPath),
      checkInputFile('Audio input', audioPath),
      checkInputFile('Subtitle input', subtitlePath),
      checkInputFile('Instrumental input', instrumentalPath),
    ].filter(Boolean)

    if (errors.length > 0) {
      throw new Error(`Combiner input validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
    }

    const useMixGate = this.config.audioMixMode === 'mix-gate' && speechSegments && speechSegments.length > 0
    const useVocalRemoval = this.config.audioMixMode === 'mix-vocal-removal' && !!instrumentalPath

    let filterComplex: string
    let tempSubPath: string | undefined

    if (subtitlePath) {
      const sizePreset = toVideoSizePreset(dimensions.width, dimensions.height)
      const tempSubName = `_vt_sub_${Date.now()}.ass`
      tempSubPath = path.join(os.tmpdir(), tempSubName)
      await fs.copyFile(subtitlePath, tempSubPath)

      const escapedSubPath = tempSubPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      const subFilterParts = [`subtitles=${escapedSubPath}`]
      if (sizePreset) subFilterParts.push(`original_size=${sizePreset}`)
      subFilterParts.push('force_style=Alignment\\=2\\,MarginV\\=60')
      const subFilterStr = `[0:v]${subFilterParts.join(':')}[v]`

      filterComplex = useMixGate
        ? buildMixGateFilterComplex(subFilterStr, speechSegments, duration)
        : useVocalRemoval
          ? buildVocalRemovalFilterComplex(subFilterStr, duration)
          : `${subFilterStr};[1:a]apad=whole_dur=${duration}[a]`
    } else {
      filterComplex = useMixGate
        ? buildMixGateFilterComplex('[0:v]copy[v]', speechSegments, duration)
        : useVocalRemoval
          ? buildVocalRemovalFilterComplex('[0:v]copy[v]', duration)
          : `[0:v]copy[v];[1:a]apad=whole_dur=${duration}[a]`
    }

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

      let stderr = ''

      command
        .outputOptions([
          '-filter_complex', filterComplex,
          '-map', '[v]',
          '-map', '[a]',
          '-c:v', 'libx264',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-t', String(duration),
          '-movflags', '+faststart',
        ])
        .on('start', (cmd: string) => {
          console.log(`[ffmpeg-combiner] Command: ${cmd}`)
        })
        .on('stderr', (line: string) => {
          stderr += line + '\n'
        })
        .on('progress', (info) => {
          const currentTime = info.timemark ? timeMarkToSeconds(info.timemark) : 0
          const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100))
          onProgress(pct)
        })
        .on('end', () => {
          signal?.removeEventListener('abort', onAbort)
          if (tempSubPath) fs.unlink(tempSubPath).catch(() => {})
          onProgress(100)
          resolve()
        })
        .on('error', (error) => {
          signal?.removeEventListener('abort', onAbort)
          if (tempSubPath) fs.unlink(tempSubPath).catch(() => {})
          if (stderr) {
            console.error(`[ffmpeg-combiner] Stderr:\n${stderr}`)
          }
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
