"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useAssistant } from "@/lib/assistant"

interface Msg {
  id: string
  role: "user" | "assistant"
  text: string
  pending?: boolean
}

let mid = 0
const nextId = () => `m${mid++}-${Date.now()}`

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
  const { handleMessage, suggestions, actions } = useAssistant()
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "I'm your voice-studio copilot. I can add videos, approve/reject/label clips, and create, train, sample, or export voice models. Ask me anything or try a suggestion below.",
    },
  ])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busy) return
      setInput("")
      setBusy(true)
      const userMsg: Msg = { id: nextId(), role: "user", text }
      const pendingMsg: Msg = { id: nextId(), role: "assistant", text: "", pending: true }
      setMessages((prev) => [...prev, userMsg, pendingMsg])
      try {
        const reply = await handleMessage(text)
        setMessages((prev) =>
          prev.map((m) => (m.id === pendingMsg.id ? { ...m, text: reply, pending: false } : m)),
        )
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? { ...m, text: "Something went wrong running that action.", pending: false }
              : m,
          ),
        )
      } finally {
        setBusy(false)
      }
    },
    [busy, handleMessage],
  )

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <div>
            <h2 className="font-mono text-sm font-semibold text-foreground">Copilot</h2>
            <p className="text-[11px] text-muted-foreground">NLP control for the studio</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => setShowActions((s) => !s)}
        >
          {showActions ? "Hide" : "Actions"}
        </Button>
      </header>

      {showActions && (
        <div className="max-h-48 overflow-y-auto border-b border-border bg-muted/30 px-3 py-2">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Registered actions
          </p>
          <ul className="flex flex-col gap-1.5">
            {actions.map((a) => (
              <li key={a.name} className="text-[11px] leading-tight">
                <code className="text-accent">{a.name}</code>
                <span className="text-muted-foreground"> — {a.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-foreground"
                  : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground"
              }
            >
              {m.pending ? (
                <span className="flex items-center gap-1 py-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                </span>
              ) : (
                <div className="leading-relaxed">{renderMarkdown(m.text)}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            disabled={busy}
            className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

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
        <Button type="submit" size="sm" disabled={busy || !input.trim()} className="h-9">
          Send
        </Button>
      </form>
    </aside>
  )
}
