# Lane A handoff, 2026-10-23 (living document)

This is written for a fresh lane A session on another account. It is updated as steps finish. The **Last updated** line names the newest step. Where this file and Live-State disagree, the later dated text wins. Live-State is current only to records batch 3 (`8c5347ba5`).

**Last updated:** 2026-10-23. Phone 1 part 3 is DONE and VERIFIED; the census is verified; the kept export is deleted; the result has been relayed to lane B. CHORE-225 A+B is merged as `9f8e95722` and PUSHED (21,136 tests passed; check 0/0; build OK; dist OK). Phone 1 part 4 (the CHORE-225 "after" run) is DONE and VERIFIED, and the result has been relayed to lane B. The `MC-368` 1 lift stays BLOCKED. The maintainer chose stage C2 (30 s) and approved all four lane B follow-ups. Stage C is merged as `3882db23e` and PUSHED (21,163 tests passed; check 0/0; build OK; dist OK at 244 files). The CHORE-226 sizing is done (row 3). The workflow fix for scratch-report writes is in place (`b288851f1`).

## Start here
1. Read `CLAUDE.md` → `AGENTS.md`, then the `campaign-workflow` skill.
2. Read the **Lane A role** and **Standing rules** sections below.
3. Read the **In flight** table. Each row says what finishes it and what to do next.
4. Read `Agents/Live-State.md`, the top bullet (batch 3). Then read this file's **Since batch 3** list for anything later.
5. Peer lanes B, C, D and E are separate interactive sessions in `.claude/worktrees/Lane-*`. They will also stop when the quota runs out. Their state is in their own worktrees and records files (`Agents/Lanes/lane-*-records.md` on their branches) and in their scratch folders `%TEMP%\risu-lane-<x>\`. When the maintainer restarts a lane session, it resumes from its own records.

## Lane A role
- Lane A owns:
  - the main checkout `C:\Projects\RisuAI`;
  - the shared records (Maintainer-Context, Roadmap, Investigation-Ledger, Live-State, Decision-Index);
  - `Agents/Tools/device/`;
  - both Note 9 phones;
  - every lane merge.
- A merge goes: merge `--no-ff` → full checks → records fold-in → doc-verify → commit → push.
- Goal: the Android-only personal MVP (`MC-345`). MVP scope (`MC-452`): the chat-open and edit stalls, the slow export, and grid avatar loading.
- Commits and merges need the maintainer's approval (`AskUserQuestion`). Pushing after each main commit is pre-approved.

## Standing rules (beyond AGENTS.md)
- **Shared-tree hygiene:**
  - Stage only named paths: `git commit -F <msgfile> -- <paths>`. Write the message with `[IO.File]::WriteAllLines`.
  - No git index operations in the shared tree.
  - Preserve the maintainer's own changes: `.claude/launch.json`, `docs/branding/RisuTanium_Gradient.svg`, `0`, `Agents/Handoff-2026-10-08*` and `docs/planning/`.
- **Commit trailer** (every lane A commit and merge):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_015Q6ABYpmiXZmtpyHTvmFkW`. A new session uses its own session URL.
- **Write guard:**
  - Register a grant with `& ./.claude/scripts/register-write-scope.ps1 -SessionId '<this session id>' -AgentId '<id>' -Role '<role>' -Files @(<absolute paths>)`. Revoke it with `-Revoke` after the hand-back.
  - record-clerk is refused Maintainer-Context and Decision-Index. Lane A appends MCs itself, then runs `.claude/scripts/update-decision-index.ps1` (and again with `-Check`) and `.claude/scripts/validate-workflow.ps1`.
  - The guard does not see shell writes (CHORE-353). Briefs forbid temporary repo edits by any tool. After any "restored" hand-back, hash-check the files it names.
- **Records format:**
  - Pure CRLF. Maintainer-Context has no final newline.
  - The MC format follows MC-456 and MC-457: Tag, Source and Related; the answers as paraphrased questions with their option text; "What was decided"; then "Notes, not the maintainer's words".
  - Lane MCs are copied verbatim, in fold-in order. Ledger rows have 7 columns.
- **Every AI report gets a doc-verifier.** Its corrections are appended as a "Corrections from doc-verifier" section, and they take precedence.
- **Subagent reports:** since `b288851f1` plus the gitignored `.claude/settings.local.json` rule (see the Update log), agents write reports under `%TEMP%\risu-*` themselves and hand back the path. If a Write is still refused, lane A saves the hand-back to scratch.
- **Phones:**
  - Phone 1 is `29f3cde9193f7ece`, ports 6270-6309. Phone 2 is `2ac80128013f7ece`, ports 6310-6329. Every adb call takes `-s`.
  - Kill only PIDs you started. No `adb logcat -c`. Never hand-edit app state; only the measurement localStorage keys are allowed.
  - Builds come from `git archive` into scratch, with TauriActivity.kt and proguard-tauri.pro copied in and hash-compared. Install with the repo HEAD `Agents/Tools/device/sign-install.ps1`, never an archive copy.
  - Fixed test key: `test-key-sha256=69c387cd...29aaf`. A release build refuses run-as. Do not press Back to close panels; it quits the app.
- **Never read signing secrets:** key.txt, keystores, keystore.properties, `%LOCALAPPDATA%\risu-test-signing` contents, `%USERPROFILE%\.risu-signing`.
- **Real library:** allowed only on the spare Note 9s. Reports carry no personal content (no names, chat text or asset names). The census prints opaque chaIds only.
- **Daily APK:** do NOT build the maintainer's daily APK from main until A9 passes (`MC-368` 1). See In flight row 1.

## In flight

| # | Item | State | Finishes when | Next action |
|---|---|---|---|---|
Rows done this session (details in the Update log): phone 1 part 3, the census (500/500, closed), the A+B merge `9f8e95722`, and phone 1 part 4 (the "after" run; `MC-368` 1 stays BLOCKED on gcMarkMs).

| # | Item | State | Finishes when | Next action |
|---|---|---|---|---|
| 1 | **Merge CHORE-225 stage C** (lane B `7eb3d7223`: C2 module net at most every 30 s, plus the MEASURE yield-gap meter; `MC-372`) | Approved 2026-10-23 ("let's merge it and handoff"). DONE: merged as `3882db23e`, full checks passed (21,163 passed, 23 skipped; check 0/0; build and dist OK; logs in `%TEMP%\risu-b715\merge-c\`), PUSHED | `summary.txt` shows test, check, build and dist all exit 0 | If they all pass: `git push origin main`. If any fails: do not push. Read the log and ask the maintainer (the merge is local only). Lane B's own final checks: 21,083 passed (row 2436) |
| 2 | **Stage C phone run** (phone 1, same profile) | Not requested yet. Lane B's pre-registered expectations are in its row 2436 (B6) | Lane B's device request, or lane A writes one from row 2436 | Ask the maintainer. MEASURE build of main after row 1, with prepare.ps1. Report ticks (including the modules=false tick ms at 0 residents from `savePassMeter`), CDP after a select, gcMarkMs, the first module tick's time against the GC mark's start, and the yield gaps with and without `risu-measure-yield-mode=message`. Then lane B decides B2 (if the gaps are long) and the GC idle-net hold (if gcMarkMs is still 1 s or more) |
| 3 | **CHORE-226 sizing** (lane B row 2437, verified PASS) | Done, but the row is **uncommitted** in Lane-B's `Agents/Lanes/lane-B-records.md`. The working copy repeats two bullets ("CHORE-226 sizing done" and "Next free IDs"); lane B should dedupe them before committing | Lane B commits its records | Merge lane B's records commit (maintainer approval). The maintainer chooses among candidates A to E (`%TEMP%\risu-lane-b\c226\sizing.md`); nothing is approved. The open item is a field-names-only diff of two consecutive real `shard:13` units (lane A's phone data) |
| 4 | **Records batch 4** | Not started | — | See below. Add the stage C merge (row 1) and row 3 |

**Census command** (lane B's tool; re-review `[APPROVE]`; README at `%TEMP%\risu-lane-b\tools\census\README.md`):
```
pwsh -NoProfile -File "C:\Users\yor42\AppData\Local\Temp\risu-lane-b\tools\census\run-census.ps1" -FileA "C:\Risubackup\Backup_partial.bin" -FileB "<kept export>" -ReportPath "C:\Users\yor42\AppData\Local\Temp\risu-b715\census\partial-vs-p3.txt" -JsonPath "C:\Users\yor42\AppData\Local\Temp\risu-b715\census\partial-vs-p3.json" -Repo 'C:\Projects\RisuAI'
```
- Conditions:
  - Use a new output path each run.
  - The input must be fully pulled and must not be touched during the run.
  - Record the `-Repo` HEAD and its dirty files, the input sizes, and that `git status` is unchanged.
  - Keep the vitest log on the PC.
  - Never delete the census folder recursively: it holds a `node_modules` junction into Lane-B.
- Baseline (`%TEMP%\risu-b715\census\partial-run-note.md`): `Backup_partial.bin` is 345,832,259 B, with 500 characters (all inline), 771 chats, 164 modules and 517 assets.

## Records batch 4 (to fold in; pattern of `8c5347ba5` and its brief `%TEMP%\risu-b715\records-b3\brief.md`)
- **A9 report**: `%TEMP%\risu-b715\phone1-a9\report.md`, verified, corrections appended.
  - Verified: automatic passes done, deleting 10 then 1; gcMarkMs 268 and 250; manual run deleted 0; export complete (517 + 499 + 1).
  - The pass start and duration were not recorded.
  - The 500-vs-499 question is open, pending the census.
- **Merges with full checks**:
  - `ff06d0136` (lane B export switches): 21,007 passed; dist OK at 244 files.
  - `f16fb5c30` (lane E grid B1'): 21,046 passed. Hashes matched Gate 2.
  - `4bc6b0b42` (lane B meter): 21,059 passed; dist OK.
  - Plus row 2's merge. Outputs are in `%TEMP%\risu-b715\records-b-knob`, `records-e-gridB` and `records-b-meter` (`full.*`).
- **Lane records to fold** (check each lane file for exact rows):
  - Lane B: MC-370, MC-371, "Measure first" (lane B's own session), CHORE-225; rows 2396-2429.
  - Lane D: MC-389 and rows 2583-2586. These are **uncommitted** in Lane-D. Ask the maintainer to approve lane D's records-only commit, then merge it.
  - Lane E: MC-463 and MC-464; rows 3571-3579. Also an **uncommitted** "2026-10-23, resume point (quota handover)" paragraph at the end of `Agents/Lanes/lane-E-records.md` in Lane-E. Ask the maintainer to approve lane E's records-only commit, then merge it with lane D's.
- **Lane A MC: MC-348** (lane A's range; next free). It records the maintainer's answers since MC-457:
  - S3/S4: "Park, re-measure after fix (Recommended)". This is also in lane D's MC-389.
  - Grid stage B: "B1' only, rest deferred (Recommended)". This is also in lane E's MC-463.
  - The grid B1' commit: "Commit + merge (Recommended)". This is in lane E's MC-464.
  - The merge of lane B's switches: "Merge + full checks (Recommended)".
  - The meter merge: "Merge + full checks (Recommended)".
  - Phone 1 part 3: "Run it now (Recommended)".
  - CHORE-225 stage A: "Merge after phone run (Recommended)".
  - Stages A+B: "Merge A+B after phone (Recommended)".
  - The handoff instruction of 2026-10-23.
  - The question texts are in this session's transcript, `C:\Users\yor42\.claude\projects\C--Projects-RisuAI\1c5d666f-a481-42d8-be9b-a9de61c9160c.jsonl`. Search it for each label.
- Lane A ledger rows start at 2183.
- **CHORE-205** (the architecture study, HIGH priority) is ALREADY written into `Agents/Roadmap.md`, uncommitted. Fold it in with batch 4 and record the maintainer's quote in MC-348: "I think we should ticket this study as high priority with secondary problems, as it solves lots of core issues." It also clarifies that the question is long-horizon and post-MVP.
- Next free IDs: lane A MC-348, CHORE-206, row 2183; lane D MC-390 (once MC-389 is folded), CHORE-242, row 2587; lane E MC-465, CHORE-355, row 3580; lane B MC-373, CHORE-226 (a candidate), row 2438 (lane B used MC-372 and rows 2430-2437).

## Since batch 3 (facts not yet in the shared records)
- **Phone 1 part 1** (`%TEMP%\risu-b715\phone1-fresh\report.md`, verified). The chat-open, edit and grid stalls all come from store2 save planning: the idle net re-encodes all modules each tick when 0 or 1 characters are resident.
  - About 110 s of plan after a select.
  - 8.4 s of a 10.9 s edit.
  - About 91 % of a 101 s grid window (lane E, verified).
- **Ownership** (`MC-457` 5): lane B owns the planner fix (CHORE-225); lane D keeps render work (S3/S4, now parked).
- **Export cold-collect regression** (358 s against A1's 100 s). A9's quiet export took 113.5 s. Part 1's pollers ran `dumpsys meminfo` on the app and its renderers about every 0.35 s, a likely contributor. Row 1 tests this.
- **500 vs 499 coldstorage units** (part 1 against A9). Lane B's analysis was opus-reviewed:
  - Stage 5a GC cannot delete a unit that an export needs.
  - A missing unit would prompt or abort, never drop silently.
  - The likely cause is a character opened during A9 and exported inline; this is verified as a mechanism only.
  - The census closes it.
- **Lane states at handoff:**
  - B: CHORE-225 A+B committed (`77990fcb2`); waiting for row 2. No agents are running. Lane B's handoff is the "2026-10-23, handoff for a fresh lane B session" block in Lane-B's `Agents/Lanes/lane-B-records.md`; it is **uncommitted** (the only dirty file there), so merging `77990fcb2` does not include it. Next free: MC-372, CHORE-226, row 2430. Lane B writes the "after" request once lane A sends the verified baseline path.
  - C: idle.
  - D: idle until the re-measure (S3/S4 parked); MC-389 uncommitted.
  - E: idle, with no agents and no grants. Next, in order: lane B's CHORE-225 fix; a lane A phone grid capture on a re-import (`%TEMP%\risu-lane-e\grid\phone-request.md`); lane E reads it against the B1' pass mark and the 10 s target; then a maintainer proposal on B2, B3, A2 and background generation (`MC-463`). Lane E evidence: `%TEMP%\risu-lane-e\grid\`.
- **Owed:**
  - A flake ticket for the node server fixture load timeouts.
  - Live-State archive moves.
  - The S4-5b Note 9 pass.
  - The maintainer has not yet said which phone they use day to day.
  - CHORE-354 is low priority.

## Open maintainer question (2026-10-23): where would a rewrite be faster or simpler than patching?
The maintainer asked for an analysis and recommendations before deciding. Rewriting departs from targeted stabilization, so the decision is theirs. Lane A gave a first read from session context only. It has not been checked against the code and must not be cited as evidence.
- **Strongest candidate: the store2 save planner.** It is the decision point for what gets encoded and when; the on-disk format and the save loop's guarantees stay. Five stages plus CHORE-225 A and B have patched it. A whole-store "re-encode, hash, compare" each idle tick is what stalls the chat, the edit and the grid. Options:
  - (i) per-entity change tracking;
  - (ii) moving the encode and hash into a worker;
  - (iii) leaving it as it is after CHORE-225 A and B.
  - AGENTS.md's warning applies: dirty tracking can silently drop a dependency, and encode-and-compare is safe by construction.
- **Possible candidate: the Android export writer.** The whole `.bin` export could move into Rust, reading store2 and assets directly. The output must stay byte-compatible with upstream (`MC-175`).
- **Small candidate: thumbnail generation** off the main thread (OffscreenCanvas in a worker, or native). It helps only after the planner stall is gone.
- **Not candidates:** the chat display, regex and CBS pipeline (card compatibility with upstream semantics), the Back handling, and the backup format itself.
- **Proposed study** (new account, after phone 1 part 3):
  1. One investigator per candidate, sizing the current code, the rewrite scope, the compatibility constraints, the test coverage that would carry over, and the measured benefit from phone 1 parts 1 and 3 and the CHORE-225 "after" run.
  2. A senior-advisor challenge on the result.
  3. A short decision memo for the maintainer.
  - The CHORE-225 "after" numbers are the main input to the planner question, so run the study after them.
- **The maintainer's clarification (2026-10-23):** this is a long-horizon, post-MVP question: which subsystems will have to be dealt with sooner or later because of architectural problems? It is not "let's rewrite now". Lane A's first read, unverified: one root assumption underlies most issues. The whole library is a single reactive object in the page's main-thread memory. Save planning, the boot walk, the stubs and unload work, the grid's load-everything, and export shuttling through the page all follow from that. Secondary issues:
  - most CPU work is on the main thread, with no worker architecture;
  - the IPC is byte-heavy (base64);
  - the `.bin` is one monolithic file (upstream-bound);
  - card scripts run per message per pass;
  - the plugin permission UX re-prompts endlessly.
  - The study should map these against library growth (`project-storage-futureproofing`, `project-real-save-sizes-2026-10-13` memories).
## Update log
- 2026-10-23: created. Phone 1 part 3 is running. Rows 2-4 wait on it.
- 2026-10-23: lane E has written its resume point (uncommitted in Lane-E; next free MC-465, CHORE-355, row 3580).
- 2026-10-23: lane B has written its handoff (uncommitted in Lane-B). The lane D, E and B records-only commits all need the maintainer's OK before batch 4.
- 2026-10-23: the maintainer approved "Commit all three now (Recommended)". Each lane commits only its own records file on its branch, without pushing. Lane B's commit sits on top of `77990fcb2`, so row 2 merges lane B's NEW tip. Lane D and E tips merge with batch 4. Add this answer to MC-348. The tip hashes are below once the lanes report them.
- 2026-10-23: lane E records tip `53eb983cc` (parent `7cc62f54d`, only lane-E-records.md, +2 lines, not pushed).
- 2026-10-23: lane D records tip `e295d27ae` (parent `f986f9abf`, only lane-D-records.md: MC-389, rows 2583-2586, CHORE-241 update, resume point; not pushed).
- 2026-10-23: lane B records tip `cc1a3da48` (parent `77990fcb2`, only lane-B-records.md, +18 lines, not pushed). In flight row 2 now merges `cc1a3da48`.
- 2026-10-23: CHORE-205 (architecture study, HIGH priority) added to Roadmap, uncommitted. Starts after phone 1 part 3 and the CHORE-225 "after" run.
- 2026-10-23: phone 1 part 3 finished. Report saved at `%TEMP%\risu-b715\phone1-p3\report.md`; its doc-verifier is running. Kept export: `phone1-p3\kept\export-r6.bin` (424,434,396 B, sha256 65279600...4335). Delete it after the verifier finishes.
- 2026-10-23: **census `%TEMP%\risu-b715\census\partial-vs-p3.txt`** (lane A, `-Repo` main `4bc6b0b42`, repo unchanged). The export has 500 ids, all cold (all inline in the fixture). Ids only in either file: 0. Other state differences: 0. Chat-count differences: 0. 771 chats and 164 modules on both sides. 501 units = 500 characters + 1 other JSON. **No data loss after several stage 5a passes.**
- 2026-10-23: **open for `MC-368` 1 / the daily-APK lift.** The automatic pass's gcMarkMs was 8,480 ms (r7b) and 11,809 ms (r7). That fails lane B's A9 re-arm criterion (mark under 1 s); A9 had 250-270 ms. It is probably contention with the idle net's 7-12 s module ticks; that is unverified. The trigger is once per page load (`autoGc.ts`), not "30 s after last input". Ask lane B, then the maintainer, whether this blocks the lift.
- 2026-10-23: part 3 headlines (unverified):
  - Part 1's 358 s is not reproduced by the pollers (r3, 1.03x) or by a select (r4, 0.53x).
  - Cold collect tracks the idle-net ticks: netTickMs is 94-97% of cold collect with 0 residents.
  - Read-ahead 0 is 96% slower, so keep 3.
  - Quiet runs drift: 244-325 s.
  - The CHORE-225 baseline meters are r2b and r6. r1-r4 lost their keys because of a WebView flush race; the fix is `tools\prepare.ps1`.
- 2026-10-23: CHORE-225 A+B merged as `9f8e95722` (tip `cc1a3da48`). One conflict in `lane-B-records.md`, resolved by keeping both appended blocks: lane A's fold-in marker, then lane B's handoff. Full checks are writing to `%TEMP%\risu-b715\records-b225\full.*`. Push when they pass.- 2026-10-23: the part 3 report is verified, with corrections appended (the netTick share is 93.6-94.9%; r2b has 116 passes; r6 ticks run 6.9-15.7 s; the trigger IS the 30 s quiet trigger, once per load; the uid is not in result.json). The census is verified (ids, states and chat counts; not bytes). Kept export deleted. Lane B has the verified path and has been asked: (a) to write the CHORE-225 "after" request (with prepare.ps1); (b) whether gcMarkMs of 8.3-11.8 s blocks the `MC-368` 1 lift, or whether the CHORE-225 fix is expected to clear it. **Next:** lane B's answer, then ask the maintainer about the daily-APK lift.- 2026-10-23: lane B rules that the stage 5a mark of 8.3-11.8 s **blocks** the `MC-368` 1 lift under the pre-registered rule. CHORE-225 is expected (INFERRED) to cut the mark's wall time; the "after" run re-measures it. If it is under 1 s, take the lift to the maintainer; otherwise lane B designs a bounded re-arm or a batch cap with its own Gate 2. Per-launch deletions are expected: edits orphan units.
- 2026-10-23: the "after" request is `%TEMP%\risu-lane-b\device-requests\2026-10-23-chore225-after.md`. The maintainer approved **"Runs 1-4, grid later (Recommended)"**: runs 1-4 on phone 1 once the `9f8e95722` full checks pass; lane E's grid capture is separate, later, and needs a re-import. Record this in MC-348.- 2026-10-23: `9f8e95722` full checks: 21,136 passed, 23 skipped; check 0/0; build OK; checkReleaseDist OK at 244 files. Pushed. Outputs are in `%TEMP%\risu-b715\records-b225\full.*`.
- 2026-10-23: **phone 1 part 4 dispatched** (perf-analyzer): a MEASURE build of `9f8e95722`, in-place, runs 1-4 of the after request; no grid run and no re-import. Report: `%TEMP%\risu-b715\phone1-p4\report.md`, or in the hand-back. **Next:** a doc-verifier checks it. Then: if gcMarkMs is under 1 s and the other criteria pass, ask the maintainer to lift the `MC-368` 1 daily-APK block; otherwise send it to lane B for a re-arm or batch-cap design. Relay the result to lanes B, D and E (D: the S3 re-measure decision; E: the grid capture still needs a re-import session). If the agent stopped on quota: check the phone state and revert prep / remove forward 6270.- 2026-10-23: phone 1 part 4 finished. Report saved at `%TEMP%\risu-b715\phone1-p4\report.md` (unverified; doc-verifier running). Headlines, which still need verifying:
  - **PASS:**
    - modules=true ticks fall from 8.3-9.5 s to 2.3-2.8 s (25-33% of baseline);
    - edit plans 0.5-2.4 s;
    - commit kinds and bytes unchanged (one commit split differs);
    - export CDP timeouts 1% (baseline 51-76%);
    - export cold collect 102.8 s (baseline 244-325 s).
  - **FAIL:** CDP under 150 ms by +20 s after a select. Back-to-back 2.5-3.5 s main-thread tasks continue to about +148 s. The idle net still ticks with modules=true at 0 residents, just cheaper. Which path does not yield is NOT established.
  - **gcMarkMs:** 4 of 6 launches are under 1 s (513-623 ms). r1 took 2,656 ms and the voided r2 1,428 ms. Whether this meets the A9 rule is for lane B and the verifier.
  - The device's end state is clean: prep reverted, no forward, no processes, the export deleted.
  - **Next:** once verified, relay to lane B. Both the gcMark verdict and stage C are lane B's, and stage C (the idle-net module cadence) is the maintainer's decision under `MC-371`. Then take the `MC-368` 1 lift question to the maintainer with lane B's verdict.- 2026-10-23: part 4 verified, with corrections appended. Verdicts:
  - ticks PASS (25-36% of baseline); edit plans PASS;
  - CDP-after-select FAIL; output FAIL-literal (7 vs 6 commits, an extra 3,253 B manifest; unit kinds unchanged);
  - gcMarkMs NOT MET (3 of 5 under 1 s; r1 2,656 ms and r2 1,428 ms; r2 and r2b ended outside the ~60 s window);
  - export cold collect 102.8 s (information only).
  - `block` is Sha256.block from unitDigest (not measurement-only). The verifier found no yields in encodeFront, finishTree or the commit stage. shard:13 is rewritten on every commit; the cause is not traced.
- Relayed to lane B, asking for: (a) its mark verdict and next step (bounded re-arm or batch cap); (b) the CHORE-225 stage C proposal (idle-net module cadence; the maintainer's decision under `MC-371`) plus a yield-gap measurement. **Next:** take (a) and (b) to the maintainer.
- Note: part 4's build result.json lists 5 lingering java.exe and conhost.exe processes (Gradle daemons from the scratch build). Leave them unless they are confirmed to be this session's; never kill by image name.- 2026-10-23: lane B's verdicts and proposal: `%TEMP%\risu-lane-b\c225\stageC-proposal.md` (lane B row 2432).
  - (a) The mark lift stays blocked. A failed mark means incomplete clean-up, not data loss (INFERRED).
  - (b) Stage C options C1 to C4.
  - The extra commit count is INFERRED to be stage B's accepted yield timing.
- 2026-10-23: **the maintainer's answers. Record them in MC-348; lane B records its own MC.**
  - "C2: at most every 30 s (Recommended)": idle-net module scope at most once per 30 s.
  - Follow-ups, all four approved: "Yield-gap measurement", "B2 extra yields", "CHORE-226 shard rewrite", "Idle net paused during clean-up".
  - B2 applies only if the gaps prove long. CHORE-226 is sizing only. The GC idle-net hold comes after stage C is measured.
  - Suggested order, sent to lane B: C2 with the yield-gap meter → CHORE-226 sizing → B2 → the GC hold.
  - **Next for lane A:**
    - Merge each lane B commit on the maintainer's approval, with full checks.
    - Then a phone run on the same profile with prepare.ps1, measuring ticks, CDP after a select, gcMarkMs and the yield gaps.
    - Later, lane E's grid capture with a re-import.
- 2026-10-23: **workflow fix: subagent scratch-report writes.** The maintainer reported coders being refused report writes and pasting the text into the hand-back instead.
  - The write guard is not the cause. A simulated perf-analyzer Write under %TEMP%\risu-b715\... returns exit 0.
  - `.claude/scripts/subagent-identity.ps1` (uncommitted) now tells writer and scratch roles that %TEMP% scratch outside any repository needs no registration, and to hand back the path. Hook tested for perf-analyzer and code-searcher; validate-workflow.ps1 passes.
  - Cause 2 is Claude Code's permission prompt for writes outside the project folder. Per the docs (via claude-code-guide, not yet tried live), the fix is an `Edit(//c/Users/yor42/AppData/Local/Temp/<root>/**)` allow rule in the gitignored `.claude/settings.local.json`. Edit rules also cover Write. The maintainer chose the risu-* scope: `.claude/settings.local.json` (gitignored, local to this PC) allows `Edit(//c/Users/yor42/AppData/Local/Temp/risu-*/**)`. A live test passed: a fresh background perf-analyzer wrote `%TEMP%\risu-b715\permtest\ok.md` with the Write tool. **On the new account:** the file is per PC, not per account, so it carries over. Re-add it if the session runs from another checkout. Keep lane scratch under `%TEMP%\risu-*`.
  - Hook change committed and pushed as `b288851f1`.
- 2026-10-23: **stage C merged locally and CHORE-226 sized.** The maintainer: "stage C and CHORE-226 sizing is done - let's merge it and handoff." Lane B `7eb3d7223` (Gate 1 [APPROVE] row 2433; Gate 2 [REJECT] then [EDITORIAL] rows 2434-2435; lane B checks 21,083 passed, row 2436) merged as `3882db23e`. Full checks passed (21,163) and it is pushed. The CHORE-226 row 2437 is uncommitted in Lane-B (In flight row 3).
- 2026-10-23 (new account, session `session_016PhPnHGY8egqxdh7wyhEdH`): the maintainer's answers, for MC-348: "Run it with add-on (Recommended)" (stage C phone run plus a CHORE-226 field-names-only shard diff in run 4); CHORE-226 "Decide after the diff (Recommended)"; lane B records "Dedupe + commit (Recommended)".
  - Lane B records committed by lane A as `2f30c1362` on `worktree-Lane-B` (row 2437, deduped handoff bullets; not pushed). Merge it with batch 4.
  - Phone 1 part 5 dispatched (perf-analyzer): brief `%TEMP%\risu-b715\phone1-p5\brief.md`, report `phone1-p5\report.md`. **Next:** doc-verifier on the report; relay to lane B (B2, GC hold, `MC-368` 1); take the CHORE-226 diff to the maintainer for the A-E choice. If the agent stopped on quota: check the phone, revert prep keys, remove forwards in 6270-6309.
- 2026-10-23: **lane organization (maintainer):** lanes C, D and E are retired for now, and lane B is recreated only when it is needed. Lane A hands the maintainer an initiation prompt and brief for each new session. For MC-348.
- 2026-10-23: **CHORE-205 stage (a) started** at the maintainer's request ("let's run chore-205 investigation now"). Six read-only investigators, S1-S6 (save planning, residency, export/import, grid/assets, chat display, plugin permissions). Shared brief: `%TEMP%\risu-b715\c205\brief.md`; reports go to `c205\S<n>\report.md`. **Next:** one doc-verifier per report (or one per pair); give S1 the part 5 numbers as an addendum; then (b) senior-advisor challenges, with a separate one for the in-memory model; then (c) a decision memo. Update the CHORE-205 status in the Roadmap with batch 4.
- 2026-10-23: all six CHORE-205 reports are in `c205\S<n>\report.md` (saved by lane A from the hand-backs). S1, S2, S4, S5 and S6 are verified, with corrections appended; S3's verifier is running. **Cause of the refused writes:** Claude Code refuses a subagent Write of a .md whose name starts with report/summary/findings/analysis (anthropics/claude-code#44657). The maintainer chose "Rename + text fallback": the identity hook now says to use `result.md` (committed and pushed as `9319256d4`). New briefs name `result.md`. For MC-348.
- 2026-10-23: **the maintainer answered S2's open question 3:** "No, I don't have V2.1 plugins. plus, V2.1 was actively retired from community when upstream maintainer showed that there is security concern." So the V2.1 load-all and the disabled put-back do not apply to their library. Both advisors were told. For MC-348.
- 2026-10-23: **CHORE-205 stages (b) and (c) done.** Advisor verdicts are in `c205\advisor-whole-result.md` (FINAL) and `c205\advisor-memory-result.md`. The decision memo is `c205\decision-memo.md`; it is verified (35 of about 40 claims CONFIRMED, 0 REFUTED) and the corrections are appended. Only memo question 6 blocks: start stage 0 (measurement only) now, and on which device. **Next:** the maintainer's answers go into MC-348; update the CHORE-205 status in the Roadmap with batch 4.
- 2026-10-23: **the maintainer approved stage 0: "Now, PC + one Note 9 run (Recommended)".** For MC-348.
  - (c) The module-writer trace (investigator) and (d) the PC heap snapshots (perf-analyzer, scratch build of `9319256d4`, ports 6420-6439) are running. Outputs go to `c205\stage0\c-writers-result.md` and `c205\stage0\d-heap-result.md`.
  - (a) The tick split and (b) the net-found counter are lane B's (save loop). Brief: `%TEMP%\risu-lane-b\c205-stage0\brief.md`. The initiation prompt was handed to the maintainer, who creates the new lane B session.
  - Afterwards: merge lane B's change with full checks, then one phone 1 session per lane B's device request, plus the grid re-import capture and the chat-select recapture. This waits until part 5 has freed phone 1.
- 2026-10-23: stage 0 (c), the module-writer trace, is verified, with corrections appended: no missed writer was found. Both residual gaps need a V2.1 plugin that does not clean up after itself.
- 2026-10-23: **the maintainer retires V2.1 plugin execution.** Asked "what if we retire V2.1 entirely?", they chose "Retire 2.1 execution, keep data (Recommended)" and "Size now, implement post-MVP (Recommended)".
  - Upstream's text (`upstream/main:src/ts/plugins/migrationGuide.md:10`) says 2.1 "will still be supported for a long time", recommends 3.0, and says 2.1 "might show security warnings".
  - This amends `MC-175` for 2.1 only. Write it as its own lane A MC in batch 4, with "Notes, not the maintainer's words" covering the round-trip guarantee: data is kept byte-for-byte, including the `enabled` flag. Versions 1, 2 and 3.0 are unchanged.
  - File a CHORE (lane A next free: CHORE-206).
  - Sizing (investigator) is running; output goes to `%TEMP%\risu-b715\v21-retire\sizing-result.md`. Next: a doc-verifier checks it.
- 2026-10-23: the new lane B session is running, listed in ListAgents as `Lane B [03652e]` (interactive). It works from `%TEMP%\risu-lane-b\c205-stage0\brief.md`.
- 2026-10-23 ~15:47: **part 5's first agent died silently** during the cargo build (around 15:10) with no hand-back. The phone was not touched and no forwards were left. The brief was updated (output `result.md`; HEAD `9319256d4` is expected), and the run was restarted with a new perf-analyzer that writes `phone1-p5\progress.md` as it goes.
- 2026-10-23: **V2.1 retirement sizing verified** (`%TEMP%\risu-b715\v21-retire\sizing-result.md`, corrections appended).
  - V1 and V2 already never run, and new 2.1 imports are already refused.
  - Remaining work: about 12-14 source files edited and 4 deleted; roughly -900 source lines and -3,000 test lines; 7 locale files.
  - Stages 1 and 2 must land together, and must also drop the loadPlugins restore-all and switch-off block.
  - Keep the pluginV2 handler-set cleanup, because V3 relies on it.
  - Add a test for updating a 2.1 plugin to 3.0, which carries `enabled` over.
  - Implementation is post-MVP. File the CHORE in batch 4 and record the open UI questions for the maintainer: boot notice, toggle, localized refusal text, and the dead PluginAlertModal.
