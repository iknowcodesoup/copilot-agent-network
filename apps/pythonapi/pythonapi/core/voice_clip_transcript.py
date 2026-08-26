"""Fill clip text from the video's own transcript around a decision's bounds.

A clip's text starts out as whatever the video's transcript says for its
range. It should keep tracking that as a reviewer drags the trim bar, right
up until the reviewer types over it by hand - see ClipSummary.text_edited.
This sits between the route and VoiceClipRepository.apply_decisions because
it needs the factory gateway (core layer) and the clips' current
text_edited state (repository layer); the repository itself stays
Postgres-only, per the routes -> core -> repositories -> infrastructure
layering.
"""

from collections.abc import Sequence

from pythonapi.core.voice_factory_gateway import VoiceFactoryError, VoiceFactoryGateway
from pythonapi.models.voice_run import ClipDecision, ClipSummary
from pythonapi.repositories.voice_clips import VoiceClipRepository


async def apply_decisions_with_transcript_fill(
    video_id: str,
    decisions: Sequence[ClipDecision],
    clip_repository: VoiceClipRepository,
    gateway: VoiceFactoryGateway | None,
) -> list[ClipSummary]:
    """apply_decisions, plus the transcript auto-fill and reset behaviour.

    A plain resize (start_sec/end_sec given, no text) refills text from the
    transcript only while the clip's own text_edited is still False - a
    reviewer's hand-typed text is never overwritten by a drag. reset_text
    forces the refill regardless, from the bounds the decision gives or, if
    it gives none, the clip's own stored bounds - that is the "reset to
    transcription" button.

    update_clips is a Postgres-only route by design and must keep working
    with VOICE_FACTORY_URL unset (see get_voice_factory_gateway), so a None
    gateway just skips the fill - keep, text and bounds still save. A factory
    error once gateway exists is swallowed the same way: it means the
    transcript could not be read, not that the resize itself is invalid.
    """
    needs_lookup = [
        decision
        for decision in decisions
        if decision.reset_text
        or (
            decision.text is None
            and decision.start_sec is not None
            and decision.end_sec is not None
        )
    ]
    if gateway is not None and needs_lookup:
        existing = {
            clip.clip_id: clip
            for clip in await clip_repository.list_clips_for_video(video_id)
        }
        for decision in needs_lookup:
            clip = existing.get(decision.clip_id)
            if clip is None:
                continue
            if decision.reset_text:
                start = (
                    decision.start_sec
                    if decision.start_sec is not None
                    else clip.start_sec
                )
                end = decision.end_sec if decision.end_sec is not None else clip.end_sec
            elif not clip.text_edited:
                start, end = decision.start_sec, decision.end_sec
            else:
                continue
            if start is None or end is None:
                continue
            try:
                text = await gateway.get_transcript_text(video_id, start, end)
            except VoiceFactoryError:
                continue
            if text:
                decision.text = text
                decision.text_edited = False
    return await clip_repository.apply_decisions(video_id, decisions)
