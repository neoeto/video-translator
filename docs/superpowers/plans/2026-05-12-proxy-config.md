# Proxy Configuration Implementation Plan

## Context

**Project**: video-translator — Electron desktop app that downloads YouTube videos, transcribes via OpenAI Whisper, translates via ChatGPT, synthesizes TTS via edge-tts, and recombines with subtitles.

**Problem**: All network-dependent services (yt-dlp, OpenAI, edge-tts) cannot be reached from China without a proxy. Users need to configure an HTTP proxy that applies to all network requests.

**Decision**: Add `proxyUrl` field to existing `AppConfig`, inject proxy into each service individually.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `electron/services/types.ts` | MODIFY | Add `proxyUrl` to `AppConfig` |
| `src/types.ts` | MODIFY | Mirror `proxyUrl` in renderer types |
| `electron/services/config.ts` | MODIFY | Default value, schema, setter for `proxyUrl` |
| `electron/services/downloader.ts` | MODIFY | Pass `--proxy` flag to yt-dlp |
| `electron/services/transcriber.ts` | MODIFY | Pass ProxyAgent to OpenAI client |
| `electron/services/translator.ts` | MODIFY | Pass ProxyAgent to OpenAI client |
| `electron/services/tts.ts` | MODIFY | Replace edge-tts `tts()` with local impl that supports proxy |
| `src/components/InputView.tsx` | MODIFY | Add proxy URL input field |
| `src/store/usePipelineStore.ts` | MODIFY | Add `proxyUrl` to default config |
| `package.json` | MODIFY | Add `https-proxy-agent` dependency |

## Dependencies

- `undici` — already a transitive dependency of `openai` SDK, provides `ProxyAgent` for OpenAI
- `https-proxy-agent` — NEW, needed for WebSocket proxy in edge-tts replacement

## Tasks

### Task 1: Add `proxyUrl` to config layer

**Files**: `electron/services/types.ts`, `src/types.ts`, `electron/services/config.ts`, `src/store/usePipelineStore.ts`

**MUST DO**:
- Add `proxyUrl: string` to `AppConfig` in both `electron/services/types.ts` and `src/types.ts`
- Default value: `''` (empty string = no proxy)
- Add `proxyUrl` to electron-store schema in `config.ts` with `{ type: 'string', default: '' }`
- Add `proxyUrl` to `setConfig()` in `config.ts` (handle `undefined` check like existing fields)
- Add `proxyUrl: ''` to default config in `usePipelineStore.ts`

**MUST NOT DO**:
- Do not change any service logic yet
- Do not modify the IPC layer (preload.ts) — `Partial<AppConfig>` already covers new fields

**Reference**: Follow exact patterns of `outputDir` field for how to add a new config field.

### Task 2: Add `https-proxy-agent` dependency

**Files**: `package.json`

**MUST DO**:
- Run `npm install https-proxy-agent` in the video-translator directory
- Verify it appears in `dependencies` in package.json

**MUST NOT DO**:
- Do not add `undici` explicitly — it's already a transitive dep of `openai`
- Do not add `http-proxy-agent` — `https-proxy-agent` handles both HTTP and HTTPS proxies

### Task 3: Inject proxy into yt-dlp downloader

**Files**: `electron/services/downloader.ts`

**MUST DO**:
- Import `getConfig` from `./config.js` (already imported? check first)
- Read `proxyUrl` from config: `const { proxyUrl } = getConfig()`
- When building yt-dlp args, if `proxyUrl` is non-empty, prepend `['--proxy', proxyUrl]` to the args array
- This applies to BOTH `downloadVideo()` and `getVideoTitle()` functions (both call `runYtDlp`)
- Best approach: modify `runYtDlp()` to accept an optional proxyUrl parameter, and both callers pass it

**MUST NOT DO**:
- Do not modify the spawn call itself — only the args array
- Do not add proxy if `proxyUrl` is empty string

**Reference**: The `runYtDlp` function is at line ~43. It takes `args: string[]`. The callers build args arrays.

### Task 4: Inject proxy into OpenAI clients (transcriber + translator)

**Files**: `electron/services/transcriber.ts`, `electron/services/translator.ts`

**MUST DO**:
- In `transcriber.ts` function `transcribeOnce()` (line ~69): create OpenAI client with proxy
  ```typescript
  import { ProxyAgent } from 'undici'
  import { getConfig } from './config.js'

  // Inside transcribeOnce:
  const { proxyUrl } = getConfig()
  const client = new OpenAI({
    apiKey,
    ...(proxyUrl ? { fetchOptions: { dispatcher: new ProxyAgent(proxyUrl) } } : {}),
  })
  ```
- In `translator.ts` function `translate()` (find where `new OpenAI` is called): same pattern
- Only create ProxyAgent if `proxyUrl` is non-empty

**MUST NOT DO**:
- Do not create ProxyAgent at module level — config can change at runtime
- Do not import undici types — just use the runtime value

**Reference**: `transcriber.ts` line 79 creates `new OpenAI({ apiKey })`. `translator.ts` has similar pattern.

### Task 5: Replace edge-tts `tts()` with local proxy-aware implementation

**Files**: `electron/services/tts.ts`

**CONTEXT**: The `edge-tts` npm package's `tts()` function creates a WebSocket internally without accepting proxy options. Since the entire function is ~50 lines of code, we replace it with a local implementation that accepts an `agent` parameter.

**MUST DO**:
- Import `WebSocket` from `ws` (already in edge-tts deps, or add `ws` as direct dep if needed)
- Import `HttpsProxyAgent` from `https-proxy-agent`
- Import `getConfig` from `./config.js`
- Create a local `ttsWithProxy(text, options)` function that:
  1. Reads `proxyUrl` from config
  2. Creates WebSocket with `{ agent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined, ...headers }`
  3. Uses the same SSML format and protocol as the original `tts()` function
- Replace all calls to `tts()` from `edge-tts` with `ttsWithProxy()`
- Remove the `import { tts } from 'edge-tts'` import

**The protocol** (copied from edge-tts source):
- URL: `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=${uuid}`
- Headers: `Host: speech.platform.bing.com`, `Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`, `User-Agent: ...`
- On open: send config message (JSON with audio format), then SSML message
- On message: collect binary audio chunks, resolve on `turn.end` text message
- Return `Buffer` of concatenated audio data

**MUST NOT DO**:
- Do not keep the `edge-tts` import — remove it entirely
- Do not change the audio format or voice selection logic
- Do not modify `synthesizeTextToFile` signature — only the internal `tts()` call changes

**Reference**: Full edge-tts source is at `node_modules/edge-tts/out/index.js`. The `tts()` function is lines 12-51.

### Task 6: Add proxy input to UI

**Files**: `src/components/InputView.tsx`

**MUST DO**:
- Add a new form section between "OpenAI API Key" and the submit button
- Label: "🌐 网络代理 (可选)"
- Input: text field, bound to `config.proxyUrl`, save via `saveConfig({ proxyUrl: value })`
- Placeholder: `http://127.0.0.1:7890`
- Helper text below: "留空则不使用代理"
- Follow the exact same styling pattern as the "OpenAI API Key" field (bg-gray-700, border-gray-600, etc.)
- Add basic validation hint: if value is non-empty and doesn't start with `http://` or `https://`, show a red hint

**MUST NOT DO**:
- Do not block form submission for invalid proxy URLs — just show a hint
- Do not make proxy required
- Do not change existing field order or layout

**Reference**: Follow the "OpenAI API Key" field pattern at lines 101-121 of InputView.tsx.

### Task 7: Verify and test

**MUST DO**:
- Run `npm run typecheck` — must pass with 0 errors
- Run `npm run build` — must succeed
- Manual verification: open the app, confirm proxy field appears, type a URL, confirm it saves

## Execution Order

```
Task 1 (config layer) ──┐
Task 2 (npm dep)    ────┤
                        ├── Task 3 (yt-dlp)    ──┐
                        ├── Task 4 (openai)    ──┤── Task 7 (verify)
                        ├── Task 5 (edge-tts) ──┤
                        └── Task 6 (UI)        ──┘
```

Tasks 1+2 must complete first. Then Tasks 3-6 can run in parallel. Task 7 runs last.
