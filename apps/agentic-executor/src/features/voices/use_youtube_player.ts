"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Minimal typing for the slice of the YouTube IFrame API this hook uses.
 * Not @types/youtube - that types the whole player, and this reads a
 * handful of its members.
 */
interface YoutubePlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  destroy: () => void;
}

/* Mirrors the IFrame API's numeric player states. Only PLAYING and PAUSED
   are read here; the rest pass through unhandled. */
const YT_STATE_PLAYING = 1;
const YT_STATE_PAUSED = 2;

interface YoutubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => YoutubePlayer;
}

declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YoutubeApi> | null = null;

/* One script tag and one onYouTubeIframeAPIReady callback for the whole
   page, no matter how many players mount - the API calls that global once,
   so a second definition would silently drop the first player's callers. */
function loadYoutubeApi(): Promise<YoutubeApi> {
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      if (window.YT?.Player) {
        resolve(window.YT);
        return;
      }
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        if (window.YT) resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

/* How often to poll getCurrentTime while playing, to catch a clip's endSec.
   The IFrame API has no native "stop at this position" or timeupdate event,
   so this is the coarsest interval that still feels responsive. */
const END_WATCH_INTERVAL_MS = 200;

/* Mounts an unmuted YouTube player into containerRef once `mounted` is true.
   Torn down and rebuilt whenever videoId or mounted changes, so React 19
   StrictMode's dev double-invoke just runs this twice and the `cancelled`
   flag stops the first, aborted attempt from building a player nobody
   holds a reference to.

   The video's own audio track is the sound now - there is no separate clip
   WAV to keep in sync, which is the whole point: one media element cannot
   drift from itself. Starting unmuted needs a user gesture, which every
   caller already has (a click on the play button or the facade thumbnail). */
export function useYoutubePlayer(videoId: string | null, mounted: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  /* Read inside the poll interval and the onStateChange handler, both of
     which are set up once per player and would otherwise close over a stale
     endSec from whichever play() call was current when they were bound. */
  const endSecRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mounted || !videoId || !containerRef.current) return;
    let cancelled = false;
    setReady(false);
    setPlaying(false);
    loadYoutubeApi().then((api) => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new api.Player(containerRef.current, {
        videoId,
        playerVars: { playsinline: 1 },
        events: {
          onReady: () => !cancelled && setReady(true),
          onStateChange: (event) => {
            if (cancelled) return;
            if (event.data === YT_STATE_PLAYING) setPlaying(true);
            else if (event.data === YT_STATE_PAUSED) setPlaying(false);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId, mounted]);

  /* Polls for the clip's end while playing, since the IFrame API cannot be
     told to stop at a position on its own. Cleared whenever playback stops
     for any reason, including the pause this same effect triggers. */
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      const endSec = endSecRef.current;
      const player = playerRef.current;
      if (endSec != null && player && player.getCurrentTime() >= endSec) {
        player.pauseVideo();
      }
    }, END_WATCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [playing]);

  const seekTo = (seconds: number) => {
    if (ready) playerRef.current?.seekTo(seconds, true);
  };

  /* endSec is optional: a cue with no clip bounds (or the muted preview's
     old "seek" cue) just plays on. */
  const playVideo = (endSec?: number) => {
    endSecRef.current = endSec ?? null;
    if (ready) playerRef.current?.playVideo();
  };

  const pauseVideo = () => {
    if (ready) playerRef.current?.pauseVideo();
  };

  return { containerRef, ready, playing, seekTo, playVideo, pauseVideo };
}
