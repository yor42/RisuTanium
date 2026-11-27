[EDITORIAL]

# Gate 2 r1, #820 telemetry (worktree 820-telemetry, uncommitted vs origin/main)

## Summary
No substantive defect. One editorial registry-wording finding (row 1628), one editorial test-strength note. Read-only; no scratch files created.

## Evidence / commands
- `node C:/Projects/RisuAI/node_modules/vitest/vitest.mjs run --root . Agents/Tools/usage`: 2 files, 30 tests passed (execution).
- Read gaps.mjs, gap-registry.json, gaps.test.mjs, README addition, mc/820.md, usage-820/README.md; parsed result-*.json and gaps-*.json with ConvertFrom-Json (execution).
- Did not read any session .jsonl.

## Acceptance
1. Pure/deterministic: PASS. buildGapExport reads only result + registry; sort is by id; no Date/path/env use (HERE only locates the default registry in main). Strict key set rejects a registry gap that carries its own costUsd.
2. costUsd null, nothing estimated: PASS. Every gap gets `costUsd: null`; `measured.costUsdAssumedListPrice` is labelled as assumed list price from the frozen totals; acceptedResultIds null; no saving stated.
3. No text/ids/names/paths: PASS. Grep of gaps-*.json and result-*.json for `C:\`, `Users`, `jsonl`, `RisuAI`, backslashes: 0 hits. Aliases are src-NNN only. Error messages are allowlisted codes (`invalid-result read`, `output-exists`, `internal-error`).
4. Numbers: PASS. Both results: calls 12503, tokens 28952/33564620/2994603410/7255454, cost 1431.173253, turns 1045; tools 13297 union vs 4146 legacy. Per-trigger tools legacy->union: cross-session 2015->6583, task-notification 1104->3141, maintainer 917->3128, compact-summary 110->445. noToolTurns 173->55, 40->24, 7->4. Diagnostics counts: usage-repeat 22894, synthetic-skipped 10, turn-straddles-since 10, boundary-straddle 1, missing-id 1; usage-conflict, collision, tuple-without-usage absent/0. Union manifest digest ccc29f10... matches; result SHA prefixes 23F05A24 and BA8F3CE9 match.
5. Registry honesty: see finding 1. Audit-2026-10-08 line 19 supports the Codex claim ("Collaboration usage did not report token costs; those remain unavailable"). Ledger row 255 says "not reported by the tool" (matches). The Antigravity entry openly cites the maintainer brief and states no repo record carries it (honest, disclosed in the README limits).
6. Tests: mostly meaningful (byte-identity across deep copies, null costs, measured counts derived from a synthetic result with one usage-free tuple, error allowlist, overwrite refusal). See finding 2.

## Findings
1. EDITORIAL, known-limitation. Registry entry `native-dispatch-without-usage-block` says ledger rows "state usage 'not reported by the tool'" for rows 255 and 1628. Row 255 does. Row 1628 says "not reported: a Windows crash killed both agents", i.e. the usage is missing because the agents crashed, not because the tool omits it. The quoted phrase is therefore wrong for 1628. Suggest citing row 255 and 2525/2530 (which say plain "not reported") or rewording the 1628 mention. This is registry text only; no number depends on it.
2. EDITORIAL, known-limitation. The "never emits transcript text or paths" test is weak as a guard: the sentinel is dropped by `analyze` before gaps.mjs sees it, and the gap output is built from a fixed key list, so the assertion cannot fail by a plausible mutation of gaps.mjs except by echoing the input path or error cause. It does cover the path and file-name-in-error cases, which is the part gaps.mjs owns. No change required.

## Rebuttals from previous round
None (round 1).

## Limitations
Result SHA and digests are checked against the files in the worktree, not against the private envelopes or frozen inputs, which I did not and may not read. The 77-file input scope is not independently reproducible here.
