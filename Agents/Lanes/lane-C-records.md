# Lane C records: role-play-first import and thin native task design

Lane rules: [README.md](README.md) and [lane-C-brief.md](lane-C-brief.md). Branch `worktree-Lane-C`, started from `b2a1cfcab`. IDs: MC-430 to MC-449, CHORE-330 to CHORE-349, ledger rows 3300 to 3499; no overflow block (provisional IDs on exhaustion, README step 2). Scratch: `%TEMP%\risu-lane-c\`. Ports: 6440 to 6459.

A step here is at most "technically accepted"; it becomes COMPLETE only after lane A folds these records into the shared files.

## Steps

| Step | Item | State |
|---|---|---|
| 1 | CHORE-202 rerun plan (plan only; lane A runs it on a phone): [lane-C-chore202-rerun-plan.md](lane-C-chore202-rerun-plan.md) | Plan verified (row 3303 PASS WITH CORRECTIONS, corrections applied; row 3304 PASS); rows 3300 to 3305; data-ceiling exception and commit approved (`MC-430`); committed on the lane branch, not pushed; plan approved to run after CHORE-204 (lane A's relay); records verified (row 3305); technically accepted; COMPLETE (folded into the shared files by lane A on 2026-10-22, merged in `be1655b18`) |

## MC entries

### MC-430 — Lane C, 2026-10-22: the CHORE-202 rerun may use the 1.25 GiB b1 fixture (an exception to `MC-330` 1); commit the plan on the lane branch

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane C session transcript. Input: [lane-C-chore202-rerun-plan.md](lane-C-chore202-rerun-plan.md), checked by `doc-verifier` (rows 3303 and 3304).
- **Related:** `MC-330` 1, `MC-326` 4; CHORE-202.

1. **Data ceiling: "Approve 1.25 GiB (Recommended)".** The rerun reuses the measure2 fixture `m2-mix18k.bin` (1.24 GiB, assets 1,216.7 MiB), with a 1.25 GiB cap. This is above `MC-330` 1's 200 to 500 MB guidance. The option text gave the reason: the stall appeared only about 61 s into a screen-off copy, so a smaller set may finish first. Not chosen: "Smaller fixture", where lane A would have had to show that the copy still runs 120 s after screen-off.
2. **Commit: "Commit, no push (Recommended)".** The plan and the lane C records are committed on `worktree-Lane-C`, with only those two files staged. Not chosen: "Commit and push branch", "Not yet".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator; the summaries above repeat them.
- Item 1 covers this rerun only; it does not change `MC-330` 1 for other device checks.
- Nothing here authorizes a push, a merge, or a special build.

## CHORE entries

### CHORE-202 (changed) — The Note 9 screen-off import stall has an unknown cause

**Status (2026-10-22, lane C step 1): rerun plan written, [lane-C-chore202-rerun-plan.md](lane-C-chore202-rerun-plan.md); committed on `worktree-Lane-C` (`MC-430`); the maintainer approved running it after CHORE-204 (relayed by lane A on 2026-10-22, recorded in lane A's records); lane A runs R0 on the PC, then R1 to R4 on phone 2. Cause still UNKNOWN.** Ledger rows 3300 to 3305.

- **Corrected facts (re-read in lane A's raw b1 files by `doc-verifier`, row 3303):** the copy did not slow at screen-off. After `KEYCODE_SLEEP` (20:57:42) it wrote at full rate for about 61 s; the writes fell at 20:58:43 to 46, and the Tauri `getDataDir` bridge calls in logcat stopped at 20:58:43 and resumed at 21:07:44, one second after the wake. During the stall almost all sampled app and renderer threads were in state S and none in D (21 sporadic R samples among about 38,900, 20:58:50 to 21:07:30). This replaces the "about 90 s" in the entry above.
- **Poller fault:** b1's `power.txt` blocks 2 to 24 are empty, starting with the poll at 20:57:25, before the sleep. So the empty polls are a fault of the hand-started poller, cause unexplained, and not screen-off behaviour.
- **Copy path on Android (source read, tauri 2.12.1 / wry 0.57.0 per the main checkout's `Cargo.lock`; the APK's linked version is not confirmed):** each asset batch is an `invoke` sent through `window.ipc.postMessage`. Each Rust command resolves `app_data_dir()` through a blocking UI-thread hop (`PathPlugin.getDataDir`), and its reply is delivered by `evaluateJavascript` on the UI thread. `WryActivity.onPause` calls `WebView.onPause()`. `KeepAliveService` is a `dataSync` foreground service with no wake lock, and the manifest has no `WAKE_LOCK` permission.
- **Plan:** no special build. A page-side ring (wrapped `invoke`, Blob reads, `scheduler.yield`, heartbeat, lifecycle events) is installed over CDP before the file pick. An on-device power and process-state sampler records a canary line and each call's exit status. Runs: R0 on the PC; R1 baseline screen-off; R2 backgrounded with the screen on; R3 screen-off with the app whitelisted; R4 a runtime `scheduler.yield` override. Each run has a 15 min limit and the session 75 min; the fixture ceiling is 1.25 GiB.
- **Maintainer decision:** the 1.25 GiB fixture ceiling, above `MC-330` 1's 200 to 500 MB guidance, is approved as an exception for this rerun (`MC-430` 1). A marks or no-yield build, if the run is inconclusive, is a separate gated stage with its own decision.
- **Related:** `MC-326` 4, `MC-330`, `MC-336`, `MC-430`; CHORE-203.

## Ledger rows

All scratch paths are under `%TEMP%\risu-lane-c\`, outside the repository, unless named otherwise.

| Row | Date | Item | Agent / role | Artifact | Result |
|---|---|---|---|---|---|
| 3300 | 2026-10-22 | CHORE-202 copy-path mechanism | investigator | `evidence\mechanism.md` | Packet (source read only). On Android the copy waits on `invoke` replies (`put_assets_batch_b64`, `write_chunk`), not on yields; nine candidate mechanisms, each with the observation that would separate it. Plan input; its decision-critical claims were rechecked by row 3303. |
| 3301 | 2026-10-22 | CHORE-202 device tooling and b1 evidence | investigator | `evidence\tooling.md` | Packet. The b1 power polls were empty from the 2nd poll, before the sleep (a poller fault); the copy ran about 61 s after the sleep, then went idle; bridge calls stopped until the wake. Plan input; rechecked by row 3303. |
| 3302 | 2026-10-22 | CHORE-202 rerun plan | doc-writer | `Agents/Lanes/lane-C-chore202-rerun-plan.md` | Plan written to the orchestrator's design; no special build. |
| 3303 | 2026-10-22 | Plan verification | doc-verifier | hand-back; copy in `verify\verdicts.md` | PASS WITH CORRECTIONS: 30 claims, 20 VERIFIED, 4 CONTRADICTED, 4 OVERSTATED, 2 UNSUPPORTED; 11 corrections (timeline, poller-fault cause, injection method, R2 stay-awake, fixture-push flags, ring and heartbeat caveats, cleanup). Applied by the doc-writer. |
| 3304 | 2026-10-22 | Incremental re-check of the corrections | doc-verifier | hand-back; copy in `verify\verdicts.md` | PASS: all 11 corrections applied and accurate; no new contradiction; brief requirements all present. Two minor notes: the `onPause` / `KeepAliveService` and CDP-latency facts were not re-read by this pass (row 3303 verified them). |
| 3305 | 2026-10-22 | Records verification | doc-verifier | hand-back | PASS WITH CORRECTIONS: about 30 claim groups, 27 VERIFIED, 1 OVERSTATED (every thread S during the stall; in fact 21 sporadic R samples), 2 unverifiable from files (the question round, lane A's relay). Two corrections, applied by the orchestrator: the thread-state wording, and the status lines brought in line with the handoff. It noted that `tooling.md` Q2's block count (22) is wrong; the raw file has 24. |
| 3306 | 2026-10-22 | Plan amended from lane A's R0 | orchestrator | `Agents/Lanes/lane-C-chore202-rerun-plan.md` | Withdrawn: "not frozen as a whole" and "(e) weakened by b1" (a frozen desktop Chrome 155 page still answered CDP; WebView unknown). Filled: the destination asset directory and the time budget. Adjusted: renderer wchan (isolated uid; shell-uid attempt or recorded as missing), and the `pre` dump comes before the file pick. Source: lane A's R0 notes (doc-verified by lane A). Verification: incremental `doc-verifier` PASS WITH CORRECTIONS (11 claims verified); both corrections applied (a stale handoff sentence, the wchan `pre` point). |

## Handoff

2026-10-22, step 1 done (technically accepted). The plan is ready for lane A: [lane-C-chore202-rerun-plan.md](lane-C-chore202-rerun-plan.md). Lane A has filled its two TODO(evidence) items from R0 (the destination asset directory, and the time budget; row 3306). Later the same day lane A relayed the maintainer's approval of the plan ("Approve, run after CHORE-204"). That decision was given in lane A's session, so it belongs in lane A's records, not as a lane C `MC`. Lane A's sequence: build the tooling and run R0 on the PC in `%TEMP%\risu-b715\chore202\` (done, passed); run R1 to R4 on phone 2 after CHORE-204 lands (the reviewed `--no-same-owner` restore), with the measure2 debug MEASURE APK, whose match to b1's build lane A is confirming. The plan document merges into `main` with these records. Next for lane C: wait for lane A's results. The design work (the role-play-first import and the thin native task) does not start before then. Lane A folded these records in (`e2ab7c247`, on merge `be1655b18`). Lane A's R0 on the PC passed (`%TEMP%\risu-b715\chore202\notes.md`); the plan was amended from it (row 3306), on top of `main` at `fa5111580`. Lane A's Roadmap CHORE-202 entry does not yet carry the "Copy path on Android" paragraph or the Related line of the CHORE-202 entry here; lane A folds them in later. R1 to R4 wait for CHORE-204 (d). Evidence packets: `%TEMP%\risu-lane-c\evidence\`.