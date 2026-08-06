# pythonapi

FastAPI service for the monorepo.

It now mounts a CopilotKit endpoint at `/copilotkit` via the Python SDK.

It also initializes a Langfuse client when `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`,
and `LANGFUSE_SECRET_KEY` are present in the environment.

To point the Next.js frontend at this service, set `NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL`
to the Python service URL, for example `http://localhost:8000/copilotkit`.
