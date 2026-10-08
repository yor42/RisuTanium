---
name: triage-artifacts
description: Classifies and deduplicates supplied artifacts into an explicit known schema while retaining evidence uncertainty.
context: fork
agent: haiku-triager
---

Triage the supplied artifacts: $ARGUMENTS
Use only named inputs, scope/exclusions and the caller's known output schema. Return terse cited classifications, deduplication basis, counts and uncertainty. If input/schema is missing, return the gap. No root-cause, safety or acceptance decisions; read-only and no git writes.
