"""Health endpoint tests."""

from pythonapi.dependencies import get_langfuse, get_redis
from pythonapi.main import app


def test_health_route(client):
    """Neither Redis, Langfuse, nor Postgres is configured in the test
    environment. Qdrant is always present (embedded ":memory:" mode)."""
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "qdrant": {"connected": True}}


def test_health_route_reports_redis_connected(client, fake_redis):
    app.dependency_overrides[get_redis] = lambda: fake_redis

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "redis": {"configured": True, "connected": True},
        "qdrant": {"connected": True},
    }


def test_health_route_reports_langfuse_configured(client):
    app.dependency_overrides[get_langfuse] = lambda: object()

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "langfuse": {"configured": True},
        "qdrant": {"connected": True},
    }
