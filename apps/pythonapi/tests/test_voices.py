"""Tests for the durable Voice entity (Story 3.1): create and fetch."""

import pytest

from pythonapi.dependencies import get_required_voice_repository
from pythonapi.main import app
from pythonapi.repositories.voices import InMemoryVoiceRepository


@pytest.fixture
def repository() -> InMemoryVoiceRepository:
    return InMemoryVoiceRepository()


@pytest.fixture
def voice_client(client, repository):
    app.dependency_overrides[get_required_voice_repository] = lambda: repository
    return client


def test_create_voice_returns_201_with_awaiting_commit_phase(voice_client):
    response = voice_client.post("/api/voices", json={"name": "Picard"})

    assert response.status_code == 201
    body = response.json()
    assert body["phase"] == "awaiting_commit"
    assert body["id"]


def test_create_voice_rejects_a_duplicate_name(voice_client):
    voice_client.post("/api/voices", json={"name": "Picard"})

    response = voice_client.post("/api/voices", json={"name": "Picard"})

    assert response.status_code == 409


def test_get_voice_returns_the_voice_with_empty_contributions(voice_client):
    created = voice_client.post("/api/voices", json={"name": "Picard"})
    voice_id = created.json()["id"]

    response = voice_client.get(f"/api/voices/{voice_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Picard"
    assert body["phase"] == "awaiting_commit"
    assert body["checkpoint_path"] is None
    assert body["contributions"] == []


def test_get_voice_reports_404_for_an_unknown_id(voice_client):
    response = voice_client.get("/api/voices/nope")

    assert response.status_code == 404
