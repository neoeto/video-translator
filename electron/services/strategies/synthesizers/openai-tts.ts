import { promises as fs } from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'
import { ProxyAgent } from 'undici'
import type { AppConfig, SpeakerGender, SpeakerProfile, SynthesizerStrategy, SynthesisResult, TranslatedSegment } from '../../types.js'
import {
  buildTimeline, createSilenceFile,
  sleep, toErrorMessage, isRetryableTtsError,
  MAX_TTS_RETRIES, INITIAL_TTS_BACKOFF_MS,
} from './tts-helpers.js'

const VOICE_POOL_BY_GENDER: Record<SpeakerGender, string[]> = {
  'adult-male': ['echo', 'onyx'],
  'adult-female': ['nova', 'shimmer'],
  'child-male': ['fable', 'alloy'],
  'child-female': ['alloy', 'fable'],
}

export default class OpenAITtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'openai-tts'
  private readonly speakerVoiceMap = new Map<string, string>()
  private readonly genderVoiceIndex = new Map<SpeakerGender, number>()
  private readonly client: OpenAI

  constructor(private readonly config: AppConfig) {
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      ...(config.proxyEnabled && config.proxyUrl
        ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxyUrl) } }
        : {}),
    })
  }

  private getVoice(speaker: string, speakerProfiles?: SpeakerProfile[]): string {
    const existing = this.speakerVoiceMap.get(speaker)
    if (existing) return existing

    const profile = speakerProfiles?.find(p => p.id === speaker)
    const gender: SpeakerGender = profile?.gender ?? 'adult-male'
    const pool = VOICE_POOL_BY_GENDER[gender]
    const idx = this.genderVoiceIndex.get(gender) ?? 0
    const voice = pool[idx % pool.length]
    this.genderVoiceIndex.set(gender, idx + 1)
    this.speakerVoiceMap.set(speaker, voice)
    return voice
  }

  async synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    speakerProfiles?: SpeakerProfile[]
    onProgress: (pct: number) => void
    signal?: AbortSignal
    syncMode?: import('../../types.js').SyncMode
  }): Promise<SynthesisResult> {
    const { segments, workDir, onProgress, signal, syncMode, speakerProfiles } = input
    const ttsWorkDir = path.join(workDir, '.tts-temp')
    await fs.mkdir(ttsWorkDir, { recursive: true })

    try {
      const result = await buildTimeline(
        segments,
        ttsWorkDir,
        async (segment, index, wd) => this.synthesizeSegment(segment, index, wd, speakerProfiles),
        onProgress,
        signal,
        syncMode,
      )
      return { audioPath: result.audioPath, segmentTimings: result.segmentTimings }
    } catch (error) {
      throw new Error(`Failed to synthesize audio: ${toErrorMessage(error)}`)
    } finally {
      await fs.rm(ttsWorkDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async synthesizeSegment(segment: TranslatedSegment, index: number, workDir: string, speakerProfiles?: SpeakerProfile[]): Promise<string> {
    const targetDuration = Math.max(0.05, segment.end - segment.start)
    const text = segment.targetText.trim() || segment.sourceText.trim()
    const finalFile = path.join(workDir, `segment-${index}-final.mp3`)
    const voice = this.getVoice(segment.speaker, speakerProfiles)

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
