"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { useYoutubePlayer } from "./use_youtube_player";
import { youtubeVideoId } from "./derive";
import type { VideoSummary } from "./types";

/*
 * Thumbnail facade until the operator presses play. Mounting the real
 * YouTube iframe up front would tear it down and rebuild it on every video
 * switch (the review pane keys on videoId), and a static thumbnail costs
 * nothing to swap between videos.
 */
export function YoutubeEmbedPlayer({
  video,
  seekToSec,
}: {
  video: VideoSummary;
  /* re-target the muted preview when the operator selects a different clip;
     a no-op until the player has actually been started */
  seekToSec: number | null;
}) {
  const [playing, setPlaying] = useState(false);
  const videoId = youtubeVideoId(video.url);
  const { containerRef, ready, seekTo } = useYoutubePlayer(videoId, playing);

  useEffect(() => {
    if (ready && seekToSec != null) seekTo(seekToSec);
    // seekTo is recreated every render but always reads the latest player
    // ref, so only ready/seekToSec need to trigger this - including seekTo
    // itself would re-seek on every render.
  }, [ready, seekToSec]);

  if (!videoId) return null;

  return (
    <div className="relative aspect-video max-h-64 w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
      {playing ? (
        <div ref={containerRef} className="size-full" />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group relative size-full"
          aria-label={`Play preview of ${video.title}`}
        >
          {video.thumbnailUrl && (
            <img
              src={video.thumbnailUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-background/30 transition-colors group-hover:bg-background/10">
            <span className="flex size-12 items-center justify-center rounded-full bg-background/80 text-foreground backdrop-blur">
              <Play className="size-5 translate-x-0.5" />
            </span>
          </div>
        </button>
      )}
    </div>
  );
}
