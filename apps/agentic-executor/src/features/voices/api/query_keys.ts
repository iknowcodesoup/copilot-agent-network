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

/* Which slice of the video the audio route should answer with.

   padSec widens the window past the clip's own bounds - the trim bar uses
   it to show the surrounding audio a clipped word onset hides in; row
   playback leaves it off to hear exactly what review.csv would commit.

   startSec/endSec name the bounds the slice is cut at. The route never reads
   them - see clipAudioUrl below for why they are sent anyway. */
export interface ClipAudioWindow {
  padSec?: number;
  startSec?: number | null;
  endSec?: number | null;
}

/* Keyed on the video, so playing a clip never depends on a run lookup.

   The bounds ride in the query string although the route ignores them: it
   re-slices full.wav from review.csv on every call, so a trim changes the
   bytes this URL answers with while the URL itself stays the same. An
   <audio> element that already loaded the old slice then sees no attribute
   change and keeps it, and the browser cache can hand it back again. Naming
   the bounds makes every trim a new resource, which is what lets playback
   follow the edit with no reload and no save button. The trim bar sends no
   bounds on purpose - a stable URL is what stops its own save from tearing
   down the waveform under the pointer. */
export function clipAudioUrl(
  videoId: string,
  clipId: string,
  { padSec, startSec, endSec }: ClipAudioWindow = {},
): string {
  const query = new URLSearchParams();
  if (padSec) query.set("pad_sec", String(padSec));
  if (startSec != null && endSec != null)
    query.set("bounds", `${startSec.toFixed(3)}-${endSec.toFixed(3)}`);
  const search = query.toString();
  const base = `${voiceFactoryBase}/videos/${videoId}/clips/${clipId}/audio`;
  return search ? `${base}?${search}` : base;
}
