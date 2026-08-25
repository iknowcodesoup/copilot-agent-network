"use client";

import { useMemo, useState } from "react";
import { useSpeakerBoard } from "./api/use_videos";
import { useAssignClips } from "./api/use_voices";
import { cn } from "@/lib/utils";
import { ClipRow } from "./clip_row";
import { reviewLabel, reviewStatus, toneForReviewStatus } from "./derive";
import { StatusPill } from "./status_pill";
import type { StudioClip } from "./types";

type Filter = "all" | "kept" | "excluded" | "unreviewed" | "flagged";

/*
 * Keyed on the video, because the clips are: they belong to the video and are
 * shared by every character that claims it. No run is needed to read or
 * review them, which is why runId is only passed through to the rows.
 */
export function ClipListPanel({
  videoId,
  runId,
  selectedClipId,
  onSelectClip,
  playingClipId,
  onPlayClip,
  onPauseVideo,
}: {
  videoId: string;
  runId: string | null;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  /* Which clip is currently sourcing the video's audio, if any. Only one row
     can be "playing" at a time - the video is the only player now. */
  playingClipId: string | null;
  /* Passed straight through to every row, which plays that clip's own
     startSec..endSec range through the video. This panel knows nothing
     about the preview. */
  onPlayClip: (clip: StudioClip) => void;
  onPauseVideo: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  /* Which clips are mid-assign. The mutation alone cannot say: a group assign
     names many clips at once, and every row of that group has to show it. */
  const [pendingClipIds, setPendingClipIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const board = useSpeakerBoard(videoId, Boolean(videoId));
  const assignClips = useAssignClips();
  const clips = useMemo(
    () => board.data?.speakers.flatMap((speaker) => speaker.clips) ?? [],
    [board.data],
  );
  /* Every clip diarization put under the same speaker label. Picking a voice
     on any one row assigns the whole group, which is the point of the label:
     it is a bulk-select, not an association. A clip with no label is its own
     group of one - there is nothing to join. */
  const clipIdsInGroupOf = (clipId: string): string[] => {
    const clip = clips.find((candidate) => candidate.clipId === clipId);
    if (!clip?.speakerLabel) return clipId ? [clipId] : [];
    return clips
      .filter((candidate) => candidate.speakerLabel === clip.speakerLabel)
      .map((candidate) => candidate.clipId);
  };

  /* The one assign path. A first pick on a speaker takes the whole group; a
     later pick on a row that already shows a name corrects that row alone,
     because a diarized group is not always one person. Both are the same
     write - only the list of clip ids differs. */
  const assign = (clipId: string, voiceId: string, groupWide: boolean) => {
    const clipIds = groupWide ? clipIdsInGroupOf(clipId) : [clipId];
    setPendingClipIds(new Set(clipIds));
    assignClips.mutate(
      { voiceId, videoId, clipIds },
      { onSettled: () => setPendingClipIds(new Set()) },
    );
  };
  const shown = clips.filter((clip) => {
    if (filter === "kept") return clip.keep === true;
    if (filter === "excluded") return clip.keep === false;
    if (filter === "unreviewed") return clip.keep === null;
    if (filter === "flagged") return clip.flagged;
    return true;
  });

  if (board.isLoading)
    return (
      <p className="min-h-0 flex-1 p-6 text-center text-sm text-muted-foreground">
        Loading clips…
      </p>
    );
  if (board.isError)
    return (
      <p className="min-h-0 flex-1 rounded-lg border border-destructive/30 p-6 text-center text-sm text-destructive">
        Unable to load clips.
      </p>
    );
  if (clips.length === 0)
    return (
      <div className="min-h-0 flex-1 rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No clips yet — they appear once diarization completes.
        </p>
      </div>
    );

  const counts = {
    all: clips.length,
    kept: clips.filter((c) => c.keep === true).length,
    excluded: clips.filter((c) => c.keep === false).length,
    unreviewed: clips.filter((c) => c.keep === null).length,
    flagged: clips.filter((c) => c.flagged).length,
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "kept", "excluded", "unreviewed", "flagged"] as Filter[]).map((key) => (
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
        {/* A fact, not a button. Nobody commits a run: they decide clips,
            and this says how many are still undecided. */}
        <StatusPill
          className="ml-auto"
          tone={toneForReviewStatus(reviewStatus(clips))}
          label={reviewLabel(clips)}
        />
      </div>
      {/* One assignment failure, reported once. Repeating it on every row of
          the group says nothing extra. */}
      {assignClips.isError && (
        <p role="alert" className="text-xs text-destructive">
          {assignClips.error.message}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {shown.map((clip, position) => {
          const studioClip = { ...clip, runId: runId ?? "", videoId } as StudioClip;
          return (
            <ClipRow
              key={clip.clipId}
              clip={studioClip}
              ordinal={position + 1}
              selected={clip.clipId === selectedClipId}
              onSelect={() => onSelectClip(clip.clipId)}
              onAssignVoice={(voiceId) =>
                /* Group-wide only while the clip is still unnamed. Once it
                   shows a voice, a further pick is a correction to this row,
                   so it must not drag the rest of the group with it. */
                assign(clip.clipId, voiceId, clip.voiceName === null)
              }
              assigning={pendingClipIds.has(clip.clipId)}
              playing={playingClipId === clip.clipId}
              onPlayClip={() => onPlayClip(studioClip)}
              onPauseVideo={onPauseVideo}
            />
          );
        })}
      </div>
    </div>
  );
}
