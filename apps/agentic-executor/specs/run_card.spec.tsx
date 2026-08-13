import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { RunCard } from '../src/app/features/voices/run_card';
import { QueryProvider } from '../src/app/features/voices/query_provider';
import type { VoiceRun } from '../src/app/features/voices/voice_api';

function buildRun(overrides: Partial<VoiceRun> = {}): VoiceRun {
  return {
    id: 'run-1',
    primaryCharacter: 'janeway',
    sourceUrl: 'https://youtu.be/abc',
    videoId: 'abc',
    videoTitle: 'Voyager bridge scenes',
    phase: 'awaiting_review',
    diarize: true,
    numSpeakers: null,
    speakerMap: {},
    voyicerJobId: null,
    commitStageIndex: 0,
    clipCount: 3,
    approvedCount: 2,
    checkpointPath: null,
    currentEpoch: null,
    currentLoss: null,
    error: null,
    errorCount: 0,
    failedFromPhase: null,
    createdAt: '2026-08-12T00:00:00',
    updatedAt: '2026-08-12T00:00:00',
    ...overrides,
  };
}

function renderCard(run: VoiceRun, expanded: boolean) {
  return render(
    <QueryProvider>
      <RunCard run={run} expanded={expanded} onToggle={() => undefined} />
    </QueryProvider>
  );
}

describe('RunCard', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ run_id: 'run-1', video_id: 'abc', speakers: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('shows the summary without fetching while it is collapsed', async () => {
    renderCard(buildRun(), false);

    expect(screen.getByText('janeway')).toBeTruthy();
    expect(screen.getByText('2/3 clips')).toBeTruthy();

    // The point of collapsing: the children that cost a request are simply not
    // mounted, so a shut card is free no matter how many runs are on screen.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the speaker board only once it is expanded', async () => {
    renderCard(buildRun(), true);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.endsWith('/runs/run-1/speakers'))).toBe(
      true
    );
  });

  it('explains what an active run is doing while there is nothing to click', () => {
    renderCard(buildRun({ phase: 'downloading', clipCount: 0 }), true);

    expect(screen.getByText(/downloading the audio/i)).toBeTruthy();
  });

  it('offers a retry only when the run has failed', () => {
    renderCard(
      buildRun({ phase: 'failed', error: 'Job 7 failed. See its log.' }),
      true
    );

    expect(screen.getByText(/job 7 failed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});
