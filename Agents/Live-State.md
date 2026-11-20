# Live State — observed 2026-11-20

Current-state entry point: one current block, rewritten when observations change; history moves to `Agents/Archive/`. It does not supersede maintainer decisions. Authority order is in [README](README.md): GitHub issues and project board 1 on yor42/RisuTanium for ticket status, [Maintainer-Context](Maintainer-Context.md) through the [Decision-Index](Decision-Index.md) for decisions, this file and the latest lane handoffs for current state, [Roadmap](Roadmap.md) as scope history.

Everything below "Current state" up to 2026-11-20 is archived verbatim in [Archive/Live-State-history-2026-11-20.md](Archive/Live-State-history-2026-11-20.md); earlier history in [2026-11-02](Archive/Live-State-history-2026-11-02.md), [2026-10-24](Archive/Live-State-history-2026-10-24.md) and [2026-10-20](Archive/Live-State-history-2026-10-20.md).

## Where current state lives

- **Tickets:** open issues and board 1 on yor42/RisuTanium (always `gh ... --repo yor42/RisuTanium`). Check issue, PR and `git log origin/main` state before offering a ticket.
- **Lanes:** the latest lane handoffs (lane A and lane B handoffs of 2026-11-19 at the time of writing; they are untracked in the main checkout and kept by lane A) and lane A's decisions log. A session's own MC block and device rows are in its PR (MC-2713).
- **Governance:** governance v2 (MC-2744 to MC-2753, rolled out 2026-11-20 as staged docs PRs): [AGENTS](../AGENTS.md), [CLAUDE](../CLAUDE.md), [gates](../docs/workflow/gates.md) (approval matrix, size tiers, follow-up policy, CI ownership), [records](../docs/workflow/records.md), [ownership](../docs/workflow/ownership.md), [routing](../docs/workflow/routing.md), [live checks](../docs/workflow/live-checks.md) (device checklist and row template).

## Current state

- **Merged work and open PRs:** read `git log origin/main` and the open PR list on yor42/RisuTanium; the records batch 5 paragraph that stood here is archived verbatim in [Archive/Live-State-history-2026-11-20.md](Archive/Live-State-history-2026-11-20.md). MC IDs come from per-session blocks of 10 assigned by lane A (MC-2713); the decisions log runs through MC-2753.

- **Current MVP (batch 54, 2026-11-05):** the release-signed APK of main `a3b5d706e` (`MC-1082`), built by the maintainer and installed on their phone at 14:39 KST; APK sha256 `4716857a605c614beebe0888e3e67291006de53112313317102b470c29f30cc4` (as typed, matches `result.json`); the maintainer reports no data loss (not checked by the lane). It contains CHORE-412 layout 2, so an older APK cannot read the store after the update and the way back is the pre-update `.bin` (`MC-1074`). `MC-350` carry-forward is live from this build. Dirty tree at build time: `dirty: true` (the unowned files, including the Android manifest edit). Owed: the Note 9 check of the streamed-fetch port (`MC-1078`).

## Open governance follow-ups

- #384: automatic self-revoking per-worktree write grants (MC-2750).
- #387: native-first route order and Codex/agy opt-in in the workflow controller (MC-2748).
- MC-2752 done 2026-11-20: the `Agents/Handoff-2026-10-08*` backlog moved out of the tree by lane A after its live items went to #280 (comment) and #391.
- The MC-2747 bulk close of old owed administrative closeouts runs as one sweep batch (lane A).