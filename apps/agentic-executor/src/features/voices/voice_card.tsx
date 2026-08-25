"use client";

import { Mic, AudioLines, Clapperboard } from "lucide-react";
import { StatusPill } from "./status_pill";
import { cn } from "@/lib/utils";
import type { VoiceDetail } from "./types";

/*
 * What a voice is made of, read from its clips.
 *
 * A clip is assigned to this voice by id, and that is the whole association,
 * so the card counts those rows rather than a stored total - there is no clip
 * count column, and inventing one would give the same fact two writers.
 *
 * Only kept clips train, so the card says how many of them there are. A voice
 * holding forty clips of which two are kept is two clips of training audio,
 * and reporting forty would be a promise the compile does not keep.
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
  const keptCount = voice.clips.filter((clip) => clip.keep === true).length;
  const videoCount = new Set(voice.clips.map((clip) => clip.videoId)).size;
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
        {voice.clips.length === 0 ? (
          <span>no clips assigned yet</span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1">
              <AudioLines className="size-3" />
              {keptCount} clip{keptCount === 1 ? "" : "s"}
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
