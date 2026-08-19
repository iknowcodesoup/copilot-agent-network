"use client"

import { useEffect, useState } from "react"
import { Mic, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStudio } from "./studio-provider"
import { VoiceCard } from "./voice-card"
import { TrainingPanel } from "./training-panel"

export function VoicesView() {
  const { snapshot, selectedVoiceId, setSelectedVoiceId, createVoice } = useStudio()
  const voices = snapshot.voices
  const [newName, setNewName] = useState("")

  useEffect(() => {
    if (!selectedVoiceId && voices.length > 0) setSelectedVoiceId(voices[0].id)
  }, [voices, selectedVoiceId, setSelectedVoiceId])

  const selected = voices.find((v) => v.id === selectedVoiceId) ?? null

  const onCreate = async () => {
    const name = newName.trim()
    if (!name) return
    const v = await createVoice(name)
    setNewName("")
    if (v) setSelectedVoiceId(v.id)
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Mic className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Voice Models</h2>
          <span className="font-mono text-xs text-muted-foreground">{voices.length} voices</span>
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) onCreate()
              }}
              placeholder="New voice name"
              className="w-40 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button size="sm" variant="outline" onClick={onCreate}>
              <Plus /> Add
            </Button>
          </div>
        </div>

        {voices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No voices yet. Assign a speaker label on a clip to collect one, or add one manually.
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
  )
}
