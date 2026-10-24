# Lane F records (plugin batch: CHORE-30, CHORE-65)

Lane F works in `.claude/worktrees/Lane-F`, branch `worktree-Lane-F`, made from `df408f8de` (then `origin/main`) on 2026-10-24. Lane A folds these records into the shared files at merge (`Agents/Lanes/README.md`).

ID ranges: MC-520 to MC-539, CHORE-370 to CHORE-389, ledger rows 3700 to 3899. Overflow: provisional MC-F1, CHORE-F1, row F1. Scratch: `%TEMP%\risu-lane-f\`. Ports: 6480 to 6499 (from the lane F brief; not in the README's ports list).

## MC entries

### MC-520 — Lane F, 2026-10-24: V3 character writes refuse a mismatched or absent selection; V3 getArg/setArg are limited to the calling plugin; setCharacterToIndex's saving is checked in this batch (CHORE-30, CHORE-65, CHORE-370; amends `MC-175` for these API calls only)

- Tag: decisions (`AskUserQuestion` answers by option label, 2026-10-24). Date: 2026-10-24. Sweep ref: none.
- Source: the Lane F session transcript; the sizing packet `%TEMP%\risu-lane-f\sizing\result.md` (investigator, TRACED only). The option labels are the maintainer's choices. The question and option texts are Lane F's wording, quoted below as asked.
- Reasoning: none beyond the answers; the reasons in the option texts are Lane F's.
- Alternatives rejected: item 1: "Write by chaId", "Keep upstream behaviour"; item 2: "Silently ignore"; item 3: "Refuse writes only", "Keep upstream behaviour"; item 4: "Separate ticket".
- Differs from upstream: items 1, 2 and 3. Upstream's `setChar` writes `db.characters[get(selectedCharID)] = char` with no check, and its `getArg`/`setArg` accept any plugin name.
- Related: `MC-175` (amended for these calls only), `MC-349` (V2.1 retired; V2 is not executed, as upstream), `MC-479` (CHORE-30 premise correction), `MC-165` 3 (CHORE-65 low priority), `MC-091` (item 4 as a shared-cause scope amendment), `MC-163`.

**The questions and answers.**
1. Question: "CHORE-30: a V3 plugin calls setChar/setCharacter with a character whose chaId differs from the selected one (selection changed during an await, or it passed another character). What should happen?" Answer: "Refuse the write (Recommended)". The option read: "The V3 call rejects with an error and nothing is written. A plugin doing getChar → edit → setChar keeps its chaId and is unaffected. Breaks only a plugin that deliberately swaps a different-chaId object into the selected slot (none is documented; plugins.md says \"current character\"). A missing chaId still targets the selected slot as today."
2. Question: "CHORE-30: setChar/setCharacter is called while no character is selected (today it writes to characters[\"-1\"], whose save fate is unverified). What should happen?" Answer: "Refuse with an error (Recommended)". The option read: "The V3 call rejects with an error naming the cause; nothing is written. Matches the existing refusal style."
3. Question: "CHORE-65: V3's deprecated getArg('Other::key') / setArg('Other::key', v) read and write another plugin's saved arguments, API keys included, with no prompt. Upstream is identical; no documented cross-plugin use exists, and a community-plugin survey is not possible from here (no probes of community services). What should the fork do?" Answer: "Own plugin only (Recommended)". The option read: "In V3, getArg/setArg refuse (error) when the name before '::' is not the calling plugin's own name. Own-name calls work as before. A plugin family that shares settings this way would break."
4. Question: "The sizing found V3 setCharacterToIndex writes DBState.db directly without the save marking setChar uses; whether its write is saved is unverified (possible silent loss). Include it?" Answer: "Check it in this batch (Recommended)". The option read: "Investigate whether the write is saved; if it is not, fix it here as a shared-cause correction (MC-091) under the same gates. New CHORE ID from Lane F's range."

**What was decided (the chosen options' texts, summarised by Lane F):**
1. A V3 `setChar`/`setCharacter` whose character has a `chaId` that differs from the selected character's rejects and writes nothing; a character with no `chaId` still targets the selected slot.
2. A V3 `setChar`/`setCharacter` with nothing selected rejects and writes nothing.
3. V3 `getArg`/`setArg` refuse a name before `::` that is not the calling plugin's own; own-name calls work as before.
4. Whether `setCharacterToIndex` writes are saved is checked in this batch, and fixed here only if they are not (see CHORE-370: they are).

### MC-521 — Lane F, 2026-10-25: Lane F may register its subagents' exact-file write grants in main's ignored guard registry

- Tag: decision (`AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the Lane F session transcript. The option label is the maintainer's choice; the question and option texts are Lane F's wording.
- Reasoning (Lane F's, from the question): the session was launched rooted at `main`, so its hooks run `main`'s `guard-write.ps1`, whose checkout is `C:\Projects\RisuAI`. A coder reported `checkout=C:\Projects\RisuAI` while working in the Lane-F worktree. The lane brief says never to write to `C:\Projects\RisuAI` itself.
- Alternatives rejected: "I relaunch Lane F", "Orchestrator writes".
- Related: `docs/workflow/ownership.md` (guard root and registration), `Agents/Lanes/README.md`.

**The question and answer.** Question: "This session was launched from main, so the write guard for my subagents is main's copy (checkout=C:\Projects\RisuAI). To let the coder write the 10 named worktree files I must register a grant in main's ignored registry. How should Lane F proceed?" Answer: "Register in main's registry (Recommended)". The option read: "Write one exact-file grant JSON into C:\Projects\RisuAI\.claude\scratch\write-scopes\ (git-ignored, used by the guard only) via the register script, listing only the 10 worktree files; revoke after hand-back. No tracked file in main changes."

**What was decided (summarised by Lane F):** Lane F registers exact-file grants for its subagents in `main`'s git-ignored guard registry, lists only worktree files in them, and revokes each grant after the hand-back. No tracked file in `main` changes.

## CHORE changes

### CHORE-30 — retitle: "V2/V3 setChar writes into whatever character is selected"

- Status (2026-10-24, Lane F): in progress. V2 plugins are not executed (as upstream) and V2.1 plugins are not executed (`MC-349`), so only V3 plugins execute. The live callers are V3 `setChar` and `setCharacter`, both through `setSelectedCharacter` to `getV2PluginAPIs().setChar` (TRACED, sizing packet). Decision: `MC-520` 1 and 2.
- Status (2026-10-25, Lane F): technically accepted; committed on `worktree-Lane-F` as `a2849421a`, not yet merged. `setChar` refuses, before any id fill or write, when nothing is selected, the index is out of range, the slot is not a character, or both `chaId`s are present and differ by `idKey`. Gate 1 rows 3702 and 3703, Gate 2 rows 3705 and 3706, commit message row 3707, full checks row 3708. Residuals (`MC-520` 1): a character with no `chaId` still replaces whatever is selected; a selected slot with no `chaId` accepts any id.

### CHORE-65 — status update

- Status (2026-10-24, Lane F): in progress. The V2 `getDatabase` proxy half is moot: V2 and V2.1 plugins are not executed (`MC-349` for V2.1), and the V3 `getDatabase` is a permission-gated snapshot (TRACED, sizing packet). The live half is V3's deprecated `getArg`/`setArg` aliases with a `Name::key` argument. Decision: `MC-520` 3.
- Status (2026-10-25, Lane F): technically accepted; committed on `worktree-Lane-F` as `5f1322222`, not yet merged. V3 `getArg`/`setArg` throw (the plugin sees a rejected call) unless the name before the first `::` is the calling plugin's own; own-name calls are passed on unchanged. Same gate and check rows as CHORE-30. Retitle suggested at fold-in: drop the moot V2.1 proxy half from the title.

### CHORE-370 — V3 `setCharacterToIndex` may not mark its write for saving (new)

- Status (2026-10-24, Lane F): open, in this batch (`MC-520` 4). Found by the CHORE-30 sizing (TRACED, not run): it assigns `DBState.db.characters[charId]` directly and does not call `setDatabaseLite`, unlike `setChar`. Whether the write is saved is unverified; the check comes first.
- Status (2026-10-25, Lane F): premise refuted; no fix needed (`MC-520` 4 called for a fix only if the write is not saved). The sizing's premise that `setChar` marks characters through `setDatabaseLite` was wrong: the `setDatabaseLite` that `setChar` calls (`src/ts/storage/database.svelte.ts`) only wraps module asset lists and assigns `DBState.db`; it marks no characters. Both `setChar` and `setCharacterToIndex` are saved by the identity tracker in `src/ts/storage/dbChangeEffects.svelte.ts`, which marks any replaced element of `DBState.db.characters` by `chaId`; its comment names V3 `setCharacterToIndex` (TRACED). The existing guard `src/ts/plugins/apiV3/tests/v3SaveMarks.svelte.test.ts` drives `setCharacterToIndex` through the real effects and the real encoder round trip: 2 passed, run by Lane F on `df408f8de` on 2026-10-25 (EXECUTED). Packet: the investigator's hand-back, with `%TEMP%\risu-lane-f\save-mark\neg1.out.json` for the `-1` case.
- Residual, not sized: when the replacing object carries a different `chaId` from the slot it replaces, the tracker does not delete the old `chaId`'s block (TRACED: the tracker only appends marks). `MC-520` 1 covers `setChar`/`setCharacter` only, so `setCharacterToIndex` still accepts a different `chaId`. Whether the old block comes back on reload was not checked. TODO(evidence).

## Ledger rows

In the shared Investigation-Ledger format. Token counts were not measured for these rows.

| # | Date | Question | Tier(s) | Tokens | Escalated? | Outcome |
|---|---|---|---|---|---|---|
| 3700 | 2026-10-24 | CHORE-30, CHORE-65 sizing | `investigator` | not measured | no | Packet accepted as input. V2 proxy half of CHORE-65 moot; CHORE-30 live via V3 only. Its claim that `setDatabaseLite` marks characters was refuted by row 3701. Evidence: `%TEMP%\risu-lane-f\sizing\result.md`. |
| 3701 | 2026-10-25 | CHORE-370 save check, `-1` write fate | `investigator` | not measured | no | `setCharacterToIndex` saved via the identity tracker (existing test, 2 passed); `characters[-1]` is a string key that is not saved (EXECUTED: `Object.keys` `["0","1","-1"]`, length 2, the snapshot drops it). The investigator also reported, from a scratch run, that the selected-character effects marked it; that part is in its hand-back only. The orchestrator checked `setDatabaseLite` and the tracker in source and reran the test. Evidence: the investigator's hand-back; `%TEMP%\risu-lane-f\save-mark\neg1.out.json`. |
| 3702 | 2026-10-25 | Gate 1 round 1, plan for CHORE-30/65 | `adversarial-reviewer` | not measured | no | [REJECT]: B1, existing `v3IdentityFill` tests break under `MC-520` 1 and 2 with no migration named (the orchestrator read those tests and confirmed it). O1 to O4 optional. Evidence: `%TEMP%\risu-lane-f\gate1\review\result.md`. |
| 3703 | 2026-10-25 | Gate 1 round 2 | `adversarial-reviewer` (resumed) | not measured | no | [APPROVE] of plan Revision 2. Evidence: `%TEMP%\risu-lane-f\gate1\plan.md`, review file "Round 2". |
| 3704 | 2026-10-25 | CHORE-30, CHORE-65 implementation | `sonnet-coder` (grant per `MC-521`, revoked after hand-back) | not measured | no | Implementer reports `pnpm vitest run src/ts/plugins` 28 files / 587 passed, `pnpm check` 0 errors, reproducers red on `df408f8de`, mutants M1 to M4 killed. Claims, checked at Gate 2. Evidence: `%TEMP%\risu-lane-f\gate2\impl-handback.md`, `%TEMP%\risu-lane-f\impl\`. |
| 3705 | 2026-10-25 | Gate 2, CHORE-30 and CHORE-65 | `opus-reviewer` | not measured | no | [EDITORIAL]: E1, a `characterWriteCheck.test.ts` title labelled (R) passes against a never-refusing check. Optional O1 (pin the check order), O2 (a `plugins.md` example now always throws) taken by the orchestrator; O3, O4 not taken. O5: base run on the final test snapshot gives 31 failed / 84 passed in the four test files (the implementer's 28/87 predates three migrated tests). Reviewer's own base run and mutants M5 to M13; M9 (checks swapped) survived. `pnpm vitest run src/ts/plugins` 587 passed; `pnpm check` 0 errors. Evidence: `%TEMP%\risu-lane-f\gate2\review\result.md`. |
| 3706 | 2026-10-25 | Gate 2 closure | `opus-reviewer` (resumed) | not measured | no | [APPROVE]. The three edits verified as described; M9 now killed (1 failed / 586 passed); `pnpm vitest run src/ts/plugins` 587 passed. Evidence: review file, "Closure". |
| 3707 | 2026-10-25 | Commit-message check, both commits | `opus-reviewer` (fresh) | not measured | no | [EDITORIAL], both corrections applied by the orchestrator: the CHORE-30 red figure is over its own three test files, 27 failed / 82 passed on `df408f8de` (re-run by the reviewer); `MC-349` covers V2.1 only (V2 is not executed, as upstream). Commit 1's code alone over `src/ts/plugins`: only the 4 CHORE-65 reproducers fail. Evidence: `%TEMP%\risu-lane-f\commit\review\result.md`. |
| 3708 | 2026-10-25 | Full checks, final snapshot (`df408f8de` plus the batch, before it was committed; the tree of `5f1322222`) | Lane F orchestrator | not measured | no | `pnpm check`: 0 errors, 0 warnings. `pnpm build`: built. `pnpm test`: run 1 failed 2 tests in `src/ts/drive/tests/internalBackupSnapshotLoad.svelte.test.ts` (assertion "the main file was moved aside"); that file alone: 111 passed. Run 2, while a reviewer ran tests at the same time: 1 failed in `src/ts/storage/tests/supersededUnits.svelte.test.ts` (timed out waiting for the re-archive; ledger row 2543 records a re-archive timeout in another test of this file under a full run); that file alone: 26 passed. Run 3 with nothing else running: 984 files passed (1 skipped), 22,059 tests passed (23 skipped). Exit codes (check 0, build 0, test 1, 1, 0) were printed by the run script to the session's console, not into the logs. Neither file is one of the three the lane brief names for CHORE-193 (`assetPieceSave`, `firstLife`, `storeImportBoot`), and neither touches plugin code; Lane F treats them as load failures, not counted. Each run rewrote `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` with LF endings only (CHORE-240); restored with `git checkout`, not committed. Evidence: `%TEMP%\risu-lane-f\full\` (test.log, test2.log, test3.log, check.log, build.log). |
| 3709 | 2026-10-25 | Verify this records file | `doc-verifier` (closure resumed) | not measured | no | First pass: approve with five required corrections (setDatabaseLite wording, `MC-349` attribution, shared ledger format, header base, CHORE-240 and row 2543 references), all applied. Closure: APPROVE. The maintainer answers, the exit codes and the ports remain unverifiable from the packets. |

## Handoff

- 2026-10-24: worktree created at `df408f8de`; sizing of CHORE-30 and CHORE-65 dispatched to an investigator (result in `%TEMP%\risu-lane-f\sizing\result.md`).
- 2026-10-25: the maintainer approved committing both ("Commit both (Recommended)", asked because CHORE-30 changes which plugin writes reach the live character database). Commits on `worktree-Lane-F`: `a2849421a` (CHORE-30) and `5f1322222` (CHORE-65). Their combined tree is the snapshot of row 3708. This records file is committed separately, after them. Nothing pushed or merged.
- For lane A at fold-in: `MC-520` and `MC-521` into Maintainer-Context; CHORE-30 retitle and status, CHORE-65 status and retitle, new CHORE-370 (premise refuted; residual TODO(evidence)) into the Roadmap; rows 3700 to 3708 into the Investigation-Ledger. CHORE-206's note "Moot once CHORE-206 lands: CHORE-30 and CHORE-65" and the Roadmap CHORE-65 note "may now be closable after CHORE-206" are superseded by these entries.
- Grant hygiene (`MC-521`): the coder's grant in `main`'s registry was revoked after its hand-back. No other Lane F grant is registered.
- Open follow-ups, not in this batch: the CHORE-370 residual (does `setCharacterToIndex` with a different `chaId` leave the old block, and does it come back on reload?). The `modules.test.ts.snap` LF rewrite on every full run is CHORE-240 (open, lane D); restored here each time.
