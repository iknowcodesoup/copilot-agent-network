"""OpenAI-compatible proxy and OpenAPI docs tests."""

from fastapi import Response

from pythonapi.main import app


def test_openapi_schema_moves_under_api_prefix(client):
    response = client.get("/api/openapi.json")

    assert response.status_code == 200
    schema = response.json()
    assert "/api/health" in schema["paths"]
    assert "/api/v1/models" in schema["paths"]


def test_openai_models_proxy_forwards_through_api(client, monkeypatch):
    async def fake_forward(request, upstream_path: str) -> Response:
        assert upstream_path == "models"
        return Response(
            content='{"object":"list","data":[{"id":"local-model"}]}',
            media_type="application/json",
        )

    app.dependency_overrides.clear()
    monkeypatch.setattr("pythonapi.routes.openai_proxy._forward_request", fake_forward)

    response = client.get("/api/v1/models")

    assert response.status_code == 200
    assert response.json() == {"object": "list", "data": [{"id": "local-model"}]}
