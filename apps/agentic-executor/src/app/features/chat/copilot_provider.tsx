"use client";

import { CopilotKit, HttpAgent } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import type { ReactNode } from "react";

const pythonApiUrl =
  process.env.NEXT_PUBLIC_PYTHON_API_URL ?? "http://localhost:8000";

/*
 * Built once at module scope, not per render: CopilotKit keys its run state
 * off the agent instance, so a new HttpAgent on every render would reset the
 * conversation. The browser talks to FastAPI directly over AG-UI, which is
 * why this needs the public URL rather than the docker-internal hostname.
 */
const agents = {
  default: new HttpAgent({ url: `${pythonApiUrl}/api/agent` }),
};

export function CopilotProvider({ children }: { children: ReactNode }) {
  return (
    <CopilotKit
      selfManagedAgents={agents}
      onError={({ type, error, context }) => {
        // Without a handler a failed run is silent - the chat just sits there
        // with no message and no console output.
        console.error("CopilotKit error", type, error, context);
      }}
    >
      {children}
    </CopilotKit>
  );
}
