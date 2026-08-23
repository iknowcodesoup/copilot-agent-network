"use client";

import { Film, MoreVertical, Play, Scissors, Trash2 } from "lucide-react";
import { StatusPill } from "./status_pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useDeleteVideo } from "./api/use_videos";
import type { VideoSummary, VoiceRunPhase } from "./types";
import { toneForPhase } from "./derive";

/*
 * Watch, Delete, and room for whatever comes next - one overflow menu rather
 * than a growing row of icon buttons on a card this narrow. Stops its own
 * clicks from reaching the card's onSelect, which sits underneath it.
 */
function VideoCardMenu({
  video,
  watchUrl,
  className,
}: {
  video: VideoSummary;
  watchUrl: string | null;
  className?: string;
}) {
  const deleteVideo = useDeleteVideo();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:border-primary/40 hover:text-foreground",
          className,
        )}
        title="More options"
      >
        <MoreVertical className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(event) => event.stopPropagation()}>
        {watchUrl && (
          <DropdownMenuLinkItem href={watchUrl} target="_blank" rel="noreferrer">
            <Play />
            Watch
          </DropdownMenuLinkItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          disabled={deleteVideo.isPending}
          onClick={() => {
            if (
              !window.confirm(
                `Delete "${video.title}"? This deletes it and any run using it. It cannot be undone.`,
              )
            )
              return;
            deleteVideo.mutate(video.videoId);
          }}
        >
          <Trash2 />
          {deleteVideo.isPending ? "Deleting…" : "Delete"}
        </DropdownMenuItem>
        {deleteVideo.isError && (
          <p className="max-w-48 px-2 py-1 text-[0.7rem] text-destructive">
            {(deleteVideo.error as Error).message}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* The video describes itself, counts included: they come from the factory,
   which recomputes them from review.csv. phase is null for a video no run has
   claimed - ingested for one character, and offered to the next.

   Compact list row, not a grid tile: this sits in VideoListPanel's w-80
   scrolling column, one video per row rather than a thumbnail-first card. */
export function VideoCard({
  video,
  phase,
  watchUrl,
  selected,
  onSelect,
}: {
  video: VideoSummary;
  phase: VoiceRunPhase | null;
  /* Where to watch this video. The factory knows it only once meta.json is
     written, so the run's own source_url stands in until then. */
  watchUrl: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = phase ? toneForPhase(phase) : null;
  return (
    /* A div, not a button: VideoCardMenu's Watch link nests inside, and an
       anchor inside a button is invalid markup that browsers resolve
       unpredictably. */
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
        "group flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 text-left transition-colors",
        selected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
          : "border-transparent hover:border-border hover:bg-muted/40",
      )}
    >
      <div className="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted/30">
        {video.thumbnailUrl ? (
          // a plain img, not next/image: next/image needs every remote host
          // declared up front, and YouTube serves thumbnails from several domains
          <img
            src={video.thumbnailUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <Film className="absolute inset-0 m-auto size-4 text-muted-foreground/60" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-foreground">
          {video.title}
        </h3>
        <div className="flex items-center gap-2 font-mono text-[0.7rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Scissors className="size-3" />
            {video.clipCount}
          </span>
          {tone ? (
            <StatusPill
              tone={tone}
              pulse={tone === "in-progress"}
              className="px-1.5 py-0"
            />
          ) : (
            <StatusPill tone="queued" label="not started" className="px-1.5 py-0" />
          )}
        </div>
      </div>
      <VideoCardMenu video={video} watchUrl={watchUrl} />
    </div>
  );
}
