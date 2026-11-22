# Stage handoff: #609 chatDrafts encode memo (single stage)

## 1. Completed PR and commit
- PR https://github.com/yor42/RisuTanium/pull/635 (closes the issue at merge). Branch `claude/609-drafts-memo-480186`.
- Reviewed change: commit 643664a7c. 29032f886 merges origin/main 72a7e32a4 without touching the six changed files.

## 2. Decisions
- One memo slot per save encoder: the last framed draft list and its digest, filled while planning, because the save loop
  never acknowledges an unchanged plan (Gate 1 round 1 reject of plan 1).
- Every pass still copies and compares the whole live list. No dirty mark was narrowed. Reuse needs equal length, equal
  value and the previous unit's digest equal to the slot's.
- A compare that throws counts as not equal and goes on to the normal encode (Gate 1 round 2 E1, orchestrator arbitration).
- No maintainer decision was needed (grilling found no open question), so no MC entry. MC-3704..3713 are unused.
  Context: MC-3585 (the 200 cap), MC-3615 (priority).

## 3. Changed files
- `src/ts/storage/store2/codec/split.ts`, `src/ts/storage/store2/codec/types.ts`, `src/ts/storage/store2/saveEncoder.ts`
- `src/ts/storage/tests/store2/chatDraftsMemo.svelte.test.ts` (new), `src/ts/storage/tests/store2/chatDraftsN2.test.ts`,
  `src/ts/storage/tests/globalApi.saveStore2.svelte.test.ts` (one test)

## 4. Tests and evidence
- Red before green: on 51dba53a3 the new tests give 14 failures, all on re-encode counts (13 in the memo file, one
  save-loop test); green with the change.
- Mutants: M1-M14 killed at Gate 2, and X9r, X10r, X14 by the final test lines.
- Gate 2 differential against the base: 68,860 plans, identical.
- Before the last test-only edit: store2 folder, save-loop host file and draft store suites, 8,926 passed.
  After the main merge: the chatDrafts suites, workspaceMemo and the save-loop host file, 161 passed; svelte-check 0 errors.
- N2, i9, later unchanged plans at the cap, ten runs: 7.0-10.0 ms before, 1.3-1.9 ms after, 0.8-1.7 ms without drafts.
- Gates: Gate 1 [REJECT] then [EDITORIAL]; Gate 2 [EDITORIAL] with closure. Dispositions are in the PR body.
- CI: TODO(evidence), see the PR's checks.
- Device: Note 9 A/B save-pass timing with 200 drafts (boot, no edit, no commit), requested from lane B at PR open.
  PENDING; merge waits for PASS or a maintainer waiver. The PR body holds the row's state.

## 5. Unresolved
- The known limitations in the PR body (accepted, no follow-up).
- Unrelated, forwarded to lane A: `ffPresetInUse.test.ts` U0 fails under CPU load on the base and the change alike
  (5 of 5 at 5 copies on 2 CPUs) and is not in `flake-list.json`.

## 6. Next stage
- None remains. After merge: confirm the issue closed and the board card moved.
