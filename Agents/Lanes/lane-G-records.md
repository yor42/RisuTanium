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
