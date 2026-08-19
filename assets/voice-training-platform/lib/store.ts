import type {
  Checkpoint,
  Clip,
  LogEvent,
  LogLevel,
  Snapshot,
  TrainingRun,
  Video,
  Voice,
} from "./types"

// ---------------------------------------------------------------------------
// Singleton store (survives within a running server process; resets on restart)
// Kept on globalThis so Next.js HMR doesn't wipe it between edits.
// ---------------------------------------------------------------------------

type LogSubscriber = (event: LogEvent) => void

interface StoreData {
  videos: Map<string, Video>
  clips: Map<string, Clip>
  voices: Map<string, Voice>
  runs: Map<string, TrainingRun>
  checkpoints: Map<string, Checkpoint>
  logs: LogEvent[]
  subscribers: Set<LogSubscriber>
  seeded: boolean
  simStarted: boolean
}

const g = globalThis as unknown as { __voiceStore?: StoreData }

function createData(): StoreData {
  return {
    videos: new Map(),
    clips: new Map(),
    voices: new Map(),
    runs: new Map(),
    checkpoints: new Map(),
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

const SPEAKERS = ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02", "SPEAKER_03"]
const VOICE_COLORS = [
  "oklch(0.66 0.19 293)",
  "oklch(0.7 0.15 155)",
  "oklch(0.78 0.14 78)",
  "oklch(0.7 0.12 235)",
  "oklch(0.68 0.19 12)",
  "oklch(0.72 0.16 330)",
]

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

function randPeaks(n: number): number[] {
  const peaks: number[] = []
  for (let i = 0; i < n; i++) {
    // smooth-ish random envelope
    const base = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.5 + Math.random()))
    peaks.push(Math.max(0.08, Math.min(1, base * (0.6 + Math.random() * 0.5))))
  }
  return peaks
}

// ---------------------------------------------------------------------------
// Logging + pub/sub for SSE
// ---------------------------------------------------------------------------

export function log(key: string, level: LogLevel, stage: string, message: string): LogEvent {
  const event: LogEvent = { id: uid("log"), key, ts: Date.now(), level, stage, message }
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

export function getLogs(key?: string): LogEvent[] {
  if (!key || key === "all") return store.logs.slice(-500)
  return store.logs.filter((l) => l.key === key).slice(-500)
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export function getSnapshot(): Snapshot {
  return {
    videos: [...store.videos.values()].sort((a, b) => b.createdAt - a.createdAt),
    clips: [...store.clips.values()],
    voices: [...store.voices.values()].sort((a, b) => a.createdAt - b.createdAt),
    runs: [...store.runs.values()],
    checkpoints: [...store.checkpoints.values()],
  }
}

// ---------------------------------------------------------------------------
// Clip generation
// ---------------------------------------------------------------------------

export function makeClipsForVideo(video: Video, count: number) {
  for (let i = 0; i < count; i++) {
    const noisy = Math.random() < 0.2
    const durationSec = Math.round((2 + Math.random() * 9) * 10) / 10
    const clip: Clip = {
      id: uid("clip"),
      videoId: video.id,
      index: i,
      speakerLabel: SPEAKERS[Math.floor(Math.random() * Math.min(3, SPEAKERS.length))],
      sttText: SAMPLE_TEXT[i % SAMPLE_TEXT.length],
      status: noisy ? "rejected" : "pending",
      noisy,
      durationSec,
      audioUrl: `synth:${video.id}:${i}`,
      peaks: randPeaks(48),
    }
    store.clips.set(clip.id, clip)
    video.clipIds.push(clip.id)
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function addVideo(url: string, title?: string): Video {
  const id = uid("vid")
  const guessTitle =
    title ||
    `YouTube clip ${url.split("v=")[1]?.slice(0, 6) ?? Math.floor(Math.random() * 9999)}`
  const video: Video = {
    id,
    url,
    title: guessTitle,
    channel: "Imported Source",
    thumbnail: `/generic-youtube-thumbnail.png?height=180&width=320&query=audio waveform ${id}`,
    state: "queued",
    stage: "downloading",
    progress: 0,
    createdAt: Date.now(),
    clipIds: [],
  }
  store.videos.set(id, video)
  log(id, "info", "queue", `Queued ${url} for processing`)
  return video
}

export function patchClip(
  clipId: string,
  patch: Partial<Pick<Clip, "speakerLabel" | "sttText" | "status">>,
): Clip | null {
  const clip = store.clips.get(clipId)
  if (!clip) return null
  if (patch.speakerLabel !== undefined) clip.speakerLabel = patch.speakerLabel
  if (patch.sttText !== undefined) clip.sttText = patch.sttText
  if (patch.status !== undefined) {
    // noisy clips cannot be approved
    clip.status = clip.noisy && patch.status === "approved" ? "rejected" : patch.status
  }
  return clip
}

/**
 * Assign a clip to a voice by (re)labeling the speaker. Creates the voice if the
 * label maps to a new voice name. Returns the affected voice.
 */
export function assignClipToVoice(clipId: string, voiceName: string): Voice | null {
  const clip = store.clips.get(clipId)
  if (!clip) return null

  // detach from old voice
  if (clip.assignedVoiceId) {
    const old = store.voices.get(clip.assignedVoiceId)
    if (old) old.clipIds = old.clipIds.filter((c) => c !== clipId)
  }

  let voice = [...store.voices.values()].find((v) => v.name.toLowerCase() === voiceName.toLowerCase())
  if (!voice) voice = createVoice(voiceName)

  clip.speakerLabel = voiceName
  clip.assignedVoiceId = voice.id
  if (!voice.clipIds.includes(clipId)) voice.clipIds.push(clipId)
  return voice
}

export function createVoice(name: string): Voice {
  const id = uid("voice")
  const voice: Voice = {
    id,
    name,
    color: VOICE_COLORS[store.voices.size % VOICE_COLORS.length],
    createdAt: Date.now(),
    clipIds: [],
    runIds: [],
  }
  store.voices.set(id, voice)
  return voice
}

export function startTraining(voiceId: string): TrainingRun | null {
  const voice = store.voices.get(voiceId)
  if (!voice) return null
  const id = uid("run")
  const run: TrainingRun = {
    id,
    voiceId,
    state: "running",
    progress: 0,
    startedAt: Date.now(),
    etaHours: Math.round((6 + Math.random() * 40) * 10) / 10,
    step: 0,
    totalSteps: 100,
    checkpointIds: [],
  }
  store.runs.set(id, run)
  voice.runIds.push(id)
  log(id, "info", "train", `Started training run for voice "${voice.name}" (ETA ~${run.etaHours}h)`)
  return run
}

export function addCheckpoint(run: TrainingRun): Checkpoint {
  const voice = store.voices.get(run.voiceId)
  const cp: Checkpoint = {
    id: uid("ckpt"),
    runId: run.id,
    step: run.step,
    loss: Math.round((2.5 * Math.exp(-run.step / 45) + 0.15 + Math.random() * 0.05) * 1000) / 1000,
    createdAt: Date.now(),
    sampleUrl: `synth:${run.id}:${run.step}`,
    downloadUrl: `/api/voices/${run.voiceId}/export?ckpt=${run.step}`,
  }
  store.checkpoints.set(cp.id, cp)
  run.checkpointIds.push(cp.id)
  if (voice) voice.latestCheckpointId = cp.id
  return cp
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function seed() {
  if (store.seeded) return
  store.seeded = true

  // Complete video with clips + an assigned voice
  const v1 = addVideo("https://youtube.com/watch?v=aBcD12", "Building a Synth From Scratch")
  v1.channel = "Modular Lab"
  v1.state = "complete"
  v1.stage = "done"
  v1.progress = 100
  makeClipsForVideo(v1, 8)
  log(v1.id, "success", "done", "Processing complete — 8 clips extracted")

  // In-progress video
  const v2 = addVideo("https://youtube.com/watch?v=XyZ987", "Field Recording Walkthrough")
  v2.channel = "Ambient Field"
  v2.state = "in-progress"
  v2.stage = "transcribing"
  v2.progress = 42
  makeClipsForVideo(v2, 4)

  // Failed video
  const v3 = addVideo("https://youtube.com/watch?v=Fai1ed", "Corrupted Upload Test")
  v3.channel = "Test Source"
  v3.state = "failed"
  v3.stage = "downloading"
  v3.progress = 18
  log(v3.id, "error", "download", "ffmpeg exited with code 1 — stream unavailable")

  // A voice built from v1 clips
  const voice = createVoice("Narrator A")
  const v1clips = v1.clipIds.slice(0, 5)
  for (const cid of v1clips) {
    const clip = store.clips.get(cid)
    if (clip && !clip.noisy) {
      clip.assignedVoiceId = voice.id
      clip.speakerLabel = "Narrator A"
      voice.clipIds.push(cid)
    }
  }

  // A completed training run w/ checkpoints for that voice
  const run: TrainingRun = {
    id: uid("run"),
    voiceId: voice.id,
    state: "complete",
    progress: 100,
    startedAt: Date.now() - 1000 * 60 * 60 * 12,
    etaHours: 12,
    step: 100,
    totalSteps: 100,
    checkpointIds: [],
  }
  store.runs.set(run.id, run)
  voice.runIds.push(run.id)
  for (const step of [20, 40, 60, 80, 100]) {
    run.step = step
    addCheckpoint(run)
  }
  log(run.id, "success", "train", "Training run finished — final checkpoint saved")
}
