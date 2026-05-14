import { promises as fs } from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'
import { ProxyAgent } from 'undici'
import type { AppConfig, SynthesizerStrategy, SynthesisResult, TranslatedSegment } from '../../types.js'
import {
  buildTimeline, createSilenceFile,
  sleep, toErrorMessage, isRetryableTtsError,
  MAX_TTS_RETRIES, INITIAL_TTS_BACKOFF_MS,
} from './tts-helpers.js'

const VOICE_POOL = ['alloy', 'nova', 'echo', 'shimmer', 'fable', 'onyx']

export default class OpenAITtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'openai-tts'
  private readonly speakerVoiceMap = new Map<string, string>()
  private voiceIndex = 0
  private readonly client: OpenAI

  constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      ...(config.proxyEnabled && config.proxyUrl
        ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxyUrl) } }
        : {}),
    })
  }

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
  }): Promise<SynthesisResult> {
    const { segments, workDir, onProgress } = input
    const ttsWorkDir = path.join(workDir, '.tts-temp')
    await fs.mkdir(ttsWorkDir, { recursive: true })

    try {
      const audioPath = await buildTimeline(
        segments,
        ttsWorkDir,
        async (segment, index, wd) => this.synthesizeSegment(segment, index, wd),
        onProgress
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
    const finalFile = path.join(workDir, `segment-${index}-final.mp3`)
    const voice = this.getVoice(segment.speaker)

    if (!text) {
      await createSilenceFile(targetDuration, finalFile)
      return finalFile
    }

    await this.synthesizeToFile(text, finalFile, voice)
    return finalFile
  }

  private async synthesizeToFile(text: string, outputFile: string, voice: string): Promise<void> {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
      try {
        const response = await this.client.audio.speech.create({
          model: 'tts-1',
          voice,
          input: text,
        })
        const buffer = Buffer.from(await response.arrayBuffer())
        await fs.writeFile(outputFile, buffer)
        return
      } catch (error) {
        lastError = error
        if (!isRetryableTtsError(error) || attempt === MAX_TTS_RETRIES) throw error
        await sleep(INITIAL_TTS_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }
}
