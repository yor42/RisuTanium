# Studio S5: module 고급 (Advanced) and 배경 HTML forms

Status: **spec, revision 4** (2026-11-23), not built. Revision 4 changes only the T5-GUARD-QUIET (d) setup (Gate 1 r3 incremental check, I1; section 9c). Revision 3 answers Gate 1 r2 ([EDITORIAL], H1-H6; section 9c) and changes nothing else. Revision 2 answers Gate 1 r1 ([EDITORIAL], G1-G5) and applies the maintainer rulings MC-4030 (Studio must be feature complete against classic), MC-4043 (its app-wide-settings exception) and MC-3985 (module list operations go to #709). Revision 1 answered Gate 1 r0 ([REJECT], F1-F12) and folded in MC-3980..MC-3984. Ticket yor42/RisuTanium#683, stage S5 of the #651 split (MC-3900). This is spec first (MC-3902), so no build starts before this file merges. A later build PR on the same ticket implements it. Written against `origin/main` 71882fe16. Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) §3, §5, §6 and §8, [SLICE3_SPEC.md](SLICE3_SPEC.md) §1, and the character Advanced form in [SLICE4_SPEC.md](SLICE4_SPEC.md) §2, §4, §6, §9 and §10.

Decisions used: MC-175, MC-329, MC-350, MC-1639, MC-1827, MC-2949, MC-3638, MC-3900, MC-3902, MC-3941, MC-3980, MC-3981, MC-3982, MC-3983, MC-3984, MC-3985, MC-4030, MC-4043, DD-094, DD-165.

No product question is open. Section 8 records the decisions. A choice marked **(design default)** was made here, inside decided intent. It can be vetoed without asking the maintainer.

**What revision 2 changes (summary):**
- MC-4030: the read-only "change it in Modules settings" fallback is gone. Studio edits an absent required key, an absent optional key and a value stored in the wrong type itself, and an undo puts back the exact stored state (section 2.5, engine change E11 in section 3.8, changed contract 6).
- The low-level guard now asks when a write makes the engine read the flag **on** while it reads **off** now. This covers a restored truthy non-boolean value such as `1` (section 3.5).
- Every remaining link to classic is named as an error or interim route with its follow-up ticket (section 1.3).
- Gate 1 r1 G1-G5 are fixed (section 9b).

**What revision 3 changes (Gate 1 r2, section 9c):**
- The low-level guard reads the **last** write of the flag in a plan, not every write (H2). T5-GUARD-QUIET gains a partial-replay case and a multi-write revert case, which kill the ops-based guard and the any-write guard (H1, H2).
- Section 3.8 lists every `FieldValue` site and its outcome instead of claiming that `pnpm check` finds them (H3). `readHeld` classifies a value by its stored (plain JSON) form (H4).
- Focus compares a foreign reading as a tagged value, so it never equals a typed string (H5).
- MCP module import is named as a list operation of #709 and as a known limitation of S5 (H6).

## 0. Today (source read in this worktree)

| Fact | Anchor (`src/`) |
|---|---|
| The classic module editor has five tabs: basic info, lorebook, regex, trigger and assets. A stub module shows no tabs. | `lib/Setting/Pages/Module/ModuleMenu.svelte:223-271` |
| Basic info edits `name` (TextInput), `description` (a small single-line TextInput), `namespace` (TextInput with Help), `hideIcon` (check, shown as `hideIcon ?? false`) and the toggle definition. | `ModuleMenu.svelte:273-286` |
| `backgroundEmbedding` is a textarea in the **regex** tab, above the regex list. | `ModuleMenu.svelte:307-309` |
| `lowLevelAccess` is a check in the **trigger** tab, shown as `lowLevelAccess ?? false`. It has a Help line and no confirm. The trigger list receives the flag as `lowLevelAble`. | `ModuleMenu.svelte:409-415` |
| The only app-wide setting ModuleMenu reads is `useAdditionalAssetsPreview`, which gates the asset previews of the assets tab (MC-4043, section 1.3). | `ModuleMenu.svelte:43-48, 371` |
| Every field binds straight to the live module object. Nothing is undoable and there is no save status. | `ModuleMenu.svelte:37, 275-285`; `ModuleSettings.svelte:180-189, 274-287` |
| A new module starts as `{name: '', description: '', id}`. | `ModuleSettings.svelte:238-246` |
| Importing a module asks first when its `lowLevelAccess` is truthy. The classic editor never asks. | `process/modules.ts:824-830` |
| The engine reads `lowLevelAccess` and `hideIcon` by truthiness, and a namespace only when it is non-empty and found in a set of reference strings. | `process/modules.ts:1002, 1126`; `process/moduleRefs.ts:42-47` |
| A replace-import stores the incoming module under the **old id**. Studio history is keyed by that id, so it survives the replace. | `process/moduleDuplicates.ts:50-66`; `ts/studio/history/ownerPhase.ts:40-41` |
| Studio's module owner has these kinds: lore, regex, scripts, toggles, html (배경 HTML), advanced and display. `advanced` is one item that is always present. `html` has one item while `backgroundEmbedding` holds non-blank text, and none otherwise. | `ts/studio/ownerModel.ts:268-283, 338-348` |
| The module 고급 and 배경 HTML kinds have no form. They fall to the read-only note. | `lib/Studio/StudioDetail.svelte:205-260` |
| The classic link of every module kind opens the Settings module list. A stub shows it as `studioOpenModules`, any other module as `studioOpenClassic`. | `ts/studio/classicLinks.svelte.ts:56-60`; `StudioDetail.svelte:104, 261-266` |
| The history registry lets the module owner set `customModuleToggle` only. | `ts/studio/history/fieldRegistry.ts:56-75`; `historyModel.ts:60-65` |
| **The history reader reads a value of the wrong type as absent**, and the edit builder refuses an absent value on a path with `editWhenAbsent: false`. A history `FieldValue` holds only `{had: false}` or a value of the path's type. | `ts/studio/edit/studioSetters.ts:141-166, 241-250`; `historyModel.ts:111-120, 267-281` |
| The store2 codec stores a module as plain JSON. An `undefined` property is absent after a save. The pure helpers `toPlainJson` and `sameJsonValue` give and compare that stored form. | `storage/store2/codec/normalize.ts:10-12, 30-37, 96-99`; `codec/modules.ts:13-16` |
| **`editField` is refused `gone` for every module owner.** The edit intent needs a character target, and a module target has none. An existing test pins this refusal. | `ownerHistory.svelte.ts:909-913, 1087, 1434-1435`; `history/tests/ownerHistory.moduleText.svelte.test.ts:162-178` |
| `readOwnerFields` resolves an owner without the open-module id, so it returns `null` for every module owner. Focus after a module undo therefore never finds the field. | `ts/studio/ownerFields.ts:12-24`; `studioSetters.ts:105-106` |
| Toggle Update-All writes a module text as a `textSet` and records no history step. `writeModuleText` handles `backgroundEmbedding`. | `ts/studio/toggleUpdateAll.ts:250-252`; `edit/toggleUpdateAllDb.ts:124-137`; `studioSetters.ts:667-669` |

## 1. Scope and field inventory

### 1.1 In and out

**In:** the module-level fields that ModuleMenu edits and no other stage owns:
- in the 고급 kind: `name`, `description`, `namespace`, `hideIcon` and `lowLevelAccess`;
- in the module's own 배경 HTML kind: `backgroundEmbedding` (MC-3981).

Each of them is edited in Studio whatever its stored state: present and typed, absent, or stored in another type (MC-4030, section 2.5).

**Out (each with its owner):**
- Owned by other stages: lorebook entries (S7, #685), regex scripts (S6, #684), the toggle builder (live) and the display/assets kind (live).
- **Triggers and Lua** go to the scripts kind of #708 (MC-3983, MC-3985). So does the character's 배경 HTML kind. S5 neither edits nor shows triggers.
- **Module list operations** (create, delete, import, import an MCP module, export, convert to character, enable globally) go to #709 (MC-3985). The classic module list is their interim route until #709 lands.
- Fields Studio never writes: `cjs`, `mcp`, `icon`, `risutanium_asset_folders` and `risutanium_asset_retained`. Every Studio write keeps them, because the module write makes a shallow copy of the whole object (`studioSetters.ts:577`). T5-KEYS pins this. None of them is a ModuleMenu field.
- No per-field search entries and no `field=` deep links (no owner has them yet).

**MCP modules are editable** in these forms (MC-1639). **A module whose id another row shares is read-only, with a reason** (MC-1639, `studioRefusalModuleSharedId`). That is an error state of the data, not a parity gap: classic edits only the first holder of an id.

### 1.2 Inventory

All six fields are upstream `RisuModule` fields (`process/modules.ts:45-68`). The `.bin` and `.risum` shapes do not change (MC-175 and MC-223 are untouched).

| Field | Path / type | Today | Engine effect | Studio control | Validation | Risky |
|---|---|---|---|---|---|---|
| 이름 | `name: string` (required) | TextInput, per keystroke | Tree and title label; import duplicate check (trimmed name); low-level import prompts | Single-line input with a composition gate and `typing` steps (as S1's single-line fields) | An empty name is allowed. Info note `studioModAdvNameEmpty` (design default). Absent or wrong-typed: edited (section 2.5). | no |
| 설명 | `description: string` (required) | Small single-line TextInput | Module list subtitle and store2 index entry. It becomes the creator notes on conversion. Never reaches a prompt. | LT, mode `plain`, compact (3 lines, grows), no token chip (design default) | Absent or wrong-typed: edited (section 2.5). | no |
| 네임스페이스 | `namespace?: string` | TextInput with Help | Selects the module through every reference source (section 4.1) | Single-line input. One `single` step on commit (section 4.1) | Info notes: shared namespace, unmatchable value, Module Integration note (MC-3982) | no |
| 아이콘 숨기기 | `hideIcon?: boolean` | Check | Hides the chat icons wherever the module is active, read by truthiness (`process/modules.ts:1126-1136`) | Switch with an explanation line, in 고급 › 표시 (design default) | None | no |
| 낮은 수준 접근 | `lowLevelAccess?: boolean` | Check in the trigger tab, no confirm | Turns on low-level trigger effects and Lua interaction access for this module's triggers, read by truthiness (`modules.ts:1001-1003`; `triggers.ts:1134-1136, 1556-1709`; `scriptings.ts:1297-1299, 1784-1800`) | Switch in 위험한 설정 (section 2.3). **Every off→on asks**: a direct turn-on (MC-3980) and every replay (MC-3984) | None | **yes** |
| 배경 HTML | `backgroundEmbedding?: string` | Textarea in the regex tab | Rendered behind the chat (section 4.2). It turns a theme pack's canvas off (MC-2949). | LT, mode `html+cbs`, no token chip, in the 배경 HTML kind form (MC-3981) | None | no |

### 1.3 Classic parity (MC-4030, MC-4043)

MC-4030: Studio is planned to replace classic, so it must be feature complete against it. A link out to classic is allowed only as an interim or error step, with a follow-up ticket. MC-4043: app-wide settings that classic shows beside a form's fields stay in Settings and are not a parity gap. Per-module fields must be in Studio.

**Every ModuleMenu field and operation, and where Studio has it:**

| Classic (ModuleMenu / ModuleSettings) | Studio after S5 | Ticket |
|---|---|---|
| Basic info: `name`, `description`, `namespace`, `hideIcon` | 고급 form | #683 (this) |
| Basic info: toggle definition `customModuleToggle` | toggles kind (toggle builder, live) | done |
| Regex tab: `backgroundEmbedding` | 배경 HTML form | #683 (this) |
| Regex tab: the regex list, add, import, export | regex kind | S6, #684 |
| Lorebook tab: entries, folders, add, import, export | lore kind | S7, #685 |
| Trigger tab: the trigger list (it reads the flag as `lowLevelAble`) | scripts kind | #708 |
| Trigger tab: `lowLevelAccess` | 고급 form, 위험한 설정 | #683 (this) |
| Assets tab: the list, add, rename, remove | display kind (live) | done |
| Assets tab: `useAdditionalAssetsPreview` | stays in Settings: an app-wide setting (MC-4043) | none needed |
| Module list: create, delete, import, import an MCP module, export, convert to character, enable globally | not in Studio yet | #709 (MC-3985) |

The `lowLevelAble` coupling is the trigger editor's reading of the flag. It belongs to #708's scripts kind, which must read the flag by truthiness as the engine does. S5 owns the flag's only editor. Nothing in S5 stays classic-only.

**Known limitation (Gate 1 r2 H6): #709 does not name MCP module import.**
- The classic module list has a separate MCP import button, `importMCPModule()` (aria-label `moduleImportMcp`, `ModuleSettings.svelte:254-257`), beside the file import (`:259-262`).
- #709's body lists create, delete, import, export, convert and enable globally, and does not name it (read with `gh issue view 709 --repo yor42/RisuTanium`, 2026-11-23).
- It is a list operation, so it belongs to #709 under MC-3985, not to S5. S5's scope does not change.
- Until #709 names it, MCP import is a classic-only operation that no ticket names, which MC-4030 does not allow once classic is retired. Section 10 asks lane A to add it to #709.

**Links to classic that remain on the two module kinds S5 builds:**

| Link | When | Class | Follow-up |
|---|---|---|---|
| `studioOpenClassic` (`studio-detail-classic`) | A loaded module, any kind | **Interim.** It opens the Settings module list (`classicLinks.svelte.ts:60`). After S5 the 고급 and 배경 HTML kinds need it for nothing they show. It still reaches the trigger tab and the list operations. | #708 (triggers), #709 (list operations). S5 does not change `classicLinks`. Removing the link is part of retiring classic, after #684, #685, #708 and #709. |
| `studioOpenModules` | A stub: not loaded, or its load was refused | **Error state.** Studio cannot show a body it could not load. The module list is where such a module is deleted or exported. | #709 (delete and export of a module from Studio). |

## 2. Layout

### 2.1 Mount and frame

One component, `StudioModuleAdvancedForm.svelte`, has a `section: 'advanced' | 'html'` prop, as `StudioAdvancedForm` does. Its props are the primitives `moduleId` and `slotIndex`, as `StudioModuleAssetForm` gets them (`StudioDetail.svelte:253-257`).

**Live module (F8).** The form never keeps the module object it mounted with:
- **Editable mode:** it reads the module on every render through a derived lookup over `DBState.db.modules`, by id at the given slot. When the slot no longer holds that id, it searches by id. The id is unique in this mode (the mount condition requires `!moduleIdShared`), so the search finds the one holder or none.
- **Shared view (`readOnlyShared`, G5):** it reads **only** the slot `moduleRowOf` gave (`StudioDetail.svelte:61-63`). When that slot no longer holds the id, it shows no values. It never searches by id, because two or more rows hold the id and a search would pick the first holder, which can be another row.
- A Studio write replaces the slot object (`studioSetters.ts:678-681`). A form that held the mounted object would show stale values after its own first write.

**Mount conditions in `StudioDetail` (E6):**
- `moduleAdvancedFormLive = openableModuleId !== null && !moduleIdShared && kindNode?.kind === 'advanced'`
- `moduleHtmlFormLive = openableModuleId !== null && !moduleIdShared && kindNode?.kind === 'html'`

These are the same condition as the module toggle builder (`StudioDetail.svelte:116`). The form mounts on the **kind**, not the item, so it also mounts while the html kind has no item. Each form shows the module status chip (`currentModuleAck()`) and is keyed by `ownerKey`.

**Shared view:**
- `moduleAdvancedShared` and `moduleHtmlShared` are the same conditions with `moduleIdShared` true.
- They mount the same component with `readOnlyShared`. It shows the values as plain text with the switches disabled, plus the status line `studioRefusalModuleSharedId`.
- No write path is offered.

**Suppressed while either form or either shared view is mounted, as `toggleBuilderLive` suppresses them today:**
- the empty-kind note `studioEmptyKind`, on the html kind with no item;
- the `itemText` block (`studio-detail-text` and `studio-detail-truncated`);
- the read-only note `studio-detail-readonly`.

The classic link is unchanged and is the interim link of section 1.3.

**Frame (S4 §2):**
- a column of sections (`studio-form-section`, a header button with `aria-expanded`, a body);
- labels above controls at every width;
- inline Help disclosures from today's Help keys (`namespace`, `lowLevelAccess`, `backgroundHTML`).

**Root `data-part` and sections:**

| `section` | Root `data-part` | Sections, in order (design default) |
|---|---|---|
| `advanced` | `studio-module-advanced-form` | **정보** (이름, 설명, 네임스페이스); **표시** (아이콘 숨기기); **위험한 설정** (낮은 수준 접근), last. None of them folds. |
| `html` | `studio-module-html-form` | No section header. One field: the label `backgroundHTML` with its Help, the LT field, and the hint `studioModAdvBackgroundHint` under it. |

Section collapse state is not stored (design default). The tree counts of both kinds stay as today.

### 2.2 Widths

- **Phone (360-412, Android MVP first):**
  - The form is one full-screen column with the existing edge padding.
  - Inputs are `min-h-11` (44 dp).
  - Each switch is a full-width row: label and explanation on the left, the switch on the right, and the whole row is the tap target.
  - Nothing scrolls horizontally. The risky sheet is a bottom sheet.
- **768:** the same column.
- **1280:** one column at the S4 §9 form max width, centred. Headers are not sticky.

### 2.3 위험한 설정 section

The structure follows S4 §6:
- `data-part="studio-module-risky"`;
- the heading "위험한 설정" with the triangle-alert icon;
- an always-visible warning line;
- the switch, with its explanation line visible under it and `aria-describedby` pointing to that line and to the warning.

The wording names the module (section 5).

**Turning it on asks (MC-3980). Every replay that turns it on asks too (MC-3984).** "On" and "off" are the engine's reading, by truthiness. The guard and the sheet are specified in section 3.5. Turning it off never asks. Studio never turns the flag on by itself.

**Theme packs:** the section gets ordinary `studio-*` part names only. No new guard, invariant or protected part is added against a pack hiding, covering or restyling it (MC-3638). A pack that hides it is a known limitation.

### 2.4 States

| State | What the form area shows |
|---|---|
| Loaded, id unique, history ready | The form, editable, with the status chip. |
| History loading, or another page holds the owner | The form is read-only (`readonly`, `aria-busy`), as S1 does (`StudioAdvancedForm.svelte:77-78, 176`). |
| Stub (not loaded) | No form. Today's not-loaded or loading line (`StudioDetail.svelte:196-201`). The model gives a stub no kinds (`ownerModel.ts:331`). |
| Load refused | "Not loaded" stays. The classic link reads `studioOpenModules`: an error-state link, follow-up #709 (section 1.3). |
| Shared id | The read-only view and `studioRefusalModuleSharedId` (section 2.1). |
| **A value stored absent or in another type (MC-4030)** | The field is **editable**. It shows the value as the engine reads it, with the note `studioModAdvValueForeign(stored)` when the stored value is of another type. See section 2.5. |
| Write refused at write time | The control goes back to the live value. The section's refusal line shows `refusalTextOf(result, owner)`, as in S1 (`StudioAdvancedForm.svelte:110-120, 213-215`). |
| Low-level confirm pending | The switch shows the engine reading from before the press and the sheet is open (section 3.5). |
| Empty values | Empty inputs. The 배경 HTML field shows the LT empty state. |
| MCP module | The same editable form (MC-1639). |

### 2.5 Absent and wrong-typed values (MC-4030)

Such modules exist:
- `convertCharacterToModule` copies an optional `creatorNotes` into `description`, so `description` can be `undefined` (`interchangeability.ts:65`);
- unvalidated imports can lack `name` (`moduleDuplicates.ts:8-9`);
- a `.risum` written by another tool can hold any JSON value, for example `lowLevelAccess: 1` or `namespace: null`.

Revision 1 made such a field read-only and pointed to classic. Under MC-4030 Studio edits it. The rules, per stored state:

| Stored state | How the engine reads it | What the control shows | What the first edit does | What its undo does |
|---|---|---|---|---|
| Key absent, or present with `undefined` | absent | Empty input, or the switch off. No note. (`name` shows `studioModAdvNameEmpty`.) | Writes a typed value: a string, or `true`/`false`. | Deletes the key again. |
| Typed (`string` on a text field, `boolean` on a switch) | as stored | The value | Writes the new typed value | Writes the old typed value |
| Another type (for example `1`, `null`, `'yes'`, `{…}`) on a **switch** | truthy is on, falsy is off | The switch at that truthiness, **enabled**, plus the note `studioModAdvValueForeign(stored)` | Writes `true` or `false`: the opposite of the shown state. Turning on asks (section 3.5). | Writes the original stored value back, deep-equal (section 3.8). |
| Another type on a **text** field (for example `name: 5`, `namespace: null`, `backgroundEmbedding: 0`) | not text: `namespace` selects nothing (`moduleRefs.ts:46`), a non-string `backgroundEmbedding` is never rendered as text | Empty input, plus the note `studioModAdvValueForeign(stored)` | Writes the typed string the user entered | Writes the original stored value back |

`stored` in the note is the value's JSON text, cut to 80 characters with an ellipsis (design default). The note disappears once the stored value is typed, and comes back after an undo that puts the foreign value back.

**A key with an `undefined` value is treated as absent.** A save stores it as an absent key (`codec/normalize.ts:11`). So deleting it on undo restores the exact stored state. The only difference is the in-memory `'description' in module`, which no reader tests and no save keeps.

**The truthy non-boolean `lowLevelAccess` (for example `1`):**
- The switch shows **on**, enabled, with the note.
- Pressing it turns the flag off: it writes `false`, with no sheet (turning off never asks).
- Undoing that turn-off writes `1` back. The engine reads `1` as on, so that undo is an off→on replay and **asks** (MC-3984, section 3.5).
- Pressing the switch again (now `false`) writes `true` and asks (MC-3980).
- A direct write of `true` over a live `1` is on→on. It does not ask and lands as a type normalisation (engine API only; the switch never offers it because it shows on).
- A falsy foreign value (`0`, `''`, `null`) shows off. Turning it on writes `true` and asks.

**Namespace with a foreign value.** It shows empty, so a blur without typing writes nothing (section 4.1). Typing a value and committing writes a string. The user cannot turn `null` into `''` (the draft equals the shown value), and the engine reads both as no namespace.

## 3. Write and history model

### 3.1 Registry additions (E1)

Six rows are appended to `FIELD_SPECS` and `FIELD_PRESENTATION` (`ts/studio/history/fieldRegistry.ts:56-106`), plus their frozen rows:

| Path (history identity) | `property` | value | holders | absent | editWhenAbsent | keepForeign (new fact, E11) | labelKey | focus `{form, part}` |
|---|---|---|---|---|---|---|---|---|
| `moduleName` | `name` | text | module | **delete** | **true** | true | `name` | `studio-module-advanced-form` / `studio-module-name` |
| `moduleDescription` | `description` | text | module | **delete** | **true** | true | `description` | `studio-module-advanced-form` / `studio-module-description` |
| `moduleNamespace` | `namespace` | text | module | delete | true | true | `namespace` | `studio-module-advanced-form` / `studio-module-namespace` |
| `moduleHideIcon` | `hideIcon` | bool | module | delete | true | true | `hideChatIcon` | `studio-module-advanced-form` / `studio-module-hide-icon` |
| `moduleLowLevelAccess` | `lowLevelAccess` | bool | module | delete | true | true | `lowLevelAccess` | `studio-module-advanced-form` / `studio-module-low-level` |
| `backgroundEmbedding` | (none) | text | module | delete | true | true | `backgroundHTML` | `studio-module-html-form` / `studio-module-background` |

**Why the first five carry a module prefix:**
- A registered path's `holders` is frozen (`fieldRegistry.ts:21-26`, F-b). A shared `name` or `lowLevelAccess` path would freeze the holder list of whichever of S2, S3 or S5 lands first.
- `FIELD_PRESENTATION.focus` holds one target per path.

**Why `backgroundEmbedding` is bare (F3 simpler path, chosen):**
- Neither reason applies to it. No other holder has that property (the character's field is `backgroundHTML`), and its focus target belongs to the module only.
- The bare path makes **path = property = registry target**. So `routeOf`, `textTargetOfField` (`path.replace('.', '/')` is the identity for a dot-free path) and `textTargetOfOp` stay correct unchanged.
- This removes the failure class where path and target differ (T5-TX pins it).
- The registry rule allows a path equal to its property (`fieldRegistry.ts:8-11`: never *required* to equal it).

**`absent`, `editWhenAbsent` and `keepForeign` (changed in revision 2, MC-4030):**
- **All six rows edit when absent and delete on `{had: false}`.** This includes the required keys `name` and `description`. Revision 1 refused an absent `name`/`description` (`editWhenAbsent: false`, `absent: 'keep'`), because an undo could not delete a `keep` key. With `absent: 'delete'` the undo deletes it again, which is the exact prior stored state.
- A `{had: false}` write reaches a module only by replaying or restoring a value that was recorded absent. So `delete` never removes a `name` that was present when Studio first wrote it.
- Turning a switch off writes `false`, not a delete.
- **`keepForeign: true`** (E11, section 3.8): a present value of another type is read as `{had: 'foreign', value}` instead of absent, so an undo writes it back.
- The registry gains the rule (comment beside the rules): `keepForeign` is set on new rows only, requires `editWhenAbsent: true`, and is never changed on an existing row. The frozen-facts test pins it with the other facts.

**Ops:**
- Text paths use `editText(owner, path, value, 'typing'|'single')`.
- Boolean paths use `editField(owner, path, value, confirm?)` (E9, E5).

**Coordination with S2/S3:** S2 and S3 also append registry rows. Whichever stage lands second appends after the first one's rows and rebases the frozen table and the order literals.

### 3.2 Edit planner: a field intent needs no character target (E9, critical contract, F1)

**Today.** `editField` is `applyStudioWrite(owner, {kind: 'edit', build: …})` (`ownerHistory.svelte.ts:1434-1435`). Every `edit` intent is refused `gone` without a character target (`:909-913`), and a module target has none (`:1087`). So no boolean module path can be written. Neither can `customModuleToggle` through `editField`.

**Change (the reviewer's simpler mechanism).** A new intent kind replaces `edit` for `editField`:
- Shape: `{kind: 'field', path, value, confirm?}`.
- Planning happens in the same branch as `text`.
- Order: owner kind parsed → path must be in `SET_PATHS_BY_KIND[ownerKind]`, else `precondition` → `buildFieldEdit(path, value, live)`. That function refuses a value of the wrong type, and `unchanged` → Rule K → restore writes.
- It needs the live reader only, never a character target.
- The greeting intents keep `{kind: 'edit'}` and the "no character target → `gone`" rule.
- The comment "Every edit intent is refused without a character target" is reworded to cover the greeting intents only.

**Consequences:**

| Owner | Before | After |
|---|---|---|
| Character or chat, path in its row | lands | lands (same build) |
| Character or chat, path not in its row | `{ok: true, unchanged: true}` when the value equals the one the reader reads (a chat owner's reader reads the character's paths, `studioSetters.ts:172-175, 251-252`); `precondition` (Rule K, after the build) otherwise | always `precondition` (the row check, before the build). Harmless: nothing is written either way (G1b). |
| Module, path in its row (`customModuleToggle`, the five new paths, `backgroundEmbedding`) | `gone` | lands. Coalesce default `true`, as today's `editField`. **Exception:** a `moduleLowLevelAccess` write that turns the engine reading off→on without the call's own `confirmed` naming it is refused `riskyConfirm` (E5, section 3.5) (G3.1). |
| Module, path not in its row (`desc`) | `gone` | `precondition` |
| Session (preset), path in its row (`customModuleToggle`) | `gone` | lands as `editText(…, 'typing')` does, through `applySessionWrite` |
| Any owner, greeting intents | unchanged | unchanged |

**Deliberate amendment of the pinned C2 test** (`ownerHistory.moduleText.svelte.test.ts`, "a field edit and a greeting intent have no character target and are refused as gone"):
- `editField desc` now expects `{ok: false, reason: 'precondition'}`.
- `editField customModuleToggle` moves to a new positive test, "a module field edit lands without a character target", which expects one slot replacement and one step.
- The three greeting intents stay `gone`.
- The test title is reworded to "greeting intents have no character target and are refused as gone".
- This is a named contract change, not collateral.

### 3.3 Write path (critical contract: persisted module record)

Every write goes through the existing module action of the history service:
- `applyStudioWrite` resolves the target (`resolveModuleTarget`, `studioSetters.ts:76-92`) and plans.
- It then calls `writeLiveModule(id, live => buildWrittenModule(live, writes, extras))` (`ownerHistory.svelte.ts:1169-1172`).
- `buildWrittenModule` makes a shallow copy of the module (`{...live}`), sets `propertyOf(path)` from a `set` write, or deletes it when the value is absent and `absent` is `delete` (`studioSetters.ts:576-604`). E11 adds one branch: a `{had: 'foreign'}` write assigns a fresh copy of the stored value (section 3.8).
- `writeLiveModule` finds the slot again by id and assigns it once (`:678-692`).
- After the save is armed, the slot-replaced port and the module ack run (`ownerHistory.svelte.ts:1200-1207`).

No new write function is added. The edit planner (E9), the foreign branch (E11) and the confirm guard (E5) are the changes in front of it.

**Downstream effects of a slot assignment:**
- **Dirty tracking.** The assignment changes the slot element's identity, which the modules effect turns into `tracker.modules = true` (`storage/dbChangeEffects.svelte.ts:196-203`).
- **store2.** The encoder derives the module index entry from the unit again (`storage/store2/codec/modules.ts:35-60`; `codec/split.ts:1140`). A non-string `name`/`description` projects as `''`, a non-boolean flag is left out of the entry, as today.
- **`moduleUpdate`.** Its deps include `namespace`, `hideIcon` and `backgroundEmbedding` (`process/moduleUpdateDeps.ts:29-40`).
- **Studio's owner model.** It is derived again on a slot replacement (`ownerSource.svelte.ts:66-78`).

### 3.4 Router: `backgroundEmbedding` is a text field path (E3, critical contract)

The asset merge already writes the target `backgroundEmbedding` (`referenceTargets.ts:351, 375`). So does Update-All. With a registered set path on the same property, the one router must send that target to the set path (as MC-3941 did for the character's text fields). Otherwise:
- a merge step's write is a `textSet` that the restore point never learns (`deriveRestoreWrites`, `historyModel.ts:1222-1243`);
- a merge then a form edit records the wrong `before`;
- a form edit then a merge lists the field as changed elsewhere.

**Every path↔target converter, and what E3 does to it:**

| Converter | Anchor | Change |
|---|---|---|
| `TextFieldPath` type and `TEXT_FIELD_PATHS` | `historyModel.ts:85-109` | Append `'backgroundEmbedding'`. The type comment "The character text fields" becomes "The owner text fields (the character's and the module's `backgroundEmbedding`)". |
| `routeOf` | `:894-912` | None. `parseTargetPath('module', 'backgroundEmbedding')` gives `{field}`, which matches the list. |
| `textTargetOfField` | `:940-942` | None. It is the identity for a dot-free path. |
| `textTargetOfOp` | `:946-955` | None. `set backgroundEmbedding` gives `backgroundEmbedding`. |
| `textFieldOf`, `textOf`, `storeText`, `textWriteFor`, `deriveRestoreWrites`, `textBeforeOf` | `:915, 959-1039, 1214-1243` | None. The module reader reads the path, because it is held by the module (`studioSetters.ts:209`). The character reader reads it as absent (`:172-177`). `textOf` and `textBeforeOf` already require `typeof value === 'string'` (`:966, 1035`), so a foreign value reads as no text and no merge or Update-All rewrites it. |
| `writeCharacterText` skip | `studioSetters.ts:447-453` | None. `parseTargetPath('character', …)` is null first. |
| `writeModuleText`'s `backgroundEmbedding` branch | `studioSetters.ts:667-669` | **Kept, no skip.** Update-All writes a module text as a `textSet` and records no history step (`toggleUpdateAll.ts:250-252`, pinned by `toggleUpdateAll.test.ts:287-288`), and this branch is its only writer for the field. It writes only over a string, so a foreign value is left alone. |
| `writeOpFor` comment | `toggleUpdateAll.ts:249` | The comment changes to: "the write for a registry path of this owner kind; a module text is always a `textSet`, which lands the same value a replay's `set` would". The code is unchanged. |

**Tests that pin `TEXT_FIELD_PATHS` and are amended deliberately:**
- `fieldRegistry.test.ts:71`
- `historySetPaths.test.ts:53`
- `historyModel.s1TextFields.test.ts:83`

**Tests that pin the literal `RESTORE_PATH_ORDER`, amended for the six appended rows:**
- `fieldRegistry.test.ts:66`
- `historySetPaths.test.ts:55`
- `historyModel.w0a.test.ts:104`
- the frozen F-c, which is derived from the frozen table

`fieldRegistry.probe.svelte.test.ts:150` keeps working: its probe rows follow the real rows.

The stored `textEdit` op shape does not change.

### 3.5 Low-level confirm: one-path guard (E5, E4; MC-3980, MC-3984; critical contract)

**Unified with #680 S2 (PR 728).** This section describes the guard as unified with the character flags (Gate 1 delta verdict `gate1-u2.md`, 2026-11-23): one guard, one refusal code `riskyConfirm`, one confirm vocabulary `confirmed`, one question store and sheet. Where it says "the path", it means each risky path under its own rule.

**The rule (revision 2):**
- `engineOn(v)` is the engine's reading of a `FieldValue`: `{had: true, value: true}` is on; `{had: 'foreign', value}` is on when `value` is truthy; everything else is off.
- No Studio write lands when the deciding `set` of a risky path in `planned.writes` has a value that is `engineOn` **while the live reading is not `engineOn`**, unless the call's own `confirmed` names that path. One guard serves `moduleLowLevelAccess` and the three character flags. For `moduleLowLevelAccess` the deciding write is the **last** `set` (revision 3, H2); for the character flags it is **any** `set`. A plan with no `set` of the path never asks.
- **Why the last write.** `planRevert` pushes one write per applied op and does not collapse writes per path (`historyModel.ts:1977-2048`). Only the stored ops are collapsed (`revertStepOps`, `:2219-2249`). The writes chain, because each op's precondition is checked against the working copy. `buildWrittenModule` applies all of them to one copy, which `writeLiveModule` assigns once (`studioSetters.ts:576-604, 678-692`). So the engine never sees an intermediate value, and the last write is the value the module ends with. Read per write, the rule would ask on a revert that crosses a turn-on and a later turn-off back to before both (writes `[true, …, false]` against a live `false`), which is a net off→off. **The character paths keep the any-write rule because their writes land in place**, one op at a time with no rollback (`applyCharacterWrites`): an intermediate turn-on is live even when the last write turns it off, so a character batch with any unconfirmed turn-on write is refused before anything is applied. The rule is per path (`RISKY_FLAG_RULE` in `riskyFlags.ts`, a mapped type that forces a choice for every path added later); only a holder that assigns once may take the last-write rule.
- The live reading is `live.field('moduleLowLevelAccess')` from the reader the plan used (`ownerHistory.svelte.ts:1088`).
- It runs on every intent kind with no kind list: `field` (the direct turn-on), `value`, `replay` (undo and redo), `revert` and `restore`, so a new intent is guarded by default.
- `text`, `asset` and `restoreDeleted` can never produce it. Text paths exclude booleans. An asset step holds no `set`. A deleted item is a first message.
- The guard looks at this one path only. It is not the all-owner, all-flag replay guard (MC-3984).

**Why the live reading is now part of the rule.** Revision 1 checked the write alone (`{had: true, value: true}`). With E11 an undo can write back a foreign truthy value such as `1`, which the engine reads as on. A write-only rule on `true` would let that undo turn the flag on unasked. A write-only rule on `engineOn` would ask on on→on, for example a restore from a live `true` to a recorded `1`. Comparing the last write with the live reading asks exactly on a net off→on, which is MC-3984's wording.

**Where it sits.** It is one check in `applyStudioWrite`:
- after `planFor` has returned writes and after the session branch (`:1093`; a session owner never holds the path);
- before the asset-removal check, the record assignment, the live write and the save.

Its place relative to the `noWrite` branch (`:1105-1123`) is free (G1a): an `already` or dropped replay returns `writes: []` (`historyModel.ts:1648-1660`), so a guard on writes sees nothing there either way. The guard reads `planned.writes`, never the replayed step's ops. In a partial replay, an op that fails its precondition is left out of the writes (`historyModel.ts:1583-1611`), so a failed turn-on op never asks (H1, I1, T5-GUARD-QUIET (d)). The op fails when the live reading differs from the op's `before`. `absent` and `false` are different readings (`fieldValueEquals` compares `had` first, `historyModel.ts:115-120`), so a flag that was `false` when the step was stored and is absent now fails it.

Every entry point reaches this one place: `editField`, sync `undo`, `redo`, `revertTo` and `restore`, and the queued `replay` through `applyReplay` (`ownerHistory.svelte.ts:1310-1318`).

**The refusal it returns:**
- `{ok: false, reason: 'riskyConfirm', paths: SetPath[], pin?: RiskyPin}`, with `paths` the flags left unconfirmed.
- `pin` is `{expectTop}` for an undo or redo: it is the id of the step that would have been replayed (`replayedSteps`, `:795-805`).
- Nothing is written, marked, recorded or saved. The open step stays as it was. **The history position is unchanged**: no `land` ran, so `done`, `undone` and the restore point are the objects they were.
- `StudioRefusal` gains `'riskyConfirm'`. `refusalTextOf` maps it per kind through `paths`: a refusal naming `moduleLowLevelAccess` shows `studioRefusalConfirmLowLevel`, any other shows `studioRefusalRiskyConfirm` (`refusalText('riskyConfirm')`). Both keys stay.

**API (named, not literal code; G3.2):**
- `editField(owner, path, value: string | boolean | BiasRow[], options?: { confirmed?, coalesceKey?, reportStep? })`
- `editValue(owner, path, value: boolean, options?: { confirmed? })`
- `restore(owner, keep, options?: { confirmed? })`
- `ReplayDesc` members gain `confirmed?: readonly SetPath[]`; the revert member also gains `expectIds?`
- `confirmed` names the flags this one call confirms; it never outlives the call.
- The `ok: false` member of `StudioResult` (`ownerHistory.svelte.ts:167`) carries `paths?: SetPath[]` and `pin?: RiskyPin` on a `riskyConfirm` refusal. Neither is stored or posted.

The sync `undo`, `redo` and `revertTo` take no confirm. They are used by tests only and always refuse the turn-on.

**Hosts.** One retry helper (`withRiskyConfirm`, `resolveRiskyRefusal`, `pinnedDesc` in `ts/studio/edit/riskyReplay.ts`) and one question store (`askRiskyTurnOn`, `riskyQuestion`, `answerRiskyQuestion`, `cancelRiskyQuestion` in `ts/studio/edit/riskyConfirm.svelte.ts`). `runWithLowLevelConfirm`, `askStudioRisky` and `lowLevelConfirm.svelte.ts` no longer exist. The helper takes the first result and an attempt callback that receives `confirmed` and `pin`:
- On a `riskyConfirm` refusal it asks through `askRiskyTurnOn(owner, paths)`; the sheet names the module (the tree's label when the name is empty or not a string).
- **Turn on:** it runs the attempt again with `confirmed` and the refusal's pin, so a stack that moved while the sheet was open refuses `targetChanged` and nothing lands.
- **Cancel, Back or Esc:** it returns `null`, the silent result. The host shows no message and changes no state. Focus returns to the element that had it before the sheet, if that element is still connected.
- **Blocked** (a shell layer is open): it returns the refusal with its `paths`, and the host shows the per-kind refusal text.

**Pinned retries (supersedes the accepted G3.3 property of revision 3).** `runReplay` checks `expectTop` for an undo or redo and `expectIds` for a revert (the step and every step above it), so a stack that moved while the sheet was open refuses `targetChanged` for all three. A restore has no pin: its retry recomputes `keep` after the answer, so a path that changed elsewhere during the question is kept, not overwritten unseen.

**Cancel refuses the whole action (G3.4, design default).** Cancelling a revert or restore that also changes other fields lands nothing; the user can revert or restore again and confirm. This reads MC-3984's "the same confirm" as a confirm on the action, not on the flag alone. It can be vetoed.

| Route | Host (production caller) | Change |
|---|---|---|
| Direct turn-on (switch) | `StudioModuleAdvancedForm` | Calls `editField(…, true)`, then `resolveRiskyRefusal`; its asks are cancelled when the form is destroyed. The switch keeps the engine reading from before the press until the write lands. On landing, the live region announces `studioModAdvLowLevelOn(name)`. |
| Undo of a turn-off; redo of a turn-on (keys, layer buttons) | `StudioScreen.replayAndNotify` (`StudioScreen.svelte:140-173`) | Runs the replay through `withRiskyConfirm` before the outcome notice. The silent (`null`) result says nothing. |
| Undo, redo or revert from the History panel | `StudioHistoryPanel.replayAction` (`StudioHistoryPanel.svelte:132-152`) | The same. The panel message stays unset on a cancel. |
| Restore point | `StudioRestoreSheet.confirm` (`StudioRestoreSheet.svelte:65-79`) | On the refusal, the restore sheet stays open and does not show its refusal line. The risky sheet opens above it. On Turn on, `restore(owner, keep, {confirmed})` runs with `keep` recomputed after the answer. Its refusal line renders `refusalTextOf` of the refused `{reason, paths}`. On Cancel, both sheets stay as they were, minus the risky one. |
| Toast Undo | `studioToasts.ts:196` | No change. Its step is an asset or greeting step, which never holds the path. If it ever met the refusal, it would show the per-kind refusal text (fail closed). |

**Sheet (E4).** `StudioRiskyConfirm.svelte` is mounted by `StudioScreen` while `riskyQuestion() !== null`. It follows the restore-sheet pattern:
- `role="alertdialog"` (`studio-risky-confirm`, with `-title`, `-body`, `-cancel`, `-ok` parts), labelled by its title, with the body line;
- buttons Cancel (`language.cancel`, initial focus) and `studioModAdvLowLevelAskConfirm`; Tab cycles the two; a tap on the scrim cancels;
- a bottom sheet on phone, centred from `sm`;
- `z` above the restore layer;
- its own Back layer, `registerStudioRiskyBack()`, registered from its initialisation;
- Esc closes it first in `StudioScreen.onkeydown`, before the restore sheet; while it is pending the history keys are dropped.

The question store keeps one pending question:
- A second ask while one is pending resolves `no`; the shown question stays.
- Closing Studio, ending the visit, changing the selected owner key or the character, or the asker's destruction ends it `no` (the screen's effect and each host's `still()`); a cancelled question is silent.
- Under a shell layer (`hasOpenShell()`) the answer is `blocked`: no question opens, nothing is written, and the refusal shows the module text.

The sheet is the same for the direct and the replay routes (MC-3984: "the same confirm as a direct turn-on"):
- title `studioModAdvLowLevelAskTitle`;
- body `studioModAdvLowLevelAskBody(name)`.

S2's character flags use the same sheet, store and guard (unification of PR 728 with this stage, Gate 1 delta verdict `gate1-u2.md`, 2026-11-23): the sheet reads `riskyQuestion()`, shows the module wording for `moduleLowLevelAccess` and the character wording for the other three paths.

### 3.6 Undo, redo, restore

The semantics are the shell's (SLICE1 §5):
- per-op preconditions (`historyModel.ts:1070-1081`), which compare with `fieldValueEquals`, deep for a foreign value after E11;
- typing coalesces within 1 s;
- the restore point records `before` at the first write of the visit and `last` on every write (`:2528-2564`);
- the step label is `{kind: 'field', field: <path>}`.

The routes that turn `moduleLowLevelAccess` off→on (engine reading) are:
- undo of a turn-off step, including a turn-off of a truthy foreign value such as `1`;
- redo of a turn-on step;
- a revert that crosses a turn-off step;
- a restore whose `before` reads on.

All of them ask (section 3.5). This includes the replace-import case: the id is kept, so history survives the replace (section 0). Every off→on replay asks, whatever content the module holds now.

A namespace step's undo can switch the module on or off again (section 4.1). The inline note follows the live value.

Focus (E10):
- `readOwnerFields` resolves a module owner through the published open-module id (`resolveOwnerTarget(owner, openStudioModuleId)` with `liveReaderOf`), as the restore sheet does (`StudioRestoreSheet.svelte:43-45`).
- Without that, a module undo or redo has `before` and `after` both `null`, and focus never reaches the changed field.
- A foreign reading is reported as a tagged value, `{foreign: value}` (a new exported type `ForeignFieldRead` in `ownerFields.ts`), never as a bare value or its JSON text (revision 3, H5). A bare JSON text can equal a typed string. `name: 5` would read `"5"`, and a foreign `true` on a text path would read `"true"`. An undo between such a value and the typed string `"5"` or `"true"` would then compare equal and place no focus.
- `changedFieldTarget`'s registry loop (`historyFocus.ts:64-66`) compares each path with a helper instead of `!==`. Two tags are equal when `sameJsonValue` holds for their values. A tag never equals a typed value or `undefined`. Anything else compares with `===`, as today. The reader returns a fresh copy each time, so a reference comparison would see every foreign field as changed.
- Character, chat and session owners keep today's resolution.

### 3.7 Changed critical contracts

1. **The Studio history stored record (device-only) is widened.** Module records may now hold `set` ops, labels and restore keys for six new paths, and foreign values on them (contract 6). Older builds refuse such a record whole (`isSetPath`/`parseLabel`, `historyModel.ts:263-265, 303-304`), which MC-1827 allows without a version bump. The set-aside keeping the newer bytes is inherited and tested again (T5-OLD). MC-350: no saved data becomes unreadable.
2. **The persisted module record write (upstream format).** Studio now writes six upstream fields of `db.modules[i]`, including key deletion on undo (now also of `name` and `description` when they were absent) and writing a foreign value back on undo. The shape stays upstream's: Studio puts back only values the module held before.
3. **Security enforcement input and its confirm guard.** `moduleLowLevelAccess` decides what every trigger of the module may do. The one-path guard (section 3.5) is the enforcement: no Studio route turns the engine reading on without a confirmation.
4. **The text router.** `backgroundEmbedding` joins `TEXT_FIELD_PATHS`, which decides which ops replay it as a `set` and what the restore point learns (section 3.4).
5. **The edit planner's guard order and the "no target, no edit" rule (F1).** `editField` becomes a `field` intent that needs only the live reader (section 3.2).
6. **The history `FieldValue` and the module reader (E11, MC-4030).** `FieldValue` gains `{had: 'foreign', value: JsonValue}` on `keepForeign` paths. The module reader, the parser, `fieldValueEquals` and the module writer change (section 3.8).

### 3.8 Foreign values (E11, critical contract 6, MC-4030)

**The problem.** `readHeld` reads a value of the wrong type as `{had: false}` (`studioSetters.ts:162-165`). An edit over `lowLevelAccess: 1` would record `before: {had: false}`, and its undo would delete the key. The stored state would not come back. Revision 1 avoided that by refusing the edit; MC-4030 does not allow that.

**The variant.** `FieldValue` becomes:
- `{had: false}`: absent (a missing key, or `undefined`);
- `{had: true, value: string | boolean}`: present, of the path's type;
- **`{had: 'foreign', value: JsonValue}`**: present, of another type, as plain JSON (`JsonValue` from `storage/blockFrame.ts:137`).

**`pnpm check` does not find the sites (revision 3, H3).** `'foreign'` is truthy and `JsonValue` includes `string` and `boolean`. So an existing `if (x.had)` site still compiles and runs with the third shape: `fieldValueEquals` would compare by reference, `ownerFields.ts` would pass the fresh copy through, and `buildWrittenModule` would fall to its delete branch. The build therefore handles the sites from this list, and the tests named below kill a missed one.

The list covers every non-test `src` line matching `\bFieldValue\b` or `\.had\b`. Grep on 2026-11-23, worktree at 71882fe16: 51 lines in 9 files. It is COMPLETE for those two patterns. A site reached through destructuring or under another name does not match them.

| Site | What it does with a foreign value | Outcome |
|---|---|---|
| `historyModel.ts:112` (`FieldValue` type) | (type) | **Changed by E11**: the third member |
| `historyModel.ts:115-120` (`fieldValueEquals`) | would compare by reference | **Changed by E11**: `sameJsonValue`. Its callers follow it: `:1073` (precondition), `:1175` (`holdsResultOf`), `:2246` (`revertStepOps` net-zero) and `:2322` (`restoreValueEquals`). |
| `historyModel.ts:267-281` (`parseFieldValue`) | refuses `had: 'foreign'` | **Changed by E11**: accepts it on `keepForeign` paths only |
| `historyModel.ts:165, 200, 661, 676, 753-768` (op, restore value, reader, write op, `Working`) | stores and passes the value | Safe: types and storage only |
| `historyModel.ts:966, 1031-1035, 1228-1230` (`textOf`, `textBeforeOf`, `deriveRestoreWrites`) | `typeof … === 'string'` guards | Safe: a foreign value reads as no text |
| `studioSetters.ts:144-166` (`readHeld`) | reads a wrong type as absent | **Changed by E11**: see "Who produces it" |
| `studioSetters.ts:16, 141, 172` (import, comment, live reader `field`) | returns `readHeld` | Safe |
| `studioSetters.ts:248, 251, 254` (`buildFieldEdit`) | passes the absent check; never `unchanged`, because its type differs from the typed value; `after` is typed | Safe, as designed |
| `studioSetters.ts:384-405, 407-411` (`writeHeld`, `setCharacterField`) | the `typeof` branch writes nothing for a foreign value | Safe: no character or chat path has `keepForeign`, and the parser refuses one there |
| `studioSetters.ts:594-602` (`buildWrittenModule` `set` branch) | would fall to the delete branch | **Changed by E11**: assigns a fresh plain copy |
| `presetTarget.ts:11, 63, 84` (session adapter) | the reader returns a typed value; the write check uses `typeof` | Safe |
| `greetingListOps.ts:90`, `assetSetters.ts:179` | `typeof` guards | Safe |
| `ownerFields.ts:20` (`readOwnerFields`) | would pass the fresh copy through | **Changed by E10**: tagged reading (section 3.6) |

The other matches belong to other types:
- `FmValue`: `historyModel.ts:123-124, 287, 290, 2464, 2474`; `studioSetters.ts:414`;
- the folder field value: `historyModel.ts:397, 400`; `folderCodec.ts:222, 226, 496`; `mergePreview.ts:225`;
- a local object: `StudioExampleForm.svelte:212`.

T5-FOREIGN-UNDO kills a missed equality, writer or reader site, and T5-FOCUS-RO a missed `ownerFields` site.

**Who produces it.** Only `readHeld`, and only for a path whose facts carry `keepForeign: true` (the six new rows):
- It classifies the **stored form**, not the raw value (revision 3, H4): `plain = toPlainJson(raw)` (`codec/normalize.ts:35`), the form a save stores. A missing key, `undefined`, a function and a symbol all give `plain === undefined`.
- `plain === undefined` → `{had: false}`;
- `typeof plain` is the path's type (`string` on a text path, `boolean` on a bool path) → `{had: true, value: plain}`;
- anything else → `{had: 'foreign', value: plain}`.
- **Why the plain form.** `toPlainJson` changes some non-JSON values (`normalize.ts:47-66`): a `Date` becomes its ISO string, a boxed primitive becomes its primitive, and `±Infinity` and `NaN` become `null`. Classifying the raw value while storing the plain one could record `{had: 'foreign', value: <a string on a text path>}`. The parser below refuses that, so the module's whole Studio record would be set aside at the next load. Classifying the plain form gives only readings the parser accepts.
- A path without `keepForeign` keeps today's raw `typeof` reading (`studioSetters.ts:162-165`).

Every other path keeps today's reading, so no character, chat or session behaviour changes (T5-FOREIGN-SCOPE).

**Equality.** `fieldValueEquals` compares two foreign values with `sameJsonValue` (`codec/normalize.ts:99`), and a foreign value never equals a typed or absent one. `restoreValueEquals` and every precondition use it, so a redo over a live `{x: 1}` matches a recorded `{x: 1}`, even after the record went through JSON.

**Writer.** `buildWrittenModule`'s `set` branch gains: a `{had: 'foreign'}` write assigns `toPlainJson(value)`, a fresh copy, under `propertyOf(path)`, whatever `absent` says. The history record's object is never aliased into `DBState`. The character and chat writers never see a foreign write: no path they hold has `keepForeign`, and the parser refuses one (below). They leave the field as it is if they do.

**Edit builder.** `buildFieldEdit` is unchanged in logic. A foreign `before` is never `unchanged` (it has another type than the typed `value`) and passes the absent check. The op records `before: {had: 'foreign', value}` and `after: {had: true, value}`.

**Parser.** `parseFieldValue(path, raw)` accepts `{had: 'foreign', value}` only when:
- the path's facts carry `keepForeign: true`;
- `value` is present and is not of the path's type (a string on a text path, a boolean on a bool path is malformed);
- `value` is not `undefined`.

Anything else refuses the record whole, as today.

**MC-1827 check** (refused-whole widening keeps the version):
- (a) An older build refuses a record holding a foreign value whole. Such a value sits only on the six new paths, which an older build already refuses on the path (`isSetPath`). The old `parseFieldValue` also returns `null` for `had: 'foreign'` (`historyModel.ts:271-276`). Nothing is dropped entry by entry.
- (b) The new reader reads every shape v2 wrote: `had: true` and `had: false` parse as today.
- (c) The set-aside keeps the newer bytes (inherited, T5-OLD).
- No `HISTORY_FORMAT_VERSION` bump. The rows and the variant land in the same build PR, so no build ever holds one without the other.

**Undo restores the exact prior stored state:**

| Before the edit (stored) | Op `before` | Undo writes |
|---|---|---|
| key absent | `{had: false}` | delete (`absent: 'delete'` on all six rows) |
| `description: undefined` (converted character) | `{had: false}` | delete. The stored form was already absent (section 2.5). |
| `lowLevelAccess: 1` | `{had: 'foreign', value: 1}` | `1`, after the confirm (section 3.5) |
| `namespace: null` | `{had: 'foreign', value: null}` | `null` |
| `hideIcon: {x: 1}` | `{had: 'foreign', value: {x: 1}}` | a fresh `{x: 1}` |

**Size.** A foreign value is stored in the history record as it is. A large one counts against the existing per-owner cap (`studioHistoryStore.ts:17, 25`), as a large text already does. No new bound (design default).

**Limitation (accepted).** A live value `toPlainJson` refuses (a `bigint` or a cycle) cannot reach a loaded module: JSON import and the store2 load both give plain JSON, and a save of such a module already fails in the codec. If one is there, the reading falls back to `{had: false}`, and the undo deletes the key. No recovery is designed for already-corrupted state (AGENTS.md).

**Limitation (accepted, revision 3, H4): non-JSON values held in memory.** For a `Date`, a boxed primitive, `±Infinity` or `NaN`, the control, the guard's live reading and the undo all use the stored form, not the raw value.
- The engine reads the raw value by truthiness, so the two readings can differ. `lowLevelAccess: Infinity` reads as foreign `null`, and `new Boolean(false)` reads as typed `false`. Both show off while the engine reads them on.
- Every such difference shows off where the engine reads on. So Studio asks more often, never less, and no route turns the flag on without a confirm.
- An undo writes back the stored form, which is what a save keeps.
- No producer of such values is known. JSON import, the store2 load and `.risum` give plain JSON. Per Gate 1 r2's trace (not re-read here), only `Infinity` might come through a msgpack `.bin`. So no fixture is built for them (MC-329).

## 4. Namespace and background HTML semantics (traced)

### 4.1 Namespace

- **Selection.**
  - A run's reference list is: `enabledModules`, the chat's modules, the character's modules, the persona's module, and the comma-split, trimmed Module Integration text (`process/moduleRefs.ts:23-39`).
  - A module matches when its id **or its non-empty namespace** is in that list (`:45-47`). A non-string namespace matches nothing. The first holder of an id wins (`process/moduleRefList.ts:40-58`).
- **Module Integration** is a preset field. Its working value is `db.moduleIntergration`, saved into and restored from each preset (`storage/database.svelte.ts:2375, 2534`). It is a per-preset setting, not a module field, and is not part of this form.
- **CBS:** `{{moduleenabled::ns}}` and `{{moduleassetlist::ns}}` (`ts/cbs.ts:1699-1729`, not reopened).
- **Boot residency** reads the index entry's namespace (`storage/store2/residencyPolicy.ts:46-74`).
- **Studio badge:** `namespace` (`ts/studio/studioModules.ts:87-97`).
- **Uniqueness:** none. Studio adds a non-blocking note only.
- **Effect of a change.** Nothing stored elsewhere is rewritten. A rename can switch the module off wherever only its namespace turned it on, or on where the new value is listed, from the moment the write lands (`process/modules.ts:1111-1157`).
- **What Studio says (MC-3982):**
  - After a landed namespace write, and while the field shows the live value, an inline note appears under the field:
    - `studioModAdvNamespaceIntegrationOff(before, after)` when the working Module Integration list holds the old value;
    - `studioModAdvNamespaceIntegrationOn(after)` when it holds the new one.
  - "Holds" uses the same trim and comma split as `moduleRefs.ts:34-36`. A foreign old value counts as no namespace.
  - The note reads the live state on every render, so an undo makes it correct again.
  - **Not noted:** other presets' integration texts, and matches through the id lists (`enabledModules`, the chat's, the character's and the persona's modules), which can also name a namespace (F11).
  - The pure helper `moduleNamespaceNotes.ts` computes all four namespace notes (shared, unmatchable, integration off, integration on).
- **Commit timing (design default; F7):**
  - The draft lives in the input. It is committed as one `single` step on blur or Enter, **only when the draft differs from the value shown**. Focus then blur with no typing writes and marks nothing. This matters because on a create-shaped module (no `namespace` key), `''` would otherwise be written as a change (`studioSetters.ts:241-259`). The same holds for a foreign namespace, which shows empty.
  - Enter is ignored while an IME is composing (`event.isComposing` or `keyCode === 229`).
  - Unmount flushes a differing draft (S1's flush, `StudioAdvancedForm.svelte:165-168`).

### 4.2 Background HTML

- `moduleUpdate` joins every active module's `backgroundEmbedding` into the `moduleBackgroundEmbedding` store (`process/modules.ts:1120-1135`).
- The chat background renders the character's `backgroundHTML` + that store, through CBS and `ParseMarkdown(…, 'back')` (`lib/ChatScreens/BackgroundDom.svelte:52-124`).
- A module embedding turns a theme pack's canvas off (MC-2949).
- The asset merge writes it as the target `backgroundEmbedding`, which after E3 is a `set` of the bare path. Update-All writes it as a `textSet`. Neither rewrites a foreign value (section 3.4).
- Not traced: CSS scoping of the embedding. This spec does not rely on it.

## 5. en.ts keys (English only)

**Existing keys reused:** `name`, `description`, `namespace`, `hideChatIcon`, `lowLevelAccess`, `backgroundHTML`, help `namespace`, help `lowLevelAccess`, help `backgroundHTML`, `cancel`, `studioRefusalModuleSharedId`, `studioNotLoaded`, `studioAssetModuleLoading`, `studioOpenModules`, `studioOpenClassic`.

**New keys: 18.** Revision 2 drops `studioModAdvValueClassicOnly` and adds `studioModAdvValueForeign`. The build PR carries all 7 other locales and passes `localeParity` (MC-058).

| Key | English | Where |
|---|---|---|
| `studioModAdvSectionInfo` | Details | section header |
| `studioModAdvSectionDisplay` | Display | section header |
| `studioModAdvSectionRisky` | Risky settings | section header |
| `studioModAdvRiskyWarning` | These settings change what this module can do. Turn them on only when you need them. | warning line |
| `studioModAdvLowLevelHint` | Lets this module's triggers and Lua call AI models, generate images and use other heavy features. | switch explanation |
| `studioModAdvHideIconHint` | Hides the chat icons in every chat where this module is on. | switch explanation |
| `studioModAdvNameEmpty` | Without a name the module is listed as "Module". | info note |
| `studioModAdvNamespaceShared` | (name: string) => `The module "${name}" uses the same namespace.` | info note |
| `studioModAdvNamespaceUnmatchable` | Module Integration ignores spaces at the ends and splits on commas, so it cannot find this namespace. | info note |
| `studioModAdvNamespaceIntegrationOff` | (before: string, after: string) => `Module Integration lists "${before}". With "${after}" this module stops turning on through it.` | inline note (MC-3982) |
| `studioModAdvNamespaceIntegrationOn` | (after: string) => `Module Integration lists "${after}". This module now turns on through it.` | inline note (MC-3982) |
| `studioModAdvBackgroundHint` | Shown behind the chat wherever this module is on. A theme pack's background is turned off while it has content. | html form hint |
| `studioModAdvValueForeign` | (stored: string) => `Stored as ${stored}, which is not the kind of value this field uses. A change here replaces it, and undo puts it back.` | field note (section 2.5) |
| `studioModAdvLowLevelAskTitle` | Turn on Low Level Access? | sheet title |
| `studioModAdvLowLevelAskBody` | (name: string) => `"${name}" will be able to access AI models and your storage directly.` | sheet body |
| `studioModAdvLowLevelAskConfirm` | Turn on | sheet button |
| `studioModAdvLowLevelOn` | (name: string) => `Low Level Access is on for "${name}".` | live-region announcement |
| `studioRefusalConfirmLowLevel` | Turning Low Level Access on needs your confirmation. | `refusalText` fallback (section 3.5) |

## 6. Required tests for the build

**Classes:**
- **R = regression reproducer.** It fails on the named base on an *assertion* about the intended defect. Import, setup and missing-export failures do not count.
- **C = compatibility guard.** It may pass before and after, and the row says so.
- **D = diagnostic.**
- **A = new-behaviour acceptance (per Gate 1 r0 F6).** Before the fix it fails only because the feature is absent (no form, no switch, no registered path). It is not a reproducer. Its evidence is that every mutant named for it in the mutant table makes it fail. Section 10 asks the Orchestrator to confirm the A label against the gates' three-label rule.

**Pre-fix base** is `origin/main` at the build branch point (71882fe16 unless rebased), unless a row names a stage-internal base. Every R row is **DESIGNED, NOT DEMONSTRATED** until the build shows its pre-fix failure.

**Fixtures follow MC-329.** Each module is built the way its producer builds it:
- *create-shaped:* `{name: '', description: '', id}` (`ModuleSettings.svelte:238-246`);
- *replace-imported:* through `applyModulePlacement(DBState.db.modules, incoming, {choice: 'replace', targetId})` (`moduleDuplicates.ts:50-66`). `incoming` is shaped like a `.risum` the classic editor wrote: `lowLevelAccess: false` (classic writes `false`, `ModuleMenu.svelte:413`), a fresh `id` and its own `trigger`;
- *converted:* `convertCharacterToModule` on a character without `creatorNotes`, which gives `description: undefined` (`interchangeability.ts:65`);
- *nameless:* `applyModulePlacement` with an incoming module that has no `name` key, as an unvalidated import places it (`moduleDuplicates.ts:8-9`);
- *foreign-typed:* a `.risum` JSON body holding `lowLevelAccess: 1`, `namespace: null`, `hideIcon: {x: 1}`, `name: 5` and `backgroundEmbedding: 0`, decoded through the module import decoder the classic import uses (`process/modules.ts` import path; the build names the function) and placed with `applyModulePlacement`. No hand-built object for these values;
- *every-key:* see the correction below.

**Correction of revision 0's fixture sentence (F4).** No single producer writes every key. `convertCharacterToModule` (`interchangeability.ts:62-129`) sets no `cjs`, `mcp` or `risutanium_asset_retained`. The *every-key* fixture is therefore hand-assembled, with each key in the shape its own producer writes:
- `name`, `description`, `id`, `namespace`, `hideIcon`, `lowLevelAccess` and `backgroundEmbedding`: shaped as the classic editor stores them;
- `lorebook`, `regex`, `trigger`, `icon` and `customModuleToggle`: as `convertCharacterToModule` copies them;
- `assets`: as the module asset list stores tuples;
- `cjs`: a string;
- `mcp`: as the MCP import sets it (`process/mcp`);
- `risutanium_asset_folders` and `risutanium_asset_retained`: as the Studio asset write stores them;
- one unknown key `x_upstream_future: {nested: [1]}`.

| Id | Scenario | Class | Base and expected failure | File (new or extended) |
|---|---|---|---|---|
| T5-PLAN | `editField(M1, 'customModuleToggle', 'a=A')` lands: one slot replacement, `customModuleToggle` written, one step; undo deletes the key | **R** | `origin/main`: returns `{ok: false, reason: 'gone'}` from the planner (`ownerHistory.svelte.ts:911-913`), so `toEqual({ok: true})` fails | `ownerHistory.moduleText.svelte.test.ts` (the new positive test from the C2 amendment, section 3.2) |
| T5-C2 | Greeting intents on a module stay `gone`; `editField(M1, 'desc')` is `precondition`; nothing written or marked | C (passes before for the greeting half; the `desc` half changes reason by design and is amended on purpose) | none (pinned contract, amended) | same, amended C2 |
| T5-PLAN-S | (a) A preset owner's `editField(…, 'customModuleToggle', 'x')` lands like `editText(…, 'typing')`. (b) **G1b:** a chat owner's `editField(chat, 'desc', <the character's current desc>)` is `{ok: false, reason: 'precondition'}`, with nothing written or marked. (c) A character's `editField` on a chat path is `precondition`. | A (a, b) / C (c passes before) | `origin/main`: (a) returns `gone`; (b) returns `{ok: true, unchanged: true}` (the reader reads the character's `desc`, `studioSetters.ts:172-175, 251-252`). Changes by design (section 3.2). | `ownerHistory.presetText.svelte.test.ts` (a); `ownerHistory.moduleText.svelte.test.ts` or a chat-owner suite (b, c) |
| T5-FZ | The frozen-facts table holds the six rows exactly, appended in order, with `keepForeign` (F-a, F-b, F-c) | **R** | `origin/main`: F-a's `toEqual` fails (the registry lacks the rows) | `fieldRegistry.frozen.test.ts` |
| T5-RB | A hand-written module record JSON holding a `set` op, a label and a restore key for every new path reads back equal | **R** | `origin/main`: `parseOwnerRecord` returns `null` (unknown path), so `toEqual(record)` fails | new `history/tests/historySetPaths.s5.test.ts` |
| T5-RB-OPS | Each op in T5-RB equals the `buildFieldEdit` output over `createModuleLiveReader` | A | absent path (setup) | same |
| T5-KIND-a | A character or chat record holding a new path in a `set` op or a restore key is refused whole | C (passes before: unknown path; after: kind rule) | none | same |
| T5-KIND-b | A character record whose step *label* alone names a new path reads (labels are not kind-checked) | A | `origin/main`: `parseLabel` refuses the unknown path (`historyModel.ts:303-304`) | same |
| T5-WR | A wrong-typed `had: true` value (bool on a text path, string on a bool path) refuses the record whole, while the same record correctly typed reads | **R** | `origin/main`: the correctly typed record is refused too, so "reads" fails | same |
| T5-FOREIGN-RB | A module record holding `{had: 'foreign', value: …}` on each new path (values `1`, `null`, `{x: 1}`, `'yes'` on a bool path, `5` on a text path) in `before`, `after` and a restore key reads back equal. Refused whole: a foreign value on `customModuleToggle` or `desc` (no `keepForeign`), a foreign string on a text path, a foreign boolean on a bool path, and `{had: 'foreign'}` with no `value`. | A | `origin/main`: refused (unknown path) | same |
| T5-PROP | `editField(M1, 'moduleHideIcon', true)` writes `hideIcon`, never a key named after the path; the same for each prefixed path through its intent | A | `origin/main`: refused `gone` by the planner (F1). The property mapping itself is new. | new `history/tests/ownerHistory.s5.svelte.test.ts` |
| T5-ABS | On a create-shaped module, set `namespace`, `hideIcon` and `lowLevelAccess` (with confirm), then undo each: the key is deleted, never `undefined` or `false`. On a module holding `false`, undo restores `false`. | A | `origin/main`: refused `gone` | same |
| T5-REQ (revised) | On the *nameless* fixture, `editText(M, 'moduleName', 'N', 'single')` lands; undo deletes `name` (`'name' in module` is false); redo writes `'N'`. On the *converted* fixture, `moduleDescription` lands and its undo deletes the key. **Positive control:** on a module holding `name: 'A'`, undo restores `'A'`. | A | `origin/main`: refused (unknown path) | same |
| T5-FOREIGN-UNDO | On the *foreign-typed* fixture, for each path: edit to a typed value (the flag through `editField(…, false)`, no confirm), then undo. The stored value is deep-equal to the original (`1`, `null`, `{x: 1}`, `5`, `0`), with `lowLevelAccess` undone through a confirmed replay. Then redo writes the typed value again. For `hideIcon: {x: 1}`: the restored object is not the record's `before.value` (mutating it leaves the record unchanged). Also run the edit-undo pair across a persist and reload of the record (JSON round trip). | **R** | Stage-internal base "5a without E11" (rows with `keepForeign` ignored, readers as today): the edit records `before: {had: false}`, so the undo deletes the key and `toEqual(1)` (and the others) fails on the value | same |
| T5-FOREIGN-SCOPE | A character holding `hideChatIcon: 1`: `editField(char, 'hideChatIcon', false)` records `before: {had: false}` as today, and a character record never holds `had: 'foreign'` | C (passes before and after: `keepForeign` is on the six new rows only) | none | same |
| T5-SLOT | Writes refuse, with nothing written or marked, for a stub slot, two slots sharing the id, and a module that is not the open one | C (the guards exist) | none | same |
| T5-MARK | A landed edit replaces exactly one slot, the save tracker sees modules dirty, and the module ack notes it | A | `origin/main`: refused `gone` | same |
| T5-KEYS (F4) | On the *every-key* module, edit, undo and redo each of the six paths. After each action, every key the path does not own is deep-equal to the original. Each array or object value it does not own keeps its reference (`next.trigger === prev.trigger`, and so on). `x_upstream_future` is carried. | C (passes before for `customModuleToggle` through `editText`; the new paths are reached after E1/E9) | none | same |
| T5-STORE | A store2 encode after a namespace, hideIcon and lowLevelAccess edit writes an index entry with the new values (codec round trip). After an undo to `lowLevelAccess: 1` the entry carries no `lowLevelAccess`, as today for a non-boolean. | C (encoder unchanged) | none | extend the store2 module codec tests |
| T5-OLD | The previous build's parser refuses a record holding `moduleNamespace`, and one holding a foreign value, whole (frozen copy of today's tables or a recorded record), and the set-aside keeps its bytes | C (MC-1827 a, c) | none | extend the `studioHistoryStore` set-aside tests |
| T5-NS | Changing the namespace to a value listed in Module Integration makes the module active (module list and Studio badge). Changing it away removes it. Undo returns it. | A | `origin/main`: refused `gone` | `ownerHistory.s5` plus a `studioModules` test |
| T5-TX | The module counterpart of `T1-TX (b)`: a registered module text path is in `TEXT_FIELD_PATHS` exactly when a module registry target addresses it. `textFieldOf('backgroundEmbedding') === 'backgroundEmbedding'` (path = target). | A | `origin/main`: `textFieldOf` returns `null` | `historyModel.s1TextFields.test.ts` |
| T5-ROUTE-a | Edit `moduleName` (opens the restore point). Then form-edit `backgroundEmbedding`. Then an asset merge renames an asset referenced in it. `listChangedElsewhere(restore, live)` is empty, and two undos restore the visit-start text. | **R** | Stage-internal base "E1 applied, E3 not". The merge's write is a `textSet` that `deriveRestoreWrites` ignores, so `last` stays the edit's text, live ≠ last, and the list holds `backgroundEmbedding`. | extend `ownerHistory.assets.svelte.test.ts` (module merge block) |
| T5-ROUTE-b | Edit `moduleName` (opens the restore point). Then the merge. Then a form edit of `backgroundEmbedding`. The restore point's `before` for `backgroundEmbedding` is the visit-start text, not the post-merge text. | **R** | Same base. The merge teaches nothing, so the edit records `before` = post-merge text, and `toEqual(visitStart)` fails. | same |
| T5-ROUTE-UA | Module Update-All still writes `backgroundEmbedding` as a `textSet` through `writeModuleText` and records no step | C (passes before and after; guards the kept branch) | none | existing `toggleUpdateAll.test.ts:287-288` plus a `toggleUpdateAllDb` module write of the field |
| T5-GUARD-DIRECT | `editField(M1, 'moduleLowLevelAccess', true)` without confirm gives `{ok: false, reason: 'riskyConfirm', paths: ['moduleLowLevelAccess']}`. Slot object unchanged (`toBe`), no mark, no port call, `done`/`undone`/`restore` unchanged (`toBe`). With `{confirmed: ['moduleLowLevelAccess']}` it lands. `editValue` of the path passes the same guard (T5-GUARD-VALUE). Turn-off never needs confirm. | A | absent path | new `history/tests/ownerHistory.s5Confirm.svelte.test.ts` |
| T5-GUARD-UNDO | **Replace-import then undo (MC-3984).** Turn on (confirmed), turn off. Replace-import an incoming module with `lowLevelAccess: false` and a new trigger. `replay(undo)` refuses `riskyConfirm` with `pin: {expectTop}` = the turn-off step's id. Nothing changed (as above). `replay({kind: 'undo', expectTop, confirmed})` lands `true` and moves the step to `undone`. | A | absent path | same |
| T5-GUARD-REDO | Turn on (confirmed), undo (no ask), redo: refused. Confirmed redo lands. | A | absent path | same |
| T5-GUARD-REVERT | Turn on (confirmed), turn off, edit `moduleName`. `revertTo` the turn-on step is refused whole: name and flag unchanged, the record unchanged. Confirmed, it lands both. | A | absent path | same |
| T5-GUARD-RESTORE | A module holding `lowLevelAccess: true` at visit start. Turn off in the visit. `restore(keep ∅)` is refused with nothing changed. `restore(keep ∅, {confirmed})` lands. | A | absent path | same |
| T5-GUARD-FOREIGN | On the *foreign-typed* fixture (`lowLevelAccess: 1`): (a) `editField(…, false)` lands with no confirm; (b) `replay(undo)` refuses `riskyConfirm` and nothing changes; confirmed, it writes `1`. (c) With live `1`, `editField(…, true)` lands without confirm (on→on). (d) A module holding `lowLevelAccess: 0` at visit start, edited to `true` (confirmed), then undone: no ask (on→off). (e) A restore from a live `true` to a recorded `1`: no ask. | **R** for (b) | Stage-internal base "E11 applied, guard predicate of revision 1 (`{had: true, value: true}` only)": the undo writes `{had: 'foreign', value: 1}`, which that predicate passes, so `toEqual` of the `riskyConfirm` refusal fails and the flag reads on. (a, c, d, e): A. | same |
| T5-GUARD-QUIET | None of these refuses `riskyConfirm`. (a) Undo of a turn-on (on→off). (b) A replay that does not touch the path. (c) An `already` replay (the flag set to `true` outside history). (d) **Partial replay (H1, I1).** A module with `name: 'B'` and `lowLevelAccess: false` (a present `false`, not an absent key). Turn on (confirmed), edit `moduleName` to `'A'`, then `revertTo` before the turn-on (on→off, no ask). That stores the step `[moduleName A→B, moduleLowLevelAccess {had: true, true}→{had: true, false}]` (`revertStepOps`). Replace-import an incoming module with `name: 'B'` and no `lowLevelAccess` key (the *replace-imported* producer), so the live flag reads `{had: false}`. Undo the revert step. The name op's precondition (live `'B'`) holds and it applies. The flag op's forward form is `{had: true, false}→{had: true, true}`: its precondition compares the live `{had: false}` with `{had: true, false}` and fails, because absent is not `false` (`fieldValueEquals`, `historyModel.ts:115-120`). It is not at its target either (`holdsResultOf` compares with `{had: true, true}`). With the name applied the replay has `real > 0`, so it lands partly (`:1583-1611, 1676-1693`), with `writes` holding the name only: no ask, `name` is `'A'`, the flag stays absent. The flag must start as `false`: from an absent start the stored revert op ends at `{had: false}`, the undo's op `{had: false}→{had: true, true}` meets its precondition against the absent live flag, applies, and the correct guard asks. (e) **Multi-write revert (H2).** A module with `name: 'A'` and `lowLevelAccess: false`. Turn on (confirmed), edit `moduleName` to `'B'`, turn off, then `revertTo` before the turn-on. Its writes are `[set true, set 'A', set false]` against a live `false`. It lands with no ask; `name` is `'A'` and `lowLevelAccess` is `false`. The name edit keeps the revert from being refused `unchanged`: without it, the flag's net-zero op is dropped from the stored ops (`historyModel.ts:2246`) and the revert is refused before the guard (`:2119-2128`). | C for (a)-(c): none of them asks before or after. A for (d) and (e). | (a)-(c): none. (d), (e): `origin/main` has no such path, so they cannot be set up. | same |
| T5-GUARD-STALE (G4) | **Through the helper.** Call `resolveRiskyRefusal` with the undo's `riskyConfirm` refusal and a held-pending ask. Land a new edit while it is pending. Resolve the ask as yes. The retry, pinned by the refusal's `expectTop`, returns `targetChanged`; the flag is unchanged, the new edit's step is on top of `done`, and nothing else landed. A second test whose attempt ignores the pin undoes the new top. | A | absent path | `history/tests/ownerHistory.s5Confirm.svelte.test.ts` |
| T5-HOST-KEY | `StudioScreen`: Ctrl+Z on the turn-off step opens the risky sheet (`studio-risky-confirm`) with the module title, body and button. Cancel (`studio-risky-confirm-cancel`): no notice, flag off, `done` length unchanged. Again, Turn on (`studio-risky-confirm-ok`): flag on. | A | no sheet | new `lib/Studio/StudioRiskyConfirm.hosts.svelte.test.ts` (jsdom) |
| T5-HOST-PANEL | History panel Undo, Redo and Revert buttons: the same three checks | A | no sheet | same |
| T5-HOST-RESTORE | Restore sheet confirm: the risky sheet opens over it, the restore sheet shows no refusal line, Cancel leaves both values and the restore sheet open, Turn on restores | A | no sheet | same |
| T5-HOST-BACK | Back and Esc close the risky sheet first (as Cancel); a selection change resolves it as Cancel | A | no sheet | same |
| U-2 | A confirmed revert is pinned by `expectIds`: a step that lands while the sheet is open makes Turn on refuse `targetChanged` and the new step stays on top | A | none | same |
| U-4 | The module question sheet has the shared frame (alertdialog, focus trap, scrim-tap cancel) with the module wording and no character consequence line | A | none | same |
| U-6a, U-6b, U-6c | The `riskyConfirm` refusal reads as `studioRefusalConfirmLowLevel` when its `paths` name the module path (pure; Screen notice under a shell; restore-sheet refusal line) and as `studioRefusalRiskyConfirm` otherwise | A | none | `studioToasts.svelte.test.ts`, same |
| T5-RISKY | Form switch: pressing it while off opens the sheet. Cancel leaves the stored flag absent, with no step. Turn on writes it and announces `studioModAdvLowLevelOn`. Turning it off never asks. | A | no switch | new `lib/Studio/StudioModuleAdvancedForm.svelte.test.ts` (jsdom) |
| T5-NSCOMMIT (F7) | Typing in the namespace input writes nothing until blur or Enter. Focus then blur with no typing writes and marks nothing on a create-shaped module and on `namespace: null`. Enter during composition does not commit. Unmount flushes a differing draft. | A | no form | same |
| T5-FORM (G2) | Mount for a loaded module: every control reflects the store. Edit name, description and hideIcon; each write lands. **Then a change that does not come from the DOM:** undo each edit through the history service (and, separately, land a second write through the service, not the DOM). Each control shows the undone or new live value. A refused write restores the control and shows the refusal line. | A | `origin/main`: `studio-detail-readonly` shown, no form | same, plus new `StudioDetail.moduleAdvanced.svelte.test.ts` |
| T5-FOREIGN-FORM (replaces T5-CLASSIC) | On the *nameless*, *converted* and *foreign-typed* fixtures: every control is enabled. `lowLevelAccess: 1` shows the switch **on** with `studioModAdvValueForeign('1')`; pressing it writes `false` with no sheet, and the note goes. `hideIcon: {x: 1}` shows on with the note. `namespace: null` and `name: 5` show empty inputs with the note; typing and committing writes a string. `name` absent and `description` undefined show empty inputs without the note and accept typing. No `studioModAdvValueClassicOnly` key exists. | A | no form | `StudioModuleAdvancedForm` test |
| T5-HTML (F5) | The 배경 HTML kind with an empty embedding mounts `studio-module-html-form`, with no `studioEmptyKind` note and no `studio-detail-text`. Typing writes `backgroundEmbedding` as `typing` steps. The kind gains its item after the first non-blank write and the form stays mounted. On `backgroundEmbedding: 0` the field shows empty with the foreign note, and typing writes a string. | A | `origin/main`: `studioEmptyKind` and the read-only note shown | `StudioDetail.moduleAdvanced` |
| T5-SHARED (G5) | Shared id on both kinds: values shown read-only, `studioRefusalModuleSharedId` shown, no control writable. **Then** replace the shown slot with another module (different id) while a second row still holds the shared id: the view shows no values, never the other holder's. | A | `origin/main`: read-only note only, no values | same |
| T5-STUB | Stub selected: no form, the loading or not-loaded line, the link reads `studioOpenModules` | C (passes before and after) | none | same |
| T5-FOCUS | After undo of each module field, focus lands on its control (`[data-part=<form>] [data-part=<part>]`). Includes an undo that writes back a foreign object value. | A | no element (and `readOwnerFields` returns `null` for modules, E10) | extend `StudioHistoryFocus.svelte.test.ts` |
| T5-FOCUS-RO | `readOwnerFields(moduleOwnerKey)` returns the module's values while its id is published, and `null` when it is not. Two reads of an unchanged foreign object value compare equal (`changedFieldTarget` returns `null`). **H5:** `changedFieldTarget` returns `moduleName`, in both directions, between a foreign `5` and the typed `'5'`, and between a foreign `true` and the typed `'true'`. | A | `origin/main`: always `null` | extend `ts/studio/historyFocus.s1.test.ts` or a new `ownerFields.test.ts` |
| T5-LABEL | The History panel names each new step with its label | A | no step | extend `StudioHistoryPanel.labels.svelte.test.ts` |
| T5-PARTS | The `areaParts` allow-list holds the new form's part lookup, and every rendered name has the `studio-` prefix | C | none | `themePack/areaParts.test.ts` (guard file, see section 7) |
| T5-LOC | `localeParity` passes with the 18 keys in all 8 files | C | none | existing |

**Mutants that must be killed.** Each breaks one new rule, and the named tests must fail.

| Mutant | Must fail |
|---|---|
| The `field` intent keeps the character-target requirement (E9 reverted) | T5-PLAN, T5-PROP, T5-ABS |
| The `field` intent skips the owner-row check (any path reaches the build) (G1b) | T5-PLAN-S (b): the chat owner's `editField desc` at its current value returns `{ok: true, unchanged: true}` |
| Registry row `moduleNamespace` gets `absent: 'keep'` | T5-FZ, T5-ABS |
| Registry row `moduleName` gets `absent: 'keep'` (revision 1's value) | T5-FZ, T5-REQ (the undo leaves `name`) |
| Registry row `moduleName` gets `editWhenAbsent: false` (revision 1's value) | T5-FZ, T5-REQ (the edit is refused) |
| `moduleLowLevelAccess` omits `property` (writes a key named after the path) | T5-PROP |
| A new row's `holders` gains `character` | T5-FZ, T5-KIND-a |
| `buildWrittenModule` writes `false` instead of deleting on `{had: false}` | T5-ABS |
| `buildWrittenModule` builds `next` from a list of known keys instead of a spread | T5-KEYS |
| `readHeld` ignores `keepForeign` (a wrong type reads absent, as today) | T5-FOREIGN-UNDO |
| `readHeld` produces `foreign` on every path (ignores the fact) | T5-FOREIGN-SCOPE |
| `fieldValueEquals` compares foreign values with `===` | T5-FOREIGN-UNDO (`{x: 1}` redo and the JSON round trip), T5-FOCUS-RO |
| The writer assigns the record's foreign value by reference | T5-FOREIGN-UNDO (mutation leaks into the record) |
| The writer deletes on a foreign write (treats it as absent) | T5-FOREIGN-UNDO |
| `parseFieldValue` accepts `foreign` on any path, or with a value of the path's type | T5-FOREIGN-RB |
| `TEXT_FIELD_PATHS` lacks `backgroundEmbedding` (E1 without E3) | T5-ROUTE-a, T5-ROUTE-b, T5-TX |
| The row is `moduleBackgroundEmbedding` with `property: 'backgroundEmbedding'` (revision 0's prefixed path) | T5-TX, T5-FZ |
| `writeModuleText`'s `backgroundEmbedding` branch is removed | T5-ROUTE-UA |
| The confirm guard covers `replay` intents only | T5-GUARD-REVERT, T5-GUARD-RESTORE, T5-GUARD-DIRECT |
| The confirm guard is ignored when `confirm` is absent (always passes) | T5-GUARD-DIRECT, -UNDO, -REDO, -REVERT, -RESTORE |
| The guard's predicate is `{had: true, value: true}` only (revision 1) | T5-GUARD-FOREIGN (b) |
| The guard ignores the live reading (asks on on→on) | T5-GUARD-FOREIGN (c, e) |
| The guard asks when **any** `set` of the flag in `planned.writes` is `engineOn` against an off live reading, instead of the last one (H2) | T5-GUARD-QUIET (e) |
| The guard runs after `land` (the stack moves on a refusal) | T5-GUARD-UNDO (`done`/`undone` unchanged) |
| The guard inspects the replayed step's ops (or their inverses) instead of the planned writes, compared with the live reading (G1a, H1) | T5-GUARD-QUIET (d): the flag op fails its precondition (live absent against a stored `false`) and the plan holds no flag write, but an ops-based guard sees the op's target `true` against the off live reading and asks. The `already` case (c) kills only the live-blind variant, which "the guard ignores the live reading" already names. |
| A host re-runs an undo or a revert without its pin (G4) | T5-GUARD-STALE (through the helper), U-2 |
| A host shows the refusal text on Cancel, or re-runs on Cancel | T5-HOST-KEY, T5-HOST-PANEL, T5-HOST-RESTORE |
| The module refusal shows the generic text, or a character refusal the module text (`refusalTextOf` ignores `paths`) | U-6a, U-6b, U-6c |
| `moduleLowLevelAccess` decided by any write, or a character path by the last write (`RISKY_FLAG_RULE`) | T5-GUARD-QUIET (e), U-1, `riskyFlags.test.ts` |
| The guard skips the `value` intent, or checks the module path only | U-3 |
| The restore sheet closes, or shows its refusal line, on the confirm refusal | T5-HOST-RESTORE |
| The form switch confirms without the sheet | T5-RISKY |
| The namespace commits on blur when the draft equals the shown value | T5-NSCOMMIT |
| The namespace input writes per keystroke | T5-NSCOMMIT |
| The form keeps the mounted module object instead of re-reading by id (G2) | T5-FORM (the undo through the service is not shown) |
| The shared view falls back to a search by id (G5) | T5-SHARED (the other holder's values are shown) |
| The low-level switch reads only `typeof === 'boolean'` (shows off for `1`) | T5-FOREIGN-FORM |
| A foreign value makes the field read-only (revision 1's fallback) | T5-FOREIGN-FORM |
| The mount condition drops `!moduleIdShared` | T5-SHARED |
| The html mount does not suppress `studioEmptyKind` | T5-HTML |
| `readOwnerFields` keeps the open-module-free resolution | T5-FOCUS, T5-FOCUS-RO |
| `readOwnerFields` reports a foreign reading untagged, as its value or its JSON text (H5) | T5-FOCUS-RO (the `5`/`'5'` and `true`/`'true'` cases for the text; the two-reads case for the value) |
| `changedFieldTarget` compares two tagged readings with `!==` (by reference) | T5-FOCUS-RO (the two-reads case) |
| A focus part name mismatches between the registry and the form | T5-FOCUS |

**Gate 2:** opus-reviewer for critical contracts 1-6 (section 3.7). The failure scenarios to name to the reviewer:
- a module record holding a new path or a foreign value is partly read by the previous build;
- an undo leaves `lowLevelAccess: undefined` or `false` where the key was absent;
- an undo does not put back the stored value (absent `name`, `lowLevelAccess: 1`, `namespace: null`, an object), or aliases the record's value into the database;
- a write lands on a stub or on one of two shared-id slots;
- **any route** (direct, undo, redo, revert, restore; after a replace-import too; an undo back to a truthy foreign value) turns the engine reading of `lowLevelAccess` on with no confirm;
- a refused confirm moves the history position;
- a merge step and a form edit on `backgroundEmbedding` replay against each other, or Update-All stops writing it;
- a character, chat or session `editField` changes behaviour beyond section 3.2's table, or a character path starts recording foreign values;
- a Studio write drops a key it does not own.

`pnpm check` and the targeted suites above. No APK is needed for the review. A Note 9 device row for one module edit and one confirmed turn-on (synthetic data) is the build session's call under the approval matrix.

## 7. Engine and code changes, sizes, stages

| # | Change | Files | Size (ESTIMATE) |
|---|---|---|---|
| E1 | Six registry rows + presentation + frozen rows; the `keepForeign` fact and its registry rule; the order and text-path literals amended | `fieldRegistry.ts`; tests `fieldRegistry.frozen.test.ts`, `fieldRegistry.test.ts`, `historySetPaths.test.ts`, `historyModel.w0a.test.ts` | S (~70) |
| E11 | Foreign `FieldValue`: type, `fieldValueEquals`, `parseFieldValue`, `readHeld` (plain-form classification), the module writer branch; the changed sites of the section 3.8 site list (H3) | `historyModel.ts`, `studioSetters.ts` | S-M (~120) |
| E3 | `backgroundEmbedding` joins `TEXT_FIELD_PATHS`; type comment; `writeOpFor` comment | `historyModel.ts`, `toggleUpdateAll.ts`; test `historyModel.s1TextFields.test.ts` | XS (~15) |
| E9 | `field` intent: `editField` needs the live reader only (section 3.2) | `ownerHistory.svelte.ts`; test `ownerHistory.moduleText.svelte.test.ts` (C2 amended) | S (~40) |
| E5 | Confirm guard in `applyStudioWrite` (engine reading, live-aware, per-path rule); one `riskyConfirm` refusal with `paths` and `pin`; `confirmed` on `editField`/`editValue`/`restore`/`ReplayDesc`; per-kind `refusalTextOf`; retry helper `riskyReplay.ts`; host wiring in three callers | `ownerHistory.svelte.ts`, `riskyFlags.ts`, `riskyReplay.ts`, `studioToasts.ts`, `StudioScreen.svelte`, `StudioHistoryPanel.svelte`, `StudioRestoreSheet.svelte` | M (~260) |
| E4 | Risky confirm sheet, question store and its Back layer (unified with the character flags) | `lib/Studio/StudioRiskyConfirm.svelte`, `ts/studio/edit/riskyConfirm.svelte.ts`, `studioBack.svelte.ts` (`registerStudioRiskyBack`); `studioScreen.svelte.ts` holds no risky state | S-M (~170) |
| E10 | `readOwnerFields` resolves a module owner through the open-module id; a foreign reading is reported as a tagged value, and `changedFieldTarget` compares tags by value (H5) | `ts/studio/ownerFields.ts`, `ts/studio/historyFocus.ts` | XS (~30) |
| E2 | Module form (`section` advanced/html): sections, inputs with composition gates, LT fields, switches, notes (including the foreign note), read-only states, refusal line, shared view (slot-only read) | new `lib/Studio/StudioModuleAdvancedForm.svelte`, new `ts/studio/edit/moduleNamespaceNotes.ts` | M (400-550) |
| E6 | Mounts, shared views, and suppression of the read-only note, `studioEmptyKind` and `itemText` for both module kinds | `StudioDetail.svelte` | S (~40) |
| E7 | areaParts allow-list entry for the form's registry part lookup | `themePack/areaParts.test.ts` (**guard file: may need an exact grant**, ownership.md; F12) | XS |
| E8 | 18 keys, 8 files | `src/lang/*.ts` | S |

**Totals (ESTIMATE):**
- Application: 14-15 files changed or added, plus 8 locale files.
- Tests: about 9 new and 12 extended or amended. The new ones: `historySetPaths.s5`, `ownerHistory.s5`, `ownerHistory.s5Confirm`, `lowLevelConfirm`, `StudioModuleAdvancedForm`, `StudioDetail.moduleAdvanced`, `StudioRiskyConfirm.hosts`, `moduleNamespaceNotes`, possibly `ownerFields`. The extended or amended ones: the four literal pins, `s1TextFields`, `moduleText` C2, `presetText`, `ownerHistory.assets`, store2 codec, `studioHistoryStore`, `StudioHistoryFocus`, `StudioHistoryPanel.labels`, `areaParts`.
- About 2,300-3,100 lines including tests (revision 1: 2,000-2,800; E11 and its tests add about 300).

**Stages.** One build PR, staged in the session with one coder per stage (serial, one worktree) and one combined opus Gate 2:
- **5a (engine):** E1, E11, E3, E9, E10, with T5-PLAN, -C2, -PLAN-S, -FZ, -RB, -RB-OPS, -KIND-a/b, -WR, -FOREIGN-RB, -PROP, -ABS (without the low-level case), -REQ, -FOREIGN-UNDO (without the low-level undo), -FOREIGN-SCOPE, -SLOT, -MARK, -KEYS, -STORE, -OLD, -NS, -TX, -ROUTE-a/b, -ROUTE-UA, -FOCUS-RO. Run T5-ROUTE-a/b once on "E1 applied, E3 not", T5-FOREIGN-UNDO once on "5a without E11", and T5-PLAN once on `origin/main`, to demonstrate their R failures.
- **5b (confirm):** E5 and E4, with T5-ABS (low-level case), T5-FOREIGN-UNDO (low-level undo), the T5-GUARD rows, T5-GUARD-STALE and the T5-HOST rows. Run T5-GUARD-FOREIGN (b) once with the revision 1 predicate to demonstrate its R failure. Its en.ts keys land here.
- **5c (forms):** E2, E6, E7, E8, with T5-RISKY, -NSCOMMIT, -FORM, -FOREIGN-FORM, -HTML, -SHARED, -STUB, -FOCUS, -LABEL, -PARTS and -LOC. The translator's 7 locale files land once at the end of 5c, and `localeParity` runs then.

**Coordination:**
- S2 reuses `StudioRiskyConfirm` and the confirm pattern, and since the unification (section 3.5) its character flags pass the same guard: one guard, one refusal code `riskyConfirm`, one confirm vocabulary `confirmed: SetPath[]`, one question store.
- S5 edits the same deriveds in `StudioDetail.svelte` as other stages (a mechanical conflict).
- The registry ordering between S2, S3 and S5 is covered in section 3.1. A later stage that wants foreign values on its own new rows sets `keepForeign` there; S5 adds the fact and the engine support.
- #708 builds the scripts kind and reads the flag for its trigger editor (section 1.3).

## 8. Decided product questions (record)

| Q | Question | Chosen | MC | Consequence |
|---|---|---|---|---|
| Q1 | Does turning a module's low-level access on in Studio ask first? | B: ask on a direct turn-on | MC-3980, **amended by MC-3984** | The original "replays never ask" consequence was wrong. A replace-import keeps the id, so a surviving step could turn the flag on for new triggers (Gate 1 r0 F2). Under MC-3984, every undo, redo, revert or restore that turns it off→on also asks, through the one-path guard of section 3.5. This is not the all-owner replay guard. Revision 2: "on" is the engine's truthy reading, so an undo back to `1` asks too. |
| Q2 | Where does `backgroundEmbedding` get its form? | A: this ticket, in the module's 배경 HTML kind | MC-3981 | One registry row (the bare path), the router entry E3 and the html form. The character's 배경 HTML stays read-only until #708. |
| Q3 | What does Studio say when the namespace changes? | B: inline note | MC-3982 | A note under the field when the **working** Module Integration list holds the old or new value. Undo reverts it. Not noted: other presets' integration texts, and matches through the id lists (`enabledModules`, the chat's, the character's and the persona's modules) (F11). |
| Q4 | Who builds the scripts kind and the character's 배경 HTML kind? | A: a new ticket outside S5 | MC-3983 | Filed as #708. S5 neither edits nor shows triggers. |
| Q5 | Where do the module list operations go? | New ticket | MC-3985 | Filed as #709: create, delete, import, export, convert to character, enable globally. MCP module import is a list operation too and belongs there; #709 does not name it yet (known limitation, section 1.3; Gate 1 r2 H6). The classic module list is their interim route; the stub link `studioOpenModules` is its error-state link (section 1.3). |
| Q6 | Must Studio match classic? | Yes: "studio is planned to replace classic. so studio must be feature complete compared to legacy." | MC-4030 | Revision 1's read-only fallback for absent or wrong-typed values is removed; Studio edits them and undo restores the exact stored state (sections 2.5, 3.8). Every remaining classic link is an interim or error link with its ticket (section 1.3). |
| Q7 | Do app-wide settings classic shows beside a form count? | No: they stay in Settings | MC-4043 | ModuleMenu's only one, `useAdditionalAssetsPreview` (assets tab), stays in Settings. It is not in S5's kinds either. |

## 9. Gate 1 r0 dispositions

| Finding | Disposition | Where |
|---|---|---|
| F1 boolean module edits refused; planner change missing | **ADDRESSED.** Source checked: `ownerHistory.svelte.ts:909-913, 1087, 1434-1435` and the C2 pin `ownerHistory.moduleText.svelte.test.ts:162-178`. E9 (`field` intent, reviewer's simpler mechanism), changed contract 5, deliberate C2 amendment, T5-PLAN as the real R on `origin/main`, T5-PROP reclassified A with the `gone` reason, and two mutants. | §3.2, §3.7, §6, §7 |
| F2 Q1 B consequence misstated; stale history can turn the flag on | **ADDRESSED** by the maintainer's MC-3984 (re-asked). Source checked: `moduleDuplicates.ts:50-66` keeps the id. The one-path guard, every route (undo of a turn-off, redo of a turn-on, revert, restore), host wiring, cancel semantics, the replace-import-then-undo test (T5-GUARD-UNDO) and mutants. | §3.5, §3.6, §6, §8 |
| F3 T5-ROUTE does not kill its mutant; converters omitted | **ADDRESSED.** The bare `backgroundEmbedding` path was chosen, so path = property = target. Every converter is listed with its change. T5-ROUTE is split into (a) edit then merge and (b) merge then edit, each after an opening `moduleName` edit so a restore point exists (`noteRestoreWrites` ignores an asset step without one, `historyModel.ts:2544-2553`), on base "E1 without E3". T5-TX pins path = target. **Further correction found here:** revision 0's `writeModuleText` skip would have broken module Update-All, so the branch is kept and guarded (T5-ROUTE-UA). | §3.1, §3.4, §6 |
| F4 no test for "a write loses fields the form does not own"; fixture sentence false | **ADDRESSED.** Source checked: `interchangeability.ts:62-129` has no `cjs`/`mcp`/`risutanium_asset_retained`. T5-KEYS with an every-key fixture plus an unknown key, the corrected fixture sentence, and the spread mutant. | §6 |
| F5 fold decisions; html kind form unspecified | **ADDRESSED.** "pending" marks and the unchosen branches removed; html form mount, states, `{form, part}` names, LT field, and suppression of `studioEmptyKind` and `itemText` (`StudioDetail.svelte:205-219`). | §2.1, §2.4, §3.1, §5, §8 |
| F6 R classification contradicts the rule; T5-REQ and T5-KIND wrong | **ADDRESSED.** R is kept only for assertion failures (T5-PLAN, -FZ, -RB, -WR, -ROUTE-a/b; revision 2 adds -FOREIGN-UNDO and -GUARD-FOREIGN (b) on stage-internal bases). The rest are A or C. T5-KIND is split into a (C) and b (A). Label A is flagged in section 10. T5-REQ is revised again under MC-4030 (section 9b). | §6 |
| F7 blur commit writes an untouched field | **ADDRESSED.** Commit only when the draft differs, IME Enter ignored, T5-NSCOMMIT extended, mutant added. | §4.1, §6 |
| F8 re-read the module by id; classic/Studio co-mount | **ADDRESSED** (re-read; T5-FORM; mutant; revision 2 strengthens T5-FORM per G2 and fixes the shared view per G5). Co-mount: **UNCERTAIN, inherited limitation**, carried from the module toggle builder and not verified here (section 10). | §2.1, §10 |
| F9 §3.3 route list omits undo of a turn-off | **ADDRESSED.** | §3.6 |
| F10 required keys absent or not strings | Revision 1: read-only with `studioModAdvValueClassicOnly`. **Superseded by MC-4030 in revision 2:** Studio edits these values itself, and undo restores the exact stored state (E11). | §2.5, §3.8, §6 |
| F11 Q3 consequence | **ADDRESSED.** | §4.1, §8 |
| F12 sizing and Gate 2 list | **ADDRESSED.** Re-sized, contract 5 added, the guard file grant noted for E7. | §3.7, §6, §7 |

## 9b. Gate 1 r1 dispositions

| Finding | Disposition | Where |
|---|---|---|
| G1a The "guard before `noWrite`" mutant is equivalent | **ADDRESSED.** Verified: an `already` or dropped replay returns `writes: []` (`historyModel.ts:1648-1660`), and the `noWrite` branch returns before any write (`ownerHistory.svelte.ts:1105-1123`). The row is replaced by the reviewer's killable mutant: "the guard inspects the replayed step's ops (or their inverses) instead of the planned writes", killed by T5-GUARD-QUIET's `already` case. Section 3.5 now says the guard's place relative to `noWrite` is free. **Revision 3 (Gate 1 r2 H1):** the `already` case kills only the live-blind variant. The ops-based variant that compares with the live reading is killed by T5-GUARD-QUIET (d), a partial replay. | §3.5, §6 mutants |
| G1b The "`field` skips the owner-row check" mutant survives on a module; §3.2 table cell | **ADDRESSED.** Verified: a chat owner's reader reads character paths (`studioSetters.ts:172-176`), and `buildFieldEdit` returns `unchanged` for an equal value (`:251-252`). T5-PLAN-S (b), a chat owner's `editField desc` at its current value, is now the killing test. Today it gives `{ok: true, unchanged: true}`; with the row check it gives `precondition`. The §3.2 "Before" cell is corrected. | §3.2, §6 |
| G2 T5-FORM may not kill "the form keeps the mounted object" | **ADDRESSED.** T5-FORM now makes a change that does not come from the DOM after the first write (an undo through the service, and separately a second write through the service) and asserts the control shows the live value. | §6 |
| G3.1 Turn-on refusal not noted in the consequence table | **ADDRESSED.** | §3.2 |
| G3.2 `expectTop` and `cancelled` not on `StudioResult` | **ADDRESSED.** Verified the `ok: false` member at `ownerHistory.svelte.ts:167` lacks both. Both are named in the §3.5 API list. | §3.5 |
| G3.3 No stale check on a re-run revert or restore | **ADDRESSED** as an accepted property, stated in §3.5. | §3.5 |
| G3.4 Cancel refuses the whole action | **ADDRESSED.** Marked **(design default)**. | §3.5 |
| G4 T5-GUARD-STALE must go through the helper | **ADDRESSED.** The row now calls `runWithLowLevelConfirm` with a pending ask, lands an edit, resolves Turn on and asserts `targetChanged` with nothing landed. T5-HOST-KEY is no longer named for that mutant. | §6 |
| G5 The shared view must not search by id | **ADDRESSED.** Verified `moduleRowOf` gives the slot (`StudioDetail.svelte:61-63`). In `readOnlyShared` mode the form reads only that slot and shows nothing when it no longer holds the id. T5-SHARED gains the moved-slot case and a mutant. | §2.1, §6 |

Also changed in revision 2, outside the r1 findings: MC-4030 (sections 1.3, 2.4, 2.5, 3.1, 3.5, 3.8, 5, 6), MC-4043 and MC-3985 (sections 1.1, 1.3, 8). The guard predicate change in section 3.5 follows from E11 and is new for Gate 1 to check.

## 9c. Gate 1 r2 dispositions

Gate 1 r2 was [EDITORIAL] with six findings. Revision 3 changes nothing outside them. No finding is rebutted.

| Finding | Disposition | Where |
|---|---|---|
| H1 The `already` case does not kill the ops-based guard that compares with the live reading | **ADDRESSED.** Verified:<br>- In a replay with `real > 0`, a failed op is counted, its write is not pushed (`historyModel.ts:1583-1611`), and the replay lands (`:1676-1693`).<br>- With `real === 0`, a failure refuses `precondition` (`:1631-1637`), so a single-`set` step cannot produce the case.<br>- A revert step holds one net op per path (`revertStepOps`, `:2219-2249`), so a revert across a turn-on and a name edit is a two-op step.<br>T5-GUARD-QUIET (d) is the killing case: undo of that revert step after a replace-import without the key (a real producer, MC-329, instead of a hand deletion). **Revision 4 (I1):** the case starts from `lowLevelAccess: false`, not from an absent flag; see the I1 row. The mutant row names (d) and says (c) kills only the live-blind variant. The §9b G1a row is updated. | §3.5, §6, §9b |
| H2 Several writes to the flag in one plan; "exactly" does not hold per write | **ADDRESSED** with the reviewer's first option: the predicate reads the last `set` of the flag. Verified:<br>- Writes are not collapsed (`:1977-2048`).<br>- The net-zero filter of writes applies to text and asset targets only, because `targetKeyOf` returns `null` for `set` (`:1786-1802, 2083-2100`).<br>**Correction to the suggested test.** A revert that crosses only a turn-on and a turn-off is refused `unchanged` before the guard runs: its net-zero `set` is dropped from the stored ops (`:2246`), and an empty result refuses (`:2119-2128`). So that test would not kill the any-write mutant. Case (e) adds a name edit between the two. The any-write mutant is added. "Exactly" now holds for the net result. | §3.5, §6 |
| H3 The "`pnpm check` forces every `had` site" claim is false | **ADDRESSED.** The claim is removed and replaced with the site list and its outcomes: 51 lines in 9 files, COMPLETE for the two patterns. The reviewer's table is extended with:<br>- the `fieldValueEquals` callers `:1073, 1175, 2246, 2322`;<br>- `studioSetters.ts:16, 141, 172, 254, 407-411` and `presetTarget.ts:11, 63`;<br>- the matches that belong to other types.<br>The E11 row in §7 points to the list and drops the "possibly `ownerTargets.ts` and the session adapter" files, which the list shows are safe. | §3.8, §7 |
| H4 `readHeld` classifies the raw type but stores the plain form | **ADDRESSED.** It now classifies `toPlainJson(raw)`; verified `normalize.ts:35-66`. The accepted-limitation line is added. No test or mutant is added: no producer of such values is known, and MC-329 rules out a hand-built fixture for this rule. If Gate 2 wants the rule pinned, a D (diagnostic) row with an in-memory `new Boolean(false)` is the candidate. | §3.8 |
| H5 E10's JSON text can collide with a typed string | **ADDRESSED.** Verified that `changedFieldTarget` compares registry paths with `!==` (`historyFocus.ts:64-66`). It is the only non-test place that compares `OwnerFields` values (Grep `OwnerFields`, 2026-11-23). The tag `{foreign: value}` is compared with `sameJsonValue`. It was chosen over a text prefix, because any string can be stored in a text field. T5-FOCUS-RO gains the collision cases, and two mutants are added. E10's files gain `historyFocus.ts`. | §3.6, §6, §7 |
| H6 MCP module import is not named | **ADDRESSED as a named known limitation that points to #709**, per the brief. It is not S5 scope. Verified `ModuleSettings.svelte:254-262` and #709's body (`gh issue view 709`, read only). It is added to the §1.1 list (for consistency with the §1.3 row), the §1.3 row, Q5's consequence and a §10 ask to lane A. | §1.1, §1.3, §8, §10 |
| I1 (Gate 1 r3) T5-GUARD-QUIET (d) cannot produce what it claims | **ADDRESSED.** Reviewer's reasoning verified against source, and the first option taken:<br>- Starting from no flag, the revert step stores the flag op `{had: true, true}→{had: false}` (`revertForward` is `invertOp`, `historyModel.ts:824-827, 1759-1767`; `revertStepOps` keeps first `before` and last `after`, `:2224-2249`). The undo's forward op is `{had: false}→{had: true, true}`, and its precondition is `fieldValueEquals(live, before)` (`:1073`). After a replace-import without the key the live flag is `{had: false}`, so the precondition holds, the op applies, the plan writes `set true` against an off live reading, and the correct guard asks. Case (d) as written failed against the correct implementation and did not kill the ops-based mutant.<br>- `fieldValueEquals` returns `a.had === b.had` when either side is absent (`:115-120`), so absent is distinct from `false` in the op precondition. The spec's foreign rule (E11) adds a third member and keeps that.<br>- Case (d) now starts from `lowLevelAccess: false`. The stored revert op ends at `{had: true, false}`, the undo's forward op is `{had: true, false}→{had: true, true}`, and the live `{had: false}` fails its precondition (`:1073`) and is not at its target (`holdsResultOf`, `:1175`). The name op applies, so `real > 0` and the replay lands partly (`:1583-1611, 1676-1693`) with the name only in `writes`. End state: `name: 'A'`, the flag absent, no ask. The ops-based guard sees the flag op's target `true` against the off live reading and asks, so (d) kills it.<br>- Traced, not executed (spec-only; no pre-fix base exists, DESIGNED, NOT DEMONSTRATED). | §3.5, §6 |

## Premises

| Premise | Status |
|---|---|
| The planner refuses module `editField` `gone` and the C2 pin exists | INHERITED from revision 1 (reopened there; Gate 1 r1 verified) |
| Every replay, revert and restore passes `applyStudioWrite`; the production callers are `StudioScreen`, `StudioHistoryPanel`, `StudioRestoreSheet` and `studioToasts` | INHERITED from revision 1 (Gate 1 r1 verified) |
| `live` is the plan's reader inside `applyStudioWrite`, and the session branch and `noWrite` branch come before the guard's place | REOPENED (`ownerHistory.svelte.ts:1084-1158`) |
| Replace-import keeps the id | INHERITED from revision 1 (Gate 1 r1 inherited) |
| Router and converter behaviour for a bare path; `textOf`/`textBeforeOf` require a string | REOPENED for the string checks (`historyModel.ts:959-1040`); the rest INHERITED (Gate 1 r1 verified) |
| `readHeld` reads a wrong type as absent; `buildFieldEdit`'s absent and unchanged checks; `buildWrittenModule`'s `set` branch | REOPENED (`studioSetters.ts:141-166, 241-263, 576-604`) |
| `FieldValue`, `fieldValueEquals`, `parseFieldValue` and the op parser refuse a malformed value so the record is refused whole | REOPENED (`historyModel.ts:111-120, 267-281, 449-460, 571-599`) |
| Preconditions and restore compare through `fieldValueEquals` | REOPENED (`historyModel.ts:1070-1081, 2315-2331, 2373-2410`) |
| Registry rules (frozen facts, `editWhenAbsent` enforced by the builder) | REOPENED (`fieldRegistry.ts:1-75`) |
| The MC-1827 rule text | REOPENED (`Agents/Maintainer-Context.md` MC-1827) |
| store2 stores modules as plain JSON; `undefined` is absent; `toPlainJson` and `sameJsonValue` exist | REOPENED (`codec/normalize.ts:10-37, 96-99`; `codec/modules.ts:13-60`) |
| The history store's per-owner cap | REOPENED (`studioHistoryStore.ts:17, 25`); the cap's enforcement path not re-read |
| `readOwnerFields` returns `null` for module owners and reads `had ? value : undefined` | REOPENED (`ownerFields.ts:12-24`) |
| ModuleMenu's fields, tabs and its only app-wide setting | REOPENED (`ModuleMenu.svelte:38-48, 223-417`) |
| The classic link destination and the stub label | REOPENED (`classicLinks.svelte.ts:56-61`; `StudioDetail.svelte:104, 196-266`) |
| The engine reads `lowLevelAccess`/`hideIcon` by truthiness and the namespace as a non-empty string | REOPENED (`modules.ts:824, 1002, 1126`; `moduleRefs.ts:42-47`); `triggers.ts` truthiness INHERITED from revision 0 |
| `convertCharacterToModule` copies an optional `creatorNotes`; unvalidated imports can lack `name` | INHERITED from revision 1 (Gate 1 r1 accepted F10's source) |
| Update-All module writes are `textSet` with no history step | INHERITED (Gate 1 r1 verified) |
| Restore point creation and update rules | REOPENED (`historyModel.ts:2525-2564`) |
| `planRevert` pushes one write per applied op; only the stored ops collapse per path; a net-zero `set` is dropped from the stored ops, and a revert with no stored op is refused `unchanged` | REOPENED in revision 3 (`historyModel.ts:1977-2048, 2071-2129, 2219-2249`) |
| A replay with `real > 0` lands partly and leaves a failed op out of `writes`; with `real === 0` a failure refuses `precondition` | REOPENED in revision 3 (`historyModel.ts:1583-1611, 1631-1694`) |
| `toPlainJson` turns a `Date`, a boxed primitive and the non-finite numbers into their JSON forms | REOPENED in revision 3 (`codec/normalize.ts:35-66`) |
| `changedFieldTarget` compares registry paths with `!==`, and is the only comparison of `OwnerFields` values | REOPENED in revision 3 (`historyFocus.ts:50-67`; Grep `OwnerFields`) |
| MCP import is a separate classic list button, and #709's body does not name it | REOPENED in revision 3 (`ModuleSettings.svelte:254-262`; `gh issue view 709`) |
| No producer of non-JSON in-memory module values is known (only `Infinity` might come through a msgpack `.bin`) | INHERITED from Gate 1 r2's trace (not re-read) |
| html kind item and count rules; detail suppression conditions | INHERITED from revision 1 (Gate 1 r1 verified) |
| The MC-1827 set-aside keeps bytes | INHERITED FROM SIZING and S0a/S1 (not re-read) |
| store2 index entry derived again each pass | INHERITED FROM revision 0 (verified by Gate 1 r0) |
| `lowLevelAccess` effect list | INHERITED FROM revision 0 (spot-checked by Gate 1 r0); `ScriptingLowLevelIds` not enumerated |
| `LongTextField` token chip can be turned off for `plain` and `html+cbs` | UNCERTAIN: the build checks it |
| Preview of module text uses the bound character as `{{char}}` | UNCERTAIN: `PreviewSourceInput` was not read for a module owner |
| The `.risum` import decoder passes a foreign-typed field through unchanged (fixture producer) | UNCERTAIN: the decoder was not read; the build names it and checks that the fixture keeps `1`, `null` and `{x: 1}`. If it normalises them, the fixture uses the producer that does not (an older classic-written module through store2 load). |

## 10. Open items for the Orchestrator and lane A

- **Test label A.** Gate 1 r0 F6 asked for new-behaviour acceptance rows that are neither R nor C. gates.md names three labels only. Please confirm the A label, or name the label to use. The rows and their mutants stay as they are.
- **Classic and Studio co-mount (F8).** It is not verified whether the Settings module editor and Studio can be mounted on one module at once. If they can, classic edits made after a Studio write land on a detached object (`ModuleSettings.svelte:187, 281-284`). This is an inherited limitation shared with the toggle builder. A location survey could settle it, but it is not needed for this ticket.
- **E7 guard file.** `themePack/areaParts.test.ts` may need an exact grant for the build's coder (ownership.md).
- **S2 coordination.** `StudioRiskyConfirm` and the question store (`riskyConfirm.svelte.ts`) are built here and shared; the unification with #680 S2 (PR 728, Gate 1 delta verdict `gate1-u2.md`, 2026-11-23) replaced `askStudioRisky`, `runWithLowLevelConfirm` and `lowLevelConfirm.svelte.ts` with that store and the retry helper `riskyReplay.ts`.
- **Session `editField` widening (section 3.2).** This is an engine consequence, not a product choice. It is named so Gate 1 and Gate 2 can object.
- **MC-4030 beyond S5 (for lane A, not this ticket).** The character paths S1/S4 registered with `editWhenAbsent: false` (`firstMessage`, `exampleMessage`, `systemPrompt`, `replaceGlobalNote`, `additionalText`, `personality`, `scenario`, `depth_prompt.prompt`, `fieldRegistry.ts:58-69`) still refuse an absent or wrong-typed value, and every character path still reads a wrong type as absent. Under MC-4030 that is a parity gap against the classic character editor. Their facts are frozen, so a fix needs its own design (for example new paths, or a reader-only change with its own MC-1827 check). Recommended: a follow-up ticket that reuses E11's `keepForeign` support. Not decided here.
- **MCP module import on #709 (Gate 1 r2 H6, for lane A).** Please add "import an MCP module" (`importMCPModule()`, `ModuleSettings.svelte:254-257`) to #709's list of operations, so that classic retirement under MC-4030 does not miss it. S5's scope does not change (section 1.3, known limitation).
- **Classic link retirement.** Removing `studioOpenClassic` from module kinds belongs after #684, #685, #708 and #709 (section 1.3). Lane A may want that written into the classic-retirement plan.
- **Studio importing store2 helpers.** E11 imports `toPlainJson` and `sameJsonValue` from `storage/store2/codec/normalize.ts`. They are pure. If a layering rule forbids Studio importing the codec, the build moves them to a shared pure module instead; behaviour is unchanged.
