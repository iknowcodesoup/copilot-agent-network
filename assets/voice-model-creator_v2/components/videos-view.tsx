"use client"

import { useEffect } from "react"
import { Film } from "lucide-react"
import { useStudio } from "./studio-provider"
import { VideoCard } from "./video-card"
import { ClipTable } from "./clip-table"
import { StatusPill } from "./status-pill"

export function VideosView() {
  const { snapshot, selectedVideoId, setSelectedVideoId } = useStudio()
  const videos = snapshot.videos

  // auto-select the first video once data arrives
  useEffect(() => {
    if (!selectedVideoId && videos.length > 0) setSelectedVideoId(videos[0].id)
  }, [videos, selectedVideoId, setSelectedVideoId])

  const selected = videos.find((v) => v.id === selectedVideoId) ?? null

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Film className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Processing Queue</h2>
          <span className="font-mono text-xs text-muted-foreground">{videos.length} videos</span>
        </div>

        {videos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No videos yet. Paste a YouTube URL above to start processing.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                selected={v.id === selectedVideoId}
                onSelect={() => setSelectedVideoId(v.id)}
              />
            ))}
          </div>
        )}
      </section>

      {selected && (
        <section className="rounded-xl border border-border bg-card/50 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{selected.title}</h3>
            <StatusPill tone={selected.state} pulse={selected.state === "in-progress"} />
            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto truncate font-mono text-[0.7rem] text-muted-foreground hover:text-primary"
            >
              {selected.url}
            </a>
          </div>
          <ClipTable videoId={selected.id} />
        </section>
      )}
    </div>
  )
}
