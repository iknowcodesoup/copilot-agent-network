# copilot_agent_network

Nx monorepo containing:

- A Next.js app at `apps/agentic-executor`
- A Python FastAPI service at `apps/pythonapi`

## Docker Through Nx

Use these from the repo root:

```powershell
nx up apps
```

Other useful commands:

```powershell
nx watch apps
nx down apps
nx build apps
nx config apps
```

What they do:

- `nx up apps`: build and start both containers
- `nx watch apps`: start the dev watch stack with live sync and auto-rebuilds
- `nx down apps`: stop the compose stack
- `nx build apps`: build the Docker images only
- `nx config apps`: print the resolved compose config

Endpoints:

- Next.js app: `http://localhost:3000`
- Python API health: `http://localhost:8000/health`
- Python API hello: `http://localhost:8000/hello`

## Watch Behavior

`nx watch apps` does the following:

- Changes under `apps/agentic-executor/src` and `public` sync into the container and Next dev reloads automatically.
- Changes under `apps/pythonapi/pythonapi` sync into the container and `uvicorn --reload` restarts automatically.
- Dependency or config changes rebuild the affected image.

Examples:

- Editing `apps/agentic-executor/src/...` updates the web app without a full image rebuild.
- Editing `apps/pythonapi/pythonapi/...` restarts only the Python API process.
- Editing `package-lock.json`, `package.json`, or `apps/pythonapi/uv.lock` triggers a container rebuild.

## Run with Nx locally

```powershell
nx dev @agentic-executor/agentic-executor
nx serve pythonapi
```
