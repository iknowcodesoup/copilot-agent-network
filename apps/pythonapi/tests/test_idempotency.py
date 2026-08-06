"""IdempotencyMiddleware tests.

The middleware reads its Redis client from app.state directly (it's ASGI
middleware, constructed before Depends() is available), so these tests set
app.state.redis rather than using app.dependency_overrides.
"""

from pythonapi.dependencies import get_required_order_repository
from pythonapi.main import app
from pythonapi.repositories.orders import InMemoryOrderRepository


def test_repeated_request_with_same_key_is_not_reprocessed(client, fake_redis):
    app.state.redis = fake_redis
    app.dependency_overrides[get_required_order_repository] = InMemoryOrderRepository
    headers = {"Idempotency-Key": "test-key-1"}
    payload = {"name": "Widget", "itemId": 42}

    first = client.post("/orders", json=payload, headers=headers)
    second = client.post("/orders", json=payload, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    # Same body (including the generated order id) proves the handler did
    # not run a second time - it was served from the idempotency cache.
    assert first.json() == second.json()


def test_requests_without_key_are_each_processed(client, fake_redis):
    app.state.redis = fake_redis
    app.dependency_overrides[get_required_order_repository] = InMemoryOrderRepository
    payload = {"name": "Widget", "itemId": 42}

    first = client.post("/orders", json=payload)
    second = client.post("/orders", json=payload)

    assert first.json()["id"] != second.json()["id"]
