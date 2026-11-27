# CI gate and merge mechanics (#841, MC-4490 to MC-4495)

Main will require a pull request and one passing status check, named exactly **`CI gate`**, with no bypass (maintainer decision 2026-11-27, MC-4490). This file is for lane A, which switches the ruleset on after this PR is merged and a push run on main has reported the check. Nothing here changes the approval matrix in [gates](gates.md#approval-matrix-mc-2744): PR sessions never merge, lane A merges, red CI the session cannot clear goes to the maintainer, nobody pushes to main.

## What `CI gate` reports

`.github/workflows/ci.yml` runs on every pull request, with no path filter, because a required check that a path filter skipped never reports and the PR waits forever. Its first job, `Decide what to run`, calls `.github/scripts/ci-relevance.sh` on the files the PR changes (the merge of its head into the current base). The last job, `CI gate` (`if: always()`, no permissions, no checkout), is strict in both directions:

| Change | `Decide what to run` | Unit tests / check / node-server | `CI gate` |
|---|---|---|---|
| Docs only (Markdown, `Agents/**`, `docs/**`, except `docs/design/**` non-Markdown files and everything under `Agents/Tools`, `src` and `theme-packs`, which tests read) | success, relevant=false | skipped | success |
| Anything else, including `.github/**`, `docs/design/**` non-Markdown, `Agents/Tools/**`, `src/**` and `theme-packs/**` | success, relevant=true | all must succeed | success only if all succeeded |
| `changes` failed, or a heavy job failed, was cancelled or was skipped by an upstream failure | | | failure |
| Heavy job ran although relevant=false, or relevance unreadable | | | failure |

Any doubt (other event, `workflow_dispatch`, a push that is not a plain merge onto main, a diff error, an empty path list) means relevant=true. A skipped job counts as passing for a required check, which is why the gate must run with `always()` and compare results itself. Re-running failed jobs re-evaluates the gate. After retargeting a PR to another base, re-push or close and reopen it: `pull_request` does not fire on a base change, so the old green was computed against the old base. Never dispatch CI on a PR branch to clear a red gate; re-run the PR's own run.

Repository tests for these rules are `.github/scripts/*.test.sh` (Git Bash or Linux); the `changes` job runs them first, so an edit that breaks the rules or the gate text turns every PR red. A PR can also edit the gate itself; see Limits.

## Ruleset settings for lane A

Set only after this PR is merged and a push run on main shows `CI gate` (GitHub offers a check only once it has reported):

- Target the default branch; the bypass list is empty.
- Require a pull request: 0 required approvals, code-owner review off (a solo maintainer cannot approve their own PR; `.github/CODEOWNERS` is advisory), allowed merge method `merge` only.
- Require status checks: context `CI gate`, integration GitHub Actions, so no other app or API status can satisfy it. "Require branches to be up to date" stays off: strict mode would force an update and rerun loop on every merge, and the merge-ref run plus the post-merge push run cover the interaction (MC-4491).
- Keep the existing `default` ruleset (deletion, non-fast-forward).
- Enable the repository setting "Allow auto-merge"; `--auto` needs it.
- `rust-check` and `docker-check` keep their path filters, `codeql` runs on a schedule; all stay non-required; making them required brings the never-reports problem back.

## Merging with the gate

```
gh pr merge <n> --repo yor42/RisuTanium --auto --merge --match-head-commit <sha>
```

`--merge` is a merge commit, never squash. `--auto` waits for `CI gate` and merges when it passes. `<sha>` is the head the Gate 2 review covered; a head that moved after review no longer matches. If GitHub fires the auto-merge after a later push anyway (not verified), merge by hand with `gh pr merge <n> --repo yor42/RisuTanium --merge --match-head-commit <sha>` once green. A docs-only PR still gets the import check in [CI ownership](gates.md#ci-ownership-mc-2014-mc-2036-mc-2240) before it is queued, since a green gate no longer says that nothing CI-covered reads the changed file.

## Related files

- `.github/scripts/vitest-summary.mjs`: each unit-test shard lists its failures (name and assertion, a few lines each) in its job summary next to the `github-actions` reporter's annotations.
- `.github/CODEOWNERS`: protected paths only, advisory.
- `.github/labeler.yml` and `.github/workflows/labeler.yml`: `area:*` labels from changed paths, additive, on `pull_request`.
- Limits: a PR may edit `ci.yml` and the gate itself, so its own run proves little about them; `.github/**` is always heavy, Gate 2 reads the workflow, and the push run after merge re-tests. Third-party actions added here are SHA-pinned; the existing `actions/checkout`, `pnpm/action-setup` and `actions/setup-node` stay on version tags as before.
