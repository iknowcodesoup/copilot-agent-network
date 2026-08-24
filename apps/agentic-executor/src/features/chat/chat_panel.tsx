"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
  useSuggestions,
} from "@copilotkit/react-core/v2"
import { Button } from "@/components/ui/button"

const WELCOME =
  "I'm your voice-studio copilot. I can add videos, keep or discard clips, " +
  "bind speakers to voices, create voices, and start training. I can also " +
  "ask the research and voice agents why a run is behaving the way it is."

function renderMarkdown(text: string) {
  // minimal inline markdown: **bold** and line breaks
  const lines = text.split("\n")
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
    return (
      <span key={i} className="block">
        {parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? (
            <strong key={j} className="font-semibold text-foreground">
              {p.slice(2, -2)}
            </strong>
          ) : (
            <span key={j}>{p}</span>
          ),
        )}
      </span>
    )
  })
}

export function ChatPanel() {
  const { copilotkit } = useCopilotKit()
  /* Subscribing to both updates is what makes this panel live: message
     deltas stream in as the run produces them, and the run status drives the
     pending indicator. Throttled, because a token-level re-render of the
     whole transcript is wasted work. */
  const { agent } = useAgent({
    agentId: "default",
    updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged],
    throttleMs: 100,
  })
  const { suggestions } = useSuggestions()

  const [input, setInput] = useState("")
  const [showActions, setShowActions] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const messages = agent.messages
  const isRunning = agent.isRunning

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages, isRunning])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || isRunning) return
      setInput("")
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text })
      try {
        await copilotkit.runAgent({ agent })
      } catch (error) {
        // The provider's onError already logs. Swallowing here keeps a failed
        // run from taking the panel down with it.
        console.error("run failed", error)
      }
    },
    [agent, copilotkit, isRunning],
  )

  /* The last message is still streaming while the run is open, so the dots
     only belong before the first token of the reply arrives. */
  const lastMessage = messages[messages.length - 1]
  const awaitingFirstToken =
    isRunning &&
    (lastMessage === undefined ||
      lastMessage.role === "user" ||
      lastMessage.role === "tool" ||
      !("content" in lastMessage && lastMessage.content))

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {isRunning && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            )}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <div>
            <h2 className="font-mono text-sm font-semibold text-foreground">Copilot</h2>
            <p className="text-[11px] text-muted-foreground">
              Orchestrator over AG-UI
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => setShowActions((s) => !s)}
        >
          {showActions ? "Hide" : "Tools"}
        </Button>
      </header>

      {showActions && (
        <div className="max-h-48 overflow-y-auto border-b border-border bg-muted/30 px-3 py-2">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Registered tools
          </p>
          <ul className="flex flex-col gap-1.5">
            {/* The live registry, not a hand-kept list: these are exactly the
                tools the model is offered on the next run. */}
            {copilotkit.tools.map((tool) => (
              <li key={tool.name} className="text-[11px] leading-tight">
                <code className="text-accent">{tool.name}</code>
                <span className="text-muted-foreground"> — {tool.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
              {WELCOME}
            </div>
          </div>
        )}

        {messages.map((message) => {
          if (message.role === "user") {
            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-foreground">
                  {typeof message.content === "string" ? message.content : ""}
                </div>
              </div>
            )
          }

          if (message.role !== "assistant") return null

          const toolCalls = message.toolCalls ?? []
          return (
            <div key={message.id} className="flex flex-col items-start gap-1.5">
              {message.content && (
                <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground">
                  <div className="leading-relaxed">
                    {renderMarkdown(message.content)}
                  </div>
                </div>
              )}
              {/* A tool call is the run's visible work. Showing it keeps the
                  panel honest about what the copilot changed. */}
              {toolCalls.map((call) => (
                <div
                  key={call.id}
                  className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground"
                >
                  <span className="text-accent">{call.function.name}</span>
                  {call.function.arguments && call.function.arguments !== "{}" && (
                    <span> {call.function.arguments}</span>
                  )}
                </div>
              ))}
            </div>
          )
        })}

        {awaitingFirstToken && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2">
              <span className="flex items-center gap-1 py-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
              </span>
            </div>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.title}
              type="button"
              onClick={() => send(suggestion.message)}
              disabled={isRunning}
              className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {suggestion.title}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              send(input)
            }
          }}
          rows={1}
          placeholder="Ask the copilot…  e.g. “train Narrator A”"
          className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-accent"
        />
        <Button
          type="submit"
          size="sm"
          disabled={isRunning || !input.trim()}
          className="h-9"
        >
          Send
        </Button>
      </form>
    </aside>
  )
}
