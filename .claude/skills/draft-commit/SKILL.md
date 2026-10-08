---
name: draft-commit
description: Returns an evidence-complete routine commit-message draft without committing or asserting unsupported facts.
context: fork
agent: record-clerk
---

Draft the routine commit message requested: $ARGUMENTS
Use only supplied change/verification evidence; return message text, do not write files or mutate git. Omit unsupported technical assertions and retain material qualifications. Evidence gaps or complex technical/persistence messages return to doc-writer through the Orchestrator. Ordinary facts go to doc-verifier; opus-reviewer owns persistence-message fact-checking. This invocation never authorizes committing.
