# Audio Mix Mode Design

## Problem

The current pipeline completely replaces the original video audio with TTS-synthesized speech. All non-speech audio (ambient sounds, background music, sound effects) is lost in the translated output.

## Approach

Add a configurable `audioMixMode` setting with two modes:

1. **mix-gate** (implemented first): Mute original audio during speech segments, keep it at full volume during non-speech gaps, overlay TTS on top.
2. **mix-vocal-removal** (future): Use AI vocal separation (Demucs/UVR) to remove original vocals, keep accompaniment, overlay TTS.

The existing `replace` mode remains the default for backward compatibility.

## Configuration

### New Type

```typescript
export type AudioMixMode = 'replace' | 'mix-gate' | 'mix-vocal-removal'
```

### AppConfig Addition

```typescript
audioMixMode: AudioMixMode  // default: 'replace'
```

- Added to `simpleKeys` in `config.ts` for persistence
- Added to config schema with enum validation

## CombinerStrategy Interface Change

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
    speechSegments?: { start: number; end: number }[]  // NEW
  }): Promise<CombineResult>
}
```

- `speechSegments` is optional — only required for `mix-gate` and `mix-vocal-removal` modes
- The pipeline extracts `{ start, end }` from `translationResult.segments` and passes them to the combiner

## Mix-Gate FFmpeg Filter

When `audioMixMode === 'mix-gate'`, the combiner builds a filter_complex that:

1. Mutes original audio during speech segments
2. Adds 30ms fade at segment boundaries to prevent audio pops
3. Pads TTS audio to video duration
4. Mixes processed original audio with TTS

### Filter Structure

```
[0:v]subtitles=path/to/subs[v];
[0:a]volume=0:enable='between(t,s1,e1)+between(t,s2,e2)+...',afade=...[bg];
[1:a]apad=whole_dur=DURATION[tts];
[bg][tts]amix=inputs=2:duration=first:dropout_transition=0[a]
```

### Boundary Fade Detail

For each speech segment `(start, end)`, apply a volume envelope:
- **Fade out** (30ms): original audio fades from 1→0 starting at `start - 0.03`
- **Silence**: volume = 0 from `start` to `end`
- **Fade in** (30ms): original audio fades from 0→1 ending at `end + 0.03`

Implementation uses `volume` filter with `enable` expression containing `between()` calls for each speech segment. The 30ms fade is achieved by extending the between() window slightly and using the `volume` filter's built-in interpolation, or by chaining `afade` filters at each boundary.

Practical approach: use `volume=0:enable='...'` for hard gating, then apply a single `highpass=f=10` or similar to soften transitions. Alternatively, use a series of `afade` pairs (fade-out then fade-in) around each segment.

**Chosen approach**: Extend each segment's between() window by 30ms on each side and use `volume` with smooth `enable` expression. The volume filter's `eval=frame` ensures per-frame evaluation for smooth transitions.

### Edge Cases

- **No speech segments**: Original audio passes through unchanged; TTS is silent/empty
- **Many segments (100+)**: The `between()` expression may be long (~5000 chars for 200 segments) but FFmpeg supports expressions up to ~65536 chars
- **Overlapping segments**: Merge overlapping/adjacent speech segments before building the filter to avoid redundant `between()` clauses
- **Segment at video start (t=0)**: No fade-out needed, start with volume=0
- **Segment at video end**: No fade-in needed after segment ends

## Pipeline Changes

In `pipeline.ts`, when calling `combiner.combine()`:

```typescript
const result = await this.strategies.combiner.combine({
  videoPath: download.videoPath,
  audioPath: synthesizedAudioPath,
  subtitlePath,
  outputPath: finalOutputPath,
  onProgress,
  signal,
  // NEW: pass speech segment times for mix-gate mode
  speechSegments: config.audioMixMode !== 'replace'
    ? translationResult.map(s => ({ start: s.start, end: s.end }))
    : undefined,
})
```

## Data Flow

```
Before:
  Video ──→ Combiner ──→ Output (TTS replaces original audio)
  TTS   ──↗

After (mix-gate):
  Video ──────────→ Combiner ──→ Output (mixed audio)
  TTS   ──────────↗     │
  speechSegments ─↗     │
                         ↓
              [0:a] mute during speech ──→ amix ──→ [a]
              [1:a] pad to duration    ──↗
```

## UI Changes

Add an "Audio Mix Mode" selector in the settings panel, positioned after the TTS mode selector:

- 🔄 **替换原声 (Replace)** — default, current behavior
- 🎵 **保留背景音 (Mix-Gate)** — mute original during speech, keep ambient/music
- 🎤 **人声分离 (Vocal Removal)** — disabled, shows "即将推出 / Coming soon"

The selector is only visible when `pipelineMode === 'full'` (not applicable to subtitle-only mode).

## i18n Keys

```
audioMixMode: '音频混合' / 'Audio Mix'
audioMixReplace: '替换原声' / 'Replace Original'
audioMixReplaceHelp: '用合成语音完全替换原始音频' / 'Fully replace original audio with synthesized speech'
audioMixGate: '保留背景音' / 'Preserve Background'
audioMixGateHelp: '保留环境音和音乐，语音时段替换为翻译' / 'Keep ambient sounds and music, replace speech segments with translation'
audioMixVocalRemoval: '人声分离' / 'Vocal Removal'
audioMixVocalRemovalHelp: '即将推出' / 'Coming soon'
```

## Files to Modify

1. `electron/services/types.ts` — Add `AudioMixMode`, update `CombinerStrategy`, update `AppConfig`
2. `src/types.ts` — Frontend mirror of type additions
3. `electron/services/config.ts` — Add to schema, defaults, and `simpleKeys`
4. `electron/services/strategies/combiners/ffmpeg.ts` — Implement mix-gate filter logic
5. `electron/services/pipeline.ts` — Pass `speechSegments` to combiner
6. `src/components/SettingsView.tsx` — Add audio mix mode selector (or InputView if settings are there)
7. `src/i18n/locales/zh.ts` — Add Chinese i18n keys
8. `src/i18n/locales/en.ts` — Add English i18n keys

## Future: mix-vocal-removal Mode

When implementing mode B (vocal removal) later:
- Add a new pipeline step between extraction and TTS to run Demucs/UVR
- Split original audio into vocals + accompaniment
- Discard vocals, keep accompaniment
- The combiner would then mix accompaniment + TTS (no need for volume gating)
- This would require Demucs as an external dependency (~1GB model download)

## Not In Scope

- Automatic volume normalization (loudness matching between TTS and original)
- User-configurable volume levels for original vs TTS audio
- Real-time audio preview
