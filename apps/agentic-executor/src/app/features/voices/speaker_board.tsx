"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { ClipRow } from "./clip_row";
import { VoiceSpeakerCombobox } from "./voice_speaker_combobox";
import {
  useAssignRun,
  useCommitRun,
  useDiscardRun,
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
  const assignRun = useAssignRun(runId);
  const commitRun = useCommitRun(runId);
  const discardRun = useDiscardRun(runId);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  /*
   * Local echo of what assign_run has stored, keyed by speaker label. The
   * combobox shows the name; commit/assign payloads need the id, so both
   * are tracked side by side rather than round-tripping through the board
   * query on every selection.
   */
  const [assignedNames, setAssignedNames] = useState<Record<string, string>>(
    {},
  );
  const [assignedVoiceIds, setAssignedVoiceIds] = useState<
    Record<string, string>
  >({});

  const assignedCount = Object.keys(assignedVoiceIds).length;

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

  /*
   * Autosave-on-select: each combobox selection calls assign_run right away,
   * before "Commit assignments" is ever clicked. assign_run is a full
   * replace and is documented as safe to call repeatedly (voice.py:376-381),
   * so this keeps "Commit assignments" a single cheap call while still
   * satisfying "Assign speakers only opens the combobox, it never starts
   * training on its own".
   */
  function selectVoiceForSpeaker(
    speakerLabel: string,
    voiceId: string,
    voiceName: string,
  ) {
    const nextVoiceIds = { ...assignedVoiceIds, [speakerLabel]: voiceId };
    setAssignedVoiceIds(nextVoiceIds);
    setAssignedNames((current) => ({ ...current, [speakerLabel]: voiceName }));

    const assignments: Record<string, string | null> = {};
    for (const group of speakers) {
      if (!group.speakerLabel) {
        continue;
      }
      assignments[group.speakerLabel] =
        nextVoiceIds[group.speakerLabel] ?? null;
    }
    assignRun.mutate(assignments);
  }

  function commit() {
    commitRun.mutate();
  }

  function discard() {
    discardRun.mutate(undefined, {
      onSuccess: () => {
        setAssignedNames({});
        setAssignedVoiceIds({});
        setAssigning(false);
      },
    });
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
                {speakerLabel !== null && assigning && (
                  <VoiceSpeakerCombobox
                    speakerLabel={speakerLabel}
                    assignedVoiceName={assignedNames[speakerLabel] ?? null}
                    disabled={!awaitingReview}
                    onSelect={(voiceId, voiceName) =>
                      selectVoiceForSpeaker(speakerLabel, voiceId, voiceName)
                    }
                  />
                )}
                {speakerLabel !== null && !assigning && (
                  <p className="text-xs text-muted-foreground">
                    {assignedNames[speakerLabel]
                      ? `assigned to ${assignedNames[speakerLabel]}`
                      : "awaiting assignment"}
                  </p>
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
                ? `Assign a voice to at least one speaker for ${primaryCharacter}. Unassigned speakers are left out of the commit.`
                : `${assignedCount} speaker${assignedCount === 1 ? "" : "s"} assigned.`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={assigning ? "outline" : "secondary"}
                onClick={() => setAssigning((current) => !current)}
              >
                {assigning ? "Done assigning" : "Assign speakers"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={discardRun.isPending}
                onClick={discard}
              >
                {discardRun.isPending ? "Discarding..." : "Discard"}
              </Button>
              <Button
                size="sm"
                disabled={assignedCount === 0 || commitRun.isPending}
                onClick={commit}
              >
                {commitRun.isPending ? "Committing..." : "Commit assignments"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {assignRun.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {(assignRun.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {commitRun.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {(commitRun.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {discardRun.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {(discardRun.error as Error).message}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
