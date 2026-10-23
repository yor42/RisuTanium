# CHORE-139 result (Phase 3): a folder emptied by `checkCharOrder` is dropped in the same pass

**Status:** proposed status for lane A to apply: FIXED on the fork (fork-only), Gate 2 round 2 `[EDITORIAL]` (round 1 `[REJECT]`, remediated); doc-verifier pass run (scratchpad `p3/c139/dv/result.md`), corrections applied. Full `pnpm test` is pending at phase close (UNVERIFIED until then). Short entry: [lane-cloud-records.md](../lane-cloud-records.md) (`MC-717` 2). The CHORE-139 entry is in lane-cloud-records.md.

## Question / ticket ask

Deleting a folder's last remaining character leaves an empty folder until the next order check. Trace it, reproduce it, compare with upstream, and fix it if the maintainer agrees.

## Environment

- Fork: `/home/user/RisuTanium`, branch `lane-cloud`, HEAD `e34be1c`. Dirty tree when written: `Agents/Lanes/lane-cloud-records.md`, `src/lib/Others/GridCatalog.folderMenu.svelte.test.ts`, `src/lib/Others/GridCatalog.svelte`, `src/ts/characters.ts`, `src/ts/globalApi.svelte.ts`, untracked `src/ts/characters.removeCharFolderPrune.svelte.test.ts` (`git status --short`). Earlier stages ran at HEAD `4455c00`, `bae8761` and `18a2c7a`; other sessions' uncommitted changes (lorebook and others) were present during Gate 2 runs.
- Upstream: read-only clone of `kwaroran/risuai` at `f50b594` (`/home/user/kwaroran/risuai`), compared by the investigation and Gate 2 round 1; not re-opened for this report.
- Linux container, Vitest, happy-dom default environment. Sources (session scratchpad `p3/`, not repository paths): investigation `c139/result.md`; verification `vfy/result.md`; implementation `c139/impl/result.md`; Gate 2 round 1 `c139/g2/result.md`; remediation `c139/rem/result.md` and `rem/mut.txt`; Gate 2 round 2 `c139/g2r2/result.md`.
- Gate 1: not required (investigation sized it as tiny, low-risk code change; no plan review). Gate 2 took the `opus-reviewer` route because `checkCharOrder` mutates the reactive database.

## Findings

- **Premise CONFIRMED, with a refinement** (investigation; VERIFIED by the verifier): the defect is in `checkCharOrder` (`src/ts/globalApi.svelte.ts`), not `removeChar`. In its prune loop a folder's `data.length === 0` test ran before the inner loop that removes ids not in the set of untrashed, existing characters. A folder emptied by that inner loop was written back (`order[i] = data`) and not re-tested, so it stayed with `data: []` until a second call. `removeChar` (normal, `permanent`, `permanentForce`) calls it once, so the last member of a folder left an empty folder.
- **Upstream** `f50b594` (`globalApi.svelte.ts:1089+`) has the identical order and a single call in `removeChar` (investigation; Gate 2 round 1 compared). It is an inherited latent defect; the fix is fork-only.
- **Existing workaround:** `trashFolderMembers` and `trashCharacters` called `checkCharOrder()` twice, each with a comment that the second pass removes a folder the first emptied.
- **Callers:** the verifier counted 19 non-test calls in 8 files (the investigation said 10 files, an overstatement), plus the plugin v3 exposure (`v3.svelte.ts:1423`). The sidebar order helpers remove folders they empty themselves (comments in `sidebarOrder.ts`), so they were not affected (verifier: by comment, logic not re-traced). The `removeChar` callers (tile trash button, Remove character button) were the affected single-pass paths.
- **No code path creates an empty character folder** (verifier, VERIFIED): creation sites make folders with two members; chat folders are unrelated to `characterOrder`. An empty folder at the start of a pass was already spliced by the old first check, so the fix cannot newly prune an intentionally empty folder.
- **Held save:** the prune loop returns at the `holding` check before any pruning; the new check sits after it, so a held save still prunes nothing (verifier; Gate 2 `holdbypass` mutant caught).

## Reactive-database mutation

- `checkCharOrder` edits `DBState.db.characterOrder` in place (the default `db` argument). The change: when the inner pruning leaves a folder entry's `data` empty, that entry is spliced out of the array in the same pass (`order.splice(i, 1); i--; continue`) instead of at the next call.
- When: inside `checkCharOrder`, after the `holding` early return. Same `splice` on the same array as the old second pass; no new object, reassignment or save-path bypass. Persisted shape is unchanged (strings and folders); only an emptied folder's own name, color and image go away one call earlier (Gate 2 round 1).
- Callers where the pass runs on a loaded or repaired database (save repair `liveCharacterCheck`, which passes `db`, and bootstrap load, which uses the default): a folder with only purged or missing members is now dropped in that pass rather than the next (Gate 2 round 1).
- UNVERIFIED: `store2` internals and the save loop were not traced (investigation and Gate 2 both state this). Whether an in-place order edit reaches the save without a mark is the existing behaviour, not re-established here.

## What changed and evidence

`git diff -- src/ts/globalApi.svelte.ts src/ts/characters.ts src/lib/Others/GridCatalog.folderMenu.svelte.test.ts src/lib/Others/GridCatalog.svelte` plus the new untracked test:

- `src/ts/globalApi.svelte.ts`: +5 lines in `checkCharOrder`, after the inner pruning and before `order[i] = data`: drop the folder if `data.data.length === 0`.
- `src/ts/characters.ts`: the second `checkCharOrder()` and its two explanatory comments removed from `trashFolderMembers` and `trashCharacters`; the `trashFolderMembers` doc comment reworded ("runs twice" removed) and rewrapped.
- `src/lib/Others/GridCatalog.folderMenu.svelte.test.ts`: the (F) Delete-then-Trash assertion changed from `toHaveBeenCalledTimes(2)` to `1`, with the comment "One pass removes the trashed ids and the folder it just emptied."
- `src/lib/Others/GridCatalog.svelte`: comment only, "repairs it twice" to "repairs it once" (orchestrator's round-2 editorial, ledger row 5066).
- New `src/ts/characters.removeCharFolderPrune.svelte.test.ts`, `describe('a folder emptied by the order pruning is removed in the same pass')`, 9 tests:
  - `checkCharOrder removes a folder whose last member is trashed, in one pass`
  - `checkCharOrder removes a folder whose last member no longer exists, in one pass`
  - `removeChar (normal) of the last untrashed member leaves no empty folder`
  - `removeChar (permanentForce) of the last member leaves no empty folder`
  - `a folder with remaining members is kept, minus the removed id` (compatibility guard)
  - `adjacent emptied folders are all removed in one pass`
  - `an emptied folder followed by a stale id leaves neither behind`
  - `an emptied folder after a kept entry does not overwrite that entry`
  - `a held save prunes nothing, so an emptied folder is not touched` (compatibility guard)
- Line endings: LF, no CR, same as HEAD (Gate 2 round 2).

Executed evidence:

- Pre-fix (implementer, unmodified code): 4 failed, 2 passed on `expected [folder, 'b'] to equal ['b']`. After the remediation, in-memory pre-fix mutant (`rem/mut.txt`): 7 failed, 2 passed (the two passing are the guards). Round 2 reproduced 7 failed, 2 passed on the intended order assertions.
- Mutants on the new file (in-memory, repository untouched): no `i--` killed by 2 tests; no `continue` killed by 1; held-save bypass killed by the held-save guard (round 1 also by `globalApi.characterIdPause` (R)).
- Round 1 differential, 20,000 seeded random orders: one new pass equals two old passes; the new pass is idempotent; the old single pass left 7,537 empty folders; no `"data":[]` after the fix. Not re-executed in round 2 (the `checkCharOrder` change is byte-identical).
- Round 2 related set: 162 test files, all passed (2,884 tests), exit 0 (`grep -rlE "checkCharOrder|trashFolderMembers|trashCharacters|removeChar\b" src --include='*.test.ts'`). `NODE_OPTIONS=--max-old-space-size=8192 pnpm check`: exit 0, 0 errors, 0 warnings.
- Round 2 grep over 154 test files naming `checkCharOrder`: the only other `toHaveBeenCalledTimes(2)` assertions count two separate keyboard moves (SidebarRail.keyboard, GridCatalog.keyboard), not a double pass. Scope: `checkCharOrder*` spies only.

## Gates

- Gate 2 round 1 (opus-reviewer, ledger row 5058): `[REJECT]`, substantive. (1) The existing GridCatalog.folderMenu (F) test pinned two calls and failed with the change (1 failed, 37 passed). (2) The no-`i--` mutant survived. Implementation correctness: no defect found.
- Two statements in the implementation report (row 5053) were refuted by round 1: "no tests pin the double call" and that only `actors.test.ts` failed. The investigation's claim that the GridCatalog.folderMenu spy is "unaffected" was also wrong. Corrected here by the findings above.
- Remediation (test-warrior, row 5060): assertion changed to 1 call, three reproducers added, doc rewrap and test rename; the 4-file run (new test, GridCatalog.folderMenu, trashFolderMembers, trashCharacters) gave 76 passed, `pnpm check` exit 0.
- Gate 2 round 2 (fresh opus-reviewer, row 5065): `[EDITORIAL]`. Round-1 findings resolved. E1, the stale "repairs it twice" comment in `GridCatalog.svelte`, applied (row 5066, comment-only, no re-review needed per the verdict). E2 (optional nit, not applied unless noted elsewhere): the (F) comment in GridCatalog.folderMenu is correct for the real `checkCharOrder` but, in that test, `checkCharOrder` is a no-op spy, so the test pins only the call count and passes even under the pre-fix `checkCharOrder`.
- Streak: one substantive `[REJECT]`; `[EDITORIAL]` does not count.

## Residuals

- Full `pnpm test` is pending at phase close; UNVERIFIED whether `actors.test.ts` (9 timeouts in the implementer's run, not on base-verified) or `saveLoop` is affected; round 2 did not include them.
- `store2`/save loop not traced (see above).
- Plugins that call `checkCharOrder` (v3) see the new one-pass behaviour; not tested.
- The `permanentForce` path has no non-test caller found in source (investigation); covered by test only.

## Decisions

`MC-717` 2 (answer quoted exactly as recorded in [lane-cloud-records.md](../lane-cloud-records.md)):

2. CHORE-139, deleting a folder's last remaining character leaves an empty folder until the next order check. Answer: **"Yes, remove it (Recommended)"**: fix `checkCharOrder` to drop a folder it just emptied, matching bulk delete, and remove the now-redundant double-call workarounds.

Related: `MC-717` (other items), `MC-175` (compatibility: persisted shape unchanged), ledger rows 5041, 5043, 5053, 5058, 5060, 5065, 5066 (this report 5067).

## Citation mismatches

- The investigation's "19 call sites in 10 files" is 19 calls in 8 files (9 with the v3 reference), per the verifier. The investigation also described the GridCatalog.folderMenu spy as unaffected, which Gate 2 round 1 refuted by execution.
- Investigation line numbers (`globalApi.svelte.ts:3280-3353`, `characters.ts:967-1035`) were taken at HEAD `4455c00`. At the current tree: `checkCharOrder` `globalApi.svelte.ts:3280` (holding return 3325, new block 3344-3348); `removeChar` `characters.ts:967`; `trashFolderMembers` `characters.ts:1154`; `trashCharacters` `characters.ts:1214`. The 19-call count is at HEAD; the working tree has 17 after the two removals.

## Corrections from doc-verifier

This section takes precedence over the body above. Independent doc-verifier pass (scratchpad `p3/c139/dv/result.md`): about 24 claims, 20 VERIFIED, 1 WRONG, 3 STALE, 1 INCOMPLETE; reran the prune and GridCatalog folderMenu tests (47 passed) and the trash tests (29 passed). Corrections, already applied above:

1. WRONG: only `liveCharacterCheck` passes `db` (`globalApi.svelte.ts:1489`); bootstrap load (`bootstrap.ts:1238`) calls `checkCharOrder()` with the default. The conclusion holds for both.
2. STALE: current-tree line numbers added under "Citation mismatches".
3. STALE: the pending-verification and missing-records-entry notes are replaced.
4. INCOMPLETE: Gate 1 was skipped under the `docs/workflow/gates.md` small low-risk carve-out; Gate 2 (opus-reviewer) found two call-count pins the implementation had missed. The records entry now says so.
