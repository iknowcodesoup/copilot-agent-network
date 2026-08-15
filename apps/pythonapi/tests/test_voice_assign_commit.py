"""Tests for Story 3.2: split assignment from commit, with an audit trail.

Covers every row of the spec's I/O & Edge-Case Matrix:
- assign happy path / unknown voice / wrong phase
- commit happy path / nothing assigned / wrong phase
- GET /voices/{id} returns real contributions after a commit
"""

from datetime import UTC, datetime

import pytest

from pythonapi.dependencies import (
    get_required_voice_contribution_repository,
    get_required_voice_repository,
    get_required_voice_run_repository,
)
from pythonapi.main import app
from pythonapi.models.voice import VoiceRun, VoiceRunPhase
from pythonapi.models.voices import Voice, VoicePhase
from pythonapi.repositories.voice_contributions import (
    InMemoryVoiceContributionRepository,
)
from pythonapi.repositories.voice_runs import InMemoryVoiceRunRepository
from pythonapi.repositories.voices import InMemoryVoiceRepository


def make_run(phase: VoiceRunPhase, **overrides) -> VoiceRun:
    now = datetime.now(UTC)
    fields = {
        "id": "run1",
        "primary_character": "janeway",
        "source_url": "https://www.youtube.com/watch?v=vid_abc123",
        "video_id": "vid_abc123",
        "video_title": "Janeway speaks",
        "phase": phase,
        "created_at": now,
        "updated_at": now,
    }
    fields.update(overrides)
    return VoiceRun(**fields)


def make_voice(**overrides) -> Voice:
    now = datetime.now(UTC)
    fields = {
        "id": "voice1",
        "name": "Janeway",
        "phase": VoicePhase.AWAITING_COMMIT,
        "created_at": now,
        "updated_at": now,
    }
    fields.update(overrides)
    return Voice(**fields)


@pytest.fixture
def run_repository() -> InMemoryVoiceRunRepository:
    return InMemoryVoiceRunRepository()


@pytest.fixture
def voice_repository() -> InMemoryVoiceRepository:
    return InMemoryVoiceRepository()


@pytest.fixture
def contribution_repository() -> InMemoryVoiceContributionRepository:
    return InMemoryVoiceContributionRepository()


@pytest.fixture
def assign_client(client, run_repository, voice_repository, contribution_repository):
    app.dependency_overrides[get_required_voice_run_repository] = lambda: run_repository
    app.dependency_overrides[get_required_voice_repository] = lambda: voice_repository
    app.dependency_overrides[get_required_voice_contribution_repository] = lambda: (
        contribution_repository
    )
    return client


# --- assign ------------------------------------------------------------


@pytest.mark.asyncio
async def test_assign_stores_the_mapping_without_touching_phase(
    assign_client, run_repository, voice_repository
):
    await run_repository.create_run(make_run(VoiceRunPhase.AWAITING_REVIEW))
    await voice_repository.create_voice(make_voice(id="voice1", name="Janeway"))
    await voice_repository.create_voice(make_voice(id="voice2", name="Chakotay"))

    response = assign_client.post(
        "/api/voice/runs/run1/assign",
        json={"assignments": {"SPEAKER_00": "voice1", "SPEAKER_01": "voice2"}},
    )

    assert response.status_code == 200
    assert response.json() == {
        "run_id": "run1",
        "voice_assignments": {"SPEAKER_00": "voice1", "SPEAKER_01": "voice2"},
    }
    stored = await run_repository.get_run("run1")
    assert stored.voice_assignments == {
        "SPEAKER_00": "voice1",
        "SPEAKER_01": "voice2",
    }
    assert stored.phase is VoiceRunPhase.AWAITING_REVIEW


@pytest.mark.asyncio
async def test_assign_can_be_called_more_than_once_as_a_full_replace(
    assign_client, run_repository, voice_repository
):
    await run_repository.create_run(make_run(VoiceRunPhase.AWAITING_REVIEW))
    await voice_repository.create_voice(make_voice(id="voice1", name="Janeway"))
    await voice_repository.create_voice(make_voice(id="voice2", name="Chakotay"))
    assign_client.post(
        "/api/voice/runs/run1/assign",
        json={"assignments": {"SPEAKER_00": "voice1"}},
    )

    response = assign_client.post(
        "/api/voice/runs/run1/assign",
        json={"assignments": {"SPEAKER_01": "voice2"}},
    )

    assert response.status_code == 200
    stored = await run_repository.get_run("run1")
    # full replace, not a merge: SPEAKER_00 from the first call is gone
    assert stored.voice_assignments == {"SPEAKER_01": "voice2"}


@pytest.mark.asyncio
async def test_assign_rejects_an_unknown_voice_id_and_stores_nothing(
    assign_client, run_repository, voice_repository
):
    await run_repository.create_run(make_run(VoiceRunPhase.AWAITING_REVIEW))
    await voice_repository.create_voice(make_voice(id="voice1", name="Janeway"))

    response = assign_client.post(
        "/api/voice/runs/run1/assign",
        json={"assignments": {"SPEAKER_00": "voice1", "SPEAKER_01": "nope"}},
    )

    assert response.status_code == 404
    stored = await run_repository.get_run("run1")
    assert stored.voice_assignments == {}


@pytest.mark.asyncio
async def test_assign_allows_a_null_voice_id_to_discard_a_speaker(
    assign_client, run_repository, voice_repository
):
    await run_repository.create_run(make_run(VoiceRunPhase.AWAITING_REVIEW))
    await voice_repository.create_voice(make_voice(id="voice1", name="Janeway"))

    response = assign_client.post(
        "/api/voice/runs/run1/assign",
        json={"assignments": {"SPEAKER_00": "voice1", "SPEAKER_01": None}},
    )

    assert response.status_code == 200
    stored = await run_repository.get_run("run1")
    assert stored.voice_assignments == {"SPEAKER_00": "voice1", "SPEAKER_01": None}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "phase",
    [
        VoiceRunPhase.DOWNLOADING,
        VoiceRunPhase.DIARIZING,
        VoiceRunPhase.COMMITTING,
        VoiceRunPhase.TRAINING,
        VoiceRunPhase.READY,
        VoiceRunPhase.FAILED,
        VoiceRunPhase.COMMITTED,
    ],
)
async def test_assign_rejects_a_run_that_is_not_awaiting_review(
    assign_client, run_repository, phase
):
    await run_repository.create_run(make_run(phase))

    response = assign_client.post(
        "/api/voice/runs/run1/assign",
        json={"assignments": {"SPEAKER_00": "voice1"}},
    )

    assert response.status_code == 409


def test_assign_reports_404_for_an_unknown_run(assign_client):
    response = assign_client.post(
        "/api/voice/runs/nope/assign",
        json={"assignments": {"SPEAKER_00": "voice1"}},
    )

    assert response.status_code == 404


# --- commit --------------------------------------------------------------


@pytest.mark.asyncio
async def test_commit_creates_one_contribution_per_assigned_speaker_and_advances_phase(
    assign_client, run_repository, voice_repository, contribution_repository
):
    await run_repository.create_run(make_run(VoiceRunPhase.AWAITING_REVIEW))
    await voice_repository.create_voice(make_voice(id="voice1", name="Janeway"))
    await voice_repository.create_voice(make_voice(id="voice2", name="Chakotay"))
    assign_client.post(
        "/api/voice/runs/run1/assign",
        json={
            "assignments": {
                "SPEAKER_00": "voice1",
                "SPEAKER_01": "voice2",
                "SPEAKER_02": None,
            }
        },
    )

    response = assign_client.post("/api/voice/runs/run1/commit")

    assert response.status_code == 201
    body = response.json()
    assert len(body["contributions"]) == 2
    speaker_labels = {row["speaker_label"] for row in body["contributions"]}
    assert speaker_labels == {"SPEAKER_00", "SPEAKER_01"}
    for row in body["contributions"]:
        assert row["run_id"] == "run1"
        assert row["video_id"] == "vid_abc123"
        assert row["video_title"] == "Janeway speaks"

    stored = await run_repository.get_run("run1")
    assert stored.phase is VoiceRunPhase.COMMITTED

    voice1_contributions = await contribution_repository.list_contributions_for_voice(
        "voice1"
    )
    assert [row.speaker_label for row in voice1_contributions] == ["SPEAKER_00"]


@pytest.mark.asyncio
async def test_commit_rejects_an_empty_assignment_and_creates_no_rows(
    assign_client, run_repository, contribution_repository
):
    await run_repository.create_run(make_run(VoiceRunPhase.AWAITING_REVIEW))

    response = assign_client.post("/api/voice/runs/run1/commit")

    assert response.status_code == 400
    stored = await run_repository.get_run("run1")
    assert stored.phase is VoiceRunPhase.AWAITING_REVIEW
    assert await contribution_repository.list_contributions_for_voice("voice1") == []


@pytest.mark.asyncio
async def test_commit_rejects_an_assignment_of_only_discarded_speakers(
    assign_client, run_repository
):
    """Every value None: same as nothing assigned."""
    await run_repository.create_run(
        make_run(VoiceRunPhase.AWAITING_REVIEW, voice_assignments={"SPEAKER_00": None})
    )

    response = assign_client.post("/api/voice/runs/run1/commit")

    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "phase",
    [
        VoiceRunPhase.DOWNLOADING,
        VoiceRunPhase.DIARIZING,
        VoiceRunPhase.COMMITTING,
        VoiceRunPhase.TRAINING,
        VoiceRunPhase.READY,
        VoiceRunPhase.FAILED,
        VoiceRunPhase.COMMITTED,
    ],
)
async def test_commit_rejects_a_run_that_is_not_awaiting_review(
    assign_client, run_repository, phase
):
    await run_repository.create_run(
        make_run(phase, voice_assignments={"SPEAKER_00": "voice1"})
    )

    response = assign_client.post("/api/voice/runs/run1/commit")

    assert response.status_code == 409


def test_commit_reports_404_for_an_unknown_run(assign_client):
    response = assign_client.post("/api/voice/runs/nope/commit")

    assert response.status_code == 404


# --- fetch voice after commit --------------------------------------------


@pytest.mark.asyncio
async def test_get_voice_lists_real_contributions_after_a_commit(
    assign_client, run_repository, voice_repository
):
    await run_repository.create_run(make_run(VoiceRunPhase.AWAITING_REVIEW))
    await voice_repository.create_voice(make_voice(id="voice1", name="Janeway"))
    assign_client.post(
        "/api/voice/runs/run1/assign",
        json={"assignments": {"SPEAKER_00": "voice1"}},
    )
    assign_client.post("/api/voice/runs/run1/commit")

    response = assign_client.get("/api/voices/voice1")

    assert response.status_code == 200
    body = response.json()
    assert len(body["contributions"]) == 1
    contribution = body["contributions"][0]
    assert contribution["run_id"] == "run1"
    assert contribution["video_id"] == "vid_abc123"
    assert contribution["video_title"] == "Janeway speaks"
    assert contribution["speaker_label"] == "SPEAKER_00"
    assert contribution["voice_id"] == "voice1"
    assert contribution["created_at"]


@pytest.mark.asyncio
async def test_get_voice_still_returns_empty_contributions_before_any_commit(
    assign_client, voice_repository
):
    await voice_repository.create_voice(make_voice(id="voice1", name="Janeway"))

    response = assign_client.get("/api/voices/voice1")

    assert response.status_code == 200
    assert response.json()["contributions"] == []
