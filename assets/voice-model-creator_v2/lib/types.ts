// ---------------------------------------------------------------------------
// Canonical types.
//
// These mirror the real backend wire contract (formerly lib/types_live.ts).
// The app adopts them as the single source of truth. A few small UI-only
// extension shapes (StudioClip, LogLine, Snapshot) wrap the wire types so the
// SSE-driven studio can keep working without inventing data the API returns.
// ---------------------------------------------------------------------------

// ── Voice-run pipeline ─────────────────────────────────────────────────────

/*
 * Phases the pipeline moves a run through. Mirrors VoiceRunPhase in
 * apps/pythonapi/pythonapi/models/voice.py - a union, not a TS enum.
 */
export const VoiceRunPhases = [
  "downloading",
  "diarizing",
  "awaiting_review",
  "committing",
  "training",
  "exporting",
  "ready",
  "failed",
] as const

export type VoiceRunPhase = (typeof VoiceRunPhases)[number]

export const PhaseLabels: Record<VoiceRunPhase, string> = {
  downloading: "Downloading",
  diarizing: "Splitting by speaker",
  awaiting_review: "Waiting for review",
  committing: "Preparing dataset",
  training: "Training",
  exporting: "Exporting model",
  ready: "Ready",
  failed: "Failed",
}

export interface VideoResult {
  videoId: string
  title: string
  durationSec: number | null
  channel: string | null
  thumbnailUrl: string | null
  url: string
}

export interface VoiceRun {
  id: string
  primaryCharacter: string
  sourceUrl: string
  videoId: string | null
  videoTitle: string | null
  phase: VoiceRunPhase
  diarize: boolean
  numSpeakers: number | null
  speakerMap: Record<string, string | null>
  voyicerJobId: string | null
  /* which of DOWNLOADING's ordered ingest steps is in flight */
  ingestStageIndex: number
  commitStageIndex: number
  clipCount: number
  approvedCount: number
  checkpointPath: string | null
  /* last training progress the factory reported, pushed over the event stream */
  currentEpoch: number | null
  currentLoss: number | null
  error: string | null
  /* consecutive transient factory errors. Above zero means the run is waiting
     on a factory that is not answering, not that it has failed. */
  errorCount: number
  failedFromPhase: VoiceRunPhase | null
  /* the job that failed, kept so its log stays readable after voyicerJobId
     clears */
  failedJobId: string | null
  createdAt: string
  updatedAt: string
}

/*
 * DOWNLOADING's ordered ingest steps, mirroring INGEST_STAGES in
 * voice_pipeline_graph.py. Used only to label where a retry resumes - the
 * server is what actually walks them.
 */
export const IngestStageLabels = [
  "downloading the audio",
  "transcribing",
  "cutting clips",
  "splitting by speaker",
  "scoring clips for review",
] as const

/*
 * COMMITTING's ordered stages, mirroring the ordered_stages tuple in
 * _committing_node_factory.
 */
export const CommitStageLabels = [
  "merging approved clips",
  "resampling",
  "preprocessing",
] as const

// ── Clips & speakers ───────────────────────────────────────────────────────

export interface ClipSummary {
  clipId: string
  keep: boolean
  qualityScore: number | null
  flagged: boolean
  speakerLabel: string | null
  speakerCoverage: number | null
  durationSec: number | null
  startSec: number | null
  endSec: number | null
  text: string
}

export interface SpeakerGroup {
  speakerLabel: string | null
  assignedCharacter: string | null
  clipCount: number
  keptCount: number
  totalDurationSec: number
  clips: ClipSummary[]
}

export interface SpeakerBoard {
  runId: string
  videoId: string
  speakers: SpeakerGroup[]
}

// ── Training & checkpoints ─────────────────────────────────────────────────

export interface CheckpointSummary {
  path: string
  name: string
  epoch: number | null
  step: number | null
  modifiedAt: string | null
}

export interface TrainingProgress {
  character: string
  preprocessed: boolean
  runningJobId: string | null
  currentEpoch: number | null
  currentLoss: number | null
  checkpoints: CheckpointSummary[]
}

export interface JobLog {
  offset: number
  content: string
  state: string
}

// ── Clip decisions & assignment ────────────────────────────────────────────

export interface ClipDecision {
  clipId: string
  keep?: boolean
  speakerLabel?: string | null
}

// ── Durable Voice entity ───────────────────────────────────────────────────

/*
 * The durable Voice entity (Story 3.1) - independent of any one run, and
 * what the assign-speaker combobox searches and creates (Story 3.5).
 */
export const voicePhases = [
  "awaiting_commit",
  "training",
  "exporting",
  "ready",
  "failed",
] as const

export type VoicePhase = (typeof voicePhases)[number]

export interface VoiceSummary {
  id: string
  name: string
  phase: VoicePhase
}

/*
 * GET /voices/{id}'s full shape (Story 3.6): a VoiceSummary plus the
 * contribution audit trail the card's popover and clips modal both read.
 */
export interface VoiceDetail {
  id: string
  name: string
  phase: VoicePhase
  checkpointPath: string | null
  voyicerJobId: string | null
  contributions: VoiceContribution[]
  createdAt: string
  updatedAt: string
}

export interface VoiceContribution {
  id: string
  voiceId: string
  runId: string
  videoId: string | null
  videoTitle: string | null
  speakerLabel: string
  createdAt: string
}

/* What one assign call did: the mapping stored and the contribution rows
   it created in the same request - assign now commits immediately, so
   there is no separate commit response shape. */
export interface RunAssignResponse {
  runId: string
  voiceAssignments: Record<string, string | null>
  contributions: VoiceContribution[]
}

// ---------------------------------------------------------------------------
// UI-only extension shapes
//
// The wire types above describe individual API responses. The studio streams
// a single aggregate snapshot over SSE, so these compose the wire types into
// the shape the client consumes. They add no data the backend cannot supply:
//   - StudioClip: a ClipSummary plus the run/video linkage + ordering the list
//     UI needs. `audioUrl` is DERIVED (see lib/derive.ts), not stored.
//   - LogLine: one decoded line of a JobLog's text stream, tagged with the run
//     it came from so the monitor can filter by source.
// ---------------------------------------------------------------------------

export interface StudioClip extends ClipSummary {
  /** run this clip belongs to (clips are produced per VoiceRun) */
  runId: string
  /** video the run ingested, for grouping in the UI */
  videoId: string
  /** stable ordering within the run */
  index: number
  /** resolved voice from the run's speakerMap, when assigned */
  assignedVoiceId?: string | null
}

export interface LogLine {
  id: string
  /** the run id this line belongs to */
  key: string
  ts: number
  message: string
}

export interface Snapshot {
  runs: VoiceRun[]
  videos: VideoResult[]
  clips: StudioClip[]
  voices: VoiceDetail[]
  training: TrainingProgress[]
}
