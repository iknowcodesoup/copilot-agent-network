"use client";

import { Play, Cpu, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrainVoice, useVoiceDetail } from "@/lib/voice_api";
import type { VoiceDetail } from "@/lib/types";

/*
 * One voice, and the speakers committed into it.
 *
 * The list already carries the contributions, so the card grid renders
 * without this. The detail request adds one thing the list leaves out: each
 * contribution's video title, which the factory owns and costs a call per
 * video to resolve.
 *
 * The sample and export controls that used to sit here are gone. Both called
 * provider stubs with empty bodies and then reported success, so the panel
 * said it had synthesized audio and started a download when it had done
 * neither.
 */
export function TrainingPanel({ voice }: { voice: VoiceDetail }) {
  const detail = useVoiceDetail(voice.id);
  const trainVoice = useTrainVoice();
  /* The list's copy until the detail lands, so the panel never blanks out
     between selecting a voice and its titles arriving. */
  const contributions = detail.data?.contributions ?? voice.contributions;
  const trainable = contributions.length > 0 && voice.phase !== "training";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/15">
          <Cpu className="size-4 text-primary" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {voice.name}
          </h3>
          <p className="font-mono text-xs text-muted-foreground">
            {contributions.length} speaker
            {contributions.length === 1 ? "" : "s"} assigned
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            onClick={() => trainVoice.mutate(voice.id)}
            disabled={!trainable || trainVoice.isPending}
          >
            <Play />
            {voice.phase === "training" ? "Training…" : "Start training"}
          </Button>
        </div>
      </div>

      {trainVoice.isError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4" />
          {trainVoice.error.message}
        </div>
      )}

      {contributions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing assigned yet. Pick this voice on a speaker in a video&apos;s
          clip list, then train it.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {contributions.map((contribution) => (
            <li
              key={contribution.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2"
            >
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[0.7rem] text-primary">
                {contribution.speakerLabel}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                {contribution.videoTitle ?? contribution.videoId ?? "unknown video"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
