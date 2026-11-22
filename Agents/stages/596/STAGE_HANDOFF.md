# Stage handoff: #596 parallel replies, after stage 1

Read this, the issue and the repository at origin/main. Source statements below were read at 51dba53a3 and not executed, unless a test is named. Re-pin them before use.

## 1. Completed

- Stage 1 (keyed active-units registry, no behaviour change): PR https://github.com/yor42/RisuTanium/pull/636, reviewed code commit 364619fd8 on `claude/596-parallel-replies-s1-9de6e7`.
- Refs #596. Stages remain, so the final stage closes the ticket.

## 2. Decisions

Maintainer:

- MC-3308: replies in different chats run in parallel; a chat that is writing refuses a second send.
- MC-3309: the notification Stop stops every reply; per-chat Stop is in the app (#449).
- MC-3310: one keep-alive card ("N replies writing"), with an outcome kept per chat.
- MC-3734: stages 1, 2, 5 and 7 land before the MVP update. Stage 6 comes after, and its D5 question (MC-1293) is asked before stage 5. Context given with the question, not decided: stage 3 merged (#606), stage 4 covered by #514 and MC-3309, stage 8 belongs to #202.
- MC-3735: while a plugin works after the reply, that chat keeps refusing a Send until the plugin finishes or the user presses Stop. No queue, no early release.

Stage 1 mechanism (accepted at Gate 1; rules are in the header of `src/ts/process/activeUnits.ts`):

- Units are released by handle identity. There is no release by key, and only the taker releases. The key is the owner's chat `{chaId, chatId}`, never a group member.
- `doingChat` is `readonly` over a private writable, not `derived`: a derived store can be stale inside another store's subscriber and would open the gate. Admission reads the set.
- `sendAdmissible` and `recoveredApplyBlocked` still refuse on any unit. `sendTargetOf` and `has` have no runtime caller yet.
- Take and release sit where the flag was set and cleared, so no notification moved. Do not merge the unit with the work registration or the published unit without treating that as a behaviour change.

## 3. Changed files

- App: `src/ts/process/activeUnits.ts` (new), `src/ts/process/index.svelte.ts`.
- New tests: `src/ts/process/tests/activeUnits.test.ts` and its `activeUnits.test-helpers.ts`; tests added to `sendChatOwnership`, `sendChatOwnedStream`, both `applyRecovered*` tests and `ChatShell.headerIntent`.
- 91 test files moved off `doingChat.set`: 66 use the real-module helper, 25 keep their writable mock.
- Records: `Agents/mc/596.md` (MC-3734, MC-3735), this file.
- Exact list: `git show --stat 364619fd8`.

## 4. Verification

- Gate 1: r1 REJECT, r2 EDITORIAL. Advisor: proceed with amendments (done). Gate 2: r1 REJECT (two test-only findings), r2 APPROVE by Sonnet under MC-3767 (the fix did not touch the contract).
- Targeted vitest: 95 files, 2019 tests pass. svelte-check: 0 errors, 5 warnings, as on the base. Both were repeated on 477db538b (main 72a7e32a4 merged in, no `src` change). CI results are on the PR.
- R1 and R2 fail on 51dba53a3 and pass on the stage. They use a synthetic re-entry and prove no user-visible bug.
- The plan's mutants were killed, as were the round 1 survivors after the fix.
- Not run locally: full suite, build, device, native. CI is the full run. No device row is owed: nothing user-visible changed.

## 5. Unresolved

- A throw at a recovered apply's take or `registerWork` leaves the unit held, as the flag did. A throw ahead of the release in `sendChat`'s outer finally does the same; see stage 5 below.
- Stop does not free a send that waits on a hung plugin hook until stage 7, so MC-3735's "or Stop" is not true yet.
- `ChatShell.headerIntent` T-A3a timed out under load at its 1 s mount wait. It was not attributed to this change and not proven pre-existing. The wait is now 15 s; watch it in CI.
- G3 leaves a harmless 2 s timer when its race assertion fails.
- #514 S4 (PR 631) was open when this was written. It keeps a chat's key held through the Anthropic overload retire, sleep and refetch, and adds T30 (settle before flush in the stream finally). Run T30 and `sendChatOwnedStream.svelte.test.ts` on any tree that merges both.
- Branches that still add `doingChat.set` fail `pnpm check` after this merges. Re-grep after each merge of main.
- Process slips in this stage, all ended: mutant runs without a run slot, four slot folders briefly created at once by a non-exclusive create, short gaps between slot runs, and a stray root file from PowerShell `.Count>0` (never staged). Briefs must state the slot rule, an exclusive create and `-gt 0`.

## 6. Next stages

MC block: MC-3736..3743 are unused. Stages edit `index.svelte.ts`, so run them one after another. Each is Tier 2 on the critical contract (send admission and write exclusion): designer, Opus Gate 1, advisor challenge, fresh coder, Opus Gate 2. An Opus orchestrator is recommended for the same reason.

Order question for the maintainer, asked by the next orchestrator: is "1, 2, 5, 7" an order or a set? Stage 2 must precede 5. Stage 7 depends on neither, and the advisor recommends 7 before 5 if stage 5's questions are still open.

Which predicate answers what:

| Question | Read |
|---|---|
| Any unit anywhere | `doingChat`, `activeUnits.any()` |
| A send or apply holds this chat (not reactive) | `activeUnits.has(key)` |
| This chat shows busy (UI, Stop) | `isBusyIn`, `isComposerBusyIn` |
| Anything writes this chat or character | `isWriting`, `hasWorkIn`, `writingTargets` |
| The composer holds the chat before a send | `composerWindowFor` |

For every stage: the unit's AbortController signal is the unit id; mint no other. Add no per-chat predicate export to `index.svelte.ts` (about 293 test files mock it); use a leaf module, `chatOrigin` or `composerActions`.

### Stage 2: per-unit Stop plumbing (next; still one reply at a time)

- Turn into keyed state: the published unit (by signal, with its target), the composer window (ref-counted by chat), `inflight` and the current controller, `autoModeRunning`, `locked`, `turnsReached`, `pendingStopDelete`, `chatProcessStage` (whose reset moves after admission, as a refused send resets it today). They live in `generationOwnership.svelte.ts`, `composerActions.svelte.ts`, `stopDelete.svelte.ts` and `index.svelte.ts`.
- The global `abortChat` becomes stop-all (MC-3309). Per-chat Stop stays `stopWorkIn` and `stopComposerWorkIn`.
- The recovered applies publish no unit, so `abortChat` and the notification Stop miss them today. The plan says whether an apply counts for stop-all.
- Never take an active unit for the composer window: fast-forward, the flip blocker and the header read `doingChat` as "a reply is running".
- A unit overwritten in today's single slot would lose its native `chat_stop` tag (inferred, not observed). Test two origins for their tags.

### Stage 5: open the gate across chats

Ask the maintainer first:

- Reload edge, already on main: after a page reload a reply can still run natively while the page holds no unit, and no admission check reads `runningReplies.svelte`. A Send into that same chat is admitted today, against MC-3308. #616 as filed covers deleting that message by a keyed native cancel, not admission. Ask what Send and Stop do there, and whether #616 is needed before the update. Do not model that reply as an active unit.
- D5 (MC-1293): two chats of one character writing character-level fields. This key cannot answer it.
- Selection-bound writes: `setChatVar` without a subject writes the selected chat and marks nothing for save. List the reply-path callers that pass no subject; if any exist, ask whether that part of stage 6 moves ahead.
- Previews beside another chat's reply; auto mode beside other chats; the "another chat is writing" Send block and its locale keys; the flip blocker; two error alerts at once; the header rule (shown chat or last reply anywhere); v3 plugin `sendChat` (refusal, message, explicit target; today it picks the selected chat after awaits).

Then, before Gate 1:

- Choose the gate's source: `activeUnits.has` or `isBusyIn`, which the buttons and Stop already read. Every `reply` and `preview` registration came from a unit at the pin; re-count. Add a test that both answers agree at every awaited point of a send and an apply.
- Decide whether "take after the in-flight begin" is load-bearing. If not, make check and take adjacent and update O1; if it is, make a second take of a held key fail loudly.
- Make the release unconditional. A stuck key would block one chat whose button shows Send, with no Stop.
- Swap the refusal sites against an origin captured at the gate: composerActions, command, multisend, previewRunner, devToolActions, v3, DefaultChatScreen, ShellComposer, BookmarkList, ChatShell. Fast-forward stays "any reply".
- `recoveredApplyDeferred` is one boolean: check that a wake-up is not lost.
- MC-3310's card and per-chat outcomes belong here; new strings need all 7 locales.
- Decide "same chat or elsewhere" for each default-key `simulateRunningSend()`. G1, G2, G3, Q1, S1 and U2 pin today's rule or the registry's arithmetic. They are not product rulings.
- Not yet covered by any sweep: cold-storage restore or unload during an off-screen reply, group speaker rotation, export or snapshot during a changing reply, desktop and Node reply paths.

### Stage 7: plugin and hook stall

- Stop frees a chat only by making the body return. Never release from the Stop handler, by key or through the test reset. Check the signal after each raced hook, or a stopped unit still speaks, auto-continues or resends.
- Classify each awaited hook before racing it: `runChatOutputListeners` (two sites in the send, one in each apply), both replacer loops in `src/ts/process/request/request.ts`, the replacer in the reconcile path in `src/ts/bootstrap.ts`, the `request` trigger, and v3 `runLLMModel`, which passes no signal. A hook that writes the chat needs abort checks between its steps instead of a race.
- Open question: may hooks get an additive reply id or origin (plugin contract, MC-175)?
- After a Stop the plugin's own calls may finish in the background (accepted in MC-3735).
