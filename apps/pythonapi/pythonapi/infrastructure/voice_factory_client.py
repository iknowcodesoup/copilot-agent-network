"""HTTP client for the jeanlucrecord control API.

Follows the same shape as redis_client.py: build_voice_factory_client is called
exactly once, from main.py's lifespan, and the result is stored on app.state.
No module-level client instance lives here.

The control API is optional. It runs on the host machine, outside this compose
stack, because TTS training needs an NVIDIA GPU and Docker. When
VOICE_FACTORY_URL is unset every /api/voice route answers 503 rather than
failing at startup.
"""

import httpx

from pythonapi.config import Settings


def build_voice_factory_client(settings: Settings) -> httpx.AsyncClient | None:
    """Build a client for the control API when VOICE_FACTORY_URL is set."""
    if not settings.VOICE_FACTORY_URL:
        return None
    return httpx.AsyncClient(
        base_url=settings.VOICE_FACTORY_URL.rstrip("/"),
        timeout=settings.VOICE_FACTORY_TIMEOUT_SECONDS,
    )


async def close_voice_factory_client(client: httpx.AsyncClient) -> None:
    await client.aclose()
