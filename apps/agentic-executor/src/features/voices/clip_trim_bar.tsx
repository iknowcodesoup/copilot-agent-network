"use client";

import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/plugins/regions";
import { useUpdateClips } from "./api/use_videos";
import { clipAudioUrl } from "./api/query_keys";
import { formatDuration } from "@/lib/format";
import type { ClipSummary } from "./types";

/* Context around the clip's own bounds, so a clipped word onset or trailing
   consonant is visible and draggable back in - not just what review.csv
   already kept. Comfortably under the route's MAX_PAD_SEC of 10s. */
const TRIM_PAD_SEC = 3;
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
 * the clip's current bounds. Releasing an edge saves the new bounds as a
 * PATCH. There is no save button and no undo button: the drag is the whole
 * gesture, and an edit that went the wrong way is dragged back the same way.
 */
export function ClipTrimBar({
  videoId,
  clip,
}: {
  videoId: string;
  clip: ClipSummary | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const updateClips = useUpdateClips(videoId);

  const clipId = clip?.clipId ?? null;
  const startSec = clip?.startSec ?? null;
  const endSec = clip?.endSec ?? null;

  useEffect(() => {
    if (!containerRef.current || !clipId || startSec == null || endSec == null)
      return;

    const windowStart = Math.max(0, startSec - TRIM_PAD_SEC);

    const regions = RegionsPlugin.create();
    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      height: 64,
      waveColor: resolveCssColor("--muted-foreground", "#888"),
      progressColor: resolveCssColor("--primary", "#7c5cff"),
      cursorColor: resolveCssColor("--primary", "#7c5cff"),
      url: clipAudioUrl(videoId, clipId, { padSec: TRIM_PAD_SEC }),
      plugins: [regions],
    });

    let cancelled = false;
    waveSurfer.on("ready", () => {
      if (cancelled) return;
      replaceTrimRegion(regions, { start: startSec, end: endSec }, windowStart);
    });

    /* region-updated is the release, not the drag: the plugin emits it once
       per handle let-go, never per pointer move. So the release is the save,
       with no timer behind it. The PATCH answers with the new bounds, they
       land in the clip cache, and the row's audio URL changes with them -
       which is what makes playback follow the trim on its own. */
    regions.on("region-updated", (region) => {
      updateClips.mutate([
        {
          clipId,
          startSec: windowStart + region.start,
          endSec: windowStart + region.end,
        },
      ]);
    });

    return () => {
      cancelled = true;
      waveSurfer.destroy();
    };
    // Rebuilding only on clip identity, not on every startSec/endSec write,
    // is what keeps a save's own refetch from tearing down the waveform the
    // operator is mid-drag on - startSec/endSec are deliberately read once,
    // from whichever clip prop this effect saw at clipId's last change.
  }, [videoId, clipId]);

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
        {updateClips.isPending && (
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            saving…
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
