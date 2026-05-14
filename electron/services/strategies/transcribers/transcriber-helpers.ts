import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { TranscriptSegment } from '../../types.js'

const require = createRequire(import.meta.url)
const ffmpegStatic = require('ffmpeg-static') as string | null

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    }
  })
}

export function buildWhisperEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (ffmpegStatic) {
    const ffmpegDir = path.dirname(ffmpegStatic)
    env.PATH = env.PATH ? `${ffmpegDir}${path.delimiter}${env.PATH}` : ffmpegDir
  }
  return env
}

export function runWhisperCli(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: buildWhisperEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const stderrChunks: Buffer[] = []

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code, signal) => {
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
