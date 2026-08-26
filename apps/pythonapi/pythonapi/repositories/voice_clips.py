"""Persistence for clips and the review decisions made about them.

Same shape as voice_repository.py: a Protocol contract, an in-memory double
for tests, and a Postgres implementation that opens its own session per
method.

This table replaced review.csv on the voice factory host. The move matters
for one reason: a dataset is built from two facts - which clips a reviewer
kept, and which voice each one is for - and both used to live in a file that
no query could reach and no transaction protected. "Every clip assigned to
this voice, across every video" was a directory scan. Here it is one indexed
read, which is what lets the Voices view show a voice's clips at all.

The factory still owns the audio. Nothing here is a copy of a wav; the
bounds below say which part of the video's full.wav a clip is, and the
factory cuts it on demand.
"""

from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from pythonapi.models.orm import VoiceClipRow
from pythonapi.models.voice_run import (
    KEEP_BY_DECISION,
    ClipDecision,
    ClipSummary,
)


def _length_excluded_reason(
    duration_sec: float, minimum: float = 1.0, maximum: float = 15.0
) -> str:
    """Why a clip's length disqualifies it, or "" when it does not.

    Re-derived on every trim rather than left as ingest measured it, so
    stretching a too-short clip clears the reason instead of keeping a label
    its new bounds no longer earn.
    """
    if duration_sec < minimum:
        return "too_short"
    if duration_sec > maximum:
        return "too_long"
    return ""


class VoiceClipRepository(Protocol):
    """Storage contract for one video's clips and their review state."""

    async def import_clips(self, video_id: str, clips: Sequence[ClipSummary]) -> int:
        """Record the clips ingest produced, and answer how many were new.

        Idempotent, and deliberately not an overwrite: a clip already here
        keeps its review state. Ingest can run again over a video someone has
        already reviewed - a retry, a second run claiming the same video -
        and re-importing must not throw those decisions away.
        """
        ...

    async def list_clips_for_video(self, video_id: str) -> list[ClipSummary]:
        """Every clip of one video, in playback order."""
        ...

    async def apply_decisions(
        self, video_id: str, decisions: Sequence[ClipDecision]
    ) -> list[ClipSummary]:
        """Apply keep/text/bounds changes and answer the clips as they now
        stand.

        The caller edited them, so it needs the new state; answering a count
        would only make it ask again for what this call already knows.
        """
        ...

    async def assign_clips(
        self, voice_id: str, video_id: str, clip_ids: Sequence[str]
    ) -> int:
        """Point these clips at this voice. Answers how many rows changed."""
        ...

    async def unassign_clips(self, video_id: str, clip_ids: Sequence[str]) -> int:
        """Take these clips off whatever voice holds them."""
        ...

    async def list_clips_for_voice(self, voice_id: str) -> list[ClipSummary]:
        """Every clip assigned to one voice, across every video.

        Ordered by video then start time, so two reads of the same
        assignments list them the same way.
        """
        ...

    async def list_clips_for_voices(
        self, voice_ids: Sequence[str]
    ) -> dict[str, list[ClipSummary]]:
        """The same, for many voices at once, keyed by voice id.

        The Voices card grid needs what one card needs, for every card on
        screen. One query answers them all. Every id asked for gets an entry,
        empty when nothing is assigned to it yet.
        """
        ...

    async def delete_clips_for_video(self, video_id: str) -> None:
        """Drop one video's clips, when the video itself is deleted."""
        ...


class InMemoryVoiceClipRepository:
    """Dict-backed VoiceClipRepository. Test double and local dev without
    Postgres."""

    def __init__(self) -> None:
        # (video id, clip id) -> the clip, the same pair the Postgres
        # composite primary key holds
        self._clips: dict[tuple[str, str], ClipSummary] = {}

    async def import_clips(self, video_id: str, clips: Sequence[ClipSummary]) -> int:
        imported = 0
        for clip in clips:
            key = (video_id, clip.clip_id)
            if key in self._clips:
                continue
            self._clips[key] = clip.model_copy(deep=True)
            imported += 1
        return imported

    async def list_clips_for_video(self, video_id: str) -> list[ClipSummary]:
        return [
            clip.model_copy(deep=True)
            for (stored_video_id, _), clip in sorted(
                self._clips.items(), key=lambda item: (item[0][0], item[1].start_sec)
            )
            if stored_video_id == video_id
        ]

    async def apply_decisions(
        self, video_id: str, decisions: Sequence[ClipDecision]
    ) -> list[ClipSummary]:
        changed: list[ClipSummary] = []
        for decision in decisions:
            clip = self._clips.get((video_id, decision.clip_id))
            if clip is None:
                continue
            _apply_decision(clip, decision)
            changed.append(clip.model_copy(deep=True))
        return changed

    async def assign_clips(
        self, voice_id: str, video_id: str, clip_ids: Sequence[str]
    ) -> int:
        assigned = 0
        for clip_id in clip_ids:
            clip = self._clips.get((video_id, clip_id))
            if clip is None:
                continue
            clip.voice_id = voice_id
            assigned += 1
        return assigned

    async def unassign_clips(self, video_id: str, clip_ids: Sequence[str]) -> int:
        removed = 0
        for clip_id in clip_ids:
            clip = self._clips.get((video_id, clip_id))
            if clip is None or clip.voice_id is None:
                continue
            clip.voice_id = None
            removed += 1
        return removed

    async def list_clips_for_voice(self, voice_id: str) -> list[ClipSummary]:
        return (await self.list_clips_for_voices([voice_id]))[voice_id]

    async def list_clips_for_voices(
        self, voice_ids: Sequence[str]
    ) -> dict[str, list[ClipSummary]]:
        grouped: dict[str, list[ClipSummary]] = {voice_id: [] for voice_id in voice_ids}
        wanted = set(voice_ids)
        for (video_id, _), clip in sorted(
            self._clips.items(), key=lambda item: (item[0][0], item[1].start_sec)
        ):
            if clip.voice_id in wanted:
                grouped[clip.voice_id].append(
                    clip.model_copy(deep=True, update={"video_id": video_id})
                )
        return grouped

    async def delete_clips_for_video(self, video_id: str) -> None:
        for key in [key for key in self._clips if key[0] == video_id]:
            del self._clips[key]


def _apply_decision(clip: ClipSummary, decision: ClipDecision) -> None:
    """One decision, onto one clip. Shared so the two stores cannot drift.

    Only the fields the decision names are touched: keeping a clip and
    retyping its text are separate calls, and neither may quietly revert the
    other.
    """
    if decision.keep is not None:
        clip.keep = KEEP_BY_DECISION[decision.keep]
    if decision.speaker_label is not None:
        clip.speaker_label = decision.speaker_label
    if decision.text is not None:
        clip.text = decision.text
        clip.text_edited = (
            decision.text_edited if decision.text_edited is not None else True
        )
    if decision.start_sec is not None and decision.end_sec is not None:
        clip.start_sec = decision.start_sec
        clip.end_sec = decision.end_sec
        clip.duration_sec = decision.end_sec - decision.start_sec
        clip.excluded_reason = _length_excluded_reason(clip.duration_sec)


class PostgresVoiceClipRepository:
    """SQLAlchemy 2.0 async VoiceClipRepository."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def import_clips(self, video_id: str, clips: Sequence[ClipSummary]) -> int:
        if not clips:
            return 0
        # DO NOTHING, not DO UPDATE: an already-imported clip keeps the
        # review state a person put on it. See the Protocol's docstring.
        statement = (
            pg_insert(VoiceClipRow)
            .values(
                [
                    {
                        "video_id": video_id,
                        "clip_id": clip.clip_id,
                        "keep": clip.keep,
                        "text": clip.text,
                        "text_edited": clip.text_edited,
                        "start_sec": clip.start_sec or 0.0,
                        "end_sec": clip.end_sec or 0.0,
                        "duration_sec": clip.duration_sec or 0.0,
                        "quality_score": clip.quality_score,
                        "flagged": clip.flagged,
                        "speaker_label": clip.speaker_label,
                        "speaker_coverage": clip.speaker_coverage,
                        "excluded_reason": clip.excluded_reason,
                    }
                    for clip in clips
                ]
            )
            .on_conflict_do_nothing(index_elements=["video_id", "clip_id"])
        )
        async with AsyncSession(self._engine) as session:
            result = await session.execute(statement)
            await session.commit()
            return result.rowcount or 0

    async def list_clips_for_video(self, video_id: str) -> list[ClipSummary]:
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                select(VoiceClipRow)
                .where(VoiceClipRow.video_id == video_id)
                .order_by(VoiceClipRow.start_sec)
            )
            return [_clip_from_row(row) for row in result.scalars()]

    async def apply_decisions(
        self, video_id: str, decisions: Sequence[ClipDecision]
    ) -> list[ClipSummary]:
        if not decisions:
            return []
        clip_ids = [decision.clip_id for decision in decisions]
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                select(VoiceClipRow).where(
                    VoiceClipRow.video_id == video_id,
                    VoiceClipRow.clip_id.in_(clip_ids),
                )
            )
            by_clip_id = {row.clip_id: row for row in result.scalars()}
            changed: list[ClipSummary] = []
            for decision in decisions:
                row = by_clip_id.get(decision.clip_id)
                if row is None:
                    continue
                clip = _clip_from_row(row)
                _apply_decision(clip, decision)
                _write_clip_onto_row(row, clip)
                changed.append(clip)
            await session.commit()
            return changed

    async def assign_clips(
        self, voice_id: str, video_id: str, clip_ids: Sequence[str]
    ) -> int:
        return await self._set_voice(voice_id, video_id, clip_ids)

    async def unassign_clips(self, video_id: str, clip_ids: Sequence[str]) -> int:
        return await self._set_voice(None, video_id, clip_ids)

    async def _set_voice(
        self, voice_id: str | None, video_id: str, clip_ids: Sequence[str]
    ) -> int:
        if not clip_ids:
            return 0
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                update(VoiceClipRow)
                .where(
                    VoiceClipRow.video_id == video_id,
                    VoiceClipRow.clip_id.in_(list(clip_ids)),
                )
                .values(voice_id=voice_id)
            )
            await session.commit()
            return result.rowcount or 0

    async def list_clips_for_voice(self, voice_id: str) -> list[ClipSummary]:
        return (await self.list_clips_for_voices([voice_id]))[voice_id]

    async def list_clips_for_voices(
        self, voice_ids: Sequence[str]
    ) -> dict[str, list[ClipSummary]]:
        grouped: dict[str, list[ClipSummary]] = {voice_id: [] for voice_id in voice_ids}
        if not voice_ids:
            return grouped
        async with AsyncSession(self._engine) as session:
            result = await session.execute(
                select(VoiceClipRow)
                .where(VoiceClipRow.voice_id.in_(list(voice_ids)))
                .order_by(VoiceClipRow.video_id, VoiceClipRow.start_sec)
            )
            for row in result.scalars():
                grouped[row.voice_id].append(_clip_from_row(row))
        return grouped

    async def delete_clips_for_video(self, video_id: str) -> None:
        async with AsyncSession(self._engine) as session:
            await session.execute(
                delete(VoiceClipRow).where(VoiceClipRow.video_id == video_id)
            )
            await session.commit()


def _clip_from_row(row: VoiceClipRow) -> ClipSummary:
    return ClipSummary(
        clip_id=row.clip_id,
        video_id=row.video_id,
        keep=row.keep,
        quality_score=row.quality_score,
        flagged=row.flagged,
        speaker_label=row.speaker_label,
        speaker_coverage=row.speaker_coverage,
        voice_id=row.voice_id,
        duration_sec=row.duration_sec,
        start_sec=row.start_sec,
        end_sec=row.end_sec,
        text=row.text,
        text_edited=row.text_edited,
        excluded_reason=row.excluded_reason,
    )


def _write_clip_onto_row(row: VoiceClipRow, clip: ClipSummary) -> None:
    # Only the review fields. voice_id is assign_clips's to write, and the
    # ingest measurements are the factory's - a decision never edits either.
    row.keep = clip.keep
    row.speaker_label = clip.speaker_label
    row.text = clip.text
    row.text_edited = clip.text_edited
    row.start_sec = clip.start_sec or 0.0
    row.end_sec = clip.end_sec or 0.0
    row.duration_sec = clip.duration_sec or 0.0
    row.excluded_reason = clip.excluded_reason
