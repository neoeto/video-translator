import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import OpenAI from 'openai'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { getConfig } from './config.js'
import type { AppConfig, TranslatedSegment } from './types.js'

const require = createRequire(import.meta.url)
const ffprobeStatic = require('ffprobe-static') as { path?: string }

const ffmpegStatic = require('ffmpeg-static') as string | null
const ffmpegPath: string | null = ffmpegStatic
const ffprobePath = ffprobeStatic.path

if (!ffmpegPath) {
  throw new Error('ffmpeg binary not found')
}

if (!ffprobePath) {
  throw new Error('ffprobe binary not found')
}

ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath)

const DEFAULT_VOICE = 'zh-CN-YunxiNeural'
const MAX_RATE_ADJUSTMENT = 50
const DURATION_TOLERANCE = 0.3
const MAX_TTS_RETRIES = 3
const INITIAL_TTS_BACKOFF_MS = 1000
const INDEXTTS_DEFAULT_API_URL = 'http://localhost:8080'
const INDEXTTS_ATEMPO_MIN = 0.5
const INDEXTTS_ATEMPO_MAX = 2

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableTtsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { status?: number; code?: string; name?: string; message?: string }

  if (candidate.status === 429 || (typeof candidate.status === 'number' && candidate.status >= 500)) return true

  const retryableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'])
  if (candidate.code && retryableCodes.has(candidate.code)) return true

  const name = candidate.name ?? ''
  if (name.includes('RateLimit') || name.includes('Connection') || name.includes('Network')) return true

  const message = candidate.message ?? ''
  return /rate limit|timeout|network|connection reset|fetch failed|socket hang up/i.test(message)
}

function isRetryableEdgeTtsError(error: unknown): boolean {
  const message = toErrorMessage(error)
  return /noaudioreceived|timeout|network|connection|proxy|temporar|503|502|429|websocket|econnreset|etimedout/i.test(message)
}

type FfmpegCommand = ReturnType<typeof ffmpeg>

function clampRate(rate: number): number {
  // Edge TTS 语速调整过大会明显失真，因此限制在可接受范围内做近似匹配。
  return Math.max(-MAX_RATE_ADJUSTMENT, Math.min(MAX_RATE_ADJUSTMENT, rate))
}

function formatRate(rate: number): string {
  return `${rate >= 0 ? '+' : ''}${rate}%`
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, data) => {
      if (error) {
        reject(error)
        return
      }

      const duration = data.format?.duration
      if (typeof duration !== 'number' || !isFinitePositive(duration)) {
        reject(new Error(`Unable to determine duration for ${filePath}`))
        return
      }

      resolve(duration)
    })
  })
}

function detectEdgeTtsPath(config: AppConfig): string {
  if (config.localWhisperCliPath) {
    const whisperDir = path.dirname(config.localWhisperCliPath)
    const candidate = path.join(whisperDir, 'edge-tts')
    try {
      require('node:fs').accessSync(candidate, require('node:fs').constants.X_OK)
      console.log('[edge-tts] detected at', candidate)
      return candidate
    } catch {
      console.log('[edge-tts] not at', candidate, '- falling back to PATH')
    }
  }
  return 'edge-tts'
}

function getEdgeTtsProxy(config: AppConfig): string | null {
  if (!config.proxyEnabled) {
    return null
  }

  const proxyUrl = config.proxyUrl.trim()
  return proxyUrl ? proxyUrl : null
}

function buildEdgeTtsEnv(config: AppConfig): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const proxyUrl = getEdgeTtsProxy(config)

  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
    env.ALL_PROXY = proxyUrl
    env.http_proxy = proxyUrl
    env.https_proxy = proxyUrl
    env.all_proxy = proxyUrl
  }

  return env
}

async function runEdgeTtsCli(
  text: string,
  voice: string,
  rate: string,
  outputFile: string,
  config: AppConfig
): Promise<void> {
  const edgeTtsPath = detectEdgeTtsPath(config)
  const safeRate = rate || '+0%'
  const textFile = `${outputFile}.txt`
  const proxyUrl = getEdgeTtsProxy(config)

  await fs.writeFile(textFile, text, 'utf8')

  const args = [`--file=${textFile}`, `--voice=${voice}`, `--rate=${safeRate}`, `--write-media=${outputFile}`]
  if (proxyUrl) {
    args.push(`--proxy=${proxyUrl}`)
  }

  console.log('[edge-tts] spawn', edgeTtsPath, JSON.stringify(args))

  try {
    await new Promise<void>((resolve, reject) => {
    const child = spawn(edgeTtsPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: buildEdgeTtsEnv(config),
    })
    const stderrChunks: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk) })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0) { resolve(); return }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      reject(new Error(stderr || `edge-tts exited with code ${code}`))
    })
    })
  } finally {
    await fs.rm(textFile, { force: true }).catch(() => {})
  }
}

function runFfmpeg(configure: (command: FfmpegCommand) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg()
    configure(command)
    command.on('end', () => resolve())
    command.on('error', (error) => reject(error))
    command.run()
  })
}

async function createSilenceFile(duration: number, outputFile: string): Promise<void> {
  const safeDuration = Math.max(0.05, duration)

  await runFfmpeg((command) => {
    command
      .input('anullsrc=r=24000:cl=mono')
      .inputFormat('lavfi')
      .audioCodec('libmp3lame')
      .format('mp3')
      .duration(safeDuration)
      .output(outputFile)
  })
}

async function synthesizeEdgeTextToFile(text: string, rate: number, outputFile: string, config: AppConfig): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
    try {
      await runEdgeTtsCli(text, DEFAULT_VOICE, formatRate(rate), outputFile, config)
      return
    } catch (error) {
      lastError = error

      if (!isRetryableEdgeTtsError(error) || attempt === MAX_TTS_RETRIES) {
        throw error
      }

      await sleep(INITIAL_TTS_BACKOFF_MS * 2 ** (attempt - 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function createOpenAITtsClient(config: AppConfig): OpenAI {
  return new OpenAI({
    apiKey: config.openaiApiKey,
    ...(config.proxyEnabled && config.proxyUrl ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxyUrl) } } : {}),
  })
}

async function synthesizeOpenAITextToFile(
  text: string,
  outputFile: string,
  client: OpenAI,
): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
    try {
      const response = await client.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: text,
      })

      const buffer = Buffer.from(await response.arrayBuffer())
      await fs.writeFile(outputFile, buffer)
      return
    } catch (error) {
      lastError = error

      if (!isRetryableTtsError(error) || attempt === MAX_TTS_RETRIES) {
        throw error
      }

      await sleep(INITIAL_TTS_BACKOFF_MS * 2 ** (attempt - 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function createIndexTtsUrl(config: AppConfig): string {
  const baseUrl = config.indexttsApiUrl.trim() || INDEXTTS_DEFAULT_API_URL
  return new URL('/tts', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

function createIndexTtsFetchOptions(config: AppConfig): { dispatcher?: ProxyAgent } {
  return config.proxyEnabled && config.proxyUrl ? { dispatcher: new ProxyAgent(config.proxyUrl) } : {}
}

function createIndexTtsRequestBody(text: string, config: AppConfig): { text: string; reference_audio?: string } {
  const referenceAudio = config.indexttsReferenceAudio.trim()
  return referenceAudio ? { text, reference_audio: referenceAudio } : { text }
}

function isMp3Response(contentType: string, outputFile: string): boolean {
  return /audio\/mpeg|audio\/mp3/i.test(contentType) || outputFile.toLowerCase().endsWith('.mp3')
}

async function convertAudioToMp3(inputFile: string, outputFile: string): Promise<void> {
  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioCodec('libmp3lame')
      .format('mp3')
      .output(outputFile)
  })
}

async function writeIndexTtsAudioResponse(response: Response, outputFile: string): Promise<void> {
  const contentType = response.headers.get('content-type') ?? ''
  const buffer = Buffer.from(await response.arrayBuffer())

  if (isMp3Response(contentType, outputFile)) {
    await fs.writeFile(outputFile, buffer)
    return
  }

  const rawFile = `${outputFile}.indextts-response`
  try {
    await fs.writeFile(rawFile, buffer)
    await convertAudioToMp3(rawFile, outputFile)
  } finally {
    await fs.rm(rawFile, { force: true }).catch(() => {})
  }
}

async function synthesizeIndexTtsTextToFile(text: string, outputFile: string, config: AppConfig): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
    try {
      const response = await undiciFetch(createIndexTtsUrl(config), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createIndexTtsRequestBody(text, config)),
        ...createIndexTtsFetchOptions(config),
      })

      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText)
        const error = new Error(message || `IndexTTS request failed with status ${response.status}`)
        Object.assign(error, { status: response.status })
        throw error
      }

      await writeIndexTtsAudioResponse(response, outputFile)
      return
    } catch (error) {
      lastError = error

      if (!isRetryableTtsError(error) || attempt === MAX_TTS_RETRIES) {
        throw error
      }

      await sleep(INITIAL_TTS_BACKOFF_MS * 2 ** (attempt - 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function buildAtempoFilter(playbackRate: number): string {
  const filters: number[] = []
  let remainingRate = playbackRate

  while (remainingRate > INDEXTTS_ATEMPO_MAX) {
    filters.push(INDEXTTS_ATEMPO_MAX)
    remainingRate /= INDEXTTS_ATEMPO_MAX
  }

  while (remainingRate < INDEXTTS_ATEMPO_MIN) {
    filters.push(INDEXTTS_ATEMPO_MIN)
    remainingRate /= INDEXTTS_ATEMPO_MIN
  }

  filters.push(remainingRate)
  return filters.map((rate) => `atempo=${rate.toFixed(6)}`).join(',')
}

async function adjustAudioTempoToDuration(inputFile: string, outputFile: string, actualDuration: number, targetDuration: number): Promise<void> {
  const playbackRate = actualDuration / targetDuration

  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioFilters(buildAtempoFilter(playbackRate))
      .audioCodec('libmp3lame')
      .format('mp3')
      .output(outputFile)
  })
}

async function padAudioToDuration(inputFile: string, outputFile: string, targetDuration: number): Promise<void> {
  const currentDuration = await probeDuration(inputFile)
  const missingDuration = targetDuration - currentDuration

  // 合成语音偏短会让后续字幕时间轴漂移，补静音比拉伸音频更不影响音色。
  if (missingDuration <= DURATION_TOLERANCE) {
    await fs.copyFile(inputFile, outputFile)
    return
  }

  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioFilters(`apad=pad_dur=${missingDuration}`)
      .outputOptions(['-acodec', 'libmp3lame', '-t', String(targetDuration)])
      .format('mp3')
      .output(outputFile)
  })
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''")
}

async function concatAudioFiles(filePaths: string[], outputFile: string, workDir: string): Promise<void> {
  const listFile = path.join(workDir, 'concat.txt')
  const listContent = filePaths.map((filePath) => `file '${escapeConcatPath(filePath)}'`).join('\n') + '\n'
  await fs.writeFile(listFile, listContent)

  await runFfmpeg((command) => {
    command
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputFile)
  })
}

async function finalizeSegmentAudio(
  segment: TranslatedSegment,
  segmentIndex: number,
  workDir: string,
  config: AppConfig,
  openAIClient?: OpenAI,
): Promise<string> {
  const targetDuration = Math.max(0.05, segment.end - segment.start)
  const text = segment.cn.trim() || segment.en.trim() || segment.text.trim()
  const baseFile = path.join(workDir, `segment-${segmentIndex}.mp3`)
  const adjustedFile = path.join(workDir, `segment-${segmentIndex}-adjusted.mp3`)
  const finalFile = path.join(workDir, `segment-${segmentIndex}-final.mp3`)

  if (!text) {
    await createSilenceFile(targetDuration, finalFile)
    return finalFile
  }

  if (config.ttsMode === 'openai') {
    if (!openAIClient) {
      throw new Error('OpenAI TTS client was not initialized.')
    }

    await synthesizeOpenAITextToFile(text, baseFile, openAIClient)
  } else if (config.ttsMode === 'indextts') {
    await synthesizeIndexTtsTextToFile(text, baseFile, config)
  } else {
    await synthesizeEdgeTextToFile(text, 0, baseFile, config)
  }

  let actualDuration = await probeDuration(baseFile)

  if (config.ttsMode === 'edge' && Math.abs(actualDuration - targetDuration) > DURATION_TOLERANCE) {
    // 先按原始/目标时长比例重合成，再对仍偏短的片段补静音，兼顾语速自然和时间线对齐。
    const rawRate = Math.round((actualDuration / targetDuration) * 100 - 100)
    const adjustedRate = clampRate(rawRate)
    await synthesizeEdgeTextToFile(text, adjustedRate, adjustedFile, config)
    actualDuration = await probeDuration(adjustedFile)

    if (actualDuration < targetDuration - DURATION_TOLERANCE) {
      await padAudioToDuration(adjustedFile, finalFile, targetDuration)
    } else {
      await fs.copyFile(adjustedFile, finalFile)
    }
  } else if (config.ttsMode === 'indextts' && Math.abs(actualDuration - targetDuration) > DURATION_TOLERANCE) {
    await adjustAudioTempoToDuration(baseFile, adjustedFile, actualDuration, targetDuration)
    actualDuration = await probeDuration(adjustedFile)

    if (actualDuration < targetDuration - DURATION_TOLERANCE) {
      await padAudioToDuration(adjustedFile, finalFile, targetDuration)
    } else {
      await fs.copyFile(adjustedFile, finalFile)
    }
  } else {
    await fs.copyFile(baseFile, finalFile)
  }

  return finalFile
}

async function makeSegmentTimeline(
  segments: TranslatedSegment[],
  workDir: string,
  config: AppConfig,
): Promise<string[]> {
  const files: string[] = []
  const openAIClient = config.ttsMode === 'openai' ? createOpenAITtsClient(config) : undefined

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const segmentFile = await finalizeSegmentAudio(segment, index, workDir, config, openAIClient)

    if (index === 0 && segment.start > 0) {
      // 首段前导静音保留原视频开头空白，避免中文音轨整体提前。
      const leadingSilence = path.join(workDir, 'leading-silence.mp3')
      await createSilenceFile(segment.start, leadingSilence)
      files.push(leadingSilence)
    }

    files.push(segmentFile)

    const next = segments[index + 1]
    if (next) {
      const gap = next.start - segment.end
      if (gap > DURATION_TOLERANCE) {
        // 段落间隔用静音占位，防止拼接后的语音压缩掉原始停顿节奏。
        const gapFile = path.join(workDir, `gap-${index}.mp3`)
        await createSilenceFile(gap, gapFile)
        files.push(gapFile)
      }
    }
  }

  return files
}

export async function synthesize(
  translatedSegments: TranslatedSegment[],
  outputDir: string,
  config: AppConfig,
  onProgress: (pct: number) => void,
): Promise<string> {
  getConfig()
  await fs.mkdir(outputDir, { recursive: true })

  const outputPath = path.join(outputDir, 'cn_audio.mp3')
  const workDir = path.join(outputDir, '.tts-temp')
  await fs.mkdir(workDir, { recursive: true })

  try {
    if (translatedSegments.length === 0) {
      await createSilenceFile(0.1, outputPath)
      onProgress(100)
      return outputPath
    }

    const timelineFiles = await makeSegmentTimeline(translatedSegments, workDir, config)

    for (let index = 0; index < translatedSegments.length; index += 1) {
      onProgress(((index + 1) / translatedSegments.length) * 100)
    }

    if (timelineFiles.length === 1) {
      await fs.copyFile(timelineFiles[0], outputPath)
      onProgress(100)
      return outputPath
    }

    await concatAudioFiles(timelineFiles, outputPath, workDir)
    onProgress(100)
    return outputPath
  } catch (error) {
    throw new Error(`Failed to synthesize Chinese audio: ${toErrorMessage(error)}`)
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
