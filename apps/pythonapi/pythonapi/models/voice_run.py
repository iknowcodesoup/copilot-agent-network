"""Schemas for the voice-model pipeline.

A voice run tracks one source video from download through to an exported model.
The pipeline itself lives in the star-trek-voyicer repo; this service only
orchestrates it and holds the run state.
"""

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class VoiceRunPhase(StrEnum):
    """Where one run has reached.

    A run ingests one video and stops. It does not train anything: a voice is
    built from clips spread across many videos, so training belongs to the
    Voice (see VoicePhase in models/voice.py), not here.

    INGESTED is terminal and states a fact about ingest, not about review.
    Review has no phase at all - a video is being reviewed until every clip is
    kept or excluded, which is derived from the clips themselves and never
    stored.
    """

    DOWNLOADING = "downloading"
    DIARIZING = "diarizing"
    INGESTED = "ingested"
    FAILED = "failed"


# Phases the reconciler leaves alone. Both are terminal: a run that reaches
# INGESTED has nothing left to do, and the reconciler must stop ticking it.
RESTING_PHASES = frozenset(
    {
        VoiceRunPhase.INGESTED,
        VoiceRunPhase.FAILED,
    }
)


class VideoResult(BaseModel):
    """One YouTube search hit."""

    video_id: str
    title: str
    duration_sec: float | None = None
    channel: str | None = None
    thumbnail_url: str | None = None
    url: str


# A video and its speakers are the factory's own facts, so this service passes
# both through exactly as the factory shapes them. There is no model here on
# purpose: a field the factory adds must reach the browser with no edit in this
# repository, which a model would silently drop.


class VoiceRunRequest(BaseModel):
    """Start a run against one video."""

    # the dataset every unmapped speaker's clips land in
    primary_character: str = Field(min_length=1, max_length=64)
    source_url: str = Field(min_length=1)
    diarize: bool = True
    num_speakers: int | None = Field(default=None, ge=1, le=20)
    whisper_model: str | None = None
    min_clip_duration: float | None = Field(default=None, gt=0)
    max_clip_duration: float | None = Field(default=None, gt=0)


class VoiceRun(BaseModel):
    """One run's complete state.

    This is what the browser sees, so the lease columns are deliberately absent:
    they belong to the reconciler's mutual exclusion, not to the run. See
    VoiceRunRepository.claim_runs.
    """

    id: str
    primary_character: str
    source_url: str
    # the only join to the factory, which owns the video itself: its title,
    # its clips, and which speaker each clip belongs to
    video_id: str | None = None
    phase: VoiceRunPhase
    diarize: bool = True
    num_speakers: int | None = None
    voyicer_job_id: str | None = None
    # which of DOWNLOADING's ordered ingest steps is in flight
    ingest_stage_index: int = 0
    # last training progress the factory reported, over the webhook
    current_epoch: int | None = None
    current_loss: float | None = None
    error: str | None = None
    # consecutive transient factory errors. A successful call resets it, and
    # only VOICE_MAX_CONSECUTIVE_ERRORS in a row fails the run.
    error_count: int = 0
    # the phase a failed run was in when it failed, so a retry can resume there
    failed_from_phase: VoiceRunPhase | None = None
    # the job that failed. Its log is the only record of why, so it outlives
    # voyicer_job_id, which is cleared to stop the next tick polling a dead job.
    failed_job_id: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at", mode="after")
    @classmethod
    def strip_timezone(cls, v: datetime) -> datetime:
        # If the datetime has timezone info, strip it
        if v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v


class VoiceRunResponse(BaseModel):
    """Acknowledgement for a newly started run."""

    id: str
    phase: VoiceRunPhase


class ClipSummary(BaseModel):
    clip_id: str
    # Which video the clip was cut from. Set when clips are read across
    # videos - a voice's own list spans several - and left None when the
    # caller already named one video, as the review board does.
    video_id: str | None = None
    # None is unreviewed: neither kept nor excluded. Distinct from False,
    # which is an explicit exclusion - see keep_from_cell in the factory's
    # core/clip_review.py, the source of this value.
    keep: bool | None
    quality_score: float | None = None
    flagged: bool = False
    speaker_label: str | None = None
    speaker_coverage: float | None = None
    # Which voice this clip trains. speaker_label is what diarization heard;
    # this is the decision made about it, and it is the only thing a dataset
    # reads. None until a reviewer decides.
    voice_id: str | None = None
    # The voice's name, resolved from voice_id when the clip is read. Not
    # stored beside the id: a rename would leave the copy behind.
    voice_name: str | None = None
    duration_sec: float | None = None
    start_sec: float | None = None
    end_sec: float | None = None
    text: str = ""
    excluded_reason: str = ""


class VideoClips(BaseModel):
    """One video's clips exactly as the factory cut them.

    Read once, when ingest finishes, and imported into voice_clips. After
    that this service never asks the factory about a clip again - the review
    record is a table here, not a file there.
    """

    video_id: str
    clips: list[ClipSummary] = Field(default_factory=list)


class SpeakerGroup(BaseModel):
    """Every clip pyannote attributed to one speaker.

    speaker_label is None for the rejected group: clips no single speaker holds,
    which means cross-talk or music.

    Grouping is all the label is for. It gives a reviewer a whole speaker to
    assign at once, and nothing downstream joins on it.
    """

    speaker_label: str | None
    clip_count: int
    kept_count: int
    total_duration_sec: float
    clips: list[ClipSummary] = Field(default_factory=list)


class SpeakerBoard(BaseModel):
    """Clips grouped by speaker, for the review screen.

    Keyed on the video, because the clips are. run_id is None for a video no
    run has claimed yet, which a second character browsing an already
    ingested video is looking at.
    """

    video_id: str
    run_id: str | None = None
    speakers: list[SpeakerGroup] = Field(default_factory=list)


# What a reviewer can decide about one clip. "none" puts it back to
# undecided, which is what a second click on an already-kept clip does.
ClipKeepDecision = Literal["kept", "excluded", "none"]

KEEP_BY_DECISION: dict[ClipKeepDecision, bool | None] = {
    "kept": True,
    "excluded": False,
    "none": None,
}


class ClipDecision(BaseModel):
    """One change a reviewer makes to one clip.

    Every field is optional and only the ones given are applied, so keeping a
    clip and retyping its text are separate calls that do not overwrite each
    other. Which voice a clip trains is not here: that is its own route, so
    assigning cannot be smuggled in beside a keep.
    """

    clip_id: str
    # Three states need three words. A bool cannot carry them, because None
    # would have to mean both "undecided" and "unchanged", and clearing a
    # decision would be indistinguishable from not mentioning it.
    keep: ClipKeepDecision | None = None
    speaker_label: str | None = None
    text: str | None = None
    # The trim bar's write. Both bounds move together or neither does - a
    # start past its end is not a clip, and half a trim would store one.
    start_sec: float | None = None
    end_sec: float | None = None


class ClipDecisionRequest(BaseModel):
    """A batch of clip changes, applied in one call.

    A batch, not one clip per request, because the review screen edits a
    speaker's worth of clips at a time and one round trip per row would make
    a partly-applied review a normal outcome.
    """

    decisions: list[ClipDecision] = Field(min_length=1)


class CheckpointSummary(BaseModel):
    path: str
    name: str
    epoch: int | None = None
    step: int | None = None
    modified_at: datetime | None = None


class TrainingProgress(BaseModel):
    character: str
    preprocessed: bool = False
    running_job_id: str | None = None
    current_epoch: int | None = None
    current_loss: float | None = None
    checkpoints: list[CheckpointSummary] = Field(default_factory=list)


class JobLog(BaseModel):
    offset: int
    content: str
    state: str


class VoiceLogChunk(BaseModel):
    """New job-log content, pushed as it is produced."""

    run_id: str
    job_id: str
    offset: int
    content: str


class VoiceWebhookEventType(StrEnum):
    """What the factory is reporting."""

    STARTED = "started"
    PROGRESS = "progress"
    FINISHED = "finished"


class VoiceWebhookEvent(BaseModel):
    """What the voice factory posts when one of its jobs changes.

    Deliberately small. It says which job changed and what the factory saw; it
    never says what phase the run should move to. The reconciler decides that,
    by asking the factory itself.
    """

    job_id: str
    type: VoiceWebhookEventType
    # present on a progress event during training
    epoch: int | None = None
    loss: float | None = None
    # present on a finished event: the factory's own job state
    state: str | None = None
