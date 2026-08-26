"use client";

import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Cpu,
  AlertCircle,
  ChevronDown,
  Pencil,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/features/chat/studio_provider";
import {
  useTrainVoice,
  useUnassignClips,
  useVoiceDetail,
} from "./api/use_voices";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clipAudioUrl } from "./api/query_keys";
import type { VoiceClip, VoiceDetail } from "./types";

/*
 * One voice, and every clip assigned to it.
 *
 * This is the unified view: the clips a voice holds come from any number of
 * videos, and they are the same rows COMPILING turns into training audio. So
 * what is listed here is exactly what the voice will train on - split into
 * the two groups that matter for training: Kept, which is the training set,
 * and Excluded, which is everything else assigned but not yet audio (an
 * explicit exclude and an unreviewed clip land in the same place here - this
 * panel is about what trains, not about review, which stays on the video tab).
 *
 * Which speaker diarization heard is not what a clip is grouped by, and not
 * what it is assigned by. It is shown beside a clip and nothing more.
 */
export function TrainingPanel({ voice }: { voice: VoiceDetail }) {
  const detail = useVoiceDetail(voice.id);
  const trainVoice = useTrainVoice();
  const unassignClips = useUnassignClips();
  const { setView, setSelectedVideoId, setPendingClipId } = useStudio();
  /* The list's copy until the detail lands, so the panel never blanks out
     between selecting a voice and its clips arriving. */
  const clips = detail.data?.clips ?? voice.clips;
  const keptClips = clips.filter((clip) => clip.keep === true);
  const excludedClips = clips.filter((clip) => clip.keep !== true);
  const trainable = keptClips.length > 0 && voice.phase !== "training";
  const videoCount = new Set(clips.map((clip) => clip.videoId)).size;
  /* Only one clip plays at a time - starting another pauses whichever one
     was already going, the same rule the video tab's row player follows. */
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  /* Kept is the training set, so it opens expanded; Excluded is reference
     material a reviewer checks less often, so it starts collapsed. */
  const [keptOpen, setKeptOpen] = useState(true);
  const [excludedOpen, setExcludedOpen] = useState(false);

  const onRemove = (clip: VoiceClip) =>
    unassignClips.mutate({
      voiceId: voice.id,
      videoId: clip.videoId,
      clipIds: [clip.clipId],
    });

  /* Jump to this clip on the Videos tab - the trim bar and the text editor
     both live there, next to the player a reviewer needs to hear it. */
  const onEdit = (clip: VoiceClip) => {
    setSelectedVideoId(clip.videoId);
    setPendingClipId(clip.clipId);
    setView("videos");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/15">
          <Cpu className="size-4 text-primary" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {voice.name}
          </h3>
          <p className="font-mono text-xs text-muted-foreground">
            {keptClips.length} of {clips.length} clip
            {clips.length === 1 ? "" : "s"} will train · {videoCount} video
            {videoCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            onClick={() => trainVoice.mutate(voice.id)}
            disabled={!trainable || trainVoice.isPending}
          >
            <Play />
            {voice.phase === "training" ? "Training…" : "Start training"}
          </Button>
        </div>
      </div>

      {trainVoice.isError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4" />
          {trainVoice.error.message}
        </div>
      )}
      {unassignClips.isError && (
        <p role="alert" className="text-xs text-destructive">
          {unassignClips.error.message}
        </p>
      )}

      {clips.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No clips yet. Pick this voice on a clip in a video, then train it.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ClipGroup
            title="Kept"
            clips={keptClips}
            open={keptOpen}
            onToggleOpen={() => setKeptOpen((value) => !value)}
            playingClipId={playingClipId}
            onPlayClip={setPlayingClipId}
            onRemove={onRemove}
            onEdit={onEdit}
          />
          <ClipGroup
            title="Excluded"
            clips={excludedClips}
            open={excludedOpen}
            onToggleOpen={() => setExcludedOpen((value) => !value)}
            playingClipId={playingClipId}
            onPlayClip={setPlayingClipId}
            onRemove={onRemove}
            onEdit={onEdit}
          />
        </div>
      )}
    </div>
  );
}

/* A collapsible section for one keep state. Clips come back ordered by video
   then start time, so first-seen order is already the order to render - no
   second sort that could disagree with the one the server applied. */
function ClipGroup({
  title,
  clips,
  open,
  onToggleOpen,
  playingClipId,
  onPlayClip,
  onRemove,
  onEdit,
}: {
  title: string;
  clips: VoiceClip[];
  open: boolean;
  onToggleOpen: () => void;
  playingClipId: string | null;
  onPlayClip: (clipId: string | null) => void;
  onRemove: (clip: VoiceClip) => void;
  onEdit: (clip: VoiceClip) => void;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
        />
        <span>{title}</span>
        <span className="font-mono opacity-60">{clips.length}</span>
      </button>
      {open &&
        (clips.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            No clips here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {clips.map((clip) => (
              <ClipLine
                key={`${clip.videoId}:${clip.clipId}`}
                clip={clip}
                playing={playingClipId === `${clip.videoId}:${clip.clipId}`}
                onPlayToggle={() =>
                  onPlayClip(
                    playingClipId === `${clip.videoId}:${clip.clipId}`
                      ? null
                      : `${clip.videoId}:${clip.clipId}`,
                  )
                }
                onEnded={() => onPlayClip(null)}
                onRemove={() => onRemove(clip)}
                onEdit={() => onEdit(clip)}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

/* Read-only, plus the one write that belongs here: taking a clip off this
   voice. Editing the text and trimming stay on the video tab, where the
   player is that a reviewer needs to hear what they are editing.

   Playback here is the clip's own audio slice, not the video - there is no
   video pane on this tab. clipAudioUrl re-slices full.wav from review.csv,
   so it always plays exactly what training would use. */
function ClipLine({
  clip,
  playing,
  onPlayToggle,
  onEnded,
  onRemove,
  onEdit,
}: {
  clip: VoiceClip;
  playing: boolean;
  onPlayToggle: () => void;
  onEnded: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) void audio.play();
    else audio.pause();
  }, [playing]);

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2",
        clip.keep !== true && "opacity-70",
      )}
    >
      <audio
        ref={audioRef}
        src={clipAudioUrl(clip.videoId, clip.clipId)}
        preload="none"
        onEnded={onEnded}
      />
      <button
        type="button"
        onClick={onPlayToggle}
        aria-label={playing ? "Pause clip" : "Play clip"}
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary"
      >
        {playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5 translate-x-px" />
        )}
      </button>
      <span
        className={cn(
          "shrink-0 font-mono text-[0.65rem] uppercase",
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
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
        {clip.text || <span className="italic opacity-60">no transcript</span>}
      </span>
      <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
        {clip.videoTitle ?? clip.videoId}
      </span>
      <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
        {formatDuration(clip.durationSec)}
      </span>
      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit this clip on the Videos tab"
        title="Edit on Videos tab"
        className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
      >
        <Pencil className="size-3" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this clip from the voice"
        className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}
