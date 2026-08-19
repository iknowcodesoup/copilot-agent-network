"use client";

import { Mic, Scissors } from "lucide-react";
import { useStudio } from "./studio-provider";
import { StatusPill } from "./status-pill";
import { cn } from "@/lib/utils";
import type { VoiceDetail } from "@/lib/types";

export function VoiceCard({
  voice,
  selected,
  onSelect,
}: {
  voice: VoiceDetail;
  selected: boolean;
  onSelect: () => void;
}) {
  const { trainingForVoice } = useStudio();
  const training = trainingForVoice(voice);
  const clips = voice.contributions.length;
  const active = voice.phase === "training";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left",
        selected
          ? "border-primary/60 ring-1 ring-primary/40"
          : "border-border hover:border-primary/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary/15">
          <Mic className="size-3.5 text-primary" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {voice.name}
        </h3>
        <StatusPill
          tone={
            active
              ? "running"
              : voice.phase === "ready"
                ? "complete"
                : "neutral"
          }
          pulse={active}
          label={voice.phase}
        />
      </div>
      <div className="flex items-center gap-3 font-mono text-[0.7rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Scissors className="size-3" />
          {clips} clips
        </span>
        {training?.checkpoints[0] && (
          <span>epoch {training.checkpoints[0].epoch ?? "—"}</span>
        )}
      </div>
    </button>
  );
}
