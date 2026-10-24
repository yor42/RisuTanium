# Lane G records

Lane G is the parity batch (Group B, kept open by the maintainer on 2026-10-24): CHORE-178, CHORE-45 and CHORE-41. Checkout `.claude/worktrees/Lane-G`, branch `worktree-Lane-G`, made from `origin/main` at `df408f8de`. IDs: MC-540 to MC-559, CHORE-390 to CHORE-409, ledger rows 3900 to 4099; overflow is provisional `MC-G1`, `CHORE-G1`, `row G1` (`Agents/Lanes/README.md`). Scratch: `%TEMP%\risu-lane-g\`. Ports 6500 to 6519.

## MC entries

### MC-540 — Lane G, 2026-10-24: CHORE-178, a lorebook scan depth larger than the chat scans every message; a non-number or negative `@@scan_depth` falls back to the configured depth; CHORE-41 stays parked

- Tag: decisions (maintainer's `AskUserQuestion` answers by option label, 2026-10-24). Date: 2026-10-24. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`. The answers and option labels are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: CHORE-178's `searchMatch` in `src/ts/process/lorebook.svelte.ts` slices `messages.slice(messages.length - arg.searchDepth, messages.length)` with no clamp. A negative start counts from the end, so with depth 5 a 3-message chat scans only the last 2 messages and a 4-message chat only the last 1 (lane G's reading of `Array.prototype.slice` semantics at `df408f8de` when the question was asked; later confirmed by the Gate 1 reviewer's node experiment and by the reproducers failing on `df408f8de`). The meaning of a too-large depth and of a bad decorator value is user-visible, so it is the maintainer's choice (`MC-091`). CHORE-41 was parked by `MC-199` 1 until the maintainer reports it again; the Android MVP is installed (`MC-475`), so lane G asked.
- Alternatives rejected: "Leave as upstream" (CHORE-178); "Leave as is" (the bad decorator value); "Still happens" (CHORE-41).
- Related: `MC-175` and `MC-011` (the fork may diverge from upstream behaviour while staying data-compatible), `MC-199` 1 (CHORE-41 low priority), `MC-475` (the MVP baseline).

**The maintainer's answers.**
1. To "CHORE-178: when a lorebook's scan depth is larger than the number of chat messages, what should it scan? (Today with depth 5, a 3-message chat scans only the last 2, a 4-message chat only the last 1; 1-2 messages and 5+ work.)": "Scan all messages (Recommended)". The option read: "Clamp the window: depth larger than the chat means every message is scanned. Matches what depth is meant to be; differs from upstream only in fixing the bug. Depth 0 still scans no messages."
2. To "CHORE-178 side case: an @@scan_depth decorator whose value is not a number (e.g. a typo) currently scans the whole chat. What should it do?": "Use normal depth (Recommended)". The option read: "Ignore the bad decorator value and use the lorebook's configured scan depth. A negative value is treated the same way."
3. To "CHORE-41 (edit button on an earlier message sometimes opens no editor): do you still see it on the Android MVP or anywhere else?": "Not seen lately". The option read: "Keep it parked (low priority, MC-199 1); Lane G does not work it."

**What was decided (maintainer).**
1. A scan depth larger than the number of scanned messages scans every message. A depth of 0 still scans no messages (answer 1).
2. An `@@scan_depth` value that is not a number, or is negative, is ignored and the lorebook's configured scan depth is used (answer 2).
3. CHORE-41 stays parked at low priority; lane G does not work it (answer 3).

### MC-541 — Lane G, 2026-10-24: CHORE-45 is fixed in two stages; stage 1 now with no extra memory, stage 2 (a prompt-pass cache that grows with the chat) waits for the memory-footprint work

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-24). Date: 2026-10-24. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`; the sizing packet `%TEMP%\risu-lane-g\chore45\result.md` (an `investigator` packet, not independently verified; a Map/FIFO simulation in `sim.js` and `sim2.js` there). The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: the sizing packet found that `processScriptCache` in `src/ts/process/scripts.ts` is shared by the send's prompt pass, display, `editinput` and `editoutput`, and that under the default streaming mode `'off'` (still the default at `df408f8de`; `MC-257`'s change is not implemented) each streamed chunk inserts an `editoutput` entry and the remounted body an `editdisplay` entry. A long reply can therefore evict the whole 1,000-entry cache, and the next send misses on every message. Separately, a chat with more than about 1,000 cacheable messages misses even without streaming; fixing that needs a capacity that grows with the chat, bounded by a memory budget, and `MC-119` places capacity sizing after the memory-footprint work.
- Alternatives rejected: "Both stages, 16 MB cap"; "Both stages, 64 MB cap".
- Related: `MC-069`, `MC-113`, `MC-119`, `MC-130`, `MC-257`; CHORE-390 (stage 2).

**The maintainer's answer.** To "CHORE-45 (script cache): the cache holds 1,000 results shared by everything. A streamed reply adds ~2 entries per chunk, so one long reply can wipe it and make the next send redo every message's scripts (cost grows with chat length; worst on phones). Separately, chats with ~1,000+ cacheable messages miss even without streaming. How far should Lane G go?": "Stage 1 now, 2 later (Recommended)". The option read: "Now: stop caching streamed partial replies and give the send's prompt pass its own cache, so display/stream traffic can't evict it. No extra memory. Very long chats (1,000+ cacheable messages) still go cold; that part waits for the memory-footprint work (MC-119) and gets a follow-up ticket."

**What was decided (maintainer).**
1. CHORE-45 stage 1: streamed partial replies are not cached, and the send's prompt pass gets its own cache that display and streaming traffic cannot evict. No added memory budget.
2. Stage 2, a prompt-pass capacity that grows with the chat under a memory cap, waits for the memory-footprint work (`MC-119`) and is filed as CHORE-390.

### MC-542 — Lane G, 2026-10-25: CHORE-45 stage 1 caps are 1,000 entries for the prompt pass and 200 for everything else (amends the "no extra memory" wording of `MC-541` 1)

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: the option chosen in `MC-541` said stage 1 adds no memory. A second fixed cap for the non-prompt traffic raises the worst-case ceiling of cached text, so lane G asked before planning. The ~20% and the MB figures in the option are lane G's arithmetic from the sizing packet's bound of about 1,000 x (2L + S) characters (L message length, S script text); nothing was measured.
- Alternative rejected: "800 + 200 (same total)".
- Related: `MC-541`, CHORE-390.

**The maintainer's answer.** To "CHORE-45 stage 1 detail: splitting the cache means one fixed cap for the send's prompt pass and one for everything else (display, edits). I described stage 1 as 'no extra memory'; strictly, a second cap raises the worst case a little. Which split?": "1,000 + 200 (Recommended)". The option read: "Prompt pass keeps today's 1,000 entries; display/edits get their own 200 (the chat screen shows ~30-60 messages). Worst-case cached text rises by up to ~20% of today's ceiling (e.g. ~6 MB to ~7 MB at 2 KB messages). Fixed, does not grow with the chat."

**What was decided (maintainer).** The send's prompt pass keeps a cache capped at 1,000 entries; all other script-cache traffic gets a separate cache capped at 200 entries. Neither grows with the chat.

## CHORE changes

### CHORE-178 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `d4e868da7`, technically accepted; merge and full checks pending.** `searchMatch` clamps the scan window's start at 0, and a non-number or negative `@@scan_depth` returns `false`, so the configured depth stays and a `@@@scan_depth` fallback applies (`MC-540` 1 and 2). New test file `src/ts/process/tests/lorebookScanDepth.svelte.test.ts`, 13 tests: 6 reproducers fail on `df408f8de` and pass after (run by the implementer, and again by the Gate 2 reviewer through a scratch vitest config that restores the old lines in memory), and 7 guards pass before and after. Gate 1 EDITORIAL (`%TEMP%\risu-lane-g\chore178\review\gate1.md`), with its 4 amendments applied. Gate 2 APPROVE (`%TEMP%\risu-lane-g\chore178\gate2\verdict.md`), `pnpm check` clean. Commit claims checked by `doc-verifier`. Optional, not taken: a guard that `@@scan_depth 0` is valid and scans nothing. Non-goal: a NaN or negative configured depth is not validated.

### CHORE-45 — status update for the Roadmap entry

**Status (2026-10-25, lane G): stage 1 fixed on `worktree-Lane-G` in `6aabb3a85`, technically accepted; stage 2 is CHORE-390; merge and full checks pending.**

- **Prompt-pass cache.** Calls that carry a `promptView` cache in their own map, capped at 1,000 entries. Every other call shares a map capped at 200 (`MC-541` 1, `MC-542`). Both maps keep the same key, the same oldest-first eviction and the same `isKeyDeterminedPass` gate, and `resetScriptCache` clears both.
- **Streamed replies bypass the cache.** `processScriptFull` takes a trailing `cache: 'use' | 'bypass'`, and the streaming reply path in `index.svelte.ts` (`processAndWriteReply`) passes `'bypass'`. Non-streamed `editoutput` calls still cache.
- **Accepted behaviour change (Gate 1 amendment 6).** An identical repeated streamed text now reruns the scripts, so `emoChanged` can be true.
- **Accepted consequence (`MC-542`).** Display entries now live in the 200-entry map, so a very large chat-load window or a long off-mode stream thrashes display hits. This costs speed only.
- **Tests.** New `src/ts/process/tests/scriptsCacheSplit.test.ts`; `sendChatScriptsCost.svelte.test.ts` and `scriptsMeasure.test.ts` are amended. The reproducers fail on `df408f8de` and pass after, run by the implementer and again by the Gate 2 reviewer against the base source through a scratch config (11 failed, 21 passed). The reproducers are: 300 prompt-pass entries survive 1,200 other calls, and a streamed chunk's text is not cached in modes off, balanced and strong.
- **Evidence.** Sizing packet `%TEMP%\risu-lane-g\chore45\result.md` (an `investigator` packet; Gate 1 checked its load-bearing claims against source). Gate 1 EDITORIAL with 6 amendments applied (`%TEMP%\risu-lane-g\chore45\review\gate1.md`). Gate 2 APPROVE (`%TEMP%\risu-lane-g\chore45\gate2\verdict.md`). Targeted run 28 files, 607 tests passed; `pnpm check` clean. The commit claims were checked by `doc-verifier`.
- **Not measured.** Nothing was measured on a device. The benefit is shown only by hit counters on mocks.

### CHORE-41 — status update for the Roadmap entry

**Status (2026-10-24, lane G): stays open, low priority, not worked (`MC-540` 3).** The maintainer has not seen it lately.

### CHORE-390 — Script cache stage 2: a prompt-pass cache sized to the chat, under a memory cap

**Status (2026-10-24): open, not scheduled; waits for the memory-footprint work (`MC-541` 2, `MC-119`).** Type: performance limitation.

- After CHORE-45 stage 1 the send's prompt pass has its own cache, still capped by entry count. A chat with more than that many cacheable messages misses on every message of a repeat send (sizing packet `%TEMP%\risu-lane-g\chore45\result.md`, simulation RUN in node; not measured on a device).
- Proposed shape (from the sizing packet, not decided): the prompt-pass capacity follows the chat's length, bounded by a byte budget. The budget is the maintainer's number.

## Ledger rows

None yet.

## Handoff

- 2026-10-24: worktree made, dependencies installed. Decisions MC-540 recorded. CHORE-45 sizing dispatched to an `investigator` (packet to `%TEMP%\risu-lane-g\chore45\result.md`). CHORE-178 plan next.
- 2026-10-25: batch done. Branch `worktree-Lane-G`, commits `d4e868da7` (CHORE-178) and `6aabb3a85` (CHORE-45 stage 1) on `df408f8de`; this records file is committed after them. Not pushed.
- **Full checks on the tree committed as `6aabb3a85`.** The run started on the uncommitted tree, whose `git status` (`status.txt`) lists exactly the commit's five files plus this untracked file. Logs are in `%TEMP%\risu-lane-g\full\`.
  - `pnpm check`: exit 0, with 0 errors and 0 warnings. The exit code was printed to the task output, not saved in the log.
  - `pnpm build`: exit 0 (`built in 14.78s`). The exit code was likewise in the task output only.
  - `pnpm test`: exit 1. 980 of 985 files passed, 1 was skipped and 4 failed. 21,939 tests passed, 133 were skipped and 6 failed.
  - **The four failing files:**
    - `drive/tests/internalBackupSnapshotLoad.svelte.test.ts`
    - `process/request/secretRefProviders.test.ts`
    - `storage/tests/assetFacade.test.ts`
    - `storage/tests/manualCleanup.svelte.test.ts`
  - **What the failures were (`test.txt`):**
    - 1 hook timeout in `secretRefProviders`; that suite's tests were skipped and are not among the 6.
    - 3 test timeouts.
    - 2 vitest mock-export errors: "No `risuChatParser` export is defined on the parser mock".
    - Assertion failures in the `internalBackupSnapshotLoad` guard test "strict decoding rejects…".
  - **Where the mock-export error comes from:** the stack points at `scripts.ts`'s module-level alias `export const risuChatParser = risuChatParserOrg`, imported through `stores.svelte.ts`. That alias and its import are identical at `df408f8de`; lane G's diff changes no import and no module-level alias in `scripts.ts`; only the `processScriptFull` signature gains a parameter (`git diff df408f8de HEAD -- src/ts/process/scripts.ts`).
  - **Rerun alone:** the four files passed, 4 of 4 files and 565 tests. The `doc-verifier` reran them too, with the same result.
  - **Classification:** none of the four files is in lane G's diff, and they pass when run alone. That they are load flakes is lane G's inference, not an established cause. They are outside the three CHORE-193 files named in the lane brief.
  - **Snapshot file:** the full run rewrote `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` with line-ending changes only. `git diff --stat` showed no content change; this was observed in the session and not saved to scratch. Lane G restored the file with `git checkout --`. Afterwards `git status --short` showed only this records file, and the `doc-verifier`'s later check saw the same.
- **Open:**
  - No product question is open.
  - CHORE-41 is parked (`MC-540` 3).
  - CHORE-390 is unscheduled.
  - Pushing the branch needs the maintainer's approval.
  - Merging is lane A's job.

# Batch 2 (from 2026-10-25): closure audit and test fixes

Lane A's brief `%TEMP%\risu-b715\lanes-next\lane-G-hygiene.md` (lane A records the maintainer's choice as MC-507). Branch fast-forwarded to `main` `8003b3c4c`; batch 1 is folded in. IDs continue at MC-543, CHORE-391, row 3900.

## Batch 2 MC entries

### MC-543 — Lane G, 2026-10-25: lane G takes batch 2 (closure audit of CHORE-29, 31, 32, 55, 61, 70; CHORE-209; CHORE-183)

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: lane A relayed the batch and said the relay is not approval, so lane G confirmed the scope in its own session before starting.
- Alternatives rejected: "Audit + CHORE-209 only"; "Not now".
- Related: `MC-507` (lane A's record of the same choice), `MC-500` (commit on the lane branch after gates and green checks).

**The maintainer's answer.** To "Lane A relayed Lane G's next batch, which it says you chose as "Closure audit + test fixes": (1) a records-only closure audit of CHORE-29, 31, 32, 55, 61 and 70 against current main, with a close/park/keep proposal for you to decide; (2) CHORE-209, a test-only isolation fix for the Chat.supaResume branch tests; (3) CHORE-183, a missing or non-list botPresets stopping "Convert without these parts", sized first, with any product choice brought to you before code. Should Lane G take this scope?": "Yes, all three". The option read: "Lane G fast-forwards to main, then audit, CHORE-209, and CHORE-183 (sized first)."

**What was decided (maintainer).** Lane G takes all three items of batch 2. CHORE-183 is sized first, and any product choice comes to the maintainer before code.

### MC-544 — Lane G, 2026-10-25: CHORE-183, converting an older-format save with a missing, null or non-list `botPresets` uses the Default preset; a present non-list is named among the skipped parts

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`; the sizing packet `%TEMP%\risu-lane-g\chore183\result.md` (an `investigator` packet, not independently verified; a scratch vitest run of the real `convertLegacyWithout` there). The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: the sizing packet found that the throw (`botPresets is not a list.`) is reachable only through the older-format (msgpack) lenient decode, after the user confirms "Convert without these parts", and that nothing is written. The block-format decoder, the `.bin` import path and `setDatabase` already default a missing list to a Default preset. Whether a malformed value is dropped silently or named is user-visible.
- Alternatives rejected: "Default it; always name it"; "Refuse with a message"; "Park it".
- Related: `MC-322` 6 (the source of CHORE-183), `MC-175`.

**The maintainer's answer.** To "CHORE-183: converting an older-format save whose preset list (botPresets) is missing, null or not a list crashes after you confirm "Convert without these parts" (nothing is written). Newer saves and .bin imports already fill in a Default preset in that case. Real old saves probably always have the list; the trigger so far is a synthetic file. What should the conversion do?": "Default it; name bad ones (Recommended)". The option read: "Missing or null: use the Default preset, as other import paths do, without listing it, since nothing is lost. Present but not a list: also use the Default preset, and list "Presets" among the skipped parts on the confirm screen so you know that value was dropped. The original file is never changed."

**What was decided (maintainer).**
1. A missing or null `botPresets` in an older-format save being converted becomes the Default preset, and is not listed as skipped.
2. A present `botPresets` that is not a list also becomes the Default preset, and "Presets" is listed among the skipped parts on the confirm screen.
3. The original file is never changed.

### MC-545 — Lane G, 2026-10-25: CHORE-183, on the normal (strict) conversion a present non-list `botPresets` counts as a failed read; corrects the premise of `MC-544`

- Tag: decision and a correction (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`; the CHORE-183 Gate 1 verdict `%TEMP%\risu-lane-g\chore183\review\gate1.md` (`opus-reviewer`, `[REJECT]`) and its runs `run4.log` and `run6.log` there (lane G read the run results). The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- **Correction to `MC-544`'s reasoning.** `MC-544` said the throw is reachable only through the older-format lenient decode, after the user confirms "Convert without these parts". The Gate 1 reviewer found that wrong. A save with a recognised older-format header decodes the same way in strict and lenient mode, so the throw comes first in the normal strict conversion, at boot and on the recovery screen, and no question is asked first. The reviewer's runs used real older-writer bytes (`encodeRisuSaveLegacy`, uncompressed and compressed) with `botPresets` missing or an object, through `convertLegacyProfile`, and the result was `CodecInputError: botPresets is not a list.`, nothing asked and nothing written. `MC-544` 1 (missing or null becomes the Default preset) still applies on both paths. `MC-544` 2 (name a present non-list) cannot be shown on the strict path, which has no skipped-parts list. The text of `MC-544` is left as recorded.
- Alternatives rejected: "Default it silently there"; "Add a "Presets" item".
- Related: `MC-544`, `MC-091`, `MC-058` (new strings would need the translator); CHORE-391 (the same class of crash for other fields).

**The maintainer's answer.** To "CHORE-183 follow-up: the crash also happens on the normal conversion of an older save (at startup, no screen shown), not only on "Convert without these parts". The normal path has no skipped-parts list, so your choice to name a malformed (non-list) preset value can't be shown there. A missing/null list → Default preset works on both paths as decided. For a present but malformed value on the normal path, what should happen?": "Treat as a failed read (Recommended)". The option read: "The normal conversion treats the file as not cleanly readable, so the existing flow follows: a good backup if one exists, otherwise the "Convert without these parts" screen, which names "Presets" before you convert. No new UI text; keeps your rule that a dropped value is always named first."

**What was decided (maintainer).** On the normal (strict) conversion of an older-format save, a present `botPresets` that is not a list counts as a failed strict read. The existing flow then follows: a good backup if one exists, otherwise "Convert without these parts", which names "Presets" before the user converts (`MC-544` 2 holds there). No new UI text.

### MC-546 — Lane G, 2026-10-25: closure audit: CHORE-29, 31, 32, 55 and 61 close; CHORE-55's later stages and CHORE-61's `kv:` export edge become new tickets; CHORE-70 stays open, narrowed

- Tag: decisions (maintainer's `AskUserQuestion` answers by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`. The evidence is the audit packet `%TEMP%\risu-lane-g\audit\result.md` (`investigator`, source reading at `8003b3c4c`) and its independent check `%TEMP%\risu-lane-g\audit\review\verdict.md` (`opus-reviewer`, `[REJECT]` of the packet's wording for CHORE-29, 32 and 70; it ran scratch vitest diagnostics on the real store2 save loop, `run1.log` to `run3.log` there). Both re-check lane E's audit `%TEMP%\risu-lane-e\audit\audit.md`. The answers and option labels are the maintainer's; the question texts are lane G's wording, quoted below, and were written from the corrected verdict.
- Reasoning: the tickets' status lines said "superseded on store2 per lane E audit" or "candidate to close". The brief required a source check of each "moot" claim. The verdict confirmed that the legacy save loop, `RisuSaveEncoder` writes and `reloadSaveEncoder` cannot run on any production page. It confirmed the three fixing commits (`33545c2c6`, `d0decfb61`, `0d4efeb12`) as ancestors of `8003b3c4c`. It corrected three premises:
  - CHORE-29: since `67273e799`, unused units are cleaned up automatically, once per launch, on Tauri only.
  - CHORE-32: the returned character counts as unheld and is saved at the next idle-net check, about every 2 s (scratch test S1).
  - CHORE-70: a leftover remains on read-only legacy pages.
- Limit: question 1 did not mention CHORE-32's narrow stub-load retry window, where only the 30 s backstop catches the edit (traced, not run); the CHORE-32 status line records it.
- Alternatives rejected: "Close 29 and 31; keep 32"; "Close and drop the rest" and "Keep open for the rest" (CHORE-55); "Close, no ticket" (CHORE-61); "Close, accept the gap" (CHORE-70).
- Related: `MC-181` (CHORE-55's release blocker lifted), `MC-223` (the one allowed export exception), `MC-091`, `MC-175`; CHORE-392 and CHORE-393.

**The maintainer's answers.**
1. To "Closure audit (verified by opus-reviewer, with scratch tests run on the real store2 save loop): CHORE-29 (stale copy on filling a chaId), CHORE-31 (cold storage turns a group into a character) and CHORE-32 (a swap drops a pending edit) no longer happen. 29 and 32 were shown by test; 32's edit is now saved at the next idle check about 2 s later. Close these three as moot, with the corrected reasons?": "Close all three (Recommended)". The option read: "Each gets a dated closing line citing the mechanism or commit (31: 33545c2c6) and the scratch test evidence."
2. To "CHORE-55 (Tauri main-file writes not atomic): fixed for every store write by d0decfb61 (temp file, rename, sync). The ticket also lists later stages (inlay files, search index, streaming writes) that were never done; MC-181 only lifted the release blocker. What happens to those?": "Close; new ticket for rest (Recommended)". The option read: "Close CHORE-55 as fixed and file the remaining stages as their own open, unscheduled ticket."
3. To "CHORE-61 (encoder loses data on a reserved or over-long chaId): fixed by 0d4efeb12. One edge remains: a character id like "kv:foo" makes a full .bin export refuse with an error when the save also has a "foo" data namespace. That is a loud refusal, not silent loss, but it blocks every full export while it lasts.": "Close; file kv: ticket (Recommended)". The option read: "Close CHORE-61 and file the kv: export edge as a small new ticket (its fix changes export re-id behaviour, so it would come back to you)."
4. To "CHORE-70 (a partly decoded save is installed without notice): fixed on every page that saves. Left over: on a read-only legacy page (web/Node, or a not-yet-converted Tauri/Android profile whose storage gate failed) a partly decoded save loads with no notice, and a .bin export from there can be partial yet look complete. Data on disk is untouched.": "Keep open, narrowed (Recommended)". The option read: "Retitle CHORE-70 to the read-only-page notice and partial-export gap; low priority, not scheduled."

**What was decided (maintainer).**
1. CHORE-29, CHORE-31 and CHORE-32 close as moot, each with a dated line citing the mechanism or commit and the scratch evidence.
2. CHORE-55 closes as fixed. Its remaining stages (inlay files, search index, streaming writes) become a new open, unscheduled ticket, CHORE-392.
3. CHORE-61 closes as fixed. The `kv:` export edge becomes a small new ticket, CHORE-393. Its fix changes export re-id behaviour, so it comes back to the maintainer.
4. CHORE-70 stays open at low priority, unscheduled. It is retitled to the read-only-page notice and partial-export gap.

### MC-547 — Lane G, 2026-10-25: commit CHORE-183 on the lane branch (the per-commit approval for a persistence change)

- Tag: approval (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `7fb81b14-3585-4fb9-b518-f42aa7240633`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: lane G's batch 1 brief says save-format, persistence and data-loss changes need per-commit approval even under the standing approval. CHORE-183 changes what a legacy conversion installs.
- Alternative rejected: "Hold it".
- Related: `MC-500`, `MC-544`, `MC-545`; commit `8c1abc67a`.

**The maintainer's answer.** To "CHORE-183 is ready to commit on the Lane G branch. Converting an older save with a missing or null preset list now installs with the Default preset. A malformed list makes the normal conversion offer a good backup, or else name "Presets" on the "Convert without these parts" screen. The source file is never written. Gate 1 (after one REJECT) and Gate 2 are APPROVE from opus-reviewer; full test, check and build are green. It changes what a conversion writes, so it needs your per-commit approval. Commit it?": "Commit it". The option read: "Commit the five CHORE-183 files on worktree-Lane-G (not pushed); lane A merges."

**What was decided (maintainer).** CHORE-183 is committed on `worktree-Lane-G`. It is not pushed, and lane A merges it.

## Batch 2 CHORE changes

### CHORE-391 — Converting an older-format save stops with an error for other malformed fields

**Status (2026-10-25): open, not scheduled; found by the CHORE-183 Gate 1 review.** Type: suspected defect (legacy conversion), the same class as CHORE-183. Not decided whether or how to handle these; no maintainer decision.

- Source: `%TEMP%\risu-lane-g\chore183\review\gate1.md`, residual R1 (`opus-reviewer` source reading at `8003b3c4c`; not executed for these fields).
- The cases: a present non-list `modules`, `loadouts`, `plugins` or `pluginV2`; a `botPresets` list with an element that is not an object; a character or chat that is not an object. The CHORE-183 commit-claim check (`opus-reviewer`, source reading, not executed) adds two more: a character's non-list `chats` and a chat's non-list `message`. Each still throws a `CodecInputError` in the conversion. At boot the user then sees an error alert, and on the recovery screen the unexpected-error screen. That addition was reported in session, not saved.

### Status lines for the Roadmap entries (closure audit, `MC-546`)

- **CHORE-29 — COMPLETE (closed as moot, 2026-10-25, `MC-546` 1).**
  - In store2 the manifest is rebuilt from the live list on each pass (`scoped.ts`), and ids are minted (`split.ts`), so nothing brings back a stale copy.
  - Scratch tests S3 and S4 (`%TEMP%\risu-lane-g\audit\review\`, real store2 save loop on a memory backend) reload exactly the live list after filling an empty `chaId` and after replacing a slot five times.
  - Unused units are cleaned up automatically, once per launch, on Tauri only (`67273e799`, `autoGc.ts`); on web and Node they stay on disk.
  - An upstream `.bin` that already holds a stale character block imports it, as upstream does; that is not a fork defect.
- **CHORE-31 — COMPLETE (closed as moot, 2026-10-25, `MC-546` 1).**
  - `33545c2c6` (2026-10-01, the 10-day archiving stopped) deleted `makeColdDataForCharacter`.
  - `buildColdStub` (`coldCharacter.ts`) and `stubFromEntry` (`stub.ts`) keep the group type and members.
  - On conversion and import, `resolveLegacyTree` (`resolve.ts`) brings back the unit's real group.
- **CHORE-32 — COMPLETE (closed as moot, 2026-10-25, `MC-546` 1).**
  - In store2, the pass that drops the absent character's mark (`saveLoop.ts`, `marksOf`) also saves without that character. When it returns it counts as unheld and is saved at the next idle-net check, about every 2 s (scratch test S1; control S2).
  - A narrow window remains in `planOf`'s stub-load retry, where only the 30 s backstop catches the edit (traced, not run; existing test B3 covers the backstop).
  - That window is a short not-yet-saved delay (CHORE-153 class), not a permanent drop.
  - No repository test covers the absent-character case; the scratch tests are diagnostics.
- **CHORE-55 — COMPLETE (closed as fixed, 2026-10-25, `MC-546` 2).**
  - `d0decfb61` and the store contract write every Tauri store file through a temp file, a rename and a sync (`tauriAtomicWrite.ts`, `tauriFilesStore.ts`, `durable_write.rs`, `chunked_io.rs`).
  - The remaining stages are CHORE-392.
- **CHORE-61 — COMPLETE (closed as fixed, 2026-10-25, `MC-546` 3).**
  - `0d4efeb12` (2026-10-08, CHORE-117) added the reserved-name and 255-byte checks (`characterIds.ts`, `risuSave.ts`) and a prototype-free block map.
  - `exportCopyOf` re-ids reserved, over-long and missing ids before `writeRisuSaveV0` names character blocks by `chaId`.
  - The remaining `kv:` edge is CHORE-393.
- **CHORE-209 — fixed on `worktree-Lane-G` in `1fb45bf9a` (2026-10-25); technically accepted; merge pending.**
  - Test (c) of `src/lib/ChatScreens/Chat.supaResume.svelte.test.ts` imported its memory modules dynamically inside the timed body. They are now imported at the top of the file. `afterEach` also restores the empty mocked database, but that reset alone does not fix the race: a Gate 2 mutant with only the reset still failed.
  - Evidence: under a scratch config that delays the cold import with a 300 ms timeout, the `8003b3c4c` file fails (c) by timeout and (d) with "expected 3 to be 5", and the fixed file passes 21 of 21. Both the implementer and the Gate 2 reviewer ran this; the reviewer used the final harness on a scratch copy of the base file (`%TEMP%\risu-lane-g\chore209\gate2\red.log`).
  - Limit: the forced delay models the cold import, not real full-suite timing.
  - Gates: no plan gate (test-only, small); Gate 2 EDITORIAL, with the comment reworded and rechecked (`%TEMP%\risu-lane-g\chore209\gate2\verdict.md`). Commit claims checked by `doc-verifier` in session (not saved).
- **CHORE-183 — fixed on `worktree-Lane-G` in `8c1abc67a` (2026-10-25, committed under `MC-547`); technically accepted; merge pending.**
  - What changed (`MC-544`, `MC-545`):
    - A missing or null `botPresets` in a converted older-format save gets the Default preset, shared with `completeRestoredTree` through `makeDefaultPreset` in `treeToBlockSet.ts`.
    - A present non-list `botPresets` makes the strict read (`readStrictSource`) treat that file as not decoded, so a good backup is offered. Otherwise the lenient read names "Presets" and the conversion then defaults it.
    - Only a tree with a `characters` list is defaulted. The source file is never written.
  - Tests: new `src/ts/storage/tests/store2/legacyConvertPresets.test.ts` and two cases in `legacyLenient.test.ts`. 18 reproducers fail on `8003b3c4c` for the defect (Gate 2 rerun, `%TEMP%\risu-lane-g\chore183\gate2\red-base.log`).
  - Gates (all `opus-reviewer`): Gate 1 round 1 REJECT (wrong premise, corrected in `MC-545`), round 2 APPROVE with amendments B1 to B6; Gate 2 APPROVE; commit message and comments EDITORIAL (reported in session, not saved), corrected and closed.
  - Full checks: run on the tree holding both changes, before three comment-only edits (see the batch 2 handoff).
  - Residual: CHORE-391.
- **CHORE-70 — open, low priority, not scheduled; narrowed (2026-10-25, `MC-546` 4).**
  - New title: "On a read-only legacy page a partly decoded save loads with no notice, and a `.bin` export from it can be partial yet look complete".
  - Saving pages decode strictly first (`convert.ts`), so the original premise no longer holds there.
  - The leftover reaches read-only legacy pages: web (the transitional OPFS page) and Node (a failed capability probe), and a not-yet-converted Tauri or Android profile whose native storage-gate registration failed or timed out (`store2/backend/tauri.ts`).
  - On those pages a partly decoded save is loaded with no notice (`bootstrap.ts`). The `.bin` export there has no read-only check, because `refuseOnReadOnlyPage` guards only restore, internal-backup load and clean-up.
  - Data on disk is untouched. The Android MVP's store2 profile cannot reach a read-only legacy page, so `MC-350`'s carried-forward data is not affected.
  - `.bin` import goes through `storeImport.ts` and `importTree.ts` (CHORE-221), not the same path.

### CHORE-392 — Tauri non-store writes are not yet atomic: inlay files, search index, streaming writes (the remaining stages of CHORE-55)

**Status (2026-10-25): open, not scheduled (`MC-546` 2).** Type: robustness (partial write on a failed write). Split out of CHORE-55 when it closed: the store writes are atomic since `d0decfb61`, and the later stages in CHORE-55's entry were never done. `MC-181` lifted CHORE-55's release blocker; this ticket carries no blocker.

### CHORE-393 — A character id like `kv:foo` makes a full `.bin` export refuse when the save also has a `foo` data namespace

**Status (2026-10-25): open, not scheduled (`MC-546` 3).** Type: suspected defect (export).

- `isUsableCharacterId('kv:foo')` is true (`characterIds.ts`), and `writeRisuSaveV0` then throws on the block-name collision (`risuSaveV0.ts`). Scratch tests K1 to K3 in `%TEMP%\risu-lane-g\audit\review\` show it.
- `runExport` reports the error, so it is a loud refusal, not silent loss. While it lasts it blocks every full `.bin` export, which goes beyond `MC-223`'s one allowed exception.
- A fix changes export re-id behaviour, so the choice comes back to the maintainer.

## Batch 2 fold-in list

- MC-543, MC-544, MC-545.
- MC-546, MC-547.
- CHORE-391, CHORE-392, CHORE-393 (new).
- Status lines: CHORE-29, 31, 32, 55, 61 COMPLETE (to the closed archive); CHORE-70 narrowed and retitled; CHORE-209 and CHORE-183 fixed (merge pending).
- Commits: `1fb45bf9a` (CHORE-209), `8c1abc67a` (CHORE-183), then this records file.

## Batch 2 handoff

- 2026-10-25: scope confirmed (MC-543), branch at `8003b3c4c`. Next: the closure audit and CHORE-183 sizing (read-only, in parallel), then CHORE-209.
- 2026-10-25: batch 2 done. Branch `worktree-Lane-G` on main `8003b3c4c`: `1fb45bf9a` (CHORE-209), `8c1abc67a` (CHORE-183), then this records file. Not pushed.
- **Full checks** ran on the tree holding both changes, before three comment-only edits to the CHORE-183 files. Lane G made the `plan = await` spacing fix before the run, but no saved file records that order (the `convert.ts` mtime is later than the logs because of the comment edits). Logs are in `%TEMP%\risu-lane-g\full2\`, with exit codes in `exits.txt`.
  - `pnpm test`: exit 0. 990 files passed and 1 skipped; 22,157 tests passed and 23 skipped.
  - `pnpm check`: exit 0, with 0 errors and 0 warnings.
  - `pnpm build`: exit 0.
  - The run rewrote `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` with line-ending changes only (`git diff --stat` empty). Lane G restored it with `git checkout --`.
- **Open:** no product question.
  - New tickets: CHORE-391 (other malformed fields), CHORE-392 (CHORE-55's remaining stages) and CHORE-393 (the `kv:` export edge, whose fix choice comes back to the maintainer).
  - CHORE-70 stays open, narrowed.
  - Pushing the branch needs the maintainer's approval; merging is lane A's job.