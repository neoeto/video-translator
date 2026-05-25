import ffmpeg from 'fluent-ffmpeg'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SyncMode, TranslatedSegment } from '../../types.js'

import { resolvePackagedPath } from '../../resolve-packaged-path.js'

const require = createRequire(import.meta.url)
const ffprobeStatic = require('ffprobe-static') as { path?: string }
const ffmpegStatic = require('ffmpeg-static') as string | null

const resolvedFfmpegPath = resolvePackagedPath(ffmpegStatic)
const resolvedFfprobePath = resolvePackagedPath(ffprobeStatic.path)

if (resolvedFfmpegPath) ffmpeg.setFfmpegPath(resolvedFfmpegPath)
if (resolvedFfprobePath) ffmpeg.setFfprobePath(resolvedFfprobePath)

export const DURATION_TOLERANCE = 0.3
export const MAX_TTS_RETRIES = 3
export const INITIAL_TTS_BACKOFF_MS = 1000
export const TTS_SAMPLE_RATE = 24000

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
      .input(`anullsrc=r=${TTS_SAMPLE_RATE}:cl=mono`)
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
      .audioCodec('libmp3lame')
      .audioFrequency(TTS_SAMPLE_RATE)
      .audioChannels(1)
      .format('mp3')
      .output(outputFile)
  })
}

// ffmpeg atempo filter range is [0.5, 2.0]; chain multiple filters for rates outside that range
const ATEMPO_MIN = 0.5
const ATEMPO_MAX = 2.0

export function buildAtempoFilter(playbackRate: number): string {
  const filters: number[] = []
  let remainingRate = playbackRate

  while (remainingRate > ATEMPO_MAX) {
    filters.push(ATEMPO_MAX)
    remainingRate /= ATEMPO_MAX
  }
  while (remainingRate < ATEMPO_MIN) {
    filters.push(ATEMPO_MIN)
    remainingRate /= ATEMPO_MIN
  }

  filters.push(remainingRate)
  return filters.map((rate) => `atempo=${rate.toFixed(6)}`).join(',')
}

export async function adjustAudioTempo(
  inputFile: string,
  outputFile: string,
  actualDuration: number,
  targetDuration: number,
): Promise<void> {
  const playbackRate = actualDuration / targetDuration
  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioFilters(buildAtempoFilter(playbackRate))
      .audioCodec('libmp3lame')
      .format('mp3')
      .output(outputFile)
  })
}

// Natural mode: comfortable speed range — beyond this, speech sounds unnatural
const NATURAL_MIN_RATE = 0.77
const NATURAL_MAX_RATE = 2.0

export interface SegmentTiming {
  start: number
  end: number
  actualDuration: number
}

export interface TimelineResult {
  audioPath: string
  segmentTimings: SegmentTiming[]
}

/**
 * Truncate audio to a target duration with a short fade-out to avoid abrupt cuts.
 */
async function truncateAudio(inputFile: string, outputFile: string, targetDuration: number): Promise<void> {
  const fadeOutDuration = Math.min(0.15, targetDuration * 0.1)
  const fadeStart = Math.max(0, targetDuration - fadeOutDuration)
  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioFilters(`afade=t=out:st=${fadeStart}:d=${fadeOutDuration}`)
      .outputOptions(['-acodec', 'libmp3lame', '-t', String(targetDuration)])
      .format('mp3')
      .output(outputFile)
  })
}

/**
 * Force audio to exactly targetDuration by padding with silence if short.
 * Unlike padAudioToDuration, this always pads regardless of how small the difference is.
 */
async function forceExactDuration(inputFile: string, outputFile: string, targetDuration: number): Promise<void> {
  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioFilters('apad')
      .outputOptions(['-acodec', 'libmp3lame', '-t', String(targetDuration)])
      .format('mp3')
      .output(outputFile)
  })
}

/**
 * Adjust a TTS segment's duration to match the target window.
 * - strict mode: force-fit to exact target via atempo + pad
 * - natural mode: adjust within comfortable range, truncate if still overlong
 * Returns the path to the adjusted file and its actual duration.
 */
async function adjustSegmentDuration(
  rawFile: string,
  index: number,
  workDir: string,
  targetDuration: number,
  syncMode: SyncMode,
): Promise<{ file: string; duration: number }> {
  const actualDuration = await probeDuration(rawFile)

  // In strict mode, skip the tolerance check — always force-fit to target
  if (syncMode !== 'strict' && Math.abs(actualDuration - targetDuration) <= DURATION_TOLERANCE) {
    // Within tolerance — no tempo adjustment needed.
    // But if shorter than target, pad to prevent cumulative drift.
    if (actualDuration < targetDuration - 0.01) {
      const paddedFile = path.join(workDir, `segment-${index}-padded.mp3`)
      await forceExactDuration(rawFile, paddedFile, targetDuration)
      return { file: paddedFile, duration: targetDuration }
    }
    return { file: rawFile, duration: actualDuration }
  }

  const ratio = actualDuration / targetDuration
  const adjustedFile = path.join(workDir, `segment-${index}-adjusted.mp3`)
  const finalFile = path.join(workDir, `segment-${index}-final.mp3`)

  if (syncMode === 'strict') {
    // Strict: force to exact target duration via atempo + pad/truncate
    if (Math.abs(actualDuration - targetDuration) > DURATION_TOLERANCE) {
      await adjustAudioTempo(rawFile, adjustedFile, actualDuration, targetDuration)
    } else {
      // Small difference — copy as starting point for pad/truncate
      await fs.copyFile(rawFile, adjustedFile)
    }
    const adjustedDuration = await probeDuration(adjustedFile)

    if (adjustedDuration > targetDuration + 0.05) {
      const truncatedFile = path.join(workDir, `segment-${index}-truncated.mp3`)
      await truncateAudio(adjustedFile, truncatedFile, targetDuration)
      return { file: truncatedFile, duration: targetDuration }
    }
    if (adjustedDuration < targetDuration - 0.05) {
      await padAudioToDuration(adjustedFile, finalFile, targetDuration)
      return { file: finalFile, duration: targetDuration }
    }
    return { file: adjustedFile, duration: targetDuration }
  }

  // Natural: clamp speed to comfortable range
  const clampedRate = Math.max(NATURAL_MIN_RATE, Math.min(NATURAL_MAX_RATE, ratio))
  if (Math.abs(clampedRate - 1.0) < 0.02) {
    // Rate is essentially 1x, no tempo adjustment needed
    // Pad if shorter to prevent drift accumulation
    if (actualDuration < targetDuration - 0.01) {
      const paddedFile = path.join(workDir, `segment-${index}-padded.mp3`)
      await forceExactDuration(rawFile, paddedFile, targetDuration)
      return { file: paddedFile, duration: targetDuration }
    }
    return { file: rawFile, duration: actualDuration }
  }

  const adjustedTarget = actualDuration / clampedRate
  await adjustAudioTempo(rawFile, adjustedFile, actualDuration, adjustedTarget)
  const adjustedDuration = await probeDuration(adjustedFile)

  // If still overlong after tempo adjustment, truncate to prevent drift
  if (adjustedDuration > targetDuration + DURATION_TOLERANCE) {
    const truncatedFile = path.join(workDir, `segment-${index}-truncated.mp3`)
    await truncateAudio(adjustedFile, truncatedFile, targetDuration)
    return { file: truncatedFile, duration: targetDuration }
  }

  // If shorter after tempo adjustment, pad to prevent drift accumulation
  if (adjustedDuration < targetDuration - 0.01) {
    const paddedFile = path.join(workDir, `segment-${index}-padded.mp3`)
    await forceExactDuration(adjustedFile, paddedFile, targetDuration)
    return { file: paddedFile, duration: targetDuration }
  }

  return { file: adjustedFile, duration: adjustedDuration }
}

/**
 * Assembles per-segment audio files into a single timeline with leading silence and
 * compensating gap fillers. Uses sync mode to determine duration adjustment behavior.
 * Returns the output audio path and per-segment actual timing information.
 */
export async function buildTimeline(
  segments: TranslatedSegment[],
  workDir: string,
  synthesizeSegment: (segment: TranslatedSegment, index: number, workDir: string) => Promise<string>,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  syncMode: SyncMode = 'natural',
): Promise<TimelineResult> {
  const outputPath = path.join(workDir, '..', 'cn_audio.mp3')

  if (segments.length === 0) {
    await createSilenceFile(0.1, outputPath)
    onProgress(100)
    return { audioPath: outputPath, segmentTimings: [] }
  }

  const files: string[] = []
  const segmentTimings: SegmentTiming[] = []
  let cumulativePosition = 0

  for (let index = 0; index < segments.length; index += 1) {
    if (signal?.aborted) throw new Error('Pipeline cancelled')
    const segment = segments[index]
    const rawFile = await synthesizeSegment(segment, index, workDir)

    const targetDuration = Math.max(0.05, segment.end - segment.start)
    const { file: adjustedFile, duration: actualDuration } = await adjustSegmentDuration(
      rawFile, index, workDir, targetDuration, syncMode
    )

    // Leading silence before first segment
    if (index === 0 && segment.start > 0) {
      const leadingSilence = path.join(workDir, 'leading-silence.mp3')
      await createSilenceFile(segment.start, leadingSilence)
      files.push(leadingSilence)
      cumulativePosition = segment.start
    }

    // Compensating gap: always align to segment's intended start time
    if (index > 0) {
      const expectedGap = segment.start - cumulativePosition
      if (expectedGap > 0.01) {
        const gapFile = path.join(workDir, `gap-${index}.mp3`)
        await createSilenceFile(expectedGap, gapFile)
        files.push(gapFile)
        cumulativePosition += expectedGap
      } else if (expectedGap < -DURATION_TOLERANCE) {
        // Previous segment overran; no gap to insert, accept minor overlap
      }
    }

    const segStart = cumulativePosition
    files.push(adjustedFile)
    cumulativePosition += actualDuration

    segmentTimings.push({
      start: segStart,
      end: segStart + actualDuration,
      actualDuration,
    })

    onProgress(((index + 1) / segments.length) * 100)
  }

  // Trailing silence: ensure audio covers until the last segment's end time
  const expectedEnd = segments[segments.length - 1].end
  if (cumulativePosition < expectedEnd - DURATION_TOLERANCE) {
    const trailingSilence = path.join(workDir, 'trailing-silence.mp3')
    await createSilenceFile(expectedEnd - cumulativePosition, trailingSilence)
    files.push(trailingSilence)
  }

  if (files.length === 1) {
    await fs.copyFile(files[0], outputPath)
  } else {
    await concatAudioFiles(files, outputPath, workDir)
  }

  onProgress(100)
  return { audioPath: outputPath, segmentTimings }
}
