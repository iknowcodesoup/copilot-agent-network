"""Persistence for run speakers and voice contributions (Story 3.2).

Same shape as repositories/voices.py: a Protocol contract, an in-memory
double for tests, and a Postgres implementation that opens its own session
per method. voice_contributions is append-only, so this repository offers no
update method - only create_contribution and read queries.

Two tables, one repository, because they are one fact. A speaker row exists
so that the factory's text label (SPEAKER_00) is stored once and referenced
by id. A contribution joins a voice id to a speaker id, and nothing else -
the run and the video are the speaker's, and are read back through it.
"""

import uuid
from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from pythonapi.models.orm import (
    VoiceContributionRow,
    VoiceRunRow,
    VoiceRunSpeakerRow,
)
from pythonapi.models.voices import VoiceContribution


class VoiceContributionRepository(Protocol):
    """Storage contract for run speakers and the contribution audit trail
    (FR19)."""

    async def assign_speaker(self, run_id: str, label: str, voice_id: str) -> str:
        """Point this run's speaker at this voice, and answer its id.

        The speaker row is created the first time the run's label is seen.
        Callers hold a label because the voice factory speaks labels; this is
        the one place that turns one into an id, so no other code keys on the
        text.
        """
        ...

    async def create_contribution(self, contribution: VoiceContribution) -> None:
        """Record that this speaker belongs to this voice.

        Idempotent on the (voice, speaker) pair. An assign call sends the
        run's whole map, so most pairs in it are already recorded, and a
        speaker moved away and back again arrives at one that was recorded
        before. Both must leave one row, with its original created_at.
        """
        ...

    async def list_contributions_for_voice(
        self, voice_id: str
    ) -> list[VoiceContribution]:
        """Every contribution committed into this voice, each traceable to
        its run and video (FR22)."""
        ...

    async def list_contributions_for_voices(
        self, voice_ids: Sequence[str]
    ) -> dict[str, list[VoiceContribution]]:
        """The same trail for many voices at once, keyed by voice id.

        The list route needs what the detail route needs, for every voice on
        screen. One query answers them all, so a card grid does not cost one
        request per card. Every id asked for gets an entry, empty if the voice
        has no contribution yet.
        """
        ...


class InMemoryVoiceContributionRepository:
    """Dict-backed VoiceContributionRepository. Test double and local dev
    without Postgres."""

    def __init__(self) -> None:
        self._contributions: dict[str, VoiceContribution] = {}
        # (run id, label) -> speaker id, the same pair the Postgres unique
        # constraint holds
        self._speakers: dict[tuple[str, str], str] = {}
        # speaker id -> the voice it points at now
        self._speaker_voices: dict[str, str] = {}

    async def assign_speaker(self, run_id: str, label: str, voice_id: str) -> str:
        key = (run_id, label)
        speaker_id = self._speakers.get(key)
        if speaker_id is None:
            speaker_id = uuid.uuid4().hex
            self._speakers[key] = speaker_id
        self._speaker_voices[speaker_id] = voice_id
        return speaker_id

    async def create_contribution(self, contribution: VoiceContribution) -> None:
        recorded = any(
            existing.voice_id == contribution.voice_id
            and existing.speaker_id == contribution.speaker_id
            for existing in self._contributions.values()
        )
        if recorded:
            return
        self._contributions[contribution.id] = contribution.model_copy(deep=True)

    async def list_contributions_for_voice(
        self, voice_id: str
    ) -> list[VoiceContribution]:
        return [
            contribution.model_copy(deep=True)
            for contribution in sorted(
                self._contributions.values(), key=lambda row: row.created_at
            )
            if contribution.voice_id == voice_id
        ]

    async def list_contributions_for_voices(
        self, voice_ids: Sequence[str]
    ) -> dict[str, list[VoiceContribution]]:
        grouped: dict[str, list[VoiceContribution]] = {
            voice_id: [] for voice_id in voice_ids
        }
        for contribution in sorted(
            self._contributions.values(), key=lambda row: row.created_at
        ):
            group = grouped.get(contribution.voice_id)
            if group is not None:
                group.append(contribution.model_copy(deep=True))
        return grouped


class PostgresVoiceContributionRepository:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def assign_speaker(self, run_id: str, label: str, voice_id: str) -> str:
        async with AsyncSession(self._engine) as session:
            row = await session.scalar(
                select(VoiceRunSpeakerRow).where(
                    VoiceRunSpeakerRow.run_id == run_id,
                    VoiceRunSpeakerRow.label == label,
                )
            )
            if row is None:
                row = VoiceRunSpeakerRow(
                    id=uuid.uuid4().hex, run_id=run_id, label=label
                )
                session.add(row)
            row.voice_id = voice_id
            speaker_id = row.id
            await session.commit()
            return speaker_id

    async def create_contribution(self, contribution: VoiceContribution) -> None:
        async with AsyncSession(self._engine) as session:
            # ON CONFLICT rather than a read-then-write: two assign calls for
            # the same pair can race, and the unique constraint is what
            # decides. Nothing is updated, so the first created_at stands.
            await session.execute(
                pg_insert(VoiceContributionRow)
                .values(
                    id=contribution.id,
                    voice_id=contribution.voice_id,
                    speaker_id=contribution.speaker_id,
                    created_at=contribution.created_at,
                )
                .on_conflict_do_nothing(index_elements=["voice_id", "speaker_id"])
            )
            await session.commit()

    async def list_contributions_for_voice(
        self, voice_id: str
    ) -> list[VoiceContribution]:
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                _contribution_query().where(VoiceContributionRow.voice_id == voice_id)
            )
            return [_contribution_from_rows(*rows) for rows in result.all()]

    async def list_contributions_for_voices(
        self, voice_ids: Sequence[str]
    ) -> dict[str, list[VoiceContribution]]:
        grouped: dict[str, list[VoiceContribution]] = {
            voice_id: [] for voice_id in voice_ids
        }
        # IN () is not valid SQL, and an empty ask has an empty answer anyway
        if not grouped:
            return grouped
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                _contribution_query().where(VoiceContributionRow.voice_id.in_(grouped))
            )
            for rows in result.all():
                grouped[rows[0].voice_id].append(_contribution_from_rows(*rows))
        return grouped


def _contribution_query():
    """A contribution with the speaker it points at and that speaker's run.

    Two joins rather than stored copies: the run and the video belong to the
    speaker, so reading them through it is what keeps one writer per fact.
    """
    return (
        select(VoiceContributionRow, VoiceRunSpeakerRow, VoiceRunRow)
        .join(
            VoiceRunSpeakerRow,
            VoiceContributionRow.speaker_id == VoiceRunSpeakerRow.id,
        )
        .join(VoiceRunRow, VoiceRunSpeakerRow.run_id == VoiceRunRow.id)
        .order_by(VoiceContributionRow.created_at)
    )


def _contribution_from_rows(
    contribution_row: VoiceContributionRow,
    speaker_row: VoiceRunSpeakerRow,
    run_row: VoiceRunRow,
) -> VoiceContribution:
    return VoiceContribution(
        id=contribution_row.id,
        voice_id=contribution_row.voice_id,
        speaker_id=contribution_row.speaker_id,
        run_id=speaker_row.run_id,
        # video_id only: the factory owns the title, and a caller that wants
        # one resolves it at read time -- see core/video_titles.py
        video_id=run_row.video_id,
        speaker_label=speaker_row.label,
        created_at=contribution_row.created_at,
    )
