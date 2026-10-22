# Lane B records: import/export page fixes

Lane rules: [README.md](README.md) and [lane-B-brief.md](lane-B-brief.md). Branch `worktree-Lane-B`, started from `74b28ddd1`, fast-forwarded to `e8fd39618` (records only) on 2026-10-21. IDs: MC-355 to MC-374, CHORE-220 to CHORE-239, ledger rows 2300 to 2499; overflow MC-400 to 409, CHORE-300 to 309, rows 3000 to 3099. Scratch: `%TEMP%\risu-lane-b\`. Ports: 6400 to 6419.

A stage here is at most "technically accepted"; it becomes COMPLETE only after lane A folds these records into the shared files.

## Stages

| Stage | Item | State |
|---|---|---|
| 1 | CHORE-194: import warning and estimate keyed on the database entry | COMPLETE; folded into the shared files by lane A on 2026-10-22, merged as `953f63241` |
| 2 | Read the `.bin` once, decode the database once (`MC-328` 2, `MC-323` lead 6, CHORE-103), replaced by the slim stage (`MC-357`) | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[EDITORIAL]`, E1 applied; records verified (row 2318); rows 2307 to 2318; COMPLETE; folded into the shared files by lane A on 2026-10-22, merged as `165dcf10f` |
| 3 | Parallel large entries (`MC-328` 2), desktop and Android only (`MC-358`) | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[EDITORIAL]`, items applied; defaults stay at 1 stream until the Note 9 run (CHORE-222); rows 2319 to 2325; COMPLETE; folded into the shared files by lane A on 2026-10-22, merged as `42993e408` |
| 4 | Android batched asset reader for export (fit-map E1), and an export phase timer (`MC-359`) | Gate 1 `[APPROVE WITH AMENDMENTS]`; Gate 2 `[EDITORIAL]`, E1 applied; rows 2326 to 2335; technically accepted; Note 9 export run done (row 2337: every batch reply an `ArrayBuffer`, none fell back, so no Rust reply command); COMPLETE; folded into the shared files by lane A on 2026-10-22, merged in `dd9c04679` |

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

### MC-360 — Lane B, 2026-10-22: CHORE-220 answers (unit entries count at a quarter in the import size figure; the figure is decimal MB)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Input: lane A's Note 9 release run (`%TEMP%\risu-b715\phone2-rel\report.md`, part A, with its "Corrections from doc-verifier" section, which verified the A-table and the MiB claim).
- **Related:** `MC-355` 2, `MC-356`, `MC-318` 6; CHORE-194, CHORE-220.

1. **Units: "Count units at ¼ (Recommended)".** The unit entries count at a quarter of their size, because they are uncompressed text and the database entry is compressed.
   - The option text gave the effect: the stub file that showed about 78 MB would show about 28 MB, close to the 30 MB of the same content inline, and in line with the measured memory.
   - It is one constant with no text change, so no translator pass. It is a rough factor calibrated from one pair of files.
   - The question stated the measurements:
     - a stub file showed "about 78 MB", and the same 500 characters inline showed "about 30 MB";
     - the import memory peaks were 723 and 642 MiB, and the post-reload peak was no worse;
     - the import took 207 s against 140 s;
     - the stub file's database alone (10 MB) would show no warning, yet its import used more memory than the 30 MB one's.

   Not chosen: "Reword the sentence" (keep the number and drop "several times that much memory", with a translator pass) and "Keep as is".
2. **Label: "Compute decimal MB (Recommended)".** The number shown with "MB" is bytes ÷ 1,000,000, matching file managers. The numbered-backup restore uses the same formatter, and the 16 MiB threshold stays. It is one line with no text change. Not chosen: "Leave it".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- **The orchestrator's ruling, not asked:** the quarter weight applies to the size figure only:
  - the 16 MiB trigger;
  - the shown number;
  - the time notice's database sentence.
  
  The import-time estimate keeps the full unit bytes, because the units took real resolve time on the phone (66 s). CHORE-220 Gate 2 accepted the ruling.
- Under the new rule the Note 9 stub file is about 28 MB weighted, so it still warns. It shows 28 or 29: Gate 2 computed 29 from the approximate 10.4 and 71 MB, and the device's 78 MiB bounds the result to 28 or 29.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-361 — Lane B, 2026-10-22: CHORE-222 answers (the Android restore copies 2 large entries at once with 4 batches in flight; a finishing message during the drain; the one-at-a-time path stays)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs:
  - lane A's Note 9 release run (`%TEMP%\risu-b715\phone2-rel\report.md`, part B and its corrections);
  - `%TEMP%\risu-lane-b\c222\packet.md` (investigator), superseded where they differ by `packet-verify.md` (`doc-verifier`: 36 of 41 verified, 0 wrong).
- **Related:** `MC-358`, `MC-328` 2, `MC-326` 4; CHORE-222.

1. **Defaults: "Android 2 at once, 4 batches (Recommended)".** The Android restore defaults to 2 large-entry streams with 4 batch calls in flight. The desktop stays at 1, with no desktop measurement; that test backup has no asset large enough to stream there.
   - Before it ships:
     - a PC test that restores a phone-like mix at 2,4 and 4,4 and checks every asset byte for byte;
     - the missing refused-name test;
     - one Note 9 debug-build run at 2,4 that checks the restored assets on the phone.
   - The question stated:
     - the copy of a 1.2 GiB backup took 212 s today, 78 s at 2 at once with 4 batches, and 71 s at 4 at once with 4 batches;
     - memory during the copy rose only slightly;
     - most of the gain probably comes from no longer pausing all other work before each large file, and 2 to 4 added only 5 to 10%;
     - no phone run proved the import completed correctly.
   
   Not chosen: "Android 4 at once, 4 batches", "Measure first" (a phone run of one stream through the new path) and "Keep at 1".
2. **Progress: "Show a finishing message (Recommended)".** Once every entry has been read, the text switches to a separate message, such as "Finishing copying files...", until the copies end. It is plain English like the neighbouring progress texts, so there is no translator pass. Not chosen: "Stop below 100%", "Count finished bytes" and "Leave it".
3. **Old path: "Keep it (Recommended)".** The literal one-at-a-time path stays as the desktop default and the instant fallback. Not chosen: "Delete it".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- **Corrections to the question's figures:**
  - "212 s" is R1a; R1b was 219 s.
  - The "4 s" hold at 100% was observed as `100.00%` only in R5 and R6 (`packet-verify.md`).
- The phone runs are n=1 per combination on one Note 9, screen on. Completion was not established in them; the prerequisites above exist for that reason.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-362 — Lane B, 2026-10-22: CHORE-223 answers (measure the slow export steps first; release each character's data once it is written)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs:
  - lane A's Note 9 release run of the stage 4 export (`%TEMP%\risu-b715\phone1-s4\report.md`, with its corrections; row 2337);
  - `%TEMP%\risu-lane-b\c223\packet.md` (investigator), superseded where they differ by `packet-verify.md` (`doc-verifier`: 19 of 24 verified, corrections 1 to 4).
- **Related:** `MC-359`, `MC-328` 2; CHORE-223.

1. **Next step: "Measure first (Recommended)".** Add timing marks that are compiled out of normal builds: each file-write call's bytes and milliseconds, and step A split into reading and encoding. Then one Note 9 export run. The change makes no behaviour change apart from item 2. The run should tell whether the write slowness comes from the save-dialog path or the storage, and whether step A waits on reads or on the phone's CPU. A targeted fix follows the run.
   - The question stated:
     - an Android export of 500 characters and 3,000 assets took about 112 to 119 s from Save to complete on the Note 9 release build;
     - three slow parts lie outside the 10 s asset copy: (A) about 82 s before the save dialog, reading the 500 characters one at a time; (B) about 80 to 90 s writing 71 MB of character data; (C) about 14 s writing the 10 MB database;
     - B and C run under 1 MB/s through the app's file-write call, cause unknown.
   
   Not chosen: "Fix step A now" (read 2 to 4 characters ahead) and "Record only".
2. **Memory: "Include it (Recommended)".** Free each character's data as soon as it is written. It ships with the item 1 change, and the same phone run shows whether the memory peak drops. The question stated that the export holds all 71 MB of character data until it finishes, that the 1,337 MiB peak fell during that writing step, and that the link to the peak is likely but not measured. Not chosen: "Not now".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- **Corrections to the question's figures** (`packet-verify.md`): step C is four or more `writeFile` calls, not three; `late.payloads` being empty is inferred from the entry count and the fixture.
- The phone figures are n=2 on one Note 9 (row 2337); run 1 had lmkd reclaiming system processes, and run 2 was warm.
- Nothing here authorizes application-code edits, commits or pushes.

## CHORE entries

### CHORE-194 (changed) — The import size and time warning is keyed on the database entry, which comes out low for stub-form files

**Status (2026-10-22, lane B stage 1): fixed on `worktree-Lane-B`, technically accepted once the records are verified and the commit is approved; uncommitted. The Note 9 calibration is open under CHORE-220 (`MC-355` 2).** Ledger rows 2300 to 2306.

- **What changed:** `ColdEntryIndex.estimatedUnitBytes` (`src/ts/storage/store2/legacy/binReader.ts`) sums the `dataLength` of the entry the reader tries first per id (the last noted place): a name-only estimate that over-counts orphan units and rejected bodies, and under-counts units served from the page or the old profile and units served by an earlier entry. `confirmImportScale` (`src/ts/drive/storeImport.ts`) takes it as a fourth argument from its one call in `backuplocal.ts`; the 16 MiB size sentence and the long-tail key use the database entry plus that estimate. The 1 GiB Android trigger, the copy time and the free-space figure still use the file size less the database entry, so the units stay in them. The numbered-backup restore (`storeRestore.ts`, `confirmDatabaseSize`) is unchanged and keeps the database bytes. The sentence reads "The saved data in this backup, not counting images and other files, is about N MB" in English and six locales (`MC-356`).
- **Unchanged case:** a file without unit entries gets the same prompts and figures as before. A fork inline export with plugin-storage units or an upstream file with cold-chat units now counts them.
- **Not done:** the upstream `.bin` round trip was not run, because no read or write path changed (reasoning by the plan and both gates, not execution). The Note 9 figure (`MC-355` 2) and the mixed byte basis (CHORE-220) remain.
- **Related:** `MC-355`, `MC-356`, `MC-318` 6; CHORE-220.

### CHORE-220 — The import size warning sums compressed database bytes with uncompressed unit bytes, so a stub-form file warns earlier and shows a larger number

**Status (2026-10-22, `MC-360`): fixed on `worktree-Lane-B`; technically accepted, Gate 2 `[APPROVE]`; COMPLETE (folded into the shared files by lane A on 2026-10-22, merged in `888c20283`).** Ledger rows 2336, 2341 and 2342.
- **The Note 9 check** (lane A's release run, verified):
  - a stub file showed "about 78 MB" and the same content inline "about 30 MB";
  - the import memory peaks were 723 and 642 MiB;
  - the import took 207 s against 140 s;
  - "78" was MiB labelled MB.
- **What changed:**
  - `importSavedDataSizeBytes` (`src/ts/drive/storeImport.ts`) counts the unit entries at `UNIT_SIZE_WEIGHT` (0.25) for the 16 MiB trigger, the shown number and the time notice's database sentence.
  - `estimateImportSeconds` keeps the full unit bytes.
  - The shown figure is decimal MB (`Math.ceil(bytes / 1_000_000)`), in both warnings and the numbered-backup restore.
  - No string changed.
- **Effect:** the Note 9 stub file now shows 28 or 29, and still warns.

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

**Status (2026-10-22, latest): fixed.** Lane A's Note 9 debug-build check of `af735c916` passed (`%TEMP%\risu-lane-b\device-requests\2026-10-22-chore222-android-defaults.result.md`): from a fresh profile at the default, `m2-mix18k.bin` restored 18,000 of 18,000 assets with every name, sha256 and size matching (1,275,826,695 B); `assets/` has no `risu-write-*` or `.tmp` files (the rest of app data was not listed); no crash or ANR. The maintainer accepted it as meeting `MC-361` 1 (relayed by lane A, 2026-10-22). Lane A is to record it as `MC-342` (relayed; not in this checkout), with its own run and verification rows. Two recorded limits:
- "import committed" was not observed; the commit is inferred from store2 growing by exactly the 6,442 planned units and the page reloading after the commit began;
- "Finishing copying files..." was not seen in any of 275 polls, so the phone did not exercise it. The unobserved window was at most about 3.7 s; a drain of a few seconds or none fits. The PC tests (T4) cover the message.

**Status (2026-10-22, later, `MC-361`): in progress.** The Note 9 run is done (row 2336), and the maintainer chose:
- 2 streams with 4 flights on Android;
- the desktop stays at 1;
- a finishing message during the drain;
- the literal path is kept.

The plan is `%TEMP%\risu-lane-b\c222\plan.md`, at Gate 1 (opus-reviewer). The default does not ship before the PC completion test, the refused-name test above 1 stream, and a Note 9 debug-build check of the restored assets.

**Status (2026-10-22, implemented): technically accepted on the PC, pending the Note 9 debug-build check (`MC-361` 1).** The change is merged (folded into the shared files by lane A on 2026-10-22, merged in `af735c916`); the Note 9 check is pending. Ledger rows 2344 to 2348.
- **The defaults** (`src/ts/drive/backuplocal.ts`): `ANDROID_ASSET_MAX_STREAMS` 2 and Android `maxFlights` 4. The desktop keeps `ASSET_MAX_STREAMS` 1 and the literal `streamAlone` path. The MEASURE knob still overrides both.
- **The finishing message:** "Finishing copying files..." shows immediately before the drain, only when nothing stopped or failed, the source is unchanged, and the pipeline has work outstanding (`RestoreAssetPipeline.outstanding`: streams, calls or an unsent batch).
  - On the tail without store2, `Loading backup...` replaces it before the commit.
  - The store2 and boot `Loading backup...` calls are unmoved.
  - Web and Node pages without store2 now show `Loading backup...` during the decode instead of the last percentage. This is cosmetic.
- **The PC prerequisites are met:**
  - a phone-like 60-entry mix restores byte-exact at 2,4, at 4,4 and at the default, with the stream cap reached and completeness checked inside the install (T2);
  - a refused name above 1 stream is reported (T3; the existing streamed refused-name test also kills r7 at the default).
- **The stage 3 survivors:** r3 is now killed (T6); r7 is killed.
- **Open:**
  - **The Note 9 debug-build check** (`%TEMP%\risu-lane-b\device-requests\2026-10-22-chore222-android-defaults.md`), routed through the maintainer, because both phones are booked.
  - **Untested condition terms:** removing `!sourceChanged` (m9b), `stopMessage === null` (g5) or `passFailure === null` (g6) from the message condition leaves every test passing.
    - The consequence: a "Finishing copying files..." flash before the correct error, with nothing installed.
    - Gate 2 executed m9b with a 30 ms database read, as a WebView `Blob.arrayBuffer` would take, and saw the flash. So the window is not only a microtask.
    - Optional tests were named by Gate 2. They are not added.

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

### CHORE-223 — An Android stub export spends most of its time in two steps outside the asset loop ('export start' to 'export cold collected'; 'export database encoded' to 'export stub and late payloads done')

**Status (2026-10-22, `MC-362`): in progress. The measurement and the memory release are implemented on `worktree-Lane-B` and technically accepted on the PC (Gate 2 `[APPROVE]`); uncommitted until the maintainer approves. The Note 9 run is pending.** Ledger rows 2337 and 2349 to 2356.
- **Mechanism, verified** (`c223\packet.md` with `packet-verify.md`):
  - step A, 'export start' to 'export cold collected': `readStubsForExport` reads the 500 characters one at a time; `readUnits` reads each character's pieces with 8 workers, one `read_range` call per piece; each character is re-encoded as JSON;
  - steps B and C: the writes run at about 0.7 to 0.9 MB/s through plugin-fs `writeFile` in append mode with a 4 MiB buffer. That the per-call write cost causes B and C is inferred, not measured;
  - `get_assets_batch` refuses keys outside `assets/`, so batching step A needs Rust.
- **What changed:**
  - **Measurement** (MEASURE builds only, `import.meta.env.DEV || VITE_RISU_MEASURE==='1'`; folded out of release builds). It is appended to the existing export notes in `src/ts/drive/backuplocal.ts`:
    - 'export cold collected' carries the stub read and encode times (`readStubsForExport`, `src/ts/drive/exportInline.ts`) and the `read_range` calls, total time, wall time with any call in flight, and the `store2/` share (`src/ts/storage/tauriByteTransport.ts`);
    - 'export stub and late payloads done', 'export database written' and 'export closed' carry each `writeFile` call's bytes, the time until the call returns its promise, and the wait (`TauriWriter.put`, `src/ts/exportWriters.ts`). Up to 25 calls are listed, otherwise the cheapest and dearest.
    - A failing clock never fails an export or a read. `util/checkReleaseDist.mjs` gains four field markers.
  - **Memory release:** `writeStubPayloadsAndRelease` writes each stub payload and then drops it from the returned array, and clears `cold.stubEntries` once, only after `encodeDatabaseWithLateColdStorage` returns, in both the full and the partial export. Only references are dropped. Leftover: a partial export that leaves out an oversize item keeps the original map alive through `collected`.
  - The backup file is unchanged; in a MEASURE build it is byte-identical with the measurement key on and off (tests).
- **Not proved:** the native writer, the Android bridge, and any phone timing or memory effect. The PC harness mocks Tauri fs.
- **Open:**
  - **The Note 9 run:** a release `VITE_RISU_MEASURE=1` export of `m2-stub500.bin`, n=2, with the new fields, a CDP `write_file` timing to an `$APPDATA` scratch path, and the PSS during steps B and C by process. Routed through the maintainer once committed.
  - **Untested, measurement only** (Gate 2 N1, N2): the write-stats reset before 'export database encoded' and the retry-read timing survive mutants. N3 to N5 (row 2355) are low-impact and not done.

**Status (2026-10-22): open, candidate; not scheduled.** Source: lane A's Note 9 run of the stage 4 export (`%TEMP%\risu-b715\phone1-s4\report.md`, with its corrections). That run was a release build of `18156c972`, with `m2-stub500.bin`. It was imported inline and exported as 500 stub characters with 3,000 assets. n=2: lmkd reclaimed system processes during run 1's asset loop, and run 2 was warm on the same page.

- **Measured** (from the export phase ring):
  - confirm to the save dialog: about 83.5 s, nearly all of it 'export start' to 'export cold collected' (81.8 and 82.2 s);
  - the asset loop: 9.6 and 11.5 s;
  - 'export database encoded' to 'export stub and late payloads done': 90.8 and 78.9 s;
  - Save to complete: 119.0 and 112.1 s.
- **Not examined:** the mechanism of either long step. The ring has no finer marks inside them.
- **Next, if scheduled:** a sizing of both steps (cold collection of 500 units, then re-reading and writing the stub and late payloads). It needs the maintainer's go-ahead.
- **Related:** `MC-359`, `MC-334`, `MC-328` 2.

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
| 2336 | 2026-10-22 | Note 9 phone 2, release `VITE_RISU_MEASURE=1` of `42993e408`: the stage 1 calibration (CHORE-220) and the stage 3 stream counts (CHORE-222) | lane A device agent, with a doc-verifier | not recorded (lane A's) | no | `%TEMP%\risu-b715\phone2-rel\report.md`. CDP works on a plain release build.<br>**CHORE-220:** shown 78 (stub) and 30 (inline), and the figure is MiB; resolve 66 s against about 0 s; peaks 723 and 642 MiB.<br>**CHORE-222:** copy R1 212/219 s, R2 89, R3 84, R4 78, R5 71, R6 83; the copy-window PSS rose slightly.<br>**Verifier corrections:** completion was not established for R1 to R6; lmkd reclaimed other apps in R1a; the CHORE-203 1.5x is confounded by the commit change. |
| 2337 | 2026-10-22 | Note 9 phone 1, release `VITE_RISU_MEASURE=1` of `18156c972`: the stage 4 export of `m2-stub500.bin` | lane A device agent, with a doc-verifier | not recorded (lane A's) | no | `%TEMP%\risu-b715\phone1-s4\report.md`.<br>**Both runs:** `export assets done, batched=3000 fallback=0 missing=0 numberArrayReplies=0`.<br>**Times:** asset loop 9.6 and 11.5 s; Save to complete 119.0 and 112.1 s, against m2 (c)'s 616.4 s, which was a debug build of another commit on another phone and profile (the verifier lists the confounds).<br>**PSS:** 1,336.9 MiB at one sample.<br>**Completion:** file decoded with 3,501 entries, 3,000 assets and 500 units.<br>No reason for a Rust base64 reply (`MC-359` 1). The long steps outside the loop became candidate CHORE-223. |
| 2338 | 2026-10-22 | CHORE-222: why did 1 to 2 streams cut the copy 2.4x; how to prove completion; the prerequisites | investigator | 191,240 | no | `c222\packet.md`. The `streamAlone` barrier (flush and wait for all flights before each large entry) against none in `streamBeside`. 2 to 4 streams gave 5 to 10%. The slowdown follows the fixture's large entries, not loop growth. A desktop run would not stream m2-mix18k. PC proof: the Android harness at 2,2 and 4,4 with a phone-shaped mix (the plan uses 2,4 and 4,4). Sized (a), (b) and (c). |
| 2339 | 2026-10-22 | Verify the CHORE-222 packet | doc-verifier | 80,245 | no | `c222\packet-verify.md` (saved by the orchestrator). 41 sub-claims: 36 verified, 3 imprecise, 0 wrong. Corrected: 100.00% was seen only in R5 and R6; the share of time in large entries is 40 to 66%; a citation path; the comment ranges. It fed `MC-361`. |
| 2340 | 2026-10-22 | CHORE-222 plan | orchestrator | not recorded | no | `c222\plan.md`. C1: the Android limits 2 and 4. C2: an `outstanding` getter and "Finishing copying files..." on the normal end only. Tests T1 to T5; mutants 1 to 7; a device run-as hash check after the commit. At Gate 1. |
| 2341 | 2026-10-22 | CHORE-220 implementation | sonnet-coder | 79,350 | no | `c220\impl\report.md` (saved by the orchestrator) and the logs. `UNIT_SIZE_WEIGHT` and `importSavedDataSizeBytes`; decimal MB; the time estimate on the full sum. Red on base: a load hook serving HEAD's `storeImport.ts`; 13 of 103 failed, on assertion diffs. Mutants weight=1, time-weighted, 2^20 and db-weighted were each red. `pnpm check` 0/0; `pnpm test` 903 files passed, 1 skipped; 20,318 tests passed, 23 skipped; `pnpm build` exit 0. The snapshot line-ending rewrite was restored. |
| 2342 | 2026-10-22 | CHORE-220 Gate 2 r1 | adversarial-reviewer | 52,846 | no | `c220\gate2-r1.md` (saved by the orchestrator). `[APPROVE]`, no binding items. Callers: `confirmImportScale` (one call) and `confirmDatabaseSize` (it and `storeRestore.ts`). The base hash matches HEAD. Base: 13 red. Mutants time-weighted (2 red) and db-weighted (12 red) were re-run. The Note 9 stub file still warns (29). Non-binding: no test drives a real-exporter stub file to a warning. All five files are CRLF; `pnpm check` 0/0. |
| 2343 | 2026-10-22 | Verify the CHORE-220 records and commit message, and the records of rows 2336 to 2342 | doc-verifier | 82,892 | no | About 60 claim groups: 49 verified, 3 corrected, 8 unverifiable (the transcript, tokens, lane A's agents). Corrected: row 2338's knob values (the packet says 2,2 and 4,4); the CHORE-223 title, which claimed the mechanisms; the commit message's row range. Also applied: the fixture wording and the confounds in CHORE-223, and "28 or 29" for the stub file's figure. Its trailer note was settled by the session's own attribution reminder (Opus 5.5). |
| 2344 | 2026-10-22 | CHORE-222 Gate 1 r1 | opus-reviewer | 186,062 | no | `c222\gate1-r1.md`, `c222\gate1\`. `[REJECT]`, 8 binding items (B1 to B8). The mechanism needs no redesign. Executed: the r1 message condition showed the message after a batch failure (B1); the tail without store2 kept it through the commit (B2); three existing tests assert the old Android default, and one fails only when run alone (B3). The tests could not kill their mutants (B4). New T6 kills r3 (B5). T4 additions and wording (B6, B7). The device check details (B8). |
| 2345 | 2026-10-22 | CHORE-222 Gate 1 r2, a targeted re-check of the revised plan section | opus-reviewer (the same instance, resumed) | 196,550 cumulative with r1 | no | `c222\gate1-r2.md`. `[APPROVE]`. The B2 placement (before `if(!pendingDatabase){`) was executed: drive plus restore tests 1316 of 1317 in its scratch copy, and the one failure is B3a, before B3a was rewritten. Notes adopted: the exact placement, and four withdrawn r1 passages marked. This is the second consecutive round, not a third rejection. |
| 2346 | 2026-10-22 | CHORE-222 implementation | sonnet-coder | 182,909 | no | `c222\impl\report.md` (saved by the orchestrator) and the logs.<br>**Code:** `ANDROID_ASSET_MAX_STREAMS` 2 and `maxFlights` 4; `outstanding`; the finishing message under the B1 condition; the tail `Loading backup...`.<br>**Tests:** B3 (a) to (c) rewritten; T1, T2, T3, T4 and T6 added.<br>**Red on base:** 10 of 238 (6 behavioural; 4 for the missing `outstanding` property, which do not count as reproducers). Guards are labelled.<br>**Mutants:** m1 to m12 killed; m9b survived.<br>**Checks:** `pnpm check` 0/0. Full `pnpm test`: run 1 had 2 failures in unrelated files, which pass alone; run 2 had 903 files passed, 1 skipped, and 20,335 tests passed, 23 skipped. The first drive run lost a worker, unexplained, and 4 reruns were clean. `pnpm build` and `check:dist` OK. The snapshot line-ending rewrite was restored. |
| 2347 | 2026-10-22 | CHORE-222 Gate 2 r1 | opus-reviewer | 187,350 | no | `c222\gate2-r1.md`, `c222\gate2\`. `[EDITORIAL]`.<br>**Safety:** no loss, reorder or early install. B1 to B7 are met after E1 and E2; B8 belongs to the device brief.<br>**Executed:**<br>- red on base 10 of 238;<br>- its own mutants g1 to g4, g8 to g10 killed;<br>- g5 and g6 survive, and so does m9b. A 30 ms database-read probe shows m9b's window is real outside happy-dom; the effect is a cosmetic flash before the correct error.<br>**Runs:** drive 1320/1320 with no worker loss; the two unrelated tests pass alone; `pnpm check` 0/0. No link to the flaky signals: every hold is released in afterEach.<br>**E1:** the T4 source-stop comment named only one term.<br>**E2:** the class-doc bound is `(maxFlights + 1) x batchBytes` at most `budgetBytes`, shown by a probe.<br>The orchestrator applied both; afterwards the 3 affected test files passed 108/108, and line endings are unchanged.<br>Non-binding, not done: tests for g5, g6 and m9b; labelling the `outstanding` unit tests; the T6 comment wording; B3(c) is killed by neither mutant (covered elsewhere). The full suite was not re-run (`MC-329` 4). |
| 2348 | 2026-10-22 | Verify the CHORE-222 records, commit message and device request | doc-verifier | 86,809 | no | About 55 claim groups: 49 verified, 2 overstated (one issue), 0 wrong, 4 unverifiable (tokens, the orchestrator's 108/108 rerun, the trailer). Corrected: row 2347 now says "B1 to B7 after E1 and E2; B8 is the device brief"; row 2345's 1316 of 1317 is the scratch run before B3a. It confirmed the device request covers every B8 item, and the fixture facts by `walk.js`: 1,331,537,701 B; 18,000 assets, 173 of them above 1 MiB. |
| 2349 | 2026-10-22 | CHORE-223: what are the slow export steps outside the asset loop? | investigator | 138,290 | no | `c223\packet.md`. Step A: serial `readStubsForExport`, `readUnits` with 8 workers, one `read_range` per unit, JSON re-encode. Steps B and C: about 0.7 to 0.9 MB/s through plugin-fs `writeFile` append. `get_assets_batch` refuses non-`assets/` keys. `cold.stubEntries` is held to the end. |
| 2350 | 2026-10-22 | Verify the CHORE-223 packet | doc-verifier | 68,514 | no | `c223\packet-verify.md` (saved by the orchestrator). 24 sub-claims: 19 verified, 2 overstated, 1 wrong (minor), 2 inferred and reasonable. Corrected: `late.payloads` empty is inferred; step C is four or more calls; the release must drop `stubPayloads` too; `readUnits` is not export-local. It fed `MC-362`. |
| 2351 | 2026-10-22 | CHORE-223 plan | orchestrator | not recorded | no | `c223\plan.md`. C1 writer timing, C2 stub and range read timing, C3 the notes, C4 the release; tests T1 to T4; the Note 9 step. Revised as r2 after Gate 1 r1; its top section is binding. |
| 2352 | 2026-10-22 | CHORE-223 Gate 1 r1 | opus-reviewer | 183,159 | no | `c223\gate1-r1.md`, `c223\gate1\`. `[REJECT]`, 3 binding items. B1: the release mechanism (shift on the returned array, not a copy; one `cold.stubEntries = new Map()`, never re-pointing the local; strictly after the encode, or a stub is silently written without its unit; the loop total taken first; references only; one helper). B2: the tests and mutants. B3: the measurement (each write call's time to return its promise and its wait; the range reads' in-flight wall time and `store2/` share; a device write timing and a memory comparison). Diagnostic: `gate1\retain.mjs` in Node (A to E). |
| 2353 | 2026-10-22 | CHORE-223 Gate 1 r2, a targeted re-check of the revised plan section | opus-reviewer (the same instance, resumed) | 192,943 cumulative with r1 | no | `c223\gate1-r2.md`. `[APPROVE]`. B1 to B3 met in the r2 top section; no source or tests re-run. This is the second round, not a third rejection. |
| 2354 | 2026-10-22 | CHORE-223 implementation | sonnet-coder | 241,059 | no | `c223\impl\report.md` (saved by the orchestrator), `report-addendum.md` and the logs.<br>**Code:** `takeExportWriteStats`, `takeStubReadStats`, `takeRangeReadStats` and their test seams; `writeStubPayloadsAndRelease`; the note fields; four dist markers.<br>**Tests:** new `exportStubRelease.test.ts` (6) and `exportMeasure.test.ts` (6); +5 in `exportWriters.test.ts`, +6 in `tauriByteTransport.test.ts`.<br>**Red on base** (scratch load hook): `exportStubRelease` 4 of 6, both reproducers for the full and partial export; 2 guards pass. `exportMeasure` cannot run on base (new seams), so it is not a reproducer.<br>**Mutants:** m1 to m6 and 15 measurement mutants killed.<br>**Amendment:** the first full run failed 1 test, `backuplocalExportAndroid.test.ts`, which compared the whole phase list; the grant was amended to that file, and the appended fields are stripped before the comparison, with their presence asserted.<br>**Checks:** `pnpm check` 0/0; full `pnpm test` 912 files passed, 1 skipped; 20,570 tests passed, 23 skipped; `pnpm build` and `check:dist` OK (before the test-only amendment); no new field name in `dist`. The snapshot line-ending rewrite was restored. |
| 2355 | 2026-10-22 | CHORE-223 Gate 2 r1 | opus-reviewer | 160,291 | no | `c223\gate2-r1.md`, `c223\gate2\`. `[APPROVE]`, no binding items. The helper runs only after the encode, at both callers; nothing reads `stubEntries` afterwards. `put` keeps create, append and rethrow. The existing `dist` folds the stats to no-ops; `check:dist` re-run OK. Red on base 4 of 6 for the intended reasons. Its own 9 mutants were killed. Targeted 264 + 142 passed; `pnpm check` 0/0. All 10 files CRLF. Non-binding, not done: N1 the pre-encode write-stats reset is untested (g5 survives); N2 the retry-read timing is untested (g9); N3 a reproducer title also holds on base; N4 a taken in-flight window can count twice when the clock throws; N5 two export names stay in the dist chunk with no-op bodies. The full suite was not re-run (`MC-329` 4). |
| 2356 | 2026-10-22 | Verify the CHORE-223 records and commit message, and the CHORE-222 status | doc-verifier | 70,446 | no | About 60 claim groups: 54 verified, 2 overstated, 4 unverifiable (tokens, the trailer, lane A's `MC-342`), 0 wrong. Corrected in CHORE-222's status: the temp-file check covers `assets/` only; the 3.7 s is the longest unobserved window, not the poll spacing; `MC-342` is relayed and not in this checkout. Also applied: N3 to N5 named in CHORE-223's open list. Its trailer note was settled by the session's own attribution reminder (Opus 5.5). |

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

2026-10-22, after stage 4:
- **Stage 4** is COMPLETE (lane A fold-in `b7f2be85d`). Its Note 9 run (row 2337) saw only `ArrayBuffer` replies and no fallbacks, so no Rust reply command is needed. The long steps outside the asset loop are candidate CHORE-223.
- **CHORE-220:** decisions `MC-360`. It is implemented and through Gate 2 (rows 2336, 2341 and 2342); COMPLETE (folded into the shared files by lane A on 2026-10-22, merged in `888c20283`).
- **CHORE-222:** decisions `MC-361` (rows 2336 and 2338 to 2340). Its plan is at Gate 1, and the implementation starts after the CHORE-220 commit (one writer per checkout). After that commit, a Note 9 debug-build device request checks the restored assets with run-as. (Superseded below.)

2026-10-22, CHORE-222:
- **CHORE-222:** Gate 1 `[REJECT]` and then `[APPROVE]` in round 2; implemented; Gate 2 `[EDITORIAL]`, E1 and E2 applied (rows 2344 to 2348). It is merged (folded into the shared files by lane A on 2026-10-22, merged in `af735c916`); the Note 9 check is pending.
- **After the commit:** the Note 9 debug-build check of the restored assets, routed through the maintainer.

2026-10-22, CHORE-223:
- **CHORE-222** is fixed: the Note 9 check passed and the maintainer accepted it (lane A's `MC-342`).
- **CHORE-223:** decisions `MC-362`. Gate 1 `[REJECT]` and then `[APPROVE]` in round 2; implemented; Gate 2 `[APPROVE]` (rows 2349 to 2356). It awaits the maintainer's commit approval.
- **After the commit:** the Note 9 release MEASURE export run, routed through the maintainer. A targeted fix of steps A to C follows its figures.
- **CHORE-221** remains an unscheduled candidate.
