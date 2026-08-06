"""Orders endpoint tests."""

from pythonapi.dependencies import get_required_order_repository
from pythonapi.main import app
from pythonapi.repositories.orders import InMemoryOrderRepository


def test_create_order(client):
    app.dependency_overrides[get_required_order_repository] = InMemoryOrderRepository

    response = client.post("/orders", json={"name": "Widget", "itemId": 42})

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "created"
    assert body["id"]


def test_create_order_without_postgres_returns_503(client):
    """get_required_order_repository raises when Postgres isn't configured,
    instead of crashing."""
    response = client.post("/orders", json={"name": "Widget", "itemId": 42})

    assert response.status_code == 503
