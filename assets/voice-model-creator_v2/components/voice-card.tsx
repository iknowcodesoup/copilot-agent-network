"use client"

import { Mic, Scissors } from "lucide-react"
import { useStudio } from "./studio-provider"
import { StatusPill } from "./status-pill"
import { cn } from "@/lib/utils"
import type { Voice } from "@/lib/types"

export function VoiceCard({
  voice,
  selected,
  onSelect,
}: {
  voice: Voice
  selected: boolean
  onSelect: () => void
}) {
  const { snapshot } = useStudio()
  const runs = voice.runIds.map((r) => snapshot.runs.find((run) => run.id === r)).filter(Boolean)
  const activeRun = runs.find((r) => r?.state === "running")
  const latestCkpt = voice.latestCheckpointId
    ? snapshot.checkpoints.find((c) => c.id === voice.latestCheckpointId)
    : undefined

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left transition-all",
        selected ? "border-primary/60 ring-1 ring-primary/40" : "border-border hover:border-primary/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `color-mix(in oklch, ${voice.color} 22%, transparent)` }}
        >
          <Mic className="size-3.5" style={{ color: voice.color }} />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{voice.name}</h3>
        {activeRun ? (
          <StatusPill tone="running" pulse />
        ) : latestCkpt ? (
          <StatusPill tone="complete" label="Trained" />
        ) : (
          <StatusPill tone="neutral" label="Untrained" />
        )}
      </div>

      <div className="flex items-center gap-3 font-mono text-[0.7rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Scissors className="size-3" />
          {voice.clipIds.length} clips
        </span>
        {latestCkpt && <span>loss {latestCkpt.loss}</span>}
        {activeRun && <span className="text-primary">{activeRun.progress}%</span>}
      </div>

      {activeRun && (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${activeRun.progress}%` }} />
        </div>
      )}
    </button>
  )
}
