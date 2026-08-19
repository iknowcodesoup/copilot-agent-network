"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Radio, ChevronDown } from "lucide-react";
import { useStudio } from "./studio-provider";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";

export function LogMonitor() {
  const { logs, logFilter, setLogFilter, snapshot, connected } = useStudio();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const filtered = useMemo(
    () =>
      logFilter === "all" ? logs : logs.filter((log) => log.key === logFilter),
    [logs, logFilter],
  );
  useEffect(() => {
    if (autoScroll && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered, autoScroll]);
  const keyLabel = (key: string) =>
    snapshot.videos.find((video) => video.videoId === key)?.title ??
    snapshot.runs.find((run) => run.id === key)?.primaryCharacter ??
    key;
  return (
    <section className="flex h-full flex-col overflow-hidden bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Radio
          className={cn(
            "size-3.5",
            connected ? "text-success" : "text-muted-foreground",
          )}
        />
        <h2 className="font-mono text-xs font-medium uppercase tracking-wide text-foreground">
          Pipeline Log
        </h2>
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {connected ? "streaming" : "disconnected"}
        </span>
        <div className="ml-auto relative">
          <select
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            aria-label="Filter log source"
            className="appearance-none rounded-md border border-border bg-background py-1 pl-2 pr-6 font-mono text-[0.7rem] text-foreground"
          >
            <option value="all">all sources</option>
            {snapshot.videos.map((video) => (
              <option key={video.videoId} value={video.videoId}>
                {video.title}
              </option>
            ))}
            {snapshot.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.primaryCharacter}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
        </div>
      </header>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {filtered.length === 0 ? (
          <p className="text-muted-foreground/60">Waiting for events…</p>
        ) : (
          filtered.map((log) => (
            <div key={log.id} className="flex gap-2 py-px">
              <span className="shrink-0 text-muted-foreground/50">
                {formatClock(log.ts)}
              </span>
              {logFilter === "all" && (
                <span className="max-w-[10rem] shrink-0 truncate text-primary/70">
                  [{keyLabel(log.key)}]
                </span>
              )}
              <span className="min-w-0 break-words text-foreground/80">
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
