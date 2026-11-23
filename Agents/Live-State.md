# Live State — observed 2026-11-24

Current-state entry point: one current block, rewritten when observations change; history moves to `Agents/Archive/`. It does not supersede maintainer decisions. Authority order is in [README](README.md): GitHub issues and project board 1 on yor42/RisuTanium for ticket status, [Maintainer-Context](Maintainer-Context.md) through the [Decision-Index](Decision-Index.md) for decisions, this file and the latest lane handoffs for current state, [Roadmap](Roadmap.md) as scope history.

Everything below "Current state" up to 2026-11-20 is archived verbatim in [Archive/Live-State-history-2026-11-20.md](Archive/Live-State-history-2026-11-20.md); earlier history in [2026-11-02](Archive/Live-State-history-2026-11-02.md), [2026-10-24](Archive/Live-State-history-2026-10-24.md) and [2026-10-20](Archive/Live-State-history-2026-10-20.md).

## Where current state lives

- **Tickets:** open issues and board 1 on yor42/RisuTanium (always `gh ... --repo yor42/RisuTanium`). Check issue, PR and `git log origin/main` state before offering a ticket.
- **Lanes:** the latest lane handoffs (lane A and lane B handoffs of 2026-11-19 at the time of writing; they are untracked in the main checkout and kept by lane A) and lane A's decisions log. A session's own MC block and device rows are in its PR (MC-2713).
- **Governance:** governance v2 (MC-2744 to MC-2753 and MC-2775 to MC-2781, rolled out 2026-11-20 as staged docs PRs): [AGENTS](../AGENTS.md), [CLAUDE](../CLAUDE.md), [gates](../docs/workflow/gates.md) (approval matrix, size tiers, follow-up policy, CI ownership), [records](../docs/workflow/records.md), [ownership](../docs/workflow/ownership.md), [routing](../docs/workflow/routing.md), [live checks](../docs/workflow/live-checks.md) (device checklist and row template).

## Current state

- **Merged work and open PRs:** read `git log origin/main` and the open PR list on yor42/RisuTanium; the records batch 5 paragraph that stood here is archived verbatim in [Archive/Live-State-history-2026-11-20.md](Archive/Live-State-history-2026-11-20.md). MC IDs come from per-session blocks of 10 assigned by lane A (MC-2713); blocks are granted through MC-4089 as of 2026-11-23 (the next block starts at MC-4090; lane A's own next free ID is MC-3878), and pending entries live in `Agents/mc/` until folded. The 2026-11-22 and 2026-11-24 records batches folded every entry merged by then.

- **New sessions:** the 2026-11-22 hold is lifted (MC-3615). Every new session start is asked, naming its model (MC-3622, MC-3764). New work goes first to the MVP-update blockers (MC-3616): #590 (open), #603 (closed 2026-11-23) and #596 (open; stages 1, 2, 5 and 7, MC-3734/3735). After those, the performance tickets come next (MC-3618).

- **Release blockers (MC-3870, MC-3871):** issues labelled `release-blocker` on yor42/RisuTanium: the remaining Studio work and the theme-pack rework (#654, after #560 and #438). Studio S1 (#679), S2 (#680), S4 (#682) and S5 (#683) are merged and closed; S3 (#681), S6 (#684), S7 (#685) and S8 (#686) are open.

- **Studio history core (lane A ruling, 2026-11-23):** Studio tickets that edit `fieldRegistry.ts`, `historyModel.ts` or `ownerHistory.svelte.ts` run one at a time. #680 and #683 ran in parallel and each built its own low-level-access guard; PR 728 merged them into one, and #682's S4b engine work waited for it. This rule is lane A's, applying the shared-cause amendment of MC-091, not a maintainer decision.

- **ChroMemory:** the S3a embedding spike passed on Note 9 phone 1, and `multilingual-e5-small` is the local default (#689, MC-4020). ChroMemory S4, keyword-miss lore recall behind `searchLore` (#687), merged as PR 722.

- **Current MVP (batch 54, 2026-11-05):** the release-signed APK of main `a3b5d706e` (`MC-1082`), built by the maintainer and installed on their phone at 14:39 KST; APK sha256 `4716857a605c614beebe0888e3e67291006de53112313317102b470c29f30cc4` (as typed, matches `result.json`); the maintainer reports no data loss (not checked by the lane). It contains CHORE-412 layout 2, so an older APK cannot read the store after the update and the way back is the pre-update `.bin` (`MC-1074`). `MC-350` carry-forward is live from this build. Dirty tree at build time: `dirty: true` (the unowned files, including the Android manifest edit). Owed: the Note 9 check of the streamed-fetch port (`MC-1078`).

## Open governance follow-ups

- #384 done 2026-11-21: automatic self-revoking per-worktree write grants (MC-2750, MC-3171; #534).
- #387 done 2026-11-21: native-first route order, Codex/agy `optIn` and the route-health check in the workflow controller (MC-2748; #521). Policy revision `2026-11-21.1` was adopted in the main checkout's live state the same day (lane A).
- #481 done 2026-11-21: ticket PRs write MC entries to `Agents/mc/<ticket>.md`; lane A folds them into Maintainer-Context in batches (MC-3044; #522).
- MC-2752 done 2026-11-20: the `Agents/Handoff-2026-10-08*` backlog moved out of the tree by lane A after its live items went to #280 (comment) and #391.
- The MC-2747 bulk close of old owed administrative closeouts runs as one sweep batch after the governance v2 PRs merge, with the list shown to the maintainer first (MC-2780; lane A).