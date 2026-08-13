"""Redis client construction.

No module-level client instance lives here on purpose: both builders are
called exactly once, from main.py's lifespan, and the resulting instances
are stored on app.state. Routes and middleware read them from there (directly
or via dependencies.py) instead of importing a shared global.

There are two clients because there are two access patterns. Ordinary commands
answer in milliseconds and want a short socket timeout, so a wedged server
fails a request instead of hanging it. A blocking read parks on purpose for its
whole block window, so the same short timeout would abort every one of them.
Never send a blocking command over the general client.
"""

from redis.asyncio import Redis

from pythonapi.config import Settings


def build_redis_client(settings: Settings) -> Redis | None:
    """Build the general Redis client when REDIS_URL is set, else None.

    Every socket timeout in this module is passed explicitly. redis-py's own
    default is not a stable contract: it changed from None ("block forever") to
    5 seconds, which turned the voice event tail read into a timeout every 5s
    while /health still reported the server connected.
    """
    if not settings.REDIS_URL:
        return None
    return Redis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        socket_timeout=settings.REDIS_SOCKET_TIMEOUT_SECONDS,
    )


def build_blocking_redis_client(
    settings: Settings, block_seconds: float
) -> Redis | None:
    """Build a client for reads that park for up to `block_seconds`.

    The socket timeout has to clear the block window, otherwise the client
    hangs up before the server ever answers. The general timeout is added on
    top as the margin: it is already the answer to "how long is too long once
    the server does reply".

    A separate pool, not just separate options. One blocking read holds its
    connection for the entire window, one per open SSE connection, so sharing
    the general pool would let a few open dashboards starve the idempotency
    middleware.
    """
    if not settings.REDIS_URL:
        return None
    return Redis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
        socket_timeout=block_seconds + settings.REDIS_SOCKET_TIMEOUT_SECONDS,
    )


async def close_redis_client(client: Redis) -> None:
    await client.aclose()
