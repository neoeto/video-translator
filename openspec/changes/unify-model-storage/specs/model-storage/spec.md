## ADDED Requirements

### Requirement: Model directories derived from outputDir
The system SHALL derive all model storage paths from the user-configured `outputDir` setting. The derived paths SHALL be `<outputDir>/.system/models/audio-separator/` for audio-separator models and `<outputDir>/.system/models/huggingface-cache/` for HuggingFace model caches.

#### Scenario: Default model paths on fresh install
- **WHEN** the application starts with a default `outputDir` of `~/Videos/video-translator`
- **THEN** audio-separator models SHALL be stored at `~/Videos/video-translator/.system/models/audio-separator/`
- **AND** HuggingFace caches SHALL be stored at `~/Videos/video-translator/.system/models/huggingface-cache/`

#### Scenario: Model paths follow outputDir changes
- **WHEN** the user changes `outputDir` to a new location
- **THEN** subsequent pipeline runs SHALL use the new derived model paths
- **AND** previously downloaded models in the old location SHALL NOT be migrated

### Requirement: No independent model dir config fields
The system SHALL NOT expose `audioSeparatorModelDir` or `huggingfaceModelDir` as configurable settings. These paths SHALL only be computed from `outputDir`.

#### Scenario: Config no longer contains model dir fields
- **WHEN** the application configuration is loaded
- **THEN** `AppConfig` SHALL NOT include `audioSeparatorModelDir` or `huggingfaceModelDir` fields
- **AND** the settings UI SHALL NOT render inputs for these fields

### Requirement: Model directories created on demand
The system SHALL create `.system/models/audio-separator/` and `.system/models/huggingface-cache/` directories automatically when a pipeline stage needs to write to them.

#### Scenario: First pipeline run creates directories
- **WHEN** a pipeline stage requires a model directory that does not exist
- **THEN** the system SHALL create the full directory path including `.system/models/` and the appropriate subdirectory
