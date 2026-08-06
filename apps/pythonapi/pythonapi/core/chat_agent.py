"""Chat agent that speaks the Agent User Interaction (AG-UI) protocol.

The CopilotKit v2 frontend consumes AG-UI events directly, so this module is
the whole backend contract: one async generator that turns a RunAgentInput
into a stream of AG-UI events. There is no CopilotKit runtime and no proxy in
between - see routes/agent.py for the SSE transport.

Tools are deliberately not forwarded to the model. RunAgentInput carries any
frontend-registered tools, but answering a tool call means emitting
ToolCall*Events and resuming the run, which this agent does not yet do;
forwarding the definitions without handling the response would strand the run.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
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
)
from openai import AsyncOpenAI

from pythonapi.config import settings

# Roles the LiteLLM gateway accepts verbatim. AG-UI also defines "activity"
# and "reasoning" messages, which are presentation-only transcript entries
# and carry no input for the next completion.
_FORWARDED_ROLES = {"developer", "system", "user", "assistant", "tool"}


async def run_chat_agent(agent_input: RunAgentInput) -> AsyncIterator[BaseEvent]:
    """Stream one agent run as AG-UI events.

    Failures are emitted as RunErrorEvent rather than raised: the SSE response
    headers are already on the wire by the time this generator runs, so an
    exception here would truncate the stream instead of telling the client
    what went wrong.
    """
    yield RunStartedEvent(thread_id=agent_input.thread_id, run_id=agent_input.run_id)

    message_id = str(uuid4())
    client = AsyncOpenAI(
        base_url=settings.LLM_BASE_URL,
        api_key=settings.LLM_API_KEY,
    )

    try:
        completion = await client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=_to_openai_messages(agent_input.messages),
            stream=True,
        )

        yield TextMessageStartEvent(message_id=message_id)

        async for chunk in completion:
            delta = chunk.choices[0].delta if chunk.choices else None
            content = delta.content if delta is not None else None
            if content:
                yield TextMessageContentEvent(message_id=message_id, delta=content)

        yield TextMessageEndEvent(message_id=message_id)
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as an event
        yield RunErrorEvent(message=str(exc), code=type(exc).__name__)
        return
    finally:
        await client.close()

    yield RunFinishedEvent(thread_id=agent_input.thread_id, run_id=agent_input.run_id)


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
