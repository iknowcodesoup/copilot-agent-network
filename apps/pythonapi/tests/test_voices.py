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


# --- search ----------------------------------------------------------------


def test_search_voices_matches_case_insensitively(voice_client):
    voice_client.post("/api/voices", json={"name": "Picard"})
    voice_client.post("/api/voices", json={"name": "Riker"})

    response = voice_client.get("/api/voices", params={"query": "pic"})

    assert response.status_code == 200
    names = [voice["name"] for voice in response.json()]
    assert names == ["Picard"]


def test_search_voices_with_empty_query_returns_every_voice_by_name(voice_client):
    voice_client.post("/api/voices", json={"name": "Riker"})
    voice_client.post("/api/voices", json={"name": "Picard"})

    response = voice_client.get("/api/voices")

    assert response.status_code == 200
    names = [voice["name"] for voice in response.json()]
    assert names == ["Picard", "Riker"]


def test_search_voices_returns_empty_list_for_no_match(voice_client):
    voice_client.post("/api/voices", json={"name": "Picard"})

    response = voice_client.get("/api/voices", params={"query": "nope"})

    assert response.status_code == 200
    assert response.json() == []


def test_search_voices_caps_results_at_limit(voice_client):
    for name in ["Aaa", "Aab", "Aac", "Aad"]:
        voice_client.post("/api/voices", json={"name": name})

    response = voice_client.get("/api/voices", params={"query": "a", "limit": 2})

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert [voice["name"] for voice in body] == ["Aaa", "Aab"]
