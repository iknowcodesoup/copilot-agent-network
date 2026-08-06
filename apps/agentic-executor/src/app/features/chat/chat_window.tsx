"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";

export function ChatWindow() {
  return (
    <CopilotChat
      labels={{
        chatInputPlaceholder: "Ask the agent something...",
      }}
    />
  );
}
