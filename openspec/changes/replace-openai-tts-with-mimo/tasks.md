## 1. Type System & Config Foundation

- [x] 1.1 Update `TtsMode` type in `electron/services/types.ts` from `'edge' | 'openai' | 'indextts'` to `'edge' | 'mimo' | 'indextts'`
- [x] 1.2 Add `ReferenceMode` type (`'speaker-sample' | 'segment-original'`) in `electron/services/types.ts`; refactor `IndexTtsReferenceMode` to alias it
- [x] 1.3 Add new fields to `AppConfig` in `electron/services/types.ts`: `mimoApiKey: string`, `mimoVoiceMode: 'preset' | 'voiceclone'`, `mimoReferenceAudio: string`, `mimoReferenceMode: ReferenceMode`
- [x] 1.4 Mirror all type changes in `src/types.ts` (frontend)
- [x] 1.5 Update `electron/services/config.ts`: add defaults (`mimoApiKey: ''`, `mimoVoiceMode: 'preset'`, `mimoReferenceAudio: ''`, `mimoReferenceMode: 'speaker-sample'`), update JSON schema (`ttsMode` enum, `mimoVoiceMode` enum), add `mimoApiKey`/`mimoVoiceMode`/`mimoReferenceAudio`/`mimoReferenceMode` to `simpleKeys`
- [x] 1.6 Add config migration in `electron/services/config.ts`: map persisted `ttsMode: 'openai'` → `'edge'` with console warning on load
- [x] 1.7 Update `src/store/usePipelineStore.ts`: add new field defaults to match config

## 2. MiMo TTS Engine Implementation

- [x] 2.1 Create `electron/services/strategies/synthesizers/mimo-tts.ts` with `MimoTtsSynthesizer` class implementing `SynthesizerStrategy`
- [x] 2.2 Implement constructor: instantiate `OpenAI` client with `baseURL: 'https://api.xiaomimimo.com/v1'`, `apiKey: config.mimoApiKey`, and proxy dispatcher via `getDispatcher`
- [x] 2.3 Implement `get supportsVoiceCloning()` returning `config.mimoVoiceMode === 'voiceclone'`
- [x] 2.4 Implement voice pool map (`VOICE_POOL` by language + gender) and `getVoice()` method with round-robin assignment and speaker caching
- [x] 2.5 Implement `synthesize()` entry point: create `.tts-temp` dir, instantiate `ReferenceAudioResolver` if voiceclone mode, delegate to `buildTimeline`, cleanup
- [x] 2.6 Implement `synthesizeSegment()`: resolve text, pick voice (preset or voiceclone via resolver), handle empty text → silence
- [x] 2.7 Implement `synthesizeToFile()`: call `client.chat.completions.create()` with model/voice/messages/audio params, decode base64 from `choices[0].message.audio.data`, write WAV file
- [x] 2.8 Add retry logic using shared `isRetryableTtsError` + exponential backoff (3 attempts, 1000ms base)
- [x] 2.9 Implement voiceclone reference audio base64 encoding: read file, determine MIME type, construct `data:{mime};base64,{data}` string

## 3. Factory & Pipeline Wiring

- [x] 3.1 Update `electron/services/factories.ts`: replace `import OpenAITtsSynthesizer` with `import MimoTtsSynthesizer`, change `case 'openai'` to `case 'mimo'`
- [x] 3.2 Delete `electron/services/strategies/synthesizers/openai-tts.ts`
- [x] 3.3 Update `electron/services/pipeline.ts`: bump `ttsPipelineVersion` from `2` to `3`
- [x] 3.4 Verify `createTtsFingerprint` in `pipeline.ts` includes `mimoVoiceMode`/`mimoReferenceMode`/`mimoReferenceAudio` in fingerprint when applicable

## 4. Frontend UI Updates

- [x] 4.1 Update `src/components/SettingsView.tsx`: change OpenAI TTS button to MiMo TTS button (`ttsMode: 'mimo'`), update label/icon
- [x] 4.2 Add MiMo TTS config section in `SettingsView.tsx`: API key input, voice mode toggle (preset/voiceclone), conditional reference audio + reference mode fields (mirror IndexTTS UI pattern)
- [x] 4.3 Remove OpenAI TTS-specific UI (help text for openaiApiKey reuse)
- [x] 4.4 Update `src/components/InputView.tsx`: change validation from `ttsMode === 'openai' && !openaiApiKey` to `ttsMode === 'mimo' && !mimoApiKey`, update error message key

## 5. i18n Updates

- [x] 5.1 Update `src/i18n/locales/en.ts`: replace `settings.tts.openai` with `settings.tts.mimo`, add `settings.tts.mimoApiKey`, `settings.tts.mimoKeyHelp`, `settings.tts.mimoVoiceMode`, `settings.tts.mimoVoiceMode.preset`, `settings.tts.mimoVoiceMode.voiceclone`, `settings.tts.mimoReferenceAudio`, `settings.tts.mimoReferenceMode` and related sub-keys
- [x] 5.2 Update `src/i18n/locales/zh.ts`: mirror the same key changes with Chinese translations
- [x] 5.3 Update `input.validation.openaiTtsKeyRequired` to `input.validation.mimoApiKeyRequired` in both locale files
- [x] 5.4 Update help text (`help.settings.ttsDesc`) in both locales to describe MiMo TTS instead of OpenAI TTS

## 6. Tests & Fixtures

- [x] 6.1 Update `electron/services/dependency-manager.test.ts`: change all `ttsMode: 'openai'` fixtures to `ttsMode: 'mimo'`
- [x] 6.2 Verify no other test files reference `'openai'` as a `ttsMode` value (grep and fix any stragglers)
- [x] 6.3 Run `npm run typecheck` and fix any compilation errors
- [x] 6.4 Run `npm run lint` and fix any lint errors
- [x] 6.5 Run `npm test` and fix any test failures
