# CHORE-215 Gate 2, round 4 (opus-reviewer, fresh), 2026-10-26

## Snapshot and inputs

- Repository /home/user/RisuTanium, branch lane-C-chore215-tokenize, HEAD 10b26345f plus 4 uncommitted files.
  - md5: contextTrim.ts 379e56b8, contextTrim.test.ts 80b10dff, index.svelte.ts 8a2ce8e5, sendChatContextTrim.svelte.test.ts 1a6e84a2.
  - The md5s and `git status --porcelain` were the same at the start and at the end of the review.
- `git diff HEAD` equals fix-r4.diff once the index lines are stripped (DIFF-EQUAL).
- What changed since round 3:
  - index.svelte.ts: one comment only ("NaN, infinite, negative or huge").
  - The send test: unchanged since round 2.
  - The helper and its unit tests: rewritten. The new bounds contract, constants and tests.
  - So the round-2 index mutants (m2, m4, m5) and the send guards are still valid evidence, and I reused them.
- Runtime: Node v22.22.0, vitest 4.1.11 from the repository's node_modules.
- Resolved dependencies, read from node_modules:
  - @dqbd/tiktoken 1.0.22: `encode` returns `Uint32Array` (tiktoken.d.ts:142).
  - @mlc-ai/web-tokenizers 0.1.6: `encode` returns `Int32Array` (lib/tokenizers.d.ts:20).
  - @huggingface/transformers 3.8.1: `encode` returns `number[]`.
- No hand-back file exists in the scratchpad. I checked the brief's claims instead (finding 6).

## Findings

### 1. [EDITORIAL] The boundary test says "one past any bound", but it never tests one past the negative side of LAZY_BEFORE_LIMIT. Mutant X1 survives and is non-equivalent.

- **What the test does.** 'within the bounds the walk is lazy; one past any bound and it is eager':
  - It tests `-LAZY_BEFORE_LIMIT` (lazy) and `LAZY_BEFORE_LIMIT + 2` (eager).
  - It does not test `-LAZY_BEFORE_LIMIT - 2`.
- **The mutant.** X1 replaces `Math.abs(args.tokensBeforeMessages) > LAZY_BEFORE_LIMIT` with `args.tokensBeforeMessages > LAZY_BEFORE_LIMIT`.
  - All 17 unit tests pass with it (X1.out).
  - The orchestrator's `before-abs` mutant removed both sides at once, so the negative side was never broken on its own.
- **X1 is not equivalent (executed).**
  - prop5z, P class, seed 3: 29 of 100,000 totals differ under X1, and 0 differ for the current helper.
  - Example: before −9007199254740994, limit −9007194959773842. The eager trim gives −9007199254740800; X1 gives −9007199254740801.
  - On the boundary test's own shape (x1cx.mjs: 200 messages of 10, before `-LAZY_BEFORE_LIMIT - 2`, limit `-LAZY_BEFORE_LIMIT + 50`), the current helper makes 200 calls and X1 makes 6.
- **The code is correct.** This is a gap in the test pin and an overstated title, not a logic defect. It is reachable only with maxResponse around −2^51.
- **Fix (preferred).** Add this one line to that test:
  `expect(await lazyCalls(makeCase([], messages(), -LAZY_BEFORE_LIMIT - 2, [], -LAZY_BEFORE_LIMIT + 50))).toBe(200)`
  - It passes on the current helper and fails on X1 (shown above by execution, at helper level).
  - Narrowing the title instead would also be enough.

### 2. [EDITORIAL] The LAZY_ENTRY_LIMIT doc is off by one.

- The doc says "The most chats plus counts after the messages the lazy walk works with".
- The code falls back when `chats.length + tokensAfterMessages.length >= LAZY_ENTRY_LIMIT`, so the most the walk works with is `LAZY_ENTRY_LIMIT - 1`.
- The function doc ("fewer than `LAZY_ENTRY_LIMIT`") and the boundary test (2^18 − 1 is lazy, 2^18 is eager) are both correct.
- Suggested: "The walk works with fewer chats plus counts after the messages than this", or similar.
- The other two constant docs are consistent with their checks:
  - LAZY_COUNT_LIMIT: "largest", and the check is `<=`.
  - LAZY_BEFORE_LIMIT: "largest ... in magnitude", and the walk falls back when the magnitude is `>` the limit.

### 3. Rerun of the property classes against the current helper. Executed; outputs in g2r4/.

| Script | Cases | Result |
|---|---|---|
| cx4.mjs | 125,820 | 0 mismatches, 0 decision flips (round 3: 106,248 / 18,668). |
| cx3.mjs | 5 hand-built cases | All the same as the eager trim, including mixed-sign after-counts, huge counted counts and huge prefix counts with a negative limit. |
| f4cx.mjs | 2 round-2 counterexamples | Both the same. |
| prop4.mjs, seeds 5 and 17, 40,000 per class | C1 to C4 | 0 mismatches in every class, 0 double counts (round 3: C1 2,716 and C3 543). |
| prop2.mjs, seeds 3 and 11, 50,000 per class | A1 to A4 | 0 mismatches, 0 double counts. |
| prop.mjs, seeds 1, 7 and 99, 200,000 each | A and B | A: 0 mismatches. B: 4,079, all explained by the `precondition:` input (an uncounted message count that is not an exact integer). sendOrderMis 0, doubleCount 0. |
| prop5z.mjs (new, mulberry32), seeds 1 to 6, 100,000 per class | P and Q | P: 0 mismatches once the sign of zero is ignored. Q: about 1,650 mismatches per seed, all explained. 0 double counts, and a counted chat is never recounted. |
| prop5c.mjs, seeds 7 and 8, 100,000 per class | P and Q | P: 0 mismatches. Q: 1,599 and 1,671 mismatches, 0 unexplained. |
| propR.mjs, seeds 21 and 22, 100,000 per class | All counts and limits in bounds, edges included | 0 mismatches. About 54% of cases provably took the lazy route. |
| bound.mjs | 61 worst cases | 0 mismatches and 0 inexact results against both the float model and BigInt. |

Notes on the table:
- **prop.mjs.** All three seeds give identical numbers. Its LCG, `seed * 1103515245` in doubles, loses precision and the sequences merge. That is why I added prop5 with a sound PRNG.
- **prop5z classes.**
  - P (inside the stated precondition): every uncounted message count is an integer in [0, 2^32]. The before value, the after-counts, the counted (multimodal) counts, the prefix counts and the limit are all free. Free values include NaN, ±Infinity, fractions, ±2^51 ± 1, 2^53 and above, and 3906250000000088.
  - Q (outside it): the uncounted counts are free too.
  - "All explained" means each mismatch has an uncounted message count that is out of bounds and that the walk never takes.
- **bound.mjs worst cases.** 2^18 − 1 entries, all at 2^32, before ±2^51, limits from fits-all to −2^53 and NaN.
  - The lazy route made between 1 and 262,143 count calls.
  - At 2^18 entries the route is eager (all 262,143 chats counted).

Conclusion: every remaining mismatch is outside the stated caller precondition. Inside it, the only difference is the sign of zero (finding 7c).

### 4. The 2^51 + 2^50 argument is sound on every lazy path. Reasoning, checked by bound.mjs and propR.

- **Bounds.** On the lazy route:
  - |before| ≤ 2^51.
  - Every count either trim uses is an integer in [0, 2^32]:
    - after-counts and counted counts: checked up front;
    - walk-loop, last-chat-loop and prefix-pop counts: checked as taken;
    - never-counted message counts: the caller precondition.
  - There are at most 2^18 − 1 entries (chats, prefix included, plus after-counts).
  - So the sum of all counts is at most (2^18 − 1)·2^32 < 2^50.
- **Partial sums.** Every partial sum in either trim is before + A − P, where:
  - A is a partial sum of the added message and after-counts;
  - P is a partial sum of the subtracted prefix and message pops;
  - A and P are each non-negative and below 2^50, so |A − P| < 2^50 and |sum| < 2^51 + 2^50 < 2^53.
- **Paths covered.** This holds for:
  - the eager push-order total;
  - the eager pop loop;
  - `fixed` (before + after − prefix pops);
  - `fixed + known`, with `known` growing and shrinking;
  - the failure total.
- **Every value is an integer within 2^53**, so the results are exact and do not depend on order.
- **The monotone step is sound.** "Once the counted part is over the limit, so is the whole" needs only non-negative message counts. That holds for the checked counts and, by the precondition, for the uncounted ones.
- **The `known -= countOf(chats[dropped])` branch** has no check of its own. That is correct: its value comes from the cache, filled either by a checked walk count or by a checked counted entry.
- **The constants have margin.** The bound 2^52 + 2^50 is also below 2^53, so X5 (LAZY_BEFORE_LIMIT = 2^52) is still sound. prop5z P on X5 gave 0 mismatches.

### 5. The caller precondition holds in index.svelte.ts. Traced from source.

- **Message chats.** Each is built with `content` (the string from processScriptFull/risuChatParser), `memo`, `attr`, `thoughts`, and `multimodals` only when non-empty. It has no `name`, so no name is counted.
  - A chat that has `multimodals` is counted in the loop and put in `countedMessages`. Those values are checked up front.
  - Thoughts are not counted: the `count` closure passes no `countThoughts`.
  - So an uncounted message count is `encode(content).length + chatAdditonalTokens`.
- **chatAdditonalTokens** is 5 for `gpt*` models and 3 otherwise:
  - `caculatedChatTokens` is set where the send starts;
  - `arg.chatAdditonalTokens` is only ever that value, or passed through unchanged from the caller's arg.
- **The encode branches on the lazy path return arrays:**
  - tikJS: Uint32Array;
  - tokenizeWebTokenizers: Int32Array;
  - gemmaTokenize: number[];
  - the encodeCache holds those same results.
  - The branches that do not return a local array are excluded by `countVaries`:
    - the plugin `'custom'` tokenizerFunc (which may return anything, `?? [0]`);
    - tokenizeGoogleCloud (a network count);
    - tokenizeGGUFModel (Local).
  - The `countVaries` test reads the same keys as `encode`: `aiModel === 'custom'` plus the provider's `tokenizer === 'custom'`, and `getModelInfo(aiModel).tokenizer`.
  - The array length is at most about 3 × (2^29 − 24) UTF-8 bytes, which is below 2^32. In practice it is bounded by memory far below that.
- **Prefix chats** (examples, `[Start a new chat]`, the first message):
  - They are counted only when popped, and those counts are checked as taken. So no precondition is needed for them; example names, if any, are covered.
  - `[Start a new chat]` is pushed but never added to `before`. Both trims subtract its count, as today.
- **Depth prompts** are pushed to `tokensAfterMessages` and also added to `currentTokens`, in the same order as today. They are checked up front.
- **`before` is `currentTokens`**, which starts at `maxResponse` and adds the prompt counts and `triggerResult.tokens`. It is free, and it is checked: integer, |before| ≤ 2^51.
- **Between the loop and the trim**, nothing changes the chats; only the depth prompts are counted there.
- **Previously accepted limitations, not reopened:**
  - Identity holds while the tokenizer settings stay unchanged during the send (Gate 1).
  - A message dropped uncounted can no longer fail the send through a tiktoken special-token throw (round 1, recorded as a behaviour change).

### 6. The brief's claims, checked

| Claim | Result |
|---|---|
| Targeted tests 60/60 | Confirmed: `npx vitest run src/ts/process/contextTrim.test.ts src/ts/process/tests/sendChatContextTrim.svelte.test.ts` exits 0, 2 files, 60 passed (targeted.out). The orchestrator's fix-r4.out shows 59. It probably predates the last test, and it does not matter. |
| pnpm check 0/0 | Confirmed: `NODE_OPTIONS=--max-old-space-size=8192 pnpm check` exits 0 with 0 errors and 0 warnings (check.out). |
| 11 mutants each fail a test | Confirmed from mut4/*.r2.out: each fails 1 to 4 tests. The negative side of the before bound was not one of them (finding 1). |
| 1,080-case search with 0 differences | Confirmed: mut4/clean-20133.search reads "diffs 0 of 1080". |
| New tests are reproducers against round 3 | The round-3 helper, with the three constants appended so the imports resolve, fails 3 of 17 tests (r3helper.out): the multimodal test (cx4), the 2^53 test (cx3 cases) and the boundary test. |
| 'a prefix count beyond the bound takes the eager trim' | Passes on round 3 and does not kill the prefix mutant. It is a guard, which the `guard:` describe allows. The prefix check is pinned by the fractional/2^53 test. See 7b. |
| JSDoc placement | Fixed. The TypeScript API (jsdoc.cjs) attaches the contract block to `trimChatsToContext`, and each constant has its own one-line doc. |
| Mock compatibility | No test mocks `./contextTrim`, and the new exports only add. The caller's new reads use optional chaining (`getModelInfo(...)?.tokenizer`, `pluginV2.providerOptions?.get`). The caller has changed only comments since round 2, when the send tests passed. |
| Line endings and whitespace | All four files are LF only, as at HEAD, and `git diff HEAD --check` is clean. |

### 7. Non-blocking (optional)

- **(a) Splicing on failure.** The doc says "Same chats dropped (spliced in place), same failure and same total".
  - On failure the helper splices nothing, while today's loop splices before it throws.
  - The caller returns false at once, so nothing can observe the difference. Saying "on success" would be exact.
- **(b) The prefix test is a guard.** 'a prefix count beyond the bound takes the eager trim' does not check which route was taken:
  - Its first case falls back at the `before` check.
  - Its second case is exact on either route.
  - Optional: assert the call count, or retitle it as a guard.
- **(c) The sign of zero.** With before −0 and no message or after-count, the eager trim returns −0 and the helper returns +0.
  - It cannot be observed: `currentTokens` is unread after the trim except in the error text, where `${-0}` is "0".
  - It is practically unreachable: `before` starts at maxResponse and any prompt count adds at least 3.
- **(d) A constants test.** Mutants X7 (count limit 2^36), X8 (entry limit 2^22) and X9 (entry tally without the prefix chats) survive, because the tests follow the constants.
  - X7 and X8 are unsound by the doc's own argument.
  - Optional: a one-line test `expect(LAZY_BEFORE_LIMIT + LAZY_ENTRY_LIMIT * LAZY_COUNT_LIMIT).toBeLessThan(2 ** 53)` would pin the argument the doc states.
- **(e) For the full-check owner.** g2r4 never ran the full suite.
  - The orchestrator's full-test.out started at 00:58, and the matching full-status.txt lists the round-3 md5s. It reports 9 failures, all `Test timed out` in src/ts/storage/tests/store2/replay/actors.test.ts.
  - That file imports only store2 modules, not this change.
  - The single owner still needs a full run on the round-4 snapshot.

## Mutants run by this review

Harness: g2r4/w, a copy of the current test, with node_modules symlinked. The clean run passes 17/17.

| Mutant | Change | Unit tests | Notes |
|---|---|---|---|
| X1 | negative side of the before bound dropped | survives | Non-equivalent (finding 1). |
| X2 | entries `>=` changed to `>` | killed | Boundary test. |
| X3 | count cap `<=` changed to `<` | killed | Boundary test. |
| X4 | before bound `>` changed to `>=` | killed | Boundary test. |
| X5 | LAZY_BEFORE_LIMIT 2^52 | survives | Still sound: 0 mismatches. |
| X6 | LAZY_BEFORE_LIMIT 2^53 | killed | The 2^53 test. |
| X7 | LAZY_COUNT_LIMIT 2^36 | survives | 7d. |
| X8 | LAZY_ENTRY_LIMIT 2^22 | survives | 7d. |
| X9 | entry tally without the prefix chats | survives | 0 mismatches in the P class. Unsound only with about 2^18 prefix chats. |

## Commands run (outputs in g2r4/)

- Snapshot:
  - `md5sum` of the four files, at the start and at the end;
  - `git status --porcelain`;
  - `git diff HEAD` against fix-r4.diff (current.diff);
  - `git diff HEAD --check`;
  - the CR count of each file.
- Property and counterexample scripts, each run with `node --experimental-strip-types`:
  - `cx4.mjs`, `cx3.mjs`, `f4cx.mjs`;
  - `prop4.mjs {5,17} 40000`, `prop2.mjs {3,11} 50000`, `prop.mjs {1,7,99} 200000`;
  - `prop5.mjs` and `prop5z.mjs` with seeds 1 to 6, `prop5c.mjs` with seeds 7 and 8, `propR.mjs` with seeds 21 and 22, each 100,000 per class;
  - `bound.mjs`, `x1cx.mjs`.
- Mutation:
  - `mut.py` with X1 to X9, then vitest in g2r4/w (X*.out, mut-summary.txt);
  - prop5z on X1, X5 and X9.
- The round-3 helper against the current tests (r3helper.out).
- `jsdoc.cjs`.
- Targeted vitest in the repository (targeted.out) and `pnpm check` (check.out).
- Not run: the full suite (per MC-329), and any new send-level execution. The send-level precondition is traced from source, and the round-2 send mutants are reused because the caller has changed only comments since.

## Artifacts (scratch only)

Everything is under /tmp/claude-0/-home-user-RisuTanium/626cd7fe-9d63-5c92-a857-46e9012b86d0/scratchpad/c215/g2r4/:

- Helper and mutant copies: contextTrim.ts (current helper, same md5) and ct-X1.ts to ct-X9.ts.
- Scripts:
  - copied from g2r3: prop.mjs, prop2.mjs, prop4.mjs, cx3.mjs, cx4.mjs, f4cx.mjs, jsdoc.cjs;
  - new: prop5.mjs, prop5z.mjs, prop5c.mjs, propR.mjs, bound.mjs, x1cx.mjs, mut.py.
- Mutation harness: w/ (test copy, helper restored to the current md5, node_modules symlink, vitest.config.mjs).
- Outputs: *.out, mut-summary.txt, current.diff.
- This verdict.md.

No repository file was written. Vitest runs in the repository may have touched only the untracked vite/vitest cache.

## Verdict

- Round 3's finding is closed:
  - The counted, walk, last-chat and prefix counts, and the before and after values, are all bounded by one contract.
  - Every mismatch left in every class lies outside the stated caller precondition.
  - The caller meets that precondition for every chat it does not count up front.
  - The 2^51 + 2^50 exactness argument is sound on every lazy path. It is checked against BigInt at the worst-case bounds.
- What is left is wording and the test title (findings 1 and 2), with an optional one-line test that makes the boundary test's title true.
- No logic, data-safety or invariant defect remains, so this is not a substantive rejection and does not extend the streak.

[EDITORIAL]
