# Stage handoff: #596 parallel replies, after stage 5d (final)

Read this, the issue, `s5-plan-r2.md` beside this file (the accepted stage 5 plan) and the repository at origin/main. Source statements below were read at d70df2cb3 or 105915cbe and not executed, unless a test is named. Re-pin them before use.

## 1. Completed

- Stage 1 (keyed active-units registry): PR https://github.com/yor42/RisuTanium/pull/636, merged as ab535a18c.
- Stage 2 (per-unit Stop plumbing): PR https://github.com/yor42/RisuTanium/pull/648, merged as 1b23f5d1f.
- Stage 5a (the send gate opens per chat; engine and starters): PR https://github.com/yor42/RisuTanium/pull/669, merged as e5d5dc499.
- Stage 5b (stop-all = per-chat Stop, MC-3790): PR https://github.com/yor42/RisuTanium/pull/675, merged as 8804c641d.
- Stage 5c (per-chat UI and the O-6 re-list): PR https://github.com/yor42/RisuTanium/pull/692, merged as c09298670.
- DV-596-S5-1 (Note 9 phone 1, debug APK of c09298670): PASS on 2026-11-23. Two native replies in two chats; one notification Stop ended both; after a reload Beta's Send was refused with the new reason and came back without reload, Alpha admitted. Result: `%TEMP%\risu-b715\b61\596-s2\dv596-run1\dv596-s5-1-result.md`.
- Stage 7 plan accepted (Gate 1 r6 after advisor challenge): `s7-plan.md` beside this file. Decisions MC-3796..3799, MC-3950..3957.
- Stage 7a (abort leaf, script access revocation, script pass stop, MC-3958): PR https://github.com/yor42/RisuTanium/pull/705, merged as 1fe41cb28.
- Stage 7b (send-path hooks, request path, body interceptors, MCP and Gemini races, inlay and imggen, stableDiff signal): PR https://github.com/yor42/RisuTanium/pull/717, merged as 5c24228a5.
- Stage 7d (edit passes outside the live output, TTS, composer input race MC-3957): PR https://github.com/yor42/RisuTanium/pull/726, merged as bdda8894a.
- Stage 7e (live output passes under the 10 s stop deadline, non-stream raw store, 20 s watchdog; MC-3950, MC-3955): PR https://github.com/yor42/RisuTanium/pull/731, merged as c736d40a7.
- Stage 7c (60 s bounded wait per replacerafterRequest on a recovered reply, MC-3798): PR https://github.com/yor42/RisuTanium/pull/734, merged as ca8f2db2e.
- Stage 5d (reply-error alerts queue as boot notices, count card, native Stop mark; MC-3959 in `Agents/mc/596-s5d.md`): branch `claude/596-parallel-replies-s5d`, plan `s5d-plan.md` beside this file (Gate 1 r1 reject, r2 editorial); Gate 2 Sonnet r1 editorial, items fixed. Closes #596.
- Refs #596. Remaining before the MVP update, in this order (MC-3736, orchestrator's order): none; #596 closes with 5d. The final stage closes the ticket.

## 2. Decisions

All in `Agents/mc/596.md` unless noted.

- MC-3308 (Maintainer-Context): replies in different chats run in parallel; a chat that is writing refuses a second send. MC-3309: the notification Stop stops every reply. MC-3310: one keep-alive card, outcome per chat.
- MC-3734: stages 1, 2, 5 and 7 before the MVP update; stage 6 after. MC-3735: a plugin working after the reply keeps that chat refusing Send until it finishes or Stop.
- MC-3736: the stage list is a set; the orchestrator orders it.
- MC-3737: after a reload, Send refuses in a chat whose native reply still runs; Stop for it stays the notification's; #616 after the update.
- MC-3738: chats of one character reply in parallel; script writes to character fields are last-writer-wins (answers MC-1293 D5).
- MC-3739: previews and auto mode run beside other chats; one auto mode at a time. MC-3740: the header follows the shown chat.
- MC-3741: v3 `sendChat` pins the chat selected at the call, refusing only if that chat writes, before the push. MC-3795: if that chat is gone, push nothing and throw "No active chat found".
- MC-3742: error alerts queue, each naming its chat. MC-3792: the first line is "Character: chat name".
- MC-3743: stop-all also stops a recovered apply.
- MC-3790 (N2): the notification Stop is the in-app per-chat Stop for every chat that shows Stop, plus the reply/preview sweep; stage 2's composer loops in `abortChat` go. A button-trigger run beside a reply in the same chat is then cut too.
- MC-3791: the card shows "N replies writing" with no name; it closes as "N replies failed" or "N replies stopped"; one bad chat keeps today's named notice.
- MC-3793, MC-3794: in a chat whose native reply still runs after a reload, previews and tree edits are refused too, and the tree controls show busy.

MC block MC-3790..3799: MC-3796..3799 are unused.

## 3. Mechanism so far

Stage 2 (unchanged by 5a except where noted): `stopAllReplyWork()` in `chatOrigin.ts`; `abortChat` = stop-all; published unit tags in a `WeakMap`; composer window handles per chat; keyed locks, auto run, draft keys, turns and process stage (`processStageIn`); `stopDelete` per chat.

Stage 5a:

- `src/ts/process/sendAdmission.ts` (new leaf): `chatKeyOf`, `selectedChatKey`, `sendRefusalIn` (engine) and `starterRefusalIn` (starters), null first. A chat is refused when `activeUnits.has(its key)` or when `runningReplies.svelte.ts`'s non-reactive reader lists a running native reply for it (the reload edge, not modelled as a unit).
- `activeUnits.take()` returns a boolean and refuses an equal key. The take moved next to `enterSendChat`, with a re-check, before publish, in-flight and the abort listener. The release is unconditional (a nested finally in `sendChat`; the applies take first, with `registerWork` inside the `try`).
- Recovered-apply deferral and its wake-up are keyed per chat (`deferRecoveredApply`, `rerunDeferredApply(origin)`); `recoveredApplyBlocked` is gone.
- Every starter refuses on the chat it pushes or takes: composer send, tree edits (`enterTree`) and auto mode, `/command`, `.po` multisend, `previewRunner`, `devToolActions`, v3 `sendChat` (pinned chat; MC-3741, MC-3795). Fast-forward, the flip blocker, the backup guard and `doingChat` stay "any unit".
- Intermediate state (dev builds only): the composer UI still disables Send while another chat writes, and in a reload-edge chat Send is enabled but refused silently, until 5c. A recovered apply's early return now pulses `doingChat`, which can re-show a header hidden by reader intent until 5c removes the header's `doingChat` subscription.

Which predicate answers what:

| Question | Read |
|---|---|
| Any unit anywhere | `doingChat`, `activeUnits.any()` |
| May this chat start a send (engine / starter) | `sendRefusalIn`, `starterRefusalIn` |
| A send or apply holds this chat (not reactive) | `activeUnits.has(key)` |
| This chat shows busy (UI, Stop) | `isBusyIn`, `isComposerBusyIn` |
| Anything writes this chat or character | `isWriting`, `hasWorkIn`, `writingTargets` |
| The composer holds the chat before a send | `composerWindowFor` |
| This chat's progress stage | `processStageIn(origin)` |

For every stage: the unit's AbortController signal is the unit id; mint no other. Add no per-chat predicate export to `index.svelte.ts` (about 293 test files mock it); use a leaf module (`sendAdmission`, `chatOrigin`, `composerActions`).

## 4. Stage 5a verification

- Plan: `s5-plan-r2.md`. Gate 1 r1 REJECT (release order in the applies and a skipped wake-up; a v3 registration leak; a mismapped mutant), advisor PROCEED WITH AMENDMENTS AM1..AM5, Gate 1 r2 EDITORIAL.
- Two serial Sonnet coders (seam 1 engine, seam 2 starters). Red first on base: 26 seam 1 rows and 19 seam 2 rows failed on their assertions; guards are labelled in the files. Seam 1: 22/22 mutants killed; seam 2: 21 killed, including M26 and M33 after V9 and V10 were added.
- Gate 2 r1 (Opus) EDITORIAL: F1..F8 fixed in the editorial commit (docs, a JSDoc, two final newlines, a test title, new tests V8b and K2 each shown to fail on a hand mutant); F9 (A12b simplified) accepted. Sonnet re-check under MC-3767.
- Gate 2 reran 33 files, 894 tests: pass. `pnpm check`: 0 errors, 5 warnings, as on base.
- Accepted deviations: O1 and R6a changed because the take moved; `commandLineOrigin`'s "button's /multisend in another chat" now generates in chat B (MC-3308).
- Not run locally: full suite, build, device, native. CI is the full run.

## 5. Known limitations and leftovers (name in the 5a PR)

- R5: the reload-edge refusal starts only after the first reconcile pass lists the reply; between boot and that pass, Send in that chat is admitted.
- R5b: keys waiting for a unit refuse Send in their chat from that chat's release until the requested pass finishes; an auto run there breaks at its next tick.
- R9: a throw before an apply's write returns `'failed'`, and its one-time "failed elsewhere" note can mislead for a reply a later pass places.
- R10: a recovered apply can take chat A between the composer Send's push and its `sendChat`; the send is refused and the user message has no reply. Existed under the global rule; per-chat deferral makes it reachable while other chats write. Closing it needs a wake-up on window close.
- O-6: closed in 5c by `src/ts/nativeReply/runningRelist.svelte.ts` (re-list at 2, 4, 8, 16, 30 s, then every 30 s, only while the shown chat is refused by a native entry and not busy; stops on clear, chat change or hide). The re-list widens the retry rate of kept records while a chat is blocked (5c Gate 2 E8). A panic exit is healed by the same re-list.
- E-r2-4: v3's cold-chat re-check is plugin-visible.
- From stage 2: about 35 test mocks of `index.svelte.ts` keep an unused `chatProcessStage` key (remove in files a sub-stage edits); R7's 60 ms timer in `stopDelete.svelte.test.ts`; `ChatShell.headerIntent` T-A3a and `ChatShell.longChatHint` T4.4 can time out under load; re-grep for new `doingChat.set` after each merge of main.

## 6. Next

Each step is Tier 2 on the critical contract (send admission and write exclusion), except 5d's alert half. The plan covers 5b and 5c, so no new designer is needed: fresh coder, Opus Gate 2 (5c at the orchestrator's call), PR. Fix re-checks follow MC-3767. Steps edit `index.svelte.ts` or `composerActions.svelte.ts`, so run them one after another.

### 5b: stop-all = per-chat Stop (MC-3790)

As `s5-plan-r2.md` (r1 steps carried): enumerate the chats that show Stop (`composerWindows` is module-private; add an enumeration in `generationOwnership`/`chatOrigin`), rewrite `abortChat` as `stopComposerWorkIn` per such chat plus the reply/preview sweep, delete the generation holds and the composer loops, and update the stale comment in `messageActions.svelte.ts` (O1). F3 and F7 from stage 2 disappear with the loops. Stage 7's hook checks must read the unit's signal (`signal: unit.signal`), never the caller's.

### 5b result (done)

- `abortChat` snapshots `composerWindowTargets()` (`generationOwnership`) and `busyTargets()` (`chatOrigin`: owner chats of reply/preview registrations), runs `stopComposerWorkIn` for each, then the `stopAllReplyWork()` sweep. The generation holds and stage 2's composer loops are gone; takes, continue, auto runs and replies are reached through their registrations (the composer Send's gap between push and `sendChat` through `stopTake`'s fallback).
- Gate 2 r1 (Opus) EDITORIAL. Known limitations: B7 (DefaultChatScreen's no-shown-chat Stop fallback) has no test; its wiring is unchanged. B4 uses a take in C and a mocked `sendChat` (regenerate and auto-tick reach is covered by `chatTreeEngine` TB2 and `generationOwnership`'s auto-tick test, and by guards P0-P2 that run the real stop-to-silence chain). The final sweep is redundant by construction (mutant R4 and M42 survive as equivalent); keep it as the sweep MC-3790 names.

### 5c: per-chat UI

As the plan: ShellComposer, DefaultChatScreen, BookmarkList, ChatShell (busy reader and header, MC-3740), Suggestion, `isComposerLockedIn`; delete `chatShellSendBlockedWriting`; add `chatShellSendWaitsForNativeReply` ('A reply is still being written in this chat. Send when it finishes.') in all 8 locales (translator, same PR); tree controls busy in a reload-edge chat (MC-3794); the O-6 re-list. About 27 one-line mock factory edits.

After 5c merges: device row DV-596-S5-1 (this ticket's own session asks for it, leases a Note 9 through the main checkout's controller by absolute path and writes the row; lane B is retired, MC-3774; `Agents/Tools/device/BRIEF-TEMPLATE.md` sections 5 and 8; synthetic data): two native replies in two chats; the notification Stop for both; a reload with one still running (B refused with the new string, A works, B's Send returns when its native reply ends, without a reload). A fail stops stage 7's plan acceptance until dispositioned.

### 5c result (done)

- Send, textarea and suggestions follow the shown chat (`isComposerLockedIn`, `isComposerBusyIn`, `sendRefusalIn`); ChatShell header and `getBusy` follow the shown chat (MC-3740), with the native row for tree busy (MC-3794); BookmarkList busy re-evaluates on chat switch. `requestReconcile()` now returns the pass promise so the re-list never has two requests outstanding.
- Gate 2: Opus r1 REJECT on test fidelity only (S1 C4b, S2 C7, S3 ChatShell half of C5); remediated; Sonnet r2 APPROVE. Accepted limitations: E2 (visible-restart only tested from step 0), E3 (the re-list `epoch` guard has no test), E4 (bootstrap wiring of the awaited pass has no test), E5 (DefaultChatScreen's busy exclusion for the re-list untested), E9 (a suggestion click in a native-blocked chat).

### Stage 7: plugin and hook stall (design starts after 5b merges)

- Stop frees a chat only by making the body return. Never release from the Stop handler. Check the unit's signal after each raced hook, or a stopped unit still speaks, auto-continues or resends.
- Classify each awaited hook before racing it: `runChatOutputListeners` (two sites in the send, one in each apply; it takes no signal today), both replacer loops in `src/ts/process/request/request.ts`, the replacer in the reconcile path in `src/ts/bootstrap.ts`, the `request` trigger, and v3 `runLLMModel` (no signal). A hook that writes the chat needs abort checks between its steps instead of a race.
- Cross-chat couplings that stage 5 leaves (plan R8): C-1 the Lua mode mutex is shared by every chat (a waiting script in A stalls B's next run in that mode; needs abortable waits, advisor N3: does the mutex let a waiter leave on abort?); C-2 the reconcile pass is serial and replaces the running map only at its end, so an apply awaiting a hook keeps every other chat's reload-edge refusal; C-3 `recoverText` replacers run in the pass before any unit or registration exists, so a stall there has no Stop. Replacing stale entries at the start of a pass would admit a Send ahead of a finished recovered reply (reply order trade-off).
- Open question: may hooks get an additive reply id or origin (plugin contract, MC-175)?
- After a Stop the plugin's own calls may finish in the background (MC-3735).

### Stage 7 progress

- 7a done (fa150373d): `src/ts/process/abortRace.ts` (race on the unit signal, `detach` with a terminal catch; no stage-7 code detaches a promise any other way), access-id revocation in `scriptings.ts` (also before registration and in the mutex queue), `runScriptPass` returns after an aborted hook. Gate 2: Opus r1 reject on test fidelity only, Sonnet r2 approve. Equivalent mutant: M16 (argued in `s7a-code-1.md`).
- 7b done: every send-path hook, request-path hook, body interceptor, MCP tool call and inlay/imggen wait races on the unit signal. New `src/ts/process/request/bodyInterceptors.ts`. Known limitations for 5d and later: K1..K12 in s7-plan.md, plus an abandoned emotion or additional-information search still starts its query embedding after Stop (Gate 2 r1 E1).
- 7d done: the editprocess and editRequest passes, the recovered applies' output pass, sayTTS (linked signal, raced pre/postprocessors), /speak and the composer's 'input' trigger and editinput race their Stop. Known limitations: Gate 2 r1 E1 (abandoned threading not pinned by a test at the composer and first-message sites), E4 (EP-1 has no mark assertion), E5 (sayTTS stop.dispose untested).
- 7e done: one stop deadline and one watchdog per unit, owned by the sendChat wrapper (WeakMap keyed by the unit signal, disposed in its finally). Stream-end passes stop writing when abandoned; non-stream passes store the pass input raw (no inlay), and a stopped non-stream body returns before runCurrentChatFunction. Plan correction (Gate 2 r1 E3): D-11 is unreachable, because the existing early return after requestChatData ends the body before any pass when Stop lands during the request; D-11 is a guard and M63 is equivalent. Known limitation E1: the non-stream inlay comment covers only the abandoned case.
- 7c done: `boundedRecoveredReplacers` in `nativeReply/reconcile.ts`, wired in `bootstrap.ts` recoverText. Known limitation: the bootstrap wiring has no test (plan E5/P14).
- 5d: the maintainer answered FQ-1..3 on 2026-11-23 (all as boot notices: a reply error waits behind a closable alert, returns after a cover, only the person's close dismisses it); record as MC-3959 in the 5d PR. Plan by the designer in `s5d-plan.md` (scratch), then Gate 1.
- 5d done. Device row for after the merge (plan O-10, Note 9, synthetic): two native replies give "2 replies writing" and the notification Stop gives "2 replies stopped" with no "Replied" after it; one visible toast for a hidden chat; two mock failures in two chats give two labelled alerts one after another; a confirm up during a failure makes the error wait.
- Carry to 5d (from DV-596-S5-1): the reply notification names one chat while two run (MC-3791's count card fixes it); a stopped reply in a hidden chat raised both a "was stopped" and a "replied" toast.

### 5d: queued alerts and the card (after stage 7)

Re-plan before coding (advisor AM4): the reply-error queue becomes a lane of the existing controller in `alertPrompts.ts`. Ask the maintainer first: FQ-1 a queued error waits behind an alert the person can close instead of replacing it; FQ-2 it is shown again after a cover closes; FQ-3 code cannot close it. The card half follows MC-3791 (keys `keepAliveRepliesWriting`, `keepAliveRepliesFailed`, `keepAliveRepliesStopped`); the alert label follows MC-3792. New keys in all 8 locales.
