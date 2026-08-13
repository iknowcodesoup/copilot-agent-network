"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

const pythonApiUrl =
  process.env.NEXT_PUBLIC_PYTHON_API_URL ?? "http://localhost:8000";

export const voiceApiBase = `${pythonApiUrl}/api/voice`;

/*
 * Phases the pipeline moves a run through. Mirrors VoiceRunPhase in
 * apps/pythonapi/pythonapi/models/voice.py - a union, not a TS enum.
 */
export const voiceRunPhases = [
  "downloading",
  "diarizing",
  "awaiting_review",
  "committing",
  "training",
  "exporting",
  "ready",
  "failed",
] as const;

export type VoiceRunPhase = (typeof voiceRunPhases)[number];

/* Phases where the pipeline is doing something on its own. */
const activePhases: ReadonlySet<VoiceRunPhase> = new Set([
  "downloading",
  "diarizing",
  "committing",
  "training",
  "exporting",
]);

export function isActive(phase: VoiceRunPhase): boolean {
  return activePhases.has(phase);
}

export const phaseLabels: Record<VoiceRunPhase, string> = {
  downloading: "Downloading",
  diarizing: "Splitting by speaker",
  awaiting_review: "Waiting for review",
  committing: "Preparing dataset",
  training: "Training",
  exporting: "Exporting model",
  ready: "Ready",
  failed: "Failed",
};

export interface VideoResult {
  videoId: string;
  title: string;
  durationSec: number | null;
  channel: string | null;
  thumbnailUrl: string | null;
  url: string;
}

export interface VoiceRun {
  id: string;
  primaryCharacter: string;
  sourceUrl: string;
  videoId: string | null;
  videoTitle: string | null;
  phase: VoiceRunPhase;
  diarize: boolean;
  numSpeakers: number | null;
  speakerMap: Record<string, string | null>;
  voyicerJobId: string | null;
  /* which of DOWNLOADING's ordered ingest steps is in flight */
  ingestStageIndex: number;
  commitStageIndex: number;
  clipCount: number;
  approvedCount: number;
  checkpointPath: string | null;
  /* last training progress the factory reported, pushed over the event stream */
  currentEpoch: number | null;
  currentLoss: number | null;
  error: string | null;
  /* consecutive transient factory errors. Above zero means the run is waiting
     on a factory that is not answering, not that it has failed. */
  errorCount: number;
  failedFromPhase: VoiceRunPhase | null;
  /* the job that failed, kept so its log stays readable after voyicerJobId
     clears */
  failedJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

/*
 * DOWNLOADING's ordered ingest steps, mirroring INGEST_STAGES in
 * voice_pipeline_graph.py. Used only to label where a retry resumes - the
 * server is what actually walks them.
 */
export const ingestStageLabels = [
  "downloading the audio",
  "transcribing",
  "cutting clips",
  "splitting by speaker",
  "scoring clips for review",
] as const;

/*
 * COMMITTING's ordered stages, mirroring the ordered_stages tuple in
 * _committing_node_factory.
 */
export const commitStageLabels = [
  "merging approved clips",
  "resampling",
  "preprocessing",
] as const;

/* Where a retry on this run would resume. Falls back to the phase's own label
   when the phase has no sub-steps to name. */
export function resumeStepLabel(run: VoiceRun): string {
  const resumePhase = run.failedFromPhase ?? "downloading";
  if (resumePhase === "downloading") {
    return ingestStageLabels[run.ingestStageIndex] ?? phaseLabels.downloading;
  }
  if (resumePhase === "committing") {
    return commitStageLabels[run.commitStageIndex] ?? phaseLabels.committing;
  }
  return phaseLabels[resumePhase];
}

export interface ClipSummary {
  clipId: string;
  keep: boolean;
  qualityScore: number | null;
  flagged: boolean;
  speakerLabel: string | null;
  speakerCoverage: number | null;
  durationSec: number | null;
  startSec: number | null;
  endSec: number | null;
  text: string;
}

export interface SpeakerGroup {
  speakerLabel: string | null;
  assignedCharacter: string | null;
  clipCount: number;
  keptCount: number;
  totalDurationSec: number;
  clips: ClipSummary[];
}

export interface SpeakerBoard {
  runId: string;
  videoId: string;
  speakers: SpeakerGroup[];
}

export interface CheckpointSummary {
  path: string;
  name: string;
  epoch: number | null;
  step: number | null;
  modifiedAt: string | null;
}

export interface TrainingProgress {
  character: string;
  preprocessed: boolean;
  runningJobId: string | null;
  currentEpoch: number | null;
  currentLoss: number | null;
  checkpoints: CheckpointSummary[];
}

export interface JobLog {
  offset: number;
  content: string;
  state: string;
}

export interface ClipDecision {
  clipId: string;
  keep?: boolean;
  speakerLabel?: string | null;
}

/*
 * FastAPI speaks snake_case and this app speaks camelCase. Converting at the
 * boundary keeps every component in one convention, so no component has to
 * remember which side of the wire a field came from.
 */
function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function convertKeys(value: unknown, convert: (key: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertKeys(item, convert));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        convert(key),
        convertKeys(entry, convert),
      ])
    );
  }
  return value;
}

export class VoiceApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "VoiceApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${voiceApiBase}${path}`, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init?.headers }
      : init?.headers,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? detail;
    } catch {
      // a non-JSON error body is still worth reporting by status alone
    }
    throw new VoiceApiError(detail, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return convertKeys(await response.json(), toCamelCase) as T;
}

function jsonBody(payload: unknown): string {
  return JSON.stringify(convertKeys(payload, toSnakeCase));
}

/*
 * speaker_map keys are speaker labels like SPEAKER_00, not field names. Running
 * them through the case converter would rewrite them, so they stay untouched.
 */
function speakerMapBody(speakerMap: Record<string, string | null>): string {
  return JSON.stringify({ speaker_map: speakerMap });
}

export const voiceQueryKeys = {
  runs: ["voice", "runs"] as const,
  run: (runId: string) => ["voice", "runs", runId] as const,
  speakers: (runId: string) => ["voice", "runs", runId, "speakers"] as const,
  training: (runId: string) => ["voice", "runs", runId, "training"] as const,
  log: (runId: string) => ["voice", "runs", runId, "log"] as const,
  search: (query: string) => ["voice", "search", query] as const,
  characters: ["voice", "characters"] as const,
};

export function clipAudioUrl(runId: string, clipId: string): string {
  return `${voiceApiBase}/runs/${runId}/clips/${clipId}/audio`;
}

/*
 * None of the run hooks below poll. The server pushes every state change over
 * the voice event stream, which writes straight into this cache - see
 * voice_event_stream.tsx. The initial fetch here is what fills the cache before
 * the stream connects, and the fallback if it never does.
 */
/*
 * The stream owns these two entries once it is connected, so they never go
 * stale on their own. Without that, the default staleTime of 0 refetches on
 * every remount and every window focus, and each of those reads can land after
 * a newer pushed event and put older state back on the screen. A mutation's
 * invalidateQueries still forces a refetch, which is the one time a read here
 * knows something the stream has not sent yet.
 */
const STREAM_KEEPS_THIS_FRESH = {
  staleTime: Infinity,
  refetchOnWindowFocus: false,
} as const;

export function useVoiceRuns() {
  return useQuery({
    queryKey: voiceQueryKeys.runs,
    queryFn: () => request<VoiceRun[]>("/runs"),
    ...STREAM_KEEPS_THIS_FRESH,
  });
}

export function useVoiceRun(
  runId: string,
  options?: Partial<UseQueryOptions<VoiceRun, VoiceApiError>>
) {
  return useQuery<VoiceRun, VoiceApiError>({
    queryKey: voiceQueryKeys.run(runId),
    queryFn: () => request<VoiceRun>(`/runs/${runId}`),
    ...STREAM_KEEPS_THIS_FRESH,
    ...options,
  });
}

export function useSpeakerBoard(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: voiceQueryKeys.speakers(runId),
    queryFn: () => request<SpeakerBoard>(`/runs/${runId}/speakers`),
    enabled,
  });
}

export function useTrainingProgress(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: voiceQueryKeys.training(runId),
    queryFn: () => request<TrainingProgress>(`/runs/${runId}/training`),
    enabled,
  });
}

/*
 * Detailed job output, kept off the event stream on purpose. The stream carries
 * run state, which is small and changes rarely; a training log is neither, and
 * pushing it would make every browser pay for output only one screen reads.
 */
export function useJobLog(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: voiceQueryKeys.log(runId),
    queryFn: () => request<JobLog>(`/runs/${runId}/logs`),
    enabled,
  });
}

export function useVideoSearch(query: string) {
  return useQuery({
    queryKey: voiceQueryKeys.search(query),
    queryFn: () =>
      request<{ query: string; videos: VideoResult[] }>(
        `/search?query=${encodeURIComponent(query)}&limit=12`
      ),
    enabled: query.trim().length > 0,
    // a search costs a real yt-dlp call, so keep results around
    staleTime: 5 * 60_000,
  });
}

export function useCharacters() {
  return useQuery({
    queryKey: voiceQueryKeys.characters,
    queryFn: () => request<string[]>("/characters"),
    staleTime: 60_000,
  });
}

export function useStartRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      primaryCharacter: string;
      sourceUrl: string;
      diarize: boolean;
      numSpeakers?: number | null;
    }) =>
      request<{ id: string; phase: VoiceRunPhase }>("/runs", {
        method: "POST",
        body: jsonBody(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.runs });
    },
  });
}

export function useUpdateClips(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decisions: ClipDecision[]) =>
      request<{ updated: number; approvedCount: number }>(
        `/runs/${runId}/clips`,
        { method: "PATCH", body: jsonBody({ decisions }) }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.speakers(runId) });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.run(runId) });
    },
  });
}

export function useApproveRun(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (speakerMap: Record<string, string | null>) =>
      request<VoiceRun>(`/runs/${runId}/approve`, {
        method: "POST",
        body: speakerMapBody(speakerMap),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.run(runId) });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.runs });
    },
  });
}

export function useDeleteRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      request<void>(`/runs/${runId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.runs });
    },
  });
}

/* Put a failed run back in the phase it fell over in. */
export function useRetryRun(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<VoiceRun>(`/runs/${runId}/retry`, { method: "POST" }),
    onSuccess: (run) => {
      queryClient.setQueryData(voiceQueryKeys.run(runId), run);
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.runs });
    },
  });
}
