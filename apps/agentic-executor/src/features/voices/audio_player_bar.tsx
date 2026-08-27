"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Where to move this clip's WAV to, as an offset from the clip's own start.
 * The row's audio URL sends no pad, so the WAV begins at startSec and t=0
 * is that same instant.
 *
 * `token` is why this is an object and not a bare number, for the reason
 * VideoCue carries one: clicking the same spot twice must seek twice, and a
 * value-equal prop would leave the effect below dormant the second time.
 */
export interface ClipSeekCue {
  offsetSec: number;
  token: number;
}

export function AudioPlayerBar({
  src,
  seekCue,
  onPlayAt,
  onStop,
}: {
  src?: string;
  /* A position pushed in from outside - the trim bar's click, carried down
     by the review pane. The bar has no scrubber of its own, so this is the
     only way its position moves without a play/pause. */
  seekCue?: ClipSeekCue | null;
  onPlayAt?: (offsetSec: number) => void;
  onStop?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  /* A seek this component performed itself must not echo back out through
     onPlayAt: the row turns that signal into a video cue, so an unguarded
     echo would aim the video back at the position it just moved away from,
     and the two players would trade seeks. */
  const programmaticSeekRef = useRef(false);
  /* preload="none" means a click before the first play has no media to seek
     yet - a currentTime write there is dropped. The position waits here and
     lands once metadata arrives. */
  const pendingSeekRef = useRef<number | null>(null);
  /* The listeners below are bound once per src. Reading the callbacks
     through a ref keeps a parent's fresh closures reachable without
     rebinding four listeners on every render. */
  const followersRef = useRef({ onPlayAt, onStop });
  useEffect(() => {
    followersRef.current = { onPlayAt, onStop };
  });

  useEffect(() => {
    /* A new src is a different recording - a trim, most often - so the bar
       must not open part-played at the old one's position, and a position
       aimed at the old slice must not land on this one. */
    setPlaying(false);
    pendingSeekRef.current = null;
    const audio = audioRef.current;
    if (!audio) return;
    const onLoadedMetadata = () => {
      if (pendingSeekRef.current == null) return;
      programmaticSeekRef.current = true;
      audio.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
    };
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
       must not, or dragging the waveform would start the video. A seek this
       component performed itself re-aims nothing at all - see the ref. */
    const onSeeked = () => {
      if (programmaticSeekRef.current) {
        programmaticSeekRef.current = false;
        return;
      }
      if (!audio.paused) followersRef.current.onPlayAt?.(audio.currentTime);
    };
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("seeked", onSeeked);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("seeked", onSeeked);
    };
  }, [src]);

  /* Applies a pushed-in position. Setting currentTime while playing keeps it
     playing from there; setting it while paused just parks it, so the next
     Play starts where the operator last clicked rather than back at the
     clip's start. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !seekCue) return;
    /* HAVE_NOTHING - metadata has not arrived, so a currentTime write here
       would be dropped. */
    if (audio.readyState === 0) {
      pendingSeekRef.current = seekCue.offsetSec;
      return;
    }
    programmaticSeekRef.current = true;
    audio.currentTime = seekCue.offsetSec;
    // Only the token marks a new instruction - offsetSec repeats freely, and
    // depending on it would re-seek on every render that rebuilt the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekCue?.token]);

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
