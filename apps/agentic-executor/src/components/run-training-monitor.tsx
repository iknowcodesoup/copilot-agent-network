"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useJobLog, useTrainingProgress, type VoiceRun } from "@/lib/voice_api"

/* main.py's MAX_EPOCHS. Only used to draw a bar, never to decide anything. */
const MAX_EPOCHS = 3000

/* How much of the tail of the training log to show. */
const LOG_TAIL_CHARACTERS = 4000

/*
 * A run's own training progress card: epoch/loss come off the run itself
 * (the factory reports them over its webhook, so voice_event_stream.tsx
 * already keeps them current). Only the checkpoint list and job log still
 * cost a request.
 */
export function RunTrainingMonitor({
  run,
  enabled,
}: {
  run: VoiceRun
  enabled: boolean
}) {
  const training = useTrainingProgress(run.id, enabled)
  const log = useJobLog(run.id, enabled)

  if (!enabled) {
    return null
  }
  if (training.isLoading) {
    return <Skeleton className="h-40 w-full" />
  }

  const checkpoints = training.data?.checkpoints ?? []
  const { currentEpoch, currentLoss } = run
  const percent =
    currentEpoch === null
      ? 0
      : Math.min((currentEpoch / MAX_EPOCHS) * 100, 100)

  return (
    <Card>
      <CardHeader>
        <h3 className="font-medium">Training</h3>
        <p className="text-xs text-muted-foreground">
          {currentEpoch === null
            ? "Waiting for the first epoch."
            : `Epoch ${currentEpoch} of ${MAX_EPOCHS}`}
          {currentLoss !== null && ` · loss ${currentLoss.toFixed(2)}`}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={percent} />

        <div>
          <p className="mb-1 text-xs font-medium">
            Checkpoints ({checkpoints.length})
          </p>
          {checkpoints.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None saved yet. main.py writes one every 20 epochs.
            </p>
          ) : (
            <ul className="max-h-40 overflow-y-auto text-xs tabular-nums">
              {checkpoints
                .slice()
                .reverse()
                .map((checkpoint) => (
                  <li
                    key={checkpoint.path}
                    className="flex justify-between border-b border-border/60 py-1 last:border-b-0"
                  >
                    <span className="truncate">{checkpoint.name}</span>
                    <span className="shrink-0 pl-3 text-muted-foreground">
                      epoch {checkpoint.epoch ?? "?"}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>

        {log.data?.content && (
          <div>
            <p className="mb-1 text-xs font-medium">Job log</p>
            <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug">
              {log.data.content.slice(-LOG_TAIL_CHARACTERS)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
