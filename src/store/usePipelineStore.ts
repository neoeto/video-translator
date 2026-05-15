import { create } from 'zustand'
import type { PipelineState, AppConfig, SpeakerProfile } from '../types'

interface PipelineStore {
  // Pipeline state (updated from main process via IPC)
  state: PipelineState
  // App config
  config: AppConfig
  // Loading states
  isLoadingConfig: boolean
  // Actions
  loadConfig: () => Promise<void>
  saveConfig: (partial: Partial<AppConfig>) => Promise<void>
  startPipeline: (url: string) => Promise<void>
  cancelPipeline: () => Promise<void>
  submitSpeakerLabels: (profiles: SpeakerProfile[]) => Promise<void>
  reset: () => void
  updateState: (state: Partial<PipelineState>) => void
}

const initialPipelineState: PipelineState = {
  stage: 'idle',
  progress: 0,
  overallProgress: 0,
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  state: initialPipelineState,
  config: {
    locale: 'en',
    openaiApiKey: '',
    outputDir: '',
    proxyEnabled: false,
    proxyUrl: '',
    transcribeMode: 'openai' as const,
    localWhisperApiUrl: 'http://localhost:9000',
    localWhisperCliPath: 'whisper',
    whisperxPath: 'whisperx',
    whisperxHfToken: '',
    translateMode: 'openai' as const,
    openaiModel: 'gpt-4o',
    deepseekApiKey: '',
    deepseekModel: 'deepseek-chat',
    glmApiKey: '',
    glmModel: 'glm-4-flash',
    ttsMode: 'edge' as const,
    syncMode: 'natural' as const,
    pipelineMode: 'full' as const,
    audioMixMode: 'replace' as const,
    indexttsApiUrl: 'http://localhost:8080',
    indexttsReferenceAudio: '',
    audioSeparatorPath: '',
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
  },
  isLoadingConfig: true,

  loadConfig: async () => {
    try {
      const config = await window.electronAPI.getConfig()
      set({ config, isLoadingConfig: false })
    } catch {
      set({ isLoadingConfig: false })
    }
  },

  saveConfig: async (partial) => {
    await window.electronAPI.setConfig(partial)
    // 写入后立即从主进程重读，避免前端局部合并与 electron-store 默认值/归一化结果不一致。
    const config = await window.electronAPI.getConfig()
    set({ config })
  },

  startPipeline: async (url: string) => {
    const { config } = get()
    // 通过 IPC 订阅主进程流水线进度，把事件流收敛成 zustand 的单一状态源。
    window.electronAPI.onProgress((pipelineState) => {
      set({ state: pipelineState })
    })
    await window.electronAPI.pipelineStart(url, config.outputDir)
  },

  cancelPipeline: async () => {
    await window.electronAPI.pipelineCancel()
  },

  submitSpeakerLabels: async (profiles: SpeakerProfile[]) => {
    await window.electronAPI.submitSpeakerLabels(profiles)
  },

  reset: () => {
    set({ state: initialPipelineState })
  },

  updateState: (partial) => {
    set((s) => ({ state: { ...s.state, ...partial } }))
  },
}))
