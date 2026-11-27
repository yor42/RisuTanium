# Studio preset separate parameters (#706, stage f)

Status: **spec, revision 1** (2026-11-28). Ticket yor42/RisuTanium#706, stage f. Spec only (MC-3902): no application code. This file **extends** [PRESET_PROVIDER_SPEC.md](PRESET_PROVIDER_SPEC.md) (stages a to e and the rules every block shares) and [PRESET_ADVANCED_SPEC.md](PRESET_ADVANCED_SPEC.md) (S4); it does not repeat them. In particular the **one rule** (a shared data module is the only source of row set, order, control kind, options, ranges, predicate and off encoding), the predicate context, the no-editor rule, the per-control-kind off encoding (D3, MC-4729) and the extraction-guard and closure tests are the provider spec's section 2, 4.2 and 7. Decisions: MC-4721 (separate parameters are fully included, with per-purpose import and export; the global switch stays in Settings), MC-4729 (off encoding), MC-4030, MC-3972, MC-3979, MC-4043, MC-4042, MC-4047.

Evidence is source-read on main `4af04dca0` and re-read at Gate 2 rounds 1 to 3 and by the advisor; `file:line` anchors must be re-read at Gate 1.

## 0. Scope

In scope: `seperateParametersEnabled` and `seperateParameters` (`memory`, `emotion`, `translate`, `otherAx`, `overrides`) of the preset, every preset (active or not, MC-3972), with the rows and conditions classic shows, plus per-purpose JSON import and export (new in Studio). `overrides` rows are classic parity only (section 2: it is a per-model map). Out of scope: the global switch `disableSeperateParameterChangeOnPresetChange` (a note only, section 3), the per-model map `overrides[<model>]` (`EasyPanel`'s editor, left untouched), connection fields (MC-3976).

## 1. Today (source-read)

| Fact | Anchor (`src/`) |
|---|---|
| Classic's Settings section iterates every key of `seperateParameters`, including `overrides`, which it edits as a fifth purpose through `AllSeperateParameters` with the raw key as the label. | `lib/Setting/SeparateParametersSection.svelte` (about 19-21) |
| The purpose's effective model is `auxSlotModel(seperateModels, purpose) \|\| db.subModel`. For `overrides` it is the literal string `overrides`, which `getModelInfo` resolves to the last fallback (`OpenAIParameters`: temperature, top_p, frequency and presence penalty), so temperature shows and reasoning effort and verbosity are hidden. | `lib/Others/AllSeperateParameters.svelte` (about 30-36), `ts/model/modellist.ts` (about 929-940), `ts/model/types.ts` |
| Per-key conditions differ: `top_k`, `repetition_penalty`, `min_p`, `top_a`, `top_p`, `frequency_penalty`, `presence_penalty` are always shown; `temperature`, `reasoning_effort`, `verbosity` follow the model's parameter list; `thinking_type` is always shown; `thinking_tokens` only while `thinking_type === 'budget'`; `adaptive_thinking_effort` only while `'adaptive'`; `deepseek_thinking_type` only while it is already defined (classic cannot create it); `deepseek_reasoning_effort` only while that value is `'enabled'`; `outputImageModal` as a `SeparateParameters` key has **no editor** (`PromptSettings.svelte` edits only the top-level field). | `AllSeperateParameters.svelte` (about 62-89), `ClaudeThinkingSeparateParams.svelte` (about 45-83) |
| The sliders are `disableable`: off writes `-1000`, on writes the slider's `min`. The enum selects have no off state; an absent `reasoning_effort` or `verbosity` is sent as `medium` when the model lists the parameter. Requests skip `undefined`, `null`, `NaN` and `-1000`. | `UI/GUI/SliderInput.svelte`, `ts/process/request/shared.ts` (about 180-187, 258-279) |
| Two effects clamp values and have no visibility guard: `reasoning_effort` 3 becomes 2 without xhigh support and below 1 becomes 1 for min_medium; `adaptive_thinking_effort` `xhigh` becomes `high`. The request path also clamps (`getEffort(..., supportsXHighReasoning)`). | `AllSeperateParameters.svelte` (about 62-69), `ClaudeThinkingSeparateParams.svelte` (about 45-49) |
| `setPreset` seeds `memory`, `emotion`, `translate`, `otherAx` and `overrides` (five empty objects) unless `disableSeperateParameterChangeOnPresetChange` keeps the working one; `seperateParameters.overrides` defaults `{}` at load; `seperateParametersEnabled` absent is `false`. | `ts/storage/database.svelte.ts` (about 528-548, 613-620, 2585-2591) |
| JSON import and export of one purpose exists only where `withImportExport` is passed (`EasyPanel`). Classic Settings passes none; the import there is an unvalidated assignment. | `AllSeperateParameters.svelte` (about 20, 117), `EasyPanel.svelte` |
| Nothing outside the type declaration and the classic editor reads `thinking_type`, `adaptive_thinking_effort`, `deepseek_thinking_type`, `deepseek_reasoning_effort` or `outputImageModal` (grep, non-test `src/ts`; only `shared.ts` reads `seperateParameters`). | grep; premise P-S1 |

## 2. Rows, visibility and encodings (per the one rule)

- A **separate-parameters module** holds, per key, the row's control kind, range, step, `fixed`, options, predicate and off encoding, and classic's `AllSeperateParameters` / `ClaudeThinkingSeparateParams` render from it (extraction guard). Studio's rows `presetSepParam<Purpose><Key>` for the five purposes (`overrides` included, as a fifth purpose) and `presetSepParamsEnabled` are generated from it, with `seperateParameters.<purpose>.<key>` paths. The row type is the module's own: it needs the purpose's value object, and the main-parameter items do not carry it, so `allBasicParameterItems` is not bent to fit (Gate 1 confirms).
- **Predicate context** (provider spec section 2): the purpose's model is `seperateModels.<purpose>` of the edited preset, falling back to that preset's own `subModel`, then `db.subModel`; an inactive preset reads its slot values (`doNotChangeSeperateModels` is a global switch, a note only). For `overrides` the model is the literal `overrides` as in classic. Rows of the table in section 1 are the module's predicates, not restated per key here.
- **Encodings per control kind** (provider spec 4.2): a disableable slider reads `-1000`, `null` or absent as off and writes `-1000`; an enum select has no off state and shows the request's default when absent; `thinking_type` and the `deepseek_*` selects behave as classic (shown by their own conditions, writes only through their select).
- **`overrides` is a per-model map, not a purpose.** It is declared `Record<string, SeparateParameters>` and the request path reads only `overrides[modelId]` (`shared.ts` about 193; `EasyPanel` writes `overrides[model]`). Classic's section binds the whole map to `AllSeperateParameters` as if it were one object, so its top-level keys (`temperature`, `top_k`, ...) sit beside the model-id keys and nothing reads them. Studio keeps **classic parity for the rows** (the literal-model row set, temperature included) so the form matches, but: every model-id key (any key that is not a `SeparateParameters` member) is a **sentinel**: untouched by every edit, never shown, never dropped; **import and export apply to the four real purposes only** (`memory`, `emotion`, `translate`, `otherAx`), never to `overrides`; Studio does not clamp `overrides`. Stage f's Gate 1 raises to the maintainer, MC-4033 style, that the `overrides` top-level rows have no reader (classic parity kept meanwhile); this spec does not decide it.
- **Reading `null`:** classic's slider treats only `-1000` and absent as off, so a stored `null` shows "on" there. Studio also reads `null` as off, a **named deviation** with no data impact (classic never writes `null` to a slider); the extraction guard does not claim parity on it.
- **No-editor rule:** `outputImageModal` (a `SeparateParameters` key) has no row and survives every edit and import; `deepseek_thinking_type` is shown only while defined, as classic, so Studio cannot create it. Premise P-S1: if a trace finds no reader for the `thinking_*` and `deepseek_*` keys, stage f's Gate 1 raises the MC-4033 "not used" note question to the maintainer; this spec does not decide it.
- **Clamps:** one shared pure function per clamp, called by classic's effect and by Studio; Studio applies it **to the value being written or imported, never on view**, and never to a hidden value (a named deviation from classic, whose effects fire whether or not the control is visible; the request path clamps again, so the stored value is harmless).

## 3. Behaviour

- **Notes** (S4 4.5 pattern): with `disableSeperateParameterChangeOnPresetChange` on, an **inactive** preset shows the note `studioPresetSepParamsKept` (switching to it keeps the current separate parameters, and switching away saves the current ones over the edit, as for `doNotChangeSeperateModels`, S4 F11, MC-4047). The active preset needs no note: the save writes the working value.
- **Import** (the four real purposes) replaces the purpose's whole object as **one history step** (a batch of per-key sets **and deletes for keys absent from the file**, one `batch` entry, S4 4.8 "Bias import" pattern; undo restores deleted keys exactly). It validates: every key is a `SeparateParameters` member with the right value type; `-1000` and the no-editor keys (`outputImageModal`) are **accepted**; anything else refuses the file whole with `studioPresetSepParamsImportInvalid` and writes nothing (MC-4042). The target (preset id and active/inactive resolution) is resolved **at write time**, after the file pick and decode: a preset deleted meanwhile gives `studioRefusalPresetGone` and writes nothing. Import is new in Studio (classic Settings has none); the imported clamps apply as above.
- **Export** writes `parameters-<timestamp>.json` of `JSON.stringify(object, null, 2)` of the purpose's object, as `EasyPanel` does.
- **Containers:** `seperateParameters` seed the five empty objects; an absent purpose reads empty; `setPreset` clones this container, so an absent or sentinel key stays so on a switch.
- **Do not mount** classic's `AllSeperateParameters`: it reads `DBState.db.seperateModels` and `subModel` (against MC-3979) and writes from effects.

## 4. Changed critical contracts, failure scenarios

Contracts changed: persisted `botPresets` slot writes and the working `seperateParameters` (batch import), the closed `SetPath` registry and frozen tests, the global-switch interplay.

| # | Failure scenario | Guard |
|---|---|---|
| S-F1 | A purpose's row set or predicate differs from classic's (the recurring defect: `overrides` temperature, `thinking_tokens` outside `budget`, `deepseek_*`, `outputImageModal`). | one module; extraction guard and closure test over the matrix (S-a, S-b) |
| S-F2 | A classic-written `-1000` or `null` is read as "on", or an edit stores `undefined`. | encodings per control kind; test S-c |
| S-F3 | An import writes a foreign key set, drops `outputImageModal`, or refuses a classic `-1000`. | validate whole; test S-e |
| S-F4 | An import lands on the wrong or a deleted preset after the file decode. | resolve at write time; test S-f, mutant M-s3 |
| S-F5 | A Studio edit stores an effort value the purpose's model rejects, or a view writes a clamp. | clamp at write only; test S-d |
| S-F6 | Edits made while `disableSeperateParameterChangeOnPresetChange` is on are lost or overwrite the working ones on a switch. | note and test S-g (disclosed, not prevented, MC-4047) |
| S-F7 | The seed lacks `overrides`, so classic would normalise it only at load. | seed pinned; test S-h |

## 5. Stage and required tests

One stage (f), its own Gate 1 (Tier 2) and Gate 2: **opus-reviewer** (batch import, global-switch interplay, persisted object). It removes the last provider classic link and says `Closes #706`. It adds its `en.ts` keys in all 8 locales and passes `localeParity` in the same PR (MC-058). Fixtures as S4 section 8. All tests are DESIGNED, NOT DEMONSTRATED until the build shows the pre-fix failure.

- **S-a** (CG) extraction guard: classic's `AllSeperateParameters` and `ClaudeThinkingSeparateParams` rows over the matrix are identical before and after the extraction, recorded from the pre-extraction base. **S-b** closure: module rows and registry paths are in bijection; Studio's visible set equals the module filtered by the predicate, matrix axes: purpose (five keys, `overrides` included), model parameter list (temperature, each reasoning variant, verbosity, xhigh flag), `thinking_type` undefined/off/budget/adaptive, `deepseek_thinking_type` undefined/off/enabled.
- **S-c** off encodings: a slider off writes `-1000`, a stored `-1000`, `null` or absent reads off, undo restores the exact prior state (including absent), never `undefined`.
- **S-d** a Studio edit and an import of `reasoning_effort` or `adaptive_thinking_effort` beyond the purpose's model support is clamped as classic's effects do; a hidden value is untouched; viewing writes nothing.
- **S-e** import replaces one purpose as one step, undo restores it; an unknown key or a wrong value type refuses whole and writes nothing; `-1000` and `outputImageModal` are accepted and kept. Export bytes equal `JSON.stringify(obj, null, 2)`.
- **S-e2** `overrides` holding model-id keys: every Studio edit of its rows leaves the model-id keys intact; import and export are not offered for it; a stale-key import into `memory` deletes keys absent from the file and undo restores them. Mutant M-s6: an edit or import rewrites `overrides` whole.
- **S-f** the import target is resolved at write time: a preset deleted after the decode gives `studioRefusalPresetGone` and writes nothing.
- **S-g** with `disableSeperateParameterChangeOnPresetChange` on, the inactive-preset note shows and the switch and overwrite behaviour matches S4-T8's pattern. **S-h** the seed is exactly the five objects; an edit on an absent inactive purpose writes into the slot copy, not `db`.
- Mutants (scratch only): M-s1 one module predicate or step changed (S-a, S-b); M-s2 off writes `undefined` or deletes (S-c); M-s3 import target resolved at click (S-f); M-s4 clamp applied on view (S-d); M-s5 unknown key accepted (S-e).

## 6. Copy

New keys (all 8 locales in the stage): `studioPresetSepParamsKept`, `studioPresetSepParamsImportInvalid` ("This file isn't a set of parameters"), `studioPresetSepParamsExport`, `studioPresetSepParamsImport`, plus `FIELD_PRESENTATION` labels (†) only where classic's label is not an existing top-level key. Reused: `seperateParameters`, `seperateParametersEnabled`, `longTermMemory`, `emotionImage`, `translator`, `others`, `import`, `export`. Korean comes from the translator (MC-058).

## 7. Premises

| Premise | Status |
|---|---|
| P-S1 no reader of `thinking_*`, `deepseek_*`, `outputImageModal` outside the type and classic editor | REOPENED by grep (non-test `src/ts`); absence for that query only; stage f Gate 1 re-greps, and a confirmed absence goes to the maintainer (MC-4033 pattern) |
| `getModelInfo('overrides')` returns the `OpenAIParameters` fallback | REOPENED (`modellist.ts`); Gate 1 confirms |
| The separate-parameter predicates need the purpose's value object and cannot reuse `allBasicParameterItems` | NOT YET VERIFIED: Gate 1 checks `SettingContext`; if they fit, reuse |
| The per-model `overrides[<model>]` map is `EasyPanel`'s and stays out of scope | by design (section 0) |

## 8. Decisions this spec applies

- **Inherited:** MC-3972, MC-3979, MC-4030, MC-4042 (refuse a foreign import whole), MC-4043 (global switches stay in Settings), MC-4047 (disclose overwrite), MC-3975 (staged PRs).
- **2026-11-28 answers:** MC-4721 (separate parameters fully included, with per-purpose import and export), MC-4729 (off encoding).

## 9. Open questions (maintainer)

None at revision 1 beyond P-S1 (raised at Gate 1 only if a trace finds no reader). Design defaults open to veto: clamp at write only (section 2), `deepseek_thinking_type` not creatable (as classic), the module's own row type (section 2).
