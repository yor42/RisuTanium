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

### MC-702 — Lane Cloud, 2026-10-23: fix the CHORE-152 test fake here; close CHORE-144 as observed

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript. Input: the investigator packet (row 5002) and its verification (row 5003).
- **Related:** `MC-091` (scope amendment); CHORE-152, CHORE-144, CHORE-193; lane B's brief (storage tests are lane B's area).

1. **CHORE-152.** Question (paraphrased): about 63% of `assetPieceSave`'s time is a per-character callback in the shared test-only fake `src/ts/storage/tests/tauriChunkFake.ts`, which 29 storage test files reach, all in lane B's area. Should it be fixed here? Answer: **"Fix here, test-only (Recommended)"**. The option said: change only `tauriChunkFake.ts` (both sites), keep `atob`, rerun all 29 files that reach it, plus Gate 2. Lane B sees the change at merge, with a possible overlap if lane B edits the fake.
2. **CHORE-144.** Question (paraphrased): item 2 passed 52 seeds; items 1 and 3 never reproduced and their logs are gone; item 4 is test-environment only on Node 24 and already clamped in three tests. What should be done? Answer: **"Close as observed (Recommended)"**. The option said: no code change; record item 2 as not reproducible, items 1 and 3 as reopen-with-evidence, and item 4 as known and already worked around.

**What was decided:** lane Cloud changes `tauriChunkFake.ts` (test-only) for CHORE-152. CHORE-144 closes with no code change.

### MC-703 — Lane Cloud, 2026-10-23: commit the records only; CHORE-152 waits for its Gate 2

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook asked for a commit)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-700`, `MC-701`, `MC-702`; CHORE-144, CHORE-152.

1. Question (paraphrased): the stop hook wants a commit; uncommitted are the records file and the unreviewed CHORE-152 fake edit. What should be committed? Answer: **"Records only (Recommended)"**. The option said: commit and push just `Agents/Lanes/lane-cloud-records.md`; the CHORE-152 edit waits for its Gate 2.

### MC-704 — Lane Cloud, 2026-10-23: commit CHORE-152 after Gate 2 approves, without asking again

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook asked for a commit)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-701`, `MC-702` 1, `MC-703`; CHORE-152.

1. Question (paraphrased): the only uncommitted change is the CHORE-152 edit to `src/ts/storage/tests/tauriChunkFake.ts`, which is in Gate 2. Commit it? Answer: **"Commit after Gate 2 without asking again"**. The option said: if Gate 2 returns `[APPROVE]`, commit and push it without another question.

**Notes, not the maintainer's words:** this covers the CHORE-152 commit only. Any other verdict than `[APPROVE]` goes back to the maintainer.

### MC-705 — Lane Cloud, 2026-10-23: CHORE-67, move the two preservation tests to jsdom

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript. Input: the investigator survey (row 5008) and its verification (row 5009).
- **Related:** `MC-238` 4, `MC-239` 1; CHORE-67.

1. Question (paraphrased): no test relies on a DOMPurify removal under happy-dom, and the earlier `MC-239` fix holds. Two happy-dom tests (`GridCatalog.coldStub.svelte.test.ts`, `parserTarget.svelte.test.ts`) assert that plain text survives sanitizing, which `MC-239` says is not evidence under happy-dom; both pass under jsdom with no app change; an identity sanitizer cannot falsify them, while an empty-output stub does fail them. What should be done? Answer: **"Move the two to jsdom (Recommended)"**. The option said: add `// @vitest-environment jsdom` to those two test files only (test-only); prove an empty-output stub fails the named tests under jsdom; Gate 2; then close CHORE-67. GridCatalog's test is in the UI-list area other lanes use.

### MC-706 — Lane Cloud, 2026-10-23: commit CHORE-67 with the records after Gate 2, without asking again

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook asked for a commit)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-701`, `MC-704`, `MC-705`; CHORE-67.

1. Question (paraphrased): uncommitted are the records file (decided and verified) and the CHORE-67 pragma edits in progress. What should be committed? Answer: **"CHORE-67 after Gate 2, no re-ask (Recommended)"**. The option said: commit the records and the two test files together once Gate 2 returns `[APPROVE]` and the message is checked; ask again only on any other verdict.

## CHORE entries (proposed status changes)

### CHORE-67 — Existing tests that run DOMPurify under happy-dom may pass for the wrong reason

**Proposed status (2026-10-23, lane Cloud): CLOSED (`MC-705`); the two residual tests were moved to jsdom on `lane-cloud`; technically accepted (Gate 2, row 5011).** The Roadmap's "open, not scheduled" status (2026-10-02) was stale: the main fix was made under `MC-238` 4 and `MC-239` (six files moved to jsdom in `76af9bba`, per `MC-239`), and the residual survey below confirms it holds.

- **Survey (rows 5008 and 5009, verified by rerun):** in a scratch run with `dompurify` aliased to a recording stub over the real library, 40 test files call the sanitizer (17 jsdom, 23 happy-dom; "call" means a `sanitize` or factory call, not an import). With an identity stub, 28 tests in 10 files fail, and all 10 files run under jsdom. No happy-dom file depends on a sanitizer removal. Under happy-dom, DOMPurify reported a removal on every call (an observation; the cause is not established).
- **Residual fixed (`MC-705`):** two happy-dom tests read sanitized text. They are `src/lib/Others/GridCatalog.coldStub.svelte.test.ts` ("the list layout still shows the en section when a long text precedes it in the description", `[data-description]` filled through `{@html}`) and `src/ts/parser/tests/parserTarget.svelte.test.ts` ("ParseMarkdown of a message with {{getvar}} reads the selected chat's variable"). Both now carry `// @vitest-environment jsdom`, and the second file's header comment says why. No other line changed.
- **Evidence:**
  - With the real DOMPurify under jsdom, both files pass 26 of 26 (implementer twice, reviewer once).
  - With an empty-output stub under jsdom, exactly the two named tests fail (`expected '' to be 'English description'`, `expected '' to contain 'a-value'`) and 24 pass. An identity stub cannot falsify these preservation tests, and it passes them 26 of 26.
  - Every one of the 26 tests has the same outcome under happy-dom (HEAD copy) and jsdom.
  - `GridCatalog.coldStub`'s only happy-dom-specific code is a `clientWidth` override, which still applies under jsdom (no layout in either). This is from the Gate 2 reviewer's hand-back message, not its result file, and the doc-verifier confirmed it from source (row 5012).
  - `pnpm check` 0/0, with an 8 GiB heap.
- **Not done:** the other 21 happy-dom files that call the sanitizer pass under an empty-output stub, so their assertions do not read sanitized content; they stay on happy-dom. Moving all 23 would fail 6 tests in 3 files (`AlertComp.focusBox`, `charlistAvatarLazy`, `charlistAvatarLookups`; focus and inert differences, not diagnosed). Seven jsdom files that call the sanitizer pass under the identity stub (they assert no removal); that is a test-quality question outside this ticket.

### CHORE-142 — `Agents/Tools/save-gen/generate-and-verify.harness.ts` is broken

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud`; technically accepted (Gate 2 `[APPROVE]`, row 5001); uncommitted until the maintainer approves the commit.** Type: tooling; no application code. The entry's path was wrong: the file is under `Agents/Tools/save-gen/`.

- **Failure (reproduced 2026-10-23, `9a6127354`):** `npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/generate-and-verify.harness.ts` exited 1 with `[vitest] No "readImage" export is defined on the "src/ts/globalApi.svelte" mock`, thrown at module load in `src/ts/media/avatarThumb.ts`, reached from `src/ts/characters.ts`; 4 tests skipped.
- **Cause:** the harness's module mocks were copied from `src/ts/storage/tests/risuSave.test.ts` and had gone stale. That test now also mocks `src/ts/storage/store/appStore` (through `appStoreModuleOver` in `src/ts/storage/tests/appStoreMock`), which keeps the real application graph from loading.
- **Change (harness file only, +15/-5):** the same `appStore` mock; `store` declared through `vi.hoisted`; the header and region comments updated (the stale "copied verbatim ... lines ~7-55" is gone). No assertion changed. `appStore` is not on the verified path: `risuSave.ts` calls `getAppStore` only in its remote-sync branch (orchestrator check).
- **Evidence:** after the fix the same command exits 0 with 4 of 4 passed (implementer 3 runs, orchestrator 1, reviewer 1). The reviewer's scratch mutant (a decoder wrapper that drops one character) failed all 4 tests ("expected 30 to be 31"). `pnpm test`'s default glob does not match `*.harness.ts`. `Agents/Tools` is outside `tsconfig.json`'s include, so `pnpm check` does not cover it.

### CHORE-152 — Slow and flaky test: `src/ts/storage/tests/assetPieceSave.test.ts`

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud` (test-only, `MC-702` 1); technically accepted (Gate 2 `[APPROVE]`, row 5006).** The flaky part was already closed by CHORE-193 step 2 (lane E, `4cf1cce22`: `vi.setConfig({ testTimeout: 30_000 })` in the file), which this change leaves in place.

- **Cause (rows 5002 and 5003, verified by execution):** about 63% of the file's CPU self time was the per-character callback `Uint8Array.from(atob(data), (char) => char.charCodeAt(0))` at the two chunk-write sites of the shared test fake `src/ts/storage/tests/tauriChunkFake.ts`, which runs over each chunk of about 1 MiB. `assetPieceSave` reaches the fake through `tauriDesktopFake.ts`.
- **Change (that file only, +17/-2):** both sites call a local `decodeBase64` helper that keeps `atob` and copies the bytes with an index loop. `atob` stays because it rejects invalid characters and bad lengths that `Buffer.from(data, 'base64')` accepts, so a producer bug still fails in the fake. It tolerates missing padding, as before.
- **Evidence (loaded Linux machine; timings indicative only, not evidence for the Note 9 or Pi targets):**
  - Equivalence script (compatibility guard; there was no behavioural defect to reproduce): 2003 valid inputs decode byte-identically before and after, and 13 edge and invalid inputs give the same throw or result. The throw still happens before the size record and the fault hook.
  - All 31 test files that reach the fake (directly, through `tauriDesktopFake.ts` or through `tauriWireFake.ts`): 31 of 31 files, 964 of 964 tests passed, by the implementer and the reviewer.
  - `assetPieceSave.test.ts` alone: 23 of 23 in 10.7 s (Gate 2 log) and 10.2 s (doc-verifier rerun), against 35.7 s before (verification control, row 5003). The implementer's own figures of about 10 s were not logged.
  - `pnpm check`: 0 errors, 0 warnings, run with `NODE_OPTIONS=--max-old-space-size=8192`. The implementer reported a heap out-of-memory abort at the default limit; that log was not kept.
- **Gap, not fixed (out of scope):** no repository test notices if the fake's decoder is swapped for a lenient one (an implementer's scratch mutant).

### CHORE-144 — Test-suite fragilities seen during the sidebar closeout

**Proposed status (2026-10-23, lane Cloud): CLOSED as observed, no code change (`MC-702` 2).** Evidence: rows 5002 and 5003 (investigator packet `c144/result.md`, verified with corrections in `c144/verify/result.md`, session scratchpad). Runtime: Linux, Node 24.22.1 unless noted, loaded machine.

- **Item 1, `backuplocalCharacterIdsExport` "(G) ... byte for byte": not reproduced; UNCERTAIN.** Every run passed all 10 tests in the file: 3 plain runs, 6 shuffle seeds, and 12 seeds run as 3 batches of 4 parallel processes under load. The test takes about 2 ms, so a timeout is not the cause. No random input was found, and the encode is deterministic (gzip mtime 0). The assertion `expect(Buffer.equals(...)).toBe(true)` prints nothing useful when it fails. Reopen only with the failing run's output.
- **Item 2, `backuplocalEncryptedRefusal` under `--sequence.shuffle`: not reproducible on current main.** It passed 41 of 41 with 42 seeds (1 to 40, 12345, 99999), with 10 more seeds in the verification, and 51 of 51 with 8 seeds on Node 22.22.0 run together with `backuplocalCharacterIdsExport`. The failing seed was never recorded. Reopen with a recorded seed.
- **Item 3, `nodeHttpStore` ENOBUFS: not reproduced; UNCERTAIN.** The file starts one child server in `beforeAll` and sends sequential requests, so the "unbounded connections" premise is refuted. ENOBUFS is an OS error from spawn, bind or socket calls. The shared spawn-and-listen in `src/ts/storage/tests/nodeServerFixture.ts` (17 test users) is a candidate under a parallel full run (INFERRED). Reopen with the failing stack.
- **Item 4, msgpackr 1.10.1 `utf8Write` `ERR_BUFFER_OUT_OF_BOUNDS`: CONFIRMED, test environment only.** On Node 24.22.1, `Packr.encode` throws for any string of 64 or more characters (`pack.js` calls `target.utf8Write(str, pos, 0xffffffff)`), standalone and inside vitest. Node 22.22.0 does not throw. Three tests already clamp `Buffer.prototype.utf8Write` (`risuSave.msgpackRelease.test.ts`, `composedRoundTrip.svelte.test.ts`, `exportStubForm.test.ts`). The app imports only `msgpackr/index-no-eval`, in browser code whose `Buffer` is the feross polyfill, which has no `utf8Write`, so msgpackr takes its `encodeInto` path. That is source reasoning, not run in a WebView. Nothing under `server/` uses msgpackr. Not checked: which other tests would fail on Node 24 without a clamp (CI uses Node 24).

## Ledger rows

| # | Date | Question | Tier(s) | Tokens | Escalated? | Outcome |
|---|---|---|---|---|---|---|
| 5000 | 2026-10-23 | CHORE-142: make the harness run again, editing only `Agents/Tools/save-gen/generate-and-verify.harness.ts` (scratchpad `c142/result.md`) | test-warrior | 32,460 (subagent usage) | no | Pre-fix failure reproduced (the `readImage` mock error); the `appStore` mock, mirroring `risuSave.test.ts`, plus `vi.hoisted` for `store`; 4 of 4 pass in 3 runs; no assertion changed. |
| 5001 | 2026-10-23 | CHORE-142 Gate 2 (scratchpad `c142/g2/result.md`) | adversarial-reviewer | 29,539 (subagent usage) | no | `[APPROVE]`. `appStore` is not on the verified path (the remote-sync branch only; the orchestrator rechecked this in `risuSave.ts`); the scratch decoder mutant fails 4 of 4; comments accurate; rerun 4 of 4 passed. Did not run `pnpm check` (`Agents/Tools` is outside its scope). |
| 5002 | 2026-10-23 | CHORE-144 (four fragilities) and CHORE-152 (`assetPieceSave` slowness): status on current main, causes, test-only fix proposals (scratchpad `c144/result.md`) | investigator | 103,229 (subagent usage) | no | Verified with corrections in row 5003. CHORE-152: about 63% of the file's CPU self time is in the per-character callback `Uint8Array.from(atob(data), cb)` in `src/ts/storage/tests/tauriChunkFake.ts` (two sites); a scratch index loop kept `atob` and took the file from about 37 s to about 12 s, 23 of 23 passing (loaded machine). CHORE-144: item 2 (`backuplocalEncryptedRefusal` under shuffle) passed with 42 seeds; items 1 ((G) byte for byte) and 3 (`nodeHttpStore` ENOBUFS) did not reproduce and stay UNCERTAIN, needing the failing message or stack; item 4 (msgpackr 1.10.1 `utf8Write` throws on Node 24.22.1 for strings of 64 or more characters, not on 22.22.0) is test-environment only, and three tests already clamp it. No repository edits. |
| 5003 | 2026-10-23 | Independent check of row 5002 (scratchpad `c144/verify/result.md`) | doc-verifier | 41,287 (subagent usage) | no | Decision-critical claims VERIFIED by execution: own mutant 23 of 23 in 11.6 s and 11.3 s against a control at 35.7 s; 10 more shuffle seeds passed; the msgpackr throw reruns on Node 24.22.1 and not on 22.22.0. Corrections: the fake reaches 23 files through `tauriDesktopFake.ts` plus 6 through `tauriWireFake.ts` (not "about 10"); `nodeServerFixture` has 17 test users (not 20); `atob` tolerates missing padding but rejects bad characters and lengths that `Buffer.from(..., 'base64')` accepts; the second site is at line 315, not 317. Items 1 and 3 UNVERIFIABLE (no failing evidence exists). |
| 5004 | 2026-10-23 | Check the CHORE-142 commit message and this records file before the MC-700 commit (scratchpad `c142/cv/result.md`) | doc-verifier | 39,716 (subagent usage) | no | About 22 claims; the rest VERIFIED; harness rerun 4 of 4. Applied: lane A's 21,163 now names merge `3882db23e` (and `9a6127354` differs from it only in records and one workflow script); the actors wording now describes the grouped timeout errors; the ID ranges cite the brief. Rejected: the finding that the trailer must name a different model (the trailer is the session's prescribed attribution). UNVERIFIABLE: the uncaptured `saveLoop` alone runs, token figures, the MC-700 quote. |
| 5005 | 2026-10-23 | CHORE-152: fix the slow decode in `src/ts/storage/tests/tauriChunkFake.ts` only, keeping `atob` (scratchpad `c152/result.md`) | test-warrior | 33,058 (subagent usage) | no | `decodeBase64` helper with an index loop at both sites; equivalence 2003 valid and 13 edge inputs, 0 mismatches; a lenient-decoder scratch mutant was noticed by no repository test; 31 of 31 reaching files and 964 of 964 tests passed; `assetPieceSave` alone 23 of 23 in about 10 s; `pnpm check` 0/0 with an 8 GiB heap. |
| 5006 | 2026-10-23 | CHORE-152 Gate 2 (scratchpad `c152/g2/result.md`) | adversarial-reviewer | 25,994 (subagent usage) | no | `[APPROVE]`, no findings. Equivalence by reasoning and by rerun (the `atob` output is Latin-1; the throw position is unchanged); 31 of 31 files and 964 of 964 tests; `assetPieceSave` alone 23 of 23 in about 10.7 s; `pnpm check` 0/0; the file count of 31 rechecked. Nit, no change needed: `atob` also tolerates missing padding. |
| 5007 | 2026-10-23 | Check the CHORE-152 commit message and records before the MC-704 commit (scratchpad `c152/cv/result.md`) | doc-verifier | 35,933 (subagent usage) | no | 16 claims, 12 VERIFIED; spot run `assetPieceSave` alone 23 of 23 in 10.17 s. Applied: the commit message no longer claims a CHORE-144 entry (that was in `8224c8b`); the timings cite logged runs only; the heap out-of-memory note is marked as the implementer's report with no kept log. UNVERIFIABLE: token figures and the provenance of the maintainer's option text. |
| 5008 | 2026-10-23 | CHORE-67: which tests still trust DOMPurify output under happy-dom (scratch recording and identity stubs; scratchpad `c67/result.md`) | investigator | 67,144 (subagent usage) | no | Verified with corrections in row 5009. 40 test files call the real sanitizer (17 jsdom, 23 happy-dom); the identity stub fails 28 tests in 10 files, all jsdom; no happy-dom file depends on a removal. Two happy-dom tests assert that sanitized text survives (`GridCatalog.coldStub.svelte.test.ts`, `parserTarget.svelte.test.ts`); an empty-output stub fails them; under jsdom (scratch copy) they pass 18 of 18 and 8 of 8. Moving all 23 happy-dom files fails 6 tests in 3 files (focus and inert differences, not diagnosed). No repository edits. |
| 5009 | 2026-10-23 | Independent check of row 5008 (scratchpad `c67/verify/result.md`) | doc-verifier | 47,345 (subagent usage) | no | Reruns: the identity stub on the 23 happy-dom files passed 453 of 453; 50 files gave 676 tests with 28 failed in 10 files, all jsdom; the jsdom copy of the two files passed 26 of 26. Both assertions read the sanitized string (`ParseMarkdown`'s return; `[data-description]` filled by `{@html}` from the sanitize path). Corrections: "reach" means a `sanitize` or factory call, not an import; the excluded `actors` and `saveLoop` files do import the parser transitively, but a recording run showed zero sanitizer calls. |
| 5010 | 2026-10-23 | CHORE-67: add the jsdom pragma to the two residual tests only (scratchpad `c67/impl/result.md`) | test-warrior | 32,310 (subagent usage) | no | Two pragma lines; the real DOMPurify under jsdom 26 of 26 twice; the empty-output stub fails exactly the two named tests (24 pass); the identity stub 26 of 26; `pnpm check` 0/0 with an 8 GiB heap. |
| 5011 | 2026-10-23 | CHORE-67 Gate 2, and its editorial closure (scratchpad `c67/g2/result.md`) | adversarial-reviewer | 35,561 + 38,000 (subagent usage, two invocations) | no | `[EDITORIAL]`: behaviour accepted. Reruns: real 26 of 26, empty stub 2 failed and 24 passed; per-test outcomes identical under happy-dom (HEAD copy) and jsdom; `GridCatalog.coldStub`'s `clientWidth` override still applies; `pnpm check` 0/0. Finding: `parserTarget`'s header comment still said it ran under happy-dom. The `clientWidth` point is from the reviewer's hand-back message only. The orchestrator reworded the comment only; its 8 of 8 rerun has no kept log, and the doc-verifier's run after the rewording passed both files, 26 of 26 (row 5012). The same reviewer, resumed, closed it `[APPROVE]` after checking the new claims against the cited files. |
| 5012 | 2026-10-23 | Check the CHORE-67 commit message and records before the MC-706 commit (scratchpad `c67/cv/result.md`) | doc-verifier | 49,542 (subagent usage) | no | 26 claims: 23 VERIFIED, 2 INCOMPLETE, 1 UNVERIFIABLE (token figures). Spot run after the rewording: both files, 26 of 26. Applied: the post-rewording rerun now cites this run; the `clientWidth` claim is attributed to the reviewer's hand-back message and the source reading. |

## Handoff

Phase 1 in progress.
