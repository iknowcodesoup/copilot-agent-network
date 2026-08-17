"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { useStartRun, useVideoSearch, type VideoResult } from "@/lib/voice_api"

function formatDuration(seconds: number | null): string {
  if (!seconds) {
    return "--"
  }
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`
}

/*
 * `onStarted` hands the new run's id back to the dashboard, which opens that
 * card. There is one page and no routing, so starting a run must not navigate.
 */
export function VideoSearch({
  onStarted,
}: {
  onStarted?: (runId: string) => void
}) {
  const [queryDraft, setQueryDraft] = useState("")
  const [query, setQuery] = useState("")
  const [character, setCharacter] = useState("")
  const [diarize, setDiarize] = useState(true)
  const [selected, setSelected] = useState<VideoResult | null>(null)

  const search = useVideoSearch(query)
  const startRun = useStartRun()

  function start() {
    if (!selected || !character.trim()) {
      return
    }
    startRun.mutate(
      {
        primaryCharacter: character.trim(),
        sourceUrl: selected.url,
        diarize,
      },
      {
        onSuccess: (run) => {
          setSelected(null)
          onStarted?.(run.id)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setQuery(queryDraft)
        }}
      >
        <div className="min-w-64 flex-1">
          <Label htmlFor="voice-search-query">Search YouTube</Label>
          <Input
            id="voice-search-query"
            value={queryDraft}
            placeholder="star trek voyager janeway"
            onChange={(event) => setQueryDraft(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={!queryDraft.trim()}>
          Search
        </Button>
      </form>

      {search.isLoading && <Skeleton className="h-48 w-full" />}
      {search.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Search failed: {(search.error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {search.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {search.data.videos.map((video) => {
            const isSelected = selected?.videoId === video.videoId
            return (
              <button
                key={video.videoId}
                type="button"
                onClick={() => setSelected(isSelected ? null : video)}
                className={cn(
                  "overflow-hidden rounded-lg border border-border text-left transition-colors",
                  isSelected
                    ? "border-primary ring-2 ring-primary/30"
                    : "hover:border-foreground/30",
                )}
              >
                {video.thumbnailUrl && (
                  // a plain img, not next/image: next/image needs every remote
                  // host declared up front, and YouTube serves thumbnails from
                  // several domains
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    className="aspect-video w-full object-cover"
                  />
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-xs font-medium">
                    {video.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {video.channel ?? "unknown"} ·{" "}
                    {formatDuration(video.durationSec)}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-4 pt-4">
            <div className="min-w-48 flex-1">
              <Label htmlFor="voice-character">Character</Label>
              <Input
                id="voice-character"
                value={character}
                placeholder="janeway"
                onChange={(event) => setCharacter(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Lower case, no spaces. Any speaker you do not reassign lands
                here.
              </p>
            </div>

            <label className="flex items-center gap-2 pb-1 text-xs">
              <Checkbox
                checked={diarize}
                onCheckedChange={(checked) => setDiarize(checked === true)}
              />
              Split by speaker
            </label>

            <Button
              disabled={!character.trim() || startRun.isPending}
              onClick={start}
            >
              {startRun.isPending ? "Starting..." : "Start run"}
            </Button>
          </CardContent>
        </Card>
      )}

      {startRun.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {(startRun.error as Error).message}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
