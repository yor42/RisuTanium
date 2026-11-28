### MC-5074 — Owed Note 9 rows run by device-runner subagents; results in the follow-up findings

The orchestrator dispatched one device-runner per phone and attempt and judged from their result files (`Agents/Findings-2026-11-28-owed-rows-note9.md`). No product decision was made.

### MC-5075 — #930 A/B resolved with a scratch no-prefetch build

The same-APK arms of Run F could not separate the prefetch, so a scratch build of the same tree with the single prefetch call replaced by a no-op was measured as a disclosed measurement input (never committed). Sends took median 468 and 657 ms with the prefetch against 1419 and 1434 ms without, at about +85 MiB sandbox PSS idle.

### MC-5076 — Import route on the Note 9 playground uses the system chooser with real taps

The guard `file-chooser` verb failed twice (exit 7, NotReadableError) on the adb-pushed fixture. The route that worked on both phones: onboarding restore confirms, one real `input tap` on the final confirm, one tap on the file row in the system chooser, then the app's own memory-warning confirm.

### MC-5077 — DenseStatus.queryMs is read from the chroMemoryTrace store

queryMs is in no performance measure and not in the modal text, so it was read read-only from `trace.dense` over CDP. Median about 97 ms over 20 sends (49 to 146 ms).

### MC-5078 — Thermal gate and lost build lease token

Battery 30.4 to 32.5 C, no window skipped, CPU zone unreadable. The `dr5b-build2` lease token was not saved and the lease lapsed by TTL; later tokens were written to files first.

### MC-5079 — Rows left unrun

#885 split, #881 delta, B4 on the 1000 library, a second export, TalkBack, png/jpeg cross-check, D-301-SAVE n above 1, and Grid view for #193 were not run; they need a code change, a second build, or a person.
