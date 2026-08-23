# Piper training

Training turns a voice's committed clips into a Piper text-to-speech model.

## Where it runs

Training needs an NVIDIA GPU and Docker. It runs on the host, in the
`star-trek-voyicer` repository, not in the `pythonapi` container. That
container pins CPU-only torch and has no GPU access.

`pythonapi` therefore orchestrates training over HTTP. It never trains
anything itself.

## The phases a voice moves through

A voice has its own state machine, separate from a run's:

| Phase             | Meaning                                        |
| ----------------- | ---------------------------------------------- |
| `awaiting_commit` | No contribution has committed clips yet        |
| `training`        | The factory is training the model              |
| `exporting`       | The trained model is being exported            |
| `ready`           | The model is available                         |
| `failed`          | Training stopped and did not recover           |

`awaiting_commit` is where every voice starts. `ready` and `failed` are
terminal. `VoiceTrainingReconciler` advances the two middle phases and
leaves the rest alone.

## Starting training

Training starts in one of two ways:

- Explicitly, by a train call on the voice.
- Automatically, when a contribution commits clips to it.

Both paths end in the same place, so a voice never trains twice at once.

## How long it takes

Training takes days, not minutes. Everything about the design follows from
this. The phase lives in Postgres so a restart does not lose it. The lease
expires on its own so a dead instance does not strand a voice. Logs are
served on request rather than streamed to every browser.

See [troubleshooting](troubleshooting.md) when a run does not progress.
