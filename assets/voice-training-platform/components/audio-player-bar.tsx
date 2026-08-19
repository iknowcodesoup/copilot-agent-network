"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Play, Pause } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/lib/format"

// Deterministic seed from a string so each clip "sounds" consistent.
function seedFrom(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

export function AudioPlayerBar({
  peaks,
  durationSec,
  seed,
  disabled,
  accent = "var(--primary)",
}: {
  peaks: number[]
  durationSec: number
  seed: string
  disabled?: boolean
  accent?: string
}) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const ctxRef = useRef<AudioContext | null>(null)
  const nodesRef = useRef<{ osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode } | null>(null)
  const rafRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)

  const stop = useCallback(() => {
    if (nodesRef.current) {
      try {
        nodesRef.current.osc.stop()
        nodesRef.current.lfo.stop()
      } catch {
        /* already stopped */
      }
      nodesRef.current = null
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setPlaying(false)
  }, [])

  useEffect(() => () => stop(), [stop])

  const tick = useCallback(() => {
    if (!ctxRef.current) return
    const elapsed = ctxRef.current.currentTime - startedAtRef.current + offsetRef.current
    const p = Math.min(1, elapsed / durationSec)
    setProgress(p)
    if (p >= 1) {
      stop()
      setProgress(0)
      offsetRef.current = 0
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [durationSec, stop])

  const play = useCallback(
    (fromOffset: number) => {
      if (disabled) return
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!ctxRef.current) ctxRef.current = new Ctx()
      const ctx = ctxRef.current
      void ctx.resume()

      const s = seedFrom(seed)
      const baseFreq = 110 + (s % 140) // 110–250 Hz, voice-ish fundamental

      const osc = ctx.createOscillator()
      osc.type = "sawtooth"
      osc.frequency.value = baseFreq

      // gentle vibrato so it reads as "speech-like", not a flat tone
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 4 + (s % 3)
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 6
      lfo.connect(lfoGain).connect(osc.frequency)

      const gain = ctx.createGain()
      gain.gain.value = 0.0001

      const lp = ctx.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 900

      osc.connect(lp).connect(gain).connect(ctx.destination)

      const now = ctx.currentTime
      const remaining = durationSec * (1 - fromOffset)
      // amplitude envelope driven by the waveform peaks
      gain.gain.setValueAtTime(0.0001, now)
      const startPeak = Math.floor(fromOffset * peaks.length)
      for (let i = startPeak; i < peaks.length; i++) {
        const t = now + ((i - startPeak) / peaks.length) * remaining
        gain.gain.linearRampToValueAtTime(Math.max(0.0005, peaks[i] * 0.05), t)
      }
      gain.gain.linearRampToValueAtTime(0.0001, now + remaining)

      osc.start()
      lfo.start()
      osc.stop(now + remaining + 0.05)
      lfo.stop(now + remaining + 0.05)

      nodesRef.current = { osc, gain, lfo }
      startedAtRef.current = ctx.currentTime
      offsetRef.current = fromOffset * durationSec
      setPlaying(true)
      rafRef.current = requestAnimationFrame(tick)

      osc.onended = () => {
        if (nodesRef.current?.osc === osc) stop()
      }
    },
    [disabled, durationSec, peaks, seed, stop, tick],
  )

  const toggle = () => {
    if (playing) stop()
    else play(progress >= 1 ? 0 : progress)
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    stop()
    setProgress(ratio)
    play(ratio)
  }

  return (
    <div className={cn("flex items-center gap-2.5", disabled && "opacity-50")}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={playing ? "Pause clip" : "Play clip"}
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed"
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
      </button>

      <div
        onClick={seek}
        role="slider"
        aria-label="Audio position"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={disabled ? -1 : 0}
        className="group flex h-8 flex-1 cursor-pointer items-center gap-px overflow-hidden"
      >
        {peaks.map((p, i) => {
          const played = i / peaks.length <= progress
          return (
            <span
              key={i}
              className="flex-1 rounded-full transition-colors"
              style={{
                height: `${Math.max(10, p * 100)}%`,
                backgroundColor: played ? accent : "var(--muted-foreground)",
                opacity: played ? 0.95 : 0.35,
              }}
            />
          )
        })}
      </div>

      <span className="w-10 shrink-0 text-right font-mono text-[0.7rem] tabular-nums text-muted-foreground">
        {formatDuration(durationSec)}
      </span>
    </div>
  )
}
