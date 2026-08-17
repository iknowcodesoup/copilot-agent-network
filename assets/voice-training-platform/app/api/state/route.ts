import { getSnapshot } from "@/lib/store"
import { ensureSimulator } from "@/lib/simulator"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  ensureSimulator()
  return Response.json(getSnapshot())
}
