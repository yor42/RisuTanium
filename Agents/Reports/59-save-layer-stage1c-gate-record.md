# Report 59 — Save layer Stage 1c (the block store wired in): plan decisions, slice and gate record, the merge with the `.bin` speed work, and the QOL-06 merge

**STATUS:** Stage 1c is implemented, gated, committed and merged into `main` (2026-10-05 and 2026-10-06). The plan passed Gate 1 on 2026-10-05 in three rounds (`[REJECT]`, `[REJECT]`, `[EDITORIAL]`, no escalation). It was built as slices 1c-A, 1c-B, 1c-C, 1c-D1 and 1c-D2 on `feat/stage-1c`, each with its own Gate 2, then a final Gate 2 over the whole stage (round 1 `[REJECT]`, round 2 `[APPROVE]`). The maintainer then said "yes, merge 1c." and the stage was merged with the `.bin` speed commit `b6d8e963` as `25d53bcf`, and with QOL-06 as `8ca14be5`. `main` reached `1e71c45c` and was pushed to `origin/main` (`MC-222`). The save layer's Stage 1 is therefore complete as planned in Report 57; Stage 2 (per-module blocks) is not started.

This report is a dated snapshot, written on 2026-10-07 against `main` at `1e71c45c`. It is the gate record for the plan in Report 57 section 10 (stage 1c) and does not restate that plan. It follows Report 58 (the 1a and 1b record).

**Evidence labels.** Three kinds of statement appear below, and each is labelled where it matters:
- *Implementer's claim:* from a `sonnet-coder` hand-back. The Orchestrator saved several reports to scratch because the agents' own `Write` was refused. A reviewer did not re-run these unless the text says so.
- *Reviewer-run:* an `opus-reviewer` or `adversarial-reviewer` ran or opened it itself.
- *Orchestrator-run:* the full-suite, `pnpm check` and build checks the Orchestrator ran on the working tree.

All performance figures cited here come from one i9-class machine, best-case hardware (`MC-003`, `MC-010`). Test data is synthetic (`MC-131`).

**Sources** (the session scratchpad, `stage1/`, `qol/`, `qolmerge/`; not durable, so this report and ledger rows 1099, 1100 and 1179 to 1255 are the durable record): `c1plan/` (the two side maps, `plan-1c.md` and `gate1/round1.md` to `round3.md`), `c1impl/A`, `B`, `C` and `D` (the reports, the Gate 2 rounds and the remediations), `c1final/` (the final Gate 2 and its remediation), `merge/` (the merge brief, the coder's report and the review), the commit messages of the commits below, and `c1plan/pending-records.md`. Maintainer decisions: `MC-196` (the plan's four choices, the ranges, the lane end, the legacy `database.bin` choice) and `MC-197` (the commit and merge words). Compatibility: `MC-175`, `MC-011`.

## 1. Outcome at a glance

| Part | What | Commit | Gate 2 | Ledger rows |
|---|---|---|---|---|
| Plan | `plan-1c.md`, revision 3 | none (scratch) | Gate 1: round 1 `[REJECT]`, round 2 `[REJECT]`, round 3 `[EDITORIAL]` | 1099, 1100, 1179 to 1181 |
| 1c-A | Block-store core changes and the page owner; nothing calls the new owner module yet | `04a2f9dd` (30 files, +2463/-372) | Round 1 `[EDITORIAL]`, round 2 `[APPROVE]` | 1184, 1190 to 1192 |
| 1c-B | Boot from the block store, convert in the archive pass, the read-only fallback page | `69623d30` (60 files, +5562/-499) | Round 1 `[REJECT]`, round 2 `[EDITORIAL]`, round 3 `[APPROVE]` | 1210 to 1217 |
| 1c-C | Save through the block store, snapshots, stop reasons | `420a9b7b` (29 files, +3572/-2760) | Round 1 `[REJECT]`, round 2 `[REJECT]`, round 3 `[APPROVE]` | 1218 to 1226 |
| 1c-D1 | Restores through the block store, remote saving retired, preset repair | `7e90f83e` (55 files, +2167/-2303) | Round 1 `[EDITORIAL]`, round 2 `[EDITORIAL]` | 1233 to 1238 |
| 1c-D2 | Manual clean-up on the block store, `writeMainFile` removed, the cross-site census | `53c84a0e` (22 files, +2088/-407) | Round 1 `[EDITORIAL]`, round 2 `[EDITORIAL]`, round 3 `[APPROVE]` | 1239 to 1243 |
| Final | The whole stage `2ccf4fc2..53c84a0e` | `32f3e7e3` (12 files, +219/-47) | Round 1 `[REJECT]`, round 2 `[APPROVE]` | 1244 to 1247 |
| Merge with the `.bin` speed work | `b6d8e963` into `feat/stage-1c` | `25d53bcf` | Round 1 `[REJECT]` (two vacuous tests and a comment), round 2 `[APPROVE]` | 1250 to 1254 |
| QOL-06, Empty trash | The trash view's button, and its merge | `e4a060e4` (12 files, +1434/-3); merge `8ca14be5` | Gate 2 `[APPROVE]` twice; merge review `[APPROVE]` | 1227 to 1232, 1255 |

Substantive `[REJECT]` rounds in a row, per item: at most two (Gate 1 of the plan, and slice 1c-C's Gate 2), so the three-round rule of AGENTS 1.2 was never reached and no `senior-advisor` escalation was made. Slice 1c-C's second rejection prompted the second-rejection question (section 4.3). The agents were `sonnet-coder` for implementation, `opus-reviewer` for the gates, `translator` for the new strings, and `investigator` for the two side maps.

Stages B to D must ship together: slice B alone stops being correct once a save is written, and the commit messages of `69623d30`, `420a9b7b` and `7e90f83e` each say so. They were committed in order on `feat/stage-1c`, and `main` received them only through the merge.

## 2. Product choices and design calls

### 2.1 Maintainer choices (`MC-196`)

All four were chosen with `AskUserQuestion` on 2026-10-05 and are quoted by their labels:

| # | Question | Choice | Effect |
|---|---|---|---|
| D1 | An unreadable head, then "Load the newest backup" | "Keep all of them (Recommended)" | Every older generation that has a root is marked kept. Image clean-up stays off until the user deletes them from manual clean-up (dated, with a confirm). |
| D2 | The newest backup decodes only partially | "Skip to a complete one (Recommended)" | The newest strictly complete backup is used. Only if none exists is the newest partial one offered, after a confirm that lists what is missing. |
| D3 | `database.pre-blocks.bin` and clean-up | "Protect + delete option (Recommended)" | Its assets and units are kept; clean-up offers a dated, confirmed "delete the pre-conversion copy". |
| D4 | The OPFS transitional page | "Read-only + notice (Recommended)" | The page opens, does not save, and tells the user; the next start retries the copy-back. This amends Report 57 section 6.10 (`MC-091`: an explicit decision to reduce supported complexity). |

A later question (2026-10-05) extended D3: a legacy `database.bin` left on a block profile (the Node over-limit case) is also an older copy that keeps its assets alive. The answer was "Yes, cover it (Recommended)". The startup asset sweep is held while it exists, a failed presence check counts as "exists", and non-block profiles are unaffected (`MC-196` 4).

### 2.2 Orchestrator design calls (not product decisions)

- D5: `botPresetsId` out of range. The plan's first revision clamped it to -1. After Gate 1 round 1 it took upstream's append rule, and the repair moved to slice D1.
- D6: conversion is lazy (the first committing save or the boot archive pass), per Report 57 section 6.4.
- D7: the rename finish is keyed on `convertedFrom`, so no stale-save window exists before conversion.
- The startup asset sweep is held while any pre-blocks file exists (found by slice B's Gate 2 round 1 as a gap in D3).
- Report 57's counts were corrected by the write-side map: 17 `globalApi.*` call sites (not 16) and 13 files on `bootArchivePassHarness` (not 20).

## 3. The plan and Gate 1

Two `investigator` runs at `2ccf4fc2` (rows 1099 and 1100) mapped the read and whole-state side and the write side. The read side found no decision refuted, four corrections (among them: `keepCurrentMainFile` fails open, and `commitSave` always takes the commit lock), 20 gaps and three maintainer questions. The write side found four refuted or load-bearing points (`mainFileRecord` keeps 4 consumers; the `risuSaveCache` put is the encoder's only macrotask yield; there is no commit lock for Tauri without Web Locks; `dbWriteLock` is taken before every `commitSave`) and three questions. The two together touched 77 of 485 test files (the read side's figure).

The Orchestrator drafted `plan-1c.md` revision 1 (D1 to D4 the maintainer's, D5 to D7 its own; 1b API additions 2.1 to 2.7; slices A to D in a worktree; a final Gate 2). Before drafting it verified, in source, that the cache put in `risuSave.ts` was the only macrotask boundary on the changed path, that clean-up was skipped without a lock off Node, that the no-lock skip existed in `globalApi.svelte.ts`, that the `botPresetsId` readers (`loadout.ts`, `AlertComp.svelte`, `BotSettings.svelte`) were unguarded, and that the single-instance plugin was registered.

| Round | Verdict | Findings | Orchestrator checks | Result |
|---|---|---|---|---|
| 1 (row 1179) | `[REJECT]` | M1 to M6, m1 to m13, S1 to S4 | M1, M2, M3, M4, M5 and m8 spot-checked in source; all hold | Revision 2: D5 revised to upstream's append rule; new 1b changes 2.8 (a validate hook) and 2.9 (`convertedAt`) |
| 2 (row 1180) | `[REJECT]` | N1 (the re-check loops on unreadable-content damage), N2 (D3 protection lost after a restore, `convertedFrom` not carried), N3, r6 to r11 | N1, N2 and others checked; all hold | Revision 3: N2 answered by simplification (any `database.bin` on a block profile is a D3 source) |
| 3 (row 1181) | `[EDITORIAL]` | E1 to E3; O1 taken, O2 disclosed | E1 to E3 checked | Plan accepted; Gate 1 closed |

The reviewer was the same `opus-reviewer`, resumed for rounds 2 and 3. Round 1's M1 to M6 and round 2's N1 and N2 were plan defects, not wording. The plan's later maintainer-lane note (the three UI files) was resolved when the maintainer ended the lane split (`MC-196` 5).

## 4. The slices

Each slice was built in `C:\Projects\RisuAI-1c` on `feat/stage-1c`, committed by explicit path, and gated by a fresh `opus-reviewer` (resumed across its own rounds). The Orchestrator saved the coders' reports where `Write` was refused.

### 4.1 Slice 1c-A — block-store core changes and the page owner (`04a2f9dd`)

What the commit message states: a head read is absent, bytes or not-binary (a head stored as anything other than bytes is never read as absent, and only a replace that expected it can overwrite it); a keep-all replace, used only over an unreadable head, marks every rooted generation kept before writing; an optional pre-flip check lets a whole-state replace abort before the flip; an in-process commit lock for stores without Web Locks (Tauri); `characterKeySegment` is memoised per id; one packed-names rule and one tree-to-block-set function; `load()` and `readCommitted()` accept an async validate hook; the head carries `convertedAt` beside `convertedFrom`; a per-page owner module picks the head swap and commit lock for the store kind; the encoder no longer writes `risuSaveCache` and yields after every block. Nothing calls the owner module yet.

Gate 2 (row 1190): `[EDITORIAL]` with two minor behaviour findings (m1: an IndexedDB null head reads as absent; m2: a stray keep-all marker on some exits) and E1 to E7. *Reviewer-run:* 39 scratch mutants, 37 killed; the survivor M27 became the O1 test. Remediation by the same coder (row 1191, executable for m1, m2 and O1; editorial for E1 to E7); round 2 (row 1192) `[APPROVE]`, the survivors R4b and R5 carried to slice B as optional tests. *Commit message:* "storage suites: 75 failures before the change". Scope extension accepted: `drive/tests/internalBackupSnapshotLoad.svelte.test.ts` (a test-only fixture).

### 4.2 Slice 1c-B — boot from the block store, convert, read-only page (`69623d30`)

What the commit message states. Boot: on every host the boot asks the block store first; a profile with a block head loads from its blocks and is decoded strictly before it is installed. Damage shows what is damaged and offers the newest backup that decodes completely (or, if none does, the newest partial one after a confirm listing what it lacks), or stops; the backup is written only after the choice, under a fresh exclusive hold, and only if the damage is still the same; loading it keeps the damaged generation, and under an unreadable head every older generation with a root (D1, D2). A profile with no head, no main file, no pre-blocks copy and no numbered backup is seeded as an empty block profile; nothing is seeded over data. The boot archive pass commits into the blocks when it has something to commit (on a legacy profile that commit is the conversion); a legacy profile it leaves alone stays on the main file. After a conversion the legacy main file is copied to `database.pre-blocks*` and deleted, only when it is the file the conversion read and only if it is unchanged since (a version condition on Node; a re-read and byte compare on Tauri and IndexedDB; on stores without versions a write landing between that re-read and the delete is still lost, which the message states). The startup asset sweep is held while a kept generation exists, after a backup is chosen at the damage prompt, while a pre-blocks copy exists, while a block profile still has `database.bin` beside it, and whenever one of those checks fails. A page that fell back to the transitional OPFS store opens read-only with a notice (D4). Twenty new strings in seven languages. The message states: "This commit must not ship without slices C and D."

Gate 2:

| Round | Verdict | Findings | Result |
|---|---|---|---|
| 1 (row 1212) | `[REJECT]` (substantive 1 of 3) | F1 MAJOR: the rename finish deletes `database.bin` unconditionally, so a peer or upstream write during the copy is lost (a scratch reproducer passed; verified by the Orchestrator at `mainFileRename.ts:66,74`). F2 to F5 MINOR: a Tauri re-read failure falls back to a backup silently; the pass can run after the hold is released; a head-only seed blocker reads as no save; the read-only OPFS page still writes through `cleanChunks`. Plan gap: the startup sweep ignored pre-blocks references. E1 to E5. | Remediation by the same coder (row 1213): red first for each fix; full suite 9534 passed; an extra guard that the boot's first `saveDb` is skipped on a read-only page |
| 2 (row 1214) | `[EDITORIAL]` | F1 to F5 and the D3 hold fixed and red-pinned (11 in-memory mutants, 9 caught). Required R2-E1, R2-E2 (docs). Open question: does D3 cover a Node over-limit `database.bin` left on a block profile? | The maintainer answered yes (section 2.1); a fresh coder (row 1215) made `olderMainFileCopyExists` (a head plus `database.bin` means held; a failed check means held), 6 tests |
| 3 (row 1216) | `[APPROVE]` | None. `LEGACY_MAIN_FILE_KEY` = `database/database.bin` confirmed; 6 mutants killed through the exact-match harness; full suite 9540 passed, 6 skipped | Notes carried: slice D must ship plan 3.8's dated delete of `database.bin` on block profiles (the only exit from the holds) |

The commit message was checked by the same reviewer (row 1217): four false or overstated claims (the `botPresetsId` clamp is not in slice B, because plan revision 3 moved the repair to slice D; the seed "stops" was wrong; "never converted only because it booted" was wrong, since a missing `archiveCharacters` key converts; the red sentence was overstated) and two omissions. The corrected text was used. Translations (row 1211): 20 keys in six locales; the join of `saveDamageItem` is "what: problem" in ko, de and es.

### 4.3 Slice 1c-C — save through the block store, snapshots, stop reasons (`420a9b7b`)

What the commit message states. The save loop no longer writes `database/database.bin` on any page. Every iteration that reaches the store holds the write lock, takes the layout and the packed blocks in one synchronous step, and commits only the changed blocks and the root through the page's one owner. A legacy page converts on its first committing save, unless the boot pass already did, with a whole-state replace that requires no head. A commit that wrote something broadcasts the tab's session id and the committed sequence number. The outcomes: a commit-lock timeout retries quietly; a refused commit (another tab committed, the head moved, the generation is gone) asks the person ("Save mine" is offered only to a page with a live generation and a known peer sequence number, never on Node, and overwrites only the peer commit that was asked about); a Node version conflict stops saving with the existing notice; a block over the Node body limit stops saving and names the block; a conversion whose new generation does not read back is retried at most three times per page, then stops with an alert; a conversion whose head switch cannot be confirmed stops saving and keeps the write lock closed. Remote Saving is off in the encoder (it writes no `remotes/` files). Numbered backups are taken from the encoder on the existing 5-minute cadence inside the write lock when a commit has changed the store since the last backup; on Node the size is summed before anything is allocated and a snapshot over the body limit is skipped with a once-per-page notice that advises exporting a `.bin` (`MC-195` 5). The save indicator has its own words for each stop reason; nine new strings in seven languages. The message states that closing the page while a commit is in flight is not delayed (a residual), and that slices B to D must ship together.

Gate 2:

| Round | Verdict | Findings | Result |
|---|---|---|---|
| 1 (row 1219) | `[REJECT]` (substantive 1 of 3) | F1 the read-only indicator never shows (verified by the Orchestrator); F2 the C7 stopped fold-back is unguarded (a mutant survives); F3 the snapshot notice lacks the `.bin` advice (`MC-195` 5); F4 a double prompt; F5 a skipped snapshot resets the failure streak. The `rootOwed` fix (a slice A owner defect found while building 1c-C: after a thrown root put) is correct; the landed root is not adopted in 1c | Remediation 1 (row 1220) with four taken improvements: a `pageStorageModeStore`, a real-client Node test, `saveBlockLabel` |
| 2 (row 1221) | `[REJECT]` (substantive 2 of 3) | R2-1 MAJOR: the F4 fix read the live peer sequence number when the prompt resolved, so "Save mine" silently overwrote a peer commit made while the prompt was open (probe `gate2probe2`; the assignment verified by the Orchestrator). The reviewer noted its own round-1 F4 recommendation had been too broad. R2-E1 plural-label grammar | Second-rejection question: the consent was not bound to a specific peer commit. Remediation 2 (row 1222) states the invariant (Save mine consents to the asked-about sequence only; one question per peer commit) in place of another guard |
| 3 (row 1223) | `[APPROVE]` | None. The invariant holds on all constructed paths (several peer commits asked about together as the latest state; the 60 s window never lets a commit through; Node unaffected) | An optional empty-label wording taken before translation (row 1224) |

Translation (row 1225): nine keys in six locales; the translator aligned `saveBlockLabel`'s terms with each file's existing keys. The commit-message check (row 1226) found five wrong or overstated claims (restores only; the broadcast only when it wrote; unconfirmed means conversion only; the digest compare is once per page; the mutants were file copies) and some omissions; the Orchestrator verified the `writeMainFile` callers, the unconfirmed source and `bootBackupCheckPending`, and corrected the UI label to "Load Backup Locally".

Process incident (row 1218): the coder used a relative `[IO.File]` path, which rewrote 12 test titles in the main checkout's `saveSkip` test file. The revert was denied; the maintainer restored the file themselves.

### 4.4 Slice 1c-D1 — restores through the block store, remote saving retired, preset repair (`7e90f83e`)

The slice D split into D1 and D2 was for review size, not scope. What the commit message states for D1. Neither restore (Load Backup Locally and the internal-backup load) writes `database/database.bin` on any page; each decodes, re-encodes the tree into a new block generation and switches the head to it with `replaceWholeState`, with the write lock held across it. The busy check runs again immediately before the head switch; work that started while the generation was built aborts the restore, nothing live changes, and the restore's generation is removed best effort. On a page with no block head the restore converts the profile. Results: a won replace takes today's success path and keeps the write lock closed until reload; a lost one releases the locks and says the load did not happen; an aborted one releases the locks and shows only the busy check's message; an unconfirmed one keeps the write lock closed and shows the reload message; one refused for the self-hosted request limit names the block. A block-format `database` entry in a `.bin` is decoded without the local block cache; the compressed legacy format that both this fork's and upstream's exports write is decoded as before. The internal-backup load keeps an undo copy first, or asks before loading with no copy. Both restores are refused on the page that runs from OPFS this time, before anything is written. Retired: the encoder's writes to `remotes/`, the remote existence checks, and the `enableRemoteSaving`, `skipRemoteSavingOnCharacters` and `writeBlockCache` options, with the Remote Saving row in Advanced settings; the `enableRemoteSaving` data field stays, and a legacy main file whose characters point at `remotes/` still loads from them and converts them inline. Preset repair: on the load paths a `botPresetsId` that is not an integer, below -1 or past the end of the list gets upstream's out-of-bounds rule once (the working settings are appended as a new preset and the id points at it); -1 is left alone; a plugin's `setDatabase` is not repaired. Five new strings in seven languages; the Remote Saving label and the unused `savingStoppedTooLargeMessage` are removed from every locale.

Gate 2:
- Round 1 (row 1235) `[EDITORIAL]`: m1 (the ISL page mode was never set), e1 to e4; O1 to O3 taken. Residuals O4 (a null in `characters` fails at encode after assets are written) and O5 (the too-large message names the current, not the restored, character names). *Reviewer-run:* the real tauri-plugin-fs `read_dir` throws on a file path, so `tauriFilesStore.has()` is correct and the ISL Tauri mock had been unfaithful.
- A `code-searcher` survey (row 1236) found lenient `readDir` mocks (that list a file path) in `manualCleanup.svelte.test.ts` (a D2 file), `coldStorageDeletionGuards`, `loadTimeListing` and `bootstrap.desktopLaunch`; the strict fake is `src/ts/storage/tests/tauriFsFake.ts`. The D2 brief had to move `manualCleanup`'s Tauri world onto the strict fake.
- Round 2 (row 1237) `[EDITORIAL]`: E1 (the `restoreBlockStore` header and titles), P1 (the scratch red copy had drifted; the reviewer restored it to `420a9b7b`). E1 fixed and verified by the Orchestrator (three text-only lines).
- Commit-message check (row 1238) `[EDITORIAL]`: six corrections (aborted against lost messages; relaunch wording; too-large releases the locks; best-effort retire; the deleted-file coverage claim; the review line).
- *Commit message:* run against slice C, 26 of 33 `restoreBlockStore` tests and 51 of 110 internal-backup load tests failed, every one on an assertion; four test files whose subject is gone were deleted.
- *Orchestrator-run, final snapshot:* `pnpm check` 0 errors and 0 warnings; `pnpm test` 485 files, 9615 passed, 6 skipped; `pnpm build` OK.

### 4.5 Slice 1c-D2 — manual clean-up on the block store, `writeMainFile` removed, the census (`53c84a0e`)

What the commit message states. Manual clean-up on a converted profile starts its keep set from the committed state, read and strictly decoded once; the run stops with nothing deleted when that state is damaged, unreadable, has no live owner, or differs from what this tab last loaded or committed. Older copies of the main file are keep sources (every `database.pre-blocks*.bin` and, on a converted profile, any `database/database.bin`) and are each offered for deletion with a date: the head's conversion time for the copy whose fingerprint matches `convertedFrom`, "date unknown" otherwise. Only pre-blocks copies and a matching `database.bin` are called the pre-conversion copy. A copy that does not decode stops the run unless the user deletes it. Kept generations (never the one the head names) are offered with their creation dates; keeping them stops the run. Leftover generations are offered with the other-device caveat; keeping them lets the run continue. Every question is asked and every check passes before anything is deleted; confirmed generations and copies are then deleted first, and any failure there stops the run before a single unit or asset is deleted. The questions are asked inside the run's exclusive lock (on the web, this tab's saves and a newly opened tab wait while a dialog is open; a residual). Clean-up is still refused on the OPFS page. With `writeMainFile` go the main-file version cell and the write bookkeeping only it used. On a converted profile the main file is deleted only by the rename finish and by a confirmed clean-up delete. One test drives the boot pass's commit, the save step, an import, manual clean-up, the internal-backup load and the `.bin` restore on one page and finds no write of `database/database.bin` and one delete (the rename finish). Twelve new strings in seven languages.

Gate 2:
- Round 1 (row 1240) `[EDITORIAL]`: E1 (`opfsCopyBack` writes `database.bin` beside a head when the `migrated` marker exists; residual S2, verified in `classify`), E4 ("nothing was deleted" is false after an earlier confirmed delete; the Orchestrator chose the deferred delete order).
- Round 2 (row 1241) `[EDITORIAL]`: E8 (a title), M1 (failure-branch tests), O-a (held bytes replaced by length plus CRC-32, for low-spec memory).
- Round 3 (row 1242) `[APPROVE]`. Commit-message check (row 1243) `[EDITORIAL]`, five corrections.
- *Commit message:* run against D1 with the new English strings overlaid, 34 of the then 244 clean-up and census tests failed; five tests for the deferred delete order fail when the earlier order is restored in memory.
- *Orchestrator-run:* `pnpm check` 0/0; 486 files, 9654 passed, 6 skipped; build OK.
- Residuals: prompts inside the exclusive lock (accepted); CRC-32 on the main thread for large copies (profile later); O-c a `CommittedChanged` "was not started" wording after questions; `mainFileOutcome.ts` is production-unused (O4); a kept generation's date is its creation time; a confirmed leftover gaining a marker mid-run (`MC-138`).

The agent that implemented D2 and the per-run figures of D1 and D2 are not in the records items (ledger rows 1233 to 1243: `TODO(evidence)`).

## 5. The final Gate 2 over the whole stage (`32f3e7e3`)

Round 1 (row 1244, `[REJECT]`, `c1final/gate2/round1.md`) over `2ccf4fc2..53c84a0e`:
- F1: `offerBackup` (`bootBlockLoad.ts`) skipped `completeRestoredTree`, so a backup that lacked the modules, loadouts or plugins list re-damaged the profile at the next boot (a scratch reproducer 3 of 3 red; confirmed by the Orchestrator in source).
- F2: `keepFromOlderCopies` read a non-binary `database.bin` with no catch, so clean-up was blocked for good and the startup sweep held for good (the uncaught read confirmed by the Orchestrator).
- E1 to E3 (comments). Optional: O1 (the rename finish re-reads the main file at each block boot, with a Node notice at each start; not taken), O2 (the owner holds the acknowledged block bytes, about one extra save copy; unmeasured, G14; it needs an emulator figure under the `MC-047` amendment), O3 (the Tauri pre-blocks copy was not flushed before the main-file delete; taken), O4 (CRC-32 on the main thread).

Round 2 (row 1246, `[APPROVE]`): F1, F2 and E1 to E3 fixed; O3 taken (the pre-blocks keys go through `write_durable`, which flushes the file and the directory). *Reviewer-run:* nine new tests fail under the reviewer's red config (`c1final/mut/vitest.red.config.mjs`). *Orchestrator-run:* `pnpm check` 0/0; build OK; 9665 passed, 1 failed, 6 skipped. The failure was `bootstrap.startupCleanup.test.ts` "guard: a clean-up that is still running..." at 5861 ms against the 5 s default; it passed 3 of 3 in isolation and in the prior full run, and the reviewer saw no causal link. It remains a residual: a timing-sensitive test under full-suite load. The commit message (row 1247) was checked and C1 to C4 applied. The commit changed 12 files. Per its message: backups chosen at the damage prompt are completed before they are written (and `completeRestoredTree` moved to `treeToBlockSet.ts`); a non-bytes `database.bin` no longer fails clean-up (it is offered for deletion as unreadable); on Tauri the pre-blocks copies go through the durable write command.

## 6. Merging `b6d8e963` and QOL-06 into `feat/stage-1c`

### 6.1 The `.bin` speed merge (`25d53bcf`)

Stage 1c awaited the maintainer's merge word after `32f3e7e3`. After the 36 GB measurement (Report 60) they said "yes, merge 1c." (`MC-197` 6). `fix/persistence-conflict-platform-hardening` (then at `b6d8e963`, the `.bin` speed commit) was merged into `feat/stage-1c` with `--no-ff --no-commit`: eight conflicts, as the final reviewer had predicted. The reviewer's merge notes (kept from round 1 of the final gate): `backuplocal.ts` keeps `b6d8e963`'s indexed loop with the 1c tail and drops `writeMainFile`, `noteMainFileBytes` and the sleep, with `refuseOnReadOnlyPage` first after the picker; `backuplocalEncryptedRefusal` combines the 1c block-store asserts with `b6d8e963`'s walk cases; the Node size-guard test files take 1c; `backuplocalMainFileRecord.test.ts` (modify/delete) is deleted; the renamed `saveDbMainFileRecord` test needs `b6d8e963`'s mock target; `backuplocalNodeOversizedAssets.test.ts` is rewritten for the block store and the page owner; and the harnesses that mocked `streamsaver` are pointed at the vendored `src/ts/vendor/streamSaver`.

A `sonnet-coder` resolved the conflicts (row 1250): full suite 9740 passed, 0 failed; `pnpm check` 0/0; build OK. Its open point: the oversized-asset test injects a `tauri`-kind store.

Review (rows 1251 to 1253): round 1 `[REJECT]` (F1: `SendDuringRead` was vacuous after the auto-merge; F2: `BusyRefusal` and `SendBeforeWrite` were vacuous, pre-existing; E1: a comment); remediation by a coder (`injectRestoreStore` and last-position controls); round 2 `[APPROVE]`, and the commit message was checked with no corrections. *Orchestrator-run on the final tree:* 492 files, 9743 passed, 6 skipped; `pnpm check` 0/0; build OK. Committed as `25d53bcf`.

Live checks of the merged tree (row 1254, `perf-analyzer`; the numbers are in Report 60 section 3): Part A on a Tauri desktop slice (restore, export, a converted profile: restore 461 s, export 185 s, all 31,069 assets SHA-256 identical, conversion and boot OK; the export's `database` entry decode was not directly tested) and Part C, the Node oversized-asset restore, both passed. The main checkout's branch was fast-forwarded from `b6d8e963` to `25d53bcf` on the maintainer's word. The records items do not record a live run of a web (IndexedDB) or Node-hosted conversion of a legacy profile (TODO(evidence)).

### 6.2 QOL-06 Empty trash (`e4a060e4`, merged as `8ca14be5`)

The maintainer asked for an Empty trash button in the trash view on 2026-10-05 (four points; the wording is not in the records items). A `investigator` packet, a Gate 1 by `adversarial-reviewer` (`[APPROVE]` with M1 to M9, all taken except M6e; the reviewer's claim that there was "no key-parity test" was wrong) and an Orchestrator call (keep the open chat when it is not deleted, by re-pointing the selection by reference) shaped it. The commit message states: the button shows only while the view lists at least one trashed character, and with a search it reads "Delete N matching"; one confirm names the count and warns about work in progress; `removeTrashedCharacters` removes by reference, not by index, and records each character's trash time at the click and checks it again after the confirm; the removal is one synchronous change to the character list, and each removed character is marked for save so the next save drops all their blocks in one commit; assets and cold-storage units are not deleted here (the startup sweep and manual clean-up handle them); five new strings in seven languages. Gate 2 `[APPROVE]` in both rounds (optional items 1 to 4 taken); the commit message needed six corrections. *Orchestrator-run:* `pnpm check` 0/0; 490 files, 9638 passed; build OK.

The maintainer said "you can merge the QOL branch when ready." The merge into `feat/stage-1c` after `25d53bcf` was textually clean; the full suite passed (495 files, 9780 passed, 6 skipped) and the build was OK, but `pnpm check` reported one error, because a `removeTrashedCharacters.save` test passed `skipRemoteSavingOnCharacters`, an option D1 removed. The Orchestrator removed the option (one line, CRLF kept; `pnpm check` 0/0 afterwards and that test passes, 3 tests). The `adversarial-reviewer` (row 1255) approved the merge; the optional dead `writeBlockCache` and `enableRemoteSaving` options were also dropped from the save test. Residuals: removal of an archived (stub-packed) trashed character is not exercised by a merged-path test (reasoned OK: the same path as `removeChar`); whether D2 clean-up later sweeps the orphaned cold unit was not checked. Committed as `8ca14be5`; the main checkout's branch fast-forwarded to it.

## 7. Residuals and open items

Behaviour and measurement:
- The owner holds the acknowledged block bytes, about one extra save copy (O2 of the final review): unmeasured; an emulator figure is owed under the `MC-047` amendment (`MC-198` 8).
- CRC-32 for large copies runs on the main thread (D2, and O4 of the final review); profile later.
- The rename finish re-reads the main file at each block boot, and Node shows a notice at each start (O1, not taken).
- The questions in manual clean-up are asked inside the exclusive lock (accepted).
- On stores without versions, a write landing between the byte re-check and the delete of the old main file is still lost (stated in the slice B commit message).
- Closing the page while a commit is in flight is not delayed (slice C commit message).
- The timing-sensitive `bootstrap.startupCleanup` test under full-suite load (section 5).
- `opfsCopyBack` can write `database.bin` beside a head when the `migrated` marker exists (S2; clean-up then protects it as an older copy).
- Not verified natively (as in Report 58): a Tauri webview run of the whole stage beyond the post-merge Part A slice, IndexedDB atomicity outside `fake-indexeddb` and the three-browser test in `MC-195` 6, Safari and Android Chrome, power loss.

Documentation and tests: `mainFileOutcome.ts` is production-unused; the D1 residuals O4 and O5; the QOL residuals in section 6.2; the Android merge review's O3 (the `tauriFilesStore` header omits the pre-conversion copies). These are filed as CHORE-113 (Roadmap).

## 8. Native-speaker review items (all low confidence; `MC-212`'s deferred review)

From the translator runs and the slices' commit messages: slice B (ko `saveDamageItem` fragments and "move aside" in `saveMainFileLeftNotice` in all locales; de and es `saveDamageItem` phrasing); slice C (the `saveBlockLabel` terms; existing maintainer-owned oddities left untouched: vi `plugin` = "Cắm vào", cn `presets` = "默认设置"); slice D1 (cn 读取 against 恢复 and zh-Hant 載入 and 還原 verb pairing; vi `restoreNoUndoCopyConfirm` long sentence; de "Ohne Backup-Kopie fortfahren?"); slice D2 (the ko date-unknown label; cn and zh archived-data terms; de Hauptdatei, Teil(e) and the feminine-label constraint; es fragmento(s) and copia; vi heavy "đã"); QOL-06 (de and es short labels and the singular "Den 1 Charakter" and "el 1 personaje"; the ko one-character confirm left as is). These are collected in CHORE-111.

## 9. Ledger and numbers

Ledger rows: 1099 and 1100 (the two side maps), 1179 to 1181 (Gate 1), 1184 and 1190 to 1192 (slice A), 1210 to 1217 (B), 1218 to 1226 (C), 1227 to 1232 (QOL-06), 1233 to 1238 (D1), 1239 to 1243 (D2), 1244 to 1247 (the final review), 1248 (the 36 GB measurement), 1250 to 1254 (the merge and its live checks), 1255 (the QOL merge). The ranges were granted in `MC-196` 2. Many figures in rows 1227 to 1247 are `TODO(evidence)`: the records items give no token figure for those runs.
