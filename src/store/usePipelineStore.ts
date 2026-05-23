import { create } from 'zustand'
import type { PipelineState, AppConfig, SpeakerProfile, VideoSourceType } from '../types'
import type { QueueState } from '../preload'

interface PipelineStore {
  // Pipeline state (updated from main process via IPC)
  state: PipelineState
  // Queue state
  queueState: QueueState
  // App config
  config: AppConfig
  // Loading states
  isLoadingConfig: boolean
  // Actions
  loadConfig: () => Promise<void>
  saveConfig: (partial: Partial<AppConfig>) => Promise<void>
  startPipeline: (url: string, sourceType?: VideoSourceType) => Promise<void>
  cancelPipeline: () => Promise<void>
  skipError: () => Promise<void>
  removeQueued: (taskId: string) => Promise<void>
  submitSpeakerLabels: (profiles: SpeakerProfile[]) => Promise<void>
  reset: () => void
  updateState: (state: Partial<PipelineState>) => void
}

const initialPipelineState: PipelineState = {
  stage: 'idle',
  progress: 0,
  overallProgress: 0,
}

const initialQueueState: QueueState = {
  active: null,
  pending: [],
}

let progressCleanup: (() => void) | null = null
let queueCleanup: (() => void) | null = null

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  state: initialPipelineState,
  queueState: initialQueueState,
  config: {
    locale: 'en',
    sourceLanguage: 'auto' as const,
    targetLanguage: 'zh' as const,
    openaiApiKey: '',
    outputDir: '',
    proxyEnabled: false,
    proxyUrl: '',
    proxyBypass: 'localhost, 127.0.0.1',
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
  },
  isLoadingConfig: true,

  loadConfig: async () => {
    try {
      const config = await window.electronAPI.getConfig()
      set({ config, isLoadingConfig: false })
    } catch {
      set({ isLoadingConfig: false })
    }

    // Set up queue state listener
    if (!queueCleanup) {
      queueCleanup = window.electronAPI.onQueueState((qs) => {
        set({ queueState: qs })
      })
    }
  },

  saveConfig: async (partial) => {
    await window.electronAPI.setConfig(partial)
    const config = await window.electronAPI.getConfig()
    set({ config })
  },

  startPipeline: async (url: string, sourceType: VideoSourceType = 'youtube') => {
    const { config } = get()
    // Set up progress listener if not already active
    if (!progressCleanup) {
      progressCleanup = window.electronAPI.onProgress((pipelineState) => {
        set({ state: pipelineState })
      })
    }
    await window.electronAPI.pipelineStart(url, config.outputDir, sourceType)
  },

  cancelPipeline: async () => {
    await window.electronAPI.pipelineCancel()
  },

  skipError: async () => {
    await window.electronAPI.pipelineSkipError()
  },

  removeQueued: async (taskId: string) => {
    await window.electronAPI.pipelineRemoveQueued(taskId)
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
