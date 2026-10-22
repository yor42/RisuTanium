# Lane B records: import/export page fixes

Lane rules: [README.md](README.md) and [lane-B-brief.md](lane-B-brief.md). Branch `worktree-Lane-B`, started from `74b28ddd1`, fast-forwarded to `e8fd39618` (records only) on 2026-10-21. IDs: MC-355 to MC-374, CHORE-220 to CHORE-239, ledger rows 2300 to 2499; overflow MC-400 to 409, CHORE-300 to 309, rows 3000 to 3099. Scratch: `%TEMP%\risu-lane-b\`. Ports: 6400 to 6419.

A stage here is at most "technically accepted"; it becomes COMPLETE only after lane A folds these records into the shared files.

## Stages

| Stage | Item | State |
|---|---|---|
| 1 | CHORE-194: import warning and estimate keyed on the database entry | COMPLETE; folded into the shared files by lane A on 2026-10-22, merged as `953f63241` |
| 2 | Read the `.bin` once, decode the database once (`MC-328` 2, `MC-323` lead 6, CHORE-103), replaced by the slim stage (`MC-357`) | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[EDITORIAL]`, E1 applied; records verified (row 2318); rows 2307 to 2318; COMPLETE; folded into the shared files by lane A on 2026-10-22, merged as `165dcf10f` |
| 3 | Parallel large entries (`MC-328` 2), desktop and Android only (`MC-358`) | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[EDITORIAL]`, items applied; defaults stay at 1 stream until the Note 9 run (CHORE-222); rows 2319 to 2325; COMPLETE; folded into the shared files by lane A on 2026-10-22, merged as `42993e408` |
| 4 | Android batched asset reader for export (fit-map E1), and an export phase timer (`MC-359`) | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[EDITORIAL]`, E1 applied; rows 2326 to 2335; technically accepted; the Note 9 export run is running on phone 1; COMPLETE; folded into the shared files by lane A on 2026-10-22, merged in `dd9c04679` |

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

### MC-358 — Lane B, 2026-10-22: stage 3 (parallel large entries) is built with tunable counts and tuned on the Note 9; a failure stops the other streams at their next chunk; desktop and Android only (amends the "platform-neutral" wording of `MC-328` 2 for this item)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs: `%TEMP%\risu-lane-b\s3\sizing.md` (investigator) with `sizing-verify.md` (`doc-verifier`; it corrects the lock claim, the second desktop copy path and the expected gain, and supersedes the packet where they differ).
- **Related:** `MC-328` 2, `MC-197` 9, `MC-330` 3; lane B stage 3.

1. **Approach: "Build, tune on phone (Recommended)".** The option text: implement parallel streams with the stream count and the Android batch count as constants (1 = today's behaviour); prove ordering, failure and memory on the PC; then one Note 9 release run picks the defaults; desktop and Android only. The question stated: the gain is modest and unmeasured on the current build. In a phone emulation, parallel large-file streams added about +25% (2 streams) to +50% (4 streams, plus 4 batches in flight instead of Android's 2), over a base that had already doubled with the faster base64. Not chosen: "Measure first" (an emulation run on the Note 9 before any product code) and "Skip to stage 4".
2. **On failure: "Stop at next chunk (Recommended)".** When one large-file copy fails while others are in flight, each stream checks for the failure between chunks and stops. The import is refused, and nothing is committed either way. Not chosen: "Finish current file".
3. **Scope: "Desktop and Android only (Recommended)".** Stage 3 is recorded as Tauri-only. Web and Node batching stays the separate, later `MC-328` 2 item (Node endpoints and web batching). Not chosen: "Keep it general".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator from the sizing packet and its verification.
- The question's "already doubled with the faster base64" overstated: `sizing-verify.md` gives about +65% in three runs and +124% in one (mean +81%, spread unexplained).
- The emulated figures come from one Note 9 release build of an older main (c428a0234) on a 96 MiB sample. The split of the gain between the stream count and the batch count is unmeasured.
- `MC-197` 9 (per-file sync) stays in force. More streams mean more concurrent syncs.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-359 — Lane B, 2026-10-22: stage 4 turns on the existing batched asset reader and sized listing for Android exports in the page only, accepting both bridge reply forms, and adds a measurement-only export phase timer

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs: `%TEMP%\risu-lane-b\s4\sizing.md` (investigator) with `sizing-verify.md` (`doc-verifier`, 9 claims verified, one with a caveat; it supersedes the packet where they differ).
- **Related:** `MC-328` 2 (fit-map E1), `MC-223`, `MC-322` 2, `MC-175`, `MC-197`; CHORE-129.

1. **Approach: "Page-only, both forms (Recommended)".** The option text:
   - On Android, export uses the batched read and sized-listing commands the app already registers.
   - The reply parser accepts both forms the bridge can deliver (raw bytes or a number array), as the single-file reader already does.
   - No Rust change.
   - A phone run shows the speed. A Rust command that replies in base64 comes back to the maintainer only if the number-array form proves too slow.

   Not chosen: a Rust base64 reply command now, and measuring before any code.
2. **Phase timer: "Yes, measurement-only (Recommended)".** An export phase timer following the import ring's pattern. Release builds that are not MEASURE builds compile out its ring and key and record nothing. Not chosen: no timer.

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator from the sizing packet and its verification.
- A side effect of item 1, which the plan names: the sized listing also feeds the `MC-223` oversize question. Android exports then get the desktop's hard-limit question for assets. That closes the Android part of the `MC-322` 2 residual (CHORE-129) when the sized listing succeeds. If `list_assets_sized` fails, the pre-flight is still blind, as on the desktop (stage 4 Gate 1). Web and Node keep that residual.
- The `MC-223` soft limit (about 500 MB) stays out on every platform, as the maintainer decided earlier (CHORE-129, "No 500 MB soft limit").
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

### CHORE-103 (changed) — The restore of a large legacy `database` entry peaks at about +1.2 GiB in its decode tail

**Status (2026-10-22, lane B stage 2, `MC-357`): OPEN, residual format-bound; uncommitted on `worktree-Lane-B` until the maintainer approves the commit.** Ledger rows 2307 to 2318. The earlier statuses in the Roadmap entry stand.

- **What changed:**
  - **No bytes held across the copy.** The `.bin` import no longer holds the database entry's bytes across the asset copy: `store2Import.databaseBytes` is gone. The validity probe reads and decodes through `readBinDatabaseOmitted`, and the boot and page commit closures through `readBinDatabaseTree` (`src/ts/drive/storeImport.ts`). Each of those reads the entry from the file again.
  - **No copy in the decoder.** `decodeRisuSaveBranches` (`src/ts/storage/risuSave.ts`) reads the body as a view (`subarray`) instead of a copy in its compressed, raw and stream branches. That avoids a transient copy of the compressed body at every legacy decode, numbered backups included.
  - **Three decoder logs removed.** These were `console.log` calls of `this.blocks`, the directory and the decoded `db` on the block-format path; desktop Chrome keeps a logged object's graph alive (m3, synthetic).
- **Sizes on the Note 9 fixture** (synthetic, `m2-mix18k.bin`; m1 on the PC): the held bytes were 48.8 MiB, and the decode transient is 48.8 MiB lower. The decompressed buffer (170.8 MiB) and the decoded tree (about 176 to 181 MiB) remain at each decode. So the peak is format-bound and moves only with per-unit decoding (`MC-327` 12). No device measurement has been made after the change.
- **Not changed:** the decode count (the validity probe plus the commit, and a rebuild on conflict) and the `.bin` layout, encoders and write paths.
- **Related:** `MC-357`, `MC-328` 2, `MC-323` 2 lead 6; CHORE-221.

### CHORE-221 — A `.bin` commit's salvage can leave out blocks the person did not confirm

**Status (2026-10-22): open, candidate; not scheduled.** Source: the lane B stage 2 Gate 1 review (`%TEMP%\risu-lane-b\s2\gate1-r1.md`, non-binding note). It is a reviewer's reading, not independently verified by the orchestrator.

- **Problem (reviewer's claim):** the left-out question (`MC-183`) is asked once, over the validity probe's decode. The commit decodes again, and for a block-format file `RisuSaveDecoder` reads `remotes/` from the app store at that time. So the commit's salvage can leave out blocks that the person never confirmed. Since stage 2 the commit also re-reads the entry from the file, so a same-length body change with an intact header (which the header re-check does not detect) falls in the same class.
- **Possible fix named by the reviewer:** refuse as a changed file when the commit's left-out names are not a subset of the confirmed `facts.omitted`.
- **Related:** `MC-183`, `MC-357`; CHORE-103.

### CHORE-222 — Parallel large-entry streams: pick the defaults on the Note 9, then raise them

**Status (2026-10-22): open.** The lane B stage 3 code is on `worktree-Lane-B`, uncommitted until the maintainer approves. Both defaults are 1 (today's behaviour). Source: `MC-358` 1, the stage 3 gates (`%TEMP%\risu-lane-b\s3\gate1-r1.md`, `gate2-r1.md`).

- **What exists:**
  - `RestoreAssetPipeline` (`src/ts/drive/assetBatchPipeline.ts`) takes `maxStreams` and `streamSliceBytes`.
  - At `maxStreams` 1, the copy runs today's literal path (`streamAlone`).
  - Above 1, large entries stream beside each other and beside batches:
    - the last entry in file order wins for keys that fold equal;
    - a sink, batch or source failure stops the other streams before their next chunk (`MC-358` 2);
    - Android streams read one writer chunk (1 MiB) per slice.
  - **The knob.** A MEASURE-only knob, `localStorage['risu-measure-copy'] = "<streams>[,<flights>[,<sliceKiB>]]"`, is read in `backuplocal.ts` `copyMeasureLimits` on every import. `risu-measure-copy` is in `util/checkReleaseDist.mjs` `FORBIDDEN_MARKERS`.
- **Next:**
  1. A Note 9 run: a `VITE_RISU_MEASURE=1` release build, a large `.bin` such as `m2-mix18k.bin` (34.4% of its bytes in entries above 1 MiB). Streams x flights in {1,2,4} x {2,4}, and the slice size where it matters. Record the copy rate (`__risuImportPhases`) and the renderer and app PSS peak. A device request goes to lane A once this stage is committed.
  2. Before raising a default above 1:
     - (a) a test at more than 1 stream that a refused stream name is reported in the import's skipped list (Gate 2 mutant r7 survived; today it is reachable only through the knob);
     - (b) the maintainer settles the progress text during a long drain (the percentage counts bytes read and can sit at 100% while streams finish);
     - (c) decide whether the literal `maxStreams` 1 path is deleted (the new path at 1 is not identical: batches would overlap the stream).
  3. A one-line change sets `ANDROID_ASSET_MAX_STREAMS`, the desktop `ASSET_MAX_STREAMS` and, if measured, the Android flight count.
- **Known, accepted:** when the loop throws, the caller skips `stopStreams` (Gate 2 mutant r3 survived). The only effect is a delay before the error shows.
- **Related:** `MC-358`, `MC-328` 2, `MC-197` 9.

### CHORE-129 (changed) — Warn before an upstream-compatible export when data exceeds upstream's size limits, and leave that data out

**Status (2026-10-22, lane B stage 4, `MC-359`): RESIDUAL ACCEPTED UNTIL STAGE 0b for web and Node; Android assets are now checked.** The change is on `worktree-Lane-B` and stays uncommitted until the maintainer approves. Ledger rows 2326 to 2335. The earlier statuses in the Roadmap entry stand.

- **What changed:** an Android export now gets the sized asset listing (`list_assets_sized`). So the `MC-223` hard-limit question names each asset at or above the upstream limit before the export starts, as it does on the desktop. On confirm, those assets are left out and listed in `omitted.oversize`; on cancel, nothing is written. The text, flow and filtering are the desktop's.
- **Still blind:** if the sized listing fails, the export falls back to the unsized listing and writes every asset without the question, as on the desktop (test T4d). Web and Node exports keep the residual.
- **Unchanged:** no 500 MB soft limit on any platform.
- **Related:** `MC-359`, `MC-322` 2, `MC-223`.

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

Rows from 2307 on use the shared ledger's columns. Tokens are each agent's own count as reported at its completion; "not recorded" where the count is not available.

| # | Date | Question | Tier(s) | Tokens | Escalated? | Outcome |
|---|---|---|---|---|---|---|
| 2307 | 2026-10-21 | Stage 2 sizing: what do the "read once / decode once" fixes buy? | investigator | not recorded | no | `s2\sizing.md`. Packet. Its header revision and the U4 sequencing warnings are stale (`MC-357` source). |
| 2308 | 2026-10-21 | Verify the stage 2 sizing | doc-verifier | not recorded | no | `s2\sizing-verify.md`. 7 of 8 verified; claim 4 corrected. |
| 2309 | 2026-10-21 | Challenge the stage 2 plan before Gate 1 | senior-advisor | not recorded | yes (expensive-to-reverse plan) | `s2\advisor.md`. Recommended the slim stage; adopted by the maintainer as `MC-357`. |
| 2310 | 2026-10-21 | m1 and m3: decoded tree size, slice vs subarray, console retention (PC) | perf-analyzer | not recorded | no | `s2\measure\report.md`. Diagnostic. Tree about 176 to 181 MiB; `subarray` avoids a 48.8 MiB transient copy (peak only); `console.log` retains the logged graph in headless Chrome until `console.clear()`. |
| 2311 | 2026-10-22 | Verify m1 and m3 | doc-verifier | 49,049 | no | Numbers verified against the raw files; 6 corrections (decompress range, RSS rounding and spread, console.clear source files, offset source, the transient saving, log-retention wording), applied by the orchestrator to `s2\measure\report.md`. |
| 2312 | 2026-10-22 | m2: is the decoded tree collectable during the commit? (PC vitest) | perf-analyzer | 84,678 | no | `s2\m2\report.md`. Diagnostic. COLLECTED from 'import planned' on, 4 of 4 runs; positive control RETAINED. No ticket. Not separately verified; Gate 1 found its logs consistent. |
| 2313 | 2026-10-22 | Stage 2 plan | orchestrator | not recorded | no | `s2\plan.md`. C1 to C3, T1 to T5, mutants 1 to 5; Gate 1 amendments folded in, with A4 resolved by adding the name comparison. |
| 2314 | 2026-10-22 | Stage 2 Gate 1 r1 | opus-reviewer | 178,587 | no | `s2\gate1-r1.md`. `[APPROVE WITH AMENDMENTS]`, 5 binding: comment wording (raw-branch views alias the caller's bytes, executed in `gate1\alias.mjs`), T1 scope, T2/T3 inputs, claim accuracy, mutants 6 and 7. Candidate CHORE-221. |
| 2315 | 2026-10-22 | Stage 2 implementation | sonnet-coder | 189,608 | no | `s2\impl\` logs. Red on base: T1 (4), T2/T3 (12) and the refusal unit cases (8 of the 10 new) failed for the intended reasons; T4 (6, a guard) passed. Green after. `pnpm check` 0/0; `pnpm test` 901 files passed, 1 skipped; 20,231 tests passed, 23 skipped; `pnpm build` exit 0. The snapshot line-ending rewrite was restored. Mutants 1, 2, 3, 6a to 6c and 8 were run through a scratch hook, each red. |
| 2316 | 2026-10-22 | Stage 2 Gate 2 r1 | opus-reviewer | 155,278 | no | `s2\gate2-r1.md`, `s2\gate2\` logs. `[EDITORIAL]`. Mutants 4a to 4c, 5a to 5c, 7, 1' and the spot checks 2 and 8 were each red; the import-only control survived. A base-like run showed T2's page cases land and boot cases fail without the fix. Targeted 57/57 and adjacent 412/412 passed; `pnpm check` 0/0. E1, the T2/T3 header comment, was applied by the orchestrator, who also wrapped the A1 comment in `risuSave.ts` (same words). The full suite was not re-run (`MC-329` 4). |
| 2317 | 2026-10-22 | Stage 1 checks on the bumped toolchain (vite 8.1.6, markdown-it 14.3.3) | orchestrator | not recorded | no | `s1\recheck\`. `pnpm test` 899 files passed, 1 skipped; 20,196 tests passed, 23 skipped; `pnpm check` 0/0; `pnpm build` exit 0; the same counts as before the bump. |
| 2318 | 2026-10-22 | Verify the stage 2 records and commit message | doc-verifier | 63,166 | no | 14 claim groups: 11 verified, 1 wrong (row 2315's refusal red count: 8, not 10; corrected), 1 overstated (the commit message's round-trip sentence; reworded to what the logs show), token counts unverifiable. Its proposed trailer change was rejected: the session's required attribution is "Claude Opus 5.5". |
| 2319 | 2026-10-22 | Stage 3 sizing: what is "parallel large entries"? | investigator | 125,657 | no | `s3\sizing.md`. Import only, desktop and Android only. The idea overlaps large-entry streams. Two gaps: no stop check in `streamAssetEntry`, and no folded-key check for streams. Emulated gain about +25 to 50%. |
| 2320 | 2026-10-22 | Verify the stage 3 sizing | doc-verifier | 61,586 | no | `s3\sizing-verify.md` (saved by the orchestrator). Core verified. Corrected: no lock during the Tauri copy; the pipeline-less desktop streaming path; the gain split (streams alone about +25%; F=4 is part of the larger figure); the base64 result spread (+65% in three runs, +124% in one). Fed `MC-358`. |
| 2321 | 2026-10-22 | Stage 3 plan | orchestrator | not recorded | no | `s3\plan.md`. Gate 1 amendments folded in; amendment 5 resolved as option (a), chunk-sized slices on the parallel path. |
| 2322 | 2026-10-22 | Stage 3 Gate 1 r1 | opus-reviewer | 118,659 | no | `s3\gate1-r1.md`. `[APPROVE WITH AMENDMENTS]`, 7 binding: the loop-top source check, `stopStreams`, re-checks after awaits, a `'stopped'` throw on the pipeline-less path, the stop granularity, the forbidden-marker list, tests (a) to (f). |
| 2323 | 2026-10-22 | Stage 3 implementation | sonnet-coder | 260,416 | no | `s3\impl\` logs. Red on base through a swap config serving HEAD sources: 28 of 33 unit tests, of which 22 are only missing exports (`parseCopyMeasureKnob` x19, `stopStreams` x2, `ASSET_MAX_STREAMS` x1; not reproducers under gates.md), so 6 behavioural unit reds; and 7 harness reds. Guards that pass on base and are evidenced only by mutants: T3a to T3d, the T1 pin, and three harness tests. Mutants m01 to m15 killed. `pnpm check` 0/0; `pnpm test` 902 files passed, 1 skipped; 20,276 tests passed, 23 skipped; `pnpm build` and `pnpm check:dist` exit 0. The snapshot line-ending rewrite was restored. |
| 2324 | 2026-10-22 | Stage 3 Gate 2 r1 | opus-reviewer | 173,117 | no | `s3\gate2-r1.md`, `s3\gate2\`. `[EDITORIAL]`. `streamAlone` is HEAD's `addStreamed` body line for line. Targeted 160/160; `pnpm check` 0/0. `check:dist` catches a planted marker, and the built `dist/` holds no knob. Mutants m02, m04, m06, m09 and m11 re-run, plus r1, r2 and r4, all killed. r3 and r7 survived (CHORE-222). Items 1 to 3 (two test titles and one doc comment) were applied by the orchestrator, with line endings unchanged (CRLF). Item 4 is the red-count wording in row 2323. The full suite was not re-run (`MC-329` 4). |
| 2325 | 2026-10-22 | Verify the stage 3 records and commit message | doc-verifier | 65,779 | no | About 30 claim groups: 24 verified, tokens unverifiable. Corrected: row 2325 was missing (added); `MC-358`'s question overstated the base64 gain (a note added; the recorded question text is kept); the commit message's count of restore guards (five, named). The trailer question was settled by the orchestrator's own attribution reminder (Opus 5.5). |
| 2326 | 2026-10-22 | Stage 4 sizing: what does fit-map E1 (Android batched export reads) need? | investigator | 96,326 | no | `s4\sizing.md`. Packet. Commands exist on Android; the JS predicate blocks them; the `MC-223` pre-flight is blind to Android assets; batch failures fall back. Reply form (U1) unresolved. |
| 2327 | 2026-10-22 | Verify the stage 4 sizing | doc-verifier | 63,042 | no | `s4\sizing-verify.md` (saved by the orchestrator). 9 claims: 8 verified, 1 with a caveat (a batch `missing` is trusted without a re-read). It added the listing/reader coupling and found the JS base64 decoder (U2). It fed `MC-359`. |
| 2328 | 2026-10-22 | Stage 4 plan | orchestrator | not recorded | no | `s4\plan.md`. C1 (the read predicate and the reply forms), C2 (export gating and phases), T1 to T6, mutants 1 to 7. Gate 1 amendments folded in as the binding section. |
| 2329 | 2026-10-22 | Stage 4 Gate 1 r1 | opus-reviewer | 177,801 | no | `s4\gate1-r1.md`. `[APPROVE WITH AMENDMENTS]`, 8 binding. (1) The read predicate is `assetBatchWriteMode() !== 'none'`. (2) `assetBatchUsable` is replaced. (3) The parser accepts every view and a validated array. (4) The Android reader uses 8 MiB and 2 flights. (5) Five suites stub the new predicate. (6) Export-level tests use the real readers. (7) T4a to T4d. (8) More export phases and counts. From Tauri 2.12.1 source, both reply forms occur on Android; not yet seen on a device. Validation costs about 7 ms per 4 Mi elements (`gate1\probe-numbers.mjs`, i9). |
| 2330 | 2026-10-22 | Fix the asset batch harnesses' failure cascade under load, which lane A found in the stage 3 full run | test-warrior | 72,625 | no | `iso\`. Cause: a timed-out wait left the restore's busy entry registered, so later restores were refused ("did not create a file input"). Fix (tests only): afterEach releases every gate and the stream hold, waits up to 2 s for the restore to end, resets the busy registry and fails a leaking test; progress waits are 8 s, under a 20 s per-test timeout. Red: a forced fault on the old desktop file fails 12 of 69, matching lane A; green: the same fault fails 1 of 69. Unforced 69/69 and 14/14, three times and under two processes. `pnpm check` 0/0. Committed as `92f7d900a`. |
| 2331 | 2026-10-22 | Gate 2 r1 of the harness fix | adversarial-reviewer | 51,487 | no | `iso\gate2-r1.md`, `iso\gate2\`. `[APPROVE]`, no binding items. Four more forced faults across both files each failed only their own tests. Both files are CRLF. Non-binding, from the reviewer's hand-back: the old Android afterEach already released its only hold, so the change there is hardening only. Lane A reported, by message, that its full run on `11f3699fd` had no failures in `backuplocalAssetBatch`. |
| 2332 | 2026-10-22 | Verify the `MC-359` and rows 2326 to 2331 draft | doc-verifier | 73,108 | no | 24 claims: 18 verified, 1 overstated, 5 unverifiable (the transcript options, lane A's run, tokens), none wrong. Corrected: the CHORE-129 closure holds only when the sized listing succeeds. The timer wording and two source labels were also fixed. |
| 2333 | 2026-10-22 | Stage 4 implementation | sonnet-coder | 208,084 | no | `s4\impl\report.md` (saved by the orchestrator; the harness refused the coder's write) and the logs. New: `bridgeReplyBytes` (shared with read_range), `isAssetBatchReadAvailable`, `assetBatchReadUsable`, the Android reader limits (8 MiB, 2 flights) and the MEASURE-only export phases; stubs in four test doubles; new `backuplocalExportAndroid.test.ts`. Red on base (an archive of `92f7d900a` with two behavioural shims): 19 of 90 failed. Mutants M1 to M13 killed; M14 survived (that suite refuses before listing). Per-suite read counts unchanged (21/29, 13/13, 8/8, 0/0, 0/0). `pnpm check` 0/0; `pnpm test` 903 files passed, 1 skipped; 20,317 tests passed, 23 skipped; `pnpm build` and `pnpm check:dist` OK. The snapshot line-ending rewrite was restored. After the hand-back the orchestrator changed one comment, the `assetBatchPipeline.ts` module doc, at the coder's request: the file was outside its grant. |
| 2334 | 2026-10-22 | Stage 4 Gate 2 r1 | opus-reviewer | 168,195 | no | `s4\gate2-r1.md`, `s4\gate2\`. `[EDITORIAL]`. No asset leaves the `.bin` unreported; every Gate 1 amendment is met. Targeted 441/441; `pnpm check` 0/0; the read counts match. The coder's reds are behavioural. 15 of its own mutants were run: 14 killed, and the Android 16 MiB budget mutant survived. The existing `dist/` holds no export phase strings. All files are CRLF. E1: the test's bridge stand-in checked missing and large before the spent budget, unlike Rust's `get_batch_with`. The orchestrator applied the reviewer's reorder; afterwards the file passed 14/14 and is CRLF, and `pnpm check` gave 0/0. Non-binding, not done: no test pins the 8 MiB budget, the every-5,000 progress phase is untested, one doc line break in `tauriAssetBatch.ts`, and there is no direct junk-reply read_range test. The full suite was not re-run (`MC-329` 4). |
| 2335 | 2026-10-22 | Verify the stage 4 records and commit message | doc-verifier | 62,205 | no | About 30 claim groups: 25 verified, 2 wrong from one cause, 1 overstated, 5 unverifiable (the orchestrator's E1 rerun, tokens, transcript items). Corrected: the row range named 2335 before this row existed (this row added); the commit message now says Gate 2 ran 15 mutants and killed 14, and the read_range sentence was made exact. Its trailer note was settled by the session's own attribution reminder (Opus 5.5). |

## Handoff

2026-10-21: lane started; worktree clean at `74b28ddd1`; `pnpm install --frozen-lockfile` run in the worktree; this file created.

2026-10-22: stage 1 is implemented and through both gates; it awaits records verification and the maintainer's commit approval. Stage 2 is the slim stage (`MC-357`). PC measurements m1 and m3 are done (`s2\measure\report.md`, a diagnostic run, not yet verified): the tree is about 176 to 181 MiB, `subarray` saves 48.8 MiB, and `console.log` retains the logged graph in headless Chrome. Next: m2 (a WeakRef probe of the tree during the commit, in a scratch test run) once stage 1 is committed, then the stage 2 plan and its Gate 1. (Superseded below; the `subarray` saving is a transient peak saving, per row 2311.)

2026-10-22, later:
- **Stage 1** is COMPLETE (lane A fold-in `ec4799fe4`).
- **Stage 2** is implemented and through both gates, and its records are verified (rows 2307 to 2318). It awaits the maintainer's commit approval.
- **The Note 9 calibration request** for `MC-355` 2 and CHORE-220 is in `device-requests\2026-10-22-stage1-stub-import-calibration.md`. Lane A queued it with CHORE-203 for one release MEASURE session on the second Note 9.
- **Next:** stage 3, parallel large entries (`MC-328` 2).

2026-10-22, stage 3:
- **Stage 2** is COMPLETE (lane A fold-in `ae08fbf07`).
- **Stage 3:** decisions `MC-358`. It is implemented and through both gates (rows 2319 to 2325), with the defaults at 1 stream.
  - It awaits the maintainer's commit approval.
  - After the commit: the Note 9 device request for the stream and flight counts (CHORE-222).
- **Then** stage 4: the Android batched asset reader for export.

2026-10-22, stage 4:
- **Stage 3** is COMPLETE. Lane A folded it in as `11f3699fd`, on top of `42993e408` and the harness fix `92f7d900a` (rows 2330 and 2331), and pushed it. This branch was fast-forwarded to `11f3699fd`.
- **The Note 9 requests** for CHORE-220 (`MC-355` 2) and CHORE-222 are running in lane A's phone 2 session.
- **Stage 4:** decisions `MC-359`. It is implemented and through both gates (rows 2326 to 2335), and CHORE-129 is updated. It awaits the maintainer's commit approval.
  - After the commit, a Note 9 device request re-runs m2 (c), the stub export. It records the asset-loop time, the reply form (the `numberArrayReplies` count) and the tail split.
  - A Rust base64 reply command goes back to the maintainer only if the number-array form proves too slow (`MC-359` 1).
