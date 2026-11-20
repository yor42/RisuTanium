---
name: search-repository
description: Runs a bounded repository location survey with exact queries, counts, exclusions and literal matches.
---

Run this procedure in the parent. Dispatch the native `code-searcher` registered through the workflow controller (MC-2748, [routing](../../../docs/workflow/routing.md)); Codex or Antigravity only after a passed route-health check under 7 days old. Do not auto-fork a native relay.

Locate the requested items: $ARGUMENTS
Require target paths/scope/exclusions and any supplied COMMAND/INTENT/EXPECTED. Run supplied authorized queries verbatim first; report zero/ambiguity and separate adaptations. Return a location map with file:line, literal matching lines, exact commands, counts and COMPLETE/PARTIAL. Do not infer behaviour or safety. Read-only; no git writes.
