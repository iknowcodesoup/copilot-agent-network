"use client"

import { useCallback, useMemo } from "react"
import { useStudio } from "@/components/studio-provider"
import type { ClipStatus } from "@/lib/types"

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
  { name: "approveClip", description: "Approve clips (by number or all pending)", example: "approve clip 3" },
  { name: "rejectClip", description: "Reject clips", example: "reject clip 2" },
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
  "approve all pending",
  "reject noisy clips",
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
        selectedVideoId,
        selectedVoiceId,
        setView,
        setSelectedVideoId,
        setSelectedVoiceId,
        clipsForVideo,
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

      const currentVideo = snapshot.videos.find((v) => v.id === selectedVideoId) ?? snapshot.videos[0]
      const currentVoice = snapshot.voices.find((v) => v.id === selectedVoiceId) ?? snapshot.voices[0]

      // --- addVideo ---
      const urlMatch = text.match(/https?:\/\/\S+/)
      if (urlMatch && (lc.includes("add") || lc.includes("process") || lc.includes("import") || lc.includes("video"))) {
        const v = await addVideo(urlMatch[0])
        setView("videos")
        return v ? `Queued **${v.title}** for processing. Watch the log for download → transcribe → diarize.` : "Sorry, I couldn't queue that URL."
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
        if (!currentVideo) return "Select a video first so I know which clips you mean."
        const idx = Number(labelMatch[1])
        const name = labelMatch[2].trim()
        const clip = clipsForVideo(currentVideo.id).find((c) => c.index === idx)
        if (!clip) return `I couldn't find clip #${idx} in **${currentVideo.title}**.`
        await assignClipVoice(clip.id, name)
        return `Relabeled clip #${idx} → **${name}** and assigned it to that voice.`
      }

      // --- approve ---
      if (lc.includes("approve")) {
        if (!currentVideo) return "Select a video first."
        setSelectedVideoId(currentVideo.id)
        setView("videos")
        if (lc.includes("all")) {
          const pending = clipsForVideo(currentVideo.id).filter((c) => c.status === "pending" && !c.noisy)
          await Promise.all(pending.map((c) => updateClip(c.id, { status: "approved" })))
          return `Approved ${pending.length} pending clip${pending.length === 1 ? "" : "s"} in **${currentVideo.title}**.`
        }
        const n = text.match(/#?(\d+)/)
        if (n) {
          const clip = clipsForVideo(currentVideo.id).find((c) => c.index === Number(n[1]))
          if (!clip) return `No clip #${n[1]} here.`
          if (clip.noisy) return `Clip #${n[1]} is flagged noisy and can't be approved.`
          await updateClip(clip.id, { status: "approved" })
          return `Approved clip #${n[1]}.`
        }
        return "Tell me which clip, e.g. “approve clip 3” or “approve all pending”."
      }

      // --- reject ---
      if (lc.includes("reject")) {
        if (!currentVideo) return "Select a video first."
        setSelectedVideoId(currentVideo.id)
        setView("videos")
        if (lc.includes("noisy")) {
          const noisy = clipsForVideo(currentVideo.id).filter((c) => c.noisy && c.status !== "rejected")
          await Promise.all(noisy.map((c) => updateClip(c.id, { status: "rejected" })))
          return `Rejected ${noisy.length} noisy clip${noisy.length === 1 ? "" : "s"}.`
        }
        if (lc.includes("all")) {
          const pend = clipsForVideo(currentVideo.id).filter((c) => c.status === "pending")
          await Promise.all(pend.map((c) => updateClip(c.id, { status: "rejected" })))
          return `Rejected ${pend.length} pending clip${pend.length === 1 ? "" : "s"}.`
        }
        const n = text.match(/#?(\d+)/)
        if (n) {
          const clip = clipsForVideo(currentVideo.id).find((c) => c.index === Number(n[1]))
          if (!clip) return `No clip #${n[1]} here.`
          await updateClip(clip.id, { status: "rejected" as ClipStatus })
          return `Rejected clip #${n[1]}.`
        }
        return "Tell me which clip, e.g. “reject clip 2” or “reject noisy clips”."
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
        return `Started a training run for **${voice.name}**. It'll stream progress and emit checkpoints over the coming hours.`
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
        if (!voice.latestCheckpointId) return `**${voice.name}** has no checkpoint yet — train it first.`
        exportVoice(voice.id)
        return `Exporting **${voice.name}** — the model manifest download should begin.`
      }

      // --- status / summary ---
      if (lc.includes("status") || lc.includes("summary") || lc.includes("how many") || lc.includes("what")) {
        const vids = snapshot.videos
        const inProg = vids.filter((v) => v.state === "in-progress").length
        const done = vids.filter((v) => v.state === "complete").length
        const failed = vids.filter((v) => v.state === "failed").length
        const clips = snapshot.clips.length
        const approved = snapshot.clips.filter((c) => c.status === "approved").length
        const training = snapshot.runs.filter((r) => r.state === "running").length
        return [
          `**Pipeline:** ${vids.length} videos — ${inProg} in progress, ${done} complete, ${failed} failed.`,
          `**Clips:** ${clips} total, ${approved} approved.`,
          `**Voices:** ${snapshot.voices.length} models, ${training} training now.`,
        ].join("\n")
      }

      return "I can add videos, approve/reject/label clips, create & train voices, sample, and export. Try “approve all pending” or “train Narrator A”."
    },
    [studio],
  )

  return useMemo(() => ({ handleMessage, suggestions: SUGGESTIONS, actions: ACTION_CATALOG }), [handleMessage])
}
