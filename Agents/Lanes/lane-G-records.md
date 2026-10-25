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

# Batch 3 (from 2026-10-25): small fixes and low-priority follow-ups

Lane A's brief `%TEMP%\risu-b715\lanes-next\lane-G-batch3.md` (lane A records the maintainer's un-park as MC-507 and MC-508). Branch fast-forwarded from `efcf63634` to main `31b050a63` on 2026-10-25, before the batch 3 commits. IDs started at MC-548, CHORE-394 (block 390 to 409; CHORE-391 to 393 already exist) and ledger row 3900. Batch 3 used MC-548 to MC-559, so lane G's MC block (540 to 559) is exhausted; the next MC needs a new block from lane A. Next free: CHORE-394, ledger row 3900. Scope confirmed by the maintainer (scope question, not an MC): all 8 tickets, in brief order, one commit each; persistence tickets get `opus-reviewer` and per-commit approval (`MC-500`).

## Batch 3 MC entries

### MC-548 — Lane G, 2026-10-25: CHORE-391, an older save with other malformed parts follows the botPresets rule (`MC-544`, `MC-545`)

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below. Scratch: `%TEMP%\risu-lane-g\batch3\mc-source.md`.
- Reasoning: an older-format save with a non-list `modules`, `loadouts`, `plugins`, `pluginV2`, `pluginCustomStorage`, `chats` or `message`, or with a preset, module, plugin, character, chat or message element that is not an object, stops the normal conversion with a `CodecInputError`. Nothing is written, but the user is stuck at every boot. The question asked whether to extend the `MC-544` and `MC-545` rule to all of them.
- Alternative rejected: "Refuse only".
- Related: `MC-544`, `MC-545`, `MC-557` (the refinements), `MC-091`, `MC-058` (new part names need the Translator), CHORE-391.

**The maintainer's answer.** To "CHORE-391: an older save with other malformed parts (modules/loadouts/plugins not a list, a chat's messages not a list, a preset/character/chat/message that isn't an object) crashes the conversion at startup. Nothing is written and the old file stays intact, but the user is stuck at every boot. Extend the botPresets rule (MC-544/545) to all of them?": "Same rule as presets (Recommended)". The option read: "The normal conversion treats any of these as a failed read, so a good backup is offered if one exists. Otherwise "Convert without these parts" names each bad part (e.g. Modules, Chats) and drops it from the converted copy only; the old file is never changed. May need a few new part names (Translator)."

**What was decided (maintainer).** Every other malformed part follows the `MC-544` and `MC-545` rule. The normal (strict) conversion counts it as a failed read, so a good backup is offered. Otherwise "Convert without these parts" names each bad part and drops it from the converted copy only. The old file is never changed. New part names may be needed; the Translator adds them later.

### MC-549 — Lane G, 2026-10-25: CHORE-391, a present non-list character list is refused, never converted to an empty profile

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: if the save's whole character list is not a list, the conversion silently succeeds with zero characters. No crash and no warning, and the old file stays intact. An empty profile would look like every character had vanished.
- Alternative rejected: "Convert, name it".
- Related: `MC-548`, `MC-553` 1 and `MC-557` 1 (the missing-list case, corrected there), `MC-091`.

**The maintainer's answer.** To "Related case: if the save's whole character list is not a list, conversion silently succeeds with zero characters (no crash, no warning). The old file stays intact. What should happen?": "Refuse it (Recommended)". The option read: "Count it as a failed read: a good backup if any, otherwise the existing can't-convert path. Never install an empty profile from it, since that would look like all characters vanished."

**What was decided (maintainer).** A present non-list character list counts as a failed read: a good backup if one exists, otherwise the existing can't-convert path. An empty profile is never installed from it. The scope of the missing-list case is set by `MC-557` 1.

### MC-550 — Lane G, 2026-10-25: CHORE-02, `toSave.chat` stays in the code; the record is corrected and CHORE-02 closes as kept

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`. The facts come from an `investigator` packet (in-session report, not saved; TRACED/OBSERVED at `efcf63634`). Scratch: `%TEMP%\risu-lane-g\batch3\mc-source.md`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: the Roadmap entry called `toSave.chat` dead plumbing. It is not fully dead. The encoder and the store2 save loop never read it, but the failed-save merge-back and the save-pass meter both read it. Removing it would touch about 8 save-side files and about 80 test fixtures for a tiny saving.
- Alternative rejected: "Remove it".
- Related: `MC-175`, `MC-011`, CHORE-02.
- Facts, TRACED/OBSERVED at `efcf63634` (investigator packet, not independently verified): the type `toSaveType.chat` is in `risuSave.ts`. Its only populate site is the "6b-front" effect in `dbChangeEffects.svelte.ts`. It is trimmed in `globalApi.svelte.ts` and `store2/saveLoop.ts` and copied by `takeStore2Snapshot`. Its readers are `globalApi` `mergeUnsavedChanges` (merge-back after a failed save) and `store2/savePassMeter.ts` `peekSaveMarks` (a measurement counter). Chat mutations dirty the character through `tracker.character`, independent of `.chat`. The line numbers in the Roadmap-parked entry are stale.

**The maintainer's answer.** To "CHORE-02: toSave.chat is not fully dead. The encoder never uses it, but the failed-save merge-back and the save-pass meter still read it. Removing it touches about 8 save-side files and ~80 test fixtures, all for a tiny saving. What should happen?": "Keep, fix the record (Recommended)". The option read: "Leave the code. Close CHORE-02 with the corrected facts and current file locations, so it no longer looks like a pending cleanup."

**What was decided (maintainer).** The code stays. CHORE-02 closes with the corrected facts and current file locations.

### MC-551 — Lane G, 2026-10-25: CHORE-107, `openWriter` moves inside the `try` in piece-by-piece asset saving, with a reproducer

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`. The source of the ticket is commit `1e71c45c5` (2026-10-06) and `Agents/Reports/60-large-data-import-export-record.md` ("openWriter inside the try (O2 of the hashing review; CHORE-107)"). The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: if opening the writer throws, a busy counter leaks for the rest of the session. Today's keys cannot trigger it, so the defect is latent. Lane G asked whether to fix it now, as a small save-adjacent change.
- Alternative rejected: "Close as latent".
- Related: `MC-500` (per-commit approval for persistence), CHORE-107.

**The maintainer's answer.** To "CHORE-107 is real but latent: in piece-by-piece asset saving, if opening the writer ever throws, a busy counter leaks for the rest of the session. Today's keys can't trigger it. Should I fix it now (small, save-adjacent, opus-reviewer, your approval before commit)?": "Fix it (Recommended)". The option read: "Move openWriter inside the try with a guard so cleanup always runs, plus a reproducer test using a throwing fake store."

**What was decided (maintainer).** `openWriter` moves inside the `try` with a guard, so cleanup always runs. A reproducer uses a throwing fake store. The commit needs the maintainer's per-commit approval (`MC-558` 2).

### MC-552 — Lane G, 2026-10-25: CHORE-393, the `.bin` export re-ids a character whose id collides with an upstream data block, in the exported copy only

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`. The investigator packet is `%TEMP%\risu-lane-g\batch3\c393\result.md`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: a full `.bin` export refuses when a character's id is exactly `kv:<name>` and the save also holds an upstream data namespace `<name>`. That needs a hand-made or plugin-written id plus that exact namespace, since every minted id is a uuid. The live save is unaffected. The export already re-ids reserved and over-long ids, and this fits that path.
- Alternatives rejected: "Re-id any kv: id"; "Leave it".
- Related: `MC-175`, `MC-223` (the one allowed export exception), `MC-546` 3, `MC-556`, CHORE-393.

**The maintainer's answer.** To "CHORE-393: a full .bin export refuses when a character's id is exactly "kv:<name>" and the save also holds an upstream data namespace <name>. It needs a hand-made or plugin-written id plus that exact namespace; all minted ids are uuids. The live save is unaffected. How should export handle it?": "Re-id on collision (Recommended)". The option read: "Only in the exported copy, give that one character a fresh id, as export already does for reserved or over-long ids. Order, folders, groups, loadouts and message authors are remapped by the existing code. Same "ids replaced" notice, no new text. The live save and import are unchanged."

**What was decided (maintainer).** In the exported copy only, a character whose id collides with an upstream data block is given a fresh id, through the existing re-id path and notice. The live save and import are unchanged.

### MC-553 — Lane G, 2026-10-25: CHORE-391 plan questions, round 1 (missing list, unreadable presets, character with no chats, the new "Chats" label)

- Tag: decisions (maintainer's `AskUserQuestion` answers by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`; the CHORE-391 plan round 1, `%TEMP%\risu-lane-g\batch3\c391\`. The question and option texts are lane G's wording, quoted below.
- Reasoning: `MC-548` and `MC-549` left four sub-cases open. Question 1's premise (a real save always has a character list) was wrong for upstream's block format, and `MC-557` 1 corrects it.
- Alternatives rejected: not recorded as options in `mc-source.md`; TODO(evidence).

**The maintainer's answers.**
1. To "CHORE-391: an older save whose character list is missing or null (not just malformed) probably also converts into an empty profile today. Treat it like the malformed case?": "Refuse it too (Recommended)". The option read: "A failed read, same as a non-list: a good backup if any, otherwise can't convert. A real save always has the list, even if empty, so this only blocks a damaged file." The premise is wrong for block-format saves; `MC-557` 1 corrects it.
2. To "If every preset in the list is unreadable and all get dropped, what should the converted save get?": "Default preset (Recommended)". The option read: "Same as a missing preset list (MC-544): the converted copy gets the Default preset, and "Presets" is named among the dropped parts."
3. To "If all of a character's chats are unreadable and dropped, the character would have no chats left. What should conversion do?": "Add one new empty chat (Recommended)". The option read: "Keep the character usable, the way a new character starts with one chat. The dropped chats are named on the confirm screen and stay in the old file."
4. To "Dropped chats and messages need a name on the "Convert without these parts" screen. Add a new label, or reuse the generic one?": "New "Chats" label (Recommended)". The option read: "One new English string, "Chats that could not be read". The Translator adds the other six locales later. Until then those locales show the English text."

**What was decided (maintainer).**
1. The missing or null list rule is set by `MC-557` 1 (older msgpack format only).
2. Every preset dropped: the converted copy gets the Default preset, and "Presets" is named.
3. A character left with no chats gets one new empty chat. The dropped chats are named and stay in the old file.
4. A new label kind, `chats`, reads "Chats that could not be read". The Translator adds the other locales (`MC-058`).

### MC-554 — Lane G, 2026-10-25: CHORE-189, name the real plugin key of an unreadable plugin storage entry, stable across retries

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`; the CHORE-189/190 plan and sizing packet `%TEMP%\risu-lane-g\batch3\c189-190\result.md`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: the sizing found CHORE-189 narrower than recorded. Only an older save with a corrupted (non-JSON) small plugin entry is affected, on the page import with a peer-tab conflict. The prompt says "_coldpluginIndex" instead of the plugin's name and asks one extra time. No data is lost. The fix is about 15 lines in the store2 legacy path, with no new text.
- Alternative rejected: "Leave open, low".
- Related: `MC-091`, `MC-058` (no new text), CHORE-189.

**The maintainer's answer.** To "CHORE-189 is narrower than recorded. Only an older save with a corrupted (non-JSON) small plugin entry is affected, on the page import with a peer-tab conflict. The prompt says "_coldpluginIndex" instead of the plugin's name and asks one extra time. No data is lost. The fix is about 15 lines in the store2 legacy path, with no new text. Fix it now?": "Fix it now (Recommended)". The option read: "Name the real plugin key and keep it stable across retries. opus-reviewer, and your approval before commit."

**What was decided (maintainer).** The real plugin key is named, and it stays stable across retries. The commit needs `opus-reviewer` and the maintainer's per-commit approval.

### MC-555 — Lane G, 2026-10-25: CHORE-190, four sized items: N4 and keys()/length() after clear() close as accepted; the m4 test is added; E8 is fixed

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`; the CHORE-189/190 sizing packet `%TEMP%\risu-lane-g\batch3\c189-190\result.md`. The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: the sizing of CHORE-190's four items found: N4, extra re-encode work with no loss, where a fix costs about what it saves; keys()/length() after clear(), reachable only through the V2 plugin API, which has no live caller; E8, a one-microtask race that could drop one brand-new plugin value, practically unreachable; m4, a test gap, not a defect.
- Alternative rejected: the recommended option, which closes E8 as accepted.
- Related: `MC-091`, CHORE-190.

**The maintainer's answer.** To "CHORE-190's four items, as sized: N4 (extra re-encode work, no loss, and a fix costs about what it saves), keys()/length() after clear() (V2 plugin API only, which has no live caller), E8 (a one-microtask race that could drop one brand-new plugin value, practically unreachable), m4 (a test gap, not a defect). What should happen?": "Also fix E8". The option read: "As above, and also reorder E8's write so the value and its mapping land in the same tick (about 10 lines plus an interleave test, opus-reviewer)." "As above" is the recommended option: "Close N4 and keys()/length() as accepted. Add the one missing test for m4. Close E8 as accepted, noting it would be reopened if plugin calls ever share a tick."

**What was decided (maintainer).** N4 and keys()/length() after clear() close as accepted. The one missing m4 test is added. E8 is fixed: the value and its mapping are written in the same tick, with an interleave test and `opus-reviewer` review.

### MC-556 — Lane G, 2026-10-25: CHORE-393 Gate 1 amendment 5, an archived older-format character whose ids collide is exported under a fresh id and is not re-attachable on re-import; accepted and disclosed

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`; the CHORE-393 Gate 1 review `%TEMP%\risu-lane-g\batch3\c393\review\gate1.md` (amendment 5). The answer and option label are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: a character archived in the older format whose id collides is given a fresh id in the exported `.bin`. Its archived chats are still written, but on re-import the fork cannot attach them to the renamed character. The export shows its existing "cannot be restored" notice. Reserved ids are handled the same way today.
- Alternative rejected: "Inline it instead".
- Related: `MC-552`, `MC-223`, CHORE-393.

**The maintainer's answer.** To "CHORE-393 edge: a character archived in the older format whose id collides (e.g. "kv:foo" plus namespace "foo") gets a fresh id in the exported .bin. Its archived chats are still written, but on re-import the fork can't attach them to the renamed character, and the export shows its existing "cannot be restored" notice. Reserved ids are handled the same way today. Accept that?": "Accept, disclose it (Recommended)". The option read: "Same as reserved ids. Needs a hand-made id, a matching upstream namespace and an old-format archive, all at once. Recorded in the decision and the commit message."

**What was decided (maintainer).** The edge is accepted. It is disclosed in this decision and in the CHORE-393 commit message.

### MC-557 — Lane G, 2026-10-25: CHORE-391 after the Gate 1 round 1 REJECT, four corrections and additions to `MC-553`

- Tag: decisions (maintainer's `AskUserQuestion` answers by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`; the CHORE-391 Gate 1 round 1 verdict `%TEMP%\risu-lane-g\batch3\c391\review\gate1.md` (`opus-reviewer`, `[REJECT]`). The answers and option labels are the maintainer's; the question and option texts are lane G's wording, quoted below.
- Reasoning: the Gate 1 reviewer showed that the missing-list premise of `MC-553` 1 is wrong for upstream's block format. A save with zero characters has no list at all and converts fine today. Questions 2 to 4 settle how archived (cold) faults, the summary line and a leftover crash are handled.
- Alternatives rejected: not recorded as options in `mc-source.md`; TODO(evidence). Q2's question text describes a second question after conversion starts.

**The maintainer's answers.**
1. To "Correction to an earlier answer: I said a real save always has a character list. That's wrong for upstream's current (block) format: a save with zero characters has no list at all, and converts fine today. Should the "refuse missing list" rule apply only to the older msgpack format, where a missing list really means damage?": "Older format only (Recommended)". The option read: "Refuse a missing/null list only in old msgpack saves. Upstream block saves with zero characters keep converting normally. A malformed (non-list) value is still refused in both formats."
2. To "Some bad chats or messages sit inside archived (cold) character data, which is only read after the confirm screen. Dropping and naming them individually needs a second question after conversion starts. How should a bad archived unit be handled?": "Treat unit as unreadable (Recommended)". The option read: "Reuse the existing "some data is incomplete" question that already covers missing archived units: that character's archived data is named there and left out of the copy. No new text, and the old file is unchanged."
3. To "When chats are dropped from several characters, how should the confirm screen list them?": "One "Chats" line (Recommended)". The option read: "A single "Chats that could not be read" entry, however many characters it affects. Uses the one new string already approved."
4. To "Some damage can still crash conversion even after this fix, e.g. hand-made bytes with huge numbers or cycles. Should a leftover crash become a blocked "can't convert this file" screen instead of an error at boot?": "Yes, add the net (Recommended)". The option read: "Any leftover conversion error goes to the existing can't-convert path: a good backup if any, otherwise the blocked screen. Nothing is written."

**What was decided (maintainer).**
1. The refusal of a missing or null character list applies only to the older msgpack format. A block-format save with no list converts as today. A present non-list value is refused in both formats.
2. A fault inside an archived (cold) unit makes that unit unreadable, through the existing incomplete-data question. No new text. The old file is unchanged.
3. Dropped chats from several characters are listed as one "Chats that could not be read" entry.
4. A leftover conversion error goes to the existing can't-convert path: a good backup if one exists, otherwise the blocked screen. Nothing is written.

### MC-558 — Lane G, 2026-10-25: commit approvals under `MC-500`: CHORE-191 and CHORE-208 committed with localeParity red for six locales; CHORE-107 and CHORE-393 approved per commit; CHORE-210 committed too

- Tag: approval (maintainer's `AskUserQuestion` answers by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`. Test counts: `%TEMP%\risu-lane-g\batch3\full1\` and `full2\` (see the batch 3 handoff). The answers and option labels are the maintainer's; the question texts are lane G's wording, quoted below.
- Reasoning: CHORE-191 and CHORE-208 change English strings, so six locale-parity checks stay red until the Translator updates ko, cn, zh-Hant, vi, de and es on main. Earlier lanes recorded the same expected failure. CHORE-107 and CHORE-393 are save-path commits and need per-commit approval under `MC-500`.
- Alternatives rejected: not recorded in `mc-source.md`; TODO(evidence).
- Related: `MC-500`, `MC-058`, `MC-548` to `MC-557`.

**The maintainer's answers.**
1. To "Commit CHORE-191 and CHORE-208 now? Both passed Gate 2. Full test: 22,344 pass; the only failures are the 6 locale-parity checks these English changes cause until the Translator updates ko/cn/zh-Hant/vi/de/es on main (earlier lanes recorded the same expected failure). Check and build pass.": "Commit, parity noted (Recommended)". The option read: "Two commits on worktree-Lane-G. Each message says localeParity stays red for the six locales until lane A's Translator commit. The locale work goes on the fold-in list."
2. To "Per-commit approval (MC-500) for the two save-path commits, each Gate 2 APPROVE by opus-reviewer: CHORE-107 (...) and CHORE-393 (...). Approve?": "Approve both (Recommended)". The option read: "Commit each as its own commit on worktree-Lane-G. CHORE-210 (test-only, green) is committed too."

**What was decided (maintainer).** CHORE-191 and CHORE-208 are committed on `worktree-Lane-G` with localeParity red for six locales until lane A's Translator commit. CHORE-107 and CHORE-393 are approved, each as its own commit. CHORE-210 is committed too.

### MC-559 — Lane G, 2026-10-25: commit approvals under `MC-500`: CHORE-189, CHORE-190 and CHORE-391 stage 1 approved together; CHORE-391 stage 2 approved on its own

- Tag: approval (maintainer's `AskUserQuestion` answers by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `c81da7a4-dfe0-43d6-8c18-a15d4ddd2a9a`. Scratch: `%TEMP%\risu-lane-g\batch3\mc-source.md` and `decisions.md`. Test counts: `%TEMP%\risu-lane-g\batch3\full2\` (question 1) and `full3\` (question 2). The answers and option labels are the maintainer's; the question texts are lane G's wording, quoted below.
- Reasoning: CHORE-189, CHORE-190 and CHORE-391 are save-path changes and need per-commit approval under `MC-500`. Question 2 asks for stage 2 separately, after its Gate 2 REJECT and EDITORIAL rounds. Stage 2 adds the English string `store2Boot.skippedChats`, so localeParity stays red for the six locales as it does for CHORE-191 and CHORE-208 (`MC-558`).
- Alternatives rejected: not recorded as options in `mc-source.md`; TODO(evidence).
- Related: `MC-500`, `MC-558`, `MC-548` to `MC-557`, `MC-058`.

**The maintainer's answers.**
1. To "Per-commit approval (MC-500) for three save-path commits. Each passed opus Gate 2 (EDITORIAL, labels fixed). Full checks on this tree: check and build pass; test 22,918 pass, only the 6 known locale-parity failures from 191/208. CHORE-189 (name the real plugin key, asked once on retry), CHORE-190 (plugin value and mapping written in one tick), CHORE-391 stage 1 (malformed older saves are refused, a backup is offered, or the blocked screen shows instead of a crash; naming and dropping parts is stage 2). Approve?": "Approve all three (Recommended)". No option text is recorded in `mc-source.md`.
2. To "Commit CHORE-391 stage 2 on worktree-Lane-G? Gate 2 ended EDITORIAL after one REJECT. pnpm check and pnpm build pass. Full pnpm test fails only the six localeParity locale cases (23153 passed). The message is in %TEMP%\risu-lane-g\batch3\commit\msg-391s2.txt.": "Approve commit (Recommended)". The option read: "Commit the 12 stage 2 files with the verified message. The .snap file is not included. Records and the lane A hand-back come next."

**What was decided (maintainer).**
1. CHORE-189 (`1db54d1f8`), CHORE-190 (`4233439cb`) and CHORE-391 stage 1 (`353b92a13`) are committed on `worktree-Lane-G`, each as its own commit.
2. CHORE-391 stage 2 (`3dfcedf06`) is committed on `worktree-Lane-G` with localeParity red for the six locales until lane A's Translator commit.

## Batch 3 CHORE changes

### CHORE-191 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `0fe50f3f1`, technically accepted; merge pending.** The English `language.errors.chatParseFailed` text no longer ends with a stray ", ". English only. Gate 2 APPROVE by `adversarial-reviewer` (`%TEMP%\risu-lane-g\batch3\c191-208\gate2\verdict.md`; reported in the gates summary, not reread here). Locale follow-up (see the fold-in list): the other locales still carry `, {stack}`; the caller passes `stack: ''`, so they render as before. The commit `0fe50f3f1` is the batch 3 commit list's entry; the commit message is `%TEMP%\risu-lane-g\batch3\commit\msg-191.txt`.

### CHORE-208 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `4d9c34499`, technically accepted; merge pending.** "Request timed out", the native fetch timeout error from CHORE-164, uses a new English key `language.errors.requestTimedOut`. The test assertion is a wiring guard, not a behavioural reproducer. Gate 2 APPROVE by `adversarial-reviewer`, the same review as CHORE-191 (`%TEMP%\risu-lane-g\batch3\c191-208\gate2\verdict.md`). Locale follow-up: missing in the six locales, so they fall back to English until the Translator adds it (`MC-058`).

### CHORE-210 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `376ca6db1`, technically accepted; merge pending.** Test-only. The `manualCleanup.svelte.test.ts` failure under load is isolated. The mechanism, per the `376ca6db1` commit message: setup() resets modules and imports the heavy globalApi graph inside the timed body, so the first cold transform is charged to a timed test; the fix warms the graph at collection. Under a slow harness that models the cold load (not real full-suite timing), the previous file failed in all 4 slow runs (4 to 6 timeouts of 292); the fixed file passed 292 of 292 in 3 runs plus the reviewer's. The plain base run, with no delay, passes, so the fix is demonstrated only under the modelled cold load (`%TEMP%\risu-lane-g\batch3\c210\gate2\verdict.md`). Not reproduced: the one-off missing `risuChatParser` parser-mock error. TODO(evidence): it may be a separate cross-file mock issue. See the residual list.

### CHORE-107 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `79cac1241`, technically accepted; merge pending.** `openWriter` runs inside the `try` with a guard, so the busy mark is released when opening the piece writer fails (`MC-551`). The reproducer is red on the base (`expected 1 to be +0`). Gate 2 APPROVE by `opus-reviewer` (`%TEMP%\risu-lane-g\batch3\c107\gate2\verdict.md`). Residual: a Gate 2 nit, a test comment that says "start it as the save would", which is inexact. Proposed wording: "as a caller that already read from it would". Recorded as a residual, not a new ticket.

### CHORE-393 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `6ba956c5c`, technically accepted; merge pending.** The export re-ids a character whose id collides with an upstream data block (`kv:` plus a namespace), in the exported copy only (`MC-552`). The live save and import are unchanged. Gate 1 APPROVE with amendments 1 to 10 (`%TEMP%\risu-lane-g\batch3\c393\review\gate1.md`); Gate 2 APPROVE by `opus-reviewer` (`%TEMP%\risu-lane-g\batch3\c393\gate2\verdict.md`). 14 base reproducers fail: 12 export reproducers with the real writer error, 2 unit reproducers by assertion. Disclosure: `MC-556` (archived older-format chats of a re-id'd character are written but not re-attachable on re-import). The implementer's "12 failing" both-sites mutant claim is not repeated: the precise both-sites mutant fails 2, one per export (Gate 2 reviewer). Residual: message authors inside archived chat units are not remapped, the same as the reserved-id path (the `MC-556` consequence).

### CHORE-189 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `1db54d1f8`, technically accepted; merge pending.** The unreadable plugin storage entry is named by its real plugin key, and the key is stable across retries (`MC-554`). Gate 1 REJECT with amendments, applied; Gate 2 [EDITORIAL] (`opus-reviewer`; the guard label corrected) (`%TEMP%\risu-lane-g\batch3\c189-190\gate2\verdict.md`). Residual: no test pins the `backuplocal` call line (the `mutWire` mutant survives). Recorded as a residual, not a new ticket.

### CHORE-190 — status update for the Roadmap entry

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in `4233439cb`, technically accepted; merge pending.** E8 is fixed: the value and its mapping are written in one tick (`MC-555`). The N4 and keys()/length()-after-clear items are closed as accepted (`MC-555`). The m4 test gap is covered by the one added test. Gate 1 REJECT with amendments, applied; Gate 2 [EDITORIAL] (`opus-reviewer`, shared verdict with CHORE-189) (`%TEMP%\risu-lane-g\batch3\c189-190\gate2\verdict.md`).

### CHORE-02 — COMPLETE (closed as kept, 2026-10-25, `MC-550`)

- The code stays. The record is corrected: `toSave.chat` is read by the failed-save merge-back (`globalApi.svelte.ts` `mergeUnsavedChanges`) and the save-pass meter (`store2/savePassMeter.ts` `peekSaveMarks`); the encoder and the store2 save loop never read it.
- The Roadmap-parked line numbers are stale; the file locations above are current at `efcf63634` (investigator, TRACED/OBSERVED; the two readers, `mergeUnsavedChanges` and `peekSaveMarks`, were confirmed in source by the batch 3 records doc-verifier). The Roadmap rows that still call it dead plumbing are lane A's to update at merge.

### CHORE-391 — status update: fixed on the branch (both stages); merge pending

**Status (2026-10-25, lane G): fixed on `worktree-Lane-G` in two commits, both technically accepted; merge pending. Stage 1 is `353b92a13`; stage 2 is `3dfcedf06`.**

- Stage 1 (`MC-548`, `MC-549`, `MC-557`): a pure detector (`legacy/faults.ts`) finds the malformed parts. The strict read counts a file with any such part as not decoded, so a good backup is offered. An older-format save with no characters list is refused; a block-format save with no list still converts. A safety net around the whole-tree install turns any remaining codec error into the existing can't-convert result, with nothing written. Gate 1 REJECT, then APPROVE with amendments (`opus-reviewer`); Gate 2 EDITORIAL (`opus-reviewer`), test labels corrected. Full checks: see the batch 3 test status.
- Stage 2 (`3dfcedf06`; `MC-549`, `MC-553`, `MC-557`; commit approved under `MC-559` 2): "Convert without these parts" on an older-format save now converts the save and leaves out exactly the parts it names. Source: the commit message of `3dfcedf06`, checked against the Gate 2 verdicts.
  - A malformed preset, module, plugin, chat or message is dropped the way presets already were. The selected preset and the selected chat are remapped to the kept lists. If the selected preset was dropped, `botPresetsId` points one past the last kept preset. If every preset is dropped, the Default preset is installed. A dropped selected chat falls to the last kept chat. `fmIndex` is never changed.
  - A character whose chats are all dropped gets one new empty chat. A character slot that is not an object is skipped and named.
  - The skipped list names one entry per kind and one per skipped character slot, and does not name again a block the salvage already named. Malformed chats appear on one new "Chats" line, the new English key `store2Boot.skippedChats` ("Chats that could not be read").
  - A present non-list `characters` is still refused, in the older format and, on this path, in the block format; a block-format save with no `characters` list still converts.
  - The drop (`dropLegacyFaults`) builds a new tree and never changes the decoded one. During conversion a cold unit whose chats are malformed is treated as unreadable (resolve's `faultyUnitsUnusable` option); the `.bin` import does not pass that option and is unchanged.
- Stage 2 tests (commit message; reproduced by the Gate 2 round 1 reviewer on the stage 1 code): 119 new behaviour tests fail by assertion (110 `legacyConvertFaults`, 6 `legacyResolve`, 2 `legacyLenient`, 1 `bootText`). The reviewer's base run was 281 failed of 1027, with 75 of those TypeErrors from missing exports and 206 assertion failures. The block-format `characters` reproducer added after Gate 2 round 1 failed by assertion on the pre-remediation code (round 2 mutant P0: 2 of 1454 failed, both by assertion).
- Gates, CHORE-391 as a whole: Gate 1 (plan, both stages) `[REJECT]` and then APPROVE with amendments (`opus-reviewer`). Stage 2 Gate 2 round 1 `[REJECT]` (`opus-reviewer`; `%TEMP%\risu-lane-g\batch3\c391\gate2-s2\verdict.md`):
  - F1: the check that refuses a present non-list `characters` was left out of the block-format branch of the lenient decoder, on a claim that the shape cannot occur. A root block carrying `characters` as a string or an object does decode to that. "Convert without these parts" then installed an empty profile and named nothing, against `MC-549` and `MC-557` 1. The strict path was already correct. Not a regression against the stage 1 code.
  - F2: the salvage test said a salvage entry and a detector fault "of one kind are one entry" but used two different kinds, so the mutant Y5 survived (0 of 987 failed).
  - E1 (editorial): "all mutants killed" was inexact, see the residuals.
  - Remediation: the lenient decoder's block-format branch now throws `LegacyDecodeError` for a present non-list `characters` (a missing list is still accepted); a new reproducer for the string and object cases; the salvage test uses a corrupt `plugins` block plus a root `pluginV2` string.
  - Gate 2 round 2 `[EDITORIAL]` (fresh `opus-reviewer`, seeded with the round 1 verdict; `%TEMP%\risu-lane-g\batch3\c391\gate2-s2r2\verdict.md`): F1 and F2 closed, with the red/green and mutant evidence rerun (Y5 now killed, 1 of 1454). E2: the `LegacyDecodeError` doc comment no longer matched where it is thrown; fixed in `3dfcedf06` (the commit message says a doc comment was corrected). Round 2 targeted tests: 19 files, 1393 of 1393 passed; `pnpm check` 0 errors and 0 warnings.
- Full checks: the final snapshot is `353b92a13` plus the stage 2 diff (the content committed as `3dfcedf06`): see the batch 3 test status.
- Residuals, none opened as a ticket (`plan-r2.md` section 8, the Gate 1 round 2 review and the two Gate 2 verdicts):
  - A10: a `.bin` import of these malformed shapes still refuses them as `unsavable`. That is loud and unchanged (`MC-223`).
  - Mh: the mutant "chat page reset when only a message is dropped" is equivalent, not killed. With no chat dropped the remap is the identity (Gate 2 round 1, E1). The commit message already says so.
  - O1 (Gate 2 round 1, optional, not taken up): `convertDecoded` drops by recomputing the faults, not from the list the person confirmed. Agreement depends on `decoders.lenient` being `decodeLegacyLenient`, which the default decoders guarantee and a parity test proves. An injected lenient decoder, a test seam only, could drop silently. The reviewer suggested a one-line comment at the drop site.
  - O2 (Gate 2 round 2, optional, not taken up): a `ROOT_COMPONENT` block with key `characters` and value `null` replaces a list the character blocks already built (`risuSave.ts`). Pre-existing, needs crafted bytes, and is outside this ticket's stated shapes. The reviewer: record it only if the maintainer wants it.
  - Two salvaged blocks of the same kind still appear as two entries; salvage entries are kept verbatim. Pre-existing behaviour kept (Gate 2 round 1, deviation 1, accepted). The reviewer notes that only the `other` and `character` kinds can repeat within the salvage list.

## Batch 3 ledger rows

None. Batches 1 and 2 have no ledger-row block either (batch 1 says "None yet."). Ledger rows start at 3900 and none are used.

## Batch 3 residuals

Recorded in the status lines above. Proposed new CHORE IDs: none (CHORE-394 stays free). A residual becomes a new CHORE only if the parent decides it is real work.

- CHORE-107: the inexact test comment (Gate 2 nit).
- CHORE-189: no test pins the `backuplocal` call line.
- CHORE-210: the one-off `risuChatParser` parser-mock error was not reproduced; possibly a separate cross-file mock issue. TODO(evidence).
- CHORE-393: message authors inside archived chat units are not remapped (`MC-556`).
- CHORE-391: A10 (a `.bin` import of these shapes stays `unsavable`, `MC-223`); Mh (equivalent mutant, not killed); O1 (no comment at the drop site naming the `decoders.lenient` coupling); O2 (`ROOT_COMPONENT` `characters: null` overwriting a built list, pre-existing, crafted bytes only); two salvaged blocks of the same kind still appear as two entries (pre-existing). Details in the CHORE-391 status above.

## Batch 3 fold-in list

- The commits: `0fe50f3f1` (CHORE-191), `4d9c34499` (CHORE-208), `376ca6db1` (CHORE-210), `79cac1241` (CHORE-107), `6ba956c5c` (CHORE-393), `1db54d1f8` (CHORE-189), `4233439cb` (CHORE-190), `353b92a13` (CHORE-391 stage 1), `3dfcedf06` (CHORE-391 stage 2). Then this records file.
- Translator work on main, for ko, cn, zh-Hant, vi, de and es:
  - remove ", {stack}" from `errors.chatParseFailed` (optional cosmetic; the English text no longer has it);
  - add `errors.requestTimedOut` (`MC-058`);
  - add `store2Boot.skippedChats` ("Chats that could not be read"; CHORE-391 stage 2).
- `localeParity` stays red until the Translator's commit on main (`MC-558`, `MC-559` 2).
- MC-548 to MC-559.
- CHORE status changes: CHORE-191, 208, 210, 107, 393, 189, 190 and 391 (both stages) fixed on the branch (merge pending); CHORE-190's N4 and keys()/length() items closed as accepted; CHORE-02 COMPLETE (closed as kept).
- New tickets: none. The residuals above are not tickets. Lane G's MC block (540 to 559) is exhausted; the next MC needs a new block from lane A. Next free: CHORE-394, ledger row 3900.

## Batch 3 test status

Full checks, read from the logs and exit files in `%TEMP%\risu-lane-g\batch3\full1\`, `full2\` and `full3\` (`test.log`, `check.log`, `build.log`, `exit.txt` or `exits.txt`, `head.txt`, `status.txt`). Each run's snapshot is the HEAD in `head.txt` plus the uncommitted changes in `status.txt`.

- full1 (HEAD `31b050a63` plus the uncommitted changes of CHORE-191, 208, 210, 107 and 393, 11 modified files): `pnpm test` exit 1, 22,344 tests passed, 6 failed, 23 skipped; 1,004 of 1,006 files passed, 1 skipped. `pnpm check` exit 0, 0 errors and 0 warnings. `pnpm build` exit 0.
- full2 (HEAD `6ba956c5c` plus the uncommitted changes of CHORE-189, 190 and 391 stage 1; it also lists the `.snap` file as modified): `pnpm test` exit 1, 22,918 passed, 6 failed, 23 skipped; 1,006 of 1,008 files passed. `pnpm check` exit 0, 0 errors and 0 warnings. `pnpm build` exit 0. This run predates four test-title-only relabels to "unit:" (the `353b92a13` commit message); the two files rerun after them pass.
- full3 (final snapshot: HEAD `353b92a13` plus the uncommitted CHORE-391 stage 2 diff, 12 source and test files plus the modified, uncommitted `.snap`; the 3dfcedf06 file list matches those 12 files and no other source diff remains (doc-verifier); the stage 2 diff is the content committed as `3dfcedf06`, per the commit message and the brief; the run itself did not check out `3dfcedf06`): `pnpm test` exit 1, 23,153 passed, 6 failed, 23 skipped (23,182 total); 1,006 of 1,008 files passed, 1 skipped. `pnpm check` exit 0, 0 errors and 0 warnings. `pnpm build` exit 0.
- In all three runs the only failing file is `src/lang/localeParity.test.ts`, with 6 failed tests, one per locale (ko, cn, zh-Hant, vi, de, es).
  - In full1 and full2 the logs name `errors.requestTimedOut` (missing, from CHORE-208) and an `errors.chatParseFailed` placeholder mismatch (the locales still carry `{stack}`; from CHORE-191).
  - In full3 the logs also name `store2Boot.skippedChats` (missing, from CHORE-391 stage 2).
- The `.snap` file `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` shows as modified in full2 and full3 and in the session's git status; it is not part of any batch 3 commit (`MC-559` 2). Its change is not examined here.
- Not run: the full suite on the committed `3dfcedf06` tree itself.

## Batch 3 handoff

- 2026-10-25: scope confirmed (8 tickets, in brief order). Branch fast-forwarded from `efcf63634` to main `31b050a63`, before the batch 3 commits.
- 2026-10-25: commits on `worktree-Lane-G`, in order: `0fe50f3f1` (CHORE-191), `4d9c34499` (CHORE-208), `376ca6db1` (CHORE-210), `79cac1241` (CHORE-107), `6ba956c5c` (CHORE-393), `1db54d1f8` (CHORE-189), `4233439cb` (CHORE-190), `353b92a13` (CHORE-391 stage 1), `3dfcedf06` (CHORE-391 stage 2). Not pushed.
- **CHORE-391 is done on the branch (both stages), merge pending.** Stage 2 Gate 2 ended `[EDITORIAL]` after one `[REJECT]`; the final full run is full3 above. `localeParity` is red for the six locales until the Translator's commit on main.
- Open: no product question is open (the stage 2 part-name and label choices are settled by `MC-548` to `MC-553` and `MC-557`).
- Pushing the branch needs the maintainer's approval. Merging is lane A's job.

# Batch 4 (from 2026-10-25): L3 track G, the streamed `.bin` export (CHORE-205 stages A1 and A2)

Scope: `Agents/Lanes/L3-plan.md` stages A1 and A2, with editorial E7; decisions `MC-496` 5, `MC-497`, `MC-499` 1, `MC-175`, `MC-223`. Starting revision: `worktree-Lane-G` fast-forwarded from `ffa776c5d` to main `76e9d03b8` (`git rev-parse HEAD` after the fast-forward). Integration: lane B; lane A merges to `main`.

## Batch 4 MC entries

### MC-560 — Lane G, 2026-10-25: the uncommitted `modules.test.ts.snap` change stays in the worktree; the branch is fast-forwarded to main around it

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `a91b553a-f872-4106-90a7-68ac838fea5f` (batch 4). The answer and option labels are the maintainer's; the question text is lane G's wording, quoted below.
- Reasoning: `git status` lists `src/ts/process/mcp/risuaccess/tests/__snapshots__/modules.test.ts.snap` as modified, but `git diff --numstat` prints nothing for it (no content difference; index and worktree both LF). `git diff --stat ffa776c5d 76e9d03b8` touches no file under that `__snapshots__` folder, so a fast-forward leaves it as it is.
- Alternatives rejected: "You handle it first" (lane G waits for the maintainer before moving the branch).
- Related: `MC-559` 2.

**The maintainer's answer.** To "Lane-G has an uncommitted change to modules.test.ts.snap. Git shows no content difference (same bytes, LF). main doesn't touch the file, so a fast-forward to 76e9d03b8 would leave it as it is. What should I do with it?": "Leave it, fast-forward (Recommended)". The option read: "Fast-forward worktree-Lane-G to main 76e9d03b8. The .snap stays modified and is never staged. Lane G commits only named paths."

**What was decided (maintainer).** `worktree-Lane-G` is fast-forwarded to `76e9d03b8`; the `.snap` stays modified in the worktree and is never staged by lane G.

### MC-561 — Lane G, 2026-10-25: A1 gets its Gate 2 now, without stub code; the B2 stub refusal follows as a separately gated commit (adapts L3-plan E7)

- Tag: decision (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `a91b553a-f872-4106-90a7-68ac838fea5f` (batch 4). The answer and option labels are the maintainer's; the question text is lane G's wording, quoted below.
- Reasoning: E7 (`Agents/Lanes/L3-plan.md`, Gate 1 round 3 editorials) puts A1's Gate 2 after a rebase onto B2, and B2 is not yet started on lane B (lane B gave no date). A2 edits the same file, `src/ts/storage/risuSave.ts`, so building A2 on an uncommitted A1 would make the two stages one commit.
- Alternatives rejected: "Hold A1 and A2 until B2" (E7 literally, lane G idle); "Build A2 on top, one combined Gate 2" (one commit for A1+A2 after B2).
- Related: L3-plan E7 and I11; `MC-497`; CHORE-205.

**The maintainer's answer.** To "A1 is built, but under E7 its Gate 2 waits for lane B's B2, which has no date yet. A2 edits the same file (risuSave.ts), so building A2 on top of an uncommitted A1 would leave one change I can't split into two commits. How should I proceed?": "Gate 2 A1 now, refusal later (Recommended)". The option read: "Fresh opus Gate 2 on A1 as built (no stub code yet), commit it with your approval, then build A2. When B2 lands: rebase, add the one-line refusal and its test as a small follow-up commit with its own opus Gate 2, before lane B integrates. Departs from E7's wording (Gate 2 after the rebase) but keeps its intent: nothing reaches S4d without the real-marker test."

**What was decided (maintainer).** A1 is reviewed and, with commit approval, committed without stub code; A2 follows. After B2 lands, lane G rebases and adds the refusal and `parts-encoder-refuses-stub` as a separate commit with its own opus Gate 2, before lane B integrates track G.

### MC-562 — Lane G, 2026-10-25: commit approval for stage A1 (`b8e3356bb`)

- Tag: approval (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `a91b553a-f872-4106-90a7-68ac838fea5f` (batch 4). Message: `%TEMP%\risu-lane-g\l3\a1\commit-msg.txt`. Gate 2: `%TEMP%\risu-lane-g\l3\a1-gate2\result.md`; editorials: `%TEMP%\risu-lane-g\l3\a1-ed\result.md`.
- Alternatives rejected: "Not yet".
- Related: `MC-561`, `MC-500`; CHORE-205.

**The maintainer's answer.** To "Commit stage A1 on worktree-Lane-G? It covers risuSave.ts and two new test files. Gate 2 opus came back EDITORIAL, and its fixes are applied. The targeted tests pass: 6 files, 116 tests. pnpm check passes. The message is in %TEMP%\risu-lane-g\l3\a1\commit-msg.txt.": "Commit A1 (Recommended)". The option read: "Stage only the three named paths and commit with that message. The records file and the .snap are not included. No push. Then start A2."

**What was decided (maintainer).** A1 is committed on `worktree-Lane-G` as `b8e3356bb` (three named paths; not pushed).

### MC-563 — Lane G, 2026-10-25: commit approval for stage A2 (`06d22b02c`)

- Tag: approval (maintainer's `AskUserQuestion` answer by option label, 2026-10-25). Date: 2026-10-25. Sweep ref: none.
- Source: the lane G session transcript `a91b553a-f872-4106-90a7-68ac838fea5f` (batch 4). Message: `%TEMP%\risu-lane-g\l3\a2\commit-msg.txt`. Gate 2: `%TEMP%\risu-lane-g\l3\a2-gate2\result.md`; editorials: `%TEMP%\risu-lane-g\l3\a2-ed\result.md` (E1, E2 and two E3 spacing fixes by haiku-editor; the E3 comment re-wrap in `backuplocal.ts` by the orchestrator).
- Alternatives rejected: "Not yet".
- Related: `MC-497`, `MC-499` 1, `MC-561`, `MC-500`; CHORE-205.

**The maintainer's answer.** To "Commit stage A2 on worktree-Lane-G? It covers 8 paths: risuSave.ts, backuplocal.ts, 2 new tests and 4 updated tests. Gate 2 opus came back EDITORIAL, with fixes applied. fflate was checked: no data loss for any chunk size. Targeted tests and pnpm check pass. Peak export memory in one PC run: 419 MiB before, 154 MiB after. The message is in %TEMP%\risu-lane-g\l3\a2\commit-msg.txt.": "Commit A2 (Recommended)". The option read: "Stage only the 8 named paths and commit. The records file and the .snap are left out. No push. Then report to lane B (the stub-refusal follow-up still waits for B2)."

**What was decided (maintainer).** A2 is committed on `worktree-Lane-G` as `06d22b02c` (eight named paths; not pushed). The E3 comment re-wrap in `backuplocal.ts` is part of that commit.

**Correction (doc-verifier, not the maintainer's words).** The question above and the A2 commit message say fflate loses no data "for any chunk size" / "any push size". That overstates the evidence. The Gate 2 probe covered whole pushes from 65536 B to 3,000,001 B at 15 fill states (902 cases, row 3906). The committed message is left as it is.

## Batch 4 ledger rows

Same columns as `Agents/Investigation-Ledger.md`. Tokens are the subagent totals the harness reported.

| # | Date | Question | Tier(s) | Tokens | Escalated? | Outcome |
|---|---|---|---|---|---|---|
| 3900 | 2026-10-25 | L3 A1/A2 sizing: export path, msgpack splice, streamed gzip, tests | investigator | 100,102 | no | `%TEMP%\risu-lane-g\l3\sizing\result.md`. Raw input; the claims below were rechecked by rows 3901 to 3903. `dbData` is written by `writeBackup('database.risudat')` at both export sites. `writeBackupHeader` plus `write` already exist. A per-key, per-element splice equals `packr.encode` (M, msgpackr 1.10.1). Streamed gzip inflates equal (M, fflate 0.8.3). Two tests pin compressed bytes (`backuplocalCharacterIdsExport.test.ts`). |
| 3901 | 2026-10-25 | Gate 1 of the A1/A2 plan, round 1 | opus-reviewer | 173,321 | no | **`[REJECT]`**, `%TEMP%\risu-lane-g\l3\gate1-opus\result.md`. B1: per-piece encodes drop today's 4 GiB failure, and gzip's ISIZE would wrap, so an import truncates. B2: tests labelled R only because a function is missing (gates.md). B3: `toEqual` ignores undefined keys. Also: the `$state` proxy row, no chunk copy needed, output coalescing, more writer-mock tests. |
| 3902 | 2026-10-25 | Senior-advisor challenge of A2 | senior-advisor | 125,532 | no | Hand-back only. Sound; four amendments. 64 KiB input slices: fflate `Deflate.push` can grow its input buffer for a large chunk and keeps that size until the final push (the orchestrator read `Deflate.prototype.push` in `node_modules/fflate/esm/browser.js`). Row 3906 refines this: it grows only when chunk plus buffered bytes exceed 163840, so slices of at most 65536 never grow it. Output blocks of at least 1 MiB. A push/finish sink for J1. A `node:zlib` cross-check. Stay synchronous (shallow export copy). Lead: `cold.collected` payloads stay referenced (unmeasured). |
| 3903 | 2026-10-25 | Gate 1, round 2 (plan v2) | opus-reviewer (same instance, resumed) | 191,166 (cumulative) | no | **`[EDITORIAL]`**, same `result.md` (overwritten; round 1 kept as an appendix). Binding S1 to S6: size check in the sink's `push`; a `.svelte.test.ts` for `$state`; `node:zlib` does not prove one member; `Object.create` is a plain row; a spy on push sizes; the header is a fresh copy. |
| 3904 | 2026-10-25 | Gate 2 of A1 | opus-reviewer (fresh) | 118,905 | no | **`[EDITORIAL]`**, `%TEMP%\risu-lane-g\l3\a1-gate2\result.md`. Byte identity, buffer lifetime and test validity hold. 114 tests and `pnpm check` were rerun, plus 9 mutants. E1 to E4 (comments, two new test rows and a proxy assertion in the `$state` row; the coder also added a buffer-releasing encode before each `retainedAfter` baseline so an earlier row's leak cannot hide a later one) were applied by a sonnet-coder (`%TEMP%\risu-lane-g\l3\a1-ed\result.md`, 116 tests). The orchestrator reran both A1 test files (28 pass). Committed as `b8e3356bb` (`MC-562`). |
| 3905 | 2026-10-25 | A2 implementation (streamed gzip sink, `writeDatabaseEntry`) | sonnet-coder | 143,993 | no | `%TEMP%\risu-lane-g\l3\a2\result.md`. Coder's claims: 41 files and 828 tests pass, `pnpm check` clean, 8 mutants red. Three writer mocks updated (`backupSaveBusy`, `exportThisTab.svelte`, `backuplocalEncryptWriter`); four unchanged. Diagnostic D, one run on a fast PC, synthetic 300 x 500 KiB characters plus a 4.5 MiB unit: peak `arrayBuffers` delta 419 MiB legacy, 154 MiB streamed sliced, 134 MiB unsliced; wall time 3.7 s, 3.9 s and 4.1 s. Best-case hardware only. |
| 3906 | 2026-10-25 | Gate 2 of A2 | opus-reviewer (fresh) | 146,043 | no | **`[EDITORIAL]`**, `%TEMP%\risu-lane-g\l3\a2-gate2\result.md`. No blocking defect. The coder saw a large push "truncate"; the reviewer refuted it as a faulty mutant: a probe ran 902 cases, 65536 B to 3 MB pushed whole at 15 fill states, all inflating equal under fflate and `node:zlib` (M). So the 64 KiB slicing is a memory measure, not a correctness need. Six reviewer mutants and two of the coder's went red. 12 files and 224 tests pass; `pnpm check` clean. E1 to E3 were applied (the orchestrator then reran 9 files, 160 tests). E4 is a lead (see below). Committed as `06d22b02c` (`MC-563`). |

## Batch 4 leads (not tickets; for lane A or lane B to decide)

- **Import of a large streamed export (A2 Gate 2 E4, I).** The export no longer needs the whole msgpack in one buffer, but `decodeRisuSave` (fork) and upstream's `decompressSync` still inflate it into one. On a device too small to hold that buffer, an export that used to fail loudly can now succeed, and its restore then fails on that same device. Real saves are far below this so far.
- **`cold.collected` payloads (advisor, row 3902, unmeasured).** `payload.encoded` stays referenced through the database encode in both export paths. If it is large, releasing each payload after its write (as `writeStubPayloadsAndRelease` does) is a one-hunk follow-up. Passed to lane B for J1.
- **J1 must keep the no-await invariant (advisor).** `encodeDatabaseWithLateColdStorage` lists roots and encodes with no await in between. J1's async module pull has to re-establish that explicitly. Passed to lane B.

## Batch 4 handoff

- 2026-10-25: start at main `76e9d03b8` (fast-forward from `ffa776c5d`, `MC-560`).
- Commits on `worktree-Lane-G`, not pushed:
  - `b8e3356bb`: A1, parts encoder (`MC-562`).
  - `06d22b02c`: A2, streamed gzip (`MC-563`).
- **Open: the stub-refusal follow-up (`MC-561`).** When lane B's B2 lands (lane B sends its SHA and the refusal's exported name):
  1. Rebase `worktree-Lane-G` onto it.
  2. Add the one-line call in the `encodeRisuSaveParts` wrapper body.
  3. Add test `parts-encoder-refuses-stub`, including the path through `encodeRisuSaveStreamed`. Mutants: delete the line; move it inside the generator.
  4. Run a fresh opus Gate 2, then commit with approval.
  
  Lane B will not take track G for S4d until this commit exists.

  Lane B, 2026-10-26: B2 is split. B2a carries the stub marker and the callable refusal and is in Gate 1 round 2. The planned API, which may still change: a zero-import leaf, provisionally `src/ts/storage/moduleStub.ts`, with `isModuleStub(value)` and `assertNoModuleStubs(modules, where)`, which throws `ModuleStubRefusal` naming the module and `where`. The follow-up rebases on B2a's commit; lane B sends its SHA and the final names.
- Lane B, 2026-10-26: A1 and A2 merge cleanly onto main `85378dc9e` (B0, B1, CHORE-166 2A). Lane B's report: on the merged tree, the storage and drive suites pass (382 files, 11,874 tests) and `pnpm check` is clean. Lane B has asked lane A to integrate; the merge needs lane A's full checks and the maintainer's approval in lane A's session.
- Plan and gate files are in `%TEMP%\risu-lane-g\l3\` (`plan\plan.md`, `sizing\`, `gate1-opus\`, `a1\`, `a1-gate2\`, `a1-ed\`, `a2\`, `a2-gate2\`, `a2-ed\`).
- Not run here: full `pnpm test` and `pnpm build` (lane A on main); phone check P2 (after J1, through lane B and lane A). C1's parametrised export test runs on A2's writer at C1's own Gate 2 (L3-plan A2).
- Records: `MC-560` to `MC-563`, rows 3900 to 3906. CHORE-205 has no lane G status line; lane B owns the ticket. Before merge, a doc-verifier must check these records (Agents/Lanes/README.md). Next free: `MC-564`, CHORE-394, row 3907.
