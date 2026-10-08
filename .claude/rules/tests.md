---
paths:
  - "src/**/*.test.ts"
---

A regression reproducer fails on the intended defect against the relevant pre-fix base and passes after; setup/import failures prove nothing. Compatibility guards may pass before and after and must say so. Diagnostics establish mechanisms without automatically accepting a fix.
Sanitized-markup assertions use jsdom with // @vitest-environment jsdom first; happy-dom sanitizer output is not evidence. Prove an identity sanitizer makes relevant assertions fail (MC-239).
Mock providers/native filesystems to avoid live effects; mocked success does not prove native behavior. Keep runtime, inputs and actual dirty/untracked snapshot in execution evidence. Use synthetic fixtures, never external community-service probes.
Test-warrior owns named test changes; application-source amendments return to the orchestrator. Coders and test writers count together as one application writer per checkout. Apply targeted checks and the named final-check owner from [gates](../../docs/workflow/gates.md), preserving pre-existing edits, line endings and comments without repository line numbers.
