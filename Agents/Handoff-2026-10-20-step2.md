# Handoff 2026-10-20: Step 2 (stage 4b close records) done; upstream compatibility and the owed checks next

Written from `s4b\close\facts.md`, the session's transcript usage blocks, and the verifier and coordinator messages that the records pass received. `git status` and `git log` were read at the start of the records pass only; the next session first checks this file against `git status` and `git log`.

## 1. Goal and done-criteria

Step 2 ran stage 4b (store2 import and export on the unmerged `feat/alite-s4` branch) through Gate 1, Gate 2, checks and devices, then the close records. Done: stage 4b is technically accepted; the records (ledger rows 1972 to 2000 and 2040 to 2066, the Roadmap stage 4b section and CHORE statuses, the Live-State bullet, this file) are drafted from evidence. Not done: stage 4b is not COMPLETE until the owed items below close.

## 2. Base and dirty state

Branch `feat/alite-s4`, HEAD `19afc6829` (unmerged, unpushed). Commits in order: `775602a2b` S1, `ea7669b96` S2a, `1b27483f6` S2b, `c25482c16` S3, `96b9d10f1` CHORE-110, `19afc6829` S4. Main checkout (`main`): Step 1 was committed as `8e2246cbd` (pushed) including `MC-322` and `MC-323`. Uncommitted on `main` and not part of this step's commit: `Agents/Maintainer-Context.md` (`MC-324`, the maintainer's Step 2 decisions), `Agents/Decision-Index.md`, `.claude/launch.json`, `docs/branding/RisuTanium_Gradient.svg`; untracked `0`, `Agents/Handoff-2026-10-08.md`, `Agents/Handoff-2026-10-08/`, `docs/planning/`. Leave them alone. The worktree `alite-s4` has the unrelated modified `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` (noted at session start).

## 3. Changes made (records only, uncommitted)

- `Agents/Investigation-Ledger.md`: rows 1972 to 2000 and 2040 to 2066 (one row per dispatch or gate verdict; one row per remediation with its combined notifications; per-notification token figures are listed, not summed, because resumed agents report per segment).
- `Agents/Roadmap.md`: statuses for CHORE-48 (superseded), CHORE-75 (superseded), CHORE-74 (deferred), CHORE-129 (residual accepted until 0b), CHORE-103 (open, re-scoped), CHORE-110 (closed); new CHORE-183 (`botPresets` lenient-convert crash), CHORE-184 (Lua runtime fetched from unpkg.com), CHORE-185 (`Chat.draftCaptureScenarios` load-sensitive test), CHORE-186 (E5 shared-profile plugin-index deletion, pre-release blocker, owned by the upstream compatibility work); the next-free sentence now reads CHORE-187; new section "Stage 4b, store2 import and export close (2026-10-20)".
- `Agents/Live-State.md`: header date 2026-10-20; one new bullet above the Step 1 bullet. The Step 1 bullet is left in place, superseded by the new bullet's closing sentence; moving it to `Agents/Archive/` is out of this step's scope.
- This file (new).

## 4. Decisions

The decisions are the maintainer's and are recorded in `Agents/Maintainer-Context.md`, not decided here: `MC-322` (stage 4b Gate 1 answers: CHORE-74 deferred; CHORE-129 residual accepted until 0b; boot import skip notices shown before the reload; the H0 hooks stay through this session and are removed at its handoff; the double boot notice folded into S2a; the `botPresets` crash ticketed; CHORE-110 real-store run then an exporter fix); `MC-323` (investigation request: faster, resumable and background `.bin` import on Android, after stage 4b; leads and constraints); `MC-324` (tiered test data, the D11 split, and the upstream `e773240bf` merge answers 1 to 11). The S4 technical choices and the upstream order (G6, G3, G2 S1 to S3, G1, as one merge) are the orchestrator's, recorded in the Roadmap and Live-State.

## 5. Checks run

- `checks-bef339121`: 19,596 passed. `checks-c25482c16`: 19,708 passed. `checks-96b9d10f1`: 19,711 passed, 23 skipped; check, build and release-dist PASS.
- `checks-19afc6829` (first run): one failure, `Chat.draftCaptureScenarios` "success-then-fail", under APK-build load; passed 3 of 3 alone. Now CHORE-185.
- `checks-19afc6829-r2` (quiet PC): 19,724 passed, 23 skipped, 0 failed; check, build and release-dist PASS.
- Replay and live 429 re-run at `96b9d10f1` (orchestrator, 2026-10-20): `composedRoundTrip`, `nodeLiveServer` and `importForceReplay`, 3 files, 40 passed, 0 skipped.
- Gate verdicts (ledger rows 1975 to 2000 and 2040 to 2062): stage 4b Gate 1 `[REJECT]` then `[APPROVE WITH CONDITIONS]`; S1 `[APPROVE WITH CONDITIONS]` then `[APPROVE]`; S2a `[APPROVE WITH CONDITIONS]` then `[APPROVE]`; S2b `[REJECT]`, `[REJECT]`, `[APPROVE]`; S3 `[APPROVE]`; CHORE-110 `[APPROVE]`; S4 Gate 1 `[APPROVE WITH AMENDMENTS]`, Gate 2 `[REJECT]` then `[EDITORIAL]`.
- Devices (one Note 9, single runs unless stated; each report verified by `doc-verifier` with corrections, except where noted): D1 PASS; D2 to D4 PASS with corrections; D7 PASS; D5 and D8 partly evidenced (pre-fix build); D5 re-run with the S4 build (single run, CHORE-110 closed from files); D11a PASS (real upstream partial backup on the PC); D11b PASS (synthetic scale on the PC).
- Verifier results recorded in the ledger: the 4b sizing packet 10 of 13 confirmed; the `MC-322`/`MC-323` records 14 of 18 verified, all fixed before `8e2246cbd`; the S4 acceptance and D5 re-run 33 claims, 25 verified, 3 inaccurate, 5 unsupported (corrections in rows 2062 and 2063).

## 6. Not yet verified

- The maintainer's A4 round trip (D10): not run.
- The merge of `feat/alite-s4`: not decided.
- The S4 Note 9 effect is a single run that cannot separate the fix from the fresh renderer; the baseline was not re-run. The S4 acceptance's export byte identity was shown by equal sizes only (hashes not logged).
- The D5 re-run's APK bundle name, the empty `src-tauri` diffs and the device cleanup are not verifiable from local files.
- The upstream `e773240bf` triage and compatibility plan are verified (triage, sizing 8 of 8, experiments with corrections) but not implemented; no Gate 1 on the upstream items has run.
- `CHORE-74` and `MC-176` warning text may be stale against upstream `e773240bf` (unverified).
- Store key totals grow slightly per boot (untraced). The rule "no notice after a partial import that about 156k additional assets are missing" is noted, not ticketed.
- D11a did not exercise the plugin storage index path (the partial backup has no `_coldplugin` or `_coldpluginIndex`), and the plugin permission "No" answer is untested.
- The CHORE-110 device confirmation is a small (5-character) profile only; the large-profile export was not repeated.
- A2 was NOT-RUN (no API key) and the A1 meter JSON was not saved.
- All PC figures (S4 acceptance, D11a heap, D11b heap and timings) are best-case i9 hardware; the Note 9 figures are single-run debug-APK runs.
- The record drafts had an independent `doc-verifier` pass (ACCEPT AFTER FIXES); the fixes are applied and only the edited lines need a recheck.
- The unplaced D6 agent (task `a4b0c3f582627e772`, a stage 4 measurement) completed during this session; its results are not reviewed here and belong to the earlier D6 rows.

## 7. Next concrete actions

1. The maintainer's D10 A4 round trip: a `.bin` from the 4b build (the stub form switched on only after the A4 round trip; B4 Gate 1 C5b). The orchestrator runs it with the maintainer at the device.
2. The merge question for `feat/alite-s4`: asked at merge time (`MC-318` 11; the 4b Q7). Merge only when the orchestrator asks the maintainer.
3. The upstream compatibility work, as one merge, in this order: G6, then G3, then G2 (S1 to S3), then G1. Gate 1 inputs, named: `sizing-compat.md` (verified 8 of 8), `advisor-g1g2.md` (`senior-advisor` challenge), `exp\exp-results.md` (verified with corrections), `savekv-intent.md` (SaveKV purpose; 0 callers), `upstream-e773240\triage.md` (37-file conflict set, verified), `MC-324` items 1 to 11. E5 (CHORE-186) is a pre-release blocker and is owned by this work.
4. `MC-323` after that: the Android import investigation (profile the copy path on the Note 9; the commit with the X2 meter; a `senior-advisor` challenge on the resume design before Gate 1; the product questions to the maintainer).
5. Removing the H0 hooks at this handoff (`MC-322` 4): an orchestrator action; not done here.
6. Records owed: the `doc-verifier` pass on these records; then the commit of the records (maintainer authorization needed).
7. Optional follow-ups: the `d11a` asset-failure explanation is orchestrator-accepted only, with no separate verifier; the fixture-shape crashes as hardening notes, if the maintainer wants them ticketed.

## 8. Uncertainty

Stage 4b remains not COMPLETE. The S4 memory effect is measured once on the device; the PC acceptance is verified but its byte-identity evidence is size-only. The upstream plan rests on the orchestrator's order and on `MC-324` answers that are not yet implemented or Gate 1 reviewed. `Agents/Live-State.md` still carries the Step 1 bullet, marked superseded, until its archive move is authorized.
