"use client";

/*
 * Open the video on YouTube and wait for the operator to close that tab before
 * the run starts.
 *
 * Why this exists: a download that fails goes on to succeed after the video has
 * been opened and played once by hand. So the ingest is gated on that happening
 * first, rather than leaving the operator to discover the failure and repeat the
 * step themselves.
 *
 * window.closed is readable across origins - it is one of the few properties
 * that is - so polling it needs no cooperation from the opened page.
 */

const POLL_INTERVAL_MS = 500;

/* Resolves once the opened tab is closed. Resolves right away when the popup
   was blocked: a blocked popup must not strand the run behind a tab that will
   never open, so the ingest goes ahead ungated. */
export function openVideoThenContinue(url: string): Promise<void> {
  // No noopener here, deliberately: it makes window.open return null, and the
  // returned handle is the whole point - it is what .closed is polled on.
  const opened = window.open(url, "_blank");
  if (!opened) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (opened.closed) {
        window.clearInterval(timer);
        resolve();
      }
    }, POLL_INTERVAL_MS);
  });
}
