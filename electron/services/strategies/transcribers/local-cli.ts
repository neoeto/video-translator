import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig, TranscriberStrategy, TranscriptionResult } from '../../types.js'
import { getModelDirs } from '../../config.js'
import { hasHuggingFaceModel, normalizeSegments, runWhisperCli } from './transcriber-helpers.js'

interface WhisperCliJsonResponse {
  segments?: unknown
}

export default class LocalCliTranscriber implements TranscriberStrategy {
  readonly name = 'local-cli'

  constructor(private readonly config: AppConfig) {}

  async transcribe(input: { audioPath: string; onProgress?: (pct: number) => void; onDetail?: (message: string | undefined) => void; signal?: AbortSignal }): Promise<TranscriptionResult> {
    const { audioPath, onProgress, onDetail, signal } = input
    const whisperPath = path.resolve(this.config.localWhisperCliPath)
    const outputDir = path.dirname(audioPath)

    try {
      const modelDirs = getModelDirs(this.config.outputDir)
      const hfHome = modelDirs.huggingfaceModelDir || undefined
      const modelMissing = hfHome && !hasHuggingFaceModel(hfHome, 'whisper')
      const detailCb = modelMissing
        ? (msg: string | undefined) => onDetail?.(msg)
        : undefined

      if (modelMissing) {
        onProgress?.(2)
        onDetail?.('Downloading Whisper base model...')
      }

      onProgress?.(10)
      await runWhisperCli(
        whisperPath,
        [
          audioPath,
          '--model', 'base',
          '--language', 'en',
          '--output_format', 'json',
          '--output_dir', outputDir,
        ],
        outputDir,
        onProgress,
        signal,
        this.config.hfMirrorEnabled ? this.config.hfMirrorUrl : undefined,
        this.config.proxyEnabled ? this.config.proxyUrl : undefined,
        hfHome,
        detailCb,
      )

      const expectedName = `${path.parse(audioPath).name}.json`
      const parsedPath = path.join(outputDir, expectedName)

      if (!fs.existsSync(parsedPath)) {
        const outputContents = await fs.promises.readdir(outputDir).catch(() => [] as string[])
        const foundFiles = outputContents.length > 0
          ? ` Found: ${outputContents.join(', ')}`
          : ' No files found in output directory.'
        throw new Error(
          `Whisper CLI did not produce expected output file "${expectedName}" in ${outputDir}.${foundFiles}` +
            `\nWhisper path: ${whisperPath}\nAudio path: ${audioPath}`
        )
      }

      const rawContent = await fs.promises.readFile(parsedPath, 'utf8')
      const parsed = JSON.parse(rawContent) as WhisperCliJsonResponse
      const segments = normalizeSegments(parsed.segments)

      onProgress?.(100)
      return { language: 'en', segments }
    } catch (error) {
      if (typeof error === 'object' && error !== null) {
        const candidate = error as { code?: string; message?: string }
        if (candidate.code === 'ENOENT') {
          throw new Error(`Whisper CLI not found at "${whisperPath}". Please configure the correct path in Settings.`)
        }
        if (candidate.message) {
          throw new Error(`Whisper CLI failed: ${candidate.message}`)
        }
      }
      throw error
    }
  }
}
