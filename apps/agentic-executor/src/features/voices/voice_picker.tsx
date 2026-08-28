"use client"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"
import { useCreateVoice, useVoices } from "./api/use_voices"
import { VoiceApiError } from "./api/voice_client"
import type { VoiceSummary } from "./types"

/*
 * Search-or-create Voice picker for one clip row (FR25). Never free-types a
 * value into the assignment - every selection is a real Voice id, picked from
 * search results or created inline through POST /voices. The id is the whole
 * answer: the caller assigns by id, and the name is only what is shown.
 */
export function VoicePicker({
  label,
  assignedVoiceName,
  onSelect,
  onOpenChange,
}: {
  /* what this picker is naming, for the accessible label - the speaker
     diarization heard, or the clip itself when it heard none */
  label: string
  /* the currently assigned voice's name, or null when nothing is assigned */
  assignedVoiceName: string | null
  onSelect: (voiceId: string) => void
  /* The row this picker sits in needs to lift itself above the rows below
     while the dropdown is open, or an excluded clip's dimmed row - which
     forms its own stacking context - paints over the list. The picker's own
     z-index cannot reach across sibling rows; only the row can. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }

  const voices = useVoices(query, open)
  const createVoice = useCreateVoice()

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  const trimmedQuery = query.trim()
  const results = voices.data ?? []
  const hasExactMatch = results.some(
    (voice) => voice.name.toLowerCase() === trimmedQuery.toLowerCase(),
  )
  const canCreate = trimmedQuery.length > 0 && !hasExactMatch

  function selectVoice(voice: VoiceSummary) {
    onSelect(voice.id)
    setQuery("")
    setOpen(false)
  }

  function createAndSelect() {
    createVoice.mutate(trimmedQuery, {
      onSuccess: (created) => {
        onSelect(created.id)
        setQuery("")
        setOpen(false)
      },
      onError: (error) => {
        // Someone else created the same name first (FR22). Refetch and let
        // the operator pick the now-existing match instead of erroring out.
        if (error instanceof VoiceApiError && error.status === 409) {
          voices.refetch()
          return
        }
      },
    })
  }

  return (
    <div ref={containerRef} className="relative w-48">
      <Input
        aria-label={`Voice for ${label}`}
        placeholder={assignedVoiceName ?? "search or create a voice"}
        className="h-7"
        value={open ? query : (assignedVoiceName ?? "")}
        onFocus={() => {
          setQuery("")
          setOpen(true)
        }}
        onChange={(event) => setQuery(event.target.value)}
      />

      {assignedVoiceName && !open && (
        <Badge
          variant="secondary"
          className="absolute -top-2 right-0 translate-y-0"
        >
          assigned
        </Badge>
      )}

      {open && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full min-w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs shadow-md">
          {voices.isLoading && (
            <li className="px-2 py-1.5 text-muted-foreground">Searching...</li>
          )}

          {!voices.isLoading && results.length === 0 && !canCreate && (
            <li className="px-2 py-1.5 text-muted-foreground">
              Type a name to search or create a voice.
            </li>
          )}

          {results.map((voice) => (
            <li key={voice.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={() => selectVoice(voice)}
              >
                <span className="truncate">{voice.name}</span>
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                  {voice.phase}
                </span>
              </button>
            </li>
          ))}

          {canCreate && (
            <li>
              <button
                type="button"
                disabled={createVoice.isPending}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                onClick={createAndSelect}
              >
                {createVoice.isPending
                  ? "Creating..."
                  : `Create new voice "${trimmedQuery}"`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
