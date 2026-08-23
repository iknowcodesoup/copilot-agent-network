"""Chat agent that speaks the Agent User Interaction (AG-UI) protocol.

The CopilotKit v2 frontend consumes AG-UI events directly, so this module is
the whole backend contract: one async generator that turns a RunAgentInput
into a stream of AG-UI events. There is no CopilotKit runtime and no proxy in
between - see routes/agent.py for the SSE transport.

Tools come from two places and the difference decides who runs them. A tool on
the VoiceToolRegistry runs here, in this loop, and its result goes straight
back to the model. A tool in RunAgentInput.tools belongs to the browser, so the
agent emits the call and ends the run; CopilotKit executes it, appends the
result, and posts a new run. AG-UI carries no state between runs, which is what
makes that hand-off the only way a frontend tool can answer.
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
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from openai import AsyncOpenAI

from pythonapi.config import settings
from pythonapi.core.voice_agent_tools import VoiceToolRegistry

# Roles the LiteLLM gateway accepts verbatim. AG-UI also defines "activity"
# and "reasoning" messages, which are presentation-only transcript entries
# and carry no input for the next completion.
_FORWARDED_ROLES = {"developer", "system", "user", "assistant", "tool"}

# Said to the user when a run hits AGENT_MAX_TOOL_STEPS. The run ends normally
# rather than as an error: the work already done is real, and the transcript
# has to say why the agent stopped instead of just going quiet.
TOOL_STEP_LIMIT_MESSAGE = (
    "I stopped after using tools several times without reaching an answer. "
    "Ask me again with a narrower question."
)


async def run_chat_agent(
    agent_input: RunAgentInput,
    tool_registry: VoiceToolRegistry | None = None,
) -> AsyncIterator[BaseEvent]:
    """Stream one agent run as AG-UI events.

    Failures are emitted as RunErrorEvent rather than raised: the SSE response
    headers are already on the wire by the time this generator runs, so an
    exception here would truncate the stream instead of telling the client
    what went wrong.
    """
    yield RunStartedEvent(thread_id=agent_input.thread_id, run_id=agent_input.run_id)

    client = AsyncOpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.gateway_api_key,
    )
    messages = _to_openai_messages(agent_input.messages)
    tool_schemas = _tool_schemas(agent_input, tool_registry)

    try:
        for _ in range(settings.AGENT_MAX_TOOL_STEPS):
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

            text = ""
            text_started = False
            # keyed by the index the gateway uses to interleave call deltas
            pending_calls: dict[int, dict[str, str]] = {}

            async for chunk in completion:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta is None:
                    continue

                content = delta.content
                if content:
                    # Started on first content, not before: a step that goes
                    # straight to a tool call would otherwise open an empty
                    # message the client has to render.
                    if not text_started:
                        yield TextMessageStartEvent(message_id=message_id)
                        text_started = True
                    text += content
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

            # A call the gateway never named cannot be run or rendered, so it
            # is dropped rather than passed on half-formed.
            calls = [
                pending_calls[index]
                for index in sorted(pending_calls)
                if pending_calls[index]["name"]
            ]
            if not calls:
                break

            for call in calls:
                yield ToolCallEndEvent(tool_call_id=call["id"])

            messages.append(
                {
                    "role": "assistant",
                    "content": text,
                    "tool_calls": [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": call["arguments"],
                            },
                        }
                        for call in calls
                    ],
                }
            )

            # One frontend tool ends the run for all of them. The browser owns
            # the answer, and this run has no way to wait for it.
            if any(not _runs_here(call["name"], tool_registry) for call in calls):
                break

            for call in calls:
                result = await tool_registry.run(call["name"], call["arguments"])
                yield ToolCallResultEvent(
                    message_id=str(uuid4()),
                    tool_call_id=call["id"],
                    content=result,
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "content": result,
                    }
                )
        else:
            limit_message_id = str(uuid4())
            yield TextMessageStartEvent(message_id=limit_message_id)
            yield TextMessageContentEvent(
                message_id=limit_message_id, delta=TOOL_STEP_LIMIT_MESSAGE
            )
            yield TextMessageEndEvent(message_id=limit_message_id)
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as an event
        yield RunErrorEvent(message=str(exc), code=type(exc).__name__)
        return
    finally:
        await client.close()

    yield RunFinishedEvent(thread_id=agent_input.thread_id, run_id=agent_input.run_id)


def _runs_here(tool_name: str, tool_registry: VoiceToolRegistry | None) -> bool:
    """True when this service owns the tool, false when the browser does."""
    return tool_registry is not None and tool_registry.handles(tool_name)


def _tool_schemas(
    agent_input: RunAgentInput,
    tool_registry: VoiceToolRegistry | None,
) -> list[dict[str, Any]]:
    """Every tool this run may call, backend first.

    A frontend tool that reuses a backend name is dropped. Offering both would
    give the model one name with two meanings, and _runs_here would then send
    the call to the wrong side.
    """
    schemas: list[dict[str, Any]] = (
        list(tool_registry.schemas) if tool_registry is not None else []
    )

    for tool in agent_input.tools or []:
        if _runs_here(tool.name, tool_registry):
            continue
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
