# Studio preset prompt template item list (#707)

Status: **spec, revision 2** (2026-11-28). Ticket yor42/RisuTanium#707. Spec only (MC-3902): no application code. The build lands as staged PRs on #707 and only the last stage closes it. This file **extends** [PRESET_ADVANCED_SPEC.md](PRESET_ADVANCED_SPEC.md) (S4, #682) and cites its sections by number for the owner, routing by id, "not set" rules, whole-list history steps (6.5), the check hook (6.3), LT long-text fields and copy conventions. Decisions: MC-3971 (the item list is a ticket of its own), MC-4030 (feature complete against classic), MC-3972 (every preset, active or not), MC-3974 (whole-list `set` steps), MC-3979 (visibility from the preset's own values), MC-4038 (token chips count with the active model). The maintainer's answers of 2026-11-28 are D3 and D4 in section 9; **MC ids for them are assigned by lane A** (this brief names no block).

Marked **(design default)** = chosen inside a decided intent, open to veto. Evidence is source-read on main `4af04dca0`; anchors are dated to that snapshot and re-read at Gate 1.

## 0. Scope

In scope: classic's template editor for a preset whose `promptTemplate` is a list: the item list (`Setting/Pages/PromptSettings.svelte`, `UI/PromptDataItem.svelte`) with add, delete, drag and button reorder, per-type fields, the fixed and exact token totals and the template check warnings; and classic's "Use prompt template" switch (`BotSettings.svelte`, which writes `promptTemplate = []` for a preset that has none; S4 3.8 moved it here).

Out of scope: the other prompt options and the no-template prompt fields (S4), `promptSettings` (S4), the toggle builder (#650), regex (#684), importing ST/other-app presets into templates (classic's import path, #710), and **stopping the use of a template** (D3: classic has no such action; parity only).

## 1. Today (source-read)

| Fact | Anchor (`src/`) |
|---|---|
| `promptTemplate: PromptItem[]` is a `botPreset` key (`orNull(arr)`) and a working `db.promptTemplate`. `setPreset` assigns `normalizePromptTemplate(newPres.promptTemplate)` (an absent or non-array value becomes `null`; no `?? db` fallback), the save writes `normalizePromptTemplate(db.promptTemplate) ?? null`. `normalizePromptTemplate` structured-clones the list and maps item roles (`plain`/`jailbreak`/`cot` `role`: unknown → `system`, `assistant` and `char` map to `bot` per `normalizePromptRole`; `role2` of typed items; `cache.role` → `user`/`assistant`/`system`/`all`). It runs at load, in `setPreset`, in save and on import. | `ts/storage/database.svelte.ts` (about 2327-2600, 2862-2905, 198-200, 528-531) |
| `PromptItem` is a union of six interfaces: `PromptItemPlain` (`type` `plain`/`jailbreak`/`cot`, `type2` `normal`/`globalNote`/`main`, `text`, `role` `user`/`bot`/`system`, optional `name`), `PromptItemChatML` (`chatML`, `text`, `name?`), `PromptItemTyped` (`persona`/`description`/`lorebook`/`postEverything`/`memory`, `innerFormat?`, `role2?`, `name?`), `PromptItemAuthorNote` (`authornote`, `innerFormat?`, `defaultText?`, `role2?`, `name?`), `PromptItemChat` (`chat`, `rangeStart`, `rangeEnd` number or `'end'`, `chatAsOriginalOnSystem?`, `name?`), `PromptItemCache` (`cache`, `name`, `depth`, `role` `user`/`assistant`/`system`/`all`). Items carry no id. | `ts/process/prompt.ts` (about 10-70) |
| Classic edits the **working** list `DBState.db.promptTemplate` in place (`bind:promptItem={DBState.db.promptTemplate[i]}`), so it edits the active preset only. Add pushes `{type:'plain', text:'', role:'system', type2:'normal'}`. Remove splices. Reorder: the item header has move-up and move-down buttons and the list supports drag and drop (the drop handler splices the list and re-maps the open-item set). | `Setting/Pages/PromptSettings.svelte` (about 23-130, 160-262); `UI/PromptDataItem.svelte` |
| Per-type fields: name (every type); type select (`plain`, `jailbreak`, `chat`, `persona`, `description`, `authornote`, `lorebook`, `memory`, `postEverything`, `cache`, `chatML`; `cot` only while `promptSettings.customChainOfThought`); `type2` (special type: `normal`/`main`/`globalNote`), `text` (highlighted textarea) and `role` (`user`/`bot`/`system`) for plain, jailbreak, cot; `text` for chatML; `depth` and `role` (`all`/`user`/`assistant`/`system`) for cache; for chat an "advanced" switch (`rangeStart !== -1000`) revealing `rangeStart`, `rangeEnd` with an "until chat end" switch (`'end'`), and `chatAsOriginalOnSystem` only while `promptSettings.sendChatAsSystem`; `defaultText` (one line) for author note; an inner-format switch and textarea for persona, description, authornote, memory; and `role2` (`user`/`bot`/`system`, default `system`) for those four types. | `UI/PromptDataItem.svelte` (about 247-378) |
| A **type change** rewrites some fields and leaves others: to plain/jailbreak/cot it sets `text = ''` and `role = 'system'`; to cache `depth = 1`, `role = 'all'`; to chat `rangeStart = -1000`, `rangeEnd = 'end'`; for the four typed kinds it defaults `role2` to `system`. Fields of the old type stay on the object. | `UI/PromptDataItem.svelte` (about 253-268) |
| Token totals: `tokenizePreset(items, constant)` sums `tokenizeAccurate` over `text` of plain/jailbreak items and over `innerFormat` of persona, description, authornote, memory; classic shows a fixed count (`consti=true`) and an exact one. | `ts/process/prompt.ts` (about 71-90); `PromptSettings.svelte` (about 40-50, 262) |
| Template check: `templateCheck(db)` reads `db.promptTemplate` and returns English strings (no main prompt, multiple main prompts, no or multiple global notes, no description, no lorebook, no chat entry ending at "until chat end", unconnected chat ranges `[...]`). Classic shows them in a red box above the list, recomputed in an effect. | `ts/process/templates/templateCheck.ts` |
| The template's readers: the prompt builder in `process/index.svelte.ts`; plus `ts/process/stPresetFormats.ts` and `templates/templates.ts` (prebuilt templates and the converters) that create lists. | `ts/process/index.svelte.ts` (re-read at Gate 1; premise P1) |
| The Studio preset form hides main prompt, jailbreak, global note and formatting order when the preset has a template, and shows `studioPresetUsesTemplate` plus a classic button. | S4 3.4, 2 item 5 |
| History values: text, bool, number, text list, bias list (S4 6.5). No kind holds an ordered list of heterogeneous objects. | `history/historyModel.ts`, `history/fieldRegistry.ts` |

## 2. Where it lives, and the data rules

- **A section of the S4 preset advanced form**, not a new kind. S4 section 2 item 5 ("Prompt") becomes: without a template, S4's fields; **with** a template, the new **Prompt template** section (this spec) replaces `studioPresetUsesTemplate`/`studioPresetEditTemplateItems` (the classic button is removed by the stage that ships the list). For a preset with no template the section shows one row: the switch "Use prompt template" (classic's label `usePromptTemplate`), turning it on writes `[]` as one step (D3: no switch back).
- **Every preset, active or not** (MC-3972, S4 4.1): each read and write resolves the preset by id; active to `db.promptTemplate`, inactive to `slot.promptTemplate`. Absent or `null` on an inactive slot reads **no template** (a plain copy, not "keeps": `setPreset` assigns `null`); the form shows the switch row, no note.
- **One new path, one new value kind.** `presetPromptTemplate` (slot `promptTemplate`, db `promptTemplate`, `unset: 'null'`, absent = none). Its kind is `'promptItemList'`: an ordered list of `PromptItem` objects. Rationale: items have no id and no stable path, so per-item registry paths would be position-bound and a move would re-address them; the S4 rule (6.5, MC-3974) is **one `set` op whose `before` and `after` are the whole list**. Reordering, adding, deleting and editing a field are therefore one step each, and `fieldValueEquals` compares lists deeply (item by item, key by key; key order ignored; `rangeEnd` `'end'` vs number distinct). **Rejected:** index-level ops (a new op family through every replay, revert and restore switch for a memory-only owner) and per-item flat paths (positional identity).
- **Memory.** A step holds two whole lists; field typing coalesces by path within `COALESCE_MS` (S4 4.8), so one typing burst is one step. Templates are tens of items and a few thousand characters per item; the session history is memory-only (MC-1758). Stage a measures a 100-item, 2 KB-per-item template over 200 steps and Gate 1 sets the retention cap if the measure is not small (premise P3).
- **Snapshot on read, copy on write** (S4 F6): the reader returns a structural copy; `write` assigns a fresh plain copy and runs `normalizePromptTemplate` on it, so the working list never holds a legacy role the save would rewrite.
- **Not saved by Studio itself.** No Studio-side mark; the slot or `db` mutation is covered by the existing hooks (S4 6.6); stage a pins that a write into a list nested in `db.promptTemplate` and into `slot.promptTemplate` marks the save with the real hook.
- **Compatibility** (MC-175, MC-223, MC-774, MC-350). No new `botPreset` or `Database` key, no migration, no change to the `.bin`/`.rtb` shape. Values written are items of the six existing interfaces, with the roles classic's selects offer (and unknown stored roles left as read, S4 5.2). The preset's other fields are untouched.

## 3. Item model and per-type fields

An item row is a card with a header (type label or the item's name, move up, move down, remove) and, expanded, the fields below. All control labels reuse classic's keys (`language.name`, `type`, `specialType`, `noSpecialType`, `mainPrompt`, `globalNote`, `prompt`, `role`, `user`, `character`, `systemPrompt`, `all`, `depth`, `rangeStart`, `rangeEnd`, `untilChatEnd`, `advanced`, `chatAsOriginalOnSystem`, `defaultPrompt`, `innerFormat`, `customInnerFormat`, `formating.*`, `cachePoint`, `cot`).

| Item type | Fields | Control |
|---|---|---|
| all | `name` (optional text) | single line, composition gate |
| `plain`, `jailbreak`, `cot` | `type2` (`normal`, `main`, `globalNote`), `role` (`user`, `bot`, `system`), `text` | select, select, LT (cbs; chip for plain and jailbreak only, `tokenizePreset` ignores `cot`) |
| `chatML` | `text` | LT (cbs); offered by the type picker as classic's select offers it (`PromptDataItem.svelte` has the `chatML` option); default `text:''` |
| `cache` | `depth` (number), `role` (`all`/`user`/`assistant`/`system`) | number, select |
| `chat` | "advanced" switch; when on `rangeStart`, `rangeEnd` or "until chat end" (`'end'`, shows a disabled `0` as classic), `chatAsOriginalOnSystem` when the preset's own `promptSettings.sendChatAsSystem` | switches, numbers |
| `authornote` | `defaultText`, optional `innerFormat`, `role2` | text, switch + LT, select |
| `persona`, `description`, `memory` | optional `innerFormat`, `role2` | switch + LT, select |
| `lorebook`, `postEverything` | `role2` where classic's `hasPromptBlockRole` offers it (the four typed kinds only; none for these two); default object is `{ type, name? }` only | none |
| unknown stored `type` | read-only card "{type} (unknown)": move and remove only (removal is a normal whole-list step); the object is kept as read | none |

`name` is optional for every type except `cache`, where it is required by `PromptItemCache`: a cache default carries `name:''` and the card's name field never writes `undefined` for it. Defaults per type: plain-like `text:''`, `role:'system'`, `type2:'normal'`; `chatML` `text:''`; cache `name:''`, `depth:1`, `role:'all'`; chat `rangeStart:-1000`, `rangeEnd:'end'`; typed and authornote `role2:'system'`; `lorebook`, `postEverything` bare.

Type availability follows the preset's **own** values (MC-3979): `cot` is offered only while that preset's `promptSettings.customChainOfThought` is on (S4 3.5 latch rule: a stored `cot` item keeps its card whatever the switch says); `chatAsOriginalOnSystem` follows that preset's `sendChatAsSystem`.

**Type change (classic parity, D4 for add).** Changing an existing item's type writes **one** replacement object built from the new type's defaults (plain-like: `text:''`, `role:'system'`, `type2:'normal'`; cache: `depth:1`, `role:'all'`; chat: `rangeStart:-1000`, `rangeEnd:'end'`; typed: `role2:'system'`), keeping `name`. Stale keys of the old type are **dropped** (classic leaves them on the object; they are unread and dropped saves are harmless, but a replacement object keeps the stored shape clean; design default). Because the change is one undoable step, the discarded text comes back with undo.

## 4. Behaviour

### 4.1 Add (D4)

The add button opens a **type picker** (a small sheet or select) listing the types of section 3 that classic's select offers (plain, jailbreak, chat, persona, description, authornote, lorebook, memory, postEverything, cache, chatML, and cot when available). Picking one appends **one** item with that type's defaults (3) as one step and opens its card. Cancelling writes nothing. The default pick, reached with the primary action, is plain, so a user who wants classic's behaviour taps once more.

### 4.2 Remove, move, reorder

- Remove has no confirm (classic has none) and is undoable. Move up and down swap with the neighbour; the first item's up and the last item's down are disabled (S4 5.5 pattern; classic's end-item swap is a no-op, to be confirmed at Gate 1).
- **Drag** (pointer devices; design default): a handle on the card header reorders, using the same data path as the buttons (one step, `splice` of a copy). The touch layout shows buttons only (targets ≥ 44 px); drag is not required to reach any capability.
- A structural operation (add, remove, move, drag, type change) first flushes any pending long-text write of the card it started on, so a write built from an item position can never land on a moved item.
- The **open/collapsed state** is a per-form position set, kept in step with moves and removals as classic does (the set is re-mapped on every move and removal). All cards start collapsed; a new item opens. "Expand all / collapse all" is classic's Ctrl+Alt+O; Studio offers the same through one header button (design default).

### 4.3 Field edits

Add, remove, move, drag and type change pass `coalesceKey: null` so each is a step of its own (two removals within `COALESCE_MS` never merge); only field edits coalesce. Each landed field edit is one `set` of the whole list (3's table), coalesced by path for typing (the path is the list's, so edits to two different items within `COALESCE_MS` form one step: **design default**, no per-item coalescing because items have no ids; this keeps the step label "Prompt template" and the undo granularity at a typing burst). Text uses LT after composition and the pause (S4 1 saving rule); switches, selects and number inputs write at once; numbers are finite and (for ranges and depth) integers; non-finite writes nothing.

### 4.4 Token counts

Totals under the list, as classic: the fixed count and the exact count (`tokenizePreset` with the constant and exact tokenizer settings). They are computed from the preset's own template (inactive presets too), debounced with the LT pause, never cached in a component, and, per MC-4038, count with the active model's tokenizer and name it in the chip. No per-item chip is added (design default). The totals count what `tokenizePreset` counts: `text` of plain and jailbreak items and `innerFormat` of the four typed kinds; `cot`, `chatML` and `defaultText` are not counted. The LT chip on those uncounted fields is suppressed, so no chip shows a number the totals ignore.

### 4.5 Template check warnings

`templateCheck` is split into a pure function over a template array returning warning **codes with parameters** (no main, multiple main, no global note, multiple global notes, no description, no lorebook, no chat reaching the end, unconnected ranges `[...]`), and the existing `templateCheck(db)` mapping the codes to classic's **same English strings** (classic output unchanged, class CG). Studio maps the codes to new `studioPresetTemplateWarn*` keys (all 8 locales, MC-058) and shows them in the same red box above the list, for any preset, recomputed from the live list. Warnings never block a write.

### 4.6 History, restore and focus

S4 4.8 applies to the whole list (one `set` per operation). The restore-point rule captures the list at the first edit and restores it when the live list still equals the last Studio value (a changed list is refused whole, "changed elsewhere"). An item step recorded before the enabling switch was undone is refused `precondition` on undo and redo (the live value is `null`, not equal to its `after`); a restore point meeting a `null` live value is likewise refused whole. The recorded `after` is the normalized value the writer stored. Undo of the enabling switch writes "no template": `null` on both copies (the value `save` and `setPreset` produce), allowed by the check hook (plain copy, not keeps). Focus after undo: the section (`studio-preset-presetPromptTemplate`), never an item card (positions move); the card's open state is not restored by history (design default).

### 4.7 A preset changed while the form is open

MC-3896 applies unchanged (S4 1). A write refused because the preset is gone shows the form's refusal line. A template replaced underneath (an import over the same id, `.rtb` restore, or classic edits on the active preset) is a changed list: Studio's next render reads it fresh (DD-157), and a pending undo is refused `precondition`.

## 5. Engine changes

- **Value kind.** `FieldFacts.value` gains `'promptItemList'`; `FieldValue` carries `readonly PromptItem[]`; `parseFieldValue` accepts it for this path only and validates every item (known `type` with the field types of 3, or an unknown `type` kept as an opaque plain object; `NaN`/`Infinity` refused); `fieldValueEquals` is deep. **Tolerance for classic data:** a known-type item may carry `null` for an optional key (classic writes `innerFormat: null` when the custom inner format switch is off), stale keys of another type (classic's type change leaves them), and a `cache` item with a missing `name`; none of these refuses a write, and they are carried through unrelated edits unchanged. Only a wrong-typed value of a key the type reads (a string `rangeEnd`, a non-finite number, an unknown enum value) is refused. `cloneValue` and `valuesEqual` in `fieldAccess.ts` are changed to deep-copy and deep-compare object lists (today they copy only strings and bias rows and compare objects by reference). `valueMatchesKind` (S4 6.5) names the kind; `textPathsFor` and the editors stay as S4. One helper `promptItemAllowed(item)` is the port's pure check (type, role and enum membership; numeric finiteness), run before the service; undo, redo and restore never check it (S4 6.5).
- **Adapter.** `PRESET_FIELDS` gets the row with `unset:'null'`, `absent: 'notSet'` (reads none), and the normalising writer. The check hook allows `{ had:false }` on the active copy (not a keeps field).
- **`templateCheck` split** (4.5) and **classic untouched** otherwise. The classic item components stay as they are; Studio's cards are new components (`StudioPresetTemplate.svelte`, `StudioPromptItemCard.svelte`), using LT for the long text and Studio's controls. Sharing code with classic is limited to the item default builders (3), extracted to `ts/process/promptItemDefaults.ts` and used by both (classic's type-change defaults unchanged, class CG).
- **Mount.** The S4 form's Prompt section renders the new component for a preset whose effective template is a list, or the switch row otherwise.
- **Registry.** One `FIELD_SPECS` row and one `FIELD_PRESENTATION` row appended after S4's, restore-order pins and the frozen test updated deliberately (S4 6.1). The frozen rule listing allowed kinds gains `'promptItemList'`.

## 6. Changed critical contracts, failure scenarios

Contracts changed: persisted `botPresets` slot writes and the working copy `saveCurrentPreset` serialises (the template is the largest persisted block of a preset); the closed `SetPath` registry and frozen tests; the shared history value type and every owner kind's parser (`'promptItemList'`); dirty-tracking dependencies are not changed but stage a proves them for the nested list. These are critical contracts: **opus-reviewer at Gate 2 of stage a**, and Gate 1 plan review (Tier 2).

| # | Failure scenario | Guard |
|---|---|---|
| T-F1 | An edit of the active preset's template lands on the slot and is lost at the next save; or an inactive preset's lands on `db`. | S4 routing; test T-a2 |
| T-F2 | A history step holds a live proxy of the list; a later edit changes the recorded `before`. | snapshot on read, copy on write; T-a3 |
| T-F3 | A restore, undo or batch writes an item with an invalid shape (a string `rangeEnd`, a missing `type`) and the prompt builder throws at send time. | `parseFieldValue` validates; the port checks on edit; T-a4 |
| T-F4 | Type change leaves stale fields, or the discarded text cannot come back. | replacement object, one step; T-b3 |
| T-F5 | A stored record with a list on a text path or a number path is accepted, or older stored kinds fail to parse. | kind-specific parser, CG on old records; T-a5 |
| T-F6 | A move re-addresses the open-card set wrongly (the wrong card stays open after reorder). | re-map on move and remove; T-c2 |
| T-F7 | Warning codes change classic's strings. | CG: classic output pinned; T-c3 |
| T-F8 | The list's history grows without bound on a long session. | measured retention; T-a6 |
| T-F9 | A write while a preset has no template creates a template silently (an edit before the switch). | only the switch creates `[]`; an item write to an absent template is refused `precondition`; T-a7 |

## 7. Stages and required tests

Each stage is one PR on #707, its own Gate 1 (Tier 2) and Gate 2; only stage c says `Closes #707`. Each adds `en.ts` keys in all 8 locales with `localeParity` in the same PR (MC-058). Fixtures as S4 section 8 (slots by `presetFromWorkingSettings`/`savedPresetFor`, keyless slots by `keylessPreset`, the real `changeToPreset`, `saveCurrentPreset` and `dbChangeEffects`; jsdom component tests; no sanitized markup introduced). Classes RR/CG/DX as S4; all RR are DESIGNED, NOT DEMONSTRATED until the build shows the failure on the pre-stage base.

**Stage a: value kind, list, add, remove, move, text-carrying items, the enabling switch.** Gate 2: **opus-reviewer** (history value type, persisted template writes, parser).

- T-a1 (CG) stored character/chat/module records written by the real commit path before the change parse to the same records after; a `promptItemList` value on a text path, or `set` of the template path under a character key, is refused.
- T-a2 add/remove/move on an inactive preset writes only its slot, the working template unchanged; switching applies it; on the active preset writes `db.promptTemplate` and survives `saveCurrentPreset` and a switch round trip. RR on the S4 base (no path: refused).
- T-a3 recorded `before` unaffected by a later mutation of the live list; undo after an outside mutation refused `precondition`.
- T-a4 an item with a string `rangeEnd`, an unknown role on a plain item, a non-finite `depth` or `NaN` is refused by `parseFieldValue` and the port; an unknown stored `type` is kept through an unrelated edit. Tolerance: an item with `innerFormat: null`, a stale key of another type or a `cache` without `name` is carried unchanged through an edit of a different item (no refusal). Normalizer: a legacy `cache.role`, an absent plain `role` and `role2: null` are accepted by the port and the stored `after` is the normalized value (kills M-a2).
- T-a5 `fieldValueEquals` deep equality (key order ignored, one changed field unequal, an unchanged write records no step).
- T-a6 retention: 200 steps on a 100-item template stay within the measured bound (DX).
- T-a7 an item write on a preset with no template is refused; the enabling switch writes `[]` as one step; its undo writes `null` on the active copy and on a slot.
- T-a8 the add picker appends the picked type with its defaults as one step; cancel writes nothing; `cot` offered only while the preset's own `customChainOfThought` is on, `chatML` offered with `text:''`. A fixture asserts the add, remove and move steps never coalesce within `COALESCE_MS`.
- T-a9 a write into the nested list marks the save with the real hook, on slot and on `db` (dirty-tracking dependency, as S4-T6).
- Mutants (scratch only): M-a1 reader returns the live list (T-a3); M-a2 write skips `normalizePromptTemplate` (T-a4); M-a3 `fieldValueEquals` by reference (T-a5); M-a4 add always appends plain (T-a8); M-a5 routing uses `db` for an inactive preset (T-a2).

**Stage b: the remaining per-type fields and type change.** Gate 2: native Sonnet adversarial reviewer (no new contract; the S4 table and the stage-a reviewed kind).

- T-b1 chat item: advanced switch writes `-1000`/`0` and `'end'` as classic; "until chat end" toggles `'end'` and a number; `chatAsOriginalOnSystem` shown by the preset's own `sendChatAsSystem`.
- T-b2 cache `depth`/`role`, author note `defaultText`, `innerFormat` switch (off writes `null` as classic does, pinned against classic's behaviour and tolerated on read per section 5), `role2` defaults `system` for persona, description, memory and authornote only.
- T-b3 type change builds the replacement object from the defaults, keeps `name`, drops stale keys, is one step, and undo restores the old object including its text (RR vs a build that mutates in place).
- T-b4 visibility by the preset's own model and promptSettings for an inactive preset (S4-T6 pattern).
- T-b5 classic's `PromptDataItem` is unchanged in behaviour after the defaults are extracted (CG, mounted with classic's fixtures; classic's type change still leaves `type2` unset and the test does not assert it).
- Mutants: M-b1 type change keeps stale keys (T-b3); M-b2 `chatAsOriginalOnSystem` shown from `db.promptSettings` (T-b4).

**Stage c: warnings, token totals, drag, open state, expand all; closes #707.** Gate 2: native Sonnet adversarial reviewer.

- T-c1 totals equal `tokenizePreset` of the preset's own template (inactive too); the chip names the model (MC-4038); a fixture with an active and an inactive preset on different tokenizers kills a build that uses the preset's own model.
- T-c2 reorder by buttons and by drag give the same list; the open set follows the moved and removed cards; Ctrl+Alt+O parity through the header button.
- T-c3 `templateCheck(db)` output is byte-identical to the pre-split strings for a fixture set covering each warning (CG); Studio's codes map one-to-one to the new keys; an empty template yields exactly 5 codes (no main, no global note, no description, no lorebook, no chat reaching the end); multiple main and multiple global notes need a fixture with two such items, and the unconnected-ranges code needs a chat-range fixture and carries its range list as a parameter; none for a well-formed one.
- T-c4 warnings recompute on a field edit; a warning never blocks a write.
- T-c5 locale parity for the new keys (all 8).
- Mutants: M-c1 move off-by-one re-map (T-c2); M-c2 a warning code mapped to the wrong key (T-c3).

## 8. Copy

Reused keys: `usePromptTemplate`, `promptTemplate`, `template`, `name`, `type`, `formating.*`, `Chat`, `cachePoint`, `cot`, `specialType`, `noSpecialType`, `mainPrompt`, `globalNote`, `prompt`, `role`, `user`, `character`, `systemPrompt`, `all`, `depth`, `rangeStart`, `rangeEnd`, `untilChatEnd`, `advanced`, `chatAsOriginalOnSystem`, `defaultPrompt`, `innerFormat`, `customInnerFormat`, `add`, `remove`, `chatShellMoveUp`, `chatShellMoveDown`, `fixedTokens`, `exactTokens`, `settingsPage.noFormat`, `settingsPage.warning`. New (all 8 locales in the stage that adds them): `studioPresetTemplateSection`, `studioPresetTemplateAddTitle` (type picker), `studioPresetTemplateExpandAll`, `studioPresetTemplateUnknownType` ("{type} (unknown)"), `studioPresetTemplateWarn*` ×8 (one per warning code), `studioPresetTemplateTokens` (chip with model name). Korean comes from the translator (MC-058).

## 9. Decisions this spec applies

- **Inherited:** MC-3971, MC-4030, MC-3972, MC-3973 and MC-3974 (value kinds, whole-list steps), MC-3975 (staged PRs), MC-3979, MC-4031 (prompt options shown whatever the template), MC-4038, MC-4042 pattern.
- **2026-11-28 answers (ids from lane A):** **D3** the switch is one-way as in classic; Studio adds no "stop using template" (parity only). **D4** "Add item" asks for the type first (a picker), and a plain item is the primary choice.

## 10. Open questions (maintainer)

None at revision 2. Design defaults open to veto: no per-item coalescing of field edits (4.3), no per-item chip (4.4), type change drops stale keys (3), drag only on pointer devices (4.2), focus on the section after undo (4.6).

## 11. Premises

| Premise | Status |
|---|---|
| `setPreset` assigns `normalizePromptTemplate(newPres.promptTemplate)` with no keeps fallback; the save writes `?? null` | REOPENED (`database.svelte.ts`) |
| P1 the prompt builder reads the active `db.promptTemplate` only and the item shapes of section 3 | NOT YET VERIFIED beyond the type definitions: Gate 1 re-reads `process/index.svelte.ts` for any item field the builder reads that the table omits |
| Classic's type change and add behaviour as quoted | REOPENED (`PromptDataItem.svelte`, `PromptSettings.svelte`) |
| `templateCheck` strings and conditions as quoted | REOPENED (`templateCheck.ts`) |
| P3 history retention for a 100-item list | NOT YET MEASURED (stage a, T-a6) |
| `chatML` is offered by classic's type select (`PromptDataItem.svelte`) | CONFIRMED at Gate 2 |
