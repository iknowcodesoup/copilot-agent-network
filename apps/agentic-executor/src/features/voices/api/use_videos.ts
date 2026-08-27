"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClipDecision,
  ClipSummary,
  SpeakerBoard,
  VideoResult,
  VideoSummary,
} from "../types";
import { jsonBody, request } from "./voice_client";
import { voiceQueryKeys } from "./query_keys";
import { voiceFactoryBase } from "./endpoints";

/* Every ingested video the factory holds.

   No STREAM_KEEPS_THIS_FRESH here on purpose: the event stream carries runs,
   never videos, so staleTime: Infinity would freeze this list until a reload.
   The factory is the only source - a failure surfaces as an error rather than
   falling back to anything stored here. */
export function useVideos() {
  return useQuery({
    queryKey: voiceQueryKeys.videos,
    /* The factory answers {videos: [...]}. The removed Python route used to
       unwrap it; the proxy forwards it verbatim, so unwrap it here. */
    queryFn: async () =>
      (
        await request<{ videos: VideoSummary[] }>(
          "/videos",
          undefined,
          voiceFactoryBase,
        )
      ).videos,
  });
}

/* Clips grouped by speaker, keyed on the video. A video with no run has a
   board too, which is what lets a second character review one. */
export function useSpeakerBoard(videoId: string, enabled: boolean) {
  return useQuery({
    queryKey: voiceQueryKeys.speakers(videoId),
    queryFn: () => request<SpeakerBoard>(`/videos/${videoId}/clips`),
    enabled,
  });
}

export function useVideoSearch(query: string) {
  return useQuery({
    queryKey: voiceQueryKeys.search(query),
    queryFn: () =>
      request<{ query: string; videos: VideoResult[] }>(
        `/search?query=${encodeURIComponent(query)}&limit=12`,
        undefined,
        voiceFactoryBase,
      ),
    enabled: query.trim().length > 0,
    // a search costs a real yt-dlp call, so keep results around
    staleTime: 5 * 60_000,
  });
}

/* Keep, exclude, retype or trim clips. These go to pythonapi, not the
   factory: the review record is a Postgres table, so this is the one writer.
   Which voice a clip trains is a separate call - see useAssignClips - so
   culling a group never disturbs the assignment that put it there. */
export function useUpdateClips(videoId: string) {
  const queryClient = useQueryClient();
  const speakersKey = voiceQueryKeys.speakers(videoId);
  return useMutation({
    mutationFn: (decisions: ClipDecision[]) =>
      request<ClipSummary[]>(`/videos/${videoId}/clips`, {
        method: "PATCH",
        body: jsonBody({ decisions }),
      }),
    /* A trim writes its new start/end into the cache before the PATCH
       resolves, not after. ClipTrimBar reads startSec/endSec straight off
       the clip prop to size its loaded window (see its build effect), so a
       reader that only learned the trim on onSuccess would see the old
       bounds for the length of the round trip - long enough for a scroll or
       another drag to catch the stale pair and rebuild the window around it,
       which is what made a saved edit appear to revert. Scoped to
       startSec/endSec, the one pair a trim decision sets together: a keep or
       speakerLabel decision carries no such read-your-own-write requirement
       and its onSuccess write below is the only one it needs. */
    onMutate: async (decisions) => {
      await queryClient.cancelQueries({ queryKey: speakersKey });
      const previousBoard = queryClient.getQueryData<SpeakerBoard>(speakersKey);
      const trims = new Map(
        decisions
          .filter(
            (decision) => decision.startSec != null && decision.endSec != null,
          )
          .map((decision) => [
            decision.clipId,
            { startSec: decision.startSec, endSec: decision.endSec },
          ]),
      );
      if (trims.size > 0) {
        queryClient.setQueryData<SpeakerBoard>(
          speakersKey,
          (board) =>
            board && {
              ...board,
              speakers: board.speakers.map((speaker) => ({
                ...speaker,
                clips: speaker.clips.map((clip) => {
                  const trim = trims.get(clip.clipId);
                  return trim ? Object.assign(clip, trim) : clip;
                }),
              })),
            },
        );
      }
      return { previousBoard };
    },
    /* Undo the optimistic trim - a failed PATCH must not leave the bar
       showing bounds the server never accepted. */
    onError: (_error, _decisions, context) => {
      if (context?.previousBoard) {
        queryClient.setQueryData(speakersKey, context.previousBoard);
      }
    },
    /* The response carries the clips as they now stand, so write them in
       rather than asking for them again. This is the authoritative
       overwrite for every field, trims included. */
    onSuccess: (clips) => {
      const edited = new Map(clips.map((clip) => [clip.clipId, clip]));
      queryClient.setQueryData<SpeakerBoard>(
        speakersKey,
        (board) =>
          board && {
            ...board,
            speakers: board.speakers.map((speaker) => ({
              ...speaker,
              clips: speaker.clips.map(
                (clip) => edited.get(clip.clipId) ?? clip,
              ),
            })),
          },
      );
      /* A voice is made of kept clips, so excluding one changes what every
         card on the Voices view reports. */
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.voiceList });
    },
  });
}

/* Rename a video. The title lives in the factory's meta.json beside the clips,
   so every character that claims the video reads the same name. Nothing is
   stored here - the videos list is refetched instead. */
export function useRenameVideo(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) =>
      request<VideoSummary>(
        `/videos/${videoId}`,
        { method: "PATCH", body: jsonBody({ title }) },
        voiceFactoryBase,
      ),
    /* PATCH answers with the renamed video, so the list takes it as given. */
    onSuccess: (video) =>
      queryClient.setQueryData<VideoSummary[]>(
        voiceQueryKeys.videos,
        (videos) =>
          videos?.map((existing) =>
            existing.videoId === video.videoId ? video : existing,
          ),
      ),
  });
}

/* Delete a video and every run pointing at it, in the one typed pythonapi
   route that can reach both Postgres and the factory. Unlike rename, this
   cannot go straight to voiceFactoryBase - a run row here would otherwise
   dangle once the video it points at is gone. */
export function useDeleteVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (videoId: string) =>
      request<void>(`/videos/${videoId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.videos });
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.runs });
    },
  });
}
