import type { VoiceRun } from "@/lib/types"

/** A run's display title.

    The video's real name belongs to the video, which the factory owns, so a
    run names itself by the character it is training. Where the video's title
    matters, read it from the videos list and join on videoId. */
export function runTitle(run: VoiceRun): string {
  return run.primaryCharacter || run.sourceUrl
}
