"""Tool-calling tests for the AG-UI chat agent.

Every tool the agent offers belongs to the browser. Voice work reaches the
Voice Agent over A2A, so the agent runs no tools of its own and there is no
second model step to test. What is left is the hand-off: the agent has to emit
the AG-UI tool events in the order the CopilotKit client's state machine
expects, then end the run so the browser can answer.

One test here guards the boundary itself. A voice request must never reach the
model, because the Voice Agent owns that work now.
"""

import json

import pytest

from pythonapi.agents.orchestrator import chat_agent
from pythonapi.config import settings

FRONTEND_TOOL_NAME = "confirm_action"

# No voice word and no research word, so `classify` returns GENERAL and the
# model answers. Any voice term here would be delegated instead.
GENERAL_PROMPT = "Say hello to me please."


# --------------------------------------------------------------------------
# Stand-ins for the model gateway. No test here reaches LiteLLM.
# --------------------------------------------------------------------------


class _FakeFunction:
    def __init__(self, name: str | None, arguments: str | None) -> None:
        self.name = name
        self.arguments = arguments


class _FakeToolCallDelta:
    def __init__(
        self,
        index: int,
        tool_call_id: str | None = None,
        name: str | None = None,
        arguments: str | None = None,
    ) -> None:
        self.index = index
        self.id = tool_call_id
        self.function = _FakeFunction(name, arguments)


class _FakeDelta:
    def __init__(self, content=None, tool_calls=None) -> None:
        self.content = content
        self.tool_calls = tool_calls


class _FakeChunk:
    def __init__(self, content=None, tool_calls=None) -> None:
        self.choices = [
            type("Choice", (), {"delta": _FakeDelta(content, tool_calls)})()
        ]


class _FakeCompletions:
    """Replays one prepared response per create() call, in order."""

    def __init__(self, responses: list[list[_FakeChunk]], requests: list[dict]) -> None:
        self._responses = list(responses)
        self._requests = requests

    async def create(self, **kwargs):
        self._requests.append(kwargs)
        chunks = self._responses.pop(0) if self._responses else []

        async def stream():
            for chunk in chunks:
                yield chunk

        return stream()


class _FakeOpenAI:
    def __init__(self, responses: list[list[_FakeChunk]], requests: list[dict]) -> None:
        self.chat = type(
            "Chat", (), {"completions": _FakeCompletions(responses, requests)}
        )()

    async def close(self) -> None:
        return None


def _tool_call_response(name: str, arguments: str, tool_call_id: str = "call-1"):
    """One streamed step that asks for a tool, split across deltas like a
    real gateway sends it: the name once, then the arguments in pieces."""
    midpoint = len(arguments) // 2
    return [
        _FakeChunk(
            tool_calls=[_FakeToolCallDelta(0, tool_call_id, name, arguments[:midpoint])]
        ),
        _FakeChunk(tool_calls=[_FakeToolCallDelta(0, arguments=arguments[midpoint:])]),
    ]


def _text_response(text: str):
    return [_FakeChunk(content=text)]


def _frontend_tool(name: str = FRONTEND_TOOL_NAME) -> dict:
    return {
        "name": name,
        "description": "Ask the person to confirm.",
        "parameters": {"type": "object", "properties": {}},
    }


def _run_input(content: str = GENERAL_PROMPT, tools=None) -> dict:
    return {
        "threadId": "thread-1",
        "runId": "run-1",
        "state": {},
        "messages": [{"id": "m1", "role": "user", "content": content}],
        "tools": tools or [],
        "context": [],
        "forwardedProps": {},
    }


def _parse_sse(body: str) -> list[dict]:
    return [
        json.loads(line[len("data: ") :])
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


@pytest.fixture
def stub_llm(monkeypatch):
    """Install a scripted model in place of the gateway."""
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    requests: list[dict] = []

    def install(responses: list[list[_FakeChunk]]):
        client = _FakeOpenAI(responses, requests)
        monkeypatch.setattr(chat_agent, "AsyncOpenAI", lambda **_: client)
        return requests

    return install


# --------------------------------------------------------------------------
# The boundary: voice work never reaches the model
# --------------------------------------------------------------------------


def test_a_voice_request_never_reaches_the_model(client, stub_llm):
    """The Voice Agent owns voice work, so the model is not asked about it.

    This is the collision the A2A move resolves. Before it, a voice request
    could be answered by a model tool call instead of by the Voice Agent, and
    the two could drift apart.
    """
    requests = stub_llm([_text_response("I should never be asked.")])

    response = client.post("/api/agent", json=_run_input("List the voice runs."))

    assert response.status_code == 200
    assert requests == []


# --------------------------------------------------------------------------
# Frontend tool hand-off
# --------------------------------------------------------------------------


def test_agent_offers_frontend_tools_to_the_model(client, stub_llm):
    requests = stub_llm([_text_response("Hello")])

    client.post("/api/agent", json=_run_input(tools=[_frontend_tool()]))

    offered = {tool["function"]["name"] for tool in requests[0]["tools"]}
    assert offered == {FRONTEND_TOOL_NAME}


def test_agent_omits_the_tools_key_when_none_are_offered(client, stub_llm):
    """An empty tools list is not the same as no tools: some gateways reject
    it outright, so the key has to be absent rather than empty."""
    requests = stub_llm([_text_response("Hello")])

    client.post("/api/agent", json=_run_input())

    assert "tools" not in requests[0]


def test_agent_hands_a_frontend_tool_back_to_the_browser(client, stub_llm):
    stub_llm([_tool_call_response(FRONTEND_TOOL_NAME, json.dumps({"run_id": "r1"}))])

    response = client.post("/api/agent", json=_run_input(tools=[_frontend_tool()]))
    events = _parse_sse(response.text)

    # No TOOL_CALL_RESULT: the browser produces it and posts a new run.
    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "RUN_FINISHED",
    ]

    # The args deltas have to rejoin into exactly what the model sent, because
    # the client renders the call from them.
    arguments = "".join(
        event["delta"] for event in events if event["type"] == "TOOL_CALL_ARGS"
    )
    assert json.loads(arguments) == {"run_id": "r1"}


def test_agent_drops_a_tool_call_the_gateway_never_named(client, stub_llm):
    """A call with no name cannot be rendered, so it is dropped rather than
    passed on half-formed."""
    stub_llm([[_FakeChunk(tool_calls=[_FakeToolCallDelta(0, "call-1", None, "{}")])]])

    response = client.post("/api/agent", json=_run_input(tools=[_frontend_tool()]))
    types = [event["type"] for event in _parse_sse(response.text)]

    # A call that was never named is never started and never completed, so the
    # client has nothing half-rendered to reconcile.
    assert "TOOL_CALL_START" not in types
    assert "TOOL_CALL_END" not in types
    assert types[0] == "RUN_STARTED"
    assert types[-1] == "RUN_FINISHED"


def test_agent_streams_plain_text_when_the_model_calls_no_tool(client, stub_llm):
    stub_llm([_text_response("Hello there.")])

    response = client.post("/api/agent", json=_run_input())
    events = _parse_sse(response.text)

    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]
    assert events[2]["delta"] == "Hello there."
