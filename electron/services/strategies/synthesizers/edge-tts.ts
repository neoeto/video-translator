import { accessSync, constants as fsConstants } from 'node:fs'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppConfig, SynthesizerStrategy, SynthesisResult, TranslatedSegment } from '../../types.js'
import {
  buildTimeline, createSilenceFile, probeDuration, padAudioToDuration,
  sleep, toErrorMessage, isRetryableTtsError,
  DURATION_TOLERANCE, MAX_TTS_RETRIES, INITIAL_TTS_BACKOFF_MS,
} from './tts-helpers.js'

const VOICE_POOL = [
  'zh-CN-YunxiNeural',
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-YunjianNeural',
  'zh-CN-XiaoyiNeural',
  'zh-CN-YunyangNeural',
  'zh-CN-XiaozhenNeural',
]
const DEFAULT_VOICE = 'zh-CN-YunxiNeural'
const MAX_RATE_ADJUSTMENT = 50

function clampRate(rate: number): number {
  // Edge TTS 语速调整过大会明显失真，因此限制在可接受范围内做近似匹配。
  return Math.max(-MAX_RATE_ADJUSTMENT, Math.min(MAX_RATE_ADJUSTMENT, rate))
}

function formatRate(rate: number): string {
  return `${rate >= 0 ? '+' : ''}${rate}%`
}

function isRetryableEdgeTtsError(error: unknown): boolean {
  const message = toErrorMessage(error)
  return /noaudioreceived|timeout|network|connection|proxy|temporar|503|502|429|websocket|econnreset|etimedout/i.test(message)
}

function detectEdgeTtsPath(config: AppConfig): string {
  if (config.localWhisperCliPath) {
    const whisperDir = path.dirname(config.localWhisperCliPath)
    const candidate = path.join(whisperDir, 'edge-tts')
    try {
      accessSync(candidate, fsConstants.X_OK)
      console.log('[edge-tts] detected at', candidate)
      return candidate
    } catch {
      console.log('[edge-tts] not at', candidate, '- falling back to PATH')
    }
  }
  return 'edge-tts'
}

function getEdgeTtsProxy(config: AppConfig): string | null {
  if (!config.proxyEnabled) return null
  const proxyUrl = config.proxyUrl.trim()
  return proxyUrl || null
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
  if (proxyUrl) args.push(`--proxy=${proxyUrl}`)

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

async function synthesizeEdgeTextToFile(
  text: string,
  rate: number,
  outputFile: string,
  config: AppConfig,
  voice: string
): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
    try {
      await runEdgeTtsCli(text, voice, formatRate(rate), outputFile, config)
      return
    } catch (error) {
      lastError = error
      if (!isRetryableEdgeTtsError(error) || attempt === MAX_TTS_RETRIES) throw error
      await sleep(INITIAL_TTS_BACKOFF_MS * 2 ** (attempt - 1))
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export default class EdgeTtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'edge-tts'
  private readonly speakerVoiceMap = new Map<string, string>()
  private voiceIndex = 0

  constructor(private readonly config: AppConfig) {}

  private getVoice(speaker: string): string {
    const existing = this.speakerVoiceMap.get(speaker)
    if (existing) return existing
    const voice = VOICE_POOL[this.voiceIndex % VOICE_POOL.length]
    this.voiceIndex++
    this.speakerVoiceMap.set(speaker, voice)
    return voice
  }

  async synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    onProgress: (pct: number) => void
    signal?: AbortSignal
  }): Promise<SynthesisResult> {
    const { segments, workDir, onProgress, signal } = input
    const ttsWorkDir = path.join(workDir, '.tts-temp')
    await fs.mkdir(ttsWorkDir, { recursive: true })

    try {
      const audioPath = await buildTimeline(
        segments,
        ttsWorkDir,
        async (segment, index, wd) => this.synthesizeSegment(segment, index, wd),
        onProgress,
        signal
      )
      return { audioPath }
    } catch (error) {
      throw new Error(`Failed to synthesize audio: ${toErrorMessage(error)}`)
    } finally {
      await fs.rm(ttsWorkDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async synthesizeSegment(segment: TranslatedSegment, index: number, workDir: string): Promise<string> {
    const targetDuration = Math.max(0.05, segment.end - segment.start)
    const text = segment.targetText.trim() || segment.sourceText.trim()
    const baseFile = path.join(workDir, `segment-${index}.mp3`)
    const adjustedFile = path.join(workDir, `segment-${index}-adjusted.mp3`)
    const finalFile = path.join(workDir, `segment-${index}-final.mp3`)
    const voice = this.getVoice(segment.speaker)

    if (!text) {
      await createSilenceFile(targetDuration, finalFile)
      return finalFile
    }

    await synthesizeEdgeTextToFile(text, 0, baseFile, this.config, voice)
    let actualDuration = await probeDuration(baseFile)

    if (Math.abs(actualDuration - targetDuration) > DURATION_TOLERANCE) {
      // 先按原始/目标时长比例重合成，再对仍偏短的片段补静音，兼顾语速自然和时间线对齐。
      const rawRate = Math.round((actualDuration / targetDuration) * 100 - 100)
      const adjustedRate = clampRate(rawRate)
      await synthesizeEdgeTextToFile(text, adjustedRate, adjustedFile, this.config, voice)
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
}
