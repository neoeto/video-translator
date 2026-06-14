## Context

The app is an Electron-based video translator with a multi-stage pipeline (download → extract → transcribe → translate → synthesize → recombine). Several stages depend on large model files:

1. **audio-separator** — downloads a `.ckpt` file (~115 MB) via `model-downloader.ts` into a configurable `audioSeparatorModelDir`
2. **Whisper/WhisperX** — downloads HuggingFace models (hundreds of MB to GB) into a configurable `huggingfaceModelDir` (used as `HF_HOME`)

Currently, both paths default to `resources/` under the project root (hardcoded in `detectAudioSeparatorModelDir()` and `detectHuggingfaceModelDir()` in `config.ts`). The user-configurable `outputDir` field only controls where final video outputs go.

Pipeline progress is communicated via `PipelineState { stage, progress, overallProgress, ... }` through callbacks → IPC → frontend `ProgressView`. There is no sub-state mechanism to indicate what's happening inside a stage (e.g. "downloading model").

## Goals / Non-Goals

**Goals:**
- Consolidate all model file storage under `<outputDir>/.system/models/` so users control model location via a single setting
- Remove `audioSeparatorModelDir` and `huggingfaceModelDir` config fields — paths derived from `outputDir`
- Provide UI feedback when model downloads are occurring during pipeline execution
- Surface download hints for both audio-separator (managed download) and Whisper/WhisperX (HuggingFace black-box download)

**Non-Goals:**
- Migration of existing model files from old paths (users re-download on first use)
- Download progress bars for HuggingFace models (only a text hint; HuggingFace download progress is not reliably parseable)
- Changing the download mechanism itself (same CDN mirrors, same `model-downloader.ts` logic)

## Decisions

### D1: Path derivation via helper function

Create `getModelDirs(outputDir: string)` in `config.ts` returning:

```
{
  audioSeparatorModelDir: path.join(outputDir, '.system', 'models', 'audio-separator'),
  huggingfaceModelDir: path.join(outputDir, '.system', 'models', 'huggingface-cache'),
}
```

**Why a function rather than computed fields on config?** The config is persisted via `electron-store`. Derived values should not be stored. Computing on read avoids stale values when `outputDir` changes.

### D2: Extend PipelineState with optional detail fields

Add to `PipelineState`:
```typescript
detail?: 'downloading-model'
detailMessage?: string  // e.g. "Downloading whisper-large-v3..."
```

These are ephemeral — set during model download, cleared when download completes or stage progresses. Not persisted.

**Why not a new PipelineStage?** "downloading-model" is a sub-state of "transcribing" or "separating-vocals". Making it a separate stage would break the stage progression UI (step indicators) and the overall progress calculation. A detail hint is less disruptive.

### D3: Detecting HuggingFace model absence for Whisper

Before spawning Whisper/WhisperX, check if the expected model directory exists under `.system/models/huggingface-cache/hub/models--*/`. If the expected model dir is absent:
- Set `detail: 'downloading-model'` with model name in `detailMessage`
- Parse Whisper stderr for download-related lines (e.g. lines containing "Downloading" or "download") to update `detailMessage`
- Clear `detail` when the process completes

**Why not pre-download?** HuggingFace model download is triggered by the `transformers`/`faster-whisper` library internally. We don't control the download mechanism. We can only detect absence and show a hint.

### D4: Frontend renders hint below progress bar

In `ProgressView`, when `state.detail === 'downloading-model'`:
- Show a line below the progress bar with a download icon and `state.detailMessage`
- Style: subtle, informative, not blocking the main progress display
- i18n keys for the hint text

## Risks / Trade-offs

- **[Users must re-download models]** → Acceptable for a config restructuring. Models are cacheable; re-download is one-time. Old files in `resources/` can be manually deleted.
- **[HuggingFace download progress is unreliable to parse]** → Mitigation: show a static "Downloading model..." hint without exact percentage for HF models. Users at least know why progress is stalled.
- **[outputDir on network/removable drive]** → Model access could be slow. This is user's choice; no special handling.
- **[.system folder visible on Windows]** → Acceptable. Users familiar with hidden folders understand the convention. No extra Windows-specific hiding logic.
