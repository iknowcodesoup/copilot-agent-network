"""Orchestrator Agent: the `assist` skill, its card, and its A2A task handling.

Same structure as `test_research_agent.py`. The skill tests drive
`DelegatingOrchestratorAgent` directly with a stubbed `route_request`. The
task tests drive the real executor through the real SDK client over an
in-process transport.
"""

import httpx
import pytest
from a2a.client import ClientConfig, create_client
from a2a.types import Message, Part, Role, SendMessageRequest, TaskState

from pythonapi.a2a_support.service import build_a2a_service
from pythonapi.agents.orchestrator.card import (
    ORCHESTRATOR_SKILL_ID,
    build_orchestrator_agent_card,
)
from pythonapi.agents.orchestrator.delegating_agent import DelegatingOrchestratorAgent
from pythonapi.agents.orchestrator.executor import OrchestratorAgentExecutor
from pythonapi.agents.orchestrator.interface import (
    OrchestratorAnswer,
    OrchestratorRequest,
)

AGENT_BASE_URL = "http://orchestrator.test"


@pytest.fixture
def route_request(monkeypatch):
    """Swap `route_request` for a stub the test controls.

    `delegating_agent.py` imports the function into its own module
    namespace, so the patch has to land there rather than on
    `specialist_router`.
    """
    holder = {"result": None}

    async def fake_route_request(directory, text):
        holder["directory"] = directory
        holder["text"] = text
        return holder["result"]

    monkeypatch.setattr(
        "pythonapi.agents.orchestrator.delegating_agent.route_request",
        fake_route_request,
    )
    return holder


class _StubDependencies:
    def __init__(self, directory="a-directory"):
        self.specialist_directory = directory


@pytest.fixture
def agent():
    return DelegatingOrchestratorAgent(lambda: _StubDependencies())


@pytest.mark.asyncio
async def test_assist_returns_the_delegated_answer(agent, route_request):
    route_request["result"] = "Run state: still running.\n\nDocs: ..."

    answer = await agent.assist(OrchestratorRequest(text="why is this run slow?"))

    assert answer.answer == "Run state: still running.\n\nDocs: ..."


@pytest.mark.asyncio
async def test_assist_passes_the_directory_and_text_through(agent, route_request):
    route_request["result"] = "anything"

    await agent.assist(OrchestratorRequest(text="find Star Trek videos"))

    assert route_request["directory"] == "a-directory"
    assert route_request["text"] == "find Star Trek videos"


@pytest.mark.asyncio
async def test_assist_answers_a_general_request_directly(monkeypatch, route_request):
    """`route_request` returns None for a general request - the same
    contract `specialist_router.route_request` documents."""
    route_request["result"] = None

    async def fake_answer_directly(self, text):
        return f"a plain answer to: {text}"

    monkeypatch.setattr(
        "pythonapi.agents.orchestrator.delegating_agent."
        "DelegatingOrchestratorAgent._answer_directly",
        fake_answer_directly,
    )

    agent = DelegatingOrchestratorAgent(lambda: _StubDependencies())
    answer = await agent.assist(OrchestratorRequest(text="what is a language model?"))

    assert answer.answer == "a plain answer to: what is a language model?"


@pytest.mark.asyncio
async def test_assist_answers_directly_when_no_directory_is_available(
    monkeypatch, route_request
):
    """No specialist directory - e.g. outside a running lifespan - is the
    same case as a general request: answer directly, never crash."""
    route_request["result"] = "should not be used"

    async def fake_answer_directly(self, text):
        return "direct"

    monkeypatch.setattr(
        DelegatingOrchestratorAgent, "_answer_directly", fake_answer_directly
    )

    agent = DelegatingOrchestratorAgent(lambda: _StubDependencies(directory=None))
    answer = await agent.assist(OrchestratorRequest(text="hello"))

    assert answer.answer == "direct"
    assert "directory" not in route_request


def test_card_declares_every_field_the_spec_requires():
    card = build_orchestrator_agent_card(f"{AGENT_BASE_URL}/")

    assert card.name
    assert card.description
    assert list(card.default_input_modes)
    assert list(card.default_output_modes)
    assert [skill.id for skill in card.skills] == [ORCHESTRATOR_SKILL_ID]

    interface = card.supported_interfaces[0]
    assert interface.url == f"{AGENT_BASE_URL}/"
    assert interface.protocol_version == "1.0"


def test_card_does_not_promise_push_notifications():
    card = build_orchestrator_agent_card(f"{AGENT_BASE_URL}/")

    assert card.capabilities.push_notifications is False


class _FixedAnswerAgent:
    def __init__(self, answer: OrchestratorAnswer):
        self._answer = answer

    async def assist(self, request: OrchestratorRequest) -> OrchestratorAnswer:
        return self._answer


def _build_app(answer: OrchestratorAnswer):
    return build_a2a_service(
        agent_card=build_orchestrator_agent_card(f"{AGENT_BASE_URL}/"),
        executor=OrchestratorAgentExecutor(_FixedAnswerAgent(answer)),
    )


async def _send(app, text: str):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=AGENT_BASE_URL
    ) as http:
        client = await create_client(
            AGENT_BASE_URL,
            client_config=ClientConfig(httpx_client=http, streaming=False),
        )
        request = SendMessageRequest(
            message=Message(
                message_id="test-message",
                role=Role.ROLE_USER,
                parts=[Part(text=text)],
            )
        )
        return [event async for event in client.send_message(request)]


TASK_PAYLOAD = "task"


def _final_task(events):
    tasks = [
        getattr(event, TASK_PAYLOAD)
        for event in events
        if event.WhichOneof("payload") == TASK_PAYLOAD
    ]
    return tasks[-1]


def _answer_text(task):
    return task.status.message.parts[0].text


@pytest.mark.asyncio
async def test_a2a_task_completes_and_carries_the_answer():
    app = _build_app(OrchestratorAnswer(answer="Training takes days."))

    task = _final_task(await _send(app, "why is this run slow?"))

    assert task.status.state == TaskState.TASK_STATE_COMPLETED
    assert _answer_text(task) == "Training takes days."


@pytest.mark.asyncio
async def test_a2a_task_is_rejected_when_the_request_is_empty():
    app = _build_app(OrchestratorAnswer(answer="unused"))

    task = _final_task(await _send(app, "   "))

    assert task.status.state == TaskState.TASK_STATE_REJECTED
