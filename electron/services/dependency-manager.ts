import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import electron from 'electron'
import { getEmbeddedPythonBinDir, getEmbeddedPythonPath } from './embedded-python.js'
import { parsePipJsonProgress, parsePipTextLine, splitStderrLines } from './pip-progress.js'
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
  configCondition?: { field: keyof AppConfig; value: string }
  sourceTypeCondition?: { notEquals: string }
}

interface MirrorSource {
  name: string
  indexArgs: string[]
}

const MIRROR_CHAIN: MirrorSource[] = [
  {
    name: 'Tsinghua',
    indexArgs: ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple', '--trusted-host', 'pypi.tuna.tsinghua.edu.cn'],
  },
  {
    name: 'Aliyun',
    indexArgs: ['-i', 'https://mirrors.aliyun.com/pypi/simple', '--trusted-host', 'mirrors.aliyun.com'],
  },
  {
    name: 'Official PyPI',
    indexArgs: [],
  },
]

const DEP_REGISTRY: DepInfo[] = [
  {
    id: 'yt-dlp',
    name: 'yt-dlp',
    type: 'python',
    pipPackage: 'yt-dlp',
    cliName: 'yt-dlp',
    descriptionEn: 'Downloads videos from YouTube and Bilibili.',
    descriptionZh: '用于下载 YouTube 和 Bilibili 视频。',
    estimatedSize: '~10MB',
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
    name: dep.name,
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
}

function runCommand(command: string, args: string[], options?: RunCommandOptions): Promise<void> {
  const { signal, env, onStderr } = options ?? {}
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

    const onAbort = () => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
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
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
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
  if (fs.existsSync(venvCliPath)) return true

  const configuredPath = getCliPathConfig(config, dep.id)?.trim()
  if (configuredPath && fs.existsSync(configuredPath)) return true

  return isExecutableAvailable(dep.cliName)
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
  venvDir?: string,
): Promise<void> {
  let lastError: Error | undefined
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
      await runCommand(pip, ['install', 'setuptools==69.5.1', 'wheel', ...mirror.indexArgs], { signal, env })
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
        const args = [
          'install',
          dep.pipPackage,
          ...mirror.indexArgs,
        ]

        try {
          await runCommand(pip, args, {
            signal,
            env,
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
          if (venvDir) {
            try { await rm(venvDir, { recursive: true, force: true }) } catch { /* best effort */ }
            try {
              const python = await findPython()
              await createVenv(python, venvDir, signal)
              await upgradePip(pip, env, signal)
              for (const m2 of MIRROR_CHAIN) {
                try {
                  await runCommand(pip, ['install', 'setuptools==69.5.1', 'wheel', ...m2.indexArgs], { signal, env })
                  break
                } catch { /* next mirror */ }
              }
            } catch { /* best effort, next iteration will retry */ }
          }
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

  const embeddedBin = getEmbeddedPythonBinDir()
  const proxyEnv = buildProxyEnv(config)
  const depInfos = missingDeps.map((d) => findDepInfo(d.id))

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

  await installWithMirrorFallback(pip, depInfos, proxyEnv, onProgress, signal, venvDir)

  const updatedConfig: Partial<AppConfig> = {}
  for (const missingDep of missingDeps) {
    Object.assign(updatedConfig, getInstalledPathConfig(missingDep.id, path.join(binDir, getExecutableName(findDepInfo(missingDep.id).cliName))))
  }

  onProgress?.({ depId: 'config', stage: 'configuring', message: 'Configuring paths...', percent: 95 })
  onProgress?.({ depId: 'done', stage: 'done', message: 'All dependencies installed.', percent: 100 })
  return updatedConfig
}
