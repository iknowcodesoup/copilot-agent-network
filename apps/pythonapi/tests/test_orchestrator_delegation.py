"""Orchestrator routing, delegation, and failure isolation.

Routing is pure, so it is tested directly. Delegation is tested against a
stub directory, because what matters here is what the Orchestrator does with
a specialist's answer - including when there is not one.
"""

import pytest

from pythonapi.a2a_support.delegation import DelegatedResult
from pythonapi.a2a_support.discovery import (
    Specialist,
    SpecialistDirectory,
    SpecialistUnavailable,
)
from pythonapi.agents.orchestrator.routing import RoutingCategory, classify
from pythonapi.agents.orchestrator.specialist_router import route_request
from pythonapi.agents.voice.interface import VoiceSkill
from pythonapi.config import settings

RUN_ID = "4f21aabbccddeeff00112233445566aa"


@pytest.mark.parametrize(
    ("request_text", "expected"),
    [
        ("Start a run for this video", RoutingCategory.VOICE),
        ("Approve the review for that run", RoutingCategory.VOICE),
        ("What does the style guide mean?", RoutingCategory.RESEARCH),
        ("Explain the documentation", RoutingCategory.RESEARCH),
        ("Why is my training run slow?", RoutingCategory.RESEARCH_AND_VOICE),
        (
            "What are the voice dataset requirements?",
            RoutingCategory.RESEARCH_AND_VOICE,
        ),
        ("hello there", RoutingCategory.GENERAL),
        ("thanks", RoutingCategory.GENERAL),
    ],
)
def test_classify_covers_all_four_categories(request_text, expected):
    assert classify(request_text) is expected


def test_an_instruction_about_voice_work_is_not_treated_as_research():
    """'start a run' acts; 'how does a run work' explains. Only the second
    needs the documentation."""
    assert classify("start a run") is RoutingCategory.VOICE
    assert classify("how does a run work") is RoutingCategory.RESEARCH_AND_VOICE


class _StubDirectory:
    """Stands in for SpecialistDirectory, recording what was delegated."""

    def __init__(self, answers):
        self._answers = answers
        self.calls = []


async def _fake_delegate(directory, specialist, *, skill, text, arguments=None):
    directory.calls.append((specialist, skill, arguments))
    return directory._answers[specialist]


@pytest.fixture
def patched_delegate(monkeypatch):
    monkeypatch.setattr(
        "pythonapi.agents.orchestrator.specialist_router.delegate", _fake_delegate
    )


def _result(specialist, *, succeeded, text):
    return DelegatedResult(
        specialist=specialist, skill="s", succeeded=succeeded, text=text
    )


@pytest.mark.asyncio
async def test_a_general_request_is_not_delegated(patched_delegate):
    """None means the Orchestrator answers it itself."""
    directory = _StubDirectory({})

    assert await route_request(directory, "hello there") is None
    assert directory.calls == []


@pytest.mark.asyncio
async def test_a_research_request_goes_only_to_the_research_agent(patched_delegate):
    directory = _StubDirectory(
        {Specialist.RESEARCH: _result(Specialist.RESEARCH, succeeded=True, text="Yes.")}
    )

    answer = await route_request(directory, "explain the documentation")

    assert answer == "Yes."
    assert [call[0] for call in directory.calls] == [Specialist.RESEARCH]


@pytest.mark.asyncio
async def test_a_voice_request_without_a_run_id_lists_the_runs(patched_delegate):
    """ "What is running" is the question left when no run is named, so the
    status skill answers it with a listing rather than refusing."""
    directory = _StubDirectory(
        {Specialist.VOICE: _result(Specialist.VOICE, succeeded=True, text="3 runs")}
    )

    answer = await route_request(directory, "show me the run")

    assert answer == "3 runs"
    specialist, skill, arguments = directory.calls[0]
    assert specialist is Specialist.VOICE
    assert skill == VoiceSkill.VOICE_STATUS.value
    assert arguments is None


@pytest.mark.asyncio
async def test_a_voice_request_passes_the_run_id_as_an_argument(patched_delegate):
    directory = _StubDirectory(
        {Specialist.VOICE: _result(Specialist.VOICE, succeeded=True, text="training")}
    )

    await route_request(directory, f"show me run {RUN_ID}")

    specialist, skill, arguments = directory.calls[0]
    assert specialist is Specialist.VOICE
    assert skill == "voice_status"
    assert arguments == {"run_id": RUN_ID}


@pytest.mark.asyncio
async def test_the_diagnosis_workflow_asks_both_agents(patched_delegate):
    """The reference demonstration: run data plus troubleshooting content."""
    directory = _StubDirectory(
        {
            Specialist.VOICE: _result(
                Specialist.VOICE, succeeded=True, text="Run is training."
            ),
            Specialist.RESEARCH: _result(
                Specialist.RESEARCH, succeeded=True, text="Training takes days."
            ),
        }
    )

    answer = await route_request(directory, f"why is run {RUN_ID} slow?")

    assert {call[0] for call in directory.calls} == {
        Specialist.VOICE,
        Specialist.RESEARCH,
    }
    assert "Run is training." in answer
    assert "Training takes days." in answer


@pytest.mark.asyncio
async def test_research_still_answers_when_the_voice_agent_is_down(patched_delegate):
    """CAP-5: one specialist failing must not take the other's answer with
    it."""
    directory = _StubDirectory(
        {
            Specialist.VOICE: _result(
                Specialist.VOICE, succeeded=False, text="The voice agent is down."
            ),
            Specialist.RESEARCH: _result(
                Specialist.RESEARCH, succeeded=True, text="Training takes days."
            ),
        }
    )

    answer = await route_request(directory, f"why is run {RUN_ID} slow?")

    assert "Training takes days." in answer
    assert "could not read the run state" in answer


@pytest.mark.asyncio
async def test_run_state_still_answers_when_the_research_agent_is_down(
    patched_delegate,
):
    directory = _StubDirectory(
        {
            Specialist.VOICE: _result(
                Specialist.VOICE, succeeded=True, text="Run is training."
            ),
            Specialist.RESEARCH: _result(
                Specialist.RESEARCH, succeeded=False, text="The research agent is down."
            ),
        }
    )

    answer = await route_request(directory, f"why is run {RUN_ID} slow?")

    assert "Run is training." in answer
    assert "could not reach the documentation" in answer


@pytest.mark.asyncio
async def test_an_unreachable_specialist_becomes_a_result_not_an_exception():
    """delegate() must absorb a discovery failure, so one dead agent cannot
    end the chat run."""
    from pythonapi.a2a_support.delegation import delegate

    class _DownDirectory:
        async def client_for(self, specialist):
            raise SpecialistUnavailable("nothing is listening")

    result = await delegate(
        _DownDirectory(), Specialist.RESEARCH, skill="research", text="anything"
    )

    assert result.succeeded is False
    assert "nothing is listening" in result.text


@pytest.mark.asyncio
async def test_the_directory_reads_skills_from_the_card_not_a_hard_coded_list(
    monkeypatch,
):
    """CAP-6: the Orchestrator must discover capabilities, never carry its own
    copy of them."""
    # Point at a port nothing serves. The default URL is the running dev
    # stack's, so relying on it would make this pass or fail depending on
    # whether the container happens to be up.
    monkeypatch.setattr(settings, "RESEARCH_AGENT_A2A_URL", "http://127.0.0.1:9/")
    directory = SpecialistDirectory(local_app=None)

    with pytest.raises(SpecialistUnavailable):
        # There is no card to read, so there is no skill list. A hard-coded
        # list would answer here, which is exactly what must not happen.
        await directory.skills_for(Specialist.RESEARCH)

    await directory.aclose()
