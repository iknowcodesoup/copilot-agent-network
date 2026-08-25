"""SQLAlchemy ORM table definitions - the Postgres schema for document/chunk
metadata and orders. Chunk embedding vectors are out of scope here; those
live in Qdrant only (see repositories/qdrant.py).
"""

from datetime import datetime

from sqlalchemy import ARRAY, ForeignKey, Index, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class DocumentRow(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(primary_key=True)
    title: Mapped[str]
    filename: Mapped[str]
    raw_content: Mapped[bytes]
    # Docling-extracted full text, PII-masked. Empty until PROCESSING completes.
    content: Mapped[str] = mapped_column(default="")
    status: Mapped[str]
    chunk_count: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None]
    created_at: Mapped[datetime]


class ChunkRow(Base):
    __tablename__ = "chunks"
    __table_args__ = (Index("idx_chunks_document_id", "document_id"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int]
    text: Mapped[str]
    headings: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    page_no: Mapped[int | None]


class PiiVaultRow(Base):
    """Persisted, encrypted PII vault: surrogate token -> real value. Values
    are Fernet-encrypted before storage (see repositories/pii_vault.py) -
    plaintext PII never touches this schema.
    """

    __tablename__ = "pii_vault"
    __table_args__ = (Index("idx_pii_vault_entity_type", "entity_type"),)

    token: Mapped[str] = mapped_column(primary_key=True)
    entity_type: Mapped[str]
    encrypted_value: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class OrderRow(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    item_id: Mapped[int]
    status: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class VoiceRunRow(Base):
    """One source video on its way to a fine-tuned voice model.

    The `phase` column is the state machine itself, not a status label:
    VoiceRunReconciler reads it to decide what to do next, so a run survives a
    restart mid-pipeline. A run tracks one video through ingest and stops. The
    clips ingest produces, and every review decision made about them, belong
    to the video and live on voice_clips below.

    Audio stays on the voice factory host. So does the video's title, which
    the factory measures from the source and this service reads rather than
    copies, so no fact here has two writers.
    """

    __tablename__ = "voice_runs"
    __table_args__ = (
        Index("idx_voice_runs_phase", "phase"),
        # the factory webhook arrives with a job id and nothing else
        Index("idx_voice_runs_voyicer_job_id", "voyicer_job_id"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    primary_character: Mapped[str]
    source_url: Mapped[str]
    # the only join to the voice factory, which owns the video: its title, its
    # clips, its counts, and the speaker map that names their characters. None
    # until the run resolves it.
    video_id: Mapped[str | None]
    phase: Mapped[str]
    diarize: Mapped[bool] = mapped_column(default=True)
    num_speakers: Mapped[int | None]
    # No voice assignment column. A run does not own one: a clip is assigned
    # to a voice one clip at a time, and that lives on voice_clips below.
    # the control API job backing the current phase, if one is running
    voyicer_job_id: Mapped[str | None]
    # DOWNLOADING runs the ingest steps in order (download, transcribe, chunk,
    # diarize, review). This is which one is in flight, and it is what makes a
    # retry resume on the failed step instead of on the download.
    ingest_stage_index: Mapped[int] = mapped_column(default=0)
    # last training progress the factory reported over its webhook
    current_epoch: Mapped[int | None]
    current_loss: Mapped[float | None]
    error: Mapped[str | None]
    # consecutive transient factory errors; a successful call resets it
    error_count: Mapped[int] = mapped_column(default=0)
    # the phase a failed run was in, so a retry can put it back there
    failed_from_phase: Mapped[str | None]
    # the job that failed. Kept after voyicer_job_id is cleared, because its log
    # is the only place that says why the run stopped.
    failed_job_id: Mapped[str | None]
    # Mutual exclusion for multiple API instances. An instance claims a run by
    # setting these in one atomic UPDATE, and the lease expires on its own, so
    # an instance that dies never strands a run. No separate lock service.
    leased_until: Mapped[datetime | None]
    lease_owner: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class VoiceRow(Base):
    """One durable voice: the trained-model identity a run's clips
    contribute to (Story 3.1 introduces the entity only - no contribution
    link exists until Story 3.2).

    `phase` tracks training progress and is independent of any one
    VoiceRunRow's `phase`, which tracks a single video's ingest.
    """

    __tablename__ = "voices"
    __table_args__ = (
        Index("idx_voices_phase", "phase"),
        Index("idx_voices_name", "name", unique=True),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str]
    phase: Mapped[str]
    checkpoint_path: Mapped[str | None]
    # the control API job backing the current phase, if one is running
    voyicer_job_id: Mapped[str | None]
    # COMPILING runs three stages in order (compile-dataset, resample,
    # preprocess). This is which one is in flight.
    compile_stage_index: Mapped[int] = mapped_column(default=0)
    # Mutual exclusion for multiple API instances, same pattern as
    # VoiceRunRow above: an instance claims a voice by setting these in one
    # atomic UPDATE, and the lease expires on its own.
    leased_until: Mapped[datetime | None]
    lease_owner: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class VoiceClipRow(Base):
    """One clip cut out of one video, and the review decisions made about it.

    This table is the clip review record. It used to be review.csv on the
    voice factory host, which meant the two things a dataset is built from -
    which clips a reviewer kept, and which voice each one is for - lived in a
    file no query could reach and no transaction protected. They live here
    now. The factory still owns the audio: `full.wav` beside the clips is
    what a slice is cut from, and nothing in this table is a copy of it.

    A clip belongs to a video, not to a run. Two runs can claim the same
    video, and a video keeps its clips after every run against it is gone, so
    the key is (video_id, clip_id) and there is no run_id column.

    `voice_id` is the whole assignment. One clip trains one voice, so it is a
    plain nullable column rather than a join table - null means nobody has
    decided yet. A voice's dataset is every row where voice_id is its id and
    keep is true, which is one query rather than a directory scan.
    """

    __tablename__ = "voice_clips"
    __table_args__ = (
        Index("idx_voice_clips_video_id", "video_id"),
        # the dataset query: every clip assigned to one voice, across videos
        Index("idx_voice_clips_voice_id", "voice_id"),
    )

    video_id: Mapped[str] = mapped_column(primary_key=True)
    # the factory's id for the clip, unique inside its video
    clip_id: Mapped[str] = mapped_column(primary_key=True)
    # Which voice this clip trains, or None for undecided. SET NULL rather
    # than CASCADE: deleting a voice must not delete the clips, which belong
    # to the video and outlive any voice built from them.
    voice_id: Mapped[str | None] = mapped_column(
        ForeignKey("voices.id", ondelete="SET NULL"), default=None
    )
    # True kept, False excluded, None undecided. Three states, not a default:
    # "reviewed" means no clip is still None, so the difference is what the
    # review pill counts.
    keep: Mapped[bool | None] = mapped_column(default=None)
    text: Mapped[str] = mapped_column(default="")
    # Bounds into the video's full.wav, in seconds. The trim bar writes them,
    # and a slice is cut from them on demand - which is why a trim needs no
    # re-cut of any file.
    start_sec: Mapped[float] = mapped_column(default=0.0)
    end_sec: Mapped[float] = mapped_column(default=0.0)
    # Derived from the bounds and stored anyway, because the factory measured
    # it at ingest and a row imported from an old review.csv may carry a value
    # its bounds no longer explain. Recomputed on every trim.
    duration_sec: Mapped[float] = mapped_column(default=0.0)
    quality_score: Mapped[float | None] = mapped_column(default=None)
    flagged: Mapped[bool] = mapped_column(default=False)
    # What diarization heard, kept as recorded. It groups the review screen
    # and nothing joins on it - the assignment above is what a dataset reads.
    speaker_label: Mapped[str | None] = mapped_column(default=None)
    speaker_coverage: Mapped[float | None] = mapped_column(default=None)
    excluded_reason: Mapped[str] = mapped_column(default="")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())
