# Durable reactivity and performance handoff

Current state is [Live-State](Live-State.md); campaign scope/sequencing is [Roadmap](Roadmap.md). Active workflow lives in [AGENTS](../AGENTS.md), [routing](../docs/workflow/routing.md) and [gates](../docs/workflow/gates.md). This document keeps technical lessons rather than duplicate instructions or stale session baselines. The original checkpoint brief is preserved [byte-for-byte in the archive](Archive/2026-10-08/Phase2-Handoff.md).

## Load-bearing rules

- Dirty-tracking dependencies determine whether a block is encoded at all. Preserve every mutation dependency; partition effect work without narrowing it away. A missed dependency can silently lose writes. The module effect partition plan and its evidence are in [Report 11](Reports/11-stage-b-module-effect-partition-plan.md); the retired draft-copy design is [Report 10](Reports/10-stage-b-module-draft-copy-plan.md).
- Measure the premise before selecting the mechanism. When review keeps finding variations of one edge case, reconsider ownership, lifetime or the shared cause before adding another guard. A product constraint needs the maintainer's decision.
- `$state.snapshot` cost scales with graph node count, not merely bytes. A large string and many small asset references can have very different costs. Use node-count workloads when comparing designs.
- Name runtime, build, hardware, inputs and limitations. The original checkpoint measurements used an i9-13900K/64 GB DDR5. Ratios from doing less work can inform a comparison but are not universally hardware-independent; do not claim target frame-budget compliance without target measurements.
- Harness absolute costs and browser costs differ. Use harnesses for controlled comparisons and the real app for user-facing claims; larger real profiles and asset modules need representative fixtures.

## Measurement procedure

[Tools/README.md](Tools/README.md) owns measurement setup, fixtures, actual DBState access and mutate/restore procedure. Check the runtime actually under test. Vite cache-busted imports can return a different module instance; importing a second Svelte runtime can invalidate `flushSync` measurements; hidden browser panes can suppress animation frames. A plausible timing value is not evidence until those conditions are pinned down.

Do not set the legal build flag automatically. Read the applicable legal constraint and decision for an authorized one-run setup. Do not alter production source for mutants or probes; keep scratch outside the tree. Check exit codes and validate arithmetic, counts and citations.

## Area traps

- Secure-context APIs need plain-HTTP LAN fallbacks; do not assume `crypto.randomUUID()` or service workers are available.
- Asset cache lifetimes can carry correctness contracts. Trace the corruption fix before bounding them; do not infer safety from memory improvement alone.
- Enabled-module caches may hold live proxies; duplicate module IDs can arrive through imports. Trace the current mechanism rather than relying on historical freshness accidents.
- Storage path selection is centralized; legacy OPFS names do not establish active web storage. See [project reference](../docs/workflow/project-reference.md) before persistence work.
- Tests and comments are review artifacts. State present invariants, distinguish pre-fix reproducers from guards, and do not copy historical mechanism claims into code. Native/browser paths need their own applicable evidence.

Open findings and deferred work belong in Roadmap/Carry-Forward, not a duplicate list here. Original historical observations are available in the archive; their dates, hashes and runtime claims are not current verification.
