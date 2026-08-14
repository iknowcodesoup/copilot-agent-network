"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo, useState } from "react";
import { ClipRow } from "./clip_row";
import {
  useApproveRun,
  useSpeakerBoard,
  useUpdateClips,
  type SpeakerGroup,
} from "./voice_api";

const REJECTED_GROUP_LABEL = "Rejected by diarization";
const REJECTED_GROUP_HINT =
  "No single speaker holds enough of these clips. That means cross-talk, music, or silence. They cannot be assigned.";

function speakerTitle(group: SpeakerGroup): string {
  return group.speakerLabel ?? REJECTED_GROUP_LABEL;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function SpeakerBoard({
  runId,
  primaryCharacter,
  awaitingReview,
}: {
  runId: string;
  primaryCharacter: string;
  awaitingReview: boolean;
}) {
  const board = useSpeakerBoard(runId, true);
  const updateClips = useUpdateClips(runId);
  const approveRun = useApproveRun(runId);

  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  /*
   * Seed each real speaker with the primary character so the common case -
   * one wanted voice - needs no typing. Only speakers left blank are discarded.
   */
  const effectiveAssignments = useMemo(() => {
    const seeded: Record<string, string> = {};
    for (const group of board.data?.speakers ?? []) {
      if (!group.speakerLabel) {
        continue;
      }
      seeded[group.speakerLabel] =
        assignments[group.speakerLabel] ?? group.assignedCharacter ?? "";
    }
    return seeded;
  }, [board.data, assignments]);

  const assignedCount = Object.values(effectiveAssignments).filter(
    (character) => character.trim().length > 0,
  ).length;

  if (board.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (board.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load the clips: {(board.error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  const speakers = board.data?.speakers ?? [];

  function toggleKeep(clipId: string, keep: boolean) {
    updateClips.mutate([{ clipId, keep }]);
  }

  function setGroupKeep(group: SpeakerGroup, keep: boolean) {
    updateClips.mutate(
      group.clips.map((clip) => ({ clipId: clip.clipId, keep })),
    );
  }

  function approve() {
    const speakerMap: Record<string, string | null> = {};
    for (const [speakerLabel, character] of Object.entries(
      effectiveAssignments,
    )) {
      speakerMap[speakerLabel] = character.trim() || null;
    }
    approveRun.mutate(speakerMap);
  }

  return (
    <div className="flex flex-col gap-4">
      {speakers.map((group) => {
        // narrowed once here so the assignment input below needs no non-null
        // assertion on every use
        const speakerLabel = group.speakerLabel;
        const isOpen = expanded === speakerTitle(group);
        return (
          <Card key={speakerTitle(group)}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium">{speakerTitle(group)}</h3>
                <p className="text-xs text-muted-foreground">
                  {group.clipCount} clips · {group.keptCount} kept ·{" "}
                  {formatDuration(group.totalDurationSec)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {speakerLabel !== null && (
                  <Input
                    aria-label={`Character for ${speakerLabel}`}
                    placeholder="discard"
                    className="h-7 w-40"
                    disabled={!awaitingReview}
                    value={effectiveAssignments[speakerLabel] ?? ""}
                    onChange={(event) =>
                      setAssignments((current) => ({
                        ...current,
                        [speakerLabel]: event.target.value,
                      }))
                    }
                  />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!awaitingReview || updateClips.isPending}
                  onClick={() => setGroupKeep(group, true)}
                >
                  Keep all
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!awaitingReview || updateClips.isPending}
                  onClick={() => setGroupKeep(group, false)}
                >
                  Reject all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setExpanded(isOpen ? null : speakerTitle(group))
                  }
                >
                  {isOpen ? "Hide clips" : "Play clips"}
                </Button>
              </div>
            </CardHeader>

            {isOpen && (
              <CardContent className="p-0">
                {speakerLabel === null && (
                  <p className="px-3 pb-2 text-xs text-muted-foreground">
                    {REJECTED_GROUP_HINT}
                  </p>
                )}
                <ul className="max-h-96 overflow-y-auto">
                  {group.clips.map((clip) => (
                    <ClipRow
                      key={clip.clipId}
                      runId={runId}
                      clip={clip}
                      onToggleKeep={toggleKeep}
                      disabled={!awaitingReview || updateClips.isPending}
                    />
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        );
      })}

      {awaitingReview && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <p className="text-xs text-muted-foreground">
              {assignedCount === 0
                ? `Name a character for at least one speaker. Blank means discard. Unlabelled clips go to ${primaryCharacter}.`
                : `${assignedCount} speaker${assignedCount === 1 ? "" : "s"} assigned. Approving starts training and cannot be undone from here.`}
            </p>
            <Button
              disabled={assignedCount === 0 || approveRun.isPending}
              onClick={approve}
            >
              {approveRun.isPending ? "Starting..." : "Approve and train"}
            </Button>
          </CardContent>
        </Card>
      )}

      {approveRun.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {(approveRun.error as Error).message}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
