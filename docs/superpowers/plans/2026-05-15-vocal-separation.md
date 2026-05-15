# Vocal Separation (mix-vocal-removal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `audio-separator` CLI as an external vocal separation tool, enabling the `mix-vocal-removal` audio mix mode that cleanly removes original vocals and mixes TTS with the instrumental track.

**Architecture:** Add `audioSeparatorPath` config field (auto-detected, same pattern as WhisperX). New `vocal-separator.ts` utility spawns the CLI subprocess. Pipeline gains a conditional `separating-vocals` step after TTS. Combiner uses the instrumental track as a third FFmpeg input, mixed with TTS via `amix`.

**Tech Stack:** Node.js child_process, FFmpeg filter_complex, audio-separator CLI (external Python package)

**Spec:** `docs/superpowers/specs/2026-05-15-vocal-separation-design.md`

---

### Task 1: Types & Config

Add `audioSeparatorPath` to config and `'separating-vocals'` to pipeline stages.

**Files:**
- Modify: `electron/services/types.ts:3` (PipelineStage), `electron/services/types.ts:129` (CombinerStrategy), `electron/services/types.ts:195` (AppConfig)
- Modify: `src/types.ts:1` (PipelineStage), `src/types.ts:70` (AppConfig)
- Modify: `electron/services/config.ts:31-49` (detect function), `electron/services/config.ts:51-85` (defaults), `electron/services/config.ts:87-204` (schema), `electron/services/config.ts:219-242` (simpleKeys)
- Modify: `src/store/usePipelineStore.ts:29-52` (initial config)

- [ ] **Step 1: Add `'separating-vocals'` to PipelineStage in backend types**

In `electron/services/types.ts`, add `'separating-vocals'` after `'synthesizing'`:

```typescript
export type PipelineStage =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'awaiting-speaker-labels'
  | 'translating'
  | 'synthesizing'
  | 'separating-vocals'
  | 'recombining'
  | 'completed'
  | 'error'
```

- [ ] **Step 2: Add `instrumentalPath` to CombinerStrategy input**

In `electron/services/types.ts`, add `instrumentalPath?: string` to the `combine` input:

```typescript
export interface CombinerStrategy {
  readonly name: string
  combine(input: {
    videoPath: string
    audioPath?: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
    speechSegments?: { start: number; end: number }[]
    instrumentalPath?: string
  }): Promise<CombineResult>
}
```

- [ ] **Step 3: Add `audioSeparatorPath` to AppConfig in backend types**

In `electron/services/types.ts`, add after `indexttsReferenceAudio`:

```typescript
export interface AppConfig {
  // ... existing fields ...
  indexttsReferenceAudio: string
  audioSeparatorPath: string
}
```

- [ ] **Step 4: Mirror changes in frontend types**

In `src/types.ts`, add `'separating-vocals'` to PipelineStage:

```typescript
export type PipelineStage =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'awaiting-speaker-labels'
  | 'translating'
  | 'synthesizing'
  | 'separating-vocals'
  | 'recombining'
  | 'completed'
  | 'error'
```

Add `audioSeparatorPath` to AppConfig:

```typescript
export interface AppConfig {
  // ... existing fields ...
  indexttsReferenceAudio: string
  audioSeparatorPath: string
}
```

- [ ] **Step 5: Add `detectAudioSeparatorPath()` to config.ts**

In `electron/services/config.ts`, add after the `detectWhisperxPath()` function (after line 49):

```typescript
function detectAudioSeparatorPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDir, '..', '..', '..')
  const binName = process.platform === 'win32' ? 'audio-separator.exe' : 'audio-separator'
  const venvDir = process.platform === 'win32' ? 'Scripts' : 'bin'
  const venvPath = path.join(projectRoot, '.venv', venvDir, binName)
  if (fs.existsSync(venvPath)) {
    return venvPath
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where audio-separator' : 'which audio-separator'
    const result = execSync(whichCmd, { encoding: 'utf8', timeout: 3000 }).trim()
    const firstLine = result.split(/\r?\n/)[0]
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine
    }
  } catch {
    // not found on PATH
  }

  return 'audio-separator'
}
```

- [ ] **Step 6: Add `audioSeparatorPath` to defaultConfig, schema, and simpleKeys**

In `defaultConfig` (after `indexttsReferenceAudio`):
```typescript
  indexttsReferenceAudio: '',
  audioSeparatorPath: detectAudioSeparatorPath(),
```

In schema (after `indexttsReferenceAudio` schema entry):
```typescript
    audioSeparatorPath: {
      type: 'string',
      default: defaultConfig.audioSeparatorPath,
    },
```

In `simpleKeys` array (after `'indexttsReferenceAudio'`):
```typescript
    'indexttsReferenceAudio',
    'audioSeparatorPath',
```

- [ ] **Step 7: Add `audioSeparatorPath` to store initial config**

In `src/store/usePipelineStore.ts`, add after `indexttsReferenceAudio`:

```typescript
    indexttsReferenceAudio: '',
    audioSeparatorPath: '',
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors)

---

### Task 2: i18n Keys

Add all i18n keys for the vocal separation feature.

**Files:**
- Modify: `src/i18n/locales/en.ts:124-131`
- Modify: `src/i18n/locales/zh.ts:126-133`
- Modify: `src/components/ProgressView.tsx:6-13`

- [ ] **Step 1: Add English i18n keys**

In `src/i18n/locales/en.ts`, replace the existing `audioMixVocalRemovalHelp` value and add new keys. Find the line:
```
'settings.tts.audioMixVocalRemovalHelp': 'Coming soon',
```
Replace with:
```typescript
'settings.tts.audioMixVocalRemovalHelp': 'Use AI vocal separation to cleanly remove original speech, preserving all background audio. Requires audio-separator.',
'settings.tts.audioSeparatorPath': 'audio-separator Path',
'settings.tts.audioSeparatorPathHelp': 'Path to audio-separator CLI. Install with: pip install "audio-separator[cpu]"',
'progress.stages.separatingVocals': 'Vocal Separation',
```

- [ ] **Step 2: Add Chinese i18n keys**

In `src/i18n/locales/zh.ts`, replace the existing `audioMixVocalRemovalHelp` value and add new keys. Find the line:
```
'settings.tts.audioMixVocalRemovalHelp': '即将推出',
```
Replace with:
```typescript
'settings.tts.audioMixVocalRemovalHelp': '使用 AI 人声分离技术，干净地移除原始语音，保留所有背景音频。需要安装 audio-separator。',
'settings.tts.audioSeparatorPath': 'audio-separator 路径',
'settings.tts.audioSeparatorPathHelp': 'audio-separator 命令路径。安装方式：pip install "audio-separator[cpu]"',
'progress.stages.separatingVocals': '人声分离',
```

- [ ] **Step 3: Add separating-vocals to ProgressView ALL_STAGES**

In `src/components/ProgressView.tsx`, add the new stage entry after `'synthesizing'` in the `ALL_STAGES` array:

```typescript
const ALL_STAGES: { id: PipelineStage; nameKey: string }[] = [
  { id: 'downloading', nameKey: 'progress.stages.downloading' },
  { id: 'extracting', nameKey: 'progress.stages.extracting' },
  { id: 'transcribing', nameKey: 'progress.stages.transcribing' },
  { id: 'translating', nameKey: 'progress.stages.translating' },
  { id: 'synthesizing', nameKey: 'progress.stages.synthesizing' },
  { id: 'separating-vocals', nameKey: 'progress.stages.separatingVocals' },
  { id: 'recombining', nameKey: 'progress.stages.recombining' },
]
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

---

### Task 3: Vocal Separator Utility

Create the `vocal-separator.ts` module that spawns `audio-separator` CLI.

**Files:**
- Create: `electron/services/strategies/vocal-separator.ts`

- [ ] **Step 1: Create vocal-separator.ts**

Create `electron/services/strategies/vocal-separator.ts`:

```typescript
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const DEFAULT_MODEL = 'model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt'

export async function separateVocals(input: {
  audioPath: string
  workDir: string
  audioSeparatorPath: string
  onProgress?: (pct: number) => void
  signal?: AbortSignal
}): Promise<{ instrumentalPath: string }> {
  const { audioPath, workDir, audioSeparatorPath, onProgress, signal } = input
  const resolvedPath = path.resolve(audioSeparatorPath)

  await fs.mkdir(workDir, { recursive: true })

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

    const proc = spawn(resolvedPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      // audio-separator outputs progress like "Progress: 50%"
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

---

### Task 4: Pipeline Integration

Add the vocal separation step to the pipeline orchestrator.

**Files:**
- Modify: `electron/services/pipeline.ts:1-11` (imports), `electron/services/pipeline.ts:21-22` (step counts), `electron/services/pipeline.ts:278-284` (start method), `electron/services/pipeline.ts:396-461` (after TTS, before recombine)

- [ ] **Step 1: Add import for separateVocals**

In `electron/services/pipeline.ts`, add the import after the existing imports (after line 11):

```typescript
import { separateVocals } from './strategies/vocal-separator.js'
```

- [ ] **Step 2: Add TOTAL_STEPS_VOCAL_REMOVAL constant**

In `electron/services/pipeline.ts`, add after the existing step count constants (after line 22):

```typescript
const TOTAL_STEPS_FULL = 6
const TOTAL_STEPS_SUBTITLE_ONLY = 5
const TOTAL_STEPS_VOCAL_REMOVAL = 7
```

- [ ] **Step 3: Adjust totalSteps in start method**

In `electron/services/pipeline.ts`, update the `start` method where `totalSteps` is set. Find:

```typescript
    this.totalSteps = isSubtitleOnly ? TOTAL_STEPS_SUBTITLE_ONLY : TOTAL_STEPS_FULL
```

Replace with:

```typescript
    const useVocalRemoval = !isSubtitleOnly && config.audioMixMode === 'mix-vocal-removal'
    this.totalSteps = isSubtitleOnly
      ? TOTAL_STEPS_SUBTITLE_ONLY
      : useVocalRemoval ? TOTAL_STEPS_VOCAL_REMOVAL : TOTAL_STEPS_FULL
```

- [ ] **Step 4: Add vocal separation step after TTS synthesis**

In `electron/services/pipeline.ts`, after the TTS synthesis block (the closing `}` of the `if (isSubtitleOnly) ... else ...` block, which is `subtitleSegments = translationResult` or the `subtitleSegments = ...` assignment around line 435), add the vocal separation step.

Find this block:

```typescript
      const recombineStep = isSubtitleOnly ? 4 : 5
      this.assertNotCancelled()
      const outputPath = await this.runStep('recombining', recombineStep, async (onProgress, signal) => {
```

Replace with:

```typescript
      let instrumentalPath: string | undefined
      if (!isSubtitleOnly && config.audioMixMode === 'mix-vocal-removal') {
        this.assertNotCancelled()
        instrumentalPath = await this.runStep('separating-vocals', 5, async (onProgress, signal) => {
          const result = await separateVocals({
            audioPath: audio.audioPath,
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
```

- [ ] **Step 5: Pass instrumentalPath to combiner**

In the same `recombining` step, find the `combiner.combine()` call:

```typescript
        const result = await this.strategies.combiner.combine({
          videoPath: download.videoPath,
          audioPath: synthesizedAudioPath,
          subtitlePath,
          outputPath: finalOutputPath,
          onProgress,
          signal,
          speechSegments: config.audioMixMode !== 'replace' && !isSubtitleOnly
            ? subtitleSegments.map(s => ({ start: s.start, end: s.end }))
            : undefined,
        })
```

Replace with:

```typescript
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
```

Note: `speechSegments` is now only passed for `mix-gate` mode (not `mix-vocal-removal`), since vocal removal uses `instrumentalPath` instead.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

---

### Task 5: Combiner — Instrumental Track Support

Update the FFmpeg combiner to handle a third input (instrumental track) for vocal removal mode.

**Files:**
- Modify: `electron/services/strategies/combiners/ffmpeg.ts:15-24` (combine input), `electron/services/strategies/combiners/ffmpeg.ts:33-37` (filter complex), `electron/services/strategies/combiners/ffmpeg.ts:45-57` (FFmpeg command)
- Modify: `electron/services/strategies/combiners/combiner-helpers.ts` (new helper)

- [ ] **Step 1: Add buildVocalRemovalFilterComplex to combiner-helpers.ts**

In `electron/services/strategies/combiners/combiner-helpers.ts`, add the new helper function at the end of the file:

```typescript
export function buildVocalRemovalFilterComplex(
  subtitleFilter: string,
  duration: number
): string {
  return [
    subtitleFilter,
    `[2:a]apad=whole_dur=${duration}[bg]`,
    `[1:a]apad=whole_dur=${duration}[tts]`,
    `[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[a]`,
  ].join(';')
}
```

- [ ] **Step 2: Update FfmpegCombiner to handle instrumentalPath**

In `electron/services/strategies/combiners/ffmpeg.ts`, update the imports to include the new helper:

```typescript
import {
  ffmpegPath, ffprobePath,
  normalizeCombineError, getDuration, timeMarkToSeconds, buildSubtitleFilter,
  buildMixGateFilterComplex,
  buildVocalRemovalFilterComplex,
} from './combiner-helpers.js'
```

- [ ] **Step 3: Update combine method signature and logic**

In `electron/services/strategies/combiners/ffmpeg.ts`, update the `combine` method to accept `instrumentalPath`:

```typescript
  async combine(input: {
    videoPath: string
    audioPath?: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
    speechSegments?: { start: number; end: number }[]
    instrumentalPath?: string
  }): Promise<CombineResult> {
    const { videoPath, audioPath, subtitlePath, outputPath, onProgress, signal, speechSegments, instrumentalPath } = input
```

- [ ] **Step 4: Add vocal removal filter complex logic**

In the same method, find the filter complex selection block:

```typescript
    const useMixGate = this.config.audioMixMode === 'mix-gate' && speechSegments && speechSegments.length > 0

    const filterComplex = useMixGate
      ? buildMixGateFilterComplex(subtitleFilter, speechSegments, duration)
      : `${subtitleFilter};[1:a]apad=whole_dur=${duration}[a]`
```

Replace with:

```typescript
    const useMixGate = this.config.audioMixMode === 'mix-gate' && speechSegments && speechSegments.length > 0
    const useVocalRemoval = this.config.audioMixMode === 'mix-vocal-removal' && !!instrumentalPath

    const filterComplex = useMixGate
      ? buildMixGateFilterComplex(subtitleFilter, speechSegments, duration)
      : useVocalRemoval
        ? buildVocalRemovalFilterComplex(subtitleFilter, duration)
        : `${subtitleFilter};[1:a]apad=whole_dur=${duration}[a]`
```

- [ ] **Step 5: Add instrumental track as FFmpeg input**

In the FFmpeg command construction, find:

```typescript
      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
```

Replace with:

```typescript
      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
      if (useVocalRemoval && instrumentalPath) {
        command.input(instrumentalPath)
      }
      command
```

Wait — `fluent-ffmpeg` chains. We need to adjust. The full block currently is:

```typescript
      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([...])
        .on('progress', ...)
        .on('end', ...)
        .on('error', ...)
        .save(outputPath)
```

Restructure to:

```typescript
      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)

      if (useVocalRemoval && instrumentalPath) {
        command.input(instrumentalPath)
      }

      command
        .outputOptions([
          '-filter_complex', filterComplex,
          '-map', '[v]',
          '-map', '[a]',
          '-c:v', 'libx264',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
        ])
        .on('progress', (info) => {
          const currentTime = info.timemark ? timeMarkToSeconds(info.timemark) : 0
          const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100))
          onProgress(pct)
        })
        .on('end', () => {
          signal?.removeEventListener('abort', onAbort)
          onProgress(100)
          resolve()
        })
        .on('error', (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(normalizeCombineError(error))
        })
        .save(outputPath)
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

---

### Task 6: Settings UI

Enable the vocal removal button and add the audio-separator path input.

**Files:**
- Modify: `src/components/SettingsView.tsx:477-515` (audio mix mode section)

- [ ] **Step 1: Enable the Vocal Removal button**

In `src/components/SettingsView.tsx`, find the disabled vocal removal button (around line 502):

```tsx
                    <button
                      disabled
                      className="flex-1 py-2 px-3 rounded-md text-[13px] font-semibold text-on-surface-variant/40 cursor-not-allowed"
                      title={t('settings.tts.audioMixVocalRemovalHelp')}
                    >
                      {t('settings.tts.audioMixVocalRemoval')}
                    </button>
```

Replace with:

```tsx
                    <button
                      onClick={() => saveConfig({ audioMixMode: 'mix-vocal-removal' })}
                      className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                        config.audioMixMode === 'mix-vocal-removal'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.audioMixVocalRemoval')}
                    </button>
```

- [ ] **Step 2: Fix the "Replace" button active condition**

The current "Replace" button uses `config.audioMixMode !== 'mix-gate'` as the active condition, which was correct when only two modes were enabled. Now with three modes, fix it:

Find:
```tsx
                    <button
                      onClick={() => saveConfig({ audioMixMode: 'replace' })}
                      className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                        config.audioMixMode !== 'mix-gate'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
```

Replace `config.audioMixMode !== 'mix-gate'` with `config.audioMixMode === 'replace'`.

- [ ] **Step 3: Update help text to handle three modes**

Find the help text paragraph (around line 510):

```tsx
                  <p className="text-[12px] text-on-surface-variant mt-2">
                    {config.audioMixMode === 'mix-gate'
                      ? t('settings.tts.audioMixGateHelp')
                      : t('settings.tts.audioMixReplaceHelp')}
                  </p>
```

Replace with:

```tsx
                  <p className="text-[12px] text-on-surface-variant mt-2">
                    {config.audioMixMode === 'mix-gate'
                      ? t('settings.tts.audioMixGateHelp')
                      : config.audioMixMode === 'mix-vocal-removal'
                        ? t('settings.tts.audioMixVocalRemovalHelp')
                        : t('settings.tts.audioMixReplaceHelp')}
                  </p>
```

- [ ] **Step 4: Add audio-separator path input field**

After the audio mix mode section's closing `</div>` (around line 515), before the parent section closes, add:

```tsx
                {config.audioMixMode === 'mix-vocal-removal' && (
                  <div className="mt-4">
                    <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                      {t('settings.tts.audioSeparatorPath')}
                    </label>
                    <input
                      type="text"
                      value={config.audioSeparatorPath || ''}
                      onChange={(e) => saveConfig({ audioSeparatorPath: e.target.value })}
                      placeholder="audio-separator"
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 text-on-surface font-mono text-xs focus:border-primary focus:outline-none transition-colors"
                    />
                    <p className="text-[12px] text-on-surface-variant mt-1">
                      {t('settings.tts.audioSeparatorPathHelp')}
                    </p>
                  </div>
                )}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

---

### Task 7: Typecheck & Final Verification

Full typecheck to verify everything compiles together.

**Files:** All modified files

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: PASS with zero errors

- [ ] **Step 2: Verify file list**

Confirm all files from the spec were created/modified:
- Created: `electron/services/strategies/vocal-separator.ts`
- Modified: `electron/services/types.ts`, `src/types.ts`, `electron/services/config.ts`, `src/store/usePipelineStore.ts`, `electron/services/pipeline.ts`, `electron/services/strategies/combiners/ffmpeg.ts`, `electron/services/strategies/combiners/combiner-helpers.ts`, `src/components/SettingsView.tsx`, `src/i18n/locales/en.ts`, `src/i18n/locales/zh.ts`, `src/components/ProgressView.tsx`

---

## Task Dependencies

```
Task 1 (Types & Config)
  ├──→ Task 2 (i18n)
  ├──→ Task 3 (Vocal Separator)
  ├──→ Task 4 (Pipeline) ← depends on Task 3
  ├──→ Task 5 (Combiner)
  └──→ Task 6 (Settings UI) ← depends on Task 2
Task 7 (Typecheck) ← depends on all
```

Tasks 2, 3, and 5 can run in parallel after Task 1.
Task 4 depends on Task 1 and Task 3.
Task 6 depends on Task 1 and Task 2.
Task 7 depends on all.
