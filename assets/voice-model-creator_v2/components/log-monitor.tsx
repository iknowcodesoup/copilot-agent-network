"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Radio, ChevronDown } from "lucide-react"
import { useStudio } from "./studio-provider"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { LogLevel } from "@/lib/types"

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  success: "text-success",
  warn: "text-warn",
  error: "text-destructive",
}

const LEVEL_MARK: Record<LogLevel, string> = {
  info: "·",
  success: "✓",
  warn: "!",
  error: "✕",
}

export function LogMonitor() {
  const { logs, logFilter, setLogFilter, snapshot, connected } = useStudio()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const filtered = useMemo(() => {
    if (logFilter === "all") return logs
    return logs.filter((l) => l.key === logFilter)
  }, [logs, logFilter])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered, autoScroll])

  const keyLabel = (key: string) => {
    const v = snapshot.videos.find((v) => v.id === key)
    if (v) return v.title
    const run = snapshot.runs.find((r) => r.id === key)
    if (run) {
      const voice = snapshot.voices.find((vc) => vc.id === run.voiceId)
      return `train · ${voice?.name ?? "voice"}`
    }
    return key
  }

  return (
    <section className="flex h-full flex-col overflow-hidden bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Radio className={cn("size-3.5", connected ? "text-success" : "text-muted-foreground")} />
        <h2 className="font-mono text-xs font-medium tracking-wide uppercase text-foreground">
          Pipeline Log
        </h2>
        <span className="ml-1 font-mono text-[0.7rem] text-muted-foreground">
          {connected ? "streaming" : "disconnected"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <select
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              className="appearance-none rounded-md border border-border bg-background py-1 pr-6 pl-2 font-mono text-[0.7rem] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Filter log source"
            >
              <option value="all">all sources</option>
              {snapshot.videos.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
              {snapshot.runs.map((r) => {
                const voice = snapshot.voices.find((vc) => vc.id === r.voiceId)
                return (
                  <option key={r.id} value={r.id}>
                    train · {voice?.name ?? r.id}
                  </option>
                )
              })}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          setAutoScroll(atBottom)
        }}
        className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {filtered.length === 0 ? (
          <p className="text-muted-foreground/60">Waiting for events…</p>
        ) : (
          filtered.map((l) => (
            <div key={l.id} className="flex gap-2 py-px">
              <span className="shrink-0 text-muted-foreground/50">{formatClock(l.ts)}</span>
              <span className={cn("shrink-0 w-3 text-center", LEVEL_COLOR[l.level])}>
                {LEVEL_MARK[l.level]}
              </span>
              {logFilter === "all" && (
                <span className="shrink-0 max-w-[10rem] truncate text-primary/70" title={keyLabel(l.key)}>
                  [{keyLabel(l.key)}]
                </span>
              )}
              <span className="shrink-0 text-accent-foreground/60">{l.stage}</span>
              <span className={cn("min-w-0 break-words", LEVEL_COLOR[l.level])}>{l.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
