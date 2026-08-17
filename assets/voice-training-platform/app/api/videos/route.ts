import { addVideo, getSnapshot } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  ensureSimulator()
  return Response.json(getSnapshot().videos)
}

export async function POST(req: Request) {
  ensureSimulator()
  const body = (await req.json().catch(() => ({}))) as { url?: string; title?: string }
  const url = body.url?.trim()
  if (!url) {
    return Response.json({ error: "A YouTube URL is required" }, { status: 400 })
  }
  const video = addVideo(url, body.title)
  return Response.json(video, { status: 201 })
}
