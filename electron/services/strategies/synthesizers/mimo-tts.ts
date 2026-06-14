import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppConfig, SpeakerGender, SpeakerProfile, SynthesizerStrategy, SynthesisResult, TranscriptSegment, TranslatedSegment } from '../../types.js'
import {
  buildTimeline, createSilenceFile,
  sleep, toErrorMessage, isRetryableTtsError,
  MAX_TTS_RETRIES, INITIAL_TTS_BACKOFF_MS,
} from './tts-helpers.js'
import { ReferenceAudioResolver } from './reference-audio-resolver.js'

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions'
const MIMO_DEFAULT_VOICE = 'mimo_default'

const MIMO_PRESET_MODEL = 'mimo-v2.5-tts'
const MIMO_VOICECLONE_MODEL = 'mimo-v2.5-tts-voiceclone'

const VOICE_POOL: Partial<Record<string, Record<SpeakerGender, string[]>>> = {
  zh: {
    'adult-male': ['苏打', '白桦'],
    'adult-female': ['冰糖', '茉莉'],
    'child-male': ['苏打', '白桦'],
    'child-female': ['冰糖', '茉莉'],
  },
  en: {
    'adult-male': ['Milo', 'Dean'],
    'adult-female': ['Mia', 'Chloe'],
    'child-male': ['Milo', 'Dean'],
    'child-female': ['Mia', 'Chloe'],
  },
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

export default class MimoTtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'mimo'
  private readonly speakerVoiceMap = new Map<string, string>()
  private readonly genderVoiceIndex = new Map<string, number>()
  private speakerProfiles?: SpeakerProfile[]
  private resolver?: ReferenceAudioResolver

  constructor(private readonly config: AppConfig) {}

  get supportsVoiceCloning(): boolean {
    return this.config.mimoVoiceMode === 'voiceclone'
  }

  private getVoice(speaker: string): string {
    const existing = this.speakerVoiceMap.get(speaker)
    if (existing) return existing

    const targetLang = this.config.targetLanguage
    const profile = this.speakerProfiles?.find(p => p.id === speaker)
    const gender: SpeakerGender = profile?.gender ?? 'adult-male'

    const langPool = VOICE_POOL[targetLang]
    if (!langPool || !langPool[gender]) {
      this.speakerVoiceMap.set(speaker, MIMO_DEFAULT_VOICE)
      return MIMO_DEFAULT_VOICE
    }

    const pool = langPool[gender]
    const key = `${targetLang}:${gender}`
    const idx = this.genderVoiceIndex.get(key) ?? 0
    const voice = pool[idx % pool.length]
    this.genderVoiceIndex.set(key, idx + 1)
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
    sourceAudioPath?: string
    originalSegments?: TranscriptSegment[]
  }): Promise<SynthesisResult> {
    const { segments, workDir, onProgress, signal, syncMode, speakerProfiles, sourceAudioPath, originalSegments } = input
    this.speakerProfiles = speakerProfiles
    const ttsWorkDir = path.join(workDir, '.tts-temp')
    await fs.mkdir(ttsWorkDir, { recursive: true })

    if (this.config.mimoVoiceMode === 'voiceclone') {
      this.resolver = new ReferenceAudioResolver({
        mode: this.config.mimoReferenceMode ?? 'speaker-sample',
        speakerProfiles,
        globalReference: '',
        sourceAudioPath,
        originalSegments,
        cacheDir: path.join(ttsWorkDir, 'reference-clips'),
        logger: (event) => {
          if (event.level === 'warn') {
            console.warn(`[mimo.reference] seg#${event.segmentIndex}: ${event.message}`)
          }
        },
      })
    }

    try {
      const result = await buildTimeline(
        segments,
        ttsWorkDir,
        async (segment, index, wd) => this.synthesizeSegment(segment, index, wd),
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

  private async synthesizeSegment(segment: TranslatedSegment, index: number, workDir: string): Promise<string> {
    const targetDuration = Math.max(0.05, segment.end - segment.start)
    const text = segment.targetText.trim() || segment.sourceText.trim()
    const finalFile = path.join(workDir, `segment-${index}-final.wav`)

    if (!text) {
      await createSilenceFile(targetDuration, finalFile)
      return finalFile
    }

    if (this.config.mimoVoiceMode === 'voiceclone') {
      const decision = this.resolver
        ? await this.resolver.resolve(segment, index)
        : undefined
      const refPath = decision?.referenceAudio
        ?? this.speakerProfiles?.find(p => p.id === segment.speaker)?.samplePath

      if (refPath) {
        const voiceDataUrl = await fileToDataUrl(refPath)
        await this.synthesizeToFile(text, finalFile, voiceDataUrl, MIMO_VOICECLONE_MODEL)
      } else {
        const voice = this.getVoice(segment.speaker)
        await this.synthesizeToFile(text, finalFile, voice, MIMO_PRESET_MODEL)
      }
    } else {
      const voice = this.getVoice(segment.speaker)
      await this.synthesizeToFile(text, finalFile, voice, MIMO_PRESET_MODEL)
    }

    return finalFile
  }

  private async synthesizeToFile(text: string, outputFile: string, voice: string, model: string): Promise<void> {
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
      try {
        const response = await fetch(MIMO_API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'api-key': this.config.mimoApiKey,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'assistant', content: text },
            ],
            audio: { format: 'wav', voice },
          }),
        })

        if (!response.ok) {
          const message = await response.text().catch(() => response.statusText)
          const error = new Error(`MiMo API ${response.status}: ${message}`)
          Object.assign(error, { status: response.status })
          throw error
        }

        const completion = await response.json() as {
          choices?: { message?: { audio?: { data?: string } } }[]
        }
        const audioData = completion.choices?.[0]?.message?.audio?.data
        if (!audioData) {
          throw new Error('MiMo TTS response missing audio data')
        }

        const buffer = Buffer.from(audioData, 'base64')
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
