"use client";

import { useEffect, useState } from "react";
import { Check, X, Pencil, AudioLines } from "lucide-react";
import { VoiceSpeakerCombobox } from "./voice_speaker_combobox";
import { AudioPlayerBar } from "./audio_player_bar";
import { cn } from "@/lib/utils";
import type { StudioClip } from "./types";
import { clipAudioUrl } from "./api/query_keys";
import { useUpdateClips } from "./api/use_videos";

/*
 * Clip writes target clip.videoId directly, never a shared "active" video id.
 * That id used to be StudioProvider's own fallback guess (first run's video)
 * and could name a different video than the one this row is actually showing,
 * which silently sent edits to the wrong video's clips.
 *
 * Assignment is not a clip write. A voice is bound to a speaker label, so the
 * combobox reports the label and the voice id and the table records the pair.
 * The row used to write the voice's NAME onto the clip and drop the id, which
 * left the name in review.csv and no row joining the voice to anything.
 */
export function ClipRow({
  clip,
  ordinal,
  selected,
  onSelect,
  assignedVoiceName,
  onAssignSpeaker,
  assigning,
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
}) {
  const updateClips = useUpdateClips(clip.videoId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(clip.text);

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
            onSelect={(voiceId) => onAssignSpeaker(voiceId)}
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
      <div className="mt-2">
        <AudioPlayerBar
          src={clipAudioUrl(clip.videoId, clip.clipId)}
          peaks={[]}
          durationSec={clip.durationSec ?? 0}
          accent="var(--primary)"
          disabled={!clip.keep}
        />
      </div>
    </div>
  );
}
