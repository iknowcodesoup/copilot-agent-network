import type {
  CheckpointSummary,
  LogLine,
  Snapshot,
  StudioClip,
  TrainingProgress,
  VideoResult,
  VoiceContribution,
  VoiceDetail,
  VoiceRun,
} from "./types"

// ---------------------------------------------------------------------------
// Singleton store (survives within a running server process; resets on restart)
// Kept on globalThis so Next.js HMR doesn't wipe it between edits.
//
// Everything here is shaped as the live wire types (VoiceRun, VideoResult,
// ClipSummary via StudioClip, VoiceDetail, TrainingProgress). The pipeline is
// still simulated (see simulator.ts); only the shapes changed.
// ---------------------------------------------------------------------------

type LogSubscriber = (event: LogLine) => void

interface StoreData {
  runs: Map<string, VoiceRun>
  videos: Map<string, VideoResult>
  clips: Map<string, StudioClip>
  voices: Map<string, VoiceDetail>
  training: Map<string, TrainingProgress> // keyed by character (voice name)
  logs: LogLine[]
  subscribers: Set<LogSubscriber>
  seeded: boolean
  simStarted: boolean
}

const g = globalThis as unknown as { __voiceStore?: StoreData }

function createData(): StoreData {
  return {
    runs: new Map(),
    videos: new Map(),
    clips: new Map(),
    voices: new Map(),
    training: new Map(),
    logs: [],
    subscribers: new Set(),
    seeded: false,
    simStarted: false,
  }
}

export const store: StoreData = g.__voiceStore ?? (g.__voiceStore = createData())

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

let counter = 0
export function uid(prefix = "id"): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`
}

const nowISO = () => new Date().toISOString()

const SPEAKERS = ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02", "SPEAKER_03"]

const SAMPLE_TEXT = [
  "Welcome back to the channel, today we are diving into something special.",
  "So the first thing you want to do is set everything up carefully.",
  "I really think this is going to change the way you work forever.",
  "Let me show you exactly what I mean by that.",
  "And that is basically all there is to it, pretty simple right.",
  "Make sure to check the description for all of the links.",
  "This part took me way longer than I expected to get right.",
  "Alright let us go ahead and jump straight into the demo.",
  "Thanks so much for watching, I will see you in the next one.",
  "Honestly the results speak for themselves at this point.",
]

// ---------------------------------------------------------------------------
// Logging + pub/sub for SSE.
//
// The live backend exposes logs as a polled JobLog blob (offset + content).
// The studio streams them as decoded lines instead; each line is tagged with
// the run (or voice) it belongs to so the monitor can filter by source.
// ---------------------------------------------------------------------------

export function log(key: string, message: string): LogLine {
  const event: LogLine = { id: uid("log"), key, ts: Date.now(), message }
  store.logs.push(event)
  if (store.logs.length > 2000) store.logs.splice(0, store.logs.length - 2000)
  for (const sub of store.subscribers) {
    try {
      sub(event)
    } catch {
      // ignore broken subscribers
    }
  }
  return event
}

export function subscribe(sub: LogSubscriber): () => void {
  store.subscribers.add(sub)
  return () => store.subscribers.delete(sub)
}

export function getLogs(key?: string): LogLine[] {
  if (!key || key === "all") return store.logs.slice(-500)
  return store.logs.filter((l) => l.key === key).slice(-500)
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function getSnapshot(): Snapshot {
  return {
    runs: [...store.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    videos: [...store.videos.values()],
    clips: [...store.clips.values()],
    voices: [...store.voices.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    training: [...store.training.values()],
  }
}

// ---------------------------------------------------------------------------
// Derived helpers on stored state
// ---------------------------------------------------------------------------

export function clipsOfRun(runId: string): StudioClip[] {
  return [...store.clips.values()].filter((c) => c.runId === runId).sort((a, b) => a.index - b.index)
}

export function clipsOfVoice(voiceId: string): StudioClip[] {
  return [...store.clips.values()].filter((c) => c.assignedVoiceId === voiceId)
}

function recountRun(run: VoiceRun) {
  const clips = clipsOfRun(run.id)
  run.clipCount = clips.length
  run.approvedCount = clips.filter((c) => c.keep).length
  run.updatedAt = nowISO()
}

export function trainingFor(name: string): TrainingProgress | undefined {
  return store.training.get(name.toLowerCase())
}

// ---------------------------------------------------------------------------
// Clip generation
// ---------------------------------------------------------------------------

export function makeClipsForRun(run: VoiceRun, count: number) {
  const existing = clipsOfRun(run.id).length
  let cursor = existing * 6
  for (let i = 0; i < count; i++) {
    const index = existing + i
    const flagged = Math.random() < 0.2
    const durationSec = Math.round((2 + Math.random() * 9) * 10) / 10
    const startSec = cursor
    cursor += durationSec
    const clip: StudioClip = {
      clipId: uid("clip"),
      runId: run.id,
      videoId: run.videoId ?? run.id,
      index,
      keep: !flagged, // flagged clips start discarded (collapsed keep on/off)
      qualityScore: Math.round((flagged ? 0.3 + Math.random() * 0.3 : 0.6 + Math.random() * 0.4) * 100) / 100,
      flagged,
      speakerLabel: SPEAKERS[Math.floor(Math.random() * Math.min(3, SPEAKERS.length))],
      speakerCoverage: Math.round((0.4 + Math.random() * 0.6) * 100) / 100,
      durationSec,
      startSec: Math.round(startSec * 10) / 10,
      endSec: Math.round((startSec + durationSec) * 10) / 10,
      text: SAMPLE_TEXT[index % SAMPLE_TEXT.length],
      assignedVoiceId: null,
    }
    store.clips.set(clip.clipId, clip)
  }
  recountRun(run)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function addVideo(url: string, title?: string): VoiceRun {
  const videoId = uid("vid")
  const guessTitle =
    title || `YouTube clip ${url.split("v=")[1]?.slice(0, 6) ?? Math.floor(Math.random() * 9999)}`

  const video: VideoResult = {
    videoId,
    title: guessTitle,
    durationSec: null,
    channel: "Imported Source",
    thumbnailUrl: `/generic-youtube-thumbnail.png?height=180&width=320&query=audio waveform ${videoId}`,
    url,
  }
  store.videos.set(videoId, video)

  const run: VoiceRun = {
    id: uid("run"),
    primaryCharacter: guessTitle,
    sourceUrl: url,
    videoId,
    videoTitle: guessTitle,
    phase: "downloading",
    diarize: true,
    numSpeakers: null,
    speakerMap: {},
    voiceAssignments: {},
    voyicerJobId: uid("job"),
    ingestStageIndex: 0,
    commitStageIndex: 0,
    clipCount: 0,
    approvedCount: 0,
    checkpointPath: null,
    currentEpoch: null,
    currentLoss: null,
    error: null,
    errorCount: 0,
    failedFromPhase: null,
    failedJobId: null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  store.runs.set(run.id, run)
  log(run.id, `Queued ${url} for processing`)
  return run
}

export function patchClip(
  clipId: string,
  patch: { speakerLabel?: string; text?: string; keep?: boolean },
): StudioClip | null {
  const clip = store.clips.get(clipId)
  if (!clip) return null
  if (patch.speakerLabel !== undefined) clip.speakerLabel = patch.speakerLabel
  if (patch.text !== undefined) clip.text = patch.text
  if (patch.keep !== undefined) clip.keep = patch.keep
  const run = store.runs.get(clip.runId)
  if (run) recountRun(run)
  return clip
}

/**
 * Assign a clip to a voice by (re)labeling its speaker. Creates the voice if
 * the name is new, records the run→voice contribution, and updates the run's
 * speaker map. Returns the affected voice.
 */
export function assignClipToVoice(clipId: string, voiceName: string): VoiceDetail | null {
  const clip = store.clips.get(clipId)
  if (!clip) return null

  // detach from previous voice
  if (clip.assignedVoiceId) {
    const old = store.voices.get(clip.assignedVoiceId)
    if (old && !clipsOfVoice(old.id).some((c) => c.clipId !== clipId)) {
      // nothing else to do; contribution audit stays
    }
  }

  let voice = [...store.voices.values()].find((v) => v.name.toLowerCase() === voiceName.toLowerCase())
  if (!voice) voice = createVoice(voiceName)

  clip.speakerLabel = voiceName
  clip.assignedVoiceId = voice.id

  const run = store.runs.get(clip.runId)
  if (run) {
    run.speakerMap[voiceName] = voice.name
    run.updatedAt = nowISO()
    const already = voice.contributions.some(
      (c) => c.runId === run.id && c.speakerLabel === voiceName,
    )
    if (!already) {
      const contribution: VoiceContribution = {
        id: uid("contrib"),
        voiceId: voice.id,
        runId: run.id,
        videoId: run.videoId,
        videoTitle: run.videoTitle,
        speakerLabel: voiceName,
        createdAt: nowISO(),
      }
      voice.contributions.push(contribution)
    }
  }
  voice.updatedAt = nowISO()
  return voice
}

export function createVoice(name: string): VoiceDetail {
  const id = uid("voice")
  const voice: VoiceDetail = {
    id,
    name,
    phase: "awaiting_commit",
    checkpointPath: null,
    voyicerJobId: null,
    contributions: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  store.voices.set(id, voice)
  return voice
}

export function startTraining(voiceId: string): TrainingProgress | null {
  const voice = store.voices.get(voiceId)
  if (!voice) return null
  const jobId = uid("job")
  voice.phase = "training"
  voice.voyicerJobId = jobId
  voice.updatedAt = nowISO()

  const key = voice.name.toLowerCase()
  const progress: TrainingProgress = {
    character: voice.name,
    preprocessed: true,
    runningJobId: jobId,
    currentEpoch: 0,
    currentLoss: null,
    checkpoints: [],
  }
  store.training.set(key, progress)
  log(voice.id, `Started training run for voice "${voice.name}"`)
  return progress
}

export function addCheckpoint(voice: VoiceDetail, progress: TrainingProgress): CheckpointSummary {
  const epoch = progress.currentEpoch ?? 0
  const cp: CheckpointSummary = {
    path: `/models/${voice.id}/epoch_${epoch}.ckpt`,
    name: `epoch_${epoch}`,
    epoch,
    step: epoch * 100,
    modifiedAt: nowISO(),
  }
  progress.checkpoints.push(cp)
  voice.checkpointPath = cp.path
  voice.updatedAt = nowISO()
  return cp
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function seed() {
  if (store.seeded) return
  store.seeded = true

  // Fully ingested run, resting at awaiting_review with clips ready.
  const r1 = addVideo("https://youtube.com/watch?v=aBcD12", "Building a Synth From Scratch")
  const v1 = store.videos.get(r1.videoId!)!
  v1.channel = "Modular Lab"
  r1.phase = "awaiting_review"
  r1.numSpeakers = 2
  makeClipsForRun(r1, 8)
  log(r1.id, "Processing complete — 8 clips extracted, ready for review")

  // In-progress run (still diarizing).
  const r2 = addVideo("https://youtube.com/watch?v=XyZ987", "Field Recording Walkthrough")
  const v2 = store.videos.get(r2.videoId!)!
  v2.channel = "Ambient Field"
  r2.phase = "diarizing"
  r2.ingestStageIndex = 3
  makeClipsForRun(r2, 4)

  // Failed run.
  const r3 = addVideo("https://youtube.com/watch?v=Fai1ed", "Corrupted Upload Test")
  const v3 = store.videos.get(r3.videoId!)!
  v3.channel = "Test Source"
  r3.phase = "failed"
  r3.error = "ffmpeg exited with code 1 — stream unavailable"
  r3.failedFromPhase = "downloading"
  r3.failedJobId = r3.voyicerJobId
  log(r3.id, "ffmpeg exited with code 1 — stream unavailable")

  // A trained voice built from r1 clips.
  const voice = createVoice("Narrator A")
  const r1clips = clipsOfRun(r1.id).slice(0, 5)
  for (const clip of r1clips) {
    if (clip.flagged) continue
    clip.assignedVoiceId = voice.id
    clip.speakerLabel = "Narrator A"
    r1.speakerMap["Narrator A"] = "Narrator A"
    voice.contributions.push({
      id: uid("contrib"),
      voiceId: voice.id,
      runId: r1.id,
      videoId: r1.videoId,
      videoTitle: r1.videoTitle,
      speakerLabel: "Narrator A",
      createdAt: nowISO(),
    })
  }
  recountRun(r1)

  // A completed training with checkpoints for that voice.
  const progress: TrainingProgress = {
    character: voice.name,
    preprocessed: true,
    runningJobId: null,
    currentEpoch: 20,
    currentLoss: 0.21,
    checkpoints: [],
  }
  store.training.set(voice.name.toLowerCase(), progress)
  for (const epoch of [4, 8, 12, 16, 20]) {
    progress.currentEpoch = epoch
    addCheckpoint(voice, progress)
  }
  progress.currentEpoch = 20
  progress.currentLoss = 0.21
  voice.phase = "ready"
  log(voice.id, `Training run finished — final checkpoint saved`)
}
