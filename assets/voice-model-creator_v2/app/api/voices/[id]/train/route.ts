import { clipsOfVoice, startTraining, store, trainingFor } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureSimulator()
  const { id } = await ctx.params
  const voice = store.voices.get(id)
  if (!voice) return Response.json({ error: "Voice not found" }, { status: 404 })
  if (clipsOfVoice(id).length === 0) {
    return Response.json({ error: "Assign at least one clip before training" }, { status: 400 })
  }
  const existing = trainingFor(voice.name)
  if (existing?.runningJobId) {
    return Response.json(
      { error: "A training run is already in progress", progress: existing },
      { status: 409 },
    )
  }
  const progress = startTraining(id)
  return Response.json(progress, { status: 201 })
}
