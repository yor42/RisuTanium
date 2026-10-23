# Lane Cloud records: test reliability, suspected-bug checks, small fixes

Lane Cloud's records, kept on branch `lane-cloud` and folded into the shared files by lane A at merge ([README.md](README.md), "Records"). Approved by the maintainer on 2026-10-23 ("let's tackle 1~3 in series"). IDs: MC-700 to MC-749, CHORE-500 to CHORE-549, ledger rows 5000 to 5499, as reserved in the maintainer's lane Cloud brief of 2026-10-23 (the session's opening message). `Agents/Lanes/README.md` has no Cloud row yet; lane A adds it at fold-in. Scratch: the cloud session's scratchpad (outside the repository). The checkout is a Linux cloud container (`/home/user/RisuTanium`, shallow clone of `origin/main` at `9a6127354`), not a Windows worktree.

Phases, in series, with a hand-back between them: (1) test reliability, CHORE-67, CHORE-144, CHORE-152, CHORE-142; (2) the suspected-bug batches CHORE-09 to CHORE-16, verdicts and reproducers only; (3) small fixes, CHORE-138, CHORE-139, CHORE-143, CHORE-133, then any Phase 2 bug the maintainer picks.

## Environment notes

- **Write guard (step 0, 2026-10-23).** The container has no `pwsh` or `powershell`. A scratch Write outside the repository succeeded, so the two project hooks (`SubagentStart` identity and the `Write|Edit` guard) fail to start and do not block (`docs/workflow/ownership.md`: "Hook startup failures ... can proceed through normal permissions"). Route taken: `.claude/settings.json` is left unchanged and pwsh is not installed; the guard's rules are followed by hand: one application-code writer at a time; writes to named files only; subagent outputs named `result.md` or `<id>-result.md` in the session scratchpad.
- **Runtime.** Node 22.22.0, pnpm 10.34.1 (`pnpm install --frozen-lockfile`), 4 CPUs, Linux. Lane A's runs are on Windows; timings here are not evidence for the Note 9 or Pi targets.

## For lane A: store2 test failures in this container (not fixed here; lane B's area)

Baseline full `pnpm test` on unmodified `9a6127354` (Linux, Node 22.22.0, 4 CPUs, 2026-10-23; log in the session scratchpad `base/test.txt`): 937 files passed, 2 failed, 1 skipped; 21,146 tests passed, 10 failed, 30 skipped; 1,681 s. Lane A's Windows full run on the stage C merge `3882db23e` passed (21,163 passed, 23 skipped; `Agents/Handoff-2026-10-23-laneA.md`, In flight row 1). `9a6127354` adds two commits on top of that merge, touching only `.claude/scripts/subagent-identity.ps1` and `Agents/Handoff-2026-10-23-laneA.md` (`git diff --stat 3882db2 9a61273`). The tested source is therefore the same, and the failures here are environment-sensitive (Linux, 4 CPUs; which factor is not established).

- **`src/ts/storage/tests/store2/saveLoop.test.ts`, "a commit with flushed:false does not count as saved and does not fire the callbacks":** `AssertionError: expected 1 to be +0` on `expect(loop.state.saved).toBe(0)`. It is not a timeout. The file run alone failed in 2 of 3 runs, then 4 of 4 (Node 22.22.0), and 1 of 4 under Node 24.22.1, so it is not Node-version specific. Not traced. Two readings are possible, and nothing here tells them apart: a test race (after the two scripted `flushed:false` attempts, an unscripted third attempt commits normally before the assertion runs, the same pattern lane E found in another `saveLoop` test, row 3500), or a loop that counts a `flushed:false` commit as saved. The second would be a persistence defect, so lane A (or lane B) should trace it.
- **`src/ts/storage/tests/store2/replay/actors.test.ts`:** 9 of 71 fail alone as well (8 m 37 s alone): six "two recovering actors over ..." cases and the two "a Tauri restart is a new page" cases time out at 5 s, and "'tauri': every operation under injected faults > no violation, no stall, no throw" times out at 240 s. The log `base/actors-alone.txt` has no assertion error. Vitest prints one shared "Test timed out in 5000ms" for the six grouped "two recovering actors" cases, and one timeout error each for the other three. The cause is not traced; CPU speed is the likely factor (INFERRED).

## MC entries

### MC-700 — Lane Cloud, 2026-10-23: commit the completed Phase 1 items

- **Tag:** decision (chat message, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript, after the orchestrator reported CHORE-142 technically accepted (Gate 2 `[APPROVE]`, row 5001) and declined the stop hook's request to commit without the maintainer's approval.
- **Related:** the lane Cloud brief (commit only named paths, after the maintainer approves each commit; push `lane-cloud` only); CHORE-142.

1. **"you can commit the completed items"**

**What was decided:** the completed items may be committed on `lane-cloud`. At the time of the message, that was CHORE-142 (`Agents/Tools/save-gen/generate-and-verify.harness.ts`) and this records file, which records it.

**Notes, not the maintainer's words:** CHORE-67, CHORE-144 and CHORE-152 were still under investigation or verification. They were not complete and are not covered. Pushing `lane-cloud` follows the brief's "push lane-cloud only" (never `main`, never force).

### MC-701 — Lane Cloud, 2026-10-23: when the stop hook asks for a commit, ask the maintainer

- **Tag:** rule (chat message, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript, sent while the MC-700 commit was being prepared, after the session's stop hook (`~/.claude/stop-hook-git-check.sh`) had asked three times to commit and push uncommitted changes and the orchestrator had declined each time without asking.
- **Related:** `MC-700`; the lane Cloud brief (commit only after the maintainer approves each commit).

1. **"rule clarification: when hook asks you to commit, you can use the ask tool for me to confirm."**

**What was decided:** when the stop hook asks for a commit, the orchestrator asks the maintainer with `AskUserQuestion` rather than declining silently or committing. The hook itself is still not approval.

## CHORE entries (proposed status changes)

### CHORE-142 — `Agents/Tools/save-gen/generate-and-verify.harness.ts` is broken

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud`; technically accepted (Gate 2 `[APPROVE]`, row 5001); uncommitted until the maintainer approves the commit.** Type: tooling; no application code. The entry's path was wrong: the file is under `Agents/Tools/save-gen/`.

- **Failure (reproduced 2026-10-23, `9a6127354`):** `npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/generate-and-verify.harness.ts` exited 1 with `[vitest] No "readImage" export is defined on the "src/ts/globalApi.svelte" mock`, thrown at module load in `src/ts/media/avatarThumb.ts`, reached from `src/ts/characters.ts`; 4 tests skipped.
- **Cause:** the harness's module mocks were copied from `src/ts/storage/tests/risuSave.test.ts` and had gone stale. That test now also mocks `src/ts/storage/store/appStore` (through `appStoreModuleOver` in `src/ts/storage/tests/appStoreMock`), which keeps the real application graph from loading.
- **Change (harness file only, +15/-5):** the same `appStore` mock; `store` declared through `vi.hoisted`; the header and region comments updated (the stale "copied verbatim ... lines ~7-55" is gone). No assertion changed. `appStore` is not on the verified path: `risuSave.ts` calls `getAppStore` only in its remote-sync branch (orchestrator check).
- **Evidence:** after the fix the same command exits 0 with 4 of 4 passed (implementer 3 runs, orchestrator 1, reviewer 1). The reviewer's scratch mutant (a decoder wrapper that drops one character) failed all 4 tests ("expected 30 to be 31"). `pnpm test`'s default glob does not match `*.harness.ts`. `Agents/Tools` is outside `tsconfig.json`'s include, so `pnpm check` does not cover it.

## Ledger rows

| # | Date | Question | Tier(s) | Tokens | Escalated? | Outcome |
|---|---|---|---|---|---|---|
| 5000 | 2026-10-23 | CHORE-142: make the harness run again, editing only `Agents/Tools/save-gen/generate-and-verify.harness.ts` (scratchpad `c142/result.md`) | test-warrior | 32,460 (subagent usage) | no | Pre-fix failure reproduced (the `readImage` mock error); the `appStore` mock, mirroring `risuSave.test.ts`, plus `vi.hoisted` for `store`; 4 of 4 pass in 3 runs; no assertion changed. |
| 5001 | 2026-10-23 | CHORE-142 Gate 2 (scratchpad `c142/g2/result.md`) | adversarial-reviewer | 29,539 (subagent usage) | no | `[APPROVE]`. `appStore` is not on the verified path (the remote-sync branch only; the orchestrator rechecked this in `risuSave.ts`); the scratch decoder mutant fails 4 of 4; comments accurate; rerun 4 of 4 passed. Did not run `pnpm check` (`Agents/Tools` is outside its scope). |
| 5002 | 2026-10-23 | CHORE-144 (four fragilities) and CHORE-152 (`assetPieceSave` slowness): status on current main, causes, test-only fix proposals (scratchpad `c144/result.md`) | investigator | 103,229 (subagent usage) | no | Verified with corrections in row 5003. CHORE-152: about 63% of the file's CPU self time is in the per-character callback `Uint8Array.from(atob(data), cb)` in `src/ts/storage/tests/tauriChunkFake.ts` (two sites); a scratch index loop kept `atob` and took the file from about 37 s to about 12 s, 23 of 23 passing (loaded machine). CHORE-144: item 2 (`backuplocalEncryptedRefusal` under shuffle) passed with 42 seeds; items 1 ((G) byte for byte) and 3 (`nodeHttpStore` ENOBUFS) did not reproduce and stay UNCERTAIN, needing the failing message or stack; item 4 (msgpackr 1.10.1 `utf8Write` throws on Node 24.22.1 for strings of 64 or more characters, not on 22.22.0) is test-environment only, and three tests already clamp it. No repository edits. |
| 5003 | 2026-10-23 | Independent check of row 5002 (scratchpad `c144/verify/result.md`) | doc-verifier | 41,287 (subagent usage) | no | Decision-critical claims VERIFIED by execution: own mutant 23 of 23 in 11.6 s and 11.3 s against a control at 35.7 s; 10 more shuffle seeds passed; the msgpackr throw reruns on Node 24.22.1 and not on 22.22.0. Corrections: the fake reaches 23 files through `tauriDesktopFake.ts` plus 6 through `tauriWireFake.ts` (not "about 10"); `nodeServerFixture` has 17 test users (not 20); `atob` tolerates missing padding but rejects bad characters and lengths that `Buffer.from(..., 'base64')` accepts; the second site is at line 315, not 317. Items 1 and 3 UNVERIFIABLE (no failing evidence exists). |
| 5004 | 2026-10-23 | Check the CHORE-142 commit message and this records file before the MC-700 commit (scratchpad `c142/cv/result.md`) | doc-verifier | 39,716 (subagent usage) | no | About 22 claims; the rest VERIFIED; harness rerun 4 of 4. Applied: lane A's 21,163 now names merge `3882db23e` (and `9a6127354` differs from it only in records and one workflow script); the actors wording now describes the grouped timeout errors; the ID ranges cite the brief. Rejected: the finding that the trailer must name a different model (the trailer is the session's prescribed attribution). UNVERIFIABLE: the uncaptured `saveLoop` alone runs, token figures, the MC-700 quote. |

## Handoff

Phase 1 in progress.
