# Voice training troubleshooting

What to check when a run or a voice does not reach `ready`.

## A run looks stuck

First find the phase. The phase is the state machine, so it tells you who is
responsible for moving the run next.

| Phase             | Who moves it        | If it does not move                       |
| ----------------- | ------------------- | ----------------------------------------- |
| `downloading`     | Reconciler          | Check the factory reached the video       |
| `diarizing`       | Reconciler          | Check the diarizer job on the host        |
| `awaiting_review` | A person            | Nothing is wrong. It waits for the review |
| `committing`      | Reconciler          | Check the contribution rows were written  |
| `training`        | Reconciler          | Expected to be slow. See below            |
| `exporting`       | Reconciler          | Check disk space on the host              |

`awaiting_review` is the most common false alarm. The reconciler skips that
phase on purpose. The run is waiting for a person, not failing.

## Training is slow

Training takes days. A `training` phase that has not changed for hours is
normal, not a fault. Before treating it as a problem, check:

- The factory job is still alive. A dead job stops producing log output.
- `error_count` on the run. A transient factory error holds the phase and
  raises this count. It does not fail the run on its own.
- The GPU is not shared with another job.

Read the training logs from the run's log endpoint. Logs are deliberately
kept off the event stream, so they are fetched, not pushed.

## A run failed

Only `VOICE_MAX_CONSECUTIVE_ERRORS` failures in a row fail a run. One
timeout does not. A failed run records the phase it failed from, and the
retry call puts it back to that phase rather than to the start.

## Live updates stopped

Redis carries events. It never carries state. If Redis is down you lose live
updates and nothing else. The run keeps advancing, and the dashboard catches
up when Redis returns.

A lost webhook costs latency only. The reconcile timer is the backstop, so a
run still advances without it.
