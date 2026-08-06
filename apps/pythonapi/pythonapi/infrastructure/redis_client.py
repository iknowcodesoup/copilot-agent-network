"""Redis client construction.

No module-level client instance lives here on purpose: build_redis_client
is called exactly once, from main.py's lifespan, and the resulting instance
is stored on app.state. Routes and middleware read it from there (directly
or via dependencies.py) instead of importing a shared global.
"""

from redis.asyncio import Redis

from pythonapi.config import Settings


def build_redis_client(settings: Settings) -> Redis | None:
    """Build a Redis client when REDIS_URL is configured, else None."""
    if not settings.REDIS_URL:
        return None
    return Redis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)


async def close_redis_client(client: Redis) -> None:
    await client.aclose()
