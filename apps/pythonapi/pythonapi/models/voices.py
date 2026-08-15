"""Schemas for the durable Voice entity (Story 3.1).

A Voice is the trained-model identity: independent of any single video, it
receives clip contributions from one or more voice runs (Story 3.2) and
tracks its own training phase, separate from a run's ingest phase
(VoiceRunPhase in models/voice.py).
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator


class VoicePhase(StrEnum):
    """Where one voice has reached in training.

    READY and FAILED are terminal. AWAITING_COMMIT is where every voice
    starts, since no contribution has committed clips to it yet.
    """

    AWAITING_COMMIT = "awaiting_commit"
    TRAINING = "training"
    EXPORTING = "exporting"
    READY = "ready"
    FAILED = "failed"


class VoiceRequest(BaseModel):
    """Create a voice by name."""

    name: str = Field(min_length=1, max_length=64)


class Voice(BaseModel):
    """One voice's complete state.

    contributions is always empty in this story - no contribution record
    exists until Story 3.2's commit step creates one.
    """

    id: str
    name: str
    phase: VoicePhase
    checkpoint_path: str | None = None
    contributions: list = Field(default_factory=list)
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
