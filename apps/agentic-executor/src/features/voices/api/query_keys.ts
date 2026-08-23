import { voiceFactoryBase } from "./endpoints";

export const voiceQueryKeys = {
  runs: ["voice", "runs"] as const,
  run: (runId: string) => ["voice", "runs", runId] as const,
  /* Deliberately outside ["voice","runs"]: the videos list is the factory's
     answer, not a run's, and useStartRun invalidates the whole run subtree. */
  videos: ["voice", "videos"] as const,
  speakers: (videoId: string) =>
    ["voice", "videos", videoId, "clips"] as const,
  training: (runId: string) => ["voice", "runs", runId, "training"] as const,
  log: (runId: string) => ["voice", "runs", runId, "log"] as const,
  search: (query: string) => ["voice", "search", query] as const,
  characters: ["voice", "characters"] as const,
  voices: (query: string) => ["voice", "voices", query] as const,
  voiceList: ["voice", "voiceList"] as const,
  voiceDetail: (voiceId: string) => ["voice", "voiceDetail", voiceId] as const,
};

/* Keyed on the video, so playing a clip never depends on a run lookup.
   padSec widens the window past the clip's own bounds - the trim bar uses
   it to show the surrounding audio a clipped word onset hides in; row
   playback leaves it off to hear exactly what review.csv would commit. */
export function clipAudioUrl(
  videoId: string,
  clipId: string,
  padSec?: number,
): string {
  const base = `${voiceFactoryBase}/videos/${videoId}/clips/${clipId}/audio`;
  return padSec ? `${base}?pad_sec=${padSec}` : base;
}
