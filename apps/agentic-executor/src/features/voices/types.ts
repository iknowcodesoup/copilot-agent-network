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
/* A run ingests one video and stops at "ingested". It trains nothing: a
   voice is built from clips spread across many videos, so training is a
   VoicePhase. There is no review phase either - whether a video is fully
   reviewed is derived from its clips (see reviewStatus in derive.ts). */
export const VoiceRunPhases = [
  "downloading",
  "diarizing",
  "ingested",
  "failed",
] as const

export type VoiceRunPhase = (typeof VoiceRunPhases)[number]

export const PhaseLabels: Record<VoiceRunPhase, string> = {
  downloading: "Downloading",
  diarizing: "Splitting by speaker",
  ingested: "Ingested",
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

/*
 * One ingested video, as the voice factory describes it. The factory owns a
 * video: its title, its clip count, and whether it was diarized or reviewed
 * all come from work/ on that host, so nothing here is stored in Postgres and
 * nothing here belongs to a run. Runs join onto this by videoId.
 */
export interface VideoSummary {
  videoId: string
  title: string
  diarized: boolean
  reviewed: boolean
  clipCount: number
  url: string | null
  durationSec: number | null
  channel: string | null
  thumbnailUrl: string | null
  ingestedAt: string | null
}

export interface VoiceRun {
  id: string
  primaryCharacter: string
  sourceUrl: string
  /* the only join to the factory, which owns the video itself. Null until the
     run resolves it, and stale once that video is gone - see VideosView, which
     marks such a run orphaned. */
  videoId: string | null
  phase: VoiceRunPhase
  diarize: boolean
  numSpeakers: number | null
  voyicerJobId: string | null
  /* which of DOWNLOADING's ordered ingest steps is in flight */
  ingestStageIndex: number
  commitStageIndex: number
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
 * A voice's COMPILING stages, mirroring COMPILE_STAGES in the API's
 * core/voice_graph_support.py. This is what turns clip decisions into
 * training audio, at training start.
 */
export const CompileStageLabels = [
  "gathering assigned clips",
  "resampling",
  "preprocessing",
] as const

// ── Clips & speakers ───────────────────────────────────────────────────────

export interface ClipSummary {
  clipId: string
  /* true/false is a reviewer's decision; null is unreviewed - neither kept
     nor excluded. Distinct states, not a default: a voice's dataset gathers
     the clips that reached true and name it, when that voice next trains. */
  keep: boolean | null
  qualityScore: number | null
  flagged: boolean
  /* which video the clip was cut from. Set when clips are read across
     videos - a voice's own list spans several - and null when the caller
     already named one video, as the review board does. */
  videoId: string | null
  speakerLabel: string | null
  speakerCoverage: number | null
  /* Which voice this clip trains. speakerLabel is what diarization heard;
     this is the decision made about it, and it is the only thing a dataset
     reads. */
  voiceId: string | null
  /* the voice's name, resolved from voiceId server-side on every read. Never
     stored beside the id - a rename would leave the copy behind. */
  voiceName: string | null
  durationSec: number | null
  startSec: number | null
  endSec: number | null
  text: string
  excludedReason: string
}

export interface SpeakerGroup {
  speakerLabel: string | null
  clipCount: number
  keptCount: number
  totalDurationSec: number
  clips: ClipSummary[]
}

/* Keyed on the video, because the clips are. runId is null for a video no run
   has claimed. */
export interface SpeakerBoard {
  videoId: string
  runId: string | null
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

/* Omitted means "don't touch". "none" clears a clip back to unreviewed -
   the third state a plain boolean cannot reach. */
export type KeepDecision = "kept" | "excluded" | "none"

/* One change to one clip. Only the fields given are applied, so keeping a
   clip and retyping its text are separate calls that do not overwrite each
   other. Which voice a clip trains is not here - see useAssignClips - so
   assigning cannot be smuggled in beside a keep. */
export interface ClipDecision {
  clipId: string
  keep?: KeepDecision
  speakerLabel?: string | null
  text?: string
  /* a trim from the review UI; both must be given together */
  startSec?: number
  endSec?: number
}

// ── Durable Voice entity ───────────────────────────────────────────────────

/*
 * The durable Voice entity (Story 3.1) - independent of any one run, and
 * what the assign-speaker combobox searches and creates (Story 3.5).
 */
export const voicePhases = [
  "awaiting_commit",
  "compiling",
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
 * GET /voices/{id}'s full shape: a VoiceSummary plus every clip assigned to
 * it, which is what the card grid counts and the panel lists.
 */
export interface VoiceDetail {
  id: string
  name: string
  phase: VoicePhase
  checkpointPath: string | null
  voyicerJobId: string | null
  clips: VoiceClip[]
  createdAt: string
  updatedAt: string
}

/* One clip assigned to one voice, named by the video it came from.

   videoTitle is resolved from videoId at read time and is null when the
   factory is unset or no longer holds that video - the clip still shows,
   because it is still assigned and will still train. */
export interface VoiceClip {
  videoId: string
  clipId: string
  videoTitle: string | null
  keep: boolean | null
  text: string
  startSec: number
  endSec: number
  durationSec: number
  flagged: boolean
  /** what diarization heard, carried for display only */
  speakerLabel: string | null
}

/* What one assign or unassign call did, and what the voice now holds. */
export interface VoiceAssignResponse {
  voiceId: string
  assignedCount: number
  clips: VoiceClip[]
}

// ---------------------------------------------------------------------------
// UI-only extension shapes
//
// The wire types above describe individual API responses. These two add the
// linkage the list UI needs on top, and nothing the backend cannot supply:
//   - StudioClip: a ClipSummary plus the run/video linkage the list UI needs.
//     `audioUrl` is DERIVED (see clipAudioUrl in voice_api.ts), not stored.
//   - LogLine: one decoded line of a JobLog's text stream, tagged with the run
//     it came from so the monitor can filter by source.
//
// There is no aggregate Snapshot type. Components read the query hooks in
// lib/voice_api.ts directly, which is the one reactive source - the event
// stream writes pushed updates straight into that cache.
// ---------------------------------------------------------------------------

export interface StudioClip extends ClipSummary {
  /** run this clip belongs to (clips are produced per VoiceRun) */
  runId: string
  /** video the run ingested, for grouping in the UI */
  videoId: string
}

export interface LogLine {
  id: string
  /** the run id this line belongs to */
  key: string
  ts: number
  message: string
}
