# CHORE-143 result (Phase 3): premise refuted, already fixed on the fork

**Status:** proposed status for lane A to apply: CLOSED as already fixed on the fork by `src/ts/windowErrorGuard.ts` (`bootstrap.ts` delegates to it). Covered by the existing `src/ts/windowErrorGuard.test.ts`. No code change in this lane. Upstream still has the defect. Short entry: [lane-cloud-records.md](../lane-cloud-records.md) (`MC-717` 3).

## Question / ticket ask

`Agents/Roadmap.md`, "### CHORE-143": the global window `error` handler in `bootstrap.ts` reads `event.error.target` when `event.error` is null, so it throws before `alertError`. Trace and reproduce (`MC-069` for upstream); change no application code.

## Environment

- Fork: `/home/user/RisuTanium`, branch `lane-cloud`, HEAD `4455c00`. `bootstrap.ts`, `windowErrorGuard.ts` and `windowErrorGuard.test.ts` have no uncommitted change (investigation `git diff HEAD --stat` empty; `git status --short` for this report lists none of them). Other dirty paths belong to CHORE-138 and CHORE-139 and are not part of this report.
- Upstream: read-only clone of `kwaroran/risuai` at `f50b594`, outside the repository (as reported by the investigation).
- Linux container, Vitest 4.1.11, happy-dom. Scratch guard test outside the repository.
- Sources (session scratchpad `p3/`): investigation `c143/result.md`; independent verification `vfy/result.md`.

## Findings

- **Premise REFUTED at HEAD** (investigation, VERIFIED by the verifier for file existence and the scratch rerun).
- Line numbers below were re-read for this report (the verifier left them UNVERIFIED):
  - `src/ts/bootstrap.ts:14` imports `handleWindowError` from `./windowErrorGuard`.
  - `updateErrorHandling()` is at `bootstrap.ts:996-1010`; it is called at `:578`. The `error` listener (`:997-1003`, registered at `:1008`) calls `handleWindowError(event, { warn, error, report })` with `console.warn`, `console.error` and `alertError`.
  - `windowErrorGuard.ts:12-22` `classifyWindowError`: `error` null or undefined gives `ignore`; an error whose `target` is a `Worker` gives `log`; anything else gives `report`. `handleWindowError` is at `:34-45`: `ignore` calls `warn(message)` only; `log` calls `error` only; `report` calls `error` then `report`. The header comment (`:1-9`) names the ResizeObserver "loop completed with undelivered notifications" case as benign: warned, never shown.
- **Existing test** `src/ts/windowErrorGuard.test.ts` titles (read for this report): `classifyWindowError`: `(R) an event without an error object is ignored, where the earlier expression threw`, `(G) an Error is reported`, `(G) a thrown string or plain object is reported`, `(G) an error raised by a worker is logged and not reported`, `(G) in an environment without Worker nothing is taken for a worker error`, `(G) an error whose target is something else is reported`; `handleWindowError`: `(R) an event without an error object warns its message and neither logs an error nor shows an alert`, `(G) an Error is logged and reported, and not warned`, `(G) a worker error is logged and not reported`. Assertions inside the cases were not re-read (UNVERIFIED beyond titles).
- **Scratch guard** (executed by the investigation, rerun by the verifier: 3 passed): a `window` `ErrorEvent` with `error: null` and a ResizeObserver message goes through the real `handleWindowError` with bootstrap-equivalent wiring (replicated, because `updateErrorHandling` is not exported): no throw, warn called, report and error not called; the old expression throws `TypeError`; a real `Error` is reported. It passes at HEAD, so it is a compatibility guard, not a failing reproducer (the pre-fix base is the upstream code).
- **Upstream:** `bootstrap.ts:293-298` still has `console.error(event.error); if(!(event.error.target instanceof Worker)) alertError(event.error)`, which throws when `error` is null (investigation). The rejection handler is the same as the fork's. No upstream guard file.
- **Unhandled-rejection branch** (`bootstrap.ts:1004-1007`) is unchanged: `console.error(event.reason); alertError(event.reason)`. It does not dereference the reason. What `alertError` shows for an `undefined` rejection was not traced (UNVERIFIED).
- **Side effect:** every null-error window event is now warn-only, including a cross-origin "Script error." (browser behaviour UNVERIFIED here). Resource load errors do not reach the non-capture window listener (INFERRED from the DOM spec). The "null means ignore" rule is a code-level decision from sidebar Stage 2a; no MC entry records it (INFERRED; grep of Maintainer-Context and Decision-Index found only unrelated sidebar entries).
- **Roadmap:** `Agents/Roadmap.md:6541-6543` is the CHORE-143 entry and still says "Status (2026-10-08): open" with a trace TODO (stale). `Agents/Roadmap.md:7354` (Stage 2a) lists `windowErrorGuard.ts`. Lane A edits the Roadmap; this lane did not.

## What changed and evidence

- No application code and no test changed. Nothing new to commit for this ticket except this report and the records entries.
- Blast radius: one caller of `handleWindowError` (`bootstrap.ts:998`, investigation).

## Gates

No Gate 1 or Gate 2: no code change. Independent verification of the investigation: ledger row 5043 (`vfy/result.md`), no corrections required, with the line-number caveat resolved above. The independent doc-verifier pass on this report is the Orchestrator's to dispatch; none has been claimed.

## Residuals

- Options not taken: stay warn-only for all null-error events (taken, below); alert unless the message is a ResizeObserver one; `console.error` without alert.
- Exporting and testing the real `updateErrorHandling` wiring (low value, not done).
- `alertError` output for an `undefined` rejection reason: UNVERIFIED.
- Upstream still has the defect; the fork does not need to carry it.

## Decisions

`MC-717` 3 (answer quoted exactly as recorded in [lane-cloud-records.md](../lane-cloud-records.md)):

3. CHORE-143, already fixed on the fork (null-error window events are warn-only, which also silences cross-origin "Script error." events). Answer: **"Keep silent, close (Recommended)"**: close the ticket as already fixed.

Related: `MC-716`, `MC-069`.

## Citation mismatches

- `Agents/Roadmap.md:6541-6543` says open and the trace is a TODO; HEAD already contains the fix (stale, to be corrected by lane A).

## Corrections from doc-verifier

This section takes precedence over the body above. Independent doc-verifier pass, 2026-10-23 (scratchpad `p3/c138/dv/result.md`): about 30 claims checked, none wrong; `hotkey.touchcancel.test.ts` and `windowErrorGuard.test.ts` rerun, 12 passed (3 + 9). No required corrections.
