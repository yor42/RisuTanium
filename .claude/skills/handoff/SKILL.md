---
name: handoff
description: Writes a step handoff file so a fresh orchestrator session can continue without the old context.
disable-model-invocation: true
---

Write the handoff to `Agents/Handoff-<date>-<step>.md` (English, compact, under about 40 lines). Gather facts with `git status`, `git log` and the actual check logs; do not recall from memory. Sections:

1. Goal and done-criteria of the step.
2. Base and dirty state: branch, HEAD, worktrees, untracked files. Never touch others' dirty files; list them as not yours.
3. Changes made: commits (hash and subject) and uncommitted work.
4. Decisions with MC IDs; mark any maintainer question still open.
5. Checks run: command, result, exit code, log path and the snapshot checked.
6. Not yet verified: gates, checks and records still owed.
7. Next concrete actions, in order, each with its owner.
8. Uncertainty: assumptions, stale evidence and anything the next session must recheck.

Then point the current-state section of `Agents/Live-State.md` at the new file with one line. Never invent a check, hash or verdict; missing evidence is `TODO(evidence)`. The next session first checks the handoff against `git status` and `git log` ([records](../../../docs/workflow/records.md)).
