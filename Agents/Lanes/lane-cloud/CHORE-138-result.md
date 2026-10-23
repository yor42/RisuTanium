# CHORE-138 result (Phase 3): triple-touch count reset on `touchcancel`

**Status:** proposed status for lane A to apply: FIXED on the fork (fork-only), Gate 2 `[APPROVE]`, pending the independent doc-verifier pass on this report and the commit. Real-device (Android WebView) `touchcancel` behaviour is UNVERIFIED. Short entry: [lane-cloud-records.md](../lane-cloud-records.md) (`MC-717` 1).

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-138": the triple-touch quick-menu gesture in `initHotkey()` has no `touchcancel` handling. Trace it, reproduce it, compare with upstream (`MC-069`), and fix it if the maintainer agrees. `MC-250` listed this as an accepted limitation (an Orchestrator observation, not a maintainer decision).

## Environment

- Fork: `/home/user/RisuTanium`, branch `lane-cloud`, HEAD `4455c00`. Dirty tree at the time of writing: `Agents/Lanes/lane-cloud-records.md`, `src/ts/hotkey.ts` (this work), `src/ts/characters.ts` and `src/ts/globalApi.svelte.ts` (CHORE-139, not part of this report), untracked `src/ts/hotkey.touchcancel.test.ts` (this work) and `src/ts/characters.removeCharFolderPrune.svelte.test.ts` (CHORE-139, not part of this report).
- Upstream: read-only clone of `kwaroran/risuai` at `f50b594`, outside the repository (as reported by the investigation; not re-opened for this report).
- Linux container, Vitest 4.1.11, happy-dom default environment, synthetic `Event`s on `document` with fake timers. Mocks stub imports only (`alertSelect` is the observed spy).
- Sources (session scratchpad `p3/`, not repository paths): investigation `c138/result.md`; independent verification `vfy/result.md`; implementation `c138/impl/result.md`; Gate 2 `c138/g2/result.md`.
- Gate 1 not required: tiny, low-risk carve-out (3-line change in one function, no persistence or reactive database).

## Findings

- **Premise CONFIRMED** (investigation, VERIFIED by the verifier). The triple-touch block is in `initHotkey()` at `src/ts/hotkey.ts:397-418` before the fix (`touchs` at 397, `touchstart` at 400, `touchend` at 416). `touchs++` per event; with `touchs > 2` inside 300 ms of `touchStartTime` the quick menu opens. `touchend` resets `touchs` to 0. Nothing reset it on `touchcancel`.
- **The other `touchcancel` listener does not cover this.** `hotkey.ts:568` (registered in the mobile gesture setup) only clears cancelled identifiers from the swipe map; it never touches `touchs` (verifier grep: VERIFIED). Current `touchs`/`touchcancel`/`touchend` lines were re-read for this report (see Corrections).
- **Consequence** (INFERRED from code, reproduced by the synthetic test): two touches, a cancel, then one new touch within the same 300 ms window opens the quick menu. The stale count is bounded by the 300 ms window, so it is a rare false positive only; no permanent wedge and no missed gesture.
- **Upstream:** the same triple-touch block with no `touchcancel` handling anywhere in the file (investigation, `f50b594` `hotkey.ts:261-282`). The verifier did not re-check upstream beyond the packet (low risk). The fix is fork-only.
- **Fix** (`git diff -- src/ts/hotkey.ts`, 3 added lines, `initHotkey` only), right after the `touchend` listener:

```ts
document.addEventListener('touchcancel', (ev) => {
    touchs = 0
})
```

- Closure-local: nothing else reads `touchs` or `touchStartTime` (investigation). The verifier noted that a cancel zeroing the count while other fingers remain down mirrors the existing `touchend` behaviour, so it adds no new regression class.

## What changed and evidence

- Changed: `src/ts/hotkey.ts` (+3) and the new, untracked `src/ts/hotkey.touchcancel.test.ts`.
- Test titles (`describe('triple-touch quick menu and touchcancel')`):
  - `compatibility guard: three touchstarts within 300 ms open the quick menu`
  - `two touches, a cancel, then one touch within 300 ms do not open the quick menu` (regression reproducer)
  - `compatibility guard: a count older than 300 ms cannot open the quick menu`
- Pre-fix (executed by the implementer on unmodified `hotkey.ts`): `npx vitest run src/ts/hotkey.touchcancel.test.ts` gave 1 failed, 2 passed; the reproducer failed at `expect(alertSelect).not.toHaveBeenCalled()` (called once with Presets/Persona/Loadout/Cancel). Gate 2 reproduced this on a scratch copy of HEAD `hotkey.ts`.
- Post-fix: `npx vitest run src/ts/hotkey`: 10 files, 267 tests passed (implementer; Gate 2 reran it).
- The test drives real events through `initHotkey` and observes the mocked `alertSelect`; it is not a source grep (Gate 2).

## Gates

- Gate 1: not required (tiny, low-risk carve-out).
- Gate 2 (adversarial-reviewer, ledger row 5047): `[APPROVE]`. Executed: target test 3/3; `src/ts/hotkey` 10 files, 267 tests; `NODE_OPTIONS=--max-old-space-size=8192 pnpm check` 0 errors, 0 warnings (a first run without the larger heap aborted with Node OOM, exit 134, an environment limit).
- Gate 2 mutants on a scratch copy: misspelled event name caught; no reset in the handler caught. Surviving: listener on `window` instead of `document` (equivalent, `touchcancel` bubbles); reset to 1 instead of 0; resetting `touchStartTime` instead of `touchs`. The last two are optional hardening (a test for two more touches after a cancel), not required: `MC-717` 1 says the cancel "resets the count, like `touchend`".
- Full `pnpm test` and a build were not run for this change (documentation and the 3-line fix; targeted tests and `pnpm check` only). UNVERIFIED whether the full suite is affected.

## Residuals

- Real Android WebView `touchcancel` semantics are UNVERIFIED (synthetic events only). TODO(evidence): on-device observation.
- Surviving mutants above are untested hardening.
- Option B (reset on `touchend` only when no fingers remain) and a per-finger rework were not chosen and not tested.

## Decisions

`MC-717` 1 (answer quoted exactly as recorded in [lane-cloud-records.md](../lane-cloud-records.md)):

1. CHORE-138, triple-touch gesture without `touchcancel` (two touches, a cancel, then one touch within 300 ms opens the quick menu). Answer: **"3-line fix (Recommended)"**: a `touchcancel` resets the count, like `touchend`. Fork-only; upstream has the same gap.

Related: `MC-250` (accepted limitation, superseded for this gap by `MC-717` 1), `MC-716`, `MC-069`.

## Citation mismatches

- The Roadmap/ticket text points at "about line 550" for `touchcancel`; that is the swipe-map listener (now `hotkey.ts:568`), not the triple-touch counter. Reported, not a defect in the code.

## Corrections from doc-verifier

This section takes precedence over the body above. Independent doc-verifier pass, 2026-10-23 (scratchpad `p3/c138/dv/result.md`): about 30 claims checked, none wrong; `hotkey.touchcancel.test.ts` and `windowErrorGuard.test.ts` rerun, 12 passed (3 + 9). No required corrections. The verifier re-opened upstream f50b594: `hotkey.ts` has the same triple-touch block with no `touchcancel` reset, so the "not re-opened" note above is superseded.
