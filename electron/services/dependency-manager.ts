import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import electron from 'electron'
import { fetch } from 'undici'
import { getEmbeddedPythonBinDir, getEmbeddedPythonPath } from './embedded-python.js'
import { parsePipJsonProgress, parsePipTextLine, splitStderrLines } from './pip-progress.js'
import { getDispatcher } from './proxy.js'
import type { AppConfig, DepInstallProgress, DepInstallStage, MissingDep } from './types.js'

const { app } = electron

export interface DepInfo {
  id: string
  name: string
  type: 'python'
  pipPackage: string
  cliName: string
  descriptionEn: string
  descriptionZh: string
  estimatedSize: string
  /** Minimum CLI version required by the app. Older installed versions are offered as updates. */
  minimumVersion?: string
  configCondition?: { field: keyof AppConfig; value: string }
  sourceTypeCondition?: { notEquals: string }
}

interface MirrorSource {
  name: string
  indexArgs: string[]
}

const MIRROR_CHAIN: MirrorSource[] = [
  {
    name: 'Official PyPI',
    indexArgs: [],
  },
  {
    name: 'Tsinghua',
    indexArgs: ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple', '--trusted-host', 'pypi.tuna.tsinghua.edu.cn'],
  },
  {
    name: 'Aliyun',
    indexArgs: ['-i', 'https://mirrors.aliyun.com/pypi/simple', '--trusted-host', 'mirrors.aliyun.com'],
  },
]

// Avoid leaving the UI blocked forever when a mirror accepts a connection but
// never returns package data. Mirrors are retried below, so fail fast here.
const PIP_NETWORK_ARGS = ['--disable-pip-version-check', '--timeout', '20', '--retries', '1']
const YT_DLP_INSTALL_TIMEOUT_MS = 90_000
const YT_DLP_RELEASE_TAG = '2026.08.19'

const DEP_REGISTRY: DepInfo[] = [
  {
    id: 'yt-dlp',
    name: 'yt-dlp',
    type: 'python',
    pipPackage: 'yt-dlp==2026.8.19',
    cliName: 'yt-dlp',
    descriptionEn: 'Downloads videos from YouTube and Bilibili.',
    descriptionZh: '用于下载 YouTube 和 Bilibili 视频。',
    estimatedSize: '~10MB',
    // YouTube changes its player API regularly. Pinning and checking this prevents an
    // already-installed, stale extractor from being silently reused.
    minimumVersion: '2026.8.19',
    sourceTypeCondition: { notEquals: 'local-file' },
  },
  {
    id: 'whisper',
    name: 'OpenAI Whisper',
    type: 'python',
    pipPackage: 'openai-whisper',
    cliName: 'whisper',
    descriptionEn: 'Runs local Whisper speech recognition.',
    descriptionZh: '用于本地 Whisper 语音识别。',
    estimatedSize: '~140MB',
    configCondition: { field: 'transcribeMode', value: 'local-cli' },
  },
  {
    id: 'whisperx',
    name: 'WhisperX',
    type: 'python',
    pipPackage: 'whisperx',
    cliName: 'whisperx',
    descriptionEn: 'Runs WhisperX transcription and alignment locally.',
    descriptionZh: '用于本地 WhisperX 转录与对齐。',
    estimatedSize: '~3GB+',
    configCondition: { field: 'transcribeMode', value: 'whisperx' },
  },
  {
    id: 'audio-separator',
    name: 'Audio Separator',
    type: 'python',
    pipPackage: 'audio-separator[cpu]',
    cliName: 'audio-separator',
    descriptionEn: 'Separates vocals from the original audio for mixing.',
    descriptionZh: '用于分离原音频中的人声以便混音。',
    estimatedSize: '~105MB',
    configCondition: { field: 'audioMixMode', value: 'mix-vocal-removal' },
  },
  {
    id: 'edge-tts',
    name: 'Edge TTS',
    type: 'python',
    pipPackage: 'edge-tts',
    cliName: 'edge-tts',
    descriptionEn: 'Microsoft Edge text-to-speech for generating target audio.',
    descriptionZh: '用于生成目标语言语音的微软 Edge 文字转语音。',
    estimatedSize: '~5MB',
    configCondition: { field: 'ttsMode', value: 'edge' },
  },
]

function toMissingDep(dep: DepInfo): MissingDep {
  return {
    id: dep.id,
    name: dep.minimumVersion ? `${dep.name} (${dep.minimumVersion})` : dep.name,
    descriptionEn: dep.descriptionEn,
    descriptionZh: dep.descriptionZh,
    estimatedSize: dep.estimatedSize,
  }
}

function getCliPathConfig(config: AppConfig, depId: string): string | undefined {
  switch (depId) {
    case 'yt-dlp':
      return config.ytDlpPath
    case 'whisper':
      return config.localWhisperCliPath
    case 'whisperx':
      return config.whisperxPath
    case 'audio-separator':
      return config.audioSeparatorPath
    case 'edge-tts':
      return config.edgeTtsPath
    default:
      return undefined
  }
}

function getInstalledPathConfig(depId: string, cliPath: string): Partial<AppConfig> {
  switch (depId) {
    case 'yt-dlp':
      return { ytDlpPath: cliPath }
    case 'whisper':
      return { localWhisperCliPath: cliPath }
    case 'whisperx':
      return { whisperxPath: cliPath }
    case 'audio-separator':
      return { audioSeparatorPath: cliPath }
    case 'edge-tts':
      return { edgeTtsPath: cliPath }
    default:
      return {}
  }
}

function getYtDlpStandaloneAsset(): { fileName: string; url: string } {
  if (process.platform === 'darwin') {
    return { fileName: 'yt-dlp', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_RELEASE_TAG}/yt-dlp_macos` }
  }
  if (process.platform === 'win32') {
    return { fileName: 'yt-dlp.exe', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_RELEASE_TAG}/yt-dlp.exe` }
  }
  if (process.arch === 'arm64') {
    return { fileName: 'yt-dlp', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_RELEASE_TAG}/yt-dlp_linux_aarch64` }
  }
  return { fileName: 'yt-dlp', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_RELEASE_TAG}/yt-dlp_linux` }
}

async function installStandaloneYtDlp(
  config: AppConfig,
  onProgress?: (progress: DepInstallProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { fileName, url } = getYtDlpStandaloneAsset()
  const toolsDir = path.join(app.getPath('userData'), 'tools')
  const targetPath = path.join(toolsDir, fileName)
  const temporaryPath = `${targetPath}.download`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), YT_DLP_INSTALL_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    await mkdir(toolsDir, { recursive: true })
    onProgress?.({ depId: 'yt-dlp', stage: 'downloading', message: 'Downloading yt-dlp from the official release...', percent: 30 })

    const response = await fetch(url, {
      dispatcher: getDispatcher(config, url),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Official yt-dlp download returned HTTP ${response.status}`)
    }

    const data = Buffer.from(await response.arrayBuffer())
    onProgress?.({ depId: 'yt-dlp', stage: 'downloading', message: 'Saving the official yt-dlp release...', percent: 90 })
    await fs.promises.writeFile(temporaryPath, data)

    if (data.length === 0) {
      throw new Error('Official yt-dlp download returned an empty file')
    }
    if (process.platform !== 'win32') {
      await fs.promises.chmod(temporaryPath, 0o755)
    }
    await fs.promises.rename(temporaryPath, targetPath)

    const version = await runCommandWithOutput(targetPath, ['--version'], { signal })
    if (!isVersionAtLeast(version, DEP_REGISTRY.find((dep) => dep.id === 'yt-dlp')!.minimumVersion!)) {
      throw new Error(`Downloaded yt-dlp version ${version} is too old`)
    }
    return targetPath
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

function getExecutableName(cliName: string): string {
  return process.platform === 'win32' ? `${cliName}.exe` : cliName
}

function isExecutableAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

interface RunCommandOptions {
  signal?: AbortSignal
  env?: Record<string, string>
  onStderr?: (line: string) => void
  timeoutMs?: number
}

function runCommand(command: string, args: string[], options?: RunCommandOptions): Promise<void> {
  const { signal, env, onStderr, timeoutMs } = options ?? {}
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Dependency installation cancelled'))
      return
    }

    const spawnEnv = env ? { ...process.env, ...env } : process.env
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv })
    let stderr = ''
    let settled = false
    let stderrBuffer = ''
    let timeout: NodeJS.Timeout | undefined

    const clearCommandTimeout = () => {
      if (timeout) clearTimeout(timeout)
    }

    const onAbort = () => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
        clearCommandTimeout()
        signal?.removeEventListener('abort', onAbort)
        reject(new Error('Dependency installation cancelled'))
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (onStderr) {
        const { lines, remainder } = splitStderrLines(stderrBuffer, chunk)
        for (const line of lines) {
          onStderr(line)
        }
        stderrBuffer = remainder
      }
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearCommandTimeout()
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearCommandTimeout()
      signal?.removeEventListener('abort', onAbort)
      if (onStderr && stderrBuffer.trim()) {
        onStderr(stderrBuffer)
      }
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`))
      }
    })

    if (timeoutMs) {
      timeout = setTimeout(() => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        child.kill('SIGTERM')
        reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)} seconds`))
      }, timeoutMs)
    }
  })
}

function runCommandWithOutput(command: string, args: string[], options?: RunCommandOptions): Promise<string> {
  const { signal, env } = options ?? {}
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Dependency installation cancelled'))
      return
    }

    const spawnEnv = env ? { ...process.env, ...env } : process.env
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv })
    let stdout = ''
    let stderr = ''
    let settled = false

    const onAbort = () => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
        reject(new Error('Dependency installation cancelled'))
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}

async function findPython(): Promise<string> {
  const embedded = getEmbeddedPythonPath()
  if (embedded) return embedded

  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
  for (const candidate of candidates) {
    if (await isExecutableAvailable(candidate)) {
      try {
        await runCommand(candidate, ['--version'])
        return candidate
      } catch {
        continue
      }
    }
  }
  throw new Error('Python 3 is required to install dependencies.')
}

function findDepInfo(depId: string): DepInfo {
  const dep = DEP_REGISTRY.find((candidate) => candidate.id === depId)
  if (!dep) {
    throw new Error(`Unknown dependency: ${depId}`)
  }
  return dep
}

async function isDepAvailable(dep: DepInfo, config: AppConfig): Promise<boolean> {
  const venvCliPath = path.join(getVenvBinDir(), getExecutableName(dep.cliName))
  let command: string | null = null
  const configuredPath = getCliPathConfig(config, dep.id)?.trim()

  // The pipeline uses an explicitly configured executable in preference to the
  // venv. Verify that same executable, otherwise a stale custom path could pass
  // this check and still fail during the actual download.
  if (configuredPath && configuredPath !== dep.cliName) {
    if (!fs.existsSync(configuredPath)) return false
    command = configuredPath
  } else if (fs.existsSync(venvCliPath)) {
    command = venvCliPath
  } else {
    if (await isExecutableAvailable(dep.cliName)) {
      command = dep.cliName
    }
  }

  if (!command) return false
  return isDepVersionSupported(dep, command)
}

function parseVersion(version: string): number[] | null {
  const match = version.trim().match(/^v?(\d+(?:\.\d+)*)/)
  if (!match) return null
  return match[1].split('.').map(Number)
}

export function isVersionAtLeast(version: string, minimumVersion: string): boolean {
  const actual = parseVersion(version)
  const minimum = parseVersion(minimumVersion)
  if (!actual || !minimum) return false

  const componentCount = Math.max(actual.length, minimum.length)
  for (let index = 0; index < componentCount; index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

async function isDepVersionSupported(dep: DepInfo, command: string): Promise<boolean> {
  if (!dep.minimumVersion) return true

  try {
    const version = await runCommandWithOutput(command, ['--version'])
    return isVersionAtLeast(version, dep.minimumVersion)
  } catch {
    // Treat an unreadable version as unsupported, so the installer can repair it.
    return false
  }
}

export function getRequiredDeps(config: AppConfig, sourceType: string): DepInfo[] {
  return DEP_REGISTRY.filter((dep) => {
    if (dep.sourceTypeCondition && sourceType === dep.sourceTypeCondition.notEquals) {
      return false
    }
    if (!dep.configCondition) {
      return true
    }
    return config[dep.configCondition.field] === dep.configCondition.value
  })
}

export function getVenvBinDirForUserData(userDataPath: string): string {
  return path.join(userDataPath, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin')
}

export function getVenvBinDir(): string {
  return getVenvBinDirForUserData(app.getPath('userData'))
}

export async function checkMissingDeps(config: AppConfig, sourceType: string): Promise<MissingDep[]> {
  const missing: MissingDep[] = []
  for (const dep of getRequiredDeps(config, sourceType)) {
    if (!(await isDepAvailable(dep, config))) {
      missing.push(toMissingDep(dep))
    }
  }
  return missing
}

function buildProxyEnv(config: AppConfig): Record<string, string> {
  if (!config.proxyEnabled || !config.proxyUrl) return {}
  return {
    HTTP_PROXY: config.proxyUrl,
    HTTPS_PROXY: config.proxyUrl,
  }
}

async function createVenv(python: string, venvDir: string, signal?: AbortSignal): Promise<void> {
  const venvBinDir = getVenvBinDir()
  const pipExe = path.join(venvBinDir, process.platform === 'win32' ? 'pip.exe' : 'pip')
  if (fs.existsSync(venvBinDir) && fs.existsSync(pipExe)) return

  if (fs.existsSync(venvDir)) {
    await rm(venvDir, { recursive: true, force: true })
  }

  await mkdir(path.dirname(venvDir), { recursive: true })
  await runCommand(python, ['-m', 'venv', venvDir], { signal })
}

async function upgradePip(pip: string, env: Record<string, string>, signal?: AbortSignal): Promise<void> {
  try {
    const result = await runCommandWithOutput(pip, ['--version'], { signal, env })
    const match = result.match(/pip (\d+)\.(\d+)/)
    if (match) return
  } catch { /* proceed to upgrade */ }

  for (const mirror of MIRROR_CHAIN) {
    try {
      await runCommand(pip, ['install', 'pip', ...mirror.indexArgs], { signal, env })
      return
    } catch {
      const isLast = mirror === MIRROR_CHAIN[MIRROR_CHAIN.length - 1]
      if (isLast) {
        throw new Error('All mirrors failed to upgrade pip')
      }
      continue
    }
  }
}

async function installWithMirrorFallback(
  pip: string,
  depInfos: DepInfo[],
  env: Record<string, string>,
  onProgress?: (progress: DepInstallProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: Error | undefined
  const proxyUrl = env.HTTPS_PROXY || env.HTTP_PROXY
  const pipProxyArgs = proxyUrl ? ['--proxy', proxyUrl] : []
  const depStatuses: Record<string, 'pending' | 'installing' | 'done'> = {}
  for (const dep of depInfos) {
    depStatuses[dep.id] = 'pending'
  }

  const emitProgress = (stage: DepInstallProgress['stage'], message: string, percent: number, currentDepId?: string) => {
    onProgress?.({ depId: currentDepId ?? 'install', stage, message, percent, depStatuses: { ...depStatuses } })
  }

  for (const mirror of MIRROR_CHAIN) {
    try {
      emitProgress('installing', `Installing setuptools and wheel via ${mirror.name}...`, 22)
      await runCommand(pip, ['install', ...PIP_NETWORK_ARGS, ...pipProxyArgs, 'setuptools==69.5.1', 'wheel', ...mirror.indexArgs], { signal, env, timeoutMs: YT_DLP_INSTALL_TIMEOUT_MS })
      break
    } catch {
      const isLast = mirror === MIRROR_CHAIN[MIRROR_CHAIN.length - 1]
      if (isLast) {
        throw new Error('All mirrors failed to install setuptools')
      }
    }
  }

  for (const dep of depInfos) {
    let depInstalled = false
    depStatuses[dep.id] = 'installing'
    emitProgress('installing', `Installing ${dep.name}...`, 30, dep.id)

      for (const mirror of MIRROR_CHAIN) {
        if (depInstalled) break
        emitProgress('installing', `Installing ${dep.name} via ${mirror.name}...`, 30, dep.id)
        const args = [
          'install',
          '--upgrade',
          ...PIP_NETWORK_ARGS,
          ...pipProxyArgs,
          dep.pipPackage,
          ...mirror.indexArgs,
        ]

        try {
          await runCommand(pip, args, {
            signal,
            env,
            timeoutMs: dep.id === 'yt-dlp' ? YT_DLP_INSTALL_TIMEOUT_MS : undefined,
            onStderr: (line) => {
              const parsed = parsePipTextLine(line)
              if (!parsed) return
              if (parsed.type === 'downloading') {
                emitProgress('downloading', `Downloading ${parsed.package}...`, 30 + Math.round(parsed.percent * 0.6), dep.id)
              }
            },
          })
          depStatuses[dep.id] = 'done'
          depInstalled = true
          break
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          // pip can safely retry another index in the same virtual environment.
          // Recreating it here made every transient network failure look like a
          // permanently stuck install while the progress stayed at 30%.
          continue
        }
      }

    if (!depInstalled) {
      throw lastError ?? new Error(`Failed to install ${dep.name}`)
    }
  }
}

export async function installMissingDeps(
  missingDeps: MissingDep[],
  config: AppConfig,
  onProgress?: (progress: DepInstallProgress) => void,
  signal?: AbortSignal,
): Promise<Partial<AppConfig>> {
  if (missingDeps.length === 0) return {}

  onProgress?.({ depId: 'python', stage: 'detecting-python', message: 'Detecting Python...', percent: 0 })

  const proxyEnv = buildProxyEnv(config)
  const depInfos = missingDeps.map((d) => findDepInfo(d.id))
  const ytDlpDep = depInfos.find((dep) => dep.id === 'yt-dlp')
  const pipDepInfos = depInfos.filter((dep) => dep.id !== 'yt-dlp')
  const updatedConfig: Partial<AppConfig> = {}

  // yt-dlp publishes a self-contained macOS executable. Installing it directly
  // avoids a fragile Python/pip bootstrap for the only dependency needed by the
  // usual YouTube workflow.
  if (ytDlpDep) {
    const ytDlpPath = await installStandaloneYtDlp(config, onProgress, signal)
    Object.assign(updatedConfig, getInstalledPathConfig('yt-dlp', ytDlpPath))
  }

  if (pipDepInfos.length === 0) {
    onProgress?.({ depId: 'done', stage: 'done', message: 'All dependencies installed.', percent: 100 })
    return updatedConfig
  }

  const embeddedBin = getEmbeddedPythonBinDir()

  let pip: string
  let binDir: string
  let venvDir: string | undefined

  if (embeddedBin) {
    pip = path.join(embeddedBin, getExecutableName('pip'))
    binDir = embeddedBin
  } else {
    const python = await findPython()
    venvDir = path.join(app.getPath('userData'), '.venv')
    const venvBinDir = getVenvBinDir()

    onProgress?.({ depId: 'venv', stage: 'creating-venv', message: 'Creating virtual environment...', percent: 10 })
    await createVenv(python, venvDir, signal)

    pip = path.join(venvBinDir, getExecutableName('pip'))
    binDir = venvBinDir
  }

  onProgress?.({ depId: 'venv', stage: 'upgrading-pip', message: 'Upgrading pip...', percent: 15 })
  await upgradePip(pip, proxyEnv, signal)

  await installWithMirrorFallback(pip, depInfos, proxyEnv, onProgress, signal)

  for (const missingDep of pipDepInfos) {
    Object.assign(updatedConfig, getInstalledPathConfig(missingDep.id, path.join(binDir, getExecutableName(findDepInfo(missingDep.id).cliName))))
  }

  onProgress?.({ depId: 'config', stage: 'configuring', message: 'Configuring paths...', percent: 95 })
  onProgress?.({ depId: 'done', stage: 'done', message: 'All dependencies installed.', percent: 100 })
  return updatedConfig
}
