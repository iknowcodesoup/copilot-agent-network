import { addCheckpoint, log, makeClipsForRun, seed, store } from "./store"
import { IngestStageLabels } from "./types"

// ---------------------------------------------------------------------------
// Tick-based pipeline + training simulator.
// A single global interval advances any in-progress work and emits log lines.
//
// Ingest (downloading → diarizing → awaiting_review) is driven per VoiceRun.
// Training is driven per TrainingProgress that has a runningJobId. Runs rest
// at awaiting_review once clips are ready; training is a separate voice-level
// job, matching the live model where a run is ingest-only.
// ---------------------------------------------------------------------------

const TARGET_EPOCHS = 20

function tickRuns() {
  for (const run of store.runs.values()) {
    if (run.phase === "downloading") {
      // walk the ordered ingest steps
      if (run.ingestStageIndex < IngestStageLabels.length - 1) {
        run.ingestStageIndex += 1
        log(run.id, IngestStageLabels[run.ingestStageIndex])
      } else {
        run.phase = "diarizing"
        run.updatedAt = new Date().toISOString()
        log(run.id, "Entering stage: splitting by speaker")
      }
    } else if (run.phase === "diarizing") {
      if (store.clips.size === 0 || run.clipCount === 0) {
        const count = 4 + Math.floor(Math.random() * 6)
        run.numSpeakers = 2 + Math.floor(Math.random() * 2)
        makeClipsForRun(run, count)
        log(run.id, `Extracted ${count} clips with speaker labels`)
      }
      run.phase = "awaiting_review"
      run.updatedAt = new Date().toISOString()
      const flagged = store.clips.size
        ? [...store.clips.values()].filter((c) => c.runId === run.id && c.flagged).length
        : 0
      log(run.id, `Processing complete — ${run.clipCount} clips (${flagged} flagged as low quality)`)
    }
    // awaiting_review / ready / failed: nothing to advance
  }
}

function tickTraining() {
  for (const progress of store.training.values()) {
    if (!progress.runningJobId) continue
    const voice = [...store.voices.values()].find(
      (v) => v.name.toLowerCase() === progress.character.toLowerCase(),
    )

    progress.currentEpoch = (progress.currentEpoch ?? 0) + 1
    const epoch = progress.currentEpoch
    progress.currentLoss =
      Math.round((2.5 * Math.exp(-epoch / 8) + 0.15 + Math.random() * 0.05) * 1000) / 1000

    log(voice?.id ?? progress.character, `epoch ${epoch}/${TARGET_EPOCHS} · loss ${progress.currentLoss}`)

    // checkpoint every ~4 epochs
    if (voice && epoch % 4 === 0) {
      const cp = addCheckpoint(voice, progress)
      log(voice.id, `Saved checkpoint ${cp.name}`)
    }

    if (epoch >= TARGET_EPOCHS) {
      progress.runningJobId = null
      if (voice) {
        addCheckpoint(voice, progress)
        voice.phase = "ready"
        voice.voyicerJobId = null
        voice.updatedAt = new Date().toISOString()
        log(voice.id, `Training complete for "${voice.name}" — model ready to export`)
      }
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
      tickRuns()
      tickTraining()
    } catch (err) {
      console.log("[v0] simulator tick error:", (err as Error).message)
    }
  }, 2500)
  // Node: don't keep process alive solely for this timer
  if (typeof (interval as { unref?: () => void }).unref === "function") {
    ;(interval as { unref: () => void }).unref()
  }
}
