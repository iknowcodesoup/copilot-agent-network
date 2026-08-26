"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useYoutubePlayer } from "./use_youtube_player";
import { youtubeVideoId } from "./derive";
import type { VideoSummary } from "./types";

/*
 * One instruction for the player, sent by whoever drives it.
 *
 * `token` is why this is an object and not a bare number of seconds. Two
 * plays of one clip carry the same startSec, and a value-equal prop leaves
 * the effect below dormant while the video rolls on past the clip. A fresh
 * token makes the repeat fire.
 */
export interface VideoCue {
  action: "seek" | "play" | "pause";
  /* absolute position in the video, in seconds. "pause" ignores it. */
  startSec: number;
  /* Where a "play" cue should stop itself. The video's own audio is now the
     sound, so nothing else marks the end of a clip the way a trimmed WAV's
     own duration used to. Omitted for a bare seek or an untimed play. */
  endSec?: number;
  /* Where a "play" cue should snap back to once it hits endSec - the
     selection's own start, regardless of where this particular play began.
     Ignored without an endSec. */
  resetSec?: number;
  token: number;
}

/*
 * Thumbnail facade until something starts the player. Mounting the real
 * YouTube iframe up front would tear it down and rebuild it on every video
 * switch (the review pane keys on videoId), and a static thumbnail costs
 * nothing to swap between videos.
 */
export function YoutubeEmbedPlayer({
  video,
  cue,
  onPlaying,
  onPause,
  onTimeUpdate,
}: {
  video: VideoSummary;
  cue: VideoCue | null;
  /* Mirrors the player's own state back to whoever is showing a play/pause
     button for it - there is no other way to know playback stopped, since
     the end-of-clip pause happens inside the player hook, not at the caller. */
  onPlaying?: () => void;
  onPause?: () => void;
  /* The video's live position while playing, so a caller can move a
     playhead of its own (the trim bar's cursor) in step with it. */
  onTimeUpdate?: (seconds: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const videoId = youtubeVideoId(video.url);
  const { containerRef, ready, playing, seekTo, playVideo, pauseVideo } =
    useYoutubePlayer(videoId, mounted, onTimeUpdate);

  /* A play cue mounts the player itself. Waiting for the facade click first
     is what made the very first clip play move nothing at all: no player
     existed, so the seek had nowhere to land. */
  useEffect(() => {
    if (cue?.action === "play") setMounted(true);
  }, [cue]);

  useEffect(() => {
    if (!ready || !cue) return;
    if (cue.action === "pause") {
      pauseVideo();
      return;
    }
    seekTo(cue.startSec);
    if (cue.action === "play") playVideo(cue.endSec, cue.resetSec);
    // The three player calls are recreated every render but always read the
    // latest player ref, so only ready and the cue trigger this - including
    // them would re-seek on every render. `ready` stays a dependency so a
    // cue that arrives before the player exists replays once it does.
  }, [ready, cue]);

  const followersRef = useRef({ onPlaying, onPause });
  useEffect(() => {
    followersRef.current = { onPlaying, onPause };
  });
  useEffect(() => {
    if (playing) followersRef.current.onPlaying?.();
    else followersRef.current.onPause?.();
  }, [playing]);

  if (!videoId) return null;

  return (
    <div className="relative aspect-video max-h-64 w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
      {mounted ? (
        <div ref={containerRef} className="size-full" />
      ) : (
        <button
          type="button"
          onClick={() => setMounted(true)}
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
