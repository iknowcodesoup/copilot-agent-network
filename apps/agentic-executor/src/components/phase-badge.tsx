"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  isActive,
  PhaseLabels,
  type VoicePhase,
  type VoiceRunPhase,
} from "@/lib/voice_api";

/*
 * A durable Voice (Story 3.1) moves through its own, shorter phase list -
 * VoicePhase - separate from a run's ingest phases (VoiceRunPhase). Every
 * VoicePhase value except awaiting_commit already appears in VoiceRunPhase
 * with the same meaning, so this badge takes either union and looks each
 * phase up in one shared map (Story 3.6).
 */
type AnyPhase = VoiceRunPhase | VoicePhase;

const phaseStyles: Record<AnyPhase, string> = {
  downloading: "bg-muted text-muted-foreground",
  diarizing: "bg-muted text-muted-foreground",
  awaiting_review: "bg-primary/10 text-primary border-primary/30",
  awaiting_commit: "bg-primary/10 text-primary border-primary/30",
  committing: "bg-muted text-muted-foreground",
  training: "bg-muted text-muted-foreground",
  exporting: "bg-muted text-muted-foreground",
  ready: "bg-success/15 text-success border-success/30",
  failed: "bg-destructive/10 text-destructive",
};

const voicePhaseLabels: Record<VoicePhase, string> = {
  awaiting_commit: "Awaiting commit",
  training: PhaseLabels.training,
  exporting: PhaseLabels.exporting,
  ready: PhaseLabels.ready,
  failed: PhaseLabels.failed,
};

const PhaseLabelsByPhase: Record<AnyPhase, string> = {
  ...PhaseLabels,
  ...voicePhaseLabels,
};

/* awaiting_commit is a resting phase (RESTING_PHASES in models/voices.py),
   so it gets no pulse dot even though it is not in VoiceRunPhase's
   activePhases set. */
function isAnyPhaseActive(phase: AnyPhase): boolean {
  return phase !== "awaiting_commit" && isActive(phase as VoiceRunPhase);
}

export function PhaseBadge({
  phase,
  className,
}: {
  phase: AnyPhase;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", phaseStyles[phase], className)}
    >
      {isAnyPhaseActive(phase) && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 animate-pulse rounded-full bg-current"
        />
      )}
      {PhaseLabelsByPhase[phase]}
    </Badge>
  );
}
