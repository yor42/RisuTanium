# Live State — observed 2026-11-27

Current-state entry point: one current block, rewritten when observations change; history moves to `Agents/Archive/`. It does not supersede maintainer decisions. Authority order is in [README](README.md): GitHub issues and project board 1 on yor42/RisuTanium for ticket status, [Maintainer-Context](Maintainer-Context.md) through the [Decision-Index](Decision-Index.md) for decisions, this file and the latest lane handoffs for current state, [Roadmap](Roadmap.md) as scope history.

The current-state paragraphs replaced on 2026-11-27 are archived verbatim in [Archive/Live-State-history-2026-11-27.md](Archive/Live-State-history-2026-11-27.md). Everything below "Current state" up to 2026-11-20 is archived verbatim in [Archive/Live-State-history-2026-11-20.md](Archive/Live-State-history-2026-11-20.md); earlier history in [2026-11-02](Archive/Live-State-history-2026-11-02.md), [2026-10-24](Archive/Live-State-history-2026-10-24.md) and [2026-10-20](Archive/Live-State-history-2026-10-20.md).

## Where current state lives

- **Tickets:** open issues and board 1 on yor42/RisuTanium (always `gh ... --repo yor42/RisuTanium`). Check issue, PR and `git log origin/main` state before offering a ticket.
- **Lanes:** the tracked lane A handoff [Lanes/laneA-2026-11-27.md](Lanes/laneA-2026-11-27.md) (paused tickets, how to restart them, the staging prompt template and the merge recipe), lane A's untracked working handoff `Agents/Handoffs/laneA.md` in the main checkout, and lane A's decisions log. A session's own MC block and device rows are in its PR (MC-2713).
- **Governance:** governance v2 (MC-2744 to MC-2753 and MC-2775 to MC-2781, rolled out 2026-11-20 as staged docs PRs): [AGENTS](../AGENTS.md), [CLAUDE](../CLAUDE.md), [gates](../docs/workflow/gates.md) (approval matrix, size tiers, follow-up policy, CI ownership), [records](../docs/workflow/records.md), [ownership](../docs/workflow/ownership.md), [routing](../docs/workflow/routing.md), [live checks](../docs/workflow/live-checks.md) (device checklist and row template).

## Current state

- **Merged work and open PRs:** read `git log origin/main` and the open PR list on yor42/RisuTanium. MC IDs come from per-session blocks of 10 assigned by lane A (MC-2713); blocks are granted through MC-4229 as of 2026-11-27 (the next session block starts at MC-4230; lane A's own block is MC-4220..4229, next ID MC-4220), and pending entries live in `Agents/mc/` until folded. The 2026-11-27 records batch folded every entry merged by then.

- **Lane model (MC-4187..4189, 2026-11-27):** lane A recommends tickets and writes a staging prompt for each one the maintainer picks; the maintainer starts the ticket session in `claude -rc`. The session works through to its PR on its own and sends lane A one message when the PR is open and Gate 2 has passed; lane A checks, merges and removes the worktree. Work order stays as before: MVP-update blockers first (MC-3616; #590 is open, #596 and #603 are closed), then the performance tickets (MC-3618), with the release blockers below.

- **Paused on 2026-11-24:** the weekly quota stopped #438 W3-4, #685 S7-1 and #681 S3b mid-step, each with partial uncommitted code in its worktree. Work resumes on another account, so those sessions do not carry over; each ticket restarts from a new staging prompt. Details and snapshots: [Lanes/laneA-2026-11-27.md](Lanes/laneA-2026-11-27.md).

- **Release blockers (MC-3870, MC-3871):** issues labelled `release-blocker` on yor42/RisuTanium; open on 2026-11-27: #438 and #654 (theme packs; #654 also waits for #751), #651, and Studio S3 (#681), S6 (#684), S7 (#685) and S8 (#686). Studio S1 (#679), S2 (#680), S4 (#682) and S5 (#683) are merged and closed.

- **Studio history core (lane A ruling, 2026-11-23):** Studio tickets that edit `fieldRegistry.ts`, `historyModel.ts` or `ownerHistory.svelte.ts` run one at a time. #680 and #683 ran in parallel and each built its own low-level-access guard; PR 728 merged them into one, and #682's S4b engine work waited for it. This rule is lane A's, applying the shared-cause amendment of MC-091, not a maintainer decision.

- **ChroMemory:** the S3a embedding spike passed on Note 9 phone 1, and `multilingual-e5-small` is the local default (#689, MC-4020). ChroMemory S4, keyword-miss lore recall behind `searchLore` (#687), merged as PR 722.

- **Current MVP (2026-11-27):** the release-signed universal APK of main `7374a3b9a` (the PR 769 merge), built by the maintainer in their separate build checkout and installed on their phone over batch 54 on 2026-11-27; APK sha256 `0455ddaed65ca860a103eaa22a7dfd8fa3e5888612398af744dd63dbb2790285` (as typed; lane A matched it against the built file, 77,829,130 bytes). The build tree's only uncommitted files were the Android manifest and `gradlew`, differing from HEAD in line endings only. The maintainer reports the update worked without any major issue (no data check by the lane). `MC-350` carry-forward applies: later builds read this data in place. It was sideloaded; the in-app update path (#590 S2) is still open.

## Open governance follow-ups

- #384 done 2026-11-21: automatic self-revoking per-worktree write grants (MC-2750, MC-3171; #534).
- #387 done 2026-11-21: native-first route order, Codex/agy `optIn` and the route-health check in the workflow controller (MC-2748; #521). Policy revision `2026-11-21.1` was adopted in the main checkout's live state the same day (lane A).
- #481 done 2026-11-21: ticket PRs write MC entries to `Agents/mc/<ticket>.md`; lane A folds them into Maintainer-Context in batches (MC-3044; #522).
- MC-2752 done 2026-11-20: the `Agents/Handoff-2026-10-08*` backlog moved out of the tree by lane A after its live items went to #280 (comment) and #391.
- The MC-2747 bulk close of old owed administrative closeouts runs as one sweep batch after the governance v2 PRs merge, with the list shown to the maintainer first (MC-2780; lane A).