import type { VoiceRun, VoiceRunPhase } from "./types"

/** A run's display title.

    The video's real name belongs to the video, which the factory owns, so a
    run names itself by the character it is training. Where the video's title
    matters, read it from the videos list and join on videoId. */
export function runTitle(run: VoiceRun): string {
  return run.primaryCharacter || run.sourceUrl
}

/** Map a run phase to a StatusPill tone. */
export function toneForPhase(
  phase: VoiceRunPhase,
): "in-progress" | "complete" | "failed" | "queued" {
  if (phase === "failed") return "failed"
  if (phase === "ready") return "complete"
  if (phase === "awaiting_review") return "queued"
  return "in-progress"
}
