export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 10)
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`
  return `${s}.${ms}s`
}

/* For a sum of many clips, not one clip - hours-aware, so a training set past
   an hour reads as "1:01:01" instead of a misleadingly large minute count. */
export function formatTotalDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
