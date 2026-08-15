import "./global.css";
import { ChatSidebar } from "./features/chat/chat_sidebar";
import { CopilotProvider } from "./features/chat/copilot_provider";
import { DashboardNav } from "./features/nav/dashboard_nav";
import { QueryProvider } from "./features/voices/query_provider";
import { VoiceLiveState } from "./features/voices/voice_event_stream";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata = {
  title: "Agentic Executor",
  description: "Chat with the agent and build text-to-speech voice models.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <body>
        <QueryProvider>
          <CopilotProvider>
            {/* one event stream for the whole app, feeding both the voice
                screens and the chat agent */}
            <VoiceLiveState />
            {/* Nav is mounted here, above {children}, so it persists across
                the Videos/Voices split the same way ChatSidebar does. The
                chat sits beside the page rather than inside it, so one
                conversation survives every navigation and expand/collapse -
                a human-in-the-loop confirm has to outlive whatever the user
                clicks while it waits for an answer. */}
            <DashboardNav />
            {children}
            <ChatSidebar />
          </CopilotProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
