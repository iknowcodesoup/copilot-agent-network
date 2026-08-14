---
id: SPEC-video-scoped-ingestion
companions:
  - brownfield.md
  - implementation-plan.md
  - verification.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Video-Scoped Ingestion

## Why

The GPU pipeline ingests one YouTube video per character per job. The same video cannot serve a second character without re-downloading, re-transcribing, and re-diarizing it from scratch. This blocks the target of many videos feeding many named voices — a pain in the current pipeline that must close before voice work can scale past one video per character. See `brownfield.md` for the verified evidence behind each gap.

## Capabilities

- **CAP-1**
  - **intent:** A video ingests once, independent of character. A second character claiming the same video reuses the cached artifacts instead of re-downloading, re-transcribing, and re-diarizing it.
  - **success:** Claiming an already-ingested video for a new voice runs no download, transcribe, or diarize step.

- **CAP-2**
  - **intent:** The control API lists ingested videos and each video's speaker labels with clip counts, independent of any character prefix.
  - **success:** `GET /videos` returns ingested video IDs with diarization status. `GET /videos/{id}/speakers` returns speaker labels and clip counts.

- **CAP-3**
  - **intent:** A single commit can route one or more videos' speaker labels to multiple characters at once.
  - **success:** Committing a payload shaped `{video_id: {speaker_label: character}}` grows every named character's dataset with clips from every named video, in one commit.

- **CAP-4**
  - **intent:** Preprocessing regenerates the training config whenever the dataset has grown since the config was last written.
  - **success:** Running preprocess after new clips land in `dataset/` regenerates `training/config.json`. Running it again with no new clips skips.

## Constraints

- Breaking change: the `copilot_agent_network` gateway binds to the five character-scoped routes this spec moves. Update the gateway's URLs in the same change, or the voice dashboard breaks the moment the routes move. See `brownfield.md` for the exact call sites.
- `speaker_map.json`'s content and readers do not change — only its filesystem path moves with the rest of the video artifacts.
- Existing `work/<character>/youtube/*` directories from before this change need an explicit migration decision (see Open Questions).

## Non-goals

- Rebuilding multi-character clip routing. The routing that sends each speaker's clips to the right character's dataset already works; this spec only moves where the files backing it live on disk.
- Changing the `JobRequest` data model. The character field is already optional; only the path helper needs to change.
- The pythonapi data model split (`voices`, `voice_contributions` tables). That is owned by `spec-multi-voice-data-model`, which depends on this spec because the gateway URL contract changes here.

## Success signal

Ingest video A and assign its speakers to two different voices in one commit — both datasets grow from the one video. Claim video A again for a third voice — the pipeline reuses `work/videos/<A>` and runs no download, transcribe, or diarize step, which is the case that fails today. The `/voices` dashboard, pointed at the moved routes, still loads clip lists, speaker maps, and clip audio.

## Assumptions

- Assumed the migration path for pre-existing `work/<character>/youtube/*` directories is a human decision, not something this spec should default silently — carried into Open Questions rather than resolved.

## Open Questions

- Which migration path for existing `work/<character>/youtube/*` directories: move them programmatically to the new layout, or accept a one-time re-ingest in development?
