"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Minimal typing for the slice of the YouTube IFrame API this hook uses.
 * Not @types/youtube - that types the whole player, and this reads four
 * members of it.
 */
interface YoutubePlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
}

interface YoutubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, number>;
      events?: { onReady?: () => void };
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

/* Mounts a muted YouTube player into containerRef once `mounted` is true.
   Torn down and rebuilt whenever videoId or mounted changes, so React 19
   StrictMode's dev double-invoke just runs this twice and the `cancelled`
   flag stops the first, aborted attempt from building a player nobody
   holds a reference to. */
export function useYoutubePlayer(videoId: string | null, mounted: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mounted || !videoId || !containerRef.current) return;
    let cancelled = false;
    setReady(false);
    loadYoutubeApi().then((api) => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new api.Player(containerRef.current, {
        videoId,
        playerVars: { mute: 1, playsinline: 1 },
        events: { onReady: () => !cancelled && setReady(true) },
      });
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId, mounted]);

  const seekTo = (seconds: number) => {
    if (ready) playerRef.current?.seekTo(seconds, true);
  };

  /* The player stays muted (see playerVars above), so the browser lets this
     start playback without a gesture on the iframe itself. The clip WAV is
     the sound; the video is the picture. */
  const playVideo = () => {
    if (ready) playerRef.current?.playVideo();
  };

  const pauseVideo = () => {
    if (ready) playerRef.current?.pauseVideo();
  };

  return { containerRef, ready, seekTo, playVideo, pauseVideo };
}
