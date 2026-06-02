import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import electron from 'electron'
import type { AppConfig, DepInstallProgress, MissingDep } from './types.js'

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

const PYPI_MIRROR_ARGS = [
  '-i',
  'https://pypi.tuna.tsinghua.edu.cn/simple',
  '--trusted-host',
  'pypi.tuna.tsinghua.edu.cn',
] as const

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

function runCommand(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Dependency installation cancelled'))
      return
    }

    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
        resolve()
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}

async function findPython(): Promise<string> {
  for (const candidate of ['python3', 'python']) {
    if (await isExecutableAvailable(candidate)) {
      return candidate
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

export async function installMissingDeps(
  missingDeps: MissingDep[],
  _config: AppConfig,
  onProgress?: (progress: DepInstallProgress) => void,
  signal?: AbortSignal,
): Promise<Partial<AppConfig>> {
  if (missingDeps.length === 0) return {}

  onProgress?.({ depId: 'python', stage: 'detecting-python', message: 'Detecting Python...', percent: 0 })
  const python = await findPython()

  const venvDir = path.join(app.getPath('userData'), '.venv')
  const venvBinDir = getVenvBinDir()
  onProgress?.({ depId: 'venv', stage: 'creating-venv', message: 'Creating virtual environment...', percent: 10 })
  if (!fs.existsSync(venvBinDir)) {
    await mkdir(path.dirname(venvDir), { recursive: true })
    await runCommand(python, ['-m', 'venv', venvDir], signal)
  }

  const pip = path.join(venvBinDir, process.platform === 'win32' ? 'pip.exe' : 'pip')
  const updatedConfig: Partial<AppConfig> = {}
  const installStep = missingDeps.length > 0 ? 70 / missingDeps.length : 70

  for (const [index, missingDep] of missingDeps.entries()) {
    const dep = findDepInfo(missingDep.id)
    const percent = Math.round(20 + index * installStep)
    onProgress?.({
      depId: dep.id,
      stage: 'installing',
      message: `Installing ${dep.name}...`,
      percent,
    })
    await runCommand(pip, ['install', dep.pipPackage, ...PYPI_MIRROR_ARGS], signal)
    Object.assign(updatedConfig, getInstalledPathConfig(dep.id, path.join(venvBinDir, getExecutableName(dep.cliName))))
  }

  onProgress?.({ depId: 'config', stage: 'configuring', message: 'Configuring paths...', percent: 95 })
  onProgress?.({ depId: 'done', stage: 'done', message: 'All dependencies installed.', percent: 100 })
  return updatedConfig
}
