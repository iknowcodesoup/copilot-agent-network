# Verification — Videos And Voices Views

- [ ] Ingest video A. Videos view shows it in AWAITING_REVIEW. Expand to see speakers. (CAP-1, CAP-2)
- [ ] Ingest video B. Assign speaker `B_01` to a new voice "Alice". Videos view shows video B as "assigned to Alice". (CAP-2)
- [ ] Assign speaker `A_00` from video A to "Alice". Both videos show "assigned to Alice". (CAP-2, CAP-3)
- [ ] Commit both assignments. Videos table updates to COMMITTED. Voices view shows "Alice" with 2 contributing videos and a "Train now" banner. (CAP-3, CAP-4)
- [ ] Click "Train now". Voice status moves to TRAINING. Training completes, status moves to READY. "Download model" button is active. (CAP-4)
