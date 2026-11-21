# Spec: ChroMemory, RisuTanium's fork-only long-term memory engine ("LTM / Lorebook V2")

## Status

- r4, 2026-11-20, written by the LTM spec session. **Approved by the maintainer as final on 2026-11-20**, with one feature idea added (MC-2603, section 7).
- Round 3 of the independent challenge returned ACCEPT WITH CHANGES (`challenge-r3.md`). This version applies every change it listed (F1 to F9) and the maintainer's round-4 answers (MC-2599 to MC-2602).
- The engine is named ChroMemory [D MC-2599]. Where the text below says `<ENGINE>`, read ChroMemory.
- Two independent senior-advisor challenges rejected the earlier drafts:
  - r1 was rejected (`challenge-r1.md`).
  - r2 was rejected (`challenge-r2.md`). That rejection was narrower: the direction was accepted.
- This draft simplifies the product to close the loop. Hand-written pins are cut, recalled lore stays inside the lore budget, and note supersession is cut.
- Section 14 maps every r2 finding to its fix; section 15 maps every r3 finding.
- MC IDs were assigned by lane A on 2026-11-20 (MC-2588 to MC-2603; earlier drafts and reviews call them MC-LTM-1 to MC-LTM-16, MC-LTM-n = MC-(2587+n)); the maintainer's answers are in `chromemory-decisions.md`.
- The comparison of the three source proposals, the citation check, the code map and the three challenge verdicts (`challenge-r1.md` to `challenge-r3.md`) are session scratch outside the repository; this spec carries every conclusion they produced.

## Decisions this spec obeys

- MC-902:
  - a new fork-only engine under a new name;
  - it coexists with the existing engines;
  - review is optional but always available;
  - a fork-only stored format is accepted;
  - no existing engine is retired.
- MC-774, MC-175 and MC-223: the `.bin` rules.
- MC-350: Android data is read in place.
- MC-2588 to MC-2598, recorded in `chromemory-decisions.md`:
  - search, plus optional notes;
  - keyword search by default, vectors opt-in;
  - search chat and lore, recalling keyword misses only, within the unused lore budget;
  - who-knows-what tracking is reserved for later;
  - a Worker attempt comes before local vectors on phones;
  - the per-message trim stays, and snippets go in the memory slot;
  - `.bin` export shows "no memory" plus a warning;
  - no hand-written pins;
  - an aggregate-only `.bin` length analyzer.
- MC-2814, MC-2656 to MC-2658: API embedding providers are the primary vector path; a local model is the free default and fallback, not the main engine. S3 ships on API embeddings, an unreachable provider means keyword-only for that send, and keyword search stays the default.
- MC-2599 to MC-2603: the name ChroMemory; a recalled-lore cap of 5,000 tokens by default, user-raisable; notes start from now with an on-request backfill; the spec lives in `docs/design/`; a Memory dashboard as a later feature idea.

## Labels

- **[D]**: a maintainer decision.
- **[M]**: measured in M1 to M4 (synthetic data).
- **[C]**: a code fact at HEAD `2a9f2a91c`, spot-checked.
- **[P]**: a proposal.
- **[E]**: a default or estimate that a named stage will measure and may replace.

---

## 1. Goals and non-goals

### Goals

1. Recall old chat that has left the context window. [D MC-2588, MC-2589]
   - The recalled text is the processed text the request pipeline produced.
   - Recall works on a Note 9 with no download and no network, in Korean and English.
2. The chat log on the active branch is the only retrieval source. Nothing derived from it replaces it. [M M3]
3. Optionally keep a list of short, user-visible notes. [D MC-2588]
   - Notes are extracted from chat that has left the window.
   - Each note carries its source turn and is ordered by recency.
4. Recall lorebook entries whose primary keyword missed. [D MC-2590, MC-2594, MC-2597]
   - Recall uses only the lore budget the keyword scan left unused.
   - Lore activation is unchanged.
5. The user can always see what memory holds and why each item was injected, and can edit or delete notes. Review is never required. [D MC-902]
6. **Invariant I1.** With the engine on and nothing injected, the prompt equals the engine-off prompt.
7. **Invariant I2.** A send that fits with the engine off never fails with the engine on.
8. Default mode has no LLM call on the send path and a bounded added latency (section 9). [D MC-2592; M M1]
   - On phones, local vectors are allowed only after the Worker prerequisite passes.
   - Otherwise, phones use vectors through an API.
9. The engine coexists with Supa, HypaV2, HypaV3 and Hanurai, and touches none of their data. [D MC-902]

### Non-goals

- Lorebooks:
  - no replacing, migrating, rewriting or re-keying lorebooks;
  - no new fields on lore entries or cards;
  - no change to which entries activate;
  - no recall beyond the user's lore budget.
- Hand-written pins. Users already have always-active chat-lore entries and the author's note. [D MC-2596]
- Note supersession links, in-story time fields, confirmed statuses and hand-added notes. M3 measured supersession marking as failing; this belongs to stage S6.
- A knowledge graph, entity graph or multi-hop retrieval (stage S7).
- Who-knows-what tracking. [D MC-2591]
- LLM query rewriting, LLM routing or LLM reranking.
- Self-editing memory driven by agent tool calls.
- Character-claim and authority statuses. This is a deliberate cut: M3's main error was attributing a fact to the wrong speaker. The proxy instead is each note source's message role.
- Block trimming and prompt-cache optimisation. [D MC-2593]
- Making the engine's data readable by upstream. [D MC-774]

---

## 2. Concepts

| Term | Meaning |
|---|---|
| Message record | A side record the builder emits for each message chat it builds. [P; challenge r2 N2, r3 F6] Fields: `chatId`; `index` (message index in the chat); `role` (`user` or `char`, taken from the message, not the built role); `name` (always filled; the persona name for user messages); `text` (the processed content string *before* the group or `sendName` wrap; no images); and `rawHash` (a hash of `Message.data`). The first message is included under the fixed id `#first`. Example messages and the `NewChat` marker are never included. [C index.svelte.ts:1544-1589, 1655-1663, 1799-1806] |
| Engine-off trim | The existing lazy trim at the full context limit, exactly as with no engine. [C contextTrim.ts:60-153] |
| Dropped set | The message records whose chats the engine-off trim dropped this send. Only these are retrieval candidates. |
| Sent set | The ids of all message records this send built. This already excludes hidden messages, chat before an `allBefore` reset, and other branches. [C index.svelte.ts:1559-1566] |
| Unit | One indexed message record, keyed by `chatId + rawHash`. Its text is the built text at the time it was indexed. Splitting units is decided by S0. |
| Lore candidate | Section 5.4. |
| Note | Section 6. |
| Trace | What the engine did last send, and why. It is kept in memory only. |

---

## 3. Data model and stored format

### 3.1 Global settings (Database, fork-only)

**Engine selection**

- A new fork-only flag selects the engine. [P] Its name (for example `ltmEngine: boolean`) is chosen at implementation.
- Stage S1 adds one shared memory-dispatch function. It replaces the precedence chain now duplicated in `memoryEngineOf`, in the dispatcher and in `memoryTakesChats`. [C memoryEngine.ts:13-19; index.svelte.ts:1628, 1872-1948]
- The new engine wins over the legacy flags.
- The new engine never joins `memoryTakesChats`, so `countMessagesInTrim` keeps its engine-off value.
- `setMemoryEngine` clears the legacy flags and writes `memoryAlgorithmType = 'none'` for the new engine, so a `.bin` reader sees no memory. [C memoryEngine.ts:25-63]

**`ltmSettings`**

One global object with these fields:

- `budgetTokens`: default `min(1200, 15% of max context)` [E: S0 output].
- `retrieval: 'lexical' | 'hybrid'`, default `lexical`. [D MC-2589]
- `searchLore: boolean`. Its default is set by the S4 usefulness gate.
- `loreRecallCap`: default 5,000 tokens; the user may raise it. [D MC-2600]
- `notesEnabled: boolean`, default `false`.
- `shadow: boolean`.
- S1 persists only the fields S1 reads. Later stages add theirs under the unknown-keys rule.

**Running condition.** The engine and lore recall run only when both hold [C index.svelte.ts:1628; chatToggleScope.ts:247-252; challenge r3 F5]:
- the flag is set;
- `effectiveMemory(owner, chat)` is true, which is the same per-chat and per-character memory switch every engine respects.

Its rules:

- Readers keep unknown keys.
- A bad shape is defaulted in memory only. It is never written back until the user changes a setting.
  - This works only as a pure reader function. It is never a `setDatabase`-style default written onto the database object.

**`.bin` export**

- `exportCopyOf` removes the flag and `ltmSettings`.
- A new leave-out summary kind names the engine on both consent paths. [D MC-774, MC-2595; C binLeaveOut.ts, backuplocal.ts:811-835]

### 3.2 Per-chat stored data: none before stage S5

- Stages S0 to S4 store nothing per chat. [D MC-2596]
- S5 introduces one optional chat field. It is stored in the store2 chat core, which passes unknown keys through, so no codec change is needed. [C chat.ts:45-51] It is written only when a note pass commits or the user edits or deletes a note.

```ts
interface LtmChatData {                 // introduced in S5; v1
  v: 1
  notes: LtmNote[]
  covered: string[]                     // chatIds that ended a committed pass (window ends)
}
interface LtmNote {
  id: string
  text: string                          // one line, in the chat's language
  subjects: string[]                    // each occurs in a cited source
  sources: { id: string; h: string; role: 'user' | 'char' }[]  // chatId, rawHash at extraction, message role
  edited: boolean                       // the user edited the text
  createdAt: number; updatedAt: number
}
```

S5 finalises this shape after its own measurements. Earlier stages define none of it.

**Branches and identity**

- `ltmData` is not a branch field. Nothing is written on a swipe, a branch switch, a hide, a reset, an edit or a Continue.
- Note state is derived when it is read:
  - **active**: every source id is in this send's sent set, and every source's `rawHash` matches. The panel computes the same membership through `splitSentMessages`.
  - **edited-source**: a source id is in the sent set but its hash differs.
  - **off-path**: a source id is not in the sent set. This covers another branch, a hidden message, or chat before a reset.
  - **source deleted**: a source id is found neither on the path nor in `alt`.
- Notes come only from dropped chats (6.1). The newest messages, which Continue re-ids and swipes replace, are therefore never note sources. Message ids stay stable for the life of a dropped message. [C prereroll.ts:76-82: only the continued, newest message gets a new id]

**Cold storage**

- Cold storage most likely leaves the field on the hot chat object. [C coldstorage.svelte.ts:905-916]
- S5 settles this with a cold round-trip guard test.

### 3.3 Indexes and caches (device-local, rebuildable, not persisted in v1)

**Lexical chat index**

- Built from the message records of the dropped set and held in memory for the current chat.
- Reconciled on each send by unit key:
  - units for new ids or changed raw hashes are added;
  - units for ids no longer in the dropped set are removed.
- Keying on the raw hash means dynamic CBS, regex or variables cannot churn the index. A unit's text refreshes only when the message itself changes. [P; challenge r2 N8]

**Vectors (S3)**

- The existing `hypaVector` store is used provisionally.
- S3 measures load time, RAM and store size on the 5,000-message profile. It then decides whether to keep this store or use an engine-owned store with eviction, and whether vectors belong in `.rtb`.

**Lore index (S4)**

- One index per character plus enabled module set.
- It ranks only. Packing always reads the live entry by identity (5.4).
- It is rebuilt when a fingerprint over the scan's entry list (entry count, plus summed content lengths, per source) changes. A same-length edit therefore affects ranking only, until the next rebuild.

### 3.4 `.bin`, `.rtb`, other exports, and read-in-place (MC-350)

These rules come in with S5, when the first per-chat data exists.

**Exports**

- **`.bin`:**
  - `ltmData` gets a `FORK_ONLY_CHAT_KEYS` row with kind `ltmMemory`, and strings in English plus 7 locales.
  - The row always removes the field.
  - The row names the kind when notes are non-empty or when the data is opaque. [D MC-774; C exportAlternatives.ts:60-74]
- **Upstream `.bin` import:** nothing to do. [D MC-223]
- **`.rtb`:** carries the field.
- **Card export:** carries nothing.
- **Single-chat export, chat duplicate and character-with-chats export:** S5 sizing traces each one.
  - Private notes must not leave the device without the same leave-out naming.
  - A copy that re-stamps ids carries notes as they are. Dangling sources are then inert, because notes derive as off-path.

**Read-in-place**

- An absent field reads as empty. Its first write is a compatibility guard, not a migration.
- **Opaque data.** An unknown higher `v`, or a known `v` with a wrong shape, makes the whole field opaque.
  - Nothing from it is injected.
  - The panel says "memory saved by a newer or unreadable version".
  - No build path rewrites, normalises or drops it. That includes the note pass, the panel, copy paths and `.bin` naming.
  - The user may delete opaque data only through an explicit, confirmed "delete unreadable memory" action.
- **Forward growth:**
  - Readers keep unknown keys on the `ltmData` top level, on notes and on sources.
  - Writers change items in place and never rebuild them from known fields only.
  - This rule is also what reserves room for MC-2591.
- **Later format changes** follow "the reader accepts old and new; the writer emits new". Frozen-fixture tests pin them. [C codecChatUnseenReply.test.ts precedent]

**Reviewer requirement.** Every stage that adds or changes a persisted field or an export strip uses `opus-reviewer` at both gates. That is S1 (global setting and strip) and S5 (per-chat format).

---

## 4. Engine contract and send order

The engine runs at the existing memory slot, after the lorebook scan. [C index.svelte.ts:1865]

1. **Engine-off trim.** Run the existing trim at the full context limit, exactly as with no engine.
   - The trim gets one additive change: it also returns the dropped chats it splices away (the `splice` return value) and its per-chat counts. [C contextTrim.ts:70, 91, 151]
   - A failed trim returns before any splice, so it can be rerun.
   - On the varying-counter path the engine uses this non-destructive `trimChatsToContext` form, not the inline one-by-one loop, which has already destroyed the array when it fails. [C index.svelte.ts:1963-1973; challenge r3 F4b]
   - The no-engine path does not change, and a test pins that.
   - Call the result K0 (the kept set) and D0 (the dropped set).
   - Recalled lore (5.4) is already counted at this point. If this trim returns `fits: false` while recalled lore is present:
     - remove the recalled lore;
     - rerun the trim, so I2 holds.
     - The trace records the removal.
   - Recalled lore counts as injected for I1.
   - If the trim keeps fewer than the history floor F (the newest F message chats; F is an S0 output, at least 2), recalled lore is shrunk entry by entry until the floor holds or no recalled lore is left.
2. **Nothing dropped.** If D0 holds no message record, return K0 unchanged at about zero cost.
   - Stamp `lastMemory` as the no-engine path does.
3. **Retrieve.** Score the units of D0 (5.1 to 5.5) and select a packed set P whose total T is at most `budgetTokens`.
   - Only selected items are token-counted.
   - Counts are cached per unit for the session.
4. **Make room.** Continue the same trim on K0 down to the limit (context minus T). This drops further oldest kept chats.
   - T is the token count of the assembled memory message: headings, `[#index] name:` prefixes and per-message overhead included. It is not the sum of the cached item counts. An undercount would fall through to the post-assembly recheck. [C :2373-2396]
   - The second call reuses step 1's returned counts, with `firstMessageChat` and `tokensBeforeMessages` restated for the shortened array, so the kept window is not tokenised twice.
   - Make-room never drops below the history floor F (step 1).
   - The trace records the kept-history tokens evicted, next to T.
   - If that trim returns `fits: false`, or would break the floor, drop the lowest-ranked item from P and retry.
   - If P becomes empty, return K0 unchanged. This satisfies I2.
   - Chats newly dropped in this step are not retrieved this send. They become candidates on a later send if that send's engine-off trim drops them.
5. **Return.** Prepend one memory message (`memo: 'supaMemory'`) to the kept set. [C index.svelte.ts:2000-2012]
   - This keeps the template `memory` card, the `<Previous Conversation>` wrap and the non-removable rule.
   - `lastMemory` is stamped from the first kept message chat *before* the memory message is prepended. [C :1975-1978]
   - Inside the wrap, the block carries two headings: "Noted earlier (with source turn)" and "Earlier in this chat".
6. **Errors.** Any engine error returns K0 unchanged for this send (I1 and I2 hold) and is shown in the trace.
7. **Counters that vary.** When `countMessagesInTrim` is already false engine-off (plugin tokenizer or Google Cloud counter), steps 3 and 4 use the same counter.
   - At most 12 items are counted per send. [C index.svelte.ts:1629-1632; tokenizer.ts]
   - If counting fails, step 6 applies.
8. **Shadow mode.** Run steps 1 to 3, return K0 unchanged, and record P in the trace.
   - Lore recall in shadow mode computes and traces its entries but places none.

Lore recall does not use this slot. It runs at the lore stage (5.4) and is counted with lore. An error in lore recall places no recalled lore, is traced, and never fails the send.

The added send latency is measured as a delta against a no-engine send on the same chat and device.

---

## 5. Retrieval

### 5.1 Units and format

- A unit is one message record.
- Splitting long records is an S0 output:
  - if the median Korean unit is above a quarter of the snippet budget on the long-reply profile, S0 specifies a split rule;
  - otherwise units stay whole.
- Snippet format is always `[#<index>] <name>: <text>`. The record text is taken before the group wrap, so there is no special case.
- Ranking uses the index text. Packing uses this send's fresh record, so regex and persona changes show up at once. [challenge r3 F6]

### 5.2 Query

- The query is the newest message record in the send: the latest user message, or for a Continue or a group auto-turn, the latest message of any role.
- The keyword query is the rare-word builder. It reads the whole record and keeps only its rare terms: those whose document frequency in the unit index is at most a share of the units, never below 1. That share is an S0 output. If no term qualifies, it keeps the record's rarest indexed terms. BM25 scores only those terms. [D MC-2661, amending MC-2632]
- S0 decides between one and three queries. Queries 2 and 3 are the last 500 characters of the two newest earlier messages, through the same rule.
- Queries are fused by RRF, never concatenated. [M M2]

### 5.3 Lexical scoring (always on)

- Scoring is BM25 with k1 = 1.2 and b = 0.75.
- Tokenisation:
  - text is NFKC-normalised and lowercased;
  - Latin and digit runs are split into words, with a small stopword list;
  - Hangul, Han and Kana runs become overlapping character bigrams within each word;
  - a single character stays a unigram.
- [M M2: Korean MRR was 0.62 with whitespace tokens and 0.90 with character bigrams]

### 5.4 Lore recall (stage S4, at the lore stage)

[D MC-2590, MC-2594, MC-2597; challenge r2 N5, N6]

**When it runs**

- A post-scan step at the existing scan call. [C index.svelte.ts:1201]
- It runs only when the engine is selected, `searchLore` is on, and the scan cut no entry for budget this turn.
- Its budget is `min(U, loreRecallCap)` [D MC-2597, MC-2600]:
  - U is the lore budget the scan left unused (`loreToken` minus the activated entries' tokens).
  - `loreRecallCap` defaults to 5,000 tokens and the user may raise it.
  - Unused budget is a ceiling, not a target: only admitted entries are packed.
  - At most N recalled entries per send; N is an [E] S4 output.
- Recalled entries are placed like normal-position lore and counted with lore before the memory slot. Total lore therefore never exceeds the user's lore budget.
- Recalled lore never pushes history below the floor F (section 4, step 1).
- **Query.** The newest sent message's raw `data`, taken from `splitSentMessages` (the same message 5.2 names), last 500 characters. Message records do not exist yet at this stage. [C index.svelte.ts:1201 vs 1650; challenge r3 F2]
- **Lexical only.** Lore recall is lexical even in hybrid mode, so the send keeps a single dense query (the snippet query).
- **Admission.** The admission rule of 5.6 applies to lore candidates. S4 tunes its threshold for lore.

**Static exclusions (by entry property, before any scoring)**

An entry is excluded if:

- it has any of these decorators:
  - `probability`
  - `activate_only_after`
  - `activate_only_every`
  - `keep_activate_after_match`
  - `dont_activate_after_match`
  - `is_greeting`
  - `activate`
  - `dont_activate`
  - `additional_keys`
  - `exclude_keys`
  - `exclude_keys_all`
  - `position`
  - `depth`
  - `reverse_depth`
  - `role`
  - `inject_*`
  - `disable_ui_prompt`
  - `ignore_on_max_context`
  - `end` (it sets depth 0, post-everything) [C lorebook.svelte.ts:519-523]
  - `scan_depth` (the entry's own depth decided the miss, so recall would override the author)
- it is `selective`;
- it uses regex keys;
- it has no key;
- its mode is folder, child or constant.

A drift-guard test fails when the scan learns a decorator that is in neither this list nor the neutral list. The neutral list is: `priority`, `match_full_word`, `match_partial_word`, `recursive`, `unrecursive`, `no_recursive_search`.

**Dynamic part (from facts the scan already computes)**

- On the scan's final pass, the entry was not activated and its primary-key query was evaluated and returned false.
- The scan records that one boolean per entry identity as it goes.
- Entries whose evaluation stopped before the primary key are not candidates.
- No query is evaluated that the scan would not evaluate anyway.

**Parity**

With the record on, the following are unchanged:

- `actives`;
- `matchLog`;
- chat-variable writes;
- the number of random draws.

A test pins all four.

**Identity, ranking and packing**

- **Identity:** the entry's `id` when present, else the scan's content-hash fallback. [C lorebook.svelte.ts:838] Identity only maps the ranking index onto this scan's own entry list, which is the live lore. Two entries sharing an identity are both skipped.
- **Ranking:** BM25 over decorator-stripped raw content, against the query.
- **Lore index lifetime:** built off the send path; until it is ready, nothing is recalled. Real profiles can have 100+ modules, so the build budget in section 9 scales per 300 entries.
- **Packing:**
  - take the entry from this scan's own list;
  - CBS-evaluate it with the scan's side-effect-free call;
  - drop it if it renders empty;
  - pack whole entries only, up to `min(U, loreRecallCap)`.

**Default.** `searchLore` defaults on only if the S4 usefulness gate passes; otherwise it ships default-off.

### 5.5 Dense scoring (stage S3, `retrieval: 'hybrid'`)

[M M2; D MC-2592]

- Uses the existing embedding path and recipes.
- Lexical and dense rankings are fused with RRF, k = 60.
- At most one dense query runs on the send path.
- Vectors are computed after the request is dispatched and while no reply is streaming.
- On phones:
  - local models are allowed only if S3a passes (section 10);
  - otherwise mobile hybrid means remote embeddings only.
- Choosing an English-only model for a Korean chat shows a warning.
- The primary path is an API embedding provider (for example Voyage); a local model is the free fallback, and the design is not sized around local model quality. [D MC-2814, MC-2656]
- If the provider cannot be reached (offline, no key, quota, provider error), that send uses keyword search only and the Memory panel shows vectors as paused. No second local index is kept. [D MC-2657]
- Turning vectors on without an API provider preselects the local model; keyword search stays the default. [D MC-2589, MC-2658]
- CHORE-620 supplies the local fallback model; S3 does not wait for it. [D MC-2656]

### 5.6 Packing

**Budget split**

- Snippets get a floor of 50% of `budgetTokens`.
- Notes are capped at 25% (S5).
- Budget notes leave unused goes to snippets. Before S5 the snippets get the whole budget.
- `budgetTokens` is an S0 output [E]. The notes share is an S5 output [E], because S0 measures no notes; the 25% figure is its starting cap.

**Packing rules**

- Items are packed whole or skipped.
- Snippets are ordered chronologically.
- Notes are ordered newest source first.

**Admission rule** [E: S0 decides]

- A unit is admitted only if it matches at least one query term whose IDF is above a threshold.
- The rule ships only if S0 shows it raises pack precision on no-evidence turns without losing pack recall.
- Otherwise the engine fills the budget whenever D0 is non-empty. In that case the maintainer is told the per-turn token cost as a fact.

### 5.7 S0 decides whether the feature proceeds

S0 runs the harness (section 10, P0 and S0) on two corpora:

- the M4 synthetic set;
- a named-filler variant, in which characters' names appear in filler and replies follow the long-reply length profile.

Its turn-shaped queries come in two kinds: with a relevant old fact, and without one.

**Primary metric.** Pack recall at budget (evidence inside the packed set under the token budget, counted with the real tokenizer), for Korean and English separately.

**Baseline.** "Newest dropped messages" filling the same budget.

**Pre-stated pass rule.** Both conditions must hold on ask turns (the user asks for the fact), in each of the four gate cells: M4 and the real-shaped named-filler set, each in English and Korean. [challenge r3 F3; D MC-2627, MC-2661]

- an absolute floor: pack recall at least 0.5;
- a margin: pack recall at least baseline + 0.15 (absolute).

Allude turns (the user only hints at the fact) are measured and reported beside the gate. They never decide it. They are carried to the dense stage S3 (5.5) to clear. [D MC-2661, amending MC-2642]

**Statistics.**

- Settings (budget, snippet share, unit split, rare-term share, query count, admission rule) are tuned on one seeded draw of the generator. The budget may go above 1200, up to 15% of the context plus 2000, and the report states the per-send token cost. [D MC-2630, MC-2654] The gate runs on a fresh seed that tuning never saw, and only if the tune predicts a pass at the exact settings it hands to the gate. [D MC-2661]
- n per language is raised until the 95% intervals of the ask-turn pack recall and of its difference from the baseline are narrower than the margin. The gate report states the intervals.
- The share of no-fact turns where anything is packed is reported beside the gate. It is the per-turn token cost of a miss.

**FYI to the maintainer.** The absolute floor on ask turns is the keyword engine's stop rule. Below 0.5, keyword search finds the old fact in fewer than half the turns that ask for it, and the feature does not proceed. Hints that share no rare word with the fact are left to S3.

**Outcomes:**

1. The pass rule holds: proceed to S1, using S0's outputs (budget, snippet share, unit split, rare-term share, query count, admission rule, history floor F).
2. The pass rule fails, or the tune predicts a failure: stop, and report to the maintainer. No second keyword builder is tried; the highest-IDF builder is report-only. [D MC-2655, MC-2659, MC-2661] No app code exists yet at this point, because S0 stays outside the app's send path. LLM query rewriting stays out of scope.

### 5.8 Trace

For every injected item:

- its source (turn, lore entry or note);
- its lexical, dense and fused rank;
- its token count.

For the send:

- the D0 size;
- the make-room steps;
- the admission decision;
- index churn (share of units replaced);
- time-box status;
- any error.

The trace is kept in shadow mode too.

---

## 6. Notes (stage S5, opt-in)

### 6.1 Windows come only from dropped chats

[challenge r2 N7]

- A pass covers consecutive dropped message records after the last `covered` id on the active path. "Last" means by path position, not by time.
- A window holds at most 20 messages or 3,000 tokens, whichever comes first [E], counting the passed-in notes. A "full window" is one that reached either limit.
- It never includes kept (in-window) chats.
- **Start point** [D MC-2601]. When notes are turned on in a chat, `covered` starts at the trim boundary of the next send: older dropped chats are not covered. The backlog never starts at the oldest message on its own.
- **Backfill** is only by a "Backfill notes" button. Before running, it shows the number of model calls the uncovered windows need. It then runs those windows oldest first, one at a time, each committed separately, and can be stopped.
- When a pass runs:
  - after a reply settles, at most one window per settled reply, when a full window of uncovered dropped chats exists;
  - when the user presses "Update notes now" (one window).
- Every pass uses the message records and dropped set of the last send in this session. Both buttons are disabled before the chat's first send in this session. No builder runs outside a send.
- A send that starts aborts a running pass. An aborted pass commits nothing. The same window is not retried before the next settled reply.

### 6.2 Request

- **Route:** the existing `memory` sub-model route. [C hypav3.ts:1775-1787]
- **Templates:** one Korean and one English template.
  - The language is chosen automatically from the window's share of Hangul.
- **Input:**
  - the window messages, numbered `[1]..[n]`, with speaker names;
  - up to 10 existing active notes, ranked lexically against the window and numbered `(1)..(10)`, so the model can avoid repeats.
- **Asks for:**
  - at most 8 facts;
  - each fact as `{text, subjects, sources:[n...]}`;
  - written in the chat's language;
  - a character's attempts recorded as attempts.
- **Output handling:**
  - JSON or schema mode where the provider supports it; otherwise a tolerant parser.
  - A fixed output cap; a truncated reply is never retried with a larger cap.
  - Duplicates within a pass are removed. [M M3]
- Local hosts must set the context size.

### 6.3 Validation

A note is dropped when any of these hold:

- no source falls inside the window;
- its text is empty, or longer than 300 characters;
- its script does not match the window's dominant script;
- one of its subjects occurs in no cited source.

A note that passes:

- takes `role` from the cited messages;
- takes `h` from each source's `rawHash`.

A note whose normalised text equals an existing active note's text is dropped. The existing note is kept unchanged, with no added sources.

### 6.4 Commit

- Re-resolve the chat.
- Commit only if all of these still hold:
  - the chat still exists;
  - `covered` is unchanged since the pass started;
  - every window id is still in the sent set.
- Append the new notes and the window's end id to `covered`.
- A retry with the same window end does nothing.
- Cap policy: an [E] S5 output. "Passes stop at 400" is not acceptable for a 5,000-message chat; S5 picks a policy (for example a larger cap with eviction of off-path and source-deleted notes first) from the M4 data. The panel says when the cap is reached and offers to delete off-path and source-deleted notes.

### 6.5 Injection

1. Take the active notes.
2. Rank them lexically against the query. This ranks notes among themselves only; notes are never search keys for messages.
3. Keep the top notes up to the notes cap.
4. Order them newest source first.
5. Show each note with its source turn, for example `(from #812)`.

The block is not headed as current truth. A newer snippet or note can contradict an older one, and recency decides. [M M3: notes used as search keys lowered retrieval]

### 6.6 Default by evidence

The S5 gate measures, on the M4 update cases:

- state-block current-value accuracy;
- stale-assertion rate, compared with a snippets-only baseline.

It runs on one API-class model and on the two M3 models, using the maintainer's host (MC-905).

Note injection defaults on only for model classes where it does not lower accuracy. For the rest, notes are shown in the panel but not injected unless the user turns that on.

### 6.7 Cost

- Note passes appear in the usage reporting.
- The panel shows the passes made.

---

## 7. Review and edit surfaces

There is one "Memory" panel per chat:

- It is a new modal following the HypaV3Modal pattern.
- It opens from the places that open the V3 modal today, gated on the new engine. [C code-map section 3]

| Tab | Stage | Contents |
|---|---|---|
| Last send | S1 | The trace. |
| Index | S1 | Units indexed, churn, time-box status, shadow toggle, rebuild. S3 adds vector progress; S4 adds the lore toggle and lore-index size. |
| Notes | S5 | Filters: active, edited-source, off-path, source deleted. Actions: edit text, delete, jump to source. Also the "delete unreadable memory" action when the data is opaque. |

- Labels follow the existing engine pattern.
- New strings ship in English plus 7 locales in the same change.
- UI stages follow the theme tokens and the frontend-design rules.

**Feature idea: Memory dashboard** [D MC-2603, idea only, not staged]

- The maintainer approved the spec with this idea: a "Memory dashboard" menu where the user can view the details of this chat's memory.
- It would build on the Memory panel. Possible contents: what is indexed and how much, what was recalled on recent sends and why (snippets, lore, notes), token cost per send, note coverage, and index or vector status.
- It needs its own sizing and product decisions (entry point, contents, whether it replaces or extends the tabs). The natural point is after S1, when the trace exists.

---

## 8. Provider and model requirements

| Stage | Needs | Notes |
|---|---|---|
| S1 and S4, lexical | Nothing. | Offline, any device. |
| S3, hybrid | An API embedding provider (primary); a local model as the free fallback. [D MC-2656] | Korean needs a multilingual model: on M2 only the bge-m3 family worked. The ONNX runtime loads from the app bundle [C onnxRuntimeSource.ts]; weights download once. Phones get local models only if S3a passes. |
| S5, notes | The existing sub-model route. | At least 8k context; JSON mode preferred. Which model classes get injection on by default is set by 6.6. |

---

## 9. Performance budgets

**Profiles**

All budgets are [E] stage-gate targets unless marked otherwise. Two synthetic profiles are used, each with chats of 2,000 and 5,000 messages, a 40% Korean share, and 500 character cards:

- **short-reply:** median 220 characters, p90 900, max 4,000;
- **long-reply:** median 1,000 characters, p90 3,000, max 8,000.

P0's analyzer replaces these distributions with the maintainer's real aggregate distribution, if available (MC-2598). Module lore is sized from the analyzer too (default 300 entries).

**Where to measure.** Rows that depend on Android run on a Note 9 release build; all other rows run on the PC.

| Item | Budget |
|---|---|
| Added send latency, lexical, against a no-engine send, 2,000 messages, excluding the first send after a chat is opened | p95 <= 100 ms. Includes reconcile, scoring, packed-item counts and the make-room trim. |
| First send after a chat is opened (index build; the index is per chat, so this is every chat open) | If the measured full build for 5,000 messages is <= 300 ms, there is no time box. Otherwise a 150 ms box applies: the send uses the partial index, built from the newest dropped chats backwards, and the build continues after the request is dispatched. If the full build exceeds 0.5 s, the maintainer is asked whether the first send should wait instead. [D3 deferred to measurement] |
| Lexical index memory, 5,000 messages | <= 30 MB (text plus postings) |
| Lore candidates | Index build <= 100 ms per 300 entries; scoring <= 10 ms per send |
| Hybrid query embedding | Adds its model's latency to the send [M M1: MiniLM ~90 ms; bge-m3 ~1.24 s]. Shown when the model is picked. |
| Vector store (S3) | Load <= 1 s for 5,000 messages, measured before the store decision. |
| Note pass | 0 ms on the send path. |
| Prompt cost | Reported per send in the trace. |

---

## 10. Staged delivery

**Gate process**

- Each stage is its own ticket with sizing, a designer plan, Gate 1 and Gate 2.
- Persisted or export changes use `opus-reviewer` (S1 and S5).
- Each stage is usable on its own.

| Stage | Delivers | Stored change | Exit gate |
|---|---|---|---|
| P0 | (a) The M2 scripts and M4 generator, moved from `%TEMP%\risu-b715\ltm\` to a durable synthetic-only home (proposed `Agents/Tools/ltm-eval/`). (b) The aggregate-only `.bin` analyzer [D MC-2598]: it reads the maintainer's real `.bin` (path named by the maintainer) and writes one JSON with message-length histograms by role and by Hangul share, messages per chat, hidden-message share, lore entries per character and per module, lore content-length histogram, and decorator, selective and regex usage counts. It never prints or writes text, names, ids, keys or settings fields. It runs on the PC under the no-secret-fields rule. | none | (a) reproduces M2's BM25 table. (b) The output JSON passes a field allow-list check, and the maintainer approves its use. |
| S0 | The BM25 tokeniser and scorer module, and the harness of 5.7. Outside the app's send path: no app code changes. [challenge r3 F3] | none | The go/no-go of 5.7. Outputs: budget, snippet share, unit split, query count, admission rule, history floor F. |
| S1 | The shared memory-dispatch function (no behaviour change for legacy engines), engine registration (flag, dropdown, labels, `.bin` strip and naming), the send order of section 4, lexical retrieval, packing, trace, shadow mode, Last send and Index tabs. Sizing should split it; the natural first cut is dispatch function plus registration plus shadow-only, then injection and the tabs. | global fork-only setting | `opus-reviewer`. I1/I2 tests. Section 9 rows on a Note 9. Pack recall at or above S0's gate value minus 0.05. "Latest value present in pack" reported on the 28 update cases. |
| S3a | Worker embedding spike on the Note 9 WebView. Needs nothing from S1; needs CHORE-620's model choice, or a Korean-capable model named at S3a sizing. | none | Pass requires, for one named Korean-capable model (from CHORE-620): no main-thread task over 50 ms from embedding; renderer peak at most 1.5 GB above baseline; no renderer loss; indexing at least 1 message per second. Pass enables the local fallback on phones; fail means API-only on phones. Not a prerequisite of S3. [D MC-2592, MC-2656] |
| S3 | Hybrid on API embeddings: dense ranking with RRF, post-dispatch indexing, vector store decision, keyword-only on provider failure. | possibly a vector store | Needs S1 and an API embedding provider; tests use synthetic embedding fixtures, never a real provider. Gains in paraphrase pack recall. Section 9 rows met. |
| S4 | Lore recall (5.4). | none | Parity test (four items). No recalled entry fails the static or dynamic rule. Usefulness gate: on synthetic lore with paraphrased triggers and no-relevant turns, recalled-lore precision and the no-evidence recall rate are reported; this decides the `searchLore` default. |
| S5 | Notes (section 6), the Notes tab, `ltmData` v1, the backfill button. | `ltmData` v1 | `opus-reviewer`. Storage tests. The evidence gate of 6.6. Outputs: notes share, cap policy. |
| S6 (gated) | Supersession, event notes, arc summaries that never overwrite messages; only if S5 data shows need. | as needed | Must beat S5 on the eval. |
| S7 (gated) | Who-knows-what and entity lookup. [D MC-2591] | new fields, kept under the unknown-keys rule | A stronger-model test, then a maintainer decision. |

**Dependencies**

- P0 comes before S0, and S0 before S1.
- S3a can start at any time once its model is named (CHORE-620, or a model named at S3a sizing).
- After S1:
  - S3 needs S1 only; S3a and CHORE-620 gate the local fallback, not S3 [D MC-2656];
  - S4 needs S1;
  - S5 needs S1.
- S3, S4 and S5 can run in parallel, subject to file ownership.

**Note on MC-2588.** MC-2588's text says "stage 1 ships hybrid search". Under MC-2589 (keyword default), S1 is lexical and the vector half arrives at S3.

---

## 11. Test strategy

**Unit (Vitest)**

- Tokeniser.
- BM25 against a reference implementation.
- RRF.
- Packing: whole items, shares, flow of unused budget.
- Chronology.
- The query builder for Continue and group turns.
- The 500-character tail cap.
- The snippet format with pre-named content.

**Invariants**

- I1: engine on with nothing injected keeps the same chats as engine off. Covered for empty D0, for admission rejecting every unit, for an engine error, for shadow mode, and for a chat or character with memory switched off (`effectiveMemory` false, which also places no recalled lore).
- I2: a send that fits engine-off never fails engine-on. Covered for small contexts and for `fits: false` during make-room.
- The no-engine trim is unchanged by the additive dropped-chats return.
- `lastMemory` is stamped before the memory message is prepended.
- `countMessagesInTrim` is unchanged with the engine selected.
- The new engine wins the dispatch precedence over legacy flags.

**Index sync**

- After a swipe, delete, edit, hide, reset or branch switch, no unit of a departed or edited message is retrievable.
- Churn is zero across sends when only dynamic CBS output changes.

**Retrieval eval**

- A CI-sized seeded subset of the S0 harness: both corpora, both languages, turn-shaped queries.
- Floors on pack recall and on "latest value present".

**Lore**

- Parity on four items: actives, matchLog, chat-variable writes and random-draw count.
- Every static exclusion, and the drift guard.
- The dynamic rule: entries stopped before the primary key are not candidates.
- No recall when the scan cut for budget.
- Total lore stays within the lore budget.
- An empty CBS render is dropped.
- Index invalidation.

**Storage (S5, critical)**

- Codec round trip.
- An absent field reads as empty.
- Opaque data (unknown `v`, bad shape) stays byte-identical, is not injected, is not written by any path, and is deleted only by the explicit action.
- Unknown keys at every level survive edits.
- Cold-storage round trip.
- `.bin` removal and naming, including opaque data.
- `.rtb` round trip.
- One test per traced export or copy path.
- Frozen-fixture read-in-place tests for later changes.

**Notes**

- Derived states across two branches, hide, reset, delete and a Continue at the head.
- Mocked provider outputs:
  - valid;
  - truncated;
  - looping;
  - wrong script;
  - out-of-window source;
  - subject not in source;
  - duplicate.
- Commit is refused when the chat changed; retry is idempotent.
- An abort when a send starts; no retry of that window before the next settled reply.
- Start point on enabling: older dropped chats stay uncovered.
- Backfill: the shown call count equals the windows run; stopping commits only finished windows.
- Both buttons disabled before the first send.
- The cap policy S5 picks.

**Test kinds**

- Regression reproducers fail on the pre-fix base.
- Compatibility guards are labelled as guards.
- Mutation checks on the scorer, the packer, the make-room loop and the lore rule.

**Device**

- Synthetic profiles only.
- Note 9 release build through the adb guard for Android rows; PC otherwise.
- No real user content. The analyzer emits aggregates only.

---

## 12. Open questions

**Product (maintainer)**

1. Resolved: the name is ChroMemory [D MC-2599].
2. Resolved: the spec lives in `docs/design/`; committing needs its own confirmation [D MC-2602].
3. Deferred until measured: if the first-send index build exceeds 0.5 s on the Note 9, should the first send after opening a chat wait for it, or go out with partial memory?

**Technical (resolved at the named stage)**

4. Whether to keep the vector store or replace it, and whether vectors go in `.rtb` (S3).
5. Whether to persist the lexical index per device (S1 measurement).
6. Embedding input truncation in transformers.js for long units (S3).
7. Tracing of single-chat export, chat duplicate and character-with-chats export (S5).
8. Whether the Android native-reply direction (MC-1451) changes where a post-reply note pass runs (S5).

---

## 13. Name

**ChroMemory**, chosen by the maintainer [D MC-2599]: a play on chromium (the element) and chronicle, matching the xxMemory naming of the existing engines.

Candidates offered before that choice, for the record: Chronicle, Ledger, Gieok (기억), TaniMem, Archivist.

Code identifiers stay neutral (`ltmEngine`, `ltmSettings`, `ltmData`), so a later rename touches labels only.

---

## 14. How r3 answers challenge r2

| r2 finding | Resolution in r3 |
|---|---|
| N1 Blocker: reserve not released | Invariants I1 and I2. The engine-off trim runs first; retrieval only over its dropped set; room is made by exactly T, with `fits: false` shrinking P to empty. Shadow mode is defined. The trim returns the dropped chats (an additive change). (Section 1, 4, 11.) |
| N2 Dropped built chat | Message-record side record. Domain is message chats plus `#first`; examples and marker never. Role and name come from the message. Pre-named content is handled. (Section 2, 5.1.) |
| N3 Budget starves snippets | Pins cut [D MC-2596]. Lore moved to the unused lore budget [D MC-2597]. Snippet floor 50%. All shares, budget and the unit split are S0 outputs. Long-reply profile plus the real aggregate analyzer [D MC-2598]. (5.6, 9, 10.) |
| N4 S0 no go/no-go | Named-filler corpus; turn-shaped queries with and without a relevant fact; recency baseline; pre-stated +0.15 margin; stop-or-change rule. S1 floor taken from S0. (5.7, 10.) |
| N5 Lore rule unreadable | Static exclusions (including selective and `additional_keys`) plus a drift guard. The dynamic part uses the scan's own final-pass primary-key result. Parity covers four items. (5.4.) |
| N6 Lore over budget | [D MC-2597]: unused lore budget only; none when the scan cut; usefulness gate sets the default. Packing reads the live entry. (5.4.) |
| N7 Derived note state | Windows come from dropped chats only. Active means in the sent set. Duplicates are dropped, not merged. `h` hashes raw data. The source-deleted state is defined. Coverage is resolved by path position. 400-note cap. (3.2, 6.) |
| N8 Time box, churn | Box only if the build is over 300 ms; partial index plus post-dispatch build; D3 deferred to measurement. Raw-hash keys remove CBS churn. Churn is traced. The p95 row excludes first sends. (3.3, 9.) |
| N9 Pins / loreExclude | Pins dropped [D]; `loreExclude` cut; former S2 removed; the per-chat format arrives only at S5. |
| N10 Opaque rules | Top-level unknown keys kept; `ltmSettings` rules; `memoryAlgorithmType = 'none'`; S1 gets `opus-reviewer`; copy paths carry notes as they are; explicit user delete of opaque data; note shapes are not defined before S5. (3.1, 3.4, 10.) |
| N11 S3a criteria | Named model, a 50 ms task limit, a memory bound, no renderer loss, a rate floor. Needs nothing from S1. (10.) |
| N12 Failing note parts | Cut: `supersedes`, `storyTime`, `confirmed`, hand-added notes, three settings. A send aborts a running pass. Cap added. (6.) |
| N13 Section 4/5 details | Counters that vary (step 7); `lastMemory` stamp order; the dedup step is gone (candidates are dropped chats only); query for Continue and group turns plus the tail cap; box and p95 relation. (4, 5.2, 9.) |
| N14 Editorial | "exact" removed; S1 baseline named; drift-guard wording; the MC-2588 line. |

## 15. How r4 answers challenge r3

| r3 finding | Resolution in r4 |
|---|---|
| F1 Lore recall uncapped | Recall at most `min(U, loreRecallCap)`, default 5,000 tokens and user-raisable [D MC-2600], and at most N entries ([E] S4). The 5.6 admission rule applies to lore. (5.4.) |
| F2 Lore query, shadow, errors | Query is the newest sent message's raw `data` from `splitSentMessages`, 500-character tail. Lore recall is lexical only, so the single dense query stays with snippets. Shadow places none; errors place none and are traced; index built off the send path, nothing recalled until ready. (4 step 8, 5.4.) |
| F3 Go/no-go at the noise floor | Absolute floor 0.5 plus margin 0.15, both stated before the run; tune on one seed, gate on a fresh one; n raised until the 95% interval is narrower than the margin; no-fact packed share reported; FYI that the floor is the stop rule. Dispatch function moved to S1; S0 has no app code. (5.7, 10.) |
| F4 Make-room details | Counts handed back with the dropped chats; varying-counter path uses the non-destructive form; history floor F (S0 output, at least 2) with recalled lore and P shrinking first; T is the assembled memory message count; evicted tokens traced; "newly dropped" wording. (4.) |
| F5 Memory switch | Engine and lore recall run only with the flag and `effectiveMemory`; switched-off case in I1 tests. (3.1, 11.) |
| F6 Record text and name | `text` is the content before the group or `sendName` wrap; `name` always filled; snippet format always `[#index] name: text`; rank on index text, pack from this send's record. (2, 5.1.) |
| F7 Note backlog | One window per settled reply; start from the trim boundary on enabling [D MC-2601]; backfill only by a button that shows the call count first; cap policy an [E] S5 output; buttons use the last send's records and are disabled before the first send; no builder outside a send; no retry before the next settle; "full window" defined. (6.1, 6.4.) |
| F8 Static list and identity | `end` and `scan_depth` excluded; neutral list written; the live entry is this scan's own entry; shared identities skip both. (5.4.) |
| F9 Consistency | Notes share is an S5 output; S3a model dependency stated; reader diagnostic cut; "first send" is per chat open, partial index covers newest dropped chats first; `ltmSettings` defaults are a pure reader and S1 persists only its own fields; S1 split suggested. (3.1, 5.6, 9, 10.) |
