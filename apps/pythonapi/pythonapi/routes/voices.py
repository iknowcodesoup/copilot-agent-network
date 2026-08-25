"""HTTP layer for the durable Voice entity.

Thin, like every other router here: it validates input and delegates to the
repositories. The one rule this file enforces is that a clip belongs to a
voice by id, never by name - the name is what a person reads and renames.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from pythonapi.core.voice_clip_view import to_voice_clips
from pythonapi.core.voice_factory_gateway import VoiceFactoryGateway
from pythonapi.dependencies import (
    get_required_voice_clip_repository,
    get_required_voice_repository,
    get_required_voice_training_reconciler,
    get_voice_factory_gateway,
)
from pythonapi.models.voice import (
    Voice,
    VoiceAssignResponse,
    VoiceClipAssignRequest,
    VoiceClipUnassignRequest,
    VoiceDatasetClip,
    VoicePhase,
    VoiceRequest,
    VoiceResponse,
)
from pythonapi.repositories.voice_clips import VoiceClipRepository
from pythonapi.repositories.voice_repository import VoiceRepository
from pythonapi.workers.voice_training_reconciler import VoiceTrainingReconciler

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

    Names are unique (FR22): the voice picker and "fetch by name" both depend
    on a name uniquely identifying one voice, so a duplicate is rejected
    rather than creating a second row.
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


@router.get("", response_model=list[Voice])
async def search_voices(
    query: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=50),
    repository: VoiceRepository = Depends(get_required_voice_repository),
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
    gateway: VoiceFactoryGateway | None = Depends(get_voice_factory_gateway),
):
    """List or search voices by name, each with the clips assigned to it.

    An empty query matches every voice, same as search_videos's contract
    elsewhere in this service - the picker opens with an empty query and
    shows something instead of nothing.

    The clips come back here and not only from GET /{id}, because the Voices
    card grid says what each voice is made of. Without them every card read an
    empty list and reported a voice with no clips, which is exactly what a
    voice built through the per-clip path used to look like. One batched
    query covers the whole page.
    """
    voices = await repository.search_voices(query, limit)
    grouped = await clip_repository.list_clips_for_voices(
        [voice.id for voice in voices]
    )
    for voice in voices:
        voice.clips = await to_voice_clips(grouped.get(voice.id, []), gateway)
    return voices


@router.get("/by-name/{name}/dataset", response_model=list[VoiceDatasetClip])
async def get_voice_dataset(
    name: str,
    repository: VoiceRepository = Depends(get_required_voice_repository),
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
):
    """Every kept clip assigned to this voice, for the voice factory.

    The factory calls this when it compiles a dataset. It is keyed by name
    rather than id because the factory names a voice by its work/ directory
    and has no id to send - and because this is the only place the two
    systems have to agree on a string, it stays the one and only join by
    name.

    Only kept clips. A clip a reviewer excluded, or has not decided on yet,
    is not training audio, and filtering here rather than there is what makes
    un-keeping a clip take effect on the next compile with nothing to undo.

    An unknown name answers an empty list, not a 404: the factory asks about
    a directory it holds, and a voice this service does not know simply has
    no clips.
    """
    voice = await repository.get_voice_by_name(name)
    if voice is None:
        return []
    clips = await clip_repository.list_clips_for_voice(voice.id)
    return [
        VoiceDatasetClip(
            video_id=clip.video_id or "",
            clip_id=clip.clip_id,
            start_sec=clip.start_sec or 0.0,
            end_sec=clip.end_sec or 0.0,
            text=clip.text,
        )
        for clip in clips
        if clip.keep
    ]


@router.get("/{voice_id}", response_model=Voice)
async def get_voice(
    voice_id: str,
    repository: VoiceRepository = Depends(get_required_voice_repository),
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
    gateway: VoiceFactoryGateway | None = Depends(get_voice_factory_gateway),
):
    """One voice and every clip assigned to it, across every video."""
    voice = await _load_voice(repository, voice_id)
    voice.clips = await to_voice_clips(
        await clip_repository.list_clips_for_voice(voice_id), gateway
    )
    return voice


@router.post("/{voice_id}/clips", response_model=VoiceAssignResponse)
async def assign_clips(
    voice_id: str,
    assign_request: VoiceClipAssignRequest,
    repository: VoiceRepository = Depends(get_required_voice_repository),
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
    gateway: VoiceFactoryGateway | None = Depends(get_voice_factory_gateway),
):
    """Assign clips to this voice. The only way a clip joins a voice.

    It starts no training and changes no phase, so reassigning a clip has no
    effect beyond recording it. Training is POST /{id}/train, per voice, and
    it compiles the dataset from these rows when it runs - which is what
    makes every assignment reversible without an un-merge step.
    """
    voice = await _load_voice(repository, voice_id)
    assigned = await clip_repository.assign_clips(
        voice.id, assign_request.video_id, assign_request.clip_ids
    )
    if assigned == 0:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"No clips of video {assign_request.video_id!r} matched those ids",
        )
    return VoiceAssignResponse(
        voice_id=voice.id,
        assigned_count=assigned,
        clips=await to_voice_clips(
            await clip_repository.list_clips_for_voice(voice.id), gateway
        ),
    )


@router.post("/{voice_id}/clips/unassign", response_model=VoiceAssignResponse)
async def unassign_clips(
    voice_id: str,
    unassign_request: VoiceClipUnassignRequest,
    repository: VoiceRepository = Depends(get_required_voice_repository),
    clip_repository: VoiceClipRepository = Depends(get_required_voice_clip_repository),
    gateway: VoiceFactoryGateway | None = Depends(get_voice_factory_gateway),
):
    """Take clips off this voice.

    A POST, not a DELETE: the call names a list of clip ids, and a body on a
    DELETE is the kind of thing a proxy or a client library is free to drop.

    The clips are untouched - they keep their keep decision, their text and
    their bounds. Only the assignment goes, so a clip taken off one voice is
    ready to be put on another.
    """
    voice = await _load_voice(repository, voice_id)
    removed = await clip_repository.unassign_clips(
        unassign_request.video_id, unassign_request.clip_ids
    )
    return VoiceAssignResponse(
        voice_id=voice.id,
        assigned_count=removed,
        clips=await to_voice_clips(
            await clip_repository.list_clips_for_voice(voice.id), gateway
        ),
    )


@router.post(
    "/{voice_id}/train",
    response_model=VoiceResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def train_voice(
    voice_id: str,
    repository: VoiceRepository = Depends(get_required_voice_repository),
    training_reconciler: VoiceTrainingReconciler = Depends(
        get_required_voice_training_reconciler
    ),
):
    """Start training, on demand, whatever the voice's current phase.

    It sets COMPILING, not TRAINING: the voice's dataset is rebuilt here, from
    every kept clip currently assigned to it across every video, before
    piper_train reads it. So a retrain always trains on the reviewer's live
    decisions rather than on whatever an earlier run left on disk.

    Retrain is always available: this always restarts from COMPILING and wakes
    the reconciler, so an operator can kick off a fresh run even while one is
    already in flight. Only an unknown voice is rejected.
    """
    voice = await _load_voice(repository, voice_id)
    voice.phase = VoicePhase.COMPILING
    voice.voyicer_job_id = None
    voice.compile_stage_index = 0
    await repository.update_voice(voice)
    training_reconciler.wake(voice_id)
    return VoiceResponse(id=voice.id, phase=voice.phase)
