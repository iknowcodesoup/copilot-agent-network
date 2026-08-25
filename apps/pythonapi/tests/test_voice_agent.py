"""Voice Agent: its card, its skill dispatch, and its A2A task handling.

The pipeline itself is stubbed. What matters here is the agent boundary: that
the right skill runs, that a bad input is rejected before anything executes,
and that the voice factory being off is reported rather than raised.
"""

import httpx
import pytest
from a2a.client import ClientConfig, create_client
from a2a.types import Message, Part, Role, SendMessageRequest, TaskState

from pythonapi.a2a_support.service import build_a2a_service
from pythonapi.agents.voice.card import build_voice_agent_card
from pythonapi.agents.voice.executor import VoiceAgentExecutor
from pythonapi.agents.voice.interface import (
    VoiceRunSummary,
    VoiceSearchRequest,
    VoiceSkill,
    VoiceStatusResult,
)
from pythonapi.agents.voice.pipeline_voice_agent import (
    PipelineVoiceAgent,
    VoiceFactoryNotConfigured,
)
from pythonapi.models.voice_run import VoiceRunPhase

AGENT_BASE_URL = "http://voice.test"
RUN_ID = "4f21aabbccddeeff00112233445566aa"


def test_card_publishes_every_skill():
    """There is no review skill. Review is not an action a person takes once:
    they decide clips, and a voice compiles whatever the decisions say when it
    next trains."""
    card = build_voice_agent_card(f"{AGENT_BASE_URL}/")

    assert [skill.id for skill in card.skills] == [
        VoiceSkill.VOICE_SEARCH.value,
        VoiceSkill.VOICE_RUN.value,
        VoiceSkill.VOICE_STATUS.value,
    ]


def test_card_advertises_the_current_protocol_version():
    card = build_voice_agent_card(f"{AGENT_BASE_URL}/")

    assert card.supported_interfaces[0].protocol_version == "1.0"


class _NoGatewayDependencies:
    """The voice factory is unset, which is the default in local dev."""

    voice_factory_gateway = None
    voice_run_repository = None


@pytest.mark.asyncio
async def test_a_skill_reports_when_the_voice_factory_is_not_configured():
    """VOICE_FACTORY_URL unset must degrade, not crash - research has to keep
    working."""
    agent = PipelineVoiceAgent(lambda: _NoGatewayDependencies())

    with pytest.raises(VoiceFactoryNotConfigured):
        await agent.voice_search(VoiceSearchRequest(query="anything"))


class _StubVoiceAgent:
    """Records the skill that ran and returns a fixed result."""

    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.called = None

    async def _run(self, name, request):
        self.called = (name, request)
        if self.error is not None:
            raise self.error
        return self.result

    async def voice_search(self, request):
        return await self._run("voice_search", request)

    async def voice_run(self, request):
        return await self._run("voice_run", request)

    async def voice_status(self, request):
        return await self._run("voice_status", request)

    async def voice_review(self, request):
        return await self._run("voice_review", request)


def _build_app(agent):
    return build_a2a_service(
        agent_card=build_voice_agent_card(f"{AGENT_BASE_URL}/"),
        executor=VoiceAgentExecutor(agent),
    )


async def _send(app, *, text="do the thing", metadata=None):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=AGENT_BASE_URL
    ) as http:
        client = await create_client(
            AGENT_BASE_URL,
            client_config=ClientConfig(httpx_client=http, streaming=False),
        )
        message = Message(
            message_id="test-message",
            role=Role.ROLE_USER,
            parts=[Part(text=text)],
        )
        if metadata is not None:
            message.metadata.update(metadata)
        events = [
            event
            async for event in client.send_message(SendMessageRequest(message=message))
        ]
    tasks = [event.task for event in events if event.WhichOneof("payload") == "task"]
    return tasks[-1]


@pytest.mark.asyncio
async def test_a_message_with_no_skill_is_rejected():
    """Nothing is inferred from the text: an unnamed skill must not run
    anything."""
    agent = _StubVoiceAgent()
    task = await _send(_build_app(agent))

    assert task.status.state == TaskState.TASK_STATE_REJECTED
    assert agent.called is None


@pytest.mark.asyncio
async def test_an_unknown_skill_is_rejected():
    agent = _StubVoiceAgent()
    task = await _send(_build_app(agent), metadata={"skill": "delete_everything"})

    assert task.status.state == TaskState.TASK_STATE_REJECTED
    assert agent.called is None


@pytest.mark.asyncio
async def test_bad_arguments_are_rejected_before_the_skill_runs():
    """A payload that will not parse must not reach the pipeline.

    An empty payload is valid now, because run_id is optional and means "list
    the runs". A limit that is not a number is still nonsense.
    """
    agent = _StubVoiceAgent()
    task = await _send(
        _build_app(agent),
        metadata={
            "skill": VoiceSkill.VOICE_STATUS.value,
            "arguments": {"limit": "many"},
        },
    )

    assert task.status.state == TaskState.TASK_STATE_REJECTED
    assert agent.called is None


@pytest.mark.asyncio
async def test_the_named_skill_runs_with_its_parsed_arguments():
    agent = _StubVoiceAgent(
        result=VoiceStatusResult(
            runs=[VoiceRunSummary(id=RUN_ID, phase=VoiceRunPhase.DOWNLOADING.value)]
        )
    )

    task = await _send(
        _build_app(agent),
        metadata={
            "skill": VoiceSkill.VOICE_STATUS.value,
            "arguments": {"run_id": RUN_ID},
        },
    )

    assert task.status.state == TaskState.TASK_STATE_COMPLETED
    assert agent.called[0] == "voice_status"
    assert agent.called[1].run_id == RUN_ID


@pytest.mark.asyncio
async def test_a_completed_task_carries_the_full_result_as_metadata():
    agent = _StubVoiceAgent(
        result=VoiceStatusResult(
            runs=[VoiceRunSummary(id=RUN_ID, phase=VoiceRunPhase.INGESTED.value)]
        )
    )

    task = await _send(
        _build_app(agent),
        metadata={
            "skill": VoiceSkill.VOICE_STATUS.value,
            "arguments": {"run_id": RUN_ID},
        },
    )
    metadata = task.status.message.metadata

    assert metadata["skill"] == VoiceSkill.VOICE_STATUS.value
    assert metadata["result"]["runs"][0]["id"] == RUN_ID


@pytest.mark.asyncio
async def test_an_unconfigured_factory_fails_the_task_with_a_reason():
    agent = _StubVoiceAgent(
        error=VoiceFactoryNotConfigured("The voice factory is not configured.")
    )

    task = await _send(
        _build_app(agent),
        metadata={
            "skill": VoiceSkill.VOICE_STATUS.value,
            "arguments": {"run_id": RUN_ID},
        },
    )

    assert task.status.state == TaskState.TASK_STATE_FAILED
    assert "not configured" in task.status.message.parts[0].text
