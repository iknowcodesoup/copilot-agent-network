"use client";

import { useMemo } from "react";
import { useVideos } from "./api/use_videos";
import { useVoiceRuns } from "./api/use_voice_runs";
import { useStudio } from "@/features/chat/studio_provider";
import { VideoListPanel } from "./video_list_panel";
import { ClipReviewPane } from "./clip_review_pane";

/*
 * Two lists, one join key.
 *
 * The videos come from the voice factory, which owns them, and the runs come
 * from Postgres, which owns the pipeline state. They are joined on videoId,
 * never by position: a run whose video the factory no longer lists is
 * orphaned, and VideoListPanel says so rather than quietly pairing it with
 * whichever video happens to sit at the same index.
 */
export function VideosView() {
  const videos = useVideos();
  const runs = useVoiceRuns();
  const { selectedVideoId, setSelectedVideoId } = useStudio();
  const videoList = useMemo(() => videos.data ?? [], [videos.data]);
  const runList = useMemo(() => runs.data ?? [], [runs.data]);

  if (videos.isLoading)
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Loading ingested videos…
      </div>
    );
  /* No fallback to the run list here on purpose. A stale copy of the videos is
     exactly what hid the outage this view is meant to make visible. */
  if (videos.isError)
    return (
      <div className="rounded-xl border border-destructive/30 p-10 text-center text-sm text-destructive">
        Unable to reach the voice factory, so no videos can be listed. Start it
        with <span className="font-mono">just serve-jeanlucrecord</span>.
      </div>
    );

  const selectedVideo =
    videoList.find((video) => video.videoId === selectedVideoId) ??
    videoList[0] ??
    null;
  const selectedRun = selectedVideo
    ? (runList.find((run) => run.videoId === selectedVideo.videoId) ?? null)
    : null;

  return (
    <div className="flex h-full min-h-0">
      <VideoListPanel
        videos={videoList}
        runs={runList}
        selectedVideoId={selectedVideo?.videoId ?? null}
        onSelectVideo={setSelectedVideoId}
      />
      {selectedVideo ? (
        <ClipReviewPane key={selectedVideo.videoId} video={selectedVideo} run={selectedRun} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
          No videos yet. Paste a YouTube URL above to start processing.
        </div>
      )}
    </div>
  );
}
