import ffmpeg from 'fluent-ffmpeg'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { TranslatedSegment } from '../../types.js'

const require = createRequire(import.meta.url)
const ffprobeStatic = require('ffprobe-static') as { path?: string }
const ffmpegStatic = require('ffmpeg-static') as string | null

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic)
if (ffprobeStatic.path) ffmpeg.setFfprobePath(ffprobeStatic.path)

export const DURATION_TOLERANCE = 0.3
export const MAX_TTS_RETRIES = 3
export const INITIAL_TTS_BACKOFF_MS = 1000

type FfmpegCommand = ReturnType<typeof ffmpeg>

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isRetryableTtsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { status?: number; code?: string; name?: string; message?: string }

  if (candidate.status === 429 || (typeof candidate.status === 'number' && candidate.status >= 500)) return true

  const retryableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'])
  if (candidate.code && retryableCodes.has(candidate.code)) return true

  const name = candidate.name ?? ''
  if (name.includes('RateLimit') || name.includes('Connection') || name.includes('Network')) return true

  const message = candidate.message ?? ''
  return /rate limit|timeout|network|connection reset|fetch failed|socket hang up/i.test(message)
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function runFfmpeg(configure: (command: FfmpegCommand) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg()
    configure(command)
    command.on('end', () => resolve())
    command.on('error', (error) => reject(error))
    command.run()
  })
}

export function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, data) => {
      if (error) {
        reject(error)
        return
      }
      const duration = data.format?.duration
      if (typeof duration !== 'number' || !isFinitePositive(duration)) {
        reject(new Error(`Unable to determine duration for ${filePath}`))
        return
      }
      resolve(duration)
    })
  })
}

export async function createSilenceFile(duration: number, outputFile: string): Promise<void> {
  const safeDuration = Math.max(0.05, duration)
  await runFfmpeg((command) => {
    command
      .input('anullsrc=r=24000:cl=mono')
      .inputFormat('lavfi')
      .audioCodec('libmp3lame')
      .format('mp3')
      .duration(safeDuration)
      .output(outputFile)
  })
}

export async function padAudioToDuration(inputFile: string, outputFile: string, targetDuration: number): Promise<void> {
  const currentDuration = await probeDuration(inputFile)
  const missingDuration = targetDuration - currentDuration

  // 合成语音偏短会让后续字幕时间轴漂移，补静音比拉伸音频更不影响音色。
  if (missingDuration <= DURATION_TOLERANCE) {
    await fs.copyFile(inputFile, outputFile)
    return
  }

  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioFilters(`apad=pad_dur=${missingDuration}`)
      .outputOptions(['-acodec', 'libmp3lame', '-t', String(targetDuration)])
      .format('mp3')
      .output(outputFile)
  })
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''")
}

export async function concatAudioFiles(filePaths: string[], outputFile: string, workDir: string): Promise<void> {
  const listFile = path.join(workDir, 'concat.txt')
  const listContent = filePaths.map((fp) => `file '${escapeConcatPath(fp)}'`).join('\n') + '\n'
  await fs.writeFile(listFile, listContent)

  await runFfmpeg((command) => {
    command
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputFile)
  })
}

/**
 * Assembles per-segment audio files into a single timeline with leading silence and gap fillers.
 * The `synthesizeSegment` callback handles engine-specific TTS and duration adjustment.
 */
export async function buildTimeline(
  segments: TranslatedSegment[],
  workDir: string,
  synthesizeSegment: (segment: TranslatedSegment, index: number, workDir: string) => Promise<string>,
  onProgress: (pct: number) => void
): Promise<string> {
  const outputPath = path.join(workDir, '..', 'cn_audio.mp3')

  if (segments.length === 0) {
    await createSilenceFile(0.1, outputPath)
    onProgress(100)
    return outputPath
  }

  const files: string[] = []

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const segmentFile = await synthesizeSegment(segment, index, workDir)

    if (index === 0 && segment.start > 0) {
      // 首段前导静音保留原视频开头空白，避免中文音轨整体提前。
      const leadingSilence = path.join(workDir, 'leading-silence.mp3')
      await createSilenceFile(segment.start, leadingSilence)
      files.push(leadingSilence)
    }

    files.push(segmentFile)

    const next = segments[index + 1]
    if (next) {
      const gap = next.start - segment.end
      if (gap > DURATION_TOLERANCE) {
        // 段落间隔用静音占位，防止拼接后的语音压缩掉原始停顿节奏。
        const gapFile = path.join(workDir, `gap-${index}.mp3`)
        await createSilenceFile(gap, gapFile)
        files.push(gapFile)
      }
    }

    onProgress(((index + 1) / segments.length) * 100)
  }

  if (files.length === 1) {
    await fs.copyFile(files[0], outputPath)
  } else {
    await concatAudioFiles(files, outputPath, workDir)
  }

  onProgress(100)
  return outputPath
}
