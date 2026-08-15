"""Persistence for voices (Story 3.1).

Same shape as voice_runs.py: a Protocol contract, an in-memory double for
tests, and a Postgres implementation that opens its own session per method.
Unlike VoiceRunRepository, there is no lease/claim machinery here - nothing
reconciles a voice's training yet (that starts in Story 3.2/3.3).
"""

from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from pythonapi.models.orm import VoiceRow
from pythonapi.models.voices import Voice, VoicePhase


class VoiceRepository(Protocol):
    """Storage contract for voices."""

    async def create_voice(self, voice: Voice) -> None: ...

    async def get_voice(self, voice_id: str) -> Voice | None: ...

    async def get_voice_by_name(self, name: str) -> Voice | None:
        """The voice with this name, or None. Names are unique (FR22)."""
        ...


class InMemoryVoiceRepository:
    """Dict-backed VoiceRepository. Test double and local dev without
    Postgres."""

    def __init__(self) -> None:
        self._voices: dict[str, Voice] = {}

    async def create_voice(self, voice: Voice) -> None:
        self._voices[voice.id] = voice.model_copy(deep=True)

    async def get_voice(self, voice_id: str) -> Voice | None:
        voice = self._voices.get(voice_id)
        return voice.model_copy(deep=True) if voice else None

    async def get_voice_by_name(self, name: str) -> Voice | None:
        for voice in self._voices.values():
            if voice.name == name:
                return voice.model_copy(deep=True)
        return None


class PostgresVoiceRepository:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def create_voice(self, voice: Voice) -> None:
        async with AsyncSession(self._engine) as session:
            session.add(_row_from_voice(voice))
            await session.commit()

    async def get_voice(self, voice_id: str) -> Voice | None:
        async with AsyncSession(self._engine) as session:
            row = await session.get(VoiceRow, voice_id)
            return _voice_from_row(row) if row else None

    async def get_voice_by_name(self, name: str) -> Voice | None:
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                select(VoiceRow).where(VoiceRow.name == name).limit(1)
            )
            row = result.scalar_one_or_none()
            return _voice_from_row(row) if row else None


def _row_from_voice(voice: Voice) -> VoiceRow:
    return VoiceRow(
        id=voice.id,
        name=voice.name,
        phase=voice.phase.value,
        checkpoint_path=voice.checkpoint_path,
        created_at=voice.created_at,
        updated_at=voice.updated_at,
    )


def _voice_from_row(row: VoiceRow) -> Voice:
    return Voice(
        id=row.id,
        name=row.name,
        phase=VoicePhase(row.phase),
        checkpoint_path=row.checkpoint_path,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
