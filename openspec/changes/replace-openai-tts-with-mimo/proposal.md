## Why

OpenAI TTS is the current cloud-based preset-voice engine, but its pricing is a barrier and MiMo TTS (mimo-v2.5-tts) offers higher-quality Chinese/English voices with a limited-time free tier. Replacing OpenAI TTS with MiMo TTS gives users a better cost-to-quality ratio while also gaining optional cloud-based voice cloning via `mimo-v2.5-tts-voiceclone`.

## What Changes

- **BREAKING**: Remove OpenAI TTS engine entirely (`openai-tts.ts` deleted, `TtsMode` union changes from `'edge' | 'openai' | 'indextts'` to `'edge' | 'mimo' | 'indextts'`).
- Add MiMo TTS engine (`mimo-tts.ts`) supporting two sub-modes: preset voices (`mimo-v2.5-tts`) and voice cloning (`mimo-v2.5-tts-voiceclone`).
- Add new config fields: `mimoApiKey`, `mimoVoiceMode` (`'preset' | 'voiceclone'`), `mimoReferenceAudio`, `mimoReferenceMode` (`'speaker-sample' | 'segment-original'`).
- MiMo preset voices are auto-selected by target language and speaker gender; non-zh/en languages fall back to `mimo_default`.
- MiMo voiceclone mode reuses the existing `ReferenceAudioResolver` infrastructure (same pattern as IndexTTS) and sets `supportsVoiceCloning = true` dynamically.
- Update settings UI, input validation, i18n labels, config defaults/schema, pipeline cache version, and test fixtures.

## Capabilities

### New Capabilities
- `mimo-tts`: Cloud-based TTS engine using Xiaomi MiMo API (mimo-v2.5-tts for preset voices, mimo-v2.5-tts-voiceclone for voice cloning). Covers API integration, voice selection by language/gender, reference audio handling, and configuration.

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Backend**: `electron/services/strategies/synthesizers/openai-tts.ts` (deleted), new `mimo-tts.ts` (~150 lines), `factories.ts`, `types.ts`, `config.ts`, `pipeline.ts` (cache version bump).
- **Frontend**: `src/types.ts`, `src/store/usePipelineStore.ts`, `src/components/SettingsView.tsx` (TTS section rework), `src/components/InputView.tsx` (validation).
- **i18n**: `src/i18n/locales/en.ts`, `src/i18n/locales/zh.ts` — new `settings.tts.mimo*` keys, removal of `settings.tts.openai*`.
- **Tests**: `electron/services/dependency-manager.test.ts` — update `ttsMode` fixtures from `'openai'` to `'mimo'`.
- **Dependencies**: The `openai` npm package remains (used by transcriber/translator); MiMo API is OpenAI-SDK-compatible so no new dependency needed.
- **Users**: Existing users with `ttsMode: 'openai'` will have an invalid config value; config migration or reset needed. TTS cache (`tts.json`) invalidated via `ttsPipelineVersion` bump.
