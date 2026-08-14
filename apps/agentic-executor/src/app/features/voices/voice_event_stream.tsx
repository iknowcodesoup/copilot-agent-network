"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { useEffect } from "react";
import {
  useVoiceRuns,
  voiceApiBase,
  voiceQueryKeys,
  type JobLog,
  type VoiceRun,
} from "./voice_api";

/*
 * One EventSource for the whole application, and the only thing that knows the
 * server pushes at all. It writes what arrives into the TanStack Query cache
 * under the keys the ordinary hooks already read, so every voice component
 * keeps its existing useVoiceRun/useVoiceRuns call and gets live data without
 * changing a line.
 *
 * EventSource handles the hard parts of reconnecting by itself. It retries on
 * its own schedule and sends back the last `id:` it saw as Last-Event-ID, which
 * the server treats as a replay position. So nothing here counts events, tracks
 * a cursor, or holds a second copy of the state.
 */

/* AG-UI event envelopes, as the encoder writes them on the wire. */
const SNAPSHOT_EVENT_TYPE = "STATE_SNAPSHOT";
const CUSTOM_EVENT_TYPE = "CUSTOM";
const RUN_UPDATED_EVENT_NAME = "voice.run.updated";
const RUN_LOG_EVENT_NAME = "voice.run.log";

interface AgentUiEvent {
  type: string;
  name?: string;
  value?: unknown;
  snapshot?: { runs?: unknown[] };
}

/*
 * FastAPI speaks snake_case and this app speaks camelCase, the same as every
 * response voice_api.ts converts. The stream carries the same run shape, so it
 * needs the same conversion.
 */
function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, character) =>
    character.toUpperCase(),
  );
}

function convertKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertKeys(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        toCamelCase(key),
        convertKeys(entry),
      ]),
    );
  }
  return value;
}

/*
 * Drop any fetch still in the air for this key before writing to it.
 *
 * The REST hooks in voice_api.ts and this stream write the same cache entries.
 * A push always carries newer state than a read that started earlier, so a
 * fetch that resolves afterwards would put the older answer back. Cancelling is
 * TanStack's own answer to that race, and it is safe to fire and forget: with
 * nothing in flight it does nothing at all.
 */
function cancelFetchesFor(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
): void {
  void queryClient.cancelQueries({ queryKey, exact: true });
}

/*
 * Replace the run, or add it when it is new. Written as a replace rather than a
 * merge on purpose: every event carries the complete run, so applying the same
 * one twice lands on the same result. A duplicate after a reconnect is then
 * simply not a problem worth guarding against.
 */
function applyRunUpdate(queryClient: QueryClient, run: VoiceRun): void {
  cancelFetchesFor(queryClient, voiceQueryKeys.run(run.id));
  cancelFetchesFor(queryClient, voiceQueryKeys.runs);
  queryClient.setQueryData(voiceQueryKeys.run(run.id), run);
  queryClient.setQueryData<VoiceRun[]>(voiceQueryKeys.runs, (runs) => {
    if (!runs) {
      return [run];
    }
    const index = runs.findIndex((existing) => existing.id === run.id);
    if (index === -1) {
      return [run, ...runs];
    }
    const next = runs.slice();
    next[index] = run;
    return next;
  });
}

/*
 * Append one pushed log chunk to the cache useJobLog reads. Guards against a
 * replayed chunk after a reconnect the same way applyRunUpdate does not need
 * to: a log is appended, not replaced, so a duplicate would double the text
 * without this check.
 */
function applyLogChunk(
  queryClient: QueryClient,
  chunk: { runId: string; offset: number; content: string },
): void {
  const key = voiceQueryKeys.log(chunk.runId);
  cancelFetchesFor(queryClient, key);
  queryClient.setQueryData<JobLog>(key, (prev) => {
    if (prev && chunk.offset <= prev.offset) {
      return prev;
    }
    return {
      offset: chunk.offset,
      content: (prev?.content ?? "") + chunk.content,
      state: prev?.state ?? "running",
    };
  });
}

function applySnapshot(queryClient: QueryClient, runs: VoiceRun[]): void {
  cancelFetchesFor(queryClient, voiceQueryKeys.runs);
  queryClient.setQueryData(voiceQueryKeys.runs, runs);
  for (const run of runs) {
    cancelFetchesFor(queryClient, voiceQueryKeys.run(run.id));
    queryClient.setQueryData(voiceQueryKeys.run(run.id), run);
  }
}

/*
 * Apply one raw SSE frame to the cache. Exported because this is where the
 * whole contract with the server lives - the envelope shapes, the case
 * conversion, and the rule that applying an event twice is safe.
 */
export function applyVoiceEvent(queryClient: QueryClient, data: string): void {
  let event: AgentUiEvent;
  try {
    event = JSON.parse(data);
  } catch {
    // one unreadable frame must not take the connection down with it
    return;
  }

  if (event.type === SNAPSHOT_EVENT_TYPE && event.snapshot?.runs) {
    applySnapshot(queryClient, convertKeys(event.snapshot.runs) as VoiceRun[]);
    return;
  }
  if (
    event.type === CUSTOM_EVENT_TYPE &&
    event.name === RUN_UPDATED_EVENT_NAME
  ) {
    applyRunUpdate(queryClient, convertKeys(event.value) as VoiceRun);
    return;
  }
  if (event.type === CUSTOM_EVENT_TYPE && event.name === RUN_LOG_EVENT_NAME) {
    applyLogChunk(
      queryClient,
      convertKeys(event.value) as {
        runId: string;
        offset: number;
        content: string;
      },
    );
  }
}

function useVoiceEventStream(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource(`${voiceApiBase}/events`);
    source.onmessage = (event) => applyVoiceEvent(queryClient, event.data);
    source.onerror = () => {
      // EventSource reconnects by itself, and replays from Last-Event-ID when
      // it does. Logging is all there is to do here.
      console.warn("Voice event stream dropped, reconnecting");
    };
    return () => source.close();
  }, [queryClient]);
}

/*
 * Hands the chat agent the same runs the screen is showing. It reads the query
 * cache the stream writes, so there is no second endpoint, no second
 * connection, and no chance of the agent describing older state than the user
 * is looking at.
 */
function useVoiceRunsAgentContext(): void {
  const runs = useVoiceRuns();

  useAgentContext({
    description:
      "The user's text-to-speech voice model runs, live. Each run turns one " +
      "video into a fine-tuned voice. `phase` is what it is doing now, and " +
      "`currentEpoch` and `currentLoss` are the latest training figures.",
    value: (runs.data ?? []).map((run) => ({
      id: run.id,
      character: run.primaryCharacter,
      phase: run.phase,
      videoTitle: run.videoTitle,
      clipCount: run.clipCount,
      approvedCount: run.approvedCount,
      currentEpoch: run.currentEpoch,
      currentLoss: run.currentLoss,
      error: run.error,
      updatedAt: run.updatedAt,
    })),
  });
}

/*
 * Renders nothing. Mounted once in the root layout, inside both the query and
 * CopilotKit providers, so one connection serves every page.
 */
export function VoiceLiveState() {
  useVoiceEventStream();
  useVoiceRunsAgentContext();
  return null;
}
