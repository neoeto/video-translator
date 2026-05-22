import OpenAI from 'openai'
import type { AppConfig, TranslatorStrategy, TranslationResult, TranscriptSegment, TranslatedSegment } from '../../types.js'
import { getDispatcher } from '../../proxy.js'

// 分批限制 prompt 和响应体大小，降低长视频一次性翻译超出模型上下文或 JSON 截断的概率。
const BATCH_SIZE = 50
const MAX_RETRIES = 3
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

interface TranslationResponseItem {
  sourceText: string
  targetText: string
  start: number
  end: number
}

interface TranslationResponse {
  translations: TranslationResponseItem[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunkSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const batches: TranscriptSegment[][] = []
  for (let index = 0; index < segments.length; index += BATCH_SIZE) {
    batches.push(segments.slice(index, index + BATCH_SIZE))
  }
  return batches
}

function buildSystemPrompt(sourceLanguage: string, targetLanguage: string, strictSync = false): string {
  const isAuto = sourceLanguage === 'auto'

  const base = isAuto
    ? `You are a professional translator specializing in video content.
Detect the source language from the text and translate each segment naturally and fluently into ${targetLanguage}.
Return a JSON object with a "translations" array where each element has:
- "sourceText": the original text (exact copy)
- "targetText": the ${targetLanguage} translation
- "start": the start timestamp (exact copy)
- "end": the end timestamp (exact copy)
Maintain the exact same array order. Handle colloquialisms, slang, and technical terms appropriately.
Do NOT add any extra text, explanations, or notes — only return the JSON.`
    : `You are a professional ${sourceLanguage}-to-${targetLanguage} translator specializing in video content.
Translate each segment naturally and fluently into ${targetLanguage}.
Return a JSON object with a "translations" array where each element has:
- "sourceText": the original ${sourceLanguage} text (exact copy)
- "targetText": the ${targetLanguage} translation
- "start": the start timestamp (exact copy)
- "end": the end timestamp (exact copy)
Maintain the exact same array order. Handle colloquialisms, slang, and technical terms appropriately.
Do NOT add any extra text, explanations, or notes — only return the JSON.`

  if (strictSync) {
    const charGuide = targetLanguage === 'Chinese'
      ? 'approximately 4 Chinese characters per second of speech'
      : 'match the approximate speaking rate of the target language'
    return base + `\n\nIMPORTANT: Each segment has a "duration" field (in seconds). The translated text will be synthesized as speech that must fit within this duration. Adjust translation length so that the ${targetLanguage} speech duration roughly matches the original. As a guideline, ${charGuide}. Prioritize natural translation, but avoid overly long or short translations relative to the duration.`
  }

  return base
}

function isTranslationResponseItem(value: unknown): value is TranslationResponseItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.sourceText === 'string' &&
    typeof item.targetText === 'string' &&
    typeof item.start === 'number' &&
    typeof item.end === 'number'
  )
}

function parseAndValidateResponse(
  rawContent: string,
  inputSegments: TranscriptSegment[]
): TranslatedSegment[] {
  const parsed: unknown = JSON.parse(rawContent)

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid translation response: expected a JSON object.')
  }

  const response = parsed as Partial<TranslationResponse>
  const translations = response.translations

  if (!Array.isArray(translations)) {
    throw new Error('Invalid translation response: missing "translations" array.')
  }

  if (translations.length !== inputSegments.length) {
    throw new Error(
      `Invalid translation response: expected ${inputSegments.length} translations, got ${translations.length}.`
    )
  }

  return translations.map((item, index) => {
    if (!isTranslationResponseItem(item)) {
      throw new Error(`Invalid translation response: item at index ${index} has an invalid shape.`)
    }

    const segment = inputSegments[index]

    // Timestamp check prevents LLM from reordering or merging segments.
    if (item.start !== segment.start || item.end !== segment.end) {
      throw new Error(`Invalid translation response: item at index ${index} does not preserve timestamps.`)
    }

    // Always use the original text — LLMs sometimes subtly modify sourceText when echoing it back.
    return {
      start: segment.start,
      end: segment.end,
      sourceText: segment.text,
      targetText: item.targetText,
      speaker: segment.speaker,
    }
  })
}

function getProviderSettings(config: AppConfig): { apiKey: string; baseURL?: string; model: string } {
  // 三家服务兼容 OpenAI SDK 形态，差异集中在 baseURL、API key 和默认模型。
  switch (config.translateMode) {
    case 'deepseek':
      return { apiKey: config.deepseekApiKey, baseURL: DEEPSEEK_BASE_URL, model: config.deepseekModel || 'deepseek-chat' }
    case 'glm':
      return { apiKey: config.glmApiKey, baseURL: GLM_BASE_URL, model: config.glmModel || 'glm-4-flash' }
    case 'openai':
      return { apiKey: config.openaiApiKey, model: config.openaiModel || 'gpt-4o' }
  }
}

export default class OpenAICompatibleTranslator implements TranslatorStrategy {
  readonly name: string

  constructor(private readonly config: AppConfig) {
    this.name = `openai-compatible-${config.translateMode}`
  }

  async translate(input: {
    segments: TranscriptSegment[]
    sourceLanguage: string
    targetLanguage: string
    onProgress?: (pct: number) => void
    signal?: AbortSignal
    syncMode?: import('../../types.js').SyncMode
  }): Promise<TranslationResult> {
    const { segments, sourceLanguage, targetLanguage, onProgress, signal, syncMode } = input
    const strictSync = syncMode === 'strict'
    const provider = getProviderSettings(this.config)
    const targetUrl = provider.baseURL || 'https://api.openai.com'
    const client = new OpenAI({
      apiKey: provider.apiKey,
      ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
      fetchOptions: { dispatcher: getDispatcher(this.config, targetUrl) },
    })

    const batches = chunkSegments(segments)
    const translatedSegments: TranslatedSegment[] = []
    const systemPrompt = buildSystemPrompt(sourceLanguage, targetLanguage, strictSync)

    for (let i = 0; i < batches.length; i++) {
      if (signal?.aborted) throw new Error('Pipeline cancelled')
      const batchTranslations = await this.translateBatch(client, batches[i], provider.model, systemPrompt, strictSync)
      translatedSegments.push(...batchTranslations)
      onProgress?.(((i + 1) / batches.length) * 100)
    }

    return { sourceLanguage, targetLanguage, segments: translatedSegments }
  }

  private async translateBatch(
    client: OpenAI,
    segments: TranscriptSegment[],
    model: string,
    systemPrompt: string,
    strictSync = false,
  ): Promise<TranslatedSegment[]> {
    let lastError: unknown

    // In strict sync mode, include duration for each segment so LLM can control translation length
    const userContent = strictSync
      ? JSON.stringify({ segments: segments.map(s => ({ ...s, duration: +(s.end - s.start).toFixed(2) })) })
      : JSON.stringify({ segments })

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await client.chat.completions.create({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        })

        const content = response.choices[0]?.message?.content
        if (typeof content !== 'string' || content.length === 0) {
          throw new Error('Empty translation response from API.')
        }

        return parseAndValidateResponse(content, segments)
      } catch (error) {
        lastError = error
        if (attempt < MAX_RETRIES) {
          await sleep(2 ** (attempt - 1) * 1000)
        }
      }
    }

    throw new Error(
      `Failed to translate batch after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
  }

  async translateText(text: string, targetLanguage: string): Promise<string> {
    const provider = getProviderSettings(this.config)
    const targetUrl = provider.baseURL || 'https://api.openai.com'
    const client = new OpenAI({
      apiKey: provider.apiKey,
      ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
      fetchOptions: { dispatcher: getDispatcher(this.config, targetUrl) },
    })

    try {
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: [
          { role: 'system', content: `Translate the following text into ${targetLanguage}. Return ONLY the translated text, nothing else.` },
          { role: 'user', content: text },
        ],
      })
      return response.choices[0]?.message?.content?.trim() || text
    } catch {
      return text
    }
  }
}
