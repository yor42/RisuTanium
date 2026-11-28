# Per-task parameter modes: migration table and upstream census (#929), revision 2

Companion to [PER_TASK_PARAMS_PLAN.md](PER_TASK_PARAMS_PLAN.md). Docs only. Fork snapshot: worktree `claude/929-plan` at `d98ee549c`. Upstream snapshot: local ref `upstream/main` = `e81b12038`, read with `git show`/`git grep`; no network request. Names (`seperateParameters.taskModes`, `effectiveTaskModes`, `setTaskMode`, `setAllTaskModes`, `mainValuesAsBlock`) are the plan's proposals. Revision 2 moves the modes inside the `seperateParameters` container.

## 1. Upstream census (code read, upstream/main e81b12038)

| # | Fact | Anchor (upstream) | Fork today |
|---|---|---|---|
| U1 | Request rule: flag on and (`mode !== 'model'` or by-model) uses `seperateParameters[mode]`; by-model replaces it with `overrides[modelId]` and throws when missing; then `submodel` always takes `otherAx`. | `src/ts/process/request/shared.ts:179-189` | same, `shared.ts:190-201` |
| U2 | Block path skips `undefined`, `null`, `NaN`, `-1000`; main path skips only `-1000` and sets every other value, `undefined` included, as an own key (`setObjectValue`). | `shared.ts:262-268` vs `:336-338` | `shared.ts:273-280` vs `:347-351`, `:34-47` |
| U3 | Empty block `{}` with the flag on: samplers read `undefined` and are skipped; `reasoning_effort`/`verbosity` go through `getEffort`/`getVerbosity` (`medium`). | block loop | same |
| U4 | Missing block with the flag on throws `TypeError`. Hand-made data only. | block loop | same; out of scope |
| U5 | Flag off with non-empty blocks: never read by a request, kept at load, saved, replaced on a switch by the slot's container (or five empty objects). | `database.svelte.ts:573-581, 2145-2146, 2305-2312` | `database.svelte.ts:612-620, 2394-2395, 2605-2616` |
| U6 | `setPreset` takes the flag from the slot unconditionally (`?? false`) even while the lock keeps the blocks. | `database.svelte.ts:2271` | fork gates flag and container by one lock group (`database.svelte.ts:2557-2559, 2605-2616`; `presetLocks.ts:44-49`) |
| U7 | `saveCurrentPreset` builds a fixed literal (a fork-only top-level key is dropped) but clones the container whole, and `setPreset` clones the slot's container: a key nested in the container survives every upstream save and switch. | `database.svelte.ts:2146, 2308`; mirror `src/ts/drive/tests/upstreamPresetMirror.ts:152` | same shape |
| U8 | Classic UI: one checkbox; while on, every `Object.keys(seperateParameters)` entry gets an editor (known label, else the raw key). EasyPanel "run" sets the flag; its requirements read the flag. | `SeparateParametersSection.svelte:17-21`, `EasyPanel.svelte:22,63` | same (`EasyPanel.svelte:23,71`) |
| U9 | No upstream code reads a per-task mode (`git grep -n seperateParameters upstream/main -- src`, `src/lang` excluded: 31 lines in 5 files). COMPLETE for that query. | this row | n/a |
| U10 | An unknown container key upstream: an extra editor with the raw label while the flag is on. The editors' effects write only a held `reasoning_effort` (`=== 3`, `< 1`) or `adaptive_thinking_effort === 'xhigh'`, which a modes object never holds (`undefined < 1` is false), so nothing is written unless edited, except that a select bound to an undefined member writes its first option on mount (`thinking_type: off` inside the modes object; harmless to the fork read rule); no request reads it (U1); it persists (U7). | `SeparateParametersSection.svelte:19-21`, `AllSeperateParameters.svelte:62-69`, `ClaudeThinkingSeparateParams.svelte:45-47` | same |

Consequence: upstream semantics is (flag, by-model, blocks). The fork key must not reach upstream data: upstream would show and keep it, not drop it (U7, U10).

## 2. Forward migration table (read rule, nothing written at load)

Rule (MC-5090): a record without a readable mode reads every task `own` with the flag on, `same` with it off; blocks never inspected. Columns: F flag, B blocks, M by-model, L `disableSeperateParameterChangeOnPresetChange`. Requests identical to today in every cell (guard T-C1). "Switch": to a slot with the opposite flag; the container (modes inside) and the flag move together in both branches.

| Cell | F | B | M | L | Effective modes | Requests (aux / submodel / main) | Switch | Export `.bin` |
|---|---|---|---|---|---|---|---|---|
| 1 | off | empty | off | off | all same | main / main / main | slot's flag and container | unchanged, no key |
| 2 | off | empty | off | on | all same | main / main / main | working flag and container kept | unchanged |
| 3 | off | empty | on | off | all same | main (by-model inert) | as 1 | unchanged |
| 4 | off | empty | on | on | all same | as 3 | as 2 | unchanged |
| 5 | off | non-empty | off | off | all same, dormant | main / main / main | as 1 | dormant blocks byte-identical |
| 6 | off | non-empty | off | on | all same | as 5 | as 2 | as 5 |
| 7 | off | non-empty | on | off | all same | as 5 | as 1 | as 5 |
| 8 | off | non-empty | on | on | all same | as 5 | as 2 | as 5 |
| 9 | on | empty | off | off | all own | block (defaults, medium) / otherAx block / main | as 1 | unchanged |
| 10 | on | empty | off | on | all own | as 9 | as 2 | unchanged |
| 11 | on | empty | on | off | all own | overrides[model] (throws if missing) / throws if missing, else otherAx / overrides[model] | as 1 | unchanged |
| 12 | on | empty | on | on | all own | as 11 | as 2 | unchanged |
| 13 | on | non-empty | off | off | all own | block / otherAx block / main | as 1 | unchanged |
| 14 | on | non-empty | off | on | all own | as 13 | as 2 | unchanged |
| 15 | on | non-empty | on | off | all own | as 11 | as 1 | unchanged |
| 16 | on | non-empty | on | on | all own | as 11 | as 2 | unchanged |

Lock note: fork cells with L on keep flag and container together (U6); upstream lets the flag follow the slot. After a `.bin` round trip that is upstream's own behaviour on its own data.

## 3. Rows beyond the 16 cells

| Row | Input | Expected |
|---|---|---|
| R1 idempotence | any cell read twice, saved and reloaded | same effective modes; no load write; the key is written only by a mode writer |
| R2 partial | `taskModes: { memory: 'own' }`, F on | memory own; the rest inherit F (own) |
| R3 unreadable | `{ memory: 'auto' }` from a newer build | reads as F's mode; kept by every read, save, switch and `.rtb`; the first mode write on that record replaces all four with readable values from the effective view (A2); `.bin` strips the key |
| R4 non-object | `taskModes: 'x'`/array, or container `null`/non-object | read as absent (derived from F); kept until a mode writer replaces it; a writer on a record without a container seeds the five empty objects |
| R5 flag write over a mix | `{memory own, rest same}`, F set false outside the helpers | disagreement: all same; stored modes untouched |
| R6 flag write over all-same | all same, F set true outside the helpers | disagreement: all own |
| R7 mix, M off, export | memory own, rest same, F on | `.bin`: F on, memory block as stored, three blocks = copy of the record's main values, no key |
| R8 mix, M on, export | R7 with M on | aux use overrides in fork and upstream; submodel: fork main, upstream otherAx copy |
| R9 dormant block of a same task | emotion same, block non-empty | `.bin` replaces it by the copy (N2: warning line) |
| R10 fork to `.bin` to fork | R7 exported and imported | no key, F on: all own; equal requests at that moment; the link is gone (MC-5091; N3 none) |
| R11 upstream to fork to upstream | cells 1-16 | flag, blocks, overrides byte-identical (T-C3) |
| R12 `.rtb`, file container without key | file F on, container without `taskModes`; device container holds a mix (working copy or same-id slot) | the file's container replaces the device's whole (`rtbSettingsRestore.ts:89-92`; `settingsPayload.ts:757-761`): all own on the file's blocks |
| R13 `.rtb`, file container dropped | the file's container fails its check (e.g. an `overrides` key naming a custom model, `containsReference`) | the device keeps its container and modes; the file's flag applies; disagreement resolves to the file's flag; agreement keeps the device's mix on the device's blocks (today: device blocks under the file's flag) |
| R14 downgrade | pre-#929 fork build opens data with a mix | reads F only (all own); keeps the key in every save (container clone); shows a raw `taskModes` editor while F is on. Forward-only (MC-350); accepted |
| R15 flag off then on outside the helpers | stored mix, F set false then true by an out-of-contract writer (hand edit, R13 twice) | the old mix is read again, not all own (advisor A1). Every in-tree flag write goes through the helpers or moves the container with the flag; accepted |
| R16 export, F on, raw key all same | disagreement (R6) | effective all own: no synthesis; blocks byte-identical; key stripped |
| R17 EasyPanel run over a mix | memory own, rest same, another requirement unmet | modes kept (F already on); run sets all own only when no task is own |
| R18 upstream preset file | flag, blocks, no key | slot's container has no key; on switch the working modes derive from the slot's flag |

## 4. Copy rule and rule P predictions (settled by T-D1)

The copy writes only the eleven keys the block path reads (`shared.ts:212-270`): temperature, top_k, repetition_penalty, min_p, top_a, top_p, frequency_penalty (main `frequencyPenalty`), presence_penalty (`PresensePenalty`), reasoning_effort (`reasoningEffort`; slot `reasonEffort`), thinking_tokens (`thinkingTokens`), verbosity. The thinking-type members are display-only (no request reads them; grep over non-test `src` finds only `ClaudeThinkingSeparateParams.svelte` and the type) and are not copied. Values copy verbatim, `null` included; an absent main value stays absent.

Predicted by reading (DESIGNED, NOT DEMONSTRATED; T-D1 decides): representable are finite numbers, `-1000`, `null` for temperature and both penalties (`null/100` is 0 on both paths), and any value of reasoning_effort/verbosity (same helper on both paths). Not representable: `null` for the unscaled keys, `NaN` for any key, and an absent main value that the main path sets as an own `undefined` key (Anthropic then sends `thinking: {}`, `anthropic.ts:371, 398-407`). The expected common case is `thinkingTokens` `null`, written by every switch without a budget (`database.svelte.ts:2579`; upstream `:2279`): main sends a null budget, the block path sends nothing. A slot field whose switch fallback is the working value (`temperature`, `frequencyPenalty`, `PresensePenalty`, `top_k`; `database.svelte.ts:2568-2575`, upstream `:2210-2262`) and that the slot lacks is not representable either; constant fallbacks (`top_p ?? 1`, `reasonEffort ?? 0`, `thinkingTokens ?? null`, `verbosity ?? 1`) are copied as the switch would load them.

## 5. Container readers (decides nesting)

`src` at `d98ee549c`, grep `seperateParameters[^EB]|sepParams|SeparateParams|separateParameters`, `src/lang` excluded; 12 non-test files match, 8 of them read the container (the other 4 match a lock id, a label, a component name or the test mirror helper). COMPLETE for that query; generic walkers that never name the container are listed from reading.

| Reader | Kind | With a nested `taskModes` |
|---|---|---|
| `SeparateParametersSection.svelte:19-21` | iterates `Object.keys` | would show a raw editor: S1a filters the key |
| `EasyPanel.svelte:120-147` | named blocks, `overrides` | unaffected |
| `shared.ts:190-201` | `[modelMode]` (`ModelModeExtended`, `shared.ts:22`), `overrides`, `otherAx` | never reads it |
| `presetFromWorkingSettings` `database.svelte.ts:2395`; `setPreset` `:2605-2616` | clone whole | carried |
| lock group `presetLocks.ts:47-48`; `PRESET_RECORD_FIELDS` `records.ts:29` | whole field | carried |
| `.rtb` rules `settingsFields.ts:149, 241`; `checkRebuilt`/`kindHolds` `settingsPayload.ts:131-163`; `containsReference` `:104-115` | plain object; reference prefixes | passes (`'taskModes'`, `'same'`, `'own'` are no reference) |
| `.rtb` export `presetSourceOf` `settingsPayload.ts:407`; working apply `rtbSettingsRestore.ts:89-92`; slot merge `settingsPayload.ts:757-761` | whole value | carried and replaced as one value |
| store2 `configFields` `codec/split.ts:62-72`; `normalizePresets` `:1385-1402`; full `.rtb` unit closure `rtbExport.ts:36` | blacklist; whole preset | carried (P7) |
| dirty tracking `dbChangeEffects.svelte.ts:132-138, 251-262` | deep snapshot | tracked |
| `trustImportedPreset`/`presetFromTemplate` | no container line after `database.svelte.ts:2616` in the grep | kept (P8) |
| plugin API `allowedDbKeys` `plugins.svelte.ts:421-446` | allowlist | neither flag nor container reachable |
| secret fields | named fields; the container is no secret (`secretFields.test.ts` sets it `null`) | unaffected |
| Studio | no code; `PRESET_SEPARATE_PARAMS_SPEC.md` generates rows for five named purposes | S3 adds the key as a sentinel |
