"""AG-UI agent endpoint, consumed directly by the CopilotKit v2 frontend.

The browser connects here through an AG-UI HttpAgent, so this route is the
only contract between the two apps: POST a RunAgentInput, receive the run
back as an SSE stream of AG-UI events.
"""

from ag_ui.core import RunAgentInput
from ag_ui.encoder import EventEncoder
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from pythonapi.config import settings
from pythonapi.core.chat_agent import run_chat_agent
from pythonapi.core.voice_agent_tools import VoiceToolRegistry
from pythonapi.dependencies import get_voice_tool_registry

router = APIRouter(tags=["Agent"])


@router.post("/agent")
async def post_agent(
    agent_input: RunAgentInput,
    request: Request,
    tool_registry: VoiceToolRegistry | None = Depends(get_voice_tool_registry),
) -> StreamingResponse:
    """Run the chat agent and stream its AG-UI events."""
    # A missing key is a deployment error, not a run error: fail before the
    # stream opens so the client sees a 500 instead of an empty event stream.
    if not settings.LLM_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LLM_API_KEY is not configured",
        )

    encoder = EventEncoder(accept=request.headers.get("accept"))

    async def event_stream():
        async for event in run_chat_agent(agent_input, tool_registry):
            yield encoder.encode(event)

    return StreamingResponse(
        event_stream(),
        media_type=encoder.get_content_type(),
        headers={
            "Cache-Control": "no-cache",
            # Tells nginx-style reverse proxies not to buffer the stream,
            # which would otherwise hold tokens back until the run ends.
            "X-Accel-Buffering": "no",
        },
    )
