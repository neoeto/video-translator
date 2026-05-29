import ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { ffmpegPath, ffprobePath, timeMarkToSeconds } from './strategies/combiners/combiner-helpers.js'

export type ExportResolution = 'original' | '1080p' | '720p' | '480p'

interface ExportOptions {
  sourcePath: string
  targetPath: string
  resolution: ExportResolution
}

interface VideoDimensions {
  width: number
  height: number
}

function getVideoDimensions(videoPath: string): Promise<VideoDimensions> {
  if (!ffprobePath) return Promise.reject(new Error('ffprobe binary not found'))
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error) { reject(error instanceof Error ? error : new Error(String(error))); return }
      const videoStream = data.streams.find((s) => s.codec_type === 'video')
      const width = videoStream?.width
      const height = videoStream?.height
      if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
        reject(new Error('Unable to determine video dimensions'))
        return
      }
      resolve({ width, height })
    })
  })
}

function getVideoDuration(videoPath: string): Promise<number> {
  if (!ffprobePath) return Promise.resolve(0)
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error || !data?.format?.duration) { resolve(0); return }
      resolve(data.format.duration)
    })
  })
}

const RESOLUTION_MAP: Record<Exclude<ExportResolution, 'original'>, number> = {
  '1080p': 1920,
  '720p': 1280,
  '480p': 854,
}

let activeAbort: AbortController | null = null

export function cancelExport(): void {
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
  }
}

export async function exportVideo(options: ExportOptions, win: BrowserWindow): Promise<void> {
  const { sourcePath, targetPath, resolution } = options

  if (!ffmpegPath) throw new Error('ffmpeg binary not found')

  await fs.mkdir(path.dirname(targetPath), { recursive: true })

  if (resolution === 'original') {
    const stat = await fs.stat(sourcePath)
    const totalBytes = stat.size
    const readStream = (await import('node:fs')).createReadStream(sourcePath)
    const writeStream = (await import('node:fs')).createWriteStream(targetPath)

    activeAbort = new AbortController()
    const signal = activeAbort.signal

    let written = 0
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        readStream.destroy()
        writeStream.destroy()
        fs.unlink(targetPath).catch(() => {})
        reject(new Error('Export cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })

      readStream.on('data', (chunk: Buffer) => {
        written += chunk.length
        const percent = Math.round((written / totalBytes) * 100)
        win.webContents.send('export:progress', { percent, stage: 'copying' as const })
      })
      readStream.on('error', (err) => { signal.removeEventListener('abort', onAbort); reject(err) })
      writeStream.on('error', (err) => { signal.removeEventListener('abort', onAbort); reject(err) })
      writeStream.on('finish', () => {
        signal.removeEventListener('abort', onAbort)
        activeAbort = null
        win.webContents.send('export:progress', { percent: 100, stage: 'copying' as const })
        resolve()
      })
      readStream.pipe(writeStream)
    })
  }

  // Encoding mode
  const dims = await getVideoDimensions(sourcePath)
  const targetWidth = RESOLUTION_MAP[resolution]

  // Don't upscale — fall back to copy
  if (dims.width <= targetWidth) {
    return exportVideo({ sourcePath, targetPath, resolution: 'original' }, win)
  }

  const duration = await getVideoDuration(sourcePath)
  activeAbort = new AbortController()
  const signal = activeAbort.signal

  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Export cancelled')); return }

    const command = ffmpeg()
      .input(sourcePath)
      .outputOptions([
        '-vf', `scale=${targetWidth}:-2`,
        '-c:v', 'libx264',
        '-crf', '23',
        '-preset', 'medium',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
      ])
      .on('progress', (info) => {
        const currentTime = info.timemark ? timeMarkToSeconds(info.timemark) : 0
        const percent = duration > 0 ? Math.min(99, Math.round((currentTime / duration) * 100)) : 0
        win.webContents.send('export:progress', { percent, stage: 'encoding' as const })
      })
      .on('end', () => {
        signal.removeEventListener('abort', onAbort)
        activeAbort = null
        win.webContents.send('export:progress', { percent: 100, stage: 'encoding' as const })
        resolve()
      })
      .on('error', (error) => {
        signal.removeEventListener('abort', onAbort)
        activeAbort = null
        if (signal.aborted) {
          fs.unlink(targetPath).catch(() => {})
          reject(new Error('Export cancelled'))
        } else {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      .save(targetPath)

    const onAbort = () => {
      command.kill('SIGTERM')
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
