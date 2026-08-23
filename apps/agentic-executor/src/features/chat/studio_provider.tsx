"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useVoiceRuns } from "@/features/voices/voice_api";

/*
 * What the operator is looking at, and nothing else.
 *
 * Server state belongs to TanStack Query, which is already the single
 * reactive source: the event stream writes pushed updates straight into that
 * cache, so every component reading a query hook re-renders together. This
 * provider used to mirror those queries into a `snapshot` object and wrap
 * every mutation in a second function. That copy was the problem - it hand-
 * built voice objects with empty contribution lists, and derived an
 * "active" run id by guessing, which sent clip writes at the wrong video.
 *
 * So: five pieces of view state here, and components call the query hooks
 * directly for everything else.
 */

type View = "videos" | "voices" | "search";

interface StudioContextValue {
  view: View;
  setView: (view: View) => void;
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
  selectedVideoId: string | null;
  setSelectedVideoId: (id: string | null) => void;
  selectedVoiceId: string | null;
  setSelectedVoiceId: (id: string | null) => void;
  logFilter: string;
  setLogFilter: (key: string) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const runs = useVoiceRuns();
  const [view, setView] = useState<View>("videos");
  const [selectedRunId, setSelectedRunIdState] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState("all");

  /* Selection is keyed by video, since a freshly ingested video may have no
     run yet - two such videos both reduce to a null runId and would otherwise
     be indistinguishable. Selecting a run keeps the video in sync. */
  const runList = runs.data ?? [];
  const setSelectedRunId = useCallback(
    (id: string | null) => {
      setSelectedRunIdState(id);
      setSelectedVideoId(
        (id ? runList.find((run) => run.id === id)?.videoId : null) ?? null,
      );
    },
    [runList],
  );

  const value = useMemo(
    () => ({
      view,
      setView,
      selectedRunId,
      setSelectedRunId,
      selectedVideoId,
      setSelectedVideoId,
      selectedVoiceId,
      setSelectedVoiceId,
      logFilter,
      setLogFilter,
    }),
    [
      view,
      selectedRunId,
      setSelectedRunId,
      selectedVideoId,
      selectedVoiceId,
      logFilter,
    ],
  );
  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used within StudioProvider");
  return context;
}

/* The run showing a given video, or null. Selection stores the video; the
   actions need the run. Every caller resolves it the same way, from the one
   runs query, instead of the provider guessing one for everybody. */
export function useRunForVideo(videoId: string | null) {
  const runs = useVoiceRuns();
  if (!videoId) return null;
  return runs.data?.find((run) => run.videoId === videoId) ?? null;
}
