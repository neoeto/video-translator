# Pipeline 插件化架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the video-translator pipeline from ad-hoc function calls to a strategy-pattern plugin architecture with typed data contracts between all 6 pipeline nodes.

**Architecture:** Each pipeline node is defined by a strategy interface with standardized input/output types. Factory functions create concrete implementations based on AppConfig. The pipeline orchestrator depends only on strategy interfaces — never on concrete implementations. Speaker-to-voice mapping is encapsulated within TTS strategy implementations.

**Tech Stack:** TypeScript, Electron, fluent-ffmpeg, OpenAI SDK, edge-tts CLI, yt-dlp

---

## File Map

### New files to create

| File | Purpose |
|------|---------|
| `electron/services/strategies/downloaders/yt-dlp.ts` | yt-dlp downloader strategy |
| `electron/services/strategies/extractors/ffmpeg.ts` | FFmpeg audio extractor strategy |
| `electron/services/strategies/transcribers/openai-api.ts` | OpenAI Whisper API + local-api transcriber |
| `electron/services/strategies/transcribers/local-cli.ts` | Local Whisper CLI transcriber |
| `electron/services/strategies/transcribers/whisperx.ts` | WhisperX CLI transcriber |
| `electron/services/strategies/translators/openai-compatible.ts` | OpenAI-compatible LLM translator (handles openai/deepseek/glm) |
| `electron/services/strategies/synthesizers/edge-tts.ts` | Edge TTS synthesizer strategy |
| `electron/services/strategies/synthesizers/openai-tts.ts` | OpenAI TTS synthesizer strategy |
| `electron/services/strategies/synthesizers/indextts.ts` | IndexTTS synthesizer strategy |
| `electron/services/strategies/combiners/ffmpeg.ts` | FFmpeg video combiner strategy |
| `electron/services/factories.ts` | All factory functions + `createPipelineStrategies` |

### Files to modify

| File | Changes |
|------|---------|
| `electron/services/types.ts` | Replace old types with new contracts + strategy interfaces |
| `electron/services/pipeline.ts` | Refactor to use `PipelineStrategies`, remove direct imports |
| `electron/services/subtitle.ts` | Accept `TranslationResult` instead of old `TranslatedSegment[]` |
| `electron/main.ts` | Create strategies via factory, pass to orchestrator |
| `src/types.ts` | Mirror new `TranslatedSegment` type for frontend |
| `src/components/ResultView.tsx` | Use `sourceText`/`targetText` instead of `en`/`cn` |

### Files to delete (after extraction)

| File | Reason |
|------|--------|
| `electron/services/downloader.ts` | Extracted to `strategies/downloaders/yt-dlp.ts` |
| `electron/services/audio.ts` | Extracted to `strategies/extractors/ffmpeg.ts` |
| `electron/services/transcriber.ts` | Extracted to `strategies/transcribers/*` |
| `electron/services/translator.ts` | Extracted to `strategies/translators/*` |
| `electron/services/tts.ts` | Extracted to `strategies/synthesizers/*` |
| `electron/services/combiner.ts` | Extracted to `strategies/combiners/ffmpeg.ts` |

### DRY note on translators

The spec lists separate files for openai/deepseek/glm translators. In practice all three use the identical OpenAI SDK with different `baseURL`/`apiKey`/`model`. Creating three files with duplicated logic violates DRY. This plan uses a single `openai-compatible.ts` with the factory function supplying different provider configs. Similarly, the `openai` and `local-api` transcribers share the same OpenAI SDK code (different baseURL), so they live in one `openai-api.ts`.

---

### Task 1: Rewrite types.ts — data contracts & strategy interfaces

**Files:**
- Modify: `electron/services/types.ts`

This is the foundation. All other tasks depend on these types compiling correctly.

- [ ] **Step 1: Replace the data types and add strategy interfaces**

Replace the entire content of `electron/services/types.ts` with:

```typescript
// ─── Pipeline stages ─────────────────────────────────────────────

export type PipelineStage =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'translating'
  | 'synthesizing'
  | 'recombining'
  | 'completed'
  | 'error'

// ─── Node data contracts ────────────────────────────────────────

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  speaker: string
  confidence?: number
}

export interface TranscriptionResult {
  language: string
  segments: TranscriptSegment[]
}

export interface TranslatedSegment {
  start: number
  end: number
  sourceText: string
  targetText: string
  speaker: string
}

export interface TranslationResult {
  sourceLanguage: string
  targetLanguage: string
  segments: TranslatedSegment[]
}

export interface DownloadResult {
  videoPath: string
  title: string
}

export interface AudioResult {
  audioPath: string
}

export interface SynthesisResult {
  audioPath: string
}

export interface CombineResult {
  outputPath: string
}

// ─── Strategy interfaces ────────────────────────────────────────

export interface DownloaderStrategy {
  readonly name: string
  download(input: {
    url: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<DownloadResult>
}

export interface AudioExtractorStrategy {
  readonly name: string
  extract(input: {
    videoPath: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<AudioResult>
}

export interface TranscriberStrategy {
  readonly name: string
  transcribe(input: {
    audioPath: string
  }): Promise<TranscriptionResult>
}

export interface TranslatorStrategy {
  readonly name: string
  translate(input: {
    segments: TranscriptSegment[]
    sourceLanguage: string
    targetLanguage: string
  }): Promise<TranslationResult>
}

export interface SynthesizerStrategy {
  readonly name: string
  synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    onProgress: (pct: number) => void
  }): Promise<SynthesisResult>
}

export interface CombinerStrategy {
  readonly name: string
  combine(input: {
    videoPath: string
    audioPath: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
  }): Promise<CombineResult>
}

export interface PipelineStrategies {
  downloader: DownloaderStrategy
  extractor: AudioExtractorStrategy
  transcriber: TranscriberStrategy
  translator: TranslatorStrategy
  synthesizer: SynthesizerStrategy
  combiner: CombinerStrategy
}

// ─── Pipeline state (shared with frontend via IPC) ──────────────

export interface PipelineState {
  stage: PipelineStage
  progress: number
  overallProgress: number
  videoTitle?: string
  error?: string
  outputPath?: string
  translatedSegments?: TranslatedSegment[]
}

// ─── Subtitle style ─────────────────────────────────────────────

export interface SubtitleStyle {
  enFontSize: number
  cnFontSize: number
  enColor: string
  cnColor: string
  enPosition: 'top' | 'bottom'
  cnPosition: 'top' | 'bottom'
  bgColor: string
  bgOpacity: number
  fontFamily: string
}

// ─── Config types ───────────────────────────────────────────────

export type TranscribeMode = 'openai' | 'local-api' | 'local-cli' | 'whisperx'
export type TranslateMode = 'openai' | 'deepseek' | 'glm'
export type TtsMode = 'edge' | 'openai' | 'indextts'
export type Locale = 'en' | 'zh'

export interface ProxyConfig {
  enabled: boolean
  url: string
}

export interface AppConfig {
  locale: Locale
  openaiApiKey: string
  outputDir: string
  subtitleStyle: SubtitleStyle
  proxyEnabled: boolean
  proxyUrl: string
  transcribeMode: TranscribeMode
  localWhisperApiUrl: string
  localWhisperCliPath: string
  whisperxPath: string
  whisperxHfToken: string
  translateMode: TranslateMode
  openaiModel: string
  deepseekApiKey: string
  deepseekModel: string
  glmApiKey: string
  glmModel: string
  ttsMode: TtsMode
  indexttsApiUrl: string
  indexttsReferenceAudio: string
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd electron && npx tsc --noEmit -p ../tsconfig.node.json 2>&1 | head -30`

Expected: errors from files still using old types (pipeline.ts, translator.ts, etc.) — this is expected and will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```
feat: rewrite types.ts with new data contracts and strategy interfaces
```

---

### Task 2: Create downloader strategy

**Files:**
- Create: `electron/services/strategies/downloaders/yt-dlp.ts`
- Delete: `electron/services/downloader.ts` (after extraction)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p electron/services/strategies/downloaders
mkdir -p electron/services/strategies/extractors
mkdir -p electron/services/strategies/transcribers
mkdir -p electron/services/strategies/translators
mkdir -p electron/services/strategies/synthesizers
mkdir -p electron/services/strategies/combiners
```

- [ ] **Step 2: Create yt-dlp.ts**

Move all code from `electron/services/downloader.ts` into `electron/services/strategies/downloaders/yt-dlp.ts`. Wrap it in a class implementing `DownloaderStrategy`.

Key changes:
- The exported function `downloadVideo(url, outputDir, onProgress)` becomes the `download()` method on the class
- The `getConfig()` calls inside `downloadVideo` need to be replaced — proxy URL is injected at construction time
- Return type changes from `{ filePath, title }` to `DownloadResult` (`{ videoPath, title }` — rename `filePath` to `videoPath`)
- Import types from `../../../services/types.js` (adjust relative path)

```typescript
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { DownloaderStrategy, DownloadResult, ProxyConfig } from '../../types.js'
import { getVideoStorageKey } from '../../video-key.js'

const require = createRequire(import.meta.url)
const ffmpegStaticPath = require('ffmpeg-static') as string | null

const DOWNLOAD_FORMAT = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v'])

// ── Keep all existing helper functions (getCacheDir, isYtDlpMissingError,
//    normalizeTitle, parseProgress, parseDownloadDestination,
//    parseMergedDestination, isTemporaryStreamArtifact, isVideoArtifact,
//    fileExists, dedupePaths, findFinalVideoFile, resolveDownloadedVideoPath,
//    toDescriptiveError, runYtDlp, getVideoTitle, findCachedVideo)
//    — copy them verbatim from downloader.ts.
//    Only change: remove `getConfig()` calls, use `this.proxyUrl` instead.

export class YtDlpDownloader implements DownloaderStrategy {
  readonly name = 'yt-dlp'
  private proxyUrl: string

  constructor(proxy: ProxyConfig) {
    this.proxyUrl = proxy.enabled ? proxy.url : ''
  }

  async download(input: {
    url: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<DownloadResult> {
    // Same logic as current downloadVideo(), but:
    // 1. Use this.proxyUrl instead of getConfig().proxyUrl
    // 2. Return { videoPath: actualFilePath, title } instead of { filePath, title }
    // Copy the full implementation from downloader.ts, adapting as described.
    ...
  }
}
```

Implementation detail: copy the entire body of `downloadVideo()` and all helper functions from `downloader.ts`. Replace every `getConfig().proxyUrl` with `this.proxyUrl`. Rename the returned `filePath` field to `videoPath` in all internal references and the final return.

- [ ] **Step 3: Delete old downloader.ts**

```bash
rm electron/services/downloader.ts
```

- [ ] **Step 4: Verify TypeScript compiles for the new file**

```bash
npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep -i "yt-dlp"
```

Expected: no errors from `yt-dlp.ts` itself (other files may still error).

- [ ] **Step 5: Commit**

```
refactor: extract downloader to yt-dlp strategy
```

---

### Task 3: Create audio extractor strategy

**Files:**
- Create: `electron/services/strategies/extractors/ffmpeg.ts`
- Delete: `electron/services/audio.ts`

- [ ] **Step 1: Create ffmpeg.ts audio extractor**

Move code from `audio.ts`. Wrap in class implementing `AudioExtractorStrategy`.

Key changes:
- `extractAudio(videoPath, outputDir, onProgress)` → `extract({ videoPath, outputDir, onProgress })`
- Return `AudioResult` (`{ audioPath }`) instead of bare `string`
- No config dependencies — ffmpeg paths are resolved at module level (keep as-is)

```typescript
import ffmpeg from 'fluent-ffmpeg'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { AudioExtractorStrategy, AudioResult } from '../../types.js'

// ── Keep existing ffmpeg/ffprobe setup, getDuration, timeMarkToSeconds,
//    normalizeExtractionError helpers — copy verbatim from audio.ts

export class FfmpegAudioExtractor implements AudioExtractorStrategy {
  readonly name = 'ffmpeg'

  async extract(input: {
    videoPath: string
    outputDir: string
    onProgress: (pct: number) => void
  }): Promise<AudioResult> {
    // Same logic as current extractAudio(), return { audioPath: outputPath }
    const { videoPath, outputDir, onProgress } = input
    const duration = await getDuration(videoPath)
    await fs.mkdir(outputDir, { recursive: true })
    const outputPath = path.join(outputDir, 'audio.wav')

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .format('wav')
        .on('progress', (progress) => {
          const currentTime = progress.timemark ? timeMarkToSeconds(progress.timemark) : 0
          const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100))
          onProgress(pct)
        })
        .on('end', () => { onProgress(100); resolve() })
        .on('error', (error) => { reject(normalizeExtractionError(error)) })
        .save(outputPath)
    })

    return { audioPath: outputPath }
  }
}
```

- [ ] **Step 2: Delete old audio.ts**

```bash
rm electron/services/audio.ts
```

- [ ] **Step 3: Commit**

```
refactor: extract audio extractor to ffmpeg strategy
```

---

### Task 4: Create transcriber strategies

**Files:**
- Create: `electron/services/strategies/transcribers/openai-api.ts` (handles `openai` + `local-api` modes)
- Create: `electron/services/strategies/transcribers/local-cli.ts`
- Create: `electron/services/strategies/transcribers/whisperx.ts`
- Delete: `electron/services/transcriber.ts`

- [ ] **Step 1: Create openai-api.ts**

This handles both `openai` and `local-api` modes (same OpenAI SDK, different baseURL).

Key changes from `transcriber.ts`:
- Constructor receives: `apiKey`, `baseURL` (optional), `ProxyConfig`
- `transcribe({ audioPath })` returns `TranscriptionResult` with `language: 'en'` and `segments` where each segment has mandatory `speaker: 'SPEAKER_0'` (OpenAI Whisper API doesn't support diarization)
- Move shared helpers (`sleep`, `isRetryableError`, `describeOpenAIError`, `normalizeSegments`) into this file
- `normalizeSegments` must ensure every segment has `speaker` — default to `'SPEAKER_0'`

```typescript
import fs from 'node:fs'
import OpenAI from 'openai'
import { ProxyAgent } from 'undici'
import type { TranscriberStrategy, TranscriptionResult, TranscriptSegment, ProxyConfig } from '../../types.js'

const MAX_WHISPER_FILE_SIZE_BYTES = 25 * 1024 * 1024
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 500
const DEFAULT_SPEAKER = 'SPEAKER_0'

// ── Copy: sleep, isRetryableError, describeOpenAIError from transcriber.ts

function normalizeSegments(segments: unknown): TranscriptSegment[] {
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
      speaker: typeof item.speaker === 'string' ? item.speaker : DEFAULT_SPEAKER,
      ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}),
    }
  })
}

export class OpenAIApiTranscriber implements TranscriberStrategy {
  readonly name: string
  private client: OpenAI

  constructor(config: { name: string; apiKey: string; baseURL?: string; proxy: ProxyConfig }) {
    this.name = config.name
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.proxy.enabled && config.proxy.url
        ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxy.url) } }
        : {}),
    })
  }

  async transcribe(input: { audioPath: string }): Promise<TranscriptionResult> {
    // Retry loop from current transcriber.ts transcribeWithOpenAICompatibleApi + transcribe()
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const stats = await fs.promises.stat(input.audioPath)
        if (stats.size > MAX_WHISPER_FILE_SIZE_BYTES) {
          throw new Error('Audio file exceeds the 25MB Whisper API limit.')
        }
        const response = await this.client.audio.transcriptions.create({
          model: 'whisper-1',
          file: fs.createReadStream(input.audioPath),
          response_format: 'verbose_json',
          timestamp_granularities: ['segment'],
          language: 'en',
        }) as { segments?: unknown }
        return {
          language: 'en',
          segments: normalizeSegments(response.segments),
        }
      } catch (error) {
        lastError = error
        if (!isRetryableError(error) || attempt === MAX_RETRIES) {
          throw new Error(describeOpenAIError(error))
        }
        await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }
    throw new Error(describeOpenAIError(lastError))
  }
}
```

- [ ] **Step 2: Create local-cli.ts**

Extract `transcribeWithLocalCli` logic. Constructor takes `cliPath: string`.

```typescript
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type { TranscriberStrategy, TranscriptionResult, TranscriptSegment } from '../../types.js'

const require = createRequire(import.meta.url)
const ffmpegStatic = require('ffmpeg-static') as string | null
const DEFAULT_SPEAKER = 'SPEAKER_0'

// ── Copy: buildWhisperEnv, runWhisperCli, normalizeSegments from transcriber.ts

export class LocalCliTranscriber implements TranscriberStrategy {
  readonly name = 'local-cli'
  private cliPath: string

  constructor(config: { cliPath: string }) {
    this.cliPath = path.resolve(config.cliPath)
  }

  async transcribe(input: { audioPath: string }): Promise<TranscriptionResult> {
    // Same logic as current transcribeWithLocalCli()
    // Returns { language: 'en', segments: normalizeSegments(parsed.segments) }
    ...
  }
}
```

- [ ] **Step 3: Create whisperx.ts**

Extract `transcribeWithWhisperX` logic. Constructor takes `whisperxPath`, `hfToken`.

Key difference: WhisperX supports diarization with `--diarize` flag, so returned segments may have real speaker IDs (e.g., `SPEAKER_00`, `SPEAKER_01`).

```typescript
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type { TranscriberStrategy, TranscriptionResult, TranscriptSegment } from '../../types.js'

const require = createRequire(import.meta.url)
const ffmpegStatic = require('ffmpeg-static') as string | null
const DEFAULT_SPEAKER = 'SPEAKER_0'

// ── Copy: buildWhisperEnv, runWhisperCli, normalizeSegments from transcriber.ts

export class WhisperXTranscriber implements TranscriberStrategy {
  readonly name = 'whisperx'
  private whisperxPath: string
  private hfToken: string

  constructor(config: { whisperxPath: string; hfToken: string }) {
    this.whisperxPath = path.resolve(config.whisperxPath)
    this.hfToken = config.hfToken
  }

  async transcribe(input: { audioPath: string }): Promise<TranscriptionResult> {
    // Same logic as current transcribeWithWhisperX()
    // Returns { language: 'en', segments: normalizeSegments(parsed.segments) }
    ...
  }
}
```

- [ ] **Step 4: Delete old transcriber.ts**

```bash
rm electron/services/transcriber.ts
```

- [ ] **Step 5: Commit**

```
refactor: extract transcriber to strategy implementations
```

---

### Task 5: Create translator strategy

**Files:**
- Create: `electron/services/strategies/translators/openai-compatible.ts`
- Delete: `electron/services/translator.ts`

- [ ] **Step 1: Create openai-compatible.ts**

Single class that handles all three providers (openai/deepseek/glm). They use the same OpenAI SDK with different `baseURL`/`apiKey`/`model`.

Key changes from `translator.ts`:
- Constructor receives: `name`, `apiKey`, `model`, `baseURL?`, `ProxyConfig`
- Input segments type changes from `Segment` to `TranscriptSegment`
- Output uses `TranslatedSegment` with `sourceText`/`targetText` instead of `en`/`cn`
- `translate()` method also receives `sourceLanguage` and `targetLanguage`, uses them in the system prompt
- The method returns `TranslationResult` (with `sourceLanguage`, `targetLanguage`, `segments`)

```typescript
import OpenAI from 'openai'
import { ProxyAgent } from 'undici'
import type {
  TranslatorStrategy, TranslationResult, TranslatedSegment, TranscriptSegment, ProxyConfig
} from '../../types.js'

const BATCH_SIZE = 50
const MAX_RETRIES = 3

function buildSystemPrompt(sourceLanguage: string, targetLanguage: string): string {
  return `You are a professional translator specializing in video content.
Translate each segment from ${sourceLanguage} to ${targetLanguage} naturally and fluently.
Return a JSON object with a "translations" array where each element has:
- "sourceText": the original text (exact copy)
- "targetText": the translated text
- "start": the start timestamp (exact copy)
- "end": the end timestamp (exact copy)
Maintain the exact same array order. Handle colloquialisms, slang, and technical terms appropriately.
Do NOT add any extra text, explanations, or notes — only return the JSON.`
}

// ── Copy: sleep, chunkSegments from translator.ts

interface TranslationResponseItem {
  sourceText: string
  targetText: string
  start: number
  end: number
}

function parseAndValidateResponse(
  rawContent: string,
  inputSegments: TranscriptSegment[]
): TranslatedSegment[] {
  const parsed: unknown = JSON.parse(rawContent)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid translation response: expected a JSON object.')
  }
  const response = parsed as { translations?: unknown }
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
    const typedItem = item as TranslationResponseItem
    const segment = inputSegments[index]
    if (typedItem.start !== segment.start || typedItem.end !== segment.end) {
      throw new Error(`Invalid translation response: item at index ${index} does not preserve timestamps.`)
    }
    return {
      start: segment.start,
      end: segment.end,
      sourceText: typedItem.sourceText,
      targetText: typedItem.targetText,
      speaker: segment.speaker,
    }
  })
}

export class OpenAICompatibleTranslator implements TranslatorStrategy {
  readonly name: string
  private client: OpenAI
  private model: string

  constructor(config: {
    name: string
    apiKey: string
    model: string
    baseURL?: string
    proxy: ProxyConfig
  }) {
    this.name = config.name
    this.model = config.model
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.proxy.enabled && config.proxy.url
        ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxy.url) } }
        : {}),
    })
  }

  async translate(input: {
    segments: TranscriptSegment[]
    sourceLanguage: string
    targetLanguage: string
  }): Promise<TranslationResult> {
    const batches = chunkSegments(input.segments)
    const translatedSegments: TranslatedSegment[] = []
    const systemPrompt = buildSystemPrompt(input.sourceLanguage, input.targetLanguage)

    for (const batch of batches) {
      const batchResult = await this.translateBatch(batch, systemPrompt)
      translatedSegments.push(...batchResult)
    }

    return {
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      segments: translatedSegments,
    }
  }

  private async translateBatch(
    segments: TranscriptSegment[],
    systemPrompt: string
  ): Promise<TranslatedSegment[]> {
    // Same retry logic as current translateBatch()
    // But uses new parseAndValidateResponse with sourceText/targetText
    ...
  }
}
```

- [ ] **Step 2: Delete old translator.ts**

```bash
rm electron/services/translator.ts
```

- [ ] **Step 3: Commit**

```
refactor: extract translator to openai-compatible strategy
```

---

### Task 6: Create synthesizer strategies

**Files:**
- Create: `electron/services/strategies/synthesizers/edge-tts.ts`
- Create: `electron/services/strategies/synthesizers/openai-tts.ts`
- Create: `electron/services/strategies/synthesizers/indextts.ts`
- Delete: `electron/services/tts.ts`

The current `tts.ts` is the largest file (~594 lines) with shared helpers used by all three engines. Strategy: extract shared helpers (silence creation, audio duration probing, concat, tempo adjustment) into each file as needed, or keep shared utilities as module-level functions in each file.

- [ ] **Step 1: Create edge-tts.ts**

Key changes:
- Constructor receives `ProxyConfig`, `localWhisperCliPath` (for edge-tts path detection)
- Speaker→voice mapping: use `Map<string, string>` from the `speakers` input list
- Uses `TranslatedSegment.targetText` instead of `.cn`, and `.sourceText` instead of `.en`/`.text`

```typescript
import ffmpeg from 'fluent-ffmpeg'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { SynthesizerStrategy, SynthesisResult, TranslatedSegment, ProxyConfig } from '../../types.js'

const require = createRequire(import.meta.url)
const ffprobeStatic = require('ffprobe-static') as { path?: string }
const ffmpegStatic = require('ffmpeg-static') as string | null
// ── ffmpeg/ffprobe setup (copy from tts.ts)

const VOICE_POOL = [
  'zh-CN-YunxiNeural',
  'zh-CN-XiaoxiaoNeural',
  'zh-CN-YunjianNeural',
  'zh-CN-XiaoyiNeural',
  'zh-CN-YunyangNeural',
  'zh-CN-XiaozhenNeural',
]
const MAX_RATE_ADJUSTMENT = 50
const DURATION_TOLERANCE = 0.3
const MAX_TTS_RETRIES = 3
const INITIAL_TTS_BACKOFF_MS = 1000

// ── Copy shared helpers from tts.ts:
//    sleep, toErrorMessage, isRetryableEdgeTtsError, runFfmpeg,
//    createSilenceFile, probeDuration, padAudioToDuration,
//    escapeConcatPath, concatAudioFiles, clampRate, formatRate,
//    isFinitePositive, detectEdgeTtsPath, getEdgeTtsProxy,
//    buildEdgeTtsEnv, runEdgeTtsCli, synthesizeEdgeTextToFile

export class EdgeTtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'edge-tts'
  private proxy: ProxyConfig
  private localWhisperCliPath: string

  constructor(config: { proxy: ProxyConfig; localWhisperCliPath: string }) {
    this.proxy = config.proxy
    this.localWhisperCliPath = config.localWhisperCliPath
  }

  private buildSpeakerVoiceMap(speakers: string[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const speaker of speakers) {
      if (!map.has(speaker)) {
        map.set(speaker, VOICE_POOL[map.size % VOICE_POOL.length])
      }
    }
    return map
  }

  async synthesize(input: {
    segments: TranslatedSegment[]
    workDir: string
    speakers: string[]
    onProgress: (pct: number) => void
  }): Promise<SynthesisResult> {
    const { segments, workDir, speakers, onProgress } = input
    await fs.mkdir(workDir, { recursive: true })

    const outputPath = path.join(workDir, '..', 'cn_audio.mp3')
    const ttsWorkDir = path.join(workDir, '.tts-temp')
    await fs.mkdir(ttsWorkDir, { recursive: true })

    try {
      if (segments.length === 0) {
        await createSilenceFile(0.1, outputPath)
        onProgress(100)
        return { audioPath: outputPath }
      }

      const voiceMap = this.buildSpeakerVoiceMap(speakers)
      const files = await this.makeSegmentTimeline(segments, ttsWorkDir, voiceMap)

      if (files.length === 1) {
        await fs.copyFile(files[0], outputPath)
      } else {
        await concatAudioFiles(files, outputPath, ttsWorkDir)
      }
      onProgress(100)
      return { audioPath: outputPath }
    } finally {
      await fs.rm(ttsWorkDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async makeSegmentTimeline(
    segments: TranslatedSegment[],
    workDir: string,
    voiceMap: Map<string, string>,
  ): Promise<string[]> {
    // Same logic as current makeSegmentTimeline(), but:
    // - Use segment.targetText instead of segment.cn
    // - Use segment.sourceText instead of segment.en / segment.text
    // - Use voiceMap.get(segment.speaker) for voice selection
    ...
  }
}
```

- [ ] **Step 2: Create openai-tts.ts**

Similar pattern. Constructor receives `apiKey`, `ProxyConfig`.

```typescript
import { promises as fs } from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'
import { ProxyAgent } from 'undici'
import type { SynthesizerStrategy, SynthesisResult, TranslatedSegment, ProxyConfig } from '../../types.js'

const VOICE_POOL = ['alloy', 'nova', 'echo', 'shimmer', 'fable', 'onyx']
// ── Copy shared helpers from tts.ts needed by OpenAI TTS:
//    sleep, toErrorMessage, isRetryableTtsError, runFfmpeg,
//    createSilenceFile, probeDuration, padAudioToDuration,
//    escapeConcatPath, concatAudioFiles

export class OpenAITtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'openai-tts'
  private client: OpenAI

  constructor(config: { apiKey: string; proxy: ProxyConfig }) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.proxy.enabled && config.proxy.url
        ? { fetchOptions: { dispatcher: new ProxyAgent(config.proxy.url) } }
        : {}),
    })
  }

  // buildSpeakerVoiceMap, synthesize, makeSegmentTimeline
  // Same as EdgeTtsSynthesizer but using OpenAI TTS API for audio generation
  ...
}
```

- [ ] **Step 3: Create indextts.ts**

Constructor receives `apiUrl`, `referenceAudio`, `ProxyConfig`.

```typescript
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import type { SynthesizerStrategy, SynthesisResult, TranslatedSegment, ProxyConfig } from '../../types.js'

// ── Copy shared helpers from tts.ts needed by IndexTTS:
//    sleep, toErrorMessage, isRetryableTtsError, runFfmpeg,
//    createSilenceFile, probeDuration, adjustAudioTempoToDuration,
//    padAudioToDuration, escapeConcatPath, concatAudioFiles,
//    buildAtempoFilter, convertAudioToMp3, isMp3Response,
//    writeIndexTtsAudioResponse, synthesizeIndexTtsTextToFile

export class IndexTtsSynthesizer implements SynthesizerStrategy {
  readonly name = 'indextts'
  private apiUrl: string
  private referenceAudio: string
  private proxy: ProxyConfig

  constructor(config: { apiUrl: string; referenceAudio: string; proxy: ProxyConfig }) {
    this.apiUrl = config.apiUrl.trim() || 'http://localhost:8080'
    this.referenceAudio = config.referenceAudio.trim()
    this.proxy = config.proxy
  }

  // synthesize method — single voice (no speaker differentiation)
  // IndexTTS uses reference_audio for voice cloning, doesn't have a voice pool
  ...
}
```

- [ ] **Step 4: Delete old tts.ts**

```bash
rm electron/services/tts.ts
```

- [ ] **Step 5: Commit**

```
refactor: extract TTS to edge-tts, openai-tts, indextts strategies
```

---

### Task 7: Create combiner strategy

**Files:**
- Create: `electron/services/strategies/combiners/ffmpeg.ts`
- Delete: `electron/services/combiner.ts`

- [ ] **Step 1: Create ffmpeg.ts combiner**

Move all code from `combiner.ts`. Wrap in `FfmpegCombiner` class.

```typescript
import ffmpeg from 'fluent-ffmpeg'
import { createRequire } from 'node:module'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { CombinerStrategy, CombineResult } from '../../types.js'

// ── Copy all helper functions from combiner.ts verbatim:
//    ffmpeg/ffprobe setup, toErrorMessage, normalizeCombineError,
//    getDuration, timeMarkToSeconds, escapeSubtitleFilterPath,
//    getFontsDir, buildSubtitleFilter

export class FfmpegCombiner implements CombinerStrategy {
  readonly name = 'ffmpeg'

  async combine(input: {
    videoPath: string
    audioPath: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
  }): Promise<CombineResult> {
    // Same logic as current combine() function
    // Return { outputPath: input.outputPath }
    ...
  }
}
```

- [ ] **Step 2: Delete old combiner.ts**

```bash
rm electron/services/combiner.ts
```

- [ ] **Step 3: Commit**

```
refactor: extract combiner to ffmpeg strategy
```

---

### Task 8: Update subtitle.ts

**Files:**
- Modify: `electron/services/subtitle.ts`

- [ ] **Step 1: Update generateAss signature and field references**

Change `generateAss` to accept `TranslationResult` instead of `TranslatedSegment[]`:

```typescript
import type { TranslationResult, SubtitleStyle, TranslatedSegment } from './types.js'

// ── Keep all helper functions unchanged

export function generateAss(
  translation: TranslationResult,
  style: SubtitleStyle,
  videoWidth: number,
  videoHeight: number
): string {
  const { segments } = translation
  const width = videoWidth || DEFAULT_VIDEO_WIDTH
  const height = videoHeight || DEFAULT_VIDEO_HEIGHT
  // ... existing layout calculation ...

  const lines = [
    // ... existing header ...
    // In style names, keep 'English'/'Chinese' for now since SubtitleStyle
    // still uses enFontSize/cnFontSize — this is a presentation concern
    ...segments.flatMap((segment) => [
      buildDialogueLine(segment.start, segment.end, 'English', segment.sourceText, centerX, enY, bgAlpha),
      buildDialogueLine(segment.start, segment.end, 'Chinese', segment.targetText, centerX, cnY, bgAlpha),
    ]),
  ]

  return lines.join('\n')
}
```

Also update `writeAssFile` to accept `TranslationResult`.

- [ ] **Step 2: Commit**

```
refactor: update subtitle.ts to use TranslationResult
```

---

### Task 9: Create factories.ts

**Files:**
- Create: `electron/services/factories.ts`

- [ ] **Step 1: Create factories.ts with all factory functions**

```typescript
import type { AppConfig, ProxyConfig, PipelineStrategies } from './types.js'

import { YtDlpDownloader } from './strategies/downloaders/yt-dlp.js'
import { FfmpegAudioExtractor } from './strategies/extractors/ffmpeg.js'
import { OpenAIApiTranscriber } from './strategies/transcribers/openai-api.js'
import { LocalCliTranscriber } from './strategies/transcribers/local-cli.js'
import { WhisperXTranscriber } from './strategies/transcribers/whisperx.js'
import { OpenAICompatibleTranslator } from './strategies/translators/openai-compatible.js'
import { EdgeTtsSynthesizer } from './strategies/synthesizers/edge-tts.js'
import { OpenAITtsSynthesizer } from './strategies/synthesizers/openai-tts.js'
import { IndexTtsSynthesizer } from './strategies/synthesizers/indextts.js'
import { FfmpegCombiner } from './strategies/combiners/ffmpeg.js'

function getProxy(config: AppConfig): ProxyConfig {
  return { enabled: config.proxyEnabled, url: config.proxyUrl }
}

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'

export function createDownloader(config: AppConfig): YtDlpDownloader {
  return new YtDlpDownloader(getProxy(config))
}

export function createAudioExtractor(_config: AppConfig): FfmpegAudioExtractor {
  return new FfmpegAudioExtractor()
}

export function createTranscriber(config: AppConfig) {
  const proxy = getProxy(config)
  switch (config.transcribeMode) {
    case 'openai':
      return new OpenAIApiTranscriber({
        name: 'openai-whisper',
        apiKey: config.openaiApiKey,
        proxy,
      })
    case 'local-api':
      return new OpenAIApiTranscriber({
        name: 'local-api',
        apiKey: 'not-needed',
        baseURL: config.localWhisperApiUrl,
        proxy,
      })
    case 'local-cli':
      return new LocalCliTranscriber({ cliPath: config.localWhisperCliPath })
    case 'whisperx':
      return new WhisperXTranscriber({
        whisperxPath: config.whisperxPath,
        hfToken: config.whisperxHfToken,
      })
  }
}

export function createTranslator(config: AppConfig) {
  const proxy = getProxy(config)
  switch (config.translateMode) {
    case 'openai':
      return new OpenAICompatibleTranslator({
        name: 'openai',
        apiKey: config.openaiApiKey,
        model: config.openaiModel || 'gpt-4o',
        proxy,
      })
    case 'deepseek':
      return new OpenAICompatibleTranslator({
        name: 'deepseek',
        apiKey: config.deepseekApiKey,
        model: config.deepseekModel || 'deepseek-chat',
        baseURL: DEEPSEEK_BASE_URL,
        proxy,
      })
    case 'glm':
      return new OpenAICompatibleTranslator({
        name: 'glm',
        apiKey: config.glmApiKey,
        model: config.glmModel || 'glm-4-flash',
        baseURL: GLM_BASE_URL,
        proxy,
      })
  }
}

export function createSynthesizer(config: AppConfig) {
  const proxy = getProxy(config)
  switch (config.ttsMode) {
    case 'edge':
      return new EdgeTtsSynthesizer({
        proxy,
        localWhisperCliPath: config.localWhisperCliPath,
      })
    case 'openai':
      return new OpenAITtsSynthesizer({
        apiKey: config.openaiApiKey,
        proxy,
      })
    case 'indextts':
      return new IndexTtsSynthesizer({
        apiUrl: config.indexttsApiUrl,
        referenceAudio: config.indexttsReferenceAudio,
        proxy,
      })
  }
}

export function createCombiner(_config: AppConfig): FfmpegCombiner {
  return new FfmpegCombiner()
}

export function createPipelineStrategies(config: AppConfig): PipelineStrategies {
  return {
    downloader: createDownloader(config),
    extractor: createAudioExtractor(config),
    transcriber: createTranscriber(config),
    translator: createTranslator(config),
    synthesizer: createSynthesizer(config),
    combiner: createCombiner(config),
  }
}
```

- [ ] **Step 2: Commit**

```
feat: add factory functions for all pipeline strategies
```

---

### Task 10: Refactor pipeline.ts orchestrator

**Files:**
- Modify: `electron/services/pipeline.ts`

This is the critical integration task. The orchestrator must switch from direct service imports to using injected strategies.

- [ ] **Step 1: Rewrite pipeline.ts**

Key changes:
- Remove imports of `downloadVideo`, `extractAudio`, `transcribe`, `translate`, `synthesize`, `combine`, `getConfig`
- Constructor accepts `PipelineStrategies` and `targetLanguage`
- `start()` calls strategy methods using the new input/output contracts
- Cache logic adapts to new types (`TranscriptSegment` instead of `Segment`, new `TranslatedSegment` with `sourceText`/`targetText`)
- Type guards (`isSegment`, `isTranslatedSegment`) updated for new field names
- `generateAss` called with `TranslationResult` wrapper

```typescript
import ffmpeg from 'fluent-ffmpeg'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { generateAss } from './subtitle.js'
import type {
  PipelineStrategies, PipelineStage, PipelineState,
  TranscriptSegment, TranslatedSegment, TranslationResult,
  SubtitleStyle,
} from './types.js'
import { getVideoStorageKey } from './video-key.js'

// ── Keep: ffprobe setup, TOTAL_STEPS, VideoDimensions,
//    CachedSegmentsFile, CachedOutputFile, toErrorMessage,
//    sanitizeFileName, createFingerprint, fileExists,
//    readCachedJson, readCachedSegments, writeCachedSegments,
//    readCachedOutput, writeCachedOutput, getVideoDimensions

// ── Update type guards:
function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.start === 'number' &&
    typeof c.end === 'number' &&
    typeof c.text === 'string' &&
    typeof c.speaker === 'string'
  )
}

function isTranslatedSegment(value: unknown): value is TranslatedSegment {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.start === 'number' &&
    typeof c.end === 'number' &&
    typeof c.sourceText === 'string' &&
    typeof c.targetText === 'string' &&
    typeof c.speaker === 'string'
  )
}

// ── Cache fingerprint functions: remove AppConfig dependency,
//    use strategy names instead of config modes

export class PipelineOrchestrator {
  private state: PipelineState
  private callbacks: Set<(state: PipelineState) => void>
  private cancelled: boolean
  private workDir: string
  private strategies: PipelineStrategies
  private targetLanguage: string
  private subtitleStyle: SubtitleStyle

  constructor(
    strategies: PipelineStrategies,
    targetLanguage: string,
    subtitleStyle: SubtitleStyle,
  ) {
    this.strategies = strategies
    this.targetLanguage = targetLanguage
    this.subtitleStyle = subtitleStyle
    this.state = { stage: 'idle', progress: 0, overallProgress: 0 }
    this.callbacks = new Set()
    this.cancelled = false
    this.workDir = ''
  }

  async start(url: string, outputDir: string): Promise<void> {
    this.cancelled = false
    this.workDir = path.join(outputDir, '.tmp', getVideoStorageKey(url))

    try {
      await fs.mkdir(this.workDir, { recursive: true })

      // Step 1: Download
      this.assertNotCancelled()
      const download = await this.runStep('downloading', 0, (onProgress) =>
        this.strategies.downloader.download({ url, outputDir, onProgress })
      )
      this.updateState({ videoTitle: download.title })

      // Step 2: Extract audio
      this.assertNotCancelled()
      const audio = await this.runStep('extracting', 1, async (onProgress) => {
        const cachedAudioPath = path.join(this.workDir, 'audio.wav')
        if (await fileExists(cachedAudioPath)) {
          onProgress(100)
          return { audioPath: cachedAudioPath }
        }
        return this.strategies.extractor.extract({
          videoPath: download.videoPath, outputDir: this.workDir, onProgress,
        })
      })

      // Step 3: Transcribe
      this.assertNotCancelled()
      const transcription = await this.runStep('transcribing', 2, async () => {
        const transcriptPath = path.join(this.workDir, 'transcript.json')
        const videoStats = await fs.stat(download.videoPath)
        const fp = createFingerprint({
          size: videoStats.size,
          mtimeMs: Math.trunc(videoStats.mtimeMs),
          strategy: this.strategies.transcriber.name,
        })
        const cached = await readCachedSegments(transcriptPath, fp, isTranscriptSegment)
        if (cached) {
          this.updateProgress(2, 100)
          return { language: 'en', segments: cached }
        }
        const result = await this.strategies.transcriber.transcribe({
          audioPath: audio.audioPath,
        })
        await writeCachedSegments(transcriptPath, fp, result.segments)
        this.updateProgress(2, 100)
        return result
      })

      // Step 4: Translate
      this.assertNotCancelled()
      const translation = await this.runStep('translating', 3, async () => {
        const translationPath = path.join(this.workDir, 'translated_segments.json')
        const fp = createFingerprint({
          segments: transcription.segments,
          strategy: this.strategies.translator.name,
        })
        const cached = await readCachedSegments(translationPath, fp, isTranslatedSegment)
        if (cached) {
          this.updateProgress(3, 100)
          return {
            sourceLanguage: transcription.language,
            targetLanguage: this.targetLanguage,
            segments: cached,
          } as TranslationResult
        }
        const result = await this.strategies.translator.translate({
          segments: transcription.segments,
          sourceLanguage: transcription.language,
          targetLanguage: this.targetLanguage,
        })
        await writeCachedSegments(translationPath, fp, result.segments)
        this.updateProgress(3, 100)
        return result
      })
      this.updateState({ translatedSegments: translation.segments })

      // Step 5: Synthesize TTS
      this.assertNotCancelled()
      const speakers = [...new Set(translation.segments.map((s) => s.speaker))]
      const synthesis = await this.runStep('synthesizing', 4, async (onProgress) => {
        const ttsCachePath = path.join(this.workDir, 'tts.json')
        const fp = createFingerprint({
          segments: translation.segments,
          strategy: this.strategies.synthesizer.name,
        })
        const cachedOutput = await readCachedOutput(ttsCachePath, fp)
        if (cachedOutput) {
          onProgress(100)
          return { audioPath: cachedOutput }
        }
        const result = await this.strategies.synthesizer.synthesize({
          segments: translation.segments,
          workDir: this.workDir,
          speakers,
          onProgress,
        })
        await writeCachedOutput(ttsCachePath, fp, result.audioPath)
        return result
      })

      // Step 6: Recombine
      this.assertNotCancelled()
      const combineResult = await this.runStep('recombining', 5, async (onProgress) => {
        const { width, height } = await getVideoDimensions(download.videoPath)
        this.assertNotCancelled()

        const assContent = generateAss(translation, this.subtitleStyle, width, height)
        const subtitlePath = path.join(this.workDir, 'subtitles.ass')
        await fs.writeFile(subtitlePath, assContent, 'utf8')
        this.assertNotCancelled()

        const finalOutputPath = path.join(
          outputDir, `${sanitizeFileName(download.title)}_translated.mp4`
        )
        return this.strategies.combiner.combine({
          videoPath: download.videoPath,
          audioPath: synthesis.audioPath,
          subtitlePath,
          outputPath: finalOutputPath,
          onProgress,
        })
      })

      this.assertNotCancelled()
      this.setState({
        stage: 'completed',
        progress: 100,
        overallProgress: 100,
        videoTitle: download.title,
        outputPath: combineResult.outputPath,
        translatedSegments: translation.segments,
      })
    } catch (error) {
      this.setState({
        ...this.state,
        stage: 'error',
        error: toErrorMessage(error),
      })
    }
  }

  // ── Keep: cancel, onProgress, getState, runStep, updateProgress,
  //    calculateOverallProgress, assertNotCancelled, updateState,
  //    setState, notify — unchanged from current pipeline.ts
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`

Expected: PASS (all files should compile cleanly)

- [ ] **Step 3: Commit**

```
refactor: rewrite pipeline orchestrator to use strategy interfaces
```

---

### Task 11: Update main.ts — wire factory to orchestrator

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Update pipeline creation in IPC handler**

```typescript
import { createPipelineStrategies } from './services/factories.js'
import { getConfig, setConfig } from './services/config.js'
import { PipelineOrchestrator } from './services/pipeline.js'
import type { AppConfig } from './services/types.js'

// In registerIpcHandlers():
ipcMain.handle('pipeline:start', async (_event, url: string, outputDir: string): Promise<void> => {
  if (!mainWindow) {
    throw new Error('Main window is not available')
  }

  const config = getConfig()
  const strategies = createPipelineStrategies(config)
  const pipeline = new PipelineOrchestrator(strategies, 'zh', config.subtitleStyle)
  currentPipeline = pipeline

  pipeline.onProgress((state) => {
    mainWindow?.webContents.send('pipeline:progress', state)
  })

  try {
    await pipeline.start(url, outputDir)
  } finally {
    currentPipeline = null
  }
})
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 3: Commit**

```
refactor: wire factory-created strategies to pipeline in main.ts
```

---

### Task 12: Update frontend types and components

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/ResultView.tsx`

- [ ] **Step 1: Update src/types.ts**

Replace the `Segment` and `TranslatedSegment` interfaces to match the new backend types:

```typescript
export interface TranslatedSegment {
  start: number
  end: number
  sourceText: string
  targetText: string
  speaker: string
}
```

Remove the old `Segment` interface (no longer needed on frontend). Keep `PipelineState` using `TranslatedSegment[]`.

- [ ] **Step 2: Update ResultView.tsx**

Change `segment.en` → `segment.sourceText` and `segment.cn` → `segment.targetText`:

```tsx
// Line ~111
<span>{segment.sourceText}</span>
// Line ~115
<span className="text-primary-fixed-dim">{segment.targetText}</span>
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 4: Commit**

```
refactor: update frontend types to use sourceText/targetText
```

---

### Task 13: Clean up and final verification

- [ ] **Step 1: Verify old service files are deleted**

Confirm these files no longer exist:
```bash
ls electron/services/downloader.ts electron/services/audio.ts \
   electron/services/transcriber.ts electron/services/translator.ts \
   electron/services/tts.ts electron/services/combiner.ts 2>&1
```

Expected: `No such file or directory` for all 6 files.

- [ ] **Step 2: Verify new strategy files exist**

```bash
find electron/services/strategies -name "*.ts" | sort
```

Expected:
```
electron/services/strategies/combiners/ffmpeg.ts
electron/services/strategies/downloaders/yt-dlp.ts
electron/services/strategies/extractors/ffmpeg.ts
electron/services/strategies/synthesizers/edge-tts.ts
electron/services/strategies/synthesizers/indextts.ts
electron/services/strategies/synthesizers/openai-tts.ts
electron/services/strategies/transcribers/local-cli.ts
electron/services/strategies/transcribers/openai-api.ts
electron/services/strategies/transcribers/whisperx.ts
electron/services/strategies/translators/openai-compatible.ts
```

- [ ] **Step 3: Full typecheck**

Run: `npm run typecheck`

Expected: PASS with zero errors.

- [ ] **Step 4: Final commit**

```
chore: clean up old service files after strategy extraction
```
