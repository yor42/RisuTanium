---
name: write-ownership
description: Supplies exact file ownership, single application-writer concurrency and direct-tool instance-grant doctrine.
user-invocable: false
---

Follow [ownership](../../../docs/workflow/ownership.md). One active application-code writer per checkout: coder and test writer count together. Read-only helpers may run concurrently; document writers need exact nonoverlapping named files and one integration owner. Parallel application items require separately authorized worktrees with explicit starting revision and integration owner; verify revision rather than trust a default branch. No automatic isolation, merge or commit.
Direct Write/Edit workers require exact instance grants from the Orchestrator: session ID, actual agent ID, role, this hook's repository root and exact file paths. SubagentStart exposes identity but cannot automatically claim a role-wide or pending scope. Return identity once, wait for explicit registration, and resume the SAME instance. Named --agent sessions use agent ID main, while ordinary main sessions with both identity keys absent retain normal authorization/permissions.
Register/amend/revoke through `pwsh -NoProfile -File .claude/scripts/register-write-scope.ps1` as the parent, never grant yourself authority through shell. Role bounds and human authorization still apply inside a granted file. Reviewer probes need exact explicitly granted files under external temporary scratch, never repository writes.
The direct-tool hook is not a security sandbox: shell/MCP/alternate channels, disabled hooks and missing/startup/timeout failures can bypass this channel or proceed under normal permissions. Honour doctrine and independently inspect actual diffs; no claimed OS-enforced isolation or unverified native isolated-worktree routing.
