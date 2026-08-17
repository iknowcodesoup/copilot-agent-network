export type VideoState = "queued" | "in-progress" | "failed" | "complete"
export type VideoStage = "downloading" | "transcribing" | "diarizing" | "done"
export type ClipStatus = "pending" | "approved" | "rejected"
export type TrainingState = "running" | "failed" | "complete"
export type LogLevel = "info" | "warn" | "error" | "success"

export interface LogEvent {
  id: string
  key: string // videoId or runId this log belongs to
  ts: number
  level: LogLevel
  stage: string
  message: string
}

export interface Clip {
  id: string
  videoId: string
  index: number
  speakerLabel: string
  sttText: string
  status: ClipStatus
  noisy: boolean
  durationSec: number
  audioUrl: string
  peaks: number[]
  assignedVoiceId?: string
}

export interface Video {
  id: string
  url: string
  title: string
  channel: string
  thumbnail: string
  state: VideoState
  stage: VideoStage
  progress: number // 0-100
  createdAt: number
  clipIds: string[]
}

export interface Checkpoint {
  id: string
  runId: string
  step: number
  loss: number
  createdAt: number
  sampleUrl: string
  downloadUrl: string
}

export interface TrainingRun {
  id: string
  voiceId: string
  state: TrainingState
  progress: number // 0-100
  startedAt: number
  etaHours: number
  step: number
  totalSteps: number
  checkpointIds: string[]
}

export interface Voice {
  id: string
  name: string
  color: string
  createdAt: number
  clipIds: string[]
  runIds: string[]
  latestCheckpointId?: string
}

export interface Snapshot {
  videos: Video[]
  clips: Clip[]
  voices: Voice[]
  runs: TrainingRun[]
  checkpoints: Checkpoint[]
}
