"use client"

import { useEffect, useState } from "react"
import { Check, X, AudioLines, Pencil } from "lucide-react"
import { useStudio } from "./studio-provider"
import { SpeakerLabelEditor } from "./speaker-label-editor"
import { AudioPlayerBar } from "./audio-player-bar"
import { cn } from "@/lib/utils"
import type { Clip } from "@/lib/types"

export function ClipRow({ clip }: { clip: Clip }) {
  const { updateClip, snapshot } = useStudio()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(clip.sttText)

  useEffect(() => {
    if (!editing) setText(clip.sttText)
  }, [clip.sttText, editing])

  const assignedVoice = snapshot.voices.find((v) => v.id === clip.assignedVoiceId)
  const accent = assignedVoice?.color ?? "var(--primary)"

  const saveText = () => {
    setEditing(false)
    if (text.trim() && text !== clip.sttText) updateClip(clip.id, { sttText: text.trim() })
  }

  const approve = () => !clip.noisy && updateClip(clip.id, { status: "approved" })
  const reject = () => updateClip(clip.id, { status: "rejected" })

  return (
    <div
      className={cn(
        "rounded-lg border bg-background/40 p-3 transition-colors",
        clip.status === "approved" && "border-success/30",
        clip.status === "rejected" && "border-destructive/20 opacity-75",
        clip.status === "pending" && "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.7rem] text-muted-foreground/60">
          #{clip.index.toString().padStart(2, "0")}
        </span>
        <SpeakerLabelEditor clip={clip} />

        {clip.noisy && (
          <span className="inline-flex items-center gap-1 rounded-md border border-warn/30 bg-warn/10 px-1.5 py-0.5 font-mono text-[0.65rem] uppercase text-warn">
            <AudioLines className="size-3" /> noisy
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={cn(
              "font-mono text-[0.65rem] uppercase tracking-wide",
              clip.status === "approved" && "text-success",
              clip.status === "rejected" && "text-destructive",
              clip.status === "pending" && "text-muted-foreground",
            )}
          >
            {clip.status}
          </span>
          <button
            type="button"
            onClick={approve}
            disabled={clip.noisy}
            aria-label="Approve clip"
            title={clip.noisy ? "Noisy clips cannot be approved" : "Approve"}
            className={cn(
              "flex size-7 items-center justify-center rounded-md border transition-colors",
              clip.status === "approved"
                ? "border-success/40 bg-success/15 text-success"
                : "border-border text-muted-foreground hover:border-success/40 hover:text-success",
              clip.noisy && "cursor-not-allowed opacity-40 hover:border-border hover:text-muted-foreground",
            )}
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={reject}
            aria-label="Reject clip"
            title="Reject"
            className={cn(
              "flex size-7 items-center justify-center rounded-md border transition-colors",
              clip.status === "rejected"
                ? "border-destructive/40 bg-destructive/15 text-destructive"
                : "border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive",
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* STT */}
      <div className="mt-2">
        {editing ? (
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveText}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                saveText()
              }
              if (e.key === "Escape") {
                setText(clip.sttText)
                setEditing(false)
              }
            }}
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-sm leading-relaxed text-foreground/90 hover:bg-muted/40"
          >
            <span className="flex-1">{clip.sttText}</span>
            <Pencil className="mt-1 size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Audio */}
      <div className="mt-2">
        <AudioPlayerBar
          peaks={clip.peaks}
          durationSec={clip.durationSec}
          seed={clip.id}
          accent={accent}
          disabled={clip.status === "rejected" && clip.noisy}
        />
      </div>
    </div>
  )
}
