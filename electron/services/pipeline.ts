import ffmpeg from 'fluent-ffmpeg'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { extractAudio } from './audio.js'
import { combine } from './combiner.js'
import { getConfig } from './config.js'
import { downloadVideo } from './downloader.js'
import { generateAss } from './subtitle.js'
import { synthesize } from './tts.js'
import { transcribe } from './transcriber.js'
import { translate } from './translator.js'
import type { AppConfig, PipelineStage, PipelineState, Segment, TranslatedSegment } from './types.js'
import { getVideoStorageKey } from './video-key.js'

const require = createRequire(import.meta.url)
const ffprobeStatic = require('ffprobe-static') as { path?: string } | string
const ffprobePath = typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic.path

if (typeof ffprobePath === 'string') {
  ffmpeg.setFfprobePath(ffprobePath)
}

const TOTAL_STEPS = 6

interface VideoDimensions {
  width: number
  height: number
}

interface CachedSegmentsFile<T> {
  fingerprint: string
  segments: T[]
}

interface CachedOutputFile {
  fingerprint: string
  outputPath: string
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return sanitized || 'translated_video'
}

function createFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function isSegment(value: unknown): value is Segment {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.start === 'number' &&
    typeof candidate.end === 'number' &&
    typeof candidate.text === 'string'
  )
}

function isTranslatedSegment(value: unknown): value is TranslatedSegment {
  if (!isSegment(value)) {
    return false
  }

  const candidate = value as { en?: unknown; cn?: unknown }
  return typeof candidate.en === 'string' && typeof candidate.cn === 'string'
}

function isCachedSegmentsFile<T>(
  value: unknown,
  isItem: (candidate: unknown) => candidate is T
): value is CachedSegmentsFile<T> {
  // 缓存来自磁盘 JSON，运行时守卫可避免损坏或旧格式缓存污染后续阶段。
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.fingerprint === 'string' &&
    Array.isArray(candidate.segments) &&
    candidate.segments.every(isItem)
  )
}

function isCachedOutputFile(value: unknown): value is CachedOutputFile {
  // 输出缓存只记录路径，必须先校验结构，后续再确认文件仍然存在。
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.fingerprint === 'string' && typeof candidate.outputPath === 'string'
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

async function readCachedJson<T>(
  filePath: string,
  isValue: (candidate: unknown) => candidate is T
): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return isValue(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function readCachedSegments<T>(
  filePath: string,
  fingerprint: string,
  isItem: (candidate: unknown) => candidate is T
): Promise<T[] | null> {
  const cached = await readCachedJson(filePath, (value): value is CachedSegmentsFile<T> =>
    isCachedSegmentsFile(value, isItem)
  )

  if (!cached || cached.fingerprint !== fingerprint) {
    return null
  }

  return cached.segments
}

async function writeCachedSegments<T>(filePath: string, fingerprint: string, segments: T[]): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify({ fingerprint, segments }, null, 2), 'utf8')
}

async function readCachedOutput(filePath: string, fingerprint: string): Promise<string | null> {
  const cached = await readCachedJson(filePath, isCachedOutputFile)

  if (!cached || cached.fingerprint !== fingerprint) {
    return null
  }

  return (await fileExists(cached.outputPath)) ? cached.outputPath : null
}

async function writeCachedOutput(filePath: string, fingerprint: string, outputPath: string): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify({ fingerprint, outputPath }, null, 2), 'utf8')
}

async function createTranscriptionFingerprint(videoPath: string, config: AppConfig): Promise<string> {
  const stats = await fs.stat(videoPath)

  // 用大小和修改时间近似表示视频内容，避免为缓存校验重新读取大视频计算哈希。
  return createFingerprint({
    size: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
    transcribeMode: config.transcribeMode,
    localWhisperApiUrl: config.localWhisperApiUrl,
    localWhisperCliPath: config.localWhisperCliPath,
  })
}

function getTranslationModel(config: AppConfig): string {
  switch (config.translateMode) {
    case 'deepseek':
      return config.deepseekModel || 'deepseek-chat'
    case 'glm':
      return config.glmModel || 'glm-4-flash'
    case 'openai':
      return config.openaiModel || 'gpt-4o'
  }
}

function createTranslationFingerprint(segments: Segment[], config: AppConfig): string {
  // 翻译缓存绑定转录结果和模型配置，允许转录不变时独立复用翻译阶段。
  return createFingerprint({
    segments,
    translateMode: config.translateMode,
    model: getTranslationModel(config),
  })
}

function createTtsFingerprint(translatedSegments: TranslatedSegment[], config: AppConfig): string {
  // TTS 只依赖译文和合成引擎，独立指纹可让下游失败后跳过昂贵的语音合成。
  return createFingerprint({
    translatedSegments,
    ttsMode: config.ttsMode,
  })
}

function getVideoDimensions(videoPath: string): Promise<VideoDimensions> {
  if (!ffprobePath) {
    return Promise.reject(new Error('ffprobe binary not found'))
  }

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      const videoStream = data.streams.find((stream) => stream.codec_type === 'video')
      const width = videoStream?.width
      const height = videoStream?.height

      if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
        reject(new Error('Unable to determine video dimensions'))
        return
      }

      resolve({ width, height })
    })
  })
}

export class PipelineOrchestrator {
  private state: PipelineState
  private callbacks: Set<(state: PipelineState) => void>
  private cancelled: boolean
  private workDir: string

  constructor() {
    this.state = {
      stage: 'idle',
      progress: 0,
      overallProgress: 0,
    }
    this.callbacks = new Set()
    this.cancelled = false
    this.workDir = ''
  }

  async start(url: string, outputDir: string): Promise<void> {
    this.cancelled = false
    this.workDir = path.join(outputDir, '.tmp', getVideoStorageKey(url))
    const config = getConfig()

    try {
      await fs.mkdir(this.workDir, { recursive: true })

      this.assertNotCancelled()
      const download = await this.runStep('downloading', 0, (onProgress) => downloadVideo(url, outputDir, onProgress))
      this.updateState({ videoTitle: download.title })

      this.assertNotCancelled()
      const audioPath = await this.runStep('extracting', 1, async (onProgress) => {
        const cachedAudioPath = path.join(this.workDir, 'audio.wav')
        if (await fileExists(cachedAudioPath)) {
          onProgress(100)
          return cachedAudioPath
        }

        return extractAudio(download.filePath, this.workDir, onProgress)
      })

      this.assertNotCancelled()
      const segments = await this.runStep('transcribing', 2, async () => {
        const transcriptPath = path.join(this.workDir, 'transcript.json')
        const transcriptFingerprint = await createTranscriptionFingerprint(download.filePath, config)
        const cachedSegments = await readCachedSegments(transcriptPath, transcriptFingerprint, isSegment)
        if (cachedSegments) {
          this.updateProgress(2, 100)
          return cachedSegments
        }

        const result = await transcribe(audioPath, config)
        await writeCachedSegments(transcriptPath, transcriptFingerprint, result)
        this.updateProgress(2, 100)
        return result
      })

      this.assertNotCancelled()
      const translatedSegments = await this.runStep('translating', 3, async () => {
        const translationPath = path.join(this.workDir, 'translated_segments.json')
        const translationFingerprint = createTranslationFingerprint(segments, config)
        const cachedSegments = await readCachedSegments(translationPath, translationFingerprint, isTranslatedSegment)
        if (cachedSegments) {
          this.updateProgress(3, 100)
          return cachedSegments
        }

        const result = await translate(segments, config)
        await writeCachedSegments(translationPath, translationFingerprint, result)
        this.updateProgress(3, 100)
        return result
      })
      this.updateState({ translatedSegments })

      this.assertNotCancelled()
      const cnAudioPath = await this.runStep('synthesizing', 4, async (onProgress) => {
        const ttsCachePath = path.join(this.workDir, 'tts.json')
        const ttsFingerprint = createTtsFingerprint(translatedSegments, config)
        const cachedOutput = await readCachedOutput(ttsCachePath, ttsFingerprint)
        if (cachedOutput) {
          onProgress(100)
          return cachedOutput
        }

        const outputPath = await synthesize(translatedSegments, this.workDir, config, onProgress)
        await writeCachedOutput(ttsCachePath, ttsFingerprint, outputPath)
        return outputPath
      })

      this.assertNotCancelled()
      const outputPath = await this.runStep('recombining', 5, async (onProgress) => {
        const { width, height } = await getVideoDimensions(download.filePath)
        this.assertNotCancelled()

        const assContent = generateAss(translatedSegments, config.subtitleStyle, width, height)
        const subtitlePath = path.join(this.workDir, 'subtitles.ass')
        await fs.writeFile(subtitlePath, assContent, 'utf8')
        this.assertNotCancelled()

        const finalOutputPath = path.join(outputDir, `${sanitizeFileName(download.title)}_translated.mp4`)
        return combine(download.filePath, cnAudioPath, subtitlePath, finalOutputPath, onProgress)
      })

      this.assertNotCancelled()
      this.setState({
        stage: 'completed',
        progress: 100,
        overallProgress: 100,
        videoTitle: download.title,
        outputPath,
        translatedSegments,
      })
    } catch (error) {
      this.setState({
        ...this.state,
        stage: 'error',
        error: toErrorMessage(error),
      })
    }
  }

  cancel(): void {
    this.cancelled = true
  }

  onProgress(callback: (state: PipelineState) => void): () => void {
    this.callbacks.add(callback)
    callback(this.state)

    return () => {
      this.callbacks.delete(callback)
    }
  }

  getState(): PipelineState {
    return { ...this.state }
  }

  private async runStep<T>(
    stage: PipelineStage,
    completedSteps: number,
    operation: (onProgress: (pct: number) => void) => Promise<T>
  ): Promise<T> {
    // 每步开始时先固定已完成步数，当前阶段进度从 0 单独累加到总进度。
    this.updateState({
      stage,
      progress: 0,
      overallProgress: this.calculateOverallProgress(completedSteps, 0),
      error: undefined,
    })

    return operation((pct) => {
      // 子任务只报告本阶段百分比，编排器统一换算，避免各服务感知全局流水线。
      this.updateProgress(completedSteps, pct)
    })
  }

  private updateProgress(completedSteps: number, currentStepProgress: number): void {
    const progress = Math.max(0, Math.min(100, currentStepProgress))
    this.updateState({
      progress,
      overallProgress: this.calculateOverallProgress(completedSteps, progress),
    })
  }

  private calculateOverallProgress(completedSteps: number, currentStepProgress: number): number {
    // 总进度 = 已完成阶段的均分进度 + 当前阶段在 1/TOTAL_STEPS 中的占比。
    return (completedSteps / TOTAL_STEPS) * 100 + currentStepProgress / TOTAL_STEPS
  }

  private assertNotCancelled(): void {
    if (this.cancelled) {
      throw new Error('Pipeline cancelled')
    }
  }

  private updateState(partial: Partial<PipelineState>): void {
    this.setState({ ...this.state, ...partial })
  }

  private setState(state: PipelineState): void {
    this.state = state
    this.notify()
  }

  private notify(): void {
    const snapshot = this.getState()
    for (const callback of this.callbacks) {
      callback(snapshot)
    }
  }
}
