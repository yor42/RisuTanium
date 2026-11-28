# Per-task parameter modes (#929): plan, revision 2

## Summary
- Decision: the four modes live inside the existing container, `seperateParameters.taskModes` (`memory`/`emotion`/`translate`/`otherAx` -> `'same'|'own'`), not in a new top-level preset field. The container already moves whole on every path.
- Migration is a read rule (MC-5090): a missing or unreadable mode reads as the flag says; a flag that disagrees with the modes wins. The stored flag always equals "any task own" (MC-5092).
- `.bin`: the key is stripped from the root and every slot from S1a on; from S1b a `same` task's block in a flag-on record becomes a copy of that record's main values (MC-5091). Flag-off records are untouched (N1).
- Slices: S1a engine + strip (no mix can exist), S1b synthesis + warning, S2 classic per-task rows, S3 Studio via #706 stage f.
- Maintainer answers 2026-11-28 are recorded (MC-5094..5096); only the N7 wording awaits review at S2 planning.

## Requirements and scope
In scope: key, read rule, resolution, the two flag writers, classic filter, `.bin` strip and translation with warning, preset files (N4), S2, S3 hand-over. Out of scope: `overrides` semantics and the by-model switch (MC-5093), the missing-block `TypeError` (census U4), the Models page row (DS-082, reuses the S1 helpers), EasyPanel parameter tabs beyond "run".

## Decision: nested key
Census section 5 lists every container reader (COMPLETE for its query). Only `SeparateParametersSection.svelte:19-21` iterates the keys; requests read only `[modelMode]`, `overrides` and `otherAx` (`shared.ts:22, 190-201`); every other path moves the container as one value, including both settings `.rtb` apply sites (`rtbSettingsRestore.ts:89-92`, `settingsPayload.ts:757-761`) and the full `.rtb` unit closure (P7). Upstream with a stray key shows a raw-labelled editor while the flag is on, writes nothing unless edited, except that a select bound to an undefined member writes its first option on mount (a harmless `thinking_type: off` inside the modes object; moot while the key never reaches upstream data), never sends it, and keeps it through every save and switch (census U7, U10). Nesting costs one fork UI filter and a strip on every upstream-bound writer; the separate field needed eight contract edits and missed the `.rtb` slot merge (Gate 1 F2).

## Approach and stages
### Mechanism
1. **Key.** `taskModes?: Partial<Record<TaskKey, 'same'|'own'>>` in the container type of `Database` (`database.svelte.ts:1188-1194`) and `botPreset` (`:1840`); no request mode, `overrides` or block member can take the name. New pure module `src/ts/storage/taskParameterModes.ts`: `TASK_KEYS`, `TASK_MODES_KEY`, `effectiveTaskModes`, `setTaskMode`, `setAllTaskModes`, `mainValuesAsBlock`, `representable`, `binTaskParameterRecord`, `withoutTaskModes`.
2. **Read rule** `effectiveTaskModes(record)`: `f = Boolean(record.seperateParametersEnabled)`; a plain-object `taskModes` in a plain-object container gives each task its value when `same`/`own`, else `f ? own : same`; if `anyOwn(result) !== f`, all `f ? own : same`. I1 by construction. A non-object container or key reads as absent. No load write.
3. **Writers.** `setTaskMode(record, task, mode, {copyIntoEmpty})`: `next = {...effectiveTaskModes(record), [task]: mode}` (all four readable, so an unreadable member is replaced, A2); a new `taskModes` object and `seperateParametersEnabled = anyOwn(next)` in the same synchronous step; with `copyIntoEmpty`, `own` and an empty block, a new block `mainValuesAsBlock(record)` in that step (N6). A record without a container gets the five empty objects first. `setAllTaskModes(record, mode)` writes all four and the flag. No writer sets a mode or the flag alone. Rewire: the classic checkbox (`SeparateParametersSection.svelte:17`) calls `setAllTaskModes(db, check ? 'own' : 'same')`; EasyPanel "run" (`EasyPanel.svelte:71`) calls `setAllTaskModes(db, 'own')` only when no task is `own`, else leaves modes and flag (already on).
4. **Classic filter.** `SeparateParametersSection.svelte:19` iterates the container's keys without `TASK_MODES_KEY`; every other key shows as today.
5. **Resolution** (`shared.ts:190-201`; both loops kept byte-for-byte as local MAIN and BLOCK). `E = effective(db)`, `on = Boolean(flag)`:
   - `model`: `on && byModel` ? overrides[modelId] (throws if missing) : MAIN.
   - `submodel`: `!on` -> MAIN; by-model with a missing entry throws (today); then `E.otherAx === 'own'` ? BLOCK(otherAx) : MAIN.
   - aux: `!on` -> MAIN; `byModel` -> overrides[modelId] (throws if missing) in either mode; else `E[t] === 'own'` ? BLOCK(t) : MAIN.
   by-model keeps precedence for `same` tasks so the fork matches its export (census R8).
6. **`.bin` strip (S1a)** in `exportCopyOf` (`backuplocal.ts:266`), synchronously before its first await (`:292`), beside the `botPresets` copy (`:272-274`): `plain` and every `plain.botPresets[i]` whose container holds the key become new records with a new container without it. A record without the key keeps the page object (I4).
7. **`.bin` translation (S1b)** extends step 6 per record with `E = effectiveTaskModes(record)`, never the raw key (Gate 1 F4): with the flag on, every task with `E[t] === 'same'` gets `mainValuesAsBlock(record)` in the new container. Flag on with a raw all-same key reads all own and synthesizes nothing (census R16). Flag off: strip only (N1). The flag is not rewritten.
8. **Copy rule** `mainValuesAsBlock(record)`: only the eleven block-path keys, from their main fields (census 4). Values verbatim, `null` copied, absent stays absent; a slot's constant switch fallbacks apply as `setPreset` loads them. The display-only thinking-type members are never copied.
9. **Rule P and the warning (S1b).** `representable(parameter, value)` is the table T-D1 produces: strict and data-only, compared on the `data` object `applyParameters` returns (an own `undefined` key differs from an absent one), for all eleven keys regardless of model (N5). Expected unrepresentable: `thinkingTokens` `null`. One leave-out kind `taskParameters` (preset, task, parameter or "replaced block") lists unrepresentable main values of `same` tasks in flag-on records and, per N2, replaced non-empty blocks that differ from the copy. Pattern: `binLeaveOut.ts:26, 39, 77-78`, `backuplocal.ts:986, 1013, 1018`, `dataLeaveOutSheet.ts:84, 119`. Cancel writes no file.
10. **Settings report** (`SettingsExportButtons.svelte`, `risutanium-settings-report.json`) is diagnostic, never imported, and exempt from the strip.
10b. **Preset files.** S1a: `downloadPreset` (`database.svelte.ts:2638-2642`) and `buildPresetBundlePayload` (`presetBundle.ts:83`) apply `withoutTaskModes` after `withoutPresetMeta`, so a bundle entry still equals a single export. S1b (N4, MC-5095): the same per-record translation as step 7 (copies for `same` tasks only when the flag is on, key absent), and the step 9 warning covers a preset file as it covers a `.bin`.

### Dirty tracking and order
Writers assign new `taskModes` and block objects inside the existing container together with the flag, synchronously; the root and `botPresets` effects deep-read both (`dbChangeEffects.svelte.ts:132-138, 251-262`). Flag and container share the lock group and the fast-forward record (decided whole), so only the `.rtb` dropped-container case separates flag from modes, and the disagreement rule covers it (census R13).

### Stages
- **S1a** steps 1-6 and the step 10 strip. Only `setAllTaskModes` writes, so no mix exists and the key never leaves the fork. Critical contracts: persisted preset shape, `.bin` translation, request resolution: opus-reviewer Gate 2.
- **S1b** steps 7-9 and 10b (preset files), warning strings (en + 7 locales by translator, localeParity, MC-058). Settled by MC-5094..5096 (N2, N4, N5). Merges before S2. opus-reviewer.
- **S2** classic rows: one row per task ("Same as main" / "Own", `setTaskMode` with `copyIntoEmpty`); a task's editor while `own`; `overrides` while any is `own`; N7 text. 8 locales. Native Sonnet Gate 2.
- **S3** #706 stage f: four mode rows replace `presetSepParamsEnabled`, writing through `setTaskMode` as one history step (modes, flag, copied block); `taskModes` is a sentinel for the generic container paths (never shown, never a `SetPath` target). Lane A routes the spec revision.

## Expected files
S1a: `src/ts/storage/taskParameterModes.ts` (new), `database.svelte.ts` (types, `downloadPreset`), `storage/presetBundle.ts`, `process/request/shared.ts`, `drive/backuplocal.ts`, `lib/Setting/Pages/SeparateParametersSection.svelte`, `lib/Others/ProTools/EasyPanel.svelte`, tests. S1b: `taskParameterModes.ts`, `backuplocal.ts`, `drive/binLeaveOut.ts`, `setting/dataLeaveOutSheet.ts`, `src/lang/*.ts` (8), N4 files, tests. Unchanged: `records.ts`, `presetLocks.ts`, `settingsFields.ts`, `settingsPayload.ts`, the three preset functions. S2: `SeparateParametersSection.svelte`, `src/lang/*.ts`, a component test. S3: #706 stage f.

## Invariants and compatibility
I1 the flag equals any-own of the effective view, every record. I2 flag and container travel together; modes travel inside the container. I3 migrated requests byte-identical (census 1-16). I4 upstream to fork to upstream `.bin` byte-identical for flag, blocks and overrides; the key never reaches a `.bin` or (per N4) a preset file (MC-175/MC-223/MC-774). I5 no load write; an unreadable value is kept until a mode write on that record (MC-350). I6 export never mutates the page. I7 mode code never writes by-model (MC-5093). Downgrade: census R14, accepted.

## Acceptance scenarios
A1 cells 1-16 send base parameters. A2 a mix: memory's block, main values for emotion. A3 sub-model follows otherAx. A4 an outside flag write over a mix reads all same or all own. A5 switch and lock move container and flag together. A6 settings `.rtb` replaces the container whole (R12, R13). A7 S1a `.bin`: no key in root or any slot; page unchanged. A8 S1b `.bin` of a mix: copies for same tasks, slots too. A9 flag-off `.bin` byte-identical but for the strip. A10 unrepresentable values and replaced blocks named before export; cancel writes nothing. A11 no `taskModes` editor. A12 EasyPanel run keeps a mix. A13 S2 own copies into an empty block only.

## Required tests
Base for every reproducer: `d98ee549c`, with the key a plain property inside the container (base runs import nothing new). All DESIGNED, NOT DEMONSTRATED. Fork data via `setDatabase` and `presetFromWorkingSettings`/`savedPresetFor`; upstream data via `upstreamPresetMirror.ts` `saveCurrentPreset` (MC-329). "Guard" = compatibility guard, passes before and after.

| id | scenario | class | pre-fix base and expected failure | fixture |
|---|---|---|---|---|
| T-R1 | A2 via `applyParameters` | regression reproducer | base ignores the key: emotion sends its block temperature, expected main | `utilityOverrides.test.ts` installDb |
| T-R2 | A3 other same | reproducer | base sends the otherAx block for submodel | same |
| T-R3 | A4 | guard; rule pinned by T-U1 | n/a | same |
| T-R8 | A8 root and a slot | reproducer (S1b) | base keeps the same tasks' dormant blocks, expected copies | export harness (`exportUsageStatistics.svelte.test.ts`) |
| T-R9 | A10 | reproducer (S1b) | base shows no `taskParameters` entry | `binLeaveOut` plus confirm |
| T-R10 | A11 | new-behaviour test (S1a; fails on base only because the fixture holds the key) | base renders a sixth accordion `taskModes`, expected five | component test |
| T-R11 | A7 flag off and on, root and every slot | new-behaviour test (S1a; fails on base only because the fixture holds the key) | base `.bin` keeps `taskModes`, expected absent | export harness |
| T-R13 | S1a: the classic checkbox and EasyPanel run call the helper (modes and flag change together; run keeps a mix) | new-behaviour test (S1a) | base writes the flag alone | component tests |
| T-R12 | preset file and bundle strip | new-behaviour test (S1a; fails on base only because the fixture holds the key) | base output keeps the key | `downloadPreset` 'return', `buildPresetBundlePayload` |
| T-R14 | S1b preset file (`downloadPreset` 'return', `.json`, `.risup`, Realm) and bundle entry with the flag on and a mix: copies for `same` tasks, no key; bundle entry equals the single export (N4, MC-5095) | reproducer (S1b) | base keeps the `same` tasks' dormant blocks, expected copies | `downloadPreset` 'return', `buildPresetBundlePayload` |
| T-R15 | S1b flag-off record in a `.bin` and in a preset file: no copy, blocks byte-identical, key absent (N1, MC-5094) | guard (passes before and after apart from the strip) | n/a | export harness, `downloadPreset` |
| T-R16 | S1b warning: a `same` task whose stored non-empty block equals the copy gives no entry; a differing block gives one; an unrepresentable main value (thinkingTokens null) gives one; cancel writes no file; the same entries appear for a preset-file export (N2, N5) | reproducer (S1b) | base shows no `taskParameters` entry | `binLeaveOut` plus the export and preset-export confirms |
| T-C1 | A1 16 cells | guard | n/a | census 2 |
| T-C2 | A9 | guard | n/a | mirror-made db |
| T-C3 | I4 round trip | guard | n/a | `upstreamPresetMirror.ts` |
| T-C4 | I6 | guard | n/a | export harness |
| T-C5 | `ffRecords.test.ts:46-71`, `ffPresetLocks.test.ts:97`, `presetLocks.test.ts:147`, `drive/tests/rtb/settingsFields.test.ts:121`, localeParity | existing guards, unamended | n/a | existing |
| T-C6 | A6 slot merge and working apply: file container without key over a device mix; file container dropped by `containsReference` | guard | n/a | `settingsPayload.test.ts:650-715` builders |
| T-C7 | A5 unlocked switch to a slot without key; slot key disagreeing with slot flag; locked switch with a slot key | guard (stored shape) | n/a | `presetLocks.test.ts` slots |
| T-C8 | P7 store2 encode and full `.rtb` restore keep the key, root and slots | guard | n/a | `store2/rtbFixtures.ts` |
| T-C9 | A12 | guard (base never touches the key) | n/a | `EasyPanel.parts.svelte.test.ts` |
| T-U1 | read rule, writers, R1-R6, R15, A2, container `null` | unit of new code | n/a | pure |
| T-U2 | copy rule: exact eleven keys, `null` copied, absent absent, alias, slot fallbacks, R16 | unit of new code | n/a | pure |
| T-D1 | MAIN vs BLOCK per key over {finite, 0, -1000, null, NaN, absent}, root and slot | diagnostic, then guard; its table is rule P | n/a | `applyParameters` both paths |
| T-S2 | A13, row gates, N7 text | reproducer (S2) | base renders one checkbox | component test |

## Mutants to kill
M1 a `same` aux uses its block -> T-R1. M2 submodel ignores otherAx's mode -> T-R2. M3 disagreement branch removed -> T-U1 (R5). M4 absent key reads `same` regardless of the flag -> T-C1 cells 9-16. M5 `setTaskMode` leaves the flag -> T-U1. M6 `setTaskMode` keeps another task's unreadable value -> T-U1 (A2). M7 classic filter removed -> T-R10. M8 root strip removed -> T-R11. M9 slot strip removed -> T-R11 slot case. M10 synthesis with the flag off -> T-C2. M11 no synthesis for same -> T-R8. M12 export writes into page objects -> T-C4. M13 only the working copy translated -> T-R8 slot case. M14 synthesis reads the raw key -> T-U2 (R16). M15 `representable` always true -> T-R9. M16 `null` left out of the copy -> T-U2. M17 thinking-type members copied -> T-U2. M18 by-model skipped for `same` aux -> T-C1 cell 11 and T-R1 by-model variant. M19 EasyPanel run sets all own unconditionally -> T-C9. M20 slot merge merges the container per member -> T-C6. M21 copy into a non-empty block -> T-S2. M22 preset file keeps the key -> T-R12.

## Risks and trade-offs
- A flag write outside the helpers flattens a mix (R5/R6) or, done twice, restores an old one (R15, advisor A1). In-tree flag writers are the helpers, `setPreset` and the `.rtb` apply, each moving the container with the flag; plugins cannot write either (`plugins.svelte.ts:421-446`).
- An unstripped key would persist upstream (U7), so every upstream-bound writer strips it (T-R11, T-R12).
- Strict rule P warns on most mixed exports with no thinking budget (N5).
- The warning reads the page at confirm time, the copy later; an edit in between is unwarned, as for every leave-out kind.
- The submodel `throw` under by-model stays for a `same` other task (today and the export agree).

## Finding dispositions
Gate 1: F1 ADDRESSED (strip in S1a, steps 6 and 10; T-R11, T-R12). F2 ADDRESSED by nesting (the slot merge replaces the container whole, `settingsPayload.ts:757-761`; no pairing rule; T-C6, M20). F3 ADDRESSED by nesting (`PRESET_RECORD_FIELDS`, lock group, `setPreset` unchanged, so the `set`-trap guards hold unamended). F4 ADDRESSED (step 7, R16, M14). F5 ADDRESSED (P7, P8). F6 ADDRESSED (T-C6, T-C7, T-R11). Simpler path (nest): ACCEPTED.
Advisor: root cause and missed insights 1-4 ACCEPTED, each reopened (census 5; thinking-type grep; `shared.ts:190-198`). A1 ACCEPTED (census R15). A2 ACCEPTED (step 3; revision 1's unreadable-member branch and its mutant are gone). (b) ACCEPTED (filter in S1a, strip for every record, S3 sentinel). (c) ACCEPTED (one kind, two causes, none for the link). (d) ACCEPTED. (e) ACCEPTED, REFINED with source: `null` is representable only for the scaled keys; for unscaled keys MAIN sets `null` and BLOCK skips it (`shared.ts:273-280` vs `:347-351`); T-D1 decides. DO NOT list ACCEPTED (steps 3, 5, 8; no load write). N1, N3, N6 settled as recommended; N2, N4 (recomputed), N5, N7 to the maintainer.

## Premises
REOPENED: P1 resolution identical upstream and fork (U1); P2 skip asymmetry (`shared.ts:34-47, 273-280, 347-351`); P3 flag and container are preset-scoped and move together (`presetLocks.ts:44-49`, `database.svelte.ts:2557-2559, 2605-2616`); P4 container readers (census 5); P5 `.bin` precedent and leave-out kinds (`backuplocal.ts:280-314, 986, 1013, 1018`); P6 settings `.rtb` applies carried fields whole (`rtbSettingsRestore.ts:89-92`, `settingsPayload.ts:582-595, 757-761`); P7 full `.rtb` carries root and slots, by reading (`codec/split.ts:62-72, 1385-1402`, `rtbExport.ts:36`), test T-C8; P9 budget handling (`anthropic.ts:371, 398-407`, `google.ts:382-387`); P10 upstream with a stray key (U7, U10). VERIFIED: P8 preset import keeps the container (census 5). No sizing packet; T-C5 anchors other than `ffRecords`/`ffPresetLocks` are inherited from revision 1.
## Open items
Superseding notes for lane A: MC-4721/MC-4043 now read "the four per-task modes are preset fields inside the container; stage f writes them through the shared helper"; ENGINE_CHANGES.md row 4-4 and SLICE4_SPEC.md:264 ("a task with a non-empty block becomes own") are superseded by MC-5090.

Settled by the maintainer (2026-11-28, MC-5094..MC-5096):
- **N1** flag-off export synthesizes nothing (amends MC-5091, MC-5094). **N2** a `taskParameters` line when a replaced stored block differs from the copy. **N3** no line for the lost "same" link. **N4** preset files (`.json`, `.risup`, Realm, bundles) use the `.bin` translation and carry no key (step 10b). **N5** rule P strict and data-only. **N6** copy only into an empty block. **UI timing** S2 in this ticket, S3 with #706 stage f. No question blocks S1a or S1b.

**N7 draft (English only, for the maintainer when S2 is planned; the translator writes the locales).** Shown under the per-task rows while "per-model parameters" is on: "Per-model parameters are on: every task uses the values saved for its model, whichever mode it is set to. Choosing Own for a task turns this on for all of them." Wording is a proposal, not a decision.

**Edits #706 stage f needs (lane A owns the spec revision):** `PRESET_SEPARATE_PARAMS_SPEC.md` line 9 scope: replace "`seperateParametersEnabled` and `seperateParameters`" with the four task modes (`seperateParameters.taskModes`) plus the container blocks and `overrides`; the flag is derived, not a row. Line 20 (setPreset seeding): the container moves whole, so `taskModes` travels with it; no new seeding. Container adapter and extraction guard S-a: skip `taskModes` as a block key, never a `SetPath` target, written only through `setTaskMode` as one history step with the flag and a copied block. Rows: four mode rows ("Same as main" / "Own") replace the flag row; import and export per purpose never carry `taskModes`. Lines 84-85 (inherited list and 2026-11-28 answers): MC-4043 and MC-4721 read as superseded by MC-5092. Stage f follows S1a (needs `taskParameterModes.ts`).

Other: the missing-block `TypeError` (U4) is a follow-up candidate.
