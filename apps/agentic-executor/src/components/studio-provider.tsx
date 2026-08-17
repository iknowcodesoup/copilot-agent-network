"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  request,
  useAssignRun,
  useCommitRun,
  useCreateVoice,
  useJobLog,
  useSpeakerBoard,
  useStartRun,
  useUpdateClips,
  voiceQueryKeys,
  voicesApiBase,
  useVoiceList,
  useVoiceRuns,
  VoiceApiError,
} from "@/lib/voice_api";
import type {
  LogLine,
  Snapshot,
  StudioClip,
  TrainingProgress,
  VideoResult,
  VoiceDetail,
  VoiceRun,
} from "@/lib/types";

type View = "videos" | "voices";
interface StudioContextValue {
  snapshot: Snapshot;
  logs: LogLine[];
  connected: boolean;
  view: View;
  setView: (v: View) => void;
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
  selectedVoiceId: string | null;
  setSelectedVoiceId: (id: string | null) => void;
  logFilter: string;
  setLogFilter: (k: string) => void;
  clipsForRun: (runId: string) => StudioClip[];
  clipsForVoice: (voiceId: string) => StudioClip[];
  videoForRun: (run: VoiceRun) => VideoResult | undefined;
  trainingForVoice: (voice: VoiceDetail) => TrainingProgress | undefined;
  addVideo: (url: string, title?: string) => Promise<VoiceRun | null>;
  updateClip: (
    clipId: string,
    patch: { speakerLabel?: string; text?: string; keep?: boolean },
  ) => Promise<void>;
  assignClipVoice: (clipId: string, voiceId: string) => Promise<void>;
  commitRun: () => Promise<void>;
  createVoice: (name: string) => Promise<VoiceDetail | null>;
  startTraining: (voiceId: string) => Promise<{ error?: string } | null>;
  sampleVoice: (
    voiceId: string,
    text?: string,
  ) => Promise<{ error?: string; text?: string } | null>;
  exportVoice: (voiceId: string, ckpt?: string) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);
const EMPTY: Snapshot = {
  runs: [],
  videos: [],
  clips: [],
  voices: [],
  training: [],
};

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const runsQuery = useVoiceRuns();
  const voicesQuery = useVoiceList();
  const startRun = useStartRun();
  const createVoiceMutation = useCreateVoice();
  const updateClips = useUpdateClips("");
  const [view, setView] = useState<View>("videos");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState("all");
  const activeRunId = selectedRunId ?? runsQuery.data?.[0]?.id ?? "";
  const logQuery = useJobLog(activeRunId, Boolean(activeRunId));
  const speakerBoardQuery = useSpeakerBoard(activeRunId, Boolean(activeRunId));
  const assignRun = useAssignRun(activeRunId);
  const commitRunMutation = useCommitRun(activeRunId);
  const runs = runsQuery.data ?? [];
  const voices: VoiceDetail[] = (voicesQuery.data ?? []).map((voice) => ({
    ...voice,
    checkpointPath: null,
    voyicerJobId: null,
    contributions: [],
    createdAt: "",
    updatedAt: "",
  }));
  const videos = runs.map(
    (run): VideoResult => ({
      videoId: run.videoId ?? run.id,
      title: run.videoTitle ?? "Untitled video",
      durationSec: null,
      channel: null,
      thumbnailUrl: null,
      url: run.sourceUrl,
    }),
  );
  const snapshot: Snapshot = { ...EMPTY, runs, voices, videos };
  const logs: LogLine[] = (logQuery.data?.content ?? "")
    .split(/\r?\n/)
    .map((message) => message.trim())
    .filter((message) => message.length > 0)
    .map((message, index) => ({
      id: `${activeRunId}-${logQuery.data?.offset ?? 0}-${index}`,
      key: activeRunId,
      ts: Date.now(),
      message,
    }));

  const activeVoiceAssignments =
    runs.find((run) => run.id === activeRunId)?.voiceAssignments ?? {};
  const clips: StudioClip[] =
    speakerBoardQuery.data?.speakers
      .flatMap((speaker) => speaker.clips)
      .map((clip, index) => ({
        ...clip,
        runId: activeRunId,
        videoId:
          runs.find((run) => run.id === activeRunId)?.videoId ?? activeRunId,
        index,
        assignedVoiceId:
          activeVoiceAssignments[clip.speakerLabel ?? clip.clipId] ?? null,
      })) ?? [];
  const clipsForRun = useCallback(
    (runId: string) => (runId === activeRunId ? clips : []),
    [activeRunId, clips],
  );
  const clipsForVoice = useCallback(
    (voiceId: string) => clips.filter((clip) => clip.speakerLabel === voiceId),
    [clips],
  );
  const videoForRun = useCallback(
    (run: VoiceRun) => videos.find((video) => video.videoId === run.videoId),
    [videos],
  );
  const trainingForVoice = useCallback(() => undefined, []);
  const addVideo = useCallback(
    async (url: string, title?: string) => {
      const result = await startRun.mutateAsync({
        primaryCharacter: title?.trim() || "default",
        sourceUrl: url,
        diarize: true,
        numSpeakers: null,
      });
      return runs.find((run) => run.id === result.id) ?? null;
    },
    [runs, startRun],
  );
  const updateClip = useCallback(
    async (
      clipId: string,
      patch: { speakerLabel?: string; text?: string; keep?: boolean },
    ) => {
      if (!activeRunId) return;
      await updateClips.mutateAsync([
        { clipId, keep: patch.keep, speakerLabel: patch.speakerLabel },
      ]);
    },
    [activeRunId, updateClips],
  );
  const assignClipVoice = useCallback(
    async (clipId: string, voiceId: string) => {
      if (!activeRunId) return;
      const newAssignments: { [id: string]: string } = {};
      const target = clips.find((clip) => clip.clipId === clipId);
      if (target)
        newAssignments[target.speakerLabel ?? target.clipId] = voiceId;
      await assignRun.mutateAsync(newAssignments);
    },
    [activeRunId, assignRun, clips],
  );
  const commitRun = useCallback(async () => {
    if (!activeRunId) return;
    await commitRunMutation.mutateAsync();
  }, [activeRunId, commitRunMutation]);
  const createVoice = useCallback(
    async (name: string) => {
      const result = await createVoiceMutation.mutateAsync(name);
      return {
        id: result.id,
        name,
        phase: "awaiting_commit",
        checkpointPath: null,
        voyicerJobId: null,
        contributions: [],
        createdAt: "",
        updatedAt: "",
      } as VoiceDetail;
    },
    [createVoiceMutation],
  );
  const startTraining = useCallback(
    async (voiceId: string) => {
      try {
        await request(`/${voiceId}/train`, { method: "POST" }, voicesApiBase);
        queryClient.invalidateQueries({
          queryKey: voiceQueryKeys.voiceDetail(voiceId),
        });
        queryClient.invalidateQueries({ queryKey: voiceQueryKeys.voiceList });
        return null;
      } catch (error) {
        const message =
          error instanceof VoiceApiError ? error.message : "Training failed to start.";
        return { error: message };
      }
    },
    [queryClient],
  );
  const sampleVoice = useCallback(
    async (_voiceId: string, text?: string) => ({ text: text ?? "" }),
    [],
  );
  const exportVoice = useCallback((_voiceId: string, _ckpt?: string) => {
    // Export is a stub: the model file lives on the voice factory host, and
    // there is no download/copy action wired up yet.
  }, []);

  const value = useMemo(
    () => ({
      snapshot,
      logs,
      connected: !runsQuery.isError,
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
      commitRun,
      createVoice,
      startTraining,
      sampleVoice,
      exportVoice,
    }),
    [
      snapshot,
      logs,
      runsQuery.isError,
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
      commitRun,
      createVoice,
      startTraining,
      sampleVoice,
      exportVoice,
    ],
  );
  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used within StudioProvider");
  return context;
}
