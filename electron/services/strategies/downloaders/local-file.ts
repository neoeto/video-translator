import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { AppConfig, DownloaderStrategy, DownloadResult } from '../../types.js'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.wmv', '.ts', '.mts'])

function getLocalCacheDir(outputDir: string, filePath: string): string {
  const hash = createHash('sha256').update(filePath).digest('hex').slice(0, 16)
  return path.join(outputDir, '.cache', `local-${hash}`)
}

function extractTitleFromPath(filePath: string): string {
  const baseName = path.basename(filePath)
  const ext = path.extname(baseName)
  return baseName.slice(0, baseName.length - ext.length) || 'local_video'
}

export default class LocalFileDownloader implements DownloaderStrategy {
  readonly name = 'local-file'

  constructor(private readonly _config: AppConfig) {}

  async download(input: {
    url: string
    outputDir: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
  }): Promise<DownloadResult> {
    // url 此处实际是本地文件路径
    const { url: filePath, outputDir, onProgress, signal } = input

    const ext = path.extname(filePath).toLowerCase()
    if (!VIDEO_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported video format: ${ext}`)
    }

    try {
      await fs.access(filePath)
    } catch {
      throw new Error(`File not found: ${filePath}`)
    }

    const cacheDir = getLocalCacheDir(outputDir, filePath)

    // 检查缓存
    const metaPath = path.join(cacheDir, 'meta.json')
    try {
      const metaRaw = await fs.readFile(metaPath, 'utf8')
      const meta = JSON.parse(metaRaw) as { videoPath: string; title: string }
      await fs.access(meta.videoPath)
      onProgress(100)
      return meta
    } catch {
      // 缓存未命中，继续复制
    }

    if (signal?.aborted) throw new Error('Pipeline cancelled')

    await fs.mkdir(cacheDir, { recursive: true })
    const title = extractTitleFromPath(filePath)
    const destPath = path.join(cacheDir, `video${ext}`)

    // 复制文件到工作目录，通过分块计算进度
    const stats = await fs.stat(filePath)
    const totalSize = stats.size

    if (totalSize === 0) {
      throw new Error('File is empty')
    }

    const src = await fs.open(filePath, 'r')
    const dst = await fs.open(destPath, 'w')
    try {
      const bufferSize = 1024 * 1024 // 1MB chunks
      const buffer = Buffer.allocUnsafe(bufferSize)
      let copied = 0

      while (true) {
        if (signal?.aborted) {
          throw new Error('Pipeline cancelled')
        }
        const { bytesRead } = await src.read(buffer, 0, bufferSize)
        if (bytesRead === 0) break
        await dst.write(buffer, 0, bytesRead)
        copied += bytesRead
        onProgress(Math.min(99, Math.round((copied / totalSize) * 100)))
      }
    } finally {
      await src.close()
      await dst.close()
    }

    const meta = { videoPath: destPath, title }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
    onProgress(100)
    return meta
  }
}
