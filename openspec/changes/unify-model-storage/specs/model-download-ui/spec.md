## ADDED Requirements

### Requirement: Pipeline state includes download detail
The system SHALL support an optional `detail` field on `PipelineState` with value `'downloading-model'` and an accompanying `detailMessage` string to communicate that a model download is in progress within a pipeline stage.

#### Scenario: Audio separator model download
- **WHEN** the pipeline runs the vocal separation stage and the audio-separator model is not yet downloaded
- **THEN** `PipelineState.detail` SHALL be set to `'downloading-model'`
- **AND** `PipelineState.detailMessage` SHALL contain the model name and size information

#### Scenario: Whisper model download detected
- **WHEN** the pipeline runs the transcription stage and the required HuggingFace model is not present in the cache
- **THEN** `PipelineState.detail` SHALL be set to `'downloading-model'`
- **AND** `PipelineState.detailMessage` SHALL contain the model name

#### Scenario: Download completes
- **WHEN** the model download finishes and the pipeline stage continues
- **THEN** `PipelineState.detail` SHALL be cleared (set to `undefined`)
- **AND** `PipelineState.detailMessage` SHALL be cleared

### Requirement: Download hint displayed in progress UI
The `ProgressView` component SHALL display a contextual hint line below the stage progress bar when `PipelineState.detail` equals `'downloading-model'`.

#### Scenario: User sees download hint
- **WHEN** a pipeline stage is active and `state.detail` is `'downloading-model'`
- **THEN** the progress view SHALL show a line below the progress bar with a download icon and the `detailMessage` text

#### Scenario: No download hint when detail is absent
- **WHEN** `state.detail` is `undefined` or any value other than `'downloading-model'`
- **THEN** no download hint line SHALL be rendered

### Requirement: Whisper stderr parsed for download progress
The system SHALL monitor Whisper/WhisperX subprocess stderr for lines indicating HuggingFace download activity and update `detailMessage` accordingly.

#### Scenario: HuggingFace download detected in stderr
- **WHEN** the Whisper subprocess outputs a line containing "Downloading" to stderr
- **THEN** `detailMessage` SHALL be updated to reflect the download activity

#### Scenario: No download lines in stderr
- **WHEN** the Whisper subprocess does not output any download-related lines
- **THEN** `detailMessage` SHALL remain as the initial model name hint
