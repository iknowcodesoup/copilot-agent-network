"""The four voice skills, implemented over the existing voice pipeline.

Every skill delegates: search and the speaker map go to the factory gateway,
run state comes from the repository, and starting a run or approving a review
goes through core.voice_operations - the same code the REST routes call. So a
skill call and a REST call cannot drift apart.

Nothing here writes `voice_runs.phase` outside the one transition a person
makes. VoiceRunReconciler stays the only writer of every other phase.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from pythonapi.agents.voice.interface import (
    VoiceRunSummary,
    VoiceSearchRequest,
    VoiceSearchResult,
    VoiceSearchSubject,
    VoiceStatusRequest,
    VoiceStatusResult,
)
from pythonapi.core.video_titles import resolve_video_titles
from pythonapi.core.voice_factory_gateway import VoiceFactoryGateway
from pythonapi.core.voice_operations import load_run, start_voice_run
from pythonapi.models.voice_run import VoiceRunRequest, VoiceRunResponse
from pythonapi.repositories.voice_runs import VoiceRunRepository


class VoiceDependencies(Protocol):
    """The slice of `app.state` the voice skills read."""

    voice_factory_gateway: VoiceFactoryGateway | None
    voice_run_repository: VoiceRunRepository


class VoiceFactoryNotConfigured(RuntimeError):
    """VOICE_FACTORY_URL is unset, so every voice skill is unavailable.

    The spec keeps this failure isolated: research and general requests must
    still work when the voice side is off.
    """


class PipelineVoiceAgent:
    """Answers voice requests from the existing run state and factory."""

    def __init__(self, dependencies_provider: Callable[[], VoiceDependencies]) -> None:
        self._dependencies_provider = dependencies_provider

    def _dependencies(self) -> VoiceDependencies:
        dependencies = self._dependencies_provider()
        if getattr(dependencies, "voice_factory_gateway", None) is None:
            raise VoiceFactoryNotConfigured(
                "The voice factory is not configured, so voice work is unavailable."
            )
        return dependencies

    async def voice_search(self, request: VoiceSearchRequest) -> VoiceSearchResult:
        dependencies = self._dependencies()
        if request.subject is VoiceSearchSubject.CHARACTERS:
            characters = await dependencies.voice_factory_gateway.list_characters()
            return VoiceSearchResult(characters=characters)

        videos = await dependencies.voice_factory_gateway.search_videos(
            request.query, request.limit
        )
        return VoiceSearchResult(videos=videos)

    async def voice_run(self, request: VoiceRunRequest) -> VoiceRunResponse:
        dependencies = self._dependencies()
        return await start_voice_run(
            request,
            dependencies.voice_factory_gateway,
            dependencies.voice_run_repository,
        )

    async def voice_status(self, request: VoiceStatusRequest) -> VoiceStatusResult:
        # Status reads run state only, so naming a run never reaches the
        # factory and does not go through the gateway check the others share.
        dependencies = self._dependencies_provider()
        if request.run_id is not None:
            run = await load_run(dependencies.voice_run_repository, request.run_id)
            return VoiceStatusResult(run=run)

        runs = await dependencies.voice_run_repository.list_runs(limit=request.limit)
        # The factory owns the video title and a run row carries only the id,
        # so one call names every video in the page.
        titles = await resolve_video_titles(
            self._dependencies().voice_factory_gateway,
            [run.video_id for run in runs],
        )
        return VoiceStatusResult(
            runs=[
                VoiceRunSummary(
                    id=run.id,
                    primary_character=run.primary_character,
                    phase=run.phase.value,
                    video_title=titles.get(run.video_id),
                    error=run.error,
                )
                for run in runs
            ]
        )
