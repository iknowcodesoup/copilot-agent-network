"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  VoiceAssignResponse,
  VoiceDetail,
  VoicePhase,
  VoiceSummary,
} from "../types";
import { jsonBody, request } from "./voice_client";
import { voiceQueryKeys } from "./query_keys";
import { voicesApiBase } from "./endpoints";

/* Search voices by name, for the voice picker. An empty query lists every
   voice, so a fresh picker shows something rather than nothing. enabled
   defaults to true; the picker passes false while it is closed, so it costs
   no request until the operator opens it. */
export function useVoices(query: string, enabled = true) {
  return useQuery({
    queryKey: voiceQueryKeys.voices(query),
    queryFn: () =>
      request<VoiceSummary[]>(
        `?query=${encodeURIComponent(query)}&limit=20`,
        undefined,
        voicesApiBase,
      ),
    enabled,
    staleTime: 10_000,
  });
}

/* Create a voice by name, for the combobox's inline-create path. Names are
   unique (FR22), so the caller handles a 409 by treating it as a match
   rather than an error. */
export function useCreateVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      request<{ id: string; phase: VoicePhase }>(
        "",
        { method: "POST", body: jsonBody({ name }) },
        voicesApiBase,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice", "voices"] });
      // voiceList (Story 3.6's Voices dashboard) is a separate cache key
      // with no shared prefix - without this, a voice created here stays
      // invisible on that view until something else refetches it.
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.voiceList });
    },
  });
}

/* Rename a voice. A clip joins a voice by id, so the rename touches only this
   row - every clip that shows the name reads it back resolved on the next
   fetch. Names are unique (FR22), so the caller handles a 409 as a name
   another voice already holds. */
export function useRenameVoice(voiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      request<VoiceDetail>(
        `/${voiceId}`,
        { method: "PATCH", body: jsonBody({ name }) },
        voicesApiBase,
      ),
    /* PATCH answers with the renamed voice, so the caches that hold it take it
       as given. The speaker boards resolve each clip's voice name server-side,
       so they are stale after a rename and have to be refetched. */
    onSuccess: (voice) => {
      queryClient.setQueryData<VoiceDetail[]>(
        voiceQueryKeys.voiceList,
        (voices) =>
          voices?.map((existing) =>
            existing.id === voice.id ? voice : existing,
          ),
      );
      queryClient.setQueryData(voiceQueryKeys.voiceDetail(voice.id), voice);
      queryClient.invalidateQueries({ queryKey: ["voice", "voices"] });
      queryClient.invalidateQueries({ queryKey: ["voice", "videos"] });
    },
  });
}

/* Every voice, for the Voices view's card grid. limit=50 is the route's max,
   and an empty query matches everything, the same contract useVoices relies
   on for the picker.

   Each voice carries its clips, so a card says what the voice is made of
   without one detail request per card. */
export function useVoiceList() {
  return useQuery({
    queryKey: voiceQueryKeys.voiceList,
    queryFn: () =>
      request<VoiceDetail[]>("?query=&limit=50", undefined, voicesApiBase),
  });
}

/* One voice's full detail: every clip assigned to it, from every video. */
export function useVoiceDetail(voiceId: string) {
  return useQuery({
    queryKey: voiceQueryKeys.voiceDetail(voiceId),
    queryFn: () =>
      request<VoiceDetail>(`/${voiceId}`, undefined, voicesApiBase),
  });
}

/* Start or restart training, whatever the voice's current phase (always
   accepted). The card refetches both this voice's
   detail and the list afterward so the phase shows without a page
   reload. */
export function useTrainVoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (voiceId: string) =>
      request<{ id: string; phase: VoicePhase }>(
        `/${voiceId}/train`,
        { method: "POST" },
        voicesApiBase,
      ),
    /* The voice comes in as the mutation's variable rather than a hook
       argument, so the assistant can train a voice it only resolves once the
       operator names it. */
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({
        queryKey: voiceQueryKeys.voiceDetail(id),
      });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.voiceList });
    },
  });
}

/* Assign clips of one video to a voice. The one write that joins a clip to a
   voice, whether the operator picked a whole speaker or corrected a single
   row - the caller decides which clip ids to send, and nothing else differs.

   The clips themselves are untouched: their keep decision, text and bounds
   are useUpdateClips's, so culling a group afterwards cannot undo the
   assignment that put it there.

   The voice is a mutation variable, not a hook argument, because a caller
   rarely knows it at render time - the picker resolves it when the operator
   chooses, and the assistant when it resolves a name. */
export function useAssignClips() {
  return useClipAssignment((voiceId) => `/${voiceId}/clips`);
}

/* Take clips off a voice. The clips stay exactly as they are - only the
   assignment goes - so a clip removed from one voice is ready for another. */
export function useUnassignClips() {
  return useClipAssignment((voiceId) => `/${voiceId}/clips/unassign`);
}

interface ClipAssignment {
  voiceId: string;
  videoId: string;
  clipIds: string[];
}

/* Assign and unassign differ by their path and nothing else - same body, same
   response, same caches to drop. */
function useClipAssignment(pathFor: (voiceId: string) => string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ voiceId, videoId, clipIds }: ClipAssignment) =>
      request<VoiceAssignResponse>(
        pathFor(voiceId),
        { method: "POST", body: jsonBody({ videoId, clipIds }) },
        voicesApiBase,
      ),
    onSuccess: (_result, { voiceId, videoId }) => {
      /* The board shows each clip's assigned voice, so it has to be re-read
         after an assignment - the response describes the voice, not the
         video. */
      queryClient.invalidateQueries({
        queryKey: voiceQueryKeys.speakers(videoId),
      });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.voiceList });
      queryClient.invalidateQueries({
        queryKey: voiceQueryKeys.voiceDetail(voiceId),
      });
    },
  });
}
