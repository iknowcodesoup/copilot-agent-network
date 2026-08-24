"""Chat agent that speaks the Agent User Interaction (AG-UI) protocol.

The CopilotKit v2 frontend consumes AG-UI events directly, so this module is
the whole backend contract: one async generator that turns a RunAgentInput
into a stream of AG-UI events. There is no CopilotKit runtime and no proxy in
between - see routes/agent.py for the SSE transport.

Every tool here belongs to the browser. Voice work goes to the Voice Agent
over A2A, so this module runs no tools of its own: it emits the call and ends
the run, then CopilotKit executes it, appends the result, and posts a new run.
AG-UI carries no state between runs, which is what makes that hand-off the
only way a frontend tool can answer.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

from ag_ui.core import (
    BaseEvent,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from openai import AsyncOpenAI

from pythonapi.a2a_support.discovery import SpecialistDirectory
from pythonapi.agents.orchestrator.specialist_router import route_request
from pythonapi.config import settings

# Roles the LiteLLM gateway accepts verbatim. AG-UI also defines "activity"
# and "reasoning" messages, which are presentation-only transcript entries
# and carry no input for the next completion.
_FORWARDED_ROLES = {"developer", "system", "user", "assistant", "tool"}


async def run_chat_agent(
    agent_input: RunAgentInput,
    specialist_directory: SpecialistDirectory | None = None,
) -> AsyncIterator[BaseEvent]:
    """Stream one agent run as AG-UI events.

    Failures are emitted as RunErrorEvent rather than raised: the SSE response
    headers are already on the wire by the time this generator runs, so an
    exception here would truncate the stream instead of telling the client
    what went wrong.
    """
    yield RunStartedEvent(thread_id=agent_input.thread_id, run_id=agent_input.run_id)

    # Delegation comes first. A request the specialists own is answered from
    # their results and the model is never asked. Only a general request
    # reaches the model below.
    if specialist_directory is not None:
        delegated = await _delegate(agent_input, specialist_directory)
        if delegated is not None:
            message_id = str(uuid4())
            yield TextMessageStartEvent(message_id=message_id)
            yield TextMessageContentEvent(message_id=message_id, delta=delegated)
            yield TextMessageEndEvent(message_id=message_id)
            yield RunFinishedEvent(
                thread_id=agent_input.thread_id, run_id=agent_input.run_id
            )
            return

    client = AsyncOpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.gateway_api_key,
    )
    messages = _to_openai_messages(agent_input.messages)
    tool_schemas = _tool_schemas(agent_input)

    try:
        message_id = str(uuid4())
        request: dict[str, Any] = {
            "model": settings.LLM_MODEL,
            "messages": messages,
            "stream": True,
        }
        # An empty tools list is not the same as no tools: some gateways
        # reject it outright.
        if tool_schemas:
            request["tools"] = tool_schemas

        completion = await client.chat.completions.create(**request)

        text_started = False
        # keyed by the index the gateway uses to interleave call deltas
        pending_calls: dict[int, dict[str, str]] = {}

        async for chunk in completion:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta is None:
                continue

            content = delta.content
            if content:
                # Started on first content, not before: a run that goes
                # straight to a tool call would otherwise open an empty
                # message the client has to render.
                if not text_started:
                    yield TextMessageStartEvent(message_id=message_id)
                    text_started = True
                yield TextMessageContentEvent(message_id=message_id, delta=content)

            for call_delta in getattr(delta, "tool_calls", None) or []:
                call = pending_calls.setdefault(
                    call_delta.index,
                    {
                        "id": call_delta.id or str(uuid4()),
                        "name": "",
                        "arguments": "",
                    },
                )
                function = getattr(call_delta, "function", None)

                name = getattr(function, "name", None)
                if name and not call["name"]:
                    call["name"] = name
                    yield ToolCallStartEvent(
                        tool_call_id=call["id"],
                        tool_call_name=name,
                        parent_message_id=message_id,
                    )

                argument_delta = getattr(function, "arguments", None)
                if argument_delta:
                    call["arguments"] += argument_delta
                    yield ToolCallArgsEvent(
                        tool_call_id=call["id"], delta=argument_delta
                    )

        if text_started:
            yield TextMessageEndEvent(message_id=message_id)

        # A call the gateway never named cannot be rendered, so it is dropped
        # rather than passed on half-formed. The browser owns every tool that
        # survives, so the run ends here and CopilotKit posts the next one.
        for index in sorted(pending_calls):
            if pending_calls[index]["name"]:
                yield ToolCallEndEvent(tool_call_id=pending_calls[index]["id"])
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as an event
        yield RunErrorEvent(message=str(exc), code=type(exc).__name__)
        return
    finally:
        await client.close()

    yield RunFinishedEvent(thread_id=agent_input.thread_id, run_id=agent_input.run_id)


def _tool_schemas(agent_input: RunAgentInput) -> list[dict[str, Any]]:
    """Every tool this run may call.

    All of them belong to the browser. Voice work reaches the Voice Agent over
    A2A instead of through a tool, so this service runs none of them itself.
    """
    schemas: list[dict[str, Any]] = []

    for tool in agent_input.tools or []:
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                    or {"type": "object", "properties": {}},
                },
            }
        )

    return schemas


def _to_openai_messages(messages: list) -> list[dict]:
    """Map AG-UI messages onto the OpenAI chat-completions message shape."""
    openai_messages: list[dict] = []

    for message in messages:
        if message.role not in _FORWARDED_ROLES:
            continue

        openai_message: dict = {
            "role": message.role,
            "content": _content_text(message.content),
        }

        # A tool result is only interpretable next to the call it answers.
        if message.role == "tool":
            openai_message["tool_call_id"] = message.tool_call_id

        tool_calls = getattr(message, "tool_calls", None)
        if tool_calls:
            openai_message["tool_calls"] = [
                {
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": tool_call.function.name,
                        "arguments": tool_call.function.arguments,
                    },
                }
                for tool_call in tool_calls
            ]

        openai_messages.append(openai_message)

    return openai_messages


def _content_text(content: object) -> str:
    """Flatten AG-UI message content to plain text.

    User messages may be multimodal (a list of typed parts). Only the text
    parts survive: this agent has no vision/audio path, and passing an image
    part through as its repr would put base64 noise into the prompt.
    """
    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        return "".join(
            part.text for part in content if getattr(part, "type", None) == "text"
        )

    return str(content)


async def _delegate(
    agent_input: RunAgentInput, specialist_directory: SpecialistDirectory
) -> str | None:
    """Ask the specialists about the newest user message.

    Returns None only when the request is general, which is the one case the
    model answers. A specialist that fails reports that failure to the user:
    `delegate` already turns every error into a result, so there is nothing
    here to catch and nothing to fall back to.
    """
    latest = _latest_user_text(agent_input)
    if not latest:
        return None
    return await route_request(specialist_directory, latest)


def _latest_user_text(agent_input: RunAgentInput) -> str:
    for message in reversed(agent_input.messages):
        if getattr(message, "role", None) == "user":
            return _content_text(getattr(message, "content", ""))
    return ""
