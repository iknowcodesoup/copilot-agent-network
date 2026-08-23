"""Shared HTTP-shaping helpers for the voice run/video/job route modules."""

from fastapi import HTTPException, status

from pythonapi.core.voice_factory_gateway import VoiceFactoryError


def unavailable(error: VoiceFactoryError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The voice factory did not answer: {error}",
    )
