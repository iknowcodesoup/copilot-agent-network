# Diarization

Diarization splits one video's audio into segments and labels each segment
with a speaker. It answers "who spoke when", not "what did they say".

## Where it sits in a run

A run reaches `diarizing` after `downloading` finishes. The diarizer writes
speaker segments and clips for the video. The run then moves to
`awaiting_review`.

## Speaker labels are per video

The diarizer labels speakers within one video only. It has no idea that
speaker 0 in one video is the same person as speaker 2 in another. Linking
them is the operator's job, done by assigning both speakers to the same
voice.

This is why a speaker label is not a voice. A speaker is a per-video
observation. A voice is the durable identity that survives across videos.

## Why review is a human step

`awaiting_review` is the only phase a person moves. The reconciler skips it.
A run can sit there for as long as the review takes, which is why the phase
is stored in Postgres and not held in memory.

The operator confirms which speaker is which, and drops segments that are
noisy or wrongly split. Bad segments accepted here become bad training data
later, and the cost only shows up after a training run that takes days.

See [dataset-requirements](dataset-requirements.md) for what a good clip is.
