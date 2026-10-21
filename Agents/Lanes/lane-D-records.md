# Lane D records

Lane D (UI lists and small items), branch `worktree-Lane-D`. Rules: [README.md](README.md); brief: [lane-D-brief.md](lane-D-brief.md). IDs: MC-375 to MC-394, CHORE-240 to CHORE-259, ledger rows 2500 to 2699 (overflow MC-410 to 419, CHORE-310 to 319, rows 3100 to 3199). Lane A folds these sections into the shared records files at merge.

## MC entries

### MC-375 — Lane D, 2026-10-21: S4-4 Grid drag plan answers (Q1 to Q12) and the folder-removal confirmation

- **Tag:** decisions (`AskUserQuestion` answers by option label, with the maintainer's own text where given)
- **Date:** 2026-10-21
- **Sweep ref:** none (stated directly this session)
- **Source:** this lane D session's two `AskUserQuestion` rounds on the S4-4 plan (`%TEMP%\risu-lane-d\s4-4\plan-s4-4.md`, section 4, Q1 to Q12).
- **Reasoning:** none stated, except the maintainer's own text in item 2.
- **Alternatives rejected:** the unchosen option labels, per item below.
- **Related:** `MC-277` 10, 11, 15 and 16, `MC-278` 8, `MC-279`.

**What was decided:**
1. **Q1, the long press that enters edit mode: "Let go, then hold again (Recommended)".** The entering press only enters edit mode; a second 500 ms hold lifts. Alternative: "Same press can drag".
2. **Q6, a dragged selection that includes a folder tile, dropped into an open folder or onto a folder tile:** the maintainer chose "Other" and wrote: "Folder's characters join, but with confirmation prompt. as it will delete the existing folder." Options offered: "No target there (Recommended)", "Folder's characters join".
3. **Follow-up to item 2, the dwell merge (`MC-277` 16) with a dragged folder: "Yes, same prompt (Recommended)".** Option text: "Any drop that would remove a dragged folder (append into a folder or dwell-merge onto a character) asks first, naming the folder(s). Drops without a folder in the drag never ask. Group into new folder (S4-3) stays as shipped, no prompt." Alternative: "Only into-folder drops".
4. **Q7, the selection after a drop: "Keep after move, clear after merge (Recommended)".** Edit mode stays in every case. Alternatives: "Always clear", "Always keep".
5. **Q2 to Q5 and Q8 to Q12: "Accept all (Recommended)".** The option was summarised to the maintainer as follows: mouse drag in edit mode only; the rail's drop look (faded tiles, a ghost with a count badge, a 3 px bar, a ring on the target); the ring only once the 400 ms dwell arms; closed and open folder tiles both append at the end, with no spring-open; a drop between open-folder members inserts there; "Moved 1 item" / "Moved N items" for drops and the rail's existing move wording for Alt+Left/Right; no-op drops are silent; dragged tiles are not merge targets; the edge-scroll speed is unchanged. The full recommendation texts are in the plan, section 4. Alternative: "I'll go through them".

### MC-376 — Lane D, 2026-10-21: the CHORE-192 commit on the lane branch and the S4-4 folder-removal confirmation wording

- **Tag:** decisions (`AskUserQuestion` answers by option label)
- **Date:** 2026-10-21
- **Sweep ref:** none (stated directly this session)
- **Source:** this lane D session's `AskUserQuestion` round after the CHORE-192 checks and records verification (ledger rows 2501 to 2505).
- **Reasoning:** none stated.
- **Alternatives rejected:** the unchosen option labels, per item below.
- **Related:** `MC-375` 2 and 3, CHORE-192, `MC-058` (translations).

**What was decided:**
1. **The CHORE-192 commit: "Commit on the lane branch (Recommended)".** Option text: stage only `src/ts/plugins/apiV3/risuai.d.ts`, `src/ts/plugins/apiV3/tests/v3DeclarationDocs.test.ts` and `Agents/Lanes/lane-D-records.md`, commit on `worktree-Lane-D`, nothing pushed. Alternatives: "Show me the message first", "Hold until S4-4".
2. **The English text of `othersUi.editFolderRemoveConfirm` (S4-4b): "Short + what's lost (Recommended)".** Preview shown: one folder: `Remove the folder "Alpha" and move its characters here? Its name, colour and picture are not kept.`; two or three folders: `Remove the folders "Alpha" and "Beta" and move their characters here? Their names, colours and pictures are not kept.`; four or more: `Remove the folders "Alpha", "Beta", "Gamma" and 2 more, and move their characters here? Their names, colours and pictures are not kept.` Alternative: "Short" (the same without the second sentence). The translator fills the six other locales (`MC-058`).

## CHORE entries

### CHORE-192 — The `addTTSPreprocessor` JSDoc example in `risuai.d.ts` closes the comment early (status update)

**Status (2026-10-21, lane D): fixed in the working tree, technically accepted, awaiting the maintainer's commit approval.** Ledger rows 2501 to 2504.

- **Mechanism (executed):** the example regex `/\*(.*?)\*/g` contains `*/`, which ends the JSDoc block. The TypeScript parser then reports 110 syntactic diagnostics, from 1941:56 ("Property or signature expected.") to the end of the file, so everything after the example parses as broken code. `pnpm check` never reported it: the file is inside the `tsconfig.json` `include`, but `skipLibCheck: true` skips `.d.ts` files. No other `*/` occurs inside a comment body in the file (coder's and reviewer's scans).
- **Fix:** the example now reads `/\*(.*?)[*]/g`, which matches the same text (the reviewer compared both on `a *b* c`, `**`, `*x*y*`, `*a* *b*` and `a*b`). One line; the file stays CRLF.
- **Test:** new `src/ts/plugins/apiV3/tests/v3DeclarationDocs.test.ts` (CRLF). It parses the file with the TypeScript compiler API and asserts (1) `getSyntacticDiagnostics` returns nothing and (2) the `addTTSPreprocessor` method's `@example` contains `ctx.text.replace(` and `});`. Regression reproducer: both tests fail on a copy with the original line (110 diagnostics from 1941:56; "expected undefined to be defined") and pass on the fixed file.
- **Checks on the final tree:** `pnpm check` 0 errors and 0 warnings; `pnpm test` 899 files passed, 1 skipped, 20,189 tests passed, 23 skipped, exit 0; `pnpm build` exit 0 (`%TEMP%\risu-lane-d\chore192\full-test.txt`, `full-build.txt`). The tree also held the uncommitted `Agents/Lanes/lane-D-records.md` (documentation only).

## Ledger rows

| # | Date | Question | Tier(s) | Tokens | Escalated? | Outcome |
|---|---|---|---|---|---|---|
| 2500 | 2026-10-21 | Rebuild the S4-4 (Grid drag) plan from the Roadmap, the MC entries and the current code; the old plan files are gone | `investigator`, id `a01f5f0b392f1b4bf` | not recorded | n/a (plan) | `%TEMP%\risu-lane-d\s4-4\plan-s4-4.md` at `e8fd39618`, read-only. Refuted or corrected: `moveManyToGap` does not exist (0 grep matches); R5 is already guarded in `railDrag.ts` `pointerUp`; source-gone cancellation is already active for presses that start in edit mode; edge scroll needs host-tracked travel; the `characterOrder` save path is unchanged. Sub-stages 4a (pure), 4b (Grid wiring), 4c (Alt+Left/Right). Twelve product questions, answered in `MC-375`; revision 2 (same file) applies the answers, including the Q6 folder contribution with a confirmation. The old Gate 1 amendments A4-1 to A4-17 are known only from their Roadmap summaries. Not independently verified yet (Gate 1 pending). |
| 2501 | 2026-10-21 | CHORE-192: reproduce and fix the early JSDoc close in `risuai.d.ts` | `sonnet-coder`, id `a8255af79bc10d679` | not recorded | n/a (implementation) | Parse finding: 110 syntactic diagnostics from 1941:56, hidden from `pnpm check` by `skipLibCheck`. One-line fix to `/\*(.*?)[*]/g`; new parser-based test, red 2 of 2 before the fix, green 2 of 2 after; `pnpm check` 0 and 0; eol preserved (CRLF). The first write was refused until an exact instance grant was registered (2 files), revoked after the hand-back. Report: not retained (the file named in the hand-back does not exist); evidence: `red.txt`, `green.txt`, `check.txt` in `%TEMP%\risu-lane-d\chore192\`. |
| 2502 | 2026-10-21 | Gate 2, CHORE-192 | `adversarial-reviewer`, id `ad66798f25061fb97` | not recorded | Gate 2 | `[EDITORIAL]` (`%TEMP%\risu-lane-d\chore192\review\gate2.md`): same regex matches on five inputs; red on a scratch copy with the original line (both tests fail), green on the fixed copy; no other `*/` in a comment body; two editorials: use the public `Program.getSyntacticDiagnostics` instead of a cast to the internal `parseDiagnostics`, and convert the new test from LF to CRLF (all sampled repo test files are CRLF). Both applied by the orchestrator. |
| 2503 | 2026-10-21 | Gate 2 delta, CHORE-192 editorials | `adversarial-reviewer`, id `ad66798f25061fb97` (resumed within minutes) | not recorded | Gate 2 (delta) | `[APPROVE]`: no cast; CRLF 53, bare LF 0; red rerun on the original copy (110 diagnostics from 1941:56) and green on the fixed copy; the custom host cannot hide syntactic diagnostics (by reading; the red run shows none are hidden). |
| 2504 | 2026-10-21 | Full checks on the CHORE-192 tree | orchestrator | n/a | n/a (checks) | `pnpm check` 0 errors, 0 warnings; `pnpm test` 899 files passed, 1 skipped, 20,189 tests passed, 23 skipped, exit 0; `pnpm build` exit 0. |
| 2505 | 2026-10-21 | Verify the lane D records (CHORE-192 entry, rows 2500 to 2504, `MC-375` format) | `doc-verifier`, id `ac599731b50ddec11` | not recorded | n/a (verification) | 14 claims: 10 VERIFIED, 2 CORRECTED, 2 UNVERIFIABLE (the write-grant refusal, agent ids and resume timing, which only the orchestrator session holds). Corrections applied: row 2501's report path (the file does not exist) and the file's line endings (LF to CRLF, to match `Agents/Lanes/`). It reran the new test (2 of 2 passed). Overall PASS WITH FIXES. |

## Handoff

- 2026-10-21: lane started. Branch fast-forwarded from 74b28ddd1 to e8fd39618 (`origin/main`, which adds `Agents/Lanes/` and CHORE-195). First stage: character list S4-4 (drag), Gate 1 with `opus-reviewer`.
