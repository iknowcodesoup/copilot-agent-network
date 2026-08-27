"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/plugins/regions";
import { useUpdateClips } from "./api/use_videos";
import { clipAudioUrl } from "./api/query_keys";
import { formatDuration } from "@/lib/format";
import type { ClipSummary } from "./types";

/* Context around the clip's own bounds, so a clipped word onset or trailing
   consonant is visible and draggable back in - not just what review.csv
   already kept. */
const MIN_PAD_SEC = 3;
/* Mirrors MAX_PAD_SEC in the factory host's videos.py - the audio route
   clamps pad_sec at this many seconds server-side, so this bar can never ask
   for more. Generous on purpose: a clip that keeps growing should feel
   unbounded in practice, and reaching this many minutes of context takes
   deliberate, repeated extending, never an accident. */
const MAX_PAD_SEC = 300;
/* How close a released handle has to land to the loaded window's edge
   before the bar widens the view around it. */
const EDGE_THRESHOLD_SEC = 0.75;
/* Each edge hit multiplies the pad by this factor rather than adding a fixed
   amount, so an operator who keeps dragging toward a long clip accelerates
   toward MAX_PAD_SEC instead of crawling there one small step at a time. */
const EDGE_GROWTH_FACTOR = 2.5;
const FIRST_EDGE_PAD_SEC = 15;
const WHEEL_ZOOM_FACTOR = 1.4;
const REGION_COLOR = "color-mix(in oklab, var(--primary) 22%, transparent)";

/* The pad to request after an edge hit, given the one currently loaded -
   a fixed first jump so a small clip does not immediately balloon, then
   compounding growth for an operator who clearly wants to keep going. */
function nextEdgePad(currentPad: number): number {
  const grown =
    currentPad <= MIN_PAD_SEC ? FIRST_EDGE_PAD_SEC : currentPad * EDGE_GROWTH_FACTOR;
  return Math.min(MAX_PAD_SEC, Math.round(grown));
}

interface TrimBounds {
  start: number;
  end: number;
}

/* getComputedStyle, not a literal var() string: the waveform paints on
   canvas, and a canvas fillStyle cannot resolve a CSS custom property the
   way a DOM style attribute can. Regions are DOM overlays, so they use the
   var() form directly (see REGION_COLOR above). */
function resolveCssColor(variableName: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variableName)
    .trim();
  return value || fallback;
}

type Regions = ReturnType<typeof RegionsPlugin.create>;

function replaceTrimRegion(regions: Regions, bounds: TrimBounds, windowStart: number) {
  regions.getRegions().forEach((region) => region.remove());
  regions.addRegion({
    start: bounds.start - windowStart,
    end: bounds.end - windowStart,
    color: REGION_COLOR,
    drag: false,
    resize: true,
  });
}

/*
 * One wavesurfer instance, mounted here only - not one per clip row. It
 * loads the padded slice (never full.wav: an hour of 22050 mono decodes to
 * ~85 MB of Float32 and freezes the tab) and draws one draggable region at
 * the clip's current bounds. Releasing an edge saves the new bounds as a
 * PATCH. There is no save button and no undo button: the drag is the whole
 * gesture, and an edit that went the wrong way is dragged back the same way.
 */
export function ClipTrimBar({
  videoId,
  clip,
  isPlaying,
  currentTimeSec,
  onPlayFrom,
  onPauseVideo,
}: {
  videoId: string;
  clip: ClipSummary | null;
  /* Whether this clip is the one currently sourcing the video's audio. */
  isPlaying: boolean;
  /* The video's live position, but only ever passed through while it
     belongs to this clip's own timeline (see ClipReviewPane) - null
     otherwise, which falls back to this clip's own startSec below. */
  currentTimeSec: number | null;
  /* Plays the video from an arbitrary position - inside the trim, inside
     the padded context, wherever the operator last positioned the cursor -
     through to this clip's own endSec. */
  onPlayFrom: (startSec: number) => void;
  onPauseVideo: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const windowStartRef = useRef(0);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const updateClips = useUpdateClips(videoId);

  const clipId = clip?.clipId ?? null;
  const startSec = clip?.startSec ?? null;
  const endSec = clip?.endSec ?? null;

  /* Where the next Play click starts from, once the operator has clicked or
     dragged to reposition it manually. Keyed on clipId like `extend`, for
     the same reason - a leftover position from a previous clip must never
     leak into this one. */
  const [manualCursor, setManualCursor] = useState<{
    clipId: string;
    sec: number;
  } | null>(null);
  const cursorSec =
    isPlaying && currentTimeSec != null
      ? currentTimeSec
      : manualCursor?.clipId === clipId
        ? manualCursor.sec
        : startSec;

  /* A play/pause cycle leaves the cursor wherever it stopped - a manual
     pause mid-clip, or the reset-to-start the video hook performs once
     playback reaches endSec (see use_youtube_player's resetSec). Both
     arrive as the last currentTimeSec reported before isPlaying flips
     false, which is what this captures - only the transition matters, not
     every tick while playing, so this intentionally does not depend on
     currentTimeSec or clipId. */
  useEffect(() => {
    if (!isPlaying && clipId && currentTimeSec != null) {
      setManualCursor({ clipId, sec: currentTimeSec });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  /* Clicking or dragging the waveform (see the "interaction" and
     region-clicked wiring below) always repositions the cursor, and redirects
     playback to there too if the video is already rolling - a still frame
     just parks the cursor for the next Play click. Held in a ref so the
     wavesurfer-build effect below never has to depend on isPlaying or
     onPlayFrom, both of which change every tick while playing.

     wavesurfer's "interaction" event fires on every pointer-move of a drag,
     not just on release, so redirecting the live video on each one reseeks
     and replays it dozens of times per gesture - heard as the video
     stopping and starting. The cursor still tracks the pointer instantly;
     only the actual video redirect is debounced down to one call, after the
     gesture settles. */
  const repositionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const handleRepositionRef = useRef((_absSec: number) => {
    /* Replaced below before the waveform can ever call it - this only
       exists to give the ref an initial, correctly-typed function. */
  });
  useEffect(() => {
    handleRepositionRef.current = (absSec: number) => {
      if (!clipId) return;
      setManualCursor({ clipId, sec: absSec });
      if (!isPlaying) return;
      if (repositionDebounceRef.current)
        clearTimeout(repositionDebounceRef.current);
      repositionDebounceRef.current = setTimeout(() => {
        onPlayFrom(absSec);
      }, 200);
    };
  });
  useEffect(() => {
    return () => {
      if (repositionDebounceRef.current)
        clearTimeout(repositionDebounceRef.current);
    };
  }, []);

  /* An operator-driven request to show more than the default pad, either
     from releasing a handle near the loaded edge or from the wheel. Keyed
     on clipId so a leftover value from a previous clip is never mistaken
     for this one - switching clips (or video) falls back to the defaults
     below with no reset effect of its own.

     Only the pad lives here, never a frozen copy of start/end: this effect
     already reads startSec/endSec straight off the clip prop below, and a
     second copy of the same bounds is exactly what let them drift apart -
     an edge-hit save would freeze the bounds at that instant, a later save
     that didn't hit an edge would update the prop but not the copy, and the
     next pad change (a fresh edge hit, or the wheel) would then rebuild the
     window around the stale copy and visibly undo the second save. Reading
     the prop fresh at every rebuild is what onMutate in useUpdateClips is
     for - it lands the new bounds in the cache before the PATCH resolves,
     so they are already current by the time a pad change triggers this
     effect again. */
  const [extend, setExtend] = useState<{ clipId: string; pad: number } | null>(
    null,
  );
  const pad = extend?.clipId === clipId ? extend.pad : MIN_PAD_SEC;

  useEffect(() => {
    if (!containerRef.current || !clipId || startSec == null || endSec == null)
      return;

    const requestBounds = { start: startSec, end: endSec };
    const effectivePad = extend?.clipId === clipId ? extend.pad : MIN_PAD_SEC;
    const windowStart = Math.max(0, requestBounds.start - effectivePad);

    windowStartRef.current = windowStart;

    const regions = RegionsPlugin.create();
    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      height: 64,
      waveColor: resolveCssColor("--muted-foreground", "#888"),
      progressColor: resolveCssColor("--primary", "#7c5cff"),
      cursorColor: resolveCssColor("--primary", "#7c5cff"),
      url: clipAudioUrl(videoId, clipId, {
        padSec: effectivePad,
        startSec: requestBounds.start,
        endSec: requestBounds.end,
      }),
      /* Debounced, not instant: a drag-to-seek fires "interaction"
         repeatedly, and each one redirects the live video (see
         handleRepositionRef) while playing - undebounced, a single drag
         gesture would fire a burst of real seeks at the YouTube player. */
      dragToSeek: { debounceTime: 200 },
      plugins: [regions],
    });
    waveSurferRef.current = waveSurfer;

    let cancelled = false;
    waveSurfer.on("ready", () => {
      if (cancelled) return;
      replaceTrimRegion(regions, requestBounds, windowStart);
    });

    /* Clicking or dragging the bare waveform (outside the region) seeks
       wavesurfer's own silent audio element - harmless, since this instance
       is never played - and reports the position so the cursor can follow.
       Clicking inside the region instead reaches the regions plugin first
       (see region-clicked below), which is why this alone would miss most
       of the visible clip. */
    waveSurfer.on("interaction", (relativeSec) => {
      handleRepositionRef.current(windowStart + relativeSec);
    });

    /* A resize drag's release fires this too - mouseup and mousedown both
       land on the same handle element, which is all a native click needs.
       resizedRecently swallows exactly that spurious click, cleared on the
       next tick so a genuine follow-up click still works. */
    let resizedRecently = false;
    regions.on("region-update", () => {
      resizedRecently = true;
    });
    regions.on("region-clicked", (_region, event) => {
      if (resizedRecently || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeSec =
        ((event.clientX - rect.left) / rect.width) * waveSurfer.getDuration();
      handleRepositionRef.current(windowStart + relativeSec);
    });

    /* region-updated is the release, not the drag: the plugin emits it once
       per handle let-go, never per pointer move. So the release is the save,
       with no timer behind it. The PATCH answers with the new bounds, they
       land in the clip cache, and the row's audio URL changes with them -
       which is what makes playback follow the trim on its own.

       A release that lands near either edge of the loaded window widens the
       pad, which is what lets the operator grab the handle again and keep
       extending - each repeated edge hit compounds the pad (nextEdgePad)
       rather than jumping straight to the server's max, so a clip that only
       needed a little more context does not fetch minutes of audio for it.
       The rebuild this triggers re-centers on the release on its own: it
       reads startSec/endSec straight off the clip prop, and useUpdateClips's
       onMutate has already landed this save's bounds in the cache by then.
       Widening mid-drag instead would swap the audio buffer under an active
       pointer capture the regions plugin still has bound to the region it
       just replaced, so this only ever triggers on the settled position. */
    regions.on("region-updated", (region) => {
      setTimeout(() => {
        resizedRecently = false;
      }, 0);
      const absStart = windowStart + region.start;
      const absEnd = windowStart + region.end;
      updateClips.mutate([{ clipId, startSec: absStart, endSec: absEnd }]);

      const loadedEnd = windowStart + waveSurfer.getDuration();
      const nearStart =
        windowStart > 0 && absStart - windowStart <= EDGE_THRESHOLD_SEC;
      const nearEnd = loadedEnd - absEnd <= EDGE_THRESHOLD_SEC;
      if (nearStart || nearEnd) {
        setExtend({ clipId, pad: nextEdgePad(effectivePad) });
      }
    });

    return () => {
      cancelled = true;
      waveSurfer.destroy();
      waveSurferRef.current = null;
    };
    // Rebuilding on clip identity or an explicit extend request, but not on
    // every startSec/endSec write, is what keeps a plain save's own refetch
    // from tearing down the waveform the operator is mid-drag on - the base
    // startSec/endSec are deliberately read once, from whichever clip prop
    // this effect saw at its last identity change.
  }, [videoId, clipId, extend]);

  /* Wheel widens or narrows the pad without touching the region at all, so
     it carries no drag-continuity risk - it is only ever a manual override
     between drags. A native, non-passive listener is required to preventDefault
     the page scroll; React's onWheel is passive by default. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !clipId || startSec == null || endSec == null) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = extend?.clipId === clipId ? extend.pad : MIN_PAD_SEC;
      const next = Math.min(
        MAX_PAD_SEC,
        Math.max(
          MIN_PAD_SEC,
          Math.round(
            current * (event.deltaY > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR),
          ),
        ),
      );
      if (next !== current) setExtend({ clipId, pad: next });
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [clipId, extend, startSec, endSec]);

  /* Moves wavesurfer's own (silent) cursor to match cursorSec, whether that
     came from the video playing, a manual reposition, or the end-of-clip
     reset. setTime only ever touches this instance's own audio element, so
     it never makes a sound - the video is the one actually playing. */
  useEffect(() => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer || cursorSec == null) return;
    const relativeSec = cursorSec - windowStartRef.current;
    if (relativeSec < 0 || relativeSec > waveSurfer.getDuration()) return;
    waveSurfer.setTime(relativeSec);
  }, [cursorSec]);

  if (!clip)
    return (
      <p className="shrink-0 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        Select a clip below to trim it.
      </p>
    );
  if (startSec == null || endSec == null)
    return (
      <p className="shrink-0 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        This clip has no timing data yet.
      </p>
    );

  return (
    <div className="shrink-0 rounded-lg border border-border bg-card/50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              isPlaying ? onPauseVideo() : onPlayFrom(cursorSec ?? startSec)
            }
            aria-label={isPlaying ? "Pause" : "Play from cursor"}
            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            {isPlaying ? (
              <Pause className="size-3" />
            ) : (
              <Play className="size-3 translate-x-px" />
            )}
          </button>
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            {formatDuration(endSec - startSec)} clip, ±{pad}s shown
          </span>
        </div>
        {updateClips.isPending ? (
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            saving…
          </span>
        ) : (
          <span className="text-[0.7rem] text-muted-foreground/70">
            Click to move the cursor · scroll to widen the view
          </span>
        )}
      </div>
      <div ref={containerRef} />
      {updateClips.isError && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {updateClips.error.message}
        </p>
      )}
    </div>
  );
}
