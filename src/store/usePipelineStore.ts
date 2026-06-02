import { create } from 'zustand'
import type { PipelineState, AppConfig, DepInstallProgress, MissingDep, SpeakerProfile, VideoSourceType, ManualReviewResult } from '../types'
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
  missingDeps: MissingDep[] | null
  installingDeps: boolean
  depInstallProgress: DepInstallProgress | null
  // Actions
  loadConfig: () => Promise<void>
  saveConfig: (partial: Partial<AppConfig>) => Promise<void>
  startPipeline: (url: string, sourceType?: VideoSourceType) => Promise<boolean>
  installDeps: () => Promise<void>
  dismissDepsDialog: () => void
  cancelPipeline: () => Promise<void>
  skipError: () => Promise<void>
  removeQueued: (taskId: string) => Promise<void>
  submitSpeakerLabels: (profiles: SpeakerProfile[]) => Promise<void>
  submitManualReview: (result: ManualReviewResult) => Promise<void>
  cancelManualReview: () => Promise<void>
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
    themeMode: 'dark' as const,
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
    hfMirrorEnabled: false,
    hfMirrorUrl: '',
    ytDlpPath: 'yt-dlp',
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
    indexttsReferenceMode: 'speaker-sample' as const,
    audioSeparatorPath: '',
    subtitleTrack1: 'target' as const,
    subtitleTrack2: 'source' as const,
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
    subtitleMinSplitWidth: 20,
    subtitleMaxSplitWidth: 60,
    subtitleSourceMinSplitWidth: 20,
    subtitleSourceMaxSplitWidth: 60,
  },
  isLoadingConfig: true,
  missingDeps: null,
  installingDeps: false,
  depInstallProgress: null,

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
    const missing = await window.electronAPI.depsCheck(sourceType)
    if (missing.length > 0) {
      set({ missingDeps: missing })
      return false
    }

    if (!progressCleanup) {
      progressCleanup = window.electronAPI.onProgress((pipelineState) => {
        set({ state: pipelineState })
      })
    }
    await window.electronAPI.pipelineStart(url, config.outputDir, sourceType)
    return true
  },

  installDeps: async () => {
    const { missingDeps } = get()
    if (!missingDeps?.length) return

    set({ installingDeps: true, depInstallProgress: null })
    const depsProgressCleanup = window.electronAPI.onDepsProgress((progress) => {
      set({ depInstallProgress: progress })
    })
    try {
      const remaining = await window.electronAPI.depsInstall(missingDeps)
      set({
        missingDeps: remaining.length > 0 ? remaining : null,
        installingDeps: false,
      })
      await get().loadConfig()
    } catch {
      set({ installingDeps: false })
    } finally {
      depsProgressCleanup()
    }
  },

  dismissDepsDialog: () => {
    set({ missingDeps: null, installingDeps: false, depInstallProgress: null })
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

  submitManualReview: async (result: ManualReviewResult) => {
    await window.electronAPI.submitManualReview(result)
  },

  cancelManualReview: async () => {
    await window.electronAPI.cancelManualReview()
  },

  reset: () => {
    set({ state: initialPipelineState, missingDeps: null, installingDeps: false, depInstallProgress: null })
  },

  updateState: (partial) => {
    set((s) => ({ state: { ...s.state, ...partial } }))
  },
}))
