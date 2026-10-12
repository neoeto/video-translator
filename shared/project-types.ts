export const PROJECT_SCHEMA_VERSION = 1 as const

export type ProjectSourceType = 'youtube' | 'bilibili' | 'local-file'
export type ProjectResolution = 'original' | '1080p' | '720p' | '480p'
export type FrameFormat = 'png' | 'jpeg'
export type AudioFormat = 'wav' | 'mp3' | 'aac' | 'm4a' | 'flac' | 'ogg'

export interface ProjectSource {
  type: ProjectSourceType
  url?: string
  title?: string
}

export interface ProjectMediaInfo {
  duration: number
  width: number
  height: number
  format?: string
  videoCodec?: string
  audioCodec?: string
}

export interface ProjectAssets {
  video: string
  audio?: string
}

export interface ProjectGenerated {
  frames: string[]
  audio: string[]
  exports: string[]
}

export interface ProjectClip {
  id: string
  sourceStart: number
  sourceEnd: number
}

export interface ProjectTimeline {
  videoTrack: ProjectClip[]
  /** Phase 1 keeps the original audio aligned with the video track. */
  audioTrack: { type: 'original'; enabled: boolean }
}

export interface ProjectManifest {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: string
  name: string
  createdAt: number
  updatedAt: number
  source?: ProjectSource
  media?: ProjectMediaInfo
  assets: ProjectAssets
  generated: ProjectGenerated
  timeline: ProjectTimeline
}

export interface ProjectListItem {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  duration?: number
  thumbnail?: string
}

export interface ProjectCreateRequest {
  name?: string
}

export interface ProjectAcquireRequest {
  sourceType: ProjectSourceType
  url: string
}

export interface ProjectFrameRequest {
  assetPath?: string
  timestamp: number
  format?: FrameFormat
}

export interface ProjectFrameResult {
  assetPath: string
  width: number
  height: number
  timestamp: number
}

export interface ProjectAudioRequest {
  assetPath?: string
  format: AudioFormat
}

export interface ProjectAudioResult {
  assetPath: string
  format: AudioFormat
}

export interface ProjectSpeakerAudioRequest {
  assetPath?: string
  format: AudioFormat
}

export interface ProjectSpeakerAudioFile {
  speaker: string
  assetPath: string
  format: AudioFormat
  duration: number
}

export interface ProjectSpeakerAudioResult {
  files: ProjectSpeakerAudioFile[]
}

export interface ProjectRenderRequest {
  resolution: ProjectResolution
  timeline?: ProjectTimeline
  outputName?: string
}

export interface ProjectRenderResult {
  assetPath: string
  duration: number
}

export interface ProjectOperationProgress {
  projectId: string
  operationId: string
  stage: 'acquiring' | 'probing' | 'frame' | 'audio' | 'speaker-analysis' | 'speaker-export' | 'rendering'
  percent: number
}

export interface ProjectMediaMetadata extends ProjectMediaInfo {
  assetPath: string
}
