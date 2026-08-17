"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useStudio } from "@/components/studio-provider"

export function AddVideoBar() {
  const { addVideo, setSelectedVideoId, setView } = useStudio()
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = url.trim()
    if (!v || busy) return
    setBusy(true)
    const created = await addVideo(v)
    setBusy(false)
    if (created) {
      setUrl("")
      setView("videos")
      setSelectedVideoId(created.id)
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube URL to queue for processing…"
          className="h-9 w-full rounded-md border border-border bg-background px-3 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent"
        />
      </div>
      <Button type="submit" size="sm" disabled={busy || !url.trim()} className="h-9 shrink-0">
        {busy ? "Queuing…" : "Process video"}
      </Button>
    </form>
  )
}
