import { getLogs, getSnapshot, subscribe } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: Request) {
  ensureSimulator()

  const { searchParams } = new URL(req.url)
  const key = searchParams.get("key") ?? "all"

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      // 1. replay recent logs for this key
      for (const evt of getLogs(key)) send("log", evt)

      // 2. initial full snapshot
      send("state", getSnapshot())

      // 3. tail new logs
      const unsub = subscribe((evt) => {
        if (key === "all" || evt.key === key) send("log", evt)
      })

      // 4. push snapshot + heartbeat on interval so UI stays live
      const tick = setInterval(() => send("state", getSnapshot()), 2000)
      const hb = setInterval(() => send("ping", { ts: Date.now() }), 15000)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(tick)
        clearInterval(hb)
        unsub()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      req.signal.addEventListener("abort", cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
