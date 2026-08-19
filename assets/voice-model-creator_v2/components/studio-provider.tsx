"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  LogLine,
  Snapshot,
  StudioClip,
  TrainingProgress,
  VideoResult,
  VoiceDetail,
  VoiceRun,
} from "@/lib/types"

type View = "videos" | "voices"

interface StudioContextValue {
  snapshot: Snapshot
  logs: LogLine[]
  connected: boolean
  view: View
  setView: (v: View) => void
  selectedRunId: string | null
  setSelectedRunId: (id: string | null) => void
  selectedVoiceId: string | null
  setSelectedVoiceId: (id: string | null) => void
  logFilter: string
  setLogFilter: (k: string) => void
  // derived helpers
  clipsForRun: (runId: string) => StudioClip[]
  clipsForVoice: (voiceId: string) => StudioClip[]
  videoForRun: (run: VoiceRun) => VideoResult | undefined
  trainingForVoice: (voice: VoiceDetail) => TrainingProgress | undefined
  // actions
  addVideo: (url: string, title?: string) => Promise<VoiceRun | null>
  updateClip: (
    clipId: string,
    patch: { speakerLabel?: string; text?: string; keep?: boolean },
  ) => Promise<void>
  assignClipVoice: (clipId: string, voiceName: string) => Promise<void>
  createVoice: (name: string) => Promise<VoiceDetail | null>
  startTraining: (voiceId: string) => Promise<{ error?: string } | null>
  sampleVoice: (voiceId: string, text?: string) => Promise<{ error?: string; text?: string } | null>
  exportVoice: (voiceId: string, ckpt?: string) => void
}

const StudioContext = createContext<StudioContextValue | null>(null)

const EMPTY: Snapshot = { runs: [], videos: [], clips: [], voices: [], training: [] }

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [connected, setConnected] = useState(false)
  const [view, setView] = useState<View>("videos")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null)
  const [logFilter, setLogFilter] = useState<string>("all")
  const seenLogIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const es = new EventSource("/api/stream?key=all")
    es.addEventListener("open", () => setConnected(true))
    es.addEventListener("error", () => setConnected(false))
    es.addEventListener("state", (e) => {
      try {
        setSnapshot(JSON.parse((e as MessageEvent).data) as Snapshot)
      } catch {
        /* ignore */
      }
    })
    es.addEventListener("log", (e) => {
      try {
        const evt = JSON.parse((e as MessageEvent).data) as LogLine
        if (seenLogIds.current.has(evt.id)) return
        seenLogIds.current.add(evt.id)
        setLogs((prev) => {
          const next = [...prev, evt]
          return next.length > 600 ? next.slice(next.length - 600) : next
        })
      } catch {
        /* ignore */
      }
    })
    return () => es.close()
  }, [])

  const clipsForRun = useCallback(
    (runId: string) =>
      snapshot.clips.filter((c) => c.runId === runId).sort((a, b) => a.index - b.index),
    [snapshot.clips],
  )

  const clipsForVoice = useCallback(
    (voiceId: string) => snapshot.clips.filter((c) => c.assignedVoiceId === voiceId),
    [snapshot.clips],
  )

  const videoForRun = useCallback(
    (run: VoiceRun) => snapshot.videos.find((v) => v.videoId === run.videoId),
    [snapshot.videos],
  )

  const trainingForVoice = useCallback(
    (voice: VoiceDetail) =>
      snapshot.training.find((t) => t.character.toLowerCase() === voice.name.toLowerCase()),
    [snapshot.training],
  )

  const addVideo = useCallback(async (url: string, title?: string) => {
    const res = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title }),
    })
    if (!res.ok) return null
    return (await res.json()) as VoiceRun
  }, [])

  const updateClip = useCallback(
    async (clipId: string, patch: { speakerLabel?: string; text?: string; keep?: boolean }) => {
      // optimistic update
      setSnapshot((prev) => ({
        ...prev,
        clips: prev.clips.map((c) => (c.clipId === clipId ? { ...c, ...patch } : c)),
      }))
      await fetch(`/api/clips/${clipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
    },
    [],
  )

  const assignClipVoice = useCallback(async (clipId: string, voiceName: string) => {
    setSnapshot((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.clipId === clipId ? { ...c, speakerLabel: voiceName } : c)),
    }))
    await fetch(`/api/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignVoice: voiceName }),
    })
  }, [])

  const createVoice = useCallback(async (name: string) => {
    const res = await fetch("/api/voices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return null
    return (await res.json()) as VoiceDetail
  }, [])

  const startTraining = useCallback(async (voiceId: string) => {
    const res = await fetch(`/api/voices/${voiceId}/train`, { method: "POST" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: (data as { error?: string }).error ?? "Failed to start training" }
    return null
  }, [])

  const sampleVoice = useCallback(async (voiceId: string, text?: string) => {
    const res = await fetch(`/api/voices/${voiceId}/sample`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: (data as { error?: string }).error ?? "Failed to sample" }
    return data as { text?: string }
  }, [])

  const exportVoice = useCallback((voiceId: string, ckpt?: string) => {
    const url = `/api/voices/${voiceId}/export${ckpt ? `?ckpt=${ckpt}` : ""}`
    window.open(url, "_blank")
  }, [])

  const value = useMemo<StudioContextValue>(
    () => ({
      snapshot,
      logs,
      connected,
      view,
      setView,
      selectedRunId,
      setSelectedRunId,
      selectedVoiceId,
      setSelectedVoiceId,
      logFilter,
      setLogFilter,
      clipsForRun,
      clipsForVoice,
      videoForRun,
      trainingForVoice,
      addVideo,
      updateClip,
      assignClipVoice,
      createVoice,
      startTraining,
      sampleVoice,
      exportVoice,
    }),
    [
      snapshot,
      logs,
      connected,
      view,
      selectedRunId,
      selectedVoiceId,
      logFilter,
      clipsForRun,
      clipsForVoice,
      videoForRun,
      trainingForVoice,
      addVideo,
      updateClip,
      assignClipVoice,
      createVoice,
      startTraining,
      sampleVoice,
      exportVoice,
    ],
  )

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}

export function useStudio() {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error("useStudio must be used within StudioProvider")
  return ctx
}
