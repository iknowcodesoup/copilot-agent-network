"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useSpeakerBoard, useRenameVideo } from "./api/use_videos";
import { RunActions } from "./run_actions";
import { StatusPill } from "./status_pill";
import { WatchLink } from "./watch_link";
import { YoutubeEmbedPlayer, type VideoCue } from "./youtube_embed_player";
import { ClipTrimBar } from "./clip_trim_bar";
import { ClipListPanel } from "./clip_list_panel";
import { toneForPhase } from "./derive";
import type { VideoSummary, VoiceRun } from "./types";

/* Click the title to correct it. The factory owns the name - it lives in
   meta.json beside the clips - so the rename is visible to every character
   that claims the same video, and nothing is stored on this side. */
function VideoTitle({ video }: { video: VideoSummary }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(video.title);
  const renameVideo = useRenameVideo(video.videoId);

  useEffect(() => {
    if (!editing) setTitle(video.title);
  }, [video.title, editing]);

  const save = () => {
    setEditing(false);
    const next = title.trim();
    if (next && next !== video.title) renameVideo.mutate(next);
  };

  if (editing)
    return (
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") {
            setTitle(video.title);
            setEditing(false);
          }
        }}
        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm font-semibold outline-none"
      />
    );

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-muted/40"
    >
      <h3 className="truncate text-sm font-semibold text-foreground">
        {video.title}
      </h3>
      <Pencil className="size-3 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground" />
    </button>
  );
}

/*
 * Right column of the two-pane videos view, for one video at a time:
 * detail header, a muted YouTube preview, the trim bar for whichever clip
 * is selected, and the scrollable clip list. selectedClipId lives here, not
 * in StudioProvider - the provider's own docstring warns against exactly
 * that, since setSelectedVideoId does not sync anything and a provider-held
 * clip id would survive a video change and point the trim bar at another
 * video's review.csv. VideosView keys this whole component on videoId, so
 * switching videos resets it structurally instead of through an effect that
 * can drift.
 */
export function ClipReviewPane({
  video,
  run,
}: {
  video: VideoSummary;
  run: VoiceRun | null;
}) {
  const board = useSpeakerBoard(video.videoId, true);
  const clips = useMemo(
    () => board.data?.speakers.flatMap((speaker) => speaker.clips) ?? [],
    [board.data],
  );
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const activeClipId = selectedClipId ?? clips[0]?.clipId ?? null;
  const selectedClip =
    clips.find((clip) => clip.clipId === activeClipId) ?? null;
  const watchUrl = video.url ?? run?.sourceUrl ?? null;

  /* Every instruction to the preview goes through this one cue, so the
     player has a single caller and no second source of truth about where the
     video should be. Selecting a clip only re-aims a preview that is already
     running; playing one starts it. */
  const [videoCue, setVideoCue] = useState<VideoCue | null>(null);
  const cueCount = useRef(0);
  const sendCue = (action: VideoCue["action"], startSec = 0) => {
    cueCount.current += 1;
    setVideoCue({ action, startSec, token: cueCount.current });
  };

  const selectClip = (clipId: string) => {
    setSelectedClipId(clipId);
    const clip = clips.find((candidate) => candidate.clipId === clipId);
    if (clip?.startSec != null) sendCue("seek", clip.startSec);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <VideoTitle video={video} />
        {run && (
          <StatusPill
            tone={toneForPhase(run.phase)}
            pulse={!["failed", "ready", "awaiting_review"].includes(run.phase)}
            label={run.phase.replaceAll("_", " ")}
          />
        )}
        {watchUrl && (
          <WatchLink url={watchUrl} label="Watch on YouTube" className="ml-auto" />
        )}
      </div>

      {run && (
        <div className="flex flex-col gap-2">
          {/* The failure text is the only record of why a run stopped, so
              it sits next to the button that acts on it. */}
          {run.phase === "failed" && run.error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[0.7rem] text-destructive">
              {run.error}
            </p>
          )}
          <RunActions run={run} />
        </div>
      )}

      <YoutubeEmbedPlayer video={video} cue={videoCue} />
      <ClipTrimBar videoId={video.videoId} clip={selectedClip} />
      <ClipListPanel
        videoId={video.videoId}
        runId={run?.id ?? null}
        selectedClipId={activeClipId}
        onSelectClip={selectClip}
        onPlayVideoAt={(videoSec) => sendCue("play", videoSec)}
        onPauseVideo={() => sendCue("pause")}
      />
    </div>
  );
}
