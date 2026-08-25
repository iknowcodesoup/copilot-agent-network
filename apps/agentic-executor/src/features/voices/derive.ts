import type { ClipSummary, VoiceRun, VoiceRunPhase } from "./types"

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
): "in-progress" | "complete" | "failed" {
  if (phase === "failed") return "failed"
  if (phase === "ingested") return "complete"
  return "in-progress"
}

export type ReviewStatus = "reviewing" | "reviewed"

/** Whether a video still has clips nobody has decided on.

    Review is not a phase a run waits in and it is never stored: a reviewer
    decides clips whenever they like, and a video is reviewed once none are
    left undecided. A clip with keep === null has no decision yet. */
export function reviewStatus(clips: ClipSummary[]): ReviewStatus {
  return clips.some((clip) => clip.keep === null) ? "reviewing" : "reviewed"
}

/** How many clips are still undecided. Zero means review is finished. */
export function undecidedCount(clips: ClipSummary[]): number {
  return clips.filter((clip) => clip.keep === null).length
}

/** The label the review pill shows, in place of a phase. */
export function reviewLabel(clips: ClipSummary[]): string {
  const remaining = undecidedCount(clips)
  return remaining === 0 ? "Reviewed" : `Reviewing (${remaining} left)`
}

/** Map a review status to a StatusPill tone. */
export function toneForReviewStatus(
  status: ReviewStatus,
): "review" | "complete" {
  return status === "reviewed" ? "complete" : "review"
}

const YOUTUBE_URL_PATTERN =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/

/** Pull the 11-character video id out of any YouTube URL shape the factory
    hands back, for the iframe embed. Null for a URL that is not YouTube's -
    the embed has nothing to show, not a broken player. */
export function youtubeVideoId(url: string | null): string | null {
  if (!url) return null
  return url.match(YOUTUBE_URL_PATTERN)?.[1] ?? null
}
