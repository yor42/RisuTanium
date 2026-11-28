# #301: where the large-character save time goes (post-staging profile)

Date 2026-11-28. Session `claude/301-large-save`, snapshot origin/main `5968b7485`. Report only: no application code changed. Refs #301. Decisions: MC-5010 in `Agents/mc/301.md`. The profile was produced by a native `perf-analyzer` (dispatch 301-perf-1); its full report is the body below, unedited except for the header. Consequential claims have had one source check by this session (commit `ca1e040e8` is an ancestor of the snapshot and `store2/lists/scan.ts`, `blockFrame.ts` exist); the numbers themselves are the analyzer's and have not been re-run by a second party.

**Headline:** the 330/400 ms phone tasks predate `ca1e040e8` ("Stage the save pass and the idle-net verdict of one big character (#301)"). On the current main the save is 2-3 yield-separated tasks; the longest task is a median 43.6 ms on PC (production build, 5 cold reps), an estimated 105-150 ms on the Note 9 (unmeasured), under the 200 ms target. Options for lane A are in the section "Options" at the end.

---

Analyzer status: MEASURED (Node production-mode harness + real Chrome PC run of the production build). Phone not measured.

# #301 large-character save: where the main-thread time goes (post-fix HEAD)

## Summary
- The 330/400 ms phone figures predate `ca1e040e8` (staged save pass and idle-net verdict, MC-4380/4381/4382). Post-fix, there is no single long task from "the save of the whole character". The pass is 2-3 yield-separated tasks and the idle-net verdict repeats the same cost every ~2 s while idle.
- Browser (PC, production minified build, 5 cold reps): longest task median 43.6 ms (range 31.7-51.8) after the edit, 41.3 ms (33.4-52.7) after Undo all. These include UI click tasks (20-52 ms) in the same window; effects and the store write show no long task on PC web.
- Mechanism: every pass and every verdict re-encodes and re-digests the whole marked character. Cost is JS SHA-256 (`Sha256.block`), the inlay-id regex scan (`InlayIdCollector.add`), crc32 and UTF-8/JSON of the largest unit. Only changed bytes are written, but a toggle edit still rewrites the 1.5-2.7 MB core unit.
- Phone figure after the fix is an UNMEASURED estimate of about 115-150 ms per task (see ratio section).
- Caveat: Node timings were taken while other sessions loaded the machine (some runs 1.3-1.7x slower); quiet rerun recommended.

## Setup
- Code: worktree `C:\Projects\RisuAI\.claude\worktrees\301-large-save`, branch `claude/301-large-save`, HEAD `5968b7485869d822060afd84878ac6c5025a5d71`, `git status --short` clean. No repository edits.
- Hardware/software: i9-13900KF 24C/32T, 63.8 GB, Windows 11 10.0.26300, Chrome 158.0.8127.37, Node 24.19.0, vitest 4.1.12, svelte 5.57.3. These are best-case hardware numbers (lower bounds for the phone).
- Node harness: `%TEMP%\risu-301\h\save301.svelte.harness.ts` run with vitest, NODE_ENV=production, config `h\vitest.config.ts`. Real `createSaveEncoder.plan`, `commitRequest().build`, `acknowledge`, `verdictOfYielding`, real `createListDerivation`, `$state` proxy db (and plain db for comparison), 8 ms yield budget. Fixtures built in-harness with `codecFixtures.ts`: `desc` 1.5M-char description, `chat` 1500 messages, `lore` 1500 entries, `many`, `s3d4` (1.5M desc + 12 x 100k greetings + 300 lore x 4000). 7 reps per edit and phase. Output: `out\node-prox.jsonl`, `out\node-plain.jsonl`.
- Browser: production build (minified) served by a Node server on :6311, Chrome launched with `Agents\Tools\chatshell-cdp\launch-chrome.mjs --port 9511`, CDP only, about:blank start, synthetic fixture `fixture\s301-fixture.bin` (s3d4 large synthetic character, imported through the UI). Driver `b\run301.mjs` (edit window E: type '2' in the Mood toggle key and wait 36 s; A: Back to the list; U: Update all; N: Undo all), CDP Tracing, 5 cold reps (`out\trace\r1..r5-{E,A,U,N}.json.gz`), summarised by `b\summ301.mjs`/`analyze301.mjs` (tasks >= 14 ms). CPU profile: debug (unminified, production-mode) build, Profiler interval 200 us, 1 rep usable (p1; p2 stopped).

## Findings and Evidence

### Node (production mode, `$state` proxy db), medians of 7, ms
Plan = encoder.plan wall including yields; slice = longest synchronous stretch between yields; verdict = idle-net re-encode.
| fixture / edit | plan wall | longest slice | verdict wall | verdict longest slice | bytes written |
|---|---|---|---|---|---|
| desc / toggle | 42 | 26 | 39 | 24 | 1.50 MB |
| desc / descKey | 46 | 27 | 41 | 25 | 1.50 MB |
| chat / msgLast | 38 | 20 | 65 | 29 | 23 KB |
| lore / toggle | 52-57 | 34-36 | 52 | 34 | 2.9 KB |
| many / toggle | 44 | 17-18 | 48 | 16 | 0.74 MB |
| s3d4 / toggle | 87 | 38 | 86 | 38 | 2.70 MB |
Undo is within noise of edit. Proxy vs plain db: no meaningful difference (42.35 vs 42.85 ms on desc/toggle). `build` about 0.3 ms, `acknowledge` about 0.03 ms. The in-harness list timer reported 0 for `characterInlays` (wrapper does not intercept the encoder's call), so Node gives no inlay attribution; use the browser profile.

### Browser PC, production build, 5 cold reps
- Post-edit save pass: 2-3 tasks, e.g. [39.8/18.6/43.6] ms, sum 74-121 ms. Longest task median: E 43.6, A 39.8, U 43.1, N 41.3 ms. A verdict cluster of similar size recurs at about 12 s and 14 s after the edit (also 24.5/26.7 s in N).
- Page longtask observer (>= 50 ms), p1 profile run: edit window [51 ms, 101 ms] (the 101 ms entry is the first in-page task after load and edit, not a steady pass; unconfirmed whether it contains the save), A [54], U [51, 50], N [52, 50].
- CPU profile (debug build, p1), self time, ms: E window total busy 1023 ms of 18.6 s (includes load noise): `add` 132 (InlayIdCollector.add), `block` 95 (Sha256), GC 30, TextEncoder `encode` 26, `crc32` 23, plainValue 9, writeValue 7, encodeFrame 6.5, canonicalJson 6. N window busy 686 ms: Sha256 `block` 117, inlay regex `(?=([0-9a-f]{8}-...))` 90, GC 85, `add` 57, `encode` 35, `crc32` 25, `walk` (StudioToggleUses) 15. Interpretation: roughly 60-70 percent of attributed JS self time is inlay scan plus SHA-256; crc32 plus UTF-8 are 15-20 percent. The profile covers several passes and verdicts in each window, so these are aggregates, not per-pass values. "(program)" 640 ms in E is native and idle-adjacent time, not attributable.

### Mechanism
- `characterSteps` (`store2/codec/split.ts`) yields before lore, scripts, assets, inlays and each chat; the budget (`saveYield.ts`, 8 ms) yields only between stages. The core put holds the 1.5M description, so `put` (canonicalJson, UTF-8, `Sha256`, `encodeFrame` with byte-loop crc32) is one indivisible stretch of about 16-40 ms; `lists.characterInlays` (`lists/scan.ts InlayIdCollector.add`: UUID lookahead matchAll, `includes('assets/')`, token regex over every string) is another.
- The verdict (`saveEncoder.ts verdictSteps`, shadows reset at `acknowledge`) re-encodes from scratch, so it costs about the same as the pass. Debounce 500 ms, idle net every 2000 ms.
- Dirty tracking (`dbChangeEffects.svelte.ts`) is not a measured cost: no long tasks from effects on PC web.

## Ranked candidate cuts (gains are estimates unless stated)
1. Memoise the inlay scan by string content in `lists/scan.ts` / `lists/derive.ts` (`characterInlays`). Browser profile shows scan self time about equal to or above SHA-256. Estimated 25-45 percent off the largest synchronous stretch in the browser; Node cannot confirm. Dirty-tracking dependency: none narrowed, the scan output is identical for identical strings. Failure scenario if the memo key is identity or length-based rather than content: a changed string reports stale inlay ids, so the inlay list and referenced-asset set miss an asset and GC deletes a live asset. Require content-exact keys.
2. crc32 slicing-by-8 in `blockFrame.ts` (about 22-25 ms of profile self time across the window). Estimated gain 2-3 ms per pass on a 2.7 MB unit; low risk, byte-for-byte equivalence test against the current table.
3. Seed the verdict shadow at acknowledge so the idle net does not re-digest a just-saved character. Halves steady idle cost. This is a critical contract: the idle net exists to catch edits that were never marked dirty (the partition-never-narrow rule in `dbChangeEffects.svelte.ts`). Failure scenario: a mutation outside any mark between save and verdict returns a false `clean` and the block is silently never saved. Needs `opus-reviewer`; do not ship without a test that mutates an unmarked field after acknowledge and expects `dirty`.
4. Chunked or incremental hashing inside one put (feed `Sha256` in slices with yields) in `codec/reuse.ts` / `assetHash.ts`. Largest effect on the longest slice (the 1.5-2.7 MB unit), but a larger change and it interacts with `ChunkMemo`; touches `put`/`putReusing` and #224's plan files.
5. Faster SHA (WebCrypto async digest restructure). Needs the staged generator to become async-aware; large.
Rejected: container-identity reuse of the unit (would skip re-reading nested mutations; same dropped-saved-block failure as 3).

## Phone/PC ratio (labelled unmeasured estimate)
- Existing same-flow lane B pairs (PC Chrome 157 DEV vs Note 9): typing 124 vs 328 ms, D1a 300 vs 760, D1b 583 vs 1423, D1c 312 vs 788, so about 2.4-2.6x; the pre-fix phone 330 ms against about 96 ms pre-fix PC production sum is about 3.4x.
- Applied to 44 ms PC median: about 105-150 ms per task on the phone (estimate, not measured), under the 200 ms target with margin about 25 percent. The 6x fast/slow phone-state spread in Maintainer-Context would give about 260 ms in the slow state; the 35x apply-cost ratio belongs to another workload and was not applied.

## Overlaps
- #816 (ChroMemory vectors, merged `a515f620a`): touches drive/rtb, `chroMemory/vectorPersist`, bootstrap, `store_keys.rs`; no overlap with `store2/codec`, `saveEncoder`, `lists/scan`, `blockFrame`.
- #224 (import dedup): closed. PR #927 only adds `docs/design/storage/IMPORT_DEDUP_PLAN.md`; no `src/ts/storage` changes. Cuts 4 and 5 share `codec/reuse.ts`, `codec/scoped.ts`, `codec/types.ts`, `baseContent.ts` with that plan; cuts 1 and 2 do not.
- Studio history-core files (fieldRegistry, historyModel, ownerHistory, studioSetters, objectLists, objectListOps, studioHistoryService, studioHistoryStore): not touched or depended on by any cut. The Studio UI was only driven through the browser.

## NOT measured
- Any phone run (Note 9 or Tab S9); WebView JIT/GC behaviour.
- Per-pass attribution in the browser (profile aggregates multiple passes; 1 rep; unminified build).
- Inlay scan in Node (wrapper reported 0).
- Real-user data shape (regex-heavy text could differ from the synthetic prose pool).
- Quiet-machine Node timings; main-thread cost of the store write (Tauri/Node server transport) on phone.
- Whether the 101 ms page longtask in the p1 edit window contains a save stage.

## Validation criteria
- Rerun the same harness and `run301.mjs` (5 cold reps, same fixture, production build) before and after; accept when the browser longest task median drops below the current 43.6 ms with the sum of the pass not rising, and a phone run (separate device approval) shows each task under 200 ms.
- Byte-equality oracle: encoded units and manifests identical before and after for each cut across the 5 fixtures.
- crc32 equivalence test on random and edge-length inputs; inlay memo exactness test (changed string changes result; asset id inside the string still found).
- For cut 3: unmarked mutation after acknowledge must produce `dirty`.

## Open items
- Quiet-machine Node rerun; second profile rep; per-pass profile via a MEASURE-build trace.

## Incidents
None. Own processes stopped: Chrome 13356, Node server 48908, run301 21160, profile loop. The launcher (PID 26648) exits with Chrome.

---

## Options (for lane A; nothing implemented)

| Option | Gain | Contract risk | Cost |
|---|---|---|---|
| A. Do nothing; close #301 as met on PC, run one Note 9 timing row after the staged pass to confirm each task < 200 ms | none needed (estimate 105-150 ms/task) | none | one device row |
| B. Memoise the inlay scan by exact string content (`lists/scan.ts`, `lists/derive.ts`) | est. 25-45% off the longest stretch (browser profile only) | low, but a non-content key drops a live asset reference (GC deletes it); content-exact key and an exactness test required; Gate 2 `opus-reviewer` (asset lifecycle) | small |
| C. crc32 slicing-by-8 (`blockFrame.ts`) | est. 2-3 ms per pass | low; byte-equality test vs current table | tiny |
| D. Seed the verdict shadow at acknowledge | halves idle-net cost | HIGH: the idle net exists to catch unmarked mutations; a false `clean` silently drops a saved block; needs `opus-reviewer` and a test mutating an unmarked field after acknowledge | medium |
| E. Chunked hashing inside one put | largest effect on the longest slice | touches `codec/reuse.ts` etc. (shared with the #224 plan) | large |

Recommendation: A, then B and C only if the Note 9 row exceeds 200 ms. Not D or E.
