"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceCard } from "./voice_card";
import { useVoiceList } from "./voice_api";

/*
 * The Voices view (Story 3.6): a flat card-per-voice grid, no pagination or
 * filtering (spec's Never list) - useVoiceList already asks for every voice
 * in one call.
 */
export function VoicesView() {
  const voices = useVoiceList();

  if (voices.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  if (voices.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not load voices: {(voices.error as Error).message}
        </AlertDescription>
      </Alert>
    );
  }

  const list = voices.data ?? [];

  if (list.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No voices yet. Assign a speaker to a voice during run review to create
        one.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((voice) => (
        <VoiceCard key={voice.id} voice={voice} />
      ))}
    </div>
  );
}
