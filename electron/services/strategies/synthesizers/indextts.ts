import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fetch as undiciFetch } from 'undici'
import type { AppConfig, SpeakerProfile, SynthesizerStrategy, SynthesisResult, TranslatedSegment } from '../../types.js'
import { getDispatcher } from '../../proxy.js'
import {
  buildTimeline, createSilenceFile, runFfmpeg,
  sleep, toErrorMessage, isRetryableTtsError,
  MAX_TTS_RETRIES, INITIAL_TTS_BACKOFF_MS, TTS_SAMPLE_RATE,
} from './tts-helpers.js'

const INDEXTTS_DEFAULT_API_URL = 'http://localhost:8080'

async function convertAudioToMp3(inputFile: string, outputFile: string): Promise<void> {
  await runFfmpeg((command) => {
    command
      .input(inputFile)
      .audioCodec('libmp3lame')
      .audioFrequency(TTS_SAMPLE_RATE)
      .audioChannels(1)
      .format('mp3')
      .output(outputFile)
  })
}

export default class IndexTtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'indextts'
  readonly supportsVoiceCloning = true
  private speakerProfiles?: SpeakerProfile[]

  constructor(private readonly config: AppConfig) {}

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
    this.speakerProfiles = speakerProfiles
    const ttsWorkDir = path.join(workDir, '.tts-temp')
    await fs.mkdir(ttsWorkDir, { recursive: true })

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
    const rawFile = path.join(workDir, `segment-${index}-raw.mp3`)

    if (!text) {
      await createSilenceFile(targetDuration, rawFile)
      return rawFile
    }

    const profile = this.speakerProfiles?.find(p => p.id === segment.speaker)
    const referenceAudio = profile?.samplePath || this.config.indexttsReferenceAudio.trim()
    await this.synthesizeToFile(text, rawFile, referenceAudio)
    return rawFile
  }

  private async synthesizeToFile(text: string, outputFile: string, referenceAudio?: string): Promise<void> {
    const baseUrl = this.config.indexttsApiUrl.trim() || INDEXTTS_DEFAULT_API_URL
    const apiUrl = new URL('/tts', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
    const ref = referenceAudio || ''
    const body = ref ? { text, reference_audio: ref } : { text }
    const fetchOptions = { dispatcher: getDispatcher(this.config, apiUrl) }

    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt += 1) {
      try {
        const response = await undiciFetch(apiUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          ...fetchOptions,
        })

        if (!response.ok) {
          const message = await response.text().catch(() => response.statusText)
          const error = new Error(message || `IndexTTS request failed with status ${response.status}`)
          Object.assign(error, { status: response.status })
          throw error
        }

        const contentType = response.headers.get('content-type') ?? ''
        const buffer = Buffer.from(await response.arrayBuffer())

        // Always convert through ffmpeg to normalize sample rate and channels
        const rawFile = `${outputFile}.indextts-response`
        try {
          await fs.writeFile(rawFile, buffer)
          await convertAudioToMp3(rawFile, outputFile)
        } finally {
          await fs.rm(rawFile, { force: true }).catch(() => {})
        }
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
