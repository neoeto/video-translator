import { create } from 'zustand'
import type { TranslatedSegment, ManualReviewData } from '../types'

export interface EditableSegment extends TranslatedSegment {
  id: string
  deleted: boolean
}

type EditorTool = 'select' | 'cut' | 'delete'
type SidePanel = 'subtitles' | 'audio'

interface EditorState {
  // Source data
  videoPath: string
  audioPath: string
  hasSynthesizedAudio: boolean // true if TTS audio exists (need segment-based sync)
  segments: EditableSegment[]
  segmentTimings: { start: number; end: number; actualDuration: number }[]
  duration: number

  // Playback
  isPlaying: boolean
  currentTime: number

  // Editor
  activeTool: EditorTool
  selectedSegmentId: string | null
  sidePanel: SidePanel
  zoomLevel: number // pixels per second

  // Undo/redo (full snapshot)
  undoStack: EditableSegment[][]
  redoStack: EditableSegment[][]

  // Waveform (loaded async)
  waveformData: number[]

  // Initialized
  initialized: boolean
}

interface EditorActions {
  init: (data: ManualReviewData) => void
  cleanup: () => void

  // Playback
  setPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void

  // Tools
  setTool: (tool: EditorTool) => void
  setSelectedSegment: (id: string | null) => void
  setSidePanel: (panel: SidePanel) => void
  zoomIn: () => void
  zoomOut: () => void

  // Segment editing
  updateSegmentText: (id: string, field: 'sourceText' | 'targetText', text: string) => void
  updateSegmentTime: (id: string, start: number, end: number) => void
  deleteSegment: (id: string) => void
  splitAtPlayhead: () => void

  // Undo/redo
  undo: () => void
  redo: () => void

  // Async data
  setWaveformData: (data: number[]) => void

  // Get result for submission
  getResult: () => { segments: TranslatedSegment[] }
}

type EditorStore = EditorState & EditorActions

const MIN_ZOOM = 5
const MAX_ZOOM = 200
const DEFAULT_ZOOM = 40
const MAX_UNDO = 50

function createSegmentId(): string {
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function pushSnapshot(stack: EditableSegment[][], segments: EditableSegment[]): EditableSegment[][] {
  const next = [...stack, segments.map(s => ({ ...s }))]
  if (next.length > MAX_UNDO) next.shift()
  return next
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  // Initial state
  videoPath: '',
  audioPath: '',
  hasSynthesizedAudio: false,
  segments: [],
  segmentTimings: [],
  duration: 0,
  isPlaying: false,
  currentTime: 0,
  activeTool: 'select',
  selectedSegmentId: null,
  sidePanel: 'subtitles',
  zoomLevel: DEFAULT_ZOOM,
  undoStack: [],
  redoStack: [],
  waveformData: [],
  initialized: false,

  init: (data) => {
    const segments: EditableSegment[] = data.segments.map((seg, i) => ({
      ...seg,
      id: createSegmentId() + `-${i}`,
      deleted: false,
    }))
    set({
      videoPath: data.videoPath,
      audioPath: data.synthesizedAudioPath || data.originalAudioPath || '',
      hasSynthesizedAudio: !!data.synthesizedAudioPath,
      segments,
      segmentTimings: data.segmentTimings,
      duration: data.duration,
      isPlaying: false,
      currentTime: 0,
      activeTool: 'select',
      selectedSegmentId: null,
      sidePanel: 'subtitles',
      zoomLevel: DEFAULT_ZOOM,
      undoStack: [],
      redoStack: [],
      waveformData: [],
      initialized: true,
    })
  },

  cleanup: () => {
    set({
      videoPath: '',
      audioPath: '',
      hasSynthesizedAudio: false,
      segments: [],
      segmentTimings: [],
      duration: 0,
      isPlaying: false,
      currentTime: 0,
      undoStack: [],
      redoStack: [],
      waveformData: [],
      initialized: false,
    })
  },

  setPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setTool: (tool) => set({ activeTool: tool }),
  setSelectedSegment: (id) => set({ selectedSegmentId: id }),
  setSidePanel: (panel) => set({ sidePanel: panel }),

  zoomIn: () => {
    const { zoomLevel } = get()
    set({ zoomLevel: Math.min(MAX_ZOOM, zoomLevel * 1.5) })
  },
  zoomOut: () => {
    const { zoomLevel } = get()
    set({ zoomLevel: Math.max(MIN_ZOOM, zoomLevel / 1.5) })
  },

  updateSegmentText: (id, field, text) => {
    const { segments, undoStack } = get()
    set({
      undoStack: pushSnapshot(undoStack, segments),
      redoStack: [],
      segments: segments.map(s => s.id === id ? { ...s, [field]: text } : s),
    })
  },

  updateSegmentTime: (id, start, end) => {
    const { segments, undoStack } = get()
    if (start < 0 || end <= start) return
    set({
      undoStack: pushSnapshot(undoStack, segments),
      redoStack: [],
      segments: segments.map(s => s.id === id ? { ...s, start, end } : s),
    })
  },

  deleteSegment: (id) => {
    const { segments, undoStack } = get()
    set({
      undoStack: pushSnapshot(undoStack, segments),
      redoStack: [],
      segments: segments.map(s => s.id === id ? { ...s, deleted: true } : s),
      selectedSegmentId: null,
    })
  },

  splitAtPlayhead: () => {
    const { segments, currentTime, undoStack } = get()
    // Find the segment at the playhead
    const idx = segments.findIndex(s => !s.deleted && currentTime > s.start + 0.1 && currentTime < s.end - 0.1)
    if (idx === -1) return

    const seg = segments[idx]
    const newSegments = [...segments]
    const seg1: EditableSegment = {
      ...seg,
      id: createSegmentId(),
      end: currentTime,
    }
    const seg2: EditableSegment = {
      ...seg,
      id: createSegmentId(),
      start: currentTime,
      targetText: '',
      sourceText: '',
    }
    newSegments.splice(idx, 1, seg1, seg2)

    set({
      undoStack: pushSnapshot(undoStack, segments),
      redoStack: [],
      segments: newSegments,
    })
  },

  undo: () => {
    const { undoStack, segments, redoStack } = get()
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    set({
      segments: prev,
      undoStack: undoStack.slice(0, -1),
      redoStack: pushSnapshot(redoStack, segments),
    })
  },

  redo: () => {
    const { redoStack, segments, undoStack } = get()
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    set({
      segments: next,
      redoStack: redoStack.slice(0, -1),
      undoStack: pushSnapshot(undoStack, segments),
    })
  },

  setWaveformData: (data) => set({ waveformData: data }),

  getResult: () => {
    const { segments } = get()
    return {
      segments: segments
        .filter(s => !s.deleted)
        .map(({ id: _, deleted: __, ...rest }) => rest),
    }
  },
}))
