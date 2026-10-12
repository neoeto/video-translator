import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppConfig, VideoSourceType } from './types.js'
import type { ProjectAcquireRequest, ProjectManifest } from '../../shared/project-types.js'
import { createDownloader } from './factories.js'
import { probeMedia } from './project-media.js'
import { ensureProjectDirectories, toProjectRelativePath } from './project-paths.js'
import { ProjectStore } from './project-store.js'

function validateSourceUrl(sourceType: VideoSourceType, url: string): void {
  if (typeof url !== 'string' || !url.trim()) throw new Error('A source is required')
  if (sourceType === 'local-file') return
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('Invalid source URL') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Source URL must use HTTP or HTTPS')
  if (parsed.username || parsed.password) throw new Error('Source URL must not contain credentials')
  const host = parsed.hostname.toLowerCase()
  if (sourceType === 'youtube') {
    const valid = (host === 'youtube.com' || host === 'www.youtube.com') && (/^\/watch$/.test(parsed.pathname) || /^\/shorts\/[^/]+/.test(parsed.pathname)) || host === 'youtu.be' && /^\/[^/]+/.test(parsed.pathname)
    if (!valid) throw new Error('Unsupported YouTube URL')
  } else if (sourceType === 'bilibili') {
    const valid = (host === 'bilibili.com' || host === 'www.bilibili.com') && /^\/video(?:\/|$)/.test(parsed.pathname) || host === 'b23.tv' && /^\/[^/]+/.test(parsed.pathname)
    if (!valid) throw new Error('Unsupported Bilibili URL')
  }
}

export async function acquireProjectMedia(
  outputDir: string,
  config: AppConfig,
  manifest: ProjectManifest,
  request: ProjectAcquireRequest,
  signal: AbortSignal | undefined,
  onProgress: (percent: number) => void,
): Promise<ProjectManifest> {
  validateSourceUrl(request.sourceType, request.url)
  const dirs = await ensureProjectDirectories(outputDir, manifest.id)
  const stagingDir = path.join(dirs.temp, `acquire-${randomUUID()}`)
  await fs.mkdir(stagingDir, { recursive: true })
  try {
    const downloader = createDownloader(config, request.sourceType)
    const result = await downloader.download({ url: request.url, outputDir: stagingDir, onProgress: percent => onProgress(Math.max(0, Math.min(80, Math.round(percent * 0.8)))), signal })
    if (signal?.aborted) throw new Error('Project operation cancelled')
    const extension = path.extname(result.videoPath).toLowerCase() || '.mp4'
    const destination = path.join(dirs.assets, `source${extension}`)
    await fs.copyFile(result.videoPath, destination)
    if (signal?.aborted) throw new Error('Project operation cancelled')
    onProgress(85)
    const media = await probeMedia(destination)
    if (signal?.aborted) throw new Error('Project operation cancelled')
    const updated: ProjectManifest = {
      ...manifest,
      source: { type: request.sourceType, url: request.url, title: result.title },
      assets: { ...manifest.assets, video: toProjectRelativePath(outputDir, manifest.id, destination) },
      media,
      timeline: {
        ...manifest.timeline,
        videoTrack: [{ id: 'source', sourceStart: 0, sourceEnd: media.duration }],
      },
    }
    const store = new ProjectStore(outputDir)
    if (signal?.aborted) throw new Error('Project operation cancelled')
    onProgress(100)
    if (signal?.aborted) throw new Error('Project operation cancelled')
    const saved = await store.save(manifest.id, updated)
    if (signal?.aborted) throw new Error('Project operation cancelled')
    return saved
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
