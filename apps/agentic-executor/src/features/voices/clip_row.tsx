"use client";

import { useEffect, useState } from "react";
import { Check, X, Pencil, AudioLines } from "lucide-react";
import { VoicePicker } from "./voice_picker";
import { cn } from "@/lib/utils";
import type { StudioClip } from "./types";
import { formatDuration } from "@/lib/format";
import { useUpdateClips } from "./api/use_videos";
import { AudioPlayerBar, type ClipSeekCue } from "./audio_player_bar";
import { clipAudioUrl } from "./api/query_keys";

/*
 * Clip writes target clip.videoId directly, never a shared "active" video id.
 * That id used to be StudioProvider's own fallback guess (first run's video)
 * and could name a different video than the one this row is actually showing,
 * which silently sent edits to the wrong video's clips.
 *
 * The picker always renders, even when diarization gave the clip no speaker
 * label - review is a human decision, and a clip the pipeline could not
 * attribute is exactly the clip a reviewer most needs to be able to name.
 *
 * A pick always does the same thing: it assigns clips to a voice, through the
 * one route that does that. Only how many clips it names changes, and the
 * panel decides that - the whole speaker group while the clip is still
 * unnamed, this row alone once it shows a voice, because a diarized group is
 * not always one person.
 */
export function ClipRow({
  clip,
  ordinal,
  selected,
  onSelect,
  onAssignVoice,
  assigning,
  playing,
  seekCue,
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
  /* Assign this clip - and, while it is still unnamed, its whole speaker
     group - to the picked voice. The panel owns that decision. */
  onAssignVoice: (voiceId: string) => void;
  assigning: boolean;
  /* Whether THIS row's clip is the one currently sourcing the video's audio.
     The video is the only player now, so only one row can be "playing" at a
     time, and the row cannot know that on its own. */
  playing: boolean;
  /* Where to move this row's WAV to, when the trim bar's cursor moved and
     this is the clip it moved within. Null for every other row. */
  seekCue?: ClipSeekCue | null;
  /* Plays this clip's range (startSec..endSec) through the video. The row
     has no audio of its own to play - the video's own track is the sound. */
  onPlayClip: () => void;
  onPauseVideo: () => void;
}) {
  const updateClips = useUpdateClips(clip.videoId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(clip.text);
  /* Raise this row above the ones below it while its voice dropdown is open.
     An excluded clip's row is dimmed, and a dimmed element forms its own
     stacking context - so the dropdown's own z-index cannot climb over the
     next row from inside this one. The row has to win the ordering itself. */
  const [pickerOpen, setPickerOpen] = useState(false);
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
        /* Dim an unkept clip's row without opacity: a sub-1 opacity forms a
           stacking context, which would trap this row's open voice dropdown
           under the row below it. Muted text and border read the same. */
        !clip.keep && "text-muted-foreground",
        /* Positioned and lifted only while the voice dropdown is open, so the
           list clears every row beneath it - a dimmed excluded row included. */
        pickerOpen && "relative z-30",
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
        <VoicePicker
          label={clip.speakerLabel ?? "this clip"}
          assignedVoiceName={clip.voiceName}
          onSelect={onAssignVoice}
          onOpenChange={setPickerOpen}
        />
        {/* <button
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
        </button> */}
        <AudioPlayerBar
          src={clipAudioUrl(clip.videoId, clip.clipId, {
            startSec: clip.startSec,
            endSec: clip.endSec,
          })}
          seekCue={seekCue}
          onPlayAt={clip.startSec == null ? undefined : () => onPlayClip()}
          onStop={clip.startSec == null ? undefined : onPauseVideo}
        />
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {hasTiming
            ? `${formatDuration(clip.durationSec ?? 0)}`
            : "no timing data"}
        </span>{" "}
        {!clip.speakerLabel && (
          <span
            className="rounded-md border border-dashed border-border px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
            title="Diarization found no dominant speaker for this clip. Assigning a voice here pins this clip alone - there is no group to join."
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
            <AudioLines className="size-3" /> flagged / noisy
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={cn(
              "font-mono text-[0.65rem] uppercase",
              clip.keep === true && "text-success",
              clip.keep === false && "text-destructive",
              clip.keep === null && "text-muted-foreground",
            )}
          >
            {clip.keep === true
              ? "kept"
              : clip.keep === false
                ? "excluded"
                : "unreviewed"}
          </span>
          <button
            type="button"
            onClick={() =>
              /* A second click on an already-kept clip undoes the decision
                 instead of doing nothing - the toggle's third state. */
              updateClips.mutate([
                {
                  clipId: clip.clipId,
                  keep: clip.keep === true ? "none" : "kept",
                },
              ])
            }
            aria-label={
              clip.keep === true ? "Clear keep decision" : "Keep clip"
            }
            className={cn(
              "flex size-7 items-center justify-center rounded-md border",
              clip.keep === true
                ? "border-success/40 bg-success/15 text-success"
                : "border-border text-muted-foreground hover:text-success",
            )}
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              updateClips.mutate([
                {
                  clipId: clip.clipId,
                  keep: clip.keep === false ? "none" : "excluded",
                },
              ])
            }
            aria-label={
              clip.keep === false ? "Clear exclude decision" : "Exclude clip"
            }
            className={cn(
              "flex size-7 items-center justify-center rounded-md border",
              clip.keep === false
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
              /* The row itself is role="button" and treats a bare space as
                 "activate" (see the wrapper's onKeyDown above) - without this,
                 every space typed here would bubble up and get swallowed
                 before it reached the textarea's value. */
              e.stopPropagation();
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
    </div>
  );
}
