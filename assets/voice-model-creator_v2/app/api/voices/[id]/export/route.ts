import { clipsOfVoice, store, trainingFor } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureSimulator()
  const { id } = await ctx.params
  const { searchParams } = new URL(req.url)
  const ckpt = searchParams.get("ckpt") ?? "latest"

  const voice = store.voices.get(id)
  if (!voice) return Response.json({ error: "Voice not found" }, { status: 404 })

  const progress = trainingFor(voice.name)
  const cp =
    ckpt === "latest"
      ? progress?.checkpoints[progress.checkpoints.length - 1]
      : progress?.checkpoints.find((c) => String(c.epoch) === ckpt)

  // A mock model manifest stands in for the real model weights archive.
  const manifest = {
    format: "voice-model/v1",
    voiceId: voice.id,
    voiceName: voice.name,
    checkpoint: ckpt,
    checkpointPath: cp?.path ?? voice.checkpointPath ?? null,
    epoch: cp?.epoch ?? progress?.currentEpoch ?? null,
    loss: progress?.currentLoss ?? null,
    sampleRate: 24000,
    exportedAt: new Date().toISOString(),
    clipCount: clipsOfVoice(voice.id).length,
    note: "Simulated export. Replace with real weights archive from the training service.",
  }

  const safeName = voice.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}_${ckpt}.voicemodel.json"`,
    },
  })
}
