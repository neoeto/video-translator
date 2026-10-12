import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AudioFormat } from '../../shared/project-types.js'
import type { AppConfig, TranscriptSegment } from './types.js'
import { getDuration, ffmpegPath } from './strategies/combiners/combiner-helpers.js'
import WhisperXTranscriber from './strategies/transcribers/whisperx.js'

const AUDIO_OPTIONS: Record<AudioFormat, string[]> = {
  wav: ['-c:a', 'pcm_s16le'],
  mp3: ['-c:a', 'libmp3lame'],
  aac: ['-c:a', 'aac'],
  m4a: ['-c:a', 'aac'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis'],
}

export type ProjectSpeakerAudioProgress = {
  stage: 'speaker-analysis' | 'speaker-export'
  percent: number
}

export interface ProjectSpeakerAudioFile {
  speaker: string
  outputPath: string
  format: AudioFormat
  duration: number
}

export interface ProjectSpeakerAudioServiceResult {
  files: ProjectSpeakerAudioFile[]
}

function runFfmpeg(
  command: ReturnType<typeof ffmpeg>,
  outputPath: string,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
  duration = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Project operation cancelled'))
      return
    }
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      command.kill('SIGTERM')
      if (!settled) {
        settled = true
        cleanup()
        void fs.unlink(outputPath).catch(() => {})
        reject(new Error('Project operation cancelled'))
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    command
      .on('progress', info => {
        if (!onProgress) return
        const mark = info.timemark ?? ''
        const parts = mark.split(':').map(Number)
        const current = parts.length === 3 && parts.every(Number.isFinite)
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : 0
        onProgress(duration > 0 ? Math.min(99, Math.round(current / duration * 100)) : 0)
      })
      .on('end', () => {
        if (settled) return
        settled = true
        cleanup()
        onProgress?.(100)
        resolve()
      })
      .on('error', error => {
        if (settled) return
        settled = true
        cleanup()
        void fs.unlink(outputPath).catch(() => {})
        reject(signal?.aborted ? new Error('Project operation cancelled') : (error instanceof Error ? error : new Error(String(error))))
      })
      .save(outputPath)
  })
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replaceAll("'", "'\\''")
}

function safeSpeakerName(speaker: string): string {
  const safe = speaker.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return (safe || 'unknown').slice(0, 64)
}

function groupSegments(segments: TranscriptSegment[]): Map<string, TranscriptSegment[]> {
  const grouped = new Map<string, TranscriptSegment[]>()
  for (const segment of segments) {
    const speaker = typeof segment.speaker === 'string' ? segment.speaker.trim() : ''
    if (!speaker || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start) continue
    const list = grouped.get(speaker) ?? []
    list.push({ ...segment, speaker })
    grouped.set(speaker, list)
  }
  for (const list of grouped.values()) list.sort((left, right) => left.start - right.start)
  return grouped
}

export async function exportSpeakerAudio(input: {
  sourcePath: string
  tempDir: string
  outputDir: string
  config: AppConfig
  format: AudioFormat
  signal?: AbortSignal
  onProgress?: (progress: ProjectSpeakerAudioProgress) => void
}): Promise<ProjectSpeakerAudioServiceResult> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found')
  if (!AUDIO_OPTIONS[input.format]) throw new Error(`Unsupported audio format: ${input.format}`)

  const operationDir = path.join(input.tempDir, `speaker-audio-${randomUUID()}`)
  const normalizedAudioPath = path.join(operationDir, 'source.wav')
  const outputPaths: string[] = []
  await fs.mkdir(operationDir, { recursive: true })
  await fs.mkdir(input.outputDir, { recursive: true })

  try {
    if (input.signal?.aborted) throw new Error('Project operation cancelled')
    await runFfmpeg(
      ffmpeg().input(input.sourcePath).noVideo().outputOptions(['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le']).format('wav'),
      normalizedAudioPath,
      input.signal,
    )

    const transcriber = new WhisperXTranscriber(input.config)
    const transcription = await transcriber.transcribe({
      audioPath: normalizedAudioPath,
      signal: input.signal,
      onProgress: percent => input.onProgress?.({ stage: 'speaker-analysis', percent: Math.round(Math.max(0, Math.min(100, percent)) * 0.5) }),
      onDetail: (_key, _params) => {},
    })
    if (input.signal?.aborted) throw new Error('Project operation cancelled')

    const grouped = groupSegments(transcription.segments)
    if (grouped.size === 0) throw new Error('No speaker segments found in WhisperX transcription')

    const speakers = Array.from(grouped.entries())
    const files: ProjectSpeakerAudioFile[] = []
    for (let speakerIndex = 0; speakerIndex < speakers.length; speakerIndex += 1) {
      if (input.signal?.aborted) throw new Error('Project operation cancelled')
      const [speaker, segments] = speakers[speakerIndex]
      const speakerDir = path.join(operationDir, `speaker-${speakerIndex}`)
      await fs.mkdir(speakerDir, { recursive: true })
      const clipPaths: string[] = []
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        if (input.signal?.aborted) throw new Error('Project operation cancelled')
        const segment = segments[segmentIndex]
        const clipPath = path.join(speakerDir, `clip-${segmentIndex}.wav`)
        await runFfmpeg(
          ffmpeg().input(normalizedAudioPath).seekInput(segment.start).duration(segment.end - segment.start)
            .outputOptions(['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le']).format('wav'),
          clipPath,
          input.signal,
          percent => input.onProgress?.({ stage: 'speaker-export', percent: 50 + Math.round(((speakerIndex + (segmentIndex + percent / 100) / segments.length) / speakers.length) * 45) }),
          segment.end - segment.start,
        )
        clipPaths.push(clipPath)
      }

      const concatList = path.join(speakerDir, 'concat.txt')
      await fs.writeFile(concatList, `${clipPaths.map(file => `file '${escapeConcatPath(file)}'`).join('\n')}\n`, 'utf8')
      const filename = `speaker-${safeSpeakerName(speaker)}-${randomUUID()}.${input.format}`
      const outputPath = path.join(input.outputDir, filename)
      await runFfmpeg(
        ffmpeg().input(concatList).inputOptions(['-f', 'concat', '-safe', '0']).outputOptions(AUDIO_OPTIONS[input.format]).format(input.format),
        outputPath,
        input.signal,
        percent => input.onProgress?.({ stage: 'speaker-export', percent: 50 + Math.round(((speakerIndex + percent / 100) / speakers.length) * 50) }),
        segments.reduce((total, segment) => total + segment.end - segment.start, 0),
      )
      outputPaths.push(outputPath)
      const duration = await getDuration(outputPath)
      if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Speaker audio output has invalid duration for ${speaker}`)
      files.push({ speaker, outputPath, format: input.format, duration })
    }

    input.onProgress?.({ stage: 'speaker-export', percent: 100 })
    return { files }
  } catch (error) {
    await Promise.all(outputPaths.map(outputPath => fs.unlink(outputPath).catch(() => {})))
    throw error
  } finally {
    await fs.rm(operationDir, { recursive: true, force: true }).catch(() => {})
  }
}
