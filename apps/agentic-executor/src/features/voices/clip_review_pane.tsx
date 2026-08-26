"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useSpeakerBoard, useRenameVideo } from "./api/use_videos";
import { useStudio } from "@/features/chat/studio_provider";
import { RunActions } from "./run_actions";
import { YoutubeEmbedPlayer, type VideoCue } from "./youtube_embed_player";
import { ClipTrimBar } from "./clip_trim_bar";
import { ClipListPanel } from "./clip_list_panel";
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
  /* A jump landed here from another tab (the Voice tab's edit button) names
     one clip to select. Consumed once and cleared immediately, so a later
     manual video switch never re-applies a stale target. */
  const { pendingClipId, setPendingClipId } = useStudio();
  useEffect(() => {
    if (!pendingClipId) return;
    setSelectedClipId(pendingClipId);
    setPendingClipId(null);
  }, [pendingClipId, setPendingClipId]);
  const activeClipId = selectedClipId ?? clips[0]?.clipId ?? null;
  const selectedClip =
    clips.find((clip) => clip.clipId === activeClipId) ?? null;
  const watchUrl = video.url ?? run?.sourceUrl ?? null;

  /* Every instruction to the player goes through this one cue, so it has a
     single caller and no second source of truth about where the video
     should be. Selecting a clip only re-aims a player that is already
     running; playing one starts it. The video's own audio track is the
     sound now, so a "play" cue also carries the clip's endSec - there is no
     separate clip WAV whose own duration used to mark the stop. */
  const [videoCue, setVideoCue] = useState<VideoCue | null>(null);
  const cueCount = useRef(0);
  const sendCue = (
    action: VideoCue["action"],
    startSec = 0,
    endSec?: number,
    resetSec?: number,
  ) => {
    cueCount.current += 1;
    setVideoCue({ action, startSec, endSec, resetSec, token: cueCount.current });
  };

  /* Which clip is currently sourcing the video's audio, if any - cleared
     whenever the player reports it stopped, whether that came from the
     pause button, the clip's own end, or the operator scrubbing the video
     directly. */
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);

  /* The video's live position, and which clip it belongs to. Unlike
     playingClipId, this is never cleared on pause - a paused position (or
     one just reset to the selection's start) still names the clip whose
     trim bar should show it. A clip whose own bounds have never been played
     falls back to showing its own startSec instead (see ClipTrimBar). */
  const [currentTimeSec, setCurrentTimeSec] = useState<number | null>(null);
  const [timelineClipId, setTimelineClipId] = useState<string | null>(null);

  /* The preview is aimed at wherever the active clip now starts, not at
     wherever it started when it was picked. Selecting a clip moves that
     start, and so does trimming one - the trim bar's save lands in the clip
     cache, which is what re-renders this - so watching the number covers
     both and the trim bar needs no channel of its own. sendCue is left out
     of the dependencies deliberately: it is rebuilt every render and would
     re-aim the preview on each one. */
  const activeStartSec = selectedClip?.startSec ?? null;
  useEffect(() => {
    if (activeStartSec != null) sendCue("seek", activeStartSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStartSec]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
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

      <YoutubeEmbedPlayer
        video={video}
        cue={videoCue}
        onPause={() => setPlayingClipId(null)}
        onTimeUpdate={setCurrentTimeSec}
      />
      <ClipTrimBar
        videoId={video.videoId}
        clip={selectedClip}
        isPlaying={activeClipId != null && playingClipId === activeClipId}
        currentTimeSec={
          activeClipId != null && timelineClipId === activeClipId
            ? currentTimeSec
            : null
        }
        onPlayFrom={(startSec) => {
          if (
            !selectedClip?.clipId ||
            selectedClip.startSec == null ||
            selectedClip.endSec == null
          )
            return;
          setPlayingClipId(selectedClip.clipId);
          setTimelineClipId(selectedClip.clipId);
          sendCue("play", startSec, selectedClip.endSec, selectedClip.startSec);
        }}
        onPauseVideo={() => {
          setPlayingClipId(null);
          sendCue("pause");
        }}
      />
      <ClipListPanel
        videoId={video.videoId}
        runId={run?.id ?? null}
        selectedClipId={activeClipId}
        onSelectClip={setSelectedClipId}
        playingClipId={playingClipId}
        onPlayClip={(clip) => {
          if (clip.startSec == null || clip.endSec == null) return;
          /* Resume from wherever this clip was left - paused mid-clip, or
             scrubbed - rather than always restarting at startSec. Only valid
             when the tracked position still belongs to this same clip; a
             different clip's row falls back to its own start. */
          const resumeSec =
            timelineClipId === clip.clipId && currentTimeSec != null
              ? currentTimeSec
              : clip.startSec;
          setPlayingClipId(clip.clipId);
          setTimelineClipId(clip.clipId);
          sendCue("play", resumeSec, clip.endSec, clip.startSec);
        }}
        onPauseVideo={() => {
          setPlayingClipId(null);
          sendCue("pause");
        }}
      />
    </div>
  );
}
