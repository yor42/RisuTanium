# CHORE-144 result: four test-suite fragilities, closed as observed

**Status:** proposed CLOSED as observed, no code change (`MC-702` 2). Records commit `8224c8b` (records file only; no application or test code). No gate beyond the independent verification of the investigator packet (ledger row 5003). Short entry: [CHORE-144 in lane-cloud-records.md](../lane-cloud-records.md).

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-144 — Test-suite fragilities seen during the sidebar closeout" (status 2026-10-08, open, type tests; per the Orchestrator's facts file, investigation `sidebar-s5\final2\flake.md`, which is not in this clone). Four items:

1. `backuplocalCharacterIdsExport` "(G) ... byte for byte" (SavePartialLocalBackup) failed once on the Stage 5 snapshot run; not reproduced.
2. `backuplocalEncryptedRefusal` fails under `--sequence.shuffle`.
3. `nodeHttpStore` failed once with ENOBUFS under load.
4. `msgpackr` 1.10.1 `utf8Write` threw `ERR_BUFFER_OUT_OF_BOUNDS` on Node 24 in a standalone script; "not checked inside vitest or the app".

## Environment

Linux container, 4 CPUs, machine loaded by other lanes (load average 0.6 to 5.8 during the session). Runs on Node 24.22.1 unless marked Node 22 (22.22.0). Snapshot `9a6127354` (shallow clone). Timings are indicative only and are not evidence for the Note 9 or Pi targets. Context only: the full baseline suite on the unmodified base in this container had unrelated store2 failures (saveLoop, actors; session scratchpad `base/test.txt`, `base/actors-alone.txt`); see the "For lane A" section of the records file. They are not part of CHORE-144. Scratchpad paths are in the session scratchpad (`/tmp/claude-0/-home-user-RisuTanium/fdce1fd0-b592-51b6-b636-a27a87425761/scratchpad/`), not in the repository.

## Findings

### Item 1, (G) byte for byte: UNCERTAIN, not reproduced, no mechanism found

- RUN, Node 24.22.1: 3 plain runs; 6 shuffle seeds (1 to 6); 12 seeds (101 to 112) as 3 batches of 4 parallel vitest processes. All 10 tests in the file passed every time. (G) takes 2 ms (Partial) and 19 ms (Local), so the 5 s timeout is not the cause.
- TRACED: the test (`src/ts/drive/tests/backuplocalCharacterIdsExport.test.ts:558-566`) compares the export with `encodeRisuSaveLegacy({...db, account: undefined}, 'compression')`. The encode is deterministic (`fflate.compressSync(..., { mtime: 0 })`, msgpackr `useRecords:false`, `src/ts/storage/risuSave.ts`). The `src/ts/characters` mock only stubs `updateLorebooks`; no random input, `Date` or `setTimeout` in the file (grep).
- Shared state that exists: module-level `backupSink.writes` (cleared in `beforeEach`), `unitMem`, and msgpackr's module-level `target`/`position`. A late write landing after the clear could make the `database.risudat` lookup pick a wrong entry. No un-awaited writer was found. This is reasoning, not observed.
- The assertion `expect(Buffer.equals(...)).toBe(true)` reports only "expected false to be true". The original failure message was not recorded. TODO(evidence): `flake.md` of `sidebar-s5\final2` is not in this clone.
- Observation that would settle it: the failing run's message (null-outcome error against byte mismatch).
- Proposed, not applied (opinion): make the assertion self-diagnosing (compare lengths and first differing index).

### Item 2, `backuplocalEncryptedRefusal` under shuffle: NOT REPRODUCED on current main

- RUN: 42 seeds (1 to 40, 12345, 99999) alone on Node 24, 41/41 passed each. 8 seeds (1 to 8) on Node 22 with `CharacterIdsExport` in one invocation, 51/51 each. The verifier ran 10 more shuffle seeds, all green (`c144/verify`, per ledger row 5003).
- TRACED: `beforeEach`/`afterEach` (test lines 514-576) reset mocks, `forageFiles`, `decodeCapture.inputs`, the stubs, and `overrideBackupWindowBytes(null)`. No leaking pair found.
- Possible that it was fixed since 2026-10-08 (file last touched by `18156c9`, CHORE-129) or failed only with an older seed set; a shallow clone cannot show history. UNCERTAIN as to why it once failed. The failing seed was never recorded; reopen only with a recorded seed.

### Item 3, `nodeHttpStore` ENOBUFS: UNCERTAIN, not reproduced

- RUN: 3 runs alone, 101/101 passed, about 2.1 s each (loaded).
- REFUTED premise "unbounded concurrent connections" for this file: one child server in `beforeAll` and sequential requests (the 12-key test awaits each write in a loop).
- ENOBUFS is an OS errno raised by spawn, bind or socket calls, not by test logic. The syscall-heavy step is `spawn(process.execPath, [server.cjs], ...)` (`src/ts/storage/tests/nodeServerFixture.ts:239`), the `freePort` probe (`:84`) and loopback fetches. Interpretation only (INFERRED): host resource pressure while many fixtures spawn and bind concurrently in a parallel full run. User count of the fixture: 17 test files (verifier correction below).
- Observation that would settle it: the failing stack (spawn error or fetch error with `cause.code`) and resource state at the time.
- Proposed, not applied (opinion): retry the first launch on ENOBUFS/EAGAIN, as the fixture already does for EADDRINUSE; test-fixture only.

### Item 4, msgpackr 1.10.1 `utf8Write` on Node 24.22.1: CONFIRMED, test environment only

- Installed `node_modules/msgpackr` 1.10.1 (`package.json` pins it). `pack.js:30-31` calls `target.utf8Write(string, position, 0xffffffff)`, used for strings of length 64 or more.
- RUN standalone, Node 24.22.1: the first throwing ASCII length is 64; `new Packr({useRecords:false}).encode('a'.repeat(1e6))` throws `ERR_BUFFER_OUT_OF_BOUNDS`; `Buffer.alloc(100).utf8Write('a',0,0xffffffff)` throws. Node 22.22.0: 0 throws in 97 cases. The verifier re-ran the throw on Node 24.22.1 and not on 22.22.0 (ledger row 5003).
- RUN inside vitest (happy-dom, `msgpackr/index-no-eval`, scratch config), Node 24.22.1: throws for length 64, 100 and 5000, fine for 63 or less; Node 22.22.0 fine. This answers the Roadmap's "not checked inside vitest".
- Already known to the suite: three tests clamp `Buffer.prototype.utf8Write` (`src/ts/storage/tests/risuSave.msgpackRelease.test.ts:188-205`, `src/ts/drive/tests/composedRoundTrip.svelte.test.ts:46-70`, `src/ts/drive/tests/exportStubForm.test.ts:978-981`).
- App reach (TRACED, not run in a WebView): the app uses msgpackr in `risuSave.ts`, `src/ts/storage/database.svelte.ts:2369`, `assetList.ts` (comment only) and `translator/presets.ts`, all via `msgpackr/index-no-eval` in browser or webview code. The throwing branch needs `Buffer.prototype.utf8Write`; in a webview the `Buffer` is the feross polyfill (`node_modules/buffer/index.js:852`, a module function, not a prototype method) or absent, so msgpackr takes `TextEncoder.encodeInto`. Nothing under `server/` uses msgpackr. Conclusion: not an application defect in the Tauri, web, Android or Node-server targets; the Agents/Tools save-gen harnesses running under Node would be affected. This is source reasoning.
- UNCERTAIN: which other tests would fail on Node 24.22.1 without a clamp (full suite not run on Node 24); which Node 24.x introduced the throw (only 24.22.1 and 22.22.0 were tried). CI uses `node-version: 24` (`.github/workflows/ci.yml:45,78,134`).
- Proposed, not applied (opinion): centralise the clamp in a shared setup. Upgrading msgpackr is a maintainer dependency decision.

## What changed and evidence

No code or test change. The records commit `8224c8b` added the MC-702 and MC-703 entries and the CHORE-144 entry to `Agents/Lanes/lane-cloud-records.md` (32 insertions); ledger rows 5002 and 5003 were committed earlier, in `dc82aff`. Evidence is the investigator packet (`c144/result.md`, ledger row 5002, 103,229 tokens per the records file) and its verification (`c144/verify/result.md`, row 5003).

## What was not done / residuals

- Items 1 and 3 stay UNCERTAIN and open for reopening with evidence: the failing message or stack. Item 2 reopens with a recorded seed. The CHORE-144 hardening proposals above were not applied.
- The full suite was not run on Node 24.
- The Roadmap entry's status was not edited.
- `c144/verify/result.md` in the scratchpad is only a pointer ("See final message (verifier table). Control 35.7s vs mutant 11.6/11.3s, 23/23 both; 10 shuffle seeds green; node24 throws at len 64, node22 none."). The verifier's per-claim table was returned as a message and is summarised in ledger row 5003 of the records file, which is the source used here.

## Decisions

`MC-702` 2 ("Close as observed (Recommended)": no code change; item 2 not reproducible; items 1 and 3 reopen-with-evidence; item 4 known and already worked around), related `MC-703`. Full text: [lane-cloud-records.md](../lane-cloud-records.md); ledger rows 5002 and 5003.

## Corrections from doc-verifier

This section takes precedence over the body above. Seeded from the verification of the investigator packet (session scratchpad `c144/verify/result.md`; the per-claim corrections are as summarised in ledger row 5003).

1. The shared fake `tauriChunkFake.ts` is reached by 23 files through `tauriDesktopFake.ts` plus 6 through `tauriWireFake.ts` (superseded by 31; this belongs to CHORE-152; the packet's "about 10" was wrong).
2. `nodeServerFixture` has 17 test users, not 20 (the packet said "grep count 20"). Applied in item 3.
3. `atob` tolerates missing padding but rejects invalid characters and lengths that `Buffer.from(..., 'base64')` accepts (CHORE-152).
4. The second `Uint8Array.from(atob...)` site is at line 315, not 317 (CHORE-152).
5. Items 1 and 3 are UNVERIFIABLE because no failing evidence exists. Kept as UNCERTAIN.
6. Decision-critical claims VERIFIED by execution: the verifier's own mutant ran 23/23 in 11.6 s and 11.3 s against a control at 35.7 s; 10 more shuffle seeds passed; the msgpackr throw reruns on Node 24.22.1 and not on 22.22.0.
7. Writer's note, not a verifier correction: the MC-702 question text in the records file says item 2 "passed 52 seeds". That is the packet's 42 seeds plus the verifier's 10; the 8 Node 22 seeds are separate. This report states the components, not the 52.
