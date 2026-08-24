"""Mount and run the RAG MCP server for one lifespan cycle.

Unlike the A2A specialists, which are mounted once at import time and reused
across every `lifespan()` cycle, the RAG MCP server is built fresh inside
`lifespan()` itself. The MCP SDK's `StreamableHTTPSessionManager.run()` may
be entered only once per instance, and pythonapi's test suite re-enters
`lifespan()` once per test against the same long-lived `app` object (see
`tests/conftest.py`'s `client` fixture). Rebuilding the server - and its
mount - on every cycle, then removing the mount on exit, is what keeps
`.run()` from ever being called twice on one instance. Every other optional
subsystem in `main.py` (Redis, the worker pool, the reconcilers) already
follows this same rebuild-per-cycle shape.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from mcp.server import MCPServer
from starlette.routing import Mount

from pythonapi.config import settings
from pythonapi.mcp_support.rag_server import build_rag_mcp_server


@asynccontextmanager
async def rag_mcp_server_resource(parent_app: FastAPI) -> AsyncIterator[MCPServer]:
    """Build, mount, and run the RAG MCP server for the app's lifetime."""
    mcp = build_rag_mcp_server(dependencies_provider=lambda: parent_app.state)
    # streamable_http_path="/" so the mount prefix itself is the endpoint,
    # matching the specialists' <mount>/.well-known/agent-card.json shape
    # rather than nesting a second /mcp segment under it.
    mount = Mount(
        settings.RAG_MCP_MOUNT_PATH,
        app=mcp.streamable_http_app(streamable_http_path="/"),
    )
    parent_app.router.routes.append(mount)
    try:
        async with mcp.session_manager.run():
            yield mcp
    finally:
        parent_app.router.routes.remove(mount)
