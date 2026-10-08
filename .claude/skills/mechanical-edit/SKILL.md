---
name: mechanical-edit
description: Applies explicitly bounded mechanical changes in named files and returns syntax proof for independent review.
context: fork
agent: haiku-editor
---

Apply the explicit bounded mechanical edit: $ARGUMENTS
Require exact named files/anchors, operation/find-replace, scope/exclusions and done condition. Preserve pre-existing edits, style and line endings. Do not expand authorization, refactor autonomously or change configuration behaviour, persistence, security, user consent or translations. Return exact diff and appropriate syntax/structure proof; all application edits go to the parent for independent review. No git writes.
