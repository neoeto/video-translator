import OpenAI from 'openai'
import { ProxyAgent } from 'undici'
import { getConfig } from './config.js'
import type { AppConfig, Segment, TranslatedSegment } from './types.js'

const SYSTEM_PROMPT = `You are a professional English-to-Chinese translator specializing in video content.
Translate each segment naturally and fluently into Chinese.
Return a JSON object with a "translations" array where each element has:
- "en": the original English text (exact copy)
- "cn": the Chinese translation
- "start": the start timestamp (exact copy)
- "end": the end timestamp (exact copy)
Maintain the exact same array order. Handle colloquialisms, slang, and technical terms appropriately.
Do NOT add any extra text, explanations, or notes — only return the JSON.`

// 分批限制 prompt 和响应体大小，降低长视频一次性翻译超出模型上下文或 JSON 截断的概率。
const BATCH_SIZE = 50
const MAX_RETRIES = 3
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

interface TranslationResponseItem {
  en: string
  cn: string
  start: number
  end: number
}

interface TranslationResponse {
  translations: TranslationResponseItem[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunkSegments(segments: Segment[]): Segment[][] {
  const batches: Segment[][] = []

  for (let index = 0; index < segments.length; index += BATCH_SIZE) {
    batches.push(segments.slice(index, index + BATCH_SIZE))
  }

  return batches
}

function isTranslationResponseItem(value: unknown): value is TranslationResponseItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const item = value as Record<string, unknown>

  return (
    typeof item.en === 'string' &&
    typeof item.cn === 'string' &&
    typeof item.start === 'number' &&
    typeof item.end === 'number'
  )
}

function parseAndValidateResponse(
  rawContent: string,
  inputSegments: Segment[]
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

    // 校验原文和时间戳可防止 LLM 重排、合并或改写片段导致字幕与音频错位。
    if (item.en !== segment.text) {
      throw new Error(`Invalid translation response: item at index ${index} does not preserve the original English text.`)
    }

    if (item.start !== segment.start || item.end !== segment.end) {
      throw new Error(`Invalid translation response: item at index ${index} does not preserve timestamps.`)
    }

    return {
      start: item.start,
      end: item.end,
      text: segment.text,
      en: item.en,
      cn: item.cn,
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
    }
  })
}

async function translateBatch(
  client: OpenAI,
  segments: Segment[],
  model: string
): Promise<TranslatedSegment[]> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ segments }) },
        ],
      })

      const content = response.choices[0]?.message?.content

      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('Empty translation response from OpenAI.')
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

export async function translate(
  segments: Segment[],
  config: AppConfig
): Promise<TranslatedSegment[]> {
  getConfig()
  const provider = getProviderSettings(config)
  const client = new OpenAI({
    apiKey: provider.apiKey,
    ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
    ...(config.proxyEnabled && config.proxyUrl ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxyUrl) } } : {}),
  })
  const batches = chunkSegments(segments)
  const translatedSegments: TranslatedSegment[] = []

  for (const batch of batches) {
    const batchTranslations = await translateBatch(client, batch, provider.model)
    translatedSegments.push(...batchTranslations)
  }

  return translatedSegments
}
