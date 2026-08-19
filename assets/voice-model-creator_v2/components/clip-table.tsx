"use client"

import { useMemo, useState } from "react"
import { useStudio } from "./studio-provider"
import { ClipRow } from "./clip-row"
import { cn } from "@/lib/utils"
import type { ClipStatus } from "@/lib/types"

type Filter = "all" | ClipStatus | "noisy"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "noisy", label: "Noisy" },
]

export function ClipTable({ videoId }: { videoId: string }) {
  const { clipsForVideo } = useStudio()
  const [filter, setFilter] = useState<Filter>("all")
  const clips = clipsForVideo(videoId)

  const counts = useMemo(() => {
    return {
      all: clips.length,
      pending: clips.filter((c) => c.status === "pending").length,
      approved: clips.filter((c) => c.status === "approved").length,
      rejected: clips.filter((c) => c.status === "rejected").length,
      noisy: clips.filter((c) => c.noisy).length,
    }
  }, [clips])

  const shown = clips.filter((c) => {
    if (filter === "all") return true
    if (filter === "noisy") return c.noisy
    return c.status === filter
  })

  if (clips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No clips yet — they appear once diarization completes.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-[0.7rem] transition-colors",
              filter === f.key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            <span className="ml-1.5 opacity-60">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {shown.map((clip) => (
          <ClipRow key={clip.id} clip={clip} />
        ))}
        {shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground/60">
            No clips match this filter.
          </p>
        )}
      </div>
    </div>
  )
}
