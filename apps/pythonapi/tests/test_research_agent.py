"""Research Agent: the skill, its card, and its A2A task handling.

The skill tests drive `RagResearchAgent` directly with a stubbed pipeline.
The task tests drive the real executor through the real SDK client over an
in-process transport, so the A2A wire format is exercised rather than
assumed.
"""

import httpx
import pytest
from a2a.client import ClientConfig, create_client
from a2a.types import Message, Part, Role, SendMessageRequest, TaskState

from pythonapi.a2a_support.service import build_a2a_service
from pythonapi.agents.research.card import (
    RESEARCH_SKILL_ID,
    build_research_agent_card,
)
from pythonapi.agents.research.executor import ResearchAgentExecutor
from pythonapi.agents.research.interface import ResearchAnswer, ResearchQuestion
from pythonapi.agents.research.rag_research_agent import (
    NO_RESULTS_ANSWER,
    RagResearchAgent,
)
from pythonapi.models.documents import RagAnswer, SearchResponse, SearchResultItem

AGENT_BASE_URL = "http://research.test"


def _search_result(document_id: str, title: str, chunk_index: int = 0):
    return SearchResultItem(
        document_id=document_id,
        document_title=title,
        chunk_index=chunk_index,
        text="Voice training needs clean single-speaker clips.",
        score=0.9,
    )


def _search_response(results, *, is_answerable=True, answer="Clean clips."):
    return SearchResponse(
        query="anything",
        answer=RagAnswer(is_answerable=is_answerable, answer=answer, confidence=0.8),
        results=results,
    )


@pytest.fixture
def pipeline_result(monkeypatch):
    """Swap the RAG pipeline for a stub the test controls.

    The agent imports `search_and_generate` into its own module namespace, so
    the patch has to land there rather than on the pipeline module.
    """
    holder = {}

    async def fake_search_and_generate(**kwargs):
        holder["kwargs"] = kwargs
        return holder["response"]

    monkeypatch.setattr(
        "pythonapi.agents.research.rag_research_agent.search_and_generate",
        fake_search_and_generate,
    )
    return holder


class _StubDependencies:
    """Stands in for the slice of app.state the skill reads.

    Every attribute goes straight through to the patched pipeline, so None is
    fine - the test asserts on what was passed, not on what it does.
    """

    document_repository = None
    embedding_index = None
    embedding_client = None
    reranker = None
    pii_masker = None
    answer_generator = None
    search_cache = None


@pytest.fixture
def agent():
    return RagResearchAgent(lambda: _StubDependencies())


@pytest.mark.asyncio
async def test_research_returns_answer_with_sources(agent, pipeline_result):
    pipeline_result["response"] = _search_response(
        [_search_result("doc-1", "piper-training.md")],
        answer="Voice training requires clean clips.",
    )

    answer = await agent.research(ResearchQuestion(question="training needs?"))

    assert answer.answer == "Voice training requires clean clips."
    assert [(source.document_id, source.title) for source in answer.sources] == [
        ("doc-1", "piper-training.md")
    ]


@pytest.mark.asyncio
async def test_research_cites_each_document_once(agent, pipeline_result):
    """Several chunks of one document is the normal case for a good match."""
    pipeline_result["response"] = _search_response(
        [
            _search_result("doc-1", "piper-training.md", chunk_index=0),
            _search_result("doc-1", "piper-training.md", chunk_index=3),
            _search_result("doc-2", "diarization.md"),
        ]
    )

    answer = await agent.research(ResearchQuestion(question="training needs?"))

    assert [source.document_id for source in answer.sources] == ["doc-1", "doc-2"]


@pytest.mark.asyncio
async def test_research_returns_no_results_when_nothing_retrieved(
    agent, pipeline_result
):
    pipeline_result["response"] = _search_response([])

    answer = await agent.research(ResearchQuestion(question="unrelated"))

    assert answer.answer == NO_RESULTS_ANSWER
    assert answer.sources == []


@pytest.mark.asyncio
async def test_research_returns_no_results_when_answer_is_not_answerable(
    agent, pipeline_result
):
    """Retrieval found chunks, but the generator judged them irrelevant."""
    pipeline_result["response"] = _search_response(
        [_search_result("doc-1", "diarization.md")], is_answerable=False
    )

    answer = await agent.research(ResearchQuestion(question="unrelated"))

    assert answer.answer == NO_RESULTS_ANSWER
    assert answer.sources == []


@pytest.mark.asyncio
async def test_research_passes_the_question_through_unchanged(agent, pipeline_result):
    pipeline_result["response"] = _search_response([_search_result("doc-1", "a.md")])

    await agent.research(ResearchQuestion(question="how long does training take?"))

    assert pipeline_result["kwargs"]["query"] == "how long does training take?"


def test_card_declares_every_field_the_spec_requires():
    card = build_research_agent_card(f"{AGENT_BASE_URL}/")

    assert card.name
    assert card.description
    assert list(card.default_input_modes)
    assert list(card.default_output_modes)
    assert [skill.id for skill in card.skills] == [RESEARCH_SKILL_ID]

    interface = card.supported_interfaces[0]
    assert interface.url == f"{AGENT_BASE_URL}/"
    assert interface.protocol_version == "1.0"


def test_card_does_not_promise_push_notifications():
    """The spec rules them out for the first version, so the card must not
    advertise them."""
    card = build_research_agent_card(f"{AGENT_BASE_URL}/")

    assert card.capabilities.push_notifications is False


class _FixedAnswerAgent:
    def __init__(self, answer: ResearchAnswer):
        self._answer = answer

    async def research(self, request: ResearchQuestion) -> ResearchAnswer:
        return self._answer


def _build_app(answer: ResearchAnswer):
    return build_a2a_service(
        agent_card=build_research_agent_card(f"{AGENT_BASE_URL}/"),
        executor=ResearchAgentExecutor(_FixedAnswerAgent(answer)),
    )


async def _send(app, text: str):
    """Send one A2A message to `app` and return the events it produced."""
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
    """The Task carried by the last response that has one.

    A StreamResponse is a protobuf oneof, so the payload has to be selected
    by name rather than found by attribute.
    """
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
    app = _build_app(
        ResearchAnswer(
            answer="Training takes days.",
            sources=[{"document_id": "doc-1", "title": "piper-training.md"}],
        )
    )

    task = _final_task(await _send(app, "how long does training take?"))

    assert task.status.state == TaskState.TASK_STATE_COMPLETED
    assert _answer_text(task) == "Training takes days."


@pytest.mark.asyncio
async def test_a2a_task_carries_sources_as_metadata():
    """The Orchestrator reads sources from metadata, not from the prose."""
    app = _build_app(
        ResearchAnswer(
            answer="Training takes days.",
            sources=[{"document_id": "doc-1", "title": "piper-training.md"}],
        )
    )

    task = _final_task(await _send(app, "how long?"))
    metadata = task.status.message.metadata

    assert metadata["skill"] == RESEARCH_SKILL_ID
    assert metadata["sources"][0]["title"] == "piper-training.md"


@pytest.mark.asyncio
async def test_a2a_task_with_no_sources_still_completes():
    """A no-results answer is a completed task, not a failed one."""
    app = _build_app(ResearchAnswer(answer=NO_RESULTS_ANSWER, sources=[]))

    task = _final_task(await _send(app, "something unrelated"))

    assert task.status.state == TaskState.TASK_STATE_COMPLETED
    assert list(task.status.message.metadata["sources"]) == []


@pytest.mark.asyncio
async def test_a2a_task_is_rejected_when_the_question_is_empty():
    app = _build_app(ResearchAnswer(answer="unused", sources=[]))

    task = _final_task(await _send(app, "   "))

    assert task.status.state == TaskState.TASK_STATE_REJECTED
