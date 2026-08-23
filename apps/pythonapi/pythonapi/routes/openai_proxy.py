import httpx
from fastapi import APIRouter, HTTPException, Request, Response, status

from pythonapi.config import settings
from pythonapi.routes.proxy_headers import copy_headers

router = APIRouter(prefix="/v1", tags=["OpenAI Compatible"])

_REQUEST_HEADER_BLOCKLIST = {"connection", "content-length", "host"}
_RESPONSE_HEADER_BLOCKLIST = {
    "connection",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def _build_upstream_url(path: str) -> str:
    return f"{settings.LLM_BASE_URL.rstrip('/')}/{path.lstrip('/')}"


async def _forward_request(request: Request, upstream_path: str) -> Response:
    body = await request.body()
    headers = copy_headers(request.headers.items(), _REQUEST_HEADER_BLOCKLIST)
    if not settings.LLM_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="LLM_BASE_URL is not configured",
        )
    # Only when the gateway has a master key. A keyless local stack needs no
    # Authorization header, and an empty bearer token reads as a bad one.
    if settings.LLM_API_KEY:
        headers.setdefault("authorization", f"Bearer {settings.LLM_API_KEY}")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upstream_response = await client.request(
                request.method,
                _build_upstream_url(upstream_path),
                content=body,
                headers=headers,
                params=request.query_params,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI upstream request failed: {exc}",
        ) from exc

    response_headers = copy_headers(
        upstream_response.headers.items(), _RESPONSE_HEADER_BLOCKLIST
    )
    media_type = upstream_response.headers.get("content-type")

    return Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=media_type,
    )


@router.get("/models")
async def list_models(request: Request) -> Response:
    return await _forward_request(request, "models")


@router.post("/chat/completions")
async def create_chat_completion(request: Request) -> Response:
    return await _forward_request(request, "chat/completions")


@router.post("/responses")
async def create_response(request: Request) -> Response:
    return await _forward_request(request, "responses")


@router.post("/embeddings")
async def create_embedding(request: Request) -> Response:
    return await _forward_request(request, "embeddings")


@router.api_route(
    "/{upstream_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
async def proxy_openai_request(request: Request, upstream_path: str) -> Response:
    return await _forward_request(request, upstream_path)
