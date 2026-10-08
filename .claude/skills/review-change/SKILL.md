---
name: review-change
description: Supplies independent Gate 1 and Gate 2 verdict, evidence, test-purpose and proportional remediation rules.
user-invocable: false
---

Consult [gates](../../../docs/workflow/gates.md) for acceptance criteria and escalation. Orchestrator selects the reviewer independently of the author and supplies scope, acceptance scenarios, invariants, relevant MC IDs and explicitly approved limitations, without the author's reasoning transcript.
Gate 1 checks plan readiness; Gate 2 checks the concrete implementation and its factual artifacts. Reopen source/callers/diff and rerun relevant claims when feasible. Separate executed proof from reasoning; unsupported suspicion is not a concrete defect.
Tests are regression reproducers (fail pre-change on intended defect, pass after), compatibility guards (may pass before/after and say so) or diagnostics (establish a mechanism). Sanitizer output uses jsdom and identity mutation per MC-239.
Final review token is [APPROVE], [EDITORIAL] or [REJECT]. Editorial corrections fix wording that misstates an otherwise understood accepted behaviour. Substantive misunderstanding, logic/test/invariant defect or missing safety-critical evidence rejects.
For unchanged behaviour after an editorial correction, verify the changed claim against source and inspect the diff; do not retrigger Gate 2 or unrelated tests. Behavioural corrections need targeted independent remediation review. Broader reopening is justified only when an invariant/contract/design changes or earlier acceptance evidence is invalidated. Reuse still-valid evidence and identify it.
Three consecutive substantive rejections escalate before a fourth revision; editorial rounds neither count nor break the streak. A reviewer never writes repository files or changes index/snapshots. Granted Write is only for outside-repository throwaway verification scratch; list it. Shell write capability is not permission.
