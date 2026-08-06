"""Shared pytest fixtures."""

import fakeredis
import pytest
from fastapi.testclient import TestClient

from pythonapi.main import app


@pytest.fixture
def client():
    """TestClient used as a context manager so lifespan() actually runs.

    REDIS_URL / LANGFUSE_* stay unset in the test environment, so both
    clients resolve to None at startup and nothing here touches the network.
    """
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def fake_redis():
    """An in-memory stand-in for redis.asyncio.Redis, exercising real semantics."""
    return fakeredis.FakeAsyncRedis(decode_responses=True)


@pytest.fixture(autouse=True)
def _reset_dependency_overrides():
    yield
    app.dependency_overrides.clear()
