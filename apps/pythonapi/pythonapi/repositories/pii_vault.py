"""Storage for the PII vault: surrogate token -> real value.

This is storage-only, no masking/detection logic - that lives in
core/pii.py's PiiMasker, which composes an instance of PiiVaultRepository.
Kept as its own Protocol (mirroring DocumentRepository's Postgres/InMemory
split) so any future PII-aware code path - not just /search - can reuse
put_many/get_many/get directly without going through PiiMasker's Presidio
analysis step.
"""

import asyncio
from typing import Protocol

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from pythonapi.models.orm import PiiVaultRow


class PiiVaultRepository(Protocol):
    async def put_many(self, entries: dict[str, str]) -> None: ...

    async def get_many(self, tokens: list[str]) -> dict[str, str]: ...

    async def get(self, token: str) -> str | None: ...


class InMemoryPiiVaultRepository:
    """Dict-backed fallback for local dev without Postgres. Unencrypted, does
    not survive a restart - same role as InMemoryDocumentRepository."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def put_many(self, entries: dict[str, str]) -> None:
        if not entries:
            return
        async with self._lock:
            self._store.update(entries)

    async def get_many(self, tokens: list[str]) -> dict[str, str]:
        return {token: self._store[token] for token in tokens if token in self._store}

    async def get(self, token: str) -> str | None:
        return self._store.get(token)


class PostgresPiiVaultRepository:
    """Values are Fernet-encrypted before storage; plaintext PII never
    touches the schema or leaves this process."""

    def __init__(self, engine: AsyncEngine, encryption_key: str) -> None:
        self._engine = engine
        self._fernet = Fernet(encryption_key.encode())

    def _entity_type(self, token: str) -> str:
        # Entity types can contain underscores (e.g. US_SSN, PHONE_NUMBER),
        # so split on the last underscore, not the first.
        return token.strip("<>").rsplit("_", 1)[0]

    async def put_many(self, entries: dict[str, str]) -> None:
        if not entries:
            return
        stmt = insert(PiiVaultRow).values(
            [
                {
                    "token": token,
                    "entity_type": self._entity_type(token),
                    "encrypted_value": self._fernet.encrypt(value.encode()).decode(),
                }
                for token, value in entries.items()
            ]
        )
        stmt = stmt.on_conflict_do_nothing(index_elements=[PiiVaultRow.token])
        async with AsyncSession(self._engine) as session:
            await session.execute(stmt)
            await session.commit()

    async def get_many(self, tokens: list[str]) -> dict[str, str]:
        if not tokens:
            return {}
        stmt = select(PiiVaultRow).where(PiiVaultRow.token.in_(tokens))
        async with AsyncSession(self._engine) as session:
            rows = (await session.execute(stmt)).scalars().all()
        return {
            row.token: self._fernet.decrypt(row.encrypted_value.encode()).decode()
            for row in rows
        }

    async def get(self, token: str) -> str | None:
        return (await self.get_many([token])).get(token)
