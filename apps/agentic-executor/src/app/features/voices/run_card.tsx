"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PhaseBadge } from "./phase_badge";
import { SpeakerBoard } from "./speaker_board";
import { TrainingMonitor } from "./training_monitor";
import { resumeStepLabel, useJobLog, useRetryRun, type VoiceRun } from "./voice_api";

/* Fallback shown until the job's log has produced its first line. */
const waitingMessages: Record<string, string> = {
  downloading:
    "Downloading the audio and transcribing it. This takes a few minutes.",
  diarizing: "Splitting the audio by speaker.",
  committing: "Building the dataset. Copying clips, resampling, preprocessing.",
  exporting: "Writing the ONNX model.",
};

/*
 * Every job's stdout and stderr land in the same raw log - library import
 * chatter and deprecation-warning source lines included. Only the tool doing
 * the work prints anything progress-shaped: yt-dlp's "[download]  42.1% of
 * ...", ffmpeg's "time=00:00:12", faster-whisper's "[ 12.34 -  15.67] text",
 * or Lightning's "Epoch 3: 73%|...loss=32.1". Scanning backward for one of
 * those, instead of trusting the last line blindly, is what keeps a stray
 * warning from ever showing up here.
 */
const PROGRESS_LINE =
  /\[download]|\bepoch \d+\b|loss=|eta \d|time=\d|^\[\s*\d+\.\d+\s*-\s*\d+\.\d+\s*]|\d+(\.\d+)?%/i;

/* How much of the tail of the job log to scan for a progress line. */
const LOG_SCAN_CHARACTERS = 4000;

function latestLogLine(content: string | undefined): string | null {
  if (!content) {
    return null;
  }
  const lines = content
    .slice(-LOG_SCAN_CHARACTERS)
    .trimEnd()
    .split("\n")
    .map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index] && PROGRESS_LINE.test(lines[index])) {
      return lines[index];
    }
  }
  return null;
}

/*
 * One run, collapsed to a row until it is opened.
 *
 * The run itself never needs fetching: every event on the voice stream carries
 * the complete run, so the dashboard's list already holds current state and
 * passes it down. Only the three sub-resources cost a request - the speaker
 * board, the training progress, and the job log - and each of those lives in a
 * child that is simply not mounted while the card is shut. So collapsing a card
 * is what stops its polling, and no hook here needs an `enabled` flag.
 */
export function RunCard({
  run,
  expanded,
  onToggle,
}: {
  run: VoiceRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const retry = useRetryRun(run.id);
  const awaitingReview = run.phase === "awaiting_review";
  const waitingMessage = waitingMessages[run.phase];
  const log = useJobLog(run.id, expanded && Boolean(waitingMessage));
  const waiting = latestLogLine(log.data?.content) ?? waitingMessage;

  return (
    <Card className={cn(expanded && "border-foreground/30")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{run.primaryCharacter}</p>
          <p className="truncate text-xs text-muted-foreground">
            {run.videoTitle ?? run.sourceUrl}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {run.clipCount > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {run.approvedCount}/{run.clipCount} clips
            </span>
          )}
          <PhaseBadge phase={run.phase} />
          <span
            aria-hidden
            className={cn(
              "text-xs text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          >
            &#9654;
          </span>
        </div>
      </button>

      {expanded && (
        <CardContent className="flex flex-col gap-6 border-t border-border pt-6">
          {run.error && (
            <Alert variant={run.phase === "failed" ? "destructive" : undefined}>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{run.error}</span>
                {run.phase === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    {retry.isPending
                      ? "Retrying"
                      : `Retry from ${resumeStepLabel(run)}`}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* an error while the run is still going means the factory is not
              answering yet, not that the run is lost */}
          {run.phase !== "failed" && run.errorCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Waiting for the voice factory to answer. Tried {run.errorCount}{" "}
              times so far. The run carries on once it comes back.
            </p>
          )}

          {waiting && (
            <p className="text-xs text-muted-foreground">{waiting}</p>
          )}

          {run.phase === "ready" && (
            <Alert>
              <AlertDescription>
                The model is exported. Copy{" "}
                <code>output/{run.primaryCharacter}.onnx</code> and its{" "}
                <code>.onnx.json</code> into <code>apps/janewav/src/models/</code>,
                then add a MODELS entry.
              </AlertDescription>
            </Alert>
          )}

          <TrainingMonitor
            run={run}
            enabled={run.phase === "training" || run.phase === "ready"}
          />

          {/* the review board is the point of opening a run, so keep it after
              approval too - it is the record of what went into the dataset */}
          {(awaitingReview || run.clipCount > 0) && (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="font-medium">Speakers</h2>
                <p className="text-xs text-muted-foreground">
                  {awaitingReview
                    ? "Play the clips, reject the bad ones, and name a character for each speaker you want."
                    : "Review is closed for this run."}
                </p>
              </div>
              <SpeakerBoard
                runId={run.id}
                primaryCharacter={run.primaryCharacter}
                awaitingReview={awaitingReview}
              />
            </section>
          )}
        </CardContent>
      )}
    </Card>
  );
}
