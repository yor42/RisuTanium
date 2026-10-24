# Live State — observed 2026-10-24

Current-state entry point; rewrite when observations change. This file does not supersede maintainer decisions or reconcile pending campaign records. Authority: [README](README.md), [Maintainer-Context](Maintainer-Context.md), [Roadmap](Roadmap.md). Durable traps: [Phase2-Handoff](Phase2-Handoff.md).

## Observed repository snapshot

Superseded updates are archived in [Archive/Live-State-history-2026-10-24.md](Archive/Live-State-history-2026-10-24.md) and, before that, [Archive/Live-State-history-2026-10-20.md](Archive/Live-State-history-2026-10-20.md); the current step handoff is [Handoff-2026-10-21-upstream-close.md](Handoff-2026-10-21-upstream-close.md).

- **Current state (2026-10-24, lane A Roadmap cleanup; `MC-479`; the update paragraphs it replaces are in [Archive/Live-State-history-2026-10-24.md](Archive/Live-State-history-2026-10-24.md)):** `main` is at `ec069c5ad`, pushed, plus the cleanup commit that carries this edit, which cannot name its own hash. The [Roadmap](Roadmap.md) now opens with a "Now" section and an open-tickets table; closed, superseded and moot entries are in [Archive/Roadmap-closed-2026-10-24.md](Archive/Roadmap-closed-2026-10-24.md).
- **MVP:** the release-signed APK of `f0e397aae` is installed on the maintainer's phone (`MC-475`); `MC-350` carry-forward is live.
- **In flight:** lane B rebases its CHORE-205 plugin module asset-list fix (`916adac48`, built on `f0e397aae`) onto `main` after CHORE-206, re-runs Gate 2 and asks for a new commit approval and merge; lane B also sizes lever L3, including the MCP module tools. Device profile stage B waits on the maintainer's go-ahead (`MC-474`). CHORE-207 (off-main-thread asset work) is a candidate; next is reading the grid plan (`MC-478`).
- **Open:** `saveLoopNetBackstop` B7 (a CHORE-205 test, lane B) failed in lane C's Linux run and passes on Windows; its platform and clock dependence is UNKNOWN. **Behaviour change** from CHORE-500: V2 `editdisplay` plugin hooks, Lua edit triggers and the `display` trigger receive translated text with `&` and `<` escaped (`MC-435`).
- **Lanes:** A: orchestrator, session risuai-68. B: "Lane B [d820f9]", CHORE-205; lane B's records give its state. C (cloud): idle, its scope (CHORE-500, CHORE-330, CHORE-501) merged in `a83c7901b`. D and E: retired. "Lane 1" and "Lane 2" belong to another project.
- **Next free IDs:** lane A: MC-500 (block MC-500 to MC-519, after MC-470 to MC-479), CHORE-208, row 2262. Lane B: MC-485 (block MC-480 to MC-499), CHORE-227, row 3010 (as stated in lane B's merge request of 2026-10-24; MC-481 to MC-484 and rows 3000 to 3009 are on its unmerged branch). Lane C: MC-438, CHORE-331, row 3341. Lane Cloud (the earlier cloud lane): MC-725, CHORE-504, row 5123.
- **Phone 1:** the fixed test key, the real partial profile, and the MEASURE build of `0d54f5e84` (sha256 prefix `13736598`) installed; free.
- **Phone 2:** the release build of `e41513308` on the test key (the app was uninstalled once for the key change), holding the synthetic profile; free.
- **Daily APK:** the holds are released (the `MC-368` 1 block by `MC-400`; the stage 2 and 2c holds by lane B's S0 judgements); none is current. Building a daily APK from main is the maintainer's call.

## Active work and unresolved records

The raw [latest handoff](Handoff-2026-10-08.md) and [evidence folder](Handoff-2026-10-08/) stay as preserved evidence (untracked).

- Note 9/runtime observations, GitHub security rescan status, sidebar sync and phone measurements need their own live checks; none is claimed to have passed on current HEAD.

## Workflow cleanup

Canonical active entry points: [AGENTS](../AGENTS.md), [workflow README](../docs/workflow/README.md), [routing](../docs/workflow/routing.md), [gates](../docs/workflow/gates.md), [project reference](../docs/workflow/project-reference.md). [Dated audit](../docs/workflow/audit-2026-10-08.md) separates observations, changes and remaining validation.

Original AGENTS, Live-State and Phase2-Handoff bytes are in [Archive/2026-10-08](Archive/2026-10-08/README.md); the archive is non-operative. [Summary](Summary.md) stays at its original path to preserve its relative links.

Before the next item: read relevant original MC decisions, verify actual working state, use the accepted plan/evidence and apply the independent gates. Do not pick a new product trade-off or silently convert pending notes into settled decisions.

## Accepted follow-up workflow work

MC-243 adopts four [path rules](../.claude/rules/) and selective read-only language intelligence, with [Desktop preview first](../docs/workflow/live-checks.md). Side chats are already handled by the maintainer. [Manual plugin/server setup](../docs/workflow/claude-desktop-setup.md) and [the campaign resumption prompt](../docs/workflow/resume-main-campaign.md) cover the next session. The TS/Svelte servers and Rust analyzer component were absent at inspection; no installation or native LSP/preview execution is claimed. [Feature acceptance](../docs/workflow/feature-opportunities-2026-10-08.md) records configuration checks and remaining runtime validation.
