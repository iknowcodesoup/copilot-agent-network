"use client";

import { useMemo, useState } from "react";
import {
  useCommitRun,
  useSpeakerBoard,
  useVoiceRun,
} from "@/lib/voice_api";
import { cn } from "@/lib/utils";
import { ClipRow } from "./clip-row";
import type { StudioClip } from "@/lib/types";

type Filter = "all" | "kept" | "review" | "flagged";

export function ClipTable({ runId }: { runId: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const board = useSpeakerBoard(runId, Boolean(runId));
  const run = useVoiceRun(runId);
  const commitRun = useCommitRun(runId);
  const voiceAssignments = run.data?.voiceAssignments ?? {};
  const clips = useMemo(
    () => board.data?.speakers.flatMap((speaker) => speaker.clips) ?? [],
    [board.data],
  );
  const hasAssignment = Object.values(voiceAssignments).some(
    (voiceId) => voiceId != null,
  );
  const shown = clips.filter((clip) => {
    if (filter === "kept") return clip.keep;
    if (filter === "review") return !clip.keep;
    if (filter === "flagged") return clip.flagged;
    return true;
  });

  if (board.isLoading)
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        Loading clips…
      </p>
    );
  if (board.isError)
    return (
      <p className="rounded-lg border border-destructive/30 p-6 text-center text-sm text-destructive">
        Unable to load clips.
      </p>
    );
  if (clips.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No clips yet — they appear once diarization completes.
        </p>
      </div>
    );

  const counts = {
    all: clips.length,
    kept: clips.filter((c) => c.keep).length,
    review: clips.filter((c) => !c.keep).length,
    flagged: clips.filter((c) => c.flagged).length,
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "kept", "review", "flagged"] as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[0.7rem] capitalize",
              filter === key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {key} <span className="ml-1 opacity-60">{counts[key]}</span>
          </button>
        ))}
        <button
          type="button"
          disabled={!hasAssignment || commitRun.isPending}
          onClick={() => commitRun.mutate()}
          className={cn(
            "ml-auto rounded-full border px-2.5 py-1 font-mono text-[0.7rem]",
            hasAssignment
              ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border text-muted-foreground/50",
          )}
        >
          {commitRun.isPending ? "Committing…" : "Commit run"}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {shown.map((clip) => (
          <ClipRow
            key={clip.clipId}
            clip={
              {
                ...clip,
                runId,
                videoId: runId,
                index: clip.startSec ?? 0,
                assignedVoiceId:
                  voiceAssignments[clip.speakerLabel ?? clip.clipId] ?? null,
              } as StudioClip
            }
          />
        ))}
      </div>
    </div>
  );
}
