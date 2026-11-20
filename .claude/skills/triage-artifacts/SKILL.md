---
name: triage-artifacts
description: Classifies and deduplicates supplied artifacts into an explicit known schema while retaining evidence uncertainty.
---

Run this procedure in the parent. Dispatch the native `haiku-triager` registered through the workflow controller (MC-2748, [routing](../../../docs/workflow/routing.md)); Codex or Antigravity only after a passed route-health check under 7 days old. Do not auto-fork a native relay.

Triage the supplied artifacts: $ARGUMENTS
Use only named inputs, scope/exclusions and the caller's known output schema. Return terse cited classifications, deduplication basis, counts and uncertainty. If input/schema is missing, return the gap. No root-cause, safety or acceptance decisions; read-only and no git writes.
