---
name: haiku-review
description: Independently verifies a documented eligible item within the approved bounded Haiku pilot without expanding review eligibility.
context: fork
agent: haiku-reviewer
---

Review the explicitly eligible pilot item: $ARGUMENTS
Consult [pilot](../../../docs/workflow/review-pilot.md) and [log](../../../docs/workflow/review-pilot-log.md). Require eligibility, actual reviewed base plus dirty/untracked inputs, requirements/source context and evidence. Ordinary documentation or exact unchanged-semantics mechanical edits only; exclusions and existing Sonnet/Opus safety gates remain. Return uncertainty to the appropriate tier. Do not mutate files or count configured aliases as observed Haiku execution. The parent records actual model/outcome evidence and counts resumed rounds once per item.
