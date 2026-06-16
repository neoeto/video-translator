import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig, TranscriberStrategy, TranscriptionResult } from '../../types.js'
import { getModelDirs } from '../../config.js'
import { hasHuggingFaceModel, normalizeSegments, runWhisperCli } from './transcriber-helpers.js'

interface WhisperXJsonResponse {
  segments?: unknown
}

export default class WhisperXTranscriber implements TranscriberStrategy {
  readonly name = 'whisperx'

  constructor(private readonly config: AppConfig) {}

  async transcribe(input: { audioPath: string; onProgress?: (pct: number) => void; onDetail?: (key: string | undefined, params?: Record<string, string>) => void; signal?: AbortSignal }): Promise<TranscriptionResult> {
    const { audioPath, onProgress, onDetail, signal } = input
    const whisperxPath = path.resolve(this.config.whisperxPath)
    const outputDir = path.dirname(audioPath)

    try {
      const modelDirs = getModelDirs(this.config.outputDir)
      const hfHome = modelDirs.huggingfaceModelDir || undefined
      const modelMissing = hfHome && !hasHuggingFaceModel(hfHome, 'whisper')
      const detailCb = modelMissing
        ? (key: string | undefined, params?: Record<string, string>) => onDetail?.(key, params)
        : undefined

      // Map config sourceLanguage to whisperx --language flag
      const whisperLang = this.config.sourceLanguage === 'auto' ? undefined : this.config.sourceLanguage
      const args = [
        audioPath,
        '--model', 'large-v3',
        '--diarize',
        ...(whisperLang ? ['--language', whisperLang] : []),
        '--output_format', 'json',
        '--output_dir', outputDir,
        '--print_progress', 'True',
      ]

      if (this.config.whisperxHfToken.trim()) {
        args.push('--hf_token', this.config.whisperxHfToken.trim())
      }

      if (modelMissing) {
        onProgress?.(2)
        onDetail?.('progress.download.whisperxLarge')
      }

      onProgress?.(10)
      await runWhisperCli(whisperxPath, args, outputDir, onProgress, signal,
        this.config.hfMirrorEnabled ? this.config.hfMirrorUrl : undefined,
        this.config.proxyEnabled ? this.config.proxyUrl : undefined,
        hfHome,
        detailCb)

      const expectedName = `${path.parse(audioPath).name}.json`
      const parsedPath = path.join(outputDir, expectedName)

      if (!fs.existsSync(parsedPath)) {
        const outputContents = await fs.promises.readdir(outputDir).catch(() => [] as string[])
        const foundFiles = outputContents.length > 0
          ? ` Found: ${outputContents.join(', ')}`
          : ' No files found in output directory.'
        throw new Error(
          `WhisperX CLI did not produce expected output file "${expectedName}" in ${outputDir}.${foundFiles}` +
            `\nWhisperX path: ${whisperxPath}\nAudio path: ${audioPath}`
        )
      }

      const rawContent = await fs.promises.readFile(parsedPath, 'utf8')
      const parsed = JSON.parse(rawContent) as WhisperXJsonResponse
      const segments = normalizeSegments(parsed.segments)

      onProgress?.(100)
      return { language: whisperLang || 'auto', segments }
    } catch (error) {
      if (typeof error === 'object' && error !== null) {
        const candidate = error as { code?: string; message?: string }
        if (candidate.code === 'ENOENT') {
          throw new Error(`WhisperX CLI not found at "${whisperxPath}". Please configure the correct path in Settings.`)
        }
        if (candidate.message) {
          throw new Error(`WhisperX CLI failed: ${candidate.message}`)
        }
      }
      throw error
    }
  }
}
