# Vocal Separation Mode Design (mix-vocal-removal)

**Date:** 2026-05-15
**Status:** Draft

## Problem

The `mix-gate` audio mix mode uses volume gating to mute original audio during speech segments, preserving background sounds. However, this approach has a limitation: the original vocal audio is only muted during detected speech segments, which may not perfectly align with actual speech boundaries. The `mix-vocal-removal` mode uses AI-powered vocal separation to cleanly extract the instrumental/background track, providing a higher quality result.

## Solution

Integrate `audio-separator` (python-audio-separator) as an external CLI tool to perform vocal/instrumental separation. The instrumental track replaces the original audio as background, mixed with the TTS audio.

## Tool: audio-separator

- **Package**: [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)
- **Install**: `pip install "audio-separator[cpu]"` (macOS CoreML) / `pip install "audio-separator[gpu]"` (Windows CUDA)
- **CLI**: `audio-separator <input> --model_filename <model> --output_dir <dir>`
- **Output**: Two files — `<name>_(Vocals).wav` and `<name>_(Instrumental).wav`
- **Model**: Hardcoded default `model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt` (~105MB, auto-downloaded on first use)
- **Cross-platform**: macOS (CoreML), Windows (CPU/CUDA), Linux (CPU/CUDA)

## Dependency Management

Same pattern as WhisperX:

1. User installs `audio-separator` themselves via pip
2. App auto-detects the binary path:
   - macOS/Linux: Check `.venv/bin/audio-separator`, then `which audio-separator`
   - Windows: Check `.venv\Scripts\audio-separator.exe`, then `where audio-separator`
3. User can manually configure the path in Settings
4. New config field: `audioSeparatorPath: string`

## Pipeline Position

Serial, after TTS synthesis, before final combining:

```
Download → Extract Audio → STT → Translate → TTS → [Vocal Separation] → Combine
```

The vocal separation step only runs when `audioMixMode === 'mix-vocal-removal'`.

## Architecture

### New File: `electron/services/strategies/vocal-separator.ts`

```typescript
export async function separateVocals(input: {
  audioPath: string
  workDir: string
  audioSeparatorPath: string
  onProgress?: (pct: number) => void
  signal?: AbortSignal
}): Promise<{ instrumentalPath: string }>
```

Implementation:
- Spawn `audio-separator` CLI as child process
- Args: `<audioPath> --model_filename model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt --output_dir <workDir>`
- Parse stdout for progress (audio-separator outputs progress information)
- On completion, glob for `*_(Instrumental).*` in workDir
- Return the instrumental file path
- Handle errors: ENOENT (not installed), non-zero exit code, missing output file

### Config Changes

**`electron/services/types.ts`** — Add to `AppConfig`:
```typescript
audioSeparatorPath: string
```

**`src/types.ts`** — Mirror the same field.

**`electron/services/config.ts`**:
- Add `detectAudioSeparatorPath()` function (cross-platform, same pattern as WhisperX)
- Add `audioSeparatorPath` to `defaultConfig` with detected path
- Add `audioSeparatorPath` to schema (type: string)
- Add `audioSeparatorPath` to `simpleKeys` array

**`src/store/usePipelineStore.ts`**:
- Add `audioSeparatorPath: ''` to initial config state

### Pipeline Changes

**`electron/services/pipeline.ts`**:

When `audioMixMode === 'mix-vocal-removal'` and not subtitle-only:

1. After TTS synthesis, run vocal separation as a new step
2. Adjust `TOTAL_STEPS_FULL` conditionally: 6 (normal) → 7 (with vocal separation)
3. Pass `instrumentalPath` to combiner instead of `speechSegments`

```typescript
// After TTS synthesis, before recombining
if (config.audioMixMode === 'mix-vocal-removal' && !isSubtitleOnly) {
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
```

### PipelineStage

Add `'separating-vocals'` to `PipelineStage` type.

### Combiner Changes

**`electron/services/types.ts`** — Add to `CombinerStrategy.combine` input:
```typescript
instrumentalPath?: string
```

**`electron/services/strategies/combiners/ffmpeg.ts`**:

When `audioMixMode === 'mix-vocal-removal'` and `instrumentalPath` is provided:

```
Filter complex:
[0:v]subtitles=...[v];
[2:a]apad=whole_dur=DURATION[bg];
[1:a]apad=whole_dur=DURATION[tts];
[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[a]
```

- Input 0: original video (video stream only)
- Input 1: TTS audio
- Input 2: instrumental track (new input)
- No volume gating needed — vocals already removed

### Settings UI

**`src/components/SettingsView.tsx`**:

1. Enable the "Vocal Removal" button when `audioSeparatorPath` points to a valid binary
2. When `audioMixMode === 'mix-vocal-removal'` is selected, show the help text explaining the mode
3. Add `audio-separator path` input field in the TTS settings section (similar to WhisperX path)

The button enable logic:
- `audioSeparatorPath` is non-empty AND not the default fallback `'audio-separator'` (unless it exists on PATH)
- Simpler approach: always enable the button, validate at pipeline start

Decision: **Always enable the button.** If audio-separator is not found, the pipeline will fail with a clear error message at the vocal separation step, same as WhisperX.

### i18n

**New keys:**

English (`en.ts`):
```
'settings.tts.audioMixVocalRemovalHelp': 'Use AI vocal separation to cleanly remove original speech, preserving all background audio. Requires audio-separator.'
'settings.tts.audioSeparatorPath': 'audio-separator Path'
'settings.tts.audioSeparatorPathHelp': 'Path to audio-separator CLI. Install with: pip install "audio-separator[cpu]"'
'progress.separatingVocals': 'Separating vocals...'
```

Chinese (`zh.ts`):
```
'settings.tts.audioMixVocalRemovalHelp': '使用 AI 人声分离技术，干净地移除原始语音，保留所有背景音频。需要安装 audio-separator。'
'settings.tts.audioSeparatorPath': 'audio-separator 路径'
'settings.tts.audioSeparatorPathHelp': 'audio-separator 命令路径。安装方式：pip install "audio-separator[cpu]"'
'progress.separatingVocals': '正在分离人声...'
```

### Error Handling

1. **audio-separator not found (ENOENT)**: Throw error with message: "audio-separator not found at '<path>'. Install with: pip install \"audio-separator[cpu]\"" and configure the path in Settings.
2. **Non-zero exit code**: Throw error with stderr output.
3. **Missing output file**: List actual files in workDir, throw descriptive error.
4. **Model download on first use**: The ~105MB model auto-downloads. Progress may show as stalled during download. No special UX handling — the CLI handles download progress internally.
5. **Cancellation**: Kill the child process on abort signal.

### Caching

The instrumental track output can be cached in the work directory. Since the audio file is the same across runs (same video), the vocal separation result is deterministic. No additional cache fingerprint logic needed — the work directory already serves as a natural cache boundary.

## Files Changed

### New:
- `electron/services/strategies/vocal-separator.ts` — Vocal separation utility

### Modified:
- `electron/services/types.ts` — `audioSeparatorPath` in AppConfig, `instrumentalPath` in CombinerStrategy, `'separating-vocals'` in PipelineStage
- `src/types.ts` — Frontend mirror of `audioSeparatorPath` and PipelineStage
- `electron/services/config.ts` — `detectAudioSeparatorPath()`, defaults, schema, simpleKeys
- `src/store/usePipelineStore.ts` — Initial config state
- `electron/services/pipeline.ts` — Vocal separation step, dynamic step count
- `electron/services/strategies/combiners/ffmpeg.ts` — instrumental track input handling
- `src/components/SettingsView.tsx` — Enable vocal removal button, add audio-separator path input
- `src/i18n/locales/en.ts` — New i18n keys
- `src/i18n/locales/zh.ts` — New i18n keys
