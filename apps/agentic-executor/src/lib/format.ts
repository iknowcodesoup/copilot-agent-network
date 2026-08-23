export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 10)
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`
  return `${s}.${ms}s`
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
