"use client"

import { useCallback, useMemo } from "react"
import { useStudio } from "@/components/studio-provider"
import { isPhaseActive, runTitle } from "@/lib/derive"

/**
 * A framework-agnostic action registry + intent parser.
 * Each action mirrors the shape of a CopilotKit `useCopilotAction` (name,
 * description, parameters, handler) so this can later be swapped to a real
 * CopilotKit runtime + LLM without touching the UI or the studio actions.
 */

export interface AssistantAction {
  name: string
  description: string
  example: string
}

export const ACTION_CATALOG: AssistantAction[] = [
  { name: "addVideo", description: "Queue a YouTube URL for processing", example: "add video https://youtube.com/watch?v=…" },
  { name: "switchView", description: "Switch between Videos and Voices", example: "show voices" },
  { name: "keepClip", description: "Keep clips (by number or all)", example: "keep clip 3" },
  { name: "discardClip", description: "Discard clips", example: "discard clip 2" },
  { name: "labelClip", description: "Relabel a clip's speaker / assign to a voice", example: "label clip 1 as Narrator A" },
  { name: "createVoice", description: "Create a new voice model", example: "create voice Host" },
  { name: "startTraining", description: "Start a training run for a voice", example: "train Narrator A" },
  { name: "sampleVoice", description: "Synthesize a sample from a voice", example: "sample Narrator A saying hello world" },
  { name: "exportVoice", description: "Export / download a voice model", example: "export Narrator A" },
  { name: "status", description: "Summarize pipeline & voice status", example: "status" },
]

export const SUGGESTIONS = [
  "status",
  "show voices",
  "keep all clips",
  "discard flagged clips",
  "train Narrator A",
]

export function useAssistant() {
  const studio = useStudio()

  const handleMessage = useCallback(
    async (raw: string): Promise<string> => {
      const text = raw.trim()
      const lc = text.toLowerCase()
      const {
        snapshot,
        selectedRunId,
        selectedVoiceId,
        setView,
        setSelectedRunId,
        setSelectedVoiceId,
        clipsForRun,
        addVideo,
        updateClip,
        assignClipVoice,
        createVoice,
        startTraining,
        sampleVoice,
        exportVoice,
      } = studio

      const findVoiceByName = (q: string) =>
        snapshot.voices.find((v) => v.name.toLowerCase() === q.toLowerCase()) ??
        snapshot.voices.find((v) => v.name.toLowerCase().includes(q.toLowerCase()))

      // No fallback to the first entry. "Whatever sorts first" is not what the
      // operator meant, and every command below already refuses a missing one.
      const currentRun = snapshot.runs.find((r) => r.id === selectedRunId)
      const currentVoice = snapshot.voices.find((v) => v.id === selectedVoiceId)

      // --- addVideo ---
      const urlMatch = text.match(/https?:\/\/\S+/)
      if (urlMatch && (lc.includes("add") || lc.includes("process") || lc.includes("import") || lc.includes("video"))) {
        const r = await addVideo(urlMatch[0])
        setView("videos")
        return r ? `Queued **${runTitle(r)}** for processing. Watch the log for download → transcribe → diarize.` : "Sorry, I couldn't queue that URL."
      }

      // --- switchView ---
      if (/\b(show|switch to|open|go to)\b.*\bvoices?\b/.test(lc) || lc === "voices") {
        setView("voices")
        return "Switched to the **Voices** view."
      }
      if (/\b(show|switch to|open|go to)\b.*\bvideos?\b/.test(lc) || lc === "videos") {
        setView("videos")
        return "Switched to the **Videos** view."
      }

      // --- create voice ---
      const createMatch = text.match(/create (?:a )?voice(?: (?:named|called))?\s+["']?([\w .-]+?)["']?$/i)
      if (createMatch) {
        const name = createMatch[1].trim()
        const v = await createVoice(name)
        setView("voices")
        if (v) setSelectedVoiceId(v.id)
        return `Created voice model **${name}**. Assign clips to it by relabeling speakers, then start training.`
      }

      // --- label / assign clip ---
      const labelMatch = text.match(/(?:label|assign|relabel)\s+clip\s+#?(\d+)\s+(?:as|to)\s+["']?([\w .-]+?)["']?$/i)
      if (labelMatch) {
        if (!currentRun) return "Select a video first so I know which clips you mean."
        const idx = Number(labelMatch[1])
        const name = labelMatch[2].trim()
        const clip = clipsForRun(currentRun.id).find((c) => c.index === idx)
        if (!clip) return `I couldn't find clip #${idx} in **${runTitle(currentRun)}**.`
        // assignClipVoice needs a real Voice id, never a typed name (that's
        // the bug this command used to have) - resolve or create first, the
        // same search-or-create the speaker combobox does.
        let voice = findVoiceByName(name)
        if (!voice) voice = (await createVoice(name)) ?? undefined
        if (!voice) return `Couldn't find or create a voice named **${name}**.`
        await assignClipVoice(clip.clipId, voice.id)
        return `Relabeled clip #${idx} → **${voice.name}** and assigned it to that voice.`
      }

      // --- keep / approve ---
      if (lc.includes("keep") || lc.includes("approve")) {
        if (!currentRun) return "Select a video first."
        setSelectedRunId(currentRun.id)
        setView("videos")
        if (lc.includes("all")) {
          const target = clipsForRun(currentRun.id).filter((c) => !c.keep && !c.flagged)
          await Promise.all(target.map((c) => updateClip(c.clipId, { keep: true })))
          return `Kept ${target.length} clip${target.length === 1 ? "" : "s"} in **${runTitle(currentRun)}**.`
        }
        const n = text.match(/#?(\d+)/)
        if (n) {
          const clip = clipsForRun(currentRun.id).find((c) => c.index === Number(n[1]))
          if (!clip) return `No clip #${n[1]} here.`
          await updateClip(clip.clipId, { keep: true })
          return `Kept clip #${n[1]}.`
        }
        return "Tell me which clip, e.g. “keep clip 3” or “keep all clips”."
      }

      // --- discard / reject ---
      if (lc.includes("discard") || lc.includes("reject")) {
        if (!currentRun) return "Select a video first."
        setSelectedRunId(currentRun.id)
        setView("videos")
        if (lc.includes("flagged") || lc.includes("noisy")) {
          const flagged = clipsForRun(currentRun.id).filter((c) => c.flagged && c.keep)
          await Promise.all(flagged.map((c) => updateClip(c.clipId, { keep: false })))
          return `Discarded ${flagged.length} flagged clip${flagged.length === 1 ? "" : "s"}.`
        }
        if (lc.includes("all")) {
          const kept = clipsForRun(currentRun.id).filter((c) => c.keep)
          await Promise.all(kept.map((c) => updateClip(c.clipId, { keep: false })))
          return `Discarded ${kept.length} clip${kept.length === 1 ? "" : "s"}.`
        }
        const n = text.match(/#?(\d+)/)
        if (n) {
          const clip = clipsForRun(currentRun.id).find((c) => c.index === Number(n[1]))
          if (!clip) return `No clip #${n[1]} here.`
          await updateClip(clip.clipId, { keep: false })
          return `Discarded clip #${n[1]}.`
        }
        return "Tell me which clip, e.g. “discard clip 2” or “discard flagged clips”."
      }

      // --- start training ---
      if (lc.includes("train")) {
        const m = text.match(/train(?:ing)?\s+(?:run\s+)?(?:for\s+)?["']?([\w .-]+?)["']?$/i)
        let voice = m ? findVoiceByName(m[1].trim()) : undefined
        if (!voice && (lc.includes("this") || lc.includes("selected"))) voice = currentVoice
        if (!voice) voice = currentVoice
        if (!voice) return "Which voice should I train? e.g. “train Narrator A”."
        setView("voices")
        setSelectedVoiceId(voice.id)
        const res = await startTraining(voice.id)
        if (res?.error) return `Couldn't start training for **${voice.name}**: ${res.error}`
        return `Started a training run for **${voice.name}**. It'll stream epoch/loss progress and emit checkpoints.`
      }

      // --- sample ---
      if (lc.includes("sample")) {
        const saying = text.match(/saying\s+["']?(.+?)["']?$/i)
        const nameM = text.match(/sample\s+(?:voice\s+)?["']?([\w .-]+?)["']?(?:\s+saying|$)/i)
        let voice = nameM ? findVoiceByName(nameM[1].trim()) : undefined
        if (!voice) voice = currentVoice
        if (!voice) return "Which voice should I sample?"
        setView("voices")
        setSelectedVoiceId(voice.id)
        const res = await sampleVoice(voice.id, saying?.[1])
        if (res && "error" in res && res.error) return `Can't sample **${voice.name}**: ${res.error}`
        return `Synthesized a sample from **${voice.name}**${saying ? ` saying “${saying[1]}”` : ""}. Open the Voices view to play it.`
      }

      // --- export ---
      if (lc.includes("export") || lc.includes("download")) {
        const m = text.match(/(?:export|download)\s+(?:voice\s+)?["']?([\w .-]+?)["']?$/i)
        let voice = m ? findVoiceByName(m[1].trim()) : undefined
        if (!voice) voice = currentVoice
        if (!voice) return "Which voice model should I export?"
        if (!voice.checkpointPath) return `**${voice.name}** has no checkpoint yet — train it first.`
        exportVoice(voice.id)
        return `Exporting **${voice.name}** — the model manifest download should begin.`
      }

      // --- status / summary ---
      if (lc.includes("status") || lc.includes("summary") || lc.includes("how many") || lc.includes("what")) {
        const runs = snapshot.runs
        const inProg = runs.filter((r) => isPhaseActive(r.phase)).length
        const done = runs.filter((r) => r.phase === "awaiting_review" || r.phase === "ready").length
        const failed = runs.filter((r) => r.phase === "failed").length
        const clips = snapshot.clips.length
        const kept = snapshot.clips.filter((c) => c.keep).length
        const training = snapshot.training.filter((t) => t.runningJobId).length
        return [
          `**Pipeline:** ${runs.length} videos — ${inProg} in progress, ${done} ready, ${failed} failed.`,
          `**Clips:** ${clips} total, ${kept} kept.`,
          `**Voices:** ${snapshot.voices.length} models, ${training} training now.`,
        ].join("\n")
      }

      return "I can add videos, keep/discard/label clips, create & train voices, sample, and export. Try “keep all clips” or “train Narrator A”."
    },
    [studio],
  )

  return useMemo(() => ({ handleMessage, suggestions: SUGGESTIONS, actions: ACTION_CATALOG }), [handleMessage])
}
