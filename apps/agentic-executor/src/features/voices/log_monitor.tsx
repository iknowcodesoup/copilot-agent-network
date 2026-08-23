"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Radio, ChevronDown } from "lucide-react";
import { useRunForVideo, useStudio } from "@/features/chat/studio_provider";
import { useJobLog, useVoiceRuns } from "./api/use_voice_runs";
import { useVideos } from "./api/use_videos";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LogLine } from "./types";

export function LogMonitor() {
  const { logFilter, setLogFilter, selectedVideoId, selectedRunId } =
    useStudio();
  const videos = useVideos();
  const runs = useVoiceRuns();
  const runForVideo = useRunForVideo(selectedVideoId);
  const runId = runForVideo?.id ?? selectedRunId ?? "";
  const log = useJobLog(runId, Boolean(runId));
  const connected = !runs.isError;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const videoList = useMemo(() => videos.data ?? [], [videos.data]);
  const runList = useMemo(() => runs.data ?? [], [runs.data]);
  /* The log route serves one plain text body, so the lines are cut here. The
     offset is part of each id, which keeps keys stable as the file grows. */
  const logs = useMemo<LogLine[]>(() => {
    const offset = log.data?.offset ?? 0;
    return (log.data?.content ?? "")
      .split(/\r?\n/)
      .map((message) => message.trim())
      .filter((message) => message.length > 0)
      .map((message, index) => ({
        id: `${runId}-${offset}-${index}`,
        key: runId,
        ts: Date.now(),
        message,
      }));
  }, [log.data, runId]);

  const filtered = useMemo(
    () =>
      logFilter === "all" ? logs : logs.filter((line) => line.key === logFilter),
    [logs, logFilter],
  );
  useEffect(() => {
    if (autoScroll && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered, autoScroll]);
  const keyLabel = (key: string) =>
    videoList.find((video) => video.videoId === key)?.title ??
    runList.find((run) => run.id === key)?.primaryCharacter ??
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
            {videoList.map((video) => (
              <option key={video.videoId} value={video.videoId}>
                {video.title}
              </option>
            ))}
            {runList.map((run) => (
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
