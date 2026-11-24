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
