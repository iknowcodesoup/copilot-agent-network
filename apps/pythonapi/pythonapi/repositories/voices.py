"""Persistence for voices (Story 3.1).

Same shape as voice_runs.py: a Protocol contract, an in-memory double for
tests, and a Postgres implementation that opens its own session per method.

Story 3.3 adds the claim/lease machinery voice_runs.py already has: several
API instances can run at once, and two of them reconciling the same voice
would start the same factory training job twice. claim_voices takes
ownership in a single atomic UPDATE, so the database decides who wins.
"""

from datetime import UTC, datetime, timedelta
from typing import Protocol

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from pythonapi.models.orm import VoiceRow
from pythonapi.models.voices import RESTING_PHASES, Voice, VoicePhase


def _utc_now() -> datetime:
    """Now, as naive UTC.

    Every datetime in this file comes from here. The Postgres columns are
    TIMESTAMP WITHOUT TIME ZONE, so a stored value is always naive, and Python
    refuses to compare a naive datetime against an aware one. One helper is
    what keeps a single aware value from reaching a comparison.
    """
    return datetime.now(UTC).replace(tzinfo=None)


class VoiceRepository(Protocol):
    """Storage contract for voices."""

    async def create_voice(self, voice: Voice) -> None: ...

    async def get_voice(self, voice_id: str) -> Voice | None: ...

    async def get_voice_by_name(self, name: str) -> Voice | None:
        """The voice with this name, or None. Names are unique (FR22)."""
        ...

    async def search_voices(self, query: str, limit: int = 20) -> list[Voice]:
        """Voices whose name contains query, case-insensitively, by name.

        Backs the assign-speaker combobox (Story 3.5): a short list to pick
        an existing voice from, or a signal that none matches and inline
        create is the only option.
        """
        ...

    async def claim_voices(
        self, owner: str, lease_seconds: float, limit: int = 50
    ) -> list[Voice]:
        """Take ownership of every claimable voice no one else holds."""
        ...

    async def claim_voice(
        self, voice_id: str, owner: str, lease_seconds: float
    ) -> Voice | None:
        """Take ownership of one voice. None when it rests or someone holds
        it."""
        ...

    async def release_voice(self, voice_id: str) -> None:
        """Give up ownership so the next pass, here or elsewhere, can take
        it."""
        ...

    async def update_voice(self, voice: Voice) -> bool:
        """Persist a voice. False when it no longer exists."""
        ...


class InMemoryVoiceRepository:
    """Dict-backed VoiceRepository. Test double and local dev without
    Postgres."""

    def __init__(self) -> None:
        self._voices: dict[str, Voice] = {}
        # voice id -> (expiry, owner). Kept beside the voices rather than on
        # them, for the same reason the Postgres lease columns stay off
        # Voice: a lease is the reconciler's, not the voice's.
        self._leases: dict[str, tuple[datetime, str]] = {}

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

    async def search_voices(self, query: str, limit: int = 20) -> list[Voice]:
        needle = query.lower()
        matches = [
            voice for voice in self._voices.values() if needle in voice.name.lower()
        ]
        matches.sort(key=lambda voice: voice.name)
        return [voice.model_copy(deep=True) for voice in matches[:limit]]

    async def claim_voices(
        self, owner: str, lease_seconds: float, limit: int = 50
    ) -> list[Voice]:
        claimed = []
        for voice in sorted(self._voices.values(), key=lambda voice: voice.created_at):
            if len(claimed) >= limit:
                break
            if voice.phase in RESTING_PHASES or self._is_held(voice.id):
                continue
            self._take_lease(voice.id, owner, lease_seconds)
            claimed.append(voice.model_copy(deep=True))
        return claimed

    async def claim_voice(
        self, voice_id: str, owner: str, lease_seconds: float
    ) -> Voice | None:
        voice = self._voices.get(voice_id)
        if voice is None or voice.phase in RESTING_PHASES or self._is_held(voice_id):
            return None
        self._take_lease(voice_id, owner, lease_seconds)
        return voice.model_copy(deep=True)

    async def release_voice(self, voice_id: str) -> None:
        self._leases.pop(voice_id, None)

    async def update_voice(self, voice: Voice) -> bool:
        if voice.id not in self._voices:
            return False
        voice.updated_at = _utc_now()
        self._voices[voice.id] = voice.model_copy(deep=True)
        return True

    def _is_held(self, voice_id: str) -> bool:
        lease = self._leases.get(voice_id)
        return lease is not None and lease[0] > _utc_now()

    def _take_lease(self, voice_id: str, owner: str, lease_seconds: float) -> None:
        self._leases[voice_id] = (
            _utc_now() + timedelta(seconds=lease_seconds),
            owner,
        )


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

    async def search_voices(self, query: str, limit: int = 20) -> list[Voice]:
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                select(VoiceRow)
                .where(VoiceRow.name.ilike(f"%{query}%"))
                .order_by(VoiceRow.name)
                .limit(limit)
            )
            return [_voice_from_row(row) for row in result.scalars()]

    async def claim_voices(
        self, owner: str, lease_seconds: float, limit: int = 50
    ) -> list[Voice]:
        """Claim every free claimable voice in one atomic UPDATE.

        The WHERE clause is the mutual exclusion: two instances running this
        at the same moment cannot both match the same row, because the first
        one to commit moves leased_until into the future. RETURNING then
        tells us which rows we actually won, so nothing has to be read back
        and re-checked.
        """
        claimable = (
            select(VoiceRow.id)
            .where(VoiceRow.phase.not_in(_resting_phase_values()), _lease_is_free())
            .order_by(VoiceRow.created_at)
            .limit(limit)
            .scalar_subquery()
        )
        return await self._claim_where(VoiceRow.id.in_(claimable), owner, lease_seconds)

    async def claim_voice(
        self, voice_id: str, owner: str, lease_seconds: float
    ) -> Voice | None:
        claimed = await self._claim_where(VoiceRow.id == voice_id, owner, lease_seconds)
        return claimed[0] if claimed else None

    async def release_voice(self, voice_id: str) -> None:
        async with AsyncSession(self._engine) as session:
            await session.execute(
                update(VoiceRow)
                .where(VoiceRow.id == voice_id)
                .values(leased_until=None, lease_owner=None)
            )
            await session.commit()

    async def _claim_where(
        self, voice_filter, owner: str, lease_seconds: float
    ) -> list[Voice]:
        """The one UPDATE behind both claim methods.

        Everything stays inside the session: RETURNING rows are read, turned
        into plain Voice copies, and only then committed. Reading them after
        the session closed would hand back detached rows.
        """
        expiry = _utc_now() + timedelta(seconds=lease_seconds)
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                update(VoiceRow)
                .where(
                    voice_filter,
                    VoiceRow.phase.not_in(_resting_phase_values()),
                    _lease_is_free(),
                )
                .values(leased_until=expiry, lease_owner=owner)
                .returning(VoiceRow)
            )
            voices = [_voice_from_row(row) for row in result.scalars()]
            await session.commit()
            return voices

    async def update_voice(self, voice: Voice) -> bool:
        async with AsyncSession(self._engine) as session:
            row = await session.get(VoiceRow, voice.id)
            if row is None:
                return False
            row.name = voice.name
            row.phase = voice.phase.value
            row.checkpoint_path = voice.checkpoint_path
            row.voyicer_job_id = voice.voyicer_job_id
            row.updated_at = _utc_now()
            await session.commit()
            return True


def _resting_phase_values() -> list[str]:
    return [phase.value for phase in RESTING_PHASES]


def _lease_is_free():
    """No one holds this voice, or whoever did has gone away."""
    now = _utc_now()
    return (VoiceRow.leased_until.is_(None)) | (VoiceRow.leased_until < now)


def _row_from_voice(voice: Voice) -> VoiceRow:
    return VoiceRow(
        id=voice.id,
        name=voice.name,
        phase=voice.phase.value,
        checkpoint_path=voice.checkpoint_path,
        voyicer_job_id=voice.voyicer_job_id,
        created_at=voice.created_at,
        updated_at=voice.updated_at,
    )


def _voice_from_row(row: VoiceRow) -> Voice:
    return Voice(
        id=row.id,
        name=row.name,
        phase=VoicePhase(row.phase),
        checkpoint_path=row.checkpoint_path,
        voyicer_job_id=row.voyicer_job_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
