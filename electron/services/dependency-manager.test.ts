import assert from 'node:assert/strict'
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
    indexttsApiUrl: '',
    indexttsReferenceAudio: '',
    indexttsReferenceMode: 'speaker-sample',
    audioSeparatorPath: 'audio-separator',
    subtitleTrack1: 'target',
    subtitleTrack2: 'source',
    manualReviewEnabled: false,
    ...overrides,
  }
}

test('requires yt-dlp for remote sources but not local files', () => {
  assert.deepEqual(getRequiredDeps(config(), 'youtube').map((dep) => dep.id), ['yt-dlp'])
  assert.deepEqual(getRequiredDeps(config(), 'local-file').map((dep) => dep.id), [])
})

test('requires transcription and vocal-removal packages only when matching config modes are enabled', () => {
  const required = getRequiredDeps(config({
    transcribeMode: 'whisperx',
    audioMixMode: 'mix-vocal-removal',
  }), 'bilibili').map((dep) => dep.id)

  assert.deepEqual(required, ['yt-dlp', 'whisperx', 'audio-separator'])
})

test('builds the virtualenv bin path under Electron userData', () => {
  const binDir = getVenvBinDirForUserData('/tmp/video-translator-user-data')

  assert.equal(
    binDir,
    process.platform === 'win32'
      ? '/tmp/video-translator-user-data/.venv/Scripts'
      : '/tmp/video-translator-user-data/.venv/bin',
  )
})
