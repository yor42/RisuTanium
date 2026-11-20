---
name: close-item
description: Completes proportionate evidence-backed administrative closeout after technical acceptance of an explicit item.
---

Close the explicit item: $ARGUMENTS
Consult [records](../../../docs/workflow/records.md). COMPLETE (MC-2747) means: the PR is merged on green CI (or merged with a matching diff where CI skips its paths), the issue is closed with a link to the PR, its board 1 card has moved, and every leftover is dispositioned (fixed, known limitation in the PR body, follow-up issue under the follow-up policy in gates.md, or dropped with a reason). Check each of the four and report which hold; before reporting COMPLETE, revoke the item's active write grants through register-write-scope.ps1 -Revoke (the main checkout's script for a worktree session); do not reconstruct the old record-heavy closeout set. A no-decision item needs no invented MC entry. Closing an issue by hand, other than through the PR's own closing keyword, is asked (MC-2744).
After writing is finished, the parent revokes any exact active write grant through register-write-scope.ps1 -Revoke. No Stop hook or implied automatic registry cleanup performs this lifecycle step. Reopen technical analysis only for a substantive defect, contradiction or invalidated acceptance; administrative/editorial updates do not trigger Gate 2 or app tests.
