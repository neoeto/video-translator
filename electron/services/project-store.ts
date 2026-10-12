import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectListItem,
  type ProjectManifest,
  type ProjectTimeline,
} from '../../shared/project-types.js'
import { ensureProjectDirectories, getProjectDirectories, getProjectsRoot, assertProjectId } from './project-paths.js'

function invalid(message: string): never {
  throw new Error(`Invalid project manifest: ${message}`)
}

function validateRelativeAsset(value: unknown, field: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || path.isAbsolute(value) || (value && value.replaceAll('\\', '/').split('/').some(part => part === '..' || part === ''))) invalid(`${field} must be a project-relative path`)
}

function validateProjectName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name.trim() || name.length > 240) invalid('name is invalid')
}

export function validateTimeline(timeline: unknown, mediaDuration?: number, allowEmptyVideo = false): asserts timeline is ProjectTimeline {
  if (!timeline || typeof timeline !== 'object') invalid('timeline is required')
  const value = timeline as ProjectTimeline
  if (!Array.isArray(value.videoTrack) || (!allowEmptyVideo && value.videoTrack.length === 0)) invalid('timeline.videoTrack must be non-empty')
  for (const clip of value.videoTrack) {
    if (!clip || typeof clip !== 'object' || typeof clip.id !== 'string' || !clip.id || typeof clip.sourceStart !== 'number' || typeof clip.sourceEnd !== 'number' || !Number.isFinite(clip.sourceStart) || !Number.isFinite(clip.sourceEnd) || clip.sourceStart < 0 || clip.sourceEnd <= clip.sourceStart || (mediaDuration !== undefined && clip.sourceEnd > mediaDuration)) invalid('timeline contains an invalid clip')
  }
  if (!value.audioTrack || value.audioTrack.type !== 'original' || value.audioTrack.enabled !== true) invalid('phase 1 only supports an enabled original audio track')
}

export function validateProjectManifest(input: unknown, expectedId?: string, allowEmptyVideo = false): ProjectManifest {
  if (!input || typeof input !== 'object') invalid('manifest must be an object')
  const value = input as ProjectManifest
  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION) invalid('unsupported schemaVersion')
  if (typeof value.id !== 'string') invalid('id is required')
  assertProjectId(value.id)
  if (expectedId && value.id !== expectedId) invalid('id does not match project path')
  validateProjectName(value.name)
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) invalid('timestamps are invalid')
  if (!value.assets || typeof value.assets !== 'object') invalid('assets are required')
  validateRelativeAsset(value.assets.video, 'assets.video', allowEmptyVideo)
  if (value.assets.audio !== undefined) validateRelativeAsset(value.assets.audio, 'assets.audio')
  if (!value.generated || typeof value.generated !== 'object') invalid('generated is required')
  for (const field of ['frames', 'audio', 'exports'] as const) {
    if (!Array.isArray(value.generated[field])) invalid(`generated.${field} must be an array`)
    value.generated[field].forEach((asset, index) => validateRelativeAsset(asset, `generated.${field}[${index}]`))
  }
  if (value.source !== undefined) {
    if (typeof value.source !== 'object' || !value.source || !['youtube', 'bilibili', 'local-file'].includes(value.source.type)) invalid('source type is invalid')
    if (value.source.url !== undefined && typeof value.source.url !== 'string') invalid('source.url must be a string')
    if (value.source.title !== undefined && typeof value.source.title !== 'string') invalid('source.title must be a string')
  }
  if (value.media === null || (value.media !== undefined && (typeof value.media !== 'object' || !Number.isFinite(value.media.duration) || value.media.duration < 0 ||
      !Number.isFinite(value.media.width) || value.media.width <= 0 || !Number.isFinite(value.media.height) || value.media.height <= 0))) {
    invalid('media metadata is invalid')
  }
  validateTimeline(value.timeline, value.media?.duration, allowEmptyVideo)
  return value
}

export class ProjectStore {
  constructor(private readonly outputDir: string) {}

  async create(name = 'Untitled project'): Promise<ProjectManifest> {
    validateProjectName(name)
    const id = randomUUID()
    const now = Date.now()
    const manifest: ProjectManifest = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      name: name.trim() || 'Untitled project',
      createdAt: now,
      updatedAt: now,
      assets: { video: '' },
      generated: { frames: [], audio: [], exports: [] },
      timeline: { videoTrack: [], audioTrack: { type: 'original', enabled: true } },
    }
    // An empty video path is allowed only until acquisition populates a project.
    const dirs = await ensureProjectDirectories(this.outputDir, id)
    await this.writeManifest(dirs.manifest, manifest, true)
    return manifest
  }

  async open(projectId: string, allowEmptyVideo = false): Promise<ProjectManifest> {
    assertProjectId(projectId)
    const id = projectId
    const dirs = getProjectDirectories(this.outputDir, id)
    const parsed = JSON.parse(await fs.readFile(dirs.manifest, 'utf8')) as unknown
    return validateProjectManifest(parsed, id, allowEmptyVideo)
  }

  async save(projectId: string, input: unknown): Promise<ProjectManifest> {
    assertProjectId(projectId)
    const id = projectId
    const manifest = validateProjectManifest(input, id)
    const dirs = await ensureProjectDirectories(this.outputDir, id)
    manifest.updatedAt = Date.now()
    await this.writeManifest(dirs.manifest, manifest)
    return manifest
  }

  async list(): Promise<ProjectListItem[]> {
    const root = getProjectsRoot(this.outputDir)
    let entries
    try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { return [] }
    const result: ProjectListItem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROJECT_ID_RE.test(entry.name)) continue
      try {
        const manifest = await this.open(entry.name)
        result.push({ id: manifest.id, name: manifest.name, createdAt: manifest.createdAt, updatedAt: manifest.updatedAt, duration: manifest.media?.duration })
      } catch { /* ignore incomplete/corrupt projects in the lightweight index */ }
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async delete(projectId: string): Promise<void> {
    assertProjectId(projectId)
    const dirs = getProjectDirectories(this.outputDir, projectId)
    await fs.rm(dirs.root, { recursive: true, force: true })
  }

  private async writeManifest(manifestPath: string, manifest: ProjectManifest, allowEmptyVideo = false): Promise<void> {
    validateProjectManifest(manifest, manifest.id, allowEmptyVideo)
    const tempPath = `${manifestPath}.${randomUUID()}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' })
    try {
      await fs.rename(tempPath, manifestPath)
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {})
      throw error
    }
  }
}

const PROJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
