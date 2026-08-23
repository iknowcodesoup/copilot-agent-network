"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/plugins/regions";
import { Undo2 } from "lucide-react";
import { useUpdateClips } from "./api/use_videos";
import { clipAudioUrl } from "./api/query_keys";
import { formatDuration } from "@/lib/format";
import type { ClipSummary } from "./types";

/* Context around the clip's own bounds, so a clipped word onset or trailing
   consonant is visible and draggable back in - not just what review.csv
   already kept. Comfortably under the route's MAX_PAD_SEC of 10s. */
const TRIM_PAD_SEC = 3;
const TRIM_SAVE_DEBOUNCE_MS = 800;
const REGION_COLOR = "color-mix(in oklab, var(--primary) 22%, transparent)";

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
 * the clip's current bounds. Dragging an edge debounce-saves the new bounds
 * as a PATCH; the previous bounds stay in a ref so Undo can put them back.
 */
export function ClipTrimBar({
  videoId,
  clip,
}: {
  videoId: string;
  clip: ClipSummary | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const regionsRef = useRef<Regions | null>(null);
  const lastSavedRef = useRef<TrimBounds | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowStartRef = useRef(0);
  const [undoBounds, setUndoBounds] = useState<TrimBounds | null>(null);
  const updateClips = useUpdateClips(videoId);

  const clipId = clip?.clipId ?? null;
  const startSec = clip?.startSec ?? null;
  const endSec = clip?.endSec ?? null;

  useEffect(() => {
    setUndoBounds(null);
    if (!containerRef.current || !clipId || startSec == null || endSec == null)
      return;

    const windowStart = Math.max(0, startSec - TRIM_PAD_SEC);
    windowStartRef.current = windowStart;
    lastSavedRef.current = { start: startSec, end: endSec };

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;
    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      height: 64,
      waveColor: resolveCssColor("--muted-foreground", "#888"),
      progressColor: resolveCssColor("--primary", "#7c5cff"),
      cursorColor: resolveCssColor("--primary", "#7c5cff"),
      url: clipAudioUrl(videoId, clipId, TRIM_PAD_SEC),
      plugins: [regions],
    });

    let cancelled = false;
    waveSurfer.on("ready", () => {
      if (cancelled) return;
      replaceTrimRegion(regions, { start: startSec, end: endSec }, windowStart);
    });

    regions.on("region-updated", (region) => {
      const bounds: TrimBounds = {
        start: windowStartRef.current + region.start,
        end: windowStartRef.current + region.end,
      };
      setUndoBounds(lastSavedRef.current);
      lastSavedRef.current = bounds;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        updateClips.mutate([{ clipId, startSec: bounds.start, endSec: bounds.end }]);
      }, TRIM_SAVE_DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      waveSurfer.destroy();
      regionsRef.current = null;
    };
    // Rebuilding only on clip identity, not on every startSec/endSec write,
    // is what keeps a save's own refetch from tearing down the waveform the
    // operator is mid-drag on - startSec/endSec are deliberately read once,
    // from whichever clip prop this effect saw at clipId's last change.
  }, [videoId, clipId]);

  const undo = () => {
    const bounds = undoBounds;
    const regions = regionsRef.current;
    if (!bounds || !regions || !clipId) return;
    replaceTrimRegion(regions, bounds, windowStartRef.current);
    lastSavedRef.current = bounds;
    setUndoBounds(null);
    updateClips.mutate([{ clipId, startSec: bounds.start, endSec: bounds.end }]);
  };

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
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {formatDuration(endSec - startSec)} clip, ±{TRIM_PAD_SEC}s shown
        </span>
        {undoBounds && (
          <button
            type="button"
            onClick={undo}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 font-mono text-[0.7rem] text-muted-foreground hover:text-foreground"
          >
            <Undo2 className="size-3" /> Undo
          </button>
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
