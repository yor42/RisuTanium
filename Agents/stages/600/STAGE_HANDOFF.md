# Stage handoff: #600 module installs, single stage

Read this, issue #600 and the repository at origin/main. This was the only stage; none remains.

## 1. Completed

- PR https://github.com/yor42/RisuTanium/pull/646 (`Closes #600`), branch `claude/600-module-load-e6369f`.
- Reviewed code commit f938d0a06 (Gate 2 diff plus two comment wording fixes Gate 2 asked for), then a merge of origin/main cf640e93b (b2d4359f7) that changes none of the PR's files.
- **Note 9 A/B done (MC-3684).** DV-600-1 and DV-600-2 (lane B, baseline) and DV-600-3 (this session, run 4 on the APK from 643b1ad3b) all ran. Results are in the PR body. No second cause; edit-to-commit not longer. Lane A merges on green CI.

## 2. Decisions

- MC-3684: build the fix now; merge after the Note 9 before/after run; a second cause on the phone is reported and asked about before the scope widens.
- MC-3685: a module whose save-tracking deep read fails (thousands of levels deep, or self-referencing) is not retried at other modules' installs. It is read again only when its slot is written, the list's shape changes, or the effects are registered again. Error shown once.
- Mechanism (rules in the comment above the modules effect in `src/ts/storage/dbChangeEffects.svelte.ts`): a flat slot effect holds container, length and every index and marks; one `$effect.pre` holder per index reads only its slot and creates the deep reader; the reader marks in `finally` and rethrows a failure from a microtask. The slot subscription must never sit in an effect that deep-reads: a stack overflow while a child proxy is created leaves that effect with no dependency.
- MC-3686: picker taps were allowed as a fallback for DV-600-3 only (not needed in the end; the guard file-chooser verb fed every file). MC-3687: phone 2's 15 unlisted apps were marked stranded, not removed.
- Mark count equals the base's, plus one class: a slot write or in-place reorder with K leaf edits of other modules in one flush gives 1 + K trues instead of 1. No consumer reads an exact count.

## 3. Changed files

- `src/ts/storage/dbChangeEffects.svelte.ts` (modules effect block and its comment)
- `src/ts/storage/tests/dbChangeEffects.svelte.test.ts` (reproducers R1-R9, guards G1-G23, comment corrections)
- `Agents/mc/600.md` (MC-3684 to MC-3687), this file

## 4. Verification

- Gate 1 (opus-reviewer): r1 REJECT, r2 REJECT, r3 EDITORIAL. Gate 2 (opus-reviewer): EDITORIAL, wording applied and checked (comments only).
- `dbChangeEffects.svelte.test.ts`: 232/232 on the change; on the base effect 220/232, failing exactly the 12 R cases on their read sets. Rerun after merging main: 232/232.
- 26 neighbouring test files 462/462. `pnpm check` 0 errors, 5 existing warnings outside these files. Mutants (scratch, DEV runtime) killed by the named tests; one equivalent survivor accepted at Gate 1.
- PC measurement, best-case hardware (production compile, N=120): slot write with 119 resident about 135 ms before, about 1.4 ms after; whole load about 8 s before, about 0.2 s after.
- CI: TODO(evidence), on the PR.
- Device rows (in the PR body): all DONE. P-chat 232-247 s to 22-29 s; P-home 189-200 s to 9 s; N-chat 15 s to 5-6 s; M-P 101/196 s to 11-25 s; M-N 10 s to 5 s. Baseline load time per 20 modules grew (27 to 61 s); the fix's is flat (3-6 s). Edit-to-commit 24.0 s to 1.4 s (120 modules), 1.9 s to 2.0 s (130 modules). Run evidence is outside the repo, in the #600 run folder (run 4) and lane B's folder.

## 5. Unresolved

- None blocks the merge. The Note 9 A/B found no second cause and no longer edit-to-commit, so MC-3684 needs no maintainer ask.
- Per-install work outside this effect (`refreshModules`, re-render, chat-body re-parse): disposed, no ticket. The phone profiles show no growth with resident modules. What remains is a fixed per-module stub-match cost (canonical JSON encoding and SHA-256).
- `globalApi.saveStore2` "a mark with no edit commits no unit and no commit key" failed once on unmodified source under load and passed on rerun. Not attributed to this change; watch CI.
- #599 (copy plugin modules without installing) shares no file with this PR.

## 6. Next stage

None remains. After the merge: close-out (issue closed by the PR's keyword, board card moved, leftovers above dispositioned), report to lane A, stop. Unused MC block: MC-3688..3693.
