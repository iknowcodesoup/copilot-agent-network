"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeleteRun, useRetryRun } from "./api/use_voice_runs";
import type { VoiceRun } from "./types";

/*
 * Retry and delete for one run. Shared by the review pane's own run and by
 * the orphaned-runs list, which is the only reason this is its own file
 * rather than living beside one of them.
 *
 * Retry only appears on a failed run, because that is the only phase the API
 * accepts it in - it puts the run back in failed_from_phase. Delete drops the
 * run row and cancels its job; the factory keeps the downloaded audio and
 * clips, so the same video can be claimed again without a second download.
 */
export function RunActions({ run }: { run: VoiceRun }) {
  const retryRun = useRetryRun(run.id);
  const deleteRun = useDeleteRun();
  const busy = retryRun.isPending || deleteRun.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {run.phase === "failed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => retryRun.mutate()}
        >
          <RotateCcw />
          {retryRun.isPending ? "Retrying…" : "Retry"}
        </Button>
      )}
      {(retryRun.isError || deleteRun.isError) && (
        <span className="text-xs text-destructive">
          {((retryRun.error ?? deleteRun.error) as Error).message}
        </span>
      )}
    </div>
  );
}
