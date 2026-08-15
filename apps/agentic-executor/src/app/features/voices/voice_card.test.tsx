import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { VoiceCard } from "./voice_card";
import type { VoiceSummary } from "./voice_api";

/*
 * Covers Story 3.6's I/O matrix rows for "Train now" / "Retrain a READY
 * voice", plus the acceptance criterion that a READY voice always shows a
 * disabled "Download model" button with no model size.
 */
function renderCard(voice: VoiceSummary, detailBody: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => detailBody,
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return render(<VoiceCard voice={voice} />, { wrapper: Wrapper });
}

function detailFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "v1",
    name: "Picard",
    phase: "awaiting_commit",
    checkpoint_path: null,
    voyicer_job_id: null,
    contributions: [],
    created_at: "2026-08-01T00:00:00",
    updated_at: "2026-08-01T00:00:00",
    ...overrides,
  };
}

const contribution = {
  id: "c1",
  voice_id: "v1",
  run_id: "r1",
  video_id: "vid1",
  video_title: "Episode 1",
  speaker_label: "SPEAKER_00",
  created_at: "2026-08-01T00:00:00",
};

const secondContribution = {
  id: "c2",
  voice_id: "v1",
  run_id: "r2",
  video_id: "vid2",
  video_title: "Episode 2",
  speaker_label: "SPEAKER_01",
  created_at: "2026-08-02T00:00:00",
};

describe("VoiceCard view clips modal", () => {
  it("lists clips grouped by contributing video, isolating a per-video fetch error", async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes("/voices/v1")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            detailFixture({
              phase: "ready",
              contributions: [contribution, secondContribution],
            }),
        });
      }
      if (url.includes("/runs/r1/speakers")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            run_id: "r1",
            video_id: "vid1",
            speakers: [
              {
                speaker_label: "SPEAKER_00",
                assigned_character: null,
                clip_count: 1,
                kept_count: 1,
                total_duration_sec: 3,
                clips: [
                  {
                    clip_id: "clip1",
                    keep: true,
                    speaker_label: "SPEAKER_00",
                    text: "Make it so.",
                  },
                ],
              },
            ],
          }),
        });
      }
      if (url.includes("/runs/r2/speakers")) {
        return Promise.resolve({ ok: false, status: 502 });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }) as unknown as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }
    render(
      <VoiceCard voice={{ id: "v1", name: "Picard", phase: "ready" }} />,
      { wrapper: Wrapper },
    );

    fireEvent.click(await screen.findByText("View clips"));

    expect(await screen.findByText("Make it so.")).toBeInTheDocument();
    expect(screen.getByText("Episode 1")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText((text) => text.startsWith("Episode 2")),
      ).toBeInTheDocument(),
    );
  });
});

describe("VoiceCard phase-conditional actions", () => {
  it("shows 'Train now' for an awaiting_commit voice with a contribution", async () => {
    renderCard(
      { id: "v1", name: "Picard", phase: "awaiting_commit" },
      detailFixture({ phase: "awaiting_commit", contributions: [contribution] }),
    );

    expect(await screen.findByText("Train now")).toBeInTheDocument();
    expect(screen.queryByText("Retrain")).not.toBeInTheDocument();
  });

  it("hides 'Train now' for an awaiting_commit voice with no contributions yet", async () => {
    renderCard(
      { id: "v1", name: "Picard", phase: "awaiting_commit" },
      detailFixture({ phase: "awaiting_commit", contributions: [] }),
    );

    await waitFor(() =>
      expect(screen.getByText("No contributions yet")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Train now")).not.toBeInTheDocument();
    expect(screen.getByText("Retrain")).toBeInTheDocument();
  });

  it("shows 'Retrain' (never 'Train now') for a READY voice", async () => {
    renderCard(
      { id: "v1", name: "Picard", phase: "ready" },
      detailFixture({ phase: "ready", contributions: [contribution] }),
    );

    expect(await screen.findByText("Retrain")).toBeInTheDocument();
    expect(screen.queryByText("Train now")).not.toBeInTheDocument();
  });

  it("labels an awaiting_commit voice 'Awaiting commit' with no pulse dot", async () => {
    renderCard(
      { id: "v1", name: "Picard", phase: "awaiting_commit" },
      detailFixture({ phase: "awaiting_commit", contributions: [contribution] }),
    );

    const badge = await screen.findByText("Awaiting commit");
    // Scoped to the badge itself: the card's own loading Skeleton also uses
    // animate-pulse, so a page-wide query would false-negative on it.
    expect(
      badge.closest('[data-slot="badge"]')?.querySelector(".animate-pulse"),
    ).not.toBeInTheDocument();
  });

  it("shows a disabled 'Download model' with no model size once READY", async () => {
    renderCard(
      { id: "v1", name: "Picard", phase: "ready" },
      detailFixture({ phase: "ready", contributions: [contribution] }),
    );

    const downloadButton = await screen.findByRole("button", {
      name: /download model/i,
    });
    expect(downloadButton).toBeDisabled();
    // "Model size: <em dash>" - matched by prefix only. The CI runner's
    // subprocess capture decodes as cp1252 on this host, which cannot
    // represent the literal em dash, so this avoids putting one in a
    // string a failed assertion could print to that stream.
    expect(screen.getByText(/^Model size:/)).toBeInTheDocument();
  });

  it("does not show the Download model row before READY", async () => {
    renderCard(
      { id: "v1", name: "Picard", phase: "training" },
      detailFixture({ phase: "training", contributions: [contribution] }),
    );

    await screen.findByText("Retrain");
    expect(
      screen.queryByRole("button", { name: /download model/i }),
    ).not.toBeInTheDocument();
  });
});
