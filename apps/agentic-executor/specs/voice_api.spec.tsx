import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useTrainingProgress,
  useVoiceRun,
  useVoiceRuns,
  voiceQueryKeys,
} from '../src/app/features/voices/voice_api';

/*
 * The server pushes every run change over SSE, so nothing here may poll. A
 * leftover refetchInterval would put the old traffic straight back.
 */
function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('voice query hooks', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: async () => [] })
    ) as unknown as typeof fetch;
  });

  it.each([
    ['useVoiceRuns', () => useVoiceRuns(), voiceQueryKeys.runs],
    ['useVoiceRun', () => useVoiceRun('run1'), voiceQueryKeys.run('run1')],
    [
      'useTrainingProgress',
      () => useTrainingProgress('run1', true),
      voiceQueryKeys.training('run1'),
    ],
  ])('should leave %s without a polling interval', async (_name, hook, key) => {
    const queryClient = newQueryClient();

    renderHook(hook, { wrapper: wrapper(queryClient) });

    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: key })).toBeDefined();
    });
    const query = queryClient.getQueryCache().find({ queryKey: key });
    expect(query?.options.refetchInterval).toBeUndefined();
  });

  it('should fetch a run list once and then leave it alone', async () => {
    const queryClient = newQueryClient();

    renderHook(() => useVoiceRuns(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/voice/runs'),
      expect.anything()
    );
  });
});
