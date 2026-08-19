"use client";

import { useState } from "react";
import { Play, Download, Cpu, Waves, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "./studio-provider";
import { AudioPlayerBar } from "./audio-player-bar";
import type { VoiceDetail } from "@/lib/types";

export function TrainingPanel({ voice }: { voice: VoiceDetail }) {
  const { trainingForVoice, startTraining, sampleVoice, exportVoice } =
    useStudio();
  const training = trainingForVoice(voice);
  const [error, setError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState(
    "The quick brown fox jumps over the lazy dog.",
  );
  const [sample, setSample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onTrain = async () => {
    setError(null);
    const result = await startTraining(voice.id);
    if (result?.error) setError(result.error);
  };
  const onSample = async () => {
    setBusy(true);
    setError(null);
    const result = await sampleVoice(voice.id, sampleText);
    setBusy(false);
    if (result?.error) setError(result.error);
    else setSample(result?.text ?? sampleText);
  };
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
            {voice.contributions.length} clips assigned
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!voice.checkpointPath}
            onClick={() => exportVoice(voice.id)}
          >
            <Download /> Export model
          </Button>
          <Button
            size="sm"
            onClick={onTrain}
            disabled={
              voice.phase === "training" || voice.contributions.length === 0
            }
          >
            <Play />{" "}
            {voice.phase === "training" ? "Training…" : "Start training"}
          </Button>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {error}
        </div>
      )}
      {voice.checkpointPath && (
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Waves className="size-3.5 text-primary" />
            <h4 className="text-xs font-semibold uppercase tracking-wide">
              Sample voice
            </h4>
          </div>
          <div className="flex gap-2">
            <input
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            />
            <Button
              size="sm"
              onClick={onSample}
              disabled={busy || !sampleText.trim()}
            >
              <Play />
              {busy ? "Synth…" : "Generate"}
            </Button>
          </div>
          {sample && (
            <div className="mt-3 rounded-md border border-border bg-card p-2.5">
              <p className="text-xs text-muted-foreground">
                &ldquo;{sample}&rdquo;
              </p>
              <AudioPlayerBar
                peaks={[]}
                durationSec={2}
                seed={`${voice.id}:${sample}`}
                accent="var(--primary)"
              />
            </div>
          )}
        </div>
      )}
      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        {training?.checkpoints.length ?? 0} checkpoints available.
      </div>
    </div>
  );
}
