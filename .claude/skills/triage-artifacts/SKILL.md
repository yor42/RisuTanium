---
name: triage-artifacts
description: Classifies and deduplicates supplied artifacts into an explicit known schema while retaining evidence uncertainty.
---

Run this procedure in the parent. Select and register the `scout` route through the workflow controller, then call the external runner directly. Native `haiku-triager` is a recorded fallback only. Do not auto-fork a native relay. See [subscription-first execution](../../../docs/workflow/subscription-first.md).

Triage the supplied artifacts: $ARGUMENTS
Use only named inputs, scope/exclusions and the caller's known output schema. Return terse cited classifications, deduplication basis, counts and uncertainty. If input/schema is missing, return the gap. No root-cause, safety or acceptance decisions; read-only and no git writes.
