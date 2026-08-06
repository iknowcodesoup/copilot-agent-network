# pythonapi

FastAPI service for the monorepo.

It mounts all custom endpoints under `/api`, including the chat agent at
`/api/agent` and the FastAPI schema at `/api/openapi.json`.

## Agent endpoint

`POST /api/agent` speaks the [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui):
it takes a `RunAgentInput` and streams the run back as server-sent AG-UI
events. The CopilotKit v2 frontend consumes that format natively, so it
connects here directly through an AG-UI `HttpAgent` - there is no CopilotKit
runtime and no Next.js proxy in between.

The v1 `copilotkit` Python SDK is deliberately not a dependency. It implements
the v1 remote-endpoint protocol, which v2 clients cannot talk to; bridging the
two needs a translation layer that this service no longer carries.

Because the browser calls this route cross-origin, `CORS_ALLOW_ORIGINS` must
list the web app's origin (comma-separated, default `http://localhost:4001`).

All LLM traffic should route through a shared LiteLLM gateway. In docker
compose, pythonapi, BAML, and the public `/api/v1/*` OpenAI-compatible proxy
all target LiteLLM first, and LiteLLM then routes to the configured backend
provider such as LM Studio.

It also initializes a Langfuse client when `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`,
and `LANGFUSE_SECRET_KEY` are present in the environment.

To point the Next.js frontend at this service, set `NEXT_PUBLIC_PYTHON_API_URL`
to the Python service's browser-reachable base URL, for example
`http://localhost:8000`. Next inlines `NEXT_PUBLIC_*` at build time, so rebuild
the web image after changing it rather than just restarting the container.
