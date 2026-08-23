"""Turn an AgentExecutor into a mountable A2A service.

Each specialist is built as a self-contained FastAPI app carrying its own
Agent Card and JSON-RPC routes. That one shape covers both topologies the
spec allows: run it standalone on its own port and the card sits exactly at
the well-known path, or mount it under a prefix inside pythonapi and the same
routes move with it. Nothing about the agent changes between the two - only
where it is served from - so the deployment decision stays reversible.

REST and gRPC bindings are deliberately not built. The card advertises
JSON-RPC only, and an unadvertised transport is a surface no client will use.
"""

from __future__ import annotations

from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.fastapi_routes import add_a2a_routes_to_fastapi
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCard
from a2a.utils.constants import DEFAULT_RPC_URL
from fastapi import FastAPI


def build_a2a_service(*, agent_card: AgentCard, executor: AgentExecutor) -> FastAPI:
    """Build the ASGI app that serves one specialist over A2A.

    The task store is in-memory on purpose. An A2A task here is one
    request/response exchange, and the durable state that must survive a
    restart already lives where it belongs - `voice_runs.phase` for voice
    work, Postgres and Qdrant for documents. Persisting a second copy of a
    task's lifecycle would duplicate the run state model the spec protects.
    """
    request_handler = DefaultRequestHandler(
        agent_executor=executor,
        task_store=InMemoryTaskStore(),
        agent_card=agent_card,
    )

    app = FastAPI(title=agent_card.name, description=agent_card.description)
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(agent_card=agent_card),
        jsonrpc_routes=create_jsonrpc_routes(
            request_handler=request_handler,
            rpc_url=DEFAULT_RPC_URL,
        ),
    )
    return app
