# Stage handoff: #596 parallel replies, after stage 2

Read this, the issue and the repository at origin/main. Source statements below were read at 9960b8fad (stage 2 base) and not executed, unless a test is named. Re-pin them before use.

## 1. Completed

- Stage 1 (keyed active-units registry, no behaviour change): PR https://github.com/yor42/RisuTanium/pull/636, merged as ab535a18c.
- Stage 2 (per-unit Stop plumbing, still one reply at a time): reviewed code commit efa25080e on `claude/596-parallel-replies-s2-92a4ca`, then origin/main cf640e93b merged in (includes #514 S4, PR 631). PR: see the branch.
- Refs #596. Stages 5 and 7 remain before the MVP update, so the final stage closes the ticket.

## 2. Decisions

Maintainer, earlier:

- MC-3308: replies in different chats run in parallel; a chat that is writing refuses a second send.
- MC-3309: the notification Stop stops every reply; per-chat Stop is in the app (#449).
- MC-3310: one keep-alive card ("N replies writing"), with an outcome kept per chat.
- MC-3734: stages 1, 2, 5 and 7 land before the MVP update; stage 6 after.
- MC-3735: while a plugin works after the reply, that chat keeps refusing a Send until the plugin finishes or the user presses Stop.

Maintainer, this stage (all in `Agents/mc/596.md`):

- MC-3736: "1, 2, 5, 7" is a set; the orchestrator orders 5 and 7. Stage 5's questions are answered, so stage 5 runs next, then stage 7.
- MC-3737: after a reload, Send refuses in a chat whose native reply still runs (new string, all 8 locales); Stop for it stays the notification's; #616 after the update.
- MC-3738: D5 (MC-1293) answered: chats of one character reply in parallel; character-field writes by scripts are last-writer-wins.
- MC-3739: previews and auto mode run beside other chats' replies; still one auto mode at a time.
- MC-3740: the header follows the shown chat's reply.
- MC-3741: v3 plugin `sendChat` pins the chat selected when it was called and refuses only if that chat writes, checked before the user message is added. No new plugin API parameter.
- MC-3742: error alerts queue, each naming its chat.
- MC-3743: stop-all (`abortChat`, the notification Stop) also stops a recovered apply.

MC block MC-3736..3743 is used up. Ask lane A for a new block before stage 5 records anything.

## 3. Stage 2 mechanism (accepted at Gate 1 r3, Gate 2 r1 EDITORIAL)

- `stopAllReplyWork()` in `chatOrigin.ts`, beside `stopWorkIn`: runs the stop of every `reply` and `preview` registration on a snapshot, once only, with a logged throw that does not shield the next. It reaches every outermost send, preview and recovered apply (an apply's stop sets `stopped` and aborts, so its write check returns `'deferred'`).
- `abortChat` (in `composerActions.svelte.ts`) is stop-all: `stopAllReplyWork()`, then the composer part (the auto run, every unsettled take, every held generation controller). `abortUnitInProgress` is removed. Per-chat Stop is still `stopWorkIn` / `stopComposerWorkIn`.
- Published unit tags: a `WeakMap<AbortSignal, target>` in `generationOwnership.svelte.ts`, tag-only (native `chat_stop` tags for two origins stay apart).
- Composer window: handles from `openComposerWindow(origin)`, ref-counted by chat; `setComposerWindow` is removed. It never takes an active unit.
- Locks carry their chat; the auto run is one identity-compared slot carrying its chat; each in-flight take has its own draft key.
- `turnsReached` and the process stage are keyed by the owner's chat (`setProcessStage`, `processStageIn`, a `SvelteMap`); the `chatProcessStage` export of `index.svelte.ts` is removed, and the stage reset now runs after admission.
- `stopDelete.svelte.ts`: at most one pending stop-and-delete per chat.
- Unchanged: `sendAdmissible` and `recoveredApplyBlocked` still refuse on any unit, and every "any" reader keeps its answer (doingChat, isComposerBusy, isComposerLocked, isAutoModeActive, composer window open, flip blocker, fast-forward, header).

User-visible: the notification Stop now also stops a recovered apply (MC-3743). A refused send no longer resets the running reply's progress ring. Both are rare; no device row is owed.

## 4. Changed files

- App: `src/ts/process/chatOrigin.ts`, `generationOwnership.svelte.ts`, `index.svelte.ts`, `composerActions.svelte.ts`, `src/ts/chatShell/stopDelete.svelte.ts`, `src/lib/ChatScreens/DefaultChatScreen.svelte`, `src/lib/ChatShell/ShellComposer.svelte`.
- New test: `src/ts/process/tests/generationOwnershipKeyed.test.ts`. 24 test files edited (new reproducers, import swaps from `abortUnitInProgress` to `stopAllReplyWork`, `setComposerWindow` to `openComposerWindow`).
- Records: `Agents/mc/596.md` (MC-3736..3743), this file.
- Exact list: `git show --stat efa25080e`.

## 5. Verification

- Gate 1: r1 REJECT (two test findings), r2 EDITORIAL, advisor PROCEED WITH AMENDMENTS (A1 stop-all through the work registry; A2 lock and auto-run handles carry their chat; A3 one draft key per take; A4 sub-stage seam), r3 EDITORIAL. Gate 2 r1 EDITORIAL by Opus: F1 two lost final newlines and F4 an `abortChat` comment overstatement were fixed in the commit after the merge; F2 and F3 are carried to stage 5 below.
- Red first: R1, R3b, R4, R5, R9, R9s (2a) and R7, R10, R11a, R11b, R12a, R12b (2b) failed on base on their assertions; probes P6 and P8 ran on base in scratch.
- Plan mutants M1..M38 killed (coder sweeps in run slot B). Gate 2's own 10 mutants: 6 killed, 4 survived in paths production cannot reach at stage 2 (see F2, F3).
- Gate 2 ran 31 files, 992 tests: pass. svelte-check: 0 errors, 5 warnings, as on base.
- After merging cf640e93b (#514 S4): T30 and `sendChatOwnedStream.svelte.test.ts` plus every changed test file and the stage-1 suites were rerun; results are on the PR.
- Not run locally: full suite, build, device, native. CI is the full run.

## 6. Unresolved and leftovers

- F2 (Gate 2): the auto run's registration stop that clears a newer run's slot is not killed by any test. Unreachable at stage 2. Stage 5 makes it reachable (a per-chat window plus a delete of the old run's chat): add `stopComposerWorkIn(chatA)` while run B is active, then assert `isAutoModeActive()` is still true.
- F3 (Gate 2): the generation-hold loop in `abortChat` (abort only the first held generation) and `sendChatMain`'s hold release are not pinned by a test. Equivalent at stage 2 (one composer action can hold generations). Stage 5 adds a several-actions test if the loops survive N2.
- `abortChat`'s composer steps do not isolate a throw (a throwing drafts listener in `cancelInflight` skips later steps); plan item F7, decided with N2.
- About 35 test mock factories of `index.svelte.ts` still carry an unused `chatProcessStage` key. Inert; remove when a stage touches those files.
- A stale comment in `messageActions.svelte.ts` (the plan's O1) still describes the old single controller.
- R7 in `stopDelete.svelte.test.ts` waits 60 ms for the 25 ms settle interval. Watch it in CI.
- Carried from stage 1: a throw at a recovered apply's take or `registerWork`, or ahead of the release in `sendChat`'s outer finally, leaves the unit held; Stop does not free a send that waits on a hung plugin hook until stage 7; `ChatShell.headerIntent` T-A3a (15 s mount wait) and `ChatShell.longChatHint` T4.4 can time out under load; re-grep for new `doingChat.set` after each merge of main.

## 7. Next stages

Each is Tier 2 on the critical contract (send admission and write exclusion): designer, Opus Gate 1, advisor challenge, fresh coder, Opus Gate 2. Fix re-checks follow MC-3767. Stages edit `index.svelte.ts`, so run them one after another.

Which predicate answers what:

| Question | Read |
|---|---|
| Any unit anywhere | `doingChat`, `activeUnits.any()` |
| A send or apply holds this chat (not reactive) | `activeUnits.has(key)` |
| This chat shows busy (UI, Stop) | `isBusyIn`, `isComposerBusyIn` |
| Anything writes this chat or character | `isWriting`, `hasWorkIn`, `writingTargets` |
| The composer holds the chat before a send | `composerWindowFor` |
| This chat's progress stage | `processStageIn(origin)` |

For every stage: the unit's AbortController signal is the unit id; mint no other. Add no per-chat predicate export to `index.svelte.ts` (about 293 test files mock it); use a leaf module, `chatOrigin` or `composerActions`.

### Stage 5: open the gate across chats (next)

Ask the maintainer first (with the next MC block):

- N2: should the composer part of stop-all move onto the registry, so the notification Stop equals "the in-app Stop of every chat that shows Stop"? Option A keeps the composer loops (stage 5 adds per-step throw isolation and a several-takes test). Option B (designer's recommendation) uses one enumeration: `stopComposerWorkIn` for every chat that shows Stop plus the reply/preview sweep elsewhere; it deletes the generation holds and the composer loops. Trade-off: a button or form trigger run (kind `work`) in a chat that shows Stop is then aborted by the notification Stop, as the in-app Stop already does. Re-read the reply chime path (`replyNotice.ts`, `noteReplySound`) before asking.

Then, before Gate 1:

- Implement MC-3737..3742 (reload-edge refusal reading `runningReplies.svelte`, without modelling that reply as a unit; same-character parallel; previews and auto mode per chat; header per shown chat; v3 `sendChat` pinned target checked before the message is pushed; queued error alerts naming their chat). New strings need all 7 non-English locales.
- Choose the gate's source: `activeUnits.has` or `isBusyIn`. Add a test that both answers agree at every awaited point of a send and an apply.
- Decide whether "take after the in-flight begin" is load-bearing. If not, make check and take adjacent and update O1; if it is, make a second take of a held key fail loudly.
- Make the release unconditional. A stuck key would block one chat whose button shows Send, with no Stop.
- Swap the refusal sites against an origin captured at the gate: composerActions, command, multisend, previewRunner, devToolActions, v3, DefaultChatScreen, ShellComposer, BookmarkList, ChatShell. Fast-forward and the flip blocker stay "any reply". The "another chat is writing" Send block (`chatShellSendBlockedWriting`) becomes false and is removed or reworded.
- `recoveredApplyDeferred` is one boolean: check that a wake-up is not lost. `recoveredApplyBlocked` and `deferRecoveredApply` take an origin but ignore it.
- MC-3310's card and per-chat outcomes.
- Decide "same chat or elsewhere" for each default-key `simulateRunningSend()`. G1, G2, G3, Q1, S1 and U2 pin today's rule or the registry's arithmetic. They are not product rulings.
- Required tests carried from stage 2: F2 and F3 above.
- Not yet covered by any sweep: cold-storage restore or unload during an off-screen reply, group speaker rotation, export or snapshot during a changing reply, desktop and Node reply paths. A plugin `parse` with `runVar` writes the selected chat unmarked (evidence sweep at 9960b8fad found no reply-path caller without a subject otherwise).

### Stage 7: plugin and hook stall

- Stop frees a chat only by making the body return. Never release from the Stop handler, by key or through the test reset. Check the signal after each raced hook, or a stopped unit still speaks, auto-continues or resends.
- Classify each awaited hook before racing it: `runChatOutputListeners` (two sites in the send, one in each apply; it takes no signal today, so a stop after the write cuts the output trigger short but not the listeners), both replacer loops in `src/ts/process/request/request.ts`, the replacer in the reconcile path in `src/ts/bootstrap.ts`, the `request` trigger, and v3 `runLLMModel`, which passes no signal. A hook that writes the chat needs abort checks between its steps instead of a race.
- Open question: may hooks get an additive reply id or origin (plugin contract, MC-175)?
- After a Stop the plugin's own calls may finish in the background (accepted in MC-3735).
