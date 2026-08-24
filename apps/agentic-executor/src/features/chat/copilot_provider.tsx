"use client"

import { HttpAgent } from "@ag-ui/client"
import { CopilotKitProvider } from "@copilotkit/react-core/v2"
import type { ReactNode } from "react"

const pythonApiUrl =
  process.env.NEXT_PUBLIC_PYTHON_API_URL ?? "http://localhost:8000"

/*
 * Built once at module scope, never per render. CopilotKit keys run state off
 * the agent instance, so a fresh HttpAgent on each render would drop the
 * thread mid-conversation.
 *
 * `selfManagedAgents` rather than `agents__unsafe_dev_only`: the browser
 * speaks AG-UI to FastAPI directly and there is no CopilotKit runtime in
 * between. That is also why this reads the public URL - the request leaves
 * the browser, so the compose hostname would not resolve.
 *
 * HttpAgent comes from the AG-UI SDK. @copilotkit/react-core/v2 stopped
 * re-exporting it, so importing it from there fails to compile.
 */
const agents = {
  default: new HttpAgent({ url: `${pythonApiUrl}/api/agent` }),
}

export function CopilotProvider({ children }: { children: ReactNode }) {
  return (
    <CopilotKitProvider
      selfManagedAgents={agents}
      onError={({ error, code, context }) => {
        // Without a handler a failed run is silent: the panel keeps its
        // pending bubble and nothing reaches the console.
        console.error("CopilotKit error", code, error, context)
      }}
    >
      {children}
    </CopilotKitProvider>
  )
}
