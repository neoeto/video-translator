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
  const venvWhisper = path.join(projectRoot, '.venv', 'bin', 'whisper')
  // 开发环境优先使用项目虚拟环境，避免误用系统 PATH 中版本不一致的 whisper。
  if (fs.existsSync(venvWhisper)) {
    return venvWhisper
  }

  try {
    // 打包或用户自定义安装时再查 PATH，最后保留命令名让调用阶段给出明确错误。
    const whichResult = execSync('which whisper', { encoding: 'utf8', timeout: 3000 }).trim()
    if (whichResult && fs.existsSync(whichResult)) {
      return whichResult
    }
  } catch {
    // not found on PATH
  }

  return 'whisper'
}

function detectWhisperxPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDir, '..', '..', '..')
  const venvWhisperx = path.join(projectRoot, '.venv', 'bin', 'whisperx')
  if (fs.existsSync(venvWhisperx)) {
    return venvWhisperx
  }

  try {
    const whichResult = execSync('which whisperx', { encoding: 'utf8', timeout: 3000 }).trim()
    if (whichResult && fs.existsSync(whichResult)) {
      return whichResult
    }
  } catch {
    // not found on PATH
  }

  return 'whisperx'
}

const defaultConfig: AppConfig = {
  locale: 'en',
  openaiApiKey: '',
  outputDir: path.join(os.homedir(), 'Movies', 'video-translator'),
  proxyEnabled: false,
  proxyUrl: '',
  transcribeMode: 'openai',
  localWhisperApiUrl: 'http://localhost:9000',
  localWhisperCliPath: detectWhisperPath(),
  whisperxPath: detectWhisperxPath(),
  whisperxHfToken: '',
  translateMode: 'openai',
  openaiModel: 'gpt-4o',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  glmApiKey: '',
  glmModel: 'glm-4-flash',
  ttsMode: 'edge',
  indexttsApiUrl: 'http://localhost:8080',
  indexttsReferenceAudio: '',
  subtitleStyle: {
    enFontSize: 16,
    cnFontSize: 22,
    enColor: '#FFFFFF',
    cnColor: '#FFFF00',
    enPosition: 'bottom',
    cnPosition: 'bottom',
    bgColor: '#000000',
    bgOpacity: 0.6,
    fontFamily: 'Arial',
  },
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
    indexttsApiUrl: {
      type: 'string',
      default: defaultConfig.indexttsApiUrl,
    },
    indexttsReferenceAudio: {
      type: 'string',
      default: defaultConfig.indexttsReferenceAudio,
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
  },
})

export function getConfig(): AppConfig {
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

  const simpleKeys = [
    'locale',
    'openaiApiKey',
    'outputDir',
    'proxyEnabled',
    'proxyUrl',
    'transcribeMode',
    'localWhisperApiUrl',
    'localWhisperCliPath',
    'whisperxPath',
    'whisperxHfToken',
    'translateMode',
    'openaiModel',
    'deepseekApiKey',
    'deepseekModel',
    'glmApiKey',
    'glmModel',
    'ttsMode',
    'indexttsApiUrl',
    'indexttsReferenceAudio',
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
