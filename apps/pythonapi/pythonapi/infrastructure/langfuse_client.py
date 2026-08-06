"""Langfuse client construction. See redis_client.py for the DI rationale."""

from langfuse import Langfuse

from pythonapi.config import Settings


def build_langfuse_client(settings: Settings) -> Langfuse | None:
    """Build a Langfuse client when its keys are configured, else None."""
    if not settings.LANGFUSE_PUBLIC_KEY or not settings.LANGFUSE_SECRET_KEY:
        return None
    return Langfuse(
        public_key=settings.LANGFUSE_PUBLIC_KEY,
        secret_key=settings.LANGFUSE_SECRET_KEY,
        host=settings.LANGFUSE_HOST,
        environment=settings.LANGFUSE_ENV,
        release=settings.LANGFUSE_RELEASE,
    )


def close_langfuse_client(client: Langfuse) -> None:
    client.flush()
