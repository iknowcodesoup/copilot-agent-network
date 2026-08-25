"""Group one video's clips by speaker, for the review screen.

The grouping is a view, not a stored fact: the clips are the record, and this
turns them into the shape the board renders. One function, so every caller
over the same clips gets the same board.

What the grouping is for is assigning in bulk. Diarization heard a speaker
and put forty clips under one label, so a reviewer names that whole group in
one go and then culls it with keep and exclude. Nothing downstream joins on
the label - which voice a clip trains is on the clip.
"""

from collections import defaultdict
from collections.abc import Sequence

from pythonapi.models.voice_run import ClipSummary, SpeakerBoard, SpeakerGroup


def build_speaker_board(
    video_id: str, clips: Sequence[ClipSummary], run_id: str | None = None
) -> SpeakerBoard:
    """Every clip grouped under the speaker it belongs to.

    run_id names the run looking at this video, and is None when no run
    claims it - which is normal, since clips outlive the run that produced
    them.
    """
    grouped: dict[str | None, list[ClipSummary]] = defaultdict(list)
    for clip in clips:
        grouped[clip.speaker_label].append(clip)

    speakers = [
        SpeakerGroup(
            speaker_label=speaker_label,
            clip_count=len(group),
            kept_count=sum(1 for clip in group if clip.keep),
            total_duration_sec=sum(clip.duration_sec or 0.0 for clip in group),
            clips=group,
        )
        # None sorts last: the rejected group is the least interesting
        for speaker_label, group in sorted(
            grouped.items(), key=lambda item: (item[0] is None, item[0] or "")
        )
    ]
    return SpeakerBoard(video_id=video_id, run_id=run_id, speakers=speakers)
