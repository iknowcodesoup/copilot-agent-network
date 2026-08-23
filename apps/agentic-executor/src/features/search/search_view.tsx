"use client";

import { useState } from "react";
import { Film, Play, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { useStartRun } from "@/features/voices/api/use_voice_runs";
import { useVideoSearch } from "@/features/voices/api/use_videos";
import type { VideoResult } from "@/features/voices/types";
import { WatchLink } from "@/features/voices/watch_link";
import { useStudio } from "@/features/chat/studio_provider";

/* Every speaker the operator does not reassign lands here. The review screen is
   where a speaker gets its real name, so naming one up front is not required. */
const DEFAULT_CHARACTER = "default";

/* One search result, in a grid - unlike VideoCard, which moved to a compact
   list row for the two-pane videos view. Double-click starts it, and so does
   the button - one click only selects, so the grid stays browsable. */
function SearchResultCard({
  video,
  selected,
  pending,
  onSelect,
  onStart,
}: {
  video: VideoResult;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
  onStart: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onStart}
      onKeyDown={(event) => {
        if (event.key === "Enter") onStart();
      }}
      className={cn(
        "group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left transition-all",
        selected
          ? "border-primary/60 ring-1 ring-primary/40"
          : "border-border hover:border-primary/30",
      )}
    >
      <div className="relative flex h-20 items-end overflow-hidden bg-muted/30 px-3 pb-3 pt-6">
        {video.thumbnailUrl && (
          // a plain img, not next/image: next/image needs every remote host
          // declared up front, and YouTube serves thumbnails from several domains
          <img
            src={video.thumbnailUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <Film className="absolute left-3 top-2 size-3.5 text-muted-foreground/60" />
        <div className="absolute inset-0 bg-background/35" />
        <WatchLink url={video.url} className="absolute right-2 top-2" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-medium text-foreground">
            {video.title}
          </h3>
          <p className="truncate font-mono text-[0.7rem] text-muted-foreground">
            {video.channel ?? "Unknown channel"}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            {video.durationSec != null ? formatDuration(video.durationSec) : "--"}
          </span>
          <Button
            size="sm"
            variant={selected ? "default" : "outline"}
            disabled={pending}
            onClick={(event) => {
              event.stopPropagation();
              onStart();
            }}
          >
            {pending ? "Starting…" : "Start run"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* Search, pick, and start a run - the alternative to pasting a URL straight
   into AddVideoBar. Starting a run hands off to the Videos tab, same as
   AddVideoBar does, so there is one place a run is ever watched from. */
export function SearchView() {
  const { setView, setSelectedRunId } = useStudio();
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [character, setCharacter] = useState("");
  const [selected, setSelected] = useState<VideoResult | null>(null);
  const [startingVideoId, setStartingVideoId] = useState<string | null>(null);

  const search = useVideoSearch(query);
  const startRun = useStartRun();

  async function start(video: VideoResult) {
    if (startingVideoId) return;
    setStartingVideoId(video.videoId);
    startRun.mutate(
      {
        primaryCharacter: character.trim() || DEFAULT_CHARACTER,
        sourceUrl: video.url,
        diarize: true,
      },
      {
        onSuccess: (run) => {
          setStartingVideoId(null);
          setSelected(null);
          setCharacter("");
          setSelectedRunId(run.id);
          setView("videos");
        },
        onError: () => setStartingVideoId(null),
      },
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchIcon className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            Search YouTube
          </h2>
          {search.data && (
            <span className="font-mono text-xs text-muted-foreground">
              {search.data.videos.length} results
            </span>
          )}
          <form
            className="ml-auto flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(queryDraft);
            }}
          >
            <input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="star trek voyager janeway"
              className="w-64 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!queryDraft.trim()}
            >
              Search
            </Button>
          </form>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2">
          <Play className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Start run downloads the video's audio and begins processing.
          </p>
          <label
            htmlFor="search-character"
            className="ml-auto text-xs text-muted-foreground"
          >
            Character
          </label>
          <input
            id="search-character"
            value={character}
            onChange={(event) => setCharacter(event.target.value)}
            placeholder={DEFAULT_CHARACTER}
            className="w-40 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        {search.isLoading && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Searching YouTube…
          </div>
        )}

        {search.isError && (
          <div className="rounded-xl border border-destructive/30 p-10 text-center text-sm text-destructive">
            Search failed: {(search.error as Error).message}
          </div>
        )}

        {!query && !search.isLoading && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Search YouTube to find a video, then start a run against it.
            </p>
          </div>
        )}

        {search.data && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {search.data.videos.map((video) => (
              <SearchResultCard
                key={video.videoId}
                video={video}
                selected={selected?.videoId === video.videoId}
                pending={startingVideoId === video.videoId}
                onSelect={() =>
                  setSelected((current) =>
                    current?.videoId === video.videoId ? null : video,
                  )
                }
                onStart={() => start(video)}
              />
            ))}
          </div>
        )}

        {startRun.isError && (
          <p className="mt-3 text-xs text-destructive">
            {(startRun.error as Error).message}
          </p>
        )}
      </section>
    </div>
  );
}
