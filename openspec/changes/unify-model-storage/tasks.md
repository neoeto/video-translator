## 1. Backend: Remove model dir config fields

- [x] 1.1 Remove `audioSeparatorModelDir` and `huggingfaceModelDir` from `AppConfig` in `electron/services/types.ts` and `src/types.ts`
- [x] 1.2 Remove `detectAudioSeparatorModelDir()` and `detectHuggingfaceModelDir()` from `electron/services/config.ts`
- [x] 1.3 Remove both fields from `defaultConfig`, schema, `simpleKeys` in `setConfig()` in `electron/services/config.ts`
- [x] 1.4 Remove default values for both fields from `src/store/usePipelineStore.ts`
- [x] 1.5 Remove both fields from test fixtures in `electron/services/dependency-manager.test.ts`

## 2. Backend: Add model path derivation

- [x] 2.1 Add `getModelDirs(outputDir: string)` helper in `electron/services/config.ts` returning `{ audioSeparatorModelDir, huggingfaceModelDir }` derived as `<outputDir>/.system/models/<subdir>`
- [x] 2.2 Update `electron/services/pipeline.ts` to call `getModelDirs(config.outputDir)` and use derived paths instead of config fields for vocal separator and transcriber invocations

## 3. Backend: Add PipelineState detail fields

- [x] 3.1 Add optional `detail?: 'downloading-model'` and `detailMessage?: string` to `PipelineState` in `electron/services/types.ts` and `src/types.ts`
- [x] 3.2 Add a `setDetail(detail, message?)` helper method on the Pipeline class that calls `this.updateState({ detail, detailMessage })`

## 4. Backend: Model download detection — audio-separator

- [x] 4.1 Update `ensureAudioSeparatorModel()` in `electron/services/model-downloader.ts` to accept an `onDetail` callback invoked with `(message: string)` at download start and `(undefined)` at completion
- [x] 4.2 Update `separateVocals()` in `electron/services/strategies/vocal-separator.ts` to wire the `onDetail` callback through to `ensureAudioSeparatorModel`, using the pipeline's `setDetail` to set/clear the download state
- [x] 4.3 Update the pipeline's vocal separation step in `electron/services/pipeline.ts` to pass a `setDetail`-based callback to `separateVocals`

## 5. Backend: Model download detection — Whisper/WhisperX

- [x] 5.1 Add a helper function to detect whether the expected HuggingFace model directory exists under `.system/models/huggingface-cache/hub/` (check for `models--*` directories matching common whisper model names)
- [x] 5.2 Update `local-cli.ts` transcriber to check for model absence before spawning Whisper; if absent, call `setDetail('downloading-model', modelName)` and parse stderr for download lines to update `detailMessage`; clear detail on completion
- [x] 5.3 Update `whisperx.ts` transcriber with the same model absence detection and stderr parsing logic

## 6. Frontend: Remove settings UI for deleted fields

- [x] 6.1 Remove UI inputs for `audioSeparatorModelDir` and `huggingfaceModelDir` from the settings page component
- [x] 6.2 Remove related i18n keys from `src/i18n/locales/en.ts` and `src/i18n/locales/zh.ts`

## 7. Frontend: Download hint in ProgressView

- [x] 7.1 Add i18n keys for model download hint text in `en.ts` and `zh.ts` (e.g. `progress.downloadingModel`)
- [x] 7.2 Update `src/components/ProgressView.tsx` to render a hint line below the progress bar when `state.detail === 'downloading-model'`, showing a download icon and `state.detailMessage`
- [x] 7.3 Ensure the hint line is hidden when `detail` is undefined (normal progress)

## 8. Verification

- [x] 8.1 Verify `electron-vite build` succeeds with no type errors
- [x] 8.2 Verify existing tests in `electron/services/` still pass after config changes
