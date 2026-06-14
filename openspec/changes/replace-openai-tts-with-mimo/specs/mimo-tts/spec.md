## ADDED Requirements

### Requirement: MiMo TTS engine registration
The system SHALL register a MiMo TTS engine selectable via `ttsMode: 'mimo'` in the synthesizer factory. The `TtsMode` type SHALL be `'edge' | 'mimo' | 'indextts'`.

#### Scenario: Factory selects MiMo synthesizer
- **WHEN** `config.ttsMode` is `'mimo'`
- **THEN** `createSynthesizer()` SHALL return a `MimoTtsSynthesizer` instance

#### Scenario: Invalid ttsMode is rejected at compile time
- **WHEN** `config.ttsMode` is `'openai'` (removed value)
- **THEN** the TypeScript compiler SHALL reject the code due to non-exhaustive switch in `createSynthesizer()`

### Requirement: MiMo TTS config fields
The system SHALL provide the following config fields for MiMo TTS: `mimoApiKey` (string), `mimoVoiceMode` (`'preset' | 'voiceclone'`), `mimoReferenceAudio` (string), `mimoReferenceMode` (`'speaker-sample' | 'segment-original'`).

#### Scenario: Default config values
- **WHEN** the application starts with no prior MiMo config
- **THEN** `mimoApiKey` SHALL default to `''`, `mimoVoiceMode` SHALL default to `'preset'`, `mimoReferenceAudio` SHALL default to `''`, `mimoReferenceMode` SHALL default to `'speaker-sample'`

#### Scenario: Config schema validation
- **WHEN** config is persisted or loaded
- **THEN** `ttsMode` SHALL accept only `'edge'`, `'mimo'`, or `'indextts'`; `mimoVoiceMode` SHALL accept only `'preset'` or `'voiceclone'`

### Requirement: Config migration from removed OpenAI TTS
The system SHALL gracefully migrate any persisted `ttsMode: 'openai'` to `'edge'` on load, and SHALL log a warning.

#### Scenario: Migrate openai to edge
- **WHEN** a persisted config contains `ttsMode: 'openai'`
- **THEN** the system SHALL silently change it to `'edge'` and log a console warning

### Requirement: Preset voice synthesis via MiMo API
The MiMo TTS engine in preset mode SHALL synthesize speech by calling `POST https://api.xiaomimimo.com/v1/chat/completions` with model `mimo-v2.5-tts`, placing the target text in the `assistant` role message, and specifying the selected voice in `audio.voice`.

#### Scenario: Successful preset synthesis
- **WHEN** synthesizing a segment in preset mode
- **THEN** the engine SHALL call the MiMo API with model `mimo-v2.5-tts`, decode the base64 audio from `choices[0].message.audio.data`, and write a WAV file

#### Scenario: Empty text produces silence
- **WHEN** a segment has no `targetText` and no `sourceText`
- **THEN** the engine SHALL produce a silence file matching the target duration, without calling the API

### Requirement: Preset voice selection by language and gender
The engine SHALL map target language and speaker gender to MiMo preset voices. Chinese (`zh`) SHALL map to gender-appropriate Chinese voices; English (`en`) SHALL map to gender-appropriate English voices. All other languages SHALL use `mimo_default`.

#### Scenario: Chinese female speaker voice assignment
- **WHEN** target language is `zh` and speaker gender is `adult-female`
- **THEN** the engine SHALL select from `['冰糖', '茉莉']` in round-robin order

#### Scenario: English male speaker voice assignment
- **WHEN** target language is `en` and speaker gender is `adult-male`
- **THEN** the engine SHALL select from `['Milo', 'Dean']` in round-robin order

#### Scenario: Non-zh/en language fallback
- **WHEN** target language is `ja` (or any language other than `zh` or `en`)
- **THEN** the engine SHALL use voice `mimo_default`

#### Scenario: Speaker voice consistency across segments
- **WHEN** the same speaker appears in multiple segments
- **THEN** the engine SHALL assign the same voice to that speaker across all segments

### Requirement: Voice cloning via MiMo voiceclone model
The MiMo TTS engine in voiceclone mode SHALL synthesize speech by calling the MiMo API with model `mimo-v2.5-tts-voiceclone`, passing a base64-encoded reference audio as `audio.voice` in `data:audio/{mime};base64,{data}` format.

#### Scenario: Successful voiceclone synthesis
- **WHEN** synthesizing a segment in voiceclone mode with a resolved reference audio file
- **THEN** the engine SHALL read the file, base64-encode it with the appropriate MIME prefix, and pass it as `audio.voice` with model `mimo-v2.5-tts-voiceclone`

#### Scenario: Reference audio resolution via ReferenceAudioResolver
- **WHEN** voiceclone mode is active with `mimoReferenceMode: 'speaker-sample'`
- **THEN** the engine SHALL use `ReferenceAudioResolver` to select reference audio per segment, falling back to the speaker's profile sample, then to `mimoReferenceAudio`

#### Scenario: Reference audio resolution with segment-original mode
- **WHEN** voiceclone mode is active with `mimoReferenceMode: 'segment-original'`
- **THEN** the engine SHALL extract per-segment clips from the source audio via `ReferenceAudioResolver`, with automatic fallback to speaker sample on overlap, cross-speaker risk, or short clips

### Requirement: Dynamic voice cloning support flag
The MiMo TTS engine SHALL expose `supportsVoiceCloning` as a dynamic getter returning `true` when `mimoVoiceMode` is `'voiceclone'` and `false` when `'preset'`.

#### Scenario: Preset mode skips speaker gender labeling optimization
- **WHEN** `mimoVoiceMode` is `'preset'`
- **THEN** `supportsVoiceCloning` SHALL return `false`, and the pipeline SHALL pause for speaker gender labeling

#### Scenario: Voiceclone mode skips speaker gender labeling
- **WHEN** `mimoVoiceMode` is `'voiceclone'`
- **THEN** `supportsVoiceCloning` SHALL return `true`, and the pipeline SHALL skip the speaker gender labeling pause

### Requirement: MiMo API key validation
The input validation SHALL require a non-empty `mimoApiKey` when `ttsMode` is `'mimo'` and `pipelineMode` is not `'subtitleOnly'`.

#### Scenario: Missing MiMo API key blocks processing
- **WHEN** `ttsMode` is `'mimo'`, `pipelineMode` is not `'subtitleOnly'`, and `mimoApiKey` is empty
- **THEN** validation SHALL fail with an error message directing the user to configure the MiMo API key

### Requirement: TTS cache invalidation
The pipeline SHALL bump `ttsPipelineVersion` to invalidate existing TTS caches when MiMo TTS is introduced.

#### Scenario: Old cache entries are invalidated
- **WHEN** a previously cached TTS result exists with the old pipeline version
- **THEN** the pipeline SHALL re-synthesize instead of using the stale cache

### Requirement: API retry on transient failures
The MiMo TTS engine SHALL retry failed API calls up to 3 times with exponential backoff (starting at 1000ms), using the shared `isRetryableTtsError` heuristic for HTTP 429, 5xx, and network errors.

#### Scenario: Transient error triggers retry
- **WHEN** the MiMo API returns HTTP 429 or 5xx
- **THEN** the engine SHALL retry up to 3 times with exponential backoff before throwing

#### Scenario: Non-retryable error fails immediately
- **WHEN** the MiMo API returns HTTP 400 or 401
- **THEN** the engine SHALL throw immediately without retry

### Requirement: Proxy support for MiMo API
The MiMo TTS engine SHALL route API requests through the configured proxy when proxy is enabled, using the same `getDispatcher` mechanism as other engines.

#### Scenario: Proxy enabled routes through proxy
- **WHEN** `config.proxyEnabled` is `true` and a proxy URL is configured
- **THEN** MiMo API requests SHALL be routed through the proxy dispatcher
