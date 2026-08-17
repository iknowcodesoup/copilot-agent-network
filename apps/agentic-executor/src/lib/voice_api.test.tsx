import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  useTrainVoice,
  useVoiceDetail,
  useVoiceList,
  voicesApiBase,
} from "./voice_api";

/*
 * Covers Story 3.6's Task "voice_api.ts -- add useVoiceList, useVoiceDetail,
 * useTrainVoice" and the I/O matrix's train/retrain rows: the request shape
 * these hooks send, and that a train call invalidates the queries the card
 * refetches from afterward.
 */
function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as Response;
}

describe("useVoiceList", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("calls GET /voices with an empty query and limit=50", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: "v1", name: "Picard", phase: "ready" }]),
    );

    const { result } = renderHook(() => useVoiceList(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `${voicesApiBase}?query=&limit=50`,
      expect.anything(),
    );
    expect(result.current.data).toEqual([
      { id: "v1", name: "Picard", phase: "ready" },
    ]);
  });
});

describe("useVoiceDetail", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("calls GET /voices/{id} and converts contributions to camelCase", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "v1",
        name: "Picard",
        phase: "awaiting_commit",
        checkpoint_path: null,
        voyicer_job_id: null,
        contributions: [
          {
            id: "c1",
            voice_id: "v1",
            run_id: "r1",
            video_id: "vid1",
            video_title: "Episode 1",
            speaker_label: "SPEAKER_00",
            created_at: "2026-08-01T00:00:00",
          },
        ],
        created_at: "2026-08-01T00:00:00",
        updated_at: "2026-08-01T00:00:00",
      }),
    );

    const { result } = renderHook(() => useVoiceDetail("v1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `${voicesApiBase}/v1`,
      expect.anything(),
    );
    expect(result.current.data?.contributions).toEqual([
      {
        id: "c1",
        voiceId: "v1",
        runId: "r1",
        videoId: "vid1",
        videoTitle: "Episode 1",
        speakerLabel: "SPEAKER_00",
        createdAt: "2026-08-01T00:00:00",
      },
    ]);
  });
});

describe("useTrainVoice", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("POSTs /voices/{id}/train and invalidates the voice's detail and list queries", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(jsonResponse({ id: "v1", phase: "training" }));

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useTrainVoice("v1"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(`${voicesApiBase}/v1/train`, {
      method: "POST",
    });
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["voice", "voiceDetail", "v1"] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["voice", "voiceList"] }),
    );
  });
});
