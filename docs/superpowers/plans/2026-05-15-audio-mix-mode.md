# Audio Mix Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable audio mixing so translated videos can preserve non-speech audio (ambient sounds, background music, sound effects) from the original video.

**Architecture:** New `audioMixMode` config setting with three values: `replace` (current default), `mix-gate` (mute original during speech, keep during non-speech), and `mix-vocal-removal` (future, disabled). The `FfmpegCombiner` uses a volume expression in its filter_complex to create a smooth trapezoidal mute envelope with 30ms fades at speech boundaries. The pipeline passes speech segment timestamps to the combiner.

**Tech Stack:** TypeScript, Electron, React, FFmpeg (volume expression filter), electron-store

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `electron/services/types.ts` | Modify | Add `AudioMixMode` type, update `CombinerStrategy.combine` input, update `AppConfig` |
| `src/types.ts` | Modify | Frontend mirror: add `AudioMixMode`, update `AppConfig` |
| `electron/services/config.ts` | Modify | Add `audioMixMode` to defaults, schema, and `simpleKeys` |
| `electron/services/strategies/combiners/combiner-helpers.ts` | Modify | Add `mergeOverlappingSegments()` and `buildMixGateFilter()` helpers |
| `electron/services/strategies/combiners/ffmpeg.ts` | Modify | Use `config.audioMixMode` to select filter_complex strategy |
| `electron/services/pipeline.ts` | Modify | Pass `speechSegments` to combiner when audioMixMode is not `replace` |
| `src/components/SettingsView.tsx` | Modify | Add audio mix mode selector in TTS tab after sync mode section |
| `src/i18n/locales/en.ts` | Modify | Add 7 English i18n keys |
| `src/i18n/locales/zh.ts` | Modify | Add 7 Chinese i18n keys |

---

### Task 1: Type definitions

**Files:**
- Modify: `electron/services/types.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add AudioMixMode type and update backend types**

In `electron/services/types.ts`, add the new type after the existing `PipelineMode` type (line 185):

```typescript
export type AudioMixMode = 'replace' | 'mix-gate' | 'mix-vocal-removal'
```

Update `CombinerStrategy.combine` input to accept `speechSegments` (around line 131):

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
  }): Promise<CombineResult>
}
```

Add `audioMixMode` to `AppConfig` (after `pipelineMode` on line 213):

```typescript
  audioMixMode: AudioMixMode
```

- [ ] **Step 2: Update frontend types**

In `src/types.ts`, add after the `PipelineMode` type (line 66):

```typescript
export type AudioMixMode = 'replace' | 'mix-gate' | 'mix-vocal-removal'
```

Add `audioMixMode` to `AppConfig` (after `pipelineMode` on line 90):

```typescript
  audioMixMode: AudioMixMode
```

- [ ] **Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: Type errors in `config.ts` (missing default/schema for `audioMixMode`) and possibly `ffmpeg.ts` — this is expected, fixed in later tasks.

---

### Task 2: Config persistence

**Files:**
- Modify: `electron/services/config.ts`

- [ ] **Step 1: Add audioMixMode to defaultConfig**

In `electron/services/config.ts`, add to `defaultConfig` object (after `pipelineMode: 'full'` on line 70):

```typescript
  audioMixMode: 'replace' as const,
```

- [ ] **Step 2: Add audioMixMode to schema**

Add to the `schema` object inside `new Store<AppConfig>({...})`, after the `pipelineMode` schema entry (after line 173):

```typescript
    audioMixMode: {
      type: 'string',
      enum: ['replace', 'mix-gate', 'mix-vocal-removal'],
      default: defaultConfig.audioMixMode,
    },
```

- [ ] **Step 3: Add audioMixMode to simpleKeys**

Add `'audioMixMode'` to the `simpleKeys` array (after `'pipelineMode'` on line 232):

```typescript
    'audioMixMode',
```

---

### Task 3: i18n keys

**Files:**
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh.ts`

- [ ] **Step 1: Add English keys**

In `src/i18n/locales/en.ts`, add after the `'settings.tts.syncStrictHelp'` entry (line 123):

```typescript
  'settings.tts.audioMixMode': 'Audio Mix',
  'settings.tts.audioMixReplace': 'Replace Original',
  'settings.tts.audioMixReplaceHelp': 'Fully replace original audio with synthesized speech.',
  'settings.tts.audioMixGate': 'Preserve Background',
  'settings.tts.audioMixGateHelp': 'Keep ambient sounds and music, replace speech segments with translation.',
  'settings.tts.audioMixVocalRemoval': 'Vocal Removal',
  'settings.tts.audioMixVocalRemovalHelp': 'Coming soon',
```

- [ ] **Step 2: Add Chinese keys**

In `src/i18n/locales/zh.ts`, add after the `'settings.tts.syncStrictHelp'` entry (line 125):

```typescript
  'settings.tts.audioMixMode': '音频混合',
  'settings.tts.audioMixReplace': '替换原声',
  'settings.tts.audioMixReplaceHelp': '用合成语音完全替换原始音频。',
  'settings.tts.audioMixGate': '保留背景音',
  'settings.tts.audioMixGateHelp': '保留环境音和音乐，语音时段替换为翻译。',
  'settings.tts.audioMixVocalRemoval': '人声分离',
  'settings.tts.audioMixVocalRemovalHelp': '即将推出',
```

---

### Task 4: Combiner helpers — merge segments and build mix-gate filter

**Files:**
- Modify: `electron/services/strategies/combiners/combiner-helpers.ts`

- [ ] **Step 1: Add mergeOverlappingSegments helper**

Append to the end of `combiner-helpers.ts`:

```typescript
/**
 * Merges overlapping or nearly-adjacent speech segments into non-overlapping intervals.
 * Segments within `gap` seconds of each other are merged to avoid tiny unmuted windows.
 */
export function mergeOverlappingSegments(
  segments: { start: number; end: number }[],
  gap = 0.06,
): { start: number; end: number }[] {
  if (segments.length === 0) return []

  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const last = merged[merged.length - 1]

    if (current.start <= last.end + gap) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}
```

- [ ] **Step 2: Add buildMixGateFilter helper**

Append after `mergeOverlappingSegments`:

```typescript
const FADE_DURATION = 0.03 // 30ms fade at segment boundaries

/**
 * Builds a volume expression that mutes the original audio during speech segments
 * with 30ms linear fades at each boundary to prevent audio pops.
 *
 * The expression creates a trapezoidal envelope per segment:
 *   volume = 1 outside speech, fades to 0 over 30ms at start, stays 0, fades back to 1 over 30ms at end.
 *
 * @returns The full volume filter string, e.g. `volume='<expr>':eval=frame`
 */
function buildVolumeExpression(segments: { start: number; end: number }[]): string {
  if (segments.length === 0) return "volume=1"

  // Build per-segment trapezoidal gate expressions
  // Gate(t, s, e) = rampUp(t, s-fade, s) * rampDown(t, e, e+fade)
  //   rampUp   = min(1, max(0, (t - (s - fade)) / fade))
  //   rampDown = min(1, max(0, ((e + fade) - t) / fade))
  // Gate is 1 during segment, 0 outside, linear ramp at edges
  const gateExprs = segments.map(({ start, end }) => {
    const fadeInStart = Math.max(0, start - FADE_DURATION).toFixed(4)
    const fadeOutEnd = (end + FADE_DURATION).toFixed(4)
    const invFade = (1 / FADE_DURATION).toFixed(2)
    const rampUp = `min(1,max(0,(t-${fadeInStart})*${invFade}))`
    const rampDown = `min(1,max(0,(${fadeOutEnd}-t)*${invFade}))`
    return `${rampUp}*${rampDown}`
  })

  // Combine gates with nested max() — union of all speech windows
  let combined = gateExprs[0]
  for (let i = 1; i < gateExprs.length; i++) {
    combined = `max(${combined},${gateExprs[i]})`
  }

  // Volume = 1 - gate (invert: mute during speech, pass during non-speech)
  return `volume='1-${combined}':eval=frame`
}

/**
 * Builds the full filter_complex string for mix-gate mode.
 * Mutes original audio during speech, pads TTS to video duration, and mixes both.
 */
export function buildMixGateFilterComplex(
  subtitleFilter: string,
  speechSegments: { start: number; end: number }[],
  duration: number,
): string {
  const merged = mergeOverlappingSegments(speechSegments)
  const volumeFilter = buildVolumeExpression(merged)

  return [
    subtitleFilter,
    `[0:a]${volumeFilter}[bg]`,
    `[1:a]apad=whole_dur=${duration}[tts]`,
    `[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[a]`,
  ].join(';')
}
```

---

### Task 5: FfmpegCombiner — mix-gate filter integration

**Files:**
- Modify: `electron/services/strategies/combiners/ffmpeg.ts`

- [ ] **Step 1: Import new helper and update combine method**

Add `buildMixGateFilterComplex` to the imports from `combiner-helpers.js` (line 6):

```typescript
import {
  ffmpegPath, ffprobePath,
  normalizeCombineError, getDuration, timeMarkToSeconds, buildSubtitleFilter,
  buildMixGateFilterComplex,
} from './combiner-helpers.js'
```

- [ ] **Step 2: Update combine method signature and filter logic**

Replace the `combine` method's input type and filter_complex construction. The full updated `combine` method:

```typescript
  async combine(input: {
    videoPath: string
    audioPath?: string
    subtitlePath: string
    outputPath: string
    onProgress: (pct: number) => void
    signal?: AbortSignal
    speechSegments?: { start: number; end: number }[]
  }): Promise<CombineResult> {
    const { videoPath, audioPath, subtitlePath, outputPath, onProgress, signal, speechSegments } = input

    if (!audioPath) throw new Error('FfmpegCombiner requires audioPath for full translation mode')
    if (!ffmpegPath || !ffprobePath) throw new Error('ffmpeg binary not found')

    const duration = await getDuration(videoPath)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    const subtitleFilter = buildSubtitleFilter(subtitlePath)

    const useMixGate = this.config.audioMixMode === 'mix-gate' && speechSegments && speechSegments.length > 0

    const filterComplex = useMixGate
      ? buildMixGateFilterComplex(subtitleFilter, speechSegments, duration)
      : `${subtitleFilter};[1:a]apad=whole_dur=${duration}[a]`

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Pipeline cancelled'))
        return
      }

      const command = ffmpeg()
        .input(videoPath)
        .input(audioPath)
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

      const onAbort = () => {
        command.kill('SIGTERM')
        reject(new Error('Pipeline cancelled'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })

    return { outputPath }
  }
```

---

### Task 6: Pipeline — pass speech segments to combiner

**Files:**
- Modify: `electron/services/pipeline.ts`

- [ ] **Step 1: Pass speechSegments in combiner call**

In `pipeline.ts`, update the `combiner.combine()` call (around line 450). Replace the existing call:

```typescript
        const result = await this.strategies.combiner.combine({
          videoPath: download.videoPath,
          audioPath: synthesizedAudioPath,
          subtitlePath,
          outputPath: finalOutputPath,
          onProgress,
          signal,
        })
```

With:

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

Note: `subtitleSegments` is used (not `translationResult`) because in natural sync mode, `subtitleSegments` contains the actual TTS-adjusted timing that matches when TTS audio plays. In strict mode, both are identical.

---

### Task 7: Settings UI — audio mix mode selector

**Files:**
- Modify: `src/components/SettingsView.tsx`

- [ ] **Step 1: Add audio mix mode selector after sync mode section**

In `SettingsView.tsx`, locate the sync mode section that ends with the `</p>` tag after the `syncNaturalHelp`/`syncStrictHelp` text (around line 474-475, right before `</div>` and `</section>`). Add a new section after the sync mode help text `</p>` and before the closing `</div>` of the TTS tab content:

```tsx
                <div className="mt-6 pt-6 border-t border-outline-variant/30">
                  <label className="block text-[11px] font-semibold text-on-surface-variant mb-2 uppercase tracking-wider">
                    {t('settings.tts.audioMixMode')}
                  </label>
                  <div className="flex bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/50">
                    <button
                      onClick={() => saveConfig({ audioMixMode: 'replace' })}
                      className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                        config.audioMixMode !== 'mix-gate'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.audioMixReplace')}
                    </button>
                    <button
                      onClick={() => saveConfig({ audioMixMode: 'mix-gate' })}
                      className={`flex-1 py-2 px-3 rounded-md text-[13px] font-semibold transition-all ${
                        config.audioMixMode === 'mix-gate'
                          ? 'bg-surface-variant text-on-surface shadow-sm border border-outline-variant/50'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {t('settings.tts.audioMixGate')}
                    </button>
                    <button
                      disabled
                      className="flex-1 py-2 px-3 rounded-md text-[13px] font-semibold text-on-surface-variant/40 cursor-not-allowed"
                      title={t('settings.tts.audioMixVocalRemovalHelp')}
                    >
                      {t('settings.tts.audioMixVocalRemoval')}
                    </button>
                  </div>
                  <p className="text-[12px] text-on-surface-variant mt-2">
                    {config.audioMixMode === 'mix-gate'
                      ? t('settings.tts.audioMixGateHelp')
                      : t('settings.tts.audioMixReplaceHelp')}
                  </p>
                </div>
```

---

### Task 8: Typecheck and verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: All checks pass with no errors.

- [ ] **Step 2: Verify the FFmpeg filter string format**

Manually verify the generated filter_complex for a sample input by adding a temporary log. In `ffmpeg.ts`, temporarily add before the `new Promise`:

```typescript
console.log('[FfmpegCombiner] filter_complex:', filterComplex)
```

Run a test translation with `audioMixMode: 'mix-gate'` and verify the filter_complex looks correct in the console output. The filter should look like:

```
[0:v]subtitles=...[v];[0:a]volume='1-max(min(1,max(0,(t-0.4700)*33.33))*min(1,max(0,(3.2300-t)*33.33)),min(1,max(0,(t-5.0700)*33.33))*min(1,max(0,(8.7300-t)*33.33)))':eval=frame[bg];[1:a]apad=whole_dur=120[tts];[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[a]
```

Remove the temporary log after verification.

---

## Task Dependencies

```
Task 1 (Types) ──→ Task 2 (Config) ──→ Task 5 (Combiner)
     │                                       ↑
     ├──→ Task 3 (i18n) ──→ Task 7 (UI)     │
     │                                       │
     └──→ Task 4 (Helpers) ─────────────────→┘
                                              │
                                              ↓
Task 6 (Pipeline) ──→ Task 8 (Typecheck)
```

Parallelizable groups:
- **Group A**: Task 2 + Task 3 + Task 4 (all depend only on Task 1)
- **Group B**: Task 5 + Task 7 (depend on Group A results)
- **Sequential**: Task 6 → Task 8 (final integration + verification)

## Notes

- The `FfmpegSubtitleOnlyCombiner` does NOT need changes — it preserves original audio already and is only used in subtitle-only mode where audio mixing is not applicable.
- The `volume` expression uses `eval=frame` for per-frame evaluation, ensuring smooth 30ms fades.
- Segments are merged with a 60ms gap tolerance before building the filter, preventing rapid mute/unmute toggling for closely-spaced segments.
- The expression length for 200 segments is ~12KB, well within FFmpeg's ~65KB expression limit.
- `audioMixMode: 'mix-vocal-removal'` is defined in types but NOT implemented — the UI button is disabled. This is intentional for future expansion.
- User preference: no automatic git commits.
