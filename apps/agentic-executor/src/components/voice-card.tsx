"use client";

import { Mic, Users, Clapperboard } from "lucide-react";
import { StatusPill } from "./status-pill";
import { cn } from "@/lib/utils";
import type { VoiceDetail } from "@/lib/types";

/*
 * What a voice is made of, read from its contributions.
 *
 * A contribution is one speaker label from one video, joined to this voice by
 * id. That is the whole association, so the card counts those rows rather
 * than a stored total - there is no clip count column, and inventing one
 * would give the same fact two writers.
 */
export function VoiceCard({
  voice,
  selected,
  onSelect,
}: {
  voice: VoiceDetail;
  selected: boolean;
  onSelect: () => void;
}) {
  const speakerCount = voice.contributions.length;
  const videoCount = new Set(
    voice.contributions.map((contribution) => contribution.videoId),
  ).size;
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
        {speakerCount === 0 ? (
          <span>no speakers assigned yet</span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              {speakerCount} speaker{speakerCount === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clapperboard className="size-3" />
              {videoCount} video{videoCount === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>
    </button>
  );
}
