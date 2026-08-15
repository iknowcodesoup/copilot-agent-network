"use client";

import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { PhaseBadge } from "./phase_badge";
import {
  useSpeakerBoard,
  useTrainVoice,
  useVoiceDetail,
  type VoiceContribution,
  type VoiceSummary,
} from "./voice_api";

/*
 * One contributing run's clips, fetched only once the "View clips" modal is
 * open (Story 3.6's design note: the per-run /speakers call happens once
 * per distinct run_id among the contributions, when the modal opens).
 * Filters the run's full speaker board down to the one speaker label this
 * contribution committed - the modal is read-only, so it needs nothing else
 * SpeakerBoard exposes.
 */
function ContributionClips({
  contribution,
  enabled,
}: {
  contribution: VoiceContribution;
  enabled: boolean;
}) {
  const board = useSpeakerBoard(contribution.runId, enabled);

  const title = contribution.videoTitle ?? contribution.videoId ?? "Unknown video";

  // Base UI keeps DialogPopup mounted through its own close animation, so
  // this renders even while the dialog is closed - nothing to show (or
  // fetch, per `enabled` above) until it is.
  if (!enabled) {
    return null;
  }

  if (board.isLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  if (board.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {title}: could not load clips ({(board.error as Error).message})
        </AlertDescription>
      </Alert>
    );
  }

  const group = board.data?.speakers.find(
    (speaker) => speaker.speakerLabel === contribution.speakerLabel,
  );
  const clips = group?.clips ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-medium">{title}</p>
      <p className="text-[0.625rem] text-muted-foreground">
        speaker {contribution.speakerLabel}
      </p>
      {clips.length === 0 ? (
        <p className="text-muted-foreground">No clips found for this speaker.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {clips.map((clip) => (
            <li
              key={clip.clipId}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1"
            >
              <span className="truncate">{clip.text || clip.clipId}</span>
              <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                {clip.keep ? "kept" : "rejected"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* View-clips modal body: one section per contribution. Two contributions
   from the same run (e.g. two speakers committed from one video) render as
   two sections rather than being merged into one - each is its own
   audit-trail row (VoiceContribution) with its own speaker label. */
function ViewClipsModal({
  contributions,
  open,
}: {
  contributions: VoiceContribution[];
  open: boolean;
}) {
  return (
    <DialogContent>
      <DialogTitle>Clips</DialogTitle>
      <div className="flex flex-col gap-4 overflow-y-auto">
        {contributions.map((contribution) => (
          <ContributionClips
            key={contribution.id}
            contribution={contribution}
            enabled={open}
          />
        ))}
      </div>
    </DialogContent>
  );
}

function ContributingVideosPopover({
  contributions,
}: {
  contributions: VoiceContribution[];
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="sm" variant="outline" />}
      >
        {contributions.length} video{contributions.length === 1 ? "" : "s"}
      </PopoverTrigger>
      <PopoverContent>
        <ul className="flex flex-col gap-1.5">
          {contributions.map((contribution) => (
            <li key={contribution.id} className="flex flex-col">
              <span className="truncate font-medium">
                {contribution.videoTitle ?? contribution.videoId ?? "Unknown video"}
              </span>
              <span className="text-[0.625rem] text-muted-foreground">
                speaker {contribution.speakerLabel}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/*
 * One voice's card (Story 3.6). Fetches its own detail rather than trusting
 * the list-row summary, because the contributing-videos popover and the
 * view-clips modal both need `contributions`, which only GET /voices/{id}
 * returns - see the design note in the spec.
 */
export function VoiceCard({ voice }: { voice: VoiceSummary }) {
  const detail = useVoiceDetail(voice.id);
  const trainVoice = useTrainVoice(voice.id);
  const [clipsOpen, setClipsOpen] = useState(false);

  const contributions = useMemo(
    () => detail.data?.contributions ?? [],
    [detail.data],
  );
  const phase = detail.data?.phase ?? voice.phase;
  const hasContributions = contributions.length > 0;

  // "Train now" only while awaiting_commit with at least one contribution
  // (spec's Boundaries); "Retrain" is always visible and calls the same
  // mutation from any phase.
  const showTrainNow = phase === "awaiting_commit" && hasContributions;
  const trainLabel = showTrainNow ? "Train now" : "Retrain";

  function train() {
    trainVoice.mutate();
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{voice.name}</h3>
          <p className="text-xs text-muted-foreground">
            {/* "clip count" here is the number of committed contributions,
                not raw audio clips - the actual clip list costs a per-run
                fetch this card does not make until the modal opens. */}
            {contributions.length} contribution
            {contributions.length === 1 ? "" : "s"}
          </p>
        </div>
        <PhaseBadge phase={phase} />
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {detail.isLoading && <Skeleton className="h-16 w-full" />}

        {detail.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              Could not load this voice: {(detail.error as Error).message}
            </AlertDescription>
          </Alert>
        )}

        {!detail.isLoading && !detail.isError && (
          <div className="flex flex-wrap items-center gap-2">
            {hasContributions ? (
              <ContributingVideosPopover contributions={contributions} />
            ) : (
              <span className="text-xs text-muted-foreground">
                No contributions yet
              </span>
            )}

            <Button
              size="sm"
              variant="outline"
              disabled={!hasContributions}
              onClick={() => setClipsOpen(true)}
            >
              View clips
            </Button>

            <Button
              size="sm"
              disabled={trainVoice.isPending}
              onClick={train}
            >
              {trainVoice.isPending ? "Starting..." : trainLabel}
            </Button>
          </div>
        )}

        {phase === "ready" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>Model size: —</span>
            <Button size="sm" variant="outline" disabled>
              Download model (not available yet)
            </Button>
          </div>
        )}

        {trainVoice.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {(trainVoice.error as Error).message}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      {/* ViewClipsModal is always in the tree, not gated on clipsOpen:
          DialogPopup tracks its own open/closed state internally and stays
          mounted through its exit animation, so a `clipsOpen &&` guard here
          would unmount it before that animation plays. ContributionClips's
          `enabled` prop (wired to clipsOpen below) is what actually stops
          the per-run fetch from firing before the dialog opens. */}
      <Dialog open={clipsOpen} onOpenChange={setClipsOpen}>
        <ViewClipsModal contributions={contributions} open={clipsOpen} />
      </Dialog>
    </Card>
  );
}
