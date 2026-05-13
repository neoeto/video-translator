import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import OpenAI from 'openai'
import { ProxyAgent } from 'undici'
import type { AppConfig, Segment } from './types.js'

// OpenAI Whisper API 单文件上限为 25MB，本地 API 兼容模式也沿用该边界以提前失败。
const MAX_WHISPER_FILE_SIZE_BYTES = 25 * 1024 * 1024
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 500
const require = createRequire(import.meta.url)
const ffmpegStatic = require('ffmpeg-static') as string | null

interface WhisperVerboseJsonResponse {
  segments?: Segment[]
}

interface WhisperCliJsonResponse {
  segments?: unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRetryableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as {
    status?: number
    name?: string
    code?: string
    message?: string
  }

  // 只重试限流和网络瞬断，认证、参数、文件过大等确定性错误应立即暴露。
  if (candidate.status === 429) return true

  const retryableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'])
  if (candidate.code && retryableCodes.has(candidate.code)) return true

  const name = candidate.name ?? ''
  if (name.includes('RateLimit') || name.includes('Connection') || name.includes('Network')) return true

  const message = candidate.message ?? ''
  if (/rate limit|timeout|network|connection reset|fetch failed|socket hang up/i.test(message)) return true

  return false
}

function describeOpenAIError(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'Unknown transcription error.'
  }

  const candidate = error as {
    status?: number
    name?: string
    message?: string
  }

  if (candidate.status === 401 || candidate.status === 403 || candidate.name?.includes('Authentication')) {
    return 'OpenAI authentication failed. Check your API key.'
  }

  if (candidate.status === 429 || candidate.name?.includes('RateLimit')) {
    return 'OpenAI rate limit reached.'
  }

  if (candidate.name?.includes('Connection') || candidate.name?.includes('Network')) {
    return 'Network error while calling OpenAI.'
  }

  return candidate.message ?? 'Transcription failed.'
}

function createOpenAIClient(config: AppConfig, apiKey: string, baseURL?: string): OpenAI {
  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(config.proxyEnabled && config.proxyUrl ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxyUrl) } } : {}),
  })
}

function normalizeSegments(segments: unknown): Segment[] {
  if (!Array.isArray(segments)) {
    throw new Error('Whisper transcription response did not include segment timestamps.')
  }

  return segments.map((segment, index) => {
    if (typeof segment !== 'object' || segment === null) {
      throw new Error(`Invalid transcription segment at index ${index}.`)
    }

    const item = segment as Record<string, unknown>
    if (typeof item.start !== 'number' || typeof item.end !== 'number' || typeof item.text !== 'string') {
      throw new Error(`Invalid transcription segment at index ${index}.`)
    }

    return {
      start: item.start,
      end: item.end,
      text: item.text,
    }
  })
}

async function transcribeWithOpenAICompatibleApi(audioPath: string, config: AppConfig): Promise<Segment[]> {
  const stats = await fs.promises.stat(audioPath)

  if (stats.size > MAX_WHISPER_FILE_SIZE_BYTES) {
    console.warn(
      `Audio file is ${(stats.size / (1024 * 1024)).toFixed(2)}MB, which exceeds Whisper's 25MB limit. Please split the file and retry.`
    )
    throw new Error('Audio file exceeds the 25MB Whisper API limit. Please split it into smaller parts and try again.')
  }

  const isLocalApi = config.transcribeMode === 'local-api'
  // local-api 复用 OpenAI SDK 协议，但鉴权通常由本地服务忽略，因此使用占位 key。
  const client = createOpenAIClient(
    config,
    isLocalApi ? 'not-needed' : config.openaiApiKey,
    isLocalApi ? config.localWhisperApiUrl : undefined
  )

  const response = (await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: fs.createReadStream(audioPath),
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
    language: 'en',
  })) as WhisperVerboseJsonResponse

  return normalizeSegments(response.segments)
}

function buildWhisperEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }

  if (ffmpegStatic) {
    const ffmpegDir = path.dirname(ffmpegStatic)
    env.PATH = env.PATH ? `${ffmpegDir}${path.delimiter}${env.PATH}` : ffmpegDir
  }

  return env
}

function runWhisperCli(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: buildWhisperEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const stderrChunks: Buffer[] = []

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      const details = stderr ? `: ${stderr}` : signal ? ` with signal ${signal}` : ''
      reject(new Error(`Whisper CLI exited with code ${code ?? 'unknown'}${details}`))
    })
  })
}

async function transcribeWithLocalCli(audioPath: string, config: AppConfig): Promise<Segment[]> {
  const whisperPath = path.resolve(config.localWhisperCliPath)
  const outputDir = path.dirname(audioPath)

  try {
    await runWhisperCli(
      whisperPath,
      [
        audioPath,
        '--model',
        'base',
        '--language',
        'en',
        '--output_format',
        'json',
        '--output_dir',
        outputDir,
      ],
      outputDir
    )

    const expectedName = `${path.parse(audioPath).name}.json`
    const parsedPath = path.join(outputDir, expectedName)

    if (!fs.existsSync(parsedPath)) {
      const outputContents = await fs.promises.readdir(outputDir).catch(() => [] as string[])
      const foundFiles = outputContents.length > 0
        ? ` Found: ${outputContents.join(', ')}`
        : ' No files found in output directory.'
      throw new Error(
        `Whisper CLI did not produce expected output file "${expectedName}" in ${outputDir}.${foundFiles}` +
          `\nWhisper path: ${whisperPath}\nAudio path: ${audioPath}`
      )
    }

    const rawContent = await fs.promises.readFile(parsedPath, 'utf8')
    const parsed = JSON.parse(rawContent) as WhisperCliJsonResponse

    return normalizeSegments(parsed.segments)
  } catch (error) {
    if (typeof error === 'object' && error !== null) {
      const candidate = error as { code?: string; message?: string }
      if (candidate.code === 'ENOENT') {
        throw new Error(`Whisper CLI not found at "${whisperPath}". Please configure the correct path in Settings.`)
      }
      if (candidate.message) {
        throw new Error(`Whisper CLI failed: ${candidate.message}`)
      }
    }

    throw error
  }
}
async function transcribeOnce(audioPath: string, config: AppConfig): Promise<Segment[]> {
  // 三种模式中 local-cli 走进程调用，openai 和 local-api 共享 OpenAI-compatible HTTP 路径。
  if (config.transcribeMode === 'local-cli') {
    return transcribeWithLocalCli(audioPath, config)
  }

  return transcribeWithOpenAICompatibleApi(audioPath, config)
}

export async function transcribe(audioPath: string, config: AppConfig): Promise<Segment[]> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await transcribeOnce(audioPath, config)
    } catch (error) {
      lastError = error

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw new Error(describeOpenAIError(error))
      }

      // 指数退避降低临时限流/网络抖动时的连续请求压力。
      const delay = INITIAL_BACKOFF_MS * 2 ** (attempt - 1)
      await sleep(delay)
    }
  }

  throw new Error(describeOpenAIError(lastError))
}
