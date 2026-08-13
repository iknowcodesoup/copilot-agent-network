import React from 'react';
import { render, screen } from '@testing-library/react';
import Page from '../src/app/page';
import { QueryProvider } from '../src/app/features/voices/query_provider';

describe('Dashboard page', () => {
  beforeEach(() => {
    // The page reads useVoiceRuns on mount. Nothing here tests the request
    // itself, so an empty list is enough to get past the loading state.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    }) as unknown as typeof fetch;
  });

  it('should render successfully', async () => {
    // Only QueryProvider: the chat sidebar is mounted by layout.tsx, beside
    // the page rather than inside it, so the page needs no CopilotKit context.
    const { baseElement } = render(
      <QueryProvider>
        <Page />
      </QueryProvider>
    );

    expect(baseElement).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: /voice models/i })
    ).toBeTruthy();
  });

  it('shows the empty state when there are no runs', async () => {
    render(
      <QueryProvider>
        <Page />
      </QueryProvider>
    );

    expect(await screen.findByText(/no runs yet/i)).toBeTruthy();
  });
});
