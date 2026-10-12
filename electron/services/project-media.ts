import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  type AudioFormat,
  type FrameFormat,
  type ProjectAudioResult,
  type ProjectMediaMetadata,
  type ProjectMediaInfo,
  type ProjectRenderResult,
  type ProjectResolution,
  type ProjectTimeline,
} from '../../shared/project-types.js'
import { ffmpegPath, ffprobePath, timeMarkToSeconds } from './strategies/combiners/combiner-helpers.js'

const RESOLUTION_WIDTH: Record<Exclude<ProjectResolution, 'original'>, number> = { '1080p': 1920, '720p': 1280, '480p': 854 }

export function probeMedia(assetPath: string): Promise<ProjectMediaInfo> {
  if (!ffprobePath) return Promise.reject(new Error('ffprobe binary not found'))
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(assetPath, (error, data) => {
      if (error) { reject(error instanceof Error ? error : new Error(String(error))); return }
      const video = data.streams.find(stream => stream.codec_type === 'video')
      const duration = data.format?.duration
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 ||
          typeof video?.width !== 'number' || typeof video.height !== 'number' || video.width <= 0 || video.height <= 0) {
        reject(new Error('Unable to determine media metadata'))
        return
      }
      resolve({
        duration,
        width: video.width,
        height: video.height,
        format: typeof data.format?.format_name === 'string' ? data.format.format_name : undefined,
        videoCodec: typeof video.codec_name === 'string' ? video.codec_name : undefined,
        audioCodec: data.streams.find(stream => stream.codec_type === 'audio')?.codec_name,
      })
    })
  })
}

function runCommand(command: ReturnType<typeof ffmpeg>, outputPath: string, signal: AbortSignal | undefined, onProgress?: (percent: number) => void, duration = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Project operation cancelled')); return }
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      command.kill('SIGTERM')
      if (!settled) {
        settled = true
        fs.unlink(outputPath).catch(() => {})
        reject(new Error('Project operation cancelled'))
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    command
      .on('progress', info => {
        const current = info.timemark ? timeMarkToSeconds(info.timemark) : 0
        onProgress?.(duration > 0 ? Math.min(99, Math.round(current / duration * 100)) : 0)
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
        fs.unlink(outputPath).catch(() => {})
        reject(signal?.aborted ? new Error('Project operation cancelled') : (error instanceof Error ? error : new Error(String(error))))
      })
      .save(outputPath)
  })
}

export async function extractFrame(inputPath: string, timestamp: number, format: FrameFormat, outputPath: string, signal?: AbortSignal): Promise<ProjectMediaMetadata> {
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Frame timestamp must be non-negative')
  const metadata = await probeMedia(inputPath)
  if (timestamp > metadata.duration) throw new Error('Frame timestamp is outside the media duration')
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const frameEncoder = format === 'jpeg' ? 'mjpeg' : 'png'
  const command = ffmpeg().input(inputPath).seekInput(timestamp).outputOptions(['-frames:v', '1', '-c:v', frameEncoder]).format('image2')
  await runCommand(command, outputPath, signal)
  return { ...metadata, assetPath: outputPath }
}

const AUDIO_OPTIONS: Record<AudioFormat, string[]> = {
  wav: ['-c:a', 'pcm_s16le'],
  mp3: ['-c:a', 'libmp3lame'],
  aac: ['-c:a', 'aac'],
  m4a: ['-c:a', 'aac'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis'],
}

export async function extractAudio(inputPath: string, format: AudioFormat, outputPath: string, signal?: AbortSignal): Promise<ProjectAudioResult> {
  const metadata = await probeMedia(inputPath)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const command = ffmpeg().input(inputPath).noVideo().outputOptions(AUDIO_OPTIONS[format]).format(format)
  await runCommand(command, outputPath, signal, undefined, metadata.duration)
  return { assetPath: outputPath, format }
}

function validateTimeline(timeline: ProjectTimeline, duration: number): void {
  if (!timeline || !Array.isArray(timeline.videoTrack) || timeline.videoTrack.length === 0) throw new Error('Timeline must contain at least one video clip')
  if (timeline.audioTrack.type !== 'original' || timeline.audioTrack.enabled !== true) throw new Error('Phase 1 requires original audio enabled')
  for (const clip of timeline.videoTrack) {
    if (!Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.sourceEnd) || clip.sourceStart < 0 || clip.sourceEnd <= clip.sourceStart || clip.sourceEnd > duration + 0.001) throw new Error('Timeline clip is outside source duration')
  }
}

export async function renderProject(inputPath: string, timeline: ProjectTimeline, resolution: ProjectResolution, outputPath: string, tempDir: string, signal?: AbortSignal, onProgress?: (percent: number) => void): Promise<ProjectRenderResult> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not found')
  const metadata = await probeMedia(inputPath)
  validateTimeline(timeline, metadata.duration)
  const clips = timeline.videoTrack
  await fs.mkdir(tempDir, { recursive: true })
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const operationDir = path.join(tempDir, `render-${randomUUID()}`)
  await fs.mkdir(operationDir, { recursive: true })
  const segmentPaths: string[] = []
  try {
    for (let index = 0; index < clips.length; index += 1) {
      if (signal?.aborted) throw new Error('Project operation cancelled')
      const clip = clips[index]
      const segmentPath = path.join(operationDir, `segment-${index}.mp4`)
      const command = ffmpeg().input(inputPath).seekInput(clip.sourceStart).duration(clip.sourceEnd - clip.sourceStart)
        .outputOptions(['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'])
      await runCommand(command, segmentPath, signal, percent => onProgress?.(Math.round((index + percent / 100) / clips.length * 80)), clip.sourceEnd - clip.sourceStart)
      segmentPaths.push(segmentPath)
    }
    const concatList = path.join(operationDir, 'concat.txt')
    await fs.writeFile(concatList, segmentPaths.map(file => `file '${file.replace(/\\/g, '/').replaceAll("'", "'\\''")}'`).join('\n') + '\n', 'utf8')
    const tempOutput = path.join(operationDir, 'output.mp4')
    const outputOptions = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart']
    const width = resolution === 'original' ? undefined : RESOLUTION_WIDTH[resolution]
    if (width && metadata.width > width) outputOptions.push('-vf', `scale=${width}:-2`)
    const command = ffmpeg().input(concatList).inputOptions(['-f', 'concat', '-safe', '0']).outputOptions(outputOptions)
    await runCommand(command, tempOutput, signal, percent => onProgress?.(80 + Math.round(percent * 0.2)), clips.reduce((sum, clip) => sum + clip.sourceEnd - clip.sourceStart, 0))
    if (signal?.aborted) throw new Error('Project operation cancelled')
    await fs.rename(tempOutput, outputPath)
    if (signal?.aborted) throw new Error('Project operation cancelled')
    const rendered = await probeMedia(outputPath)
    if (signal?.aborted) throw new Error('Project operation cancelled')
    return { assetPath: outputPath, duration: rendered.duration }
  } finally {
    await fs.rm(operationDir, { recursive: true, force: true }).catch(() => {})
  }
}
