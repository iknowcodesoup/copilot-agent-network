# Verification — Video-Scoped Ingestion

- [ ] Ingest video A. Assign `SPEAKER_00` to voice X and `SPEAKER_01` to voice Y. Both datasets gain clips from one commit. (CAP-3)
- [ ] Claim video A again for voice Z. The stage reuses `work/videos/<A>` and runs no download, transcribe, or diarize step. This is the case that fails today. (CAP-1)
- [ ] Ingest video B. Assign a speaker to voice X. X's dataset holds clips from A and B. (CAP-1, CAP-3)
- [ ] Run preprocess on X. It regenerates `training/config.json` because the dataset grew. (CAP-4)
- [ ] Run preprocess again with no change. It skips. (CAP-4)
- [ ] Train X from its checkpoint. The run includes clips from both videos.
- [ ] Load the `/voices` dashboard against the moved routes. Clip lists, speaker maps, and clip audio all still load. (CAP-2, gateway constraint)
