import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { TranscriptSegment, WordTimestamp } from '../../types.js'

import { resolvePackagedPath } from '../../resolve-packaged-path.js'

const require = createRequire(import.meta.url)
const ffmpegStatic = resolvePackagedPath(require('ffmpeg-static') as string | null)

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeWords(words: unknown): WordTimestamp[] | undefined {
  if (!Array.isArray(words) || words.length === 0) return undefined

  const result: WordTimestamp[] = []
  for (const w of words) {
    if (typeof w !== 'object' || w === null) continue
    const item = w as Record<string, unknown>
    if (typeof item.word !== 'string' || typeof item.start !== 'number' || typeof item.end !== 'number') continue
    result.push({
      word: item.word,
      start: item.start,
      end: item.end,
      score: typeof item.score === 'number' ? item.score : undefined,
      speaker: typeof item.speaker === 'string' ? item.speaker : undefined,
    })
  }
  return result.length > 0 ? result : undefined
}

export function normalizeSegments(segments: unknown): TranscriptSegment[] {
  if (!Array.isArray(segments)) {
    throw new Error('Whisper transcription response did not include segment timestamps.')
  }

  return segments.map((segment, index) => {
    if (typeof segment !== 'object' || segment === null) {
      throw new Error(`Invalid transcription segment at index ${index}.`)
    }

    const item = segment as Record<string, unknown>
    if (typeof item.start !== 'number' || typeof item.end !== 'number' || typeof item.text !== 'string') {
      throw new Error(`Invalid transcription segment at index ${index}.`)
    }

    return {
      start: item.start,
      end: item.end,
      text: item.text,
      speaker: typeof item.speaker === 'string' ? item.speaker : 'SPEAKER_0',
      words: normalizeWords(item.words),
    }
  })
}

// ─── Segment splitting ──────────────────────────────────────────

/**
 * Calculates display width treating CJK characters as 2 and others as 1,
 * providing a rough approximation of on-screen subtitle width.
 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (
      (code >= 0x4E00 && code <= 0x9FFF) ||  // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4DBF) ||  // CJK Extension A
      (code >= 0x3040 && code <= 0x309F) ||  // Hiragana
      (code >= 0x30A0 && code <= 0x30FF) ||  // Katakana
      (code >= 0xAC00 && code <= 0xD7AF) ||  // Hangul Syllables
      (code >= 0xFF01 && code <= 0xFF60) ||  // Fullwidth Forms
      (code >= 0xFE30 && code <= 0xFE4F)     // CJK Compatibility Forms
    ) {
      width += 2
    } else {
      width += 1
    }
  }
  return width
}

// Punctuation marks that serve as natural sentence/clause boundaries
const SPLIT_PUNCTUATION = new Set([
  '。', '！', '？', '，', '、', '；', '：',
  '.', '!', '?', ',', ';', ':',
  '…', '—', '–',
])

const MAX_DISPLAY_WIDTH = 50      // Force split above this (~25 CJK or ~50 Latin chars)
const PREFERRED_DISPLAY_WIDTH = 35 // Prefer splitting at punctuation above this
const MIN_DISPLAY_WIDTH = 10       // Don't create segments shorter than this

/**
 * Splits long transcript segments into shorter ones using word-level timestamps.
 * Falls back to proportional time interpolation when word timestamps are unavailable.
 */
export function splitLongSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = []

  for (const segment of segments) {
    if (displayWidth(segment.text) <= MAX_DISPLAY_WIDTH) {
      // Short enough — strip words and keep as-is
      result.push({ ...segment, words: undefined })
      continue
    }

    const subSegments = segment.words?.length
      ? splitWithWordTimestamps(segment)
      : splitByPunctuation(segment)

    result.push(...subSegments)
  }

  return result
}

/**
 * Splits a segment using precise word-level timestamps from WhisperX.
 */
function splitWithWordTimestamps(segment: TranscriptSegment): TranscriptSegment[] {
  const words = segment.words!
  const results: TranscriptSegment[] = []

  let chunkWords: WordTimestamp[] = []
  let chunkText = ''
  let chunkWidth = 0

  const flushChunk = () => {
    if (chunkWords.length === 0) return
    results.push({
      start: chunkWords[0].start,
      end: chunkWords[chunkWords.length - 1].end,
      text: chunkText.trim(),
      speaker: segment.speaker,
    })
    chunkWords = []
    chunkText = ''
    chunkWidth = 0
  }

  for (const word of words) {
    const wordWidth = displayWidth(word.word)

    // Force split if adding this word would exceed hard limit
    if (chunkWidth > 0 && chunkWidth + wordWidth > MAX_DISPLAY_WIDTH) {
      flushChunk()
    }

    chunkWords.push(word)
    chunkText += word.word
    chunkWidth += wordWidth

    // Split at punctuation if we've accumulated enough text
    const lastChar = word.word[word.word.length - 1]
    if (chunkWidth >= PREFERRED_DISPLAY_WIDTH && SPLIT_PUNCTUATION.has(lastChar)) {
      flushChunk()
    }
  }

  flushChunk()

  // Merge tiny trailing segments into the previous one
  if (results.length > 1) {
    const last = results[results.length - 1]
    if (displayWidth(last.text) < MIN_DISPLAY_WIDTH) {
      const prev = results[results.length - 2]
      prev.end = last.end
      prev.text = prev.text + last.text
      results.pop()
    }
  }

  return results.length > 0 ? results : [{ ...segment, words: undefined }]
}

/**
 * Splits a segment by punctuation when word timestamps are unavailable.
 * Time is interpolated proportionally based on character position.
 */
function splitByPunctuation(segment: TranscriptSegment): TranscriptSegment[] {
  const { text, start, end, speaker } = segment
  const totalDuration = end - start
  const totalChars = text.length

  if (totalChars === 0) return [{ ...segment, words: undefined }]

  // Find all punctuation split points
  const splitPoints: number[] = []
  let currentWidth = 0
  for (let i = 0; i < text.length; i++) {
    currentWidth += displayWidth(text[i])
    if (currentWidth >= PREFERRED_DISPLAY_WIDTH && SPLIT_PUNCTUATION.has(text[i])) {
      splitPoints.push(i + 1)
      currentWidth = 0
    } else if (currentWidth >= MAX_DISPLAY_WIDTH) {
      // Force split even without punctuation
      splitPoints.push(i + 1)
      currentWidth = 0
    }
  }

  if (splitPoints.length === 0) return [{ ...segment, words: undefined }]

  const results: TranscriptSegment[] = []
  let prevIndex = 0

  for (const splitIndex of splitPoints) {
    const chunk = text.slice(prevIndex, splitIndex).trim()
    if (chunk.length === 0) { prevIndex = splitIndex; continue }

    const chunkStart = start + (prevIndex / totalChars) * totalDuration
    const chunkEnd = start + (splitIndex / totalChars) * totalDuration

    results.push({ start: chunkStart, end: chunkEnd, text: chunk, speaker })
    prevIndex = splitIndex
  }

  // Remaining text
  const remaining = text.slice(prevIndex).trim()
  if (remaining.length > 0) {
    const chunkStart = start + (prevIndex / totalChars) * totalDuration
    results.push({ start: chunkStart, end, text: remaining, speaker })
  }

  // Merge tiny trailing segments
  if (results.length > 1) {
    const last = results[results.length - 1]
    if (displayWidth(last.text) < MIN_DISPLAY_WIDTH) {
      const prev = results[results.length - 2]
      prev.end = last.end
      prev.text = prev.text + last.text
      results.pop()
    }
  }

  return results.length > 0 ? results : [{ ...segment, words: undefined }]
}

export function buildWhisperEnv(hfMirrorUrl?: string, proxyUrl?: string, hfHome?: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  // Force Python to flush stdout/stderr immediately so tqdm progress is readable in real-time
  env.PYTHONUNBUFFERED = '1'
  // Force Python to use UTF-8 for stdout/stderr to avoid UnicodeEncodeError on Windows
  // when transcript text contains characters outside the system locale (e.g. Hindi, CJK)
  if (process.platform === 'win32') {
    env.PYTHONIOENCODING = 'utf-8'
  }
  // Set HuggingFace model cache directory so all HF downloads go to a unified location
  if (hfHome) {
    env.HF_HOME = hfHome
  }
  // Set HuggingFace mirror endpoint for model downloads (e.g. https://hf-mirror.com)
  if (hfMirrorUrl) {
    env.HF_ENDPOINT = hfMirrorUrl
  }
  // Forward proxy settings so Python tools (whisper, audio-separator, etc.)
  // can download models through the configured proxy
  if (proxyUrl) {
    env.HTTP_PROXY = proxyUrl
    env.HTTPS_PROXY = proxyUrl
    env.http_proxy = proxyUrl
    env.https_proxy = proxyUrl
  }
  if (ffmpegStatic) {
    const ffmpegDir = path.dirname(ffmpegStatic)
    env.PATH = env.PATH ? `${ffmpegDir}${path.delimiter}${env.PATH}` : ffmpegDir
  }
  return env
}

export function hasHuggingFaceModel(hfHome: string, modelPrefix: string): boolean {
  const hubDir = path.join(hfHome, 'hub')
  try {
    const entries = fs.readdirSync(hubDir)
    return entries.some(e => e.startsWith('models--') && e.includes(modelPrefix))
  } catch {
    return false
  }
}

export function runWhisperCli(
  command: string,
  args: string[],
  cwd: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  hfMirrorUrl?: string,
  proxyUrl?: string,
  hfHome?: string,
  onDetail?: (message: string | undefined) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Pipeline cancelled'))
      return
    }

    const captureStdout = !!onProgress
    const child = spawn(command, args, {
      cwd,
      env: buildWhisperEnv(hfMirrorUrl, proxyUrl, hfHome),
      stdio: ['ignore', captureStdout ? 'pipe' : 'ignore', 'pipe'],
    })
    const stderrChunks: Buffer[] = []

    const onAbort = () => {
      child.kill('SIGTERM')
      reject(new Error('Pipeline cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    if (child.stdout && onProgress) {
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        // WhisperX format: "Progress: 50.00%..."
        const matches = [...text.matchAll(/Progress:\s*([\d.]+)%/g)]
        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1]
          const pct = Math.min(Math.floor(parseFloat(lastMatch[1])), 99)
          if (pct > 0) onProgress(pct)
        }
      })
    }

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)

      const text = chunk.toString('utf8')

      if (onDetail && /downloading/i.test(text)) {
        const fileMatch = text.match(/(?:downloading|Download)\s+["']?([^"'\s]+)/i)
        if (fileMatch) {
          onDetail(`Downloading ${fileMatch[1]}...`)
        }
      }

      if (onProgress) {
        const matches = [...text.matchAll(/(\d{1,3})%(?:\||[\s\r\n])/g)]
        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1]
          const pct = Math.min(parseInt(lastMatch[1], 10), 99)
          if (pct > 0) onProgress(pct)
        }
      }
    })

    child.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })

    child.on('close', (code, signal: NodeJS.Signals | null) => {
      signal // unused in this scope
      onDetail?.(undefined)
      if (code === 0) {
        resolve()
        return
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      const details = stderr ? `: ${stderr}` : signal ? ` with signal ${signal}` : ''
      reject(new Error(`Whisper CLI exited with code ${code ?? 'unknown'}${details}`))
    })
  })
}

export function isRetryableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { status?: number; name?: string; code?: string; message?: string }
  if (candidate.status === 429) return true

  const retryableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'])
  if (candidate.code && retryableCodes.has(candidate.code)) return true

  const name = candidate.name ?? ''
  if (name.includes('RateLimit') || name.includes('Connection') || name.includes('Network')) return true

  const message = candidate.message ?? ''
  return /rate limit|timeout|network|connection reset|fetch failed|socket hang up/i.test(message)
}

export function describeOpenAIError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'Unknown transcription error.'

  const candidate = error as { status?: number; name?: string; message?: string }
  if (candidate.status === 401 || candidate.status === 403 || candidate.name?.includes('Authentication')) {
    return 'OpenAI authentication failed. Check your API key.'
  }
  if (candidate.status === 429 || candidate.name?.includes('RateLimit')) return 'OpenAI rate limit reached.'
  if (candidate.name?.includes('Connection') || candidate.name?.includes('Network')) return 'Network error while calling OpenAI.'
  return candidate.message ?? 'Transcription failed.'
}
