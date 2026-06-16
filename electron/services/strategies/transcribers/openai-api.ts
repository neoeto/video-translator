import fs from 'node:fs'
import OpenAI from 'openai'
import type { AppConfig, TranscriberStrategy, TranscriptionResult, TranscriptSegment } from '../../types.js'
import { getDispatcher } from '../../proxy.js'
import { normalizeSegments, sleep, isRetryableError, describeOpenAIError } from './transcriber-helpers.js'

// OpenAI Whisper API 单文件上限为 25MB，本地 API 兼容模式也沿用该边界以提前失败。
const MAX_WHISPER_FILE_SIZE_BYTES = 25 * 1024 * 1024
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 500

interface WhisperVerboseJsonResponse {
  segments?: unknown
}

export default class OpenAIApiTranscriber implements TranscriberStrategy {
  readonly name: string

  constructor(private readonly config: AppConfig) {
    this.name = config.transcribeMode === 'local-api' ? 'local-api' : 'openai'
  }

  async transcribe(input: { audioPath: string; onProgress?: (pct: number) => void; onDetail?: (key: string | undefined, params?: Record<string, string>) => void; signal?: AbortSignal }): Promise<TranscriptionResult> {
    const { audioPath, onProgress, signal } = input
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (signal?.aborted) throw new Error('Pipeline cancelled')
        onProgress?.(10)
        const segments = await this.transcribeOnce(audioPath)
        onProgress?.(100)
        return { language: this.config.sourceLanguage || 'auto', segments }
      } catch (error) {
        lastError = error
        if (!isRetryableError(error) || attempt === MAX_RETRIES) {
          throw new Error(describeOpenAIError(error))
        }
        // 指数退避降低临时限流/网络抖动时的连续请求压力。
        await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }

    throw new Error(describeOpenAIError(lastError))
  }

  private async transcribeOnce(audioPath: string): Promise<TranscriptSegment[]> {
    const stats = await fs.promises.stat(audioPath)
    if (stats.size > MAX_WHISPER_FILE_SIZE_BYTES) {
      console.warn(
        `Audio file is ${(stats.size / (1024 * 1024)).toFixed(2)}MB, which exceeds Whisper's 25MB limit.`
      )
      throw new Error('Audio file exceeds the 25MB Whisper API limit. Please split it into smaller parts and try again.')
    }

    const isLocalApi = this.config.transcribeMode === 'local-api'
    // local-api 复用 OpenAI SDK 协议，但鉴权通常由本地服务忽略，因此使用占位 key。
    const baseURL = isLocalApi ? this.config.localWhisperApiUrl : 'https://api.openai.com'
    const client = new OpenAI({
      apiKey: isLocalApi ? 'not-needed' : this.config.openaiApiKey,
      ...(isLocalApi ? { baseURL } : {}),
      fetchOptions: { dispatcher: getDispatcher(this.config, baseURL) },
    })

    const whisperLang = this.config.sourceLanguage === 'auto' ? undefined : this.config.sourceLanguage

    const response = (await client.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(audioPath),
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      ...(whisperLang ? { language: whisperLang } : {}),
    })) as WhisperVerboseJsonResponse

    return normalizeSegments(response.segments)
  }
}
