# CHORE-10 result (Phase 2): 21 long-term-memory items traced or reproduced, reproducers in ten test files

**Status:** proposed status for lane A to apply: all 21 items investigated with maintainer decisions (`MC-711` to `MC-715`; `MC-712` item 1 is superseded by `MC-714`). 19 items have `it.fails` / `test.fails` reproducers (HAN-1, HAN-2, V2-1 to V2-4, SHARED-2, SUPA-1 to SUPA-5, V3-1 to V3-5, TOK-1, and UI-1 for its label half only), and two items have no test (V2-5, SHARED-1). No application code changed. The reproducers are in ten new, untracked test files. Gate 2 ended `[APPROVE]` in round 3 after two substantive `[REJECT]` rounds. Short entry: [lane-cloud-records.md](../lane-cloud-records.md) (`MC-711` to `MC-715`, ledger rows 5018 to 5036, "For lane A: Phase 2 saved-data risks").

## Question / ticket ask

`Agents/Roadmap.md`, CHORE-10. Phase 2 (`MC-708`): for each long-term-memory item, trace, reproduce or refute; compare with upstream (`MC-069`); put product questions to the maintainer; change no application code.

## Environment

- Fork: `/home/user/RisuTanium`, branch `lane-cloud`. The investigations ran at HEAD `9ded0aa`; the tests and Gate 2 ran at HEAD `04126b6`. `git diff --stat 9ded0aa 04126b6` lists four files (the records file, `CHORE-09-result.md` and two CHORE-09 test files), so no application source differs between the two snapshots, and the investigation citations are taken as valid at `04126b6`. `git diff --stat -- src` is empty and `git status --short` shows only the ten untracked test files plus the modified records file, which carries this work's `MC-711` to `MC-715`, the "For lane A" section and ledger rows 5018 to 5036.
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

## Corrections from doc-verifier

This section takes precedence over the body above. Independent doc-verifier pass, 2026-10-23 (scratchpad `p2/c10d/dv/result.md`): ten files rerun (40 passed, 32 expected fail), test titles, decision quotes, REPRODUCED citations and an upstream sample verified; four required corrections, applied in the body by the Orchestrator:

1. `maxSupaChunkSize` UI minimum: the fork line is `src/lib/Setting/Pages/OtherBotSettings.svelte:1279` (`:1268` is blank in the fork; it is the upstream line). The packet was right; the earlier "stale citation" label was wrong.
2. Ledger rows for CHORE-10 are 5018 to 5036 (5016 and 5017 are CHORE-09).
3. Records file: an earlier draft of the "For lane A" section named `MC-712` 1 for SUPA-3, gave the range `MC-710` to `MC-713`, and called V2-2 "a diagnostic". The Orchestrator corrected it; it now cites `MC-714`/`MC-715` for SUPA-3, `MC-710` to `MC-715`, and V2-2 as failing assertions including the stored-null case, so the report and the records agree.
4. The modified records file is part of this work (it carries `MC-711` to `MC-715`, the "For lane A" section and the CHORE-10 ledger rows); the environment line is reworded.

Optional, noted: the V3-4 citation `index.svelte.ts:1295,1342,1359` is loose; only `:1295` is the `splitSentMessages` call, `:1342` is the `makeMs` call and `:1359` the message loop.
