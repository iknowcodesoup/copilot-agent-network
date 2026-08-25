"""Schemas for the durable Voice entity.

A Voice is the trained-model identity: independent of any single video, it
holds clips assigned to it from any number of videos, and tracks its own
training phase, separate from a run's ingest phase (VoiceRunPhase in
models/voice_run.py).
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator


class VoicePhase(StrEnum):
    """Where one voice has reached in training.

    READY and FAILED are terminal. AWAITING_COMMIT is where every voice
    starts, since no clip has been assigned to it yet.

    COMPILING is what turns clip decisions into training audio. It gathers
    every kept clip assigned to this voice, across every video, and rebuilds
    the voice's dataset from scratch - then resamples and preprocesses it into
    the directory TRAINING reads. It runs here, at training start, rather than
    at assignment time, so un-keeping or reassigning a clip takes effect by
    simply not being gathered next time.
    """

    AWAITING_COMMIT = "awaiting_commit"
    COMPILING = "compiling"
    TRAINING = "training"
    EXPORTING = "exporting"
    READY = "ready"
    FAILED = "failed"


# Phases the training reconciler leaves alone. AWAITING_COMMIT waits on an
# explicit train call; READY and FAILED are terminal.
# COMPILING/TRAINING/EXPORTING are the claimable phases.
RESTING_PHASES = frozenset(
    {
        VoicePhase.AWAITING_COMMIT,
        VoicePhase.READY,
        VoicePhase.FAILED,
    }
)


class VoiceRequest(BaseModel):
    """Create a voice by name."""

    name: str = Field(min_length=1, max_length=64)


class VoiceClip(BaseModel):
    """One clip assigned to one voice, with the video it came from.

    The Voices view shows these: every tagged clip a voice holds, gathered
    from every video, which is the same set COMPILING turns into training
    audio. Which speaker diarization heard it as is carried for display and
    joins nothing.
    """

    video_id: str
    clip_id: str
    # not stored: the factory owns the title, resolved from video_id at read
    # time. None when the factory is unset or no longer holds that video.
    video_title: str | None = None
    keep: bool | None = None
    text: str = ""
    start_sec: float = 0.0
    end_sec: float = 0.0
    duration_sec: float = 0.0
    flagged: bool = False
    speaker_label: str | None = None


class Voice(BaseModel):
    """One voice's complete state.

    clips is every clip assigned to this voice, across every video. It is
    what the voice is made of and what COMPILING gathers, so the list view
    and the dataset read the same rows.
    """

    id: str
    name: str
    phase: VoicePhase
    checkpoint_path: str | None = None
    # the control API job backing the current phase, if one is running.
    # Mirrors VoiceRun.voyicer_job_id: durable, so a restart mid-training
    # resumes polling the same job instead of starting a second one.
    voyicer_job_id: str | None = None
    # which of COMPILING's three ordered stages is in flight
    compile_stage_index: int = 0
    clips: list[VoiceClip] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at", mode="after")
    @classmethod
    def strip_timezone(cls, v: datetime) -> datetime:
        # If the datetime has timezone info, strip it
        if v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v


class VoiceResponse(BaseModel):
    """Acknowledgement for a newly created voice."""

    id: str
    phase: VoicePhase


class VoiceClipAssignRequest(BaseModel):
    """Assign clips of one video to this voice.

    One route for every assignment. Picking a speaker sends that speaker's
    whole clip list, and correcting a single clip sends one id, so there is
    one write path and no "group assign" that means something different from
    a per-clip one. The reviewer culls what the group got wrong afterwards,
    with keep and exclude.
    """

    video_id: str = Field(min_length=1)
    clip_ids: list[str] = Field(min_length=1)


class VoiceClipUnassignRequest(BaseModel):
    """Take clips off this voice. The clips stay; only the assignment goes."""

    video_id: str = Field(min_length=1)
    clip_ids: list[str] = Field(min_length=1)


class VoiceAssignResponse(BaseModel):
    """How many clips the call moved, and what the voice now holds."""

    voice_id: str
    assigned_count: int
    clips: list[VoiceClip] = Field(default_factory=list)


class VoiceDatasetClip(BaseModel):
    """One row of a voice's training dataset, for the voice factory.

    The factory asks for this at compile time and slices its own full.wav
    from the bounds. It is deliberately smaller than VoiceClip: the factory
    needs the audio window and the transcript, and nothing about review.
    """

    video_id: str
    clip_id: str
    start_sec: float
    end_sec: float
    text: str
