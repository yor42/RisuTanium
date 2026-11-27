# Studio preset provider-specific blocks (#706)

Status: **spec, revision 3** (2026-11-28). Ticket yor42/RisuTanium#706. Spec only (MC-3902): no application code. The build lands as staged PRs on #706 and only the last stage closes it. This file **extends** [PRESET_ADVANCED_SPEC.md](PRESET_ADVANCED_SPEC.md) (S4, #682) and does not repeat it: owner, routing by id, "not set" rules, the number and list value kinds, the check hook, the container rules and the copy conventions are S4's sections 1, 4, 5 and 6 and are cited by number. Decisions: MC-3970 and MC-4041 (provider blocks get their own ticket), MC-4030 (Studio is feature complete against classic), MC-3972 (every preset, active or not), MC-3979 (visibility from the preset's own model), MC-3976 (connection fields never shown), MC-4043 (app-wide switches stay in Settings). The maintainer's answers of 2026-11-28 are D1 and D2 (MC-4720, MC-4721) and the off-encoding answer D3 (MC-4729) in section 10. **Separate parameters (stage f) have their own file,** [PRESET_SEPARATE_PARAMS_SPEC.md](PRESET_SEPARATE_PARAMS_SPEC.md), still stage f of #706; this file covers stages a to e and the rules every block shares.

Marked **(design default)** = chosen inside a decided intent, open to veto. Evidence is source-read on main `4af04dca0` and re-read at Gate 2 round 3 and by the advisor; `file:line` anchors are dated to that snapshot and must be re-read at Gate 1.

## 0. Scope

In scope (S4 section 3.8, ticket body, D1, D2):

| Block | Slot keys | Classic editor |
|---|---|---|
| Ooba instruct/chat parameters (sampling sliders, flags) | `ooba` | `BotSettings.svelte` (the `textgen_webui`/`mancer`/`local_*`/`hf:::*` branch) |
| Ooba request args (about 35 optional keys, mode-dependent prefixes) | `reverseProxyOobaArgs` | `OobaSettings.svelte` |
| NovelAI sampling, starter/separator, adventure, append name | `NAISettings`, `NAIadventure`, `NAIappendName` | `BotSettings.svelte` (`LLMFormat.NovelAI` branch, `NAIadventure` row) |
| NovelList sampling (D1) | `ainconfig` | `BotSettings.svelte` (`LLMFormat.NovelList` branch) |
| AI Horde / Kobold chat format, instruct and Jinja templates | `instructChatTemplate`, `JinjaTemplate` | `ChatFormatSettings.svelte` via `chatFormatSettingsData.ts` |
| OpenRouter provider routing and request model | `openrouterProvider` (`order`, `only`, `ignore`), `openrouterRequestModel` | `OpenrouterSettings.svelte`, `BotSettings.svelte` (`ModelGrid`) |
| Reverse proxy request model and API format | `customProxyRequestModel`, `customAPIFormat` | `BotSettings.svelte` (the `reverse_proxy` branch). `proxyRequestModel` has **no classic editor** (the branch's "Request Model" row binds `customProxyRequestModel`); it is read by `requests.ts` and kept by routing, and Studio does not surface it (parity, MC-4030) |
| Custom flags | `enableCustomFlags`, `customFlags` | `BotSettings.svelte` (the "Custom Flags" accordion) |
| Separate parameters (D2) | **stage f, [its own spec](PRESET_SEPARATE_PARAMS_SPEC.md)** | `SeparateParametersSection.svelte`, `Others/AllSeperateParameters.svelte` |

Out of scope: connection and endpoint fields (MC-3976: URLs, keys, `proxyConnectionId`, `forceReplaceUrl*`, `textgenWebUI*URL`, `koboldURL`, `currentPluginProvider`), app-wide switches classic shows beside these blocks (`reverseProxyOobaMode`, `openrouterFallback`, `openrouterMiddleOut`, `disableSeperateParameterChangeOnPresetChange`, `additionalParams`, `useStreaming`, Horde and Vertex settings; these are top-level `Database` fields `setPreset` never copies, `drive/rtb/settingsFields.ts` global list; MC-4043), `useInstructPrompt` (already S4a, S4 section 3.7), the prompt template list (#707), the preset list (#710). `apiType` has no classic editor and no reader outside storage and `setPreset` (grep, non-test `src`; premise P2): it is shown with S4's note `studioPresetNotUsed` (design default, as MC-4033).

## 1. Today (source-read)

| Fact | Anchor (`src/`) |
|---|---|
| Classic edits the **working** copy `db.*` (`DBState.db.ooba`, `.NAIsettings`, `.ainconfig`, `.reverseProxyOobaArgs`, `.openrouterProvider`, `.seperateParameters`, `.customFlags`), so it edits the active preset only. The slot name differs for `NAISettings` (db `NAIsettings`). | `Setting/Pages/BotSettings.svelte`, `OobaSettings.svelte`, `OpenrouterSettings.svelte`, `SeparateParametersSection.svelte`; `drive/rtb/settingsFields.ts` `PRESET_DB_ALIASES` |
| `setPreset` absent rules: `ooba`, `ainconfig`, `NAISettings`, `instructChatTemplate`, `JinjaTemplate`, `openrouterRequestModel`, `proxyRequestModel`, `apiType` keep the working value (`?? db.x`); `reverseProxyOobaArgs` absent reads `{mode:'instruct'}`; `customProxyRequestModel` `''`; `customAPIFormat` OpenAI-compatible; `customFlags` `[]`; `enableCustomFlags` and `seperateParametersEnabled` false; `NAIadventure`, `NAIappendName` plain copy (absent = off); `openrouterProvider` assigned as is (absent = undefined, not a default); `NAISettings.cfg_scale`, `mirostat_tau`, `mirostat_lr` get 1, 0, 1 when missing; `seperateParameters` absent becomes four empty objects, unless the global switch `disableSeperateParameterChangeOnPresetChange` keeps the working one. | `ts/storage/database.svelte.ts` `setPreset` (about 2477-2600) |
| Load-time normalisation: a string `openrouterProvider` (old format) becomes `{order:[x], only:[], ignore:[]}`; `seperateParameters.overrides` defaults `{}`; `setPreset` seeds `memory`, `emotion`, `translate`, `otherAx` and `overrides` (five empty objects). | `database.svelte.ts` (about 528-548, 613-620) |
| The model's `format` and `provider` decide which block classic shows; Ooba args show on `aiModel === 'ooba'` or (`reverse_proxy` with the global Ooba switch); OpenRouter shows when `aiModel` starts with `openrouter`; Horde/Kobold chat format when `aiModel` starts with `horde` or is `kobold`; the reverse-proxy rows when `aiModel` or `subModel` is `reverse_proxy`. Custom flags have no model condition. | `BotSettings.svelte` (about 225-260, 455-520, 566-640, 745-780) |
| `OptionalInput` rows (Ooba args) edit one key that may be absent: absent means "do not send". | `Setting/Pages/OobaSettings.svelte`, `UI/GUI/OptionalInput.svelte` |
| History values are text, bool, number, text list and bias list (S4 6.5). There is no object-valued kind and no number-list kind (`customFlags` is `LLMFlags[]`, numeric enum values). | `history/historyModel.ts`, `history/fieldRegistry.ts` |

## 2. Where it lives, and the data rules

- **One owner, one kind, one form.** The blocks are fields of the S4 `preset:<id>` / `advanced` form: a new section group **Provider settings** inside `StudioPresetAdvancedForm`, after Fallback and before Other (S4 section 2 order, becoming 1..8 plus this group). The classic link row `studioPresetProviderClassic` (S4 section 2 item 3) is **removed** by the first stage that ships any block and re-worded by each stage until the last removes it; after the last stage no provider classic link remains.
- **Not in this spec:** the Ooba parameters block also holds `localStopStrings` (S4's field) and the "Use name" check (`ooba.formating.useName`, which is in 3.4); stage c's classic-link removal covers the block only because S4 already has `localStopStrings`.
- **Routing, absent and "not set" rules are S4's** (4.1 to 4.3, 4.8): active preset to `db.<prop>`, inactive to the slot, containers created from a fresh seed on first write, never deleted, `{ had: false }` refused on the active copy of a "keeps" field by the check hook.
- **The one rule for every block (replaces per-row prose).** For each block a shared data module is the **only** source of its row set, order, control kind, option list, range, step, `fixed`, **visibility predicate**, off encoding and default-on value. Classic renders from the module (an extraction, class CG) and Studio's registry rows and `FIELD_PRESENTATION` rows are **generated from the same module**; this document does not restate them, because three review rounds showed any hand-written copy of classic's per-row facts drifts. `studio/edit/presetParams.ts` (S4) already does this with `allBasicParameterItems` and `item.condition(ctx)`; this spec extends the same principle from ranges to conditions, control kinds, encodings and clamps. Each stage's Gate 1 attacks the module, not a table in this file. The module exists today only for chat format (`setting/chatFormatSettingsData.ts`); each stage extracts its own.
- **Predicate context** (pinned by hand, MC-3979): a preset's predicates are evaluated on a context built from **the edited preset's own** `aiModel`, `subModel`, `modelInfo`, `useInstructPrompt`, `reverseProxyOobaArgs.mode`, `promptSettings` and, for a purpose, its own `seperateModels`; never `db.aiModel`. A **global** input (`reverseProxyOobaMode`) is read from `db`. An inactive preset reads its slot value, falling back exactly as `setPreset` would (`?? db.x` for the keeps fields). The matrix axes each stage's tests cover: model class (`ooba`; `reverse_proxy` with the global Ooba switch on and off; `textgen_webui`/`mancer`/`local_*`/`hf:::*`; NovelAI; NovelList; `horde*`/`kobold`; `openrouter`, as main and as sub), Ooba mode (`instruct`, `chat`, `chat-instruct`), `useInstructPrompt`, and template `jinja` or not.
- **A stored key with no table row is never shown or written and survives every edit** (no-editor rule). Gate 1 of each stage computes (keys of the slot's type) minus (module keys) and acknowledges the remainder in an allowlist: at preset level `proxyRequestModel` (no classic editor; the reverse-proxy "Request Model" row binds `customProxyRequestModel`; `requests.ts` reads it) and `apiType` (shown with S4's note `studioPresetNotUsed`).
- **Hidden never means deleted** (S4 4.4): a stored value of a hidden group stays and is not touched by a model change.
- **Connections.** The form still neither reads nor writes any URL or key. The reverse-proxy rows end with S4's existing `ConnectionsLink` row.
- **Compatibility** (MC-175, MC-223, MC-774, MC-350). No new `botPreset` key, no new `Database` key, no migration, no change to the `.bin` shape: every value written has the type the slot already holds. An optional key is off when it is absent, `null` or `-1000` (D3); the encodings are per control kind (4.2). Classic-written `null` and `-1000` are read as off, never as an out-of-range "on", and a write never stores `undefined`.

## 3. Field inventory

Columns as S4 section 3: **Path**, **Slot / db**, **Type**, **Absent on slot**, **Shown**, **St** (stage, section 7). Per the one rule of section 2, **Shown** is the block module's predicate and the per-leaf rows of Ooba, NovelAI and NovelList are **all rows of the block's module**, generated; only the path naming scheme, the slot and the absent rule are pinned here.

### 3.1 Chat format (Horde, Kobold, Ooba instruct, OpenRouter instruct)

| Path | Slot / db | Type | Absent | Shown | St |
|---|---|---|---|---|---|
| `presetInstructChatTemplate` | `instructChatTemplate` | enum (`chatml`, `llama3`, `gpt2`, `gemma`, `mistral`, `llama2`, `vicuna`, `alpaca`, `jinja`) | keeps | module predicate; the pair is rendered once per form (4.3) | a |
| `presetJinjaTemplate` | `JinjaTemplate` | text (LT plain mono) | keeps | module predicate (template is `jinja`) | a |

### 3.2 Reverse proxy

| Path | Slot / db | Type | Absent | Shown | St |
|---|---|---|---|---|---|
| `presetCustomProxyRequestModel` | `customProxyRequestModel` | text | `''` | module predicate | a |
| `presetCustomApiFormat` | `customAPIFormat` | number enum (`LLMFormat` values classic offers) | OpenAI-compatible | module predicate | a |
| `presetApiType` | `apiType` | text | keeps | always, `studioPresetNotUsed` (no-editor allowlist, section 2) | a |

### 3.3 OpenRouter

| Path | Slot / db | Type | Absent | Shown | St |
|---|---|---|---|---|---|
| `presetOpenrouterRequestModel` | `openrouterRequestModel` | text (model id; the picker is classic's `ModelGrid` reused unchanged) | keeps | module predicate (own condition, not the provider-list one) | b |
| `presetOpenrouterOrder`, `presetOpenrouterOnly`, `presetOpenrouterIgnore` | `openrouterProvider.{order,only,ignore}` | text list (provider ids from `getOpenRouterProviders()`, picker `OpenrouterProviderList` reused) | container seed `{order:[],only:[],ignore:[]}`; an absent container reads the seed (the slot value is assigned as is by `setPreset`; a later request reads it with `?.`, see P3) | module predicate | b |

### 3.4 Ooba, NovelAI, NovelList

| Path | Slot / db | Type | Absent | Shown | St |
|---|---|---|---|---|---|
| `presetOoba<Key>` for **each row of the Ooba parameters module** (sliders, flags, and `formating.useName` as a nested `subContainer` key) | `ooba.<key>` | number / bool (container) | keeps (the whole `ooba` object is copied from the db when the slot lacks it) | module predicate; the chat-format pair and `useName` are embedded there as in classic | c |
| `presetOobaArgsMode` | `reverseProxyOobaArgs.mode` | enum `instruct`/`chat`/`chat-instruct` | seed `mode:'instruct'` | module predicate (reverse proxy with the Ooba switch; never for `aiModel==='ooba'`, where classic hides the select and the nine mode rows) | c |
| `presetOobaArg<Key>` for **each row of the Ooba args module** (text, number and bool optional keys) | `reverseProxyOobaArgs.<key>` | text / number / bool, **optional** | off = absent, `null` (classic's write) or empty (D3, 4.2) | module predicate, mode rows by `mode` | c |
| `presetNai<Key>` for **each row of the NovelAI module** (text and number) | `NAISettings.<key>` / db `NAIsettings.<key>` | text / number (container) | keeps; `cfg_scale`, `mirostat_tau`, `mirostat_lr` read 1, 0, 1 (keeps, 4.2) | module predicate | d |
| `presetNaiAdventure`, `presetNaiAppendName` | `NAIadventure`, `NAIappendName` | bool | not set = off (plain copy) | module predicate (main or sub provider is NovelAI) | d |
| `presetAin<Key>` for **each row of the NovelList module** | `ainconfig.<key>` | number (container) | keeps | module predicate (D1) | d |

Optional-key rows are an "enabled" switch plus the value control (4.2).

### 3.5 Custom flags

| Path | Slot / db | Type | Absent | Shown | St |
|---|---|---|---|---|---|
| `presetEnableCustomFlags` | `enableCustomFlags` | bool | false | module predicate | e |
| `presetCustomFlags` | `customFlags` | number list (`LLMFlags` values; one toggle button per flag classic renders; unknown stored values kept) | `[]` | module predicate (while enabled; classic has no model condition) | e |

### 3.6 Separate parameters (D2)

Moved to [PRESET_SEPARATE_PARAMS_SPEC.md](PRESET_SEPARATE_PARAMS_SPEC.md) (stage f). It inherits sections 2 and 4 of this file.

## 4. Behaviour

Everything of S4 section 4 applies. Additions:

### 4.1 Value kinds needed

No new history value kind beyond **one**: `'numberList'` (`readonly number[]`) for `customFlags`, added in the stage that needs it (e), as S4 6.5 added `'textList'`; element validation is the adapter's (every element finite). All other rows are text, bool or number leaf paths of a plain object, addressed by flat paths with the container rule of S4 6.4. **Design default (the Gate 1 decision to attack):** one registry path per leaf, generated from the block tables, rather than an object-valued kind that sets a whole `ooba` or `reverseProxyOobaArgs` object per edit. Reasons: per-field history labels and focus after undo (S4 6.1), per-key coalescing, and no whole-object precondition refusal when two edits touch different keys. Cost: about 150 registry rows and frozen-test rows, mostly generated; the table is data, one row builder per block. **Rejected:** a `record` kind (one set per object): a single undo would revert unrelated keys typed in the same second, and refusal on any change of any key in the object makes undo brittle.

### 4.2 Optional-key editing and the off encoding (D3, MC-4729)

The encoding is per **control kind**, defined once and used by every module:

| Control kind | Read as off | Off gesture writes | On gesture writes |
|---|---|---|---|
| `OptionalInput` (Ooba args) | absent or `null` | `null` (classic's write; Gate 1 of stage c pins the nullable parse on the path facts, and falls back to the key's deletion only after a maintainer ask) | `0` (number), `false` (bool), `''` (text), as classic |
| disableable slider (`SliderInput` `disableable`; used only by the separate-parameters editor, so stages a to e carry no such row, and Studio also reads `null` as off, a named deviation: classic's slider treats only `-1000` and absent as off) | absent, `null` or `-1000` | `-1000` | the slider's `min`, as classic |
| segmented select or enum with no off state | none: absent reads as the request's own default | n/a | the picked value |

Undo restores the exact prior state including absent (the recorded `before` is `{ had:false }` for an absent key, so undo of the first write deletes the leaf and never writes `undefined`). A write never stores `undefined`. **Keeps** leaves (S4 4.2: `cfg_scale`, `mirostat_tau`, `mirostat_lr`, the `ooba` and `ainconfig` numbers) are never deleted by the editor; their undo to the absent state on an active copy is refused by the check hook, so the editor writes the default instead (`{ had:true }`). Absent a "request default", the on/off display is computed from the stored value, so a classic-written `-1000` or `null` shows as off, never as an "on" slider at an out-of-range value. Because `setPreset` clones `ooba`, `ainconfig`, `reverseProxyOobaArgs`, `customFlags` and `seperateParameters`, an absent or sentinel key stays so on a switch; `NAISettings` and `openrouterProvider` are assigned by reference (section 5).

### 4.3 Chat format coupling

`instructChatTemplate`/`JinjaTemplate` are one pair of paths that three classic places render (Ooba parameters, Ooba args in instruct mode, OpenRouter with `useInstructPrompt`, and the Horde/Kobold block). Studio renders the pair **once per form**, in the Provider settings group, shown when any of those places would show it for the preset's own model; it is one editor per value (S4 2).

### 4.4 OpenRouter provider lists

Add, remove and move per row as S4 5.4 lists; the options come from `getOpenRouterProviders()` (a network call classic already makes; no new request; the loading state of classic is kept). A stored provider id not in the options is kept and shown as "{value} (unknown)" (S4 5.2).

### 4.5 Effects, clamps and named deviations from classic

Classic's page-mounted effects that react to model changes (premise P5) are not carried: a model change in Studio writes only `aiModel` (S4 4.4) and no view ever writes. The two effects that clamp separate-parameter values (`AllSeperateParameters` `reasoning_effort`, `ClaudeThinkingSeparateParams` `adaptive_thinking_effort`) are handled in the separate-parameters spec. Where a clamp is needed, it is **one shared pure function** that classic's effect calls too; Studio applies it **to the value being written or imported, never on view**, and that difference is a named deviation.

**Named deviations from classic (each deliberate):** the chat-format pair is shown once per form (4.3); visibility reads the preset's own model, not `db`; no write happens on view; separate-parameter import and export are new; hidden values are never rewritten.

## 5. Engine changes

- **Registry.** Rows appended per stage after the S4 rows (S4 6.1 rules: `holders: []`, `editWhenAbsent: true`, `FIELD_PRESENTATION` labels, restore-order pins and frozen-test rows updated deliberately). `SESSION_OWNER_KINDS.preset.setPaths` gains the new paths.
- **Adapter.** `PRESET_FIELDS` (S4 6.2) gains rows with `container`/`key` (a nested key such as `ooba.formating.useName` adds a `subContainer`), and `absent`/`unset` rules per section 3. Containers: `ooba` (absent reads as the working value for a **keeps** read; a write to an absent slot `ooba` first copies the **whole effective** object, because `setPreset` copies the container whole and a partial slot object would drop the unedited keys on switch; this differs from S4's fresh-seed rule and is the main new routing rule, test P-c2), `NAISettings` and `ainconfig` the same, `reverseProxyOobaArgs` seed `{mode:'instruct'}`, `openrouterProvider` seed `{order:[],only:[],ignore:[]}`, `seperateParameters` seed the five empty objects (`memory`, `emotion`, `translate`, `otherAx`, `overrides`). A write to an absent slot `NAISettings` copies a **clone** of the effective object (`setPreset` assigns `NAISettings` and `openrouterProvider` by reference, so the working copy aliases the slot after a switch; the first-write copy must not alias it, test P-d4 asserts non-identity). The copy pins the working value: undo of the first leaf edit deletes only the leaf and the pinned container stays (S4 4.1), so a later change to the working value no longer carries to that preset on a switch; Studio discloses this on the first edit of an absent container. Default-read NAI leaves (`cfg_scale`, `mirostat_tau`, `mirostat_lr`, read 1, 0, 1 when absent) are **keeps**: their undo to the absent state on an active copy is refused by the hook, so the editor writes the default instead of a delete (`{had:true}`) for them. Every other optional leaf (Ooba args, separate parameters) is not-set=off and may delete.
- **Check hook** (S4 6.3): `{ had:false }` onto the active copy of a keeps field stays refused; for the optional-key leaves the delete is allowed.
- **Shared block modules.** One data module per block (Ooba parameters, Ooba args, NAI, ainconfig, OpenRouter, reverse proxy, custom flags, chat format; separate parameters in their own spec), holding row set, order, control kind, options, range, step, `fixed`, predicate, off encoding and default-on value. Classic renders from them (class CG); Studio's registry and presentation rows are generated from them.
- **Dirty tracking.** No Studio-side mark. A write into an object nested in a slot or in `db.<container>` is a mutation inside `db.botPresets` or a top-level key the generic loop deep-snapshots (S4 6.6); stage c pins this with the real hook for a nested key (`ooba.formating.useName`), because the loop's deep snapshot is the dependency.
- **Mount.** `StudioPresetAdvancedForm` gains one section component per block family (a to f), mounted under the Provider settings group.

## 6. Changed critical contracts, compatibility, failure scenarios

Contracts changed: persisted `botPresets` slot writes and the working copies `saveCurrentPreset` serialises (every stage); the closed `SetPath` registry and frozen tests (every stage); the shared history value type (stage e, `'numberList'`); dirty-tracking dependencies are not changed but stage c proves them for nested keys (and stage f).

| # | Failure scenario | Guard |
|---|---|---|
| P-F1 | An edit of one key of an **absent** slot `ooba`/`NAISettings`/`ainconfig` creates a one-key object; the next switch copies it whole and every other key is lost (the working value is replaced by a partial object). | copy-whole-effective-object rule (section 5); test P-c2 |
| P-F2 | The active preset's block edit lands on its slot and is overwritten by `saveCurrentPreset`; or an inactive preset's lands on `db.*`. | S4 routing; per-block tests |
| P-F3 | A classic-written `null` or `-1000` is read as an "on" value, or an undo writes `undefined`; the stored shape drifts from classic's. (Ooba args: the request skips `undefined` and `null` in `requests.ts`; disableable sliders: `shared.ts` skips `-1000`; so this is a display and format defect, not a wire one.) | per-control-kind encoding (4.2); test P-c4 |
| P-F4 | A visibility rule evaluated against `db.aiModel` for an inactive preset hides or shows the wrong block. | preset's own model; test per block (S4 T6 pattern) |
| P-F5 | Separate parameters edited while `disableSeperateParameterChangeOnPresetChange` is on are lost or overwrite the working ones on a switch. | note and test P-f3 (disclosed, not prevented, as MC-4047) |
| P-F6 | `numberList` widening makes an older stored record unreadable or accepts a string. | kind-specific parser; test P-e1 (as S4 F7) |
| P-F7 | A module's row set, predicate or encoding diverges from what classic shows (the recurring review defect). | single shared module; extraction guard and closure test per stage (section 7) |
| P-F8 | The module extraction changes classic's range, step or visible row set. | extraction guard recorded from the pre-extraction base; test P-a0 and per stage |

Compatibility is stated in section 2 (no format change, no migration, nothing new in `.bin`/`.rtb`).

## 7. Stages (MC-3975 pattern) and required tests

Each stage is one PR on #706, its own Gate 1 (Tier 2) and Gate 2; only the last (f) says `Closes #706`. Each adds its `en.ts` keys in all 8 locales and passes `localeParity` in the same PR (MC-058). Fixtures as S4 section 8. Classes RR/CG/DX as S4.

| Stage | Scope | Gate 2 |
|---|---|---|
| a | Provider group shell, chat format pair (3.1), reverse proxy rows (3.2), `apiType`; remove the classic link row for what moved; note re-wording | native Sonnet adversarial reviewer (text/enum leaves through the S4 table; no new contract) |
| b | OpenRouter (3.3): request model picker, provider lists | native Sonnet adversarial reviewer |
| c | Ooba parameters and Ooba args (3.4 first rows), nested container, optional keys, whole-effective-object rule, shared block tables | **opus-reviewer** (container rule for persisted slot writes, nested dirty tracking) |
| d | NovelAI, NovelList (3.4) | native Sonnet adversarial reviewer (same container rule, reviewed in c) |
| e | Custom flags (3.5), `'numberList'` kind | **opus-reviewer** (shared history value type) |
| f | Separate parameters, import/export, note; removes the last classic link; closes #706. **Own spec** [PRESET_SEPARATE_PARAMS_SPEC.md](PRESET_SEPARATE_PARAMS_SPEC.md) | **opus-reviewer** |

Two tests are required **per stage in place of prose parity**, over the matrix axes of section 2:

- **Extraction guard** (CG): the classic component's rendered rows over the context matrix are identical before and after the extraction; the expectation is recorded from the pre-extraction base and checks every row's key, order, control kind, min, max, step, `fixed` and visibility.
- **Closure test**: the module rows and the registry paths are in bijection, and Studio's visible set for each matrix context equals the module filtered by the same predicate. Mutant: change one `step` or one predicate in the module, and prove the guard fails.

Further tests (ids `P-<stage><n>`; all DESIGNED, NOT DEMONSTRATED until the build shows the pre-fix failure):

- **P-a1** (RR on the S4 base: no provider group) a `jinja` template edit on an inactive preset writes `slot.JinjaTemplate`, the working value unchanged, and switching applies it; **P-a2** reverse-proxy rows follow the preset's own model (an inactive preset on `reverse_proxy` shows them while the active one does not); **P-a3** the chat-format pair is rendered once, for `aiModel='ooba'` and for `reverse_proxy` with the Ooba switch separately.
- **P-b1** (RR) provider list add/remove/move on active and inactive presets, each one step, undo restores the exact list; **P-b2** an absent `openrouterProvider` on an inactive slot reads the seed and a write creates `{order,only,ignore}`; **P-b3** unknown provider id kept and shown as unknown; **P-b4** model change writes only `aiModel`; **P-b5** the request-model picker shows for an exact `openrouter` main or sub model, the provider lists only for a main model starting with `openrouter`.
- **P-c1** each Ooba row routes by id and survives `saveCurrentPreset` and a switch round trip; **P-c2** (RR against a fresh-seed container) a one-key edit of an inactive slot with no `ooba` copies the whole effective object; the switch then yields the full object; **P-c3** Ooba args rows appear per mode, and for `aiModel='ooba'` the select and the nine mode rows are hidden; **P-c4** the off encoding per control kind: off writes `null`, a stored `null` and an absent key both read off, undo restores the exact prior state, never `undefined`; **P-c5** a nested key write marks the save with the real `dbChangeEffects` hook (`ooba.formating.useName`); **P-c6** the no-editor allowlist computed: slot-type keys minus module keys.
- **P-d1** NovelAI rows by id, defaults 1, 0, 1 read for the three keys when missing; **P-d2** NovelList rows shown only for NovelList-format models; **P-d3** `NAIadventure`/`NAIappendName` absent reads off with no note; **P-d4** a first write to an absent inactive `NAISettings` copies a clone (identity assertion), the pinned value shows the disclosure, the three default-read leaves never write a delete on undo.
- **P-e1** (CG/RR as S4-T2) stored records unaffected, a string or `NaN` element refused, `numberList` equality element-wise; **P-e2** toggling a flag keeps unknown stored entries; **P-e3** undo after a switch applies on the working copy.

Mutants (scratch only): M-c1 container seeded fresh instead of whole-effective (P-c2); M-c2 off-switch writes `undefined` (P-c4); M-c3 visibility from `db.aiModel` (P-a2); M-e1 `numberList` equality by reference (P-e1); M-d1 first-write copy by reference (P-d4); M-g1 one module `step` or predicate changed (extraction guard and closure test).

## 8. Copy (new `en.ts` keys; all 8 locales in the stage that adds them)

Reused existing keys: `chatFormating`, `optCustomJinja`, `useNamePrefix`, `reverseProxyOobaMode` (read only), `format`, `customFlags`, `enableCustomFlags`, `openRouterProviderOrder`/`Only`/`Ignore`, `textAdventureNAI`, `appendNameNAI`, `longTermMemory`, `emotionImage`, `translator`, `others`, `import`, `export`, `customStopWords`, the settingsPage strings for Ooba and NAI rows. Slider labels that classic hard-codes in English (`Top P`, `Mirostat LR`, ...) keep their English text as classic does and take `studioPreset...` keys only where a `FIELD_PRESENTATION` label needs a top-level string (†). New keys: `studioPresetProviderGroup` (Provider settings), one † label key per registry path whose classic label is not an existing top-level key. Korean comes from the translator (MC-058).

## 9. Premises

| Premise | Status |
|---|---|
| Classic edits only the working copy; each block's `setPreset` absent rule as section 1 | REOPENED (`setPreset` read in this revision) |
| P2 `apiType` has no editor and no non-storage reader | REOPENED by grep (non-test `src`); absence within that query only; Gate 1 re-greps |
| P3 `openrouterProvider` absent on a slot reaches request code as undefined | NOT YET VERIFIED: Gate 1 traces `request/openAI/requests.ts` and `request/openrouter` use; the seed read is a display default only |
| P5 no model-change effect in the provider blocks other than the two separate-parameters clamps (4.5) | Gate 1 of each stage greps `$effect` over its block components |
| Global-only: `reverseProxyOobaMode`, `openrouterFallback`, `openrouterMiddleOut`, `disableSeperateParameterChangeOnPresetChange` are not `botPreset` keys | REOPENED (`settingsFields.ts` `PRESET_FIELD_RULE`) |
| Row set, predicates, encodings, ranges, steps and labels come from the shared module, not from this file | by design (section 2) |

## 10. Decisions this spec applies

- **Inherited:** MC-3970, MC-4041 (provider blocks, own ticket and spec), MC-4030 (feature complete), MC-3972, MC-3973, MC-3974 (value kinds and whole-list steps), MC-3975 (staged PRs), MC-3976 (no connection fields), MC-3979 (own-model visibility), MC-4033 pattern (fields with no reader shown with a note), MC-4042 pattern (refuse a foreign import whole), MC-4043 (app-wide switches stay in Settings), MC-4047 (disclose overwrite on a `doNotChange*`-style switch).
- **2026-11-28 answers (ids from lane A):** **D1** (MC-4720) NovelList sampling (`ainconfig`) is included, in stage d. **D2** (MC-4721) Separate parameters are included fully, with per-purpose import and export, in stage f (own spec); the global switch stays in Settings. **D3** (MC-4729) an optional provider setting's off writes classic's value (`null`, `-1000`) and Studio reads `null`, `-1000` and absent as off.

## 11. Open questions (maintainer)

None at revision 3. Design defaults open to veto: the per-leaf path model (4.1), the shared block modules (2), `apiType` shown with "Not used" (0), the stage split (7), the nullable parse for Ooba args (4.2).
