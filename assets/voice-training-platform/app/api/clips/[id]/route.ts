import { assignClipToVoice, log, patchClip, store } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"
import type { ClipStatus } from "@/lib/types"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureSimulator()
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as {
    speakerLabel?: string
    sttText?: string
    status?: ClipStatus
    assignVoice?: string
  }

  const existing = store.clips.get(id)
  if (!existing) return Response.json({ error: "Clip not found" }, { status: 404 })

  // Relabeling to a voice name assigns the clip to that voice model.
  if (body.assignVoice) {
    const voice = assignClipToVoice(id, body.assignVoice)
    log(existing.videoId, "info", "assign", `Clip #${existing.index} → voice "${body.assignVoice}"`)
    return Response.json({ clip: store.clips.get(id), voice })
  }

  const clip = patchClip(id, {
    speakerLabel: body.speakerLabel,
    sttText: body.sttText,
    status: body.status,
  })
  if (!clip) return Response.json({ error: "Clip not found" }, { status: 404 })

  if (body.status) {
    log(clip.videoId, body.status === "approved" ? "success" : "warn", "review", `Clip #${clip.index} ${clip.status}`)
  }
  return Response.json({ clip })
}
