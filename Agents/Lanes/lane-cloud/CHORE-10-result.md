# CHORE-10 result (Phase 2): 21 long-term-memory items traced or reproduced, reproducers in ten test files

**Status:** proposed status for lane A to apply: all 21 items investigated with maintainer decisions (`MC-711` to `MC-715`; `MC-712` item 1 is superseded by `MC-714`). 19 items have `it.fails` / `test.fails` reproducers (HAN-1, HAN-2, V2-1 to V2-4, SHARED-2, SUPA-1 to SUPA-5, V3-1 to V3-5, TOK-1, and UI-1 for its label half only), and two items have no test (V2-5, SHARED-1). No application code changed. The reproducers are in ten new, untracked test files. Gate 2 ended `[APPROVE]` in round 3 after two substantive `[REJECT]` rounds. Short entry: [lane-cloud-records.md](../lane-cloud-records.md) (`MC-711` to `MC-715`, ledger rows 5018 to 5023 and 5028 to 5037, "For lane A: Phase 2 saved-data risks").

## Question / ticket ask

`Agents/Roadmap.md`, CHORE-10. Phase 2 (`MC-708`): for each long-term-memory item, trace, reproduce or refute; compare with upstream (`MC-069`); put product questions to the maintainer; change no application code.

## Environment

- Fork: `/home/user/RisuTanium`, branch `lane-cloud`. The investigations ran at HEAD `9ded0aa`; the tests and Gate 2 ran at HEAD `04126b6`. `git diff --stat 9ded0aa 04126b6` lists four files (the records file, `CHORE-09-result.md` and two CHORE-09 test files), so no application source differs between the two snapshots, and the investigation citations are taken as valid at `04126b6`. `git diff --stat -- src` is empty and `git status --short` shows only the ten untracked test files plus the modified records file, which carries this work's `MC-711` to `MC-715`, the "For lane A" section and the CHORE-10 ledger rows.
- Upstream: read-only clone of `kwaroran/risuai` at `f50b594`, outside the repository (`MC-069`).
- Linux container, Node v22.22.0 (investigations), Vitest 4.1.11, default `vitest.config.ts` (happy-dom). Mocks stub the database, tokenizer (character or constant counts), summarizer, embeddings and stores; results show control flow and logic, not full-app or provider behaviour.
- Sources (session scratchpad `p2/`, not repository paths):
  - Investigations and independent verifications: `c10a/result.md` + `c10a/verify/result.md` (HAN, V2, SHARED); `c10b/result.md` + `c10b/verify/result.md` (SUPA, V3-1, TOK-1, UI-1); `c10c/result.md` + `c10c/verify/result.md` (V3-2 to V3-5). Where a verify file corrects a packet, the verify file wins and the item text below follows it.
  - Tests and gates: `c10a/tw`, `c10a/g2`; `c10b/tw`, `c10b/g2` (round 1), `c10b/rem`, `c10b/g2r2` (round 2), `c10b/rem2`, `c10b/g2r3` (round 3).
  - Test titles and the `.fails` / plain counts below were read from the ten files at `04126b6` by title grep (this report's author), then reconciled with the round-3 table.

## Findings

Verdicts are the investigation's, as corrected by the verifier. Every item is UPSTREAM-SAME (verified against `f50b594` by the verify files); none is a fork-only defect. "Decision" quotes the answer recorded in the records file.

| Item | Verdict | Fork location (verified) | Test |
|---|---|---|---|
| HAN-1 | REPRODUCED | `hanuraiMemory.ts:33,37,76,83,90` | 2 `it.fails` |
| HAN-2 | TRACED | `hanuraiMemory.ts:61,72,86`; `OtherBotSettings.svelte:1064-1065`; `en.ts:1629` | 1 `it.fails` |
| V2-1 | REPRODUCED | `hypav2.ts:522-523,532,535,664`; `index.svelte.ts:1549-1560` | 1 `it.fails` |
| V2-2 | REPRODUCED (3 variants + memo sub-finding) | `hypav2.ts:449`; `index.svelte.ts:1273-1287`; `exampleMessages.ts:31-55` | 3 `it.fails` |
| V2-3 | REPRODUCED (diagnostic in the investigation) | `hypav2.ts:589-597` | 1 `it.fails` |
| V2-4 | REPRODUCED (diagnostic in the investigation) | `hypav2.ts:449-460,582,664` | 1 `it.fails` |
| V2-5 | TRACED | `hypav2.ts:314-321` | none |
| SHARED-1 | TRACED (contract violation); NOT reproduced as wrong order | `hypamemory.ts:228` | none |
| SHARED-2 | TRACED | `hypamemory.ts:222,243-249` vs `hypamemoryv2.ts:366-378` | 1 `it.fails` |
| SUPA-1 | REPRODUCED | `supaMemory.ts:108-109` vs `:136` | 1 `it.fails` |
| SUPA-2 | REPRODUCED | `supaMemory.ts:160-164` | 1 `it.fails` |
| SUPA-3 | REPRODUCED | `supaMemory.ts:113-129` (error 119, id match 122) | 2 `it.fails` (two files) |
| SUPA-4 | REPRODUCED (non-progress); practical reachability low | `supaMemory.ts:304-366` | 1 `it.fails` |
| SUPA-5 | TRACED | `supaMemory.ts:228-241`; `hypav2.ts:86-91` | 2 `test.fails.each` rows |
| V3-1 | REPRODUCED (constructor); reach into V3 TRACED | `taskRateLimiter.ts:39-41`; `hypav3.ts:393-402,638-643` | 2 `it.fails` |
| V3-2 | REPRODUCED on a replica + TRACED | `HypaV3Modal.svelte:257-262,301-313`; `hypav3.ts:224-230` (exp), `:1004-1010` (std) | 2 `it.fails` (std, exp) |
| V3-3 | TRACED | `en.ts:713-714`; `hypav3.ts:1069-1072` (std window), `:301-304` (exp) | 1 `it.fails` (std only) |
| V3-4 | REPRODUCED (V3 and V2); PERSISTENCE-RISK | `hypav3.ts:215-218,995-998,1656-1664`; `hypav2.ts:290-312,386` | 3 `it.fails` (V3 std, V3 exp, V2) |
| V3-5 | TRACED | `hypav3.ts:844` (exp), `:1508` (std) | 2 `it.fails` (std, exp) |
| TOK-1 | TRACED; clamp premise REFUTED | `hypav2.ts:371-374`; `hypav3.ts:205-206,985-986`; `index.svelte.ts:1056-1061` | 3 `it.fails` (V2, V3 std, V3 exp) |
| UI-1 | TRACED (order and label); dropdown half untested | `OtherBotSettings.svelte:1015-1019` vs `index.svelte.ts:1532/1546/1564/1589`; `Toggles.svelte:194,209` | 2 `test.fails` rows (label only) |

The `.fails` sum is 32 (the round-3 total). The per-file reconciliation is in "What changed and evidence".

### HAN-1: Hanurai prefix off by one (REPRODUCED)

- **Verified fork location:** documents are stored as `search_document: ${text}` (`hanuraiMemory.ts:33,37`). The prefix is 17 characters, but `substring(16)` is used at `:76,83,90` (3 lines; `grep -n "substring(16)"`), leaving a leading space. The in-prompt duplicate check `chat.content === ...` at `:76` therefore never matches. V2 uses a separate `prefixLength` variable (`hypav2.ts:604-636`), so V2 has no off-by-one.
- **Observed (executed):** 8 chats; memory block `" message number 0\n\n message number 1\n\n ... message number 4"`; the prompt still held messages 0 to 7; 5 duplicated; assertion `expected 5 to be +0` fails.
- **Upstream: UPSTREAM-SAME** (`hanuraiMemory.ts` has a 0-line diff; upstream `:76,83,90,33,37`).
- **Corrections applied (verifier):** the effect is "every retrieved message still in the prompt is duplicated", not "every request, regardless of fill state". The packet's claim that split mode "can never match even with `substring(17)`" is OVERSTATED: a single-fragment message can match after a fix; multi-paragraph or untrimmed messages cannot, because non-split mode stores `trim()` while `:76` compares untrimmed content. A one-character fix is therefore insufficient for those messages (inference, not executed).
- **Decision, `MC-713` 4:** "Fix HAN-1; cap at Chunk Size (Recommended)". The option said: fix the prefix and compare trimmed text, so in-prompt messages are not duplicated; and bound retrieval by Chunk Size.
- **Tests** (`src/ts/process/memory/hanuraiMemory.test.ts`):
  - `guard: messages trimmed out of the prompt are retrieved into the memory block`
  - `does not insert a message the prompt still holds` (`it.fails`)
  - `inserted text carries no leading space from the document prefix` (`it.fails`)

### HAN-2: Hanurai "Chunk Size" is a reservation, not a cap (TRACED)

- **Verified fork location:** `hanuraiTokens` enters only at `hanuraiMemory.ts:61` (`tokens = currentTokens + hanuraiTokens`) to force trimming; `:72` subtracts it; the fill loop's only bound is `tokens >= arg.maxContextTokens` (`:86`). The setting label is `language.hypaChunkSize` = "Chunk Size" (`en.ts:1629`; `OtherBotSettings.svelte:1064-1065`).
- **Upstream: UPSTREAM-SAME** (UI at upstream `OtherBotSettings.svelte:1034`).
- **Decision, `MC-713` 4** (same answer as HAN-1): retrieval is bounded by Chunk Size.
- **Test:** `bounds the retrieved text by the Chunk Size setting` (`it.fails`, same file; flipped failure `expected 93 to be <= 30`). Gate 2 batch 1 confirmed the test asserts block tokens <= Chunk Size and does not pin an implementation.

### V2-1: a failed summary batch leaves a permanent gap (REPRODUCED; PERSISTENCE-RISK)

- **Verified fork location:** a failed batch increments the failure counter and `continue`s (`hypav2.ts:532`) after `idx` has advanced and `halfData` was discarded; `currentTokens` is reduced only on success (`:582`); the 3-strike abort counts consecutive failures only (`:522-523`, reset `:535`); the removal range is `slice(idx)` (`:664`). The failure is a real path: the mocked summarizer throws, the catch at `:50-52` returns `success:false`.
- **Observed (executed, 21 chats, summarizer fails call 1, then succeeds):** removed from the prompt but covered by no summary: `["id1","id2","id3"]`. Next turn with data reloaded from the returned `memory`: the same three stay uncovered; the gap is never healed.
- **Persist path:** `index.svelte.ts:1549-1553` returns the error; otherwise `memoryCtx.chat.hypaV2Data = sp.memory ?? ...` at `:1560`. The assignment is verified. The save pipeline after that line is NOT traced (verifier required correction 3), so "the gapped data is saved" is an inference and the claim "chat history is intact, only memory coverage is lost" is INCOMPLETE (whether stored chats are mutated elsewhere was not traced). Handed to lane A.
- **Upstream: UPSTREAM-SAME** (`hypav2.ts:508` `continue`).
- **Decision, `MC-713` 1:** "Retry same batch (Recommended)". The option said: roll back to the batch start and retry it; the existing 3-strike limit then aborts with an error after 3 failures on that batch; nothing is skipped.
- **Tests** (`hypav2.test.ts`):
  - `guard: without failures every message removed from the prompt is covered by a summary`
  - `a failed summary batch followed by a success leaves no removed message uncovered` (`it.fails`; flipped `['id1','id2','id3']` vs `[]`)
  - `guard: the first fail-once run still summarises later batches`
- **Interaction:** a fix that rolls back `idx` interacts with V2-4 and V2-2 (skipped entries change `idx`); fix them together or the retry window is wrong (investigation, not executed).

### V2-2: V2 skip rules (REPRODUCED)

- **Verified fork location:** the only skip is `idx === 0` (`hypav2.ts:449`); chats are built examples first, then the new-chat marker unless NovelAI or `trimStartNewChat` (`index.svelte.ts:1273-1287`). Example turns are built without `memo` (`exampleMessages.ts:31-55`; map `:64-70`).
- **Observed (executed, three variants):** (A) examples starting with `<START>`, then the marker: the example turns and the real new-chat marker are summarised as story. (B) examples without a leading `<START>`: the first example turn is dropped unsummarised and the rest summarised. (C) `trimStartNewChat` with no examples: the first message is dropped and never summarised.
- **Sub-finding (executed; diagnostic):** a summary batch ending on an example turn gets `lastChatMemo` undefined, persisted as `[null,null,"NewChat"]` (the JSON round trip in the scratch test is a stand-in for the real serializer, untraced). On the next turn `cleanInvalidChunks` (`hypav2.ts:290-312`, `isSubset` `:173-180`) does not match `null` against the undefined memos, discards those summaries and re-runs the summarizer (3 calls on turn 1, 3 on turn 2). Cost: repeated paid summarisation each turn, no chat-text loss. The related guess that the resume lookup `chat.memo === undefined` (`:402`) could match the wrong index is INFERRED and UNVERIFIABLE (not exercised).
- **Upstream: UPSTREAM-SAME** (`hypav2.ts:433`; `index.svelte.ts:831,843`; `exampleMessages.ts:30`).
- **Decision, `MC-713` 2:** "Adopt V3's skip rules (Recommended)". The option said: skip example turns, the example marker and the new-chat marker as V3 does; only real chat messages are summarized, and the first message is never dropped.
- **Tests** (`hypav2.test.ts`):
  - `guard: story messages are summarised when examples precede the new-chat marker`
  - `never summarises the example marker, example turns or the new-chat marker` (`it.fails`)
  - `never summarises example turns that have no leading example marker` (`it.fails`)
  - `summarises the first message when the new-chat marker is trimmed and there are no examples` (`it.fails`)
- **Not pinned:** the null-memo re-summarisation (sub-finding) has no separate test.

### V2-3: the summary section keeps the oldest summaries (REPRODUCED, diagnostic)

- **Verified fork location:** `hypav2.ts:589-597` iterates `mainChunks` in stored (oldest-first) order and `break`s at `allocatedTokens/2` (`:594`); chunks are pushed at `:555`; the legacy conversion reverses at `:204`.
- **Observed (executed):** 8 stored summaries of 10 tokens, allocation 100: S1 to S5 shown; S6 to S8 (the newest) absent. The verifier labelled this a diagnostic experiment (output via a thrown info error, no assertion); the repository test now carries a real assertion.
- **Upstream: UPSTREAM-SAME** (`hypav2.ts:565-570`).
- **Decision, `MC-713` 3:** "Newest-first (Recommended)". The option said: select newest summaries first, render them oldest-to-newest.
- **Tests** (`hypav2.test.ts`): `guard: summaries that fit in half the allocation are all shown, oldest to newest`; `guard: shown summaries keep oldest-to-newest order when not all fit`; `shows the newest summary when the summaries exceed half the allocation` (`it.fails`; flipped `[1,2,3,4,5]` lacks 8).

### V2-4: skipped entries are not deducted from the token count (REPRODUCED, diagnostic)

- **Verified fork location:** the skips at `hypav2.ts:449-460` do `idx++` only and are not added to `halfDataTokens`; `slice(idx)` (`:664`) removes them; `currentTokens -= halfDataTokens` (`:582`).
- **Observed (executed):** returned `currentTokens` 70 against a recount of the returned chats of 50 (drift 20 = the new-chat marker plus a blank message). The recount includes the SupaMemory chat the function also adds. A "spurious error" from this drift is UNVERIFIABLE (not isolated; the packet admits it).
- **Upstream: UPSTREAM-SAME** (`hypav2.ts:433-443,558,640`).
- **Decision, `MC-713` 5:** "Fix count; delete stub (Recommended)". The option said: deduct skipped entries' tokens; delete the dead `regenerateSummary`.
- **Tests** (`hypav2.test.ts`): `returns the token count of the chats it returns when it skips a blank message` (`it.fails`; flipped `expected 70 to be 50`); `guard: the returned token count matches the returned chats when nothing is summarised`. The no-skip guard can only use a no-summarisation scenario because `hypaMemoryV2` always skips index 0.

### V2-5: dead `regenerateSummary` stub (TRACED)

- `hypav2.ts:314-321` is an empty exported stub (`targetMainChunk` unused). `grep -rn regenerateSummary src` returns one hit, the definition. **Upstream: UPSTREAM-SAME** (`hypav2.ts:299`).
- **Decision, `MC-713` 5** (above): delete the stub.
- **Test: none.** Dead code; a test would assert only absence.

### SHARED-1: comparator violates the sort contract (TRACED; not reproduced)

- **Verified fork location:** `hypamemory.ts:228`, `(a.similarity > b.similarity ? -1 : 0)`. Never returns a positive value.
- **Observed (executed, Node 22.22.0, V8 TimSort):** zero mismatches against `b.s - a.s` for random arrays of 3 to 500 distinct scores (2000 trials each; top-3 wrong in 0 of 2000). The verifier widened the method to ascending, descending, organ-pipe, two-run and tied inputs, n = 2 to 2000, 300 trials each: zero mismatches. Non-V8 engines were not tested: UNDETERMINED there. Ties are unobservable here.
- **Upstream: UPSTREAM-SAME** (`hypamemory.ts:217`; the fork's `hypamemory.ts` diff does not touch the sort or `similarity`).
- **Decision, `MC-713` 6:** "Fix comparator; cosine (Recommended)". The option said: use a correct comparator (b - a), and switch to cosine similarity; for unit vectors the ranking is unchanged.
- **Test: none.** A test would pass on V8 today and is not a meaningful reproducer; Gate 2 accepted the omission. Only the unit-length ranking guard (below) covers sort direction.

### SHARED-2: dot product instead of cosine (TRACED)

- **Verified fork location:** `similarity()` is a raw dot product (`hypamemory.ts:243-249`, used at `:222`); `hypamemoryv2.ts:366-378` uses cosine. Local models use `normalize: true` (`transformers.ts:91`). OpenAI vectors being unit length is external knowledge, not verified. Custom-endpoint vectors were not probed (no network): UNDETERMINED.
- **Upstream: UPSTREAM-SAME** (`hypamemory.ts:232-238` region).
- **Decision, `MC-713` 6** (above).
- **Tests** (`hypamemory.similarity.test.ts`): `guard: unit-length documents rank by closeness to the query`; `ranks a document the same when its vector is scaled by 10 (cosine)` (`it.fails`; flipped `['far','close']` vs `['close','far']`). The scratch investigation did not execute this item; the repository test is the first execution.

### SUPA-1: HypaMemory v1 path does not count the loaded summary (REPRODUCED)

- **Verified fork location:** the hypa branch loads `supaMemory` and `hypaChunks` at `supaMemory.ts:108-109` with no token add; the plain branch adds `tokenize(supaMemory)` at `:136`. Re-summarisation subtracts `tokenize(oldSupaMemory)` at `:386` for tokens never added.
- **Observed (executed, stub tokenizer):** returned `currentTokens` 541 against roughly 920 actual. The follow-on claim that the prompt-level recheck then trims older history because supa/hypa entries are not `removable` (`index.svelte.ts:1646,1983-1999`) is INFERRED, not run.
- **Upstream: UPSTREAM-SAME** (`:105-106` vs `:133`).
- **Decision, `MC-712` 4:** "Count it (Recommended)". The option said: add the loaded summary's tokens on the v1 path as the plain path does.
- **Test** (`supaMemory.test.ts`): `the returned token count includes the loaded summary` (`it.fails`; flipped `expected 441 >= 821` in Gate 2 round 1).

### SUPA-2: v1 query and comma join (REPRODUCED)

- **Verified fork location:** `"past events: " + s.slice(0,3)` coerces the array with commas (`supaMemory.ts:164`); the query is `filteredChat.slice(0, 4)` (`:160-161`): the oldest four retained non-system messages. Observed `"past events: a,b,c"` and query memos `["m3","m4","m5","m6"]`. The similarity results in the experiment are canned, so only the slice and the coercion are tested (verifier).
- **Upstream: UPSTREAM-SAME** (`:158-161`).
- **Decision, `MC-712` 5:** "Keep query, fix the join". The option said: treat the oldest-4 query as intended; join the results with newlines instead of commas.
- **Tests** (`supaMemory.test.ts`): `retrieved results are joined with newlines` (`it.fails`); `guard: retrieval is queried with the oldest four remaining non-system messages and keeps three results`.

### SUPA-3: deleting the resume message leaves plain SupaMemory stuck (REPRODUCED)

- **Verified fork location:** `supaMemoryData` is `id\nsummary` (`supaMemory.ts:48-51`). The loop at `:113-129` drops `chats[0]` until `chats[0].memo === id`; if the array empties it returns `{error: "SupaMemory: chat ID not found"}` (error `:119`, id match `:122`) with no `memory`. The caller throws and aborts the send (`index.svelte.ts:1593-1596`); the assignment of `supaMemoryData` is at `:1603`, after the early return, so the stored value is untouched.
- **Observed (executed, three consecutive calls):** identical error each time, `roomData` unchanged; clearing the data recovers; a control with the resume message present works. The function also empties the caller's `chats` array in place before erroring (harmless because the caller aborts). Not data loss: a stuck state. Recovery today is manual (`CharConfig.svelte:1249/1276`); clearing drops the whole summary. HypaMemory v1 has a snapshot fallback (`:76-99`), plain SupaMemory has none.
- **Upstream: UPSTREAM-SAME** (`:113-126`, error `:116`). Upstream backups can therefore carry dangling IDs (`MC-175`, `MC-223`; reasoning, not executed).
- **Decisions:** `MC-712` 1 ("Resume at next survivor (Recommended)") was found infeasible in Gate 2 round 1: the id is a v4 UUID (`index.svelte.ts:1374`, `Chat.svelte:1313`), a deleted message is gone from `room.message` too, and no writer updates `supaMemoryData` on delete, so the send-time function cannot know where the message stood. Superseded by `MC-714` 1: **"Repoint + reset fallback (Recommended)"**. The option said: deleting the resume message repoints SupaMemory to the next message (summary kept); for data that is already dangling, a clear error naming the problem, with a one-click reset of SupaMemory data. Extended by `MC-715` 1: **"Point past the end (Recommended)"**. The option said: treat everything left as already summarised; the next new message becomes the resume point; no error, nothing re-summarised. The `MC-714` error-and-reset fallback stays for data that is already dangling. The `MC-715` case is a fix-brief requirement; the Phase 2 tests do not pin it.
- **Message-delete paths found** (search for `splice`, `filter`, `slice`, `pop` on `chat.message` in non-test source, from the batch-2 remediation): `src/lib/ChatScreens/Chat.svelte:296-305` (`rm`, plus shift-click slice about `:258-262`); `src/ts/process/command.ts:221,228,234-236` (`/cut` by index, range, chatId) and `:248` (`/del`); `src/ts/process/scriptings.ts:348` (`cutChat`), `:358` (`removeChat`); `src/ts/process/triggers.ts:1577,2010` (cut triggers). `Chat.svelte:1307` is a branch slice that makes a new chat and is not a delete of the original. A fix must repoint on all of these, ideally through one shared helper, and implement `MC-715` for the cases with no following message ("remove from here", `/del` reaching the resume message).
- **Tests:**
  - `src/ts/process/command.supaResume.test.ts`: `guard: /cut <chatId> removes only that message`; `guard: removing a message other than the resume message leaves the pointer and summary` (cuts `m3` then `m1`); `removing the resume message repoints SupaMemory at the next message and keeps the summary` (`test.fails`; flipped `'m2\nold summary text'` vs `'m3\nold summary text'`). Only the `/cut <chatId>` branch is pinned.
  - `supaMemory.test.ts`: `a resume message that no longer exists fails with an error other than the old chat-ID-not-found text` (`it.fails`); `guard: a resume message that no longer exists fails the send today`; `guard: a surviving resume message keeps the stored summary`.
- **Limit:** the dangling-ID reproducer is weak by design: a mutant returning an unrelated existing error ("SupaMemory: Not Enough Tokens to summarize") also passes it (round 2 and 3, executed). The error wording is to be judged at the fix's review. The reset control is UI work and is not tested.

### SUPA-4: no-progress loop with a tiny chunk size (REPRODUCED; reachability low)

- **Mechanism (executed under a guard):** outer `while (currentTokens > maxContextTokens)` (`supaMemory.ts:304`). The inner loop hits `chunkSize + tokens > maxChunkSize` on a system `chats[0]`; nothing is added (`:350-357`), `lastId` is set (`:358`), `break` (`:359`), `splice(0,0)` (`:366`), no summarize (`:368`). `currentTokens` and `maxChunkSize` are unchanged, so the loop never exits. The experiment stops the loop with a tokenizer that throws after 5000 calls (5001 calls observed); it cannot hang. Control with a 10-token marker and chunk 20: error "Not Enough Tokens to summarize in SupaMemory" after 5 calls. Freeze versus slow churn on a real tokenizer was not measured and is not claimed.
- **Premise corrected:** the trigger requires the leading system entry (the `[Start a new chat]` marker, `index.svelte.ts:1281-1286`; example marker `exampleMessages.ts:31-39`) to exceed `maxChunkSize = min(floor(maxContext/3), db.maxSupaChunkSize)` (`supaMemory.ts:306-309`), plus per-chat overhead (`tokenizer.ts:442`). The experiment's 50-token marker and chunk 20 are contrived; the real marker is a few tokens. The UI minimum for `maxSupaChunkSize` is 100 (`src/lib/Setting/Pages/OtherBotSettings.svelte:1279`; upstream `:1268`), default 1200 (`database.svelte.ts:475`). The verifier checked `NumberInput.svelte`: `min` is only an HTML attribute with `bind:value` and no clamp, so a typed value below 100 is stored. Reachability: by a small Max Context or a manually typed chunk size, not by default settings or the spinner. Practical likelihood low (INFERRED).
- **Upstream: UPSTREAM-SAME** (`:286-348`).
- **Decision, `MC-712` 6:** "Exit with an error (Recommended)". The option said: when an iteration makes no progress, stop and return the existing "Not Enough Tokens to summarize" style error instead of looping.
- **Tests** (`supaMemory.test.ts`): `guard: a leading system entry within the chunk size terminates with an error`; `a leading system entry larger than the chunk size returns an error instead of looping` (`it.fails`; the guard tokenizer stops the loop; flipped it finishes in 9 ms).

### SUPA-5: legacy davinci / curie summarizer values (TRACED)

- **Verified fork location:** any `supaModelType` other than `distilbart` / `subModel` posts to `https://api.openai.com/v1/completions` with `curie` mapped to `text-curie-001`, `instruct35` to `gpt-3.5-turbo-instruct`, anything else to `text-davinci-003` (`supaMemory.ts:228-241`; `hypav2.ts:86-91`). The UI offers only distilbart / instruct35 / subModel (`OtherBotSettings.svelte:1072-1076,1273-1277`) but still shows the key field for davinci/curie (`:1077,1280`). No migration exists (`database.svelte.ts:254` is the nullish default). A saved `davinci` shows a blank Select and fails with "SupaMemory: HTTP: ..." (`supaMemory.ts:245-251`). Provider retirement is external knowledge, not verified. Verified by reading; not executed in the investigation.
- **Upstream: UPSTREAM-SAME** (`supaMemory.ts:218-220`).
- **Decision, `MC-712` 7:** "Migrate to instruct35 (Recommended)". The option said: on load, map davinci/curie to the gpt-3.5-turbo-instruct option; the saved value changes; upstream reads it fine. The fix is a saved-setting change for the applicable gate.
- **Tests** (`src/ts/storage/tests/databaseSupaModelType.test.ts`): `guard: %s is kept as saved` (`test.each` over distilbart, instruct35, subModel, none); `guard: a missing value defaults to none`; `a saved %s loads as instruct35` (`test.fails.each` over davinci, curie; two expected-fail rows). The test does not show that a migrated value persists (dirty tracking and save); that belongs to the fix's persistence gate.

### V3-1: rate limiter throws when concurrency exceeds RPM (REPRODUCED)

- **Verified fork location:** the constructor throws if `maxConcurrentTasks > tasksPerMinute` (`taskRateLimiter.ts:39-41`; the check is `>` while the message says "less than"). The UI allows it: RPM `min=1` with no max, concurrency `min=1 max=10`, no cross-check (`OtherBotSettings.svelte:1253-1259`). Construction sites (verified, complete): `hypav3.ts:393` (summarization limiter, UI values only when `summarizationModel === "subModel"`), `hypav3.ts:639` (embedding limiter, always UI values, inside the similar-memory branch `similarMemoryRatio > 0`, `:603`; `HypaProcessorV2` is built only at `:638`), and `hypamemoryv2.ts:48` with safe defaults 20/5. Only the experimental path (`useExperimentalImpl`, default false, `hypav3.ts:135,1827`) is affected; defaults are 20/1 and 100/1 (`:1827-1831`).
- **Observed (executed):** throws for RPM/concurrency 5/10, 1/2, 1/10 and 20/21; 5/5 does not throw. `hypaMemoryV3`'s catch rethrows with a `[HypaV3]` prefix (`:158-162`), so generation fails. For the embedding site the throw comes after summarization, so new summaries are not returned and are re-requested next time (INFERRED from control flow, not run; cost, not data loss).
- **Upstream: UPSTREAM-SAME** (`taskRateLimiter.ts:39`; `hypav3.ts:389-393,635-636`).
- **Decision, `MC-712` 2:** "Allow it (Recommended)". The option said: drop the check; the RPM window already gates task starts; no UI change.
- **Tests** (`taskRateLimiter.test.ts`): `guard: defaults and equal limits construct`; `guard: tasks run to completion under equal limits`; `a concurrency cap above the per-minute count constructs without throwing` (`it.fails`); `tasks run to completion when the concurrency cap is above the per-minute count` (`it.fails`; per Gate 2 round 1 this one also fails at construction, so it covers the same defect twice).

### V3-2: bulk re-summarize of a non-contiguous selection moves the resume point (REPRODUCED on a replica + TRACED)

- **Verified fork location:** `resummarizeBulkSelected` builds `mergedChatMemos` as the de-duplicated concatenation in ascending index order (`src/lib/Others/HypaV3Modal.svelte:257-262`); `applyBulkResummary` writes the merged summary at `minIndex` and splices the others (`:301-313`); selection is unrestricted (`:138-147`). Resume uses the last summary: `lastSummary = data.summaries.at(-1)`, start after its last memo (`hypav3.ts:224-230` exp, `:1004-1010` std).
- **Observed (executed on a copy of the modal logic, not the live component):** summaries A{m0,m1}, B{m2,m3}, C{m4,m5}; select A and C: result `['AC:m0,m1,m4,m5','B:m2,m3']`; resume `startIdx 4`, so m4 and m5 are re-fed to summarization. Condition (non-contiguous AND includes the last summary) is correct from code; the live component and a live duplicate summary were NOT executed (UNVERIFIABLE end to end). That the merged summary then sits out of chronological order and affects recent-memory selection is INFERRED.
- **Upstream: UPSTREAM-SAME** (modal splice at upstream `HypaV3Modal.svelte:276`).
- **Decision, `MC-711` 2:** "Resume from max covered (Recommended)". The option said: base the resume point on the latest message covered by any summary, not only the last summary.
- **Tests** (`hypav3.test.ts`, standard path and `hypaMemoryV3 experimental implementation`): `guard: summaries in chronological order resume after the last covered message` (both paths); `summaries not ordered by coverage resume after the latest covered message` (`it.fails`, both paths; flipped `[4,5]` vs `[]`). The tests pin the resume function, not the modal merge.

### V3-3: "Do Not Summarize User Message" help text (TRACED)

- **Verified fork location:** the help text (`en.ts:713-714`, label `:1797`) says user messages are excluded from the max-messages-per-summary count. The experimental path matches it (`hypav3.ts:301-304`, user messages skipped `:345-348`, pushed only if summarised `:353-355`). The standard path uses a fixed window, `endIdx = min(startIdx + maxChatsPerSummary, ...)` (`:1069-1072`, loop `:1089`), and skipped user messages still consume window slots.
- **Upstream: UPSTREAM-SAME** (`en.ts:305-306`).
- **Decision, `MC-711` 3:** "Code: std path counts". The option said: make the standard path count only summarized messages, as the experimental path does, so the help text becomes true.
- **Tests** (`hypav3.test.ts`, standard path only, by decision): `guard: without the user-message option a batch holds maxChatsPerSummary messages`; `guard: with the user-message option no user message is summarised`; `with the user-message option a batch holds maxChatsPerSummary non-user messages` (`it.fails`; flipped `['assistant']` vs three assistants).

### V3-4: hiding a message deletes the summaries that cover it (REPRODUCED in V3 and V2; PERSISTENCE-RISK)

- **Verified fork location:** `chats` given to memory is built from `splitSentMessages(currentChat.message)` (`index.svelte.ts:1295,1342,1359`; `memo: msg.chatId` at `:1498`, push `:1506`), which skips `disabled === true` and stops at `'allBefore'` (`cbs.ts:118-130`). `cleanOrphanedSummary` keeps a summary only if every `chatMemos` entry is in the current `chats` memo set (`hypav3.ts:1656-1664`, `isSubset` `:1673`), called at `:215-218` (exp) and `:995-998` (std); it runs unless `preserveOrphanedMemory`, default false (`:1822`; type `:44`; UI toggle `OtherBotSettings.svelte:1231`). V2: `cleanInvalidChunks` (`hypav2.ts:290-312`), called unconditionally at `:386`.
- **Observed (executed, real `hypav3.ts` and `hypav2.ts`, mocked embedding/request/db/tokenizer):** chats m0, m1, m3 to m8 (m2 absent): V3 log `[HypaV3] Cleaned 1 orphaned summaries.` and S0{m0,m1,m2} deleted, S1 kept; V2: M1 dropped, M2 kept. Correction (verifier): V2 sets `lastMainChunkID` to the last remaining chunk's id, or 0 if none (`hypav2.ts:304-310`), it does not just "reset" it. The packet's Preserve-Orphaned-Memory control was vacuous (no assertion, missing `DBState` mock); the corrected control keeps `["S0","S1"]` (executed by the verifier).
- **Persist path:** the cleaned data is assigned back (`index.svelte.ts:1585` for V3, error exit `:1569-1573`; V2 `:1560`). Assignment verified; the save pipeline is UNVERIFIED (opus-reviewer territory). Writers of `hypaV3Data =` enumerated by the verifier: `index.svelte.ts:1572,1585`; `HypaV3Modal.svelte:408,701`; `coldstorage.svelte.ts:937,1082`. No unhide path restores it. That a summary spanning a hidden message is the typical case is INFERRED.
- **Wording observation (verifier):** the Preserve Orphaned Memory help text (`en.ts:710-711`) says "deleted chat messages"; hidden is not deleted, so the wording misleads.
- **Upstream: UPSTREAM-SAME** (`hypav3.ts:212,991,1650`, default false at `:1804`; `hypav2.ts:275,370`; `index.svelte.ts:854-857`).
- **Decision, `MC-711` 1:** "Hidden ≠ orphan (Recommended)". The option said: check summaries against the full message list, so only messages that were really deleted orphan a summary; hiding never deletes memory; applies to V2 and V3.
- **Tests:** the fixtures encode "hidden" as m2 absent from `chats` but present in `room.message` with `disabled: true`, and "deleted" as absent from both (the round-1 rejection forced this; the reviewers confirmed `hypaMemoryV2` / `hypaMemoryV3` already receive `currentChat` as `room`).
  - `hypav3.test.ts` (standard path and experimental describe): `a summary covering a hidden message is kept when Preserve Orphaned Memory is off` (`it.fails`, twice); `guard: a summary covering a deleted message is removed when Preserve Orphaned Memory is off` (twice); `guard: a summary covering the memo-less greeting is kept when Preserve Orphaned Memory is off` (twice); `guard: Preserve Orphaned Memory keeps a summary whose message is missing`.
  - `hypav2.test.ts`: `keeps a summary that covers a hidden message` (`it.fails`); `guard: a summary covering a really deleted message is removed`; `guard: a summary whose messages are all present is kept`; `guard: a summary covering the memo-less greeting is kept`.
  - The memo-less greeting guards exist because the first message (greeting) is sent without a `memo` and summaries covering it store an undefined memo; a "check only against `room.message`" fix would drop them (see Gate 2 round 2).

### V3-5: biased shuffle (TRACED)

- **Verified fork location:** `.sort(() => Math.random() - 0.5)` at `hypav3.ts:844` (exp) and `:1508` (std). Bias magnitude was not measured by the investigation (UNDETERMINED). Gate 2 round 1 measured the test's distribution instead: the current biased sort deviates 0.154 from 1/3 over a 12-seed sweep, against 0.0087 (backward Fisher-Yates), 0.0137 (forward) and 0.0177 (random-key sort) for uniform shuffles; the test tolerance 0.03 is about 4.9 sigma.
- **Upstream: UPSTREAM-SAME** (`hypav3.ts:839,1502`).
- **Decision, `MC-711` 4:** "Uniform shuffle (Recommended)". The option said: replace it with a Fisher–Yates shuffle.
- **Tests** (`hypav3.test.ts`, both paths): `every unselected summary is equally likely to be picked` (`it.fails`, std and exp; flipped deviation 0.1055 against 0.03); `guard: exactly one summary fits the random budget and it is one of the stored summaries`. `Math.random` is replaced by a seeded generator inside the helper only and restored after each test.

### TOK-1: V2 / V3 subtract the response reservation (TRACED; clamp premise REFUTED)

- **Verified fork location:** `currentTokens` starts at `db.maxResponse + 50` (`index.svelte.ts:1056-1061`). V2 subtracts `maxResponse` (`hypav2.ts:374`, comment "temporary fix"), V3 on both paths (`hypav3.ts:206,986`); nothing adds it back. Hanurai compares `arg.currentTokens + hanuraiTokens` (`hanuraiMemory.ts:61-63`), SupaMemory compares `currentTokens` directly (`supaMemory.ts:175,304`), and the no-memory fallback trims including the response (`index.svelte.ts:1612`). So V2/V3 target "input <= Max Context", the others "input + response <= Max Context".
- **Refuted premise:** the report's claim that a later clamp "shrinks the output budget to what is left" is wrong. `outputTokens` (`index.svelte.ts:2002-2005`) is written only to `generationInfo` (`:2013`) and read only by `AlertComp.svelte:521-532` (display). The request still sends the full `db.maxResponse` (`request.ts:503`; `sendChat` passes no `maxTokens`). The verifier checked 17 `maxTokens` / `maxResponse` reads in 8 request-side files (`request.ts` 503, 590, 700/716, 839, 915, 1014, 1084, 1431, 1517; `openAI/requests.ts` 293, 388, 907; `openAI/responses.ts` 345; `anthropic.ts` 84/360; `google.ts` 55/338): none clamps against Max Context or input tokens. Whether a provider rejects or truncates an over-long request is untested (INFERRED).
- **Upstream: UPSTREAM-SAME** (`hypav2.ts:355-358`; `hypav3.ts:201,980`; `index.svelte.ts:614,1526-1528`).
- **Decision, `MC-712` 3:** "Input + response (Recommended)". The option said: V2/V3 stop subtracting Max Response, matching the other memory systems and the no-memory path; their prompts get Max Response tokens shorter.
- **Tests:** `hypav2.tokenAccounting.test.ts`: `the returned token count keeps the response reservation of the input count` (`it.fails`; flipped 60 vs 150) and `guard: the memory block is added to the returned token count`. `hypav3.test.ts`: the same reproducer title in the `hypaMemoryV3 response reservation` describe (standard path) and in the experimental describe (flipped 50 vs 150). The tests call the memory functions directly; the full `sendChat` harness was not used.

### UI-1: memory dropdown precedence and V2 toggle label (TRACED)

- **Verified fork location:** the dropdown value expression is V3 > V2 > (`supaModelType !== 'none'`) > Hanurai (`OtherBotSettings.svelte:1015-1019`); the runtime order is Hanurai > V2 > V3 > SupaMemory (`index.svelte.ts:1532/1546/1564/1589`). The panel below the dropdown follows the runtime order (`:1062,1069,1087,1270`), so with Hanurai and V3 both set the dropdown says V3 while the panel and the runtime are Hanurai. The dropdown `onchange` clears the other flags (`:1023-1053`), so the mismatch is not reachable through the dropdown; it needs a database with several flags set (older versions, imported settings or plugin writes; INFERRED, no specific writer traced). The toggle label (`Toggles.svelte:194,209`) tests `hypaV3`, hanurai and `hypaMemory`, not `hypav2`, so with V2 active and `hypaMemory` false it reads `ToggleSuperMemory` ("Toggle SupaMemory", `en.ts:1320`). The V2 label part is certain from source.
- **Upstream: UPSTREAM-SAME** (UI `:985-988`; `index.svelte.ts:1072/1086/1102`; `Toggles :194,:209`).
- **Decision, `MC-712` 8:** "Dropdown follows runtime (Recommended)". The option said: align the dropdown expression to the runtime order, and give V2 the Hypa toggle label; no saved data changes.
- **Tests** (`src/lib/SideBars/Toggles.memoryLabel.svelte.test.ts`; `describe.each` over a plain layout and a container layout with more than four toggles, because `Toggles.svelte` has the label expression at two render sites): `guard: HypaMemory V3 shows the Hypa label`; `guard: SupaMemory shows the Supa label`; `HypaMemory V2 shows the Hypa label` (`test.fails`, once per layout); `guard: more than four toggles render the scrolling container, four or fewer do not`.
- **Untested: the dropdown-order half.** `OtherBotSettings.svelte` was judged too heavy for a component test; it needs a multi-flag `DBState` and a component test (or a pure helper after extraction). The orchestrator must track this half.

## What changed and evidence

- **No application code changed.** Ten new untracked test files (authored by test-warrior):
  - batch 1: `src/ts/process/memory/hanuraiMemory.test.ts`, `hypav2.test.ts`, `hypamemory.similarity.test.ts`
  - batch 2: `src/ts/process/memory/supaMemory.test.ts`, `taskRateLimiter.test.ts`, `hypav3.test.ts`, `hypav2.tokenAccounting.test.ts`; `src/ts/storage/tests/databaseSupaModelType.test.ts`; `src/lib/SideBars/Toggles.memoryLabel.svelte.test.ts`; `src/ts/process/command.supaResume.test.ts` (added in the round-1 remediation).
- **Counts** (default config; plain and `.fails` tests by title grep of the files at `04126b6`, reconciled with the round-3 table in `c10b/g2r3/result.md`: the two agree for all ten files):

| File | Passed (guards) | Expected fail (reproducers) |
|---|---|---|
| `hanuraiMemory.test.ts` | 1 | 3 |
| `hypav2.test.ts` | 9 | 7 |
| `hypamemory.similarity.test.ts` | 1 | 1 |
| `supaMemory.test.ts` | 4 | 4 |
| `taskRateLimiter.test.ts` | 2 | 2 |
| `hypav3.test.ts` | 10 | 9 |
| `hypav2.tokenAccounting.test.ts` | 1 | 1 |
| `databaseSupaModelType.test.ts` | 5 | 2 |
| `Toggles.memoryLabel.svelte.test.ts` | 5 | 2 |
| `command.supaResume.test.ts` | 2 | 1 |
| **Total** | **40** | **32** |

  "Passed" are regression-guard / compatibility tests that may pass before and after a fix; "Expected fail" are regression reproducers (they fail on the intended assertion today and must turn green with the decided fix). Parameterised tests (`test.each`, `describe.each`) count per row. `pnpm check` (`NODE_OPTIONS=--max-old-space-size=8192`): exit 0, 0 errors, 0 warnings in batch 1, after each remediation and in round 3. No full `pnpm test` run is recorded in the evidence for this work.
- **Falsification (executed by test-warrior and reviewers, in scratch copies outside the repository):** flipped copies (`.fails` changed to plain) fail on the intended assertion for every reproducer: batch 1 11 failed | 10 passed; batch 2 round 1 15 failed | 19 passed (six files); round 2 23 failed | 27 passed (five files); round 3 re-executed (hypav3 9, hypav2 7, supaMemory 4, command 1, Toggles 2 failed). None was a setup or import error. Fix mutants (scratch copies of modules implementing the decided behaviour) turn the matching reproducers green with the guards intact; guard mutants fail the intended guards. Mutants show the tests can turn green under decided behaviour, not that a real fix is complete.

### Gate 2 history

| Round | Scope | Reviewer | Verdict | What it found |
|---|---|---|---|---|
| Batch 1 | `hanuraiMemory`, `hypav2`, `hypamemory.similarity` (11 reproducers, 10 guards) | adversarial-reviewer, HEAD `04126b6` | `[APPROVE]` | No substantive defect (ledger row 5029). Advisory notes below. |
| Batch 2 round 1 | the six batch-2 files (15 reproducers, 19 guards) | opus-reviewer | `[REJECT]` (substantive 1) | F1: the V3-4 reproducer and the deleted-message guard had identical inputs with opposite expectations, so no correct fix could pass both, and the reproducer showed the deleted-message behaviour rather than the hidden defect; hidden must be encoded through `room.message` (the same flaw existed in the batch-1 V2 test). F2: SUPA-3 "next survivor" is not computable at send time, so the reproducer could pass under a fix against `MC-712` 1 and its comment prescribed an unbuildable mechanism; maintainer re-asked, giving `MC-714`. F3: experimental path untested for V3-2, V3-4, V3-5, TOK-1. F4: UI-1 label covered at one of two render sites. F5: `Toggles` import took 31 s in this container (fixed with a `@lucide/svelte` mock, 6.4 s; a container timing, not an app claim). F6: editorial ("retired" wording, casts). Also noted: the hand-back said "14 reproducers" where the actual count was 15 (SUPA-5 expands to two). |
| Batch 2 round 2 | whole remediation (fresh reviewer) | opus-reviewer | `[REJECT]` (substantive 2) | All round-1 findings resolved. New F1: the SUPA-3 "other message" guard cut the last message, so an always-repoint fix (advance the pointer past any cut) passed it, which would silently drop an unsummarised message from the prompt. F2: no explicit guard kept a summary covering the memo-less first message (greeting); a literal `room.message`-only fix would drop it, and only unrealistic default fixtures caught it, by accident. E1 to E3 editorial. Open product question: `MC-714` did not cover a deleted resume message with no following message, giving `MC-715`. A third rejection would have required advisor escalation; mechanism reconsidered: both were small test-coverage gaps, not a wrong mechanism. |
| Batch 2 round 3 | remediation of round 2 (fresh reviewer) | opus-reviewer | `[APPROVE]` | F1, F2 and E1 to E3 resolved and re-executed (always-repoint mutant fails the guard; message-list-only mutants fail the greeting guards per path; union and alternative designs pass; a null-memo variant fixture behaves the same). Non-blocking notes below. |

Ledger rows 5028 to 5035 cover test-warrior and reviewer dispatches (token figures are as recorded there; not repeated here). The streak ended at two substantive rejections, so no advisor escalation was needed.

**Batch-1 advisory notes (non-blocking, from `c10a/g2/result.md`):**

1. The V3-4 pair coherence: the reproducer and the "really deleted" guard had byte-identical inputs with opposite expectations, so under the old signature no fix could pass both unmodified. The comments disclosed this honestly. Round 1 of batch 2 later rejected the same flaw as substantive; hidden is now encoded through `room.message` (see Gate 2 history).
2. Titles and comments were clunky ("today's signature", "first fail-once run"); wording only.
3. Style: the new files use single quotes and no semicolons, while the one neighbour test in the directory (`contextualEmbeddingCache.test.ts`) uses double quotes and semicolons. Nit.
4. Gate 2 batch 1 also recorded that SHARED-1 and V2-5 have no tests (justified) and that Hanurai split mode is untested.

**Round-3 non-blocking notes (from `c10b/g2r3/result.md`):**

- The V2 greeting fixture keeps the chunk text `'M1 covers m0,m1,m2'` while its memos are `[undefined,'m0','m1']`. Cosmetic.
- V2 has no `toHypaV3Data`-style null-to-undefined conversion; if a V2 memo ever reached storage as `null` through a JSON path, current code would already drop that chunk. Pre-existing upstream behaviour, outside `MC-711` 1. The normal msgpackr save path preserves `undefined` (executed by the reviewer: `decode(encode({a:[undefined,'m0']}))` returns `[undefined,'m0']`).
- The default V3 `roomWith` and V2 `room = {}` fixtures still have an empty `room.message`; the explicit greeting guards carry that protection.
- The greeting guards pin "kept", not how the fix compares (union versus skipping memo-less entries) (`rem2/result.md`).

## Saved-data risks handed to lane A

Mechanisms are traced or reproduced; the save pipeline after the in-memory assignments was NOT traced by this lane. All are upstream behaviour too (`MC-069`). Also recorded in the records file under "For lane A: Phase 2 saved-data risks".

- **V3-4 (V3 and V2): hiding a message deletes the summaries that cover it.** Assignment verified (`index.svelte.ts:1560` V2, `:1585` V3, `:1572` V3 error exit); persistence unverified. Unhiding cannot restore it. Decision `MC-711` 1.
- **V2-1: a failed batch followed by a success saves a coverage gap.** The resume point moves past uncovered messages (`index.svelte.ts:1560`). Decision `MC-713` 1.
- **V2-2 (memo sub-finding): summaries ending on an example turn save `null` memos,** do not match on reload and are re-summarised every turn (repeated paid calls, no chat-text loss). Diagnostic only; the JSON round trip is a stand-in for the real serializer.
- **SUPA-3: deleting the resume message leaves `supaMemoryData` dangling;** every overflowing request then fails until it is cleared by hand. A stuck state, not loss. The decided fix repoints `supaMemoryData` on every message-delete path (`MC-714`, `MC-715`), which writes saved data on delete.
- **SUPA-5: the decided fix migrates a saved setting** (`supaModelType` davinci/curie to instruct35 on load, `MC-712` 7). A saved-data change; the test does not show persistence of the migrated value.
- **V3-2 (replica only): a non-contiguous bulk re-summarize that includes the newest summary** re-feeds covered messages and could create a duplicate summary; not executed against the live component.

## What was not done / residuals

- **UI-1 dropdown half is untested** (component too heavy; needs a multi-flag `DBState` or an extracted helper). Only the toggle-label half has tests.
- **No test for SHARED-1** (passes on V8 today; non-V8 engines untested, UNDETERMINED) **and V2-5** (dead code). Accepted by Gate 2.
- **Hanurai split mode is untested.** The Hanurai tests use single-paragraph messages. The one-character fix is insufficient for multi-paragraph or untrimmed messages (verifier).
- **The experimental path does not test similar-memory retrieval:** the experimental describe sets `similarMemoryRatio` to 0, so the embedding processor and the embedding limiter (the V3-1 embedding site) are not exercised there.
- **SUPA-3 fix scope:** the fix must repoint `supaMemoryData` on all deletion paths (Chat.svelte `rm` and shift-click slice, `command.ts` `/cut` by index, range and chatId and `/del`, `scriptings.ts` `cutChat` / `removeChat`, `triggers.ts` cut triggers) and implement `MC-715` (a deleted resume message with no following message points past the end, no error, nothing re-summarised). The Phase 2 tests pin only `/cut <chatId>` repointing and the dangling-ID error being something other than the old text. `MC-715` is not pinned, other paths are not tested, and the error-wording assertion is weak (an unrelated existing error also passes). If a shared helper is extracted, add a test per path or against the helper (remediation record).
- **V3-3 is standard-path only by decision;** its flip is not pinned on the experimental path (which already matches the help text).
- **Provider behaviour for TOK-1 is untested:** whether a provider rejects or truncates a request whose prompt plus `maxResponse` exceeds the model's context is INFERRED.
- **Not traced:** the save pipeline for V3-4, V2-1 and SUPA-3 data (lane A / opus-reviewer); the real serializer for the V2-2 null-memo finding; provider behaviour behind the 17 TOK-1 request-side reads (only their clamping was checked).
- **Not run (per the evidence):** full `pnpm test` and the relevant build. UNVERIFIED whether the project gates require them for new test files; a named owner should run them on the final snapshot.
- **The Roadmap and Live-State were not edited;** lane A applies the proposed status.
- No performance claims. Mocked summarizer, embeddings, database and tokenizer mean results show control flow only.

## Decisions

`MC-711` to `MC-715` (answers quoted exactly as recorded in [lane-cloud-records.md](../lane-cloud-records.md)):

- `MC-711`: 1 V3-4 **"Hidden ≠ orphan (Recommended)"**; 2 V3-2 **"Resume from max covered (Recommended)"**; 3 V3-3 **"Code: std path counts"**; 4 V3-5 **"Uniform shuffle (Recommended)"**.
- `MC-712`: 1 SUPA-3 **"Resume at next survivor (Recommended)"** (superseded by `MC-714`); 2 V3-1 **"Allow it (Recommended)"**; 3 TOK-1 **"Input + response (Recommended)"**; 4 SUPA-1 **"Count it (Recommended)"**; 5 SUPA-2 **"Keep query, fix the join"**; 6 SUPA-4 **"Exit with an error (Recommended)"**; 7 SUPA-5 **"Migrate to instruct35 (Recommended)"**; 8 UI-1 **"Dropdown follows runtime (Recommended)"**.
- `MC-713`: 1 V2-1 **"Retry same batch (Recommended)"**; 2 V2-2 **"Adopt V3's skip rules (Recommended)"**; 3 V2-3 **"Newest-first (Recommended)"**; 4 HAN-1 and HAN-2 **"Fix HAN-1; cap at Chunk Size (Recommended)"**; 5 V2-4 and V2-5 **"Fix count; delete stub (Recommended)"**; 6 SHARED-1 and SHARED-2 **"Fix comparator; cosine (Recommended)"**.
- `MC-714` 1 (supersedes `MC-712` 1): **"Repoint + reset fallback (Recommended)"**.
- `MC-715` 1 (extends `MC-714`): **"Point past the end (Recommended)"**.

Related: `MC-708` ("go ahead with Phase 2"), `MC-069` (upstream comparison), `MC-175` and `MC-223` (upstream backups and `.bin` compatibility).

## Citation mismatches

- **Snapshot:** the investigation packets cite HEAD `9ded0aa`; the tests and Gate 2 ran at `04126b6`. `git diff --stat 9ded0aa 04126b6` touches no application source (four files: records, `CHORE-09-result.md`, two CHORE-09 tests), so the file:line citations are carried over unchanged. Not re-opened line by line in this report; the verify files re-checked them at `9ded0aa`.
- **Records file, "For lane A: Phase 2 saved-data risks":** it names `MC-712` 1 as the SUPA-3 decision (superseded by `MC-714` and `MC-715`), says intended behaviour is `MC-710` to `MC-713` (the range now ends at `MC-715`) and describes V2-2 as "REPRODUCED as a diagnostic". Per the verifier (`c10a/verify`, required correction 5), the V2-2 scenarios A to C and the null-memo case E are genuine failing assertions; only scenario F (re-summarisation per turn) and V2-3 / V2-4 in the investigation were diagnostics. This report follows the verifier. Superseded: see "Corrections from doc-verifier" 3.
- **Packet versus verifier:** `c10b` cited `OtherBotSettings.svelte:1279` for the maxSupaChunkSize UI minimum; that is correct for the fork (the investigation verifier's `:1268` is the upstream line). `c10a` HAN-1 "every request, regardless of fill state" and "split mode can never match" were OVERSTATED (corrected above). The `c10a` "54 diff lines" count for `hypav2.ts` was not reproduced (38 changed lines by `^[<>]`); immaterial. `c10c` cited `HypaV3Modal.svelte` without its directory; the file is `src/lib/Others/HypaV3Modal.svelte`.
- **Gate 2 round 1 hand-back:** said 14 reproducers; the actual count was 15 (SUPA-5 expands to two rows).
- **V3-4 pair:** Gate 2 batch 1 flagged the identical-input pair as advisory (approved); batch-2 round 1 rejected the same flaw as substantive (it also applied to the batch-1 V2 half, per ledger row 5031). The two gate verdicts differ on the same flaw.
- **Hanurai and similarity test files:** batch-2 round 1 states they were not reviewed; they were reviewed only by batch-1 Gate 2 (`[APPROVE]`). Whether those two files changed after that review is UNVERIFIED (no diff against the reviewed copy was taken); round 3 re-ran their counts only (1|3 and 1|1).

## Phase 3 — batch B fixes

Scope: SUPA-1, SUPA-2, SUPA-4, V3-1, TOK-1, UI-1 (2026-10-23). Decisions: `MC-712` 2 to 6 and 8, and `MC-719` 2 and 3 in [lane-cloud-records.md](../lane-cloud-records.md); `MC-719` 1 (SHARED-2 scope) is a batch A note. Evidence is the scratchpad `p3/c10/B/` tree (`plan.md`, `g1/`, `impl/`, `g2/`); line numbers below are the current working tree (HEAD `299ca20` plus uncommitted batch B edits; the plan was written at `e34be1c`). Nothing was committed by this pass.

### Files

Eleven tracked files modified and one untracked new test (`git diff --stat HEAD -- src`: 11 files, 79 insertions, 35 deletions; the untracked test adds 157 lines). The records file and this report are also modified and are listed in the commit:

- Source (6): `src/ts/process/memory/supaMemory.ts`, `taskRateLimiter.ts`, `hypav2.ts`, `hypav3.ts`; `src/lib/Setting/Pages/OtherBotSettings.svelte`; `src/lib/SideBars/Toggles.svelte`.
- Tests (5 edited): `supaMemory.test.ts`, `taskRateLimiter.test.ts`, `hypav2.tokenAccounting.test.ts`, `hypav3.test.ts`, `src/lib/SideBars/Toggles.memoryLabel.svelte.test.ts`.
- Test (1 new, untracked): `src/lib/Setting/Pages/OtherBotSettings.memoryType.svelte.test.ts` (seven tests).

No `en.ts` or other locale change: SUPA-4 reuses the existing hard-coded English literal.

### SUPA-1: HypaMemory v1 counts the loaded summary (`MC-712` 4)

- **Change:** `supaMemory.ts:109` adds `currentTokens += await tokenize(supaMemory)` after the hypa branch loads the summary, mirroring the plain branch (`:137`). Single caller: `index.svelte.ts` `supaMemory(...)`.
- **Decision:** "Count it (Recommended)". The option said: add the loaded summary's tokens on the v1 path as the plain path does.
- **Test flipped** (`it.fails` to `it`): `the returned token count includes the loaded summary`. Pre-fix failure in `impl/red.txt`: `expected 441 to be greater than or equal to 821`.
- **Mutant:** skip the add; the flipped test fails (`impl/mut1.txt`).
- **Visible effect:** with HypaMemory v1 and a stored summary, the returned token count is larger by the summary size, so summarising starts sooner when over the limit. The previous underflow (later subtraction of tokens never added, `supaMemory.ts:338`) is the traced cause (plan.md, REASONED from source; Gate 1 checked the single caller and the hypa-branch placement).

### SUPA-2: results joined with newlines (`MC-712` 5)

- **Change:** `supaMemory.ts:165` `s.slice(0,3).join('\n')`. The oldest-four query is unchanged by decision.
- **Decision:** "Keep query, fix the join". The option said: treat the oldest-4 query as intended; join the results with newlines instead of commas.
- **Test flipped:** `retrieved results are joined with newlines` (pre-fix: `expected 'past events: a,b,c' to contain 'a\nb\nc'`). Existing guard (oldest four queried, three kept) stays green.
- **Mutant:** `join(',')`; the flipped test fails.
- **Visible effect:** the model sees newline-separated retrieved items in the "past events" block instead of a comma run.

### SUPA-4: error instead of an endless loop (`MC-712` 6)

- **Change:** `supaMemory.ts:358-364`, inside the `(chunkSize + tokens) > maxChunkSize` branch where `stringlizedChat === ''`: when the leading entry's role is `system` or `function` (nothing can be taken), return `{ currentTokens, chats, error: "Not Enough Tokens to summarize in SupaMemory" }`, the same literal as the existing returns at `:327`. The caller already throws on `error` and aborts the send.
- **Decision:** "Exit with an error (Recommended)". The option said: when an iteration makes no progress, stop and return the existing "Not Enough Tokens to summarize" style error instead of looping.
- **Plan history:** Gate 1 round 1 was `[REJECT]` on the plan's post-loop guard (`spiceLen === 0 && stringlizedChat === ''`): the `!cont` path that summarises an oversized loaded summary alone also leaves both at their reset values and then legitimately ends the pass, so the post-loop guard would fail sends that succeed today. The plan was changed to the in-branch return; round 2 was `[APPROVE]` (`g1/result-r2.md`). Round 2 noted a residual: when `maxChunkSize` has shrunk after a summary-only pass, the summary produced in that pass is discarded by the early return; the caller aborts and nothing is persisted because the memory is not returned (REASONED by the reviewer, not run).
- **Test flipped:** `a leading system entry larger than the chunk size returns an error instead of looping` (pre-fix: `expected true to be false`, i.e. the looping tokenizer guard tripped). **New guards** (pass before and after; compatibility guards, not reproducers): `guard: an oversized leading user message is still summarised alone`; `guard: summarising an oversized loaded summary alone brings the count under the limit without an error`.
- **Mutants:** guard removed, flipped test fails. Guard moved after the loop: flipped test fails (`mut1.txt`), and in a combined run the loaded-summary guard fails plus the three hypa tests (`mut1.txt`, `g2/mutpost.txt` per Gate 2). Gate 2 notes the coupling is real, not isolation: with SUPA-1 applied the hypa fixtures exceed the limit and take the summarise-summary-alone path that the misplaced guard wrongly errors on.
- **Visible effect (new error case):** a system or function entry at the head of the remaining chat that alone exceeds the summarisation chunk size now fails the send with "Not Enough Tokens to summarize in SupaMemory" (hard-coded English, not an `en.ts` key) rather than hanging. Reachability stays low (tiny chunk size setting), as recorded in Phase 2.

### V3-1: rate limiter accepts concurrency above RPM (`MC-712` 2)

- **Change:** `taskRateLimiter.ts` constructor (now `:31-38`): the `maxConcurrentTasks > tasksPerMinute` throw is deleted. The queue still enforces both caps independently (Gate 1, REASONED; confirmed by the new RPM test).
- **Decision:** "Allow it (Recommended)". The option said: drop the check; the RPM window already gates task starts; no UI change.
- **Tests flipped:** `a concurrency cap above the per-minute count constructs without throwing`; `tasks run to completion when the concurrency cap is above the per-minute count` (pre-fix: `maxConcurrentTasks must be less than tasksPerMinute`). **New:** `the per-minute count still gates task starts` (fake timers, RPM 1 and concurrency 10: one start at 30 s, second after 61 s); it throws at construction before the fix, so it is both a reproducer and an RPM guard.
- **Mutants:** restore the throw (all three tests fail); delete the RPM timestamps check (the new test fails) (`mut1.txt`).
- **Visible effect:** in the experimental HypaV3 implementation, a setup whose summarisation (sub-model only) or embedding (when Similar Memory Ratio is above 0) concurrency exceeds its requests per minute no longer fails with the `[HypaV3]`-prefixed constructor error; RPM becomes the binding limit. The standard implementation never passed the UI values to the limiter. Callers: `hypav3.ts` (two sites, both in the experimental function) and `hypamemoryv2.ts` defaults.

### TOK-1: V2/V3 keep the response reservation (`MC-712` 3)

- **Change:** deleted `currentTokens -= db.maxResponse` in `hypav2.ts` (after the `mainChunks: []` initialiser, former `:371-374` with its "temporary fix" comment) and the "Initial token correction" subtraction at both `hypav3.ts` sites (experimental and standard paths). `grep maxResponse` in `hypav2.ts` and `hypav3.ts` now returns no match; `index.svelte.ts` still seeds `currentTokens` with `maxResponse + 50` (Gate 2, read).
- **Decision:** "Input + response (Recommended)". The option said: V2/V3 stop subtracting Max Response, matching the other memory systems and the no-memory path; their prompts get Max Response tokens shorter.
- **Tests flipped (3):** `the returned token count keeps the response reservation of the input count` in `hypav2.tokenAccounting.test.ts` and, for both the standard and experimental paths, in `hypav3.test.ts` (pre-fix: `expected 60/50 >= 150` x3). No exact-budget assertion needed re-baselining: the other tests in those files were unchanged and still pass (`impl/final.txt`).
- **Mutants:** restore the subtraction at the V2 site, V3 site 1 and V3 site 2; each makes its flipped test fail (`mut1.txt`, `mut2.txt`).
- **Visible effect:** V2 and V3 now target input plus response within Max Context, like SupaMemory, Hanurai and the no-memory path. Their prompts are up to Max Response tokens shorter, and summarisation and V3's ratio budgets start earlier. Whether a provider behaves differently with the shorter prompt was not tested.

### UI-1: dropdown order and toggle label and visibility (`MC-712` 8; `MC-719` 2, 3)

- **Change:** `OtherBotSettings.svelte:1015-1019`: dropdown value is Hanurai, then V2, then V3, then Supa, else none (runtime order). `Toggles.svelte:192` and `:207` (visibility) add `DBState.db.hypav2`; `:194` and `:209` (label) become `hanuraiEnable ? hanuraiMemory : (hypav2 || hypaV3 || hypaMemory) ? ToggleHypaMemory : ToggleSuperMemory`.
- **Decisions:** `MC-712` 8, "Dropdown follows runtime (Recommended)": align the dropdown expression to the runtime order, and give V2 the Hypa toggle label; no saved data changes. `MC-719` 2, "Follow runtime order (Recommended)": order the label checks as the runtime does (Hanurai, then Hypa V2/V3, then Supa); with Hanurai+V3 on, the label says Hanurai. `MC-719` 3, "Yes, show it (Recommended)": add V2 to the toggle's visibility condition at the same two render sites; no saved data changes (a same-cause scope amendment, `MC-091`).
- **Tests flipped:** `HypaMemory V2 shows the Hypa label` (`test.fails` to `test`, per layout). **New in `Toggles.memoryLabel.svelte.test.ts`, per layout (plain and container):** `Hanurai together with HypaMemory V3 shows the Hanurai label` and `a HypaMemory V2 database without a SupaMemory model still shows the memory toggle` (reproducers); `guard: Hanurai alone shows the Hanurai label`. **New file, `OtherBotSettings.memoryType.svelte.test.ts`:** four reproducers (Hanurai+V3, Hanurai+V2, V2+V3, Hanurai+Supa) and three guards (V3+Supa shows V3, Supa alone, none). This closes the Phase 2 residual that the dropdown half was untested. Pre-fix failures included `expected hypaV3 to be hanuraiMemory/hypaV2`.
- **Mutants:** dropdown original order (4 dropdown tests fail); label without `hypav2` (4 Toggles tests fail); visibility without `hypav2` (1 test fails); label original order (2 tests fail) (`mut2.txt`).
- **Visible effect:** Hanurai+V3 now shows "Hanurai" instead of the Hypa label; a V2-only setup with summarizer type `none` now shows the toggle (labelled Hypa); the Type dropdown shows what the runtime runs when several flags are set. The dropdown `onchange` is untouched, so multi-flag states still arise only from imported or older databases (INFERRED in Phase 2, no writer traced).

### Upstream status

All six defects are present upstream as well (Phase 2 UPSTREAM-SAME labels, `MC-069`), so these are fork-only fixes. No format, plugin or `.bin` contract is touched (`MC-175`); upstream backups open unchanged.

### Saved data

No saved-data change: none of the six edits writes, migrates or reads a new field (Gate 1 and Gate 2, REASONED from source). Existing HypaV3 summaries are untouched; TOK-1 and SUPA-1 only change when new summaries are triggered.

### Verification run

- **Red-first (executed):** unmodified source with the flipped and new tests: 19 failed, 29 passed, 8 expected fail across 6 files, each failure on its intended assertion (`impl/red.txt`). Gate 2 repeated the source-reverted run: 19 failed, then restored (md5 verified).
- **After the fix (executed):** `pnpm vitest run` over `src/ts/process/memory`, `src/lib/SideBars`, `src/lib/Setting`: 79 files, 1077 passed, 19 expected fail (`impl/final.txt`; the expected fails are other items, such as SUPA-3). Importer run: 174 files, 4361 passed, 1 skipped (`impl/importers.txt`). Gate 2's targeted run: 6 files, 48 passed, 8 expected fail. `pnpm check`: 0 errors, 0 warnings (`impl/check.txt`, `g2/check.txt`).
- **Gates:** Gate 1 round 1 `[REJECT]` (SUPA-4), round 2 `[APPROVE]`; Gate 2 `[APPROVE]`, with its own post-loop mutant. Line endings kept (CR counts equal HEAD, Gate 2).

### Residuals

- The Toggles and Type-dropdown tests run under happy-dom (component mount, no real browser).
- The full `pnpm test` and the relevant build have not been run on this snapshot; they are pending at phase close.
- No real-device check (desktop or mobile) of the toggle, dropdown, rate limiter or prompt sizes.
- The summariser, embeddings, database and tokenizer are mocked in the memory tests; results show control flow, not provider behaviour.
- Round 2 residual for SUPA-4 (summary discarded on the shrunken-chunk early return) is reasoned, not run.
- Batch B ledger rows are 5069, 5071, 5074, 5076, 5079 and 5080 in the records file (rows 5070, 5072, 5073, 5075, 5077 and 5078 in the same run are batch A and C). Token figures are the subagent usage in the rows; row 5079 has none recorded.

## Phase 3 — stage A1 fixes

Scope: HAN-1, HAN-2, V2-3, V2-5, SHARED-1, V3-5 (2026-10-23). Decisions: `MC-711` 4 and `MC-713` 3 to 6 in [lane-cloud-records.md](../lane-cloud-records.md). Evidence is the scratchpad `p3/c10/` tree (`A/plan.md`, `A/g1/`, `A1/impl/`, `A1/g2/`); line numbers below are the current working tree (HEAD `10a4adf` plus uncommitted edits; the plan was written at `e34be1c`). Nothing was committed by this pass. Stage A1 is the first of three stages the plan split batch A into (A2 SHARED-2, A3 V3-2 and V3-3 are not in this section).

### Files

Eight tracked files, `+118/-30` (`A1/impl/diffstat.txt`):

- Source (4): `src/ts/process/memory/hanuraiMemory.ts`, `hypav2.ts`, `hypamemory.ts`, `hypav3.ts`.
- Tests (4): `hanuraiMemory.test.ts`, `hypav2.test.ts`, `hypamemory.similarity.test.ts`, `hypav3.test.ts`.

The records file `Agents/Lanes/lane-cloud-records.md` and this report are also modified and are listed in the commit (the records file carries `MC-722`, the stage A1 status line and ledger rows 5083 to 5087; row 5083 is the batch C Gate 1 round 2 review that led to `MC-722`, rows 5084 to 5087 are stage A1).

### HAN-1: Hanurai prefix off by one (`MC-713` 4)

- **Change:** `hanuraiMemory.ts:9` adds `const documentPrefix = 'search_document: '` (17 characters); it is used at the two push sites (`:35`, `:39`) and as `substring(documentPrefix.length)` at `:95` (the old code used `substring(16)` at three sites, leaving a leading space, so `chat.content === text` never matched). The prompt is now described by a `promptTexts` set built at `:76-91` from the final `chats`: trimmed content, plus every trimmed non-empty `\n\n` paragraph when `db.hanuraiSplit` is on. A retrieved hit whose text is in the set is skipped (`:96`). The single caller is the memory dispatch in `index.svelte.ts` (plan, traced); the return shape is unchanged.
- **Decision:** "Fix HAN-1; cap at Chunk Size (Recommended)". The option said: fix the prefix and compare trimmed text, so in-prompt messages are not duplicated; and bound retrieval by Chunk Size.
- **Tests flipped** (`it.fails` to `it`): `does not insert a message the prompt still holds`; `inserted text carries no leading space from the document prefix`. **New** (split mode and whitespace were untested): `does not insert a paragraph of a multi-paragraph message the prompt still holds`; `does not insert a message the prompt holds with surrounding whitespace`; `guard: paragraphs of a message trimmed out of the prompt are retrieved` (the positive control the Gate 1 review required, so the in-prompt reproducers cannot pass vacuously).
- **Mutants:** `substring(16)`: 4 tests fail. In-prompt check removed: 3 fail. Gate 2's own mutant, `promptTexts` built from the retrieved set: 6 fail, including both positive controls; a mutant without the split branch: 1 fail.
- **Visible effect:** Hanurai no longer repeats, in its memory block, a message that is already in the prompt, and the block text no longer starts with a stray space.

### HAN-2: Chunk Size is a cap (`MC-713` 4)

- **Change:** `hanuraiMemory.ts:93` tracks `blockTokens`; `:104-106` `continue` when `blockTokens + tokenized > db.hanuraiTokens` (the "Chunk Size" setting), and `:112` adds to `blockTokens` after the check. The existing `tokens >= maxContextTokens` exit keeps `break` (the cap check sits before the token add, so that exit is unaffected, per Gate 2). The reservation `currentTokens + hanuraiTokens` is unchanged. The per-item `+2` overhead makes the cap slightly conservative against the joined block (noted in the split-mode test comment).
- **Decision:** same as HAN-1 (`MC-713` 4). Gate 1 round 1 was `[REJECT]` on a `break` for the cap: an oversize top hit would empty the block although smaller lower-ranked hits fit. The plan changed to `continue`; round 2 was `[EDITORIAL]` (`A/g1/result-r2.md`) and called this adequate.
- **Tests flipped:** `bounds the retrieved text by the Chunk Size setting` (pre-fix: 93 tokens against a cap of 30). **New:** the same name in the split-mode describe block; `skips a retrieved text larger than the Chunk Size and still retrieves a smaller one`.
- **Mutants:** `break` instead of `continue`: 1 fails (the oversize-skip test). Gate 2: cap removed: 3 fail.
- **Visible effect:** retrieval is capped at Chunk Size and a hit larger than Chunk Size is skipped, so smaller hits can still be used. The block can be shorter than before (intended). A block can still be empty when nothing fits; the existing empty system message in that case is not in scope and its frequency is not measured (plan: "do not make it more frequent without saying so"; TODO(evidence): frequency not measured).

### V2-3: V2 shows the newest summaries (`MC-713` 3)

- **Change:** `hypav2.ts:575-587`: the loop walks `data.mainChunks.slice().reverse()` (newest first), stops at the first chunk that does not fit in `allocatedTokens / 2`, then renders the selected texts in oldest-to-newest order (`reverse()` at `:585`). `mainPromptTokens` keeps its meaning for the later detail budget. The data is not mutated.
- **Decision:** "Newest-first (Recommended)". The option said: select newest summaries first, render them oldest-to-newest.
- **Test flipped:** `shows the newest summary when the summaries exceed half the allocation` (pre-fix: the shown set `[1..5]` lacked 8). Existing guards (all fit, in order; order kept when not all fit) stay green and police the final `reverse()`.
- **Mutant:** without the `reverse()`: 1 fails.
- **Visible effect:** when the summaries exceed half the allocation, V2 shows the newest ones. If the newest summary alone exceeds half the allocation, the summary section is empty; before the fix the same happened for the oldest summary. No test pins the empty-section case (the plan asked for a note or a one-line test; only the note is made here).

### V2-5: dead `regenerateSummary` stub removed (`MC-713` 5)

- **Change:** `hypav2.ts` no longer exports `regenerateSummary` (a body that only read a local variable). Gate 2: no referrer in `src` (only `Agents/` documents mention it). Proof is `pnpm check`: 0 errors, 0 warnings (`A1/impl/check.txt`, `A1/g2/check.txt`). No test.
- **Decision:** "Fix count; delete stub (Recommended)". The option said: deduct skipped entries' tokens; delete the dead `regenerateSummary`. Only the stub half is in A1; the count half (V2-4) moved to batch C by the Orchestrator.
- **Visible effect:** none.

### SHARED-1: sort comparator (`MC-713` 6)

- **Change:** `hypamemory.ts:228` is `(a, b) => b.similarity - a.similarity` (was `a.similarity > b.similarity ? -1 : 0`). The cosine half of `MC-713` 6 is SHARED-2, stage A2, not in this section.
- **Decision:** "Fix comparator; cosine (Recommended)". The option said: use a correct comparator (b - a), and switch to cosine similarity; for unit vectors the ranking is unchanged.
- **Test:** new `guard: results are ordered by descending score and tied documents keep insertion order`. It is a compatibility guard only and has no red-first test: the old comparator never mis-sorted on V8 (the plan's executed probe: 0 mis-sorts in 2000 random trials per size for n = 3 to 300, Node v22.22.0; `A/g1/cmp.js`).
- **Mutant:** the old comparator: 0 tests fail, as planned.
- **Visible effect:** none observed; this is a robustness change.

### V3-5: uniform shuffle (`MC-711` 4)

- **Change:** `hypav3.ts:123-131` adds `shuffle<T>` (Fisher-Yates on a copy, `Math.random` only); `:849` (experimental path) and `:1510` (standard path) replace `.sort(() => Math.random() - 0.5)` with `shuffle(...)` over the same filtered copy.
- **Decision:** "Uniform shuffle (Recommended)". The option said: replace it with a Fisher–Yates shuffle.
- **Tests flipped (2):** `every unselected summary is equally likely to be picked`, standard and experimental (pre-fix: frequency deviation 0.1055 against 0.03). The seeded `Math.random` makes them deterministic.
- **Mutant:** the biased index: 2 fail.
- **Visible effect:** the random-memory summaries picked each turn are uniform over the unselected ones, not biased toward some positions.

### Upstream status

Upstream has the same defects (Phase 2 UPSTREAM-SAME labels, `MC-069`), so this is a fork-only fix. No format, plugin or `.bin` contract is touched (`MC-175`).

### Saved data

No saved data changes: every item alters per-request selection or prompt text only; `hypaV2Data`, `hypaV3Data`, embedding caches and settings keep their shape and meaning (plan; Gate 2 diff read, REASONED from source).

### Verification run

- **Red-first (executed, implementer):** unmodified source with the flipped and new tests: 10 failed, 23 passed, 11 expected fail (`A1/impl/redfirst.txt`). Failing assertions: HAN-1 (inserted duplicates, leading space, split multi-paragraph, untrimmed), HAN-2 (93 above the cap of 30, oversize text present; the 93-above-30 failure occurs in both the plain and the split-mode describe block), V2-3, V3-5 (both paths). Gate 2 repeated the run on HEAD sources with the same counts, then restored the files (md5 matched).
- **Green (executed):** five files (`hanuraiMemory`, `hypav2`, `hypav2.tokenAccounting`, `hypav3`, `hypamemory.similarity`): 37 passed, 12 expected fail, 0 failed (`A1/impl/green.txt`). Gate 2: the memory directory plus three importers, 12 files, 127 passed, 13 expected fail. `pnpm check`: 0 errors, 0 warnings (both).
- **Mutants:** six by the implementer (listed per item above, restored, `cmp` verified) and three by Gate 2.
- **Gate 2:** `[APPROVE]` (`A1/g2/result.md`). Gate 1 for batch A: round 1 `[REJECT]` (the V3-2 and HAN-2 items; HAN-2 is covered above), round 2 `[EDITORIAL]`.

### Residuals

- About 60 importer tests that mock these modules were not run.
- The full `pnpm test` and the relevant build have not been run on this snapshot; they are pending at phase close.
- The embedder, tokenizer and database are mocked; results show control flow, not provider behaviour.
- The empty-section behaviour of V2-3 and the empty-block case of HAN-2 are stated but not pinned by a test.

## Phase 3 — stage A2 fixes

Scope: SHARED-2 (2026-10-23). Decisions: `MC-713` 6 and `MC-719` 1 (with its correction note) in [lane-cloud-records.md](../lane-cloud-records.md). Evidence is the scratchpad `p3/c10/` tree (`A/plan.md` SHARED-2 parts, `A/g1/`, `A2/impl/result.md`, `A2/g2/result.md`) and the `git diff` of the two files below; line numbers are the current working tree. Nothing was committed by this pass. Stage A2 is the second of the three stages batch A was split into (A1 is the section above; A3 is not covered).

### Files

Two tracked files: `src/ts/process/memory/hypamemory.ts` (+4/-2) and `src/ts/process/memory/hypamemory.similarity.test.ts` (+21/-2) (`A2/impl/result.md`; the diff was reread). The records file `Agents/Lanes/lane-cloud-records.md` and this report are also modified and are listed in the commit (the records file carries `MC-723`, the stage A2 status line and ledger rows 5088 to 5093; rows 5089, 5090, 5092 and 5093 are stage A2, rows 5088 and 5091 are batch C and stage A3 planning).

### SHARED-2: the shared retriever scores with cosine

- **Change:** `hypamemory.ts:222` is `const sim = cosineSimilarity` inside `HypaProcesser.similaritySearchVectorWithScore` (was `const sim = similarity`, the raw dot product). `cosineSimilarity` (`hypamemory.ts:251`) gains a zero-magnitude guard at `:260-262`: `const magnitude = Math.sqrt(magA) * Math.sqrt(magB)` and `return magnitude === 0 ? 0 : dot / magnitude`, so a zero vector scores 0 instead of NaN (a NaN would make the sort comparator inconsistent). The implementer reports `cosineSimilarity` has no importer outside `hypamemory.ts`. The exported `similarity` (dot product) and `similarityCheck` are untouched (Gate 2).
- **Decision, `MC-713` 6:** "Fix comparator; cosine (Recommended)". The option said: use a correct comparator (b - a), and switch to cosine similarity; for unit vectors the ranking is unchanged. The comparator half is SHARED-1 (stage A1).
- **Decision, `MC-719` 1:** "Shared retriever only (Recommended)". The option said: switch only the shared HypaProcesser to cosine; V3 similar-memory stays on dot product; no effect on emotion scoring. Correction note in the record: the shared retriever's scores also reach the emotion-image code, and "no effect on emotion scoring" holds only for normalised embeddings.

### Tests (`hypamemory.similarity.test.ts`, 5 tests, all pass)

- **Regression reproducer, flipped:** `ranks a document the same when its vector is scaled by 10 (cosine)` (`:64`, was `it.fails`). Executed red-first on the pre-fix code: it fails with `expected ['far','close'] to deeply equal ['close','far']` (the scaled vector outranks), and the other existing tests passed (2 passed, 1 expected fail before the flip).
- **Guard, not a reproducer:** `scores a zero-vector document 0 and keeps the other documents in order` (`:70`). It passes on the dot product too (0, no NaN), so it guards against a naive cosine; the no-guard mutant fails it. Ties keep insertion order because `Array.prototype.sort` is stable (Gate 2, read).
- **Compatibility guard:** `guard: the exported similarity stays a raw dot product` (`:83`). Passes before and after. It pins `similarity([3, 4], [3, 4]) === 25` and `similarity([10, 0], [2, 5]) === 20`.
- **Mutants (implementer, executed; restored, diff against the fixed copy identical):**

| mutant | result |
|---|---|
| search back to the dot product | scaled-vector test fails |
| zero-magnitude guard removed | zero-vector test fails |
| `similarity()` made cosine | dot-product guard fails |

  Gate 2 ran its own: revert to dot (scale test fails), remove the guard (zero test fails), guard returns 1 (zero test fails), `similarity` made cosine-like (V3 guard fails). The md5 of `hypamemory.ts` (8469698c7873b07580e47c4757ad2a78) was identical before and after.

### Visible effects

- **Normalised embeddings:** scores and ranking are unchanged (cosine equals the dot product for unit vectors). The Transformers embedder uses `normalize: true` (Gate 2, read).
- **Non-normalised Custom Server embeddings:** ranking and score scale change (scores become scale-invariant). Emotion-image selection can change: `index.svelte.ts` subtracts fixed penalties of about 0.005 to 0.025 from the scores and takes the highest, and those penalties now act on a cosine scale. This is a disclosed, accepted effect (`MC-719` correction note); it is not "no effect".
- **Other consumers:** Gate 2 found `hanuraiMemory`, `hypav2`, `scripts`, `triggers`, `addinfo`, `multisend`, `scriptings`, `graphmem` and `supaMemory` rank only, with no score thresholds (Gate 2, read; absence of a threshold user is within the searched consumers).
- **HypaV3 similar-memory: unchanged.** `HypaProcesserEx.similaritySearchScoredEx` imports `similarity` from `hypamemory` and calls it directly, so it does not go through the changed method and stays on the dot product (Gate 2, traced from source). The main V3 search uses `HypaProcessorV2` (`hypamemoryv2.ts`, its own private `similarity`).

### Upstream status

Upstream has the same dot product, so this is a fork-only fix (verified in the upstream checkout at f50b594: `hypamemory.ts:211` is `const sim = similarity` and `similarity` at `:232` sums `a[i] * b[i]`). No format, plugin or `.bin` contract is touched (`MC-175`).

### Saved data

No saved data changes: the change affects per-request scoring only; embedding caches and memory data keep their shape and meaning (Gate 2 diff read, REASONED from source).

### Verification run

- **Green (executed, implementer):** `hypamemory.similarity.test.ts` 5/5. Importer files (the implementer's pattern list: hypamemory, hypav2, hanurai, supa, graphmem, scriptings, triggers, scripts, multisend, addinfo, PlaygroundEmbedding, index.svelte): the result file states "230 test files ... 230 passed; 5218 passed | 13 expected fail | 1 skipped". The wording is ambiguous; the file count is not independently confirmed here.
- **Green (executed, Gate 2):** memory, scriptings, files, scriptsMeasure and triggerNestingLimit tests: 24 files, 325 passed, 12 expected fail.
- **`pnpm check` (executed, both):** 0 errors, 0 warnings, exit 0 (Gate 2 with `NODE_OPTIONS=--max-old-space-size=8192`).
- **Gate 2:** `[APPROVE]`, no required changes (`A2/g2/result.md`). Gate 1 for batch A: see the stage A1 section.

### Residuals

- The V3 guard pins the exported `similarity`, not the call site: `HypaProcesserEx` is not exported from `hypav3.ts`, so the test cannot drive `similaritySearchScoredEx`. Repointing the V3 call to `cosineSimilarity` would not be caught (Gate 2: nonblocking).
- The full `pnpm test` and the relevant build have not been run on this snapshot; they are pending at phase close.
- Embedder and storage are mocked; results show control flow, not provider behaviour. NaN input vectors are out of scope (Gate 2).
- The emotion-selection change for non-normalised Custom Server embeddings is reasoned from source; no test measures it.

## Phase 3 — stage A3 fixes

Scope: V3-2 and V3-3 (2026-10-23). Decisions: `MC-711` 2 and 3, `MC-722` 1 and `MC-723` in [lane-cloud-records.md](../lane-cloud-records.md). Evidence is the scratchpad `p3/c10/` tree (`A/a3-plan.md`, `C/advisor2/result.md` (the rule), `C/g1r3/result.md` (Gate 1, A3 `[EDITORIAL]`), `A3/impl/result.md` and its logs, `A3/g2/result.md` (Gate 2 `[EDITORIAL]`), `A3/ed/result.md` (the editorial)) and the `git diff` of the files below; line numbers are the current working tree (HEAD ffc5fc2 plus uncommitted edits). Nothing was committed by this pass. Stage A3 is the third stage of batch A (A1 and A2 are the sections above). Gate 1 and Gate 2 were both `[EDITORIAL]`; the Gate 2 corrections E1 to E4 were applied (`A3/ed/result.md`), with no new gate round.

### Files

Four tracked files (`git diff --stat`: 191 insertions, 46 deletions) and two untracked new files:

- `src/ts/process/memory/hypav3.ts` (+36/-27 by `git diff --numstat`; both resume sites and the standard batching loop);
- `src/ts/process/memory/hypaResume.ts` (new, 62 lines) and `src/ts/process/memory/hypaResume.test.ts` (new, untracked);
- `src/ts/process/memory/hypav3.test.ts`;
- `src/ts/process/coldstorageData.ts` (comments only);
- `src/ts/process/tests/coldStorageDeletionGuards.svelte.test.ts` (one comment).

The records file `Agents/Lanes/lane-cloud-records.md` and this report are also modified and are listed in the commit. The records file carries the stage A3 status line, CHORE-501 and ledger rows 5094 to 5102. Rows 5094, 5095, 5097 and 5098 are batch C planning; rows 5096, 5099, 5100 and 5101 are stage A3; row 5102 is added by the Orchestrator. `hypav2.ts` is untouched.

### V3-2: resume after the highest covered message (`MC-711` 2, `MC-722` 1, `MC-723`)

- **Change:**
  - New pure module `hypaResume.ts` (imports only `type OpenAIChat`). `isSkipEligibleChat` (`:7`) is true for `example_user` / `example_assistant` names, `NewChatExample` / `NewChat` memos and blank content. `findResumeIndex(chats, memoSets)` (`:28`) builds the first-index position of every memo in `chats` (`undefined` included), deletes the `undefined` key when the first memo-less chat is skip-eligible (`:40-47`), and returns the maximum position over every memo of every set, or -1 (`:49-61`).
  - Both V3 resume sites call it with `chats, data.summaries.map((summary) => summary.chatMemos)`: experimental `hypav3.ts:232`, standard `hypav3.ts:1009`. `startIdx = lastChatIndex + 1` and the token deduction over `chats.slice(0, lastChatIndex + 1)` are unchanged. The old code compared against the last memo of the last summary.
  - The helper lives in a new module rather than in `hypav3.ts` (plan choice, accepted by the Orchestrator): `hypav2.test.ts` does not mock `stores.svelte` / `webllm`, which `hypav3.ts` imports, so a V2 import from `hypav3.ts` would load that graph in every V2 test. V2 (batch C) will import the same helper.
  - `coldstorageData.ts` comments (two hunks holding three comment edits, no behaviour change) now say the resume point is the highest position, in the sent chat list, of any memo of any summary, and that an empty-memo summary covers nothing and contributes no position. `coldStorageDeletionGuards.svelte.test.ts` has the matching comment.
- **Decision, `MC-711` 2:** "Resume from max covered (Recommended)". The option said: base the resume point on the latest message covered by any summary, not only the last summary.
- **Decision, `MC-722` 1:** "Re-summarise, never lose (Recommended)". The option said: when it cannot tell, treat the greeting as not yet summarised; the worst case is the greeting summarised twice, costing an extra call; nothing is lost.
- **Decision, `MC-723` 1:** "Accept and report (Recommended)". The option said: keep the rule and record this as a known limitation; a few repeat summaries of the greeting in this rare setup; no loss; summary sizes stay as configured. The case: with example turns and a batch that is the greeting alone (V3: one message per summary), each send can summarise the greeting again until the chat grows by about the greeting's length.
- **Rule source:** `C/advisor2/result.md` (senior-advisor, adopted). Root cause: `undefined` is one key for every memo-less chat, and upstream V2 can cover example turns, so an upstream Set `{undefined}` may mean examples only. Mapping `undefined` to the first non-skipped chat risks silent greeting loss (advisor probe P4); ignoring it re-summarises the greeting on every send for unambiguous data (N1).
- **Tests (red-first, `A3/impl/result.md`):** on unmodified source with tests flipped or added, 7 failed, 30 passed, 2 expected fail (39); Gate 2 reproduced it against a HEAD copy (`A3/g2/red.log`). Each failure is on its intended assertion.
  - **Reproducers that flipped (`it.fails` to `it`, `hypav3.test.ts`):** `summaries not ordered by coverage resume after the latest covered message`, standard (`:172`) and experimental (`:291`). Failure: fed `[1..5]` / `[4,5]` where `[]` was expected.
  - **New reproducers:** `a summary Set listing the latest memo first resumes after the latest position` (`:375`, both paths); `example turns before the greeting keep the example-only {undefined} summary from skipping them` (`:397`, both paths; fails because plain `findIndex` resumes at the first example turn).
  - **Compatibility guards (pass before and after):** the greeting-only sole summary in stored-null and in-memory-undefined shapes (`it.each` at `:385`); `example turns before the greeting: the greeting is still summarised after an example-only {undefined} summary` (`:407`); `guard: a set holding only the NewChat marker keeps the greeting` (`:415`); `guard: a set that reaches message ids decides by ids and does not feed the greeting again` (`:422`).
  - **Bounded-repeat guard (`MC-723`):** `guard: a greeting-only batch with examples present is not fed again on the second send in this fixture` (`:433`). Its comment states the accepted limitation: at a max context of 120 this fixture shows no repeat on the second send; at 250 the greeting is fed again on that send (Gate 2 probe `n3/`: with `maxChatsPerSummary` 1, examples and four sends, the greeting is fed `[1,0,0,0]` for max 140 to 240 and `[1,1,0,0]` at 250, identical at HEAD). Repeats are bounded and lose nothing.
  - **`hypaResume.test.ts`** (new, no mocks, no red-first run because the module is absent at base): `isSkipEligibleChat` branches (`it.each`) and `findResumeIndex` rows: -1 with no covered memo, maximum across sets, independence from Set order, absent memos ignored, `undefined` kept when the first memo-less chat is the greeting, kept when only memo-bearing marker chats precede it, dropped for an example turn, a defined memo past the greeting dominates, `undefined` wins only while nothing defined lies further on.
- **Mutants:**

| mutant | implementer | Gate 2 |
|---|---|---|
| skip `undefined` always | 7 fail (3 `hypaResume` rows, greeting-only guard x4) | not run (advisor N1) |
| map `undefined` to the first non-skipped chat | 6 fail (2 helper rows, example-in-prompt x2, greeting-still-summarised x2) | first-memo-less check on `chats[0]` instead: 7 fail |
| plain `findIndex` (no delete) | 4 fail | covered by the above |
| last memo only, in the helper | 11 fail | last-position map: 6 fail |
| `min` instead of `max` | 11 fail | not run |
| last memo only at both V3 sites | 6 fail | exp site only: 1 fail; std site only: 1 fail |
| helper without the blank branch | not run | 2 fail |

  The "greeting still summarised" test is a guard, not a HEAD reproducer, but it is what kills the first-non-skipped mutant.

### V3-3: the standard path counts summarised messages only (`MC-711` 3)

- **Change:** the fixed window (`endIdx = min(startIdx + maxChatsPerSummary, ...)` and `for (i = startIdx; i < endIdx; i++)`) and its `End Index` / `Chat Count` log lines are removed. The standard loop is now the experimental loop: `let currentIndex = startIdx` (`hypav3.ts:1075`), `while (toSummarize.length < settings.maxChatsPerSummary && currentIndex < chats.length - settings.queryChatCount)` (`:1094-1095`), the same four skip rules, token accrual for every examined chat, `currentIndex++` on every path (`:1148`), and `startIdx = currentIndex` (`:1196`). The experimental loop (`:295`, `:365`, `:394`) already matched and has no change.
- **Termination invariant:** a comment above the standard loop (`:1090`) states that it terminates because `maxChatsPerSummary >= 1` (the UI enforces a minimum of 1). At 0 (or NaN) both HEAD and the new code spin; this is pre-existing (Gate 1, Gate 2).
- **Decision, `MC-711` 3:** "Code: std path counts". The option said: make the standard path count only summarized messages, as the experimental path does, so the help text becomes true.
- **Tests:**
  - **Reproducer, flipped:** `with the user-message option a batch holds maxChatsPerSummary non-user messages` (`hypav3.test.ts:205`, was `it.fails`). It fails on the pre-fix source with `['assistant']` where three assistants are expected.
  - **Compatibility guards (pass before and after; Gate 1 label correction):** `a batch window made only of skipped chats` (`:448`): `guard: blank chats fill the first window and a later batch is still summarised` and `guard: user messages fill the first window with the user-message option and a later batch is still summarised`. The tokenizer in these tests throws after a fixed call count, so a loop that stops advancing fails instead of spinning on microtasks. Their value is the `currentIndex++` mutant.
- **Mutants:**

| mutant | result |
|---|---|
| restore the `endIdx` window (std) | implementer: 1 fail (the batch-size reproducer) |
| drop `currentIndex++` (std and exp) | implementer: the full `hypav3.test.ts` run OOMs the worker (older tests with skipped chats spin); only the skipped-window describe: 2 fail each, "tokenizer call limit: window stopped advancing". Gate 2 (std): subset 2 fail, full file OOM, vitest exit 1 |
| std counts examined chats | Gate 2: 1 fail |
| std `startIdx += pushed count` | Gate 2: 1 fail |
| std `<=` on the `queryChatCount` bound | **Gate 2: SURVIVED** |
| std pushes blank chats | **Gate 2: SURVIVED** |

  The two survivors are in unchanged skip rules: a test gap around existing semantics, not a defect in the change. `fedIndexes` cannot see blank chats, so the blank-window guard does not assert they are not fed (Gate 2 suggestion; not done).

### Visible effects

- **A bulk re-summarise no longer re-summarises.** V3 resumes after the highest position of any covered memo. A non-contiguous bulk selection that includes the newest summary used to move the resume point back (V3-2); it now does not. A summary Set listing the latest memo first also no longer moves it.
- **The greeting is never lost.** An ambiguous `{undefined}` summary is not counted when an example turn precedes the greeting (`MC-722` 1). Gate 2 probes: upstream example-only `{undefined}` keeps the greeting summarised and the example turns in the prompt; `{'NewChat'}` marker-only keeps the greeting; sets that reach ids decide by ids.
- **Bounded repeat greeting summaries with example turns (`MC-723`).** With examples present and a greeting-only batch, the greeting can be summarised again on a later send. It is bounded and loses nothing (probe above).
- **Standard path, "Do Not Summarize User Message":** the batch now holds `maxChatsPerSummary` summarised messages; skipped (user, blank, example, new-chat) messages no longer use up slots. The help text is now true for both paths. Gate 2 saw the difference only where skipped chats sit in a window: `greet-m3` std (first batch `{undefined,m0}` became `{undefined,m0,m1}`) and `user-opt-m3` std (six short batches became three full ones), now equal to the experimental path.
- **Ordinary chats behave identically to HEAD** (Gate 2, executed, seven configurations, standard and experimental): fed inputs, saved memo sets, output chats and `currentTokens` were identical when no chat is skip-eligible and the user option is off.

### Saved data

- **Which messages are summarised changes**: the resume point and the standard batch contents differ from HEAD for the cases above. A saved chat's existing summaries are not rewritten or repaired on load (`MC-011`).
- **The `hypaV3Data` shape is unchanged**: `toSerializableHypaV3Data` / `toHypaV3Data` and the pushed summary shape are untouched (Gate 2 diff read). Stored `null` memos map back to `undefined` in the existing loader, and both shapes were executed (greeting-only sole summary, null and undefined).
- **Upstream data works (`MC-175`):** upstream-shaped sets (example-only `{undefined}`, `{'NewChat'}`, sets reaching ids, latest-first order) were executed and keep the greeting; the helper adds no sentinel memo or field. `lastChatMemo` handling is not touched.

### Upstream status

Upstream has the same defects, so this is a fork-only fix. Verified in the upstream checkout at f50b594 (`/home/user/kwaroran/risuai`, `git rev-parse` gives f50b594): `src/ts/process/memory/hypav3.ts` resumes from `[...lastSummary.chatMemos].at(-1)` (`:219-221` experimental, `:998-1000` standard) and the standard path still has `endIdx` (`:1063`, loop `:1086`, `startIdx = endIdx` `:1177`); there is no `hypaResume`-like file in that `memory/` directory. Not checked: the upstream `HypaV3Modal` splice line (cited from the earlier V3-2 finding). No format, plugin or `.bin` contract is touched (`MC-175`).

### Verification run

- **Red-first (executed, implementer and Gate 2):** 7 failed, 30 passed, 2 expected fail (39); see V3-2.
- **Green (executed, implementer, before the editorial):** `hypav3.test.ts` + `hypaResume.test.ts`: 55 passed + 2 expected fail (the two V3-4 `it.fails`, untouched); targeted memory dir + cold storage: 12 files, 166 passed, 9 expected fail.
- **Green (executed, Gate 2):** memory dir and every test file importing or mocking `hypav3`, `hypaResume` or `coldstorageData`: 107 files, 2926 passed, 11 expected fail, 1 skipped, exit 0.
- **After the editorial (executed, `A3/ed/result.md`):** `hypav3.test.ts`, `hypaResume.test.ts`, `coldStorageDeletionGuards.svelte.test.ts`: 3 files, 113 passed, 2 expected fail, 1 skipped (116).
- **`pnpm check` (executed, implementer, Gate 2 and after the editorial):** 0 errors, 0 warnings (with `NODE_OPTIONS=--max-old-space-size=8192`).
- **Gate 2 probes (executed):** HEAD copy against the real module on both paths, with `useExperimentalImpl: true` for the experimental path. Current code passes P4, P4b, P4u, N1, N2, N6, N7, N8; HEAD fails P4u and N8. P5 and P6 fail at both HEAD and the current code: they are batch C (C2, `cleanOrphanedSummary`), not A3.
- **Gate 2:** `[EDITORIAL]` (E1 to E4 applied). Gate 1 for A3: `[EDITORIAL]` (`C/g1r3/result.md`; its A3 corrections were folded into the plan).

### Residuals

- **CHORE-501 (proposed):** `getNextSummarizationTarget` in `src/lib/Others/HypaV3Modal/modal-footer.svelte` still uses the last summary's last memo. This display-only preview can disagree with the real resume point for unordered or latest-first sets. No data effect. Not fixed; see the records file.
- **Full `pnpm test` and the relevant build have not been run** on this snapshot; they are pending at phase close. The multi-file runs above are targeted (importers of the changed modules), not the full suite.
- **Mutant survivors:** the `queryChatCount` bound `<=` and the std blank-push mutants survive in unchanged skip rules (above).
- **`currentIndex++` mutant:** it OOMs the full test file (loud failure: worker heap, vitest exit 1, not a silent pass). Attribution comes from the bounded-tokenizer guards. Real code cannot reach it under the loop guard.
- **Probe-template flag:** the advisor and Gate 1 probe templates set `enableExperimentalMode`, which is not a HypaV3 setting (`useExperimentalImpl` is), so their "experimental" rows ran the standard path. Gate 2 re-ran with the real flag and reached the same table. The experimental-path evidence for A3 therefore rests on the Gate 2 run.
- **Implementer's in-repo mutants:** `mut.py` wrote mutants into the repository files and restored them; gates.md asks for in-memory or scratch substitution. The restore was confirmed byte-identical (`cmp` against `hypav3.good` / `hypaResume.good`, and md5, Gate 2).
- **Upstream `trimStartNewChat` without examples:** upstream skips the greeting at index 0 and never covers it; the fork's resume then drops it from the prompt. Pre-existing upstream behaviour (advisor).
- **Examples removed after an example-only summary:** `{undefined}` is then read as the greeting. The data looks unambiguous; accepted.
- **Messages unhidden after surrounding summarisation:** sliced without coverage under any max rule; pre-existing, out of scope.
- **One chronological-data corner (plan, not separately executed):** when the last summary ends on `undefined`, there are two memo-less chats and an earlier summary covers a later defined memo, the new code resumes after that later memo (decided, `MC-711` 2).
- **Two copies of the skip predicate:** the V3 loops keep inline skip rules and `isSkipEligibleChat` duplicates them. Parity is tested only through the `hypav3.test.ts` example-turn tests; the optional Gate 1 row driving a blank or `NewChat` first memo-less chat through `hypaMemoryV3` was not added (Gate 2).
- **V2-to-V3 conversion:** `HypaV3Modal` conversion copies V2 memos, so the same ambiguity reaches V3; the rule handles it (plan).

## Phase 3 — stage C1 fix

Scope: SUPA-5 (2026-10-23). Decision: `MC-712` 7 in [lane-cloud-records.md](../lane-cloud-records.md). Evidence is the scratchpad `p3/c10/` tree (`C/plan.md` section "C1 SUPA-5", `C1/impl/result.md` and its logs, `C1/g2/result.md` (Gate 2 `[EDITORIAL]`)), the `git diff` of the two files below, and upstream read-only at `/home/user/kwaroran/risuai` f50b594. Line numbers are the current working tree (branch `lane-cloud`, HEAD 5c88496 per Gate 2, plus uncommitted edits). Nothing was committed by this pass. Gate 1 for C1 was `[APPROVE]` (round 2; also round 1 and round 3 per ledger rows 5077, 5083, 5094). Gate 2 was `[EDITORIAL]`; E1 was applied by the Orchestrator with no new gate round.

### Files

- `src/ts/storage/database.svelte.ts` (+5): in `setDatabase`, directly after the `supaModelType` nullish default.
- `src/ts/storage/tests/databaseSupaModelType.test.ts` (+3/-2).
- This report and `Agents/Lanes/lane-cloud-records.md` (the C1 status line and ledger rows 5103 to 5106; the Orchestrator adds 5105 and 5106).

### The change

`database.svelte.ts:257-261`: if `data.supaModelType` is `"davinci"` or `"curie"`, set it to `"instruct35"`. It is an in-memory assignment on the loaded tree and goes through the normal save. The comment reads: "Upstream no longer offers davinci or curie (their OpenAI models are retired); instruct35 is its remaining OpenAI completion option." (Gate 2 E1 found the implementer's first wording, "Upstream offers and reads instruct35 only", false; the Orchestrator reworded it.)

### Decision

`MC-712` 7 (lane-cloud-records.md:194): "SUPA-5 (legacy davinci/curie summarizer values). Answer: **"Migrate to instruct35 (Recommended)"**. The option said: on load, map davinci/curie to the gpt-3.5-turbo-instruct option; the saved value changes; upstream reads it fine."

### Test flip

`databaseSupaModelType.test.ts:124-128`: the `test.fails.each(['davinci', 'curie'])` rows `a saved %s loads as instruct35` became `test.each`. The comment now says only the in-memory value is asserted and persistence is not tested. The 5 guard rows are unchanged.

| Run | Who | Source | Result |
|---|---|---|---|
| Red (executed) | implementer | pre-fix | 5 passed, 2 expected fail (`test.fails.each`) |
| Green (executed) | implementer | fixed | 7 passed |
| Mutant, migration removed (executed) | implementer | HEAD `database.svelte.ts` swapped in | 2 failed (davinci, curie), 5 passed |
| Related (executed) | implementer | fixed | `databaseSupaModelType`, `databaseAccountField`, `risuSave`, `secretFields`: 38 passed |
| Red (executed) | Gate 2, scratch copy | HEAD `database.svelte.ts` with the flipped test | 2 failed, 5 passed; received "davinci" and "curie" |
| Green (executed) | Gate 2, scratch copy | fixed | 7 passed |
| Mutant 1 (executed) | Gate 2, scratch copy | only davinci migrated | 1 failed (curie), 6 passed |
| Mutant 2 (executed) | Gate 2, scratch copy | everything except `subModel` mapped | 3 failed, 4 passed (the guards catch an over-broad mapping) |
| `pnpm check` (executed) | implementer; Gate 2 | in-repo | 0 errors, 0 warnings. Gate 2's first run aborted with an OOM at the default heap; the rerun used `NODE_OPTIONS=--max-old-space-size=6144`, exit 0 |

Many other tests import `setDatabase` but mock it or do not read `supaModelType`; they were not run (implementer).

### Saved data

Changed value: a saved `supaModelType` of `davinci` or `curie` becomes `instruct35`. Gate 2 traced these from source; none was executed end to end.

- Upstream `.bin` into the fork: backup restore calls `setDatabase(dbData)` (backuplocal.ts), so the setting migrates (`MC-175`).
- Fork into upstream: export reads `getDatabase()` (backuplocal.ts:601, :889), which holds the migrated value; upstream offers `instruct35` and reads it as `gpt-3.5-turbo-instruct`, so the backup stays readable (`MC-223`). If an un-migrated value were stored anyway, upstream still reads davinci and curie as before.
- Idempotent: `instruct35` is not in the predicate; the guard row "instruct35 is kept as saved" passes (executed). Presets do not carry the field (plan).
- Load paths: 8 `setDatabase(` calls in `src/ts/bootstrap.ts` (grep of the working tree; Gate 2 counted 7), backup restore, the Google token persist and the plugin `setDatabase(db)` (plugins.svelte.ts:1071), all through `setDatabase`. Plugin `setDatabaseLite` writes (plugins.svelte.ts:1023, :1040) assign `DBState.db` directly after load; that is not a load, and a plugin writing `davinci` still works because the fork keeps its branches.

### Upstream status

Checked at f50b594. Upstream still has the request branches: `hypav2.ts:74-75` and `supaMemory.ts:218` send `text-curie-001` for `curie`, and every other non-`instruct35` value falls through to `text-davinci-003` (Gate 2; E1 confirmed by the Orchestrator per row 5104). Upstream's `OtherBotSettings.svelte` still lists davinci and curie in the OpenAI-key field condition (:1046, :1269, Gate 2) but its selector no longer offers them. Upstream also offers `distilbart` and `subModel`.

### Process notes

- The implementer ran its mutant in the repository file in place (the HEAD copy swapped in for one run, then restored), not on a scratch copy. Gate 2 confirmed the repository file byte-identical to the implementer's `fixed.bak` (`cmp`), diff stat +4 at that time, 0 CR in either file or at HEAD.
- Gate 2 E2 (optional): the test-file header at HEAD says the summariser request "only know[s]" distilbart, instruct35 and subModel, while the fork's `supaMemory.ts` and `hypav2.ts` still branch on `curie`. It was not applied.

### Residuals

- Persistence of the migrated value is untested (in-memory only). Gate 2 did not trace whether root dirty tracking marks the root block right after load (reasoning only; not decision-critical, since every later load migrates again and export reads the in-memory value).
- The curie and davinci branches in `supaMemory.ts` and `hypav2.ts`, and the key-field conditions in `OtherBotSettings.svelte`, are left in the fork. They are unreachable after load except through a plugin write; removing them is optional cleanup (plan).
- The full `pnpm test` and the relevant build have not been run on this snapshot; they are pending at phase close.

## Phase 3 — stage C3 fixes

Scope: V2-1, V2-2 and V2-4, the HypaV2 loader null mapping and the shared resume (2026-10-23). Decisions: `MC-711` 2, `MC-713` 1, 2 and 5, `MC-722` 1 and `MC-723` in [lane-cloud-records.md](../lane-cloud-records.md). Evidence is the scratchpad `p3/c10/` tree (`C/plan.md` sections "C3 V2 loop" and "Gate 1 round 3", premises 1 and 6; `C/advisor2/result.md` (the resume rule); `C3/impl/result.md` and its logs; `C3/g2/result.md` (Gate 2 `[EDITORIAL]`)), the `git diff` of the four code/test files below, the records file, and upstream read-only at `/home/user/kwaroran/risuai` f50b594. Line numbers are the current working tree (branch `lane-cloud`; Gate 2 gives HEAD d6994c7 plus uncommitted edits). Nothing was committed by this pass. Gate 1 for C3 was `[EDITORIAL]` (round 3, folded into the plan); Gate 2 was `[EDITORIAL]`: E1 was applied by the Orchestrator (the NewChat-only-summary test relabelled `guard:` and "compatibility guard (passes at HEAD)"); O1 was not applied. No new gate round followed E1.

### Files

- `src/ts/process/memory/hypav2.ts` (`git diff --stat`: 35 lines changed).
- `src/ts/process/memory/hypav2.test.ts` (173 lines changed).
- `src/ts/process/tests/memorySummarizerSubject.svelte.test.ts` and `src/ts/process/tests/requestOriginMemory.svelte.test.ts` (3 lines changed each: one mock line plus a comment). These two are outside the files the plan named; see "The two mock edits".
- This report and `Agents/Lanes/lane-cloud-records.md`. The records file carries the C3 status line and ledger rows 5107 to 5110; rows 5107 and 5108 exist in the working tree, the Orchestrator adds 5109 and 5110 (TODO(evidence): their content is not in the packet).

### The change (`hypav2.ts`)

- **Resume** (`:390-393`): `findResumeIndex(chats, data.mainChunks.map(c => c.chatMemos))` replaces the lookup of `lastMainChunk.lastChatMemo`. The helper is the A3 module `hypaResume.ts` (see the stage A3 section): maximum position over every memo of every chunk, `undefined` counted only when the first memo-less chat is the greeting. `lastChatMemo` is still written (upstream reads it) and is no longer read here. The token subtraction over `chats.slice(0, lastChatIndex + 1)` and `idx = lastChatIndex + 1` are unchanged, so what is subtracted and what is sent stay complementary (Gate 2).
- **Skip rule** (`:443-447`): `isSkipEligibleChat(chat)` replaces both the `idx === 0` rule and the blank-content rule; a skipped chat adds its `chatTokens` to `skippedTokens`.
- **Per-iteration counter** (`:412-414`): `let skippedTokens = 0` is declared inside the outer `while`, next to `startIdx`.
- **Retry** (`:510-520`): on a retryable failure `idx = startIdx` before the `continue`. A failed iteration changes only locals and `idx`; `data` and `currentTokens` are touched only after the `!summaryData.success` branch (Gate 2, from source). The existing consecutive-failure counter (`:384`, `:510-511`) therefore counts failures on one batch. The non-retryable return and the success reset (`:524`) are unchanged.
- **Success** (`:571`): `currentTokens -= halfDataTokens + skippedTokens`.
- **Loader** (`:337-340`): `toHypaV2Data` maps a stored `null` memo to `undefined` (`new Set(mainChunk.chatMemos.map((memo) => (memo === null ? undefined : memo)))`). It builds a new array and does not mutate `room.hypaV2Data`. Same shape as the `toHypaV3Data` loader.

### Decisions

- `MC-713` 1: "V2-1 (a failed batch followed by a success leaves a permanent coverage gap). Answer: **"Retry same batch (Recommended)"**. The option said: roll back to the batch start and retry it; the existing 3-strike limit then aborts with an error after 3 failures on that batch; nothing is skipped."
- `MC-713` 2: "V2-2 (V2 skips only index 0; example turns and the marker are summarised; the first message can be dropped; memo-less example turns make summaries re-run every turn). Answer: **"Adopt V3's skip rules (Recommended)"**. The option said: skip example turns, the example marker and the new-chat marker as V3 does; only real chat messages are summarized, and the first message is never dropped."
- `MC-713` 5: "V2-4 and V2-5. Answer: **"Fix count; delete stub (Recommended)"**. The option said: deduct skipped entries' tokens; delete the dead `regenerateSummary`." (V2-5 is not in C3; the plan lists it as gone.)
- `MC-711` 2: "V3-2 ... Answer: **"Resume from max covered (Recommended)"**. The option said: base the resume point on the latest message covered by any summary, not only the last summary." (Applied to V2 through the shared helper.)
- `MC-722` 1: "Re-summarise, never lose (Recommended)": "when it cannot tell, treat the greeting as not yet summarised; the worst case is the greeting summarised twice, costing an extra call; nothing is lost."
- `MC-723`: "Accept and report (Recommended)": a repeated greeting summary with example turns and a greeting-only batch is a known limitation, not fixed by overshooting batch sizes.
- The loader mapping has no decision of its own: it is a same-cause amendment under `MC-091` (plan premise 6 and design item 6; mechanism: store2's `toPlainJson` turns `undefined` array members into `null` on save, so `cleanInvalidChunks` drops every greeting-covering summary after a reload while the resume point moves past it; plan probe P1, which fails at HEAD).

### Tests (`hypav2.test.ts`)

Run labels: reproducer = fails at the pre-fix base; guard = may pass before and after. HEAD results are the implementer's executed red-first run (HEAD source substituted for the module, `mut/head.ts`: 11 fail, each on its intended assertion) and Gate 2's independent repeat (same 11, listed as the 5 flips, (a), (b), (c), (g), (j), (l)).

Five `it.fails` became `it` (all reproducers; all fail at HEAD):

| Flipped test | Line |
|---|---|
| `a failed summary batch followed by a success leaves no removed message uncovered` (V2-1) | `:118` |
| `never summarises the example marker, example turns or the new-chat marker` (V2-2) | `:146` |
| `never summarises example turns that have no leading example marker` (V2-2) | `:153` |
| `summarises the first message when the new-chat marker is trimmed and there are no examples` (V2-2; plan item (e)) | `:160` |
| `returns the token count of the chats it returns when it skips a blank message` (V2-4; 70 vs 50 at HEAD) | `:213` |

New tests, lettered as in the plan:

| Item | Test | Line | Label | HEAD result |
|---|---|---|---|---|
| (a) | `retries the same batch after a failed summary` | `:295` | reproducer | FAIL (second input is `m4..`, not `m1..`) |
| (b) | `aborts after three failures on one batch, all three attempts with the same input` | `:304` | reproducer | FAIL (three distinct inputs) |
| (d) | `guard: non-consecutive failures never abort` | `:314` | guard | PASS (the success reset exists at HEAD) |
| (c) | `deducts skipped messages exactly once when a batch fails and is retried` | `:323` | reproducer | FAIL (150 vs 100) |
| (g) | `keeps a greeting-covering summary after the saved data is reloaded` | `:354` | reproducer | FAIL (second call yields `SUMMARY[m3,m4,m5]` instead of keeping `SUMMARY[greeting,m1,m2]`) |
| (j) | `does not re-summarise a greeting covered by the only summary, stored with a null memo` (N1) | `:369` | reproducer | FAIL (greeting fed again) |
| (h) | `guard: a greeting summarised alone is summarised once and not fed again on the next send` (N2, `MC-723` limitation) | `:378` | guard | PASS |
| (i) | `it.each` `guard: the greeting is summarised or kept, not lost, after an example-only summary` (stored `null` and in-memory `undefined`; P4/P4b) | `:391` | guard | PASS, both rows |
| (k) N7 | `guard: feeds the greeting when the only summary covers the new-chat marker` | `:403` | guard | PASS |
| (k) N6 | `guard: a set holding the marker and a real id resumes after the real id` | `:411` | guard | PASS |
| (l) | `resumes after the latest memo of a set that lists it first` (N8) | `:421` | reproducer | FAIL (HEAD resumes after `id1`, so `m3` is fed again) |
| (m) | `guard: a set {id1, undefined} resumes after id1` | `:430` | guard | PASS |

(f), resume with a hidden last memo, belongs to C2.

Plan corrections found by the implementer and confirmed by Gate 2:

- **(k) is a guard, not a reproducer.** Gate 1 round 3 said N6 fails at HEAD. In the implementer's fixture (summary `{'NewChat'}`, chats `[NewChat, greeting, ...]`) HEAD resumes at index 1, the greeting, so N6 and N7 pass at HEAD. Gate 2 E1 found N7 still carried a "regression reproducer" comment and no `guard:` title; the Orchestrator relabelled it. No Gate 2 mutant fails N7, N6 or (m); they guard against a future "treat `NewChat` as covering the greeting" change.
- **(g) and (j) need the NewChat marker before the greeting.** Without it HEAD's `idx === 0` rule skips the greeting first and the failure is on a precondition, not on the intended assertion. With the marker the fixture is the default production shape (no `trimStartNewChat`), HEAD fails on the intended assertion and the loader mutant is still caught (Gate 2).
- (h) fails under implementer mutant m3 only incidentally (token counts) and uses a size-aware tokenizer for its greeting-only batch (implementer doubt, not independently assessed).

The test file adds `summarizer.inputs` (the captured summariser input), an optional tokenizer argument on `callV2`, and the real `toPlainJson` from `store2/codec/normalize` for the reload tests.

### Mutants

Implementer (five mutants on scratch copies via an alias config; repository never mutated; logs `mut-m1.log` to `mut-m5.log`):

| Mutant | Failing tests |
|---|---|
| m1 drop `idx = startIdx` | coverage flip; (a); (b); (c) (4) |
| m2 outer-scope `skippedTokens` | V2-4 blank flip; (c) (2) |
| m3 drop `+ skippedTokens` | V2-4 blank flip; (c); (h) (3) |
| m4 restore the `idx === 0` skip | the three V2-2 flips (3) |
| m5 remove the loader mapping | (g); (j) (2) |

Gate 2 (nine mutants plus HEAD and current on scratch copies; the repository was never mutated; 31 tests per run: `hypav2.test.ts` 29 and `hypav2.tokenAccounting.test.ts` 2):

| Variant | Result |
|---|---|
| current | 31 pass (the C2-owned `it.fails` counts as expected fail) |
| head | 11 fail: the 5 flips, (a), (b), (c), (g), (j), (l) |
| x1 drop `idx = startIdx` | 4 fail: coverage flip, (a), (b), (c) |
| x2 deduct skipped tokens in place (double count on retry) | (c) fails, 140 vs 160 |
| x3 `idx === 0 \|\| isSkipEligibleChat` (only the idx-0 rule restored) | `summarises the first message when the new-chat marker is trimmed` fails |
| x4 resume by the last summary's `lastChatMemo` | (l) fails |
| x5 ignore the `undefined` memo | (j) fails |
| x6 map `undefined` to the first non-skipped memo-less chat | (i), both rows, fail |
| x7 drop the success reset of the failure counter | (d) fails |
| x8 deduct before the success check | (c) fails, 140 vs 190 |
| x9 remove the loader mapping | (g) and (j) fail |

### The two mock edits

`memorySummarizerSubject.svelte.test.ts` and `requestOriginMemory.svelte.test.ts` each gained `async similaritySearchScored() { return [] }` in their `HypaProcesser` mock, and the mock comment now says "similarity steps of hypaV2 and hypaV3". Why: their V2 tests use 10-message conversations whose index-0 message HEAD skipped; it is now summarised, so V2 runs on to the retrieval step, which the mock lacked. Gate 2 executed it on scratch copies of both files at HEAD without the line: against HEAD source 28 of 28 pass; against current source 6 V2 tests fail with `TypeError: processor.similaritySearchScored is not a function`. Their assertions (summariser request bodies and markers) are made before retrieval and the mock returns `[]`, so the edit hides no assertion (Gate 2, from source and execution). `hypav2.tokenAccounting.test.ts` is unchanged.

### Visible effects

- A batch whose summariser call always fails now ends the send with the 3-strike error (`MC-713` 1), where HEAD advanced to the next batch and left a coverage gap. Earlier successes in the same call are discarded when the call aborts; `index.svelte.ts:1549-1553` (Gate 2) throws the error and returns false without assigning `hypaV2Data`, so the next send summarises those messages again (existing behaviour, a plan-stated risk; no loss).
- The greeting is summarised when `chats[0]` is not a NewChat marker. Gate 2's trace of `index.svelte.ts:1279-1324`: `chats[0]` is an example entry (skipped as before; every other example entry is now skipped as well) or, under `trimStartNewChat` or a novelai model without examples, the greeting or the first message. HEAD skipped that entry and then sliced it out, so it was in neither the summary nor the prompt; now it is summarised.
- Summaries that cover the greeting now survive a reload (the loader mapping): HEAD dropped them as orphans while the resume point had already moved past them.
- Example turns, once passed, appear neither summarised nor in the prompt, as in V3 (`chats.slice(idx)` after the resume point). Example turns come from the character card, not from chat messages (Gate 2).
- V2 calls with a first message to summarise reach the retrieval step more often (Gate 2).

### Saved data and compatibility (`MC-175`)

- `hypaV2Data` keeps its shape. New data still holds the greeting's `undefined` memo; store2 saves it as `null` (`hypaV2Data` is a store2 SIDE_FIELD, `store2/legacy/resolve.ts:146`; the plain-JSON normalisation turns `undefined` array members into `null`, `codec/normalize.ts:10-11, 73-78`, the array branch at `:77`) and the loader restores it. `lastChatMemo` is still written.
- Existing saved summaries with `null` memos are now kept after reload (previously dropped). Where such a summary covers only the example region (upstream V2 summarises example turns under the same key), the shared rule's ambiguity branch applies: the greeting is summarised again at worst once, never lost (`MC-722` 1, `MC-723`). No repair on load (`MC-011`).
- Upstream V2 data with `undefined` or `null` memos loads (Gate 2, from source; the upstream-shaped fixtures (i), (k) and (m) were executed). Which messages are summarised changes (saved-memory change); no format change and no new fields.
- The `SerializableHypaV2Data.chatMemos` type stays `string[]`; `memo === null` compiles because `strict` is false (`tsconfig.json:24`, Gate 2). No `any`.

### Upstream status

Checked at f50b594, `src/ts/process/memory/hypav2.ts`: upstream has the same V2 defects: the `idx === 0` skip (`:433-436`) and the blank-content skip (`:440-443`), the failure branch `continue` with `idx` already advanced (`:496-508`, so the batch is not retried), `currentTokens -= halfDataTokens` without the skipped tokens (`:558`), and resume by the last chunk's `lastChatMemo` (`:385-386`). Upstream's V2 loader has no null mapping (`:330`: `new Set(mainChunk.chatMemos)`), so after a JSON round trip upstream also drops greeting-covering summaries; its V3 loader has the mapping (`hypav3.ts:1632-1634`). The V2 fixes are therefore fork-only; no upstream change was proposed here.

### Verification run by the implementer and Gate 2

| Run | Who | Result |
|---|---|---|
| Red-first against HEAD source (executed) | implementer; Gate 2 | 11 fail on intended assertions (the implementer's pre-fix `red.log` shows 12 failed of 29, the 12th being the C2-owned hidden-message test run as a plain `it`) |
| Test file plus `hypav2.tokenAccounting.test.ts` (executed) | Gate 2 | current: 31 pass |
| `src/ts/process/memory` plus both mock-edited files (executed) | Gate 2 | 12 files, 150 passed, 4 expected fail, exit 0 |
| `src/ts/process/memory` plus the 49 test files that mention hypav2 (executed, `importers.log`) | implementer | 57 files passed, 1155 passed, 4 expected fail |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm check` (executed) | implementer; Gate 2 | exit 0, 0 errors, 0 warnings |

Gate 2 did not rerun the importer run; it relied on `importers.log`.

### Residuals

- **Upstream data written by `trimStartNewChat` without examples.** Upstream V2 skips the greeting at index 0 and never covers it; the fork's resume (before and after C3) then slices it out of the prompt. Pre-existing upstream behaviour, not new loss (advisor `C/advisor2/result.md` and Gate 2).
- **`MC-723`.** With example turns and a greeting-only batch, a send can summarise the greeting again until the chat grows by about the greeting's length (advisor probe: 3 sends, one extra paid call each). Accepted and reported. Test (h) is a guard for the once-and-then-stable case, not a proof that the loop cannot occur.
- **Examples removed after an upstream example-only summary was written:** the rule reads `{undefined}` as the greeting (advisor, accepted as a residual).
- **O1 (typing).** `chatMemos` stays `string[]` although saved data holds `null`; `(string | null)[]` would be the same type under the current non-strict configuration and a comment would only be documentation. Not applied (Gate 2: accepted under the no-lazy-type rule).
- **Hidden-message `it.fails`.** `keeps a summary that covers a hidden message` (`hypav2.test.ts:258`) stays `it.fails`; it is C2's.
- **Full suite.** The full `pnpm test` and the relevant build have not been run on this snapshot; they are pending at phase close. Ledger rows 5107 to 5110 record this stage.
- The implementer ran no mutant in the repository; the two mock-edit files are beyond the plan's named files (flagged, accepted by Gate 2).

## Corrections from doc-verifier

This section takes precedence over the body above. Independent doc-verifier pass, 2026-10-23 (scratchpad `p2/c10d/dv/result.md`): ten files rerun (40 passed, 32 expected fail), test titles, decision quotes, REPRODUCED citations and an upstream sample verified; four required corrections, applied in the body by the Orchestrator:

1. `maxSupaChunkSize` UI minimum: the fork line is `src/lib/Setting/Pages/OtherBotSettings.svelte:1279` (`:1268` is blank in the fork; it is the upstream line). The packet was right; the earlier "stale citation" label was wrong.
2. Ledger rows for CHORE-10 are 5018 to 5023 and 5028 to 5036 at the time of this pass (5016, 5017 and 5024 to 5027 are CHORE-09).
3. Records file: an earlier draft of the "For lane A" section named `MC-712` 1 for SUPA-3, gave the range `MC-710` to `MC-713`, and called V2-2 "a diagnostic". The Orchestrator corrected it; it now cites `MC-714`/`MC-715` for SUPA-3, `MC-710` to `MC-715`, and V2-2 as failing assertions including the stored-null case, so the report and the records agree.
4. The modified records file is part of this work (it carries `MC-711` to `MC-715`, the "For lane A" section and the CHORE-10 ledger rows); the environment line is reworded.

Optional, noted: the V3-4 citation `index.svelte.ts:1295,1342,1359` is loose; only `:1295` is the `splitSentMessages` call, `:1342` is the `makeMs` call and `:1359` the message loop.
5. Phase 2 close check (scratchpad `p2/close/dv/result.md`): ledger rows for CHORE-10 are 5018 to 5023 and 5028 to 5037. The range "5018 to 5036" in an earlier version of item 2 and the commit message's "5018-5037" also span the CHORE-09 rows 5024 to 5027; the records file lists the exact rows. The commit message of `ae9edbf` is not amended.

### Batch B (Phase 3)

Independent doc-verifier pass, 2026-10-23 (scratchpad `p3/c10/B/dv/result.md`): about 46 claims checked; six test files rerun (48 passed, 8 expected fail); file:line cites, test titles, decision quotes and upstream status checked. Corrections, applied in the body above: (1) the diff figures are 11 tracked files, 79 insertions, 35 deletions plus a 157-line untracked test; (2) the V3-1 visible effect applies to the experimental HypaV3 implementation only; (3) the SUPA-1 underflow cause is from the plan, not Gate 1; (4) the ledger-row note named the batch B rows. `pnpm check` and the full suite were not rerun by this pass.

### Stage A1 (Phase 3)

Independent doc-verifier pass, 2026-10-23 (scratchpad `p3/c10/A1/dv/result.md`): about 40 claims in the stage A1 section plus `MC-722`, the status line, rows 5083 to 5086 and the commit draft. Five test files rerun: 37 passed, 12 expected fail. File:line cites, test titles, counts, decision quotes and upstream status (f50b594) verified. Corrections, applied in the body above: (1) the records-file sentence in Files; (2) "table above" reworded; (3) red-first failure breakdown. `pnpm check` and the full suite were not rerun by this pass.

### Stage A2 (Phase 3)

Independent doc-verifier pass, 2026-10-23 (scratchpad `p3/c10/A2/dv/result.md`): the stage A2 section, `MC-723`, the status line, rows 5088 to 5092 and the commit draft. Test file rerun: 5 passed; file:line cites, mutant and Gate 2 figures, decision quotes verified; `cosineSimilarity` has no importer outside `hypamemory.ts`. Corrections, applied: (1) upstream dot product verified in the upstream checkout (the TODO is resolved in "Upstream status"); (2) the importer-run figure in row 5089 is the implementer's own, not independently confirmed; (3) the row-range wording names which rows are stage A2. `pnpm check` and the full suite were not rerun by this pass.

### Stage A3 (Phase 3)

Independent doc-verifier check, 2026-10-23 (scratchpad `p3/c10/A3/dv/result.md`; ledger row 5102). About 60 claims checked; the three targeted test files were rerun (113 passed, 2 expected fail, 1 skipped). These corrections take precedence over the text above and have been applied to it:

1. The `coldstorageData.ts` comment change is two hunks holding three comment edits, not four hunks.
2. The greeting-only compatibility guard starts at the `it.each` on `hypav3.test.ts:385`; `:384` is its comment line.
3. Ledger row 5099 (Gate 2) said "7 of 9 own mutants caught". `A3/g2/result.md` lists ten Gate 2 mutants: eight caught and two survived. Row 5099 now says "8 of 10". The mutant table in this report was already correct.

The Gate 2 probes, mutant runs, the 2926-pass run and `pnpm check` were read from their logs and not rerun by the verifier.

### Stage C1 (Phase 3)

Independent doc-verifier check, 2026-10-23 (scratchpad `p3/c10/C1/dv/result.md`; ledger row 5106). About 35 claim groups checked; the test file was rerun (7 passed). These corrections take precedence over the text above and have been applied to it:

1. `src/ts/bootstrap.ts` has 8 `setDatabase(` calls (lines 185, 214, 246, 352, 383, 426, 696, 1237), not 7 as Gate 2 counted. The conclusion that every load path goes through `setDatabase` is unchanged.
2. UNVERIFIABLE from repository or upstream source: that OpenAI retired the davinci and curie models (the code comment and this section say so). It is an external fact; nothing in this stage depends on it.

### Stage C3 (Phase 3)

Independent doc-verifier check, 2026-10-23 (scratchpad `p3/c10/C3/dv/result.md`; ledger row 5110). About 70 claims checked; `hypav2.test.ts` and the two mock-edited files were rerun (3 files, 56 passed, 1 expected fail). These corrections take precedence over the text above and have been applied to it:

1. Ledger rows 5109 and 5110 exist; the stale TODO(evidence) note is removed.
2. The importer run covered `src/ts/process/memory` plus the 49 test files that mention hypav2, which is how it reaches 57 files.
3. Gate 2's "31 tests per run" is `hypav2.test.ts` (29) plus `hypav2.tokenAccounting.test.ts` (2).
4. The store2 normalisation cite is `codec/normalize.ts:10-11, 73-78` (the array branch that writes `null` is at `:77`), not `:66-71` (the cycle check).
5. Upstream f50b594 `hypav2.ts`: the blank-content skip is `:440-443` and the failure branch `:496-508`.
6. Ledger row 5108 said Gate 2 ran ten mutants; it ran nine (plus the HEAD and current variants). Row 5108 is corrected.
7. Ledger row 5107's "5 guards" counts test letters (d, h, i, k, m); those are seven guard test rows, because (i) and (k) have two rows each. Row 5107 is corrected.

The scratchpad logs were read, not rerun; the full suite, `pnpm check` and the build were not run by the verifier.
