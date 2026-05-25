import ffmpeg from 'fluent-ffmpeg'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { getConfig } from './config.js'
import { generateAss } from './subtitle.js'
import { extractSpeakerSamples } from './speaker-sample.js'
import { separateVocals } from './strategies/vocal-separator.js'
import type { AppConfig, PipelineStage, PipelineState, PipelineStrategies, SpeakerProfile, TranscriptSegment, TranslatedSegment, VideoSourceType } from './types.js'
import { getLanguageDisplayName } from './types.js'
import { getVideoStorageKey } from './video-key.js'

import { resolvePackagedPath } from './resolve-packaged-path.js'

const require = createRequire(import.meta.url)
const ffprobeStatic = require('ffprobe-static') as { path?: string } | string
const ffprobePath = resolvePackagedPath(typeof ffprobeStatic === 'string' ? ffprobeStatic : ffprobeStatic.path)

if (typeof ffprobePath === 'string') {
  ffmpeg.setFfprobePath(ffprobePath)
}

const TOTAL_STEPS_FULL = 6
const TOTAL_STEPS_SUBTITLE_ONLY = 5
const TOTAL_STEPS_VOCAL_REMOVAL = 7

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

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.start === 'number' &&
    typeof candidate.end === 'number' &&
    typeof candidate.text === 'string' &&
    typeof candidate.speaker === 'string'
  )
}

function isTranslatedSegment(value: unknown): value is TranslatedSegment {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.start === 'number' &&
    typeof candidate.end === 'number' &&
    typeof candidate.sourceText === 'string' &&
    typeof candidate.targetText === 'string' &&
    typeof candidate.speaker === 'string'
  )
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
    whisperxPath: config.whisperxPath,
    whisperxHfToken: config.whisperxHfToken,
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

function createTranslationFingerprint(segments: TranscriptSegment[], config: AppConfig): string {
  return createFingerprint({
    segments,
    translateMode: config.translateMode,
    model: getTranslationModel(config),
    syncMode: config.syncMode,
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
  })
}

function createTtsFingerprint(translatedSegments: TranslatedSegment[], config: AppConfig, speakerProfiles?: SpeakerProfile[]): string {
  return createFingerprint({
    translatedSegments,
    ttsMode: config.ttsMode,
    syncMode: config.syncMode,
    speakerProfiles: speakerProfiles?.map(p => ({ id: p.id, gender: p.gender })),
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

function getVideoDuration(videoPath: string): Promise<number> {
  if (!ffprobePath) {
    return Promise.resolve(0)
  }

  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (error, data) => {
      if (error || !data?.format?.duration) {
        resolve(0)
        return
      }
      resolve(data.format.duration)
    })
  })
}

function generateThumbnail(videoPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        timemarks: ['00:00:03'],
        folder: path.dirname(outputPath),
        filename: path.basename(outputPath),
        size: '640x?',
      })
      .on('end', () => resolve())
      .on('error', () => resolve()) // Non-critical: silently skip if thumbnail fails
  })
}

export class PipelineOrchestrator {
  private state: PipelineState
  private callbacks: Set<(state: PipelineState) => void>
  private cancelled: boolean
  private abortController: AbortController | null
  private workDir: string
  private totalSteps: number
  private speakerLabelsResolver: ((profiles: SpeakerProfile[]) => void) | null

  constructor(private readonly strategies: PipelineStrategies) {
    this.state = {
      stage: 'idle',
      progress: 0,
      overallProgress: 0,
    }
    this.callbacks = new Set()
    this.cancelled = false
    this.abortController = null
    this.workDir = ''
    this.totalSteps = TOTAL_STEPS_FULL
    this.speakerLabelsResolver = null
  }

  async start(url: string, outputDir: string, sourceType: VideoSourceType = 'youtube'): Promise<void> {
    this.cancelled = false
    this.abortController = new AbortController()
    this.workDir = path.join(outputDir, '.tmp', getVideoStorageKey(url, sourceType))
    const config = getConfig()
    const isSubtitleOnly = config.pipelineMode === 'subtitleOnly'
    const useVocalRemoval = !isSubtitleOnly && config.audioMixMode === 'mix-vocal-removal'
    this.totalSteps = isSubtitleOnly
      ? TOTAL_STEPS_SUBTITLE_ONLY
      : useVocalRemoval ? TOTAL_STEPS_VOCAL_REMOVAL : TOTAL_STEPS_FULL

    try {
      await fs.mkdir(this.workDir, { recursive: true })

      this.assertNotCancelled()
      const download = await this.runStep('downloading', 0, (onProgress, signal) =>
        this.strategies.downloader.download({ url, outputDir, onProgress, signal })
      )
      this.updateState({ videoTitle: download.title, sourceType })

      const duration = await getVideoDuration(download.videoPath)
      if (duration > 0) {
        this.updateState({ duration })
      }

      // Generate thumbnail from source video for progress display
      const thumbnailPath = path.join(this.workDir, 'thumbnail.jpg')
      await generateThumbnail(download.videoPath, thumbnailPath)
      try {
        const buf = await fs.readFile(thumbnailPath)
        this.updateState({ thumbnailDataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` })
      } catch {
        // Non-critical
      }

      this.assertNotCancelled()
      const audioPath = await this.runStep('extracting', 1, async (onProgress, signal) => {
        const cachedAudioPath = path.join(this.workDir, 'audio.wav')
        if (await fileExists(cachedAudioPath)) {
          onProgress(100)
          return cachedAudioPath
        }

        const result = await this.strategies.extractor.extract({
          videoPath: download.videoPath,
          outputDir: this.workDir,
          onProgress,
          signal,
        })
        return result.audioPath
      })

      this.assertNotCancelled()
      const transcription = await this.runStep('transcribing', 2, async (onProgress, signal) => {
        const transcriptPath = path.join(this.workDir, 'transcript.json')
        const transcriptFingerprint = await createTranscriptionFingerprint(download.videoPath, config)
        const cachedSegments = await readCachedSegments(transcriptPath, transcriptFingerprint, isTranscriptSegment)
        if (cachedSegments) {
          this.updateProgress(2, 100)
          return cachedSegments
        }

        const result = await this.strategies.transcriber.transcribe({ audioPath, onProgress, signal })
        await writeCachedSegments(transcriptPath, transcriptFingerprint, result.segments)
        this.updateProgress(2, 100)
        return result.segments
      })

      this.assertNotCancelled()

      // Speaker labeling pause: skip for subtitle-only mode or voice-cloning synthesizers
      let speakerProfiles: SpeakerProfile[] | undefined
      const needsSpeakerLabeling = !isSubtitleOnly && !this.strategies.synthesizer.supportsVoiceCloning
      if (!isSubtitleOnly) {
        // Always extract samples (needed for voice cloning too)
        const profilesCachePath = path.join(this.workDir, 'speaker-profiles.json')
        const cachedProfiles = await this.loadSpeakerProfiles(profilesCachePath, transcription)

        if (cachedProfiles) {
          speakerProfiles = cachedProfiles
        } else {
          const profiles = await extractSpeakerSamples(audioPath, transcription, this.workDir)

          if (needsSpeakerLabeling) {
            // Pause for user to assign gender labels (Edge TTS, OpenAI TTS)
            this.updateState({
              stage: 'awaiting-speaker-labels',
              progress: 0,
              speakerProfiles: profiles,
            })
            speakerProfiles = await new Promise<SpeakerProfile[]>((resolve) => {
              this.speakerLabelsResolver = resolve
            })
            this.speakerLabelsResolver = null
          } else {
            // Voice cloning: use samples directly without user labeling
            speakerProfiles = profiles
          }

          await this.saveSpeakerProfiles(profilesCachePath, transcription, speakerProfiles)
        }
        this.assertNotCancelled()
      }

      const translationResult = await this.runStep('translating', 3, async (onProgress, signal) => {
        const translationPath = path.join(this.workDir, 'translated_segments.json')
        const translationFingerprint = createTranslationFingerprint(transcription, config)
        const cachedSegments = await readCachedSegments(translationPath, translationFingerprint, isTranslatedSegment)
        if (cachedSegments) {
          this.updateProgress(3, 100)
          return cachedSegments
        }

        // sourceLanguage 为 'auto' 时让 LLM 自动检测源语言，否则使用用户指定值。
        const resolvedSource = config.sourceLanguage === 'auto'
          ? undefined
          : getLanguageDisplayName(config.sourceLanguage)
        const resolvedTarget = getLanguageDisplayName(config.targetLanguage)

        const result = await this.strategies.translator.translate({
          segments: transcription,
          sourceLanguage: resolvedSource ?? 'auto',
          targetLanguage: resolvedTarget,
          onProgress,
          signal,
          syncMode: config.syncMode,
        })
        await writeCachedSegments(translationPath, translationFingerprint, result.segments)
        this.updateProgress(3, 100)
        return result.segments
      })
      this.updateState({ translatedSegments: translationResult })

      // Translate video title (non-blocking, best effort)
      if (download.title && this.strategies.translator.translateText) {
        const resolvedTarget = getLanguageDisplayName(config.targetLanguage)
        try {
          const translatedTitle = await this.strategies.translator.translateText(download.title, resolvedTarget)
          this.updateState({ translatedTitle })
        } catch {
          // Non-critical: keep original title
        }
      }

      // Generate video summary from transcript (non-blocking, best effort)
      if (this.strategies.translator.summarizeText && translationResult.length > 0) {
        const resolvedTarget = getLanguageDisplayName(config.targetLanguage)
        try {
          const transcriptText = translationResult.map(s => s.sourceText).join(' ')
          const truncated = transcriptText.length > 2000 ? transcriptText.slice(0, 2000) : transcriptText
          const summary = await this.strategies.translator.summarizeText(truncated, resolvedTarget)
          if (summary) {
            this.updateState({ summary })
          }
        } catch {
          // Non-critical: skip summary
        }
      }

      let subtitleSegments = translationResult
      let synthesizedAudioPath: string | undefined

      if (isSubtitleOnly) {
        // Subtitle-only mode: skip TTS, use original translation timestamps
        subtitleSegments = translationResult
      } else {
        // Full translation mode: synthesize TTS audio
        this.assertNotCancelled()
        const synthesisResult = await this.runStep('synthesizing', 4, async (onProgress, signal) => {
          const ttsCachePath = path.join(this.workDir, 'tts.json')
          const ttsFingerprint = createTtsFingerprint(translationResult, config, speakerProfiles)
          const cachedOutput = await readCachedOutput(ttsCachePath, ttsFingerprint)
          if (cachedOutput) {
            onProgress(100)
            return { audioPath: cachedOutput, segmentTimings: translationResult.map(s => ({ start: s.start, end: s.end, actualDuration: s.end - s.start })) }
          }

          const speakers = [...new Set(translationResult.map((s) => s.speaker))]
          const result = await this.strategies.synthesizer.synthesize({
            segments: translationResult,
            workDir: this.workDir,
            speakers,
            speakerProfiles,
            onProgress,
            signal,
            syncMode: config.syncMode,
          })
          await writeCachedOutput(ttsCachePath, ttsFingerprint, result.audioPath)
          return result
        })

        synthesizedAudioPath = synthesisResult.audioPath

        // In natural mode, adjust subtitle timestamps to match actual TTS audio timing
        subtitleSegments = config.syncMode === 'natural' && synthesisResult.segmentTimings.length === translationResult.length
          ? translationResult.map((seg, i) => ({
              ...seg,
              start: synthesisResult.segmentTimings[i].start,
              end: synthesisResult.segmentTimings[i].end,
            }))
          : translationResult
      }

      let instrumentalPath: string | undefined
      if (!isSubtitleOnly && config.audioMixMode === 'mix-vocal-removal') {
        this.assertNotCancelled()
        instrumentalPath = await this.runStep('separating-vocals', 5, async (onProgress, signal) => {
          const result = await separateVocals({
            audioPath,
            workDir: this.workDir,
            audioSeparatorPath: config.audioSeparatorPath,
            onProgress,
            signal,
          })
          return result.instrumentalPath
        })
      }

      const recombineStep = isSubtitleOnly ? 4 : (config.audioMixMode === 'mix-vocal-removal' ? 6 : 5)
      this.assertNotCancelled()
      const outputPath = await this.runStep('recombining', recombineStep, async (onProgress, signal) => {
        const { width, height } = await getVideoDimensions(download.videoPath)
        this.assertNotCancelled()

        const assContent = generateAss(subtitleSegments, config.subtitleStyle, width, height)
        const subtitlePath = path.join(this.workDir, 'subtitles.ass')
        await fs.writeFile(subtitlePath, assContent, 'utf8')
        this.assertNotCancelled()

        const suffix = isSubtitleOnly ? '_subtitled' : '_translated'
        const finalOutputPath = path.join(outputDir, `${sanitizeFileName(download.title)}${suffix}.mp4`)
        const result = await this.strategies.combiner.combine({
          videoPath: download.videoPath,
          audioPath: synthesizedAudioPath,
          subtitlePath,
          outputPath: finalOutputPath,
          onProgress,
          signal,
          speechSegments: config.audioMixMode === 'mix-gate' && !isSubtitleOnly
            ? subtitleSegments.map(s => ({ start: s.start, end: s.end }))
            : undefined,
          instrumentalPath,
        })
        return result.outputPath
      })

      this.assertNotCancelled()
      this.updateState({
        stage: 'completed',
        progress: 100,
        overallProgress: 100,
        videoTitle: download.title,
        outputPath,
        completedAt: Date.now(),
        translatedSegments: translationResult,
        sourceType,
      })
    } catch (error) {
      if (this.cancelled) {
        this.setState({
          stage: 'idle',
          progress: 0,
          overallProgress: 0,
        })
      } else {
        this.setState({
          ...this.state,
          stage: 'error',
          error: toErrorMessage(error),
        })
      }
    }
  }

  cancel(): void {
    this.cancelled = true
    this.abortController?.abort()
  }

  submitSpeakerLabels(profiles: SpeakerProfile[]): void {
    if (this.speakerLabelsResolver) {
      this.speakerLabelsResolver(profiles)
    }
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

  private async loadSpeakerProfiles(
    cachePath: string,
    segments: TranscriptSegment[]
  ): Promise<SpeakerProfile[] | null> {
    try {
      const raw = await fs.readFile(cachePath, 'utf8')
      const cached = JSON.parse(raw) as { fingerprint: string; profiles: SpeakerProfile[] }
      const speakers = [...new Set(segments.map((s) => s.speaker))].sort()
      const fingerprint = createFingerprint(speakers)
      if (cached.fingerprint === fingerprint && Array.isArray(cached.profiles) && cached.profiles.length > 0) {
        return cached.profiles
      }
    } catch {
      // No cache or invalid
    }
    return null
  }

  private async saveSpeakerProfiles(
    cachePath: string,
    segments: TranscriptSegment[],
    profiles: SpeakerProfile[]
  ): Promise<void> {
    const speakers = [...new Set(segments.map((s) => s.speaker))].sort()
    const fingerprint = createFingerprint(speakers)
    // Strip sampleDataUrl to avoid saving large base64 data
    const stripped = profiles.map(({ sampleDataUrl: _, ...rest }) => rest)
    await fs.writeFile(cachePath, JSON.stringify({ fingerprint, profiles: stripped }, null, 2), 'utf8')
  }

  private async runStep<T>(
    stage: PipelineStage,
    completedSteps: number,
    operation: (onProgress: (pct: number) => void, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    // 每步开始时先固定已完成步数，当前阶段进度从 0 单独累加到总进度。
    this.updateState({
      stage,
      progress: 0,
      overallProgress: this.calculateOverallProgress(completedSteps, 0),
      error: undefined,
    })

    const signal = this.abortController!.signal
    return operation((pct) => {
      // 子任务只报告本阶段百分比，编排器统一换算，避免各服务感知全局流水线。
      this.updateProgress(completedSteps, pct)
    }, signal)
  }

  private updateProgress(completedSteps: number, currentStepProgress: number): void {
    const progress = Math.max(0, Math.min(100, currentStepProgress))
    this.updateState({
      progress,
      overallProgress: this.calculateOverallProgress(completedSteps, progress),
    })
  }

  private calculateOverallProgress(completedSteps: number, currentStepProgress: number): number {
    // 总进度 = 已完成阶段的均分进度 + 当前阶段在 1/totalSteps 中的占比。
    return (completedSteps / this.totalSteps) * 100 + currentStepProgress / this.totalSteps
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
