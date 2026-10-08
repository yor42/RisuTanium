# Workflow policy and validation

[AGENTS.md](../../AGENTS.md) is the shared concise entry point. Claude imports it through [CLAUDE.md](../../CLAUDE.md). This directory owns the detailed local policy: [routing](routing.md), [gates](gates.md) and [project reference](project-reference.md). [Agents/README.md](../../Agents/README.md) identifies campaign authorities; [the dated audit](audit-2026-10-08.md) records why this cleanup exists.

Official documentation describes platform capabilities; the task matrix, protection rules, evidence requirements and release gates here are this repository's policy. Claude supports project memory imports and separate subagent contexts; skills supply focused procedures. These features do not make every local routing rule a runtime restriction. [Claude memory](https://code.claude.com/docs/en/memory), [subagents](https://code.claude.com/docs/en/sub-agents), [skills](https://code.claude.com/docs/en/skills).

The installed Claude CLI was checked as **2.1.286** for this audit. Recheck the runtime when relying on its behavior. Nested dispatch is supported in this observed environment; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2` configures the requested depth bound; trust or higher-precedence settings can override project settings. Restrictions on which nested agent types may be called remain doctrine. Validate current configuration and tools instead of treating schema validity as proof of a successful runtime invocation.

Run these checks from the repository root with PowerShell 7 (`pwsh`). The local validator checks this project's supported frontmatter subset, references, navigation and ignore rules; it is not a general YAML parser:

```powershell
pwsh -NoProfile -File .claude/scripts/validate-workflow.ps1
pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1 -Check
pwsh -NoProfile -File .claude/scripts/test-write-guard.ps1
```

To regenerate the deterministic decision-heading index after an authorized log append:

```powershell
pwsh -NoProfile -File .claude/scripts/update-decision-index.ps1
```

The decision index points to raw `MC-` headings; it does not paraphrase decisions or replace the append-only log. At the initial audit, native `claude plugin validate` reported success with `contents: []` for direct agent/skill directories and a temporary plugin; that did not establish file-level metadata validation. Later strict validation of the actual Svelte plugin and marketplace manifests passed; this still does not establish native LSP operation. Workflow validation checks the configuration and cross-references; acceptance also requires independent review and any applicable execution evidence. See the audit for dated results; pending validation is not a pass.

Context should contain only the relevant instructions, evidence and unresolved questions. Avoid repeated exploratory output and automatic imports of large historical records. Anthropic recommends focused instructions and efficient context use; reduced token cost from this repository's changes remains **unmeasured**. [Best practices](https://code.claude.com/docs/en/best-practices), [costs](https://code.claude.com/docs/en/costs), [skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

## Accepted follow-up improvements

MC-241 approves [record closeout/evidence curation](records.md), [pre-plan sizing and product readiness](gates.md), the bounded [Haiku review pilot](review-pilot.md) and [ownership/concurrency](ownership.md). [The improvement record](improvements-2026-10-08.md) closes the accepted configuration/script scope and distinguishes native runtime follow-ups; it does not rewrite the prior audit. [The pilot log](review-pilot-log.md) owns current progress; unanswered or configuration-only runs do not count. Guard tests create synthetic fixtures outside the checkout and retain them for inspection.
MC-243 adopts focused `.claude/rules` and read-only LSP navigation for selected workers. Explicitly read a source file before relying on its scoped rules: symbol navigation alone is not proof that Read/Write/Edit-triggered guidance loaded. [Manual Desktop setup](claude-desktop-setup.md) covers the two official language plugins, local Svelte plugin and their separate server binaries. [Live checks](live-checks.md) use Desktop preview first and Claude in Chrome when needed. [Resumption](resume-main-campaign.md) preserves the accepted campaign position and pending record reconciliation. Configuration validation does not prove native server, hook or preview operation; no plugin installation is performed by this audit.
