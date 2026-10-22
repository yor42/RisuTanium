# Lane C records: role-play-first import and thin native task design

Lane rules: [README.md](README.md) and [lane-C-brief.md](lane-C-brief.md). Branch `worktree-Lane-C`, started from `b2a1cfcab`. IDs: MC-430 to MC-449, CHORE-330 to CHORE-349, ledger rows 3300 to 3499; no overflow block (provisional IDs on exhaustion, README step 2). Scratch: `%TEMP%\risu-lane-c\`. Ports: 6440 to 6459.

A step here is at most "technically accepted"; it becomes COMPLETE only after lane A folds these records into the shared files.

## Steps

| Step | Item | State |
|---|---|---|
| 1 | CHORE-202 rerun plan (plan only; lane A runs it on a phone): [lane-C-chore202-rerun-plan.md](lane-C-chore202-rerun-plan.md) | Plan verified (row 3303 PASS WITH CORRECTIONS, corrections applied; row 3304 PASS); rows 3300 to 3305; data-ceiling exception and commit approved (`MC-430`); committed on the lane branch, not pushed; plan approved to run after CHORE-204 (lane A's relay); records verified (row 3305); technically accepted; COMPLETE (folded into the shared files by lane A on 2026-10-22, merged in `be1655b18`) |
| 2 | CHORE-182: free-space check before an Android `.bin` import (`MC-431` 1, `MC-432`) | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[APPROVE]`; locales inserted; rows 3307 to 3313; records verified (row 3318); commit approved (`MC-434`); technically accepted; committed on the lane branch, not pushed; the phone check is batched with lane A |
| 3 | E1: diagnostic patch keeping the WebView resumed while a transfer is in flight, then R2 repeated (`MC-431` 2, `MC-433`) | Patch and run steps in scratch, review round 1 `[APPROVE WITH AMENDMENTS]`, round 2 `[APPROVE]`; rows 3314 to 3317; handed to lane A, which is building and running it on phone 2; no repository change |

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

### MC-431 — Lane C, 2026-10-22: lane C's scope under work order v2 (CHORE-182 free-space check; E1 diagnostic patch; design parked)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane C session transcript. Input: lane A's message relaying work order v2 (`%TEMP%\risu-b715\workorder\workorder-v2.md`, lane A scratch, written 2026-10-22 15:16), whose "Open" list still asked for confirmation of the order.
- **Related:** `MC-326` 4 and 8, `MC-430`; CHORE-182, CHORE-202.

1. **Scope: "Confirm as relayed (Recommended)".** Lane C (1) plans CHORE-182, a free-space check before an Android `.bin` import, through the usual gates, and lane A merges it; (2) writes the E1 diagnostic patch and its run steps in lane C's scratch: `MainActivity.kt` keeps the WebView resumed while a transfer is in flight, then R2 is repeated, and lane A builds and runs it on phone 2; (3) leaves the RP-first and native-task design parked until E1 and lane A's A1 report. The option text said E1 stays in scratch, with no repository code change. Not chosen: "E1 first, CHORE-182 later", "Hold lane C".

**Notes that are not the maintainer's words:**
- The option text was written by the orchestrator from lane A's relay; the work order's own decisions are lane A's to record (A0).
- E1 is a diagnostic experiment, not a fix. Its outcome rule comes from the work order: no freeze means a bounded Kotlin fix enters the MVP; still a freeze means the native task is post-MVP.
- Nothing here authorizes a repository code change for E1, a commit, a push, or a merge.

### MC-432 — Lane C, 2026-10-22: CHORE-182 answers (warn and ask when short; fall back when the read fails; every Android import; Android only)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane C session transcript. Input: `%TEMP%\risu-lane-c\c182\discovery.md` (AI-authored investigator packet, not yet independently verified). Its premises for this round: today's need is 1.1 × assets + 512 MiB (`importFreeSpaceBytes`, `importEstimate.ts`); nothing reads free storage today; the Android warning appears only above 1 GiB of assets (`confirmImportScale`, `storeImport.ts`).
- **Related:** `MC-319` 5, `MC-320` 3 and 4, `MC-326` 8, 9 and 11, `MC-431`; CHORE-182.

1. **Free space below the need: "Warn, ask to continue (Recommended)".** The import shows the need and the free space and lets the person continue or cancel. `MC-319` 5 stands: nothing is refused for size. Not chosen: "Refuse if below assets alone", "Refuse when below need".
2. **Read fails: "Fall back, continue (Recommended)".** When free space cannot be read, the import shows today's text ("the app cannot check how much is free") with the needed size, and goes on as now. Not chosen: "Ask explicitly", "Block the import".
3. **When to check: "Every Android import (Recommended)".** The check runs on every Android `.bin` import. Nothing extra is shown when there is enough space. A warning appears when space is short, even for a small import. The time warning above 1 GiB stays and now shows the free figure. Not chosen: "Only above 1 GiB".
4. **Platforms: "Android only (Recommended)".** Desktop comes later. Not chosen: "Android + desktop Tauri".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator; the summaries above repeat them.
- The orchestrator's reading of item 2 for an import of 1 GiB or less: today such an import shows no space text, so a failed read changes nothing there (silent). The Gate 1 reviewer flagged this as an interpretation, not the option text.
- The need formula stays as it is. `MC-326` 10 option B (keeping the previous profile) is not implemented; if it lands, it adds a term (`MC-326` 11, still to be confirmed).
- Nothing here authorizes a commit, a push or a merge.

### MC-433 — Lane C, 2026-10-22: run the amended E1 (variant A only, outcome keyed on page visibility); approve the patched debug build and the c202base fixture

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane C session transcript. Input: the E1 review `%TEMP%\risu-lane-c\e1\review\verdict.md` (`adversarial-reviewer`, [APPROVE WITH AMENDMENTS]: a release step that pauses the WebView in the foreground; after HOME the window is invisible, so `WebView.onResume()` probably cannot unhide the page; a tick not removed on destroy; the build and fixture not covered by `MC-430`).
- **Related:** `MC-430`, `MC-431` 2, `MC-330` 1; CHORE-202.

1. **E1: "Run amended E1 (Recommended)".** The patch is fixed per the review. Variant A only; B (`resumeTimers`) is dropped; A0 runs only if the logs show the in-flight gate never fired. Run steps carry a three-way outcome rule keyed on the page's visibility. The maintainer approves the patched debug build on phone 2 and the c202base fixture (1,331,537,701 B, about 1.24 GiB, within `MC-430`'s 1.25 GiB cap; an exception to `MC-330` 1 as in `MC-430`), about 20 min of phone time. Not chosen: "Run with a smaller fixture", "Skip E1".

**Notes that are not the maintainer's words:**
- The option text was written by the orchestrator; the review's expectation, given in the question, is that E1 likely still freezes, which would show only that the `onResume` route does not work, not that a native task is needed.
- The patched build is diagnostic only: never merged, never copied into a lane worktree.

### MC-434 — Lane C, 2026-10-22: commit CHORE-182 on the lane branch, no push

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane C session transcript. Input: Gate 2 `[APPROVE]` (row 3311) and the records verification (row 3318).
- **Related:** `MC-432`; CHORE-182.

1. **Commit: "Commit, no push (Recommended)".** CHORE-182 is committed on `worktree-Lane-C` with only the named files staged; lane A merges, runs the full `pnpm test` and the build on the merged snapshot, and batches the phone check. Not chosen: "Not yet".

**Notes that are not the maintainer's words:**
- The option text was written by the orchestrator.
- Nothing here authorizes a push or a merge.

## CHORE entries

### CHORE-182 (changed) — A large `.bin` import on Android does not check free storage first; the time warning only states the space needed

**Status (2026-10-22, lane C step 2): fixed on `worktree-Lane-C`, uncommitted; Gate 2 `[APPROVE]`; the phone check is batched with lane A's next phone 2 session.** Ledger rows 3307 to 3313. Decisions: `MC-432`.

- **What changed:**
  - A Rust command, `app_data_free_bytes` (`src-tauri/src/free_space.rs`, registered in `lib.rs`), returns `statvfs` `f_bavail × f_frsize` (falling back to `f_bsize`) for the app data directory. The arithmetic saturates and is clamped to 2^53 − 1. It is unix only, through a direct `libc` dependency under `cfg(unix)`; elsewhere it returns an error.
  - `readAppDataFreeBytes` (`src/ts/storage/appFreeSpace.ts`) returns `null` on any failure or bad value.
  - `importSpaceVerdict` and `importFreeGigabytesText` (rounded down) are in `importEstimate.ts`.
  - `confirmImportScale` (`storeImport.ts`) reads the free space once on every Android import:
    - above 1 GiB of assets, the time notice states the free figure, or "only about F GB is free, and if the phone runs out of space the import stops";
    - at or below 1 GiB, a short import gets one new prompt (`store2ImportSpaceWarning`), and enough or unknown behave as before.
  - Other platforms are unchanged. Nothing is refused (`MC-319` 5). The strings are in English and six locales; the locale short-space sentences are the translator's own rendering.
- **Evidence:**
  - Red before green on the unmodified code. Four scratch mutants each failed tests.
  - The 4 targeted vitest files: 73 tests pass.
  - `pnpm check`: 0 errors. `cargo check` and `cargo test free_space`: 6 passed (Windows stub and the pure arithmetic).
  - The Gate 2 reviewer compiled the `statvfs` part for `aarch64-linux-android` and `armv7-linux-androideabi` in a scratch crate. The whole crate was not cross-compiled (no NDK clang).
  - Raw outputs: `%TEMP%\risu-lane-c\c182\run\`.
- **Not done:** the native value on a phone, which lane A's phone check covers (against `df /data`; no prompt on a small import). Full `pnpm test` and the build run on the merged snapshot (lane A). Two Gate 2 LOW notes need no change: the free-space call has no timeout, and the old "Your saved data is not changed" line is not absolute for a failure during the final commit.
- **Related:** `MC-432`, `MC-431`, `MC-319` 5, `MC-320` 3, `MC-326` 8 and 11.

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
| 3307 | 2026-10-22 | CHORE-182 discovery | investigator | `c182\discovery.md` | Packet. The warning is on `main` (the "unmerged" note in the Roadmap is stale); nothing reads free storage; the source `.bin` is read in slices, not copied; the open product questions went to the maintainer (`MC-432`). |
| 3308 | 2026-10-22 | CHORE-182 plan | orchestrator | `c182\plan.md` | Plan. |
| 3309 | 2026-10-22 | CHORE-182 Gate 1 | adversarial-reviewer | `c182\gate1.md` | `[APPROVE WITH AMENDMENTS]`: 8 amendments (lane B clearance in writing, a pure Rust helper tested on the PC, an async command, optional trailing string parameters, the read-failure reading noted under `MC-432`, test additions, the device-check scope, comments). All taken into the coder brief. Lane A confirmed in writing that lane B had nothing unmerged in the files (relayed by lane A's message). |
| 3310 | 2026-10-22 | CHORE-182 implementation | sonnet-coder | `c182\run\` | Red before green, 4 mutants, 73 tests pass, `pnpm check` 0 errors, `cargo check`/`cargo test` pass. Created a `node_modules` junction to the main checkout in the worktree (ignored). |
| 3311 | 2026-10-22 | CHORE-182 Gate 2 | adversarial-reviewer | `c182\gate2\verdict.md` | `[APPROVE]`; reran the 73 tests; compiled the `statvfs` part for two Android targets in a scratch crate; confirmed "the import stops" (ENOSPC fails the copy before the profile flip); two LOW notes, no change. |
| 3312 | 2026-10-22 | CHORE-182 locales | translator | `c182\tl\` | Drafts for cn, de, es, ko, vi and zh-Hant; existing sentences kept verbatim; the short-space sentence is new wording. |
| 3313 | 2026-10-22 | CHORE-182 locale insertion | sonnet-coder | `c182\run\locales-*.txt` | 6 lines per locale (4 in, 2 out), CRLF kept, `pnpm check` 0 errors, 73 tests pass. The orchestrator read the ko diff. |
| 3314 | 2026-10-22 | E1 patch | sonnet-coder | `e1\` | Variants A, B and A0 of `MainActivity.kt` and one line in `KeepAliveService.kt`, plus run steps; scratch only; not compiled. |
| 3315 | 2026-10-22 | E1 review round 1 | adversarial-reviewer | `e1\review\verdict.md` | `[APPROVE WITH AMENDMENTS]`: the release step paused the WebView in the foreground; after HOME the window is invisible, so the outcome rule must key on visibility; the tick was not removed on destroy; the build and fixture needed approval (`MC-433`); B is likely a no-op (by inference). |
| 3316 | 2026-10-22 | E1 amendments | sonnet-coder | `e1\` | Fixed per round 1 and `MC-433`: variant A only, B moved to `superseded\`, a three-way outcome rule. |
| 3317 | 2026-10-22 | E1 review round 2 | adversarial-reviewer | `e1\review\verdict-r2.md` | `[APPROVE]`; two wording notes added to the run steps by the orchestrator (an UNEXPECTED exit; no `RisuE1` line means rebuild). The reviewer ran a `git --work-tree` checkout that may have refreshed index stat data; the orchestrator confirmed nothing was staged (`git diff --cached` empty). |
| 3318 | 2026-10-22 | Records verification (MC-431 to 433, CHORE-182, rows 3307 to 3317) | doc-verifier | hand-back | PASS WITH CORRECTIONS: about 40 claims, 36 VERIFIED, 2 OVERSTATED, 2 not checkable from files. Corrections applied by the orchestrator: the "60 s" attribution in `MC-431`, the fixture size in `MC-433`, "likely a no-op" in row 3315, and lane A relays labelled. |

## Handoff

2026-10-22, step 1 done (technically accepted). The plan is ready for lane A: [lane-C-chore202-rerun-plan.md](lane-C-chore202-rerun-plan.md). Lane A has filled its two TODO(evidence) items from R0 (the destination asset directory, and the time budget; row 3306). Later the same day lane A relayed the maintainer's approval of the plan ("Approve, run after CHORE-204"). That decision was given in lane A's session, so it belongs in lane A's records, not as a lane C `MC`. Lane A's sequence: build the tooling and run R0 on the PC in `%TEMP%\risu-b715\chore202\` (done, passed); run R1 to R4 on phone 2 after CHORE-204 lands (the reviewed `--no-same-owner` restore), with the measure2 debug MEASURE APK, whose match to b1's build lane A is confirming. The plan document merges into `main` with these records. Next for lane C: wait for lane A's results. The design work (the role-play-first import and the thin native task) does not start before then. Lane A folded these records in (`e2ab7c247`, on merge `be1655b18`). Lane A's R0 on the PC passed (`%TEMP%\risu-b715\chore202\notes.md`); the plan was amended from it (row 3306), on top of `main` at `fa5111580`. Lane A folded the amendment, the "Copy path on Android" paragraph and the Related line into the shared files in the records commit after the merge `085c58f5b`. R1 to R4 wait for CHORE-204 (d). Evidence packets: `%TEMP%\risu-lane-c\evidence\`.

2026-10-22, work order v2 (`MC-431`): CHORE-182 is implemented in this worktree, uncommitted. Gate 2 returned `[APPROVE]`. It waits for its records check, the maintainer's commit approval, lane A's merge and the batched phone check. E1 is with lane A on phone 2, per lane A's message (`MC-433`); its result decides whether a bounded Kotlin fix is viable (outcome i) or the `onResume` route is ineffective (outcome ii). The RP-first and native-task design stays parked until E1 and lane A's A1 report. The worktree has a `node_modules` junction to the main checkout: remove only the link. Next free IDs: MC-435, CHORE-330, row 3319.