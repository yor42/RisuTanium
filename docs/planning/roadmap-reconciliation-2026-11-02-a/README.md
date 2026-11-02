# Roadmap reconciliation, 2026-11-02, run a

Status: proposal documents only. This is not a maintainer decision and not a Gate verdict. No campaign record, MC entry, ticket or design file was amended. No application code was touched.

Verification: Independently verified 2026-11-02 by two doc-verifiers (proposal/decisions/README; claim and ticket matrices), both ACCEPT WITH CORRECTIONS; corrections applied per lane A's arbitration. A fresh check of the remediation returned ACCEPT WITH CORRECTIONS (28 checked, 27 verified); its one correction (the gate list in the proposal's section 1) was applied by lane A. Remaining UNKNOWN and TODO(evidence) items are listed in the files.

## What this is

The governing prompt is `docs/planning/2026-11-02-claude-roadmap-reconciliation-prompt.md`. It asks for a corrected, decision-ready roadmap proposal that checks the external proposal against the real checkout.

The external proposal is `docs/planning/Independent Architecture Review & Long-Term Development Roadmap.md`. It is advisory. Where it disagrees with the working tree or the records, the working tree and the records win.

## Files in this folder

| File | Use it for |
|---|---|
| `proposal.md` | The corrected roadmap proposal. Start here. |
| `claim-matrix.md` | Every FACT claim and every DECISION REQUEST in the external proposal, with a classification and its evidence. Recommendation and vision rows are grouped. |
| `ticket-matrix.md` | UI-S stages, CHORE-562 to CHORE-588 and the other named tickets: status, real dependencies, persistence boundary, first consumer, device obligations, proposed batches. |
| `decisions.md` | Nine genuinely new choices (Q1 to Q9) for the maintainer, each phrased as a multiple-choice question, plus a short records-housekeeping note (formerly Q10). |

## Snapshot

| Item | Value |
|---|---|
| Branch | main |
| HEAD the evidence packets were taken at | `52c4f0516` |
| HEAD when these files were written | `ea14314bd` (checked with `git rev-parse` and `git diff --stat 52c4f0516 HEAD`) |
| Change between the two | Records only: six files under `Agents/` (Carry-Forward, Decision-Index, Investigation-Ledger, Live-State, Maintainer-Context, Roadmap). No `src/` change. |
| Records added after `52c4f0516` that no packet read | Batch 36, device batch 36, MC-995 and MC-996. The independent verifier read MC-995, MC-996 and the batch 36 rows for CHORE-17 and CHORE-624; the statements they change (CHORE-17 S1-b result, CHORE-624 MC-995/MC-996 wording, Roadmap citations by ticket) are corrected in `proposal.md` and the matrices. TODO(evidence): the other batch 36 rows are unread; read them before relying on any status line below that they may change. |
| Working tree | Dirty and not touched: `.claude/launch.json`, the Android manifest, `src-tauri/Cargo.toml`, a branding svg, untracked `Agents/Handoff-*`, `docs/planning/`, and a few loose files. None of it belongs to this run. |

Dated evidence in these files cites `file:line` as the packets recorded it at `52c4f0516`. Because `src/` did not change between the two HEADs, the code citations are still the code at HEAD. The records citations may have moved.

## Inputs

Evidence packets (lane A scratch under `%TEMP%\risu-b715\rr\`, one `result.md` each):

| Packet | Subject |
|---|---|
| `a-isolation` and `a-verify` | Utility isolation. Where they differ, the verifier wins. |
| `b-reuse` | Existing MCP client and memory code. |
| `c-gates` | Installed MVP, MVP-refresh gates, UI-S1 entry gates, task-preset gate, compatibility policy. |
| `d-queue` | UI-S stages and CHORE-562 to CHORE-588. |
| `e-workflow` | W-01 to W-09 against the existing workflow. |
| `f-claims` | Inventory of 330 claims in the external proposal. It classified nothing. |
| `g-interop` | Notes from primary documents on Agent Skills, OpenCode and MCP. |

Other inputs: the external proposal itself and the earlier fact-check (only to quote what is being corrected), plus the device batch 36 verification at `%TEMP%\risu-b715\b35\db36-verify\result.md` (ACCEPT WITH CORRECTIONS, reported by lane A).

## Evidence method

- This was a writing task. Discovery was done earlier by other agents. The packets are raw inputs, not accepted findings. Their labels and UNKNOWNs are kept.
- Nothing was executed. No build, test or diagnostic ran. Every code statement is a static reading by a packet author.
- The author opened three things directly, only to settle a packet question: `git rev-parse` and `git diff --stat` (HEAD moved), a directory listing of `src/ts/process/utility` and `src/ts/process/memory` (both exist, so the external proposal's paths are right), and a listing of `docs/design` (nine top-level files, no README).
- A lane A spot check was carried in: `useStreaming` is declared in `src/ts/storage/database.svelte.ts` with no default seeding found, and `request.ts` sets `targ.useStreaming = arg.forceStreaming ? true : db.useStreaming && arg.useStreaming`. So a Utility request is non-streaming unless the user turned streaming on.
- Classification words: VERIFIED, WRONG, STALE, OVERSTATED, INCOMPLETE, PROPOSED, UNKNOWN. Evidence kinds: observed code, previously reported check (with its record), diagnostic run, recommendation. No diagnostic was run for this folder.
- Every recommendation is tagged as one of: existing policy, proposed clarification, or amendment requiring approval.
- Any U-, UI-B or Batch label in these files is a proposal label, not an allocated ticket ID. Real IDs come only from the Roadmap.

## How to read the other files

1. `proposal.md` section 1 for the summary and the finding the maintainer asked to see first, then section 2 for the baseline and gates.
2. `decisions.md` for what needs an answer.
3. `claim-matrix.md` and `ticket-matrix.md` only to check a specific statement.

## Known limits

- The packets did not run a full-text search of Maintainer-Context bodies for "workspace". The statement "no MC settles Workspace persistence" is PARTIAL (index search only, plus MC-933 and the CHORE-617 row).
- `Measure-AgentTools.ps1` is not in the repository (the Maintainer-Context entry that cites it gives only the scratch path `plans\Measure-AgentTools.ps1`). Only a scratch path is recorded in the MC entry that cites `plans\Measure-AgentTools.ps1`. Whether the script still exists is UNKNOWN.
- The interoperability notes come from one web fetch on 2026-11-02 and are a fetch summary, not a full read. Re-fetch before relying on exact wording.
