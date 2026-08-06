"""Idempotency-Key support for POST requests, backed by Redis.

ASGI middleware is constructed once at app startup, before the redis client
exists, so it can't take a Depends(...) the way routes do. Instead it reads
the client off the request scope on every call - scope["app"] is set by
Starlette to the root application regardless of middleware nesting, so this
always resolves to the same instance main.py's lifespan built. There is no
module-level client here to import.
"""

import json

from fastapi.responses import JSONResponse


class IdempotencyMiddleware:
    def __init__(self, app, ttl_seconds: int = 86400) -> None:
        self.app = app
        self.ttl_seconds = ttl_seconds

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        key = headers.get(b"idempotency-key")
        if not key:
            await self.app(scope, receive, send)
            return

        redis_client = scope["app"].state.redis
        if redis_client is None:
            # Redis is an optional integration; degrade to non-idempotent
            # behavior rather than failing the request.
            await self.app(scope, receive, send)
            return

        redis_key = f"idempotency:{key.decode()}"
        cached = await redis_client.get(redis_key)
        if cached:
            response = json.loads(cached)
            cached_response = JSONResponse(
                status_code=response["status"], content=response["body"]
            )
            await cached_response(scope, receive, send)
            return

        status_code = 200
        body_chunks: list[bytes] = []

        async def capture_send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            if message["type"] == "http.response.body":
                body_chunks.append(message.get("body", b""))
            await send(message)

        await self.app(scope, receive, capture_send)

        if 200 <= status_code < 300:
            body = b"".join(body_chunks)
            cache_entry = {
                "status": status_code,
                "body": json.loads(body) if body else None,
            }
            await redis_client.set(
                redis_key, json.dumps(cache_entry), ex=self.ttl_seconds
            )
