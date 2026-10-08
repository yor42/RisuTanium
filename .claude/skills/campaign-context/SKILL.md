---
name: campaign-context
description: Supplies targeted campaign authority, compatibility, evidence protection and Windows operating constraints for project agents.
user-invocable: false
---

Read [Agents/README.md](../../../Agents/README.md) for authority, then relevant entries in [Maintainer-Context](../../../Agents/Maintainer-Context.md) and the brief's named current-state pointers. Do not preload full history, old transcripts or unrelated reports. Every brief names relevant MC IDs. After compaction, consult Live-State before expanding history.
This is targeted stabilization, not a rewrite; the fork has never shipped (MC-011). Preserve upstream characters/modules/presets/plugins. Upstream-to-fork .bin import always works; fork-to-upstream oversize exclusions need a warning naming the data and confirmation before export starts (MC-175/MC-223). Upstream need not read fork storage directly.
Respect authorization and exact scope, pre-existing edits and other sessions' work. No agent git/index writes. Never access secrets just to satisfy discovery. Never commit or quote the two protected third-party evidence directories:
- Agents/Evidences of Investigations/Community plugins to solve common pain points/
- Agents/Evidences of Investigations/Asset Cache/Community Mitigation_Webrowser Plugin/
The rest of that evidence tree is tracked (MC-027); read only task-relevant evidence explicitly needed. Ignore unrelated .claude/worktrees.
PowerShell is preferred on Windows; Bash is fallback. Use single-quoted literal strings and short commands; use Write/Edit rather than shell redirection for authored files. Preserve file bytes' line ending convention and surrounding style; no wholesale formatter. Run existing .sh scripts through the installed Git bash when needed. Never combine cross-shell destructive operations; verify resolved paths for any authorized removal/move. Keep scratch verification outside the repository and clean up only your own spawned processes.
Read-only constraints are doctrine, not an OS-enforced sandbox: shell grants can mutate. Honour each profile's narrower write scope.
Use [project reference](../../../docs/workflow/project-reference.md) only for the area being changed; trust current source/resolved dependencies over stale counts. DBState is a plain rune object; sanitizer-output tests require jsdom and identity-sanitizer falsification (MC-239).
