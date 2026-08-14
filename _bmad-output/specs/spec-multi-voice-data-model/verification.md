# Verification — Multi-Voice Data Model

- [ ] Create a voice X, ingest video A (ingestion-only graph completes). (CAP-1, CAP-2)
- [ ] Assign speaker `A_00` from video A to voice X. Voice stays in AWAITING_COMMIT. (CAP-3)
- [ ] Commit assignment. Contribution created, voice transitions to TRAINING (or TRAINING kicks off immediately). (CAP-3, CAP-4)
- [ ] Ingest video B, assign speaker `B_01` to voice X, commit. (CAP-1, CAP-3)
- [ ] Verify voice X has two contributions and its training includes clips from both videos. (CAP-1, CAP-5)
