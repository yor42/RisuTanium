# Handoff 2026-10-21: upstream 61d0eb79a merge, base64 and README landed; device-check scripts next

Written from `git status`, `git log` and `git worktree list` (read at writing), the check logs named below and the verifier verdicts. The next session first checks this file against `git status` and `git log`.

## 1. Goal and done-criteria

- **Upstream merge 979dbc9d5..61d0eb79a.** Stages U0 to U5, each with its own Gate 2, merged no-ff into `main` as `2862940fe`, and pushed. The merge-base for the next merge is `61d0eb79a`. COMPLETE: records `c4f17878c`, doc-verified.
- **Base64 encoder.** Merged to `main` as `ac5b4e105`, via `cd49e8271`, and pushed. COMPLETE.
- **README "What's different from upstream" brought current.** Commit `e4c5bd772`, doc-verified by two passes. COMPLETE. The new standing rule MC-332 updates this list in every records pass whose merge changes something a user sees.
- **H0 hooks removed** (MC-322 4). Done in this handoff's commit.

## 2. Base and dirty state

- **Main.** `main` at the commit carrying this file; parent `e4c5bd772`.
- **Not yours on main. Leave alone, never stage:**
  - modified: `.claude/launch.json` and `docs/branding/RisuTanium_Gradient.svg`;
  - untracked: `0`, `Agents/Handoff-2026-10-08.md`, `Agents/Handoff-2026-10-08/` and `docs/planning/`.
- **Worktrees:**
  - `upstream-61d0` is at `2c42d9423` and merged. It has a modified `modules.test.ts.snap`, an untracked 0-byte `lib.mjs` and an untracked `results.md`, all of unknown origin and not ours.
  - `b64-transport` is at `cd49e8271` and merged. Its `modules.test.ts.snap` is also modified; this appeared after a full `pnpm test`, and its origin is not checked.
  - `alite-s4`, `alite-s4-b4`, `alite-s4-dev1` and `qol` are older and were not touched.
  - Removing the merged worktrees is the maintainer's call.
- **Upstream clone.** `C:\Projects\RisuAI-upstream` is left detached at `61d0eb79a`, clean.

## 3. Changes made (all on main, pushed)

- `2862940fe` merge, with stage commits:
  - U0: `c68baaf15`, `f31eaf819`, `76a36fac5`, `e49be4314`.
  - U1: `aff3cfa67`, `693632e1e`.
  - U2: `41c18917e`.
  - U3: `a50298593`, `f6894f96d`, `b86b6df2d`, `40145cda0`, `cee2effb5`, `75a68bba0`.
  - U4: `28217226f`, `ba8fa93b3`.
  - U5: `2c42d9423`.
- `ac5b4e105` base64 encoder, merged through `cd49e8271`.
- `c4f17878c` records: `Upstream-Merges.md` section, MC-331, ledger rows 2074 to 2094, CHORE-187 to CHORE-193, Live-State.
- `e4c5bd772` README, MC-332, the `docs/workflow/records.md` rule, the CHORE-50 status (fixed by `a29335f76`).
- This commit: the H0 wiring removed from `.claude/settings.json`; `.claude/scripts/hook-log.mjs` deleted (the H3 status line stays); this file; the Live-State pointer.
  - Its logs remain under `%TEMP%\risu-hooklog\`.

## 4. Decisions

- **MC-330:** the standing device-check rules.
- **MC-331:**
  1. SaveKV is JSON-equal: keys are sorted by store2, the loss is accepted.
  2. Merge and push.
- **MC-332:**
  1. The README rule, applied per merge that changes something a user sees.
  2. Base64 is folded into the README when faster import/export lands.
- **Still open for the maintainer:**
  - The S2a I1 / S3 R1 plugin-index snapshot case (`Upstream-Merges.md`).
  - The stub-export decision (MC-318 7).

## 5. Checks run

- **Upstream branch at `ba8fa93b3`:**
  - `pnpm check` 0/0 and `pnpm build` OK.
  - `pnpm test`: 20,097 passed, 2 ModelList failures, fixed by `2c42d9423` (82/82 targeted).
  - Logs: `%TEMP%\risu-b715\upstream-e773240\u5\`.
- **Combined snapshot `cd49e8271`:**
  - `pnpm check` 0/0 and `pnpm build` OK.
  - `pnpm test`: 20,108 passed, 1 failed, the `assetPieceSave` 5 s timeout, a load flake that passed 23/23 three times alone (CHORE-193).
  - Logs: `%TEMP%\risu-b715\b64\full\`.
- **U5 PC round trip against upstream `61d0eb79a`:**
  - K1, K2, K3, P1 and S1 PASS on decoded data, on synthetic files, one PC, single runs.
  - Doc-verified: 15 of 18 claims verified, none wrong.
  - Results: `%TEMP%\risu-b715\u5\rt\results.md`.
- **This commit:**
  - `validate-workflow.ps1` passed, with 331 index entries.
  - `settings.json` parses.

## 6. Not yet verified

- Device time breakdown (`%TEMP%\risu-b715\devtime\report.md`): verified with corrections, but the cause of the polling stalls is UNKNOWN.
- The upstream merge has no device run against `61d0eb79a`. D10 ran on the PC only.
- The README's model-data download and peer prompts are traced in code only, not run.

## 7. Next actions (orchestrator unless stated)

1. **Device-check scripts and app-data snapshot/restore (MC-330 item 7).**
   - The scripts exit on done, crash or app-not-running, with a cap.
   - First replay one capped poll to find the stall cause.
2. **MC-323 / MC-328 sequence.**
   - The Note 9 measurement day goes on the second Note 9; the maintainer sets it up.
   - Then the page fixes. MC-081 versus the tail-locate is a Gate 1 point.
   - Then the native task.
3. **Housekeeping.**
   - Delete the large tail-test `.bin` files and the D6c 18 GB synthetic data in `%TEMP%\risu-b715\`, once they are no longer needed.
   - Ask the maintainer about removing the merged worktrees.

## 8. Uncertainty

- The two modified `modules.test.ts.snap` files and the worktree `lib.mjs` / `results.md` have unknown origin.
- Every performance number is from the i9 PC or one Note 9: a best case.
