# Generation-parameter off switch and per-task share/own (#156, CHORE-582)

Status: **plan, revision 1** (2026-11-28). Planning only: no application code, no persisted-format decision taken here. Items marked **Q** are maintainer questions for lane A; each has a recommendation. Gate tier: **2** (persisted-shape decision, upstream `.bin` compatibility). Related: #149 (field locks, complete), #706 (Studio separate-params spec), MC-350, MC-774, MC-4721, MC-4729, MC-4811, MC-4812.

## 1. Findings (source, main `5968b7485`)

1. **"Off" is stored as the number `-1000`, and that is upstream's format.** `request/shared.ts` skips `-1000`, `null`, `undefined` and `NaN` for both the main set and the separate-parameters set. `.bin` backups hold `-1000` in `temperature`, `top_p`, ... and `seperateParameters.<purpose>.<key>`. Any other encoding is fork-only.
2. **An off control already exists.** A `disableable` `SliderInput` renders a checkbox (checked = on; unchecking writes `-1000`, checking writes the slider's `min`). Disableable rows today: temperature, top_p, top_k, repetition penalty, min_p, top_a, frequency and presence penalty, thinking tokens (`botSettingsParamsData.ts`, `AllSeperateParameters`, `ClaudeThinkingSeparateParams`, Studio via `presetFields.ts` `DISABLED_NUMBER`). Not disableable: max context, max response (a number is always required), seed, and the enum selects (`reasoning_effort`, `verbosity`, adaptive effort; they have their own option values or default to `medium` when absent).
3. **Per-task share/own already exists, one level coarser.** `seperateParametersEnabled` is one global switch; when on, memory, emotion, translate, `otherAx` and per-model `overrides` use their own `SeparateParameters` (a missing purpose throws `separateParamsMissing`). There is no per-task "same as main" choice. MC-4721 keeps the global switch in Settings.
4. **The roadmap row** (`Agents/Roadmap.md` CHORE-582) says "the -1000 sentinel becomes a per-parameter flag, written back as -1000 at `.bin` export; preset format migration". That wording predates MC-4729 (Studio writes `-1000` and reads `-1000`, `null`, absent as off) and #149.

## 2. Reuse of the #149 locks/registry

**Independent.** A lock decides which preset group a switch overwrites; an off switch is a value state inside a parameter. They only meet where #149's `sampling` and `separateParameters` groups name the same fields, and those lock rows name keys, not value encodings, so any value representation passes through unchanged. No `presetFieldLocks` or registry change is needed.

## 3. Options

- **A (recommended): no storage change.** Keep `-1000` as the one stored off value. Deliver the "real switch" as UI: every parameter that can be off shows one consistently labelled "Off" toggle (today a bare checkbox labelled with the parameter name, easy to miss, and the slider's left end looks like a valid value), the dormant slider is visibly disabled while off, and turning it on restores the last non-off value of that component instance rather than `min`. Same widget in classic, the Settings registry and Studio. Zero migration, zero `.bin` delta, MC-350 trivially satisfied.
- **B: per-parameter `...Off` boolean flag in the preset/settings, `-1000` written back only at `.bin` export.** Doubles every parameter's state, needs a forward migration of every saved preset and bot setting, an export translation, a read-back of upstream `-1000`, and a second off encoding for Studio (MC-4729 settled one). Benefit over A: the last value survives off/on in storage. Cost: a persisted-format change on every sampling field in a fork whose Android MVP data is live (MC-350).
- **C: A plus per-task share/own** (see Q3).

## 4. Questions for the maintainer

- **Q1 (scope, persisted format).** Is the stored off value `-1000` kept (A), or should a new per-parameter flag replace it (B)? Recommend **A**: there is no failure A leaves open that the UI cannot fix, and B changes every preset.
- **Q2 (product).** What exactly is wrong with today's checkbox? Pick: (a) it is not labelled "Off", (b) turning back on loses the earlier value, (c) some parameter has no off switch (which?), (d) the enum selects should also get an off. Recommend (a)+(b); (c)/(d) only if named.
- **Q3 (product, possibly persisted).** "Per-task same/own": a choice per task (memory, emotion, translate, other) of "same as main" vs "own parameters", replacing the single global switch? Recommend **a separate ticket**: it needs a new per-task field (persisted) and a rule for existing users whose global switch is on, which is where MC-4721 left the switch.

## 5. If A (with Q2 a and b) is chosen: shape

- One shared off-toggle row used by `SliderInput` when `disableable` (label through `language`; a new en key plus the 7 locales and localeParity in the same PR, MC-058). Stored value stays `-1000`; on re-enable the slider restores a component-local last value, else `min` (not persisted).
- Touch: `SliderInput.svelte`, locale files, tests. No change to `shared.ts`, the Studio commit path or `.bin`.
- Not touched: the Studio history-core files, `botSettingsParamsData` encodings, request code.

## 6. Tests (A)

T1 off writes `-1000`; a stored `-1000` or `undefined` reads off (compatibility guard, passes before and after). T2 the off label and disabled slider state render (regression, fails on base). T3 re-enable restores the last value in the same instance (regression). T4 a request built from `-1000` still omits the parameter (guard). T5 the Studio form commit for an off toggle stays one discrete step with the same written value. Mutant: off writes `undefined` or `0`.

## 7. Device rows (MC-2713, from the diff under A)

Only `SliderInput` presentation changes: one phone row (Settings parameters: toggle a slider off then on, read the label and the restored value). No storage row. Not run by this session.

## 8. Risks

R1 "flag" read literally means B: Q1. R2 the label crowds a narrow phone row: device row. R3 Studio history treats an off toggle as a discrete step (`presetFields.ts`, `StudioPresetAdvancedForm.svelte`): the widget change must not alter the written value or the step kind (T5).
