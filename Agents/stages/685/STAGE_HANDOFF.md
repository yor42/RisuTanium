# #685 stage handoff: S7-0 (lore object-list op family in the Studio history core)

- Stage: S7-0 of `docs/design/studio/S7_LORE_SPEC.md` r6, section 10 row S7-0. PR "Refs #685" (does not close the issue). Next stages, started by lane A after this merges: S7-4, S7-1, S7-3; S7-2 and S7-5 any time after S7-0.
- Commit: the reviewed S7-0 commit is the first commit of this PR on `claude/685-s7-0-5d3d39` (built on `origin/main` `2099bea7a`); the PR head adds only a merge of `origin/main`.
- Decisions: `Agents/mc/685-s7-0.md`, MC-4090 (a Studio edit of a lore field whose stored value has the wrong kind is refused as `precondition`; no format change). MC-4091..4099 are unused, held for the rest of #685.
- History-core slot: this PR edits `fieldRegistry.ts`, `historyModel.ts` and `ownerHistory.svelte.ts`. Lane A frees the slot when it merges.

## What landed

- `src/ts/studio/history/objectLists.ts` (new, pure tables): `OBJ_LIST_HOLDERS`, `OBJ_LIST_FIELDS` (`LORE_FIELDS`, frozen by a test), `OBJ_LIST_IDENTITY`, anchor-excluded keys, `OBJ_PROPS`, asset-merge prefix and message key names (plain strings; S7-1 narrows them to `en.ts` keys when it adds them with all 7 locales). Tests replace this module with a probe row (`sessionKinds.ts` precedent).
- `src/ts/studio/history/objectListOps.ts` (new, pure, part of the stored format): op types `objInsert`, `objRemove`, `objSet`, `propSet`; canonical JSON and `entryAnchor` (total over non-objects, cycles, bigints); identities and counts; strict parsers for ops, labels and deleted items; inversion; drafts and `completeObjOps`; `planObjStep` (all or nothing, per-run tag rule, descending tagged remove runs, `already` witness with tags off, `dropStep`, `precondition`); listing effect; journal tail-merge (always a new op object).
- `historyModel.ts`: obj ops, labels and items in the v2 parser with kind acceptance per table; routing from `planReplay` (obj-only and mixed steps), `planRevert` (obj half planned once, newest first; mixed-revert refusal per list prefix) and `planRestoreDeleted`; `mergeCoalesced` for `objSet` and `propSet`; restore point creation for obj/propSet edit commits; `planRestoreWithLines`.
- `fieldRegistry.ts`: `lorePlus` in `FIELD_SPECS` and `FIELD_PRESENTATION`; it joins the character's restore row. `sessionKinds.ts`: one optional field (R6). `studioHistoryStore.ts`: the version-rule comment names S7's shapes (version stays 2, MC-1827).
- `edit/studioSetters.ts`: obj readers and host writers (character in place, chat through `writeLiveChat` with marks, module copy-on-write; absent lists are assigned whole on the first insert, never spliced through a raw reference of a `$state` proxy).
- `ownerHistory.svelte.ts`: `objEdit` intent, Rule K extended to obj ops, labels and produced deleted items; the per-owner, per-visit, per-list journal; `OwnerView.restoreLines` and `restoreNotes` (the visibility table); `restore(owner, keep, { lines })`.
- `StudioHistoryPanel.svelte`: interim type narrowing; obj and prop steps and obj items show `language.loreBook` until S7-1.

## Gates

- Tier 2, critical contracts (stored history format; persisted live writes and replay; restore point and journal).
- Designer: Opus. Gate 1 round 1 (opus-reviewer) [REJECT]: S1 T50's I4 oracle, S2 deleted-item order and Rule K. Plan r2 fixed both. Round 2 (fresh opus-reviewer) passed with editorial conditions N1 (absent-list proxy trap), N2 (OwnerView literals), N3 (index check comment), all applied.
- Coders: five serial fresh Sonnet sub-stages (0a format, 0b planner, 0c host writers, 0d service, 0e property test by test-warrior).
- Gate 2 round 1 (opus-reviewer) [REJECT]: S1 parser accepted absent-to-absent `objSet` on unsettable or unknown fields; S2 M60 and M61b survived. Remediated (red before green; both mutants killed). Gate 2 round 2 (fresh opus-reviewer): [APPROVE] (S1 refusal re-executed, 44 legitimate shapes still accepted; M60 and M61b killed).
- Mutants: 42 run at Gate 2 round 1 (including the plan's designer mutants); 40 killed, the two survivors fixed in remediation.
- T6: the pre-S7 parser (`2099bea7a`) refuses every record in `fixtures/s7Records.json` and every shape alone.
- R9 journal memory (real service, i9-13900KF, best case; `$env:RISU_MEASURE_JOURNAL='1'`): 500 writes into one 25,000-character field keep one entry (structural about 100 KB, budget 128 KiB); 200 alternations between two fields of one row and of two rows: structural about 10 MB, budget 16 MiB. The structural number is the gating one. No cap and no maintainer question needed (10.1).
- T50: 1000 runs by default (about 7 s), 5000 passed; no counterexample.

## Test results

- `pnpm check`: 0 errors.
- Before remediation, orchestrator: `pnpm vitest run src/ts/studio src/lib/Studio src/ts/storage/tests/globalApi.saveStore2.svelte.test.ts`: 322 files, 6796 passed, 3 skipped (the env-gated R9 file).
- After remediation, Gate 2 round 2: the 15 S7 test files, 193 passed; `pnpm check` 0 errors.

## Known limitations and leftovers

- Spec note (for the next spec revision): section 9's T50 I4 oracle must be read net of the same direction's re-adds (Gate 1 r1 S1); the plain wording fails on a correct `already` undo of a move. "Returns the initial bytes" in T50 means canonical JSON (key order aside), as T39 already says.
- E2 (for S7-1): `mergeCoalesced` merges `objSet` by list, index and field, as spec 4.2 says. A sub-second outside reorder while typing could merge two rows' edits; S7-1's `coalesceKey` should bind the row identity (entry id or anchor), not only the index.
- E4: T50 never reaches the `dropped` class; `dropStep` is covered by a model test (M37). S7-1's T50 re-run with real builders should reach it.
- E5: `FIELD_PRESENTATION.lorePlus.focus` names a target no component renders until S7-1, so going to that field from History does nothing until then.
- No production path creates obj steps before S7-1 (no builders in S7-0).

## For #708 SC-0 (lane A's question, SCRIPTS_SPEC 4.6)

- N1, N5, N6: present (per-list tables read by the parser, planner and builders; journal, line and keys per list; mixed-revert prefix per list).
- N10 (listing follows the ops whatever the label): holds on the obj path. Listing and consuming come from the tagged ops through `planObjStep`/`applyObjEffect`, the `already` move included; the greeting `restoreDeleted` label branches in `applyReplayMove` act only on `listInsert` ops, which an obj step never holds.
- N9 (`span`, `created` op keys; per-list planner checks; restore rule): not present. `parseObjOp` and `parseObjItem` check fixed key lists, and `invertObjOp` copies only the known keys. The door is open: SC-0 adds a table column for extra op keys and threads it through the parser, inversion and item construction (one mutant per touchpoint).
- N11 (caller-supplied fresh id for E): not present. `planRestoreDeleted(record, deletedId, live, context)` tags the restore with the item's own id; SC-0 widens it.
- N2 (array field kind), N3 (`created`), N4 (any list's builder through `objEdit`: present for table lists), N7 (coalescing by list, index, field and label field: the builder's `coalesceKey`), N8 (closed `ObjAction` vocabulary: present; `replace` not added).

## Instructions for the next stage

- S7-1 builders emit `ObjDraft`s; the service completes counts and anchors (`completeObjOps`). Call `service.objEdit(owner, build)`.
- S7-1 wires `restore(owner, keep, { lines })` and `restoreNotes` into the sheet, replaces the interim `language.loreBook` texts, and re-runs T50 with the real builders.
- Scratch artifacts: `%TEMP%\risu-b715\685-s7-0\` (plans, gate reports, coder reports, dispatch files).


---

# #685 stage handoff: S7-4 (lore decorator table, block parser, warnings, autocomplete, probability line)

- Stage: S7-4 of `docs/design/studio/S7_LORE_SPEC.md` r6, section 10 row S7-4. PR "Refs #685" (does not close the issue). Branch `claude/685-s7-4` from `origin/main` `dbe8084a8` (S7-0 merged as PR 747).
- Reviewed commit: the first commit of this PR; any later head commit is only a merge of `origin/main`.
- Decisions (`Agents/mc/685-s7-4.md`):
  - MC-4091: the maintainer's stage order. S7-4 runs here, and a separate Sonnet session runs S7-2 then S7-5. S7-1 comes after S7-4 merges, asked of the maintainer then.
  - MC-4092 and its O-5 addendum: Clear keeps `@@probability 100` where a `@@@` fallback follows (spec 3.3a) **or** where removing the line would change the body or the executed non-probability decorator sequence (a MC-091 shared-cause correction from Gate 1 round 1 S1).
  - MC-4093..4099 are unused, held for the rest of #685.
- Files kept off: no history-core file, no `lorebook.svelte.ts`, no `loreScanDecorators.ts`, no S7-2/S7-5 file, no `en.ts` or locale.

## What landed

- `src/ts/process/loreDecoratorTable.ts` (new leaf module, shared with #687 per spec O1): one row per decorator the scan handles (argument rule, hints, examples, `returnsIgnored`, effect, deprecated); a block parser matching ccardlib 0.4.2's `Ce` with raw offsets; the handler-result model and static run simulation.
- `src/ts/studio/longText/loreDecorators.ts` (new): W1-W6 warnings and the deprecated-form info, decorator notes, the `@@` autocomplete source, `readProbabilityLine`, `writeProbabilityLine`, `clampProbability` and `probabilityClearKeeps`. All are pure; S7-4 writes no owner data. User text is injected through a typed `LoreDecoratorCopy`; the keys arrive with S7-1.
- Generic field wiring (the field stays unaware of lorebooks):
  - `problemsModel.ts`: `ExtraProblem` and `withExtraRows`;
  - `macroPick.ts`: `PickSource`;
  - `highlightSpans.ts`: a `decorator` note kind;
  - `LongTextOverlay.svelte`: the note class;
  - `LongTextField.svelte` and `LongTextFocus.svelte`: optional `extraProblems` and `extraPicks`;
  - `MacroPicker.svelte`: an optional match label.
  - Existing long-text kinds are unchanged (TW7).

## Gates

- Tier 2, Opus designer.
- Gate 1:
  - Round 1 (opus-reviewer) [REJECT]: S1, Clear on the only block line pulled later `@@` lines into the block (body changed; `@@position` made the scan throw; reproduced against real ccardlib); S2, sub-stage types out of order; S3, MD10 not killed.
  - Round 2 (fresh opus-reviewer) [EDITORIAL]. It fuzzed 1.3 million contents against real ccardlib with 0 unsafe writes.
- Coders: three serial fresh Sonnet sub-stages, 4a (table and parser), 4b (lore functions) and 4c (field wiring).
- Gate 2:
  - Round 1 (opus-reviewer) [REJECT]: F1, T33p did not check the edited bytes, so a CRLF append with `\n` (X4) survived. Remediated test-only: the CRLF case and byte-content assertions; X4 and MD13 now fail. F2 restored a stray whitespace edit.
  - Round 2 (fresh opus-reviewer): [APPROVE] (X4 and MD13 re-executed and killed; only the two remediation files changed).
- Mutants: the spec's M14, M19, M20, M21, M40 and the plan's MS/MD set. MS2 (view compare without the sequence compare) was judged equivalent under the union rule. The kill table corrections (F3): MD19 is killed by T63 only; MD13 and MD15 by T33.

## Test results

- Orchestrator, before remediation: `pnpm check` 0 errors; `pnpm vitest run src/ts/studio src/lib/Studio src/ts/process src/ts/themePack src/styles` gave 857 files, 20488 passed, 3 skipped (env-gated).
- After remediation: `pnpm vitest run src/ts/studio/longText src/ts/process/tests/loreProbability.probe.svelte.test.ts` gave 39 files, 930 passed; `pnpm check` 0 errors.

## Known limitations and leftovers

- E3 (Gate 1 r2): a kept `@@probability 100` still keeps the entry out of ChroMemory lore recall, as any `@@probability` line does today. That is #687's concern.
- O-3 (for #687): #687 may later replace `INERT_DECORATORS` and its body parse in `loreIndex.ts` with this module's table and `decoratorBody`; a test keeps them equal meanwhile.
- O-4 (next spec revision): stale code citations listed in the plan's current-code map. Also, the spec's 3.3a Clear rule should state the MC-4092 union.
- S7-4 renders no decorator text in production until S7-1 mounts the content field with the copy and keys.

## Instructions for S7-1

- Add the decorator `en.ts` keys (`studioLoreDeco*`, `studioLoreDecoHelp.<name>`) and a picker count key (for example `studioLoreDecoMatches(n)`), with all 7 locales, and build the `LoreDecoratorCopy` from them.
- Mount the entry form's content field with `extraProblems` / `extraPicks` from `loreDecorators.ts`.
- Probability control:
  - fill and disable it from `readProbabilityLine`;
  - commit `writeProbabilityLine`'s result as one `objSet content` with label field `probability`;
  - show the kept notice when `probabilityClearKeeps` is true (S7-1 may reword it to cover both keep reasons).
- Scratch artifacts: `%TEMP%\risu-b715\685-s7-4\` (plans and their hashed gate-input copies, gate reports, coder reports, dispatch files).

# #685 stage handoff: S7-1 (lore list, entry and folder forms, list ops, restore sheet lore line)

- Stage: S7-1 of `docs/design/studio/S7_LORE_SPEC.md` r6, section 10 row S7-1. PR "Refs #685" (does not close the issue). Branch `claude/685-s7-1-45f7b9` from `c9bf67eda` (main after PR 758), with `origin/main` merged before the PR.
- Reviewed commit: the first commit of this PR; any later head commit is only a merge of `origin/main`.
- Decisions (`Agents/mc/685-s7-1.md`): MC-4190 (a new folder's name starts empty), MC-4191 (bulk and folder Always-active toggles skip rows with a malformed stored value), MC-4192 (one rule for deferred row surfaces after the fourth Gate 1 reject), MC-4193 (device rows run before merge, PC legs and phone legs). MC-4194..4199 are unused, held for the rest of #685. Also applied: MC-4090, MC-4092, MC-4179, MC-4180, MC-4182, MC-4184.
- Files kept off: no history-core file (#681 S3b holds that slot, MC-4186). Lore persisted writes go only through `service.objEdit(owner, build)` and `restore(owner, keep, { lines })`.

## What landed

- Pure layer: `edit/loreListModel.ts` (rows, row keys, folder tree, selection planner: Rules P, U, L, O and the deferred-surface tokens of Rule D), `edit/loreListOps.ts` (builders for add, duplicate, delete, folder delete subtree, move, bulk and folder Always active, local activation `loreActivateInChat`, link and unlink), `edit/objListCopy.ts` (step texts and refusal texts), `studio/loreFolderExpansion.ts`.
- `process/loreEntryMigration.ts`: `migrateLoreEntryToV2` extracted byte-for-byte from `updateLorebooks` in `characters.ts` (TC1 literal bytes, T46b).
- UI: `StudioLorePane.svelte`, `StudioLoreList.svelte` (windowed list, row menu, Move to folder sheet, bulk menu), `StudioLoreForm.svelte` (entry form with the S7-4 decorator copy, warnings and picks mounted, probability control, local activation switch), `StudioLoreFolderForm.svelte`, `StudioLoreFolderConfirm.svelte`.
- `StudioDetail.svelte` loads the pane lazily (`{#await import(...)}` inside `{#key ownerKey}`, with `studio-lore-pane-load-failed` on failure). This departs from plan F touch 1 (a static import), because the static import pulled `parser.svelte.ts` and its module-level effect into 11 existing StudioDetail test files. Gate 2 accepted it.
- History surfaces: the restore sheet shows the lore line and sends `lines` on Confirm and on the risky-confirm retry (re-read at retry time); History panel lore step texts; the refused-Undo toast maps obj refusals. T50 now runs on the real builders; `loreOps.test-helpers.ts` is deleted.
- Carry items from S7-0 and S7-4 (carry note): the kept-Clear notice wording and its show rule, the `extraPicks.matches` binding, the `refreshPicker` comment, `coalesceKey` bound to row identity, T50 on real builders, the `lorePlus` focus target, the decorator keys and `LoreDecoratorCopy`.
- `en.ts`: 126 keys; all 7 locales by the translator (localeParity 7/7). Spec r6 edited (3.3a MC-4092 union, 3.4 MC-4190, 3.9 restated, section 8 copy, 9.1 T50 notes).

## Gates

- Tier 2, Opus designer and orchestrator.
- Gate 1 (opus-reviewer, fresh each round): r1 [REJECT] (chat owner lifecycle, re-point flushes, landing focus); r2 [REJECT] (tracked entry lost off module hosts, list-mode follow opened the form); r3 [REJECT] (stale Back row key), then a senior-advisor escalation (derive the row key from live rows, one reconcile path); r4 [REJECT] (folder confirm from the form had no token), then MC-4192; r5 [EDITORIAL] (E-8 focus only if inside the closing surface, E-10 PR-body limitation, E-11 retry passes re-read lines).
- Coders: serial fresh Sonnet sub-stages 1a, TL (translator), 1b (first attempt cut by the quota pause, completed by a correction attempt), 1c, 1d, then the DOC row (doc-writer).
- Gate 2: r1 (opus-reviewer) [REJECT]: S1, the local-activation link and unlink History steps named the entry "Unnamed lore"; E1 silent read-only module host when the repair import fails; E2 T24d wording; E3 the E-10 limitation. Contracts 1 to 5 held; 8 reviewer mutants killed. Remediated (S1 with a test shown failing first, E1 note with `language.error`, E2 wording). r2 (fresh opus-reviewer) [EDITORIAL]: E-r2-1, the form's unlink caller name was uncovered (mutant S1-M2 survived); closed by a label assertion in T24 (b), S1-M2 then killed (1 test fails), source restored byte-identical.
- Test-only amendments to existing tests, judged by Gate 2 (D2): StudioDetail.moduleForm and StudioDetail tests mock `moduleLorebookRepair` and `alert`; StudioDetail lore-vehicle tests moved to a kind that keeps the read-only view; StudioHistoryPanel.assetLines lore lines no longer interim; StudioRestoreSheet.formControlNames and StudioScreen.back view mocks gain `restoreLines`/`restoreNotes` (the real view always has them); TL1 waits for the module-host toggle to be enabled (the host is read-only until the lazy repair import resolves).

## Test results

- Orchestrator, before Gate 2: `pnpm check` 0 errors; targeted run of 132 files (every touched test file plus the Studio detail, screen, history and long-text neighbours, `localeParity` and `src/ts/studio/history/tests`): 3081 passed, 3 skipped.
- After remediation: `pnpm check` 0 errors; the six remediation files 139 passed; `StudioLoreForm.svelte.test.ts` 18 passed.
- Post-merge numbers are in the PR body.

## Known limitations and leftovers

- E-10 / E3: an uncommitted probability Clear is dropped when the form unmounts without a blur, as with other Studio number fields.
- E-a widened (spec 3.9 consequence): an open id-less entry drops to the list with `studioLoreEntryGone`, although it still exists, when a change Studio did not run as its own op re-creates its element (module-host History replay of a field, undo or redo of a move or Give id, undo or redo of New ID, a classic-editor drag). Studio's own ops never cause it.
- Deferred surfaces close, writing nothing, on any view change or when their captured target can no longer be resolved; the user opens them again.
- Duplicate does not open the copy; the copy's row is focused (Rule L).
- Device rows DV-L1..L7: see the PR (MC-4193).

## Instructions for the next stage

- S7-3 adds Import and Export; section 8 already lists the `studioLoreImport*` keys, which are not in `en.ts` yet.
- Keep lore writes on `objEdit` and `restore(..., { lines })`; new list ops get a builder in `loreListOps.ts` and a step text in `objListCopy.ts`.
- Scratch artifacts: `%TEMP%\risu-b715\685-s7-1\` (plans r1..r5 and their hashed gate-input copies, gate reports, coder reports, dispatch files).