"""Voice run events, carried on a Redis Stream.

Redis is the delivery mechanism here, never the state store. Postgres holds the
durable run state; this stream exists so that a change made by one API instance
reaches every browser attached to any instance, and so a browser that dropped
its connection can ask for what it missed.

Three consequences follow from that, and each one is load-bearing:

- Losing Redis loses live updates, nothing else. Publishing failures are logged
  and swallowed, because the write to Postgres already succeeded and rolling it
  back would trade a cosmetic problem for a real one.
- The stream is bounded. It is a replay buffer, so old entries are worth less
  than the memory they hold.
- Every instance reads with XREAD, not a consumer group. A group would hand each
  event to one reader; every instance needs every event.

The Redis Stream ID doubles as the event ID, which is also the SSE `id:` a
browser sends back as Last-Event-ID. So there is no separate sequence column.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import RedisError

from pythonapi.models.voice import VoiceLogChunk, VoiceRun

logger = logging.getLogger(__name__)

# Named rather than inlined so the SSE route, the reconciler, and the browser
# all agree on the spelling.
EVENT_RUN_UPDATED = "voice.run.updated"
EVENT_RUN_LOG = "voice.run.log"

# Bump when the shape of `data` changes in a way a reader must notice.
SCHEMA_VERSION = 1

# Stream position meaning "everything from the very beginning".
STREAM_START = "0-0"

# One entry holds its whole event as JSON under this field.
PAYLOAD_FIELD = "payload"


class VoiceEvent(BaseModel):
    """One published change to one run.

    `data` carries the complete current run rather than a patch. A reader can
    then apply any event without holding the ones before it, which is what makes
    a reconnect cheap and a duplicate harmless.
    """

    event_id: str
    event_type: str
    aggregate_id: str
    occurred_at: datetime
    schema_version: int = SCHEMA_VERSION
    data: VoiceRun | VoiceLogChunk


class VoiceEventStream:
    """Publishes and replays voice run events.

    The Redis clients are optional, exactly like every other integration in this
    service. Without them, publishing does nothing and reading returns nothing:
    the pipeline still runs, the browser just has to reload to see a change.

    Two clients, because `follow` is the one method that parks on purpose. Its
    client carries a socket timeout wide enough for the block window; every
    other method here answers immediately and uses the general client, which
    has the short timeout. Sending `follow`'s XREAD over the general client
    aborts it mid-block. See infrastructure/redis_client.py.
    """

    def __init__(
        self,
        redis: Redis | None,
        blocking_redis: Redis | None,
        stream_key: str,
        max_length: int,
    ) -> None:
        self._redis = redis
        self._blocking_redis = blocking_redis
        self._stream_key = stream_key
        self._max_length = max_length

    @property
    def enabled(self) -> bool:
        return self._redis is not None

    async def publish(self, run: VoiceRun) -> str | None:
        """Publish a run's current state. Returns the assigned event id.

        Returns None when Redis is unset or unreachable. Callers must not treat
        that as a failure of the change itself - Postgres already has it.
        """
        if self._redis is None:
            return None

        event = VoiceEvent(
            # XADD assigns the real id; this placeholder never leaves the entry,
            # because readers overwrite it with the id Redis gave the entry.
            event_id="",
            event_type=EVENT_RUN_UPDATED,
            aggregate_id=run.id,
            occurred_at=datetime.now(UTC),
            data=run,
        )
        try:
            return await self._redis.xadd(
                self._stream_key,
                {PAYLOAD_FIELD: event.model_dump_json()},
                maxlen=self._max_length,
                approximate=True,
            )
        except RedisError as error:
            # The run is already durable. Live updates pause; the next
            # reconciliation publishes the state again.
            logger.warning("Could not publish a voice event for %s: %s", run.id, error)
            return None

    async def publish_log(
        self, run_id: str, job_id: str, offset: int, content: str
    ) -> str | None:
        """Publish new job-log content. Best-effort, same as publish()."""
        if self._redis is None:
            return None

        event = VoiceEvent(
            event_id="",
            event_type=EVENT_RUN_LOG,
            aggregate_id=run_id,
            occurred_at=datetime.now(UTC),
            data=VoiceLogChunk(
                run_id=run_id, job_id=job_id, offset=offset, content=content
            ),
        )
        try:
            return await self._redis.xadd(
                self._stream_key,
                {PAYLOAD_FIELD: event.model_dump_json()},
                maxlen=self._max_length,
                approximate=True,
            )
        except RedisError as error:
            logger.warning("Could not publish a voice log event for %s: %s", run_id, error)
            return None

    async def current_position(self) -> str:
        """The id of the newest entry, or the stream start when it is empty.

        An SSE connection captures this before it reads its snapshot, so a
        change published while the snapshot is being built still gets replayed.
        """
        if self._redis is None:
            return STREAM_START
        try:
            newest = await self._redis.xrevrange(self._stream_key, count=1)
        except RedisError as error:
            logger.warning("Could not read the voice event position: %s", error)
            return STREAM_START
        return newest[0][0] if newest else STREAM_START

    async def read_after(self, position: str, count: int) -> list[VoiceEvent]:
        """Events published after `position`. Does not block."""
        if self._redis is None:
            return []
        try:
            response = await self._redis.xread(
                {self._stream_key: position}, count=count
            )
        except RedisError as error:
            logger.warning("Could not replay voice events: %s", error)
            return []
        return _events_from(response)

    async def follow(
        self, position: str, block_milliseconds: int
    ) -> AsyncIterator[list[VoiceEvent]]:
        """Yield each batch of new events, forever.

        Yields an empty list when the block window passed with nothing new. The
        caller uses that as its idle tick - an SSE heartbeat, say - rather than
        running a second timer alongside this loop.
        """
        idle_seconds = block_milliseconds / 1000
        while True:
            if self._blocking_redis is None:
                # No stream to follow, but the caller's idle work still has to
                # happen, so keep the same cadence.
                await asyncio.sleep(idle_seconds)
                yield []
                continue
            try:
                response = await self._blocking_redis.xread(
                    {self._stream_key: position}, block=block_milliseconds
                )
            except RedisError as error:
                logger.warning("Voice event subscription failed: %s", error)
                await asyncio.sleep(idle_seconds)
                yield []
                continue

            events = _events_from(response)
            if not events:
                yield []
                continue
            position = events[-1].event_id
            yield events


def _events_from(response) -> list[VoiceEvent]:
    """Turn one XREAD/XRANGE reply into events, stamped with their stream ids."""
    events: list[VoiceEvent] = []
    for _stream_key, entries in response or []:
        for entry_id, fields in entries:
            payload = fields.get(PAYLOAD_FIELD)
            if payload is None:
                continue
            try:
                event = VoiceEvent.model_validate_json(payload)
            except ValueError as error:
                # An entry written by an older or newer schema. Skipping one
                # event beats dropping the whole subscription.
                logger.warning(
                    "Ignoring unreadable voice event %s: %s", entry_id, error
                )
                continue
            events.append(event.model_copy(update={"event_id": entry_id}))
    return events
