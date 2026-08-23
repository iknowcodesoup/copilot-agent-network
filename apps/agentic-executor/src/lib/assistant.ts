"use client"

import { useCallback, useMemo } from "react"
import { useRunForVideo, useStudio } from "@/components/studio-provider"
import {
  isActive,
  useAssignRun,
  useCreateVoice,
  useSpeakerBoard,
  useStartRun,
  useTrainVoice,
  useUpdateClips,
  useVoiceList,
  useVoiceRuns,
} from "@/lib/voice_api"
import { runTitle } from "@/features/voices/derive"

/**
 * A framework-agnostic action registry + intent parser.
 * Each action mirrors the shape of a CopilotKit `useCopilotAction` (name,
 * description, parameters, handler) so this can later be swapped to a real
 * CopilotKit runtime + LLM without touching the UI.
 *
 * Every action reads and writes through the same query hooks the components
 * use. It used to go through a StudioProvider wrapper layer instead, which is
 * where "label clip N as X" picked up a voice object the provider had built by
 * hand rather than the row the API returned.
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
  { name: "assignSpeaker", description: "Assign a clip's speaker to a voice", example: "label clip 1 as Narrator A" },
  { name: "createVoice", description: "Create a new voice model", example: "create voice Host" },
  { name: "startTraining", description: "Start a training run for a voice", example: "train Narrator A" },
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
  const {
    selectedRunId,
    selectedVideoId,
    selectedVoiceId,
    setView,
    setSelectedRunId,
    setSelectedVoiceId,
  } = useStudio()

  const runsQuery = useVoiceRuns()
  const voicesQuery = useVoiceList()
  const runForVideo = useRunForVideo(selectedVideoId)
  /* The run the commands act on, and the video its clips belong to. Both are
     resolved from selection, never guessed from whichever run sorts first. */
  const currentRun =
    runForVideo ?? runsQuery.data?.find((run) => run.id === selectedRunId) ?? null
  const currentVideoId = currentRun?.videoId ?? ""

  const board = useSpeakerBoard(currentVideoId, Boolean(currentVideoId))
  const updateClips = useUpdateClips(currentVideoId)
  const assignRun = useAssignRun(currentRun?.id ?? "")
  const startRun = useStartRun()
  const createVoice = useCreateVoice()
  const trainVoice = useTrainVoice()

  const handleMessage = useCallback(
    async (raw: string): Promise<string> => {
      const text = raw.trim()
      const lc = text.toLowerCase()

      const runs = runsQuery.data ?? []
      const voices = voicesQuery.data ?? []
      /* Clips carry no ordinal of their own, so the number the operator types
         is this list's position - the same order the clip table renders. */
      const clips = (board.data?.speakers.flatMap((speaker) => speaker.clips) ?? []).map(
        (clip, index) => ({ ...clip, index }),
      )
      const currentVoice = voices.find((voice) => voice.id === selectedVoiceId)

      const findVoiceByName = (name: string) =>
        voices.find((voice) => voice.name.toLowerCase() === name.toLowerCase()) ??
        voices.find((voice) => voice.name.toLowerCase().includes(name.toLowerCase()))

      /* Resolve or create, the same search-or-create the speaker combobox
         does. Names are unique, so a 409 means someone else created it
         between the search and the POST - re-read rather than fail. */
      const resolveVoice = async (name: string) => {
        const existing = findVoiceByName(name)
        if (existing) return existing
        try {
          const created = await createVoice.mutateAsync(name)
          return { id: created.id, name }
        } catch {
          const raced = findVoiceByName(name)
          return raced ?? null
        }
      }

      // --- addVideo ---
      const urlMatch = text.match(/https?:\/\/\S+/)
      if (urlMatch && (lc.includes("add") || lc.includes("process") || lc.includes("import") || lc.includes("video"))) {
        try {
          await startRun.mutateAsync({
            primaryCharacter: "default",
            sourceUrl: urlMatch[0],
            diarize: true,
            numSpeakers: null,
          })
        } catch (error) {
          return `Sorry, I couldn't queue that URL: ${(error as Error).message}`
        }
        setView("videos")
        return "Queued it for processing. Watch the log for download → transcribe → diarize."
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
        if (findVoiceByName(name)) return `A voice named **${name}** already exists.`
        try {
          const created = await createVoice.mutateAsync(name)
          setView("voices")
          setSelectedVoiceId(created.id)
        } catch (error) {
          return `Couldn't create **${name}**: ${(error as Error).message}`
        }
        return `Created voice model **${name}**. Assign a speaker to it from a video's clip list, then start training.`
      }

      // --- assign a speaker to a voice ---
      const labelMatch = text.match(/(?:label|assign|relabel)\s+clip\s+#?(\d+)\s+(?:as|to)\s+["']?([\w .-]+?)["']?$/i)
      if (labelMatch) {
        if (!currentRun) return "Select a video first so I know which clips you mean."
        const index = Number(labelMatch[1])
        const name = labelMatch[2].trim()
        const clip = clips.find((candidate) => candidate.index === index)
        if (!clip) return `I couldn't find clip #${index} in **${runTitle(currentRun)}**.`
        if (!clip.speakerLabel)
          return `Clip #${index} has no speaker label, so there is nothing to bind a voice to.`
        const voice = await resolveVoice(name)
        if (!voice) return `Couldn't find or create a voice named **${name}**.`
        try {
          /* Spread the run's current map: assign replaces it wholesale, so
             sending one pair alone would erase every other speaker. */
          await assignRun.mutateAsync({
            ...currentRun.voiceAssignments,
            [clip.speakerLabel]: voice.id,
          })
        } catch (error) {
          return `Couldn't assign that speaker: ${(error as Error).message}`
        }
        const shared = clips.filter(
          (candidate) => candidate.speakerLabel === clip.speakerLabel,
        ).length
        return `Assigned **${clip.speakerLabel}** to **${voice.name}** — that is ${shared} clip${shared === 1 ? "" : "s"}, since a voice binds to the speaker rather than one clip.`
      }

      // --- keep / approve ---
      if (lc.includes("keep") || lc.includes("approve")) {
        if (!currentRun) return "Select a video first."
        setSelectedRunId(currentRun.id)
        setView("videos")
        if (lc.includes("all")) {
          const target = clips.filter((clip) => !clip.keep && !clip.flagged)
          if (target.length === 0) return "Nothing left to keep here."
          await updateClips.mutateAsync(
            target.map((clip) => ({ clipId: clip.clipId, keep: true })),
          )
          return `Kept ${target.length} clip${target.length === 1 ? "" : "s"} in **${runTitle(currentRun)}**.`
        }
        const numberMatch = text.match(/#?(\d+)/)
        if (numberMatch) {
          const clip = clips.find((candidate) => candidate.index === Number(numberMatch[1]))
          if (!clip) return `No clip #${numberMatch[1]} here.`
          await updateClips.mutateAsync([{ clipId: clip.clipId, keep: true }])
          return `Kept clip #${numberMatch[1]}.`
        }
        return "Tell me which clip, e.g. “keep clip 3” or “keep all clips”."
      }

      // --- discard / reject ---
      if (lc.includes("discard") || lc.includes("reject")) {
        if (!currentRun) return "Select a video first."
        setSelectedRunId(currentRun.id)
        setView("videos")
        const discard = async (target: typeof clips, what: string) => {
          if (target.length === 0) return `No ${what} to discard.`
          await updateClips.mutateAsync(
            target.map((clip) => ({ clipId: clip.clipId, keep: false })),
          )
          return `Discarded ${target.length} ${what}.`
        }
        if (lc.includes("flagged") || lc.includes("noisy"))
          return discard(clips.filter((clip) => clip.flagged && clip.keep), "flagged clips")
        if (lc.includes("all"))
          return discard(clips.filter((clip) => clip.keep), "clips")
        const numberMatch = text.match(/#?(\d+)/)
        if (numberMatch) {
          const clip = clips.find((candidate) => candidate.index === Number(numberMatch[1]))
          if (!clip) return `No clip #${numberMatch[1]} here.`
          await updateClips.mutateAsync([{ clipId: clip.clipId, keep: false }])
          return `Discarded clip #${numberMatch[1]}.`
        }
        return "Tell me which clip, e.g. “discard clip 2” or “discard flagged clips”."
      }

      // --- start training ---
      if (lc.includes("train")) {
        const nameMatch = text.match(/train(?:ing)?\s+(?:run\s+)?(?:for\s+)?["']?([\w .-]+?)["']?$/i)
        const voice =
          (nameMatch ? findVoiceByName(nameMatch[1].trim()) : undefined) ?? currentVoice
        if (!voice) return "Which voice should I train? e.g. “train Narrator A”."
        if (voice.contributions.length === 0)
          return `**${voice.name}** has no speakers assigned yet, so there is nothing to train on.`
        setView("voices")
        setSelectedVoiceId(voice.id)
        try {
          await trainVoice.mutateAsync(voice.id)
        } catch (error) {
          return `Couldn't start training for **${voice.name}**: ${(error as Error).message}`
        }
        return `Started a training run for **${voice.name}**. It'll stream epoch/loss progress and emit checkpoints.`
      }

      // --- status / summary ---
      if (lc.includes("status") || lc.includes("summary") || lc.includes("how many") || lc.includes("what")) {
        const inProgress = runs.filter((run) => isActive(run.phase)).length
        const done = runs.filter((run) => run.phase === "awaiting_review" || run.phase === "ready").length
        const failed = runs.filter((run) => run.phase === "failed").length
        const training = voices.filter((voice) => voice.phase === "training").length
        const assigned = voices.filter((voice) => voice.contributions.length > 0).length
        return [
          `**Pipeline:** ${runs.length} runs — ${inProgress} in progress, ${done} ready, ${failed} failed.`,
          currentRun
            ? `**Clips (selected video):** ${clips.length} total, ${clips.filter((clip) => clip.keep).length} kept.`
            : "**Clips:** select a video to see its clips.",
          `**Voices:** ${voices.length} models, ${assigned} with speakers assigned, ${training} training now.`,
        ].join("\n")
      }

      return "I can add videos, keep/discard clips, assign speakers to voices, create voices, and start training. Try “keep all clips” or “train Narrator A”."
    },
    [
      runsQuery.data,
      voicesQuery.data,
      board.data,
      currentRun,
      selectedVoiceId,
      setView,
      setSelectedRunId,
      setSelectedVoiceId,
      updateClips,
      assignRun,
      startRun,
      createVoice,
      trainVoice,
    ],
  )

  return useMemo(() => ({ handleMessage, suggestions: SUGGESTIONS, actions: ACTION_CATALOG }), [handleMessage])
}
