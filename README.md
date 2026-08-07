# copilot_agent_network

> ## ⚠️ Work in progress
>
> This project is not finished. Treat every part of it as unstable.
> Interfaces, routes, and configuration keys can change without notice.
>
> The CopilotKit and AG-UI stage is the largest open item. The front end and
> the agent endpoint talk to each other, but the full chat experience is not
> complete. This stage will take a long time to finish. Until it is done,
> expect gaps in the chat UI, in tool calls, and in streamed agent state.

An Nx monorepo. A Next.js chat front end talks to a Python FastAPI agent
service over the AG-UI protocol. The service runs a RAG pipeline over Qdrant
and Postgres. Every model call goes through LiteLLM.

---

## Architecture

The browser calls FastAPI directly. There is no CopilotKit runtime and no
Next.js proxy route between them.

```mermaid
flowchart LR
    subgraph Browser
        UI[CopilotChat v2]
        AGENT[HttpAgent]
    end
    subgraph FastAPI["pythonapi (:8000)"]
        ROUTE["/api/agent"]
        CHAT[run_chat_agent]
        RAG[RagPipeline]
    end
    subgraph Data
        QD[(Qdrant)]
        PG[(Postgres)]
        RD[(Redis)]
    end
    LLM[LiteLLM :4000]
    LMS[LM Studio]
    LF[Langfuse :4002]

    UI --> AGENT
    AGENT -->|AG-UI over SSE| ROUTE
    ROUTE --> CHAT
    CHAT --> RAG
    RAG --> QD
    RAG --> PG
    CHAT --> LLM
    LLM --> LMS
    LLM --> LF
    ROUTE -.idempotency.-> RD
```

Key contracts:

- `apps/pythonapi/pythonapi/routes/agent.py` is the only contract between the
  two apps. It accepts a `RunAgentInput`. It returns AG-UI events over SSE.
- The front end uses `@copilotkit/react-core/v2`. The v1 remote-endpoint
  protocol is not used. The Python `copilotkit` SDK is deliberately absent.
- Every model call goes through LiteLLM at `LLM_BASE_URL`. Never call a model
  provider directly.
- Qdrant holds chunk vectors only. Postgres holds all document, chunk, and
  order metadata.

---

## Tech stack

| Layer         | Technology                                                       |
| ------------- | ---------------------------------------------------------------- |
| Monorepo      | Nx 23, pnpm 11 (JS/TS), uv (Python), `@nxlv/python` plugin       |
| Front end     | Next.js 16, React 19, CopilotKit v2 (`react-core/v2`), AG-UI     |
| API           | FastAPI, Pydantic Settings, uvicorn, Python 3.10–3.14            |
| Agents        | AG-UI protocol, LangChain, LangGraph, BAML                       |
| Model gateway | LiteLLM → LM Studio (OpenAI-compatible)                          |
| Vectors       | Qdrant (dense + sparse BM25 through fastembed)                   |
| Relational    | Postgres 16, SQLAlchemy 2.0 async, asyncpg                       |
| Cache         | Redis 7 (idempotency, rate limits)                               |
| Tracing       | Langfuse v2                                                      |
| Documents     | Docling (parsing and hybrid chunking)                            |
| Reranking     | sentence-transformers cross-encoder                              |
| PII           | Presidio analyzer and anonymizer, encrypted vault                |
| Tests         | pytest + pytest-asyncio (Python), Jest (React), Playwright (e2e) |
| Lint / format | Ruff (Python), ESLint + Prettier (TypeScript)                    |

---

## Get started

You need Docker, Node with pnpm 11, and uv. LM Studio is optional. It serves
the models that LiteLLM points to.

```powershell
# 1. Install JavaScript dependencies
pnpm install

# 2. Create your environment file
Copy-Item .env.example .env

# 3. Set the required secrets in .env (see Configuration below)

# 4. Build and start the whole stack
nx up apps
```

---

## Commands

Run all commands from the repo root. Use PowerShell.

### Docker stack

```powershell
nx up apps       # build and start every container
nx watch apps    # dev stack with live sync and auto-rebuild
nx down apps     # stop the compose stack
nx build apps    # build the Docker images only
nx config apps   # print the resolved compose config
```

### Python API

```powershell
nx serve pythonapi          # uvicorn on :8000
nx test pythonapi           # pytest with coverage
nx lint pythonapi           # ruff check
nx format pythonapi         # ruff format
nx baml-generate pythonapi  # regenerate pythonapi/baml_client from baml_src
nx sync pythonapi           # sync the uv environment
nx lock pythonapi           # refresh uv.lock
```

### Front end

```powershell
nx dev @agentic-executor/agentic-executor
nx build @agentic-executor/agentic-executor
nx test @agentic-executor/agentic-executor
nx e2e @agentic-executor/agentic-executor-e2e
```

### Whole workspace

```powershell
nx run-many -t lint test
nx affected -t lint test
```

### Dependencies

```powershell
pnpm add -w <package>              # JavaScript or TypeScript, at the root
nx add pythonapi --name <package>  # Python, updates uv.lock
```

---

## Ports and endpoints

| Service    | URL                      |
| ---------- | ------------------------ |
| Web app    | `http://localhost:4001`  |
| Python API | `http://localhost:8000`  |
| LiteLLM    | `http://localhost:4000`  |
| Langfuse   | `http://localhost:4002`  |
| Qdrant     | `http://localhost:6333`  |
| Redis      | `localhost:6379`         |

The API mounts every router under `/api`. OpenAPI docs are at
`http://localhost:8000/docs`.

| Method | Path                        | Purpose                        |
| ------ | --------------------------- | ------------------------------ |
| GET    | `/api/health`               | Health and integration status  |
| POST   | `/api/agent`                | AG-UI event stream over SSE    |
| POST   | `/api/documents`            | Upload and parse a document    |
| GET    | `/api/documents`            | List documents                 |
| GET    | `/api/documents/{id}`       | Get one document               |
| DELETE | `/api/documents/{id}`       | Delete a document              |
| POST   | `/api/search`               | Hybrid search over chunks      |
| POST   | `/api/orders`               | Create an order                |
| GET    | `/api/v1/models`            | OpenAI-compatible model list   |
| POST   | `/api/v1/chat/completions`  | OpenAI-compatible chat         |
| POST   | `/api/v1/responses`         | OpenAI-compatible responses    |
| POST   | `/api/v1/embeddings`        | OpenAI-compatible embeddings   |

---

## Watch behavior

`nx watch apps` does the following:

- Changes under `apps/agentic-executor/src` and `public` sync into the
  container. Next dev reloads automatically.
- Changes under `apps/pythonapi/pythonapi` sync into the container.
  `uvicorn --reload` restarts automatically.
- Dependency or config changes rebuild the affected image.

Examples:

- Edit `apps/agentic-executor/src/...` to update the web app without a full
  image rebuild.
- Edit `apps/pythonapi/pythonapi/...` to restart only the Python API process.
- Edit `package.json`, `pnpm-lock.yaml`, or `apps/pythonapi/uv.lock` to
  trigger a container rebuild.

---

## Configuration

Copy `.env.example` to `.env` before you start the stack. Compose reads that
file. The Python service reads the same values through the `Settings` class in
`apps/pythonapi/pythonapi/config.py`.

These keys have no default. Compose fails to start without them:

- `LITELLM_MASTER_KEY`
- `LITELLM_UPSTREAM_API_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `NEXTAUTH_SECRET`
- `SALT`
- `ENCRYPTION_KEY`
- `LANGFUSE_INIT_USER_PASSWORD`

Other useful keys:

| Key                               | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `LITELLM_UPSTREAM_API_BASE`       | Model backend. Defaults to LM Studio on port 1234. |
| `LITELLM_CHAT_BACKEND_MODEL`      | Chat model behind the `chat-default` alias.        |
| `LITELLM_EMBEDDING_BACKEND_MODEL` | Embedding model behind `embedding-default`.        |
| `NEXT_PUBLIC_PYTHON_API_URL`      | API base URL the browser calls.                    |
| `CORS_ALLOW_ORIGINS`              | Comma-separated allowed origins.                   |
| `PII_VAULT_ENCRYPTION_KEY`        | Key for the encrypted PII vault.                   |
| `HF_TOKEN`                        | Hugging Face token for model downloads.            |

Optional integrations degrade, they do not crash. Redis, Langfuse, and
Postgres can all stay unset. Qdrant always works through embedded `:memory:`.

### Providers

Three providers start in `mock` mode. Change them when you want real models:

- `EMBEDDING_PROVIDER`: `mock` or `openai_compatible`
- `RERANK_PROVIDER`: `mock` or `cross_encoder`
- `GENERATION_PROVIDER`: `mock` or `baml`

### Langfuse

The compose stack runs a self-hosted Langfuse v2 service with its own
Postgres. The Python container uses the internal URL `http://langfuse:3000`.
The UI is exposed at `http://localhost:4002`.

The stack creates these on first start:

- organization id `local-org`
- project id `pythonapi`
- API keys that match `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`

The health route reports Langfuse details only when the client is configured.

---

## Layout

```text
apps/
├── agentic-executor/            # Next.js 16 front end (port 4001)
│   ├── specs/                   # Jest component tests
│   └── src/app/
│       ├── layout.tsx           # Wraps the tree in CopilotProvider
│       ├── page.tsx
│       └── features/chat/       # copilot_provider.tsx, chat_window.tsx
├── agentic-executor-e2e/        # Playwright end-to-end tests
└── pythonapi/                   # FastAPI service (port 8000)
    ├── baml_src/                # BAML source: clients, generators, rag
    ├── litellm.config.yaml      # LiteLLM model aliases
    ├── tests/                   # pytest suite
    └── pythonapi/
        ├── main.py              # App assembly only
        ├── config.py            # Settings. All env vars land here.
        ├── dependencies.py      # FastAPI DI providers
        ├── baml_client/         # GENERATED — never edit
        ├── core/                # Business logic. No HTTP, no I/O clients.
        ├── infrastructure/      # External client builders
        ├── repositories/        # SQLAlchemy and Qdrant persistence
        ├── models/              # Pydantic schemas and SQLAlchemy ORM
        ├── routes/              # Thin HTTP layer
        ├── middleware/          # idempotency.py
        └── workers/             # embedding_worker.py
```

`baml_client/` is generated from `baml_src/`. Regenerate it with
`nx baml-generate pythonapi`. Never edit it by hand.

Layer rule: `routes/` → `core/` → `repositories/` → `infrastructure/`. Never
import in the other direction.

---

## Conventions

See [CLAUDE.md](CLAUDE.md) for the full rules. The short version:

- Python follows PEP 8. Functions and variables use `snake_case`. Classes use
  `PascalCase`.
- TypeScript files use `snake_case.tsx`. Components and types use
  `PascalCase`. Variables use `camelCase`.
- Every I/O path is `async`. No blocking call sits inside an `async def`.
- All Postgres access uses SQLAlchemy 2.0 async. No raw SQL anywhere.
- No abbreviations. Write `cancellation_token`, not `ct`.
- No magic strings. Config goes in `Settings`. UI text goes in module
  constants.
- Diagrams use Mermaid. No ASCII box art.
- Ruff enforces line length 88. Run `nx format pythonapi` before you commit.
