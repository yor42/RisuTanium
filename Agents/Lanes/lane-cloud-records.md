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

## CHORE entries (proposed status changes)

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

## Handoff

Phase 1 technically complete, awaiting the maintainer's approval before Phase 2 (2026-10-23). Commits on `lane-cloud`: `dc82aff` (CHORE-142, records), `8224c8b` (records: CHORE-144, MC-702, MC-703), `f697c20` (CHORE-152), `b53a67b` (CHORE-67), then the MC-707 commit of the four reports in `Agents/Lanes/lane-cloud/` and this file. Final checks: row 5015. Open for lane A: the `saveLoop` flushed:false failure (possible persistence defect, not traced) and the `actors` timeouts, above. Roadmap statuses are proposals only (CHORE entries above); lane A applies them.
