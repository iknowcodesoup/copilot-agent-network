import { startTraining, store } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureSimulator()
  const { id } = await ctx.params
  const voice = store.voices.get(id)
  if (!voice) return Response.json({ error: "Voice not found" }, { status: 404 })
  if (voice.clipIds.length === 0) {
    return Response.json({ error: "Assign at least one clip before training" }, { status: 400 })
  }
  const activeRun = voice.runIds
    .map((r) => store.runs.get(r))
    .find((r) => r?.state === "running")
  if (activeRun) {
    return Response.json({ error: "A training run is already in progress", run: activeRun }, { status: 409 })
  }
  const run = startTraining(id)
  return Response.json(run, { status: 201 })
}
