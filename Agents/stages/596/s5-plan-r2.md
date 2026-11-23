STATUS: PLAN READY, OPEN PRODUCT QUESTIONS

# #596 stage 5: open the send gate across chats, plan round 2

Designer, revision after Gate 1 r1 `[REJECT]` (`s5-gate1-r1.md`), the advisor challenge (`s5-advisor.md`) and the answered questions (`pending-mc.md`, MC-3790..3794). Tree: `C:\Projects\RisuAI\.claude\worktrees\596-parallel-replies-s2-92a4ca` at HEAD d70df2cb3, clean. Read-only: only reads, greps and one `Get-Content` line slice were run. Every `file:line` was read at that HEAD unless marked INHERITED. Nothing was executed: every reproducer is DESIGNED, NOT DEMONSTRATED.

## Disposition table

| item | resolution | plan section |
|---|---|---|
| F1 release not unconditional; wake-up skipped by a throw | ADDRESSED. Nested finally in all three takers: the release runs in the innermost `finally`, and the wake-up runs in a `finally` of the release. New rows A7b, A8b; mutants M5b, M11b, M11c. I3 rewritten. | Mechanism: "One check-and-take rule", "Gate", "Applies"; Required tests 5a; I3 |
| F2 v3 leaks a work registration; TypeError for nothing selected | ADDRESSED. Every check that throws runs before `beginWork`, with today's texts in today's order: type, busy, plugin model, no character, no chat. Only the push and the hand-off follow `beginWork`, inside `try/finally { handle.end() }`. An ambiguous origin resolves through the hint, as composer Send does. New rows V5, V6, V7; mutants M34-M36. A gone pinned chat is Q5. | Mechanism: "v3 sendChat"; Required tests V5-V8; Open items Q5 |
| F3 M3 cannot be killed by A3 | ADDRESSED. New row A3b: a second send started from a `'speaker'` change listener inside `enterSendChat`. Under AM2 the re-check is the take's own result, and M3 is mapped to A3b. A3 is kept for M4 and now asserts which call is refused. | Required tests A3, A3b; Mutants |
| E1 A11 fixture impossible on S2 | ADDRESSED. The second hold comes from the first send's in-flight notice (R1's one-shot). It holds on S2 and after 5a. | A11, A11b fixture |
| E2 mock factories reached by the new leaf | ADDRESSED. 5a engine step 0 surveys `generationOwnership` mocks. The five named files are on the targeted-run list. | 5a steps; Expected files |
| E3 `starterRefusalIn(null)` | ADDRESSED. Both refusal readers return null for a null key before any other read; the module doc says so. | Mechanism: leaf |
| E4 S-A2 overstated | ADDRESSED. Reworded. | S-A2 |
| E5 A15/A16 real send impossible | ADDRESSED. `simulateRunningSend(CHAT_A)`. | A15, A16 |
| E6 a throw before the write now returns `'failed'` | ADDRESSED by statement. This is the same class as today's `processScriptFull` throw (`index.svelte.ts:638-640`). The one-time "failed elsewhere" note is accepted and named in the 5a PR. | Applies; Risks R9 |
| E7 handoff's unswept list | ADDRESSED. Each item is dispositioned in Out of scope. | Requirements: Out of scope |
| E8 waiting keys refuse Send | ADDRESSED as a known limitation in the 5a PR. | Risks R5b |
| E9 apply in a composer Send's gap | ADDRESSED as a one-line limitation in the 5a PR, as the advisor recommends (N2). | Risks R10 |
| E10 request-layer `alertError` | ADDRESSED. Named in the 5d PR. It moves to the 5d re-plan's input list. | 5d; Out of scope |
| E11 A14 class note | ADDRESSED. Narrowed to the two named triggers. | A14 |
| Gate 1 "Simpler path" (advisory) | NOT ADOPTED, with a reason. The keyed set is correct apart from F1, which nesting fixes. The release still needs the nesting either way. The keyed set avoids one `store.list()` IPC per reply end on Android. | Risks R3 |
| AM1 R8 false; three cross-chat couplings | ADOPTED. R8 rewritten. C-1 Lua mode mutex, C-2 serial pass alone clears `nativeReply`, C-3 `recoverText` replacers with no unit or Stop: carried to stage 7 as a named list. C-2 and C-3 are newly visible through 5a's refusal, but none is small (reasons in R8). New row A12b. "A reply the page no longer holds" wording. | Risks R8; Requirements 2; A12b; Open items O-7 |
| AM2 one check-and-take rule | ADOPTED in the preferred form. `take()` returns false when an equal key is already held and adds nothing. All three takers treat false as their refusal. The applies take first, so the take is their only check. | Mechanism: "One check-and-take rule"; U2, U7; M3-M3d |
| AM3 5a one PR, two coder seams | ADOPTED. Seam 1 is the engine (rows U, A1-A14, A12b), seam 2 the starters and v3 (A15-A22, V, P, K). A fake-flag survey runs before seam 2. | Sub-stages; 5a steps |
| AM4 5d after stage 7; alert queue re-designed on `alertPrompts.ts` | ADOPTED as the orchestrator ordered: 5a, 5b, 5c, stage 7, 5d, all before the MVP update (MC-3736). The 5d alert half is marked for re-design before coding. The three behaviour differences are listed as future maintainer questions. The card section is kept, marked "re-planned before coding". | Sub-stages; 5d; Open items FQ-1..3 |
| AM5 Note 9 device row after 5c | ADOPTED. DV-596-S5-1, synthetic data, run by lane B. | Acceptance: Device row |
| MC-3790 (N2 Option B) | FOLDED: 5b as planned. | 5b |
| MC-3791 (Q1 card) | FOLDED: 5d card rows D5-D10, D9 = "N replies failed/stopped". | 5d |
| MC-3792 (Q2 label) | FOLDED: the input to the 5d alert re-design. | 5d |
| MC-3793 (Q3 preview) | FOLDED: previews in a chat with a native entry are refused (`starterRefusalIn` and the `sendChat` gate). | Mechanism; P2 |
| MC-3794 (Q4 tree) | FOLDED: tree steps are refused in such a chat, and tree controls show busy. | `enterTree`; 5c; A18b, C5 |

## What changed from r1

1. `activeUnits.take()` now returns a boolean and refuses an equal key (AM2). `recoveredApplyBlocked` is deleted: each apply takes first and defers when the take is refused. `sendChat`'s separate `has` re-check is replaced by the take's result, inside a `try/finally` that ends the entry on refusal or on a throw.
2. Nested finally in all three takers. The wake-up is no longer skippable, and an apply wakes only when its take succeeded (F1).
3. v3 `sendChat` order rewritten. Nothing that throws runs after `beginWork` outside a `finally` that ends it (F2).
4. New rows: U7, A3b, A7b, A8b, A10b, A12b, A18b, V5-V8. Rewritten: U2 (now asserts the new rule, not only its title), A3, A11, A14, A15, A16. New mutants M3b-M3e, M5b, M8b, M11b, M11c, M34-M36.
5. Order 5a, 5b, 5c, stage 7, 5d. The 5d alert half is marked for re-design on `alertPrompts.ts` (D1-D4 and M60-M63 are superseded). The 5d card half is kept as is, marked "re-planned before coding".
6. R8 rewritten, with couplings C-1..C-3 for stage 7. Known limitations named for the 5a PR (R5, R5b, R9, R10). The handoff's unswept list is dispositioned.
7. 5a is one PR with two coder seams. Survey steps: `generationOwnership` mocks and fake-flag tests.
8. Device row DV-596-S5-1 after 5c.
9. Q1-Q4 are removed as open (MC-3791..3794). New open question Q5: what v3 `sendChat` does when its pinned chat is gone after the prompt.

Everything not listed is unchanged from r1.

## Summary

- Stage 5 is about 950-1,250 changed app lines and 1,700-2,200 test lines in four sub-stages: 5a gate and starters, 5b notification Stop = per-chat Stop (MC-3790), 5c per-chat UI, 5d the card and the queued error alerts. Each sub-stage is its own PR (Refs #596). Order: 5a, 5b, 5c, stage 7, then 5d, all before the MVP update. 5a has two serial coder seams (engine, then starters).
- Gate: the untracked `activeUnits.has` plus an untracked native-reply reader, in a new leaf `sendAdmission.ts`. Not `isBusyIn`.
- One check-and-take rule (AM2). `take()` refuses an equal key. `sendChat` checks before `enterSendChat` (with a reason, registering nothing), then treats a refused take as a refusal and ends what `enterSendChat` began. Each apply's first act is the take, and a refused take defers.
- Release and wake-up are unconditional once the take succeeded: nested finally in all three takers (F1). The wake-up is a keyed set of chats.
- v3 `sendChat` pins the chat selected at the call. Every throwing check runs before `beginWork` with today's texts and order (F2).
- Stage 7 carries three cross-chat couplings that this stage makes visible but does not fix (AM1).
- Open: Q5 (v3, pinned chat gone during the prompt; one branch of 5a seam 2). FQ-1..3 are future questions for the 5d re-design and block nothing now.

## Requirements and scope

In scope (MC-3308, MC-3309, MC-3310, MC-3735, MC-3737..MC-3743, MC-3790..MC-3794):

1. Per-chat admission (MC-3308). A send into chat B is admitted while chat A writes. A send into a chat that holds a unit is refused. This covers every outermost `sendChat`, previews included (`index.svelte.ts:262`).
2. Native-reply refusal (MC-3737, wording per AM1/M2). While `runningReplies` lists a native reply the page no longer holds targeting chat X, Send in X is refused with a reason (new string, 8 locales). The page stops holding a reply after a reload, and also after a send ends on the page while its native request still runs: `settleNativeReplyInflight` drops a key whose end it never saw and requests a pass (`pageState.ts:226-242`), and that pass lists the live key (`reconcile.ts:505-510`). No in-app Stop for it. It is not modelled as a unit. Previews (MC-3793) and tree steps (MC-3794) in X are refused too, and X's tree controls show busy.
3. Same character in parallel (MC-3738). The key stays the owner's chat (`activeUnits.ts:22-25`).
4. Previews and auto mode beside other chats (MC-3739). Still one auto mode at a time.
5. The header follows the shown chat's reply (MC-3740).
6. v3 `sendChat` pins the chat selected at the call and refuses only if that chat writes, checked before the push (MC-3741). No new plugin API parameter.
7. Reply error alerts queue, each naming its chat (MC-3742, MC-3792). Delivered in 5d after its alert half is re-planned.
8. Stop-all (MC-3309, MC-3743, MC-3790). The notification Stop equals the per-chat Stop for every chat that shows Stop, plus the reply/preview sweep. `abortChat`'s composer loops and the generation holds are deleted.
9. One keep-alive card "N replies writing", an outcome kept per chat (MC-3310, MC-3791). Delivered in 5d.
10. Handoff leftovers. F2 (the auto-run stop must not clear a newer run) gets A20. F3 and F7 are void under MC-3790 (Risks). O1 (`messageActions.svelte.ts:169-170`) is updated in 5b.
11. Default-key `simulateRunningSend()` callers are classified (table T-class).

Out of scope:

- Stage 6: subject hygiene, character fields, the Lua mutex, the plugin `parse` + `runVar` selection-bound write.
- Stage 7: hook stall, abort checks between hooks, couplings C-1..C-3 (R8).
- #616 (keyed native cancel after a reload), and #449 beyond the existing per-chat Stop.
- Desktop and Node specifics; the MVP is Android.
- The 7 direct `alertError` calls in the request layer: `google.ts:516,536,1028,1286`, `responses.ts:597`, `requests.ts:896,1201` (INHERITED FROM GATE 1 E10). They stay unqueued and unlabelled. MC-3742 then holds only for errors through `throwError` and `sendChatMain`; the 5d PR names this.
- The handoff's "not yet covered by any sweep" list (E7). None of these is newly reachable through stage 5: switching chats mid-reply made each reachable at stage 1.
  - Cold-storage restore or unload during an off-screen reply: unload skips a chat that is writing (`coldstorage.svelte.ts:863`, INHERITED FROM GATE 1).
  - Group speaker rotation: `group.ts` reads `selectedCharID`, which is stage 6 subject hygiene.
  - Export or snapshot during a changing reply: as at stage 1.
  - Desktop and Node paths: out of scope.

## Approach and stages

### Mechanism (shared by every sub-stage)

**One check-and-take rule (AM2).** `activeUnits.ts`:

- `take(): boolean`.
  - It returns true when this handle holds its key after the call: newly added, or already held by this handle (today's same-handle early return).
  - It returns false when another handle holds an equal key (both ids equal). Then nothing is added and the store is not written.
  - `release()` is unchanged. A handle whose take was refused is not in the set, so its release is a no-op.
- The module doc's line "A second take of one key is not refused here ... the gate stays the one place that decides" (`:13-14`) is replaced. The new text says a take of a key another handle holds is refused and adds nothing; every taker treats false as its refusal; the gates before a take only refuse earlier, with a reason.
- Callers of `take()` (COMPLETE for `src`, grep `\.take\(\)` restricted to `activeUnits`):
  - production: `index.svelte.ts:420,585,693`;
  - test helper: `activeUnits.test-helpers.ts:11`;
  - `activeUnits.test.ts`;
  - `ChatShell.headerIntent.svelte.test.ts:216-217`, two different keys, so it is unaffected.

**New leaf `src/ts/process/sendAdmission.ts`.** It imports only `activeUnits`, `runningReplies.svelte`, `generationOwnership.svelte` and `stores.svelte`. No repository test mocks `activeUnits` or `runningReplies` (grep = 0, INHERITED from r1 and re-run by Gate 1).

- `chatKeyOf(owner, chat): ActiveUnitKey | null`: both ids present gives the key, else null.
- `selectedChatKey()`: `chatKeyOf` of the selected owner and its shown chat. `sendTargetOf`'s no-origin branch (`index.svelte.ts:344-349`) delegates to it.
- `sendRefusalIn(key): 'writing' | 'nativeReply' | null`. A null key gives null first. Then `'writing'` when `activeUnits.has(key)`, `'nativeReply'` when `nativeReplyRunsInNow(key)`. Not reactive.
- `starterRefusalIn(key): 'writing' | 'nativeReply' | 'composer' | null`. A null key gives null first, before `composerWindowFor` is called, because that function dereferences `target.chaId` (`generationOwnership.svelte.ts:47-53`, INHERITED FROM GATE 1 E3). Then `sendRefusalIn`, then `'composer'` when `composerWindowFor(key)`. Used by every starter that pushes or takes before it calls `sendChat`. The `sendChat` gate never reads the composer window, because `sendChatMain` runs inside the composer's own window.
- The doc states three rules: the reads are untracked on purpose; the composer window is a starter rule, never a gate rule; a null key holds nothing. A chat without ids cannot hold a unit, because ids are filled only inside `beginWork` (`chatOrigin.ts:965-999`) and never cleared (P19, INHERITED FROM SIZING).

**`runningReplies.svelte.ts`** gains `nativeReplyRunsIn(target)` (reactive, reads `version` first like `:35`) and `nativeReplyRunsInNow(target)` (does not read `version`). Each matches an entry whose target's `chaId` and `chatId` both equal the key. A `null` target matches nothing. Message presence is ignored. The map also holds keys waiting for a unit (`:102-109`, `reconcile.ts:517-520`), so those refuse too (R5b).

**Gate in `index.svelte.ts` `sendChat`:**

1. `if(!sendAdmissible(arg) || arg.signal?.aborted) return false`, where `sendAdmissible(arg)` = `sendRefusalIn(sendTargetOf(arg)) === null`. A refusal here registers nothing and fills no ids.
2. `const entry = enterSendChat(...)`; null returns false (unchanged).
3. `const active = activeUnits.unit(entry.context.origin)`, then the take inside its own `try/finally`:
   ```
   let admitted = false
   try { admitted = active.take() }
   finally { if(!admitted){ active.release(); entry.releaseSpeaker(); entry.handle.end() } }
   if(!admitted){ console.error(<one line naming the chat>); return false }
   ```
   - On a refused take, the `release()` is a no-op. It matters only when `take()` throws after adding (a throwing `active` subscriber), and then the unit is still released.
   - `beginWork` already marks a fresh id fill for save (`chatOrigin.ts:976-978`), so the refusal marks nothing.
   - The refusal is reachable only through a synchronous callback inside `enterSendChat`: the `'speaker'` change from `addReplySpeaker` (`activeStreams.ts:133-137`, listeners via `subscribeStreamChanges` `:50`).
4. `try { setProcessStage(origin, 0); addEventListener; publishUnit; beginInFlight; ...body... } catch ... finally { ... }`. Nothing between the take and the end of step 3 notifies a subscriber except the take itself.
5. Finally shape (F1):
   ```
   finally {
     try {
       try { ...today's steps through releaseUnit(unit)... }
       finally { try { active.release() } finally { rerunDeferredApply(entry.context.origin) } }
     } finally { settleSendChatCall(entry); announceReply ... (unchanged) }
   }
   ```
   The release order relative to the registration end is unchanged: unit first, registration second.

**Applies (`applyRecoveredReply` `:564-650`, `applyRecoveredStreamReply` `:667-796`):**

- `recoveredApplyBlocked` is deleted. The take is the apply's first act and its only exclusion check:
  ```
  const origin = ...
  const active = activeUnits.unit(origin)
  let held = false
  let handle: WorkHandle | null = null
  let pushed = false   // `written` in the stream apply
  try {
    held = active.take()
    if(!held) return deferRecoveredApply(origin, key)
    ...today's resolves and early returns ('failed', 'applied'/'present')...
    handle = registerWork(origin, stop, 'reply')
    ...today's body...
  } catch(error){ console.error(error); return pushed ? 'applied' : 'failed' }
  finally {
    try { if(pushed){ ...today's await/mark/hold... }; handle?.end() }
    finally { try { active.release() } finally { if(held) rerunDeferredApply(origin) } }
  }
  ```
- The early returns now run with the unit held, which the `finally` releases. Before, the blocked check came first and the early returns took nothing.
- The wake-up runs only when `held`. A refused take must not clear its own new deferral. Otherwise the requested pass defers again and requests again, and passes repeat until the holder releases (M8b, A10b).
- A throw before the write (a resolve, `registerWork`) now returns `'failed'` instead of rejecting the apply (E6). This is today's class for a `processScriptFull` throw (`:638-640`). The reconcile posts the "failed elsewhere" note once and keeps the record (`reconcile.ts:280-283`, `:405-407`), and a later pass places it. Accepted and named in the PR (R9). `'deferred'` is not used for it, because a script that always throws would then be retried silently on every pass.

**Keyed wake-up (unchanged from r1, F1 nesting added above):**

- `deferRecoveredApply(origin, key)` adds the chat key (`chatKey` rule, `generationOwnership.svelte.ts:121-123`, INHERITED from r1) to a module `Set<string>` and calls `noteWaitingForUnit(key)`.
- `rerunDeferredApply(origin)` deletes that chat's key when present, then calls `requestReconcile()`.
- Why keyed: under per-chat blocking the boolean would be cleared by an unrelated chat's release. A pass that returns at `deps.gate()` (`reconcile.ts:488-490`) would then leave a waiting reply until the next visibility change.

**Starters.** Each computes its key with `chatKeyOf` from the objects it pushes into, captured before any await.

- `composerActions.sendMain`: reads `char`/`startChat` (today `:280-288`) before the refusal, then refuses when `starterRefusalIn(key)` is non-null. This replaces `get(doingChat)` and `isComposerWindowOpen()` (`:273-278`). The refusal comes before `beginWork` and the composer take, so the draft is untouched.
- `enterTree` (`:609-635`): the same. Every tree step is refused in a chat with a native entry (MC-3794). Regenerate and reroll-generate pass through it, so the refusal comes before `detachTail`.
- `runAutoMode`:
  - Start (`:979`): `starterRefusalIn(key)` for the selected chat. `if(autoRun){ autoRun = null; return }` stays.
  - Tick (`:1013`): `sendRefusalIn(target key) !== null || !isShowingChat(target.origin)`. It never reads the composer window (the run's own window is open, `:1006`).
- `command.ts:286`: `generates = sendRefusalIn(subject key) === null && (ctx.ownsWindow === true || !composerWindowFor(subject.origin))`.
- `files/multisend.ts:68`: `signal.aborted || starterRefusalIn(subject key) !== null`.
- `previewRunner.previewMayStart` (`:34-40`): `starterRefusalIn(selectedChatKey()) !== null` replaces `get(doingChat) || isComposerWindowOpen()`. Previews are refused in a chat with a native entry (MC-3793).
- `devToolActions.isBusy` (`:10-12`): `starterRefusalIn(selectedChatKey()) !== null`.

**v3 `sendChat` (`v3.svelte.ts:1931-1986`; F2):**

1. Capture `guardChar`/`guardChat` at the call (`:1939-1941`). Cold guard unchanged (`:1942-1944`).
2. `await getPermission('sendChat')`; on no, return false (unchanged).
3. `typeof message !== 'string'`: "Message must be a string" (unchanged).
4. `starterRefusalIn(chatKeyOf(guardChar, guardChat)) !== null`: "A chat is already in progress". This replaces `get(doingChat) || isComposerWindowOpen()`. A null key (nothing selected, or ids missing) is admitted and falls to steps 6-7.
5. Plugin-model check (`:1959-1962`), text unchanged.
6. `!guardChar`: "No character selected". `!guardChat`: "No active chat found". Same texts. They now test the captured objects instead of a re-read of the selection, which is MC-3741's pin.
7. `isColdChat(guardChat)`: the existing cold text. The chat may have gone cold during the prompt, and the existing comment's intent is that a plugin is never told `true` for a send the cold guard would refuse (`:1932-1938`).
8. `const handle = beginWork(guardChar, guardChat)`. With both ids present it never returns null. With an id missing, it returns null only when the object is no longer live (the chat was deleted during the prompt). That branch is Q5; recommended: throw "No active chat found".
9. ```
   const hint = { owner: guardChar, chat: guardChat }
   let run: Promise<boolean>
   try {
     const ctx = resolveOriginWithHint(handle.origin, hint)
     if(!ctx) throw new Error("No active chat found")      // gone: Q5
     if(message){ ctx.chat.message.push({ role:'user', data: message, time: Date.now() }); markCharacterForSave(ctx.owner.chaId) }
     run = processSendChat(-1, { origin: handle.origin, originHint: hint })
   } finally { handle.end() }
   await run
   return true
   ```

Notes on the v3 order:

- Error precedence for today's texts is unchanged: type, busy, plugin model, no character, no chat. Nothing that throws runs between `beginWork` and the `try`, so no path leaks the registration.
- `processSendChat` is `sendChat`. Its synchronous prefix runs through admission, `enterSendChat` and the take before its first `await`, so the v3 registration covers the push until the send's own registration exists. Steps 4-9 contain no `await`, so the step 4 check and the send's own gate see the same state.
- Ambiguous origin (a duplicated id): the push and the reply both resolve to the hinted holder, as composer Send does (`composerActions.svelte.ts:497`, `index.svelte.ts:265`). Today the push went into the selected chat object and the reply's writes skipped under `resolveOrigin`. V7 pins the push.
- `doingChat` and `isComposerWindowOpen` imports in v3 are dropped if unused.

**Stop-all (5b, MC-3790), unchanged from r1:**

- `generationOwnership.svelte.ts` gains `composerWindowTargets()`.
- `chatOrigin.ts` gains `busyTargets()`: the distinct owner chats of `reply`/`preview` registrations.
- `abortChat()` snapshots the union, calls `stopWorkIn(target)` for each, then calls `stopAllReplyWork()`.
- Deleted: `autoRun = null`, the `inflights` and `generations` loops, `GenerationHold`/`holdGeneration`/`generations` and their holds and comments, and the `generations.clear()` in the test reset.
- The O1 comment is rewritten.

**UI (5c), unchanged from r1 except MC-3794:**

- `ShellComposer.svelte` and `DefaultChatScreen.svelte`:
  - `writingElsewhere` goes.
  - `shownNativeReply = shownOrigin ? nativeReplyRunsIn(shownOrigin) : false`.
  - `sendBlocked = sendWaitsForDelete || shownNativeReply`, with the reason `chatShellSendWaitsForNativeReply`. The delete-wait string keeps precedence.
  - The locks read the shown chat (`isComposerLockedIn`).
  - `treeControlsBusy = shownOrigin ? isComposerBusyIn(shownOrigin) || nativeReplyRunsIn(shownOrigin) : false` (MC-3794).
- `BookmarkList.svelte:134` and `Suggestion.svelte:261,273`: as in r1.
- `ChatShell.svelte`:
  - The `doingChat` subscription goes.
  - `getBusy` reads the shown chat (registrations or a native entry).
  - The header `$effect` re-shows the header only when the shown chat's busy goes true -> false with the key unchanged.
- `composerActions` gains `isComposerLockedIn(target)`. The "any" exports stay.

**5d. Card half kept, re-planned before coding; alert half marked for re-design (AM4).**

- Card half (MC-3310, MC-3791), r1's design kept as is and marked "re-planned before coding":
  - `inFlightWork.ts`: `runOutcome` becomes a per-chat map, consumed by `takeRunOutcomes()`, plus `inFlightChatTargetCount()`.
  - `keepAliveService.ts` v2: "N replies writing" with no name or avatar. Closing: one bad chat gives today's notice naming it; several give "N replies failed", or "N replies stopped" when none failed.
  - Consumers of `takeRunOutcome`: `keepAliveService.ts:598,790` (INHERITED FROM ADVISOR, COMPLETE for non-test `src`).
  - Re-planned after stage 7, because stage 7 decides how a unit stopped during a hook is classified, and D6-D10 read that classification.
- Alert half (MC-3742, MC-3792): **marked for re-design before 5d is coded.**
  - r1's second store watcher `replyErrorQueue.ts` with its microtask rule is withdrawn.
  - The re-design adds the reply-error queue as a lane of the existing controller in `src/ts/alertPrompts.ts`. That controller holds the prompt queue, `queueNotice` (`:242-252`) and `alertIdle` (`:69-78`) (INHERITED FROM ADVISOR, not re-read). The lane carries error data, not only a text.
  - Inputs to the re-design: MC-3792 (first line "Character: chat name", always), MC-3742, Gate 1 E10 (request-layer calls excluded and named), and the five reply-error sites (`index.svelte.ts` `throwError` 4, `composerActions` `sendChatMain` 1).
  - Behaviour differences the re-design must put to the maintainer before coding: FQ-1..FQ-3 under Open items.

### Sub-stages, order and PR shape

| Sub-stage | Content | App lines | Test lines | Locale |
|---|---|---|---|---|
| 5a seam 1: engine | `activeUnits.ts` take rule; `sendAdmission.ts` (new); `runningReplies.svelte.ts` readers; `index.svelte.ts` gate, take, nested finally, applies, keyed wake-up | 170-220 | 550-700 | none |
| 5a seam 2: starters | `composerActions` sendMain/enterTree/auto; `command.ts`, `files/multisend.ts`, `previewRunner.ts`, `devToolActions.ts`, `v3.svelte.ts` | 130-170 | 450-600 incl. fake-flag rewrites | none |
| 5b | Stop-all = per-chat Stop | +60 / -70 | 250-350 | none |
| 5c | per-chat UI | 120-160 | 300-400 + about 27 one-line factory edits | 1 new, 1 deleted key |
| stage 7 | (separate plan) | | | |
| 5d | card half, then alert half after re-design | re-planned | re-planned | 3-4 keys |

- **5a is one PR with two serial coders (AM3).** A fresh coder writes seam 1 and runs its rows. A fresh coder then writes seam 2. One Gate 2 (Opus) covers the PR, and the contract diff is reviewable alone at the seam commit. They are not two PRs, because the engine's native refusal without the starter checks would let composer Send push a user message and then have the send refused.
- **Order: 5a, 5b, 5c, stage 7, 5d, all before the MVP update** (orchestrator decision under MC-3736). 5b serializes after 5a (shared `composerActions`; B4/B5 need takes in two chats). 5c needs 5a's leaf and readers. Stage 7's design may start once 5b is merged. DV-596-S5-1 runs after 5c and before stage 7's plan is accepted.
- **Intermediate states** (unshipped branch; dev builds only):
  - After 5a, Send in another chat is still disabled by the UI until 5c. In a chat with a native entry, Send is enabled and a press is refused silently until 5c.
  - After 5a, a recovered apply's early return takes and releases the unit, so `doingChat` pulses true -> false. Until 5c deletes the `doingChat` header subscription, that pulse can re-show a header hidden by reader intent. Applies already pulse it today around their body.
  - After 5b, a trigger run beside a reply in the same chat is cut by the notification Stop (MC-3790 consequence).
  - Until 5d (now after stage 7), two near-simultaneous errors overwrite each other, and the card says "writing a reply" for N.

### Ordered steps

**5a seam 1 (engine coder)**

0. Survey `rg "mock\(.*generationOwnership" src` (18 files per Gate 1 E2). Record which of them reach `sendAdmission` through `sendChat`. A factory that lacks `composerWindowFor` and reaches `starterRefusalIn` gets it added. Seam 1 reaches only `sendRefusalIn`, which does not call `composerWindowFor`; the list is handed to seam 2.
1. `activeUnits.ts`: `take(): boolean` with the equal-key refusal; rewrite the module doc (`:13-14`); rewrite U2's same-key block to the new rule; add U7.
2. `runningReplies.svelte.ts`: the two readers with doc comments (reactive versus not, null target, message presence ignored, waiting keys included).
3. `sendAdmission.ts` with `chatKeyOf`, `selectedChatKey`, `sendRefusalIn`, `starterRefusalIn` (null first in both) and the module doc. `sendTargetOf` delegates.
4. `index.svelte.ts`:
   - `sendAdmissible` per chat;
   - the take block and the reorder;
   - the nested finally;
   - keyed `deferRecoveredApply`/`rerunDeferredApply(origin)`;
   - delete `recoveredApplyBlocked`; the take-first applies with the nested finally and the `held` guard.
   Update the docs: `sendChat` (`:362-383`), the deferral comments (`:514`, `:538`, `:546`), and the apply line "It runs only while no unit is held (`doingChat`)" (`:561`), which now says it runs while no unit holds its chat.
5. Tests: U2, U7, A1-A14, A3b, A7b, A8b, A10b, A12b; the T-class re-keying.
6. Targeted runs:
   - the files of those rows;
   - `activeUnits.test.ts`, `generationOwnershipKeyed.test.ts`, `sendChatOwnedStream.svelte.test.ts`, `sendChatGroupSpeaker.svelte.test.ts`, `sendChatOrigin.svelte.test.ts`, `inFlightWork.sendChat.svelte.test.ts`;
   - `src/ts/nativeReply/tests/reconcile.svelte.test.ts`, `reconcileStream.svelte.test.ts`, `runningReplies.svelte.test.ts`;
   - the 11 `abortChat` files as guards;
   - `pnpm check`.

**5a seam 2 (starters coder)**

7. Fake-flag survey (AM3, advisor M4). Search `rg -n "(doingChat|mockDoingChat|doingChatMock)\w*\.set\(true\)" src --glob "*.test.ts"` (24 files per the advisor, PARTIAL), plus hand-rolled stores (`composerActions.sound.svelte.test.ts:213-233`). For each site, record the starter it drives. Every site that drives a starter refusal is rewritten to `simulateRunningSend(<that chat's key>)` or to a held composer window, as its test intends. Known: `previewRunner.test.ts:424,853` and about 21 sites in `composerActions.svelte.test.ts`. The coder report lists every rewrite with its old and new driver. A rewrite that changes an assertion, not only the driver, is a defect unless one of this plan's rows names it.
8. Starters in `composerActions` (sendMain, enterTree, auto start and tick). Drop unused imports only if nothing else in the file reads them.
9. `command.ts`, `files/multisend.ts`, `previewRunner.ts`, `devToolActions.ts`, and their comments (`command.ts:280-285`).
10. v3 `sendChat` as specified (Q5 branch per the answer; until then, the recommended throw).
11. Tests: A15-A22, A18b, V1-V8, P1-P2, K1-K3.
12. Targeted runs:
    - the files of those rows;
    - the step 0 list, including `composerActions.generateOption.svelte.test.ts`, `files/tests/multisend.progress.test.ts`, `files/tests/multisend.androidCheckpoint.test.ts`, `files/tests/multisend.refusal.test.ts`, `tests/commandMultisendClear.test.ts`;
    - `pluginSendChatColdGuard.svelte.test.ts`, `previewRunner.test.ts`, `composerActions.sound.svelte.test.ts`;
    - every step 7 file;
    - `pnpm check`.

**5b, 5c**: as r1 (5b steps 1-6, 5c steps 1-6), with C5 covering the native row for tree controls (MC-3794).

**5d**: not coded until re-planned. The card half's r1 steps 4-5 and the alert half's re-design go to a designer revision after stage 7.

## Expected files

5a seam 1, app: `src/ts/process/activeUnits.ts`, `src/ts/process/sendAdmission.ts` (new), `src/ts/nativeReply/runningReplies.svelte.ts`, `src/ts/process/index.svelte.ts`.

5a seam 1, tests:
- New: `src/ts/process/tests/sendGatePerChat.svelte.test.ts`.
- Edited:
  - `activeUnits.test.ts` (U2 same-key block, U7);
  - `sendChatOwnership.svelte.test.ts` (G1, R2 same-chat row, Q1 title, default key `:625`);
  - `sendChatOrigin.svelte.test.ts:845`;
  - `inFlightWork.sendChat.svelte.test.ts:660`;
  - `src/ts/process/applyRecoveredReply.svelte.test.ts` (`:224`, G2 `:284`, A8, A8b, A10b);
  - `src/ts/process/applyRecoveredStreamReply.svelte.test.ts` (`:439,538,605`, G2 `:658`, A8b, A10b);
  - any `generationOwnership` mock factory from step 0 that seam 1 reaches.

5a seam 2, app: `src/ts/process/composerActions.svelte.ts`, `src/ts/process/command.ts`, `src/ts/process/files/multisend.ts`, `src/ts/process/previewRunner.ts`, `src/ts/process/devToolActions.ts`, `src/ts/plugins/apiV3/v3.svelte.ts`.

5a seam 2, tests:
- New: `src/ts/process/tests/pluginSendChatPinned.svelte.test.ts`.
- Edited:
  - `composerAutoModeOwnership.svelte.test.ts`;
  - `composerActions.svelte.test.ts`;
  - `previewOwnership.svelte.test.ts`, `previewRunner.test.ts`;
  - `commandMultisendClear.test.ts`;
  - `files/tests/multisend.refusal.test.ts`, `.progress.test.ts`, `.androidCheckpoint.test.ts`;
  - `composerActions.generateOption.svelte.test.ts`;
  - a new or existing `devToolActions` test;
  - every file from the step 7 survey.

5b and 5c: as r1. 5c's factory edits: the 21 ChatShell factories and the 6 DefaultChatScreen/Suggestion factories listed in r1.

5d: re-planned after stage 7.

Records (not this designer's): MC-3790..3794 go into `Agents/mc/596.md` on the stage 5 branch; the stage 7 section of `STAGE_HANDOFF.md` gets couplings C-1..C-3 (O-7).

## Invariants and compatibility

- I1 (MC-3308). At most one unit per chat key, enforced by the registry's own take (AM2). Units in different chats coexist. A preview counts as a send.
- I2. Every taker's exclusion decision is its take's result. `sendChat` also checks before entry, so a refused call registers nothing. Nothing between `sendChat`'s pre-check and its take awaits.
- I3 (F1). Once a take returned true, the release runs in the innermost `finally` of that taker. No earlier `finally` step can skip it: in `sendChat`, today's steps through `releaseUnit`; in the applies, the push mark, `holdRecoveredReply`, the signature wait and `handle.end()`. The wake-up runs in a `finally` of the release. In the applies it runs only when the take returned true. A take that throws after adding is still released. Only the taker releases, by handle identity. No release by key, from a Stop handler or from a reset in production.
- I4. The unit's AbortController signal stays the unit id. The keyed deferral set holds chat keys.
- I5. A `sendChat` refused before entry registers nothing, fills no ids, publishes nothing, begins no in-flight token and resets no progress stage. A `sendChat` refused at its take ends its registration and speaker and does nothing else. That branch is reachable only through a synchronous callback inside `enterSendChat`.
- I6. The gate's reads are untracked: `activeUnits.has` and `nativeReplyRunsInNow`, never `isBusyIn` or `readReplyVersion`.
- I7. At every awaited point of a send and of an apply, `activeUnits.has(K) === isBusyIn(K)`. Synchronous edges where they differ:
  - the registration begins before the take;
  - the unit releases before the registration ends;
  - an apply holds the unit before `registerWork`.
- I8. "Any" readers keep their answers: `doingChat`, `activeUnits.any()`, `isComposerBusy()`, `isComposerLocked()`, `isAutoModeActive()`, `isComposerWindowOpen()`, `isWorkInProgress()`, `flipBlocker.ts:20`, fast-forward `sending`.
- I9. A recovered apply never writes into a chat a unit holds, and is never deferred by a unit in another chat. Every deferral is followed by a reconcile request at its chat's next release. A deferral never requests one by itself.
- I10. A native reply the page no longer holds is never a unit.
- I11. v3 `sendChat` keeps its signature, return value and error texts, and their order for every path where today's texts apply (MC-175). Its registration is ended on every path after `beginWork`.
- I12. No per-chat predicate export is added to `index.svelte.ts`.
- Compatibility: no persisted format, save, `.bin` or `.rtb` change; no migration (MC-350 untouched). The only plugin-visible change is MC-3741's pinning and refusal, plus Q5's branch. Locale keys follow MC-058.

## Acceptance scenarios

- S-A1. Chat A writes; Send in chat B starts a reply in B; both finish; each reply lands in its own chat.
- S-A2. Chat A writes. In A, a second Send, regenerate, Continue, auto start, preview, plugin `sendChat` or `.po` multisend is refused before any message is pushed or draft taken. `/multisend` in A pushes its segments without generating.
- S-A3. A native reply the page no longer holds targets chat X (after a reload, or after the page's send ended while native runs on). Send, previews and tree steps in X are refused, and X shows the new reason and busy tree controls. Y works. When the native reply ends, the next pass places it and X is free.
- S-A4. A recovered reply for chat B is placed while chat A writes. One for chat A waits and is placed after A's reply ends.
- S-A5. A send or an apply that throws in its finally steps leaves its chat free, and a reply waiting for that chat is still placed.
- S-A6. Two chats of one character reply at once.
- S-A7. A prompt preview in B runs beside A's reply. Auto mode in A keeps ticking while B replies. Auto in B cannot start while auto runs in A.
- S-A8. A plugin calls `sendChat` while chat A is shown; the user switches to B during the prompt; the message and reply go to A. If A is writing, the plugin gets the existing error and nothing is pushed. With a plugin model configured, the plugin gets the existing error, and backups are not blocked afterwards.
- S-B1, S-B2, S-C1, S-C2: as r1.
- S-D1, S-D2: re-planned with 5d.

### Device row (AM5)

DV-596-S5-1, Note 9, synthetic data only, run by lane B after 5c merges and before stage 7's plan is accepted. Setup and evidence follow `docs/workflow/live-checks.md` "Device and PC checklist". Two synthetic characters with chats A and B and a streaming endpoint slow enough to overlap two replies.

1. S-A1. Send in A, switch to B, Send in B. Both replies stream through the native path and land in their own chats. The keep-alive card stays up while either writes. Its text is pre-5d, so a single-reply title is expected.
2. S-B1. With both writing, press the notification Stop. Both stop, both chats show Send, there is no chime, and the card closes as stopped.
3. S-A3. Send in A and in B. Reload the WebView while B is still writing natively and A has finished. After the reload:
   - B shows the running note, and its Send is disabled with `chatShellSendWaitsForNativeReply`;
   - Send in A works;
   - when B's native reply ends, the reply is placed in B and B's Send is enabled without a further reload.

Record per step: screenshots, logcat filtered to the app, and the build's commit. A fail stops stage 7's plan acceptance until it is dispositioned. Vitest rows are not native evidence for any of these.

## Required tests

Pre-fix base for every reproducer: S2 = d70df2cb3 unless the row names a sub-stage merge. A reproducer must fail on its assertion, not on setup or a missing export. Where a new export is needed, the row is classed by the assertion that fails once the export is stubbed with today's behaviour. All rows DESIGNED, NOT DEMONSTRATED.

### 5a seam 1

| id | scenario | class | pre-fix base and expected failure | fixture |
|---|---|---|---|---|
| U2 | registry arithmetic, same-key block rewritten: `first.take()` true, `second.take()` false, `first.release()` leaves `any()` false; the other blocks and their emissions recomputed | compatibility guard on a changed API (the file has no pre-fix base) | n/a; on S2 `take` returns void and the second handle is counted | `createActiveUnits()` |
| U7 | a second handle of a held key: `take()` false, `any`/`has` unchanged, no store emission; its `release()` does not clear the first; after the first releases, the second's `take()` is true | guard on a new rule | n/a | same |
| A1 | S-A1: unit held in A by a real send (send and preview rows); `sendChat(-1,{origin:B})` admitted, makes its request, `activeUnits.has(B)` true during; both settle | regression reproducer (replaces G1) | S2: returns false, no request | `sendChatOwnership` harness: `installTwoChats`, `holdUnit`, `controlledStream` |
| A2 | unit held in A; `sendChat` into A refused with no registration, id fill or request; A still held | compatibility guard | n/a | same |
| A3 | a send started from the first send's in-flight notice into the same chat returns false and makes no request; the first call's request is the one made; one unit | regression reproducer | S2: the notice runs before the take, so the second is admitted and two requests are made | `subscribeInFlight` one-shot as R1 (`sendChatOwnership.svelte.test.ts:875-906`, INHERITED) |
| A3b | F3: an outermost send with an origin carrying a `memberChaId` into group chat G; a one-shot `subscribeStreamChanges` listener on `'speaker'` starts `sendChat(-1,{origin:{chaId:G, chatId:g}})`. Expected: one request (the inner call's); the outer call returns false; `activeUnits.has(G)` true while the inner runs and false after; the outer published no tag and began no in-flight token; `isWriting(G)` reflects only the inner registration after the outer returns; the outer's speaker is removed | regression reproducer | S2: both calls take (two handles, `take` never refuses), two requests | group world built like `sendChatGroupSpeaker.svelte.test.ts`, real `activeStreams`, real `sendChat` with a controllable request mock |
| A4 | R1 unchanged (a notice-started send into the other chat is counted) | compatibility guard | n/a | existing R1 |
| A5 | R2 same-chat row: the second send started from the first's signal listener into the same chat is refused; after the first throws, nothing holds the chat; a later send there is admitted | regression reproducer | S2: second admitted, `has(A)` true after the first throws | existing R2 harness (`:908-944`, INHERITED) |
| A6 | I7 at awaited points: send (module-ensure wait with a stub, request pending, output listener pending); `applyRecoveredReply` (processScriptFull, runTrigger, runChatOutputListeners pending); `applyRecoveredStreamReply` (processScriptFull pending) | compatibility guard | n/a | real `sendChat`; the apply files' deferred-promise mocks |
| A7 | S-A5 send: the caller signal's `removeEventListener` throws once; the send rejects; `has(K)` false; the next send into K is admitted | regression reproducer | S2: the throw at `index.svelte.ts:457` skips `active.release()` (`:459`) | real `sendChat`; caller `AbortSignal` with `removeEventListener` spied to throw once |
| A7b | F1 send wake-up: as A7, with an apply into K called while K is held (returns `'deferred'`). After the send rejects, a `setReconcileTrigger` spy was called exactly once | regression reproducer | S2: the same throw skips `rerunDeferredApply()` (`:460`), spy 0 calls | A7 fixture + real `pageState.setReconcileTrigger` |
| A8 | `registerWork` throws once inside `applyRecoveredReply`; afterwards `has(TARGET)` false and the outcome is `'failed'` | regression reproducer | S2: the take at `:585` precedes `registerWork` (`:586`) outside any `try`; the unit stays held | hoisted partial mock of `./chatOrigin` whose `registerWork` wraps the real one and throws once |
| A8b | F1 apply: apply 1 into TARGET holds (processScriptFull pending); apply 2 into TARGET returns `'deferred'`; apply 1 is released, pushes, and the file's `markCharacterForSave` mock throws on the call made in the `finally` (armed after the push's own call). Apply 1 rejects; `has(TARGET)` false; the reconcile spy called exactly once. Both apply files | regression reproducer | S2: the throw at `:644` (stream `:790`) skips `handle.end()` and `active.release()`, so TARGET stays held; the apply's finally has no wake-up, spy 0 calls | the files' existing `markCharacterForSave` mock (`applyRecoveredStreamReply.svelte.test.ts:110,216`; reply file `:106`) + `setReconcileTrigger` spy |
| A9 | S-A4: unit held ELSEWHERE; both applies into TARGET return `'applied'` and write (G2 rows rewritten) | regression reproducer | S2: `'deferred'` | existing harnesses, `simulateRunningSend(ELSEWHERE)` |
| A10 | unit held in TARGET; both applies `'deferred'`, nothing written, `doingChat` true, no registration made | compatibility guard | n/a | same, `simulateRunningSend(TARGET)` |
| A10b | after A10's deferral, the reconcile spy has 0 calls, and `has(TARGET)` is still held by the simulated send. Both files | compatibility guard (S2 returns before any wake-up) | n/a | A10 + `setReconcileTrigger` spy |
| A11 | I9 keyed: TARGET held by a real send; ELSEWHERE held by a second real send started from the first's in-flight notice (R1's one-shot); apply into TARGET deferred; ELSEWHERE's send ends: no reconcile; TARGET's ends: exactly one | regression reproducer (keyed rule) | S2: ELSEWHERE's release requests one (boolean) | E1 fixture: R1 one-shot + `setReconcileTrigger` spy |
| A11b | deferrals for T1 and T2 (both held as in A11); T1's end requests; T2's end requests again | compatibility guard | n/a | same |
| A12 | `addRunningReplies([{key, target:{chaId:A, chatId:a, name}}])`, no held key; `sendChat` into A refused with no registration or request; into B admitted | regression reproducer | S2: A admitted | real `runningReplies` via the reconcile's producer call |
| A12b | AM1/M2 producer path: real `pageState`, key held `inflight`, bound, invoked, end not seen; `settleNativeReplyInflight(key)` drops it and requests a pass. A real `createReconciler` with a fake store lists the key `live` targeting A: afterwards `sendChat` into A is refused. The store then lists nothing and a pass runs: `sendChat` into A is admitted | regression reproducer | S2: the first `sendChat` into A is admitted | real `pageState`, `createReconciler` deps built like `nativeReply/tests/reconcile.svelte.test.ts` |
| A13 | an entry with a `null` target refuses nothing; an entry for another chat of the same character refuses nothing | compatibility guard | n/a | same as A12 |
| A14 | I6: a `sendChat` called inside a `$effect` does not re-run the effect when `addRunningReplies` adds an unrelated key or another chat's registration starts | compatibility guard for these two triggers only. On S2 neither trigger is read by the gate. `enterSendChat`'s `DBState` read is tracked in both versions and is not a trigger here | n/a | `$effect.root`, run counter |

### 5a seam 2

| id | scenario | class | pre-fix base and expected failure | fixture |
|---|---|---|---|---|
| A15 | `simulateRunningSend(CHAT_A)`; composer Send in chat B takes the draft and reaches `sendChat` with origin B | regression reproducer | S2: `sendMain` returns at `get(doingChat)` (`:273`) | `composerActions.svelte.test.ts` harness, index mock `doingChat: activeUnits.active` |
| A16 | `simulateRunningSend(CHAT_A)`; composer Send in A refused before `beginWork`; draft unchanged; no window or lock | compatibility guard | n/a | same |
| A17 | native entry for A; composer Send in A refused before the take; nothing pushed; draft unchanged | regression reproducer | S2: take, push and `sendChat` happen | same + `addRunningReplies` |
| A18 | tree step in B while A writes succeeds; in A refused | reproducer (B row) / guard (A row) | S2: B row refused at `enterTree` `:613` | composer harness, real `chatTree` |
| A18b | MC-3794: a non-generating tree step (step to a sibling) in a chat with a native entry is refused, and the tree is unchanged | regression reproducer | S2: the step is applied | same + `addRunningReplies` |
| A19 | regenerate in a chat with a native entry is refused and the tail stays | regression reproducer | S2: tail cut, `sendChatMain` called | same |
| A20 | F2: run A in RUN_CHAT toggled off with tick 1 gated; run B started in OTHER_CHAT; `stopComposerWorkIn(RUN_CHAT)`; `isAutoModeActive()` true and `composerWindowFor(OTHER_CHAT)` true; release, both end | regression reproducer and F2 killer | S2: run B refused at `:979` | `composerAutoModeOwnership` `gatedTicks` |
| A21 | auto in RUN_CHAT keeps ticking while a unit is held in OTHER_CHAT | regression reproducer | S2: tick check reads `doingChat`, loop breaks | same, index mock `doingChat: activeUnits.active` |
| A22 | a unit taken in RUN_CHAT while the loop yields stops it before another tick | compatibility guard | n/a | same |
| V1 | S-A8: the `alertConfirm` mock switches the selection to B and resolves true; the message lands in A; `processSendChat` gets origin A and the hint | regression reproducer | S2: pushed into B, `processSendChat(-1, {})` | new `pluginSendChatPinned.svelte.test.ts`, built like `pluginSendChatColdGuard.svelte.test.ts` |
| V2 | unit held in B; plugin `sendChat` from A resolves true and pushes | regression reproducer | S2: throws "A chat is already in progress" | same |
| V3 | unit held in A: rejects with the existing text; nothing pushed; `processSendChat` not called; `hasAnyWork()` false | compatibility guard | n/a | same |
| V4 | native entry for A: rejects; nothing pushed | regression reproducer | S2: pushes and calls | same + `addRunningReplies` |
| V5 | F2: plugin model configured (`getModelInfo` id `pluginmodel:::x`): rejects with "Sending chat with plugin-based model is currently blocked"; nothing pushed; `hasAnyWork()` false afterwards; a second call rejects the same way and `hasAnyWork()` stays false | compatibility guard (S2 has no `beginWork` in v3) and the M34 killer | n/a | same, `modellist` mock |
| V6 | F2: nothing selected: rejects with "No character selected" (not a `TypeError`); `hasAnyWork()` false | compatibility guard and the M35 killer | n/a | same, `selectedCharID` out of range |
| V7 | ambiguous origin: two live characters share `chaId`, the selection on the second; the message lands in the selected holder's chat, nothing in the twin; `processSendChat` gets the hint | compatibility guard for the push (S2 pushes into the selected chat too) and the M36 killer | n/a | same, duplicated `chaId` world |
| V8 | Q5 branch: the selected chat has no id and is deleted during the prompt: per Q5's answer (recommended: rejects with "No active chat found", nothing pushed, `hasAnyWork()` false) | regression reproducer if Q5 = (a) | S2: pushes into the chat selected after the prompt and returns true | same |
| P1 | `previewMayStart()` true with the selection on B while A writes | regression reproducer | S2: false | `previewOwnership.svelte.test.ts`, real `activeUnits` |
| P2 | `previewMayStart()` false while the selected chat holds a unit, or has a native entry (MC-3793) | guard (unit row) / reproducer (native row) | S2 native row: true | same |
| K1 | `/multisend` in B generates while A writes; in A it pushes without generating | reproducer (B) / guard (A) | S2 B row: `generates` false | `commandMultisendClear.test.ts`, real `activeUnits` |
| K2 | `.po` multisend into B posts entries while A writes | regression reproducer | S2: stops before the first entry | `multisend.refusal.test.ts` |
| K3 | `runAutopilot` in B runs while A writes | regression reproducer | S2: returns at `isBusy()` | direct `devToolActions` test, real `activeUnits` |

T-class (the default-key `simulateRunningSend()` calls, 16 in 8 files, COMPLETE): unchanged from r1. The flip blocker and GridCatalog stay elsewhere. The apply, in-flight, origin and ownership refusal rows move to the same chat.

Pins: G1 becomes A1 + A2. G2 becomes A9. G3 is not a send-gate test and stays. Q1 keeps its assertion. S1 is rewritten in 5c (C4). U2 is rewritten (above).

### 5b

Unchanged from r1: B1-B7.

### 5c

Unchanged from r1: C1-C8. C5's native row also asserts `treeControlsBusy` true for the shown chat with a native entry (MC-3794).

### 5d

D5-D10 (card) are kept and re-planned before coding. D1-D4 (alert) are superseded by the alert re-design. D11 (localeParity) stays.

## Mutants to kill

Each breaks one new rule; the named test must fail.

5a seam 1:
- M1 `sendAdmissible` back to `!activeUnits.any()`: A1.
- M2 the gate drops the native reader: A12, A12b.
- M3 `sendChat` ignores a refused take (proceeds when `take()` returns false): A3b.
- M3b `applyRecoveredReply` ignores a refused take: A10 (reply file).
- M3c `applyRecoveredStreamReply` ignores a refused take: A10 (stream file).
- M3d registry `take` adds when another handle holds an equal key (today's identity-only check): U7, A3b.
- M3e `sendChat`'s refusal at the take does not end the registration: A3b (`isWriting`).
- M4 take moved back after `beginInFlight`: A3 (the notice-started call returns true).
- M5 `active.release()` back in the same block as today's steps (outside the nested finally): A7.
- M5b `rerunDeferredApply` back after the inner `try/finally`: A7b.
- M6 an apply refuses its take on any held unit (`any()`): A9.
- M8 `rerunDeferredApply` requests on every release: A11.
- M8b an apply's finally wakes although its take was refused: A10b.
- M9 `rerunDeferredApply` clears every key: A11b.
- M10 `deferRecoveredApply` does not record the chat key: A11.
- M11 apply `registerWork` back before the `try`: A8.
- M11b apply release outside the nested finally: A8b (each file).
- M11c apply wake-up skipped when its finally throws: A8b (each file).
- M12 gate uses `nativeReplyRunsIn` (tracked): A14.
- M13 gate uses `isBusyIn`: A14.
- M14 native reader compares `chaId` only: A13.
- M15 native reader matches a `null` target: A13.
- Equivalent, not required: dropping the `release()` from the take block's refusal branch. A refused take adds nothing, and the release matters only for a throwing subscriber, which no row drives.

5a seam 2:
- M16-M33 as r1 (`sendMain`, `enterTree`, auto, v3 pin/refusal, preview, command, `.po`, autopilot), with M16 and M17 on A16 and A15 using `simulateRunningSend`.
- M19b `enterTree` checks only units, not the native reader: A18b.
- M34 v3 `beginWork` before the plugin-model check without ending the handle: V5.
- M35 v3 `beginWork` before the `!guardChar` check: V6.
- M36 v3 push through `writeAt(handle.origin)` without the hint: V7.

5b, 5c: as r1 (M40-M44, M50-M58).

5d: M64-M67 (card) are kept and re-planned. M60-M63 (alert) are superseded.

## Risks and trade-offs

- R1 (critical contract). The reorder moves the take before `setProcessStage`, `publishUnit`, `beginInFlight` and the listener. The production subscribers of these (`netSignalMeter.ts:301`, keep-alive through deps, the header's `doingChat` subscription) do not send (INHERITED FROM ADVISOR, COMPLETE for `subscribeInFlight(` and non-test `doingChat` subscribers). Q2 (`sendChatOwnership.svelte.test.ts:975`) stays refused.
- R1b (AM2). `take()` changes from void to boolean and refuses equal keys. Only U2's same-key block encoded the old counting. No production path took one key twice, because the gate and the apply's blocked check prevented it. The applies now take before their early returns, so a `'failed'` or `'present'` early return pulses `doingChat` (intermediate state until 5c).
- R2 (blast radius). As r1, plus the seam-2 fake-flag rewrites (24+ files, PARTIAL count) and the step 0 factory additions. The coder lists each.
- R3. The keyed deferral set adds state. Gate 1's stateless alternative (request a pass on every release) was weighed and not adopted. The keyed set is correct once F1's nesting is in. That nesting is needed for the release either way. Each extra pass costs one `store.list()` IPC on Android per reply end.
- R4. Withdrawn with the 5d alert half (it was the microtask rule).
- R5. The native-reply refusal starts only after the first pass lists the reply. Between boot and that pass, Send in X is admitted. Accepted, named in the 5a PR.
- R5b (E8). Keys waiting for a unit refuse Send in their chat from that chat's release until the requested pass finishes. An auto run there breaks at its next tick. This needs a recovered reply for a chat that holds a unit. Accepted, named in the 5a PR.
- R6. Withdrawn: Q3/Q4 are answered (MC-3793/3794), as planned.
- R7. Intermediate PR states are dev-build only.
- R8 (AM1, rewritten). Per-chat admission does not make every stall local to its chat. Three couplings remain:
  - C-1 Lua mode mutex. One mutex per mode string is shared by every chat (`scriptings.ts:214`, `:1475-1482`, read). A script in chat A that waits holds it, and chat B waits at its next run in that mode. The mutex protects shared engine state and stays (stage 6 per MC-3734).
  - C-2 Serial pass. The reconcile pass handles listings one by one (`reconcile.ts:511-521`) and replaces the running map only at its end (`:523`). While an apply awaits `runTrigger`/`runChatOutputListeners`, no other chat's entry is removed. The pass is the only thing that clears a `nativeReply` refusal.
  - C-3 `recoverText` replacers. Plugin replacers run inside the pass before any unit or registration exists (`bootstrap.ts:885-893`, read). A stall there shows no Stop, and stop-all reaches nothing.

  5a makes C-2 and C-3 visible as a refused Send with a reason and no Stop. Before, such a chat admitted a Send. MC-3737 rules that a listed chat is refused, so this is the decided behaviour. Stage 5 fixes none of them, because none is small:
  - C-1 needs abortable waits on the mutex (advisor N3, unread) and is stage 6/7 work.
  - The smallest C-2/C-3 relief, replacing stale entries at the start of a pass, would admit a Send ahead of a finished recovered reply. That changes reply order in that chat, a trade-off for stage 7 to weigh, not a small fix.

  All three go to stage 7's dossier as a named list (O-7). Two more notes stand:
  - After 5b, stage 7's hook checks must read the unit's signal (`signal: unit.signal`, `index.svelte.ts:427`), never the caller's.
  - The unconditional release keeps "Stop frees a chat only by making the body return" intact.
- R9 (E6). A throw before an apply's write returns `'failed'`. The one-time "failed elsewhere" note is then misleading for a reply a later pass places. This is the same class as today's `processScriptFull` throw. Named in the 5a PR.
- R10 (E9, advisor N2). A recovered apply can take chat A between the composer Send's push and its `sendChat`. The send is then refused and the user message has no reply. This exists under the global rule. Per-chat deferral makes it reachable while other chats write. One line in the 5a PR. Closing it needs a wake-up on window close.
- Leftover dispositions: F2 by A20. F3 void under MC-3790 (B4). F7 void (`stopRegistrations` isolates, B5). O1 in 5b step 4. The `chatProcessStage` mock keys are removed only in files a sub-stage edits.

## Premises

Re-read for this revision (REOPENED):

- P1. `sendChat` order: admission `:385`, `enterSendChat` `:391`, reset `:397`, unit `:399`, listener/publish/in-flight/take `:416-420`, finally `:432-474`. `removeEventListener` `:457` precedes `releaseUnit` `:458`, `active.release()` `:459` and `rerunDeferredApply()` `:460` in one block.
- P2. `enterSendChat` registers before the take (`:291`, `:305`). `addReplySpeaker` runs for an origin with `memberChaId` (`:312-314`) and notifies listeners synchronously (`activeStreams.ts:133-137`). Listener throws are caught (`:39-45`).
- P5. Applies: blocked check `:567`/`:670`, synchronous resolves, take `:585`/`:693`, `registerWork` `:586`/`:694`, `try` `:591`/`:701`. Finally `:641-649`/`:785-795`: mark/hold (and the signature wait) before `handle.end()` and `active.release()`. The catch returns `pushed ? 'applied' : 'failed'` (`:638-640`, `:782-784`).
- P6. The `recoveredApplyDeferred` boolean (`:515`, `:539-552`).
- P7. The reconcile pass (`reconcile.ts:487-527`): gate checks, `addRunningReplies` of live unheld keys, serial `handle`, waiting keys re-added, `setRunningReplies` at the end. `request` coalesces through `rerun` (`:530-545`). Apply `'failed'` posts a note once (`:280-283`, `:405-407`).
- P8. `runningReplies.svelte.ts` (whole): `addRunningReplies` adds, `setRunningReplies` replaces, `waitingForUnit` set.
- P21. `activeUnits.ts` (whole): the take's identity-only check (`:51-57`), `has` by both ids (`:71-81`), module doc `:13-14`. `activeUnits.test.ts` U2 same-key block (`:40-50`). Helper `activeUnits.test-helpers.ts:10-12`.
- P22. `v3.svelte.ts:1931-1986`: the check order and texts; `processSendChat` = `sendChat` (`:50`).
- P23. `beginWork` (`chatOrigin.ts:965-999`): returns null only when an object with a missing id is not live; marks fresh fills for save; registers on an ambiguous origin. `characterIdFillable` dereferences `character.chaId` (`:859-861`). `writeAt` skips gone and ambiguous origins (`:267-297`). `resolveOriginWithHint` breaks a duplicate in favour of the hinted holder (`:452-482`, `:548-550`).
- P24. `settleNativeReplyInflight` drops a key whose end the page did not see and requests a pass (`pageState.ts:226-242`). `setReconcileTrigger`/`requestReconcile` (`:83-90`).
- P25. Lua mode mutex (`scriptings.ts:214`, `:1475-1482`) and the replacer loop in `recoverText` (`bootstrap.ts:885-893`).
- P26. Composer Send passes `origin` + `originHint` (`composerActions.svelte.ts:497,570,799`). The `sendMain` refusal sites are `:273-278`, and `beginWork` comes at `:300`.
- P27. Both apply test files mock `markCharacterForSave` (`applyRecoveredReply.svelte.test.ts:106`, `applyRecoveredStreamReply.svelte.test.ts:110,216`) and use the real `pageState`. `createReconciler` is used in 3 test files under `nativeReply/tests`. A group-speaker send test exists (`sendChatGroupSpeaker.svelte.test.ts`).

Inherited:

- P3, P4, P9-P20: INHERITED from r1 (REOPENED there at the same HEAD, not re-read now). Gate 1 re-checked P1, P2, P5-P7, P9 and P11. The advisor re-checked P1, P2, P5-P7, P9 and P11.
- P16-P19: INHERITED FROM SIZING, as r1.
- From Gate 1, not re-read: `coldstorage.svelte.ts:863`; `generationOwnership.svelte.ts:47-53`; the request-layer `alertError` lines; the 18 `generationOwnership` mock files and the five named ones.
- From the advisor, not re-read: `alertPrompts.ts` structure; the `takeRunOutcome` consumers; the fake-flag count (PARTIAL); `streamed_fetch.rs` test lines.

## Open items

Product question (blocks only the V8 branch of 5a seam 2; the orchestrator asks it):

- Q5. v3 `sendChat`: the chat selected at the call had no id and was deleted while the permission prompt was open, so `beginWork` refuses it. MC-3741 pins the chat but does not say what happens when it is gone. Today the message goes into whatever chat is selected after the prompt, and the call returns true.
  - (a) Reject with the existing "No active chat found", pushing nothing (recommended; the same text as today's missing-chat case, and the plugin learns nothing was sent).
  - (b) Return false, like a declined prompt.

  A pinned chat with ids that is deleted fails the same way at the `resolveOriginWithHint` check in step 9, so both cases share the answer.

Future maintainer questions for the 5d alert re-design (AM4; asked before 5d is coded, not now):

- FQ-1. A queued reply error waits behind an alert the person can close, instead of replacing it at once (r1's D4 said "replaces, as today").
- FQ-2. A queued reply error covered by another prompt is shown again after the cover closes.
- FQ-3. Code cannot close a queued reply error; only the person can.

Process items:

- O-1. Records: MC-3790..3794 go into `Agents/mc/596.md` on the stage 5 branch (lane-owned, not this designer's).
- O-2. PR 648 merges before 5a's PR opens, or 5a rebases.
- O-3. Routing: 5a and 5b are on the critical contract, so Opus Gate 2. 5c is at the orchestrator's call. 5d is off the contract.
- O-4. Translator for 5c (1 new, 1 removed key) and 5d (after re-plan), in the same PR (MC-058).
- O-5. English text proposed: `chatShellSendWaitsForNativeReply`: 'A reply is still being written in this chat. Send when it finishes.' This is neutral for both producers (reload and page-dropped key). The 5d keys are re-planned.
- O-6. Advisor N1 is open: can a live owned native reply end without an event the page treats as an orphan event? The refusal's exits are an orphan event (`globalApi.svelte.ts:2632-2636`, INHERITED), a visibility change (`bootstrap.ts:939-944`, INHERITED) and a deferred-apply rerun. Recommended: a bounded `investigator` read of the pre-body-loop failure exits in `streamed_fetch.rs` before 5c is coded. If some end emits nothing, the 5c plan adds a bounded re-list while a shown chat is blocked by a native reply. DV-596-S5-1 step 3 is the device observation.
- O-7. Stage 7's handoff section needs couplings C-1..C-3 (R8) and advisor N3 (does the mutex let a waiter leave on abort) as a named list. Lane-owned.
- O-8. Device row DV-596-S5-1 is lane B's, after 5c merges.

Artifacts: this file only. No scratch, no repository writes.
