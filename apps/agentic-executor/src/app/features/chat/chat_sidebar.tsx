"use client";

import { CopilotSidebar } from "@copilotkit/react-core/v2";

/*
 * The chat is the control surface for the whole dashboard, so it docks beside
 * the content rather than owning a page of its own.
 *
 * CopilotSidebar renders itself fixed and full height, then sets the body's
 * margin-inline-end to its own width while it is open. So the dashboard is
 * pushed aside rather than covered, and nothing here needs a column layout.
 * Mounted once in the root layout, which is what keeps one conversation alive
 * across every expand and collapse - a human-in-the-loop confirm must outlive
 * whatever the user clicks while it is waiting for an answer.
 */
export function ChatSidebar() {
  return (
    <CopilotSidebar
      defaultOpen
      position="right"
      labels={{
        modalHeaderTitle: "Voyicer Chat",
        welcomeMessageText:
          "Please state the nature of the acoustic replication.",
        chatInputPlaceholder: "Ask about a run, or tell me to start one...",
      }}
    />
  );
}
