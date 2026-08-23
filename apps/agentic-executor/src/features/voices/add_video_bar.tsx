"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/features/chat/studio_provider";
import { useStartRun } from "./api/use_voice_runs";

export function AddVideoBar() {
  const { setView } = useStudio();
  const startRun = useStartRun();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sourceUrl = url.trim();
    if (!sourceUrl || busy) return;
    setBusy(true);
    try {
      /* POST /runs answers with the new run. The old wrapper looked the id up
         in the runs list instead, which has not refetched yet, so it read as
         a failure and the field never cleared. */
      await startRun.mutateAsync({
        primaryCharacter: "default",
        sourceUrl,
        diarize: true,
        numSpeakers: null,
      });
      setUrl("");
      setView("videos");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube URL to queue for processing…"
          className="h-9 w-full rounded-md border border-border bg-background px-3 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent"
        />
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={busy || !url.trim()}
        className="h-9 shrink-0"
      >
        {busy ? "Queuing…" : "Process video"}
      </Button>
      {startRun.isError && (
        <span role="alert" className="text-xs text-destructive">
          {startRun.error.message}
        </span>
      )}
    </form>
  );
}
