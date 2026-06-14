import { create } from 'zustand'
import type { VideoSourceType } from '../types'

interface InputState {
  videoId: string
  localFilePath: string
  sourceType: VideoSourceType
  setVideoId: (v: string) => void
  setLocalFilePath: (v: string) => void
  setSourceType: (v: VideoSourceType) => void
}

export const useInputStore = create<InputState>((set) => ({
  videoId: '',
  localFilePath: '',
  sourceType: 'youtube',
  setVideoId: (videoId) => set({ videoId }),
  setLocalFilePath: (localFilePath) => set({ localFilePath }),
  setSourceType: (sourceType) => set({ sourceType }),
}))
