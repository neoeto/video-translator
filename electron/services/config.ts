import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'
import type { AppConfig } from './types.js'

function detectWhisperPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDir, '..', '..', '..')
  const binName = process.platform === 'win32' ? 'whisper.exe' : 'whisper'
  const venvDir = process.platform === 'win32' ? 'Scripts' : 'bin'
  const venvWhisper = path.join(projectRoot, '.venv', venvDir, binName)
  // 开发环境优先使用项目虚拟环境，避免误用系统 PATH 中版本不一致的 whisper。
  if (fs.existsSync(venvWhisper)) {
    return venvWhisper
  }

  try {
    // 打包或用户自定义安装时再查 PATH，最后保留命令名让调用阶段给出明确错误。
    const whichCmd = process.platform === 'win32' ? 'where whisper' : 'which whisper'
    const whichResult = execSync(whichCmd, { encoding: 'utf8', timeout: 3000 }).trim()
    const firstLine = whichResult.split(/\r?\n/)[0]
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine
    }
  } catch {
    // not found on PATH
  }

  return 'whisper'
}

function detectWhisperxPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDir, '..', '..', '..')
  const binName = process.platform === 'win32' ? 'whisperx.exe' : 'whisperx'
  const venvDir = process.platform === 'win32' ? 'Scripts' : 'bin'
  const venvWhisperx = path.join(projectRoot, '.venv', venvDir, binName)
  if (fs.existsSync(venvWhisperx)) {
    return venvWhisperx
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where whisperx' : 'which whisperx'
    const whichResult = execSync(whichCmd, { encoding: 'utf8', timeout: 3000 }).trim()
    const firstLine = whichResult.split(/\r?\n/)[0]
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine
    }
  } catch {
    // not found on PATH
  }

  return 'whisperx'
}

function detectAudioSeparatorPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDir, '..', '..', '..')
  const binName = process.platform === 'win32' ? 'audio-separator.exe' : 'audio-separator'
  const venvDir = process.platform === 'win32' ? 'Scripts' : 'bin'
  const venvPath = path.join(projectRoot, '.venv', venvDir, binName)
  if (fs.existsSync(venvPath)) {
    return venvPath
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where audio-separator' : 'which audio-separator'
    const result = execSync(whichCmd, { encoding: 'utf8', timeout: 3000 }).trim()
    const firstLine = result.split(/\r?\n/)[0]
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine
    }
  } catch {
    // not found on PATH
  }

  return 'audio-separator'
}

function detectYtDlpPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDir, '..', '..', '..')
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const venvDir = process.platform === 'win32' ? 'Scripts' : 'bin'
  const venvPath = path.join(projectRoot, '.venv', venvDir, binName)
  if (fs.existsSync(venvPath)) {
    return venvPath
  }

  try {
    const whichCmd = process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp'
    const result = execSync(whichCmd, { encoding: 'utf8', timeout: 3000 }).trim()
    const firstLine = result.split(/\r?\n/)[0]
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine
    }
  } catch {
  }

  return 'yt-dlp'
}

const DEFAULT_SUBTITLE_MIN_SPLIT_WIDTH = 20
const DEFAULT_SUBTITLE_MAX_SPLIT_WIDTH = 60

function normalizeSubtitleSplitWidth(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.trunc(value))
}

const defaultConfig: AppConfig = {
  locale: 'en',
  themeMode: 'dark',
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  openaiApiKey: '',
  outputDir: path.join(os.homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos', 'video-translator'),
  proxyEnabled: false,
  proxyUrl: '',
  proxyBypass: 'localhost, 127.0.0.1',
  transcribeMode: 'openai',
  localWhisperApiUrl: 'http://localhost:9000',
  localWhisperCliPath: detectWhisperPath(),
  whisperxPath: detectWhisperxPath(),
  whisperxHfToken: '',
  hfMirrorEnabled: false,
  hfMirrorUrl: '',
  ytDlpPath: detectYtDlpPath(),
  translateMode: 'openai',
  openaiModel: 'gpt-4o',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  glmApiKey: '',
  glmModel: 'glm-4-flash',
  ttsMode: 'edge',
  syncMode: 'natural',
  pipelineMode: 'full',
  audioMixMode: 'replace',
  indexttsApiUrl: 'http://localhost:8080',
  indexttsReferenceAudio: '',
  indexttsReferenceMode: 'speaker-sample',
  audioSeparatorPath: detectAudioSeparatorPath(),
  subtitleTrack1: 'target',
  subtitleTrack2: 'source',
  manualReviewEnabled: false,
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
  subtitleMinSplitWidth: DEFAULT_SUBTITLE_MIN_SPLIT_WIDTH,
  subtitleMaxSplitWidth: DEFAULT_SUBTITLE_MAX_SPLIT_WIDTH,
  subtitleSourceMinSplitWidth: DEFAULT_SUBTITLE_MIN_SPLIT_WIDTH,
  subtitleSourceMaxSplitWidth: DEFAULT_SUBTITLE_MAX_SPLIT_WIDTH,
}

const store = new Store<AppConfig>({
  name: 'config',
  // electron-store 用该 key 加密本地配置，主要避免 API key 明文落盘。
  encryptionKey: 'video-translator-openai-api-key',
  defaults: defaultConfig,
  schema: {
    locale: {
      type: 'string',
      enum: ['en', 'zh'],
      default: defaultConfig.locale,
    },
    themeMode: {
      type: 'string',
      enum: ['dark', 'light', 'system'],
      default: 'dark',
    },
    sourceLanguage: {
      type: 'string',
      default: defaultConfig.sourceLanguage,
    },
    targetLanguage: {
      type: 'string',
      default: defaultConfig.targetLanguage,
    },
    openaiApiKey: {
      type: 'string',
      default: defaultConfig.openaiApiKey,
    },
    outputDir: {
      type: 'string',
      default: defaultConfig.outputDir,
    },
    proxyEnabled: {
      type: 'boolean',
      default: defaultConfig.proxyEnabled,
    },
    proxyUrl: {
      type: 'string',
      default: defaultConfig.proxyUrl,
    },
    proxyBypass: {
      type: 'string',
      default: defaultConfig.proxyBypass,
    },
    transcribeMode: {
      type: 'string',
      enum: ['openai', 'local-api', 'local-cli', 'whisperx'],
      default: defaultConfig.transcribeMode,
    },
    localWhisperApiUrl: {
      type: 'string',
      default: defaultConfig.localWhisperApiUrl,
    },
    localWhisperCliPath: {
      type: 'string',
      default: defaultConfig.localWhisperCliPath,
    },
    whisperxPath: {
      type: 'string',
      default: defaultConfig.whisperxPath,
    },
    whisperxHfToken: {
      type: 'string',
      default: defaultConfig.whisperxHfToken,
    },
    hfMirrorEnabled: {
      type: 'boolean',
      default: defaultConfig.hfMirrorEnabled,
    },
    hfMirrorUrl: {
      type: 'string',
      default: defaultConfig.hfMirrorUrl,
    },
    ytDlpPath: {
      type: 'string',
      default: defaultConfig.ytDlpPath,
    },
    translateMode: {
      type: 'string',
      enum: ['openai', 'deepseek', 'glm'],
      default: defaultConfig.translateMode,
    },
    openaiModel: {
      type: 'string',
      default: defaultConfig.openaiModel,
    },
    deepseekApiKey: {
      type: 'string',
      default: defaultConfig.deepseekApiKey,
    },
    deepseekModel: {
      type: 'string',
      default: defaultConfig.deepseekModel,
    },
    glmApiKey: {
      type: 'string',
      default: defaultConfig.glmApiKey,
    },
    glmModel: {
      type: 'string',
      default: defaultConfig.glmModel,
    },
    ttsMode: {
      type: 'string',
      enum: ['edge', 'openai', 'indextts'],
      default: defaultConfig.ttsMode,
    },
    syncMode: {
      type: 'string',
      enum: ['natural', 'strict'],
      default: defaultConfig.syncMode,
    },
    pipelineMode: {
      type: 'string',
      enum: ['full', 'subtitleOnly'],
      default: defaultConfig.pipelineMode,
    },
    audioMixMode: {
      type: 'string',
      enum: ['replace', 'mix-gate', 'mix-vocal-removal'],
      default: defaultConfig.audioMixMode,
    },
    indexttsApiUrl: {
      type: 'string',
      default: defaultConfig.indexttsApiUrl,
    },
    indexttsReferenceAudio: {
      type: 'string',
      default: defaultConfig.indexttsReferenceAudio,
    },
    indexttsReferenceMode: {
      type: 'string',
      enum: ['speaker-sample', 'segment-original'],
      default: defaultConfig.indexttsReferenceMode,
    },
    audioSeparatorPath: {
      type: 'string',
      default: defaultConfig.audioSeparatorPath,
    },
    subtitleTrack1: {
      type: 'string',
      enum: ['target', 'source', 'none'],
      default: defaultConfig.subtitleTrack1,
    },
    subtitleTrack2: {
      type: 'string',
      enum: ['target', 'source', 'none'],
      default: defaultConfig.subtitleTrack2,
    },
    manualReviewEnabled: {
      type: 'boolean',
      default: false,
    },
    subtitleStyle: {
      type: 'object',
      default: defaultConfig.subtitleStyle,
      properties: {
        enFontSize: { type: 'number', default: defaultConfig.subtitleStyle.enFontSize },
        cnFontSize: { type: 'number', default: defaultConfig.subtitleStyle.cnFontSize },
        enColor: { type: 'string', default: defaultConfig.subtitleStyle.enColor },
        cnColor: { type: 'string', default: defaultConfig.subtitleStyle.cnColor },
        enPosition: { type: 'string', enum: ['top', 'bottom'], default: defaultConfig.subtitleStyle.enPosition },
        cnPosition: { type: 'string', enum: ['top', 'bottom'], default: defaultConfig.subtitleStyle.cnPosition },
        bgColor: { type: 'string', default: defaultConfig.subtitleStyle.bgColor },
        bgOpacity: { type: 'number', default: defaultConfig.subtitleStyle.bgOpacity },
        fontFamily: { type: 'string', default: defaultConfig.subtitleStyle.fontFamily },
      },
    },
    subtitleMinSplitWidth: {
      type: 'integer',
      minimum: 0,
      default: defaultConfig.subtitleMinSplitWidth,
    },
    subtitleMaxSplitWidth: {
      type: 'integer',
      minimum: 0,
      default: defaultConfig.subtitleMaxSplitWidth,
    },
    subtitleSourceMinSplitWidth: {
      type: 'integer',
      minimum: 0,
      default: defaultConfig.subtitleSourceMinSplitWidth,
    },
    subtitleSourceMaxSplitWidth: {
      type: 'integer',
      minimum: 0,
      default: defaultConfig.subtitleSourceMaxSplitWidth,
    },
  },
})

function normalizeStoredConfig(): void {
  const splitWidthKeys = [
    'subtitleMinSplitWidth',
    'subtitleMaxSplitWidth',
    'subtitleSourceMinSplitWidth',
    'subtitleSourceMaxSplitWidth',
  ] as const
  for (const key of splitWidthKeys) {
    const stored = store.get(key) as unknown
    const normalized = normalizeSubtitleSplitWidth(stored, defaultConfig[key])
    if (stored !== normalized) {
      store.set(key, normalized)
    }
  }
}

normalizeStoredConfig()

export function getConfig(): AppConfig {
  normalizeStoredConfig()
  return store.store
}

export function setConfig(partial: Partial<AppConfig>): void {
  if (partial.subtitleStyle) {
    // 字幕样式通常由表单局部更新，合并可避免未提交字段被默认值覆盖。
    store.set('subtitleStyle', {
      ...store.get('subtitleStyle'),
      ...partial.subtitleStyle,
    })
  }

  if (partial.subtitleMinSplitWidth !== undefined) {
    store.set('subtitleMinSplitWidth', normalizeSubtitleSplitWidth(partial.subtitleMinSplitWidth, defaultConfig.subtitleMinSplitWidth))
  }
  if (partial.subtitleMaxSplitWidth !== undefined) {
    store.set('subtitleMaxSplitWidth', normalizeSubtitleSplitWidth(partial.subtitleMaxSplitWidth, defaultConfig.subtitleMaxSplitWidth))
  }
  if (partial.subtitleSourceMinSplitWidth !== undefined) {
    store.set('subtitleSourceMinSplitWidth', normalizeSubtitleSplitWidth(partial.subtitleSourceMinSplitWidth, defaultConfig.subtitleSourceMinSplitWidth))
  }
  if (partial.subtitleSourceMaxSplitWidth !== undefined) {
    store.set('subtitleSourceMaxSplitWidth', normalizeSubtitleSplitWidth(partial.subtitleSourceMaxSplitWidth, defaultConfig.subtitleSourceMaxSplitWidth))
  }

  const simpleKeys = [
    'locale',
    'themeMode',
    'sourceLanguage',
    'targetLanguage',
    'openaiApiKey',
    'outputDir',
    'proxyEnabled',
    'proxyUrl',
    'proxyBypass',
    'transcribeMode',
    'localWhisperApiUrl',
    'localWhisperCliPath',
    'whisperxPath',
    'whisperxHfToken',
    'hfMirrorEnabled',
    'hfMirrorUrl',
    'ytDlpPath',
    'translateMode',
    'openaiModel',
    'deepseekApiKey',
    'deepseekModel',
    'glmApiKey',
    'glmModel',
    'ttsMode',
    'syncMode',
    'pipelineMode',
    'audioMixMode',
    'indexttsApiUrl',
    'indexttsReferenceAudio',
    'indexttsReferenceMode',
    'audioSeparatorPath',
    'subtitleTrack1',
    'subtitleTrack2',
    'manualReviewEnabled',
  ] as const

  for (const key of simpleKeys) {
    if (partial[key] !== undefined) {
      store.set(key, partial[key])
    }
  }
}

export function getApiKey(): string {
  return store.get('openaiApiKey')
}

export function setApiKey(key: string): void {
  store.set('openaiApiKey', key)
}
