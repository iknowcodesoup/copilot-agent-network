# Operations troubleshooting

Service-level problems, and what each one does and does not break.

## An optional integration is down

Optional integrations degrade. They do not crash the service.

| System   | If it is unset or down                                   |
| -------- | -------------------------------------------------------- |
| Redis    | No live updates and no idempotency. State is unaffected   |
| Langfuse | No traces. Nothing else changes                           |
| Postgres | Document and order features stop. Qdrant still answers    |
| Factory  | `/api/voice` answers 503 and the reconciler does not run  |

Qdrant is the exception. It always works, because it falls back to the
embedded `:memory:` mode.

## A specialist agent is unavailable

A specialist failure stays isolated. An unavailable Research Agent still
leaves voice work usable. An unavailable Voice Agent still leaves research
usable. General requests work when both are down.

A delegated task that does not reach a terminal state within the A2A task
timeout is treated as a specialist failure, so one hung agent cannot hold a
chat stream open.

## The service will not boot

Settings must boot the service with no environment file at all. Every field
carries a real default, and an environment variable is an override.

Two known traps:

- An empty value is not the same as an unset one. `EMBEDDING_DIM=` is read
  as an empty string and fails to parse. Comment the key out instead.
- Qdrant fixes a collection's vector size when it creates it. Changing the
  embedding provider without changing the collection gives a dimension
  mismatch.

## The schema does not match the models

The project uses `create_all`, which creates missing tables but never alters
an existing one. A model change to an existing table does not reach the
database. In development, drop the affected tables and restart. Migrations
are a separate task.
