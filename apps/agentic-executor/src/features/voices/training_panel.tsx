"use client";

import { Play, Cpu, AlertCircle, Clapperboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useTrainVoice,
  useUnassignClips,
  useVoiceDetail,
} from "./api/use_voices";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VoiceClip, VoiceDetail } from "./types";

/*
 * One voice, and every clip assigned to it.
 *
 * This is the unified view: the clips a voice holds come from any number of
 * videos, and they are the same rows COMPILING turns into training audio. So
 * what is listed here is exactly what the voice will train on - grouped by
 * video only to say where each clip came from.
 *
 * Which speaker diarization heard is not what a clip is grouped by, and not
 * what it is assigned by. It is shown beside a clip and nothing more.
 */
export function TrainingPanel({ voice }: { voice: VoiceDetail }) {
  const detail = useVoiceDetail(voice.id);
  const trainVoice = useTrainVoice();
  const unassignClips = useUnassignClips();
  /* The list's copy until the detail lands, so the panel never blanks out
     between selecting a voice and its clips arriving. */
  const clips = detail.data?.clips ?? voice.clips;
  /* Only kept clips train. An excluded or undecided one is still assigned,
     and still listed - it is just not audio yet, which is what the reviewer
     needs to see before starting a run. */
  const keptCount = clips.filter((clip) => clip.keep === true).length;
  const trainable = keptCount > 0 && voice.phase !== "training";
  const byVideo = groupByVideo(clips);

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
            {keptCount} of {clips.length} clip
            {clips.length === 1 ? "" : "s"} will train · {byVideo.length} video
            {byVideo.length === 1 ? "" : "s"}
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
        <div className="flex flex-col gap-4">
          {byVideo.map(({ videoId, videoTitle, videoClips }) => (
            <section key={videoId} className="flex flex-col gap-1.5">
              <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Clapperboard className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">
                  {videoTitle ?? videoId}
                </span>
                <span className="shrink-0 font-mono opacity-60">
                  {videoClips.length}
                </span>
              </h4>
              <ul className="flex flex-col gap-1.5">
                {videoClips.map((clip) => (
                  <ClipLine
                    key={`${clip.videoId}:${clip.clipId}`}
                    clip={clip}
                    onRemove={() =>
                      unassignClips.mutate({
                        voiceId: voice.id,
                        videoId: clip.videoId,
                        clipIds: [clip.clipId],
                      })
                    }
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/* Read-only, plus the one write that belongs here: taking a clip off this
   voice. Editing the text and trimming stay on the video tab, where the
   player is that a reviewer needs to hear what they are editing. */
function ClipLine({
  clip,
  onRemove,
}: {
  clip: VoiceClip;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2",
        clip.keep !== true && "opacity-70",
      )}
    >
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
        {formatDuration(clip.durationSec)}
      </span>
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

interface VideoGroup {
  videoId: string;
  videoTitle: string | null;
  videoClips: VoiceClip[];
}

/* Clips come back ordered by video then start time, so first-seen order is
   already the order to render - no second sort that could disagree with the
   one the server applied. */
function groupByVideo(clips: VoiceClip[]): VideoGroup[] {
  const groups: VideoGroup[] = [];
  for (const clip of clips) {
    const existing = groups.find((group) => group.videoId === clip.videoId);
    if (existing) {
      existing.videoClips.push(clip);
      continue;
    }
    groups.push({
      videoId: clip.videoId,
      videoTitle: clip.videoTitle,
      videoClips: [clip],
    });
  }
  return groups;
}
