"""LangGraph that advances one voice run by one phase.

A run ingests one video and stops at INGESTED. It trains nothing: a voice is
built from clips spread across many videos, so training belongs to
voice_training_graph.py, which advances a Voice.

The graph is deliberately stateless. Every tick loads a run from Postgres, runs
exactly one node, and writes the resulting phase back. The `voice_runs.phase`
column is the durable state, not a LangGraph checkpointer, which is what lets a
run rest at INGESTED for days and survive a restart or redeploy.

Each node answers one question: has the control API job for this phase finished,
and if so what comes next? Nodes never block on a job. They start it, record the
job id, and return.

A node never fails a run for an unreachable factory. The GPU host can reboot
under an ingest job, so a transient error comes back as `transient_error` and
the phase stays put. The reconciler counts those and only gives up after
VOICE_MAX_CONSECUTIVE_ERRORS in a row. A permanent error - a job that really
failed, a contract the factory rejected - still fails the run here.
"""

import logging
from typing import TypedDict

from langgraph.graph import END, StateGraph

from pythonapi.core.voice_factory_gateway import (
    JOB_STATE_RUNNING,
    JOB_STATE_SUCCEEDED,
    STAGE_YOUTUBE_CHUNK,
    STAGE_YOUTUBE_DIARIZE,
    STAGE_YOUTUBE_DOWNLOAD,
    STAGE_YOUTUBE_REVIEW,
    STAGE_YOUTUBE_TRANSCRIBE,
    VoiceFactoryError,
    VoiceFactoryGateway,
    VoiceFactoryTransientError,
)
from pythonapi.core.voice_graph_support import (
    advance,
    defer,
    hold,
    route_by_phase,
)
from pythonapi.models.voice_run import VoiceRun, VoiceRunPhase
from pythonapi.repositories.voice_clips import VoiceClipRepository

logger = logging.getLogger(__name__)


class VoiceRunState(TypedDict, total=False):
    """What one tick reads and writes. Mirrors the persisted VoiceRun."""

    run: VoiceRun
    # set when the tick changed something worth writing back
    changed: bool
    # set when the factory could not answer. The phase is untouched and the
    # reconciler decides whether this run has had too many of these.
    transient_error: str | None


def build_voice_pipeline_graph(
    gateway: VoiceFactoryGateway, clip_repository: VoiceClipRepository
):
    """Compile the graph. Called once, in main.py's lifespan.

    The clip repository is a node dependency, not a state field: only
    DIARIZING writes to it, and passing it through the state would make
    every tick carry a handle it has no use for.
    """
    builder = StateGraph(VoiceRunState)

    builder.add_node(VoiceRunPhase.DOWNLOADING.value, _ingest_node_factory(gateway))
    builder.add_node(
        VoiceRunPhase.DIARIZING.value,
        _diarizing_node_factory(gateway, clip_repository),
    )

    builder.set_conditional_entry_point(
        _route_by_phase,
        {
            VoiceRunPhase.DOWNLOADING.value: VoiceRunPhase.DOWNLOADING.value,
            VoiceRunPhase.DIARIZING.value: VoiceRunPhase.DIARIZING.value,
            END: END,
        },
    )
    # one node per tick: the reconciler calls the graph again on its next pass
    for phase in (VoiceRunPhase.DOWNLOADING, VoiceRunPhase.DIARIZING):
        builder.add_edge(phase.value, END)

    return builder.compile()


def _route_by_phase(state: VoiceRunState) -> str:
    # INGESTED and FAILED are terminal, so a run in either is left alone
    return route_by_phase(state, "run", _NODE_PHASES, END)


_NODE_PHASES = frozenset(
    {
        VoiceRunPhase.DOWNLOADING,
        VoiceRunPhase.DIARIZING,
    }
)


def _fail(run: VoiceRun, message: str) -> VoiceRunState:
    logger.warning("voice run %s failed: %s", run.id, message)
    # remember where it got to, so a manual retry can put it back. The stage
    # indexes are deliberately untouched: they are the finer half of that same
    # answer, and a retry has to resume on the step that failed.
    run.failed_from_phase = run.phase
    run.phase = VoiceRunPhase.FAILED
    run.error = message
    # The job's log is the only record of why this failed, so keep the id.
    # Clearing voyicer_job_id is what stops the next tick polling a dead job.
    run.failed_job_id = run.voyicer_job_id
    run.voyicer_job_id = None
    return {"run": run, "changed": True}


# The ingest steps, in the order the factory runs them. Each is its own control
# API job. Diarization drops out for a run that did not ask for it, so
# ingest_stage_index always points at a step that will really run.
INGEST_STAGES = (
    STAGE_YOUTUBE_DOWNLOAD,
    STAGE_YOUTUBE_TRANSCRIBE,
    STAGE_YOUTUBE_CHUNK,
    STAGE_YOUTUBE_DIARIZE,
    STAGE_YOUTUBE_REVIEW,
)


def ingest_stages_for(run: VoiceRun) -> tuple[str, ...]:
    """The ingest steps this run has to walk, in order."""
    if run.diarize:
        return INGEST_STAGES
    return tuple(stage for stage in INGEST_STAGES if stage != STAGE_YOUTUBE_DIARIZE)


def _ingest_start_fields(run: VoiceRun, stage: str) -> dict:
    """What one ingest step needs beyond its name.

    Every step resolves the video directory from the URL, so all of them get
    it. Only diarization can use a speaker count.
    """
    fields = {
        "character": run.primary_character,
        "stage": stage,
        "youtube_url": run.source_url,
    }
    if stage == STAGE_YOUTUBE_DIARIZE:
        fields["num_speakers"] = run.num_speakers
    return fields


def _ingest_node_factory(gateway: VoiceFactoryGateway):
    """DOWNLOADING: walk the ingest steps, one factory job per tick.

    Download, transcribe, chunk, diarize, and review each run as their own job.
    `ingest_stage_index` survives a failure, so a retry resumes on the step that
    fell over rather than downloading the video again. Same shape and the same
    reason as _committing_node_factory below.
    """

    async def node(state: VoiceRunState) -> VoiceRunState:
        run = state["run"]
        stages = ingest_stages_for(run)
        stage_index = min(run.ingest_stage_index, len(stages) - 1)
        stage = stages[stage_index]

        if run.voyicer_job_id is None:
            try:
                job_id = await gateway.start_job(**_ingest_start_fields(run, stage))
            except VoiceFactoryTransientError as error:
                return defer(run, f"Could not start {stage}: {error}", "run")
            except VoiceFactoryError as error:
                return _fail(run, f"Could not start {stage}: {error}")
            run.voyicer_job_id = job_id
            run.ingest_stage_index = stage_index
            return {"run": run, "changed": True}

        try:
            job_state = await gateway.get_job_state(run.voyicer_job_id)
        except VoiceFactoryTransientError as error:
            return defer(
                run, f"Could not read job {run.voyicer_job_id}: {error}", "run"
            )
        except VoiceFactoryError as error:
            return _fail(run, f"Could not read job {run.voyicer_job_id}: {error}")

        if job_state == JOB_STATE_RUNNING:
            return hold(run, "run")
        if job_state != JOB_STATE_SUCCEEDED:
            return _fail(run, f"Step {stage} {job_state}. See its log for detail.")

        if stage_index + 1 < len(stages):
            run.ingest_stage_index = stage_index + 1
            run.voyicer_job_id = None
            return {"run": run, "changed": True}
        run.ingest_stage_index = 0
        return advance(run, VoiceRunPhase.DIARIZING, "run")

    return node


def _diarizing_node_factory(
    gateway: VoiceFactoryGateway, clip_repository: VoiceClipRepository
):
    """DIARIZING: the ingest job already finished, so collect the clips.

    Reads back what ingest produced, imports it, and then the run is done.
    Review is not a phase it waits in: a reviewer decides clips whenever they
    like, and whether a video is fully reviewed is derived from those
    decisions.
    """

    async def node(state: VoiceRunState) -> VoiceRunState:
        run = state["run"]
        if not run.video_id:
            return _fail(run, "No video id recorded for this run")
        try:
            video_clips = await gateway.get_clips(run.video_id)
        except VoiceFactoryTransientError as error:
            return defer(run, f"Could not read clips: {error}", "run")
        except VoiceFactoryError as error:
            return _fail(run, f"Could not read clips: {error}")

        if not video_clips.clips:
            return _fail(run, "Ingest produced no clips. Try a different video.")

        # The one read of the factory's clips. From here on the review
        # record is voice_clips in Postgres, so this import is what makes
        # the video reviewable at all - and it never overwrites a decision
        # already made, so a re-ingest of a reviewed video is safe.
        await clip_repository.import_clips(run.video_id, video_clips.clips)
        return advance(run, VoiceRunPhase.INGESTED, "run")

    return node
