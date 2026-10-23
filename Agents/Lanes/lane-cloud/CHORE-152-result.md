# CHORE-152 result: `assetPieceSave.test.ts` slowness, fixed in the Tauri chunk fake

**Status:** proposed FIXED on `lane-cloud` (test-only, `MC-702` 1); technically accepted at Gate 2 `[APPROVE]` (ledger row 5006). Commit `f697c20` (with the records file). Short entry: [CHORE-152 in lane-cloud-records.md](../lane-cloud-records.md).

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-152 — Slow and flaky test: `src/ts/storage/tests/assetPieceSave.test.ts`" (status 2026-10-09, open, type tests, related to CHORE-144). The entry reports that one full `pnpm test` run on the upstream-merge snapshot timed the reproducer "a plain-HTTP page gets the content-hash key, the same key crypto.subtle gives" out at 5,000 ms, that all 23 tests pass alone in about 61 s, and "Cause not investigated."

## Environment

Linux container, 4 CPUs, loaded by other lanes (load average 3.3 to 5.8). Node 24.22.1 for the investigation timings; the lane's test runs for the change were on the container's Node (22.22.0 per the records file; the Gate 2 run used the system Node 22.22.0 through `npx`, per the orchestrator's record; `c152/g2/result.md` does not state it). Base `9a6127354`. All timings are loaded and indicative only; they are not evidence for the Note 9 or Pi targets. Scratchpad paths are in the session scratchpad (`/tmp/claude-0/-home-user-RisuTanium/fdce1fd0-b592-51b6-b636-a27a87425761/scratchpad/`), not in the repository.

## Findings

(From the investigator packet `c144/result.md` and its verification `c144/verify/result.md`; the verification file in the scratchpad is a one-line pointer, with its table summarised in ledger row 5003.)

1. **Where the time goes. RUN (CPU profile).** Alone, 3 runs: 23/23 passed, 36.25 s, 37.47 s, 36.43 s. Profile of the worker (wall 38.9 s, user 30 s, sys 8.7 s): `writeChunk` in `src/ts/storage/tests/tauriChunkFake.ts` 24.4 s self time (about 63%); GC 3.1 s; `src/ts/assetHash.ts` `block` (real SHA hashing) 2.0 s; test `randomBytes0` 0.8 s; `bytesToBase64` 0.5 s; `atob` 0.2 s. Module reload (`loadWorld`, 23 calls) was 4.1 s and byte generation 0.85 s, so not the main cost.
2. **Cause. CONFIRMED by mutation.** `Uint8Array.from(atob(data), (char) => char.charCodeAt(0))` runs a JS callback per character over every chunk of about 1 MiB (about 17 MiB per large test, three transports). The same idiom appears at a second site (packet said line 317; verifier: 315).
3. **Mutation result. RUN, verified by the verifier's own mutant.** Replacing the idiom with an index loop (keeping `atob`): 23/23, 12.78 s, 12.05 s, 12.39 s against 36.88 s for the unmutated scratch copy run right after. The verifier's own mutant: 11.6 s and 11.3 s against a control at 35.7 s, 23/23 both. About three times faster, same assertions.
4. **`atob` is kept deliberately.** `Buffer.from(data, 'base64')` is lenient and was not used. Verifier correction: `atob` also tolerates missing padding (`"QQ"` is accepted), and it rejects invalid characters and bad lengths that `Buffer` accepts (`"AB*D"` gives 2 bytes, `"AAAAA"` gives 3, `"QQ="` gives 1 in `Buffer`). The behaviour before and after is the same.
5. **Remaining cost, not changed.** `writeChunk` grows the temp file by allocating `held+bytes` per chunk (about 150 MB of copying for 17 chunks per the packet). Opinion: leave it unless still too slow.
6. **The flaky part** was already addressed by CHORE-193 step 2 (lane E, `4cf1cce22`: `vi.setConfig({ testTimeout: 30_000 })` in the file). That 30 s bound stays; with the fix single tests are about 0.2 to 1.3 s, so lowering it is a judgement call, not made here.
7. **Intrinsic cost.** The 17 MiB `LARGE` size ("LARGE = 17 * MIB + 12345") and real SHA hashing cost at most about 3 s and are what the file tests.

## What changed and evidence

Commit `f697c20`: `src/ts/storage/tests/tauriChunkFake.ts` (the records file travels in the same commit). The test file is 19 lines changed, +17 / -2 (`git show --stat`: 19 lines changed in that file): a documented local `decodeBase64(data: string): Uint8Array` helper (`atob`, then `new Uint8Array(binary.length)` and an index loop with `charCodeAt`) used at both chunk-write sites. LF line endings, file is ASCII, no line numbers in comments.

Evidence:

- **Equivalence (compatibility guard; there is no behavioural defect to reproduce).** Script `c152/equiv.mjs`: 2003 valid inputs (empty, all 256 bytes, random, 1 MiB) with 0 mismatches between the old idiom, the new helper and the original bytes; 13 edge or invalid strings give the same throw or result before and after. Gate 2 re-ran it with the same result. Reasoning (Gate 2): `atob` returns Latin-1 so `charCodeAt` is at most 255 and the typed-array store equals `Uint8Array.from`; a throw happens in `atob`, before the chunk-size push and before `writeFault`, the same position as before.
- **All test files that reach the fake: 31 files, 964/964 tests passed** (`c152/result.md`, implementer; `c152/g2/result.md` reviewer, about 37 s). Count of 31: grep union, identical to `c152/files.txt`, 3 non-test files being the fakes themselves, chain wire to desktop to chunk covered.
- **`assetPieceSave.test.ts` alone: 23/23 in about 10.7 s (Gate 2 log) and 10.17 s (commit-claim verifier spot run, per ledger row 5007), against 35.7 s before** (verification control). The implementer's own figures of about 10 s were not logged.
- **Mutant (implementer, scratch copy): a lenient `Buffer` decoder in the fake was noticed by no repository test** (31 files pass, 964 tests; `gcPass` needed `server/` copied, 103/103).
- **`pnpm check`: 0 errors, 0 warnings** with a heap of 8192 MiB (`c152/check.log`). The implementer reported a heap out-of-memory abort at the default limit; that log was not kept (implementer's report only).
- **Gate 2 `[APPROVE]`**, comment finding is a nit only.

## What was not done / residuals

- Gap, not fixed: no repository test notices if the fake's decoder is swapped for a lenient one (the implementer's scratch mutant). A test for this is out of scope for this ticket.
- The quadratic temp-file growth in `writeChunk` is unchanged. The 30 s per-test bound is unchanged.
- The Roadmap's original observation (a full-suite run timing out at 5,000 ms on a different snapshot) was not reproduced; this report does not claim the fix removes that flake, only that the file's runtime fell. UNCERTAIN.
- The 29-files figure in `MC-702` 1 is superseded by 31 (see corrections).
- Full `pnpm test` was not re-run for this change by this report. Overlap risk: lane B owns the storage tests and may edit the same fake (`MC-702` 1).
- The commit-claim verification file `c152/cv/result.md` exists in the session scratchpad, saved by the orchestrator from the doc-verifier's returned message (the agent returned it as a message only); it is a summary in substance. Its corrections are listed below.

## Decisions

`MC-702` 1 ("Fix here, test-only (Recommended)"), `MC-704` (commit after Gate 2 without asking again), related `MC-091`, `MC-703`. Full text: [lane-cloud-records.md](../lane-cloud-records.md); ledger rows 5002 to 5007.

## Corrections from doc-verifier

This section takes precedence over the body above. Seeded from the packet verification (`c144/verify/result.md`, ledger row 5003) and the commit-claim verification (session scratchpad `c152/cv/result.md`; ledger row 5007).

From the packet verification:

1. The fake is reached by 23 files through `tauriDesktopFake.ts` plus 6 through `tauriWireFake.ts` (29), not "about 10". Gate 2 then found 31 files by a grep union (it did not reproduce 29). The final figure is 31 files; `MC-702` 1's wording "29 storage test files" is the earlier count and is superseded by 31. This report uses 31.
2. `atob` tolerates missing padding but rejects invalid characters and lengths that `Buffer.from(..., 'base64')` accepts. (Applied in finding 4.)
3. The second site is at line 315, not 317. (Applied in finding 2.)

From the commit-claim verification (ledger row 5007; 16 claims, 12 VERIFIED, spot run `assetPieceSave` alone 23/23 in 10.17 s):

4. The commit message no longer claims a CHORE-144 entry (that was committed in `8224c8b`).
5. Timings cite logged runs only. (Applied.)
6. The heap out-of-memory note is marked as the implementer's report with no kept log. (Applied.)
7. WRONG (1 of 16): the commit message said "Records: CHORE-152 and CHORE-144 entries"; the CHORE-144 entry was already in `8224c8b`. Corrected to "the CHORE-152 entry" before the commit (same as correction 4).
8. INCOMPLETE (1): the records wording "about 10 s (twice) and 10.7 s" has only Gate 2's 10.73 s logged. Corrected to cite logged timings only (same as correction 5).
9. UNVERIFIABLE: the heap out-of-memory note (no log; marked as the implementer's report) and the token figures. One further claim was counted as unlogged by the verifier and is not itemised in the saved file. The verifier's checked set was 12 VERIFIED, 1 WRONG, 1 INCOMPLETE, 1 UNVERIFIABLE group, 1 other unlogged. All required corrections were applied before commit `f697c20`.
