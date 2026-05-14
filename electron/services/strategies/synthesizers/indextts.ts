import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import type { AppConfig, SynthesizerStrategy, SynthesisResult, TranslatedSegment } from '../../types.js'
import {
  buildTimeline, createSilenceFile, probeDuration, padAudioToDuration,
  runFfmpeg, sleep, toErrorMessage, isRetryableTtsError,
  DURATION_TOLERANCE, MAX_TTS_RETRIES, INITIAL_TTS_BACKOFF_MS,
} from './tts-helpers.js'

const INDEXTTS_DEFAULT_API_URL = 'http://localhost:8080'
const INDEXTTS_ATEMPO_MIN = 0.5
const INDEXTTS_ATEMPO_MAX = 2

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

async function adjustAudioTempoToDuration(
  inputFile: string,
  outputFile: string,
  actualDuration: number,
  targetDuration: number
): Promise<void> {
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

export default class IndexTtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'indextts'

  constructor(private readonly config: AppConfig) {}

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
    const baseFile = path.join(workDir, `segment-${index}.mp3`)
    const adjustedFile = path.join(workDir, `segment-${index}-adjusted.mp3`)
    const finalFile = path.join(workDir, `segment-${index}-final.mp3`)

    if (!text) {
      await createSilenceFile(targetDuration, finalFile)
      return finalFile
    }

    await this.synthesizeToFile(text, baseFile)
    const actualDuration = await probeDuration(baseFile)

    if (Math.abs(actualDuration - targetDuration) > DURATION_TOLERANCE) {
      await adjustAudioTempoToDuration(baseFile, adjustedFile, actualDuration, targetDuration)
      const adjustedDuration = await probeDuration(adjustedFile)

      if (adjustedDuration < targetDuration - DURATION_TOLERANCE) {
        await padAudioToDuration(adjustedFile, finalFile, targetDuration)
      } else {
        await fs.copyFile(adjustedFile, finalFile)
      }
    } else {
      await fs.copyFile(baseFile, finalFile)
    }

    return finalFile
  }

  private async synthesizeToFile(text: string, outputFile: string): Promise<void> {
    const baseUrl = this.config.indexttsApiUrl.trim() || INDEXTTS_DEFAULT_API_URL
    const apiUrl = new URL('/tts', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
    const referenceAudio = this.config.indexttsReferenceAudio.trim()
    const body = referenceAudio ? { text, reference_audio: referenceAudio } : { text }
    const fetchOptions = this.config.proxyEnabled && this.config.proxyUrl
      ? { dispatcher: new ProxyAgent(this.config.proxyUrl) }
      : {}

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

        if (isMp3Response(contentType, outputFile)) {
          await fs.writeFile(outputFile, buffer)
        } else {
          const rawFile = `${outputFile}.indextts-response`
          try {
            await fs.writeFile(rawFile, buffer)
            await convertAudioToMp3(rawFile, outputFile)
          } finally {
            await fs.rm(rawFile, { force: true }).catch(() => {})
          }
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
