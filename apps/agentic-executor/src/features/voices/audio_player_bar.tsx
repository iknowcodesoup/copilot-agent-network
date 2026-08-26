"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export function AudioPlayerBar({
  src,
  onPlayAt,
  onStop,
}: {
  src?: string;
  onPlayAt?: (offsetSec: number) => void;
  onStop?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  /* The listeners below are bound once per src. Reading the callbacks
     through a ref keeps a parent's fresh closures reachable without
     rebinding four listeners on every render. */
  const followersRef = useRef({ onPlayAt, onStop });
  useEffect(() => {
    followersRef.current = { onPlayAt, onStop };
  });

  useEffect(() => {
    /* A new src is a different recording - a trim, most often - so the bar
       must not open part-played at the old one's position. */
    setPlaying(false);
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => {
      setPlaying(true);
      followersRef.current.onPlayAt?.(audio.currentTime);
    };
    const onPause = () => {
      setPlaying(false);
      followersRef.current.onStop?.();
    };
    const onEnd = () => {
      setPlaying(false);
      followersRef.current.onStop?.();
    };
    /* A scrub while playing must re-aim the follower. A scrub while paused
       must not, or dragging the waveform would start the video. */
    const onSeeked = () => {
      if (!audio.paused) followersRef.current.onPlayAt?.(audio.currentTime);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("seeked", onSeeked);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("seeked", onSeeked);
    };
  }, [src]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  return (
    <div className={cn("flex items-center gap-2.5", !src && "opacity-50")}>
      {src && <audio ref={audioRef} src={src} preload="none" />}
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? "Pause clip" : "Play clip"}
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed"
      >
        {playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5 translate-x-px" />
        )}
      </button>
    </div>
  );
}
