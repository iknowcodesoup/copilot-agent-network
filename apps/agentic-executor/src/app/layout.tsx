import "./global.css";
import { ChatSidebar } from "./features/chat/chat_sidebar";
import { CopilotProvider } from "./features/chat/copilot_provider";
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
            {/* No nav: the dashboard is the only page. The chat sits beside
                the page rather than inside it, so one conversation survives
                every expand and collapse - a human-in-the-loop confirm has to
                outlive whatever the user clicks while it waits for an answer. */}
            {children}
            <ChatSidebar />
          </CopilotProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
