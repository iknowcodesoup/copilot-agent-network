"use client"

import { useMemo } from "react"
import {
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2"
import { z } from "zod"
import { useRunForVideo, useStudio } from "./studio_provider"
import {
  isActive,
  useAssignRun,
  useStartRun,
  useVoiceRuns,
} from "@/features/voices/api/use_voice_runs"
import { useSpeakerBoard, useUpdateClips } from "@/features/voices/api/use_videos"
import {
  useCreateVoice,
  useTrainVoice,
  useVoiceList,
} from "@/features/voices/api/use_voices"
import { runTitle } from "@/features/voices/derive"

/**
 * Registers the studio with CopilotKit: what the agent can see, and what it
 * can do.
 *
 * Every tool here is a *frontend* tool. The orchestrator emits the call and
 * ends its run; CopilotKit executes the handler in the browser, appends the
 * result, and posts a follow-up run so the model can report what happened.
 * That hand-off is the only way a browser tool can answer, because AG-UI
 * carries no state between runs - see the header of chat_agent.py.
 *
 * Every handler reads and writes through the same query hooks the components
 * use, so a tool call and a click land on identical cache state.
 *
 * Renders nothing. It must sit inside CopilotProvider, StudioProvider and
 * QueryClientProvider, because it uses all three.
 */

const CLIP_TEXT_LIMIT = 120

export function CopilotStudioTools() {
  const {
    view,
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

  /* The run the tools act on, and the video its clips belong to. Both resolve
     from selection, never from whichever run happens to sort first. */
  const currentRun =
    runForVideo ?? runsQuery.data?.find((run) => run.id === selectedRunId) ?? null
  const currentVideoId = currentRun?.videoId ?? ""

  const board = useSpeakerBoard(currentVideoId, Boolean(currentVideoId))
  const updateClips = useUpdateClips(currentVideoId)
  const assignRun = useAssignRun(currentRun?.id ?? "")
  const startRun = useStartRun()
  const createVoice = useCreateVoice()
  const trainVoice = useTrainVoice()

  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data])
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data])

  /* Clips carry no ordinal of their own, so the number the operator types is
     this list's position - the same order the clip table renders. */
  const clips = useMemo(
    () =>
      (board.data?.speakers.flatMap((speaker) => speaker.clips) ?? []).map(
        (clip, index) => ({ ...clip, index }),
      ),
    [board.data],
  )

  const findVoiceByName = (name: string) =>
    voices.find((voice) => voice.name.toLowerCase() === name.toLowerCase()) ??
    voices.find((voice) => voice.name.toLowerCase().includes(name.toLowerCase()))

  /* Resolve or create, the same search-or-create the speaker combobox does.
     Names are unique, so a 409 means someone else created it between the
     search and the POST - re-read rather than fail. */
  const resolveVoice = async (name: string) => {
    const existing = findVoiceByName(name)
    if (existing) return existing
    try {
      const created = await createVoice.mutateAsync(name)
      return { id: created.id, name }
    } catch {
      return findVoiceByName(name) ?? null
    }
  }

  // ── State injection ──────────────────────────────────────────────────────
  //
  // Four separate contexts rather than one blob: each carries its own
  // description, so the model is told what it is reading rather than left to
  // infer it from key names.

  useAgentContext({
    description:
      "What the operator is looking at right now in the voice studio UI",
    value: {
      view,
      selectedRunId: selectedRunId ?? null,
      selectedVideoId: selectedVideoId || null,
      selectedVoiceId: selectedVoiceId ?? null,
      selectedRunTitle: currentRun ? runTitle(currentRun) : null,
    },
  })

  useAgentContext({
    description:
      "Every voice run in the ingest pipeline. phase is the state machine, " +
      "and only the reconciler writes it.",
    value: {
      total: runs.length,
      inProgress: runs.filter((run) => isActive(run.phase)).length,
      failed: runs.filter((run) => run.phase === "failed").length,
      runs: runs.map((run) => ({
        id: run.id,
        title: runTitle(run),
        phase: run.phase,
        videoId: run.videoId,
      })),
    },
  })

  useAgentContext({
    description: "Every trained or in-training voice model",
    value: voices.map((voice) => ({
      id: voice.id,
      name: voice.name,
      phase: voice.phase,
      speakerCount: voice.contributions.length,
    })),
  })

  useAgentContext({
    description:
      "Clips of the selected video, numbered exactly as the operator sees " +
      "them in the clip table. Empty until a video is selected.",
    value: clips.map((clip) => ({
      number: clip.index,
      speakerLabel: clip.speakerLabel,
      keep: clip.keep,
      flagged: clip.flagged,
      assignedVoice: clip.assignedVoice,
      text: clip.text.slice(0, CLIP_TEXT_LIMIT),
    })),
  })

  // ── Tools ────────────────────────────────────────────────────────────────

  useFrontendTool({
    name: "addVideo",
    description:
      "Queue a YouTube URL for processing. Starts a run that downloads, " +
      "transcribes, and splits the audio by speaker.",
    parameters: z.object({
      url: z.string().describe("The full YouTube URL to ingest"),
    }),
    handler: async ({ url }) => {
      const run = await startRun.mutateAsync({
        primaryCharacter: "default",
        sourceUrl: url,
        diarize: true,
        numSpeakers: null,
      })
      setView("videos")
      return { queued: true, runId: run.id, url }
    },
  }, [startRun, setView])

  useFrontendTool({
    name: "switchView",
    description: "Switch the studio between the Videos, Voices and Search views",
    parameters: z.object({
      view: z.enum(["videos", "voices", "search"]).describe("The view to show"),
    }),
    handler: async ({ view: target }) => {
      setView(target)
      return { view: target }
    },
  }, [setView])

  useFrontendTool({
    name: "keepClips",
    description:
      "Mark clips of the selected video as kept, so they train the voice. " +
      "Pass clip numbers, or set all to true for every clip not yet kept.",
    parameters: z.object({
      clipNumbers: z
        .array(z.number())
        .optional()
        .describe("Clip numbers as shown in the clip table"),
      all: z.boolean().optional().describe("Keep every clip not already kept"),
    }),
    handler: async ({ clipNumbers, all }) => {
      if (!currentRun) return { error: "No video is selected." }
      setSelectedRunId(currentRun.id)
      setView("videos")

      const target = all
        ? clips.filter((clip) => !clip.keep && !clip.flagged)
        : clips.filter((clip) => (clipNumbers ?? []).includes(clip.index))

      if (target.length === 0) return { changed: 0, reason: "Nothing to keep." }
      await updateClips.mutateAsync(
        target.map((clip) => ({ clipId: clip.clipId, keep: true })),
      )
      return { changed: target.length, video: runTitle(currentRun) }
    },
  }, [clips, currentRun, updateClips, setSelectedRunId, setView])

  useFrontendTool({
    name: "discardClips",
    description:
      "Mark clips of the selected video as discarded, so they do not train " +
      "the voice. Pass clip numbers, or set all or flaggedOnly.",
    parameters: z.object({
      clipNumbers: z
        .array(z.number())
        .optional()
        .describe("Clip numbers as shown in the clip table"),
      all: z.boolean().optional().describe("Discard every currently kept clip"),
      flaggedOnly: z
        .boolean()
        .optional()
        .describe("Discard only clips diarization flagged as poor quality"),
    }),
    handler: async ({ clipNumbers, all, flaggedOnly }) => {
      if (!currentRun) return { error: "No video is selected." }
      setSelectedRunId(currentRun.id)
      setView("videos")

      const target = flaggedOnly
        ? clips.filter((clip) => clip.flagged && clip.keep)
        : all
          ? clips.filter((clip) => clip.keep)
          : clips.filter((clip) => (clipNumbers ?? []).includes(clip.index))

      if (target.length === 0) return { changed: 0, reason: "Nothing to discard." }
      await updateClips.mutateAsync(
        target.map((clip) => ({ clipId: clip.clipId, keep: false })),
      )
      return { changed: target.length, video: runTitle(currentRun) }
    },
  }, [clips, currentRun, updateClips, setSelectedRunId, setView])

  useFrontendTool({
    name: "assignSpeaker",
    description:
      "Bind the speaker heard in a clip to a voice model, creating that voice " +
      "if it does not exist. The binding is per speaker, not per clip, so it " +
      "covers every clip that speaker appears in.",
    parameters: z.object({
      clipNumber: z.number().describe("Clip number as shown in the clip table"),
      voiceName: z.string().describe("Name of the voice model to bind to"),
    }),
    handler: async ({ clipNumber, voiceName }) => {
      if (!currentRun) return { error: "No video is selected." }
      const clip = clips.find((candidate) => candidate.index === clipNumber)
      if (!clip) return { error: `No clip ${clipNumber} in this video.` }
      if (!clip.speakerLabel)
        return { error: `Clip ${clipNumber} has no speaker label to bind.` }

      const voice = await resolveVoice(voiceName)
      if (!voice) return { error: `Could not find or create voice ${voiceName}.` }

      /* Spread the run's current map: assign replaces it wholesale, so one
         pair alone would erase every other speaker. */
      await assignRun.mutateAsync({
        ...currentRun.voiceAssignments,
        [clip.speakerLabel]: voice.id,
      })

      const shared = clips.filter(
        (candidate) => candidate.speakerLabel === clip.speakerLabel,
      ).length
      return {
        speakerLabel: clip.speakerLabel,
        voice: voice.name,
        clipsCovered: shared,
      }
    },
  }, [clips, currentRun, assignRun, voices])

  useFrontendTool({
    name: "createVoice",
    description: "Create a new, empty voice model with the given name",
    parameters: z.object({
      name: z.string().describe("Name for the new voice model"),
    }),
    handler: async ({ name }) => {
      if (findVoiceByName(name)) return { error: `A voice named ${name} exists.` }
      const created = await createVoice.mutateAsync(name)
      setView("voices")
      setSelectedVoiceId(created.id)
      return { created: true, id: created.id, name }
    },
  }, [voices, createVoice, setView, setSelectedVoiceId])

  useFrontendTool({
    name: "startTraining",
    description:
      "Start a training run for a voice model. The voice needs at least one " +
      "speaker assigned before there is anything to train on.",
    parameters: z.object({
      voiceName: z
        .string()
        .optional()
        .describe("Voice to train. Defaults to the selected voice."),
    }),
    handler: async ({ voiceName }) => {
      const voice =
        (voiceName ? findVoiceByName(voiceName) : undefined) ??
        voices.find((candidate) => candidate.id === selectedVoiceId)
      if (!voice) return { error: "No voice named, and none selected." }
      if (voice.contributions.length === 0)
        return { error: `${voice.name} has no speakers assigned yet.` }

      setView("voices")
      setSelectedVoiceId(voice.id)
      await trainVoice.mutateAsync(voice.id)
      return { started: true, voice: voice.name }
    },
  }, [voices, selectedVoiceId, trainVoice, setView, setSelectedVoiceId])

  // Static, not model-generated: these name the studio's real verbs, and a
  // generated set would cost a model call per thread to say the same thing.
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "Status", message: "What is the pipeline status?" },
      { title: "Show voices", message: "Switch to the voices view" },
      { title: "Keep all clips", message: "Keep all clips in this video" },
      { title: "Drop flagged", message: "Discard the flagged clips" },
      { title: "Why so slow?", message: "Why is this training run taking so long?" },
    ],
  })

  return null
}
