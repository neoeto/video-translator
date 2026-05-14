import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { getVideoStorageKey } from '../../video-key.js'
import type { AppConfig, DownloaderStrategy, DownloadResult } from '../../types.js'

const require = createRequire(import.meta.url)
const ffmpegStaticPath = require('ffmpeg-static') as string | null

// 优先选择 MP4 视频流和 M4A 音频流，降低后续 ffmpeg 合成与播放器兼容风险。
const DOWNLOAD_FORMAT = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v'])

function getCacheDir(outputDir: string, url: string): string {
  return path.join(outputDir, '.cache', getVideoStorageKey(url))
}

function isYtDlpMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('ENOENT') || error.message.includes('spawn yt-dlp')
}

function normalizeTitle(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '')
}

function parseProgress(line: string): number | null {
  const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/)
  if (!match) return null
  const pct = Number(match[1])
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null
}

function parseDownloadDestination(line: string): string | null {
  const match = line.match(/\[download\]\s+Destination:\s+(.+)$/)
  return match ? match[1].trim() : null
}

function parseMergedDestination(line: string): string | null {
  const match = line.match(/\[(?:Merger|VideoRemuxer)\]\s+(?:Merging formats into|Destination:)\s+"?(.+?)"?$/)
  return match ? match[1].trim() : null
}

function isTemporaryStreamArtifact(filePath: string): boolean {
  // yt-dlp 分流下载会留下 video.f*.ext 中间文件，不能当作最终可播放视频。
  return /^video\.f\d+\./i.test(path.basename(filePath))
}

function isVideoArtifact(filePath: string): boolean {
  // 只接受统一 video.* 前缀的媒体文件，避免误拾取同目录的字幕、元数据或临时文本。
  const baseName = path.basename(filePath)
  const extension = path.extname(baseName).toLowerCase()
  return baseName.startsWith('video.') && VIDEO_FILE_EXTENSIONS.has(extension)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function dedupePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((candidate): candidate is string => Boolean(candidate?.trim())))]
}

async function findFinalVideoFile(cacheDir: string): Promise<string | null> {
  const entries = await fs.readdir(cacheDir, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(cacheDir, entry.name))
    .filter((filePath) => isVideoArtifact(filePath) && !isTemporaryStreamArtifact(filePath))
    .sort((left, right) => left.localeCompare(right))

  return candidates[0] ?? null
}

async function resolveDownloadedVideoPath(
  cacheDir: string,
  candidatePaths: Array<string | null | undefined>
): Promise<string> {
  // yt-dlp 可能下载、合并或转封装到不同文件名，必须按日志候选和目录扫描兜底解析最终产物。
  for (const candidatePath of dedupePaths(candidatePaths)) {
    if (!(await fileExists(candidatePath))) {
      continue
    }

    if (isVideoArtifact(candidatePath) && !isTemporaryStreamArtifact(candidatePath)) {
      return candidatePath
    }
  }

  const finalVideoFile = await findFinalVideoFile(cacheDir)
  if (finalVideoFile) {
    return finalVideoFile
  }

  throw new Error('Downloaded video file not found.')
}

function toDescriptiveError(message: string, stderr = ''): Error {
  const combined = `${message}\n${stderr}`.toLowerCase()

  // 将 yt-dlp 的非结构化 stderr 归类成用户可理解的失败原因。
  if (combined.includes('video unavailable') || combined.includes('this video is unavailable')) {
    return new Error('The video is unavailable.')
  }
  if (combined.includes('geo-restricted') || combined.includes('not available in your country')) {
    return new Error('The video is geo-restricted and cannot be downloaded from your location.')
  }
  if (combined.includes('network') || combined.includes('timed out') || combined.includes('connection')) {
    return new Error('A network error occurred while downloading the video.')
  }

  const detail = stderr.trim()
  return new Error(detail ? `${message} ${detail}` : message)
}

function runYtDlp(
  args: string[],
  onStdoutLine?: (line: string) => void,
  proxyUrl?: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Pipeline cancelled'))
      return
    }

    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''

    let settled = false
    const ytDlpArgs: string[] = []
    if (ffmpegStaticPath) {
      ytDlpArgs.push('--ffmpeg-location', ffmpegStaticPath)
    }
    if (proxyUrl?.trim()) {
      ytDlpArgs.push('--proxy', proxyUrl)
    }
    ytDlpArgs.push(...args)
    const child = spawn('yt-dlp', ytDlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

    const onAbort = () => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
        reject(new Error('Pipeline cancelled'))
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })

    if (!child.stdout || !child.stderr) {
      settled = true
      reject(new Error('Failed to start yt-dlp process.'))
      return
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        onStdoutLine?.(line)
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (stdoutBuffer) {
        onStdoutLine?.(stdoutBuffer)
      }
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        console.error('[yt-dlp] exit code:', code, 'stderr:', stderr || '(empty)', 'stdout:', stdout || '(empty)')
        reject(new Error(stderr || stdout || `yt-dlp exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}

async function getVideoTitle(url: string, proxyUrl?: string, signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await runYtDlp(['--print', 'title', url], undefined, proxyUrl, signal)
    const title = normalizeTitle(stdout.split(/\r?\n/).find(Boolean) ?? stdout)
    if (!title) {
      throw new Error('Failed to determine video title.')
    }
    return title
  } catch (error) {
    if (isYtDlpMissingError(error)) {
      throw new Error('yt-dlp is not installed. Please install it from https://github.com/yt-dlp/yt-dlp')
    }
    throw error instanceof Error ? toDescriptiveError('Failed to determine video title.', error.message) : error
  }
}

async function findCachedVideo(
  cacheDir: string
): Promise<{ videoPath: string; title: string } | null> {
  try {
    const metaPath = path.join(cacheDir, 'meta.json')
    const metaRaw = await fs.readFile(metaPath, 'utf8')
    const meta = JSON.parse(metaRaw) as { videoPath: string; title: string }
    // 缓存命中仍重新解析文件路径，因为旧版本或转封装后的最终文件名可能与 meta 不一致。
    const videoPath = await resolveDownloadedVideoPath(cacheDir, [meta.videoPath, path.join(cacheDir, 'video.mp4')])
    const normalizedMeta = videoPath === meta.videoPath ? meta : { ...meta, videoPath }

    if (normalizedMeta !== meta) {
      await fs.writeFile(metaPath, JSON.stringify(normalizedMeta, null, 2), 'utf8')
    }

    return normalizedMeta
  } catch {
    return null
  }
}

export default class YtDlpDownloader implements DownloaderStrategy {
  readonly name = 'yt-dlp'

  constructor(private readonly config: AppConfig) {}

  async download(input: {
    url: string
    outputDir: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
  }): Promise<DownloadResult> {
    const { url, outputDir, onProgress, signal } = input

    try {
      const cacheDir = getCacheDir(outputDir, url)

      const cached = await findCachedVideo(cacheDir)
      if (cached) {
        onProgress(100)
        return cached
      }

      await fs.mkdir(cacheDir, { recursive: true })
      const title = await getVideoTitle(url, this.config.proxyUrl, signal)

      let actualFilePath = path.join(cacheDir, 'video.mp4')
      let mergedFilePath: string | null = null

      const { stdout, stderr } = await runYtDlp(
        ['-f', DOWNLOAD_FORMAT, '--merge-output-format', 'mp4', '-o', path.join(cacheDir, 'video.%(ext)s'), '--newline', '--no-warnings', url],
        (line) => {
          const progress = parseProgress(line)
          if (progress !== null) {
            onProgress(progress)
          }
          const destination = parseDownloadDestination(line)
          if (destination) {
            actualFilePath = destination
          }

          const mergedDestination = parseMergedDestination(line)
          if (mergedDestination) {
            mergedFilePath = mergedDestination
          }
        },
        this.config.proxyUrl,
        signal,
      )

      const lines = `${stdout}\n${stderr}`.split(/\r?\n/)
      for (const line of lines) {
        const mergedDestination = parseMergedDestination(line)
        if (mergedDestination) {
          mergedFilePath = mergedDestination
        }

        const destination = parseDownloadDestination(line)
        if (destination) {
          actualFilePath = destination
        }
      }

      actualFilePath = await resolveDownloadedVideoPath(cacheDir, [
        mergedFilePath,
        path.join(cacheDir, 'video.mp4'),
        actualFilePath,
      ])

      const meta = { videoPath: actualFilePath, title }
      await fs.writeFile(path.join(cacheDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')

      onProgress(100)
      return meta
    } catch (error) {
      if (isYtDlpMissingError(error)) {
        throw new Error('yt-dlp is not installed. Please install it from https://github.com/yt-dlp/yt-dlp')
      }
      if (error instanceof Error) {
        throw toDescriptiveError('Failed to download video.', error.message)
      }
      throw new Error('Failed to download video.')
    }
  }
}
