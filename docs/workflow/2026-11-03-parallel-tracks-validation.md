# Parallel-track amendment validation — 2026-11-03

Status: ACTIVE, independently approved. Scheduling amendment `2026-11-03-parallel-records` is additive to policy revision `2026-11-03.1`; it preserves existing saved dispatches and current worker ownership. Authority and procedures are in [parallel tracks](2026-11-03-parallel-tracks.md); the [independent implementation review](reviews/2026-11-03-parallel-records.md) records exact reviewed identities, two corrected admission findings, and the fixture-renaming addendum.

## Observed validation

- All 19 controller, parallel-track and registered-integration tests passed on the corrected implementation. Cases include two actual code writers plus separate records/device/read-only work, per-track caps, cross-class file/resource collisions, Windows path spelling, cross-kind filesystem-resource identity, clerical authority, primary Haiku admission, legacy unclaimed/running records, unchanged correction lineage, and real temporary Git worktrees at an explicit base sharing one coordinator.
- Active workflow validation passed with 17 profiles, 13 skills, four path rules and current decision index. Document counts can advance as the live campaign and this closeout add records. The parent did not change the ongoing campaign's canonical records, current state, registered dispatches, grants or actual worktrees.
- `route --job records-routing-check --mode implement --work-class records` selected native `record-clerk`, `haiku`, `low` with no external preflight. This is routing evidence; no provider inference or production records worker was launched by this amendment.
- The unchanged existing write-guard exclusions were inspected, preserving clerk limits on decisions, governance, generated index and state. Existing compatibility, independent acceptance and paid/provider activation limits remain.

These are orchestration fixtures, not observed simultaneous production device/code throughput, model usefulness or measured quota savings. No application implementation, device run, commit or push was performed here.

## Workflow fixtures separated from application discovery

The earlier external Node fixtures matched Vitest's normal application test filename pattern. Current records reported those files among failing application-test files. They are renamed without content changes:

| Historical name | Current explicit Node fixture | SHA-256 |
|---|---|---|
| `Agents/Tools/external/workspace.test.mjs` | [workspace.node-check.mjs](../../Agents/Tools/external/workspace.node-check.mjs) | `bc919f5a2fadf395e65f3af603401ba0b4f1cb48e3e151a0460c5a78254c9292` |
| `Agents/Tools/external/worker.test.mjs` | [worker.node-check.mjs](../../Agents/Tools/external/worker.node-check.mjs) | `0f4ec6f683b34a3899fb15f09e6d6248328207d5f02d9f30f088c63f158ac323` |

Both hashes match the original cutover review. Historical reports retain the names used at their observation. Explicit execution of the renamed files with `node --test` passed all 16 cases, including temporary Windows junction fixtures. The installed Vitest `list --filesOnly Agents/Tools/external` returned exit 0 and no test files after the rename. The application Vitest configuration was not changed and the full application suite was not run. The known unrelated root test was preserved.

Use these explicit commands for the checks performed here:

```powershell
node --test .claude/scripts/workflow-control.test.mjs .claude/scripts/workflow-parallel.test.mjs .claude/scripts/workflow-integration.test.mjs
node --test Agents/Tools/external/workspace.node-check.mjs Agents/Tools/external/worker.node-check.mjs
node node_modules/vitest/vitest.mjs list --filesOnly Agents/Tools/external
& .claude/scripts/validate-workflow.ps1
```

The installed Vitest entry point was used directly because the environment's `pnpm` shim attempted a package-manager metadata lookup and could not reach the registry; no dependency was installed or changed. Real campaign workers and the next records owner retain their normal authorization. The next records pass may record the supplied maintainer decision once IDs/ownership are confirmed; this closeout invents no MC allocation and does not race the active records writer.
