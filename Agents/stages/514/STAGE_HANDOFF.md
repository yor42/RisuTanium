# #514 stage handoff: S4 (last stage)

## 1. Completed PR and commit
- PR #631 (`claude/514-s4`).
- Reviewed: c64fef156 plus two test files, committed as 3afd903ae. After the last review: the reviewer's two comment corrections, MC records, two merges of main and this file. The first merge (40ddfa333) had no file overlap. The second (59ef16107, main ab535a18c with #596 stage 1) shares only `sendChatOwnedStream.svelte.test.ts`, which auto-merged.
- Earlier stages, all merged: S1 #594, S2 #610, S3 #624.

## 2. Architectural decisions
- MC-3556, MC-3674: Android owns single-character streamed replies on OpenAI-compatible, Responses, Anthropic, Gemini API and Vertex Gemini. Other formats stay page-owned. Non-stream ownership is OpenAI-compatible only.
- MC-3558, MC-3559 (S2): Rust journals an owned stream, and a page load does not cancel it.
- An attempt that will not be the reply is retired, and the retire awaited, before any later request of that send (failed head, key rotation, overload refetch, Gemini fallback, tool round). Every later request is unowned. An announced failure ends the turn.
- MC-3563 Q5, MC-3674: the overload retire also drops the announced fact, so the page posts its notice at the real end.
- One read rule per request, shared by the stored blob and the live reader.
- MC-350: no Rust, reader, consumer or persisted-format change in S4.
- Device rulings: MC-3627 (overload notification observed by shade screenshots), MC-3628 (overload ordering clause waived on device, pinned by test O1).

## 3. Changed files
- `src/ts/nativeReply/`: `grant.ts`, `ownedStream.ts`, `tests/ownedStream.svelte.test.ts`.
- `src/ts/process/request/`: `request.ts`, `anthropic.ts`, `google.ts`, `openAI/responses.ts`, `openAI/requests.ts`, `nativeReplyProviderStreams.test.ts` (new), `nativeReplyStreamGrant.test.ts`.
- `src/ts/process/tests/sendChatOwnedStream.svelte.test.ts`.
- `Agents/mc/514.md`, this file.

## 4. Test results
- Gate 1 (opus): [EDITORIAL]. Gate 2 (opus): r1 and r2 [REJECT] on test gaps only, r3 [EDITORIAL].
- On the merged tree 59ef16107: T30 passes; `sendChatOwnedStream.svelte.test.ts` 20 of 20; `src/ts/nativeReply`, `src/ts/process/request` and the owned-stream, native-push, active-units, ownership, hide-save and recovered-apply suites, 66 files, 1313 passed; `pnpm check` 0 errors.
- r3: 42 mutants, none survives the final tests.
- CI on 59ef16107: 7 of 7 green.
- Device rows (Note 9, synthetic data, LAN mock), all gating rows PASS:
  - On a debug APK of c64fef156 (Tauri CLI 2.9.1 installed against a 2.12.5 lock, executed version inferred): DR-R, DR-A, DR-G, DR-N, DR-AO (1), DR-AO (2) with the MC-3628 waiver, DR-P Anthropic non-stream and Continue. Carried across the #596 stage 1 merge (no behaviour change, merged-tree tests pass).
  - On a debug APK of 59ef16107: DR-AO (3) (one early "Replied" notice during the retry, accepted by MC-3674, then the notice at the real end), DR-P group, tools and Gemini image output.
  - Closeout, not run: DR-G429 (429 `RESOURCE_EXHAUSTED` with `antiServerOverloads`, then 200).

## 5. Unresolved issues
- DR-G429 is owed at closeout.
- Device observation, outside S4: a Gemini custom-URL send went out non-stream with streaming on, probably because the image-output setting (sent as `imageResponse`) was still on from the previous row. Not investigated.
- #616 (open): deleting a running reply after a reload does not stop it (MC-3563 Q9).
- Accepted limitations are in the PR body: an unowned overload retry and its 1 s window, one early hidden "done" notice, page-owned tool rounds, an untested errored non-SSE 200 body, dormant Gemini signature writes, Vertex unit-only.

## 6. Next stage
None remains for this ticket. What other tickets inherit:
- #596 (parallel replies, MC-3308..3310):
  - A chat's key stays held for the whole send, including the Anthropic overload sleep and refetch. The retire or consume of the first record is not the end of the send.
  - In the stream `finally` of `sendChat`, `settleOwnedStreamEnd` runs before `flushPageReplyEndWhenHidden` (test T30).
  - Owned state is keyed by generationId, and retiring one reply never touches another (tests K1).
  - Since #596 stage 1, `doingChat` is read-only over the active-units registry; S4's tests reset with `clearRunningSends()`.
- #616:
  - After a reload the page holds no send, so the fix needs a keyed native cancel.
  - That cancel covers all five owned stream formats and OpenAI-compatible non-stream.
  - `cancel_all` deliberately spares owned replies (MC-3559).
- Test doubles for this layer behave like the real store and pump: a consume completes after a suspension and rejects with a plain string, and a stamp can arrive as late as the body's end.
- MC block: MC-3674 used; MC-3675..3683 unused and returned to lane A.
