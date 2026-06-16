import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildWhisperEnv } from './transcribers/transcriber-helpers.js'
import { ensureAudioSeparatorModel } from '../model-downloader.js'

const DEFAULT_MODEL = 'model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt'

export async function separateVocals(input: {
  audioPath: string
  workDir: string
  audioSeparatorPath: string
  modelDir: string
  hfMirrorUrl?: string
  proxyUrl?: string
  hfHome?: string
  onProgress?: (pct: number) => void
  onDetail?: (key: string | undefined, params?: Record<string, string>) => void
  signal?: AbortSignal
}): Promise<{ instrumentalPath: string }> {
  const { audioPath, workDir, audioSeparatorPath, modelDir, hfMirrorUrl, proxyUrl, hfHome, onProgress, onDetail, signal } = input
  const resolvedPath = path.resolve(audioSeparatorPath)

  await fs.mkdir(workDir, { recursive: true })
  await fs.mkdir(modelDir, { recursive: true })

  // Pre-download model with CDN fallback (maps 0-8% to download, 8-100% to audio-separator)
  await ensureAudioSeparatorModel(modelDir, proxyUrl, (downloadPct) => {
    if (!signal?.aborted) onProgress?.(Math.round(downloadPct * 0.08))
  }, onDetail)

  if (signal?.aborted) throw new Error('Pipeline cancelled')

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Pipeline cancelled'))
      return
    }

    const args = [
      audioPath,
      '--model_filename', DEFAULT_MODEL,
      '--output_dir', workDir,
    ]

    const env = buildWhisperEnv(hfMirrorUrl, proxyUrl, hfHome)
    env.AUDIO_SEPARATOR_MODEL_DIR = modelDir

    const proc = spawn(resolvedPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    let stderr = ''

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      const match = chunk.toString().match(/(\d+)%/)
      if (match) {
        onProgress?.(Math.min(99, parseInt(match[1], 10)))
      }
    })

    proc.stdout.on('data', (chunk: Buffer) => {
      const match = chunk.toString().match(/(\d+)%/)
      if (match) {
        onProgress?.(Math.min(99, parseInt(match[1], 10)))
      }
    })

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          `audio-separator not found at "${resolvedPath}". ` +
          `Install with: pip install "audio-separator[cpu]" and configure the path in Settings.`
        ))
      } else {
        reject(err)
      }
    })

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(
          `audio-separator exited with code ${code}.\n${stderr.slice(-2000)}`
        ))
      }
    })

    const onAbort = () => {
      proc.kill('SIGTERM')
      reject(new Error('Pipeline cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

  // Find the instrumental output file
  const files = await fs.readdir(workDir)
  const instrumentalFile = files.find(f => f.includes('(Instrumental)'))

  if (!instrumentalFile) {
    const outputFiles = files.length > 0 ? ` Found: ${files.join(', ')}` : ' No files found.'
    throw new Error(
      `audio-separator did not produce an instrumental track in ${workDir}.${outputFiles}`
    )
  }

  onProgress?.(100)
  return { instrumentalPath: path.join(workDir, instrumentalFile) }
}
