"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { RunCard } from "../features/voices/run_card";
import { useVoiceRuns } from "../features/voices/voice_api";
import { VideoSearch } from "../features/voices/video_search";

/*
 * The Videos view: ingestion and assignment. The chat docks beside it and has
 * to stay mounted: a human-in-the-loop confirm cannot survive a navigation.
 *
 * Runs expand in place rather than opening a screen of their own. That keeps
 * the fetching honest - a shut card mounts none of its children, so it costs
 * nothing, and opening one is what asks for its clips and its training log.
 */
export default function VideosPage() {
  const runs = useVoiceRuns();
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [startingRun, setStartingRun] = useState(false);

  function openStartedRun(runId: string) {
    setStartingRun(false);
    setExpandedRunId(runId);
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Voice models</h1>
          <p className="text-xs text-muted-foreground">
            Turn a YouTube video into a fine-tuned text-to-speech model.
          </p>
        </div>
        <Button
          variant={startingRun ? "outline" : "secondary"}
          size="sm"
          onClick={() => setStartingRun((open) => !open)}
        >
          {startingRun ? "Cancel" : "New run"}
        </Button>
      </header>

      {startingRun && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <p className="text-xs text-muted-foreground">
              Find a video, name the character, and start. The pipeline
              downloads the audio, splits it by speaker, then waits for you to
              review the clips.
            </p>
            <VideoSearch onStarted={openStartedRun} />
          </CardContent>
        </Card>
      )}

      {runs.isLoading && <Skeleton className="h-40 w-full" />}

      {runs.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load runs: {(runs.error as Error).message}. Check that the
            voice factory is running and VOICE_FACTORY_URL is set.
          </AlertDescription>
        </Alert>
      )}

      {runs.data?.length === 0 && !startingRun && (
        <Card>
          <CardContent className="pt-6 text-center text-xs text-muted-foreground">
            No runs yet. Start one to build your first voice.
          </CardContent>
        </Card>
      )}

      <ul className="flex flex-col gap-2">
        {runs.data?.map((run) => (
          <li key={run.id}>
            <RunCard
              run={run}
              expanded={run.id === expandedRunId}
              onToggle={() =>
                setExpandedRunId((current) =>
                  current === run.id ? null : run.id,
                )
              }
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
