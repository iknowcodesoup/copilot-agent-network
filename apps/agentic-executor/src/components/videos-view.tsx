"use client";

import { useMemo } from "react";
import { Film } from "lucide-react";
import { useVoiceRuns } from "@/lib/voice_api";
import type { VideoResult } from "@/lib/types";
import { VideoCard } from "./video-card";
import { ClipTable } from "./clip-table";
import { StatusPill } from "./status-pill";
import { useStudio } from "./studio-provider";

export function VideosView() {
  const runs = useVoiceRuns();
  const { selectedRunId, setSelectedRunId } = useStudio();
  const runList = runs.data ?? [];
  const selectedRun =
    runList.find((run) => run.id === selectedRunId) ?? runList[0] ?? null;

  const videos = useMemo(
    () =>
      runList.map(
        (run): VideoResult => ({
          videoId: run.videoId ?? run.id,
          title: run.videoTitle ?? "Untitled video",
          durationSec: null,
          channel: null,
          thumbnailUrl: null,
          url: run.sourceUrl,
        }),
      ),
    [runList],
  );

  if (runs.isLoading)
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Loading processing queue…
      </div>
    );
  if (runs.isError)
    return (
      <div className="rounded-xl border border-destructive/30 p-10 text-center text-sm text-destructive">
        Unable to load voice runs from voice_api.
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Film className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            Processing Queue
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {runList.length} videos
          </span>
        </div>
        {runList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No videos yet. Paste a YouTube URL above to start processing.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {runList.map((run, index) => (
              <VideoCard
                key={run.id}
                video={videos[index]}
                phase={run.phase}
                clipCount={run.clipCount}
                selected={run.id === selectedRun?.id}
                onSelect={() => setSelectedRunId(run.id)}
              />
            ))}
          </div>
        )}
      </section>
      {selectedRun && (
        <section className="rounded-xl border border-border bg-card/50 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {selectedRun.videoTitle ?? "Untitled video"}
            </h3>
            <StatusPill
              tone={
                selectedRun.phase === "failed"
                  ? "failed"
                  : selectedRun.phase === "ready"
                    ? "complete"
                    : selectedRun.phase === "awaiting_review"
                      ? "queued"
                      : "in-progress"
              }
              pulse={
                !["failed", "ready", "awaiting_review"].includes(
                  selectedRun.phase,
                )
              }
              label={selectedRun.phase.replaceAll("_", " ")}
            />
            <a
              href={selectedRun.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto truncate font-mono text-[0.7rem] text-muted-foreground hover:text-primary"
            >
              {selectedRun.sourceUrl}
            </a>
          </div>
          <ClipTable runId={selectedRun.id} />
        </section>
      )}
    </div>
  );
}
