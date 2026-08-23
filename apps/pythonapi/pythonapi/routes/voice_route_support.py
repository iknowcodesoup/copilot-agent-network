"""Shared HTTP-shaping helpers for the voice route modules.

Used both by the typed routes (which catch VoiceFactoryError) and by
voice_factory_proxy.py (which catches httpx.HTTPError from the raw
forwarded call) - both mean the same thing: the factory did not answer.
"""

from fastapi import HTTPException, status


def unavailable(error: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The voice factory did not answer: {error}",
    )
