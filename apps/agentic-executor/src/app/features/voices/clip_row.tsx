"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clipAudioUrl, type ClipSummary } from "./voice_api";

function formatSeconds(seconds: number | null): string {
  if (seconds === null) {
    return "--";
  }
  return `${seconds.toFixed(1)}s`;
}

export function ClipRow({
  runId,
  clip,
  onToggleKeep,
  disabled,
}: {
  runId: string;
  clip: ClipSummary;
  onToggleKeep: (clipId: string, keep: boolean) => void;
  disabled: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0",
        !clip.keep && "opacity-50"
      )}
    >
      {/* the native player is enough here: one short mono wav, no scrubbing UI */}
      <audio
        controls
        preload="none"
        src={clipAudioUrl(runId, clip.clipId)}
        className="h-7 w-56 shrink-0"
      />

      <p className="min-w-0 flex-1 truncate text-xs" title={clip.text}>
        {clip.text || <span className="text-muted-foreground">no transcript</span>}
      </p>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatSeconds(clip.durationSec)}
      </span>

      {clip.flagged && (
        <Badge variant="outline" className="shrink-0 text-destructive">
          noisy
        </Badge>
      )}

      <Button
        size="sm"
        variant={clip.keep ? "secondary" : "outline"}
        disabled={disabled}
        onClick={() => onToggleKeep(clip.clipId, !clip.keep)}
        className="shrink-0"
      >
        {clip.keep ? "Keep" : "Rejected"}
      </Button>
    </li>
  );
}
