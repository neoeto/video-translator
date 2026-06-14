## Why

Model files (audio-separator `.ckpt`, HuggingFace whisper/pyannote caches) are currently stored under the project's `resources/` directory, which is tied to the installation path. When the app is packaged, these large files end up in the install directory — hard to manage, impossible for users to control, and disconnected from the user-configurable `outputDir`. Additionally, when models are being downloaded during pipeline execution, the UI only shows a vague stage name and percentage (e.g. "transcribing 2%"), leaving users unaware that a large model download is in progress.

## What Changes

- **BREAKING**: Remove `audioSeparatorModelDir` and `huggingfaceModelDir` from `AppConfig`. Both paths will be derived from `outputDir` as `<outputDir>/.system/models/audio-separator/` and `<outputDir>/.system/models/huggingface-cache/`.
- Add a `getModelDirs(outputDir)` helper that returns both derived paths, used throughout the backend.
- Remove the two path config fields from the settings UI and all related i18n keys.
- Add optional `detail` and `detailMessage` fields to `PipelineState` to communicate sub-state information (e.g. "downloading model").
- Show a contextual hint line below the progress bar in `ProgressView` when `detail === 'downloading-model'`, indicating which model is being downloaded.
- Detect model absence before Whisper/WhisperX runs and set the downloading-model detail; parse HuggingFace download progress from subprocess stderr when possible.
- Enhance `model-downloader.ts` (audio-separator) to set downloading-model detail with file size information.

## Capabilities

### New Capabilities
- `model-storage`: Centralized model file storage under `outputDir/.system/models/` with path derivation and directory management.
- `model-download-ui`: UI feedback when models are being downloaded during pipeline execution, including model name and download progress hints.

### Modified Capabilities
_(none — no existing specs to modify)_

## Impact

- **Backend config**: `electron/services/config.ts` — remove two detect functions and two config fields; add `getModelDirs()`.
- **Backend types**: `electron/services/types.ts`, `src/types.ts` — remove fields from `AppConfig`.
- **Pipeline**: `electron/services/pipeline.ts` — use derived paths instead of config fields; set `detail`/`detailMessage` during model-heavy stages.
- **Model downloader**: `electron/services/model-downloader.ts` — accept callback to report download detail.
- **Vocal separator**: `electron/services/strategies/vocal-separator.ts` — receive derived path, report download detail.
- **Transcribers**: `electron/services/strategies/transcribers/local-cli.ts`, `whisperx.ts` — detect missing HuggingFace models, report download detail, parse stderr for progress.
- **Frontend store**: `src/store/usePipelineStore.ts` — remove default values for deleted fields.
- **Frontend UI**: `src/components/ProgressView.tsx` — render download hint line.
- **i18n**: `src/i18n/locales/en.ts`, `zh.ts` — remove old keys, add new download hint keys.
- **Frontend settings**: Remove UI inputs for the two deleted config fields.
