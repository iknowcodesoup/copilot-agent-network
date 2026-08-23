# Operating training runs

How a run moves, and what each phase means in practice.

## Run phases

| Phase             | Meaning                                     | Terminal |
| ----------------- | ------------------------------------------- | -------- |
| `downloading`     | Fetching the video's audio                  | No       |
| `diarizing`       | Splitting audio into speaker segments       | No       |
| `awaiting_review` | Waiting for a person to approve clips       | No       |
| `committing`      | Writing the speaker to voice assignment     | No       |
| `training`        | The factory is training the model           | No       |
| `exporting`       | Exporting the trained model                 | No       |
| `ready`           | Finished                                    | Yes      |
| `failed`          | Stopped and did not recover                 | Yes      |
| `committed`       | Assignment turned into contributions        | Yes      |

The reconciler advances every phase except `awaiting_review` and the
terminal ones.

## The rules that keep runs safe

- The phase column is the state machine. There is no checkpointer. A run
  must survive a restart, because training takes days and a review can wait
  longer.
- The reconciler is the only writer of run phases. A webhook reports a
  change and wakes the reconciler. It never decides the new phase.
- Several API instances can run at once. A lease claimed in one atomic
  update is the mutual exclusion, and it expires on its own.
- Every event carries the complete run, never a patch. Applying one twice
  gives the same result, which is what makes reconnect replay cheap.

## Starting the voice factory

Run the control API from the `star-trek-voyicer` repository:

```powershell
just serve-jeanlucrecord    # http://127.0.0.1:8100
```

Set `VOICE_FACTORY_URL` here to point at it. Leave it unset and every
`/api/voice` route answers 503, the reconciler never starts, and nothing
else is affected.

To turn webhooks on, set the webhook URL and token on the factory side. The
token must match `VOICE_WEBHOOK_TOKEN` here.
