"""Find the specialist agents and hold one A2A client for each.

The Orchestrator learns what a specialist can do by reading its Agent Card,
never from a hard-coded list. This module resolves those cards and caches the
client built from each one.

Two transports, one protocol. A mounted specialist is reached over an
in-process ASGI transport; a specialist with a configured URL is reached over
the network. Both speak real A2A JSON-RPC through the SDK's own client, so
delegation code cannot tell the difference and no code path fakes the
protocol.
"""

from __future__ import annotations

import logging
from enum import StrEnum

import httpx
from a2a.client import A2ACardResolver, ClientConfig, create_client
from a2a.client.client import Client
from a2a.types import AgentCard

from pythonapi.config import settings

logger = logging.getLogger(__name__)


class Specialist(StrEnum):
    """The agents the Orchestrator can delegate to."""

    RESEARCH = "research"
    VOICE = "voice"


class SpecialistUnavailable(RuntimeError):
    """A specialist could not be reached, or its card would not resolve.

    Raised so the Orchestrator can keep one agent's failure from touching the
    other (CAP-5).
    """


def _configured_url(specialist: Specialist) -> str:
    if specialist is Specialist.RESEARCH:
        return settings.research_agent_public_url
    return settings.voice_agent_public_url


class SpecialistDirectory:
    """Resolves specialist Agent Cards and caches a client per specialist.

    Built once per process and stored on `app.state`. Resolution is lazy: a
    specialist that is never used is never contacted, and a specialist that
    was down at startup can succeed on a later request.
    """

    def __init__(self, *, local_app=None) -> None:
        # The mounted specialists live inside this same app, so reaching them
        # means dispatching back into it rather than opening a socket to
        # ourselves.
        self._local_app = local_app
        self._clients: dict[Specialist, Client] = {}
        self._cards: dict[Specialist, AgentCard] = {}
        self._http_clients: list[httpx.AsyncClient] = []

    def _build_http_client(self, specialist: Specialist) -> httpx.AsyncClient:
        remote_url = (
            settings.RESEARCH_AGENT_A2A_URL
            if specialist is Specialist.RESEARCH
            else settings.VOICE_AGENT_A2A_URL
        )
        if remote_url or self._local_app is None:
            return httpx.AsyncClient(timeout=settings.A2A_TASK_TIMEOUT_SECONDS)
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self._local_app),
            timeout=settings.A2A_TASK_TIMEOUT_SECONDS,
        )

    async def _resolve(self, specialist: Specialist) -> None:
        """Fetch the card and build the client, or report the agent as down."""
        url = _configured_url(specialist)
        http_client = self._build_http_client(specialist)
        try:
            # The card is fetched explicitly rather than left to the client
            # factory, because the Orchestrator needs the card itself: the
            # skills it routes to are read from it, never hard-coded.
            resolver = A2ACardResolver(
                httpx_client=http_client, base_url=url.rstrip("/")
            )
            card = await resolver.get_agent_card()
            client = await create_client(
                card,
                client_config=ClientConfig(httpx_client=http_client, streaming=False),
            )
        except Exception as error:
            await http_client.aclose()
            logger.warning(
                "specialist card did not resolve",
                extra={"agent": specialist.value, "url": url, "error": str(error)},
            )
            raise SpecialistUnavailable(
                f"The {specialist.value} agent did not answer at {url}."
            ) from error

        self._http_clients.append(http_client)
        self._clients[specialist] = client
        self._cards[specialist] = card

    async def client_for(self, specialist: Specialist) -> Client:
        """Return the A2A client for one specialist, resolving its card once."""
        if specialist not in self._clients:
            await self._resolve(specialist)
        return self._clients[specialist]

    async def card_for(self, specialist: Specialist) -> AgentCard:
        """Return one specialist's Agent Card, resolving it if needed."""
        if specialist not in self._cards:
            await self._resolve(specialist)
        return self._cards[specialist]

    async def skills_for(self, specialist: Specialist) -> list[str]:
        """The skill ids a specialist publishes.

        Read from the card, so adding a skill to an agent needs no change
        here.
        """
        card = await self.card_for(specialist)
        return [skill.id for skill in card.skills]

    async def aclose(self) -> None:
        for http_client in self._http_clients:
            await http_client.aclose()
        self._http_clients.clear()
        self._clients.clear()
        self._cards.clear()
