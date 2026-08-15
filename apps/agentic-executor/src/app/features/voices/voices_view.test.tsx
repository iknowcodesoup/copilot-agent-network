import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { VoicesView } from "./voices_view";

/*
 * Covers Story 3.6's I/O matrix "List voices" row: the empty-state message
 * (not a blank page) and the error branch when GET /voices fails.
 */
function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return render(<VoicesView />, { wrapper: Wrapper });
}

describe("VoicesView", () => {
  it("shows an empty-state message rather than a blank page when there are no voices", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    });

    renderView();

    expect(await screen.findByText(/no voices yet/i)).toBeInTheDocument();
  });

  it("shows an inline error when GET /voices fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ detail: "factory unavailable" }),
    });

    renderView();

    await waitFor(() =>
      expect(screen.getByText(/could not load voices/i)).toBeInTheDocument(),
    );
  });
});
