"use client"

import { useMemo, useState } from "react"
import { Play, Download, Cpu, GitCommitVertical, Waves, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStudio } from "./studio-provider"
import { AudioPlayerBar } from "./audio-player-bar"
import { StatusPill } from "./status-pill"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Voice } from "@/lib/types"

function samplePeaks(seed: string, n = 40): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    out.push(0.15 + (h % 1000) / 1000 * 0.85)
  }
  return out
}

export function TrainingPanel({ voice }: { voice: Voice }) {
  const { snapshot, startTraining, sampleVoice, exportVoice } = useStudio()
  const [error, setError] = useState<string | null>(null)
  const [sampleText, setSampleText] = useState("The quick brown fox jumps over the lazy dog.")
  const [sample, setSample] = useState<{ text: string; seed: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const runs = useMemo(
    () =>
      voice.runIds
        .map((r) => snapshot.runs.find((run) => run.id === r))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .sort((a, b) => b.startedAt - a.startedAt),
    [voice.runIds, snapshot.runs],
  )
  const activeRun = runs.find((r) => r.state === "running")
  const latestRun = runs[0]
  const checkpoints = useMemo(() => {
    const run = latestRun
    if (!run) return []
    return run.checkpointIds
      .map((c) => snapshot.checkpoints.find((cp) => cp.id === c))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .sort((a, b) => b.step - a.step)
  }, [latestRun, snapshot.checkpoints])

  const onTrain = async () => {
    setError(null)
    const res = await startTraining(voice.id)
    if (res?.error) setError(res.error)
  }

  const onSample = async () => {
    setBusy(true)
    setError(null)
    const res = await sampleVoice(voice.id, sampleText)
    setBusy(false)
    if (res && "error" in res && res.error) {
      setError(res.error)
      return
    }
    setSample({ text: sampleText, seed: `${voice.id}:${Date.now()}` })
  }

  const canSample = Boolean(voice.latestCheckpointId)

  return (
    <div className="flex flex-col gap-4">
      {/* header + train */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="flex size-9 items-center justify-center rounded-full"
          style={{ backgroundColor: `color-mix(in oklch, ${voice.color} 22%, transparent)` }}
        >
          <Cpu className="size-4" style={{ color: voice.color }} />
        </span>
        <div>
          <h3 className="text-base font-semibold text-foreground">{voice.name}</h3>
          <p className="font-mono text-xs text-muted-foreground">
            {voice.clipIds.length} clips assigned · {runs.length} run{runs.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!voice.latestCheckpointId} onClick={() => exportVoice(voice.id)}>
            <Download /> Export model
          </Button>
          <Button size="sm" onClick={onTrain} disabled={Boolean(activeRun) || voice.clipIds.length === 0}>
            <Play /> {activeRun ? "Training…" : "Start training"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* active run progress */}
      {activeRun && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <StatusPill tone="running" pulse />
            <span className="font-mono text-xs text-muted-foreground">
              step {activeRun.step}/{activeRun.totalSteps} · ETA ~{activeRun.etaHours}h
            </span>
            <span className="ml-auto font-mono text-sm font-medium text-primary">{activeRun.progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${activeRun.progress}%` }} />
          </div>
        </div>
      )}

      {/* sampling */}
      {canSample && (
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Waves className="size-3.5 text-primary" />
            <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Sample voice</h4>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="Text to synthesize…"
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button size="sm" onClick={onSample} disabled={busy || !sampleText.trim()}>
              <Play /> {busy ? "Synth…" : "Generate"}
            </Button>
          </div>
          {sample && (
            <div className="mt-3 rounded-md border border-border bg-card p-2.5">
              <p className="mb-1.5 text-xs text-muted-foreground">&ldquo;{sample.text}&rdquo;</p>
              <AudioPlayerBar peaks={samplePeaks(sample.seed)} durationSec={2 + sample.text.length / 20} seed={sample.seed} accent={voice.color} />
            </div>
          )}
        </div>
      )}

      {/* checkpoints */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <GitCommitVertical className="size-3.5 text-primary" />
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground">Checkpoints</h4>
          <span className="font-mono text-xs text-muted-foreground">{checkpoints.length}</span>
        </div>

        {checkpoints.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            {activeRun ? "Checkpoints will appear as training progresses…" : "No checkpoints yet — start a training run."}
          </p>
        ) : (
          <ol className="relative flex flex-col gap-1.5 border-l border-border pl-4">
            {checkpoints.map((cp, i) => (
              <li key={cp.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[1.32rem] top-1.5 size-2.5 rounded-full border-2 border-background",
                    i === 0 ? "bg-primary" : "bg-muted-foreground",
                  )}
                />
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                  <span className="font-mono text-xs font-medium text-foreground">step {cp.step}</span>
                  <span className="font-mono text-[0.7rem] text-muted-foreground">loss {cp.loss}</span>
                  {i === 0 && <StatusPill tone="complete" label="Latest" className="scale-90" />}
                  <span className="font-mono text-[0.7rem] text-muted-foreground/60">{formatRelative(cp.createdAt)}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Sample checkpoint at step ${cp.step}`}
                      onClick={() => setSample({ text: sampleText, seed: `${cp.id}:${Date.now()}` })}
                    >
                      <Play />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Download checkpoint at step ${cp.step}`}
                      onClick={() => exportVoice(voice.id, String(cp.step))}
                    >
                      <Download />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
