import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

// @ts-expect-error TS5097: Node's strip-types test runner requires the .ts specifier.
import { getRequiredDeps, getVenvBinDirForUserData } from './dependency-manager.ts'
import type { AppConfig } from './types.ts'

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    locale: 'en',
    themeMode: 'dark',
    sourceLanguage: 'auto',
    targetLanguage: 'zh',
    openaiApiKey: '',
    outputDir: '',
    subtitleStyle: {
      enFontSize: 36,
      cnFontSize: 50,
      enColor: '#FFFFFF',
      cnColor: '#FFFF00',
      enPosition: 'bottom',
      cnPosition: 'bottom',
      bgColor: '#000000',
      bgOpacity: 0,
      fontFamily: 'Arial',
    },
    subtitleMinSplitWidth: 20,
    subtitleMaxSplitWidth: 60,
    subtitleSourceMinSplitWidth: 20,
    subtitleSourceMaxSplitWidth: 60,
    proxyEnabled: false,
    proxyUrl: '',
    proxyBypass: '',
    transcribeMode: 'openai',
    localWhisperApiUrl: '',
    localWhisperCliPath: 'whisper',
    whisperxPath: 'whisperx',
    whisperxHfToken: '',
    hfMirrorEnabled: false,
    hfMirrorUrl: '',
    ytDlpPath: 'yt-dlp',
    translateMode: 'openai',
    openaiModel: '',
    deepseekApiKey: '',
    deepseekModel: '',
    glmApiKey: '',
    glmModel: '',
    ttsMode: 'edge',
    syncMode: 'natural',
    pipelineMode: 'full',
    audioMixMode: 'replace',
    mimoApiKey: '',
    mimoVoiceMode: 'preset',
    mimoReferenceMode: 'speaker-sample',
    indexttsApiUrl: '',
    indexttsReferenceMode: 'speaker-sample',
    edgeTtsPath: 'edge-tts',
    audioSeparatorPath: 'audio-separator',
    subtitleTrack1: 'target',
    subtitleTrack2: 'source',
    manualReviewEnabled: false,
    ...overrides,
  }
}

test('requires yt-dlp for remote sources but not local files', () => {
  assert.deepEqual(getRequiredDeps(config({ ttsMode: 'mimo' }), 'youtube').map((dep) => dep.id), ['yt-dlp'])
  assert.deepEqual(getRequiredDeps(config({ ttsMode: 'mimo' }), 'local-file').map((dep) => dep.id), [])
})

test('requires transcription and vocal-removal packages only when matching config modes are enabled', () => {
  const required = getRequiredDeps(config({
    transcribeMode: 'whisperx',
    audioMixMode: 'mix-vocal-removal',
    ttsMode: 'mimo',
  }), 'bilibili').map((dep) => dep.id)

  assert.deepEqual(required, ['yt-dlp', 'whisperx', 'audio-separator'])
})

test('builds the virtualenv bin path under Electron userData', () => {
  const binDir = getVenvBinDirForUserData('/tmp/video-translator-user-data')

  const expected = process.platform === 'win32'
    ? path.join('\\tmp\\video-translator-user-data', '.venv', 'Scripts')
    : '/tmp/video-translator-user-data/.venv/bin'

  assert.equal(binDir, expected)
})

test('marks whisper and whisperx as requiring PyTorch', () => {
  const deps = getRequiredDeps(config({ transcribeMode: 'local-cli' }), 'youtube')
  const whisper = deps.find((d) => d.id === 'whisper')
  assert.ok(whisper, 'whisper should be a required dep')
  assert.equal(whisper.requiresPyTorch, true)
})

test('yt-dlp does not require PyTorch', () => {
  const deps = getRequiredDeps(config({ ttsMode: 'mimo' }), 'youtube')
  const ytdlp = deps.find((d) => d.id === 'yt-dlp')
  assert.ok(ytdlp, 'yt-dlp should be a required dep')
  assert.equal(ytdlp.requiresPyTorch, undefined)
})

test('whisperx is marked as requiring PyTorch', () => {
  const deps = getRequiredDeps(config({ transcribeMode: 'whisperx' }), 'youtube')
  const whisperx = deps.find((d) => d.id === 'whisperx')
  assert.ok(whisperx, 'whisperx should be a required dep')
  assert.equal(whisperx.requiresPyTorch, true)
})

test('audio-separator does not require PyTorch', () => {
  const deps = getRequiredDeps(config({ audioMixMode: 'mix-vocal-removal' }), 'youtube')
  const separator = deps.find((d) => d.id === 'audio-separator')
  assert.ok(separator, 'audio-separator should be a required dep')
  assert.equal(separator.requiresPyTorch, undefined)
})

test('edge-tts is required when ttsMode is edge', () => {
  const deps = getRequiredDeps(config({ ttsMode: 'edge' }), 'youtube')
  const edgeTts = deps.find((d) => d.id === 'edge-tts')
  assert.ok(edgeTts, 'edge-tts should be a required dep')
  assert.equal(edgeTts.requiresPyTorch, undefined)
})

test('edge-tts is not required when ttsMode is not edge', () => {
  const deps = getRequiredDeps(config({ ttsMode: 'mimo' }), 'youtube')
  const edgeTts = deps.find((d) => d.id === 'edge-tts')
  assert.equal(edgeTts, undefined)
})
