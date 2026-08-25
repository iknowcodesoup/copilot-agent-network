import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useTrainVoice, useVoiceDetail, useVoiceList } from "./api/use_voices";
import { voicesApiBase } from "./api/endpoints";

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

  it("calls GET /voices/{id} and converts its clips to camelCase", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "v1",
        name: "Picard",
        phase: "awaiting_commit",
        checkpoint_path: null,
        voyicer_job_id: null,
        clips: [
          {
            video_id: "vid1",
            clip_id: "clip_0001",
            video_title: "Episode 1",
            keep: true,
            text: "Make it so.",
            start_sec: 1.5,
            end_sec: 3.0,
            duration_sec: 1.5,
            flagged: false,
            speaker_label: "SPEAKER_00",
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
    expect(result.current.data?.clips).toEqual([
      {
        videoId: "vid1",
        clipId: "clip_0001",
        videoTitle: "Episode 1",
        keep: true,
        text: "Make it so.",
        startSec: 1.5,
        endSec: 3.0,
        durationSec: 1.5,
        flagged: false,
        speakerLabel: "SPEAKER_00",
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

    const { result } = renderHook(() => useTrainVoice(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });

    result.current.mutate("v1");

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
