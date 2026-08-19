import { createVoice, getSnapshot } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  ensureSimulator()
  return Response.json(getSnapshot().voices)
}

export async function POST(req: Request) {
  ensureSimulator()
  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const name = body.name?.trim()
  if (!name) return Response.json({ error: "A voice name is required" }, { status: 400 })
  const voice = createVoice(name)
  return Response.json(voice, { status: 201 })
}
