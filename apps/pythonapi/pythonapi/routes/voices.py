"""HTTP layer for the durable Voice entity (Story 3.1).

Thin, like every other router here: it validates input and delegates to the
repository. No training or contribution logic lives here yet - that starts
in Story 3.2/3.3.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status

from pythonapi.dependencies import (
    get_required_voice_contribution_repository,
    get_required_voice_repository,
)
from pythonapi.models.voices import Voice, VoicePhase, VoiceRequest, VoiceResponse
from pythonapi.repositories.voice_contributions import VoiceContributionRepository
from pythonapi.repositories.voices import VoiceRepository

router = APIRouter(prefix="/voices", tags=["Voices"])


async def _load_voice(repository: VoiceRepository, voice_id: str) -> Voice:
    voice = await repository.get_voice(voice_id)
    if voice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice not found")
    return voice


@router.post("", response_model=VoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_voice(
    voice_request: VoiceRequest,
    repository: VoiceRepository = Depends(get_required_voice_repository),
):
    """Create a voice by name.

    Names are unique (FR22): the combobox (Story 3.5) and "fetch by name"
    both depend on a name uniquely identifying one voice, so a duplicate is
    rejected rather than creating a second row.
    """
    existing = await repository.get_voice_by_name(voice_request.name)
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A voice named {voice_request.name!r} already exists",
        )

    now = datetime.now(UTC)
    voice = Voice(
        id=uuid.uuid4().hex,
        name=voice_request.name,
        phase=VoicePhase.AWAITING_COMMIT,
        created_at=now,
        updated_at=now,
    )
    await repository.create_voice(voice)
    return VoiceResponse(id=voice.id, phase=voice.phase)


@router.get("/{voice_id}", response_model=Voice)
async def get_voice(
    voice_id: str,
    repository: VoiceRepository = Depends(get_required_voice_repository),
    contribution_repository: VoiceContributionRepository = Depends(
        get_required_voice_contribution_repository
    ),
):
    voice = await _load_voice(repository, voice_id)
    voice.contributions = await contribution_repository.list_contributions_for_voice(
        voice_id
    )
    return voice
