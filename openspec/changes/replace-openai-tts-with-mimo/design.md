## Context

The project has a Strategy Pattern for TTS with three engines: Edge TTS (free CLI), OpenAI TTS (cloud preset voices), and IndexTTS (local voice cloning). All implement `SynthesizerStrategy` and delegate to the shared `buildTimeline()` helper for audio assembly. The factory (`factories.ts:54`) selects the engine via `switch(config.ttsMode)`.

MiMo TTS (Xiaomi) is an OpenAI-SDK-compatible API (`https://api.xiaomimimo.com/v1/chat/completions`) that offers three models: `mimo-v2.5-tts` (preset voices), `mimo-v2.5-tts-voicedesign` (text-described voices), and `mimo-v2.5-tts-voiceclone` (audio cloning). It is currently in a limited-time free tier.

The existing `ReferenceAudioResolver` (used by IndexTTS) provides robust reference audio selection with two modes: `speaker-sample` (use speaker's profile sample) and `segment-original` (extract clip from source audio per segment, with fallback). This infrastructure can be reused for MiMo's voiceclone mode.

## Goals / Non-Goals

**Goals:**
- Replace OpenAI TTS with MiMo TTS as the cloud-based preset-voice engine.
- Support both preset voices (`mimo-v2.5-tts`) and voice cloning (`mimo-v2.5-tts-voiceclone`) within a single synthesizer.
- Auto-select preset voices by target language and speaker gender.
- Reuse `ReferenceAudioResolver` for voiceclone reference audio handling.
- Maintain backward compatibility with existing config persistence (graceful migration for `ttsMode: 'openai'`).

**Non-Goals:**
- `mimo-v2.5-tts-voicedesign` (text-described voice design) — not in scope; adds complexity with minimal value over preset voices.
- Streaming TTS — unnecessary complexity; the pipeline processes segments sequentially anyway.
- Style/emotion control (natural language user message or audio tags) — out of scope; keep the user message empty for plain TTS.
- Multi-language voice coverage beyond zh/en — accept `mimo_default` fallback for other languages.

## Decisions

### D1: Use OpenAI SDK with custom baseURL (not raw fetch)

**Decision:** Instantiate `new OpenAI({ apiKey, baseURL: 'https://api.xiaomimimo.com/v1', ... })` and call `client.chat.completions.create()`.

**Rationale:** MiMo's API is OpenAI-compatible (confirmed by their docs using `from openai import OpenAI`). The `openai` npm package is already a dependency. This gives us structured request/response typing, automatic retries, and proxy dispatcher support via `fetchOptions`.

**Alternatives considered:** Raw `undiciFetch` (like IndexTTS does) — more boilerplate, manual JSON construction, manual base64 decode. Not worth it since the SDK already handles these.

### D2: API response decoding — base64 in chat completion message

**Decision:** Decode `completion.choices[0].message.audio.data` (base64 string) via `Buffer.from(data, 'base64')` and write directly to a `.wav` file.

**Rationale:** MiMo returns audio inside the chat completion response as base64, not as raw audio bytes like OpenAI's `audio.speech.create()`. Since output is already WAV, the file can be passed to `buildTimeline` which normalizes it through ffmpeg anyway.

### D3: Voice selection — language + gender mapping with `mimo_default` fallback

**Decision:**
```
const VOICE_POOL: Record<string, Record<SpeakerGender, string[]>> = {
  zh: { 'adult-female': ['冰糖', '茉莉'], 'adult-male': ['苏打', '白桦'],
        'child-female': ['冰糖', '茉莉'], 'child-male': ['苏打', '白桦'] },
  en: { 'adult-female': ['Mia', 'Chloe'], 'adult-male': ['Milo', 'Dean'],
        'child-female': ['Mia', 'Chloe'], 'child-male': ['Milo', 'Dean'] },
}
```
Non-zh/en languages → `mimo_default`.

**Rationale:** MiMo's 8 preset voices are explicitly labeled as Chinese or English. Mapping by language family (e.g., CJK → Chinese voices) risks mismatched pronunciation. `mimo_default` is the safest fallback — it adapts to the deployment cluster's default voice.

**Alternatives considered:** Language-family approximation (ja/ko → zh voices, fr/de → en voices) — risky, could produce odd results. Not recommended.

### D4: Voiceclone mode reuses `ReferenceAudioResolver` with new config fields

**Decision:** Add `mimoVoiceMode`, `mimoReferenceAudio`, `mimoReferenceMode` as MiMo-specific config fields. Instantiate `ReferenceAudioResolver` with MiMo's config when `mimoVoiceMode === 'voiceclone'`. The reference audio path (from resolver or speaker profile) is read from disk, base64-encoded with MIME prefix (`data:audio/wav;base64,...`), and passed as the `audio.voice` parameter.

**Rationale:** `ReferenceAudioResolver` already handles speaker-sample/segment-original logic, overlap detection, cross-speaker risk, and graceful fallback. Duplicating this would be wasteful. New fields keep MiMo config semantically separate from IndexTTS config.

**Alternatives considered:** Reuse `indexttsReferenceAudio`/`indexttsReferenceMode` fields — semantically confusing, couples two independent engines.

### D5: `supportsVoiceCloning` is a dynamic getter

**Decision:** Implement as `get supportsVoiceCloning() { return this.config.mimoVoiceMode === 'voiceclone' }` instead of a static `readonly` property.

**Rationale:** The pipeline (`pipeline.ts:414`) checks `supportsVoiceCloning` to decide whether to pause for speaker gender labeling. Preset mode needs gender labels for voice selection; voiceclone mode uses audio samples and skips gender labeling. A dynamic getter ensures the correct behavior per sub-mode.

**Alternatives considered:** Always `true` (skip gender labeling always) — preset mode would have no gender info and couldn't select voices. Always `false` — voiceclone mode would unnecessarily pause for gender labels.

### D6: Voiceclone audio transport — base64 data URL (10MB limit)

**Decision:** Read the reference audio file, base64-encode it, prefix with `data:audio/{ext};base64,`, and pass as `audio.voice` in the API request. MiMo enforces a 10MB base64 limit.

**Rationale:** Unlike IndexTTS (local server reads file by path), MiMo is a cloud API that requires audio data inline. The `ReferenceAudioResolver` already trims clips to reasonable durations (segment-length), so 10MB should rarely be exceeded.

**Risk:** If a segment is very long, the base64 could exceed 10MB. Mitigation: truncate or compress via ffmpeg before encoding if needed. For now, accept the risk — segments are typically 2-30 seconds.

### D7: Config migration for existing `ttsMode: 'openai'`

**Decision:** In `config.ts`, add a migration hook in the `Store` `migrate` config or a post-load check that maps `'openai'` → `'edge'` (the free default) if encountered. Log a warning.

**Rationale:** A hard removal of `'openai'` from the `TtsMode` union means existing configs with `ttsMode: 'openai'` would fail schema validation and crash the app on load. Silently falling back to `'edge'` is the least disruptive option. The user can then switch to `'mimo'` in settings.

### D8: TTS cache version bump

**Decision:** Bump `ttsPipelineVersion` from `2` to `3` in `pipeline.ts:234` to invalidate all existing TTS caches.

**Rationale:** Even cached results from other engines (Edge, IndexTTS) should be re-validated since the config schema changed. This is a cheap safety measure.

## Risks / Trade-offs

- **[Non-zh/en voice quality]** → MiMo preset voices are optimized for Chinese and English. For ja/ko/fr/de etc., `mimo_default` may produce suboptimal results. Document this as a known limitation; users needing other languages should use Edge TTS or IndexTTS.

- **[10MB base64 limit on voiceclone]** → Very long segments could exceed the limit. Mitigation: the `ReferenceAudioResolver` already clips to segment duration. If issues arise, add ffmpeg-based pre-encoding compression as a follow-up.

- **[Config migration `openai` → `edge`]** → Users losing their OpenAI TTS selection silently. Mitigation: log a console warning so it's debuggable; the settings UI will show Edge TTS selected, making the change visible.

- **[MiMo API rate limits / availability]** → As a newer service, reliability is unproven. Mitigation: the existing retry logic (`isRetryableTtsError`, 3 attempts with exponential backoff) handles transient failures. The `mimo-v2.5-tts` streaming deprecation notice on their docs page suggests the API is still evolving.

- **[Breaking change for downstream consumers]** → Any code referencing `ttsMode: 'openai'` directly will fail to compile. Mitigation: exhaustive `switch` in `factories.ts` ensures compile-time safety; TypeScript will flag all unhandled cases.
