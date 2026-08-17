import { addCheckpoint, log, makeClipsForVideo, seed, store } from "./store"
import type { VideoStage } from "./types"

// ---------------------------------------------------------------------------
// Tick-based pipeline + training simulator.
// A single global interval advances any in-progress work and emits log events.
// ---------------------------------------------------------------------------

const STAGE_ORDER: VideoStage[] = ["downloading", "transcribing", "diarizing", "done"]

const STAGE_MESSAGES: Record<VideoStage, string[]> = {
  downloading: [
    "Fetching stream manifest",
    "Downloading audio track (opus)",
    "Muxing to wav @ 24kHz",
  ],
  transcribing: [
    "Loading Whisper large-v3",
    "Running speech-to-text",
    "Aligning word timestamps",
  ],
  diarizing: [
    "Running speaker diarization",
    "Clustering speaker embeddings",
    "Segmenting into clips",
  ],
  done: ["Finalizing clip manifest"],
}

function tickVideos() {
  for (const video of store.videos.values()) {
    if (video.state !== "in-progress" && video.state !== "queued") continue
    if (video.state === "queued") {
      video.state = "in-progress"
      log(video.id, "info", "download", "Worker picked up job")
    }

    video.progress = Math.min(100, video.progress + 6 + Math.random() * 8)

    const stageIndex = Math.min(
      STAGE_ORDER.length - 1,
      Math.floor((video.progress / 100) * (STAGE_ORDER.length - 1)),
    )
    const newStage = STAGE_ORDER[stageIndex]

    // occasional log line for the current stage
    if (Math.random() < 0.7) {
      const msgs = STAGE_MESSAGES[newStage]
      log(video.id, "info", newStage, msgs[Math.floor(Math.random() * msgs.length)])
    }

    if (newStage !== video.stage) {
      video.stage = newStage
      log(video.id, "info", newStage, `Entering stage: ${newStage}`)
      if (newStage === "diarizing" && video.clipIds.length === 0) {
        const count = 4 + Math.floor(Math.random() * 6)
        makeClipsForVideo(video, count)
        log(video.id, "success", "diarizing", `Extracted ${count} clips with speaker labels`)
      }
    }

    if (video.progress >= 100) {
      video.progress = 100
      video.stage = "done"
      video.state = "complete"
      if (video.clipIds.length === 0) {
        const count = 4 + Math.floor(Math.random() * 6)
        makeClipsForVideo(video, count)
      }
      const noisy = video.clipIds
        .map((c) => store.clips.get(c))
        .filter((c) => c?.noisy).length
      log(
        video.id,
        "success",
        "done",
        `Processing complete — ${video.clipIds.length} clips (${noisy} auto-rejected as noisy)`,
      )
    }
  }
}

function tickRuns() {
  for (const run of store.runs.values()) {
    if (run.state !== "running") continue
    const voice = store.voices.get(run.voiceId)

    run.step = Math.min(run.totalSteps, run.step + 2 + Math.floor(Math.random() * 3))
    run.progress = Math.round((run.step / run.totalSteps) * 100)

    if (Math.random() < 0.8) {
      const loss = (2.5 * Math.exp(-run.step / 45) + 0.15 + Math.random() * 0.05).toFixed(3)
      log(run.id, "info", "train", `step ${run.step}/${run.totalSteps} · loss ${loss}`)
    }

    // checkpoint every ~20 steps
    if (run.step % 20 < 3 && !run.checkpointIds.some((cid) => store.checkpoints.get(cid)?.step === run.step)) {
      const cp = addCheckpoint(run)
      log(run.id, "success", "checkpoint", `Saved checkpoint @ step ${cp.step} (loss ${cp.loss})`)
    }

    if (run.step >= run.totalSteps) {
      run.progress = 100
      run.state = "complete"
      addCheckpoint(run)
      log(
        run.id,
        "success",
        "train",
        `Training complete for "${voice?.name ?? "voice"}" — model ready to export`,
      )
    }
  }
}

let interval: ReturnType<typeof setInterval> | null = null

export function ensureSimulator() {
  seed()
  if (store.simStarted) return
  store.simStarted = true
  if (interval) clearInterval(interval)
  interval = setInterval(() => {
    try {
      tickVideos()
      tickRuns()
    } catch (err) {
      console.log("[v0] simulator tick error:", (err as Error).message)
    }
  }, 2500)
  // Node: don't keep process alive solely for this timer
  if (typeof (interval as { unref?: () => void }).unref === "function") {
    ;(interval as { unref: () => void }).unref()
  }
}
