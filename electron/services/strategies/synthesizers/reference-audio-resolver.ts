import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  IndexTtsReferenceMode,
  SpeakerProfile,
  TranscriptSegment,
  TranslatedSegment,
} from '../../types.js'

/**
 * Algorithm version baked into the cache key. Bump on any change to window /
 * guard logic so stale clips from previous versions are not reused.
 */
export const REFERENCE_RESOLVER_VERSION = 1

const MIN_REFERENCE_DURATION_SEC = 1.0
const TARGET_SHORT_DURATION_SEC = 2.5
const SHORT_SEGMENT_THRESHOLD_SEC = 1.2
const MAX_REFERENCE_DURATION_SEC = 6.0
const MAX_TOTAL_WINDOW_SEC = 8.0
const MIN_REFERENCE_FILE_SIZE_BYTES = 4 * 1024

export type ReferenceStrategy =
  | 'segment-original'
  | 'speaker-sample'
  | 'global'
  | 'none'

export type ResolveFallbackReason =
  | 'mode-disabled'
  | 'no-source-audio'
  | 'no-original-segments'
  | 'missing-speaker-run'
  | 'cross-speaker-overlap'
  | 'window-too-short'
  | 'extraction-failed'
  | 'invalid-output-file'

export interface ResolveResult {
  referenceAudio?: string
  strategy: ReferenceStrategy
  fallbackReason?: ResolveFallbackReason
}

export interface ResolveLogEvent {
  level: 'info' | 'warn'
  segmentIndex: number
  message: string
  strategy: ReferenceStrategy
  fallbackReason?: ResolveFallbackReason
}

export interface ReferenceAudioResolverOptions {
  mode: IndexTtsReferenceMode
  speakerProfiles?: SpeakerProfile[]
  globalReference: string
  sourceAudioPath?: string
  originalSegments?: TranscriptSegment[]
  cacheDir: string
  logger?: (event: ResolveLogEvent) => void
  /** Test seam: override the ffmpeg extraction call. */
  extractor?: (input: {
    sourceAudioPath: string
    outputPath: string
    start: number
    duration: number
  }) => Promise<void>
}

interface SpeakerRun {
  runIndex: number
  speaker: string
  startIdx: number
  endIdx: number
  startSec: number
  endSec: number
}

/**
 * Resolves the most appropriate `reference_audio` path for each segment given
 * the user-selected strategy. Guarantees:
 *   - Never crosses speaker-run boundaries when expanding windows.
 *   - Never returns a clip overlapping a different speaker's segment.
 *   - Never returns a path that fails basic validity checks.
 *   - Falls back gracefully through speaker-sample -> global -> none.
 *   - Any internal failure degrades to a fallback (never throws).
 */
export class ReferenceAudioResolver {
  private readonly speakerRuns: SpeakerRun[] = []
  private readonly indexToRun: Map<number, SpeakerRun> = new Map()
  private readonly opts: ReferenceAudioResolverOptions
  private cacheDirReady = false

  constructor(opts: ReferenceAudioResolverOptions) {
    this.opts = opts
    this.buildSpeakerRuns()
  }

  async resolve(segment: TranslatedSegment, index: number): Promise<ResolveResult> {
    if (this.opts.mode !== 'segment-original') {
      return this.fallback(segment, index, 'mode-disabled')
    }
    if (!this.opts.sourceAudioPath) {
      return this.fallback(segment, index, 'no-source-audio')
    }
    if (!this.opts.originalSegments || this.opts.originalSegments.length === 0) {
      return this.fallback(segment, index, 'no-original-segments')
    }

    const run = this.indexToRun.get(index)
    if (!run || run.speaker !== segment.speaker) {
      return this.fallback(segment, index, 'missing-speaker-run')
    }

    const window = this.computeWindow(segment, run)
    if (window.end - window.start < MIN_REFERENCE_DURATION_SEC) {
      return this.fallback(segment, index, 'window-too-short')
    }

    if (this.hasCrossSpeakerOverlap(window, segment.speaker)) {
      return this.fallback(segment, index, 'cross-speaker-overlap')
    }

    try {
      const clipPath = await this.extractClip(run, window)
      const stat = await fs.stat(clipPath).catch(() => null)
      if (!stat || !stat.isFile() || stat.size < MIN_REFERENCE_FILE_SIZE_BYTES) {
        return this.fallback(segment, index, 'invalid-output-file')
      }
      this.log({ level: 'info', segmentIndex: index, message: `segment-original ref ok (${(window.end - window.start).toFixed(2)}s)`, strategy: 'segment-original' })
      return { referenceAudio: clipPath, strategy: 'segment-original' }
    } catch (error) {
      this.log({ level: 'warn', segmentIndex: index, message: `extraction failed: ${(error as Error)?.message ?? String(error)}`, strategy: 'speaker-sample', fallbackReason: 'extraction-failed' })
      return this.fallback(segment, index, 'extraction-failed')
    }
  }

  private buildSpeakerRuns(): void {
    const segments = this.opts.originalSegments
    if (!segments || segments.length === 0) return

    let runStart = 0
    let runIndex = 0
    for (let i = 1; i <= segments.length; i += 1) {
      const isBoundary = i === segments.length || segments[i].speaker !== segments[runStart].speaker
      if (isBoundary) {
        const run: SpeakerRun = {
          runIndex,
          speaker: segments[runStart].speaker,
          startIdx: runStart,
          endIdx: i - 1,
          startSec: segments[runStart].start,
          endSec: segments[i - 1].end,
        }
        this.speakerRuns.push(run)
        for (let j = run.startIdx; j <= run.endIdx; j += 1) {
          this.indexToRun.set(j, run)
        }
        runStart = i
        runIndex += 1
      }
    }
  }

  private computeWindow(segment: TranslatedSegment, run: SpeakerRun): { start: number; end: number } {
    let start = Math.max(run.startSec, segment.start)
    let end = Math.min(run.endSec, segment.end)
    const duration = end - start

    if (duration < SHORT_SEGMENT_THRESHOLD_SEC) {
      // Expand symmetrically within the run boundary to reach TARGET_SHORT_DURATION_SEC.
      const deficit = TARGET_SHORT_DURATION_SEC - duration
      const halfPad = deficit / 2
      let newStart = Math.max(run.startSec, start - halfPad)
      let newEnd = Math.min(run.endSec, end + halfPad)
      // If one side hit the run boundary, push the other side further to compensate.
      const stillNeeded = TARGET_SHORT_DURATION_SEC - (newEnd - newStart)
      if (stillNeeded > 0) {
        if (newStart === run.startSec) {
          newEnd = Math.min(run.endSec, newEnd + stillNeeded)
        } else if (newEnd === run.endSec) {
          newStart = Math.max(run.startSec, newStart - stillNeeded)
        }
      }
      start = newStart
      end = newEnd
    } else if (duration > MAX_REFERENCE_DURATION_SEC) {
      // Trim around the segment center to MAX_REFERENCE_DURATION_SEC.
      const center = (start + end) / 2
      const half = MAX_REFERENCE_DURATION_SEC / 2
      start = Math.max(run.startSec, center - half)
      end = Math.min(run.endSec, center + half)
    }

    // Hard cap.
    if (end - start > MAX_TOTAL_WINDOW_SEC) {
      const center = (start + end) / 2
      const half = MAX_TOTAL_WINDOW_SEC / 2
      start = center - half
      end = center + half
    }

    return { start, end }
  }

  private hasCrossSpeakerOverlap(window: { start: number; end: number }, speaker: string): boolean {
    const segments = this.opts.originalSegments ?? []
    for (const seg of segments) {
      if (seg.speaker === speaker) continue
      if (seg.end <= window.start) continue
      if (seg.start >= window.end) continue
      return true
    }
    return false
  }

  private async ensureCacheDir(): Promise<void> {
    if (this.cacheDirReady) return
    await fs.mkdir(this.opts.cacheDir, { recursive: true })
    this.cacheDirReady = true
  }

  private async extractClip(run: SpeakerRun, window: { start: number; end: number }): Promise<string> {
    await this.ensureCacheDir()
    const sanitizedSpeaker = run.speaker.replace(/[^a-zA-Z0-9_-]/g, '_')
    const startMs = Math.round(window.start * 1000)
    const endMs = Math.round(window.end * 1000)
    const fileName = `${sanitizedSpeaker}-run${run.runIndex}-${startMs}-${endMs}-v${REFERENCE_RESOLVER_VERSION}.wav`
    const outputPath = path.join(this.opts.cacheDir, fileName)

    const existing = await fs.stat(outputPath).catch(() => null)
    if (existing && existing.isFile() && existing.size >= MIN_REFERENCE_FILE_SIZE_BYTES) {
      return outputPath
    }

    const duration = window.end - window.start
    const sourceAudio = this.opts.sourceAudioPath as string
    if (this.opts.extractor) {
      await this.opts.extractor({ sourceAudioPath: sourceAudio, outputPath, start: window.start, duration })
    } else {
      const { runFfmpeg } = await import('./tts-helpers.js')
      await runFfmpeg((command) => {
        command
          .input(sourceAudio)
          .setStartTime(window.start)
          .duration(duration)
          .audioCodec('pcm_s16le')
          .audioChannels(1)
          .audioFrequency(16000)
          .format('wav')
          .output(outputPath)
      })
    }
    return outputPath
  }

  private fallback(segment: TranslatedSegment, index: number, reason: ResolveFallbackReason): ResolveResult {
    const result = this.pickFallback(segment.speaker)
    this.log({
      level: reason === 'mode-disabled' ? 'info' : 'warn',
      segmentIndex: index,
      message: `segment-original skipped: ${reason} -> ${result.strategy}`,
      strategy: result.strategy,
      fallbackReason: reason,
    })
    return { ...result, fallbackReason: reason }
  }

  private pickFallback(speakerHint?: string): ResolveResult {
    const profile = speakerHint
      ? this.opts.speakerProfiles?.find(p => p.id === speakerHint)
      : undefined
    if (profile?.samplePath) {
      return { referenceAudio: profile.samplePath, strategy: 'speaker-sample' }
    }
    const global = this.opts.globalReference.trim()
    if (global) {
      return { referenceAudio: global, strategy: 'global' }
    }
    return { strategy: 'none' }
  }

  private log(event: ResolveLogEvent): void {
    this.opts.logger?.(event)
  }
}
