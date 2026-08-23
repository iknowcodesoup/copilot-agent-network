"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type {
  JobLog,
  RunAssignResponse,
  TrainingProgress,
  VoiceRun,
  VoiceRunPhase,
} from "../types";
import { jsonBody, request, VoiceApiError } from "./voice_client";
import { voiceQueryKeys } from "./query_keys";

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
  options?: Partial<UseQueryOptions<VoiceRun, VoiceApiError>>,
) {
  return useQuery<VoiceRun, VoiceApiError>({
    queryKey: voiceQueryKeys.run(runId),
    queryFn: () => request<VoiceRun>(`/runs/${runId}`),
    ...STREAM_KEEPS_THIS_FRESH,
    ...options,
  });
}

export function useTrainingProgress(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: voiceQueryKeys.training(runId),
    queryFn: () => request<TrainingProgress>(`/runs/${runId}/training`),
    enabled,
  });
}

export function useJobLog(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: voiceQueryKeys.log(runId),
    queryFn: () => request<JobLog>(`/runs/${runId}/logs`),
    enabled,
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

/* Map a run's speaker labels to Voices. Only assignment: it writes the
   voice_contributions rows and nothing else. It does not commit the run or
   start training - see useCommitRun and useTrainVoice for those, called
   separately so relabeling a clip's speaker never has a side effect beyond
   recording it. */
export function useAssignRun(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignments: Record<string, string | null>) =>
      request<RunAssignResponse>(`/runs/${runId}/assign`, {
        method: "POST",
        body: JSON.stringify({ assignments }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.run(runId) });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.runs });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.voiceList });
    },
  });
}

/* End review once every speaker the operator cares about is assigned.
   Separate from useAssignRun on purpose (Story 3.2's flattened assign+commit
   is now unflattened): assigning a speaker must not finish the run by
   itself. This is the one call that does, and it does only that - no voice
   phase change, no training. */
export function useCommitRun(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<VoiceRun>(`/runs/${runId}/commit`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.run(runId) });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.runs });
    },
  });
}
