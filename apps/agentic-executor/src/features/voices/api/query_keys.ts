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
   it to show the surrounding audio a clipped word onset hides in; row and
   voice-tab playback leave it off to hear exactly what training would use.

   startSec/endSec name the bounds the slice is cut at. The route reads them:
   given, they win; omitted, the factory falls back to review.csv, which
   holds the original ingest cut and never the reviewer's trim. A caller
   that knows the clip's current bounds must send them - see clipAudioUrl. */
export interface ClipAudioWindow {
  padSec?: number;
  startSec?: number | null;
  endSec?: number | null;
}

/* Keyed on the video, so playing a clip never depends on a run lookup.

   Always pass the clip's current bounds. The factory route slices full.wav
   at them; omit them and it falls back to review.csv's ingest bounds, which
   a trim never updates - the trim is written to Postgres, not back to the
   csv. Sending the bounds also lets playback follow an edit with no reload:
   a new bounds string is a new URL, so an <audio> element that already
   loaded the old slice refetches rather than replaying it from cache.

   The trim bar captures its bounds once per clip and rebuilds the waveform
   only on clip identity or an explicit widen, never on its own save - that,
   not a stable URL, is what stops a trim from tearing the waveform down
   under the pointer. */
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
