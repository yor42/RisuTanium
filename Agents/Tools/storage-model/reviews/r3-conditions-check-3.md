# Third incremental condition check: plan v3.4, conditions D1 and E1 only (opus-reviewer, 2026-10-14)

Instance: session b715da7c-9965-4831-b226-4d56438d78ee, agent a1e7bb3f245d95bc2, role opus-reviewer, resumed.

## Inputs

`S\stage13\plan-v3.4.md`, read only in these places:
- the change table, J1 and J2 (lines 7 and 8);
- the `FenceRecord` interface and 3.4c (lines 236 to 255);
- the 7.4 table (lines 506 to 518);
- grep for every other mention of `priorFences` and "revision 0".

The source facts were already READ in `conditions-check-2.md`: `W:server.cjs:470`, `:1778-1843`; `W:nodeHttpStore.ts:469`; `W:contract.ts:176-184`. Nothing was executed.

## Results

| Condition | Status | v3.4 evidence |
|---|---|---|
| D1: the Node per-batch fence check carries the revision observed at the pass-start read | **CLOSED** | Line 252 says the check-only entry carries "the revision returned by the pass-start fence read, absent key included (the same rule as the first-life create)". Line 252 also explains that a discarded fence sits at revision 2 or higher, with correct citations, and corrects the compare-as-0 reading of `contract.ts`. Tests: line 511 ("read at pass start (absent included)") and line 512 (a fence discarded earlier, absent at revision 2 or higher: batches carry that revision and delete normally; mutant "absent fence checked at revision 0") |
| E1: `priorFences?` in the `FenceRecord` interface | **CLOSED** | Line 244: `priorFences?: { at: number, bytes: string }[]`, Tier 1, base64url bytes of an unparsable fence that an exit replaced. It is consistent with line 247 and vector F5 (line 255) |

## Defects introduced by the edits

None.

One wording note (EDITORIAL, optional): line 252 says compare-as-0 "holds only for a never-written key". It also holds for a retired key, which `contract.ts` says correctly. For `store2-fence` the difference is moot, because retire is refused outside the prefix. A fence whose first create crashed after its revision bump is absent at revision 1 or higher; "absent key included" already covers that case.

## Overall Gate 1 verdict on plan v3.4

**[APPROVE]**

| Round or check | Result | What happened next |
|---|---|---|
| Round 3 | C1 to C13 | closed in v3.2 and v3.3 |
| Check 1 | N1 to N5, R-a | closed in v3.3 |
| Check 2 | D1, E1 | closed here |

No condition remains open.

The items the plan itself lists as later gates are not reopened here and stay binding:
- the freeze preconditions: the census and V1 to V4;
- the measurements;
- the 4a census completion;
- MC-290 recording, including the fence suspension, which is the author's proposal under U12/U13;
- the Section 10 traces.

Artefacts: this file only. No processes were started, and nothing was written to the repository or git.
