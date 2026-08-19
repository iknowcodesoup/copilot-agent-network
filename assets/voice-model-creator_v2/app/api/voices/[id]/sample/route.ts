import { log, store, trainingFor, uid } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureSimulator()
  const { id } = await ctx.params
  const voice = store.voices.get(id)
  if (!voice) return Response.json({ error: "Voice not found" }, { status: 404 })
  const progress = trainingFor(voice.name)
  if (!voice.checkpointPath && !(progress && progress.checkpoints.length > 0)) {
    return Response.json({ error: "No checkpoint available to sample yet" }, { status: 400 })
  }
  const body = (await req.json().catch(() => ({}))) as { text?: string }
  const text = body.text?.trim() || "The quick brown fox jumps over the lazy dog."
  const sampleId = uid("sample")
  log(voice.id, `Synthesized sample: "${text.slice(0, 48)}"`)
  return Response.json({ sampleUrl: `synth:${voice.id}:sample`, text, sampleId })
}
