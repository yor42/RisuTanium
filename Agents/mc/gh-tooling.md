### MC-4490 — #841 Main requires a PR and the check `CI gate`, no bypass, no review, 2026-11-27

- Tag: decisions (maintainer, via lane A brief). Date: 2026-11-27. Exact times: UNKNOWN. Sweep ref: none. Related: `#841`, `MC-2744`, `MC-2778`.

**What was decided.** main will require a pull request and a passing check named `CI gate` with no bypass (the maintainer's account and lane A are the same GitHub user), 0 approvals, code-owner review off. Lane A switches the ruleset on after #841 merges and a main push run has reported the check. The approval matrix of MC-2744 is unchanged. Wording for lane A: `docs/workflow/ci-gate.md`.

### MC-4491 — #841 Relevance moved from workflow triggers into a `changes` job, 2026-11-27

- Tag: decisions (session, Tier 2, Gate 1 approved with editorial items). Date: 2026-11-27. Exact times: UNKNOWN. Sweep ref: none. Related: `#841`.

**What was decided.** `ci.yml` has no path filter. `Decide what to run` runs `.github/scripts/ci-relevance.sh` on `git diff HEAD^1 HEAD` of the merge ref; the skip set is the old one (`*.md`, `Agents/**`, `docs/**` except `docs/design/**`) minus the roots tests read: `Agents/Tools`, `src` and `theme-packs` (Gate 2 found 6 vitest-collected files and several README and data reads there); any doubt means run everything. `CI gate` (`if: always()`, `permissions: {}`) requires the heavy jobs to be success when relevant and skipped when not, and `changes` to be success. A push to main uses the same decision (parity with the old filters). Branch up-to-date stays off in the ruleset. Markdown under `src` and `theme-packs` is therefore heavy, a change from the old filters.

**Evidence.** `.github/scripts/ci-relevance.test.sh` and `ci-gate.test.sh` (gate text extracted from `ci.yml`); mutants killed in the designer's prototype; runner proofs are recorded in the PR.

### MC-4492 — #841 Vitest shards use three reporters plus a failure list, 2026-11-27

- Tag: decisions (session). Date: 2026-11-27. Exact times: UNKNOWN. Sweep ref: none. Related: `#841`.

**What was decided.** Naming `--reporter` drops vitest's CI default, so each shard lists `default`, `github-actions` (annotations) and `json`; `.github/scripts/vitest-summary.mjs` appends a bounded failure list to the shard's job summary, never fails the job, and a missing report becomes a one-line note.

### MC-4493 — #841 CODEOWNERS is advisory, 2026-11-27

- Tag: decisions (session). Date: 2026-11-27. Exact times: UNKNOWN. Sweep ref: none. Related: `#841`.

**What was decided.** `.github/CODEOWNERS` names `@yor42` for the protected paths only and does not require review; the ruleset keeps code-owner review off because a solo maintainer cannot approve their own PR.

### MC-4494 — #841 Path labeler on `pull_request`, existing labels, additive, 2026-11-27

- Tag: decisions (session). Date: 2026-11-27. Exact times: UNKNOWN. Sweep ref: none. Related: `#841`.

**What was decided.** `actions/labeler` (SHA-pinned, v7.0.0) runs on `pull_request`, never `pull_request_target`, with `contents: read` plus `pull-requests: write` on the one job; fork and Dependabot PRs are skipped. `sync-labels` is off. `ui`, `performance`, `characters` and `statistics` have no unambiguous path and are not mapped.

### MC-4495 — #841 Merge mechanics, 2026-11-27

- Tag: decisions (session). Date: 2026-11-27. Exact times: UNKNOWN. Sweep ref: none. Related: `#841`, `MC-2778`.

**What was decided.** Lane A merges with `gh pr merge <n> --repo yor42/RisuTanium --auto --merge --match-head-commit <sha>` (merge commit, head SHA that Gate 2 reviewed). A docs-only PR keeps the import check in gates.md "CI ownership" before it is queued.
