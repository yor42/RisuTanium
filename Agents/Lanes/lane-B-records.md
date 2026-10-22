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

### MC-363 — Lane B, 2026-10-22: CHORE-223 next steps after the Note 9 measurement (size both fixes; probe on the phone before a design; apply character defaults when a stored character opens)

- **Tag:** decisions (two `AskUserQuestion` rounds, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs:
  - lane A's Note 9 measurement of `cbd256917` (`%TEMP%\risu-lane-b\device-requests\2026-10-22-chore223-export-measure.result.md`; lane A reported it doc-verified);
  - for round 2, `%TEMP%\risu-lane-b\c223\sizing2.md` (investigator), superseded where they differ by `sizing2-verify.md` (`doc-verifier`).
- **Related:** `MC-362`, `MC-359`, `MC-326` 4; CHORE-223, CHORE-224.

Round 1:
1. **"Size both fixes (Recommended)".** One investigation, no code: whether the export's writes can reuse the import's fast write path (or a similar command) for the file picked in the save dialog, and whether the character reads can be batched like the asset reads. It returns a plan with expected savings and the Rust involved, for approval before any implementation. Not chosen: "Size the write fix only" and "Record only".
2. **"Check the alert in the sizing (Recommended)".** The same investigation checks whether opening a stored character can throw with real character data or only with the synthetic data. The memory release stays as it is, and the record notes that the peak lies elsewhere. No phone re-run for the 3,501 count. Not chosen: "Also re-run the phone" and "Leave both".

Round 2:
3. **"Phone measurement first (Recommended)".** A short measurement with no Rust: on the Note 9, time the app's existing fast write command against the current write call, one at a time and several at once, and how many character reads can usefully run at once. One phone run through lane A; then a plan with a design the numbers support. Not chosen: "Build the small command now" and "Stop here".
4. **"Fill in defaults on open (Recommended)".** When a stored character is opened, apply the same default fields the app applies at startup and card import. A small separate item (CHORE-224) with its own review; no change to the backup format. Not chosen: "Scan a real backup first" and "Fix the test data only".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- Round 2's question stated the save-to-complete range "from ~119 s to somewhere between ~75 s and ~30 s"; the ~30 s end holds only if the per-call wait also goes (`sizing2-verify.md`).
- The stage 0 probes run from CDP against the installed build, so item 3 needs no app-code change (`device-requests\2026-10-22-chore223-stage0-probes.md`).
- Nothing here authorizes application-code edits, commits or pushes.

### MC-364 — Lane B, 2026-10-22: CHORE-224 scope (plugins and MCP get the defaults too; a group without members gets an empty list)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs: `%TEMP%\risu-lane-b\c224\sizing.md` (investigator), superseded where they differ by `c224\sizing-verify.md` (`doc-verifier`).
- **Related:** `MC-363` 4, `MC-175`; CHORE-224.

1. **Plugins and MCP: "Cover them too (Recommended)".** One more call in the plugin and MCP access path, so a plugin reading or editing a stored character never hits the missing field. Same review, a few more tests. Not chosen: "Screen only".
2. **Groups: "Fill in an empty list (Recommended)".** Opening a group stored without its member list gives it an empty member list instead of crashing; no change for groups that have members. Not chosen: "Leave groups".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- The plan (`c224\plan.md`) applies item 1 to the write path (`restoreArchivedForWrite`) and, only if no export reads through it, to the copy `readArchivedCharacter` returns; exports stay verbatim (`MC-175`).
- Nothing here authorizes application-code edits, commits or pushes.

### MC-365 — Lane B, 2026-10-22: CHORE-223 fix design (a text-encoded write command, read-ahead, and a Rust batch read of stored character data)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs: lane A's stage 0 probes (`%TEMP%\risu-lane-b\device-requests\2026-10-22-chore223-stage0-probes.result.md` with `probes.json`; lane A reported its doc-verifier corrections appended), and `c223\sizing2.md` with `sizing2-verify.md`.
- **Related:** `MC-363`, `MC-362`, `MC-345`; CHORE-223.

1. **"Also batch reads in Rust".** Plan three parts:
   - a small Rust command that appends text-encoded bytes to the picked file (no number lists), with one line in the shared command list;
   - reading 2 to 4 characters ahead, in TypeScript;
   - a Rust batch read for stored character data, which touches the shared read path used by startup and saving: a larger review, and a more certain read gain.
   
   Not chosen: "Text write + read-ahead (Recommended)" (without the Rust batch read) and "Probe more first".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- The question stated: the write's per-byte cost (about 0.45 ms per KB on the page) is real; the flat ~3 s wait did not reproduce on its own and probably comes from load during the export; more reads at once help (about 5x from 1 to 16 at once, on small warm files); the export has about 7 reads in flight per character today.
- Corrections to the question's figures (records verification): the probes timed whole `write_file` calls, about 0.45 to 0.65 ms per KB per call (1.5 to 2.2 MiB/s); the page-side share is inferred, not timed. The export issues about 7 reads per character through 8 workers, with about 4 in flight on average as measured.
- Lane A's verification limits these readings: the probe writes were not durable and not to the save target, and the read scaling holds only for warm 8 to 64 KiB files.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-366 — Lane B, 2026-10-22: store2 stage 5a scope (automatic clean-up of store2 leftovers only; the asset file-count limit waits for 5b; no off switch)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs: `%TEMP%\risu-lane-b\s5a\sizing.md` (investigator), superseded where they differ by `s5a\sizing-verify.md` (`doc-verifier`: 24 claims, 17 verified, corrections C1 to C4, omissions O1 to O5).
- **Related:** `MC-345` (A2; amends nothing), `MC-288`, `MC-289`, `MC-290` U9, `MC-315` W5-Q6, `MC-316` W5-Q7/Q8, `MC-314` W4-Q7.

1. **Scope: "Leftovers only (Recommended)".** Stage 5a turns on automatic clean-up of the new storage's internal leftovers only (old saved versions nothing refers to): about 150 to 200 lines, no Rust, no screen. Assets and inline images stay untouched until 5b. The question stated that the space it frees on the maintainer's data is unmeasured and may be little, and that the 5a/5b split never said where asset clean-up belongs. Not chosen: "Also build asset clean-up".
2. **The asset file-count limit: "Decide with 5b (Recommended)".** The placeholder limit (50,000) stays until the asset clean-up is planned in 5b. The question stated that the maintainer's save lists about 383,000 asset entries (roughly 32 GiB), so the asset clean-up would not run automatically for them until this is decided. Not chosen: "Raise it for large libraries" and "Button only above it".
3. **Off switch: "No switch; .bin is the fallback (Recommended)".** No off switch. Safety rests on the tests, the reviews and the phone check, and the PC `.bin` stays the restore. Not chosen: "Toggle in an existing settings page" and "Computer-only switch".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator. The `MC-345` "5a now, 5b later" option text was also the orchestrator's.
- "383,000 asset entries" is the `.bin` census of the maintainer's save (383,742 entries, 32.2 GiB), not a measured on-disk file count.
- Footnote to item 1: once clean-up runs automatically, `exportThisTabBackup` does not pin its base, so a peer tab's clean-up can delete a parked tab's units. This matters for Node and web, not the single-WebView Android MVP; the plan names it.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-367 — Lane B, 2026-10-22: CHORE-223 fix staging and the failed-export file on Android (keep today's message; stage A, a phone run, then stage B)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Inputs: `%TEMP%\risu-lane-b\c223\design.md` (investigator), superseded where they differ by `c223\design-verify.md` (`doc-verifier`; saved by the orchestrator).
- **Related:** `MC-365`, `MC-091`; CHORE-223.

1. **Failed file: "Keep today's message (Recommended)".** When an Android backup export fails partway, the half-written file in the picked folder stays, and today's message stands: "The backup file is incomplete and could not be deleted by the app. Do not use it: delete it yourself, then run the backup again." No new outcome and nothing to translate. Not chosen: "Empty the file too".
2. **Staging: "Stage A, phone, then B (Recommended)".** Stage A is the write command plus reading 3 characters ahead; then a phone run; then stage B, the batched Rust reads, designed with stage A's figures, with the advisor challenge and the strict review because it touches the shared read path at startup and saving. Two commits and two phone runs. Not chosen: "All three at once".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- The question stated that the cleanup failure is checked by source, not on the phone, and that about 26 to 33 s of the roughly 100 s writing time is the supported write saving; the rest is unexplained, and no probe targeted the save-dialog file.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-368 — Lane B, 2026-10-22: stage 5a rollout (the daily APK gets 5a only after a copy-profile run; the server/web peer exposure is accepted until 5b)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Input: the senior-advisor challenge of `s5a\plan.md` r1 (`%TEMP%\risu-lane-b\s5a\advisor.md`, saved by the orchestrator; `[APPROVE WITH AMENDMENTS]`, maintainer flags A and B).
- **Related:** `MC-366`, `MC-345` 5, `MC-313`, `MC-314`.

1. **Daily APK: "Only after the copy run (Recommended)".** The measurement build runs the clean-up on a snapshot copy of the real profile (from lane A's A1 import) first; the daily install gets 5a only once the counts and timings look right. Not chosen: "Ship with the next MVP build".
2. **Server and web peers: "Accept for now, fix in 5b (Recommended)".** On the self-hosted server or web version with two devices or tabs open, automatic clean-up can delete stored pieces another open page still uses when that page fell more than 20 saves behind; that page then asks to reload, and a backup started from it could miss pieces. Android, the MVP platform, has one page and is unaffected. Record the exposure; 5b adds protection for backups taken from an older page. Not chosen: "Android only for 5a" and "Protect it in 5a". **Superseded by `MC-369`:** the question's premise ("more than 20 saves behind") was wrong.

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- The question's "no data is lost from the latest save" means the latest committed save; the stale page's unsaved view is lost on reload (Reload-only, `MC-313`/`MC-314`).
- Nothing here authorizes application-code edits, commits or pushes.

### MC-369 — Lane B, 2026-10-22: stage 5a runs automatic clean-up only in the app (Tauri); the server and web versions keep today's behaviour until 5b (supersedes `MC-368` 2)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Input: the opus-reviewer Gate 1 r1 verdict on `s5a\plan.md` (`%TEMP%\risu-lane-b\s5a\gate1-r1.md`, `[REJECT]`, B2 and N2).
- **Related:** `MC-368`, `MC-366`, `MC-345` A2, `MC-313`, `MC-314`.

1. **Server and web: "Android app only for 5a (Recommended)".** Automatic clean-up runs only in the Android/desktop app for now; the self-hosted server and web version keep today's behaviour (no clean-up) until 5b adds the protection. The question stated the corrected premise: the storage keeps an older save version only if it is at least 5 minutes older than the previous kept one, so on the server or web version one save from another open tab or device within about 5 minutes can let automatic clean-up delete pieces a still-open page uses; that page then asks to reload (the latest committed save is safe; its unsaved view is lost), a backup started from it could miss pieces, and another device can see a one-off save failure that then retries. Android (one page) is unaffected. Not chosen: "Accept for now, fix in 5b" and "Protect it in 5a".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- "The app" means the `tauri` session kind (Android and desktop); the `node` and `indexeddb` kinds run no automatic pass in 5a.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-370 — Lane B, 2026-10-22: the export cold-collect regression is measured before it is fixed (measurement-only switches, then a 2x2 phone session)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Input: `%TEMP%\risu-lane-b\c223\coldcollect\report.md` (perf-analyzer, with the independent verifier's corrections appended: 17 claims, 12 verified, 3 overstated, 2 unverifiable, 0 wrong). Lane A's phone 1 run report: `%TEMP%\risu-b715\phone1-fresh\report.md`, step 7.
- **Related:** `MC-365`, `MC-367`; CHORE-223, CHORE-225.

1. **"Measure first (Recommended)".**
   - Add two measurement-build-only settings: the read-ahead (0 to 3) and a hold on the save loop's idle-net ticks during an export. Each is small and reviewed, and normal builds do not change.
   - Then run a phone session of four exports: read-ahead on and off, crossed with the net held and not held.
   - Fix according to the result.
   - The result also shapes stage B.
   
   Not chosen: "Turn read-ahead off on Android now" and "Wait for the planner fix".

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- The question stated that the cold collect went from about 100 s to 358 s with the same read counts, that read-ahead concurrency is the leading suspect, and that save-step contention is plausible.
- The plan adds a third measurement, the peak number of reads in flight. Lane A schedules the session after A9. The net-held arm also serves as CHORE-225's baseline.
- Nothing here authorizes application-code edits, commits or pushes.

### MC-371 — Lane B, 2026-10-22: the store2 save-planning stall is cut by changes meant to leave what is saved and when unchanged (CHORE-225 stages A and B first; the idle-net cadence is decided after)

- **Tag:** decisions (one `AskUserQuestion` round, 2026-10-22)
- **Date:** 2026-10-22
- **Sweep ref:** none
- **Source:** the lane B session transcript. Input: `%TEMP%\risu-lane-b\c225\sizing.md` (investigator) with `c225\sizing-verify.md` (doc-verifier: 6 claim groups, 5 verified (2 of them in part), 1 overstated, 0 wrong).
- **Related:** `MC-370`; CHORE-225, CHORE-223.

1. **"A+B first, decide after (Recommended)".**
   - Stage A: skip the list derivation for a module whose unit is reused, and make the hex-to-base64url step faster. The bytes stay the same.
   - Stage B: yield between modules so that no single task holds the page.
   - Whether the idle net keeps checking modules every tick is decided after the phone measurements of A and B.
   
   Not chosen: "Also slow the net now" (check modules less often, so an unmarked module edit is saved later) and "Also drop the module net" (an unmarked module edit would never be saved).

**Notes that are not the maintainer's words:**
- The option texts were written by the orchestrator.
- The question stated the following:
  - With 0 or 1 characters resident, the idle net re-encodes every module on every 2 s tick, which takes 6 to 15 s on the Note 9. That range is the coordinator's figure; the sizing did not re-measure it.
  - List derivation is about 70% of that cost cold.
  - Neither stage A nor stage B is meant to change what is saved or when. For stage A that holds only if the differential test passes.
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

**Status (2026-10-22, `MC-370`): in progress; the measurement switches are through Gate 2 and the final checks, awaiting the commit and then the phone session.** Ledger rows 2396 to 2401.
- **Phone 1, stage A Part 1:**
  - The export total fell to 932 s from 1170 s, and the asset loop to 324 s from 686 s.
  - The cold collect rose to 358 s from 100 s.
  - The diagnosis ranks stage A's read-ahead concurrency first and idle-net contention as plausible.
- **Switches** (measurement builds only; release builds unchanged, checked by `checkReleaseDist`):
  - localStorage `risu-measure-export-readahead` = 0 to 3;
  - `risu-measure-export-holdnet=on`, which skips idle-net ticks while `backupSave` is busy;
  - the peak number of `read_range` calls in flight.
  
  The export note gains `rangeMaxInFlight=`, `netHeld=`, `netTicks=`, `netTickMs=` and `residentsAtStart=`.
- **Next:** the 2x2 phone session through lane A, run in this order: (3, net on), (0, on), (3, held), (0, held), then (3, on) again. The B6 conditions and the Gate 2 device-brief check apply. Stage B (the Rust batch read) is designed after that result.

**Status (2026-10-22, lane A fold-in): stage A merged in `eb5e10bec` (no-ff of `4b04514b0`; `MC-365`, `MC-367`); technically accepted; not COMPLETE: stage A Part 1 is owed.** Part 2 ran on phone 2 (test profile, n=1; after a settled commit `__risuGcNow.run({confirm:true})` returned done, deleted 9; after a restart, done, deleted 0). Part 2 unblocks stage 5a coding. Part 1 was not run: A1's throwaway key is deleted, and `MC-456` 4 chose a fixed test key with a phone 1 wipe and re-import (the tool change is in progress, uncommitted). Ledger rows 2161 to 2170 (lane A) and 2379 to 2388 (this lane's rows, folded in after row 2378). Report: `%TEMP%\risu-b715\c223a-runs\report.md`, with its doc-verifier corrections.

**Status (2026-10-22, latest, `MC-365`, `MC-367`): in progress; stage A planned and through Gate 1.** The stage 0 probes ran on lane A's phone 2 (lane A's rows; the result with its verifier corrections is `device-requests\2026-10-22-chore223-stage0-probes.result.md`): the per-call `write_file` cost of about 1.5 to 2.2 MiB/s reproduced (the page-side number-array attribution is inferred, not timed), the ~2.9 s per-call wait did not, and reads scaled with concurrency on warm small files. Stage A is a base64 append command for Android save-dialog files plus reading 3 stub characters ahead (`c223\planA.md`, rows 2366 to 2370); a failed Android export keeps today's "kept" message (`MC-367` 1). Stage B, the Rust batch read, follows stage A's phone run.

**Status (2026-10-22, stage A implemented): in progress; stage A through Gate 2, awaiting the commit and then a phone run.**
- **Base:** stage A was implemented on `85a218885`, and main was merged into lane B as `3f579d82a` (rows 2381 to 2387).
- **W:**
  - A new Rust command, `export_append_b64` (`src-tauri/src/export_append.rs`), appends base64 chunks to a content:// file the user picked.
  - Guards: content scheme only, a host is required, the URI must survive an exact parse round-trip, and the chunk is capped at 4 MiB before and after decoding. Writes use `write_all`, and the file is synced on the last call.
  - `TauriWriter` uses the command only for content:// paths on Android.
- **R2:** stub characters are read 3 ahead. A read made ahead that fails in a shared store failure is read again at its own turn, without being charged to the retry budget.
- **MEASURE-only note fields:** `writeVia=`, `encodeMs=`, `closeMs=`, `stubAhead=`, `stubHeldMax=`, `stubRetries=`, `stubFailed=`, `appendSynced=`.
- **Not yet shown:** the native command, the save-dialog provider and the speed gain are unproven until the phone run.
- **The same phone run checks the store2 stage 5a premise:** on a MEASURE build, `__risuGcNow.run({confirm:true})` on a test profile shows whether Android confirms the flush of top-level writes (row 2384).

**Status (2026-10-22, later, `MC-363`): in progress; the Note 9 measurement is in, both fixes are sized, and stage 0 phone probes are requested.** Ledger rows 2357 and 2358; lane A records the measurement run.
- **Measured** (lane A, Note 9 phone 1, release MEASURE build of `cbd256917`, n=2, `m2-stub500.bin`; `device-requests\2026-10-22-chore223-export-measure.result.md`):
  - step A, 83 to 87 s: `stubReadMs` 99.4% of it, the stub encode 0.5%; about 3,715 `read_range` calls at about 90 ms each, with about 4 in flight (inferred from the summed time);
  - steps B (82 to 83 s) and C (16 to 19 s): almost all `writeFile` time; each call costs a page-side part of about 0.5 ms per KB and a nearly flat wait of about 2.9 s (three calls waited about 40 ms);
  - memory peak 1,349 and 1,357 MiB, in step B: no lower than row 2337's 1,336.9 MiB (+12 and +20 MiB; different commit and profile, no same-commit comparison), so the release is not shown to lower it;
  - each export decoded to 3,500 entries, not 3,501: a stray tap hydrated one character, which then exported whole (inferred).
- **Sizing** (`c223\sizing2.md` with `sizing2-verify.md`):
  - **Writes:** on Android, plugin-fs `write_file` carries the bytes as a JSON number array (the page-side cost), parsed in Rust into `serde_json` values, and opens the `content://` target per call (per source; the scheme on the phone is not observed). A base64 path needs a new app command. A side test of `write_file` to app data also showed about 3 s per append, so the wait is neither byte-proportional nor specific to the save target (one run, no raw file); its cause is unknown. Savings: about 43 s less the base64 encode cost; up to about 90 s only if the wait also goes.
  - **Reads:** no code limit of 4 in flight; a width-4 bridge and a serial server fit the figures equally. A store2 batch read plus read-ahead would save about 60 to 70 s; either alone is not robust. `readUnits` has 10 production call sites, so a backend-level change reaches boot, commit and recovery.
  - **The alert:** `updateLorebooks` maps `globalLore` unguarded after a stub is hydrated; hydration applies no defaults, and a `.bin` import stores characters verbatim. The synthetic data lacks the field; whether real upstream backups can is undetermined. Tracked as CHORE-224.
  - **The peak:** in step B the app (native) process swings 160 to 685 MiB against about 184 MiB in step A, so the growth is mostly native-side (fits the Rust value arrays; unproven).
- **Next:** the stage 0 probes (`device-requests\2026-10-22-chore223-stage0-probes.md`, requested through the maintainer for lane A to run; lane A dispatched it on phone 2): `write_file` vs the app's base64 `write_chunk`, serial and 4 in flight, and `read_range` at 1 to 16 in flight. Then a Gate 1 plan with the maintainer's design choices.

**Status (2026-10-22, `MC-362`): in progress. The measurement and the memory release are implemented on `worktree-Lane-B` and technically accepted on the PC (Gate 2 `[APPROVE]`); merged (folded into the shared files by lane A on 2026-10-22, merged in `cbd256917`); the Note 9 measurement is pending.** Ledger rows 2337 and 2349 to 2356.
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

### CHORE-224 — Opening a stored character does not apply the character defaults, so a character without `globalLore` throws on open

**Status (2026-10-22, lane A fold-in): merged in `600a13d1a` (no-ff merge of `worktree-Lane-B` at `85a218885`, on top of `c5c6897f5`); technically accepted; not COMPLETE while the Gate 2 notes below are open.** Full checks on `600a13d1a` (`%TEMP%\risu-b715\records-b224\`): `pnpm test` 2 failed, 20,737 passed, 23 skipped (the two failures are load timeouts; nodeRetire.test.ts and nodeServerFixture.test.ts reproducer 5; both files pass 22 of 22 alone); `pnpm check` 0/0; `pnpm build` passed. Ledger rows 2357 to 2378 folded into the shared ledger; rows 2359 to 2365 are the CHORE-224 rows.

**Status (2026-10-22, later, `MC-363` 4, `MC-364`): fixed on `worktree-Lane-B`; technically accepted, Gate 1 `[REJECT]` then `[APPROVE]`, Gate 2 `[APPROVE]`; uncommitted until the maintainer approves.** Ledger rows 2359 to 2365.
- **What changed:**
  - `applyCharacterDefaults` (`src/ts/storage/characterDefaults.ts`) gives a group without members an empty `characters` list (`??=`; a group with members is unchanged).
  - `characterFormatUpdate` (`src/ts/characters.ts`) applies the defaults first, before any field use, so every screen opener (`changeChar`, group member restores, restores by `chaId`) gets them.
  - Plugins and MCP (`src/ts/process/coldCharacterAccess.ts`): `restoreArchivedForWrite` applies them to the installed character; `readArchivedCharacter` to the copy it returns (no export or persistence path reads through it). `restoreAllColdCharacters` (`src/ts/process/coldRestoreAll.ts`) applies them to each restored character.
  - Not changed: `restoreOnce`, `loadStubsOf`, `readColdCharacterCopy` and every export (verbatim, `MC-175`). No forced save.
- **Saving:** a selected character's defaults are saved by the selection's own save; an opened character that is not selected (a group member, a restore by `chaId`) is saved when a later edit or a store2 put-back dirty verdict marks it. A character the defaults changed fails the put-back fingerprint and takes the dirty path; it is never swapped back to the old stub.
- **Side effect** (Gate 2, by source): a card without `chats` or `globalLore` used to make the formatter throw, so it was added live without formatting and crashed when opened; it now archives like any other card under the archive setting. Whether any importer produces such a card is unchecked.
- **Known gap:** a restore that joins one already running is never formatted; after this change the only source is the store2 save loop's `loadStubsOf`.
- **Not done (Gate 2 notes):** no test pins the C3 write's order after the placeholder check (N1); two comment clarifications (N2, N3).

**Status (2026-10-22, `MC-363` 4): open; sized and verified (rows 2359 and 2360).** Source: the CHORE-223 Note 9 run, where a stray tap opened a stored character of the synthetic `m2-stub500.bin` and raised "Cannot read properties of undefined (reading 'map')"; traced in `c223\sizing2.md` Q3 with `sizing2-verify.md`.
- **Problem:** `updateLorebooks` (`src/ts/characters.ts`) maps `globalLore` without a guard, and is reached from `characterFormatUpdate` after `changeChar` hydrates a stored character. Hydration applies no defaults. The defaults are applied at boot, at card import and in the boot archive pass, but a `.bin` import stores characters verbatim, so a backup character without the field throws when opened.
- **Decision:** apply the same defaults when a stored character is opened (`MC-363` 4); no backup format change. Plugins and MCP are covered too, and a group without members gets an empty list (`MC-364`). The plan is `c224\plan.md`, at Gate 1 (opus-reviewer).
- **Sizing** (`c224\sizing.md` with `c224\sizing-verify.md`):
  - `characterFormatUpdate` also throws on a stored character without `chats`, and on a group without `characters`; `applyCharacterDefaults` does not set a group's `characters`.
  - `applyCharacterDefaults` uses `??=` throughout (the `emotionImages` self-assign is a no-op), so it changes nothing on a complete character.
  - Recommended: one call at the top of `characterFormatUpdate`, which covers the UI openers (`changeChar`, `restoreGroupMembers`, the by-`chaId` restore). Not recommended: inside `restoreOnce`, which also runs mid-save in `loadStubsOf`.
  - Not covered by that call: `restoreArchivedForWrite` (plugin and MCP access, whose lorebook code also uses `globalLore` unguarded), `coldRestoreAll.ts` and `loadStubsOf`, which restore without formatting.
  - Exports read through `readColdCharacterCopy` stay verbatim.
- **Open:** whether real upstream backups can lack the fields; whether the defaulted character is saved, which depends on the path (on the store2 path probably memory-only until a later edit; harmless, since every open re-applies them) and goes to opus-reviewer with the store2 digest interplay.
- **Related:** `MC-363`; CHORE-223.

### CHORE-225 — Store2 save planning re-encodes every module on each idle-net tick, blocking the page for 6 to 15 s on the Note 9

**Status (2026-10-23, later): in progress; commit 1, the MEASURE save-pass meter, is through Gate 2 and the final checks and awaits the maintainer's commit approval (rows 2409 to 2412).** The maintainer approved starting with the meter ("Yes, start with the meter"). The meter records, per pass, {kind, modules, characters, ms} and, per commit, the identity, key, type and bytes of each unit that is not reused; it is enabled by localStorage `risu-measure-savepass=on` on a measurement build. `maxSliceMs` was dropped, so the CDP criterion comes from the device trace. Next: stage A.

**Status (2026-10-23): in progress; the stage A and B plan is through Gate 1 (`[APPROVE]` with 7 binding amendments, row 2406).** The measurement switches are committed (`87c2c6bd0`), so this checkout's writer is free. Coding waits for the maintainer's go-ahead (superseded: the meter was approved, see above). Planned as three commits: a MEASURE save-pass meter, then A, then B.

**Status (2026-10-22, `MC-371`): open; sized and verified.** Stages A and B are to be planned. Coding starts after the measurement switches (the CHORE-223 follow-up) are committed, because a checkout has one writer.
- **Source:**
  - lane A's phone 1 traces (select, select-cold, edit);
  - lane D's trace;
  - lane E's grid trace: 11 main-thread tasks over 1 s in 100 s (lane E's figure, not verified here).
- **Mechanism** (`c225\sizing.md`, verified in `c225\sizing-verify.md`):
  - `requestOf` (`src/ts/storage/store2/saveLoop.ts`) scopes modules into the idle net on every tick when 0 or 1 characters are resident, and once per N ticks with N residents.
  - `encodeModules` (`split.ts`) derives each module's asset and inlay lists even when the module unit is reused.
  - List derivation is about 70% of the module-set encode cold, 66% warm and 54% on an edit. SHA-256 is 8 to 9.5%. `hexStemToBase64url` is 19% to 35% cold.
  - A tick whose plan is unchanged writes nothing; the cost is all in planning.
- **The idle net is the backstop** for a module edit that raised no mark. The tests `saveLoop.test.ts` "the idle net writes what no mark named" and its neighbours pin it.
- **Plan inputs, from the verifier (before the plan):**
  - A reused list may be a merged superset from `mergeInlayLists`.
  - The differential test must include values that are not plain JSON.
  - Identical bytes hold only if the differential passes.
- **The plan's answers** (`c225\plan.md`, row 2404; not yet reviewed):
  - `mergeInlayLists` has no production caller.
  - The lists are derived from the same `plainObject(raw)` value that is digested, so the non-JSON cases stay in the differential as proof.
  - Stage B hazard: a character added during a yield would make the save throw unless the character list is copied before the module encode.
- **Open:**
  - the 33,142 B unit that repeats in three commits (its identity is not logged);
  - the cold `Ot` self time;
  - the idle-net cadence (stage C, the maintainer's call after the measurements).
- **Related:** `MC-371`, `MC-370`; CHORE-223.

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
| 2357 | 2026-10-22 | CHORE-223 sizing: the export write and read fixes, the open alert, the memory peak | investigator | 193,428 | no | `c223\sizing2.md`. Packet. Writes: plugin-fs `write_file` sends a JSON number array on Android and opens the `content://` target per call; a base64 path needs an app command (W1 stateless, W2 open-once). Reads: no code limit of 4; R1 store2 batch read plus R2 read-ahead, about 60 to 70 s. The alert needs a character without `globalLore`. The peak is in step B. |
| 2358 | 2026-10-22 | Verify the CHORE-223 sizing | doc-verifier | 141,497 | no | `c223\sizing2-verify.md`. About 34 claims: 28 verified or reasonable, 3 overstated, 1 wrong, 2 stale citations. Corrected: the asset-loop bytes are at most about 8.4 MB, not 12.3 MB; the ~90 s saving and the ~28 s projection need the per-call wait to go; units written by the `.bin` import lack the defaults; the peak growth is mostly the native app process. Omission: the device result's `write_file` test to app data also waited about 3 s per append, which weakens the open-once premise. It fed `MC-363` round 2. |
| 2359 | 2026-10-22 | CHORE-224 sizing: where to apply the character defaults on open | investigator | 76,284 | no | `c224\sizing.md`. Packet. `chats` and a group's `characters` also throw; Option A (one call at the top of `characterFormatUpdate`) recommended over Option B (inside `restoreOnce`); the plugin, MCP and restore-all openers do not format; the reproducer is a unit without `globalLore` opened by `changeChar`. |
| 2360 | 2026-10-22 | Verify the CHORE-224 sizing and the records of `MC-363`, CHORE-223, CHORE-224 and rows 2357 and 2358 | doc-verifier | 119,777 | no | `c224\sizing-verify.md`. Sizing: core verified, the self-assign upgraded to verified; corrected: 8 call sites, not 13; whether open saves the defaults is unresolved and path-dependent (store2 `markIdentitySeen`); 7 MCP lines; the reproducer is inferred by source trace. Records corrected: the peak wording, the ~43 s floor less base64 encoding, the unobserved URI scheme, the routing, and lane A's verification attribution; the CHORE-224 entry gained the sizing. |
| 2361 | 2026-10-22 | CHORE-224 plan | orchestrator | not recorded | no | `c224\plan.md`. C1 group `characters ??= []`; C2 defaults at the top of `characterFormatUpdate`; C3 plugin and MCP write and read paths; tests T1 to T5; mutants. r2 added C3b (restore-all), T6 and a put-back guard. Revised as r2 after Gate 1 r1; its top section is binding. |
| 2362 | 2026-10-22 | CHORE-224 Gate 1 r1 | opus-reviewer | 198,767 | no | `c224\gate1-r1.md`, `c224\gate1\`. `[REJECT]`, 3 binding items. B1: `restoreAllColdCharacters` (V2.1 plugins) is in scope. B2: T5's "bytes unchanged" kills nothing; assert the placeholder unchanged and nothing marked. B3: the saving wording (a selected character is saved by the selection's own save). Executed on base through a scratch config: T1 to T3 and an in-memory group case fail with the intended TypeErrors. |
| 2363 | 2026-10-22 | CHORE-224 Gate 1 r2, a targeted re-check | opus-reviewer (the same instance, resumed) | 205,195 cumulative with r1 | no | `c224\gate1-r2.md`. `[APPROVE]`. B1 to B3 met. Notes: name `coldRestoreAll.ts` and the put-back test in the grant; the put-back guard applies the defaults itself in the legacy harness. |
| 2364 | 2026-10-22 | CHORE-224 implementation | sonnet-coder | 145,218 cumulative over both rounds | no | `c224\impl\report.md` (saved by the orchestrator) and the logs.<br>**Incident:** a PowerShell helper named `Rd` (the built-in alias of `Remove-Item`) deleted the four source files, uncommitted, losing only the coder's own edits; its own restore was denied by the auto-mode classifier. With the maintainer's approval the orchestrator ran `git checkout --` on exactly those four paths, and the coder re-applied the edits.<br>**Red on base** (scratch load hook): 9 of 153 failed, exactly the 9 reproducers, for the intended errors.<br>**Mutants:** M1 to M9 killed.<br>**Checks:** `pnpm check` 0/0; full `pnpm test` 910 files passed, 3 failed; 20,587 tests passed, 4 failed (5 s timeouts in `inlays.test.ts`, `inlayCleanup.test.ts`, `nodeLiveServer.test.ts`; 59 of 59 passed alone); 23 skipped. The snapshot line-ending rewrite was restored. All 8 files CRLF. |
| 2365 | 2026-10-22 | CHORE-224 Gate 2 r1 | opus-reviewer | 130,939 | no | `c224\gate2-r1.md`, `c224\gate2\`. `[APPROVE]`, no binding items. The four sources hold only the intended hunks after the restore, with no line-ending churn. Red on base 9 of 153 for the intended reasons. Its mutants G1, G3, G4, G6 killed; G2 (C3 write before the placeholder check, a narrow race) and G5 (equivalent) survive. The put-back guard depends on the defaults (G1). The import side effect is benign. The 4 timeouts are unrelated (no shared imports). `pnpm check` 0/0. Notes N1 to N4 not done. The full suite was not re-run (`MC-329` 4). |
| 2366 | 2026-10-22 | CHORE-223 fix design (W, R2, R1) | investigator | 210,108 | no | `c223\design.md`. W: `export_append_b64` for Android `content://` targets via `Fs::open`; R2: read-ahead K=3; R1: `get_units_batch` at backend level. Corrected premises: Android failed-export removal cannot remove a content URI; exports cannot be hash-compared (fresh uuids); the wire fake cannot show the number-array cost. Staging A (W+R2), then B (R1). |
| 2367 | 2026-10-22 | Verify the CHORE-223 design | doc-verifier | 94,191 | no | `c223\design-verify.md` (saved by the orchestrator). About 20 claims: 12 verified, 4 inexact, 1 wrong. Corrected: the supported write saving is about 26 to 33 s, and no probe targeted a content URI; the `readUnits` site list; the `OpenOptions` builder form. Omissions: R2's shared retry budget and staleness window. It fed `MC-367`. |
| 2368 | 2026-10-22 | CHORE-223 stage A plan | orchestrator | not recorded | no | `c223\planA.md`. W (Rust command, `TauriWriter` gate on Android `content://`) and R2 (`STUB_READ_AHEAD` 3, in-order consumer, staleness rule); tests, mutants, the phone check. Revised as r2 after Gate 1 r1. |
| 2369 | 2026-10-22 | CHORE-223 stage A Gate 1 r1 | opus-reviewer | 196,082 | no | `c223\gateA1-r1.md`, `c223\gateA1\`. `[REJECT]`, 5 binding items: B1 the R2 reproducer must assert peak concurrency K+1; B2 `write_all` short-write rows and the `write` mutant; B3 no substring `..` refusal (a SAF document id can contain `..`), refuse parser rewrites and host-less URIs; B4 re-check the decoded size (the text cap lets 4 MiB + 1 and + 2 through); B5 close and failure handling. Executed: an offline Rust URL and base64 probe and a node length check. No silent-loss path in the design. |
| 2370 | 2026-10-22 | CHORE-223 stage A Gate 1 r2, a targeted re-check | opus-reviewer (the same instance, resumed) | 201,465 cumulative with r1 | no | `c223\gateA1-r2.md`. `[APPROVE]`. Notes: the exact-match URI rule rests on an untested inference (add a real-shaped SAF URI row; the phone run records the picked URI); keep the pre-decode text-cap rows. |
| 2371 | 2026-10-22 | Store2 stage 5a sizing (`MC-345` A2) | investigator | 175,358 | no | `s5a\sizing.md`. `gcPass` is production-reachable only through the MEASURE dev action; it deletes only `store2/` units; no asset or inlay deleter exists on store2; "idle reasons" is `Store2Session.idleReason`; "mark under 1 s" has no timing today. Proposed: run `gcPass` after the cutover step in `maintenance.ts`, about 150 to 200 lines. |
| 2372 | 2026-10-22 | Verify the stage 5a sizing | doc-verifier | 68,413 | no | `s5a\sizing-verify.md`. 24 claims: 17 verified, 3 overstated, 1 wrong citation, 3 unverifiable. Corrected: 383,742 is the `.bin` census, not an on-disk count; the deletion enumeration covered only startup paths. Omissions: Q-A is two questions (scope and the file limit); the benefit is unmeasured; a hidden switch needs a mechanism on Android. It fed `MC-366`. |
| 2373 | 2026-10-22 | Stage 5a plan | orchestrator | not recorded | no | `s5a\plan.md`. C1 `autoGc.ts` runner, C2 wiring in `maintenance.ts`, C3 an abort hook, C4 MEASURE timing; tests R1 to R4; the device check. Revised as r2 after the senior-advisor challenge. |
| 2374 | 2026-10-22 | Challenge the stage 5a plan | senior-advisor | 158,969 | yes (`MC-345` A2: irreversible deletion) | `s5a\advisor.md` (saved by the orchestrator). `[APPROVE WITH AMENDMENTS]`, A1 to A9: the abort hook is required; stop when busy, parked or not save-clean; the decisive real-encoder stub guard; test labels; the Node probe; a separate try/catch; the wiring claim corrected; an `observe` hook for MEASURE; the device check before the daily install. Flags A and B went to the maintainer (`MC-368`). |
| 2375 | 2026-10-22 | Verify the records additions and the CHORE-224 commit message | doc-verifier | 112,010 | no | Read-only. About 70 claim groups: 63 verified, 4 overstated, 2 wrong (the commit message's row range; MC-366's omission range O1 to O5), 3 unverifiable. Corrections applied: the `write_file` per-call figures and the read-concurrency figures (MC-365 notes, CHORE-223 status), row 2361's tests, the store2 put-back path marked as traced from source in the commit message. |
| 2376 | 2026-10-22 | Stage 5a Gate 1 r1 | opus-reviewer | 239,797 | yes (`MC-345` A2) | `s5a\gate1-r1.md`. `[REJECT]`, B1 to B7: retention admits a predecessor only at 5-minute intervals, so garbage starts at the second save in a window (scratch diagnostic) and A3 needs a clock; `MC-368` 2 was asked on a wrong premise; a page-state seam for the stop conditions; the backup-load wait claim is wrong on store2 pages (replace the A7 guard); MEASURE markers belong to a MEASURE-only consumer; a save-clean mutant; R62's wired replay/live-server and Chrome checks. The mechanism holds (Q1 I1 confirmed by reading). |
| 2377 | 2026-10-22 | Re-ask the server/web exposure with the corrected premise | orchestrator | not recorded | no | `MC-369`: "Android app only for 5a"; supersedes `MC-368` 2. Plan r3 limits the automatic pass to the `tauri` kind. |
| 2378 | 2026-10-22 | Re-verify the records corrections | doc-verifier | 47,622 | no | Read-only, changed text only. All 7 corrections fixed; no new error. MC-369 and rows 2375 to 2377 match their sources. The "`tauri` kind" note is plan-level, not traced. The file is still all CRLF. |
| 2379 | 2026-10-22 | Stage 5a Gate 1 r2 | opus-reviewer | 196,854 | yes (`MC-345` A2) | `s5a\gate1-r2.md`, on plan r3. `[REJECT]`; the second consecutive rejection. Three binding items, each confirmed by a scratch run: (1) a `tauri` session over the plain memory backend is always idle, so the tests need a flush-confirming wrapper; (2) A3's commit recipe could drop and evict nothing (the first two commits after an advance are both admitted); (3) the lazy page-facts seam pulls the app into the isolated runner test, and a dynamic import stalls the Tauri replay rig. Mechanism reconsidered: both rounds confirmed it, so it stays (plan r4). |
| 2380 | 2026-10-22 | Stage 5a Gate 1 r3 | opus-reviewer | 188,463 | yes (`MC-345` A2) | `s5a\gate1-r3.md`, on plan r4. `[EDITORIAL]`: r2's items resolved; E1 to E5 plan-text corrections (the rig idle program, the idle-flip timing, the pin rule, a narrower facts type, page facts injected in K's guard), adopted as plan r5. The plan is accepted for implementation. Deviation from R62 stage 5, recorded here: R62's live-server test against the wired GC and the Note 9 Chrome plain-HTTP IndexedDB check are deferred to 5b (`MC-369`: no automatic pass on `node` or `indexeddb` in 5a). |
| 2381 | 2026-10-22 | Implement CHORE-223 stage A | sonnet-coder | 219,157 | no | Report `c223\implA\report.md` (saved by the orchestrator). Base `85a218885`. W: Rust `export_append_b64` with guards and 13 Rust unit tests; `TauriWriter` gate `content://` plus Android; MEASURE fields. R2: `STUB_READ_AHEAD=3`, an in-order consumer, a staleness check on `inlineKeyOf(u, chaId)`. Red on base: R2 4 failed, W 15 failed. Mutants: TS 15 of 15 killed; Rust 9 of 10 (the NUL check is equivalent: the canonical check refuses NUL). Amendment granted: `readAhead: 0` on one call-index fake in `backuplocalStubInline.test.ts`. |
| 2382 | 2026-10-22 | Merge main into lane B | orchestrator | not recorded | no | `3f579d82a` (maintainer-approved): CHORE-224, CHORE-153, CHORE-182, S4-5. Stage A's `lib.rs` was set aside, the merge made, and its two lines re-added next to lane C's `free_space` lines; `cargo check` passed. |
| 2383 | 2026-10-22 | CHORE-223 stage A Gate 2 r1 | opus-reviewer | 184,475 | no | `c223\gateA2-r1.md`. `[REJECT]`, B1 to B3: (1) a shared store failure hit up to K+1 reads at once and each was charged to the retry budget (scratch reproducer: two outages, serial 0 failed characters, read-ahead 2; loud, not silent), and the row 2381 amendment had switched off the only guard showing it; (2) the chaId test did not assert the second read; (3) the planned `synced` note field was missing. The Rust command, the writer and the merged `lib.rs` held. |
| 2384 | 2026-10-22 | Does Android confirm store2 top-level writes as flushed? (stage 5a premise) | investigator | 80,535 | no | `s5a\flushq\report.md` (saved by the orchestrator). CONDITIONAL, leaning yes by source: `flushed` is true only if the directory sync after the rename succeeds (`store2_gate.rs`, `durable_write.rs`); no phone evidence either way. Stage 5a coding waits for a check on stage A's phone run. |
| 2385 | 2026-10-22 | Remediate stage A Gate 2 r1 | sonnet-coder | 92,917 | no | Report `c223\remA\report.md` (saved by the orchestrator). A read made ahead that failed without a kind is re-read at its own turn, free; a two-outage reproducer was red on the code without it. The chaId test asserts the second read (mutant killed). `appendSynced` recorded from the closing reply, as a note field and a release marker, with tests (mutants killed). The `readAhead: 0` amendment stays on two call-index fakes. |
| 2386 | 2026-10-22 | CHORE-223 stage A Gate 2 r2 | opus-reviewer | 146,133 | no | `c223\gateA2-r2.md`. `[EDITORIAL]`: B1 to B3 resolved. Read-ahead never failed more characters than serial in 1,803 swept cases over four failure models. A fifth model, an outage set off by one entity's read that outlasts a pause, is disclosed as residual behaviour (non-binding N1): read-ahead failed 1 and 3 more characters in 2 of 44 cases, and fewer in others. Not acted on: N2 (the equivalence test no longer pins every entity's read count; mutants m6, m9 and m10 survive) and N3 (rescue reads are not counted in the measurement note). Release and measurement builds rebuilt in scratch: `checkReleaseDist` passes the release build. E1 (a comment overclaimed retry equivalence) and E2 (test labels) applied by the orchestrator as wording-only edits. |
| 2387 | 2026-10-22 | Final checks on stage A | orchestrator | not recorded | no | On the final snapshot (`3f579d82a` plus stage A): `pnpm check` 0/0; full `pnpm test` 917 files passed, 1 skipped, 20,772 tests passed, 23 skipped, 0 failed (`c223\final-full.log`); the eol-only `modules.test.ts.snap` rewrite restored. `pnpm check` (0 errors, 0 warnings, run after the E1/E2 wording edits), `pnpm build` then `checkReleaseDist` ("OK, 242 files scanned under dist, no measurement markers", run after the full test), and the post-merge `cargo check` were run by the orchestrator in-session; their console output is in the session transcript, with no log file. `cargo test --lib export_append` (13 passed) was run by the Gate 2 r1 reviewer on the merged snapshot. |
| 2388 | 2026-10-22 | Verify the stage A records and commit message | doc-verifier | 73,017 | no | Read-only. 13 claim groups: 10 verified, 2 overstated, 1 unverifiable, 0 wrong. Corrections applied: row 2386 (four sweep models; N1 disclosed as residual; N2 and N3 recorded as not acted on); row 2387 (in-session checks attributed, no log files); the commit message's "only on the PC" scope and its cargo line. |
| 2389 | 2026-10-22 | Stage 5a flush premise on a phone (lane A's run, relayed) | orchestrator | not recorded | no | Lane A ran part 2 of `device-requests\2026-10-22-chore223-stageA-and-5a-flush.md` on phone 2: a test-only fresh profile, a MEASURE release of `eb5e10bec`. Report: `%TEMP%\risu-b715\c223a-runs\report.md`; AI-authored, then corrected by a doc-verifier. The build commit and the MEASURE flag are the agent's statements (`result.json` records an empty `commit.head`).<br>Results, from the `__risuGcNow` dev pass: after a settled edit commit, `run({confirm:true})` returned `done, deleted 9, batches 1`; after a restart with no edit, it returned `done, deleted 0`, twice.<br>Reading (inferred from source): `done` after a tracked commit is consistent with the last store2-commit write reporting `flushed === true`; the idle state was never seen set.<br>Limits: one device, one run, a tiny profile; the refused-idle path was not exercised.<br>This answers row 2384 for 5a. Part 1 (the export) is pending a test-key reinstall of phone 1. |
| 2390 | 2026-10-22 | Merge main into lane B | orchestrator | not recorded | no | `0390721dc`, approved by the maintainer ("Yes, merge and start 5a"). Brings in the CHORE-223 stage A merge, CHORE-117 stage 2, CHORE-187, CHORE-241 S1/S0, the sign-release tool commit `1f4771ca7`, and the records fold-ins. Clean merge. |
| 2391 | 2026-10-22 | Implement store2 stage 5a | sonnet-coder | 325,202 (three rounds of one instance) | no | Report: `s5a\impl\report.md` (saved by the orchestrator).<br>Files: new `gc/autoGc.ts` and `gc/gcMeter.ts`; `maintenance.ts`; `pass.ts` (A1 only); `checkReleaseDist.mjs`; `maintenanceRunner.test.ts`; three new test files and one helper (`flushConfirmBackend.ts`).<br>Red on base: 10 failed at the intended assertions; the guards pass.<br>The coder's own full run, before the amendment (`impl\full-test.log`): 20,924 passed and 2 failed (a `characterPutBackStore2.svelte.test.ts` acceptance case and a `regexEarlyReject.test.ts` timeout); both passed alone, and the final run (row 2394) is green.<br>Mutants: 18 of 18 killed.<br>Amendment requested by the orchestrator: on a MEASURE build, the result line and `gcMarkMs` go to `noteImportPhase` (gated by localStorage `risu-measure-import=on`), because builds strip the console. A static ring import leaked into the release bundle, so the note is loaded dynamically. The drop-note mutant is killed. |
| 2392 | 2026-10-22 | Grant revoked too early (orchestrator error) | orchestrator | not recorded | no | I revoked the coder's grant on a "completed" notification while the amendment was mid-edit. Its next edit was denied, `checkReleaseDist` failed on the half-applied state, and a Gate 2 run already started on it was stopped before it gave a verdict. I restored the grant and the coder finished. Rule recorded: revoke only after the hand-back text arrives. |
| 2393 | 2026-10-22 | Store2 stage 5a Gate 2 r1 | opus-reviewer | 226,905 | yes (`MC-345` A2) | `s5a\gate2-r1.md`, on the final state. `[EDITORIAL]`: no I1, silent-loss, logic or test defect.<br>- I1 traced from source; A3 and A7' run.<br>- 369 tests passed in 10 related files.<br>- Its own mutants: 5 of 6 killed. The survivor (`shouldStop` checked before the pace instead of after it) is correct code.<br>- The release build has no measurement code (244 files versus 242). The +2 are orphan stubs, and `storeImport` moved into its own chunk, which adds one module request at boot for the same bytes. The coder's "no new chunk" claim was false.<br>- The real-module note path reaches the ring for `refused: idle`.<br>- Not acted on: N2 (no mutant proves the facts are resolved after the synchronous checks).<br>The orchestrator applied the three editorial items: the whitespace in an existing test and two header sentences in `autoGc.ts`. |
| 2394 | 2026-10-22 | Final checks on stage 5a | orchestrator | not recorded | no | Final snapshot: `0390721dc` plus 5a, after the editorial edits. Results:<br>- `pnpm check`: 0/0.<br>- Full `pnpm test`: 926 files passed, 1 skipped; 20,927 tests passed, 23 skipped, 0 failed (`s5a\final-full.log`).<br>- The eol-only `modules.test.ts.snap` rewrite was restored.<br>- `pnpm build` then `checkReleaseDist`: "OK, 244 files scanned under dist, no measurement markers".<br>The check, build and marker runs were in-session; their console output is in the session transcript. |
| 2395 | 2026-10-22 | Verify the stage 5a records and commit message | doc-verifier | 84,274 | no | Read-only. 12 claim groups: 7 verified, 3 overstated, 0 wrong, 2 unverifiable; 3 omissions; 1 ordering fault. Corrections applied: row 2389 (the phone reading is "consistent with" a confirmed flush; the report's attribution; the dev pass; the build commit is the agent's statement); row 2391 (three test files and a helper; the coder's first full run); row 2393 (N2); stale handoff bullets; row 2388 moved back into order; the commit message's Device line. The trailer stays Opus 5.5, the orchestrator's model. |
| 2396 | 2026-10-22 | Why the phone 1 export cold collect took 358 s (against 100 s) | perf-analyzer | not recorded | no | Report: `c223\coldcollect\report.md`, from lane A's phone 1 run (`%TEMP%\risu-b715\phone1-fresh\report.md`, step 7).<br>Ranking:<br>- leading: stage A's read-ahead concurrency. The mean in flight was 15.7 against 4.3, and the per-invoke time was about 14 times longer, with the same read counts;<br>- plausible: contention from the idle net's module passes.<br>Diagnosis only; nothing is fixed. |
| 2397 | 2026-10-22 | Verify the cold-collect diagnosis | doc-verifier | not recorded | no | Read-only. 17 claims: 12 verified, 3 overstated, 2 unverifiable, 0 wrong. The corrections are appended to the report. Input to `MC-370`. |
| 2398 | 2026-10-22 | Measurement switch plan, Gate 1 r1 | opus-reviewer | not recorded | no | `c223\knobs\gate1-r1.md`: `[APPROVE]` of `c223\knobs\plan.md`, with binding items:<br>- B1 to B5: implementation conditions, among them that a throwing hold check means "not held";<br>- B6: the device-run conditions (a time limit per run, a decision rule registered before the run, the same poll cadence). |
| 2399 | 2026-10-22 | Implement the measurement switches | sonnet-coder | not recorded | no | Report: `c223\knobs\impl\report.md` (saved by the orchestrator).<br>Files: new `measureExportHold.ts`; `saveLoop.ts`, `globalApi.svelte.ts`, `tauriByteTransport.ts`, `exportInline.ts`, `backuplocal.ts`, `checkReleaseDist.mjs` (7 markers); three new test files and an extended `tauriByteTransport.test.ts`.<br>Red on base: 16 failed, 1 of them only a missing export.<br>Mutants: 12 of 12 killed.<br>Incident: the coder's mutant run without a test path ran the full suite. The coder stopped it. It left an eol-only snapshot rewrite, which the orchestrator restored. |
| 2400 | 2026-10-22 | Measurement switches, Gate 2 r1 | opus-reviewer | 125,015 | no | `c223\knobs\gate2-r1.md`: `[EDITORIAL]`.<br>- The reviewer's own release bundle has the same save-loop tail as the base and no `installNetHold` call. K1 folds to the default.<br>- `checkReleaseDist` is clean on the release build; the measurement build hits all 7 markers.<br>- 220 targeted tests passed; `pnpm check` 0/0.<br>- Its own mutants: 4 of 5 killed. The survivor (removing the counter reset in `backuplocal.ts`) is the admitted untested note wiring. Ruled non-binding, with a device-brief check: `netHeld` is 0 in the net-on arms, and a second export does not carry the first one's counts.<br>- E1, a test name that claimed more than it checks, was renamed by the orchestrator (wording only), and the report's "resume" claim was corrected. |
| 2401 | 2026-10-22 | Final checks on the measurement switches | orchestrator | not recorded | no | Final snapshot: `67273e799` plus the switches, after E1. Results:<br>- full `pnpm test`: 929 files passed, 1 skipped; 20,966 tests passed, 23 skipped, 0 failed (`c223\knobs\final\full.log`);<br>- the eol-only `modules.test.ts.snap` rewrite was restored;<br>- `pnpm check`: 0/0;<br>- `pnpm build` (`final\build.log`), then `checkReleaseDist`: "OK, 244 files scanned under "dist", no measurement markers".<br>The check and marker runs were in-session on the final snapshot; their console output is in the session transcript. Equivalent runs on the Gate 2 snapshot are in `c223\knobs\gate2\`. |
| 2402 | 2026-10-22 | Size the store2 save-planning stall (CHORE-225) | investigator | not recorded | no | `c225\sizing.md`, read-only. With 0 or 1 residents, the idle net re-encodes every module on each tick. List derivation is about 70% of that cost cold. Five candidates are sized. Recommended: stage A (reuse the lists, plus a faster `hexStemToBase64url`) and stage B (yield between modules), which leave the save behaviour unchanged. The cadence is the maintainer's call. |
| 2403 | 2026-10-22 | Verify the CHORE-225 sizing | doc-verifier | not recorded | no | `c225\sizing-verify.md`: 6 claim groups, 5 verified, 1 overstated (the `hexStemToBase64url` share is 19% to 35% cold), 0 wrong. Option (iii) safety conditions added: merged supersets, values that are not plain JSON, and identical bytes only if the differential passes. Input to `MC-371`. |
| 2404 | 2026-10-22 | Draft the CHORE-225 stage A and B plan | investigator | 172,693 | no | `c225\plan.md`, read-only. It refutes two verifier worries by source:<br>- the lists are derived from `plainObject(raw)`, the same value that is digested;<br>- `mergeInlayLists` has no production caller. The orchestrator confirmed this with an in-session search of `src`: the only callers are in `listsInlay.test.ts`.<br>It finds a stage B hazard: a character added during a yield would make the save throw. The fix is to copy the character list before the module encode.<br>Suggested staging: three commits (the MEASURE save-pass meter, then A, then B). No product question found. Its Gate 1 (opus-reviewer) is running and gets its own row. |
| 2405 | 2026-10-22 | Verify the measurement-switch records and commit message | doc-verifier | 57,227 | no | Read-only. Results:<br>- `MC-371` and CHORE-225: overstated;<br>- CHORE-223 status and the commit message: verified;<br>- rows 2396 to 2404: verified, apart from three fixes.<br>Corrections applied:<br>- `MC-371`: "meant to" leave saving unchanged, holding only if the differential passes; the 6 to 15 s range attributed; "5 verified (2 in part)";<br>- CHORE-225: the plan's answers and the stage B hazard added; lane E's figure marked unverified;<br>- rows 2397 and `MC-370`: 2 unverifiable claims added;<br>- row 2401: the in-session runs attributed;<br>- row 2404: the grep attributed; Gate 1 marked as running.<br>Not applied: its note that the trailer should say Sonnet 5.5. The session's attribution instruction names Opus 5.5. |
| 2406 | 2026-10-23 | CHORE-225 stage A and B plan, Gate 1 r1 | opus-reviewer | 198,728 | no | `c225\gate1-r1.md`: `[APPROVE]` with 7 binding amendments for the implementation brief. Findings, by source:<br>- The carry condition holds on every path that produces a previous tree. The remaining risk is a build whose derivation changes without a version bump, which commit `489d5f543` once did for the config list. Amendments: a golden pin test, and carrying only with the default inlay cap.<br>- A carried unit is exposed to GC, commit and export exactly like a reused one.<br>- The stage B hazard is real; copying the character list first fixes it.<br>- (iv): a scratch exhaustive check found 0 mismatches in 16,912,512 cases (`c225\gate1\hexstem-proof.mjs`).<br>Other amendments: more tests (production-built previous trees, pending and adopt, re-finalize, index consistency, a GC guard, M5b, a `whole`-path R5); fix or drop `maxSliceMs`; state "carried equals fresh" as conditional on the writer invariant.<br>No product question. |
| 2407 | 2026-10-23 | Commit the measurement switches; revise the phone request | orchestrator | not recorded | yes (commit) | `87c2c6bd0`, approved by the maintainer ("Yes, commit it"). Lane A reports the merge on main as `ff06d0136`.<br>The device request `device-requests\2026-10-23-chore223-export-2x2.md` was revised to revision 2 after lane A's A9 export (`%TEMP%\risu-b715\phone1-a9\report.md`, doc-verified by lane A; its unit-identity question is still open): read-ahead 3 with the net on had a cold collect of 113.5 s. There was no PSS or size poller during the export, and no chat select or edit just before it. 33 characters had been opened earlier in the session.<br>Revision 2 first tests the run conditions:<br>- quiet with read-ahead 3 and 0;<br>- part 1's pollers (lane A named them: `pss2.ps1` with no sleep, `sizepoll.ps1` every 5 s, `ring.ps1` every 0.7 s);<br>- after a select.<br>It attributes the slowdown only where it reproduces. It adds an edit-then-idle GC launch and a census closing check. The decision rule was set before any run. |
| 2408 | 2026-10-23 | Explain 500 against 499 coldstorage units; build a census tool | investigator | 177,371 | no | Answer: `tools\census\task1-answer.md` (saved by the orchestrator; unverified). Mechanism verified by source; cause INFERRED:<br>- an opened character stays live and is exported inline;<br>- the rings show one fewer stub slot at A9;<br>- stage 5a GC cannot delete a unit that a stub still reaches, and a missing unit makes the export prompt with the character's name;<br>- A9 had `stubFailed=0`.<br>Tool: `%TEMP%\risu-lane-b\tools\census\`. It reports counts only and compares by opaque chaId. Synthetic tests pass, by the investigator's report; no log was kept. Its `node_modules` is a junction into this worktree. An opus-reviewer review must pass before lane A runs it on real data. |
| 2409 | 2026-10-23 | Implement the CHORE-225 save-pass meter (commit 1) | sonnet-coder | 86,475 | no | Report: `c225\meter\report.md` (saved by the orchestrator).<br>Files: new `store2/savePassMeter.ts`; `saveEncoder.ts`, with MEASURE-only hooks in `plan()` and `acknowledge()` and `scopeOf` hoisted; `checkReleaseDist.mjs`, with 2 markers; two new test files.<br>Red on base: 2 failed, plus 3 guards.<br>Mutants: 7 of 7 killed.<br>`maxSliceMs` dropped (Gate 1 amendment 5, alternative 2).<br>The new files were written LF; the orchestrator converted them to CRLF after revoking the grant. |
| 2410 | 2026-10-23 | CHORE-225 meter, Gate 2 r1 | opus-reviewer | 126,443 | no | `c225\meter\gate2-r1.md`: `[EDITORIAL]`.<br>- Release bundles built and compared: only the `saveLoop` chunk differs, by the `scopeOf` hoist and variable renames, with no meter call.<br>- Both markers are present in the MEASURE build and absent from the release build.<br>- The line-ending conversion only changed line endings.<br>- 199 targeted tests passed.<br>- Its own mutants: 3 killed, 8 survived. Two titles claimed untested coverage (G9, G11), which are binding. The other survivors are non-binding gaps: the ring limit, `ms` values, stale acknowledge, `keepAsPending`, and skipped characters. |
| 2411 | 2026-10-23 | Remediate the meter Gate 2 r1 editorial items | sonnet-coder | 102,019 (same instance as row 2409, cumulative) | no | Both tests now check what their titles claim; the titles are unchanged. G9 and G11 are killed on scratch copies (logs `c225\meter\r2-*.log`). 87 targeted tests passed; `pnpm check` 0/0. |
| 2412 | 2026-10-23 | Final checks on the CHORE-225 meter | orchestrator | not recorded | no | Final snapshot: `87c2c6bd0` plus the meter, after row 2411. Results:<br>- full `pnpm test`: 931 files passed, 1 skipped; 20,979 tests passed, 23 skipped (`c225\meter\final\full.log`; it lists no failed count, and the stack traces in its tail are console noise from passing tests);<br>- the eol-only snapshot rewrite was restored, after an `--ignore-cr-at-eol` diff showed nothing (in-session);<br>- `pnpm check`: 0/0;<br>- `pnpm build` (`final\build.log`), then `checkReleaseDist`: "OK, 244 files scanned under "dist", no measurement markers".<br>The check and marker runs were in-session; their console output is in the session transcript. |
| 2413 | 2026-10-23 | Verify the meter records and commit message | doc-verifier | 56,714 | no | Read-only. 9 claim groups: 6 verified, 1 overstated, 0 wrong, 2 partly unverifiable. Corrections applied:<br>- row 2407: the A9 conditions (no poller during the export, no select or edit just before it, 33 characters opened earlier) and "doc-verified, with the unit-identity question open";<br>- row 2408: the synthetic-test claim attributed;<br>- row 2412: the log lists no failed count; the snapshot restore was in-session;<br>- CHORE-225: the superseded sentence marked.<br>Not applied: its note on the trailer model; the session's attribution instruction names Opus 5.5. |

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
- **CHORE-223:** decisions `MC-362`. Gate 1 `[REJECT]` and then `[APPROVE]` in round 2; implemented; Gate 2 `[APPROVE]` (rows 2349 to 2356). It is merged (folded into the shared files by lane A on 2026-10-22, merged in `cbd256917`); the Note 9 measurement is pending.
- **Next:** the Note 9 release MEASURE export run, dispatched on phone 1 by lane A (`MC-343` 2); the result is pending. A targeted fix of steps A to C follows its figures.
- **CHORE-221** remains an unscheduled candidate.

2026-10-22, CHORE-223 sizing:
- **CHORE-223:** the Note 9 measurement is in; both fixes are sized and verified (rows 2357 and 2358); decisions `MC-363`. Next: the stage 0 phone probes through lane A, then a Gate 1 plan.
- **CHORE-224** (new): apply the character defaults when a stored character opens; sized and verified (rows 2359 and 2360). Next: the maintainer's choices, then a Gate 1 plan. (Superseded below.)

2026-10-22, CHORE-224, CHORE-223 stage A and store2 stage 5a:
- **CHORE-224:** decisions `MC-363` 4 and `MC-364`. Gate 1 `[REJECT]` then `[APPROVE]`; implemented; Gate 2 `[APPROVE]` (rows 2361 to 2365). It awaits the maintainer's commit approval.
- **CHORE-223 stage A** (W, the base64 export command; R2, read-ahead): decisions `MC-365` and `MC-367`; the stage 0 probes ran on lane A's phone 2. Design verified (rows 2366 and 2367); the plan passed Gate 1 in round 2 (rows 2368 to 2370). The coder starts after the CHORE-224 commit (one writer per checkout). Stage B (R1, the Rust batch read) follows stage A's phone run.
- **CHORE-223 stage A, later the same day:** implemented, through Gate 2 (r1 `[REJECT]`, r2 `[EDITORIAL]`), main merged in (rows 2381 to 2387). Next: the commit, then a phone run through the maintainer and lane A that also runs the stage 5a flush check (row 2384). (Since then: committed `4b04514b0`, merged as `eb5e10bec`; the flush check ran, row 2389; the export run is pending.)
- **Store2 stage 5a, later the same day:** the flush premise held on phone 2 (row 2389). Implemented, and Gate 2 returned `[EDITORIAL]` (rows 2390 to 2394). Next: the commit, then the A9 device check. A9 runs on a MEASURE build over a snapshot copy of A1's real profile, with `risu-measure-import=on`. It reads the result line in `__risuImportPhases`, and a missing entry is ambiguous. The daily APK gets 5a only after A9 (`MC-368` 1).
- **Store2 stage 5a** (`MC-345` A2): automatic clean-up of store2 leftovers, no UI. (Superseded by the "later the same day" bullet above: the flush check is done and 5a is implemented.) Decisions `MC-366`, `MC-368` and `MC-369` (the automatic pass runs only in the app, the `tauri` kind). Sized and verified, challenged by the senior-advisor (rows 2371 to 2374); Gate 1 r1 and r2 `[REJECT]`, r3 `[EDITORIAL]`: plan r5 accepted (rows 2376, 2379 and 2380). The implementation starts after the CHORE-223 stage A commit (one writer per checkout). The daily APK gets it only after a measurement run on a copy of A1's profile.
