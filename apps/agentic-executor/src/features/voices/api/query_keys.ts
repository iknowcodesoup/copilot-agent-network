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

/* Keyed on the video, so playing a clip never depends on a run lookup. */
export function clipAudioUrl(videoId: string, clipId: string): string {
  return `${voiceFactoryBase}/videos/${videoId}/clips/${clipId}/audio`;
}
