"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VoiceDetail, VoicePhase, VoiceSummary } from "../types";
import { jsonBody, request } from "./voice_client";
import { voiceQueryKeys } from "./query_keys";
import { voicesApiBase } from "./endpoints";

/* Search voices by name, for the assign-speaker combobox (Story 3.5). An
   empty query lists every voice, so a fresh combobox shows something rather
   than nothing. enabled defaults to true; the combobox passes false while
   it is closed, so it costs no request until the operator opens it. */
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

/* Every voice, for the Voices view's card grid (Story 3.6). limit=50 is the
   route's max, and an empty query matches everything, same contract
   useVoices already relies on for the assign-speaker combobox.

   Each voice carries its contributions, so a card says what the voice is made
   of without one detail request per card. Contribution video titles are the
   detail route's job - they cost a factory call each. */
export function useVoiceList() {
  return useQuery({
    queryKey: voiceQueryKeys.voiceList,
    queryFn: () =>
      request<VoiceDetail[]>("?query=&limit=50", undefined, voicesApiBase),
  });
}

/* One voice's full detail, including its contribution audit trail - the
   single fetch voice_card.tsx's popover and view-clips modal both read
   from. */
export function useVoiceDetail(voiceId: string) {
  return useQuery({
    queryKey: voiceQueryKeys.voiceDetail(voiceId),
    queryFn: () =>
      request<VoiceDetail>(`/${voiceId}`, undefined, voicesApiBase),
  });
}

/* Start or restart training, whatever the voice's current phase (Story 3.3's
   train_voice: always accepted). The card refetches both this voice's
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
