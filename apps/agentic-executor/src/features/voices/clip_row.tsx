"use client";

import { useEffect, useState } from "react";
import { Check, X, Pencil, AudioLines, Pause, Play } from "lucide-react";
import { VoiceSpeakerCombobox } from "./voice_speaker_combobox";
import { cn } from "@/lib/utils";
import type { StudioClip } from "./types";
import { formatDuration } from "@/lib/format";
import { useUpdateClips } from "./api/use_videos";

/*
 * Clip writes target clip.videoId directly, never a shared "active" video id.
 * That id used to be StudioProvider's own fallback guess (first run's video)
 * and could name a different video than the one this row is actually showing,
 * which silently sent edits to the wrong video's clips.
 *
 * The combobox means two different things depending on whether this clip
 * already shows a name (its own pin, or a speaker's inherited default):
 *
 * - No name yet: this is the first assignment for the whole speaker group.
 *   onAssignSpeaker writes the group-wide Postgres map (voiceId, joined to a
 *   voice_contributions row), same as before - every clip pyannote grouped
 *   under this label picks up the name, which is the point: auto-label a
 *   still-undecided group.
 * - Already has a name: a diarized group is not one person, so a later pick
 *   here is a correction to THIS clip alone. It writes assignedVoice (a name
 *   string) straight to review.csv via updateClips, and never touches the
 *   group map - every other clip in the group is untouched. This is the one
 *   place a per-clip write is deliberate despite the id-joining concern
 *   above: a corrected clip's audit trail is the group's contribution row,
 *   not its own - see clip_row.tsx's onSelect below and voice_run_assignment.py.
 */
export function ClipRow({
  clip,
  ordinal,
  selected,
  onSelect,
  assignedVoiceName,
  onAssignSpeaker,
  assigning,
  playing,
  onPlayClip,
  onPauseVideo,
}: {
  clip: StudioClip;
  /* position in the currently-shown list; not stored on the clip, which has
     no stable ordering of its own (start_sec ordering is derivable, not a
     count, and was the bug: the badge used to print a timestamp) */
  ordinal: number;
  selected: boolean;
  onSelect: () => void;
  /* resolved from the run's assignments by voice id, never stored on the clip */
  assignedVoiceName: string | null;
  /* null when the clip has no speaker label - there is nothing to bind a
     voice to, and keying the pair on a clip id would invent a speaker */
  onAssignSpeaker: ((voiceId: string) => void) | null;
  assigning: boolean;
  /* Whether THIS row's clip is the one currently sourcing the video's audio.
     The video is the only player now, so only one row can be "playing" at a
     time, and the row cannot know that on its own. */
  playing: boolean;
  /* Plays this clip's range (startSec..endSec) through the video. The row
     has no audio of its own to play - the video's own track is the sound. */
  onPlayClip: () => void;
  onPauseVideo: () => void;
}) {
  const updateClips = useUpdateClips(clip.videoId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(clip.text);
  /* No timing means no range to play - the button stays disabled rather
     than falling back to playing the whole video. */
  const hasTiming = clip.startSec != null && clip.endSec != null;

  useEffect(() => {
    if (!editing) setText(clip.text);
  }, [clip.text, editing]);
  const saveText = () => {
    setEditing(false);
    if (text.trim() && text !== clip.text)
      updateClips.mutate([{ clipId: clip.clipId, text: text.trim() }]);
  };
  const error = updateClips.isError ? updateClips.error.message : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "rounded-lg border bg-background/40 p-3",
        !clip.keep && "opacity-75",
        selected
          ? "border-primary/60 ring-1 ring-primary/40"
          : clip.keep
            ? "border-success/30"
            : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.7rem] text-muted-foreground/60">
          #{String(ordinal).padStart(2, "0")}
        </span>
        {clip.speakerLabel && onAssignSpeaker ? (
          <VoiceSpeakerCombobox
            speakerLabel={clip.speakerLabel}
            assignedVoiceName={assignedVoiceName}
            onSelect={(voiceId, voiceName) => {
              if (assignedVoiceName) {
                updateClips.mutate([
                  { clipId: clip.clipId, assignedVoice: voiceName },
                ]);
              } else {
                onAssignSpeaker(voiceId);
              }
            }}
          />
        ) : (
          <span
            className="rounded-md border border-dashed border-border px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
            title="Diarization gave this clip no speaker, so no voice can be bound to it."
          >
            no speaker
          </span>
        )}
        {assigning && (
          <span className="font-mono text-[0.65rem] text-muted-foreground">
            assigning…
          </span>
        )}
        {/* A rejected write must say so. Swallowing it is what made a failed
            assignment look like a dead control. */}
        {error && (
          <span
            role="alert"
            className="max-w-xs truncate text-[0.65rem] text-destructive"
            title={error}
          >
            {error}
          </span>
        )}
        {clip.flagged && (
          <span className="inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn/10 px-1.5 py-0.5 font-mono text-[0.65rem] uppercase text-warn">
            <AudioLines className="size-3" /> flagged
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={cn(
              "font-mono text-[0.65rem] uppercase",
              clip.keep ? "text-success" : "text-muted-foreground",
            )}
          >
            {clip.keep ? "kept" : "excluded"}
          </span>
          <button
            type="button"
            onClick={() => updateClips.mutate([{ clipId: clip.clipId, keep: true }])}
            aria-label="Keep clip"
            className={cn(
              "flex size-7 items-center justify-center rounded-md border",
              clip.keep
                ? "border-success/40 bg-success/15 text-success"
                : "border-border text-muted-foreground hover:text-success",
            )}
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => updateClips.mutate([{ clipId: clip.clipId, keep: false }])}
            aria-label="Exclude clip"
            className={cn(
              "flex size-7 items-center justify-center rounded-md border",
              !clip.keep
                ? "border-destructive/40 bg-destructive/15 text-destructive"
                : "border-border text-muted-foreground hover:text-destructive",
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-2">
        {editing ? (
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                saveText();
              }
              if (e.key === "Escape") {
                setText(clip.text);
                setEditing(false);
              }
            }}
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm leading-relaxed outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-sm leading-relaxed text-foreground/90 hover:bg-muted/40"
          >
            <span className="flex-1">{clip.text}</span>
            <Pencil className="mt-1 size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
          </button>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => (playing ? onPauseVideo() : onPlayClip())}
          disabled={!hasTiming}
          aria-label={playing ? "Pause clip" : "Play clip in video"}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5 translate-x-px" />
          )}
        </button>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {hasTiming
            ? `plays from video · ${formatDuration(clip.durationSec ?? 0)}`
            : "no timing data"}
        </span>
      </div>
    </div>
  );
}
