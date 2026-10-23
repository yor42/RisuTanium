# Lane Cloud records: test reliability, suspected-bug checks, small fixes

Lane Cloud's records, kept on branch `lane-cloud` and folded into the shared files by lane A at merge ([README.md](README.md), "Records"). Approved by the maintainer on 2026-10-23 ("let's tackle 1~3 in series"). IDs: MC-700 to MC-749, CHORE-500 to CHORE-549, ledger rows 5000 to 5499, as reserved in the maintainer's lane Cloud brief of 2026-10-23 (the session's opening message). `Agents/Lanes/README.md` has no Cloud row yet; lane A adds it at fold-in. Scratch: the cloud session's scratchpad (outside the repository). The checkout is a Linux cloud container (`/home/user/RisuTanium`, shallow clone of `origin/main` at `9a6127354`), not a Windows worktree.

Phases, in series, with a hand-back between them: (1) test reliability, CHORE-67, CHORE-144, CHORE-152, CHORE-142; (2) the suspected-bug batches CHORE-09 to CHORE-16, verdicts and reproducers only; (3) small fixes, CHORE-138, CHORE-139, CHORE-143, CHORE-133, then any Phase 2 bug the maintainer picks.

## Environment notes

- **Write guard (step 0, 2026-10-23).** The container has no `pwsh` or `powershell`. A scratch Write outside the repository succeeded, so the two project hooks (`SubagentStart` identity and the `Write|Edit` guard) fail to start and do not block (`docs/workflow/ownership.md`: "Hook startup failures ... can proceed through normal permissions"). Route taken: `.claude/settings.json` is left unchanged and pwsh is not installed; the guard's rules are followed by hand: one application-code writer at a time; writes to named files only; subagent outputs named `result.md` or `<id>-result.md` in the session scratchpad.
- **Runtime.** Node 22.22.0, pnpm 10.34.1 (`pnpm install --frozen-lockfile`), 4 CPUs, Linux. Lane A's runs are on Windows; timings here are not evidence for the Note 9 or Pi targets.

## For lane A: store2 test failures in this container (not fixed here; lane B's area)

Baseline full `pnpm test` on unmodified `9a6127354` (Linux, Node 22.22.0, 4 CPUs, 2026-10-23; log in the session scratchpad `base/test.txt`): 937 files passed, 2 failed, 1 skipped; 21,146 tests passed, 10 failed, 30 skipped; 1,681 s. Lane A's Windows full run on the stage C merge `3882db23e` passed (21,163 passed, 23 skipped; `Agents/Handoff-2026-10-23-laneA.md`, In flight row 1). `9a6127354` adds two commits on top of that merge, touching only `.claude/scripts/subagent-identity.ps1` and `Agents/Handoff-2026-10-23-laneA.md` (`git diff --stat 3882db2 9a61273`). The tested source is therefore the same, and the failures here are environment-sensitive (Linux, 4 CPUs; which factor is not established).

- **`src/ts/storage/tests/store2/saveLoop.test.ts`, "a commit with flushed:false does not count as saved and does not fire the callbacks":** `AssertionError: expected 1 to be +0` on `expect(loop.state.saved).toBe(0)`. It is not a timeout. The file run alone failed in 2 of 3 runs, then 4 of 4 (Node 22.22.0), and 1 of 4 under Node 24.22.1, so it is not Node-version specific. Not traced. Two readings are possible, and nothing here tells them apart: a test race (after the two scripted `flushed:false` attempts, an unscripted third attempt commits normally before the assertion runs, the same pattern lane E found in another `saveLoop` test, row 3500), or a loop that counts a `flushed:false` commit as saved. The second would be a persistence defect, so lane A (or lane B) should trace it.
- **`src/ts/storage/tests/store2/replay/actors.test.ts`:** 9 of 71 fail alone as well (8 m 37 s alone): six "two recovering actors over ..." cases and the two "a Tauri restart is a new page" cases time out at 5 s, and "'tauri': every operation under injected faults > no violation, no stall, no throw" times out at 240 s. The log `base/actors-alone.txt` has no assertion error. Vitest prints one shared "Test timed out in 5000ms" for the six grouped "two recovering actors" cases, and one timeout error each for the other three. The cause is not traced; CPU speed is the likely factor (INFERRED).

## For lane A: Phase 2 saved-data risks (not fixed here)

Found in Phase 2 (CHORE-09, CHORE-10), all upstream behaviour too (`MC-069`). Each is a reproduced or traced mechanism in long-term memory or trigger code; the save pipeline after the in-memory assignment was not traced by this lane (that part is opus-reviewer territory). Intended behaviour is decided (`MC-710` to `MC-715`); reproducers are `it.fails` tests.

- **CHORE-10 V3-4 (HypaV3 and HypaV2): hiding a message deletes the summaries that cover it.** Hidden (`disabled`) messages are left out of the `chats` given to memory, so the orphan cleanup treats a covering summary as orphaned. HypaV3 deletes it unless Preserve Orphaned Memory is on (default off); HypaV2 always does. The cleaned data is assigned back to `chat.hypaV3Data` / `chat.hypaV2Data` in `src/ts/process/index.svelte.ts`, and unhiding cannot restore it. REPRODUCED through the real functions (scratch, verified). Decision: `MC-711` 1 (hidden is not orphan).
- **CHORE-10 V2-1 (HypaV2): a failed summary batch followed by a success leaves a permanent gap.** The failed messages are cut from the prompt, covered by no summary, and the saved resume point moves past them. REPRODUCED (scratch, verified). Decision: `MC-713` 1 (retry the same batch).
- **CHORE-10 V2-2 (HypaV2): example turns have no memo,** so summaries ending on one save `null` memos, fail to match on reload and are re-summarised every turn (repeated paid calls, no chat-text loss). REPRODUCED (failing assertions, including the stored-`null` case). Decision: `MC-713` 2 (adopt V3's skip rules).
- **CHORE-10 SUPA-3 (SupaMemory): deleting the resume message leaves saved memory stuck;** every overflowing request then fails until the data is cleared by hand. Not loss. Decision: `MC-714` (repoint to the next message; error and reset for already-dangling data), extended by `MC-715` (no following message: resume from the next new message); `MC-712` 1 is superseded.
- **CHORE-10 SUPA-5: the decided fix migrates a saved setting** (`supaModelType` davinci/curie to instruct35 on load, `MC-712` 7); that later fix is a saved-data change.
- **CHORE-09 item 4: `v2SetLorebookActivation` writes a stray `"2": true` onto a lore entry and calls `markWrite()`,** so the junk key is INFERRED to be saved with the character. Minor; no loss. Decision: `MC-710` 1.

## MC entries

### MC-700 — Lane Cloud, 2026-10-23: commit the completed Phase 1 items

- **Tag:** decision (chat message, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript, after the orchestrator reported CHORE-142 technically accepted (Gate 2 `[APPROVE]`, row 5001) and declined the stop hook's request to commit without the maintainer's approval.
- **Related:** the lane Cloud brief (commit only named paths, after the maintainer approves each commit; push `lane-cloud` only); CHORE-142.

1. **"you can commit the completed items"**

**What was decided:** the completed items may be committed on `lane-cloud`. At the time of the message, that was CHORE-142 (`Agents/Tools/save-gen/generate-and-verify.harness.ts`) and this records file, which records it.

**Notes, not the maintainer's words:** CHORE-67, CHORE-144 and CHORE-152 were still under investigation or verification. They were not complete and are not covered. Pushing `lane-cloud` follows the brief's "push lane-cloud only" (never `main`, never force).

### MC-701 — Lane Cloud, 2026-10-23: when the stop hook asks for a commit, ask the maintainer

- **Tag:** rule (chat message, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript, sent while the MC-700 commit was being prepared, after the session's stop hook (`~/.claude/stop-hook-git-check.sh`) had asked three times to commit and push uncommitted changes and the orchestrator had declined each time without asking.
- **Related:** `MC-700`; the lane Cloud brief (commit only after the maintainer approves each commit).

1. **"rule clarification: when hook asks you to commit, you can use the ask tool for me to confirm."**

**What was decided:** when the stop hook asks for a commit, the orchestrator asks the maintainer with `AskUserQuestion` rather than declining silently or committing. The hook itself is still not approval.

### MC-702 — Lane Cloud, 2026-10-23: fix the CHORE-152 test fake here; close CHORE-144 as observed

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript. Input: the investigator packet (row 5002) and its verification (row 5003).
- **Related:** `MC-091` (scope amendment); CHORE-152, CHORE-144, CHORE-193; lane B's brief (storage tests are lane B's area).

1. **CHORE-152.** Question (paraphrased): about 63% of `assetPieceSave`'s time is a per-character callback in the shared test-only fake `src/ts/storage/tests/tauriChunkFake.ts`, which 29 storage test files reach, all in lane B's area. Should it be fixed here? Answer: **"Fix here, test-only (Recommended)"**. The option said: change only `tauriChunkFake.ts` (both sites), keep `atob`, rerun all 29 files that reach it, plus Gate 2. Lane B sees the change at merge, with a possible overlap if lane B edits the fake.
2. **CHORE-144.** Question (paraphrased): item 2 passed 52 seeds; items 1 and 3 never reproduced and their logs are gone; item 4 is test-environment only on Node 24 and already clamped in three tests. What should be done? Answer: **"Close as observed (Recommended)"**. The option said: no code change; record item 2 as not reproducible, items 1 and 3 as reopen-with-evidence, and item 4 as known and already worked around.

**What was decided:** lane Cloud changes `tauriChunkFake.ts` (test-only) for CHORE-152. CHORE-144 closes with no code change.

### MC-703 — Lane Cloud, 2026-10-23: commit the records only; CHORE-152 waits for its Gate 2

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook asked for a commit)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-700`, `MC-701`, `MC-702`; CHORE-144, CHORE-152.

1. Question (paraphrased): the stop hook wants a commit; uncommitted are the records file and the unreviewed CHORE-152 fake edit. What should be committed? Answer: **"Records only (Recommended)"**. The option said: commit and push just `Agents/Lanes/lane-cloud-records.md`; the CHORE-152 edit waits for its Gate 2.

### MC-704 — Lane Cloud, 2026-10-23: commit CHORE-152 after Gate 2 approves, without asking again

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook asked for a commit)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-701`, `MC-702` 1, `MC-703`; CHORE-152.

1. Question (paraphrased): the only uncommitted change is the CHORE-152 edit to `src/ts/storage/tests/tauriChunkFake.ts`, which is in Gate 2. Commit it? Answer: **"Commit after Gate 2 without asking again"**. The option said: if Gate 2 returns `[APPROVE]`, commit and push it without another question.

**Notes, not the maintainer's words:** this covers the CHORE-152 commit only. Any other verdict than `[APPROVE]` goes back to the maintainer.

### MC-705 — Lane Cloud, 2026-10-23: CHORE-67, move the two preservation tests to jsdom

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript. Input: the investigator survey (row 5008) and its verification (row 5009).
- **Related:** `MC-238` 4, `MC-239` 1; CHORE-67.

1. Question (paraphrased): no test relies on a DOMPurify removal under happy-dom, and the earlier `MC-239` fix holds. Two happy-dom tests (`GridCatalog.coldStub.svelte.test.ts`, `parserTarget.svelte.test.ts`) assert that plain text survives sanitizing, which `MC-239` says is not evidence under happy-dom; both pass under jsdom with no app change; an identity sanitizer cannot falsify them, while an empty-output stub does fail them. What should be done? Answer: **"Move the two to jsdom (Recommended)"**. The option said: add `// @vitest-environment jsdom` to those two test files only (test-only); prove an empty-output stub fails the named tests under jsdom; Gate 2; then close CHORE-67. GridCatalog's test is in the UI-list area other lanes use.

### MC-706 — Lane Cloud, 2026-10-23: commit CHORE-67 with the records after Gate 2, without asking again

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook asked for a commit)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-701`, `MC-704`, `MC-705`; CHORE-67.

1. Question (paraphrased): uncommitted are the records file (decided and verified) and the CHORE-67 pragma edits in progress. What should be committed? Answer: **"CHORE-67 after Gate 2, no re-ask (Recommended)"**. The option said: commit the records and the two test files together once Gate 2 returns `[APPROVE]` and the message is checked; ask again only on any other verdict.

### MC-707 — Lane Cloud, 2026-10-23: commit the Phase 1 reports and records at Phase 1 close, without asking again

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook reported untracked files)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-701`, `MC-706`; CHORE-67, CHORE-142, CHORE-144, CHORE-152.

1. Question (paraphrased): the four Phase 1 reports in `Agents/Lanes/lane-cloud/` are untracked and being revised, then verified; the full checks are running. What should be committed? Answer: **"At Phase 1 close, no re-ask (Recommended)"**. The option said: commit the four reports plus the final records update together after the doc-verifier passes and the full checks finish; then hand back for Phase 1 approval.

### MC-708 — Lane Cloud, 2026-10-23: Phase 1 accepted; start Phase 2

- **Tag:** decision (chat message, 2026-10-23, in reply to the Phase 1 hand-back)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-707`, `MC-069`; CHORE-09 to CHORE-16.

1. The maintainer's words: **"go ahead with Phase 2"**.

**What was decided.** Phase 2 starts under the brief's terms: trace, reproduce or refute the open suspected bugs of CHORE-09 to CHORE-16; no application-code changes; reproducers may be committed as `it.fails` or skipped tests; product questions go to the maintainer. Upstream comparison uses a read-only shallow clone of `kwaroran/risuai` at `f50b5942` (2026-10-23), outside the repository.

**Notes.** At the start of Phase 2 the Roadmap shows CHORE-11, CHORE-13, CHORE-14, CHORE-15 and CHORE-16 resolved by the UI session (2026-10-01 to 2026-10-03), CHORE-12 left with MOD-3 and MOD-5 (neither a bug to trace) and MOD-4 under CHORE-05, and CHORE-09 with items 4, 9, 10 and 11 left and item 7's no-subject fallback. CHORE-10's 21 items have no recorded progress. Phase 2 therefore covers CHORE-09's remaining items and CHORE-10.

### MC-709 — Lane Cloud, 2026-10-23: Phase 2 commits per ticket, without asking again

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, asked under `MC-701` after the stop hook reported the uncommitted `MC-708` entry)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-701`, `MC-707`, `MC-708`.

1. Question (paraphrased): how should Phase 2 commits work? Answer: **"Per ticket, no re-ask (Recommended)"**. The option said: commit the records and each ticket's report plus reproducer tests once its doc-verifier passes, naming paths, and push lane-cloud; hold the MC-708 entry until the first such commit.

### MC-710 — Lane Cloud, 2026-10-23: CHORE-09 items 4, 7, 9, 10 and 11, intended behaviour

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the CHORE-09 investigation and its independent verification)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-208` (CHORE-09 items 1, 3, 5 and 6), `MC-069`, `MC-708`; CHORE-09.

1. Item 4 (the five deprecated V2 lorebook effects never match; `v2SetLorebookActivation` writes a stray `"2": true` and throws out of range). Answer: **"Inert, no junk write"**. The option said: keep returning null/-1 as today (existing cards already cope), but stop the stray "2" write and the throw.
2. Item 7 (`@@inject` with no subject writes to the selected character's current chat; reached from the display parser, the translator and the HypaV3 modal utils). Answer: **"Plumb the owner"**. The option said: pass the owning character and message through those three callers so `@@inject` always hits the right chat; larger change, touches the parser.
3. Item 9 (`extensions.risu_case_sensitive` is round-tripped but has no UI and no matching effect). Answer: **"Honour it + UI toggle"**. The option said: plain keys match case-sensitively when the flag is true (regex keys keep their own flags), and add a per-entry toggle in the lorebook editor (new UI, translator work).
4. Item 10 (`@@inject_lore` merges run after the token-budget cut). Answer: **"Refund when target cut"**. The option said: keep the current order; when the target was cut, give the injector's tokens back so other entries can use them; a cut injector still loses its merge.
5. Item 11 (in regex mode one non-`/pattern/` key fails the whole entry; keys are split on commas before parsing). Answer: **"Plain-substring fallback"**. The option said: non-slash keys in regex mode match as ordinary case-insensitive substrings; regex keys stay regex. The comma-splitting of regex keys was described in the question but not answered separately.

**What was decided.** These answers fix what each Phase 2 reproducer asserts and what a later fix does. Phase 2 changes no application code. Items 9 and 11 change what upstream cards do; item 9 adds UI and translation work; item 7 touches the parser.

**Notes.** The existing guard "a regex-mode key not written as /pattern/ does not activate" in `src/ts/process/tests/lorebookRegexKeys.svelte.test.ts` contradicts answer 5 and would change with the fix. Answer 2 is upstream-different: upstream has no subject path at all.

### MC-711 — Lane Cloud, 2026-10-23: CHORE-10 HypaV3 items V3-2, V3-3, V3-4 and V3-5, intended behaviour

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the HypaV3 investigation and its independent verification)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-069`, `MC-708`, `MC-214`; CHORE-10.

1. V3-4 (hidden messages make covering summaries look orphaned; V3 deletes them unless Preserve Orphaned Memory is on, V2 always; the deletion is assigned back to the chat). Answer: **"Hidden ≠ orphan (Recommended)"**. The option said: check summaries against the full message list, so only messages that were really deleted orphan a summary; hiding never deletes memory; applies to V2 and V3.
2. V3-2 (a non-contiguous bulk re-summarize that includes the newest summary moves the resume point back). Answer: **"Resume from max covered (Recommended)"**. The option said: base the resume point on the latest message covered by any summary, not only the last summary.
3. V3-3 (the "Do Not Summarize User Message" help text matches only the experimental path). Answer: **"Code: std path counts"**. The option said: make the standard path count only summarized messages, as the experimental path does, so the help text becomes true.
4. V3-5 (biased shuffle). Answer: **"Uniform shuffle (Recommended)"**. The option said: replace it with a Fisher–Yates shuffle.

**What was decided.** These answers fix what each Phase 2 reproducer asserts and what a later fix does. Phase 2 changes no application code. V3-4 is a saved-memory loss risk; per the brief it is written up for lane A, and its save pipeline was not traced (opus-reviewer territory).

### MC-712 — Lane Cloud, 2026-10-23: CHORE-10 SupaMemory, rate limiter, token and UI items, intended behaviour

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the CHORE-10 SupaMemory/limiter/UI/token investigation and its independent verification)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-069`, `MC-708`, `MC-711`; CHORE-10.

1. SUPA-3 (deleting the resume message makes plain SupaMemory fail on every overflowing request). Answer: **"Resume at next survivor (Recommended)"**. The option said: fall back to the nearest surviving message after the deleted one and keep the existing summary; no saved-format change.
2. V3-1 (the rate limiter throws when concurrency exceeds RPM, which the UI allows). Answer: **"Allow it (Recommended)"**. The option said: drop the check; the RPM window already gates task starts; no UI change.
3. TOK-1 (V2/V3 subtract the response reservation; the others keep it). Answer: **"Input + response (Recommended)"**. The option said: V2/V3 stop subtracting Max Response, matching the other memory systems and the no-memory path; their prompts get Max Response tokens shorter.
4. SUPA-1 (HypaMemory v1 does not count the loaded summary). Answer: **"Count it (Recommended)"**. The option said: add the loaded summary's tokens on the v1 path as the plain path does.
5. SUPA-2 (v1 queries with the oldest four remaining messages and comma-joins the results). Answer: **"Keep query, fix the join"**. The option said: treat the oldest-4 query as intended; join the results with newlines instead of commas.
6. SUPA-4 (no-progress loop with a tiny chunk size). Answer: **"Exit with an error (Recommended)"**. The option said: when an iteration makes no progress, stop and return the existing "Not Enough Tokens to summarize" style error instead of looping.
7. SUPA-5 (legacy davinci/curie summarizer values). Answer: **"Migrate to instruct35 (Recommended)"**. The option said: on load, map davinci/curie to the gpt-3.5-turbo-instruct option; the saved value changes; upstream reads it fine.
8. UI-1 (dropdown precedence differs from the runtime; the V2 toggle label). Answer: **"Dropdown follows runtime (Recommended)"**. The option said: align the dropdown expression to the runtime order, and give V2 the Hypa toggle label; no saved data changes.

**What was decided.** These answers fix what each Phase 2 reproducer asserts and what a later fix does. Phase 2 changes no application code. Answer 7 changes a saved setting value on load; that later fix is a save-data change for the applicable gate.

### MC-713 — Lane Cloud, 2026-10-23: CHORE-10 Hanurai, HypaV2 and shared retrieval items, intended behaviour

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the CHORE-10 Hanurai/V2/shared investigation and its independent verification)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-069`, `MC-708`, `MC-711`, `MC-712`; CHORE-10.

1. V2-1 (a failed batch followed by a success leaves a permanent coverage gap). Answer: **"Retry same batch (Recommended)"**. The option said: roll back to the batch start and retry it; the existing 3-strike limit then aborts with an error after 3 failures on that batch; nothing is skipped.
2. V2-2 (V2 skips only index 0; example turns and the marker are summarised; the first message can be dropped; memo-less example turns make summaries re-run every turn). Answer: **"Adopt V3's skip rules (Recommended)"**. The option said: skip example turns, the example marker and the new-chat marker as V3 does; only real chat messages are summarized, and the first message is never dropped.
3. V2-3 (the summary section keeps the oldest summaries). Answer: **"Newest-first (Recommended)"**. The option said: select newest summaries first, render them oldest-to-newest.
4. HAN-1 and HAN-2. Answer: **"Fix HAN-1; cap at Chunk Size (Recommended)"**. The option said: fix the prefix and compare trimmed text, so in-prompt messages are not duplicated; and bound retrieval by Chunk Size.
5. V2-4 and V2-5. Answer: **"Fix count; delete stub (Recommended)"**. The option said: deduct skipped entries' tokens; delete the dead `regenerateSummary`.
6. SHARED-1 and SHARED-2. Answer: **"Fix comparator; cosine (Recommended)"**. The option said: use a correct comparator (b - a), and switch to cosine similarity; for unit vectors the ranking is unchanged.

**What was decided.** These answers fix what each Phase 2 reproducer asserts and what a later fix does. Phase 2 changes no application code. V2-1 is a saved-memory loss risk written up for lane A; its save pipeline after the assignment in `index.svelte.ts` was not traced.

### MC-714 — Lane Cloud, 2026-10-23: CHORE-10 SUPA-3 revised: repoint on delete, reset fallback for dangling data

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, after Gate 2 found `MC-712` 1 infeasible as stated)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-712` 1 (superseded for SUPA-3), `MC-223`, `MC-175`; CHORE-10.

1. Question (paraphrased): "resume at the next survivor" cannot be computed at send time (SupaMemory saves only the resume ID and the summary; once the message is deleted nothing records where it stood), and existing dangling data (for example upstream backups) must still load. Answer: **"Repoint + reset fallback (Recommended)"**. The option said: deleting the resume message repoints SupaMemory to the next message (summary kept); for data that is already dangling, a clear error naming the problem, with a one-click reset of SupaMemory data.

**What was decided.** Supersedes `MC-712` 1. The SUPA-3 reproducers assert (a) a message-delete that removes the resume message leaves `supaMemoryData` pointing at the next message with the summary unchanged, and (b) with a dangling ID the send fails with an error that names the SupaMemory resume problem rather than "chat ID not found" (the reset control itself is UI work for the fix).

### MC-715 — Lane Cloud, 2026-10-23: CHORE-10 SUPA-3 edge: no message after the deleted resume message

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, raised by Gate 2 round 2)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-714` (extends it), CHORE-10.

1. Question (paraphrased): under `MC-714`, when the resume message is deleted and no message follows it (Chat.svelte "remove from here", or `/del` reaching the resume message), what should SupaMemory do? Answer: **"Point past the end (Recommended)"**. The option said: treat everything left as already summarised; the next new message becomes the resume point; no error, nothing re-summarised.

**What was decided.** Extends `MC-714`: deleting the resume message with no following message leaves the summary and resumes from the next message sent, without an error and without re-summarising surviving messages. The `MC-714` error-and-reset fallback stays for data that is already dangling. This is a fix-brief requirement; the Phase 2 reproducers do not pin it.

### MC-716 — Lane Cloud, 2026-10-23: Phase 2 close commit; Phase 3 start, commit rule and Phase 2 picks; CHORE-09 open questions

- **Tag:** decision (maintainer messages and `AskUserQuestion` answers, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-709`, `MC-710`, `MC-711` to `MC-715`; CHORE-09, CHORE-10, CHORE-133, CHORE-138, CHORE-139, CHORE-143.

1. Phase 2 close commit. Answer: **"Commit and push (Recommended)"** (commit `4455c00`).
2. Maintainer message: **"start phase 3"**.
3. Phase 3 commit rule. Answer: **"Per ticket, no re-ask (Recommended)"**: commit and push each Phase 3 ticket (tests, fix, report, records) to `lane-cloud` after its Gate 2 passes and its report passes doc-verifier.
4. Which Phase 2 bugs join Phase 3. Answer (multi-select): **"CHORE-09 items 4,9,10,11"**, **"CHORE-10 non-saved items"**, **"CHORE-10 saved-memory items"**. The question stated that the saved-memory items (V3-4, V2-1, V2-2, SUPA-3, SUPA-5) change saved data, had been handed to lane A, and would need explicit go-ahead here; this answer is that go-ahead (opus-reviewer gates; lane A to be informed through these records). CHORE-09 item 7 was not picked.
5. CHORE-09 item 11, comma inside a regex key. Answer: **"Don't split inside /…/ (Recommended)"**: a comma inside a `/pattern/flags` key stays part of the regex; commas between keys still separate keys.
6. CHORE-09 item 10, target re-entry after a refund. Answer: **"No, refund only (Recommended)"**: refunded tokens go to later entries in the normal order; the cut target stays cut.
7. CHORE-09 item 4, trigger editor. Answer: **"Leave editor as is (Recommended)"**: no UI change.

**What was decided.** Phase 3 covers CHORE-138, CHORE-139, CHORE-143 and CHORE-133, plus CHORE-09 items 4, 9, 10 and 11 and all CHORE-10 items (including the saved-memory items), each to its `MC-710` to `MC-715` decision and items 5 to 7 above. Per-ticket commits after Gate 2 and doc-verifier, without re-asking.

### MC-717 — Lane Cloud, 2026-10-23: CHORE-138, CHORE-139 and CHORE-143 decisions

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-250` (CHORE-138's accepted limitation, now superseded for this gap), `MC-716`; CHORE-138, CHORE-139, CHORE-143.

1. CHORE-138, triple-touch gesture without `touchcancel` (two touches, a cancel, then one touch within 300 ms opens the quick menu). Answer: **"3-line fix (Recommended)"**: a `touchcancel` resets the count, like `touchend`. Fork-only; upstream has the same gap.
2. CHORE-139, deleting a folder's last remaining character leaves an empty folder until the next order check. Answer: **"Yes, remove it (Recommended)"**: fix `checkCharOrder` to drop a folder it just emptied, matching bulk delete, and remove the now-redundant double-call workarounds.
3. CHORE-143, already fixed on the fork (null-error window events are warn-only, which also silences cross-origin "Script error." events). Answer: **"Keep silent, close (Recommended)"**: close the ticket as already fixed.

### MC-718 — Lane Cloud, 2026-10-23: CHORE-09 fix-plan amendments and CHORE-133 decisions

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-710`, `MC-716`, `MC-091` (scope amendment), `MC-175`, `MC-245` 1, `MC-238`, `MC-239`; CHORE-09, CHORE-133.

1. CHORE-09 item 11 knock-on: the V2/V3 card exporters in `src/ts/characterCards.ts` also split lorebook keys on commas, which would rewrite `/dragon{1,2}/` on export and re-import. Answer: **"Yes, same splitter (Recommended)"**: the exporters use the same regex-aware splitter (shared-cause scope amendment).
2. CHORE-09 items 9 and 11: does Case Sensitive govern the plain-text match of a non-`/pattern/` key in regex mode? Answer: **"Yes, follow the toggle (Recommended)"**: off (default) case-insensitive; on case-sensitive; `/pattern/` keys keep their own flags.
3. CHORE-09 item 10: an injector whose target never activated. Answer: **"Refund too (Recommended)"**: same treatment as a cut target.
4. CHORE-133, the one-sentence translator path that writes the source text back with `innerHTML`. Answer: **"Insert as text (Recommended)"**: use `textContent`.
5. CHORE-133, the edit-display replacement that writes translator output back with `innerHTML`. Answer: **"Leave it, separate ticket (Recommended)"**: out of this ticket; to be filed as a new ticket (proposed in the CHORE entries).

## CHORE entries (proposed status changes)


### MC-719 — Lane Cloud, 2026-10-23: CHORE-10 fix-plan questions (SHARED-2 scope, UI-1 toggle)

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the CHORE-10 batch A and B fix plans)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-712` 8, `MC-713` 6, `MC-091`; CHORE-10.

1. SHARED-2 scope (HypaV3 similar-memory search uses the same dot-product score). Answer: **"Shared retriever only (Recommended)"**. The option said: switch only the shared HypaProcesser to cosine; V3 similar-memory stays on dot product; no effect on emotion scoring.
2. UI-1 toggle label order (Hanurai and HypaV3 both on: the label says Hypa, the runtime runs Hanurai). Answer: **"Follow runtime order (Recommended)"**. The option said: order the label checks as the runtime does (Hanurai, then Hypa V2/V3, then Supa); with Hanurai+V3 on, the label says Hanurai.
3. UI-1 toggle visibility (a V2-only setup with summarizer type `none` shows no toggle, although the runtime runs V2). Answer: **"Yes, show it (Recommended)"**. The option said: add V2 to the toggle's visibility condition at the same two render sites; no saved data changes.

**What was decided.** `MC-713` 6 applies to the shared retriever only. Correction to the option text of answer 1 (Gate 1 review, scratchpad `p3/c10/A/g1/result.md`): the shared retriever's scores also reach the emotion-image code. For a non-normalised Custom Server embedding model, emotion selection can change, because the fixed penalties act on a cosine scale. "No effect on emotion scoring" holds only for normalised embeddings. The other option would have had the same effect (orchestrator reasoning: both options switch the shared retriever). The UI-1 fix orders the toggle label by runtime precedence and shows the toggle for V2-only setups; item 3 is a same-cause scope amendment (`MC-091`).

### MC-720 — Lane Cloud, 2026-10-23: CHORE-10 SUPA-3 storage, hidden resume and whole-list replacement

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the CHORE-10 batch C fix plan)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-714`, `MC-715`, `MC-175`, `MC-223`, `MC-091`; CHORE-10.

1. How to store `MC-715` "point past the end" (the resume point is a message ID and the next message does not exist yet). Answer: **"ID plus fork-only flag (Recommended)"**. The option said: point at the last remaining message, and add a fork-only chat field meaning "that message is already summarised too". Upstream ignores the field and sees a valid ID, so a backup opened there works but re-summarises that one message. It adds a saved field, so the save-data reviewers check it first.
2. A hidden resume message (hiding it, or a branch that hides messages, makes every overflowing send fail with "chat ID not found"). Answer: **"Yes, resolve at send (Recommended)"**. The option said: when sending, look the resume message up among all messages, hidden included, and resume from the next visible message. Same-cause scope amendment (`MC-091`); no format change.
3. Whole-list replacement (`/send` clear mode, `setFullChat`, the reroll history swap). Answer: **"Error and reset (Recommended)"**. The option said: do not repoint; if the resume message is gone, the send shows the new SupaMemory error, which offers the Reset control.

4. Every message of a chat that has a SupaMemory summary is deleted (no message ID is left to point at). Answer: **"Clear the memory (Recommended)"**. The option said: every message the summary covered is gone, so clear the chat's SupaMemory data, as HypaV3 drops summaries whose messages were deleted; the next long chat starts a new summary; no error.

**What was decided.** The `MC-715` case keeps an upstream-readable resume ID and adds one fork-only chat field. The field is a save-format addition subject to opus-reviewer and a senior-advisor plan challenge. Upstream degrades to re-summarising one message. A hidden resume message resolves at send time. Whole-list replacement falls back to the `MC-714` error and reset path. Deleting every message clears `supaMemoryData` (answer 4, asked after the senior-advisor challenge).

### MC-721 — Lane Cloud, 2026-10-23: CHORE-10 SupaMemory clear mode and reset placement

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the batch C Gate 1 review, scratchpad `p3/c10/C/g1/result.md`)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-714`, `MC-720` 3 and 4; CHORE-10.

1. `/send` in clear mode empties the whole chat (`MC-720` 3 and 4 point two ways). Answer: **"Clear the memory (Recommended)"**. The option said: if the chat ends up with no messages, clear the SupaMemory data as for deleting every message (`MC-720` 4); the error and reset path stays for replacements that leave other messages, such as setFullChat and the reroll swap.
2. Where the reset is offered when the saved resume point is already broken. Answer: **"Button in settings (Recommended)"**. The option said: the error names the problem and says to press "Reset SupaMemory" in the character's chat memory settings, where the summary text box is; one place to maintain.

**What was decided.** A chat left with no messages, whatever emptied it, clears `supaMemoryData` (and the covered-ID field). The `MC-720` 3 "offers the Reset control" is met by the error naming the settings button.

### MC-722 — Lane Cloud, 2026-10-23: CHORE-10 ambiguous memo-less summaries; empty chat and HypaMemory v1

- **Tag:** decision (`AskUserQuestion` answers, 2026-10-23, after the batch C Gate 1 round 2 review, scratchpad `p3/c10/C/g1r2/result.md`)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-711` 1 and 2, `MC-713` 2, `MC-721` 1, `MC-175`; CHORE-10.

1. A saved HypaV2/V3 summary that ends on a message with no saved ID (the greeting, or an example turn; upstream summaries can cover example turns only) is ambiguous. Answer: **"Re-summarise, never lose (Recommended)"**. The option said: when it cannot tell, treat the greeting as not yet summarised; the worst case is the greeting summarised twice, costing an extra call; nothing is lost.
2. Whether `MC-721` 1 (a chat left with no messages clears its SupaMemory) also clears HypaMemory v1 data (`hypa:` prefix in the same field). Answer: **"Clear it too (Recommended)"**. The option said: an empty chat clears the field whatever its kind; v1's summaries describe messages that no longer exist.

**What was decided.** Resume and coverage rules for memo-less entries must never treat an ambiguous summary as covering the greeting; a duplicate summary is acceptable, a silent drop is not. A chat left with no messages clears `supaMemoryData` whatever its kind, and the covered-ID field.

### MC-723 — Lane Cloud, 2026-10-23: CHORE-10 bounded greeting re-summary with example turns

- **Tag:** decision (`AskUserQuestion` answer, 2026-10-23, after the senior-advisor memo-less mechanism reconsideration, scratchpad `p3/c10/C/advisor2/result.md`)
- **Date:** 2026-10-23
- **Sweep ref:** none
- **Source:** the lane Cloud session transcript.
- **Related:** `MC-722` 1, `MC-711` 2; CHORE-10.

1. The narrow case left by the never-lose rule: with example turns and a summary batch that is the greeting alone (V2: greeting plus the next message exceeds Chunk Size; V3: one message per summary), each send can summarise the greeting again until the chat grows by about the greeting's length (probe: 3 sends, one extra paid call each). Answer: **"Accept and report (Recommended)"**. The option said: keep the rule and record this as a known limitation; a few repeat summaries of the greeting in this rare setup; no loss; summary sizes stay as configured.

**What was decided.** The advisor's shared rule is adopted unchanged: a memo-less key counts for the resume only when the first memo-less chat is the greeting; the orphan valid set always contains it. The bounded duplicate is a reported limitation, not fixed by overshooting batch sizes.

### CHORE-67 — Existing tests that run DOMPurify under happy-dom may pass for the wrong reason

**Proposed status (2026-10-23, lane Cloud): CLOSED (`MC-705`); the two residual tests were moved to jsdom on `lane-cloud`; technically accepted (Gate 2, row 5011).** The Roadmap's "open, not scheduled" status (2026-10-02) was stale: the main fix was made under `MC-238` 4 and `MC-239` (six files moved to jsdom in `76af9bba`, per `MC-239`), and the residual survey below confirms it holds.

- **Survey (rows 5008 and 5009, verified by rerun):** in a scratch run with `dompurify` aliased to a recording stub over the real library, 40 test files call the sanitizer (17 jsdom, 23 happy-dom; "call" means a `sanitize` or factory call, not an import). With an identity stub, 28 tests in 10 files fail, and all 10 files run under jsdom. No happy-dom file depends on a sanitizer removal. Under happy-dom, DOMPurify reported a removal on every call (an observation; the cause is not established).
- **Residual fixed (`MC-705`):** two happy-dom tests read sanitized text. They are `src/lib/Others/GridCatalog.coldStub.svelte.test.ts` ("the list layout still shows the en section when a long text precedes it in the description", `[data-description]` filled through `{@html}`) and `src/ts/parser/tests/parserTarget.svelte.test.ts` ("ParseMarkdown of a message with {{getvar}} reads the selected chat's variable"). Both now carry `// @vitest-environment jsdom`, and the second file's header comment says why. No other line changed.
- **Evidence:**
  - With the real DOMPurify under jsdom, both files pass 26 of 26 (implementer twice, reviewer once).
  - With an empty-output stub under jsdom, exactly the two named tests fail (`expected '' to be 'English description'`, `expected '' to contain 'a-value'`) and 24 pass. An identity stub cannot falsify these preservation tests, and it passes them 26 of 26.
  - Every one of the 26 tests has the same outcome under happy-dom (HEAD copy) and jsdom.
  - `GridCatalog.coldStub`'s only happy-dom-specific code is a `clientWidth` override, which still applies under jsdom (no layout in either). This is from the Gate 2 reviewer's hand-back message, not its result file, and the doc-verifier confirmed it from source (row 5012).
  - `pnpm check` 0/0, with an 8 GiB heap.
- **Not done:** the other 21 happy-dom files that call the sanitizer pass under an empty-output stub, so their assertions do not read sanitized content; they stay on happy-dom. Moving all 23 would fail 6 tests in 3 files (`AlertComp.focusBox`, `charlistAvatarLazy`, `charlistAvatarLookups`; focus and inert differences, not diagnosed). Seven jsdom files that call the sanitizer pass under the identity stub (they assert no removal); that is a test-quality question outside this ticket.

### CHORE-142 — `Agents/Tools/save-gen/generate-and-verify.harness.ts` is broken

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud`; technically accepted (Gate 2 `[APPROVE]`, row 5001); uncommitted until the maintainer approves the commit.** Type: tooling; no application code. The entry's path was wrong: the file is under `Agents/Tools/save-gen/`.

- **Failure (reproduced 2026-10-23, `9a6127354`):** `npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/generate-and-verify.harness.ts` exited 1 with `[vitest] No "readImage" export is defined on the "src/ts/globalApi.svelte" mock`, thrown at module load in `src/ts/media/avatarThumb.ts`, reached from `src/ts/characters.ts`; 4 tests skipped.
- **Cause:** the harness's module mocks were copied from `src/ts/storage/tests/risuSave.test.ts` and had gone stale. That test now also mocks `src/ts/storage/store/appStore` (through `appStoreModuleOver` in `src/ts/storage/tests/appStoreMock`), which keeps the real application graph from loading.
- **Change (harness file only, +15/-5):** the same `appStore` mock; `store` declared through `vi.hoisted`; the header and region comments updated (the stale "copied verbatim ... lines ~7-55" is gone). No assertion changed. `appStore` is not on the verified path: `risuSave.ts` calls `getAppStore` only in its remote-sync branch (orchestrator check).
- **Evidence:** after the fix the same command exits 0 with 4 of 4 passed (implementer 3 runs, orchestrator 1, reviewer 1). The reviewer's scratch mutant (a decoder wrapper that drops one character) failed all 4 tests ("expected 30 to be 31"). `pnpm test`'s default glob does not match `*.harness.ts`. `Agents/Tools` is outside `tsconfig.json`'s include, so `pnpm check` does not cover it.

### CHORE-152 — Slow and flaky test: `src/ts/storage/tests/assetPieceSave.test.ts`

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud` (test-only, `MC-702` 1); technically accepted (Gate 2 `[APPROVE]`, row 5006).** The flaky part was already closed by CHORE-193 step 2 (lane E, `4cf1cce22`: `vi.setConfig({ testTimeout: 30_000 })` in the file), which this change leaves in place.

- **Cause (rows 5002 and 5003, verified by execution):** about 63% of the file's CPU self time was the per-character callback `Uint8Array.from(atob(data), (char) => char.charCodeAt(0))` at the two chunk-write sites of the shared test fake `src/ts/storage/tests/tauriChunkFake.ts`, which runs over each chunk of about 1 MiB. `assetPieceSave` reaches the fake through `tauriDesktopFake.ts`.
- **Change (that file only, +17/-2):** both sites call a local `decodeBase64` helper that keeps `atob` and copies the bytes with an index loop. `atob` stays because it rejects invalid characters and bad lengths that `Buffer.from(data, 'base64')` accepts, so a producer bug still fails in the fake. It tolerates missing padding, as before.
- **Evidence (loaded Linux machine; timings indicative only, not evidence for the Note 9 or Pi targets):**
  - Equivalence script (compatibility guard; there was no behavioural defect to reproduce): 2003 valid inputs decode byte-identically before and after, and 13 edge and invalid inputs give the same throw or result. The throw still happens before the size record and the fault hook.
  - All 31 test files that reach the fake (directly, through `tauriDesktopFake.ts` or through `tauriWireFake.ts`): 31 of 31 files, 964 of 964 tests passed, by the implementer and the reviewer.
  - `assetPieceSave.test.ts` alone: 23 of 23 in 10.7 s (Gate 2 log) and 10.2 s (doc-verifier rerun), against 35.7 s before (verification control, row 5003). The implementer's own figures of about 10 s were not logged.
  - `pnpm check`: 0 errors, 0 warnings, run with `NODE_OPTIONS=--max-old-space-size=8192`. The implementer reported a heap out-of-memory abort at the default limit; that log was not kept.
- **Gap, not fixed (out of scope):** no repository test notices if the fake's decoder is swapped for a lenient one (an implementer's scratch mutant).

### CHORE-144 — Test-suite fragilities seen during the sidebar closeout

**Proposed status (2026-10-23, lane Cloud): CLOSED as observed, no code change (`MC-702` 2).** Evidence: rows 5002 and 5003 (investigator packet `c144/result.md`, verified with corrections in `c144/verify/result.md`, session scratchpad). Runtime: Linux, Node 24.22.1 unless noted, loaded machine.

- **Item 1, `backuplocalCharacterIdsExport` "(G) ... byte for byte": not reproduced; UNCERTAIN.** Every run passed all 10 tests in the file: 3 plain runs, 6 shuffle seeds, and 12 seeds run as 3 batches of 4 parallel processes under load. The test takes about 2 ms, so a timeout is not the cause. No random input was found, and the encode is deterministic (gzip mtime 0). The assertion `expect(Buffer.equals(...)).toBe(true)` prints nothing useful when it fails. Reopen only with the failing run's output.
- **Item 2, `backuplocalEncryptedRefusal` under `--sequence.shuffle`: not reproducible on current main.** It passed 41 of 41 with 42 seeds (1 to 40, 12345, 99999), with 10 more seeds in the verification, and 51 of 51 with 8 seeds on Node 22.22.0 run together with `backuplocalCharacterIdsExport`. The failing seed was never recorded. Reopen with a recorded seed.
- **Item 3, `nodeHttpStore` ENOBUFS: not reproduced; UNCERTAIN.** The file starts one child server in `beforeAll` and sends sequential requests, so the "unbounded connections" premise is refuted. ENOBUFS is an OS error from spawn, bind or socket calls. The shared spawn-and-listen in `src/ts/storage/tests/nodeServerFixture.ts` (17 test users) is a candidate under a parallel full run (INFERRED). Reopen with the failing stack.
- **Item 4, msgpackr 1.10.1 `utf8Write` `ERR_BUFFER_OUT_OF_BOUNDS`: CONFIRMED, test environment only.** On Node 24.22.1, `Packr.encode` throws for any string of 64 or more characters (`pack.js` calls `target.utf8Write(str, pos, 0xffffffff)`), standalone and inside vitest. Node 22.22.0 does not throw. Three tests already clamp `Buffer.prototype.utf8Write` (`risuSave.msgpackRelease.test.ts`, `composedRoundTrip.svelte.test.ts`, `exportStubForm.test.ts`). The app imports only `msgpackr/index-no-eval`, in browser code whose `Buffer` is the feross polyfill, which has no `utf8Write`, so msgpackr takes its `encodeInto` path. That is source reasoning, not run in a WebView. Nothing under `server/` uses msgpackr. Not checked: which other tests would fail on Node 24 without a clamp (CI uses Node 24).

### CHORE-09 — open items 4, 7, 9, 10, 11 (Phase 2)

**Proposed status (2026-10-23, lane Cloud): items 4, 9, 10 and 11 REPRODUCED, item 7 TRACED; intended behaviour decided (`MC-710`); fix not started (Phase 3 only if the maintainer picks it).** No application code changed. Report: [CHORE-09-result.md](lane-cloud/CHORE-09-result.md); commit `04126b6`. Ledger rows 5016, 5017 and 5024 to 5027.

- **Reproducers:** `src/ts/process/tests/triggerLegacyLorebook.test.ts` (item 4: 3 `test.fails`, 2 guards) and `src/ts/process/tests/lorebookKeyMatching.svelte.test.ts` (items 9, 10, 11: 6 `test.fails`, 8 guards). Item 7 has no test until the owner plumbing exists. Gate 2 `[EDITORIAL]`, applied.
- **Upstream (`MC-069`):** items 4, 9, 10 and 11 are upstream behaviour too; item 7 differs from upstream.
- **Open for the fix brief:** whether a comma inside a regex key is split (item 11), whether a cut target can be readmitted (item 10), and the existing guard in `lorebookRegexKeys.svelte.test.ts` that contradicts `MC-710` 5.

### CHORE-10 — long-term memory items (Phase 2)

**Proposed status (2026-10-23, lane Cloud): all 21 items investigated; 19 have `test.fails` reproducers (UI-1 for its label half only), V2-5 and SHARED-1 have none; intended behaviour decided (`MC-711`, `MC-712`, `MC-713`, `MC-714`, `MC-715`; `MC-712` 1 superseded by `MC-714`); fix not started (Phase 3 only if the maintainer picks it).** No application code changed. Report: [CHORE-10-result.md](lane-cloud/CHORE-10-result.md); commit `ae9edbf`. Ledger rows 5018 to 5023 and 5028 to 5037.

- **Reproducers:** ten new test files under `src/ts/process/memory/`, `src/ts/storage/tests/`, `src/lib/SideBars/` and `src/ts/process/`; 40 guards pass and 32 reproducers are expected failures. Gate 2: batch 1 `[APPROVE]`; batch 2 `[REJECT]`, `[REJECT]`, then `[APPROVE]` in round 3.
- **Upstream (`MC-069`):** every item is upstream behaviour too.
- **Saved-data risks:** handed to lane A in "For lane A: Phase 2 saved-data risks" above (V3-4, V2-1, V2-2, SUPA-3, SUPA-5).
- **Phase 3 batch B (2026-10-23, proposed): SUPA-1, SUPA-2, SUPA-4, V3-1, TOK-1 and UI-1 fixed on `lane-cloud`** to `MC-712` 2-6 and 8 and `MC-719` 2-3. Gate 1 round 1 `[REJECT]` (row 5071) and round 2 `[APPROVE]` (row 5074); Gate 2 `[APPROVE]` (row 5079). No saved data changes; fork-only. Remaining: batch A (`MC-719` 1, rows 5070, 5072, 5075) and batch C, the saved-memory items (`MC-720`, `MC-721`; rows 5073, 5077, 5078). Report section: [CHORE-10-result.md](lane-cloud/CHORE-10-result.md) "Phase 3 — batch B fixes".
- **Phase 3 stage A1 (2026-10-23, proposed): HAN-1, HAN-2, V2-3, V2-5, SHARED-1 (compatibility guard only) and V3-5 fixed on `lane-cloud`** to `MC-711` 4 and `MC-713` 3 to 6. Gate 1 as batch A (rows 5072, 5075); Gate 2 `[APPROVE]` (row 5085). No saved data changes; fork-only. Batch A stages A2 (SHARED-2) and A3 (V3-2, V3-3) remain; A3 follows the memo-less decision (`MC-722` 1) and waits for the senior-advisor mechanism reconsideration the orchestrator dispatched after the second batch C rejection (scratchpad `p3/c10/C/plan.md`, orchestrator section; result pending). Report section: "Phase 3 — stage A1 fixes".
- **Phase 3 stage A2 (2026-10-23, proposed): SHARED-2 fixed on `lane-cloud`**: the shared HypaProcesser scores with cosine (zero-magnitude guarded); HypaV3 similar-memory stays on dot product (`MC-713` 6, `MC-719` 1). Gate 2 `[APPROVE]` (row 5090). No saved data changes; fork-only. Non-normalised Custom Server embeddings can change emotion-image selection (disclosed). Report section: "Phase 3 — stage A2 fixes".
- **Phase 3 stage A3 (2026-10-23, proposed): V3-2 and V3-3 fixed on `lane-cloud`** to `MC-711` 2 and 3, `MC-722` 1 and `MC-723`: a shared resume helper (`hypaResume.ts`) resumes after the highest covered position, counting a memo-less key only when it can only be the greeting; the standard batching loop counts summarised messages only. Saved-memory change (which messages are summarised); the `hypaV3Data` shape is unchanged. Gate 1 rows 5094 (`[EDITORIAL]`); Gate 2 `[EDITORIAL]` row 5099, editorial applied row 5100. Fork-only. Proposed follow-up CHORE-501. Report section: "Phase 3 — stage A3 fixes".
- **Phase 3 stage C1 (2026-10-23, proposed): SUPA-5 fixed on `lane-cloud`** to `MC-712` 7: `setDatabase` maps a saved `supaModelType` of `davinci` or `curie` to `instruct35` on load. Saved-settings change, idempotent; upstream reads `instruct35` (MC-175, MC-223). Gate 1 `[APPROVE]` (round 2); Gate 2 `[EDITORIAL]` row 5104, comment reworded. Report section: "Phase 3 — stage C1 fix".
- **Residuals:** SHARED-1 and V2-5 untested; Hanurai split mode untested; the experimental V3 path is not tested for similar-memory retrieval; the SUPA-3 fix must repoint on every delete path (Chat.svelte remove, `/cut`, `/del`, `cutChat`/`removeChat` in scriptings, trigger cuts) and implement `MC-715`, which no test pins.

### CHORE-138 — The triple-touch counter has no `touchcancel`

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud` (`MC-717` 1); technically accepted (Gate 2 `[APPROVE]`, row 5047).** A `touchcancel` listener in `initHotkey()` resets the count like `touchend`; regression test `src/ts/hotkey.touchcancel.test.ts` (reproducer failed before the fix). Fork-only; upstream has the same gap. Real Android WebView cancel behaviour untested. Report: [CHORE-138-result.md](lane-cloud/CHORE-138-result.md).

### CHORE-143 — A ResizeObserver-loop event makes `bootstrap.ts`'s global error handler throw before `alertError`

**Proposed status (2026-10-23, lane Cloud): CLOSED, already fixed on the fork (`MC-717` 3); no change in this lane.** `bootstrap.ts` delegates to `handleWindowError` in `src/ts/windowErrorGuard.ts`, which warns only for events without an error object (covered by `windowErrorGuard.test.ts`). Upstream still has the defect. The Roadmap entry's "open" status is stale. Report: [CHORE-143-result.md](lane-cloud/CHORE-143-result.md).

### CHORE-133 — Translator `combineTranslation` single-sentence case sets `node.innerHTML`

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud` (`MC-718` 4); technically accepted (Gate 1 rows 5051, Gate 2 `[APPROVE]` row 5055).** The one-sentence branch writes the flattened source text with `textContent`, so decoded `&lt;img&gt;` stays literal and `&amp;amp;` no longer collapses; no formatting is lost (markers are already markdown). Regression test `src/ts/translator/translateSingleSentenceText.test.ts` (jsdom; reproducers failed before the fix). No exploit was found: downstream consumers sanitize. Fork-only; upstream has the same line. Scope: the single-sentence reparse only. Report: [CHORE-133-result.md](lane-cloud/CHORE-133-result.md).

### CHORE-501 — HypaV3 modal "next summarisation" preview uses the last summary's last memo (proposed)

**Proposed (2026-10-23, lane Cloud):** `getNextSummarizationTarget` in `src/lib/Others/HypaV3Modal/modal-footer.svelte` still finds the next message from the last memo of the last summary. After CHORE-10 stage A3 the real resume point is the highest covered position (`MC-711` 2, `MC-722` 1), so this display-only preview can disagree with what is summarised next, for example after a bulk re-summarise of older summaries. No data effect. Found at the stage A3 Gate 2 review (row 5099). Not fixed: the preview works on the full message list, not the prompt list the shared helper reads, so it needs its own small change and test.

### CHORE-500 (proposed new ticket) — Translator edit-display replacement writes translator output with `innerHTML`

**Proposed status (2026-10-23, lane Cloud): open, not scheduled (`MC-718` 5).** In `src/ts/translator/translator.ts`, `translateNodeText`'s edit-display branch writes `processedTranslated` (translator or LLM output after the card's display scripts) with `newNode.innerHTML`; card authors may rely on HTML there. Downstream consumers sanitize. Gate 1 for CHORE-133 showed this site re-parses literal text into elements when a card's edit-display output differs from the translation. Evidence: [CHORE-133-result.md](lane-cloud/CHORE-133-result.md); scratchpad `p3/c133/g1/result.md`.

### CHORE-09 — Phase 3 fix of items 4, 9, 10 and 11

**Proposed status (2026-10-23, lane Cloud): items 4, 9, 10 and 11 fixed on `lane-cloud` (`MC-710`, `MC-716` 5 to 7, `MC-718` 1 to 3); technically accepted (Gate 1 `[EDITORIAL]` row 5050, Gate 2 `[EDITORIAL]` row 5061, E1 applied row 5062). Item 7 remains open (not picked, `MC-716` 4).** New `src/ts/process/loreKeys.ts` splitter used by lorebook matching and the CCv2/CCv3 exporters; Case Sensitive toggle in the lorebook editor; en.ts keys `caseSensitive` and `help.caseSensitiveLorebook` (other locales: translator). `docs/wiki/Lorebook.md` and `Trigger-Script.md` describe the old behaviour (maintainer's to update). Report: [CHORE-09-result.md](lane-cloud/CHORE-09-result.md), Phase 3 section.

### CHORE-139 — `removeChar` leaves a just-emptied folder in place

**Proposed status (2026-10-23, lane Cloud): fixed on `lane-cloud` (`MC-717` 2); technically accepted (Gate 2 round 1 `[REJECT]` row 5058, round 2 `[EDITORIAL]` row 5065, editorial applied row 5066).** The cause was in `checkCharOrder` (emptiness tested before pruning), not `removeChar`: one pass now drops a folder it just emptied, matching bulk delete, and the double-call workarounds in `trashFolderMembers` and `trashCharacters` are removed. Regression test `src/ts/characters.removeCharFolderPrune.svelte.test.ts`; `GridCatalog.folderMenu` (F) updated to one call. Reactive-database change (`characterOrder` spliced in place, as the old second pass did); save format unchanged. Upstream has the same pruning order. Report: [CHORE-139-result.md](lane-cloud/CHORE-139-result.md). Gate 1 not required: small low-risk fix under the `gates.md` carve-out; Gate 2 (opus-reviewer) found two missed call-count pins. Ledger rows 5041, 5043, 5053, 5058, 5060, 5065 to 5068.

## Ledger rows

| # | Date | Question | Tier(s) | Tokens | Escalated? | Outcome |
|---|---|---|---|---|---|---|
| 5000 | 2026-10-23 | CHORE-142: make the harness run again, editing only `Agents/Tools/save-gen/generate-and-verify.harness.ts` (scratchpad `c142/result.md`) | test-warrior | 32,460 (subagent usage) | no | Pre-fix failure reproduced (the `readImage` mock error); the `appStore` mock, mirroring `risuSave.test.ts`, plus `vi.hoisted` for `store`; 4 of 4 pass in 3 runs; no assertion changed. |
| 5001 | 2026-10-23 | CHORE-142 Gate 2 (scratchpad `c142/g2/result.md`) | adversarial-reviewer | 29,539 (subagent usage) | no | `[APPROVE]`. `appStore` is not on the verified path (the remote-sync branch only; the orchestrator rechecked this in `risuSave.ts`); the scratch decoder mutant fails 4 of 4; comments accurate; rerun 4 of 4 passed. Did not run `pnpm check` (`Agents/Tools` is outside its scope). |
| 5002 | 2026-10-23 | CHORE-144 (four fragilities) and CHORE-152 (`assetPieceSave` slowness): status on current main, causes, test-only fix proposals (scratchpad `c144/result.md`) | investigator | 103,229 (subagent usage) | no | Verified with corrections in row 5003. CHORE-152: about 63% of the file's CPU self time is in the per-character callback `Uint8Array.from(atob(data), cb)` in `src/ts/storage/tests/tauriChunkFake.ts` (two sites); a scratch index loop kept `atob` and took the file from about 37 s to about 12 s, 23 of 23 passing (loaded machine). CHORE-144: item 2 (`backuplocalEncryptedRefusal` under shuffle) passed with 42 seeds; items 1 ((G) byte for byte) and 3 (`nodeHttpStore` ENOBUFS) did not reproduce and stay UNCERTAIN, needing the failing message or stack; item 4 (msgpackr 1.10.1 `utf8Write` throws on Node 24.22.1 for strings of 64 or more characters, not on 22.22.0) is test-environment only, and three tests already clamp it. No repository edits. |
| 5003 | 2026-10-23 | Independent check of row 5002 (scratchpad `c144/verify/result.md`) | doc-verifier | 41,287 (subagent usage) | no | Decision-critical claims VERIFIED by execution: own mutant 23 of 23 in 11.6 s and 11.3 s against a control at 35.7 s; 10 more shuffle seeds passed; the msgpackr throw reruns on Node 24.22.1 and not on 22.22.0. Corrections: the fake reaches 23 files through `tauriDesktopFake.ts` plus 6 through `tauriWireFake.ts` (not "about 10"); `nodeServerFixture` has 17 test users (not 20); `atob` tolerates missing padding but rejects bad characters and lengths that `Buffer.from(..., 'base64')` accepts; the second site is at line 315, not 317. Items 1 and 3 UNVERIFIABLE (no failing evidence exists). |
| 5004 | 2026-10-23 | Check the CHORE-142 commit message and this records file before the MC-700 commit (scratchpad `c142/cv/result.md`) | doc-verifier | 39,716 (subagent usage) | no | About 22 claims; the rest VERIFIED; harness rerun 4 of 4. Applied: lane A's 21,163 now names merge `3882db23e` (and `9a6127354` differs from it only in records and one workflow script); the actors wording now describes the grouped timeout errors; the ID ranges cite the brief. Rejected: the finding that the trailer must name a different model (the trailer is the session's prescribed attribution). UNVERIFIABLE: the uncaptured `saveLoop` alone runs, token figures, the MC-700 quote. |
| 5005 | 2026-10-23 | CHORE-152: fix the slow decode in `src/ts/storage/tests/tauriChunkFake.ts` only, keeping `atob` (scratchpad `c152/result.md`) | test-warrior | 33,058 (subagent usage) | no | `decodeBase64` helper with an index loop at both sites; equivalence 2003 valid and 13 edge inputs, 0 mismatches; a lenient-decoder scratch mutant was noticed by no repository test; 31 of 31 reaching files and 964 of 964 tests passed; `assetPieceSave` alone 23 of 23 in about 10 s; `pnpm check` 0/0 with an 8 GiB heap. |
| 5006 | 2026-10-23 | CHORE-152 Gate 2 (scratchpad `c152/g2/result.md`) | adversarial-reviewer | 25,994 (subagent usage) | no | `[APPROVE]`, no findings. Equivalence by reasoning and by rerun (the `atob` output is Latin-1; the throw position is unchanged); 31 of 31 files and 964 of 964 tests; `assetPieceSave` alone 23 of 23 in about 10.7 s; `pnpm check` 0/0; the file count of 31 rechecked. Nit, no change needed: `atob` also tolerates missing padding. |
| 5007 | 2026-10-23 | Check the CHORE-152 commit message and records before the MC-704 commit (scratchpad `c152/cv/result.md`) | doc-verifier | 35,933 (subagent usage) | no | 16 claims, 12 VERIFIED; spot run `assetPieceSave` alone 23 of 23 in 10.17 s. Applied: the commit message no longer claims a CHORE-144 entry (that was in `8224c8b`); the timings cite logged runs only; the heap out-of-memory note is marked as the implementer's report with no kept log. UNVERIFIABLE: token figures and the provenance of the maintainer's option text. |
| 5008 | 2026-10-23 | CHORE-67: which tests still trust DOMPurify output under happy-dom (scratch recording and identity stubs; scratchpad `c67/result.md`) | investigator | 67,144 (subagent usage) | no | Verified with corrections in row 5009. 40 test files call the real sanitizer (17 jsdom, 23 happy-dom); the identity stub fails 28 tests in 10 files, all jsdom; no happy-dom file depends on a removal. Two happy-dom tests assert that sanitized text survives (`GridCatalog.coldStub.svelte.test.ts`, `parserTarget.svelte.test.ts`); an empty-output stub fails them; under jsdom (scratch copy) they pass 18 of 18 and 8 of 8. Moving all 23 happy-dom files fails 6 tests in 3 files (focus and inert differences, not diagnosed). No repository edits. |
| 5009 | 2026-10-23 | Independent check of row 5008 (scratchpad `c67/verify/result.md`) | doc-verifier | 47,345 (subagent usage) | no | Reruns: the identity stub on the 23 happy-dom files passed 453 of 453; 50 files gave 676 tests with 28 failed in 10 files, all jsdom; the jsdom copy of the two files passed 26 of 26. Both assertions read the sanitized string (`ParseMarkdown`'s return; `[data-description]` filled by `{@html}` from the sanitize path). Corrections: "reach" means a `sanitize` or factory call, not an import; the excluded `actors` and `saveLoop` files do import the parser transitively, but a recording run showed zero sanitizer calls. |
| 5010 | 2026-10-23 | CHORE-67: add the jsdom pragma to the two residual tests only (scratchpad `c67/impl/result.md`) | test-warrior | 32,310 (subagent usage) | no | Two pragma lines; the real DOMPurify under jsdom 26 of 26 twice; the empty-output stub fails exactly the two named tests (24 pass); the identity stub 26 of 26; `pnpm check` 0/0 with an 8 GiB heap. |
| 5011 | 2026-10-23 | CHORE-67 Gate 2, and its editorial closure (scratchpad `c67/g2/result.md`) | adversarial-reviewer | 35,561 + 38,000 (subagent usage, two invocations) | no | `[EDITORIAL]`: behaviour accepted. Reruns: real 26 of 26, empty stub 2 failed and 24 passed; per-test outcomes identical under happy-dom (HEAD copy) and jsdom; `GridCatalog.coldStub`'s `clientWidth` override still applies; `pnpm check` 0/0. Finding: `parserTarget`'s header comment still said it ran under happy-dom. The `clientWidth` point is from the reviewer's hand-back message only. The orchestrator reworded the comment only; its 8 of 8 rerun has no kept log, and the doc-verifier's run after the rewording passed both files, 26 of 26 (row 5012). The same reviewer, resumed, closed it `[APPROVE]` after checking the new claims against the cited files. |
| 5012 | 2026-10-23 | Check the CHORE-67 commit message and records before the MC-706 commit (scratchpad `c67/cv/result.md`) | doc-verifier | 49,542 (subagent usage) | no | 26 claims: 23 VERIFIED, 2 INCOMPLETE, 1 UNVERIFIABLE (token figures). Spot run after the rewording: both files, 26 of 26. Applied: the post-rewording rerun now cites this run; the `clientWidth` claim is attributed to the reviewer's hand-back message and the source reading. |
| 5013 | 2026-10-23 | Phase 1 reports: write `Agents/Lanes/lane-cloud/CHORE-67-result.md`, `CHORE-142-result.md`, `CHORE-144-result.md` and `CHORE-152-result.md` from the scratchpad evidence, then one revision | doc-writer | 82,836 + 90,371 (subagent usage, two invocations) | no | Four reports with a "Corrections from doc-verifier" section each; verified in row 5014. |
| 5014 | 2026-10-23 | Independent check of the four Phase 1 reports | doc-verifier | 100,723 (subagent usage) | no | Four required corrections, all applied by the orchestrator: the `c67/cv/result.md` pointer (the file exists, saved from the verifier's message); the `8224c8b` description (ledger rows 5002 and 5003 were committed in `dc82aff`); CHORE-144 item 2 is NOT REPRODUCED rather than REFUTED; the full `src/ts/storage/database.svelte.ts:2369` path. Optional notes applied: the `saveLoop` lead in CHORE-142, the MC-239 "18 files" against 40 in CHORE-67, "superseded by 31" in CHORE-144. |
| 5015 | 2026-10-23 | Phase 1 final checks on the committed tree `b53a67b` (four reports and this records file untracked or modified, not covered by either command), Linux, Node 22.22.0, 4 CPUs (session scratchpad `final/test.txt`, `final/check.txt`, `final/saveLoop-alone.txt`) | orchestrator | not measured | no | `pnpm test`: 937 files passed, 2 failed, 1 skipped (940); 21,146 tests passed, 10 failed, 30 skipped (21,186); 1,496 s; exit 1. The 10 failures are exactly the baseline's 10 (`saveLoop` flushed:false, 1; `replay/actors`, 9), same names and counts as `base/test.txt`; none is in a file Phase 1 changed. `saveLoop` rerun alone: 1 failed, 77 passed, the same test. `actors` not rerun alone again (baseline alone run `base/actors-alone.txt`, 9 of 71). `NODE_OPTIONS=--max-old-space-size=8192 pnpm check`: 0 errors, 0 warnings, exit 0. No `pnpm build`: Phase 1 changed no application code (only tests, a test fake and a tools harness). The 8 GiB heap setting and the runtime line are from the command and the environment notes, not from the logs. Verified before commit (scratchpad `close/result.md`): all checkable claims VERIFIED; the trailer finding was rejected as in row 5004. |
| 5016 | 2026-10-23 | CHORE-09 items 4, 7, 9, 10, 11: trace, reproduce in scratch, upstream compare (scratchpad `p2/c09/result.md`) | investigator | 94,711 (subagent usage) | no | 4, 9, 10, 11 REPRODUCED through the real functions; 7 TRACED; all UPSTREAM-SAME except 7 (upstream has no subject path). Item 10 reframed: the budget holds; the merge needs both entries to survive. Product questions per item. No repository edits. |
| 5017 | 2026-10-23 | Independent check of row 5016 (scratchpad `p2/c09/verify/result.md`) | doc-verifier | not recorded (lost in a container restart) | no | Reran the scratch reproducers (6 pass). Corrections: item 9 fork citations; item 7 v3 caller stays within the selection; items 10/11 sketches pin one option; item 4 NaN throw and "nothing reads [2]" INFERRED. Noted `TriggerV2List.svelte` still offers the item 4 effects. |
| 5018 | 2026-10-23 | CHORE-10 HAN-1, HAN-2, V2-1..V2-5, SHARED-1/2 (scratchpad `p2/c10a/result.md`) | investigator | not recorded (lost in a container restart) | no | HAN-1, V2-1, V2-2 (3 variants plus the null-memo sub-finding), V2-3, V2-4 REPRODUCED; HAN-2, V2-5, SHARED-1/2 TRACED (SHARED-1 no misorder on V8); all UPSTREAM-SAME. |
| 5019 | 2026-10-23 | Independent check of row 5018 (scratchpad `p2/c10a/verify/result.md`) | doc-verifier | 73,803 (subagent usage) | no | 24 claims: 18 VERIFIED, 2 OVERSTATED (HAN-1 "every request", split mode "never"), 2 INCOMPLETE, 2 UNVERIFIABLE. V2-3, V2-4 and scenario F are diagnostics. Save pipeline after the assignment untraced. |
| 5020 | 2026-10-23 | CHORE-10 SUPA-1..5, V3-1, UI-1, TOK-1 (scratchpad `p2/c10b/result.md`) | investigator | not recorded (lost in a container restart) | no | SUPA-1/2/3/4, V3-1 REPRODUCED; SUPA-5, UI-1, TOK-1 TRACED; all UPSTREAM-SAME. Refuted premises: TOK-1's clamp is display-only; SUPA-4 needs a tiny chunk size. |
| 5021 | 2026-10-23 | Independent check of row 5020 (scratchpad `p2/c10b/verify/result.md`) | doc-verifier | 62,470 (subagent usage) | no | All five experiments reproduce; mocks do not manufacture results. Corrections: SUPA-4 reachable by typed entry (the input does not clamp); its 50-token marker is contrived; V3-1 construction sites listed; TOK-1 17 request-side reads checked, none clamps. |
| 5022 | 2026-10-23 | CHORE-10 V3-2, V3-3, V3-4 (V3 and V2), V3-5 (scratchpad `p2/c10c/result.md`) | investigator | 63,081 (subagent usage) | no | V3-4 REPRODUCED in V3 and V2 (PERSISTENCE-RISK); V3-2 REPRODUCED on a replica of the modal merge; V3-3, V3-5 TRACED; all UPSTREAM-SAME. |
| 5023 | 2026-10-23 | Independent check of row 5022 (scratchpad `p2/c10c/verify/result.md`) | doc-verifier | not recorded (lost in a container restart) | no | Reran V3-4; the packet's Preserve control was vacuous, a corrected control keeps both summaries. Replica matches the component. Corrections applied in the decisions' framing (hidden vs deleted wording). |
| 5024 | 2026-10-23 | CHORE-09 reproducers, tests only (scratchpad `p2/c09/tw/result.md`) | test-warrior | 72,668 (subagent usage) | no | `triggerLegacyLorebook.test.ts` and `lorebookKeyMatching.svelte.test.ts`: 9 `test.fails`, 10 guards; each reproducer fails on its intended assertion when flipped; `pnpm check` 0/0. No test for item 7 (no owner-plumbing API yet). |
| 5025 | 2026-10-23 | CHORE-09 Gate 2 (scratchpad `p2/c09/g2/result.md`) | adversarial-reviewer | 50,924 (subagent usage) | no | `[EDITORIAL]`: fix mutants flip only their own item's tests; guard mutants fail; E1 header/comment wording (`it.fails` → `test.fails`), applied by the orchestrator before commit `04126b6`. |
| 5026 | 2026-10-23 | CHORE-09 report (scratchpad `p2/c09` evidence → `Agents/Lanes/lane-cloud/CHORE-09-result.md`) | doc-writer | 59,523 (subagent usage) | no | Report with per-item verdicts, decisions and residuals; guard-count TODO resolved by the orchestrator (10 guards, 9 reproducers). |
| 5027 | 2026-10-23 | Independent check of the CHORE-09 report, MC-708..713 and the commit message (scratchpad `p2/c09/dv/result.md`) | doc-verifier | 50,028 (subagent usage) | no | No WRONG claims; reran 10 passed, 9 expected fail. Required: E1 wording in the corrections section (applied). Optional dating fix applied. MC-711..713 UNVERIFIABLE there (no CHORE-10 packets given). |
| 5028 | 2026-10-23 | CHORE-10 batch 1 reproducers (scratchpad `p2/c10a/tw/result.md`) | test-warrior | 103,817 (subagent usage) | no | `hanuraiMemory.test.ts`, `hypav2.test.ts`, `hypamemory.similarity.test.ts`: 11 `it.fails`, 10 guards; flip proof per item; `pnpm check` 0/0. |
| 5029 | 2026-10-23 | CHORE-10 batch 1 Gate 2 (scratchpad `p2/c10a/g2/result.md`) | adversarial-reviewer | 72,766 (subagent usage) | no | `[APPROVE]`. Fix mutants for every decision turn all 11 green with guards intact; unmutated guards mutated and fail. Advisory: the V3-4 reproducer and deleted-message guard share inputs, so a fixer edits both calls to pass the full list; titles; quote style. |
| 5030 | 2026-10-23 | CHORE-10 batch 2 reproducers (scratchpad `p2/c10b/tw/result.md`) | test-warrior | 135,657 (subagent usage) | no | Six files (SUPA-1..5, V3-1, V3-2, V3-3, V3-4 V3 half, V3-5, TOK-1 V2/V3, UI-1 label); UI-1 dropdown skipped (heavy component). Under review in the next row. |
| 5031 | 2026-10-23 | CHORE-10 batch 2 Gate 2, round 1 (scratchpad `p2/c10b/g2/result.md`) | opus-reviewer | 145,755 (subagent usage) | no | `[REJECT]` (substantive round 1). 15 reproducers, 19 guards across six files; 13 reproducers fixable and correct. Blocking: (1) the V3-4 reproducer and deleted guard share inputs; `hypaMemoryV3`/`V2` already receive `room`, so hidden must be encoded in `room.message` (orchestrator confirmed both call sites pass `currentChat`; the batch-1 V2 test has the same flaw); (2) SUPA-3 "next survivor" is not computable at send time; maintainer re-asked (`MC-714`). Also: experimental path untested; UI-1 label second site; Toggles import time; editorial. SUPA-5 mocks faithful; SUPA-4 cannot hang; V3-5 deterministic. |
| 5032 | 2026-10-23 | CHORE-10 batch 2 remediation of round 1 (scratchpad `p2/c10b/rem/result.md`) | test-warrior | 135,015 (subagent usage) | no | V3-4 hidden encoded via `room.message` `disabled: true` in V3 and V2; SUPA-3 rewritten to `MC-714` (`command.supaResume.test.ts`: `/cut <chatId>` repoint reproducer; dangling-ID error-text reproducer); experimental-path reproducers; UI-1 second label site; Toggles import time cut. `pnpm check` 0/0. |
| 5033 | 2026-10-23 | CHORE-10 batch 2 Gate 2, round 2 (fresh reviewer; scratchpad `p2/c10b/g2r2/result.md`) | opus-reviewer | 141,696 (subagent usage) | no | `[REJECT]` (substantive round 2; a third needs senior-advisor). All round-1 findings resolved (flipped copies: 23 failed on intended assertions). New: F1 the SUPA-3 non-resume-cut guard cuts the last message, so an always-repoint fix passes; F2 no explicit guard keeps a summary covering the first message (no chatId), caught today only by unrealistic default fixtures. Editorial E1-E3. Mechanism reconsidered: both are small test-coverage gaps, not a wrong mechanism. Open product question: MC-714 does not say what happens when no message follows the deleted resume message. 37 passed, 32 expected fail; `pnpm check` 0/0. |
| 5034 | 2026-10-23 | CHORE-10 batch 2 remediation of round 2 (scratchpad `p2/c10b/rem2/result.md`) | test-warrior | 71,822 (subagent usage) | no | F1: the non-resume guard now cuts `m3` then `m1`; the always-repoint mutant fails it, the correct alternative passes. F2: greeting-summary guards for V3 standard, V3 experimental and V2 with a realistic `room.message`; message-list-only mutants fail them, union mutants pass. E1-E3 applied. 40 passed, 32 expected fail; `pnpm check` 0/0. Under review in the next row. |
| 5035 | 2026-10-23 | CHORE-10 batch 2 Gate 2, round 3 (fresh reviewer; scratchpad `p2/c10b/g2r3/result.md`) | opus-reviewer | 88,552 (subagent usage) | no | `[APPROVE]`; ends the rejection streak at two. F1 and F2 resolved with mutant runs (always-repoint fails the guard; message-list-only fails the greeting guards, per path; union and alternative designs pass); null-memo variant checked; no regressions in flipped copies. 40 passed, 32 expected fail; `pnpm check` 0/0. Non-blocking: V2 greeting fixture text says "m0,m1,m2"; default fixtures keep an empty `room.message`. |
| 5036 | 2026-10-23 | CHORE-10 report and commit-message draft (`Agents/Lanes/lane-cloud/CHORE-10-result.md`; scratchpad `p2/c10d/commit-msg.txt`) | doc-writer | 131,530 (subagent usage) | no | All 21 items with verdicts, upstream status, decisions, test titles; counted 40 plain, 32 `.fails`. Flagged the stale "For lane A" SUPA-3/V2-2 wording in these records (orchestrator corrected it). Under independent check in the next row. |
| 5037 | 2026-10-23 | Independent check of the CHORE-10 report, records diff and commit message (scratchpad `p2/c10d/dv/result.md`) | doc-verifier | 76,813 (subagent usage) | no | Reran ten files: 40 passed, 32 expected fail. Decision quotes, test titles, REPRODUCED citations and upstream sample verified; corrected "For lane A" section accurate. Required: four corrections (fork line `OtherBotSettings.svelte:1279`, ledger range 5018-5036, stale records bullet, environment line); applied by the Orchestrator and recorded in the report's corrections section. |
| 5038 | 2026-10-23 | Phase 2 final checks on the committed tree `ae9edbf` (this records file modified, not covered by either command), Linux, Node 22.22.0, 4 CPUs (session scratchpad `p2/close/test.log`, `actors.log`, `check.log`) | orchestrator | not measured | no | `NODE_OPTIONS=--max-old-space-size=8192 pnpm test` (the variable is not echoed in the log): 950 files passed, 1 failed, 1 skipped (952); 21,197 tests passed, 9 failed, 41 expected fail (9 CHORE-09, 32 CHORE-10), 30 skipped; 1,416 s. The 9 failures are the baseline `actors.test.ts` timeouts (above); rerun alone: 9 of 71 fail, all timeouts (5 s and one 240 s), no assertion error, same as the baseline. The baseline `saveLoop` flushed:false failure did not occur in this run (it is intermittent; still open for lane A). `pnpm check`: 0 errors, 0 warnings. No build: no application code changed. |
| 5039 | 2026-10-23 | Independent check of the Phase 2 close records diff (scratchpad `p2/close/dv/result.md`) | doc-verifier | 42,535 (subagent usage) | no | Row 5038 numbers, commits, ledger ranges, 41 = 9 + 32 expected fails (rerun of the 12 files: 50 passed, 41 expected fail) and the actors baseline match VERIFIED. Required: cite the `pnpm test` heap setting accurately; correct the CHORE-10 report ledger range (applied as its corrections item 5). |
| 5040 | 2026-10-23 | CHORE-138 trace and scratch reproducer (scratchpad `p3/c138/result.md`) | investigator | 51,523 (subagent usage) | no | Premise confirmed: the triple-touch block in `hotkey.ts` has no `touchcancel`; the other `touchcancel` listener only clears the swipe map. Effect: a false quick-menu open within 300 ms after a cancel. Upstream same. Tiny fix. |
| 5041 | 2026-10-23 | CHORE-139 trace and scratch reproducer (scratchpad `p3/c139/result.md`) | investigator | 59,315 (subagent usage) | no | Cause is in `checkCharOrder` (emptiness tested before pruning), not `removeChar`; single deletes of a folder's last member affected. Upstream same. Reactive-database change: opus-reviewer gate. |
| 5042 | 2026-10-23 | CHORE-143 trace (scratchpad `p3/c143/result.md`) | investigator | 43,199 (subagent usage) | no | Premise refuted for the fork: `windowErrorGuard.ts` already ignores null-error events (warn only); existing test covers it. Upstream still has the defect. |
| 5043 | 2026-10-23 | Independent check of rows 5040-5042 (scratchpad `p3/vfy/result.md`) | doc-verifier | 39,423 (subagent usage) | no | All decision-critical claims VERIFIED; both reproducers rerun failing on the intended assertion; CHORE-143 guard 3 passed. CHORE-139: "19 calls in 8 files" (not 10); no code path creates an empty character folder; held save unaffected. |
| 5044 | 2026-10-23 | CHORE-09 items 4, 9, 10, 11 fix plan (scratchpad `p3/c09fix/plan.md`) | sonnet-coder | 78,846 (subagent usage) | no | Plan only, no edits. Raised the export-splitter amendment and two assumptions, answered in `MC-718` 1-3. Under Gate 1. |
| 5045 | 2026-10-23 | CHORE-133 trace and jsdom scratch reproducer (scratchpad `p3/c133/result.md`) | investigator | 63,761 (subagent usage) | no | The F4 sink is `translator.ts` one-sentence `innerHTML`, distinct from alert 45; markup comes from decoded message text, not the API; downstream consumers sanitize, no live exploit. Upstream same. Under independent check. |
| 5046 | 2026-10-23 | CHORE-138 implementation (scratchpad `p3/c138/impl/result.md`) | sonnet-coder | 32,642 (subagent usage) | no | `touchcancel` reset in `hotkey.ts` (+3); new `src/ts/hotkey.touchcancel.test.ts` (reproducer failed before the fix on its intended assertion, 2 guards). `src/ts/hotkey` tests 267 passed; `pnpm check` 0/0. Under Gate 2. |
| 5047 | 2026-10-23 | CHORE-138 Gate 2 (scratchpad `p3/c138/g2/result.md`) | adversarial-reviewer | 25,181 (subagent usage) | no | `[APPROVE]`. Pre-fix reproducer fails on its intended assertion (scratch copy of HEAD `hotkey.ts`); 267 `hotkey` tests pass; `pnpm check` 0/0. Misspelled-event and missing-reset mutants caught; `window` target (equivalent), reset to 1 and resetting the start time survive (optional hardening). |
| 5048 | 2026-10-23 | CHORE-138 and CHORE-143 reports and commit-message draft (`Agents/Lanes/lane-cloud/CHORE-138-result.md`, `CHORE-143-result.md`; scratchpad `p3/c138/commit-msg.txt`) | doc-writer | 56,383 (subagent usage) | no | Rechecked current line numbers; noted the stale Roadmap CHORE-143 status. Under independent check. |
| 5049 | 2026-10-23 | Independent check of the CHORE-133 trace (scratchpad `p3/c133/vfy/result.md`) | doc-verifier | 39,062 (subagent usage) | no | 6 VERIFIED, 1 EXECUTED (reproducer A fails on the intended assertion); `textContent` loses nothing (source reading). No blocking corrections. |
| 5050 | 2026-10-23 | CHORE-09 fix plan Gate 1 (scratchpad `p3/c09fix/g1/result.md`) | adversarial-reviewer | 59,725 (subagent usage) | no | `[EDITORIAL]`: update the `triggerOriginWrites` guard for item 4; add the `characterCards.ts` exporters (`MC-718` 1) with a round-trip test; make the splitter skip escaped `\/` and bracketed `/`; `i`-flag the comment-strip regexes for item 9; extra edge and later-round cut tests. |
| 5051 | 2026-10-23 | CHORE-133 fix plan Gate 1 (scratchpad `p3/c133/g1/result.md`) | adversarial-reviewer | 32,408 (subagent usage) | no | `[EDITORIAL]`: lossless on ten inputs before and after (scratch); reproducers must stub `processScriptFull` as identity, or the edit-display `innerHTML` site masks the fix; scope wording: single-sentence reparse only. |
| 5052 | 2026-10-23 | Independent check of the CHORE-138 and CHORE-143 reports and commit message (scratchpad `p3/c138/dv/result.md`) | doc-verifier | 38,966 (subagent usage) | no | About 30 claims, none wrong; 12 tests rerun passed; upstream re-opened and agrees. No required corrections; optional commit-message wording applied. |
| 5053 | 2026-10-23 | CHORE-139 implementation (scratchpad `p3/c139/impl/result.md`) | sonnet-coder | 64,374 (subagent usage) | no | `checkCharOrder` drops a folder emptied in the same pass; the double-call workarounds in `trashFolderMembers` and `trashCharacters` removed; new `src/ts/characters.removeCharFolderPrune.svelte.test.ts` (4 reproducers failed before the fix, 2 guards). `pnpm check` 0/0; the wider run's only identified failures are the baseline `actors.test.ts` timeouts (a second failing file in its first run was not identified). Under opus-reviewer Gate 2. |
| 5054 | 2026-10-23 | CHORE-133 implementation (scratchpad `p3/c133/impl/result.md`) | sonnet-coder | 32,612 (subagent usage) | no | `textContent` at the one-sentence site; new jsdom `src/ts/translator/translateSingleSentenceText.test.ts` (2 reproducers failed before the fix, 2 guards). Translator tests 39 passed; `pnpm check` 0/0. Under Gate 2. |
| 5055 | 2026-10-23 | CHORE-133 Gate 2 (scratchpad `p3/c133/g2/result.md`) | adversarial-reviewer | 34,367 (subagent usage) | no | `[APPROVE]`. One-line diff; edit-display site untouched; jsdom file calls the real `translateHTML`; against pre-fix `translator.ts` both reproducers fail on the intended assertions, guards pass; `innerText` mutant caught (incidentally, jsdom); translator tests 39 passed; `pnpm check` 0/0. |
| 5056 | 2026-10-23 | CHORE-133 report and commit-message draft (`Agents/Lanes/lane-cloud/CHORE-133-result.md`; scratchpad `p3/c133/commit-msg.txt`) | doc-writer | 43,354 (subagent usage) | no | Report with the proposed CHORE-500 for the edit-display site. Under independent check in the next row. |
| 5057 | 2026-10-23 | Independent check of the CHORE-133 report and commit message (scratchpad `p3/c133/dv/result.md`) | doc-verifier | 44,441 (subagent usage) | no | 20 claims: 15 VERIFIED (one-line diff; `translator.ts` and `util.ts` unchanged between `4455c00` and `bae8761`; upstream `:466` unfixed; 39 translator tests rerun), 2 WRONG (row 5056 did not yet exist; commit message claimed CHORE-133 records entries that were not yet written), 2 inconsistent (Gate 1 result file says "BLOCKING for the plan's test" while the hand-back says `[EDITORIAL]`; Gate 2 pre-fix runs not rerun, "as reported"), 1 incomplete (stale plan note). Corrections applied by the Orchestrator. |
| 5058 | 2026-10-23 | CHORE-139 Gate 2, round 1 (scratchpad `p3/c139/g2/result.md`) | opus-reviewer | 91,287 (subagent usage) | no | `[REJECT]` (substantive round 1). Fix correct: over 20,000 seeded random orders one new pass equals two old passes; the removed second call did nothing else; held save and save path unchanged; callers cannot rely on an empty folder surviving. Blocking: (1) `GridCatalog.folderMenu.svelte.test.ts` "(F) Delete then Trash ..." pins two `checkCharOrder` calls and now fails (the implementation report missed it); (2) the no-`i--` mutant survives every targeted test; needs a reproducer with adjacent emptied folders or an emptied folder followed by a stale id. Editorial: long doc line; the "removeChar (permanent)" test calls `'permanentForce'`. 160 of 161 related files passed; `pnpm check` 0/0. |
| 5059 | 2026-10-23 | CHORE-09 items 4, 9, 10, 11 implementation (scratchpad `p3/c09fix/impl/result.md`) | sonnet-coder | 131,909 (subagent usage) | no | Reproducers flipped and new ones added before app changes, all red on the intended assertion; green after. Splitter in new `src/ts/process/loreKeys.ts` (deviation from the plan: keeps `characterCards.ts` from importing `lorebook.svelte`); exporters use it; Case Sensitive toggle in `LoreBookData.svelte` (no UI test); en.ts keys `caseSensitive`, `help.caseSensitiveLorebook`. Nine scratch mutants each fail a repository test. 277 related files: 5,400 passed; `pnpm check` 0/0. Scope breach: it appended a "Phase 3 fix" section to `CHORE-09-result.md` although told not to touch `Agents/**`; kept, subject to doc-verifier. Under Gate 2. |
| 5060 | 2026-10-23 | CHORE-139 remediation of Gate 2 round 1 (scratchpad `p3/c139/rem/result.md`) | test-warrior | 44,850 (subagent usage) | no | `GridCatalog.folderMenu` (F) now expects one `checkCharOrder` call, with the invariant stated; three new reproducers (adjacent emptied folders; emptied folder then stale id; emptied folder after a kept entry): pre-fix 7 of 9 fail, no-`i--` mutant 2 fail, no-`continue` mutant 1 fails; editorial applied. 4 files, 76 tests passed; `pnpm check` 0/0. Under round-2 review. |
| 5061 | 2026-10-23 | CHORE-09 fix Gate 2 (scratchpad `p3/c09fix/g2/result.md`) | adversarial-reviewer | 79,792 (subagent usage) | no | `[EDITORIAL]`. All decisions and Gate 1 items met. Against a HEAD copy with a plain-split stub, 37 new/flipped tests fail on intended assertions, 98 pass. Splitter fuzz: equals `split(',')` outside regex mode (300k); 0 differences on lists of valid comma-free keys (169k generated, 21,341 from 2M random). Four reviewer mutants caught; dropping `v` from the flag set survived (E1). `loreKeys.ts` module judged sound. 135 tests in touched files, 573 in related; `pnpm check` 0/0. Note: a typo flag like `/a/x,/b/` now merges into one valid regex key (was a dead entry; not an `MC-175` regression). |
| 5062 | 2026-10-23 | CHORE-09 Gate 2 E1 applied (`loreKeys.test.ts` guard row `/a/v,/b/y`) | orchestrator | not measured | no | `loreKeys.test.ts` 33 passed; scratch copy of `loreKeys.ts` without `v` in the flag set fails that guard (1 failed, 32 passed; scratchpad `p3/c09fix/e1`). |
| 5063 | 2026-10-23 | CHORE-09 Phase 3 report update and commit-message draft (`Agents/Lanes/lane-cloud/CHORE-09-result.md`; scratchpad `p3/c09fix/commit-msg.txt`) | doc-writer | 57,887 (subagent usage) | no | Status, Phase 3 section (decisions, files, deviation, en.ts keys, gates, residuals including `docs/wiki/Lorebook.md` and `Trigger-Script.md` lines for the maintainer). Under independent check. |
| 5064 | 2026-10-23 | Independent check of the CHORE-09 Phase 3 report, rows and commit message (scratchpad `p3/c09fix/dv/result.md`) | doc-verifier | 43,520 (subagent usage) | no | One WRONG claim (diff figure 14 files/261/94 should be 9 files/232/82 for this ticket's tracked files), corrected by the Orchestrator; all else VERIFIED; six test files rerun, 135 passed, no `.fails` left. |
| 5065 | 2026-10-23 | CHORE-139 Gate 2, round 2 (fresh reviewer; scratchpad `p3/c139/g2r2/result.md`) | opus-reviewer | 67,209 (subagent usage) | no | `[EDITORIAL]`; ends the streak at one rejection. Round-1 findings resolved and rerun: `GridCatalog.folderMenu` (F) passes (fails with the old double call); no-`i--` and no-`continue` mutants caught; pre-fix fails 7 of 9 on the intended order assertion; guards hold. No other test pins the double call (154 files mention `checkCharOrder`). 162 related files, 2,884 tests passed; `pnpm check` 0/0. Editorial: stale "repairs it twice" comment in `GridCatalog.svelte`. |
| 5066 | 2026-10-23 | CHORE-139 round-2 editorial applied (`GridCatalog.svelte` comment: "repairs it once") | orchestrator | not measured | no | Comment-only change; no re-review needed per the verdict. |
| 5067 | 2026-10-23 | CHORE-139 report and commit-message draft (`Agents/Lanes/lane-cloud/CHORE-139-result.md`; scratchpad `p3/c139/commit-msg.txt`) | doc-writer | not reported | no | Notes the refuted implementation claims and the investigation's `4455c00` line numbers. Checked in row 5068; corrections applied. |
| 5068 | 2026-10-23 | Independent check of row 5067 and the CHORE-139 records entry and commit draft (scratchpad `p3/c139/dv/result.md`) | doc-verifier | 46,405 (subagent usage) | no | About 24 claims: 20 VERIFIED, 1 WRONG (bootstrap does not pass `db`), 3 STALE (line numbers, pending notes), 1 INCOMPLETE (Gate 1 basis). Reran targeted tests: 47 and 29 passed. Corrections applied by the orchestrator. |
| 5069 | 2026-10-23 | CHORE-10 batch B fix plan (scratchpad `p3/c10/B/plan.md`) | investigator | 58,731 (subagent usage) | no | SUPA-1, SUPA-2, SUPA-4, V3-1, TOK-1, UI-1; no saved data. Raised the UI-1 label order and V2 toggle visibility questions (`MC-719` 2-3). |
| 5070 | 2026-10-23 | CHORE-10 batch A fix plan (scratchpad `p3/c10/A/plan.md`) | investigator | 78,338 (subagent usage) | no | HAN, V2-3 to V2-5, SHARED, V3-2, V3-3, V3-5; raised the V3 cosine question (`MC-719` 1). V2-4 moved to batch C by the orchestrator. |
| 5071 | 2026-10-23 | CHORE-10 batch B Gate 1, round 1 (scratchpad `p3/c10/B/g1/result.md`) | adversarial-reviewer | 49,182 (subagent usage) | no | `[REJECT]` (substantive round 1): the post-loop SUPA-4 guard misfires on the summarise-summary-alone path (orchestrator confirmed in source). Other five items sound. |
| 5072 | 2026-10-23 | CHORE-10 batch A Gate 1, round 1 (scratchpad `p3/c10/A/g1/result.md`) | adversarial-reviewer | 78,527 (subagent usage) | no | `[REJECT]` (substantive round 1): V3-2 must keep `findIndex` semantics for `undefined` memos (orchestrator confirmed); HAN-2 cap must `continue`, not `break`. Emotion-scoring disclosure for `MC-719` 1; SHARED-1 cannot be red-first (0 mis-sorts in Node 22). |
| 5073 | 2026-10-23 | CHORE-10 batch C fix plan (scratchpad `p3/c10/C/plan.md`) | investigator | 114,017 (subagent usage) | no | Saved-memory items staged C1 to C4. Found that V3-4 alone causes resume duplication, that hidden resume pointers fail, and that `MC-715` needs a format addition; raised F1 to F6; F1 to F3 went to the maintainer (`MC-720` 1 to 3). |
| 5074 | 2026-10-23 | CHORE-10 batch B Gate 1, round 2 (resumed reviewer; scratchpad `p3/c10/B/g1/result-r2.md`) | adversarial-reviewer | 52,443 (cumulative with row 5071) | no | `[APPROVE]`: the in-branch SUPA-4 return fires only with no progress; the summary-then-break path is untouched. |
| 5075 | 2026-10-23 | CHORE-10 batch A Gate 1, round 2 (resumed reviewer; scratchpad `p3/c10/A/g1/result-r2.md`) | adversarial-reviewer | 84,786 (cumulative with row 5072) | no | `[EDITORIAL]`: the resume index is the maximum over all memos; the greeting test must make the skip-`undefined` mutant fail; the chronological-data wording is corrected. Folded into the plan. |
| 5076 | 2026-10-23 | CHORE-10 batch B implementation (scratchpad `p3/c10/B/impl/result.md`) | sonnet-coder | 81,601 (subagent usage) | no | Six items; 19 red-first failures on intended assertions; 13 mutants each caught; targeted runs passed; `pnpm check` 0/0. |
| 5077 | 2026-10-23 | CHORE-10 batch C Gate 1, round 1 (scratchpad `p3/c10/C/g1/result.md`) | opus-reviewer | 205,942 (subagent usage) | no | C1 `[APPROVE]`; C3, C2, C4 `[REJECT]` (substantive round 1). New: HypaV2 loses the greeting-covering summary after a store2 reload (`null` memos); probe P1 fails at HEAD, rerun by the orchestrator. Field persistence confirmed by scratch tests (store2 core, .bin encode and decode). |
| 5078 | 2026-10-23 | SUPA-3 covered-ID field challenge (scratchpad `p3/c10/C/advisor/result.md`) | senior-advisor | 97,292 (subagent usage) | no | No simpler encoding exists; spec `supaMemoryCoveredId`, valid only while it equals the resume line; no boolean; no codec change. Raised F7 (`MC-720` 4). |
| 5079 | 2026-10-23 | CHORE-10 batch B Gate 2 (scratchpad `p3/c10/B/g2/result.md`) | adversarial-reviewer | not recorded (result delivered after a container restart) | no | `[APPROVE]`. Reverted-source run 19 failed (intended); own post-loop mutant caught; coupling to the hypa tests is real, not isolation. `pnpm check` 0/0. Tree restored (md5 verified by the reviewer; the orchestrator re-ran `md5sum -c` against the reviewer's hashes: all OK). |
| 5080 | 2026-10-23 | CHORE-10 batch B report section and commit draft (`Agents/Lanes/lane-cloud/CHORE-10-result.md`; scratchpad `p3/c10/B/commit-msg.txt`) | doc-writer | 69,680 (subagent usage) | no | Checked in row 5081; corrections applied. |
| 5081 | 2026-10-23 | Independent check of row 5080, `MC-719` to `MC-721`, rows 5069 to 5080 and the batch B commit draft (scratchpad `p3/c10/B/dv/result.md`) | doc-verifier | 122,997 (subagent usage) | no | About 46 claims: about 36 verified; 4 wrong or stale, 3 overstated or incomplete (diff figures, V3-1 scope, SUPA-1 attribution, stale notes, row 5073 and 5079 wording). Six test files rerun: 48 passed, 8 expected fail. Corrections applied by the orchestrator. |
| 5082 | 2026-10-23 | CHORE-10 batch C plan revision, round 2 (scratchpad `p3/c10/C/plan.md`, `[R2]` tags) | investigator | 92,202 (subagent usage) | no | All round-1 required changes addressed; V2 `null` loader at `toHypaV2Data`; hidden-resume resolver spec; three questions answered by the orchestrator from `MC-721`. Under Gate 1 round 2. |
| 5083 | 2026-10-23 | CHORE-10 batch C Gate 1, round 2 (fresh reviewer seeded with row 5077; scratchpad `p3/c10/C/g1r2/result.md`) | opus-reviewer | 205,950 (subagent usage) | no | C1 `[APPROVE]`; C3, C2, C4 `[REJECT]` (second consecutive). Probes: P1 passes with the planned V2 loader; P4 (upstream example-only summaries make the greeting count as covered: silent drop), P6 (`allBefore` deletes the greeting-covering summary) and P8 (SupaMemory pointer moves past a hidden unsummarised message) fail the plan. Led to `MC-722`; the reviewer judged the mechanisms sound (bounded spec gaps). Being the second consecutive rejection, the orchestrator reconsidered the shared memo-less rule with a senior-advisor (`AGENTS.md`: reconsider the mechanism at the second rejection). |
| 5084 | 2026-10-23 | CHORE-10 stage A1 implementation (scratchpad `p3/c10/A1/impl/result.md`) | sonnet-coder | 57,906 (subagent usage) | no | HAN-1, HAN-2, V2-3, V2-5, SHARED-1, V3-5. Red-first 10 failed on intended assertions; SHARED-1 is a compatibility guard; five mutants caught; targeted runs passed; `pnpm check` 0/0. |
| 5085 | 2026-10-23 | CHORE-10 stage A1 Gate 2 (scratchpad `p3/c10/A1/g2/result.md`) | adversarial-reviewer | 38,569 (subagent usage) | no | `[APPROVE]`. Red-first rerun matches; own HAN mutants caught (positive controls non-vacuous); 12 files 127 passed, 13 expected fail; `pnpm check` 0/0; md5 restored. About 60 importer tests that mock these modules not run. |
| 5086 | 2026-10-23 | CHORE-10 stage A1 report section and commit draft (`Agents/Lanes/lane-cloud/CHORE-10-result.md`; scratchpad `p3/c10/A1/commit-msg.txt`) | doc-writer | 60,383 (subagent usage) | no | Checked in row 5087; corrections applied. |
| 5087 | 2026-10-23 | Independent check of row 5086, `MC-722`, the stage A1 status line, rows 5083 to 5086 and the A1 commit draft (scratchpad `p3/c10/A1/dv/result.md`) | doc-verifier | 70,935 (subagent usage) | no | About 40 claims; five wording corrections (stale records sentence, missing table reference, red-first breakdown, status-line and row 5083 overstatements, commit records line). Five test files rerun: 37 passed, 12 expected fail. Corrections applied by the orchestrator. |
| 5088 | 2026-10-23 | Memo-less resume mechanism reconsideration after two batch C Gate 1 rejections (scratchpad `p3/c10/C/advisor2/result.md`) | senior-advisor | 140,289 (subagent usage) | no | One shared rule: a memo-less key counts for the resume only when the first memo-less chat is the greeting; orphan valid set always contains it. Probes: the rule passes 10/10 shapes in V2 and V3 standard and experimental; the earlier rules fail P4 (silent loss) or N1 (per-send loop). Raised the bounded greeting duplicate (`MC-723`). |
| 5089 | 2026-10-23 | CHORE-10 stage A2 implementation (scratchpad `p3/c10/A2/impl/result.md`) | sonnet-coder | 46,673 (subagent usage) | no | SHARED-2: HypaProcesser search uses cosine with a zero-magnitude guard; V3 dot product unchanged. Scaled-vector reproducer red-first; zero-vector and V3 tests are guards; three mutants caught; importer-pattern run reported as 230 passed, 5218 passed | 13 expected fail | 1 skipped (file count wording ambiguous, not independently confirmed); `pnpm check` 0/0. |
| 5090 | 2026-10-23 | CHORE-10 stage A2 Gate 2 (scratchpad `p3/c10/A2/g2/result.md`) | adversarial-reviewer | 40,659 (subagent usage) | no | `[APPROVE]`. V3 traced to dot product; no score thresholds; normalised embeddings unchanged; own mutants caught; 24 files 325 passed, 12 expected fail; `pnpm check` 0/0. Non-blocking: the V3 guard pins `similarity`, not the call site. |
| 5091 | 2026-10-23 | CHORE-10 batch C plan round 3 and stage A3 plan (scratchpad `p3/c10/C/plan.md` `[R3]`; `A/a3-plan.md`) | investigator | 102,112 (subagent usage) | no | Adopts the row 5088 rule in A3, C3 and C2 (new pure module `hypaResume.ts`); C4 pointer stays at a hidden message; withdrawn rules listed. No maintainer decision outstanding. Under Gate 1 round 3. |
| 5092 | 2026-10-23 | CHORE-10 stage A2 report section and commit draft (`Agents/Lanes/lane-cloud/CHORE-10-result.md`; scratchpad `p3/c10/A2/commit-msg.txt`) | doc-writer | 47,505 (subagent usage) | no | Checked in row 5093; corrections applied. |
| 5093 | 2026-10-23 | Independent check of row 5092, `MC-723`, the stage A2 status line, rows 5088 to 5092 and the A2 commit draft (scratchpad `p3/c10/A2/dv/result.md`) | doc-verifier | 41,108 (subagent usage) | no | Claims verified; test file rerun 5 passed; `cosineSimilarity` has no other importer. Corrections: upstream dot product confirmed (`hypamemory.ts:211`, `:232` at f50b594), row 5089 importer figure overstated, row-range wording. Applied by the orchestrator. |
| 5094 | 2026-10-23 | CHORE-10 Gate 1 round 3: stage A3 and batch C (scratchpad `p3/c10/C/g1r3/result.md`) | opus-reviewer | 151,229 (subagent usage) | no | A3 `[EDITORIAL]`, C1 `[APPROVE]`, C3 `[EDITORIAL]`, C2 `[APPROVE]`, C4 `[REJECT]` (third consecutive for C4). Advisor probes rerun: 60 tests, rule passes every shape. C4: case (iii) moves the pointer past a hidden unsummarised message (probe); plugin `setChar` empty path missed. |
| 5095 | 2026-10-23 | C4 escalation after three consecutive rejections (scratchpad `p3/c10/C/advisor3/result.md`) | senior-advisor | 126,831 (subagent usage) | no | One invariant: the SupaMemory pointer advances past a message only when a summary covers it, or when a delete removes the pointer message; a single resolver loop with one `lastId = id`. Empty-chat check at the four internal plugin write sites, since a send-time check can never fire. Probe run2: keep variant passes T1 to T5. |
| 5096 | 2026-10-23 | CHORE-10 stage A3 implementation (scratchpad `p3/c10/A3/impl/result.md`) | sonnet-coder | 89,935 (subagent usage) | no | New `hypaResume.ts`; both V3 resume sites use it; standard batching counts summarised messages only. Red-first 7 failed on intended assertions; eight mutants caught; 100 importer files passed; `pnpm check` 0/0. |
| 5097 | 2026-10-23 | CHORE-10 C4 plan round 4 (scratchpad `p3/c10/C/plan.md` `[R4]`; `C/rev4/c4.md`) | investigator | 78,809 (subagent usage) | no | Adopts row 5095; plugin write checks accept `message: []` (read); existing supaMemory fixtures lack `message` (fallback kept). Unified loop not executed by the planner. |
| 5098 | 2026-10-23 | CHORE-10 C4 Gate 1, round 4 (fresh reviewer; scratchpad `p3/c10/C/g1r4/result.md`) | opus-reviewer | 170,110 (subagent usage) | no | `[EDITORIAL]`. Executed a scratch unified loop: 16 of 16 rows pass; HEAD fails as labelled; every named mutant caught. Five wording and test corrections folded into the plan. |
| 5099 | 2026-10-23 | CHORE-10 stage A3 Gate 2 (scratchpad `p3/c10/A3/g2/result.md`) | opus-reviewer | 131,125 (subagent usage) | no | `[EDITORIAL]`. Probe shapes on both real paths (`useExperimentalImpl`); ordinary chats identical to HEAD in seven configurations; red-first 7; 8 of 10 own mutants caught (two survivors in unchanged skip rules); 107 files 2926 passed; `pnpm check` 0/0. E1 to E4 test labels and comments. Found the advisor and g1r3 probe templates used a non-existent experimental flag. Display preview in the HypaV3 modal now can disagree (proposed CHORE-501). |
| 5100 | 2026-10-23 | CHORE-10 stage A3 Gate 2 editorial E1 to E4 applied (scratchpad `p3/c10/A3/ed/result.md`) | sonnet-coder | 37,972 (subagent usage) | no | Test names and comments (MC-723 wording, guard label, cold-storage test comment) and the standard-loop termination invariant comment. Three files 113 passed, 2 expected fail, 1 skipped; `pnpm check` 0/0. Editorial: checked by the orchestrator against the Gate 2 text, no new gate round. |
| 5101 | 2026-10-23 | CHORE-10 stage A3 report section and commit draft (`Agents/Lanes/lane-cloud/CHORE-10-result.md`; scratchpad `p3/c10/A3/commit-msg.txt`) | doc-writer | 75,540 (subagent usage) | no | Section, corrections stub and commit draft written; checked independently in row 5102. |
| 5102 | 2026-10-23 | CHORE-10 stage A3 report doc-verifier (scratchpad `p3/c10/A3/dv/result.md`) | doc-verifier | 55,983 (subagent usage) | no | About 60 claims; 2 WRONG (cold-storage hunk count; row 5099 mutant total, now 8 of 10) plus one cite refinement, all applied. Targeted rerun 113 passed, 2 expected fail, 1 skipped. |
| 5103 | 2026-10-23 | CHORE-10 stage C1 (SUPA-5) implementation (scratchpad `p3/c10/C1/impl/result.md`) | sonnet-coder | 35,427 (subagent usage) | no | `setDatabase` maps `supaModelType` davinci/curie to instruct35; two reproducer rows flipped. Red 5 passed 2 expected fail; green 7 passed; migration-removed mutant 2 fail. Related four files 38 passed; `pnpm check` 0/0. The mutant was swapped into the repository file in place and restored (byte-identical reported). |
| 5104 | 2026-10-23 | CHORE-10 stage C1 Gate 2 (scratchpad `p3/c10/C1/g2/result.md`) | opus-reviewer | 46,025 (subagent usage) | no | `[EDITORIAL]`. E1: the code comment claimed upstream reads instruct35 only; upstream f50b594 still sends text-curie-001/text-davinci-003 for those values (confirmed by the orchestrator); comment reworded by the orchestrator. E2 (optional, test header at HEAD) left. Round trip both ways traced through `setDatabase` and export; idempotent; scratch-copy red 2 fail, green 7, two mutants caught (1 and 3 fail); repository file byte-identical to the implementer's fixed copy; `pnpm check` 0/0. |
| 5105 | 2026-10-23 | CHORE-10 stage C1 report section and commit draft (`Agents/Lanes/lane-cloud/CHORE-10-result.md`; scratchpad `p3/c10/C1/commit-msg.txt`) | doc-writer | 50,845 (subagent usage) | no | Checked independently in row 5106. |
| 5106 | 2026-10-23 | CHORE-10 stage C1 report doc-verifier (scratchpad `p3/c10/C1/dv/result.md`) | doc-verifier | 45,039 (subagent usage) | no | About 35 claim groups; 1 WRONG (bootstrap `setDatabase(` count is 8, not 7), applied; 1 UNVERIFIABLE (external model-retirement fact). Test file rerun 7 passed. |

## Handoff

Phase 2 technically complete, awaiting the maintainer's approval before Phase 3 (2026-10-23). Phase 2 commits on `lane-cloud`: `04126b6` (CHORE-09 reproducers, report, `MC-708` to `MC-713`) and `ae9edbf` (CHORE-10 reproducers, report, `MC-714`, `MC-715`), then the Phase 2 close commit of this file (CHORE-09 and CHORE-10 entries, row 5038). Final checks: row 5038. No application code changed in Phase 2. Open for lane A: the Phase 1 `saveLoop` flushed:false failure and `actors` timeouts, and the Phase 2 saved-data risks, above. Open for the maintainer before any CHORE-09 or CHORE-10 fix: the item 11 comma-in-regex question, item 10 target readmission, and the `lorebookRegexKeys` guard that contradicts `MC-710` 5. Phase 3 queue: CHORE-138, 139, 143 and 133, plus any Phase 2 item the maintainer picks. Roadmap statuses are proposals only; lane A applies them.

Phase 1 (2026-10-23): commits `dc82aff`, `8224c8b`, `f697c20`, `b53a67b`, `9ded0aa`; final checks row 5015.
