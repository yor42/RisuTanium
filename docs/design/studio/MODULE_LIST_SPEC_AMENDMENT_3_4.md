STATUS: AS BUILT (PR 750). The reviewed plan text below is unchanged; this note records what the build did differently.

**As-built note.**
- Tests: every R row was shown red on its base before the fix. T9-DEFER-STEP lives in `StudioToggleBuilder.gone.svelte.test.ts` (not `StudioToggleBuilder.svelte.test.ts`). The name-composition rows (T9-NAME-LEAVE, T9-NAME-HIDE, T9-NAME-CLOSE) were added after Gate 2: T9-NAME-HIDE is a regression reproducer, LEAVE and CLOSE are compatibility guards.
- Coders: all stages were built by `sonnet-coder` (Sonnet), not the Opus coder named below; the controller routes code edits to Sonnet only. The Opus Gate 2 covers the contracts.
- The toggle editor's option write (`writeOption`) also relies on the inert-derived rule (a derived read inside a destroyed branch returns its last value); T9-DEFER-STEP covers the label only. Hardening is follow-up #752.
- The S5 form's deferred flush has no reachable landing path today: every unmount of that form is preceded by a registered flush or ends in a refusal. Its step close is the live part. A mutant that removes the deferred flush is therefore expected to survive.
- In a release build `console.*` calls are stripped (`vite.config.ts`), so the deferred closures' error logging exists in dev and tests only.
- Known limitations: the Y5 stale toggle carry record, and a plugin full-list write that keeps the id and changes content, stay as listed under "Not covered".
- The preset list field and four other Studio forms write from `onDestroy` without a registered flush; this is pre-existing and filed as #752.

# #709 spec amendment, revision 3 (final text): section 3.4 (a module deleted or replaced while a Studio form is open)

Designer, 2026-11-24.

**Inputs:**
- the L1 build coder's report (the finding that section 3.4 was wrong);
- the opus check of revision 1 ([REJECT], F1 and F5 SUBSTANTIVE, F2 to F4 EDITORIAL), and a second check of revision 2 ([REJECT], G1 SUBSTANTIVE).

**Source traced in:** the worktree `C:\Projects\RisuAI\.claude\worktrees\709-module-list-spec-7ec318`, on branch `claude/709-module-list-build` at HEAD 1002ead68 (= `origin/main`), with the L1 edits uncommitted.

**Runtime:** svelte 5.57.3 (`node_modules/svelte/package.json`), with the repository's `patches/svelte-5.57.3` and `experimental.async: true` in both `vite.config.ts` and `vitest.config.ts`.

## What revision 3 changes (amendment check r2: [REJECT] on G1; G2-G5 editorial)

- **G1:** T9-GONE-DELETE-TOGGLES gains case (b) for the row editor (`StudioToggleEditor`): a label composition held when M1 is removed from outside with a `splice`. A new mutant row says that "`StudioToggleEditor` keeps the synchronous `flushAll()`" must fail case (b). L1 demonstrates case (b) on `origin/main`.
- **G2:** the reason `endModuleAck` stays synchronous now names 고급 → 토글 of one module. That is the path where the module toggle builder keeps the same-module ack. 배경 HTML does not remount the form. The optional D row changes to match.
- **G3:**
  - The editor's target row comes from a `{@const rowId}` derived. It relies on the inert-derived rule and is named as the one exception.
  - T9-DEFER-STEP's text assertion guards it.
  - The S5 form reads `service` into a `const` in the teardown, before it queues (design default; this removes the `derived_inert` dev warning).
  - The Gate 2 read item is reworded.
- **G4:** the "close stays synchronous" mutant row is scoped to `StudioToggleEditor`. A new C row, T9-DEFER-STEP-TEXT, kills the same mutant in `StudioToggleText`. The S5 order stays a Gate 2 read item.
- **G5:** "no close by the same form runs before it". T9-LEAVE-FLUSH asserts the final state, not the timing.

## What revision 2 changes

- **F1 (step order):** in all three forms, the deferred microtask flushes first and then closes the open step. No close runs synchronously before the deferred flush any more.
  - The S5 form's `endModuleAck` stays synchronous, because a deferred end would end the ack the next form of the same module has just kept.
  - The builder's own `closeOpenStep` and `dispose` stay synchronous. The resulting stale carry record (the reviewer's Y5) is named as a known limitation that clears at the next mount.
  - New C row T9-DEFER-STEP and a mutant "close stays synchronous before the deferred flush".
- **F5 (existing test):** T5-NSCOMMIT "unmounting flushes a differing draft" (`StudioModuleAdvancedForm.svelte.test.ts`) fails under the fix. It is split into two cases:
  - a close case through `closeStudio()` (C);
  - an unmount-without-close case that asserts the drop (R, new behaviour).
  Section 3.4 states that outcome.
- **F2:** the deferred flush may rely only on identity fixed at mount and on the service's resolve-at-write check. The form's own deriveds are stale by then and are not a guard. This is also a Gate 2 read item.
- **F3:** the deferred closure catches and logs its own errors, as `flushStudioFields` does.
- **F4:** one sentence covers both cases: a refused deferred write is never shown, because the form is gone. LEAVE and HIDE are named as the only guards of the registered flush.
- The labels were rechecked (section 8). The reviewer executed four of the R rows on `origin/main` as diagnostics (E2, E4). The final test files are still **DESIGNED, NOT DEMONSTRATED**.

## Summary

- **Cause.** Svelte 5.57.3 runs `onDestroy` as an effect teardown, with `is_destroying_effect` set. During that teardown, a read of any source written earlier in the same flush returns its value from before the flush. That includes the `$state` proxies behind `DBState.db.modules` (`runtime.js:651-652`, `sources.js:188-197`).
  - The S5 form's unmount flush therefore resolves module M1 against the old list.
  - It then writes by index into the current array (`studioSetters.ts:739-741`). After an outside `splice`, that overwrites M2; after a filtered reassignment, a history step is recorded into the detached list.
  - The reviewer confirmed this in source and by execution, on `origin/main` too.
- **Fix: no Studio form writes from a teardown.** The S5 form registers its held-text flush with `registerStudioField`, which is the `LongTextField` pattern. Three forms then queue one microtask from `onDestroy` that flushes and then closes the open step: `StudioModuleAdvancedForm.svelte`, `StudioToggleText.svelte` and `StudioToggleEditor.svelte`. **None of the four forbidden files is needed** (reviewer claim 4: CONFIRMED).
- **Origin and owner.** The bug is on `origin/main` without #709. It belongs to stage **L1** (Opus; changed contract 2).

## Root cause (traced; reviewer claims 1a-1e CONFIRMED)

| Step | Source |
|---|---|
| `onDestroy(fn)` is `onMount(() => () => untrack(fn))`, so it runs as an effect teardown | `svelte/src/index-client.js:115-121` |
| A teardown runs with `set_is_destroying_effect(true)`, and an error in it goes to the error boundary | `reactivity/effects.js:445-461` (`execute_effect_teardown`) |
| The first write to a source in a flush records the previous value in `old_values` | `reactivity/sources.js:188-197` |
| While `is_destroying_effect` is set, `get(signal)` returns `old_values.get(signal)` when present, `untrack` notwithstanding | `runtime.js:651-652` |
| The S5 form flushes in `onDestroy`: write first, then `closeOpenStep`, then `endModuleAck` | `StudioModuleAdvancedForm.svelte:185-194` |
| The service resolves the module owner on every action against `DBState.db.modules` | `ownerHistory.svelte.ts:1119-1125, 1138`; `studioSetters.ts:78-94`; `assetSetters.ts:373-384` |
| The write replaces the slot by index in the current array | `studioSetters.ts:739-741` |
| `undoImport` removes with `splice`, then reassigns the same array | `importUndo.ts:92, 97` |
| The toggle editor and the toggle text flush in `onDestroy` (write, then close) and are registered | `StudioToggleEditor.svelte:92-105`; `StudioToggleText.svelte:106-113` |
| The builder's `onDestroy` closes the step and disposes the builder; children are destroyed before the parent's teardown | `StudioToggleBuilder.svelte:365-370`; `effects.js` `destroy_effect` (children first; reviewer F1) |
| `LongTextField` is registered and drops held text at dispose | `LongTextField.svelte:588-593`; `fieldWrite.ts:123-126` |
| Detail-changing state functions call `flushStudioFields('leave')` first; a close passes through the `studioOpen` flag | `fieldFlush.ts:6-9, 57-65`; `studioScreen.svelte.ts` (`openStudio`, `setStudioLayout`, `showStudioList`, `setStudioSelection`); `studioOpen.ts:12`; `closeStudio` → `studioOpen.set(false)` (`studioScreen.svelte.ts:198-199`) |
| `beginModuleAck` keeps a held ack for the same module and visit; `endModuleAck(id)` ends whichever ack is held for that id | `studioHistoryService.svelte.ts:320-343` |
| A derived whose parent effect is destroyed answers with its last value | `reactivity/deriveds.js:345-354` (reviewer F2) |

**Execution.**
- My own diagnostic: `pnpm exec vitest run src/lib/Studio/StudioDetail.moduleAdvanced.svelte.test.ts -t T9-GONE-DELETE` on the branch exits 1 with `expected 'module:M1' to be null` (a session-scratch vitest output, not kept).
- The reviewer's runs, E1 to E7 in `amend-check-r1.md`, were made in a scratch copy:
  - origin/main code: a splice leaves `[M1 ns=draft]`, a filtered reassignment records one step, and a pagehide writes nothing;
  - the corrected variant passes 591 of 592 tests in 33 files, and the one failure is T5-NSCOMMIT (F5).

## Options considered

| Option | Verdict | Why |
|---|---|---|
| A. The form re-checks at flush time that its row exists | Unsound | The re-check runs in the teardown, so it reads the old list (`runtime.js:651-652`). |
| B. Withdraw the published id before the form is destroyed | Unsound as a reactive write | `published` is `$state`, so a withdraw in the same flush is masked in the teardown. That is why the coder's `$effect.pre` attempt failed. A non-reactive mirror would depend on Svelte's internal effect order. |
| C. A guard in the history core or the setters | Forbidden (#685 S7-0), and not enough on its own | There is no public way to tell a teardown apart. |
| D. Register and drop at unmount, as `LongTextField` does | Simpler, but changes a decided contract | An IME composition held when a toggle row editor or text view unmounts without a blur would be dropped. That breaks the existing R-C9 contract ("leaving the page mid-composition writes the held value"), which needs the maintainer's acceptance (reviewer, Simpler path). Not chosen; it stays available if Gate 2 finds the deferred path too costly. |
| **E. Registered flush plus a deferred unmount flush that flushes, then closes** (chosen) | Sound | Every write then reads current data, and the service's unchanged resolve-at-write check refuses a gone or replaced module. History step boundaries stay as on base (T9-DEFER-STEP). |

## Replacement text for spec section 3.4

> ### 3.4 A module deleted or replaced while Studio shows it (MC-3896 applied to modules; design default on the brief's instruction)
>
> MC-3896 decided for presets: "The selection clears, with the notice `studioRefusalPresetGone`. Typing since the last write is dropped, and no preset changes. A write refused because the preset is gone shows the same text." This spec applies the same rule to a module owner.
>
> **No Studio form writes from a teardown.** Svelte runs `onDestroy` as an effect teardown. There, a read of any state written earlier in the same flush returns the value from before the flush (`svelte/src/internal/client/runtime.js:651-652`, `reactivity/sources.js:188-197`), and `untrack` does not change that. A write issued from a teardown is therefore planned against the module list as it was before the removal, but lands on the list as it is now. After an outside `splice` it overwrites the next module's slot. So a Studio form that holds text writes it in one of two ways:
> - **Registered flush.** The form registers its held-text flush with `registerStudioField`. Every Studio state function that changes the detail runs it before its first state write. A close runs it through the `studioOpen` flag, and a page hide through the window listeners (`fieldFlush.ts`). It runs outside a teardown and reads current data. `LongTextField` already works this way.
> - **Deferred unmount flush.** `onDestroy` queues one microtask (`queueMicrotask`, not `afterFlush`, whose contract excludes write paths). In that microtask the form **first flushes what it still holds, then closes its open step**, the order the synchronous code had. No close by the same form runs before it. At a full builder unmount the builder's own synchronous `port.closeOpenStep()` does run first; that is harmless, because the child closes again after its write and the steps stay as on base. The closure catches and logs its own errors (`console.error`), as `flushStudioFields` does, because an error in a microtask no longer reaches the error boundary.
>   - The closure relies on identity fixed at mount or captured in the teardown: the S5 form's `const owner`, and the toggle port and builder of the old instance. A teardown read of a derived executes normally, so the S5 form reads `service` into a `const` before it queues. The form's other deriveds and props are stale in the microtask (`reactivity/deriveds.js:345-354`) and are not a guard. **The one named exception** is the toggle editor's target row. Its write closures read `{@const rowId = id}`, a derived that the microtask answers with its last value because its parent effect is destroyed (the inert-derived rule). That is the old row, and that is correct. If Svelte recomputed it instead, the write would go to the builder's newly opened row. T9-DEFER-STEP's text assertion catches that. Each such read logs a `derived_inert` warning in dev and in tests; the release build strips it.
>   - The history service's resolve-at-write check (`studioSetters.ts:78-94`, unchanged) decides whether the write lands. A gone module is refused `gone`. A replaced one is refused `not-selected`, because the import withdrew its id. An owner still selected, and published for a module, gets the write.
>   - A refused deferred write is never shown, because its form is gone.
>
> L1 applies this as follows:
> - **`StudioModuleAdvancedForm.svelte`** gains the registered flush (name composition and namespace draft). Its `onDestroy` keeps the cancelling of open questions and `endModuleAck(moduleId)` synchronous, and queues one microtask that flushes, then closes (the exact calls are at the end of this bullet). `endModuleAck` stays synchronous: `beginModuleAck` keeps a held ack for the same module and visit, and `endModuleAck(id)` ends whichever ack is held for that id (`studioHistoryService.svelte.ts:320-343`). A deferred end would therefore end the ack that the next module form has just kept. The case: 고급 → 토글 of one module destroys the S5 form, and the module toggle builder's `$effect` calls `beginModuleAck(moduleId)` (`StudioToggleBuilder.svelte:90-101`). A 고급 → 배경 HTML switch does not remount the form: one branch under `{#key ownerKey}` serves both kinds (`StudioDetail.svelte:298-303`). The queued microtask runs `nameGate.flush(); commitNamespace(); svc?.closeOpenStep(owner)`, where `const svc = service` is read in the teardown.
> - **`StudioToggleText.svelte`** queues `gate.flush(); port.closeOpenStep()`.
> - **`StudioToggleEditor.svelte`** queues `flushAll(); actions.closeStep()`. Both are already registered.
> - `LongTextField` is unchanged, since its `dispose` already drops. The builder's own `onDestroy` (`StudioToggleBuilder.svelte`) is unchanged.
>
> These toggle components also serve character and preset owners. For those, the unmount write now runs after the update, with the same step boundaries as before.
>
> **Studio's screen unmounted without a close** (a surface swap such as a reload or a restore, which takes `App.svelte`'s other branches): there is no registered flush, because the `studioOpen` flag did not pass. The deferred flush runs after the detail's publish effect cleared the published id, so **a held module draft is dropped**. That is wanted on these paths. A character or preset toggle draft still lands, because those owners need no publication. Every Studio link-out found closes Studio first (`openInClassicEditor`, `openConnections`, `leaveStudio`; reviewer F5 survey of `settingsOpen.set(true)`: 17 lines, COMPLETE for that pattern).
>
> **Delete from outside the page** (a task card's import Undo, a plugin write, a restore that replaces the database):
> - The owner leaves the model. `StudioDetail`'s not-found effect clears the selection with `studioRefusalModuleGone` when the key is a module key, and keeps `studioNotFound` for every other owner type.
> - Held typing is dropped and no module changes. The form's deferred flush runs after the update, finds no slot for the id, and writes nothing. It is stopped by the service's `gone` check, or earlier by the form's own stale `editable`. No step is recorded, and no other module's slot is written. A history replay is refused because the id is no longer published.
> - **Wording edge (accepted):** a later row of a shared id has the owner id `id#index`. When an outside removal of an earlier row shifts its index, its key no longer resolves, and the notice reads "That module is no longer available." although the module still exists under a new key. Shared-id rows are read-only in Studio (S5), so nothing is lost; the user selects the row again.
>
> **Replace by an import** (the duplicate question answered Replace, possibly while a backgrounded import card runs):
> - The id stays, so the owner stays in the model and the form would stay mounted on the new content. A held namespace draft or name composition would then land **on the replaced module** later, which MC-3896 forbids.
> - `openModuleForm.svelte.ts` gains `withdrawOpenModuleId(id: string): void`.
>   - When `id` is the published id, it sets the published id to null and records `withdrawn = id` (reactive). The publish token is left alone.
>   - `withdrawn` is reset to null when the detail clears the selection, by every `publishOpenModuleId` of another id, and by `resetOpenModuleIdForTests`.
> - `commitModule` calls `withdrawOpenModuleId(placement.previous.id)` in its replace branch: right after `applyModulePlacement` returns `replaced`, in the same synchronous block, before `describeReplace`. The import runs outside any teardown, so every later write from a form is refused `not-selected` (`studioSetters.ts:79-80`), the deferred unmount flush included.
> - `StudioDetail` reads `withdrawn`. When it equals the selected module's raw id, it calls `clearStudioSelection(language.studioRefusalModuleGone)` and resets `withdrawn`.
> - A replace of **another** module withdraws nothing. The module's history survives (keyed by id), and selecting the module again publishes it again.
>
> Covered forms: every Studio form that writes a module through the history service.
> - The 고급 and 배경 HTML form: registered flush plus deferred unmount flush.
> - Long text: registered flush; drops at dispose.
> - The module toggle builder's text and row editors: registered flush plus deferred unmount flush.
> - The module asset form and Update-All's `textSet` path: no held typing.
>
> Not covered (inherited, named):
> - A `.rtb` or `.bin` restore that replaces the whole database is the restore flow's own business. No form writes into the replaced database from a teardown.
> - **A plugin's full-list write that keeps the id but changes the content** (`plugins.svelte.ts:640-641`) is not an import replace and withdraws nothing. A held draft can still be written onto plugin-replaced content by a later leave flush. MC-3896 names delete, import and `.rtb` restore, not plugin writes. Known limitation. A plugin write that removes the module is covered as a delete.
> - **Toggle carry record after a composed label-only edit at full builder unmount (known limitation).** The builder's synchronous `closeOpenStep` and `dispose` now run before the children's deferred write. A composed label-only edit held at the moment the whole builder unmounts therefore leaves its carry record `ok` instead of absent (reviewer Y5). The record clears at the next mount of that owner: `mountWindow` clears it when `buildQuestion()` is null (`toggleBuilder.svelte.ts`). A composed key rename keeps its record either way (Y6). The builder's `onDestroy` is not deferred: a deferred `dispose` could clear the carry state of a new builder of the same owner mounted in the same flush.
> - The preset list field (`StudioPresetListField.svelte`) flushes in `onDestroy` and is not registered. It is a preset form outside #709, and section 12 names it for lane A.

## Section 3.5, contract 2: replacement

> 2. **Studio write acceptance after a removal or a replace.** No Studio form writes from a teardown: held text goes through the registered flush or a deferred unmount flush that flushes and then closes the step. The import commit withdraws the published open-module id. Failure scenarios:
>    - a teardown write lands on another module's slot after an outside `splice`;
>    - a teardown write records a step into a detached list after a reassignment;
>    - held typing lands on replaced content;
>    - the withdraw clears another module's publication;
>    - the withdraw happens after an await or in a microtask, so a flush slips in between;
>    - a deliberate leave, close or hide drops held text because the registered flush is missing;
>    - a deferred write lands after its step was closed, so two edits merge into one undo step;
>    - a deferred closure picks its target through a stale prop or derived.

## Section 6: replacement and new rows

| # | Scenario | Prevented by | Test |
|---|---|---|---|
| F4 | Held typing lands on a module an import just replaced | `withdrawOpenModuleId` in the commit's synchronous block; no teardown write | T9-GONE-REPLACE, T9-WITHDRAW-ORDER |
| F10 | A form's unmount flush after an outside removal overwrites another module's slot, or records a step into a detached list | no write from a teardown (section 3.4) | T9-GONE-DELETE, T9-GONE-DELETE-FILTER, T9-GONE-DELETE-TOGGLES (a) and (b) |
| F15 | A deliberate leave, close or page hide loses the S5 form's held text once the unmount flush is deferred | the S5 form's registered flush | T9-LEAVE-FLUSH, T9-HIDE-FLUSH, T5-NSCOMMIT (close case) |
| F16 | A deferred unmount write lands after the step was closed, so one Undo reverts two edits | flush, then close, in one microtask | T9-DEFER-STEP |

## Section 8: replacement and new rows

**Labels.**
- **R** fails on the intended defect, or on the missing behaviour, on `origin/main` 1002ead68. The three forms and `importUndo.ts` there are identical to the branch.
- **C** passes before and after, and its row says so.
- Every R row is **DESIGNED, NOT DEMONSTRATED** until L1 shows its pre-fix failure. The reviewer's diagnostics (E2, E4) already reproduced the defect behind T9-GONE-DELETE (1), T9-GONE-DELETE-FILTER, T9-GONE-DELETE-TOGGLES and T9-HIDE-FLUSH on origin/main code. Those were scratch probes, not these test files.

| Id | Scenario | Class | Base and expected failure | File |
|---|---|---|---|---|
| T9-GONE-DELETE (replaces the row) | S5 form open on M1, with M2 after it. A namespace draft is typed and not committed. M1 is removed from outside: `splice(0, 1)`, then reassignment of the same array (as `undoImport` does). Then `settle()` and a drained microtask. **Assertion order:** (1) `db.modules` has length 1 and `db.modules[0]` is the M2 object with every field unchanged; (2) `service.view(module:M1).done` is empty; (3) the selection is cleared with notice `studioRefusalModuleGone`; (4) no `studio-module-advanced-form` | R | `origin/main`: (1) fails, because the teardown flush overwrites index 0 with M1 plus the draft (reviewer E2 X1) | `StudioDetail.moduleAdvanced.svelte.test.ts` |
| T9-GONE-DELETE-FILTER (new) | As above, but the removal reassigns a new filtered array (a plugin full-list write). Assert: no step for `module:M1`; `db.modules` is `[M2]`, unchanged; the notice is `studioRefusalModuleGone` | R | `origin/main`: the teardown write goes to the detached array and records one step (E2 X2), so "no step" fails | same |
| T9-GONE-DELETE-TOGGLES (new; two cases) | The module toggle builder of M1, with M2 after it. **(a) Text view:** an IME composition is begun in `studio-toggle-text` (`compositionstart`, then `input` with `isComposing`), so the gate holds text. **(b) Row editor:** row `m1` is opened, and a composition is begun in `studio-toggle-label` with text `Onex` held. In each case M1 is removed from outside with `splice` and reassignment, then settled twice. Assert in each case: `db.modules[0]` is the M2 object, unchanged; no step for `module:M1` | R (both cases) | `origin/main`: (a) `StudioToggleText`'s teardown `gate.flush()` overwrites index 0 (reviewer r1 E4 Z1: base list `[M1 "m1=One\nh=Ha"]`, 1 step); (b) `StudioToggleEditor`'s teardown `flushAll()` overwrites index 0 (reviewer r2 P1: base `[["M1","m1=Onex"]]`, 1 step) | the `StudioDetail.moduleToggles` suite (the reviewers' E4 and P1 harness) |
| T9-LEAVE-FLUSH (new) | S5 form on M1 with a namespace draft held. `setStudioSelection` to the character owner. Assert the **final state**: M1's slot holds the draft and M1 has one step. Timing is not asserted: on base the write lands in the teardown, after the selection changed | C: passes before (synchronous unmount flush) and after (registered flush). It is one of the two guards of the registration, because the existing `StudioDetail.moduleAdvanced` suite passes without it (reviewer F4) | none | `StudioDetail.moduleAdvanced.svelte.test.ts` |
| T9-HIDE-FLUSH (new) | S5 form on M1 with a namespace draft held. A `pagehide` on `window` writes the draft as one step while the form stays mounted | R | `origin/main`: the S5 form is not registered, so the page hide writes nothing (E2 X4) | same |
| T5-NSCOMMIT "unmounting flushes a differing draft" (existing; **amended on purpose**) | Split into two cases. **(a) Close:** type `late` into the namespace and call `closeStudio()`, then `unmountAll()`. Assert `namespace === 'late'` and one step. This now guards the registered flush on close. **(b) Unmount without a close:** type `late`, call `unmountAll()` with no close, then drain a microtask. Assert `'namespace' in live()` is false and no step: a module draft is dropped when Studio's screen unmounts without a close (section 3.4) | (a) C: passes before (the synchronous unmount flush in the teardown lands) and after (the registered flush runs on close). (b) R, new behaviour | (b) `origin/main`: the synchronous teardown flush writes `late`, so "no `namespace`" fails. The unamended test fails after the fix (reviewer E6/E7: `expected undefined to be 'late'`) and is replaced by (a) and (b) | `StudioModuleAdvancedForm.svelte.test.ts` |
| T9-DEFER-STEP (new) | Character owner `A`, wide toggle builder. Row `a`'s label is composing `하`. Row `b` is opened by a click that does not blur, and `B2` is typed into row `b`'s label. Assert the text is `a=하\nb=B2\n` (this also guards the editor's `{@const rowId}` exception: a wrong-row write would put `하` into row `b`) and there are **2** undo steps | C: passes before (write then close in the teardown) and after (flush then close in one microtask). It kills the editor's "close stays synchronous" mutant (reviewer r1 E5 Y7: 1 step under it) | none | `StudioToggleBuilder.svelte.test.ts` (the reviewer's E5 harness) |
| T9-DEFER-STEP-TEXT (new) | Module M1's toggle builder in text view, composing `m1=One\nh=Ha`. The List view button is clicked without a blur, row `m1` is opened, and its label is typed. Assert **2** undo steps for `module:M1` | C: passes before and after (reviewer r2 P2: base 2, fixed 2). It kills the text view's "close stays synchronous" mutant (P2: 1 step under it) | none | the `StudioDetail.moduleToggles` suite (the reviewer's P2 harness) |
| T9-GONE-REPLACE (unchanged row) | As written. With the fix, the replaced form's deferred flush is refused `not-selected` | R (unchanged) | unchanged | `moduleReplaceWithdraw.svelte.test.ts` (the coder's placement, accepted: the moduleAdvanced suite mocks `process/modules`) |

**Mutants (new rows).**

| Mutant | Must fail |
|---|---|
| The S5 form keeps the synchronous `nameGate.flush(); commitNamespace()` in `onDestroy` (today's code) | T9-GONE-DELETE (1), T9-GONE-DELETE-FILTER, T5-NSCOMMIT (b) |
| The S5 form defers but does not register with `registerStudioField` | T9-LEAVE-FLUSH, T9-HIDE-FLUSH, T5-NSCOMMIT (a) (reviewer E3 mB) |
| The S5 form registers but still flushes synchronously in `onDestroy` | T9-GONE-DELETE (1), T9-GONE-DELETE-FILTER (reviewer E3 mC) |
| `StudioToggleText` keeps the synchronous `gate.flush()` | T9-GONE-DELETE-TOGGLES (a) |
| `StudioToggleEditor` keeps the synchronous `flushAll()` (only the text view deferred) | T9-GONE-DELETE-TOGGLES (b) (reviewer r2 P1: `[["M1","m1=Onex"]]`, 1 step under it) |
| **`StudioToggleEditor`: close stays synchronous before the deferred flush** (`actions.closeStep()` in `onDestroy`, `flushAll()` queued) | T9-DEFER-STEP (1 step instead of 2) |
| **`StudioToggleText`: close stays synchronous before the deferred flush** (`port.closeOpenStep()` in `onDestroy`, `gate.flush()` queued) | T9-DEFER-STEP-TEXT (1 step instead of 2) |
| The S5 form closes synchronously before its deferred flush | no test required; Gate 2 read item "each microtask flushes before it closes" |
| Only the not-found notice changes and the forms stay as on base | T9-GONE-DELETE (1) |
| The S5 form defers `endModuleAck` into the microtask | no repository test is required. The Gate 2 code read checks that `endModuleAck` stays synchronous (the reason is in section 3.4). An optional D row: 고급 → 토글 of one module, and the module toggle builder's held ack survives |
| The deferred flush goes through `afterFlush`, or a deferred closure reads a prop getter or a changeable derived (`moduleId`, `slotIndex`, `id`) to choose its target | no test required; Gate 2 read items |

## Section 9: rows

| # | Change | Files | Size (ESTIMATE) |
|---|---|---|---|
| L-F (new) | No form writes from a teardown. The S5 form registers its held-text flush (name gate and namespace) with `registerStudioField` in `onMount`. In each of the three forms, `onDestroy` queues one microtask that flushes and then closes the open step, inside `try`/`catch` with `console.error`. The S5 form keeps the cancelling of open questions and `endModuleAck` synchronous | `src/lib/Studio/StudioModuleAdvancedForm.svelte`, `src/lib/Studio/StudioToggleText.svelte`, `src/lib/Studio/StudioToggleEditor.svelte` | XS (~30) |

**L1 stage** gains:
- L-F;
- T9-GONE-DELETE (revised), T9-GONE-DELETE-FILTER, T9-GONE-DELETE-TOGGLES (a) and (b), T9-LEAVE-FLUSH, T9-HIDE-FLUSH, T9-DEFER-STEP and T9-DEFER-STEP-TEXT;
- the amendment of T5-NSCOMMIT.

L1 demonstrates on `origin/main` that these fail: T9-GONE-DELETE (1), T9-GONE-DELETE-FILTER, T9-GONE-DELETE-TOGGLES (a) and (b), T9-HIDE-FLUSH and T5-NSCOMMIT (b). It also shows that the editor's and the text view's "close stays synchronous" mutants fail T9-DEFER-STEP and T9-DEFER-STEP-TEXT, and that the editor's synchronous `flushAll()` mutant fails T9-GONE-DELETE-TOGGLES (b).

Owner: the L1 Opus coder (changed contract 2), with a grant for the three component files and the named test files. No file in `src/ts/studio/history/` and no `studioSetters.ts` is touched, so the section 3.3 statement stands.

**Gate 2 read items (add):**
- No deferred closure reads a prop getter, or a derived that can change after destruction, to choose its target. The toggle editor's `{@const rowId}` is the named exception (section 3.4). The S5 form reads `service` into a `const` in the teardown.
- Each microtask flushes before it closes.
- `endModuleAck` stays synchronous.
- `queueMicrotask` is used, not `afterFlush`.
- Each closure has its own `try`/`catch`.

## Section 11: premise rows to add

| Premise | Status |
|---|---|
| `onDestroy` runs as an effect teardown, in which reads of state written earlier in the flush return pre-flush values, `untrack` included | REOPENED (`index-client.js:115-121`, `effects.js:445-461`, `sources.js:188-197`, `runtime.js:651-652`); confirmed by the amendment check (1a-1e) |
| A derived of a destroyed component answers with its last value | INHERITED from the amendment check F2 (`deriveds.js:345-354`, with execution E5 Y1) |
| The Studio module write replaces the slot by index in the current array; `undoImport` splices and reassigns | REOPENED (`studioSetters.ts:739-741`; `importUndo.ts:92, 97`) |
| The toggle text and editor flush then close in `onDestroy` and are registered; the builder's `onDestroy` closes and disposes; `LongTextField` is registered and drops at dispose | REOPENED (`StudioToggleText.svelte:106-113`; `StudioToggleEditor.svelte:92-105`; `StudioToggleBuilder.svelte:365-370`; `LongTextField.svelte:588-593`; `fieldWrite.ts:123-126`) |
| `beginModuleAck` keeps a same-module ack, and `endModuleAck(id)` ends it | REOPENED (`studioHistoryService.svelte.ts:320-343`) |
| Detail-changing Studio state functions flush registered fields first; `closeStudio` passes through `studioOpen` | REOPENED (four `studioScreen.svelte.ts` call sites, `studioScreen.svelte.ts:198-199`, `studioOpen.ts:12`). That no other unmount path exists is INHERITED from the `fieldFlush.ts` contract and the reviewer's partial survey |
| A microtask queued from a teardown runs outside it and reads committed data, under `experimental.async` too | INHERITED (reasoned; the reviewer's E3, E4 and E6 runs under the repository's vitest config are its execution check) |
| If a browser fires `blur` while removing a focused input, that handler runs outside a teardown and reads current data | INHERITED (reasoned from `runtime.js:651`); not tested on a device |

## Finding dispositions (amendment check r1)

| Finding | Disposition | Where |
|---|---|---|
| F1 Deferred write lands after the step is closed | **ADDRESSED.** Flush, then close, in one microtask in all three forms. `endModuleAck` stays synchronous, with the reason given. The builder's synchronous close and dispose stay, and the Y5 stale carry record is a named known limitation that clears at the next mount; the builder is not deferred, because a deferred `dispose` could hit a new same-owner builder. New C row T9-DEFER-STEP and the mutant "close stays synchronous". | §3.4, §3.5, §6 F16, §8, §9 |
| F2 Form deriveds are stale in the microtask | **ADDRESSED.** Section 3.4 wording and a Gate 2 read item. | §3.4, §9 |
| F3 Errors in the microtask are not contained | **ADDRESSED.** Each closure has its own `try`/`catch` with `console.error`. | §3.4, §9 L-F |
| F4 Wording; LEAVE and HIDE are the only guards | **ADDRESSED.** One sentence on unshown refusals; the "stale `editable` or service `gone`" stop on the delete path; T9-LEAVE-FLUSH names its guard role. | §3.4, §8 |
| F5 T5-NSCOMMIT unmount case fails | **ADDRESSED.** Named and amended on purpose: (a) a close case (C), (b) an unmount-without-close drop (R). Section 3.4 states the outcome for module drafts and for character and preset toggle drafts. | §3.4, §8 |

## Finding dispositions (amendment check r2)

| Finding | Disposition | Where |
|---|---|---|
| G1 No reproducer for the row editor's teardown write | **ADDRESSED.** T9-GONE-DELETE-TOGGLES case (b) (R), the mutant "`StudioToggleEditor` keeps the synchronous `flushAll()`", and the L1 demonstration list. | §6 F10, §8, §9 |
| G2 The 배경 HTML example is wrong | **ADDRESSED.** The reason now names 고급 → 토글 (`StudioToggleBuilder.svelte:90-101`; `StudioDetail.svelte:298-303`), and the optional D row changes to match. | §3.4, §8 mutants |
| G3 The editor's row id is a derived read | **ADDRESSED.** Named as the one exception under the inert-derived rule, guarded by T9-DEFER-STEP's text assertion. The read item is reworded, and the S5 form captures `service` in the teardown. | §3.4, §8, §9 |
| G4 The close mutant is killed only for the editor | **ADDRESSED.** The mutant is split per component. New C row T9-DEFER-STEP-TEXT for the text view; the S5 order stays a read item. | §8 |
| G5 Wording | **ADDRESSED.** "No close by the same form runs before it", with the builder's harmless close named. T9-LEAVE-FLUSH asserts the final state only. | §3.4, §8 |

## Open items

- **Same class, outside #709: the preset list field.** `StudioPresetListField.svelte:98-101` flushes its gates in `onDestroy` and is not registered. An outside preset removal could write against the old `botPresets` list. Not traced to a write. Lane A may want a ticket.
- **Non-module forms with an `onDestroy` write** were not surveyed. The reviewer's survey covered only the module owners (4 files). A `code-searcher` pass over `onDestroy` bodies under `src/lib/Studio/**` that call a service write, a gate flush or a port write would close this.
- **Option D (drop at unmount) for the toggle components** would be simpler but changes R-C9. It is the maintainer's call only if Gate 2 finds the deferred path too costly.
- **Spec placement.** The orchestrator copies this text into `docs/design/studio/MODULE_LIST_SPEC.md` (sections 3.4, 3.5, 6, 8, 9 and 11) and records the amendment (a section 10e entry or a build-amendment note).

## Artifacts

- a session-scratch vitest output of that diagnostic (not kept).
- two session-scratch `git diff` captures (not kept).
- No repository, git index or worktree writes.
