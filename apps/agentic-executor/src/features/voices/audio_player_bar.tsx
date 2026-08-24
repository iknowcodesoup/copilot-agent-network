"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";

export function AudioPlayerBar({
  src,
  peaks,
  durationSec,
  disabled,
  accent = "var(--primary)",
  onPlayAt,
  onStop,
}: {
  src?: string;
  peaks: number[];
  durationSec: number;
  seed?: string;
  disabled?: boolean;
  accent?: string;
  /* Playback started, or moved while playing. `offsetSec` is the position
     inside this clip, so a caller that knows where the clip sits can follow
     along. Reported from the media events, not from the button, because a
     scrub moves the position without touching the button. */
  onPlayAt?: (offsetSec: number) => void;
  /* Playback paused or reached the end. */
  onStop?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  /* The listeners below are bound once per src. Reading the callbacks
     through a ref keeps a parent's fresh closures reachable without
     rebinding four listeners on every render. */
  const followersRef = useRef({ onPlayAt, onStop });
  useEffect(() => {
    followersRef.current = { onPlayAt, onStop };
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () =>
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
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
      setProgress(0);
      followersRef.current.onStop?.();
    };
    /* A scrub while playing must re-aim the follower. A scrub while paused
       must not, or dragging the waveform would start the video. */
    const onSeeked = () => {
      if (!audio.paused) followersRef.current.onPlayAt?.(audio.currentTime);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("seeked", onSeeked);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
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

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    audio.currentTime = ratio * (audio.duration || durationSec);
    setProgress(ratio);
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
      <div
        onClick={seek}
        role="slider"
        aria-label="Audio position"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={!src ? -1 : 0}
        className="group flex h-8 flex-1 cursor-pointer items-center gap-px overflow-hidden"
      >
        {(peaks.length
          ? peaks
          : Array.from(
              { length: 32 },
              (_, index) => 0.25 + ((index * 17) % 60) / 100,
            )
        ).map((peak, index, values) => (
          <span
            key={index}
            className="flex-1 rounded-full transition-colors"
            style={{
              height: `${Math.max(10, peak * 100)}%`,
              backgroundColor:
                index / values.length <= progress
                  ? accent
                  : "var(--muted-foreground)",
              opacity: index / values.length <= progress ? 0.95 : 0.35,
            }}
          />
        ))}
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[0.7rem] tabular-nums text-muted-foreground">
        {formatDuration(durationSec)}
      </span>
    </div>
  );
}
