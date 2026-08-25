"""Turn stored clips into the shape a screen reads.

Two things every clip view needs and the table deliberately does not store:
the assigned voice's name, and the source video's title. Both are somebody
else's fact - the voices table owns one, the factory owns the other - so a
copy beside the clip could go stale the moment either is renamed. They are
joined on at read time instead, in one query each for the whole list.
"""

from collections.abc import Sequence

from pythonapi.core.video_titles import resolve_video_titles
from pythonapi.core.voice_factory_gateway import VoiceFactoryGateway
from pythonapi.models.voice import VoiceClip
from pythonapi.models.voice_run import ClipSummary
from pythonapi.repositories.voice_repository import VoiceRepository


async def name_assigned_voices(
    clips: Sequence[ClipSummary], voice_repository: VoiceRepository
) -> list[ClipSummary]:
    """Fill in voice_name for every clip that carries a voice_id.

    One lookup per distinct voice on the page, not one per clip: a speaker's
    forty clips all point at the same voice.
    """
    voice_ids = {clip.voice_id for clip in clips if clip.voice_id}
    names: dict[str, str] = {}
    for voice_id in voice_ids:
        voice = await voice_repository.get_voice(voice_id)
        if voice is not None:
            names[voice_id] = voice.name
    for clip in clips:
        clip.voice_name = names.get(clip.voice_id) if clip.voice_id else None
    return list(clips)


async def to_voice_clips(
    clips: Sequence[ClipSummary], gateway: VoiceFactoryGateway | None
) -> list[VoiceClip]:
    """One voice's clips, each named by the video it came from.

    The title stays None when the factory is unset or no longer holds the
    video. The clip is still shown: it is assigned, it will still train, and
    hiding it because its name could not be looked up would misreport what
    the voice is made of.
    """
    titles = await resolve_video_titles(gateway, [clip.video_id for clip in clips])
    return [
        VoiceClip(
            video_id=clip.video_id or "",
            clip_id=clip.clip_id,
            video_title=titles.get(clip.video_id or ""),
            keep=clip.keep,
            text=clip.text,
            start_sec=clip.start_sec or 0.0,
            end_sec=clip.end_sec or 0.0,
            duration_sec=clip.duration_sec or 0.0,
            flagged=clip.flagged,
            speaker_label=clip.speaker_label,
        )
        for clip in clips
    ]
