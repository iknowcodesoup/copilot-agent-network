"use client"

import { Film, Scissors } from "lucide-react"
import { StatusPill } from "./status-pill"
import { cn } from "@/lib/utils"
import type { Video } from "@/lib/types"

function bars(seed: string, n: number): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    out.push(0.2 + (h % 1000) / 1000 * 0.8)
  }
  return out
}

export function VideoCard({
  video,
  selected,
  onSelect,
}: {
  video: Video
  selected: boolean
  onSelect: () => void
}) {
  const wave = bars(video.id, 28)
  const inProgress = video.state === "in-progress"

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all",
        selected
          ? "border-primary/60 ring-1 ring-primary/40"
          : "border-border hover:border-primary/30",
      )}
    >
      {/* audio-source thumbnail */}
      <div className="relative flex h-20 items-end gap-px overflow-hidden bg-gradient-to-b from-muted/40 to-background px-3 pb-3 pt-6">
        {wave.map((b, i) => (
          <span
            key={i}
            className={cn("flex-1 rounded-full", inProgress ? "bg-info/50" : "bg-muted-foreground/30")}
            style={{ height: `${b * 100}%` }}
          />
        ))}
        <Film className="absolute left-3 top-2 size-3.5 text-muted-foreground/60" />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-foreground">{video.title}</h3>
            <p className="truncate font-mono text-[0.7rem] text-muted-foreground">{video.channel}</p>
          </div>
          <StatusPill tone={video.state} pulse={inProgress} />
        </div>

        <div className="flex items-center justify-between font-mono text-[0.7rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Scissors className="size-3" />
            {video.clipIds.length} clips
          </span>
          {video.state !== "complete" && video.state !== "failed" && (
            <span className="uppercase tracking-wide text-info">{video.stage}</span>
          )}
        </div>

        {(inProgress || video.state === "failed") && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", video.state === "failed" ? "bg-destructive" : "bg-info")}
              style={{ width: `${video.progress}%` }}
            />
          </div>
        )}
      </div>
    </button>
  )
}
