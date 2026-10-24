# Live State — observed 2026-10-24

Current-state entry point; rewrite when observations change. This file does not supersede maintainer decisions or reconcile pending campaign records. Authority: [README](README.md), [Maintainer-Context](Maintainer-Context.md), [Roadmap](Roadmap.md). Durable traps: [Phase2-Handoff](Phase2-Handoff.md).

## Observed repository snapshot

Superseded updates are archived in [Archive/Live-State-history-2026-10-24.md](Archive/Live-State-history-2026-10-24.md) and, before that, [Archive/Live-State-history-2026-10-20.md](Archive/Live-State-history-2026-10-20.md); the current step handoff is [Handoff-2026-10-21-upstream-close.md](Handoff-2026-10-21-upstream-close.md).

- **Current state (2026-10-24, lane A records batch 10; `MC-479`, `MC-500`; the update paragraphs an earlier cleanup replaced are in [Archive/Live-State-history-2026-10-24.md](Archive/Live-State-history-2026-10-24.md)):** `main` is at `a51321952` (batch T stage T1, committed locally and not yet pushed; `origin/main` is `df408f8de`), plus the records batch 10 commit that carries this edit, which cannot name its own hash. The [Roadmap](Roadmap.md) opens with a "Now" section and an open-tickets table; closed, superseded and moot entries are in [Archive/Roadmap-closed-2026-10-24.md](Archive/Roadmap-closed-2026-10-24.md), and parked tickets (`MC-501`, `MC-504`) are in [Roadmap-parked.md](Roadmap-parked.md). Work runs in gated batches (`MC-500`).
- **MVP:** the release-signed APK of `f0e397aae` is installed on the maintainer's phone (`MC-475`); `MC-350` carry-forward is live.
- **In flight:** lane A runs batch T (the native streaming path: CHORE-164, 165, 149 and 167; `MC-502`); its plan v2 passed Gate 1 round 2 as `[APPROVE WITH AMENDMENTS]`; T1 is committed (`a51321952`, not pushed) and T2 is in progress. Device profile stage C (the generator `device` scale) is on `main` as `df408f8de`; stage B's probe on phone 2 passed (MEASURED, stage B result); phone 2 is about to get stage D (a fresh main build on the test key, `pm clear`, the synthetic device-profile import), then lane B's three checks (`MC-502`). Lane B runs CHORE-205 L3, including the MCP module tools; its plugin module asset-list fix is merged (`15777155a`). Lane C (cloud) runs batch Q (CHORE-240, 185 and 353). Lanes F (plugin batch: CHORE-30, 65) and G (parity batch: CHORE-178, 45, 41) are new and have no phone access; device requests go to lane A (`MC-503`). The Android Back batch (CHORE-179, 180) and CHORE-166 follow batch T. CHORE-207 (off-main-thread asset work) stays a candidate (`MC-478`).
- **Open:** `saveLoopNetBackstop` B7 (a CHORE-205 test, lane B) failed in lane C's Linux run and passes on Windows; its platform and clock dependence is UNKNOWN. **Behaviour change** from CHORE-500: V2 `editdisplay` plugin hooks, Lua edit triggers and the `display` trigger receive translated text with `&` and `<` escaped (`MC-435`).
- **Lanes:** A: orchestrator, session risuai-68. B: "Lane B [d820f9]", CHORE-205 L3; lane B's records give its state. C (cloud): batch Q; its earlier scope (CHORE-500, CHORE-330, CHORE-501) merged in `a83c7901b`. D and E: retired. F and G: new (`MC-503`), assigned ports 6480 to 6499 and 6500 to 6519, scratch `%TEMP%\risu-lane-f\` and `%TEMP%\risu-lane-g\`, branches `worktree-Lane-F` and `worktree-Lane-G`. "Lane 1" and "Lane 2" belong to another project.
- **Next free IDs:** lane A: MC-505 (block MC-500 to MC-519; MC-500 to MC-504 used by records batch 10), CHORE-208, row 2270 (records batch 10 used rows 2262 to 2269). Lane B: MC-485 (block MC-480 to MC-499), CHORE-227, row 3014. Lane C: MC-438, CHORE-331, row 3341. Lane F: MC-520 to MC-539, CHORE-370 to 389, rows 3700 to 3899. Lane G: MC-540 to MC-559, CHORE-390 to 409, rows 3900 to 4099. New lanes start from MC-560, CHORE-410 and row 4100. Lane Cloud (the earlier cloud lane): MC-725, CHORE-504, row 5123.
- **Phone 1:** the fixed test key, the real partial profile, and the MEASURE build of `0d54f5e84` (sha256 prefix `13736598`) installed; free.
- **Phone 2:** per the stage B result, a release build of `f0e397aae` with wry 0.57.1 on the test key (not `e41513308`), holding a synthetic mid profile plus one edited message; the stage B network probe to the mock endpoint passed (MEASURED). About to get stage D (`MC-502`).
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
