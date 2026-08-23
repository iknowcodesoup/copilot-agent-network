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

/* Write review decisions straight through to the factory's review.csv, which
   stays the one source of truth for them. Nothing is counted back into a run:
   the counts are the factory's, so the videos list is refreshed instead. */
export function useUpdateClips(videoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decisions: ClipDecision[]) =>
      request<{ videoId: string; updated: number; clips: ClipSummary[] }>(
        `/videos/${videoId}/clips`,
        { method: "PATCH", body: jsonBody({ decisions }) },
        voiceFactoryBase,
      ),
    /* The response carries the clips as they now stand, so write them in
       rather than asking for them again. */
    onSuccess: ({ clips }) => {
      const edited = new Map(clips.map((clip) => [clip.clipId, clip]));
      queryClient.setQueryData<SpeakerBoard>(
        voiceQueryKeys.speakers(videoId),
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
      /* Keeping or excluding a clip moves the factory's own counts, and only
         it can recompute them. */
      queryClient.invalidateQueries({ queryKey: voiceQueryKeys.videos });
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
