# Lane B records: import/export page fixes

Lane rules: [README.md](README.md) and [lane-B-brief.md](lane-B-brief.md). Branch `worktree-Lane-B`, started from `74b28ddd1`, fast-forwarded to `e8fd39618` (records only) on 2026-10-21. IDs: MC-355 to MC-374, CHORE-220 to CHORE-239, ledger rows 2300 to 2499; overflow MC-400 to 409, CHORE-300 to 309, rows 3000 to 3099. Scratch: `%TEMP%\risu-lane-b\`. Ports: 6400 to 6419.

A stage here is at most "technically accepted"; it becomes COMPLETE only after lane A folds these records into the shared files.

## Stages

| Stage | Item | State |
|---|---|---|
| 1 | CHORE-194: import warning and estimate keyed on the database entry | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[EDITORIAL]`, E1 applied; awaiting records verification and the maintainer's commit approval (rows 2300 to 2306) |
| 2 | Read the `.bin` once, decode the database once (`MC-328` 2, `MC-323` lead 6, CHORE-103) | slim stage adopted (`MC-357`, `s2\advisor.md`); PC measurements m1 and m3 done (`s2\measure\report.md`, diagnostic, not yet verified); m2 once stage 1 is committed |
| 3 | Parallel large entries (`MC-328` 2) | not started |
| 4 | Android batched asset reader for export (fit-map E1) | not started |

## MC entries

### MC-355 — Lane B, 2026-10-21: CHORE-194 answers (reword the size sentence; accept on the PC trigger with a batched Note 9 check)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-21)
- **Date:** 2026-10-21
- **Sweep ref:** none
- **Source:** the lane B session transcript. Input: `%TEMP%\risu-lane-b\s1\discovery.md` (AI-authored investigator packet; its decision-critical claims were re-read in source by the lane B orchestrator: `confirmImportScale` in `src/ts/drive/storeImport.ts` shows the time notice only when `transportKind()` is `'android'` and the non-database bytes exceed `IMPORT_TIME_WARNING_BYTES`; `estimateImportSeconds` in `src/ts/drive/importEstimate.ts` keys the long tail on the database entry's bytes; `store2ImportSizeWarning` and `store2ImportTimeWarning` in `src/lang/en.ts` both say "The database inside this backup is about N MB"). Not yet independently verified as a report.
- **Related:** `MC-318` 6, `MC-326` 11, `MC-330` 3 and 4, `MC-058`; CHORE-194.

1. **Wording: "Reword it (Recommended)".** Once the stub units are counted, the sentence no longer says "the database"; the option text proposed "The character and chat data in this backup is about N MB" in both warnings, with the translator updating the six locales. Not chosen: "Keep the sentence" (only the number grows; no string change).
2. **Acceptance: "PC trigger + batched Note 9 (Recommended)".** Stage 1 is accepted on PC tests: a stub file warns, an inline file is unchanged, and the long tail is keyed on database plus unit bytes. A Note 9 import of a stub file goes into lane A's next planned device session as a request, and the estimate is re-calibrated later if it is off. Not chosen: "PC only" and "Note 9 before accept".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator; the summaries above repeat them.
- Item 2's "an inline file is unchanged" is the option text. Stage 1 Gate 1 amendment 6 (`s1\gate1-r1.md`) found that it holds only for a file without unit entries: fork inline exports can carry plugin-storage units and upstream inline files can carry cold-chat units, and both now count. Records and the commit say "a file without unit entries".
- Premise behind item 2 (read in source): on a PC only the 16 MiB size warning can appear; the time and space notice is Android-only and its rates were fitted on the Note 9, so CHORE-194's "estimates within a stated factor of the measured import on the PC" has no PC estimate to compare.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-356 — Lane B, 2026-10-21: the CHORE-194 size sentence reads "saved data, not counting images and other files" (amends `MC-355` 1)

- **Tag:** decision (one `AskUserQuestion` answer, 2026-10-21)
- **Date:** 2026-10-21
- **Sweep ref:** none
- **Source:** the lane B session transcript. Raised by stage 1 Gate 1 round 1 (`opus-reviewer`, `%TEMP%\risu-lane-b\s1\gate1-r1.md`, `[APPROVE WITH AMENDMENTS]`, amendment 1): the `MC-355` 1 text misstates N for an inline file (the database entry also holds settings, presets, modules, lorebooks and plugin storage), for the counted units (they include plugin-storage units), and for the numbered-backup restore, which shows the same key with a whole database file's size (`confirmDatabaseSize` called from `storeRestore.ts`; the orchestrator confirmed the call by search).
- **Related:** `MC-355`, `MC-058`; CHORE-194, CHORE-220.

1. **Wording: "\"Saved data, not files\" (Recommended)".** The sentence becomes "The saved data in this backup, not counting images and other files, is about N MB." in `store2ImportSizeWarning` and in the database sentence of `store2ImportTimeWarning`; same keys; the translator updates the six locales. Not chosen: "Keep \"character and chat\"" (the `MC-355` 1 text) and "Keep original text" ("The database inside this backup is about N MB", no translator pass).

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator. The question also stated that for the same 500 characters the number reads about 31 MB for an inline backup and about 81 MB for a stub one (CHORE-220).
- `MC-355` 1 is not rewritten; this entry replaces its wording.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-357 — Lane B, 2026-10-21: stage 2 becomes the slim stage (nothing of the database held across the copy; one fewer buffer copy per decode; tail-locate dropped; read-once deferred) (amends the page-fix wording of `MC-328` 2)

- **Tag:** decision (one `AskUserQuestion` answer, 2026-10-21)
- **Date:** 2026-10-21
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs: `%TEMP%\risu-lane-b\s2\sizing.md` (investigator) with `sizing-verify.md` (`doc-verifier`, 7 of 8 verified, claim 4 corrected; `sizing.md`'s header revision and its U4 sequencing warnings are stale); `%TEMP%\risu-lane-b\s2\advisor.md` (`senior-advisor` challenge). The orchestrator re-read two of the advisor's premises: the Note 9 fixture's manifest (`%TEMP%\risu-b715\measure2\fixtures\m2-mix18k.bin.manifest.json`) gives a 48.8 MiB compressed and 170.8 MiB uncompressed database, and `decodeRisuSaveBranches` (`src/ts/storage/risuSave.ts`) copies the input with `slice` in its three legacy branches. The advisor's ring timings and PSS series (lane A's `measure2\runs\a2\`) were not re-checked by the orchestrator.
- **Related:** `MC-328` 2, `MC-323` 2 lead 6, `MC-327` 12, `MC-330` 3; CHORE-103.

1. **Stage 2: "Adopt the slim stage (Recommended)".** The option text: hold nothing of the database across the copy, view instead of copy in the decoder, remove three debug logs, refuse a file changed before the save; PC measurements first; tail-locate dropped; the lighter file pass deferred behind a PC timing test; CHORE-103 stays open as limited by the format itself. The question stated: decoding takes about 4 s on the Note 9 and does not set the memory peak (each decode needs the decompressed database and the decoded tree together, so decoding once would not lower the peak); locating the database from the tail saves no read; the expected saving is about 49 MiB off the peak and every plateau in that test; read-once waits for the native file reading in `MC-328` 2; a `.bin` changed on disk between the copy and the save is refused with the "file changed" message, where today the stale data would be saved. Not chosen: "Slim stage + keep tail-locate" and "Hold stage 2".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator from the advisor's recommendation.
- `MC-328` 2 is not rewritten: its order stands; this entry replaces only the content of the "platform-neutral page fixes" step for decode-once, tail-locate and read-once. Faster base64 is already done (`ac5b4e105`); parallel large entries stay as lane B stage 3.
- The figures are from one debug build on one Note 9 with a synthetic fixture; PSS sampled every 5 s, so peaks are lower bounds.
- Nothing here authorizes application-code edits, commits or pushes.

## CHORE entries

### CHORE-194 (changed) — The import size and time warning is keyed on the database entry, which comes out low for stub-form files

**Status (2026-10-22, lane B stage 1): fixed on `worktree-Lane-B`, technically accepted once the records are verified and the commit is approved; uncommitted. The Note 9 calibration is open under CHORE-220 (`MC-355` 2).** Ledger rows 2300 to 2306.

- **What changed:** `ColdEntryIndex.estimatedUnitBytes` (`src/ts/storage/store2/legacy/binReader.ts`) sums the `dataLength` of the entry the reader tries first per id (the last noted place): a name-only estimate that over-counts orphan units and rejected bodies, and under-counts units served from the page or the old profile and units served by an earlier entry. `confirmImportScale` (`src/ts/drive/storeImport.ts`) takes it as a fourth argument from its one call in `backuplocal.ts`; the 16 MiB size sentence and the long-tail key use the database entry plus that estimate. The 1 GiB Android trigger, the copy time and the free-space figure still use the file size less the database entry, so the units stay in them. The numbered-backup restore (`storeRestore.ts`, `confirmDatabaseSize`) is unchanged and keeps the database bytes. The sentence reads "The saved data in this backup, not counting images and other files, is about N MB" in English and six locales (`MC-356`).
- **Unchanged case:** a file without unit entries gets the same prompts and figures as before. A fork inline export with plugin-storage units or an upstream file with cold-chat units now counts them.
- **Not done:** the upstream `.bin` round trip was not run, because no read or write path changed (reasoning by the plan and both gates, not execution). The Note 9 figure (`MC-355` 2) and the mixed byte basis (CHORE-220) remain.
- **Related:** `MC-355`, `MC-356`, `MC-318` 6; CHORE-220.

### CHORE-220 — The import size warning sums compressed database bytes with uncompressed unit bytes, so a stub-form file warns earlier and shows a larger number

**Status (2026-10-21): open, scheduled with the stage 1 Note 9 check (`MC-355` 2).** Source: the lane B stage 1 plan (`%TEMP%\risu-lane-b\s1\plan.md`, change 3, an orchestrator ruling); raised again by a side agent's note, and the maintainer asked on 2026-10-21 that it be recorded so it is not lost.

- **Problem:** the CHORE-194 fix counts the `coldstorage_<uuid>.json` unit entries as database-class bytes for the 16 MiB size warning and the long-tail rule. It sums raw on-disk bytes: the database entry is compressed and the units are uncompressed JSON. For the same content a stub-form file's sum is larger than the inline file's database entry. Example (stubflip PC fixture, 500 characters, synthetic, one fixture): inline 30.6 MB against stub 10.4 MB database plus about 71 MB of units, about 81 MB, about 2.7 times. So stub-form files cross 16 MiB with smaller libraries, and the sentence "reading it needs several times that much memory" probably overstates the memory for the unit part (inferred, unmeasured).
- **Direction:** errs toward warning, never toward a missing warning. No correction factor was set, because the only ratio comes from one synthetic fixture.
- **What settles it:** the Note 9 import of a stub-form file (`MC-355` 2), measuring the memory peak during the resolve against the shown number, and the import time against the estimate. Then recalibrate the threshold or the shown number, or both. If the wording changes again, it needs a translator pass (`MC-058`).
- **Alternative named to the maintainer, not chosen now:** keep the 16 MiB trigger and show the database and unit sizes separately in the sentence (a further string change).
- **Related:** CHORE-194, `MC-355`, `MC-318` 6.

## Ledger rows

All scratch paths are under `%TEMP%\risu-lane-b\`, outside the repository.

| Row | Date | Item | Agent / role | Artifact | Result |
|---|---|---|---|---|---|
| 2300 | 2026-10-21 | Stage 1 discovery | investigator | `s1\discovery.md` | Packet. Refuted the PC-estimate premise: the time notice is Android-only. Its decision-critical claims were re-read in source by the orchestrator (`MC-355` source line). Used as plan input; not separately verified as a report. |
| 2301 | 2026-10-21 | Stage 1 plan | orchestrator | `s1\plan.md` | Plan. Change 3 (raw byte basis) is an orchestrator ruling, recorded as CHORE-220. |
| 2302 | 2026-10-21 | Stage 1 Gate 1 r1 | opus-reviewer | `s1\gate1-r1.md` | `[APPROVE WITH AMENDMENTS]`, 7 binding. Amendment 1 led to `MC-356`. |
| 2303 | 2026-10-21 | Stage 1 translation | translator | `s1\tl\strings.md` | 12 values (2 keys, 6 locales), written to scratch because of the main-only translator guard; copied verbatim by the coder. |
| 2304 | 2026-10-21 | Stage 1 implementation | sonnet-coder | `s1\impl\handback.md`, `red-r1r2.log`, full-run logs | A1 to A7 met. Red on base: 6 of 7 new tests failed, and the guard passed. Mutants (a) to (d) each red. `pnpm check` 0/0. `pnpm test` 899 files passed, 1 skipped; 20,196 tests passed, 23 skipped. `pnpm build` exit 0. |
| 2305 | 2026-10-21 | Stage 1 process deviations | orchestrator | this row | (1) The coder created `storeImportUnitBytes.svelte.test.ts` through a shell write before its exact grant existed; later edits went through Edit; Gate 2 found it all CRLF and in line with its sibling harnesses. Cause: the grant had not been registered before dispatch. (2) The coder ran its mutants by editing repository files and restoring them, against `MC-329` 3; Gate 2 found the SHA-256 values restored and replaced the evidence with hook-based mutants. (3) The full run rewrote the line endings of `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` (no content change); the orchestrator restored it. |
| 2306 | 2026-10-22 | Stage 1 Gate 2 r1 | opus-reviewer | `s1\gate2-r1.md`, `s1\gate2\` logs | `[EDITORIAL]`. Executed: base red through an `enforce:'pre'` hook serving the base sources (8 failed: 6 of 7 new tests and both accessor tests); 10 hook mutants (a, a2, b, c, d, d2, e, f, g, h), each red; targeted 8 files, 192 passed; `pnpm check` 0/0; locale values equal `strings.md`. E1: the `confirmDatabaseSize` doc comment; applied by the orchestrator, then `pnpm check` 0/0 and line endings unchanged (CRLF). The full suite was not re-run (`MC-329` 4). |

## Handoff

2026-10-21: lane started; worktree clean at `74b28ddd1`; `pnpm install --frozen-lockfile` run in the worktree; this file created.

2026-10-22: stage 1 is implemented and through both gates; it awaits records verification and the maintainer's commit approval. Stage 2 is the slim stage (`MC-357`). PC measurements m1 and m3 are done (`s2\measure\report.md`, a diagnostic run, not yet verified): the tree is about 176 to 181 MiB, `subarray` saves 48.8 MiB, and `console.log` retains the logged graph in headless Chrome. Next: m2 (a WeakRef probe of the tree during the commit, in a scratch test run) once stage 1 is committed, then the stage 2 plan and its Gate 1.
