"use client";

import { useEffect, useMemo, useState } from "react";
import { Mic, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "@/features/chat/studio_provider";
import { useCreateVoice, useVoiceList } from "./voice_api";
import { VoiceCard } from "./voice_card";
import { TrainingPanel } from "./training_panel";

export function VoicesView() {
  const { selectedVoiceId, setSelectedVoiceId } = useStudio();
  const voiceList = useVoiceList();
  const createVoice = useCreateVoice();
  const voices = useMemo(() => voiceList.data ?? [], [voiceList.data]);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!selectedVoiceId && voices.length > 0) setSelectedVoiceId(voices[0].id);
  }, [voices, selectedVoiceId, setSelectedVoiceId]);

  const selected = voices.find((voice) => voice.id === selectedVoiceId) ?? null;

  /* Selecting the new voice by the id the POST returns. The list refetches on
     its own - waiting for it here just to read back an id we already have is
     what the removed wrapper did, with a hand-built stand-in object. */
  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await createVoice.mutateAsync(name);
    setNewName("");
    setSelectedVoiceId(created.id);
  };

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Mic className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            Voice Models
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {voices.length} voices
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) onCreate();
              }}
              placeholder="New voice name"
              className="w-40 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={onCreate}
              disabled={createVoice.isPending}
            >
              <Plus /> Add
            </Button>
          </div>
          {createVoice.isError && (
            <span role="alert" className="w-full text-xs text-destructive">
              {createVoice.error.message}
            </span>
          )}
        </div>

        {voices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No voices yet. Assign a speaker label on a clip to collect one, or
              add one manually.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {voices.map((v) => (
              <VoiceCard
                key={v.id}
                voice={v}
                selected={v.id === selectedVoiceId}
                onSelect={() => setSelectedVoiceId(v.id)}
              />
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section className="rounded-xl border border-border bg-card/50 p-4">
          <TrainingPanel voice={selected} />
        </section>
      )}
    </div>
  );
}
