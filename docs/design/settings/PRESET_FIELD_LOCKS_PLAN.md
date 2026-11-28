# Preset field locks held outside the preset (#149, CHORE-575): plan

Status: **plan, revision 2** (2026-11-28; revision 1 rejected at Gate 1 round 1, findings F1 to F8 folded in below). Ticket yor42/RisuTanium#149, batch `presets`. Planning only: no application code, no persisted-format decision taken here. Every item marked **Q** is a maintainer question for lane A to ask; each carries a recommendation. Related open tickets: #148 (CHORE-574, restore points), #150 (CHORE-576, save as you type), #156 (CHORE-582, off switches and per-task sharing). Decisions this respects: MC-175, MC-223, MC-774 (`.bin` translate or leave out with warning), MC-350 (forward readability), MC-3972 and MC-4047 (Studio discloses `doNotChange*` overwrite), MC-4043 (app-wide switches stay in Settings). Gate tier: **2** (persisted shape, switch/save order, dirty-tracking inputs); Gate 2 of the build goes to `opus-reviewer`. Roadmap row: `Agents/Roadmap.md` CHORE-575 (T9, "fields move out of presets; MC-774", row S2-5).

## 1. What exists today (read from `origin/main` 2bd29b9fe)

The issue says "keep locks outside the preset". The locks already are outside it, but only three, and they behave unevenly.

| Lock (top-level `Database` field) | What `setPreset` does when on | What `presetFromWorkingSettings` (save) does when on | Upstream has it |
|---|---|---|---|
| `doNotChangeSeperateModels` | skips `seperateModelsForAxModels`, `seperateModels` (`database.svelte.ts` setPreset, about 2562) | writes `false` / `null` into the slot (about 2405-2406): **the lock erases the preset's own aux models** | yes (upstream `database.svelte.ts` 1187, 2161, 2285) |
| `doNotChangeFallbackModels` | skips `fallbackModels`, `fallbackWhenBlankResponse` (about 2571) | writes the working values into the slot: **switching away overwrites the preset's fallbacks with whatever was live** | yes (1197, 2294) |
| `disableSeperateParameterChangeOnPresetChange` (optional) | keeps the live `seperateParameters` (about 2581) | writes the working `seperateParameters` into the slot (same overwrite) | yes (1276, 2304) |

Verified by reading `src/ts/storage/database.svelte.ts` against upstream main fetched shallow (`git fetch upstream main --depth=1`, file `src/ts/storage/database.svelte.ts`): the three names, their position in `setPreset` and in the `presetFromWorkingSettings` mask match. The `.rtb` settings-only field list carries all three (`src/ts/drive/rtb/settingsFields.ts`, `GENERATION_FIELDS`), the store2 fast-forward switch ops call the page's own `setPreset` and `savedPresetFor` (`storage/store2/fastForward/index.ts` about 150-170), and `ffRecords.test.ts` pins that the closed-switch writes are a subset of `PRESET_RECORD_FIELDS`.

Where the user meets them: `Setting/Pages/Model/AuxModelSelectors.svelte` (aux check), `Setting/Pages/PromptSettings.svelte` (fallback check), `setting/advancedSettingsData.ts` row `adv.disableSeperateParameterChangeOnPresetChange` (Advanced, hidden), `Others/ProTools/EasyPanel.svelte` (one tap sets all three), the Studio preset form notes `studioPresetFallbackKept` / `studioPresetAuxKept` / `studioPresetAuxNotSaved` (PRESET_ADVANCED_SPEC.md section 3.8, MC-4047), and the new Settings shell's planned 프리셋 page ("the three keep-on-switch locks", `docs/design/settings/SLICE1_SPEC.md` section 3.1).

**Findings that shape the plan**

1. Three locks cover three field groups only. The ticket wants locks for "chosen settings", so the lockable set needs defining (Q1).
2. The save side is wrong for a lock held outside the preset. A locked field's live value is written into the slot on switch-away (fallback, separate parameters) or erased (aux). The slot ends up holding another preset's value or an empty one. PRESET_ADVANCED_SPEC.md discloses this (MC-4047) instead of removing it.
3. **#150 (save as you type) makes finding 2 acute**: autosave of the working copy into the slot would write the live value, or the aux erase, on every edit, not once per switch. #150 cannot land correctly before the save side honours locks.
4. `setPreset` also keeps the live value whenever the slot field is absent (`newPres.x ?? db.x`, for example `apiType`, `temperature`, `maxContext`). That is an implicit, unlabelled lock for slots that lack the field and is **not** what this ticket changes.

## 2. Proposed semantics (design default; Q2)

A lock is a **switch-time exemption held in the settings, not a value**: the working copy `db.*` stays the single live value.

- **Switching to a preset** (`setPreset`): a locked group is not read from the slot. Unchanged for the three legacy groups.
- **Saving the working copy into a slot**: the skip is owned by **`savedPresetFor`** (it has the slot), not by `presetFromWorkingSettings`. For an existing slot, each locked group is copied from the slot (what it holds, or absent if it holds nothing); today's erase (aux) and overwrite (fallback, separate parameters) go away. **Callers with no slot** (`appendWorkingSettingsPreset`, `botPresetRepair`) and `copyPreset` are decided per caller: a **new** preset from the working settings takes the working values of every group, locked or not (a lock governs switching, not creating, so the new preset is what the user was running); a copy clones its source slot unchanged. The settings-only `.rtb` build goes through `savedPresetFor` and so follows the slot rule. Tests L13 to L16 pin each.
- **Editing a locked field in Studio:** the active preset's edit goes to the live value (as classic edits the working copy). An **inactive** preset's edit still writes **that preset's slot**, as MC-4032 and MC-4047 already specify; the form shows the slot value with a note that the live value is used while the group is locked. The alternative (the form edits the global value) is Q8. The three MC-4047 notes are re-worded, not removed: the "switching away overwrites it" text is no longer true, a "not used while locked" text is.
- **Unlocking**: the field takes the slot's value on the next switch, as any unlocked field does. That value is the preset's own **only if** nothing replaced it: a slot saved while the group was unlocked, a slot active when the lock was set, or one created while locked holds the value from that time, not what the user was running. Stated limitation, no migration of values.

Why this and not "pinned values stored with the lock": it adds no second value store, no copy on lock or unlock, and no pinned-versus-live ambiguity. Rejected: locks stored **inside** each preset (contradicts the ticket and `MC-774`: a lock is a user preference that must survive preset import, copy, export and restore points) and a "pinned override layer" (second source of truth per field, Gate 1 would have to prove every request reader consults it).

**Behaviour change to existing data semantics** (Q2): a user with `doNotChangeSeperateModels` on has slots whose aux models were already erased by earlier saves; nothing is recovered, and from this build on the slot keeps what it has. A user with fallback or separate-parameters locks on stops losing a slot's own values. Fork never shipped, so no recovery is designed (MC-011); once an Android MVP build is in use (MC-350) this change is forward-safe because it only stops writes.

## 3. The lockable field set (Q1)

A closed registry (one module, ids are stable strings, order is UI order; each row carries the **slot key and the database key** where they differ, for example slot `reasonEffort` and database `reasoningEffort`: the save-side copy uses slot keys, the `setPreset` skip database keys), so a lock names a **group** that setPreset and save skip together. Candidate registry, in `Studio` section order (PRESET_ADVANCED_SPEC.md section 2):

| Id | Fields (preset slot keys) | Origin |
|---|---|---|
| `auxModels` | `seperateModelsForAxModels`, `seperateModels` | legacy `doNotChangeSeperateModels` |
| `fallbackModels` | `fallbackModels`, `fallbackWhenBlankResponse` | legacy `doNotChangeFallbackModels` |
| `separateParameters` | `seperateParameters` (and `seperateParametersEnabled`, see Q6) | legacy `disableSeperateParameterChangeOnPresetChange` |
| `models` | `aiModel`, `subModel` (deferred, Q1b) | new |
| `contextLimits` | `maxContext`, `maxResponse` (deferred, Q1b) | new |
| `sampling` | `temperature`, `top_p`, `top_k`, `min_p`, `top_a`, `repetition_penalty`, `frequencyPenalty`, `PresensePenalty` | new |
| `reasoning` | `reasonEffort`, `thinkingTokens`, `thinkingType`, `deepseekThinkingType`, `adaptiveThinkingEffort`, `deepseekReasoningEffort`, `verbosity` | new |

**Coupling (Gate 1 F5):** `models` and `contextLimits` are not safe as plain groups. `setPreset` also writes `apiType`, `customAPIFormat`, `proxyRequestModel`, `openrouterRequestModel`, `customProxyRequestModel`, `proxyConnectionId` and `currentPluginProvider` with the model, so a locked `aiModel` kept across a switch to another provider's preset sends that model id to the other preset's endpoint; a locked `maxContext` can exceed what the switched model supports. Connection fields are never lockable (MC-3976). Both groups are deferred until the maintainer picks a coupling rule (Q1b).

**Recommendation:** v1 ships the three legacy ids plus `sampling` and `reasoning` (group locks, not per-field). Per-field locks are a later extension: the id list admits leaf ids without a format change. Connection and endpoint fields are never lockable (MC-3976: they are not preset fields). Prompt text, template, regex and toggles are not lockable in v1 (a locked prompt would make a switch look like it did nothing; revisit on request).

A registry-closure test pins every registry field to a real `setPreset` assignment and a `PRESET_RECORD_FIELDS` member (the existing pin in `fastForward/records.ts` already forces new `setPreset` writes to be listed).

## 4. Where the locks are stored, and the data shape (persisted format: Q3, lane A asks)

Lock state is user settings: a top-level `Database` field in the settings store, never inside `botPresets`. Options:

| Option | Shape | Upstream `.bin` | Migration | Verdict |
|---|---|---|---|---|
| **A (recommended)** | Keep the three legacy booleans as the storage of their three ids (no change). Add one optional fork-only top-level field `presetFieldLocks?: string[]`, the ids of the **new** groups only. One accessor module reads and writes both so UI and `setPreset` see one set. | The three booleans travel as upstream fields, both ways, no translation. The new list has no upstream equivalent. | none; absent means no new locks | additive, upstream round trip lossless for what upstream can express, smallest MC-350 surface |
| B | One `presetFieldLocks` list of every id; the three booleans become derived and are still **written** (kept equal) for `.bin` export | translate: booleans derived from the list at export (MC-774 translate) | forward migration list from booleans on load, idempotent | one concept one store, but a migration plus a translation on the export path (a critical contract) for no user-visible gain |
| C | Locks inside each preset | n/a | n/a | rejected (section 2) |

**Data shape (A):** `presetFieldLocks?: string[]`, unique ids from the registry, absent or empty = none. **Reader rule (MC-350):** an id the build does not know, and any non-string member, is **kept** and applied as no lock; a non-array value is treated as absent for reading and left in place until the user changes a lock (data a build cannot read is kept). **Writer rule:** a toggle touches only the known members: known ids first, in registry order and de-duplicated, then every other member in its original relative order. One write per toggle.

**Dirty tracking and fast-forward (critical contract, Gate 1 F2):** the fast-forward working side is `pickFields(config, PRESET_RECORD_FIELDS)` (`fastForward/prepare.ts`), and `PRESET_RECORD_FIELDS` (`records.ts`) holds **none** of the lock flags. So `cleanSwitch` runs `savedPresetFor` and `setPreset` (`index.ts` presetOps) on a copy where every lock is absent, that is unlocked. (Today this already makes a peer's clean switch with the aux lock on compute real values where the page erased them.) Two mechanisms: **(a)** add the flags and the list to `PRESET_RECORD_FIELDS`: a lock toggle becomes a preset-record change that parks against a peer's switch, and the "writes exactly the constant" pin changes; **(b)** carry each page's lock state as part of that side's `working` (or as an explicit parameter of `SwitchOps.saveInto`/`apply`, which today take only `(working, slot)`; `presetOps()` takes no arguments and is shared by the base, mine and theirs checks), so each side is verified under its own lock state (mine: the live settings; base: `baseConfig`; theirs: `theirsConfig`), and classify a switch as not clean when the two pages' lock states differ (the existing park path). **Design default: (b)**, because a lock toggle is a setting, not a preset change. Stage 1's Gate 1 attacks this choice with a `cleanSwitch` test with a lock on and both pages switching (expect keep), and one where the lock differs between pages (expect park). Also in the list: `setPreset`, `savedPresetFor`, the `ffRecords` subset test.

## 5. Export, import and backup

- **Settings-only `.rtb` build reads locks through a hand-written source** (Gate 1 F3): `presetSourceOf` (`drive/rtb/settingsPayload.ts`, field by field), `PRESET_SOURCE_FIELDS` (`settingsFields.ts`) and the `WorkingPresetSource` type (`database.svelte.ts`) are closed over `doNotChangeSeperateModels` only. All three must learn every lock flag, or an export with a fallback lock on writes the live value into the exported slot. Closure tests move with them (L16).
- **`.rtb` full backup:** carries the whole settings store, so `presetFieldLocks` travels with no code change beyond the store2 field being registered where settings fields are enumerated. **Settings-only `.rtb`:** add `presetFieldLocks` to `GENERATION_FIELDS` with rule `arr` in `drive/rtb/settingsFields.ts`; the closure and payload tests (`settingsPayload.test.ts`) cover the table. The three booleans are already there.
- **`.bin` fork to upstream:** the three legacy booleans are upstream fields and travel as today. `presetFieldLocks` has no upstream equivalent, so per MC-774 it is **left out of the `.bin` and stays in store2/`.rtb`, named in a warning before the export starts**. The warning is one new `BinLeaveOutEntry` kind (`presetLocks`, count of fork-only locks on, plus the group names) in `drive/binLeaveOut.ts`, shown in the same leave-out sheet; no confirm beyond the sheet (it is not size-based, MC-223). If no fork-only lock is on, the entry is absent and the sheet is unchanged. **Premise to verify at Gate 1:** whether the `.bin` writer today emits unknown top-level `Database` keys or filters to an allow-list; the leave-out has to be an explicit drop (and a test) in whichever it is.
- **`.bin` upstream to fork:** works unchanged: the booleans arrive and are the lock state for their ids; no fork-only lock exists.
- **Round trip fork to upstream to fork** loses the fork-only locks (named in the warning, MC-774); the three legacy locks survive.
- **Preset export and import** (`downloadPreset`, `.risupreset`, `.json`): a preset carries no lock (locks are not in the slot), so exported presets are unchanged and an imported preset never changes a lock. Section 2's save change makes an exported slot hold its **own** locked-group values, so `downloadPreset` of the active preset exports the slot, not what the user is running live, and a fork `.bin` opened in upstream carries slots with their own aux models instead of `null` (upstream's own next switch overwrites or erases them as before). Coherent with the design; the slot shape is unchanged.
- **Restore points (#148):** restore points snapshot preset slots only; locks are not snapshotted, so restoring never alters a lock. Restoring a slot while a group is locked changes the slot, not the live value.

## 6. UI touch points

1. **One place to manage locks:** the Settings 프리셋 page (shell design `SLICE1_SPEC.md` 3.1) lists the registry groups as switches; the existing aux/fallback checks and the Advanced separate-parameters row become links or are removed there so a lock has one control (Q4). Until that page exists, the existing three controls keep working through the same accessor.
2. **In context:** each locked group in the Studio preset form (PRESET_ADVANCED_SPEC.md section 3.8 rows) shows a lock affordance and the note "kept across presets" with a control to unlock; this replaces `studioPresetFallbackKept`, `studioPresetAuxKept`, `studioPresetAuxNotSaved` (MC-4047 notes, whose copy states the old overwrite). The note appears for an active **and** an inactive preset because a lock is global.
3. **Switch feedback:** a preset switch that skips a locked group says so once in the existing switch toast or sheet row ("kept: models, sampling"), so a switch that appears to do nothing is explained (Q5).
4. `EasyPanel.svelte` keeps its one-tap behaviour over the same three ids through the accessor; its tests (`EasyPanel.parts.svelte.test.ts`, `EasyPanel.names.svelte.test.ts`) move with it.
5. New `en.ts` keys carry all 7 non-English locales and pass `localeParity` in the same PR (MC-058; translator role).

## 7. Interactions with open tickets

- **#150 (autosave):** needs section 2 first; otherwise a locked aux group is erased on every edit. Order: **#149 stage 1 before #150's build**; #150's own save-cost measurement is independent.
- **#148 (restore points, Recently Deleted):** independent; the one dependency is that restore writes slots only (section 5). #148's snapshot of a slot now contains the slot's own locked-group values, which is the right thing to restore.
- **#156 (off switch per parameter, per-task share or own):** overlaps on separate parameters. The `separateParameters` lock (and Q6) must use whatever #156 makes the per-task share/own representation; if #156 changes `seperateParameters` shape, the lock keeps naming the same fields by group. Recommendation: land #149 first with the registry naming slot keys, and let #156 adjust that one row.
- **Studio specs (`docs/design/studio/PRESET_ADVANCED_SPEC.md`, `PRESET_PROVIDER_SPEC.md`, `PRESET_SEPARATE_PARAMS_SPEC.md`, `PRESET_LIST_SPEC.md`, `PRESET_TEMPLATE_SPEC.md`):** only the first names `doNotChange*` (section 3.8 notes, risks F11, tests S4a-T13 and S4b-T8). Stage 3 below rewrites those notes and tests; the other four specs do not mention a lock and need no change except that SEPARATE_PARAMS' off-encoding rows sit under the `separateParameters` group.

## 8. Tests required

| ID | Test | Kind |
|---|---|---|
| L1 | Registry closure: every id maps to fields that `setPreset` assigns and that are in `PRESET_RECORD_FIELDS`; no field in two ids | compatibility guard |
| L2 | For each group, lock on: `setPreset` leaves the live value; lock off: takes the slot's value | regression (fails on base for the new groups (`sampling`, `reasoning`)) |
| L3 | For each group, lock on: switch-away leaves the slot's own value unchanged (aux: slot keeps its models, not `null`; fallback and separate parameters: not overwritten); lock off: writes working value | **regression reproducer** (fails on base for the three legacy groups) |
| L4 | Round trip A, B, A with a lock on: A's slot values are intact after returning | regression |
| L5 | `ffRecords` subset test extended: every lock on leaves writes a subset of `PRESET_RECORD_FIELDS`. Plus a real fast-forward `cleanSwitch`: lock on and both pages switch cleanly (keep); lock differs between pages (park) | compatibility guard, regression |
| L6 | Reader/writer rule: unknown ids and non-string members kept after the known ids in original order, non-array ignored and left, duplicates collapsed | MC-350 guard |
| L7 | Settings-only `.rtb` carries `presetFieldLocks`; a crafted wrong-kind value is rejected by `settingsPayload` | compatibility guard |
| L8 | `.bin` export: legacy booleans present; `presetFieldLocks` absent; leave-out summary names the groups; absent when none on | regression (with the explicit drop proven by deleting it, red) |
| L9 | Upstream `.bin` with booleans imports as locks for their three ids; fork `.bin` imports in the upstream mirror (`drive/tests/upstreamPresetMirror.ts`) apply with the mirror's switch | compatibility guard |
| L10 | Studio note copy per section 2: kept/not-used notes for locked groups, none when unlocked | regression |
| L11 | `localeParity` and EasyPanel tests | existing |
| L13 | `appendWorkingSettingsPreset` and `botPresetRepair` with each lock on: the new slot holds the working values | regression |
| L14 | `copyPreset` with each lock on clones the source slot unchanged | compatibility guard |
| L15 | Unlock after a slot was saved unlocked: the next switch loads that slot's (possibly stale) value (stated limitation) | diagnostic |
| L16 | Settings-only `.rtb` export with each lock on: exported slot holds the slot's values; `presetSourceOf`, `PRESET_SOURCE_FIELDS`, `WorkingPresetSource` closure | regression |
| L17 | Studio: an inactive preset's edit of a locked field writes its slot and shows the "not used while locked" note; the active preset's edit writes the live value | regression |
| L12 | A mutant that drops the save-side skip fails L3; one that drops the setPreset skip fails L2 | mutant |

Locks affect request behaviour only through `setPreset`, so no request-path test is needed; the live-value readers are unchanged. Device rows are written by the build's PR from its diff (MC-2713); the expected row is one switch between two synthetic presets on the Note 9 with a lock on, plus export of a `.bin` with a fork-only lock.

## 9. Stages (each its own PR on #149; the last closes it)

1. **Core and storage** (opus-reviewer at Gate 2): registry, accessor, `presetFieldLocks` field and reader/writer rule, `setPreset` and the `savedPresetFor` skip for the three legacy groups with the section 2 semantics and per-caller rules, fast-forward mechanism (b), `.rtb` field registration, `presetSourceOf` and its type, and the explicit `delete plain.presetFieldLocks` in `exportCopyOf` (`drive/backuplocal.ts`) so the field is never emitted before stage 2 adds the warning. Tests L1-L7, L13-L16.
2. **Export warning:** `.bin` leave-out entry (the drop itself is in stage 1), upstream mirror test. Tests L8-L9. Needed iff any fork-only group ships (it does with `sampling` and `reasoning`).
3. **New groups:** `sampling` and `reasoning` (and `models`/`contextLimits` only after Q1b) in the registry and the skip, tests L2-L4 per group.
4. **UI:** Settings 프리셋 page rows (when the shell page exists), Studio notes and lock affordance, switch feedback, locale keys. Tests L10, L11, L17, the S4a-T13 and S4b-T8 rewrite.

## 10. Open decisions for the maintainer (lane A asks; none decided here)

| Q | Question | Recommendation |
|---|---|---|
| Q1 | Which fields can be locked? Options: the legacy three only (simplest: no new storage, no `.bin` entry, no stage 2, no Q3); legacy plus `sampling` and `reasoning`; more. | Legacy plus `sampling` and `reasoning` as group locks; per-field later; prompts, templates and regex not lockable. Legacy three only is a valid smaller v1 if the maintainer prefers the least change. |
| Q1b | `models` and `contextLimits`: how is model coupling handled (lock the connection fields too, refuse a switch across providers, or accept and disclose) | Defer both groups; revisit with #156 |
| Q8 | Studio edit of an inactive preset's locked field: write that preset's slot (design default) or edit the live value | Write the slot, with a note (keeps MC-4032 and MC-4047 behaviour) |
| Q2 | A locked field: slot keeps its own value on switch-away (design default), instead of today's erase/overwrite. This changes what existing locks do to saved presets. | Yes, keep the slot's own value; required for #150 and for correct restore points (section 2) |
| Q3 (persisted format) | Storage: A (three booleans stay, new fork-only `presetFieldLocks` list), B (one list, booleans derived), C (in presets, rejected) | A: no migration, upstream round trip lossless for legacy groups, fork-only locks left out of `.bin` with a warning |
| Q4 | Where are locks managed: only the Settings 프리셋 page plus in-context toggle in Studio, or keep the aux and fallback checks where they are as well | One home (the 프리셋 page); keep existing controls working until it exists |
| Q5 | Show "kept: ..." when a switch skips locked groups | Yes, one line in the switch feedback |
| Q6 | `seperateParametersEnabled` (the per-preset enable flag) is today **not** locked by `disableSeperateParameterChangeOnPresetChange` (the flag is taken from the slot while the object is kept). Should the separate-parameters lock keep the flag too | Yes, keep both, so the lock never yields an enabled flag with another preset's missing object; confirm with #156's representation first |
| Q7 | Fork-only locks are left out of a `.bin` with a warning (MC-774); they would not survive a trip through upstream | Accept (nothing in upstream can hold them) |

## 11. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | A lock read missing from the fast-forward copy makes the store2 record and the live page disagree | each side of the fast-forward switch check carries its own lock state (section 4, mechanism b); L5 |
| R2 | An id added by a later build is dropped by this one on write, un-locking the user silently | reader/writer rule keeps unknown ids (L6) |
| R6 | A preset created while a lock is on holds the working values, so after unlock its first switch loads those | stated in section 2; L13 |
| R3 | Save-side skip leaves a slot that never had the field (`undefined`) | the skip leaves the slot as is; `setPreset`'s `??` rules already read absent as the default |
| R4 | The user sees a switch "do nothing" | switch feedback (Q5), lock note in Studio |
| R5 | The `.bin` writer emits fork-only top-level keys unfiltered | Gate 1 premise; L8 proves the drop red-to-green |

## 12. Record

MC-4810 (Agents/mc/149.md): the plan is a design default and lists Q1, Q1b and Q2 to Q8 for lane A; nothing in it is a maintainer decision.

Known limitation (Q1): a locked `sampling` or `reasoning` value kept onto a preset whose model lacks that parameter (for example `thinkingType`) is sent as the live value; request building already tolerates unsupported parameters, and the lock note names what is kept.
