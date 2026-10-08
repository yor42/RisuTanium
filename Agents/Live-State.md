# Live State — observed 2026-10-08

Current-state entry point; rewrite when observations change. This file does not supersede maintainer decisions or reconcile pending campaign records. Authority: [README](README.md), [Maintainer-Context](Maintainer-Context.md), [Roadmap](Roadmap.md). Durable traps: [Phase2-Handoff](Phase2-Handoff.md).

## Observed repository snapshot

- Main checkout: `C:\Projects\RisuAI`, branch `main`; application baseline `a5a3095d` — `fix(save): keep edits made while the first save is still encoding (CHORE-116)`, observed at audit start. Later workflow-only commits are authorized by MC-244; use actual `git log`/status to establish the current HEAD rather than treating this application baseline as the latest commit.
- `git worktree list` also reports `C:/Projects/RisuAI-sidebar`, `feat/sidebar-rework`, `e55fb93e`. This audit does not inspect or alter that worktree.
- Existing dirty files at audit start: `.claude/launch.json` and `src-tauri/gen/android/app/src/main/AndroidManifest.xml`; preserved. Existing untracked `Handoff-2026-10-08.md` and its folder are preserved byte-for-byte.
- This workflow audit changes instructions, workflow configuration and documentation only; no application changes. Current runtime/application checks and remote push state are not asserted from older notes.

## Active work and unresolved records

The raw [latest handoff](Handoff-2026-10-08.md) and [evidence folder](Handoff-2026-10-08/) carry the pending campaign queue and records. Their contents are not reconciled by this cleanup.

- CHORE-117 Stage 1a: handoff reports an accepted plan awaiting implementation; see `plan-1a.md` and `plan-1a-r2.md` under the preserved `chore117/` evidence. No implementation is authorized or performed by this workflow-only audit.
- Handoff campaign order: records batch, CHORE-117, sidebar Stages 3–5; CHORE-118 held. Treat this as the handoff's pending queue and confirm authoritative sequencing before resuming application work.
- Pending records: `records-pending2.md`, preceding records notes, CHORE-116/117 gates, maintainer answers and Roadmap/ledger updates. Keep original text, numbering and evidence until independently reconciled. MC-240/241 record only the current workflow authorization and accepted follow-up policies; they do not settle that backlog.
- Note 9/runtime observations, GitHub security rescan status, sidebar sync and phone measurements need their own live checks; this audit claims none of them passed on current HEAD.

## Workflow cleanup

Canonical active entry points: [AGENTS](../AGENTS.md), [workflow README](../docs/workflow/README.md), [routing](../docs/workflow/routing.md), [gates](../docs/workflow/gates.md), [project reference](../docs/workflow/project-reference.md). [Dated audit](../docs/workflow/audit-2026-10-08.md) separates observations, changes and remaining validation.

Original AGENTS, Live-State and Phase2-Handoff bytes are in [Archive/2026-10-08](Archive/2026-10-08/README.md); the archive is non-operative. [Summary](Summary.md) stays at its original path to preserve its relative links.

Before the next item: read relevant original MC decisions, verify actual working state, use the accepted plan/evidence and apply the independent gates. Do not pick a new product trade-off or silently convert pending notes into settled decisions.

## Accepted follow-up workflow work

MC-241 priority: record closeout and pre-Gate1 sizing/product decisions (1/4), evidence curation and bounded Haiku verification pilot (2/3), then write concurrency/direct-tool ownership guard (5/6). The policy/configuration/script scope is independently accepted and its records are closed; see [the improvement record](../docs/workflow/improvements-2026-10-08.md) for 84 synthetic checks, metadata/validator evidence and explicit limitations. Native Desktop hook smoke validation remains a follow-up. The [Haiku pilot log](../docs/workflow/review-pilot-log.md) is 0/10 at this dated closeout. No application source, push, worktree creation or raw-artifact deletion/move occurred. MC-244 subsequently authorizes separate workflow/document commits. The earlier campaign backlog remains pending.

MC-243 adopts four [path rules](../.claude/rules/) and selective read-only language intelligence, with [Desktop preview first](../docs/workflow/live-checks.md). Side chats are already handled by the maintainer. [Manual plugin/server setup](../docs/workflow/claude-desktop-setup.md) and [the campaign resumption prompt](../docs/workflow/resume-main-campaign.md) cover the next session. The TS/Svelte servers and Rust analyzer component were absent at inspection; no installation or native LSP/preview execution is claimed. [Feature acceptance](../docs/workflow/feature-opportunities-2026-10-08.md) records configuration checks and remaining runtime validation.
