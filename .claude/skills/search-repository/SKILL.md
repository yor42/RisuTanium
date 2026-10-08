---
name: search-repository
description: Runs a bounded repository location survey with exact queries, counts, exclusions and literal matches.
context: fork
agent: code-searcher
---

Locate the requested items: $ARGUMENTS
Require target paths/scope/exclusions and any supplied COMMAND/INTENT/EXPECTED. Run supplied authorized queries verbatim first; report zero/ambiguity and separate adaptations. Return a location map with file:line, literal matching lines, exact commands, counts and COMPLETE/PARTIAL. Do not infer behaviour or safety. Read-only; no git writes.
