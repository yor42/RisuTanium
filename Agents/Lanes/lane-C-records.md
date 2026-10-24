# Lane C records: role-play-first import and thin native task design

Lane rules: [README.md](README.md) and [lane-C-brief.md](lane-C-brief.md). Branch `worktree-Lane-C`, started from `b2a1cfcab`. IDs: MC-430 to MC-449, CHORE-330 to CHORE-349, ledger rows 3300 to 3499; no overflow block (provisional IDs on exhaustion, README step 2). Scratch: `%TEMP%\risu-lane-c\`. Ports: 6440 to 6459.

**Status (2026-10-22, lane C): CHORE-182 merged (folded into the shared files by lane A on 2026-10-22, merged in `f8d5ec5f3`); not COMPLETE: lane C's design work is conditional on A1.**

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

## 2026-10-24 — lane C (cloud): CHORE-500, CHORE-501, CHORE-330

Session: lane C (cloud), a Linux cloud container (`/home/user/RisuTanium`), branch `lane-c-cloud` from `main` at `f0e397aae`. Scope: the maintainer approved CHORE-500 and CHORE-501 on 2026-10-24 (session opening message), CHORE-500 first. That approval takes them off the post-MVP list where `MC-352` 4 had parked them; the opening message gives the reason as the MVP now being installed (not checkable from files). Scratch: the session scratchpad (outside the repository), named below as `scratch\…`. Next free IDs at start: MC-435, CHORE-330, row 3319.

**MC entries**

### MC-435 — Lane C, 2026-10-24: CHORE-500 escapes the translated text before display scripts; the markdown-pass finding is filed as CHORE-330 and fixed in this lane

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-24)
- **Date:** 2026-10-24
- **Sweep ref:** none
- **Source:** the lane C (cloud) session transcript. Input: the orchestrator's sizing of `translateNodeText` in `src/ts/translator/translator.ts` and a diagnostic run under jsdom (`scratch\c500\diag\`, row 3319).
- **Related:** `MC-718` 4 and 5, `MC-352` 4, `MC-239`, `MC-175`, `MC-350`; CHORE-500, CHORE-133, CHORE-330.

1. **CHORE-500: "Escape text first (Recommended)".** The option said: escape `&` and `<` in the translated text before the card's display scripts run, so only markup the scripts add becomes elements; literal text stays text, the same as when scripts change nothing. Trade-off: in this mode a script regex sees `&lt;` / `&amp;` instead of `<` / `&` in translated text. Not chosen: "Markdown on the string" (render the script output through markdown like an untranslated message; stray `<` survives but escaped tags still become elements and `&amp;amp;` still collapses), "Sanitize at the site" (chat DOMPurify policy; hygiene only, the text loss remains), "Close, no change".
2. **The side finding: "Fix it in this lane too".** The finding: the markdown pass after the translation (`applyMarkdownToNode`, markdown-it with `html: true`) re-parses literal text as markup, which undoes CHORE-133's ampersand fix in the app; CHORE-133's test replaced that pass with a no-op. It is filed as CHORE-330 and sized and fixed in this lane after CHORE-501, with its own gates. Not chosen: "File, don't fix (Recommended)", "Don't file".

**Notes that are not the maintainer's words:**
- The question and option texts were written by the orchestrator.
- "Escape text first" applies only to the edit-display branch, which runs only with Combine translation on and when a display script changes the translated text.
- The diagnostic run is an orchestrator experiment (row 3319). Its CHORE-500 effects were later reproduced on the pre-fix base by the coder and by Gate 2 (rows 3321 and 3322); its CHORE-330 effect was independently checked at CHORE-330 Gate 1 (row 3325).

### MC-436 — Lane C, 2026-10-24: CHORE-330 escapes literal text before the translator's markdown pass, except inside KaTeX and code

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-24)
- **Date:** 2026-10-24
- **Sweep ref:** none
- **Source:** the lane C (cloud) session transcript. Input: the investigator packet `scratch\c330\inv\result.md` (row 3320; independently checked at Gate 1, row 3325).
- **Related:** `MC-435` 2, `MC-718` 4, `MC-239`, `MC-175`; CHORE-330, CHORE-133, CHORE-500.

1. **"Escape outside math/code (Recommended)".** The option said: escape `&` and `<` in the text before markdown, except inside `$$…$$` (KaTeX) and backtick code. Bold, italics, quote marks, line breaks, KaTeX and code spans work as today; literal tags and entities stay as written. Changes: `<https://…>` written in text no longer becomes a link, and any inline HTML a translator returns shows as literal tags. Not chosen: "Escape everything" (`$$a<b$$` math falls back to raw text and code spans show doubled entities), "No markdown pass" (bold and italics come back as visible `**x**` / `*x*` markers; KaTeX and code spans stop rendering), "Leave as is".

**Notes that are not the maintainer's words:**
- The question and option texts were written by the orchestrator, from the investigator's executed runs.
- The markdown pass (`applyMarkdownToNode`) has one production caller, the translator's Combine translation path (investigator, row 3320).
- The shipped mechanism (CHORE-330, row 3326) differs from the option text in the user's favour: `<https://…>` autolinks and `[l](<a b>)` keep working. It does not change the chosen outcome (literal `&` and `<` stay text outside math and code).

### MC-437 — Lane C, 2026-10-24: CHORE-501 fixes the greeting-only case before commit

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-24)
- **Date:** 2026-10-24
- **Sweep ref:** none
- **Source:** the lane C (cloud) session transcript. Input: CHORE-501 Gate 2 `[APPROVE WITH AMENDMENTS]` (row 3327) and the orchestrator's red-before-green rerun (row 3328).
- **Related:** `MC-352` 4, `MC-711` 2, `MC-722` 1; CHORE-501.

1. **"Fix greeting case first".** The option said: mirror the summariser's greeting rule in the preview (example messages, first-message-sent) before committing; needs a re-review. Not chosen: "Commit, record limits (Recommended)", which would have committed and recorded two limitations: a summary that covers only the greeting still previews the greeting, and after a chat reset or hidden messages the preview maps from the full message list. Also not chosen: "Not yet".

**Notes that are not the maintainer's words:**
- The question and option texts were written by the orchestrator.
- The orchestrator's reading: the preview builds the same prompt-order list the summariser reads (example turns, the greeting when it is sent, then the sent messages) and calls the shared `findResumeIndex`, which also covers the reset and hidden-message limitation. That is a proposal for the plan review, not the maintainer's words.

**CHORE entries**

### CHORE-500 (changed) — Translator edit-display replacement writes translator output with `innerHTML`

**Status (2026-10-24, lane C cloud): fixed on `lane-c-cloud` in `e6d8875`; Gate 2 `[APPROVE WITH AMENDMENTS]`, amendment applied and checked (rows 3321 to 3324).** Decision: `MC-435` 1. Tiny-task carve-out for Gate 1: the change is a few lines at one site, and the product choice was settled first.

- **Defect (EXECUTED, row 3319; confirmed on the pre-fix base by rows 3321 and 3322):** with Combine translation on, when a card's display script changes the translated text, `translateNodeText` writes the script output with `innerHTML`. The translated text is decoded literal text, so an escaped `<img src=x onerror=…>` became a live element, `a &amp;amp; b` lost an entity level, and `x<y and …` was destroyed: the rest of the paragraph became a bogus `<y>` element.
- **What changed:** `src/ts/translator/translator.ts` escapes `&` and `<` only, in a new module-local `escapeTranslatedForMarkup`, before `processScriptFull(..., "editdisplay")`. The "unchanged" check compares the escaped input with the script output and, in that branch, still writes the unescaped text with `textContent`, as before. Quotes and `>` are not escaped, so card regexes that match them keep matching (the shared `escapeHtmlText` escapes both and was not used). Accepted trade-off (`MC-435` 1): in this mode a display script sees `&lt;` / `&amp;` for a literal `<` / `&`.
- **Test:** new `src/ts/translator/translateEditDisplayText.test.ts` (jsdom; real `translateHTML`; `processScriptFull` controllable per test; `applyMarkdownToNode` mocked as a no-op, since the markdown pass is CHORE-330). Three regression reproducers (escaped tag, ampersand entity, bare `<`) and one documentation test of the `MC-435` trade-off (the script sees `&lt;`) fail on the pre-fix base; the commit message of `e6d8875` counts these four together as "four reproducers". Four compatibility guards pass before and after: script-added markup, a quote regex, a `>` regex, and the identity script. `MC-239`: with the helper as the identity, the same four tests fail.
- **Not changed:** stored data and save format (`MC-175`, `MC-350`); the markdown pass, which still re-parses literal text (CHORE-330).
- **Related:** `MC-435`, `MC-718` 5, `MC-352` 4, `MC-239`; CHORE-133, CHORE-330.

### CHORE-501 (changed) — HypaV3 modal "next summarisation" preview uses the last summary's last memo

**Status (2026-10-24, lane C cloud): fixed on `lane-c-cloud` in `a9f15b1`; v1 Gate 2 `[APPROVE WITH AMENDMENTS]` (row 3327); the maintainer chose to fix the greeting case first (`MC-437`); v2 Gate 1 `[APPROVE WITH AMENDMENTS]` (row 3331), Gate 2 `[APPROVE]` (row 3335).** Display only.

- **Defect (TRACED, plan `c501\plan.md`):** `getNextSummarizationTarget` in `src/lib/Others/HypaV3Modal/modal-footer.svelte` showed the message after the last summary's last memo. Both HypaV3 implementations resume after `findResumeIndex` (`src/ts/process/memory/hypaResume.ts`), the highest position of any memo of any summary over the prompt list, after orphan cleaning. So the preview disagreed for unordered or latest-first summary sets, for orphaned memos, after a reset or hidden messages, and for a greeting-only summary.
- **What changed:**
  - `findNextSummarizationTarget` in `src/lib/Others/HypaV3Modal/utils.ts` is a pure helper. It builds the prompt-order list: one memo-less example entry when the character has example turns; the greeting when the chat is not a group and has no `allBefore` reset; then the sent messages from `splitSentMessages`, with a placeholder memo for a message that has no id. It drops orphaned summaries unless `preserveOrphanedMemory` is set, maps null memos to undefined, calls `findResumeIndex`, and returns the first entry the batch loop would summarise: not an example turn, not blank, and not a user message when `doNotSummarizeUserMessage` is set.
  - The footer reads `DBState` before its one `await`.
  - `hasExampleTurns` in `src/ts/process/exampleMessages.ts` shares the example-turn line test with `exampleMessage`, whose output is unchanged.
- **Tests:** `src/lib/Others/HypaV3Modal/modal-footer.nextTarget.svelte.test.ts` mounts the real footer; it has 16 tests, each labelled reproducer or guard. On the HEAD footer 11 fail; on v1 8 fail (the orchestrator reran both, row 3336). v1's orphan case now expects the whole summary dropped; a `preserveOrphanedMemory` guard keeps the old result. `src/ts/process/tests/exampleMessages.test.ts` holds 12 tests, including an `exampleMessage` output guard. Gate 2 killed 5 mutants, including a non-equivalent "undefined memo always counted" variant.
- **Not modelled (recorded, display only):** the batch loop's tail limit (it never takes the last `queryChatCount` chats; same as HEAD); a greeting that is blank only after processing (raw text is used); example turns of group members; the `"NewChat"` / `"NewChatExample"` memos in the valid set, which the batch loop never writes into a summary.
- **Related:** `MC-437`, `MC-352` 4, `MC-711` 2, `MC-722` 1.

### CHORE-330 (new) — The translator's markdown pass re-parses literal text as markup

**Status (2026-10-24, lane C cloud): fixed on `lane-c-cloud` in `c505275`; Gate 1 two rounds `[APPROVE WITH AMENDMENTS]` (rows 3325, 3329), Gate 2 `[APPROVE]` (row 3332).** Filed and scheduled in this lane by `MC-435` 2; decision `MC-436`.

- **Defect (investigator, EXECUTED, row 3320; independent check at Gate 1):** `applyMarkdownToNode` (`src/ts/parser/parser.svelte.ts`) renders each translated text node with markdown-it (`html: true`) and writes the result with `innerHTML`. The text is decoded, so `a &amp;amp; b` shows as `a & b`, which undoes CHORE-133's ampersand fix in the app (that test mocks the pass as a no-op), and inline tags in literal text become elements. Its only production caller is the translator's Combine translation path.
- **What changed (`src/ts/parser/parser.svelte.ts`):** `applyMarkdownToNode` renders through a third markdown-it instance, `mdLiteral`, with `html: false` and the `code` and `entity` rules off. So markdown-it escapes `<` and keeps `&name;` as text under its own rules for code spans, fences and backslash escapes. The KaTeX output of `$$…$$` is replaced by private-use placeholders (U+E9C0 index U+E9C1) and restored after rendering. In text it is restored as MathML; inside a tag attribute, or when KaTeX throws, it is restored as the escaped raw match. U+E9C0 and U+E9C1 are stripped from the input first. `renderMarkdown` gains a trailing `literalText = false`. Its false path runs the same statements in the same order, so chat and highlight output is unchanged (byte-compared at Gate 2). This mechanism replaced the planned pre-scanner after Gate 1 round 1 (row 3326). Against `MC-436`'s option text, `<https://…>` autolinks and `[l](<a b>)` keep working.
- **Tests:** new `src/ts/parser/applyMarkdownLiteralText.test.ts` (16 tests; jsdom; a file-level KaTeX spy) and `src/ts/translator/translateLiteralMarkdown.test.ts` (end-to-end `translateHTML` with the real markdown pass). On the pre-fix parser 9 fail: 6 reproducers, 2 characterisations and the end-to-end case; 8 guards pass. `MC-239`: with `md` in place of `mdLiteral` the reproducers fail.
- **Residuals:** `$$a$$_x_` stays plain, because the placeholder's last character counts as a word character for emphasis flanking (`*` forms work). `$$` inside a fence renders MathML inside the code block; HEAD showed MathML source text. `[a]($$a$$)` gives an inert placeholder href. `customQuotesData` holding `<` or `>` is inserted raw, as at HEAD. Translator-returned inline HTML now shows as literal tags (`MC-436`).
- **Related:** `MC-436`, `MC-435` 2, `MC-239`; CHORE-133, CHORE-500.

**Ledger rows**

Scratch paths are under the session scratchpad, outside the repository.

| Row | Date | Item | Agent / role | Artifact | Result |
|---|---|---|---|---|---|
| 3319 | 2026-10-24 | CHORE-500 sizing and diagnostic | orchestrator | `c500\diag\` (`diag.test.ts`, `out.txt`) | Diagnostic run under jsdom on HEAD `f0e397aae`, with a deepl echo mock and a real `applyMarkdownToNode`. With a display script that appends markup, an escaped `img` became a live `img onerror`, `&amp;amp;` collapsed, and `x<y` was destroyed. With an identity script, `&amp;amp;` also collapsed, which led to CHORE-330. Input to `MC-435`. |
| 3320 | 2026-10-24 | CHORE-330 verification and sizing | investigator | `c330\inv\result.md` | Packet. Confirmed the markdown pass re-parses literal text; an escaped tag on a line of its own stays literal only through markdown-it's html-block rule plus the `markdown !== text` guard. The only production caller is the translator. A plain escape breaks KaTeX `$$a<b$$` and code spans; `html: false` does not fix the entity loss. It briefly created a stray `k.test.ts` in the repository root and moved it to scratch; `git status` was checked clean of it. Input to `MC-436`; independent check at Gate 1. |
| 3321 | 2026-10-24 | CHORE-500 implementation | sonnet-coder | `c500\impl\result.md` | Red on the HEAD `translator.ts`: three reproducers and the documentation test fail, and three guards pass. With the helper as the identity, the same four fail. `npx vitest run src/ts/translator`: 46 passed. `pnpm check`: 0 errors, 0 warnings. |
| 3322 | 2026-10-24 | CHORE-500 Gate 2 | adversarial-reviewer | `c500\g2\verdict.md` (hand-back text saved by the orchestrator) | `[APPROVE WITH AMENDMENTS]`. Red-before-green reproduced on HEAD through a scratch load plugin, with the tree untouched. Mutants caught: identity, `<`-only, quote escaping, the unchanged branch writing escaped text. One survived: also escaping `>`. Amendment: add a `>` guard. No other callers of the edit-display branch; the deeplX path is unaffected. LF line endings. `pnpm check` 0/0. |
| 3323 | 2026-10-24 | CHORE-500 amendment | orchestrator | `src/ts/translator/translateEditDisplayText.test.ts` | Added the guard "lets a script regex that matches a greater-than still produce its span". On the current code, 8 passed. Rerun with row 3322's scratch config: on HEAD it passes and the four reproducers fail; on the `>` mutant only the new guard fails. |
| 3324 | 2026-10-24 | CHORE-500 commit | orchestrator | `e6d8875` on `lane-c-cloud` | Committed with the maintainer's approval ("Commit code only (Recommended)"); two files named. The first message carried a model name in its co-author trailer; the unpushed commit was amended to drop it before anything left the container. |
| 3325 | 2026-10-24 | CHORE-330 Gate 1, round 1 | adversarial-reviewer | `c330\g1\` (`g.test.ts`, `out.txt`; `verdict.md` with the hand-back text saved by the orchestrator) | `[APPROVE WITH AMENDMENTS]`. Independent check of row 3320: claims (a) and (b) VERIFIED; (c) VERIFIED with one omission (angle-bracket link destinations also stop). The packet's "HEAD 18a2c7a" header is CONTRADICTED as a HEAD claim, though the parser is unchanged since that commit. Plan defects, executed: the fence rule, backslash escapes, escaped backticks, block boundaries, `$$`/backtick precedence, and failed KaTeX leaving live markup. |
| 3326 | 2026-10-24 | CHORE-330 plan v2 | orchestrator | `c330\plan-v2.md`, `c330\proto.mjs` | Mechanism changed rather than building a markdown pre-scanner: a third markdown-it instance (`html: false`, `code` and `entity` off) plus KaTeX placeholders. Prototype run on the round-1 cases. |
| 3327 | 2026-10-24 | CHORE-501 Gate 2 (v1) | adversarial-reviewer | `c501\g2\verdict.md` (saved by the orchestrator from the hand-back) | `[APPROVE WITH AMENDMENTS]`. A greeting-only summary disagrees with the real resume point (executed `findResumeIndex` = 0); the reset and hidden-message mapping is the same as at HEAD; tests cover only string memos. Mutants were traced, not run. |
| 3328 | 2026-10-24 | CHORE-501 red-before-green rerun (v1) | orchestrator | `c501\g2\swap.config.ts` | On the HEAD footer: 3 reproducers fail, 2 guards pass; on v1: 5 pass. Input to `MC-437`. |
| 3329 | 2026-10-24 | CHORE-330 Gate 1, round 2 | adversarial-reviewer | `c330\g1r2\` (`v2.mjs`, `run1.mjs`, `run2.mjs`; `verdict.md` with the hand-back text saved by the orchestrator) | `[APPROVE WITH AMENDMENTS]`. Every round-1 defect is fixed natively. New: placeholders restored inside attributes break them; fix: restore on a tag split, with attributes getting the escaped raw match. Asked for a test of chat byte-identity. Optional: a collision strip; the `$$a$$_x_` flanking residual. Folded into v2.1, with chat byte-identity met by construction (no refactor; a guarded flag). |
| 3330 | 2026-10-24 | CHORE-330 implementation | sonnet-coder | `c330\impl\result.md` | On the HEAD parser, 9 of 17 tests fail and 8 guards pass. With `mdLiteral` swapped for `md`, 5 fail. `npx vitest run src/ts/parser src/ts/translator`: 219 passed. `pnpm check`: 0/0. |
| 3331 | 2026-10-24 | CHORE-501 plan v2 Gate 1 | adversarial-reviewer | `c501\g1v2\verdict.md` | `[APPROVE WITH AMENDMENTS]` (source reading). Amendments: mirror orphan cleaning (a whole summary is dropped); do not call `exampleMessage` from the modal (it throws for groups and evaluates macros); use one list for the -1 and no-summary fallbacks; give a placeholder memo to messages without an id; read DBState before the await. All taken, plus the batch loop's skip rules (item 4'). |
| 3332 | 2026-10-24 | CHORE-330 Gate 2 | adversarial-reviewer | `c330\g2\verdict.md` | `[APPROVE]`. With real KaTeX, chat and highlight raw output is byte-identical to HEAD (20 inputs × 5 database configurations). 56 adversarial literal inputs gave no unexpected elements. All 7 mutants were killed. `npx vitest run src/ts/parser src/ts/translator src/lib/Others`: 1179 passed. `pnpm check`: 0/0. LF. Notes: LOW, pre-existing `customQuotesData` raw characters; LOW, `[a]($$a$$)` gives an inert placeholder href; EDITORIAL, one test title. It created a stray `lit.g2.test.ts` in the repository root and moved it out; checked absent. |
| 3333 | 2026-10-24 | CHORE-330 editorial and commit | orchestrator | `c505275` on `lane-c-cloud` | Test title and assertion corrected (fence: `pre code math`); 17 passed. Committed with the maintainer's approval ("Commit (Recommended)"); three files named. |
| 3334 | 2026-10-24 | CHORE-501 v2 implementation | sonnet-coder | `c501\impl2\result.md` | Red: 11 of 16 fail on HEAD, 8 on v1. `npx vitest run src/lib/Others src/ts/process`: 5248 passed. `pnpm check`: 0/0. Its first "undefined always counted" mutant was equivalent on the synthetic list and was replaced. |
| 3335 | 2026-10-24 | CHORE-501 v2 Gate 2 | adversarial-reviewer | `c501\g2v2\verdict.md` | `[APPROVE]`. 5 mutants, all killed, including a non-equivalent "undefined always counted". Both HypaV3 implementations share the mirrored rules; the `exampleMessage` refactor is textually equivalent. Three LOW notes: the `NewChat` memos are missing from the valid set; the `queryChatCount` tail; documented limits. The same suite and `pnpm check` 0/0 were rerun; the red runs were not rerun (from the hand-back, noted in `verdict.md` by the orchestrator; row 3336). |
| 3336 | 2026-10-24 | CHORE-501 v2 red rerun and commit | orchestrator | `c501\impl2\swap2.config.ts`; `a9f15b1` | The saved HEAD copies are byte-identical to `git show HEAD:`. HEAD: 11 failed, 5 passed; v1: 8 failed, 8 passed; current: 16 passed. Committed with the maintainer's approval ("Commit (Recommended)"); five files named. |
| 3337 | 2026-10-24 | Final checks on `a9f15b1` | orchestrator | `final\check.txt`, `final\test.txt`, `final\test2.txt`, `final\test2.head` | `NODE_OPTIONS=--max-old-space-size=8192 pnpm check`: 0 errors, 0 warnings. Full `pnpm test`: 985 files and 22097 tests; 10 failed, 22057 passed, 30 skipped; 2106.9 s. Failures: 9 in `store2/replay/actors.test.ts`, the known Linux timeouts; 1 in `store2/saveLoopNetBackstop.test.ts`, "B7 a negative age verdicts" (next row). The known `saveLoop.test.ts` race did not fire. The first full run (`final\test.txt`) was cut off by a 1500 s timeout and is not counted. |
| 3338 | 2026-10-24 | `saveLoopNetBackstop` B7 on the base | orchestrator | scratch export `base-f0e\` (`git archive f0e397a`, `node_modules` symlinked) | B7 fails 3 of 3 alone on `a9f15b1`, and 1 of 1 on the untouched `f0e397a` export with the same assertion: two verdicts for one id at slot 1000 where one was expected. It is a lane B CHORE-205 test (`fb85ce1`) that fails before this lane's changes; not investigated here. Run on Linux at about 12:48 UTC. Whether it depends on the platform or the clock is UNKNOWN. |
| 3339 | 2026-10-24 | Records verification | doc-verifier | `records\verify.md` | PASS WITH CORRECTIONS: about 55 claims, most VERIFIED; the option texts and approvals are not checkable from files. Six corrections, applied by the orchestrator: a blank line and heading levels; "three reproducers and one documentation test" for CHORE-500; two stale "not yet verified" notes; the autolink note in `MC-436`; hand-back texts saved into the stub verdict files (rows 3322, 3325, 3329, 3335); the remaining-work and handoff lines and the `MC-352` 4 lift (below). Incremental re-check in the next row. |
| 3340 | 2026-10-24 | Incremental records re-check | doc-verifier | `records\verify2.md` | PASS: all six corrections applied accurately; row 3337 matches the saved outputs; B7 re-run on HEAD and on the `f0e397a` export (2 runs each, same assertion); `git diff f0e397a..HEAD -- src/lang` is empty; commits and next free IDs consistent once this row exists. |

**Not done (for lane A at merge):**
- Full `pnpm test`, `pnpm check` and the relevant build on the merged snapshot.
- The merge into `main` and the fold-in of these records into the shared files (Roadmap statuses for CHORE-500, CHORE-501 and the new CHORE-330; `MC-435` to `MC-437`; rows 3319 to 3340).
- The README "What's different from upstream" check (`MC-332` 2). All three changes are user-visible. With Combine translation on, literal `<`, `&` and escaped tags now stay as written, and display scripts see `&lt;` / `&amp;`. The HypaV3 modal preview now names the message the summariser takes next.
- The `saveLoopNetBackstop` B7 failure (row 3338) goes back to lane B or lane A; it is not this lane's.
- No UI strings were added or changed, so the translator has nothing to do.

**Handoff (2026-10-24, lane C cloud).** Branch `lane-c-cloud`, from `main` at `f0e397aae`. Commits: `e6d8875` CHORE-500, `c505275` CHORE-330, `a9f15b1` CHORE-501, then the records commit of this section. Gates: CHORE-500 Gate 1 carve-out, Gate 2 `[APPROVE WITH AMENDMENTS]` with the amendment applied. CHORE-330 Gate 1 had two rounds of `[APPROVE WITH AMENDMENTS]` and the mechanism changed; Gate 2 `[APPROVE]`. CHORE-501 v1 Gate 2 `[APPROVE WITH AMENDMENTS]`, then `MC-437`; v2 Gate 1 `[APPROVE WITH AMENDMENTS]` and Gate 2 `[APPROVE]`. Tests: row 3337. No stored data or save format changed (`MC-175`, `MC-350`). No `REJECT` rounds. Open questions for the maintainer: none outstanding. Residuals are listed in each CHORE entry. Next free IDs: MC-438, CHORE-331, row 3341.
