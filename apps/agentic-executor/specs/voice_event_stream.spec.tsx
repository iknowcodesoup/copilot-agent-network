import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import {
  applyVoiceEvent,
  VoiceLiveState,
} from '../src/app/features/voices/voice_event_stream';
import {
  voiceQueryKeys,
  type VoiceRun,
} from '../src/app/features/voices/voice_api';

/*
 * The chat agent must read the same state the screen does, so the test records
 * what CopilotKit was handed and compares it with the query cache.
 */
const agentContextValues: unknown[] = [];

jest.mock('@copilotkit/react-core/v2', () => ({
  useAgentContext: (context: { value: unknown }) => {
    agentContextValues.push(context.value);
  },
}));

/* The server's wire format: snake_case fields inside an AG-UI envelope. */
function serverRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run1',
    primary_character: 'janeway',
    source_url: 'https://example.com/v',
    video_id: 'vid1',
    video_title: 'Janeway speaks',
    phase: 'training',
    diarize: true,
    num_speakers: null,
    speaker_map: {},
    voyicer_job_id: 'job7',
    commit_stage_index: 0,
    clip_count: 12,
    approved_count: 10,
    checkpoint_path: null,
    current_epoch: 42,
    current_loss: 31.2,
    error: null,
    error_count: 0,
    failed_from_phase: null,
    created_at: '2026-08-12T19:00:00Z',
    updated_at: '2026-08-12T19:24:10Z',
    ...overrides,
  };
}

function snapshotFrame(runs: Record<string, unknown>[]) {
  return JSON.stringify({ type: 'STATE_SNAPSHOT', snapshot: { runs } });
}

function updateFrame(run: Record<string, unknown>) {
  return JSON.stringify({
    type: 'CUSTOM',
    name: 'voice.run.updated',
    value: run,
  });
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe('applyVoiceEvent', () => {
  it('should populate the existing query keys from a snapshot', () => {
    const queryClient = newQueryClient();

    applyVoiceEvent(queryClient, snapshotFrame([serverRun()]));

    const runs = queryClient.getQueryData<VoiceRun[]>(voiceQueryKeys.runs);
    expect(runs).toHaveLength(1);
    // the wire is snake_case and the app is camelCase
    expect(runs?.[0].primaryCharacter).toBe('janeway');
    expect(runs?.[0].currentEpoch).toBe(42);
    expect(
      queryClient.getQueryData<VoiceRun>(voiceQueryKeys.run('run1'))?.phase
    ).toBe('training');
  });

  it('should replace only the run the update names', () => {
    const queryClient = newQueryClient();
    applyVoiceEvent(
      queryClient,
      snapshotFrame([serverRun(), serverRun({ id: 'run2', phase: 'ready' })])
    );

    applyVoiceEvent(
      queryClient,
      updateFrame(serverRun({ phase: 'exporting', current_epoch: 99 }))
    );

    const runs = queryClient.getQueryData<VoiceRun[]>(voiceQueryKeys.runs);
    expect(runs?.map((run) => [run.id, run.phase])).toEqual([
      ['run1', 'exporting'],
      ['run2', 'ready'],
    ]);
    expect(
      queryClient.getQueryData<VoiceRun>(voiceQueryKeys.run('run1'))?.currentEpoch
    ).toBe(99);
  });

  it('should add a run it has not seen before', () => {
    const queryClient = newQueryClient();
    applyVoiceEvent(queryClient, snapshotFrame([]));

    applyVoiceEvent(queryClient, updateFrame(serverRun({ id: 'brand-new' })));

    expect(
      queryClient.getQueryData<VoiceRun[]>(voiceQueryKeys.runs)?.map((r) => r.id)
    ).toEqual(['brand-new']);
  });

  it('should land on the same state when the same update arrives twice', () => {
    // a reconnect replays, so a duplicate has to be harmless
    const queryClient = newQueryClient();
    applyVoiceEvent(queryClient, snapshotFrame([serverRun()]));
    const frame = updateFrame(serverRun({ phase: 'ready' }));

    applyVoiceEvent(queryClient, frame);
    const afterFirst = queryClient.getQueryData<VoiceRun[]>(voiceQueryKeys.runs);
    applyVoiceEvent(queryClient, frame);
    const afterSecond = queryClient.getQueryData<VoiceRun[]>(voiceQueryKeys.runs);

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond).toHaveLength(1);
  });

  it('should ignore a frame it cannot read', () => {
    const queryClient = newQueryClient();
    applyVoiceEvent(queryClient, snapshotFrame([serverRun()]));

    applyVoiceEvent(queryClient, 'not json at all');
    applyVoiceEvent(queryClient, JSON.stringify({ type: 'RUN_STARTED' }));

    expect(
      queryClient.getQueryData<VoiceRun[]>(voiceQueryKeys.runs)
    ).toHaveLength(1);
  });
});

describe('VoiceLiveState', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
      FakeEventSource.instances.push(this);
    }

    close() {
      this.closed = true;
    }
  }

  beforeEach(() => {
    FakeEventSource.instances = [];
    agentContextValues.length = 0;
    (global as unknown as { EventSource: unknown }).EventSource =
      FakeEventSource;
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => [] })
    ) as unknown as typeof fetch;
  });

  it('should open one connection to the event endpoint and close it on unmount', () => {
    const queryClient = newQueryClient();
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <VoiceLiveState />
      </QueryClientProvider>
    );

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain('/api/voice/events');

    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('should give the chat agent the same runs the cache holds', async () => {
    const queryClient = newQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <VoiceLiveState />
      </QueryClientProvider>
    );

    FakeEventSource.instances[0].onmessage?.({
      data: snapshotFrame([serverRun()]),
    });

    await waitFor(() => {
      const latest = agentContextValues.at(-1) as { id: string; phase: string }[];
      expect(latest).toEqual([
        expect.objectContaining({
          id: 'run1',
          phase: 'training',
          currentEpoch: 42,
        }),
      ]);
    });
    expect(
      queryClient.getQueryData<VoiceRun[]>(voiceQueryKeys.runs)?.[0].phase
    ).toBe('training');
  });
});
