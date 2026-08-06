"""Factories for external clients (Redis, Langfuse).

Every function here builds a fresh client instance; none of them hold a
module-level singleton. Callers (main.py's lifespan) construct the client
once and hang it off app.state, so the rest of the app reaches it through
dependencies.py or request.app.state instead of importing a global.
"""
