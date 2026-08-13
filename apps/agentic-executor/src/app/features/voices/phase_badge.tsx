"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isActive, phaseLabels, type VoiceRunPhase } from "./voice_api";

const phaseStyles: Record<VoiceRunPhase, string> = {
  downloading: "bg-muted text-muted-foreground",
  diarizing: "bg-muted text-muted-foreground",
  awaiting_review: "bg-primary/10 text-primary border-primary/30",
  committing: "bg-muted text-muted-foreground",
  training: "bg-muted text-muted-foreground",
  exporting: "bg-muted text-muted-foreground",
  ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
};

export function PhaseBadge({
  phase,
  className,
}: {
  phase: VoiceRunPhase;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", phaseStyles[phase], className)}
    >
      {isActive(phase) && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-current"
        />
      )}
      {phaseLabels[phase]}
    </Badge>
  );
}
