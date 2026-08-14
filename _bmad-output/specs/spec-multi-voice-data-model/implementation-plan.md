# Implementation Plan — Multi-Voice Data Model

Ordered technical steps toward the capabilities in `SPEC.md`. HOW detail; the kernel states WHAT and success only. See `data-model.md` for the schemas referenced.

- [ ] Add `voices` and `voice_contributions` tables to SQLAlchemy ORM (`models/orm.py`). Use the async migration pattern (`Base.metadata.create_all`). (CAP-1, CAP-5)
- [ ] Update `VoiceRunRow`: trim training-related columns. Rename `phase` to `ingest_phase`, restrict to DOWNLOADING/DIARIZING/AWAITING_REVIEW/COMMITTED. (CAP-2)
- [ ] Create `VoiceRepository` class (`repositories/voice.py`): CRUD voices, list contributions, query by name, cascade-check before deletion. (CAP-5)
- [ ] Create `VoiceContributionRepository`: CRUD contributions (append-only), list by voice, list by run. (CAP-5)
- [ ] Split LangGraph: create `build_ingest_graph()` (video ingestion only) and `build_voice_graph()` (training only). Move training nodes to the voice graph. (CAP-2, CAP-4)
- [ ] Add routes: `POST /voices` (create named voice), `GET /voices/{id}` (fetch voice + its contributions), `POST /voices/{id}/train` (manual trigger). (CAP-1, CAP-4, CAP-5)
- [ ] Refactor `voice_runs` routes: split `approve_run` into `assign_labels` and `commit_assignments`. Assignments create contributions and trigger voice graphs. (CAP-3)
- [ ] Update `VoiceRunReconciler` to handle ingest-only state transitions. Create a separate `VoiceReconciler` to watch voice phases and update checkpoint paths on completion. (CAP-4)
