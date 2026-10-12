import path from 'node:path'
import { promises as fs } from 'node:fs'

const PROJECT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

export function assertProjectId(projectId: unknown): asserts projectId is string {
  if (typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) {
    throw new Error('Invalid project id')
  }
}

export function getProjectsRoot(outputDir: string): string {
  return path.resolve(outputDir, 'projects')
}

export function getProjectRoot(outputDir: string, projectId: string): string {
  assertProjectId(projectId)
  return path.join(getProjectsRoot(outputDir), projectId)
}

export function getProjectDirectories(outputDir: string, projectId: string): {
  root: string
  assets: string
  generated: string
  temp: string
  manifest: string
} {
  const root = getProjectRoot(outputDir, projectId)
  return {
    root,
    assets: path.join(root, 'assets'),
    generated: path.join(root, 'generated'),
    temp: path.join(root, 'temp'),
    manifest: path.join(root, 'project.json'),
  }
}

/** Resolve a renderer-provided project-relative path and enforce the project root allowlist. */
export function resolveProjectRelativePath(outputDir: string, projectId: string, relativePath: string): string {
  const dirs = getProjectDirectories(outputDir, projectId)
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Project asset path must be relative')
  }
  const normalized = relativePath.replaceAll('\\', '/')
  if (normalized.split('/').some(part => part === '..' || part === '')) {
    throw new Error('Invalid project asset path')
  }
  const resolved = path.resolve(dirs.root, normalized)
  const rootWithSep = dirs.root.endsWith(path.sep) ? dirs.root : `${dirs.root}${path.sep}`
  if (resolved !== dirs.root && !resolved.startsWith(rootWithSep)) {
    throw new Error('Project asset path escapes project root')
  }
  return resolved
}
/** Canonically resolve a manifest-listed media asset, rejecting symlinks escaping the project root. */
export async function resolveProjectAssetPath(outputDir: string, projectId: string, relativePath: string, manifest?: { assets?: { video?: string; audio?: string }; generated?: { frames?: string[]; audio?: string[]; exports?: string[] } }): Promise<string> {
  const dirs = getProjectDirectories(outputDir, projectId)
  const candidate = resolveProjectRelativePath(outputDir, projectId, relativePath)
  const listed = [manifest?.assets?.video, manifest?.assets?.audio, ...(manifest?.generated?.frames ?? []), ...(manifest?.generated?.audio ?? []), ...(manifest?.generated?.exports ?? [])]
  if (manifest && !listed.includes(relativePath)) throw new Error('Asset is not listed in project manifest')
  const canonicalRoot = await fs.realpath(dirs.root)
  const canonicalProjectsRoot = await fs.realpath(getProjectsRoot(outputDir))
  if (canonicalRoot !== canonicalProjectsRoot && !canonicalRoot.startsWith(`${canonicalProjectsRoot}${path.sep}`)) throw new Error('Project root escapes projects directory')
  const canonical = await fs.realpath(candidate)
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) throw new Error('Project asset path escapes project root')
  const stat = await fs.stat(canonical)
  if (!stat.isFile()) throw new Error('Project asset must be a regular file')
  if (!canonical.startsWith(`${await fs.realpath(dirs.assets)}${path.sep}`) && !canonical.startsWith(`${await fs.realpath(dirs.generated)}${path.sep}`)) throw new Error('Only project media assets are allowed')
  return canonical
}

export function toProjectRelativePath(outputDir: string, projectId: string, absolutePath: string): string {
  const dirs = getProjectDirectories(outputDir, projectId)
  const resolved = path.resolve(absolutePath)
  const rootWithSep = `${dirs.root}${path.sep}`
  if (!resolved.startsWith(rootWithSep)) throw new Error('Path is outside project root')
  return path.relative(dirs.root, resolved).split(path.sep).join('/')
}

export async function ensureProjectDirectories(outputDir: string, projectId: string): Promise<ReturnType<typeof getProjectDirectories>> {
  const dirs = getProjectDirectories(outputDir, projectId)
  await Promise.all([
    fs.mkdir(dirs.assets, { recursive: true }),
    fs.mkdir(dirs.generated, { recursive: true }),
    fs.mkdir(dirs.temp, { recursive: true }),
  ])
  return dirs
}
