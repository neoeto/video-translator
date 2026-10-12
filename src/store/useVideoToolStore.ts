import { create } from 'zustand'
import type { ProjectClip, ProjectManifest, ProjectTimeline } from '../../shared/project-types'

export type VideoToolSaveState = 'saved' | 'saving' | 'error'

interface VideoToolState {
  projectId: string | null
  manifest: ProjectManifest | null
  selectedClipId: string | null
  playhead: number
  initialized: boolean
  loading: boolean
  saveState: VideoToolSaveState
  saveError: string | null
  undoStack: ProjectTimeline[]
  redoStack: ProjectTimeline[]
  progress: { operationId: string; stage: string; percent: number } | null
  sessionGeneration: number
  error: string | null
  editRevision: number
  init: (manifest: ProjectManifest) => void
  load: (projectId: string) => Promise<void>
  clear: () => Promise<void>
  mergePersistedManifest: (manifest: ProjectManifest, expectedProjectId: string, expectedGeneration: number) => boolean
  setPlayhead: (time: number) => void
  selectClip: (id: string | null) => void
  splitAtPlayhead: () => void
  deleteSelected: () => void
  trimSelected: (start: number, end: number) => void
  moveSelected: (direction: -1 | 1) => void
  undo: () => void
  redo: () => void
  saveNow: () => Promise<boolean>
  setProgress: (progress: VideoToolState['progress']) => void
  setError: (error: string | null) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function cloneTimeline(timeline: ProjectTimeline): ProjectTimeline {
  return { videoTrack: timeline.videoTrack.map((clip) => ({ ...clip })), audioTrack: { ...timeline.audioTrack } }
}

function clampTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, duration))
}

function timelineDuration(manifest: ProjectManifest | null): number {
  if (!manifest) return 0
  return manifest.timeline.videoTrack.reduce((total, clip) => total + Math.max(0, clip.sourceEnd - clip.sourceStart), 0)
}

function scheduleSave(get: () => VideoToolState) {
  clearTimeout(saveTimer!)
  saveTimer = null
  const state = get()
  const projectId = state.projectId
  const sessionGeneration = state.sessionGeneration
  saveTimer = setTimeout(() => {
    saveTimer = null
    const current = get()
    if (current.projectId !== projectId || current.sessionGeneration !== sessionGeneration) return
    void current.saveNow()
  }, 450)
}

export const useVideoToolStore = create<VideoToolState>((set, get) => ({
  projectId: null,
  manifest: null,
  selectedClipId: null,
  playhead: 0,
  initialized: false,
  loading: false,
  saveState: 'saved',
  saveError: null,
  undoStack: [],
  redoStack: [],
  progress: null,
  error: null,
  sessionGeneration: 0,
  editRevision: 0,

  init: (manifest) => {
    const firstClip = manifest.timeline.videoTrack[0]
    set({ projectId: manifest.id, manifest, selectedClipId: firstClip?.id ?? null, playhead: 0, initialized: true, loading: false, saveState: 'saved', saveError: null, undoStack: [], redoStack: [], error: null })
  },

  load: async (projectId) => {
    clearTimeout(saveTimer!)
    saveTimer = null
    const sessionGeneration = get().sessionGeneration + 1
    set({ loading: true, error: null, initialized: false, projectId, sessionGeneration })
    try {
      const manifest = await window.electronAPI.projectOpen(projectId)
      const current = get()
      if (current.projectId !== projectId || current.sessionGeneration !== sessionGeneration) return
      current.init(manifest)
    } catch (error) {
      const current = get()
      if (current.projectId !== projectId || current.sessionGeneration !== sessionGeneration) return
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  clear: async () => {
    clearTimeout(saveTimer!)
    saveTimer = null
    const state = get()
    const projectId = state.projectId
    const sessionGeneration = state.sessionGeneration
    if (projectId && state.manifest && state.saveState !== 'saved' && !await state.saveNow()) return
    const current = get()
    if (current.projectId !== projectId || current.sessionGeneration !== sessionGeneration) return
    set((latest) => ({ projectId: null, manifest: null, selectedClipId: null, playhead: 0, initialized: false, loading: false, saveState: 'saved', saveError: null, undoStack: [], redoStack: [], progress: null, error: null, sessionGeneration: latest.sessionGeneration + 1 }))
  },

  mergePersistedManifest: (persisted, expectedProjectId, expectedGeneration) => {
    const state = get()
    if (state.projectId !== expectedProjectId || state.sessionGeneration !== expectedGeneration || !state.manifest) return false
    set({ manifest: { ...state.manifest, media: persisted.media, generated: persisted.generated, assets: { ...state.manifest.assets, ...persisted.assets }, updatedAt: persisted.updatedAt } })
    return true
  },

  setPlayhead: (time) => set((state) => ({ playhead: clampTime(time, timelineDuration(state.manifest)) })),

  selectClip: (id) => set({ selectedClipId: id }),

  splitAtPlayhead: () => {
    const state = get()
    if (!state.manifest) return
    const timeline = cloneTimeline(state.manifest.timeline)
    let elapsed = 0
    const index = timeline.videoTrack.findIndex((clip) => {
      const next = elapsed + clip.sourceEnd - clip.sourceStart
      const found = state.playhead > elapsed && state.playhead < next
      elapsed = next
      return found
    })
    if (index < 0) return
    const clip = timeline.videoTrack[index]
    const offset = state.playhead - (elapsed - (clip.sourceEnd - clip.sourceStart))
    const splitSource = clip.sourceStart + offset
    const left: ProjectClip = { ...clip, sourceEnd: splitSource }
    const right: ProjectClip = { ...clip, id: `${clip.id}-split-${Date.now()}`, sourceStart: splitSource }
    timeline.videoTrack.splice(index, 1, left, right)
    set({ manifest: { ...state.manifest, timeline, updatedAt: Date.now() }, selectedClipId: right.id, undoStack: [...state.undoStack, cloneTimeline(state.manifest.timeline)], redoStack: [], saveState: 'saving', saveError: null, editRevision: state.editRevision + 1 })
    scheduleSave(get)
  },

  deleteSelected: () => {
    const state = get()
    if (!state.manifest || state.manifest.timeline.videoTrack.length <= 1 || !state.selectedClipId) return
    const current = state.manifest.timeline.videoTrack
    const index = current.findIndex((clip) => clip.id === state.selectedClipId)
    if (index < 0) return
    const timeline = cloneTimeline(state.manifest.timeline)
    timeline.videoTrack.splice(index, 1)
    const nextClip = timeline.videoTrack[Math.min(index, timeline.videoTrack.length - 1)]
    set({ manifest: { ...state.manifest, timeline, updatedAt: Date.now() }, selectedClipId: nextClip?.id ?? null, undoStack: [...state.undoStack, cloneTimeline(state.manifest.timeline)], redoStack: [], saveState: 'saving', saveError: null, editRevision: state.editRevision + 1 })
    scheduleSave(get)
  },

  trimSelected: (start, end) => {
    const state = get()
    if (!state.manifest || !state.selectedClipId || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return
    const duration = state.manifest.media?.duration ?? Number.POSITIVE_INFINITY
    if (end > duration) return
    const current = state.manifest.timeline.videoTrack.find((clip) => clip.id === state.selectedClipId)
    if (!current || start === current.sourceStart && end === current.sourceEnd) return
    const timeline = cloneTimeline(state.manifest.timeline)
    const clip = timeline.videoTrack.find((item) => item.id === state.selectedClipId)
    if (!clip) return
    clip.sourceStart = start
    clip.sourceEnd = end
    set({ manifest: { ...state.manifest, timeline, updatedAt: Date.now() }, undoStack: [...state.undoStack, cloneTimeline(state.manifest.timeline)], redoStack: [], saveState: 'saving', saveError: null, editRevision: state.editRevision + 1 })
    scheduleSave(get)
  },

  moveSelected: (direction) => {
    const state = get()
    if (!state.manifest || !state.selectedClipId) return
    const index = state.manifest.timeline.videoTrack.findIndex((clip) => clip.id === state.selectedClipId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= state.manifest.timeline.videoTrack.length) return
    const timeline = cloneTimeline(state.manifest.timeline)
    const [clip] = timeline.videoTrack.splice(index, 1)
    timeline.videoTrack.splice(target, 0, clip)
    set({ manifest: { ...state.manifest, timeline, updatedAt: Date.now() }, undoStack: [...state.undoStack, cloneTimeline(state.manifest.timeline)], redoStack: [], saveState: 'saving', saveError: null, editRevision: state.editRevision + 1 })
    scheduleSave(get)
  },

  undo: () => {
    const state = get()
    const previous = state.undoStack[state.undoStack.length - 1]
    if (!state.manifest || !previous) return
    const current = cloneTimeline(state.manifest.timeline)
    const timeline = cloneTimeline(previous)
    const selected = timeline.videoTrack.find((clip) => clip.id === state.selectedClipId) ?? timeline.videoTrack[0]
    set({ manifest: { ...state.manifest, timeline, updatedAt: Date.now() }, selectedClipId: selected?.id ?? null, undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, current], saveState: 'saving', saveError: null, editRevision: state.editRevision + 1 })
    scheduleSave(get)
  },

  redo: () => {
    const state = get()
    const next = state.redoStack[state.redoStack.length - 1]
    if (!state.manifest || !next) return
    const current = cloneTimeline(state.manifest.timeline)
    const timeline = cloneTimeline(next)
    const selected = timeline.videoTrack.find((clip) => clip.id === state.selectedClipId) ?? timeline.videoTrack[0]
    set({ manifest: { ...state.manifest, timeline, updatedAt: Date.now() }, selectedClipId: selected?.id ?? null, undoStack: [...state.undoStack, current], redoStack: state.redoStack.slice(0, -1), saveState: 'saving', saveError: null, editRevision: state.editRevision + 1 })
    scheduleSave(get)
  },

  saveNow: async () => {
    const state = get()
    if (!state.projectId || !state.manifest) return true
    const projectId = state.projectId
    const manifestToSave = state.manifest
    const sessionGeneration = state.sessionGeneration
    const editRevision = state.editRevision
    set({ saveState: 'saving', saveError: null })
    try {
      const manifest = await window.electronAPI.projectSave(projectId, manifestToSave)
      const current = get()
      if (current.projectId !== projectId || current.sessionGeneration !== sessionGeneration || current.editRevision !== editRevision) return false
      set({ manifest, saveState: 'saved', saveError: null })
      return true
    } catch (error) {
      const current = get()
      if (current.projectId !== projectId || current.sessionGeneration !== sessionGeneration || current.editRevision !== editRevision) return false
      set({ saveState: 'error', saveError: error instanceof Error ? error.message : String(error) })
      return false
    }
  },

  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
}))

export function getTimelineDuration(manifest: ProjectManifest | null): number {
  return timelineDuration(manifest)
}

export function timelineToSourceTime(manifest: ProjectManifest, timelineTime: number): number {
  let remaining = Math.max(0, timelineTime)
  for (let index = 0; index < manifest.timeline.videoTrack.length; index += 1) {
    const clip = manifest.timeline.videoTrack[index]
    const length = Math.max(0, clip.sourceEnd - clip.sourceStart)
    if (remaining < length || index === manifest.timeline.videoTrack.length - 1) return clip.sourceStart + Math.min(remaining, length)
    remaining -= length
  }
  return 0
}

export function sourceToTimelineTime(manifest: ProjectManifest, sourceTime: number): number {
  let timeline = 0
  for (const clip of manifest.timeline.videoTrack) {
    if (sourceTime >= clip.sourceStart && sourceTime <= clip.sourceEnd) return timeline + sourceTime - clip.sourceStart
    timeline += Math.max(0, clip.sourceEnd - clip.sourceStart)
  }
  return timeline
}
