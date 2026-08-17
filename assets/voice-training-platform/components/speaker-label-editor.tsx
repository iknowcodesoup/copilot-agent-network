"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Plus, Tag, Mic } from "lucide-react"
import { useStudio } from "./studio-provider"
import { cn } from "@/lib/utils"
import type { Clip } from "@/lib/types"

const RAW_LABELS = ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02", "SPEAKER_03"]

export function SpeakerLabelEditor({ clip }: { clip: Clip }) {
  const { snapshot, updateClip, assignClipVoice } = useStudio()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const assignedVoice = snapshot.voices.find((v) => v.id === clip.assignedVoiceId)
  const isRaw = RAW_LABELS.includes(clip.speakerLabel)

  const pickRaw = (label: string) => {
    updateClip(clip.id, { speakerLabel: label })
    setOpen(false)
  }
  const pickVoice = (name: string) => {
    assignClipVoice(clip.id, name)
    setOpen(false)
  }
  const createNew = () => {
    const name = newName.trim()
    if (!name) return
    assignClipVoice(clip.id, name)
    setNewName("")
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex max-w-[9.5rem] items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs transition-colors",
          assignedVoice
            ? "border-transparent text-foreground"
            : isRaw
              ? "border-border bg-muted/50 text-muted-foreground hover:border-primary/40"
              : "border-border bg-muted/50 text-foreground hover:border-primary/40",
        )}
        style={
          assignedVoice
            ? { backgroundColor: `color-mix(in oklch, ${assignedVoice.color} 18%, transparent)` }
            : undefined
        }
      >
        {assignedVoice ? (
          <Mic className="size-3 shrink-0" style={{ color: assignedVoice.color }} />
        ) : (
          <Tag className="size-3 shrink-0" />
        )}
        <span className="truncate">{clip.speakerLabel}</span>
        <ChevronDown className="ml-auto size-3 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl shadow-black/40">
          <p className="px-2 py-1 font-mono text-[0.65rem] uppercase tracking-wide text-muted-foreground/70">
            Diarization label
          </p>
          <div className="flex flex-wrap gap-1 px-1 pb-1.5">
            {RAW_LABELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => pickRaw(l)}
                className={cn(
                  "rounded-md border border-border px-1.5 py-0.5 font-mono text-[0.7rem] hover:border-primary/40 hover:text-primary",
                  clip.speakerLabel === l && "border-primary/50 text-primary",
                )}
              >
                {l}
              </button>
            ))}
          </div>

          <div className="my-1 h-px bg-border" />
          <p className="px-2 py-1 font-mono text-[0.65rem] uppercase tracking-wide text-muted-foreground/70">
            Assign to voice
          </p>
          <div className="max-h-32 overflow-y-auto scrollbar-thin">
            {snapshot.voices.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground/60">No voices yet</p>
            )}
            {snapshot.voices.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => pickVoice(v.name)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: v.color }} />
                <span className="truncate text-foreground">{v.name}</span>
                <span className="ml-auto font-mono text-[0.65rem] text-muted-foreground">
                  {v.clipIds.length}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-1 flex items-center gap-1 border-t border-border p-1 pt-1.5">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) createNew()
              }}
              placeholder="New voice name"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <button
              type="button"
              onClick={createNew}
              aria-label="Create voice"
              className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/80"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
