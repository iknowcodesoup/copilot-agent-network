"""AG-UI agent endpoint tests.

The CopilotKit v2 frontend consumes this route directly, so these tests assert
the wire format it depends on: SSE frames carrying AG-UI events, in the run
lifecycle order the client's state machine expects.
"""

import json

import pytest

from pythonapi.agents.orchestrator import chat_agent
from pythonapi.config import settings


def _run_input(content: str = "Hello") -> dict:
    return {
        "threadId": "thread-1",
        "runId": "run-1",
        "state": {},
        "messages": [{"id": "m1", "role": "user", "content": content}],
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }


def _parse_sse(body: str) -> list[dict]:
    return [
        json.loads(line[len("data: ") :])
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


class _FakeDelta:
    def __init__(self, content: str | None) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str | None) -> None:
        self.delta = _FakeDelta(content)


class _FakeChunk:
    def __init__(self, content: str | None) -> None:
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, chunks: list[str | None], recorder: dict) -> None:
        self._chunks = chunks
        self._recorder = recorder

    async def create(self, **kwargs):
        self._recorder.update(kwargs)

        async def stream():
            for chunk in self._chunks:
                yield _FakeChunk(chunk)

        return stream()


class _FakeOpenAI:
    """Stands in for AsyncOpenAI so no test ever reaches the LiteLLM gateway."""

    def __init__(self, chunks: list[str | None], recorder: dict) -> None:
        self.chat = type(
            "Chat", (), {"completions": _FakeCompletions(chunks, recorder)}
        )()
        self.closed = False

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def stub_llm(monkeypatch):
    """Patch the agent's OpenAI client and supply a key so the route runs."""
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    recorder: dict = {}

    def install(chunks: list[str | None]):
        client = _FakeOpenAI(chunks, recorder)
        monkeypatch.setattr(chat_agent, "AsyncOpenAI", lambda **_: client)
        return client, recorder

    return install


def test_agent_streams_agui_run_lifecycle(client, stub_llm):
    stub_llm(["Hel", "lo", None])

    response = client.post("/api/agent", json=_run_input())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse(response.text)
    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]

    # The client correlates deltas to a message by id, so every text event in
    # a run has to carry the same one.
    message_ids = {
        event["messageId"]
        for event in events
        if event["type"].startswith("TEXT_MESSAGE")
    }
    assert len(message_ids) == 1

    assert (
        "".join(
            event["delta"]
            for event in events
            if event["type"] == "TEXT_MESSAGE_CONTENT"
        )
        == "Hello"
    )

    assert events[0]["threadId"] == "thread-1"
    assert events[0]["runId"] == "run-1"


def test_agent_forwards_messages_to_the_model(client, stub_llm):
    _, recorder = stub_llm(["ok"])

    client.post("/api/agent", json=_run_input("What is the status?"))

    assert recorder["messages"] == [{"role": "user", "content": "What is the status?"}]
    assert recorder["stream"] is True


def test_agent_flattens_multimodal_user_content(client, stub_llm):
    _, recorder = stub_llm(["ok"])

    payload = _run_input()
    payload["messages"] = [
        {
            "id": "m1",
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this"},
                {
                    "type": "image",
                    "source": {
                        "type": "data",
                        "value": "AAAA",
                        "mimeType": "image/png",
                    },
                },
            ],
        }
    ]

    client.post("/api/agent", json=payload)

    # The image part is dropped rather than stringified - this agent has no
    # vision path, and its repr would be base64 noise in the prompt.
    assert recorder["messages"] == [{"role": "user", "content": "Describe this"}]


def test_agent_reports_model_failure_as_a_run_error(client, stub_llm, monkeypatch):
    stub_llm(["ok"])

    async def explode(**_):
        raise RuntimeError("gateway unreachable")

    monkeypatch.setattr(
        chat_agent, "AsyncOpenAI", lambda **_: _ExplodingClient(explode)
    )

    response = client.post("/api/agent", json=_run_input())

    # The stream is already open by the time the call fails, so the failure
    # has to arrive as an event rather than an HTTP error status.
    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert events[0]["type"] == "RUN_STARTED"
    assert events[-1]["type"] == "RUN_ERROR"
    assert "gateway unreachable" in events[-1]["message"]


class _ExplodingClient:
    def __init__(self, create) -> None:
        self.chat = type(
            "Chat",
            (),
            {"completions": type("C", (), {"create": staticmethod(create)})()},
        )()

    async def close(self) -> None:
        return None


def test_agent_allows_the_web_origin_preflight(client):
    """The browser calls this route cross-origin, so preflight has to pass.

    Asserted against the configured default rather than a monkeypatched value:
    CORSMiddleware reads its origin list once, at app construction.
    """
    response = client.options(
        "/api/agent",
        headers={
            "Origin": "http://localhost:4001",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:4001"


def test_agent_requires_a_gateway_url(client, monkeypatch):
    monkeypatch.setattr(settings, "LLM_BASE_URL", "")

    response = client.post("/api/agent", json=_run_input())

    # A missing gateway is a deployment error, so it fails before the stream
    # opens rather than sending an empty event stream.
    assert response.status_code == 500
    assert "LLM_BASE_URL" in response.json()["detail"]


def test_agent_runs_without_an_api_key(client, stub_llm, monkeypatch):
    """A local LiteLLM with no master key is a valid deployment."""
    # After stub_llm, which sets a key of its own.
    monkeypatch.setattr(settings, "LLM_API_KEY", None)

    response = client.post("/api/agent", json=_run_input())

    assert response.status_code == 200
