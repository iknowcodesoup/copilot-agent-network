# Dataset requirements

A Piper voice is trained from clips of one speaker. The clips come from
ingested videos. This page states what a usable dataset looks like.

## What one clip must be

- One speaker only. A clip with two voices teaches the model both.
- Clean speech. Music, effects, and background noise all degrade the result.
- Correctly transcribed. The text must match the audio word for word.

## How clips reach a voice

Clips are never attached to a voice directly. The path is always:

1. A run ingests one video and diarizes it into speaker segments.
2. An operator assigns a speaker to a voice in the videos view.
3. The assignment becomes `voice_contributions` rows.
4. Training reads the contributions for that voice.

One video can contribute to several voices. One voice can draw on several
videos. This is why the contribution table exists instead of a direct link.

## How much audio is enough

More clean audio beats more total audio. A voice with a small set of clean,
correctly transcribed clips trains better than one with a large set that
includes noise and wrong transcripts.

A voice stays in `awaiting_commit` until at least one contribution commits
clips to it. Training cannot start before that.

## Where the decisions live

`review.csv` on the voice factory host is the one source of truth for clip
decisions. The orchestrator stores run state. It stores nothing on disk.

See [diarization](diarization.md) for how speakers are separated, and
[piper-training](piper-training.md) for what happens after commit.
