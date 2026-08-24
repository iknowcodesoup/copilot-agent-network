"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StudioProvider, useStudio } from "@/features/chat/studio_provider";
import { CopilotProvider } from "@/features/chat/copilot_provider";
import { CopilotStudioTools } from "@/features/chat/copilot_tools";
import { useVideos } from "@/features/voices/api/use_videos";
import { useVoiceList } from "@/features/voices/api/use_voices";
import { useVoiceRuns } from "@/features/voices/api/use_voice_runs";
import { VoiceLiveState } from "@/features/voices/voice_event_stream";
import { VideosView } from "@/features/voices/videos_view";
import { VoicesView } from "@/features/voices/voices_view";
import { SearchView } from "@/features/search/search_view";
import { LogMonitor } from "@/features/voices/log_monitor";
import { ChatPanel } from "@/features/chat/chat_panel";
import { AddVideoBar } from "@/features/voices/add_video_bar";
import { ThemeToggle } from "@/components/theme_toggle";

function ViewTabs() {
  const { view, setView } = useStudio();
  const videos = useVideos();
  const voices = useVoiceList();
  const tabs: { id: "videos" | "voices" | "search"; label: string; count?: number }[] = [
    { id: "videos", label: "Videos", count: videos.data?.length ?? 0 },
    { id: "voices", label: "Voices", count: voices.data?.length ?? 0 },
    { id: "search", label: "Search" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setView(t.id)}
          className={
            view === t.id
              ? "flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
              : "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          }
        >
          {t.label}
          {t.count !== undefined && (
            <span
              className={
                view === t.id
                  ? "rounded-full bg-accent-foreground/20 px-1.5 text-[11px]"
                  : "rounded-full bg-muted px-1.5 text-[11px]"
              }
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function ConnectionBadge() {
  const connected = !useVoiceRuns().isError;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
      <span className="relative flex h-2 w-2">
        {connected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-status-complete)] opacity-60" />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full"
          style={{
            background: connected
              ? "var(--color-status-complete)"
              : "var(--color-status-failed)",
          }}
        />
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {connected ? "query connected" : "query unavailable"}
      </span>
    </div>
  );
}

function StudioShell() {
  const { view } = useStudio();
  const [logOpen, setLogOpen] = useState(true);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-3 border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent font-mono text-sm font-bold text-accent-foreground">
                VS
              </div>
              <div>
                <h1 className="font-mono text-base font-semibold leading-tight text-foreground">
                  Voice Studio
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  YouTube to diarized clips to trained voice models
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ConnectionBadge />
              <button
                type="button"
                onClick={() => setLogOpen((o) => !o)}
                className="rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {logOpen ? "Hide logs" : "Show logs"}
              </button>
              <ThemeToggle />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ViewTabs />
            <div className="min-w-0 flex-1">
              <AddVideoBar />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {/* No padding and no scroll here: VideosView's two panes each own
              their own scrolling, and would otherwise scroll inside a
              second, outer scroller. VoicesView and SearchView still want
              the page's usual padding, so they wrap themselves in it. */}
          <main className="min-h-0 flex-1 overflow-hidden">
            {view === "videos" ? (
              <VideosView />
            ) : view === "voices" ? (
              <div className="h-full overflow-y-auto px-6 py-5">
                <VoicesView />
              </div>
            ) : (
              <div className="h-full overflow-y-auto px-6 py-5">
                <SearchView />
              </div>
            )}
          </main>
          {logOpen && (
            <div className="h-56 shrink-0 border-t border-border">
              <LogMonitor />
            </div>
          )}
        </div>
      </div>

      <div className="hidden w-80 shrink-0 lg:block xl:w-96">
        <ChatPanel />
      </div>
    </div>
  );
}

export default function Page() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      {/* One connection for the dashboard. Renders nothing; it only writes
          pushed state into the query cache every hook below already reads. */}
      <VoiceLiveState />
      <StudioProvider>
        {/* CopilotKit sits inside both providers on purpose: the tools it
            registers read studio selection and write through the same query
            hooks the components use. */}
        <CopilotProvider>
          <CopilotStudioTools />
          <StudioShell />
        </CopilotProvider>
      </StudioProvider>
    </QueryClientProvider>
  );
}
