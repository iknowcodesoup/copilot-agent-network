"use client";

import { useMemo, useState } from "react";
import {
  useAssignRun,
  useCommitRun,
  useSpeakerBoard,
  useVoiceList,
  useVoiceRun,
} from "@/lib/voice_api";
import { cn } from "@/lib/utils";
import { ClipRow } from "./clip-row";
import type { StudioClip } from "@/lib/types";

type Filter = "all" | "kept" | "review" | "flagged";

/*
 * Keyed on the video, because the clips are: review.csv belongs to the video
 * and is shared by every character that claims it. runId is null for a video no
 * run has claimed - the clips still read, and only the run actions go away.
 */
export function ClipTable({
  videoId,
  runId,
}: {
  videoId: string;
  runId: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  /* Which speaker is mid-assign. The mutation alone cannot say: its variables
     are the whole merged map, so every assigned speaker would look pending. */
  const [pendingSpeaker, setPendingSpeaker] = useState<string | null>(null);
  const board = useSpeakerBoard(videoId, Boolean(videoId));
  const run = useVoiceRun(runId ?? "", { enabled: Boolean(runId) });
  const commitRun = useCommitRun(runId ?? "");
  const assignRun = useAssignRun(runId ?? "");
  const voices = useVoiceList();
  const voiceAssignments = useMemo(
    () => run.data?.voiceAssignments ?? {},
    [run.data],
  );
  /* Resolve the assigned voice's name by id at render time. Copying the name
     onto the clip is what let a rename leave a stale string behind. */
  const voiceNameById = useMemo(
    () => new Map((voices.data ?? []).map((voice) => [voice.id, voice.name])),
    [voices.data],
  );
  const clips = useMemo(
    () => board.data?.speakers.flatMap((speaker) => speaker.clips) ?? [],
    [board.data],
  );
  const hasAssignment = Object.values(voiceAssignments).some(
    (voiceId) => voiceId != null,
  );
  /* A voice binds to a speaker, so this assigns every clip that speaker owns,
     not the one row it was picked on.

     Spreading the current map is what keeps the others: POST .../assign
     replaces voice_assignments wholesale, so sending one pair on its own
     erased every speaker assigned before it. */
  const assignSpeaker = (speakerLabel: string, voiceId: string) => {
    setPendingSpeaker(speakerLabel);
    assignRun.mutate(
      { ...voiceAssignments, [speakerLabel]: voiceId },
      { onSettled: () => setPendingSpeaker(null) },
    );
  };
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
          disabled={!runId || !hasAssignment || commitRun.isPending}
          onClick={() => commitRun.mutate()}
          className={cn(
            "ml-auto rounded-full border px-2.5 py-1 font-mono text-[0.7rem]",
            runId && hasAssignment
              ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border text-muted-foreground/50",
          )}
        >
          {commitRun.isPending ? "Committing…" : "Commit run"}
        </button>
      </div>
      {/* One assignment failure, reported once. Repeating it on every row of
          the speaker says nothing extra. */}
      {assignRun.isError && (
        <p role="alert" className="text-xs text-destructive">
          {assignRun.error.message}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {shown.map((clip) => {
          const assignedVoiceId = clip.speakerLabel
            ? (voiceAssignments[clip.speakerLabel] ?? null)
            : null;
          const speakerLabel = clip.speakerLabel;
          return (
            <ClipRow
              key={clip.clipId}
              clip={
                {
                  ...clip,
                  runId: runId ?? "",
                  videoId,
                  index: clip.startSec ?? 0,
                } as StudioClip
              }
              assignedVoiceName={
                assignedVoiceId
                  ? (voiceNameById.get(assignedVoiceId) ?? null)
                  : null
              }
              onAssignSpeaker={
                runId && speakerLabel
                  ? (voiceId) => assignSpeaker(speakerLabel, voiceId)
                  : null
              }
              assigning={
                pendingSpeaker !== null && pendingSpeaker === speakerLabel
              }
            />
          );
        })}
      </div>
    </div>
  );
}
