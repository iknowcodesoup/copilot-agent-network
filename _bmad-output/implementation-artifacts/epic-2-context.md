# Epic 2 Context: Reusable Video Ingestion

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Today, ingesting a video is tied to one character: claiming the same video for a
second character repeats the whole download/transcribe/diarize pipeline. This
epic makes video ingestion its own concern, independent of character. An
operator ingests a video once, and its cached artifacts are reused by video ID
for any number of characters afterward. A single commit can then route speaker
labels from one or more videos to multiple characters at once, and
preprocessing regenerates the training config only when new clips actually
landed. The epic delivers UJ-4 standalone — it works against the existing
dashboard UI immediately, with no dependency on Epic 3's Voice entity.

## Stories

- Story 2.1: Reuse Ingested Videos Across Characters
- Story 2.2: Route One Commit to Multiple Characters Across Multiple Videos
- Story 2.3: Skip Redundant Preprocessing

## Requirements & Constraints

- Claiming an already-ingested video for a new character must trigger no
  download, transcribe, or diarize step — cached artifacts are reused by
  video ID (FR12).
- Ingested videos and their detected speakers must be queryable independent
  of any character: a video list with diarization status, and a per-video
  speaker list with clip counts (FR13).
- A single commit payload shaped `{video_id: {speaker_label: character}}`
  must grow every named character's dataset from every video/speaker pair in
  the payload, in one call (FR14).
- Preprocessing must regenerate the training config only when new clips
  landed since the last run for that character; with no new clips, it is a
  no-op (FR15).
- Success is demonstrated by: re-ingesting a previously-ingested video for a
  new character shows no re-download/re-transcribe/re-diarize step in logs
  or timing; after the gateway-route migration, the dashboard still loads
  clip lists, speaker maps, and clip audio with no functional regression.
- A cache hit on re-ingestion must still serve correct artifacts, not merely
  fast ones — reuse must never silently serve stale transcription or
  diarization if the source video changed.

## Technical Decisions

- **Cross-repo breaking-change pairing.** This epic touches five
  `VoiceFactoryGateway`-bound routes on the control API in the separate
  `star-trek-voyicer` repo: `get_clips`, `update_clips`, `set_speaker_map`,
  `stream_clip_audio`, and `get_training_progress`. Four of the five move
  from character-scoped to video-scoped; `get_training_progress` is the one
  route that stays character-scoped and does not move. All five routes and
  the `VoiceFactoryGateway` call sites that depend on them must update in
  the same change — a hard breaking-change pairing across the two repos,
  not two independent rollouts.
- Multi-character clip routing in the voice factory host already works via
  `speaker_map.json` / `commit_reviewed_clips`. This epic relocates where
  that file lives; it does not rebuild the routing logic itself.
- The `JobRequest` data model needs no change — its `character` field is
  already optional.
- No durable Voice entity exists at this point in the build order. This
  epic's commit routes speaker labels to characters, not voices; the
  cross-video Voice concept and its data model belong to Epic 3, built on
  top of this epic's gateway contract and filesystem layout.
- No migration script for pre-existing `work/<character>/youtube/*`
  directories. The accepted path is a one-time manual re-ingest in
  development.
- Any new persistence uses SQLAlchemy 2.0 async, no raw SQL, per the
  project's standing convention.

## Cross-Story Dependencies

- Story 2.1 lands the video-scoped gateway migration (all five routes) and
  the reuse-by-video-ID behavior that Stories 2.2 and 2.3 build on.
- Epic 2 is the upstream dependency for Epic 3 (Multi-Voice Data Model),
  which depends on this epic's gateway contract and filesystem layout. Epic
  2 itself has no dependency on Epic 3.
- Epic 2 shares no dependency with Epic 1 (Agent Tool-Calling) — the two
  threads can proceed in parallel.
