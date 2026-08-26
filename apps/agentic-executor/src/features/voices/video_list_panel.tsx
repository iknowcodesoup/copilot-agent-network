"use client";

import { ChevronLeft, ChevronRight, Film } from "lucide-react";
import { VideoCard } from "./video_card";
import { RunActions } from "./run_actions";
import { StatusPill } from "./status_pill";
import { WatchLink } from "./watch_link";
import { toneForPhase } from "./derive";
import type { VideoSummary, VoiceRun } from "./types";

/*
 * Left column of the two-pane videos view: every ingested video, plus any
 * run whose video the factory no longer lists (nothing left to review, but
 * still worth seeing and deleting).
 */
export function VideoListPanel({
  videos,
  runs,
  selectedVideoId,
  onSelectVideo,
  collapsed,
  onToggleCollapsed,
}: {
  videos: VideoSummary[];
  runs: VoiceRun[];
  selectedVideoId: string | null;
  onSelectVideo: (videoId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const orphanedRuns = runs.filter(
    (run) =>
      !run.videoId || !videos.some((video) => video.videoId === run.videoId),
  );

  if (collapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center border-r border-border py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Show videos"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-border min-h-0">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <div>
          <div className="mb-2 flex items-center gap-2 px-1">
            <Film className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Videos</h2>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {videos.length}
            </span>
            <button
              type="button"
              onClick={onToggleCollapsed}
              title="Hide videos"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
          {videos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-xs text-muted-foreground">
                No videos yet. Paste a YouTube URL above to start processing.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {videos.map((video) => {
                const run = runs.find((r) => r.videoId === video.videoId) ?? null;
                return (
                  <VideoCard
                    key={video.videoId}
                    video={video}
                    phase={run?.phase ?? null}
                    watchUrl={video.url ?? run?.sourceUrl ?? null}
                    selected={video.videoId === selectedVideoId}
                    onSelect={() => onSelectVideo(video.videoId)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {orphanedRuns.length > 0 && (
          <div className="rounded-lg border border-dashed border-border p-3">
            <h3 className="mb-2 text-xs font-semibold text-foreground">
              Runs without a video
            </h3>
            <ul className="flex flex-col gap-2.5">
              {orphanedRuns.map((run) => (
                <li key={run.id} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-foreground">
                      {run.primaryCharacter}
                    </span>
                    <StatusPill
                      tone={toneForPhase(run.phase)}
                      pulse={false}
                      label={run.phase.replaceAll("_", " ")}
                      className="px-1.5 py-0"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <WatchLink url={run.sourceUrl} />
                    <RunActions run={run} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
