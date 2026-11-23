STATUS: PLAN READY, OPEN PRODUCT QUESTIONS

# #596 stage 5d plan, revision 2: queued reply-error alerts and the count card (final stage)

## Summary

- Revision of `s5d-plan.md` (r1) after Gate 1 r1 [REJECT] (`s5d-gate1-r1.md`). Base re-pinned at ca8f2db2e (main with all of stage 7). Every r1 citation was re-checked: of the files this plan cites, only `bootstrap.ts` and `nativeReply/reconcile.ts` changed since c736d40a7, and the cited `bootstrap.ts` lines (:320, :627, :855-860, :878) still hold. Nothing was executed except read-only `git`, `Grep` and file reads.
- MC-3959 settles FQ-1..3, OQ-1..3 and O-5 (5d-3 and site 6 stay in scope). Those rows are no longer blocked.
- F1: the raw `alertError` in `google.ts` Vertex auth paths is removed, so the reply path shows one labelled dialog. The source shows a side effect the verdict did not name: callers that never raise a dialog on a failed request (triggers, Lua, MCP aiaccess, and others) lose the only Vertex-auth dialog they had. That matches the ~68 other `fail` returns in the request layer, none of which alert. It is listed as OQ-4 with removal recommended. Only the `google.ts` edit waits on it.
- F2: exactly one failed reply closes as that chat's named Failed card, however many stopped. Several stopped and none failed gives "N replies stopped". Two or more failed gives "N replies failed", counting only the failed ones. K3b, K13b and M24b are added.
- F3: an entered Stop marks every held native token only when native will cancel (`nativeCancelWanted()`, a Generating card). On a Speaking card the mark stays as on base: tokens of that card's chat only. N4 and M42 are added.
- F4-F7 are applied, except stopping the count tick under the count card (left unchanged, reason given) and an optional preview row, which is now required (E19).
- Size and packaging are unchanged: one PR, three serial coder steps and one Sonnet Gate 2. 5d-1 gains `google.ts` and a comment-only change in `previewRunner.ts`.

## Changes from r1

1. Base re-pinned to ca8f2db2e (Premises). The r1 status OQ-1..3 is resolved by MC-3959 and replaced by OQ-4 (F1 side effect).
2. Part 1: `google.ts:516,536` raw `alertError` removed (F1). New rows V1 and V1b, mutant M18, OQ-4.
3. Part 1: site 6 computes the label at raise time inside `ensureModulesOrAlert`, which takes `{ asReply: true }` instead of a precomputed label (F7). E17 and E17b are reworded, and E17c and M11c are added.
4. Part 1: the "Character" in the label is the group's name in a group chat (F7).
5. Part 1: preview interaction stated. New required row E19 and a comment-only update of the `runPreview` doc comment (F6).
6. Part 1: D-4 (no dedupe) gets row E20 and mutant M17 (F7).
7. Part 1: the second `noticeShowing()` consumer (`lastCharacterRestore.ts:107`) is listed beside D-2 as D-2b (F7).
8. Part 2: the `takeRunOutcome` rule is defined for one failed among several bad (F2). K3 is unblocked, and K3b, K13b and M24b are added.
9. Part 2: mutant M31 (OQ-2 count line) against K9 (F7). The count tick is left as is (F7, reason under Part 2).
10. Part 3: the mark-all is gated on `nativeCancelWanted()`, and a Speaking card keeps the target-only mark (F3). New row N4 and mutant M42. I9 is reworded. `NoticeTokens.stopPressed(target)` stays, so the JVM test at `NativeReplyNoticePolicyTest.kt:418` and `stopMark` at `:449` are unchanged (F7).
11. Scope: the out-of-scope list and L1 now enumerate every other direct `alertError` during a reply (F4) and the other module-check callers (F5). New L12 (hanurai), and L2 now names `devToolActions.ts:123` (F7).
12. K17 is R (the harness exists), and L11 is removed (Gate 1 premise K17).
13. P17 path corrected to `src/lib/ChatShell/sidebar/ShellChatRow.svelte` (F7).
14. PR body carries the stage-7 known limitations K1..K12 and the 7b Gate 2 r1 E1 limitation, as the closing stage of #596 (F7, O-12).

## Response to Gate 1 r1

| Finding | Disposition | Where |
|---|---|---|
| F1 Vertex auth: two dialogs | ADDRESSED, remedy (a), with a side effect raised as OQ-4. Blanket removal also drops the only dialog for callers that do not raise their own on a `fail` (triggers.ts:1666,2134; scriptings.ts:830,879,1213; mcp/aiaccess.ts:79; and others, PARTIAL). That matches every other provider `fail` (request layer: 70 `type: 'fail'` returns, only these 2 paired with an alert). Recommended: accept. | Part 1 "Request layer"; V1, V1b; M18; OQ-4 |
| F2 close after one failed plus stopped | ADDRESSED with the orchestrator's ruling (from MC-3959 OQ-1 (a) and MC-3791) | Part 2 rule table; I8; K3b, K13b; M24b |
| F3 mark-all on a Speaking card | ADDRESSED: mark-all only when `nativeCancelWanted()`; a Speaking card keeps base's target-only mark | Part 3; I9; N4; M42 |
| F4 other direct `alertError` during a reply | ADDRESSED (named). hanurai is named as L12, not labelled: labelling it needs hanurai to return its error instead of alerting, which widens 5d-1 into the memory module | Out of scope; L1, L12 |
| F5 composer and other module-check callers | ADDRESSED: classified as refusals or trigger runs | Out of scope |
| F6 preview sends take the lane | ADDRESSED: stated; E19 (required, R); `runPreview` doc comment updated | Part 1 "Preview"; E19 |
| F7a site 6 label time | ADDRESSED by the thunk route: `ensureModulesOrAlert` computes the label in its catch | Part 1 site 6; I4; E17c; M11c |
| F7b `lastCharacterRestore.ts:107` | ADDRESSED: D-2b | Part 1 D-2b |
| F7c D-4 test and mutant | ADDRESSED | E20, M17 |
| F7d OQ-2 mutant | ADDRESSED | M31 |
| F7e count tick under the count card | NOT ADOPTED (optional in the verdict). `onCountTick` calls `sync()`, which sends nothing when the payload is unchanged (`pushLive`, `keepAliveService.ts:563`). Gating the timer on the count card adds a branch to a one-chat path that K10 pins byte-identical. | Part 2 |
| F7f L2 names `devToolActions.ts:123` | ADDRESSED | L2 |
| F7g P17 path | ADDRESSED | P17 |
| F7h group chat owner | ADDRESSED: REOPENED `replyNotice.ts:120-121` ("The character or group the chat belongs to") | Part 1 label |
| F7i PR body carries K1..K12 and 7b E1 | ADDRESSED | O-12 |
| F7j JVM test `:418` | ADDRESSED: `stopPressed(target)` is kept, so `:418` is unchanged. Only d6 (`:349-369`) is rewritten. | Part 3; N2 |
| O-8 local gradle run with `--rerun-tasks` | ADDRESSED | R5, O-8 |

## Requirements and scope

In scope:

1. Reply-error alerts queue per chat as a lane of the existing controller in `src/ts/alertPrompts.ts` (advisor AM4). MC-3742 says errors queue, the second shows after the first is dismissed, each names its chat, and the inline-error setting is unaffected. MC-3792 says the first line is "Character: chat name", using the chat list's label for an unnamed chat, always, even for one failure. MC-3959 has these parts:
   - FQ-1: a queued reply error waits behind an alert the person can close; it does not replace it.
   - FQ-2: it is shown again after a cover closes.
   - FQ-3: only the person's close dismisses it; code cannot.
   - OQ-3 (a): an unnameable chat's error shows the message without the label line.
2. The keep-alive card under MC-3791 and MC-3310:
   - while two or more chats write, it reads "N replies writing" with no name and no count line (MC-3959 OQ-2 (a)), and a tap opens the app as it is
   - at close: exactly one failed reply gives that chat's named Failed card, whatever stopped
   - otherwise two or more failed give "N replies failed", counting only failed replies (MC-3959 OQ-1 (a))
   - otherwise two or more stopped give "N replies stopped"
   - one bad chat alone keeps today's named notice
   - every chat keeps its own outcome; one failure followed by other work (speech) closes as Failed
3. DV-596-S5-1 carry-overs: (a) the card named one chat while two ran (item 2 fixes it); (b) the "double toast" is diagnosed in Part 4.
4. Derived and confirmed in scope by MC-3959 O-5:
   - 5d-3: the native Stop mark covers every chat native cancels
   - site 6: the module-load failure in `sendChat` is a labelled reply error
5. Derived from Gate 1 F1: the Vertex auth failure raises one dialog, not two (OQ-4 for the side effect).

Out of scope, named in the PR (all stay unqueued and unlabelled, replacing the store as today):

- Request-layer alerts that return `success` afterwards (one dialog, no `throwError` follows): `google.ts:1021,1279`, `openAI/requests.ts:896,1201`, `openAI/responses.ts:597`.
- Other direct `alertError` calls that can fire during or right after a reply (F4, Gate 1 enumeration at c736d40a7, files unchanged since):
  - `memory/hanuraiMemory.ts:67`, the reply's "too much token" failure. `sendChatBody` returns false at `index.svelte.ts:2263-2265` with no `throwError`, so the unit is not noted as failed either (existing quirk). See L12.
  - `translator/translator.ts:134,187,697,701`: reply translation errors.
  - `tts.ts` (9 sites): speech after a reply.
  - `stableDiff.ts` (internal sites, e.g. `:76,80`): image generation.
  - User-content alerts: the trigger alert effect (`triggers.ts:1623`) and Lua `alertError` (`scriptings.ts:301`).
  - `mcp/stdioApproval.ts:130`: the unreadable-approvals notice during a tool call.
- Send refusals before any reply unit exists:
  - `index.svelte.ts:286,301` (`coldStorageChatStillLoading` in `enterSendChat`)
  - `composerActions.svelte.ts:242,582`
  - `composerActions.svelte.ts:362`, `sendMain`'s own module check (F5). It runs after the take and before the reply unit, and the draft is put back, so it refuses the person's send.
- Module checks that are not replies (F5): `characters.ts:432` and `messageActions.svelte.ts:182,257` (trigger runs). They call `ensureModulesOrAlert` without `asReply`.
- The reconcile notes (`failedElsewhere`, `stoppedElsewhere`, `interrupted`, `unreadable`, built at `bootstrap.ts:855-860` and queued through `notice: queueNotice` at `:878`). They already queue and name the character in their text.
- Native card rendering (`KeepAliveNotice.kt` `noticePlan`): no change is needed (P11).

## Approach and stages

### Part 1: the reply-error lane (5d-1)

Mechanism, `src/ts/alertPrompts.ts` (unchanged from r1, accepted by Gate 1):

- `notices: string[]` (`:52`) becomes `notices: alertData[]`. `noticeText: string | null` (`:56`) becomes `noticeEntry: alertData | null`, the template of the current entry. `noticeCurrent` stays the object last written. `showNotice(entry)` (`:81`) writes a fresh copy (`{ ...entry }`) each time, so every show restarts the answer pause as today.
- `queueNotice(msg)` (`:242`) keeps its signature and enqueues `{ type: 'normal', msg }`. Every existing notice test passes unchanged.
- New `queueErrorNotice(data: alertData & { type: 'error' })` applies `queueNotice`'s admission rule to a full `alertData`. It shows at once only when:
  - no entry is current or queued,
  - no prompt is current or queued, and
  - the store shows `none` or a closeless cover (`progress`, or `wait` without `onCancel`).
  Otherwise it is pushed. Both entry kinds share one FIFO.
- `onValue` (`:121`), `publishIdle` (`:69-78`), `noticesSettled` (`:255`), `noticeShowing` (`:265`) and `settleDrainWaiters` read `noticeEntry` and `notices` where they read `noticeText` and `notices` today. The existing "the person's close ends the current entry; a cover's close shows it again" logic (`:139-151`) then applies to error entries unchanged.
- The module doc comment names the lane: an entry is a `normal` notice or a reply `error`. Both close with OK, Escape or Back, and code never closes either.

How each FQ answer maps to existing mechanism (REOPENED, `alertPrompts.ts`, unchanged at ca8f2db2e):

| Answer | Existing mechanism reused | Source |
|---|---|---|
| FQ-1 waits behind an alert the person can close | `queueNotice`'s admission rule: shown at once only over `none` or a closeless cover, otherwise queued. Prompts current or queued go first. | `:242-252`, `:98-101`, `:146-151` |
| FQ-2 shown again after a cover closes | `noticeText` (now `noticeEntry`) survives a cover. On the cover's `none` (`before !== noticeCurrent`) the same entry is re-shown as a fresh object. | `:139-151`, `:80-85` |
| FQ-3 only the person's close | the `alertStore` wrapper and `alertClear()` refuse `none` while `noticeShowing()` | `alert.ts:93-101`, `:393-401`; `alertPrompts.ts:265-267` |

Where the lane differs from boot notices:

- D-1. An entry carries a full `alertData` of type `error` (`submsg`, `stackTrace`, `link`), not a text. The link button (`AlertComp.svelte:580-588`) writes the raw store's `none` and then calls `open`. That is the person's close, so it ends the entry and shows the next one.
- D-2. `noticesSettled()` (boot's wait before the stale-account consent, `bootstrap.ts:320`, its only non-test caller) also waits for queued reply errors. No send can run before that point in boot, so nothing observable changes (Gate 1 accepted, O-4).
- D-2b (F7). `noticeShowing()` has a second consumer, `lastCharacterRestore.ts:107` (`bootNoticeShowing`, read at `:143`). It is now also true while a reply error is shown, so a last-character restore waits behind it. This is boot-time only, and a reply cannot be running then, so nothing observable changes.
- D-3. The two lanes share one FIFO: a reply error queued after a reconcile note shows after it.
- D-4. No de-duplication. Two errors with the same text from two chats differ by their label line, and the same chat failing twice gives two entries, so no error is lost (E20, M17).

`src/ts/alert.ts`:

- Split `alertError` into a private builder `errorAlertData(msg, opts): alertData | null`. It keeps:
  - the `console.error`
  - the `Error` to `msg`/`stackTrace` step and `trim`
  - the `'{}'` ignore
  - the network `submsg`
- `alertError` builds the data, then either:
  - writes the raw store as today, or
  - when `opts.reply` is present, puts the label line first (`label + '\n' + msg` when `label` is non-null, `msg` alone when it is null, per MC-3959 OQ-3 (a)) and calls `queueErrorNotice`.
- The opts type gains `reply?: { chat: string | null }`. Callers without it behave as today.
- Why an option rather than a new export: tests that mock `../alert` with only `alertError` keep working. Only assertions on the exact second argument change (R2).

New leaf `src/ts/process/replyErrorLabel.ts`:

- `replyChatLabel(origin: Origin, hint?: { owner?: { name?: string }, chat?: { name?: string } }): string | null`.
- It reads names through `readAt(origin, ...)` (`chatOrigin.ts`), as `replyNotice.ts:128-138` `namesOf` does.
- The owner is `ctx.owner.name || language.settingsPage.unnamed`. `ctx.owner` is the character, or the group in a group chat (`replyNotice.ts:120-121`), so in a group chat the label's "Character" is the group's name (F7).
- The chat is `chat.name || language.settingsPage.unnamed`, the chat list's own label (`src/lib/ChatShell/sidebar/ShellChatRow.svelte:52,207`).
- When the origin no longer reads (the chat was deleted or moved during the send), it falls back to the hint objects the send holds, which are the chat it was addressed to. With neither, it returns null (MC-3959 OQ-3 (a)).
- It formats with the new key `replyErrorChatLabel` (`'{name}: {chat}'`, so locales set the punctuation). It never throws: a throw is logged and gives null.
- It is a leaf, so the many `replyNotice` mocks do not catch it.

Call sites (REOPENED at ca8f2db2e; `index.svelte.ts` is unchanged since c736d40a7):

| # | Site | Change |
|---|---|---|
| 1 | `index.svelte.ts:1079` `throwError`, link path | `alertError(error, { link, reply })` |
| 2 | `:1084` inline errors off | `alertError(error, { reply })` |
| 3 | `:1092` inline on, chat not resolvable | `alertError(error, { reply })` |
| 4 | `:1136` inline-path catch | `alertError(error, { reply })` |
| 5 | `composerActions.svelte.ts:836` `sendChatMain` catch | `alertError(error, { reply: { chat: replyChatLabel(target.origin, target.originHint) } })` |
| 6 | `index.svelte.ts:454` `sendChat` module check | `ensureModulesOrAlert(entry.context.origin, unit.signal, entry.context.hint, { asReply: true })` |

- In `throwError` (`:1074`), `reply` is computed inside the function body at each call, from `sendChatBody`'s own `origin` and `hint` (`:899`), never from the selection. `throwError` runs where the failure is raised, so the label is read at raise time. `noteUnitFailure` and `noteUnitAlerted` stay as they are.
- A queued dialog still counts as raised for the chip suppression in `replyMarks.ts:133`. The comment there is updated to say so.
- Site 6 (F7, the thunk route):
  - `ensureModulesOrAlert` (`moduleEnsure.ts:72`) gains an optional 4th parameter `opts?: { asReply?: boolean }`.
  - In its catch (`:77-79`), after the module await failed, it calls `alertError(text, { reply: { chat: replyChatLabel(origin, hint) } })` when `opts?.asReply`. Otherwise it calls `alertError(text)` with exactly one argument, as today, so existing `toHaveBeenCalledWith(text)` assertions keep passing.
  - The label is therefore read at raise time from the same `origin` and `hint` the function already takes.
  - Its other four callers (`characters.ts:432`, `composerActions.svelte.ts:362`, `messageActions.svelte.ts:182,257`) are unchanged.
- The inline-error branch of `throwError` (`:1088-1131`) is unchanged (MC-3742).

Request layer (F1), `src/ts/process/request/google.ts`:

- Remove the `alertError(language.errors.vertexAuthIncomplete)` lines at `:516` and `:536`. The `return { type: 'fail', result: language.errors.vertexAuthIncomplete }` after each stays.
- Why: `requestGoogleCloudVertex` is reached from every `requestChatData` caller (`request.ts:663,742`; `targ` is the caller's `arg`). Its callers then differ:
  - Reply path: the main send (`index.svelte.ts:3034-3035`), the emotion request (`:3798-3802`) and the memory summaries (`:2279`, `:2310`, `:2332` via `supaMemory.ts:321`, `hypav2.ts:165`, `hypav3.ts:1793`) report the `fail` through `throwError`. With the lane, the raw alert would be up when the lane entry arrives, and the person would close two dialogs for one failure.
  - Callers that alert on `fail` themselves (`translator.ts:697`, `stableDiff.ts:76`, `PlaygroundImageTrans.svelte:189`, `IrisModal.svelte:261`): today two raw writes, the second replacing the first. After the change, one write. The person sees one dialog either way.
  - Callers that raise no dialog on `fail` (`triggers.ts:1666,2134` set a variable; `scriptings.ts:830,879,1213` return `'Error: …'` to Lua; `mcp/aiaccess.ts:79` returns the text to the tool loop; `subtitleRequest.ts`, `suggestionRequest.ts` and `index.svelte.ts:3621` not opened, PARTIAL): they lose the Vertex-auth dialog. That is OQ-4.
- Consistency: the request layer has 70 `type: 'fail'` returns (git grep count across `anthropic.ts` 11, `google.ts` 11, `openAI/requests.ts` 10, `openAI/responses.ts` 7, `request.ts` 29, `toolLoop.ts` 2). Only these two are paired with an alert. Every other provider failure, including other missing-credential failures, is reported by the caller alone.
- Inline errors on (MC-3742): the reply path now shows the Vertex auth error inline only, like every other request failure. On base the raw dialog showed as well as the inline error. State this in the PR.
- OQ-4 blocks only this edit and V1/V1b/M18. If the maintainer picks (b), the remedy becomes an optional request field set by the three `throwError` reporters, and `google.ts` alerts only without it. The plan would then need a revision for that field.

Preview sends (F6):

- `runPreview` (`previewRunner.ts:104-156`) holds `alertWait(…, onCancel)` (`:121`), which the person can close. A preview `throwError` therefore queues behind it instead of replacing it.
- When `sendChat` returns false, `closeIfOurs()` (`:115-119`, `:138-140`) still sees its wait in the store. It calls `alertClear()`, which `noticeShowing()` does not refuse because the entry is queued, not shown. The wait closes and the error shows.
- The end state matches base (one error dialog), a moment later and with a label (E19).
- The `runPreview` doc comment line "An alert that replaced the notice (the failure's error, say) stays." becomes stale. It is reworded in the same step: a reply error waits behind the notice and shows once the runner closes it. Comment only.

### Part 2: the count card (5d-2)

`src/ts/process/inFlightWork.ts` (unchanged at ca8f2db2e: `runOutcome` `:49`, reset `:78`, set `:90`, `takeRunOutcome` `:143-146`, `resetInFlightForTest` `:167-175`):

- Replace the single `runOutcome` with `outcomes: Map<string, { outcome: 'stopped' | 'failed', target: InFlightTarget | null }>`. The key is `chaId + '\u0000' + chatId`. A chat token without a target uses a per-token unique key.
- A `chat` begin deletes its own chat's entry: a new reply in that chat replaces its earlier outcome.
- A `chat` end with `stopped`/`failed` sets its chat's entry. Any other end deletes only its own chat's entry.
- A begin of any non-`save` kind clears the map only when no entry is live (a new run). This keeps the map bounded where no consumer takes it (web, desktop). On Android the consumer's all-ended take has already emptied it by then.
- `save` never clears (the comment at `:46-48` is kept and reworded).
- `takeRunOutcome()` keeps its name and both consumers (`keepAliveService.ts:598` call, `:790` wiring; grep COMPLETE for non-test `src`). It returns `RunOutcome | null`, where `RunOutcome` gains `count: number`. Reading clears the map.
- The rule (F2, the orchestrator's ruling from MC-3959 OQ-1 (a) and MC-3791's "one bad chat keeps today's notice naming it"). Here `F` is the number of failed entries and `S` the number of stopped entries:

| F | S | Result | Closing card |
|---|---|---|---|
| 0 | 0 | `null` | today's Finishing |
| 0 | 1 | `{ stopped, target: <that chat>, count: 1 }` | today's named Stopped |
| 0 | ≥2 | `{ stopped, target: null, count: S }` | "S replies stopped" |
| 1 | any | `{ failed, target: <the failed chat>, count: 1 }` | that chat's named Failed card, with the failed hint |
| ≥2 | any | `{ failed, target: null, count: F }` | "F replies failed", with the failed hint |

  A failed entry whose token had no target gives `target: null, count: 1`, which is today's unnamed Failed card for a target-less token (unchanged).
- New `inFlightChatCount(): number`: the number of distinct targets among live `chat` tokens, where a token without a target counts once.
- `resetInFlightForTest` clears the map.

`src/ts/android/keepAliveService.ts` (unchanged at ca8f2db2e):

- `KeepAliveStateLabels` gains required `repliesWriting`, `repliesFailed` and `repliesStopped`, each with `{count}`. `KeepAliveV2Deps` gains optional `chatCount?: () => number`. Without it the count is 1, which is what the existing test harness gets.
- `livePayload` (`:463-500`): when the state is `generating` and `chatCount() >= 2`:
  - `title = publicTitle = fillLang(repliesWriting, { count })`
  - `identity`, `avatar` and `target` are null, so a tap opens the app as it is (P11)
  - `text = ''` (MC-3959 OQ-2 (a))
  - `startedAt` is still `since('chat')`, the earliest start
  - `record` is null, so no avatar is warmed or sent
- `liveSpeakerKey` returns null for the count card.
- `onStreamChange` (`:658-674`) pushes no count note for the count card, since there is no count line.
- `closingPayload` (`:509-539`): when `outcome.count >= 2`:
  - `state = outcome.outcome`
  - `title = publicTitle = fillLang(repliesFailed | repliesStopped, { count })`
  - `text = failedHint` for failed, else `''`
  - identity, target and avatar are null
  - `count === 1` is unchanged (today's named notice). Under the F2 rule, `count === 1` always carries the bad chat's target when that token had one.
- `startKeepAliveService` (`:749`, deps `:768-816`) wires `chatCount: inFlightChatCount` and the three labels from the new keys.
- The count tick (F7e) stays as it is. `pushLive` starts `countTimer` for any `generating` payload (`:569-570`). Under the count card, `onCountTick` calls `sync()`, and `pushLive` sends nothing because `comparable === shownJson` and `resend` is false (`:563`). That costs one payload build a second and sends nothing.
- Native needs nothing (P11): `noticePlan` shows `notice.title` when the identity is null, and `publicVersion` uses `publicTitle`. A STOPPED/FAILED notice arriving during Stopping is shown as sent (`KeepAliveNotice.kt:426-454`). A null target taps to the launch intent (`KeepAliveService.kt:468-469`).

### Part 3: the native Stop mark (5d-3)

Current code (REOPENED at ca8f2db2e, `NativeReplyNoticePolicy.kt`):

- `onStopTap` (`:179-180`) calls `display.stopTapped()`.
- On `ENTERED` it calls `tokens.stopPressed(stopMark(...).target)`, which marks tokens whose `closing.target` equals the tapped card's target (`:142-146`, `:174-175`).
- Production caller: `KeepAliveService.kt:149` `enterStopTap`, followed by `deliverStopTap` (`KeepAliveService.kt:217`, `KeepAliveNotice.kt:164-174`).

Change:

- `NoticeTokens` gains `stopPressedAll()`, which marks every held token.
- `onStopTap` becomes: on `ENTERED`, when `display.nativeCancelWanted()` is true, `tokens.stopPressedAll()`; otherwise `tokens.stopPressed(mark.target)` as today. `STALE` and `PLAIN` mark nothing, as today.
- `stopPressed(target)`, `StopMark` and `stopMark` are unchanged. So `NativeReplyNoticePolicyTest.kt:418` (direct `tokens.stopPressed(a)`) and `:447-449` (`StopMark(a)` equality) keep passing (F7j).

Why `nativeCancelWanted()` (F3):

- It is the predicate `deliverStopTap` uses to decide whether native cancels (`KeepAliveNotice.kt:172`): `stopping && !cancelConfirmed && shown?.state == GENERATING` (`:376`).
- `onStopTap` reads it right after `stopTapped()`, which set `stopping = true` and `cancelConfirmed = false` and left `shown` unchanged (`:365-372`). It therefore has the same value `deliverStopTap` sees in the same main-thread turn.
- Under a Generating card, native cancels every live `chat_stop` request whatever its target. REOPENED: `streamed_fetch.rs:203-223` `cancel_chat` filters on `entry.tags.chat_stop` alone. So every held token's reply was stopped, and marking all of them is correct (MC-3309, D17).
- Under a Speaking card, native cancels nothing (`KeepAliveNotice.kt:162-163,172`). Held tokens live in the process-level `NativeReplyNotices.tokens` (`NativeReplyNotices.kt:18,26`) and outlive a page reload. A native reply of another chat may therefore finish as done although nothing stopped it, and marking it would wrongly skip its "Replied" notice (the verdict's scenario).
- A Speaking card keeps base behaviour, target-only. That is the smallest change and settles no new D17 question: base already skips "Replied" for the speech card's own chat.

Why mark all at all: with the count card (target null), the target-only rule marks no chat's token, so after a notification Stop a native reply that still finishes as done would post "Replied" for every stopped chat. Today's named card already leaves the unnamed chat unmarked when two chats write, so this is an existing gap that the count card widens.

Existing JVM test d6 (`NativeReplyNoticePolicyTest.kt:349-369`, "aStopMarksOnlyTheTokensOfItsChat") encodes the old rule for a Generating card and is rewritten (N2). The JVM tests are not in PR CI (P14). The session runs them locally (O-8).

### Part 4: the "double toast" diagnosis (no code change)

Unchanged from r1, accepted by Gate 1 (P13).

Observations:

- DV S-B1: the page text listed "Alpha Test's reply was stopped" twice and "Alpha Test replied Chat 1".
- The screenshot `dv596-run1/b1-after-beta.png` shows exactly one toast: "Alpha Test's reply was stopped / Chat 1".
- Only `announceReply` posts "replied" (`replyNotice.ts:235-250`; grep COMPLETE for `replyFinishedElsewhere` in non-test `src`).
- One outermost `sendChat` calls `announceReply` once (`index.svelte.ts:517`).
- `ToastHost.svelte:310-311` renders two sr-only live regions. Each keeps its last text. `announceShown` writes `text + ' ' + sub` (`toastHost.svelte.ts:392-395`).
- S-A1, earlier, posted the info toast "Alpha Test replied" / "Chat 1".

Interpretation (inferred, not executed): "Alpha Test replied Chat 1" is S-A1's text still in the polite region, and the second "was stopped" is the assertive region's copy. No double toast was posted.

Guards: existing T19c (`replyNotice.svelte.test.ts:911-927`), new T2 (guard) and T3 (diagnostic). Device observation in O-10.

### Stages

| Step | Content | App lines | Test lines | Keys |
|---|---|---|---|---|
| 5d-1 | alert lane, `alert.ts` option, `replyErrorLabel.ts`, six call sites, `moduleEnsure` option, `google.ts` (2 lines removed, if OQ-4 (a)), `previewRunner.ts` and `replyMarks.ts` comments | 90-120 | 330-440 | `replyErrorChatLabel` |
| 5d-2 | `inFlightWork` map and count, keep-alive count card and closing | 80-110 | 260-370 | `keepAliveRepliesWriting`, `keepAliveRepliesFailed`, `keepAliveRepliesStopped` |
| 5d-3 | Kotlin Stop mark | 5-10 | 30-50 (JVM) | none |
| translator | 4 keys in the 7 non-English locales (MC-058) | | | |

- Serial coders, one per step. All three start from ca8f2db2e (7c is merged). 5d-2 and 5d-3 share no file with 5d-1 except `en.ts`.
- If OQ-4 is still open when 5d-1 starts, the coder leaves `google.ts` and V1/V1b/M18 for a follow-up commit in the same PR before Gate 2.
- One combined Gate 2, then the PR (`Closes #596`, final stage).

## Expected files

App:

- `src/ts/alertPrompts.ts`
- `src/ts/alert.ts`
- `src/ts/process/replyErrorLabel.ts` (new)
- `src/ts/process/index.svelte.ts` (`throwError`, `sendChat` module check)
- `src/ts/process/composerActions.svelte.ts` (`sendChatMain` catch)
- `src/ts/process/moduleEnsure.ts`
- `src/ts/process/request/google.ts` (two lines removed; OQ-4)
- `src/ts/process/previewRunner.ts` (doc comment only)
- `src/ts/process/replyMarks.ts` (comment only)
- `src/ts/process/inFlightWork.ts`
- `src/ts/android/keepAliveService.ts`
- `src-tauri/gen/android/app/src/main/java/io/github/yor42/risutanium/NativeReplyNoticePolicy.kt`
- `src/lang/en.ts`, `ko.ts`, `ja.ts`, `cn.ts`, `zh-Hant.ts`, `de.ts`, `es.ts`, `vi.ts`

Tests:

- `src/ts/alertPrompts.replyErrors.test.ts` (new; same mocks as `alertPrompts.test.ts:38-49`, real `alert.ts`)
- `src/ts/process/tests/replyErrorLabel.svelte.test.ts` (new)
- `src/ts/process/tests/sendChatInlineError.svelte.test.ts` (assertions at :517-564 updated, rows added)
- `src/ts/process/tests/composerActions.svelte.test.ts`
- `src/ts/process/tests/moduleEnsure.test.ts`
- `src/ts/process/request/google.vertexAuth.test.ts` (new; harness pattern of `google.signature.test.ts`, which mocks `../../alert` with `alertError: vi.fn()` at :47 and `getDatabase` at :37)
- `src/ts/process/inFlightWork.test.ts`
- `src/ts/android/keepAliveService.test.ts`
- `src/ts/process/tests/replyNotice.svelte.test.ts` (T2)
- `src/lib/Nexus/pattern/ToastHost.svelte.test.ts` (T3, diagnostic)
- `src-tauri/gen/android/app/src/test/java/io/github/yor42/risutanium/NativeReplyNoticePolicyTest.kt`
- plus the mock factories the sweep finds (R2)

Records (session-owned): `Agents/mc/596.md` (MC-3959 is already there, uncommitted; add OQ-4's answer when asked), STAGE_HANDOFF closeout, device row.

New keys (English; verified absent at ca8f2db2e by `git grep`):

| Key | English |
|---|---|
| `replyErrorChatLabel` | `'{name}: {chat}'` |
| `keepAliveRepliesWriting` | `'{count} replies writing'` |
| `keepAliveRepliesFailed` | `'{count} replies failed'` |
| `keepAliveRepliesStopped` | `'{count} replies stopped'` |

`{count}` is always 2 or more. The translator writes per-locale plurals and keeps the interpolations (MC-058).

## Invariants and compatibility

- I1, no lost error. Every reply error raised through sites 1-6 is shown until the person closes it, in FIFO order. A second error never replaces the first, and a cover never ends it. The sites listed under "Out of scope" keep today's replace behaviour (L1, L2, L12).
- I2, no alert replaced. A reply error never replaces a prompt, a notice, another reply error or a closable alert (including a preview's cancellable wait). It is shown at once only over nothing or a closeless cover. Other writers still cover it, and it comes back after their close (FQ-2).
- I3, code cannot close it. `alertClear()` and the `alertStore` wrapper's `none` are refused while an entry is on screen. Only a raw-store `none` from the person's controls closes it: OK, link, Escape (`hotkey.ts`), Back (`alertBack.ts`) (P5).
- I4, no stale chat name. At every site the label is read when the failure is raised, through the failing unit's own origin (or its hint when the origin is gone), never through the selection:
  - sites 1-4: inside `throwError`
  - site 5: in the catch
  - site 6: in `ensureModulesOrAlert`'s catch, after the module await
  It names the chat under the name it had at that moment (L3).
- I5. The inline-error setting is unchanged: the inline branch adds no alert and no label (MC-3742).
- I5b. One request failure gives at most one dialog on the reply path. `requestGoogleCloudVertex` raises no dialog of its own; its `fail` is reported by the caller (F1, OQ-4).
- I6. The card never names a chat while two or more write, and never carries an avatar or target then. One chat writing gives today's card, byte-identical.
- I7. No outcome is lost within a run (MC-3310). Another chat's end or another kind's begin never erases a chat's stop or failure. Only that chat's own next begin, or the run's all-ended take, removes it.
- I8. Close rule (F2): exactly one failed reply closes as that chat's named Failed card, whatever stopped. Two or more failed give "F replies failed", counting only failed replies. With none failed, two or more stopped give "S replies stopped", and one stopped gives today's named Stopped card.
- I9. An entered notification Stop on a Generating card, where native cancels every chat stream, marks every held native token. An entered Stop on a Speaking card marks only tokens of that card's chat, as today. A stale or plain tap marks none.
- Compatibility:
  - no persisted data, format or plugin API changes (MC-175; MC-350 untouched)
  - `alertError` and `ensureModulesOrAlert` only gain optional fields or parameters
  - `takeRunOutcome`'s result gains a field, and its two consumers are in-tree
  - native JSON payload fields are unchanged; only values differ (null identity and target), which native already accepts
  - `requestGoogleCloudVertex`'s result is unchanged; only its side alert is removed
  - the plugin request argument is untouched

## Acceptance scenarios

- S1. Two chats fail close together with inline errors off. A's alert shows "Alpha: Chat 1" first and B's waits. After the person closes A's, B's shows "Beta: Chat 1" first. (MC-3742, MC-3792)
- S2. A prompt is up when a reply error arrives. The prompt stays and takes only its own answer, and the error shows after the answer. (FQ-1)
- S3. A closable alert (`alertNormal`, a boot notice) is up when a reply error arrives. The error waits until that alert is closed. (FQ-1)
- S4. Nothing, or a progress or wait-without-cancel cover, is up: the error shows at once. (FQ-1, guard)
- S5. A reply error is on screen and another writer covers it. When the cover closes, the same error is shown again. (FQ-2)
- S6. A reply error is on screen. `alertClear()` and the wrapper's `none` change nothing. OK, Escape or Back closes it, and the next entry shows. (FQ-3)
- S7. A reply error with a link: the link closes it, runs `open`, and the next entry shows.
- S8. The label names the failing unit's chat after the person switched to another chat. An unnamed chat shows the chat list's label. A deleted chat falls back to the send's hint. In a group chat the owner part is the group's name. An unnameable chat shows the message alone.
- S9. Sites 5 and 6 queue with a label. Site 6 reads the label after the module await.
- S9b. A Vertex reply with incomplete auth and inline errors off shows exactly one dialog, labelled. With inline errors on, the error shows inline only. (F1, OQ-4)
- S9c. A preview whose send fails while its cancellable wait is up: the error shows once the runner closes the wait, exactly once. (F6)
- S9d. The same chat failing twice with the same text gives two dialogs, one after the other. (D-4)
- S10. Two chats write: the card reads "2 replies writing" with no name, avatar, target or count line. When one ends, the card names the remaining chat.
- S11. Both stopped: "2 replies stopped". Both failed: "2 replies failed" with the hint. One fails and one replies: the named Failed card of the failed chat. One fails and one is stopped: the named Failed card of the failed chat. Two fail and one is stopped: "2 replies failed".
- S12. A failure followed by speech closes as Failed (MC-3791 consequence).
- S13. After a notification Stop over the count card, a native reply that still finishes as done posts no "Replied" notification.
- S13b. After a notification Stop over a Speaking card, a held native reply of another chat that finishes as done still posts "Replied". (F3)
- S14. A stopped reply in a hidden chat, with the other chat shown, posts exactly one chip.
- S15. All 8 locales carry the 4 keys (localeParity).

## Required tests

Classes:

- R: regression reproducer. It fails on base ca8f2db2e by the named assertion. The files are unchanged from c736d40a7 for every R row, so both bases are equivalent. Every R is DESIGNED, NOT DEMONSTRATED until the coder records red on base.
- G: compatibility guard; it passes before and after, as stated in the row.
- N: new-API unit with no pre-fix base (the export does not exist on base). Its red-first is shown through the R row that integrates it.
- D: diagnostic.

Fixtures:

- Alert lane: the `alertPrompts.test.ts` harness (writable `alertStore` mock, real `alert.ts`, fake timers). A person's close is the raw `{type:'none'}` write, as `AlertComp` and `hotkey.ts` write it.
- Send path: the existing `sendChatInlineError` and `composerActions` harnesses with real `replyErrorLabel.ts` and synthetic characters and chats.
- Request layer: the `google.signature.test.ts` mock pattern with a synthetic Vertex config (no client email). The fixture is built as the real producer builds it: `requestGoogleCloudVertex` reached with `arg.modelInfo.format === LLMFormat.VertexAIGemini` and a database whose `vertexClientEmail` is empty. No credential values are used.
- Card: real `inFlightWork` and the `keepAliveService.test.ts` fake v2 host.
- Kotlin: the existing `NativeReplyNoticePolicyTest` helpers (`armFor`, `card`, `generating`, `pollEffect`, `onStopTap`).

### Alert lane

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| E1 | S1 | R | Base ignores `reply` and writes the raw store. After two calls, "store shows A's error" fails because it shows B's. After A's close, "B's error shows" fails because the store is `none`. | lane harness; `alertError('x', {reply:{chat:'Alpha: Chat 1'}})`, then Beta |
| E2 | S3 | R | `alertNormal('N')`, then a reply error. "Store still shows N" fails on base: the error replaced it. | lane harness |
| E3 | S2 | R | `alertConfirm` up, then a reply error. "Store shows the confirm" fails on base. The row also asserts that the confirm resolves with its own answer after the guard and that the error then shows. | lane harness, fake timers past `ANSWER_GUARD_MS` |
| E4 | S4 | G (passes before and after: base also writes at once) | none, `progress`, and `wait` without cancel: the error shows at once | lane harness |
| E5 | S5 | R | Error shown, `alertWait('W')` covers it, then the wait owner's `alertClear()`. "The error is shown again, a fresh object with the same msg" fails on base: the store is `none`. Repeated with a non-lane `alertError` cover closed by the person. | lane harness |
| E6 | S6 | R | Error shown, then `alertClear()` and the wrapper's `none`. "Store still shows the error, no writes" fails on base: `noticeShowing()` is false, so `none` is written. | lane harness, `recordWrites` |
| E7 | S6 | R | Two queued. A raw `none` as Escape writes it closes the first, and the second shows. Fails on base as E1 does. | lane harness |
| E8 | S7 | R | Two errors with a link. The link path (raw `none`, then `open`) closes the first and runs `open` once. The second shows with its own `link`, `stackTrace` and `submsg` intact. Fails on base: the first was lost, and its `open` is unreachable. | lane harness, `Error` with stack |
| E9 | S1 | R | `alertIdle` stays false while B is queued behind A and across A's close. Fails on base: idle is true after the close, because nothing was queued. | lane harness, subscribe `alertIdle` |
| E10 | S3 | R | `queueNotice('N')` shown, then a reply error. N stays, and the error shows after N's close (FIFO across lanes, D-3). Fails on base: the error covers N. | lane harness |
| E11 | D-2 | R | `noticesSettled()` stays pending while a reply error is queued or current, and resolves after its close. Fails on base: it resolves at once. | lane harness, `track()` |
| E12 | builder parity | G (passes before and after) | With `reply`: `'{}'` queues nothing; "Failed to fetch" gets the network `submsg`; an `Error` keeps `stackTrace`; `console.error` is called once | lane harness |
| E13 | S1 label, S8 null | R | The first line equals the label and the second starts the message. A `null` label gives the message alone, with no blank line. Fails on base: no label. | lane harness |
| E14 | S8 | N | `replyChatLabel` cases: named gives `'Alpha: Morning'`; unnamed chat gives `'Alpha: Unnamed'` (`settingsPage.unnamed`); unnamed owner; a group chat gives the group's name as the owner; origin gone gives the hint names; neither gives null; a throwing `readAt` gives null | `replyErrorLabel.svelte.test.ts`, real `chatOrigin` over a synthetic DB with a character chat and a group chat |
| E15 | S8, site 2 | R | Inline off; the error fires after the selection moved to chat B. `alertErrorMock.mock.calls[0][1]` equals `{ reply: { chat: 'Alpha: Chat 1' } }`. Fails on base: it is `undefined` (the guard at :556-564 asserts undefined and is rewritten). | `sendChatInlineError` harness |
| E15b | site 1 | R | HypaV2 link path: `[1].link.open` is still `openMemorySettings`, and `[1].reply.chat` is the label. Fails on base: no `reply`. | same, :517-541 rows extended |
| E15c | site 3 | R | Inline on and the chat unresolvable (`subject.resolve()` gives null): the alert carries `reply`. Fails on base. | same harness |
| E15d | site 4 | R or limitation | Inline on and the append throws: the alert carries `reply`. If the coder cannot drive the catch without mocking internals, this is named as limitation L10, covered by M9b being equivalent by construction (one `reply` const shared by all four calls). | same harness |
| E15e | I5 | G (passes before and after) | Inline on and resolvable: no `alertError`, and the error is appended (existing :445-473) | same |
| E16 | S9, site 5 | R | `sendChat` mocked to throw in Alpha while Beta is selected: `alertError` is called with `(error, { reply: { chat: 'Alpha: Chat 1' } })`. Fails on base: it is called with `(error)`. | `composerActions.svelte.test.ts` |
| E17 | S9, site 6 | R | `ensureModulesOrAlert(ORIGIN, undefined, HINT, { asReply: true })` with a failing stub and `replyChatLabel` mocked to return `'X: Y'`: `alertError` gets `[text, { reply: { chat: 'X: Y' } }]`, and the mock was called with `(ORIGIN, HINT)`. Fails on base: the 4th argument is ignored and `alertError` gets `[text]`. | `moduleEnsure.test.ts` (its `alertError` mock records args), plus `vi.mock('./replyErrorLabel')` |
| E17b | site 6 in `sendChat` | R | A `sendChat` with a failing module stub calls `ensureModulesOrAlert` with `{ asReply: true }` as its 4th argument. Fails on base: 3 arguments. | `sendChat` harness with a module stub (e.g. `composerModuleAwait` or `moduleLoaderCallers`); the coder names the file |
| E17c | I4, site 6 | N (the option is new) | The label is read after the module await: `replyChatLabel` is not called before the stub's load promise settles, and is called once after. A call without `asReply` gives `alertError` exactly `[text]` (one argument). | `moduleEnsure.test.ts`, deferred stub |
| E18 | existing notice suite | G (passes before and after) | All of `alertPrompts.test.ts` "boot notices from the queue" (:659-990) unchanged | existing |
| E19 | S9c, F6 | R | `alertWait('…', onCancel)` up (the preview's wait), then a reply error. Asserts that the store still shows the wait, and that after `alertClear()` (the runner's `closeIfOurs`) the error is shown, exactly once in the recorded writes. Fails on base: the error replaced the wait. | lane harness, `recordWrites` |
| E20 | S9d, D-4 | R | Two `alertError('same', {reply:{chat:'Alpha: Chat 1'}})` calls: the first shows, and after the person's close the second shows with the same text. Fails on base: after the close the store is `none`. | lane harness |

### Request layer (5d-1, OQ-4)

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| V1 | S9b, I5b | R | `requestGoogleCloudVertex` with a Vertex Gemini model, a secret-reference private key and an empty `vertexClientEmail` returns `{ type: 'fail', result: language.errors.vertexAuthIncomplete }`, and `alertError` is not called. Fails on base: `alertError` is called once (`google.ts:516`). | `google.vertexAuth.test.ts` (pattern of `google.signature.test.ts`; `readKeyField`/`isSecretRef` stubbed as that suite or the coder finds them) |
| V1b | S9b, I5b | R | The same with a plain private key, `vertexAccessTokenExpires` in the past and an empty `vertexClientEmail`: same result, no `alertError`. Fails on base (`google.ts:536`). | same |
| V2 | S9b end to end | composition | One dialog on the reply path is V1/V1b (no raw alert) plus E15 (`throwError` raises one labelled lane alert for any `fail`). If the coder finds a harness that runs the real `google.ts` through `sendChat` (candidates: `requestOrigin*.svelte.test.ts`), the end-to-end row is added as R: exactly one `alertError` call, carrying `reply`. Otherwise it is named as limitation L13. | |

### Card

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| K1 | I7 | R | A and B live; A ends failed, B ends with a reply: `takeRunOutcome()` equals `{failed, target A, count 1}`. Fails on base: null (replaces "the last of two live chats to end describes the run", :89-102). | `inFlightWork.test.ts` |
| K2 | S11 | R | A and B both stopped: `{stopped, target: null, count: 2}`. Fails on base: `{stopped, target B}`. | same |
| K3 | S11, I8 | R | A and B failed, C stopped: `{failed, target: null, count: 2}` (MC-3959 OQ-1 (a)). Fails on base: C's `{stopped, target C}`. | same |
| K3b | S11, I8, F2 | R | A failed, B stopped (both orders of ending): `{failed, target A, count 1}`. Also A failed, B and C stopped: the same. Fails on base: the last to end wins (`{stopped, target B}` when B ends last). | same |
| K4 | S12 | R | A fails while tts is live, then translate begins and ends: the outcome is kept. Fails on base: reset to null. | same |
| K5 | I7 | R | A fails while B runs; A begins again and replies; B ends with a reply: null. Then A fails while B runs, B begins again, B ends: A's failure is kept. The second half fails on base: B's begin reset it. | same |
| K6 | P3a | G (passes before and after) | A stopped under a pending save survives to the save's end and is taken once (existing :110-113, :63-70, with `count` added) | same |
| K7 | bound | G (passes before and after) | A non-save begin with nothing live clears a leftover outcome | same |
| K8 | `inFlightChatCount` | N | 0, 1, 2 distinct targets; two tokens of one target count 1; a token without a target counts 1 | same |
| K9 | S10 | R | Two chats live with `chatCount: inFlightChatCount`: the live notice has `title` and `publicTitle` '2 replies writing', `identity: null`, `target: null`, `text: ''`, and no avatar. Fails on base: the title is `LABELS.generating` and the identity is B's. | `keepAliveService.test.ts` fake v2 host |
| K10 | S10 | G (passes before and after) | Back to one chat: the named card of the remaining chat. With one chat throughout, the payload is identical to today's. | same |
| K11 | S11 | R | Both stopped: closing `{state:'stopped', title:'2 replies stopped', identity:null, target:null}`. Fails on base: title 'Stopped', target B. | same |
| K12 | S11 | R | Both failed: closing title '2 replies failed', `text` failedHint, `identity` null. Fails on base. | same |
| K13 | S11 | R | A fails and B replies: the closing is named Failed with target A. Fails on base: `finishing`. | same |
| K13b | S11, F2 | R | A fails and B is stopped (B ends last): the closing is the named Failed card with target A, A's identity and `failedHint`, not a count title. Fails on base: named Stopped with target B. | same |
| K14 | I8 | G (passes before and after) | A single chat stopped or failed is named, unchanged (existing :1029-1061, :1140-1180) | same |
| K15 | S12 | R | Flip of "a failure that ended while speech was live does not show after translation ends" (:1091-1103): it now shows `failed`. Fails on base: `finishing`. | same |
| K16 | count note | R | Page hidden, two chats live, a `count` stream change after `COUNT_INTERVAL_MS`: no `updateState`. Fails on base: base resends. | same, `subscribeChanges` and `pageHidden` stubs |
| K17 | wiring | R | `startKeepAliveService` passes `chatCount` and the three labels: two chats give the count title through the production deps. Fails on base: the title is the generating label. The harness exists: `startKeepAliveService` appears 19 times in `keepAliveService.test.ts` (Gate 1). | `keepAliveService.test.ts` |
| K18 | P3b/P3d | G (passes before and after) | Existing :1078-1121 rows unchanged | same |

### Native

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| N1 | S13 | R | Count card (`generating(null)`), tokens for `a` and `b`, an entered Stop: `pollEffect(…, 1).action` gives `SKIP_STOPPED` for both. Fails on base: `POST_DONE` for both. | `NativeReplyNoticePolicyTest.kt` |
| N2 | I9 | R | Rewrite of d6 (:349-369): a named Generating card `a` with tokens `a`, `b`, `null` gives `SKIP_STOPPED` for all three. Fails on base for `b` and `null`. | same |
| N3 | I9 | G (passes before and after) | d7 (stale or plain tap marks nothing, :371-395), d8, d9, the `:414-424` disarm test (direct `stopPressed(a)`) and `:440-450` (`StopMark(a)`) unchanged | same |
| N4 | S13b, I9, F3 | G (passes before and after: base marks only the card's target) | A Speaking card for `a` (`card(state = NoticeState.SPEAKING, target = a)`), tokens for `a` and `b`, an entered Stop (`StopTap.ENTERED`, and `display.nativeCancelWanted()` is false): `b` polls `POST_DONE`, and `a` polls `SKIP_STOPPED` (base's target-only mark kept). A count-free Speaking card with target null and a token for `b`: `POST_DONE`. Kills M42. | same; a `speaking(target)` helper beside `generating` |

### Toast, diagnostic and locale

| Id | Scenario | Class | Pre-fix base and expected failure | Fixture |
|---|---|---|---|---|
| T1 | S14 | G (passes before and after) | Existing T19c `replyNotice.svelte.test.ts:911-927` | existing |
| T2 | S14 | G (passes before and after: base also posts one chip) | Two chats, B shown and A hidden, both streaming, `stopAllReplyWork()`: `expectOnlyTheChip('warning', "char-0's reply was stopped")` for A, and no `info` chip | `replyNotice.svelte.test.ts` harness with two chats |
| T3 | Part 4 | D | `ToastHost.svelte`: after an info toast expires (5 s fake clock), `[data-part="toast-live-polite"]` still holds `text + ' ' + sub`, and no toast element remains. It establishes the DV text and changes no code. | `ToastHost.svelte.test.ts` harness |
| L1 | S15 | R | localeParity fails on base once `en.ts` has the keys and a locale lacks them. It passes when all 8 carry the 4 keys. | existing localeParity test |

Every R row's red-on-base run is recorded with the command, the base hash and the failing assertion text. E1-E20 and V1/V1b run in a scratch copy of the base with the test file copied in (no pnpm through the junction; see ownership).

## Mutants to kill

Each mutant breaks one new rule, and the named test must fail.

5d-1:

- M1 `queueErrorNotice` always shows at once, skipping the admission rule: E2, E3, E10, E19.
- M2 a queued error is dropped instead of pushed when an entry is current: E1, E7.
- M3 an error entry is cleared on any `none` (a cover's close treated as the person's): E5.
- M4 `noticeShowing()` is false for error entries, so code can close them: E6.
- M5 a re-show writes the same object instead of a fresh copy: E5's `not.toBe(first)` assertion.
- M6 `alertError` ignores `reply` and writes the raw store: E1, E2.
- M7 `alertError` with `reply` writes the raw store and also queues: E2 (the store shows the error over N).
- M8 the label line is omitted, or appended last: E13.
- M9 `throwError` reads the label from the selected chat (`selectedChatKey` or the `DBState` selection) instead of `origin`/`hint`: E15.
- M9a the link path without `reply`: E15b.
- M9b the unresolvable-chat path without `reply`: E15c.
- M10 the `sendChatMain` catch without `reply`: E16.
- M11 `ensureModulesOrAlert` ignores `asReply`: E17.
- M11b `sendChat` calls it without `{ asReply: true }`: E17b.
- M11c `ensureModulesOrAlert` computes the label before the module await: E17c.
- M11d `ensureModulesOrAlert` passes a second argument (`undefined` or `{}`) when not a reply: E17c's one-argument assertion.
- M12 `publishIdle` ignores queued entries: E9.
- M13 `noticesSettled` ignores error entries: E11.
- M14 an error entry is stored as type `normal`, losing link and stack: E8.
- M15 `replyChatLabel` uses `''` for an unnamed chat: E14.
- M16 `replyChatLabel` returns null when the origin is gone although the hint has names: E14.
- M17 `queueErrorNotice` drops an entry whose `msg` equals a current or queued entry's (dedupe): E20.
- M18 the raw `alertError` is kept at either Vertex auth site in `google.ts`: V1 (`:516`), V1b (`:536`).

5d-2:

- M20 a non-chat begin clears the map while entries are live: K4, K15.
- M21 a chat begin clears every chat's outcome: K5.
- M22 a reply end deletes every outcome: K1, K13.
- M23 the count counts every bad chat instead of the failed ones: K3 (count 3), K3b (count 2).
- M24 a single bad chat returns `target: null`: K13, K14.
- M24b the target is null when the failed count is 1 among several bad (one failed plus stopped): K3b, K13b.
- M24c one failed plus stopped returns the stopped outcome (stop outranks a single failure): K3b, K13b.
- M25 stop outranks failure: K3, K12.
- M26 the count card from `chatCount() >= 1`: K10.
- M27 the count card keeps identity or target: K9.
- M28 the closing ignores `count` (named title): K11, K12.
- M29 `onStreamChange` still resends for the count card: K16.
- M30 `startKeepAliveService` omits `chatCount`: K17.
- M31 the count card keeps the count line (`text` is the page's count text): K9's `text: ''` assertion.

5d-3:

- M40 `onStopTap` marks only tokens of the card's target on a Generating card: N1, N2.
- M41 a stale or plain tap marks all: N3 (d7).
- M42 `onStopTap` marks all on any entered tap, whatever the card's state: N4.

Expected equivalent, which the coder argues if it survives: removing `inFlightChatCount`'s distinct-target step while each chat has one unit. K8's "two tokens of one target" row should kill it. If the coder cannot build two tokens of one target through the public API, it is equivalent under the one-unit-per-chat exclusion.

## Risks and trade-offs

- R1. Shared FIFO with boot and reconcile notices (D-3). A long reconcile note sequence delays a reply error. This is accepted as "no alert replaced". The alternative, a separate lane with its own priority, needs a cross-lane order rule that MC-3959 does not give.
- R2. Test blast radius.
  - Tests that mock `../alert` and assert the exact second argument of `alertError` from the send path change: `sendChatInlineError.svelte.test.ts:556-564`, and `composerActions.svelte.test.ts` if a test asserts the `sendChatMain` catch. This is PARTIAL: the coder greps `alertError).toHaveBeenCalledWith` and `alertError.mock.calls` in send-path tests.
  - Tests that mock `alertPrompts`, `replyNotice`, `inFlightWork` or `moduleEnsure`: 167 files (raw, combined grep at c736d40a7). A factory that lacks `queueErrorNotice` or `inFlightChatCount` fails only where the path executes. The coder runs `src/ts/process/tests`, `src/ts/process/request`, `src/ts/android`, `src/ts/alert*` and the ChatShell and Nexus suites that mock `alertPrompts`, and fixes factories only where a run fails.
  - Request-layer tests asserting a Vertex auth `alertError`: none at ca8f2db2e (`git grep vertexAuthIncomplete -- src ':!src/lang/*'` matches only `google.ts:516-537`).
- R3. `alertError` keeps the builder for every caller, and non-reply callers see no behaviour change (guarded by E12 and E18).
- R4. With the 5d-3 change, an entered Stop on a Generating card skips "Replied" for any chat whose reply finished just before the Stop landed. Before, that applied only to the card's chat. It is D17's existing trade-off, applied to every chat native cancels, under MC-3309.
- R5. The Kotlin tests are outside PR CI, so the local gradle run is the only evidence, and a stale gradle cache gives a false pass. The session runs `gradlew testDebugUnitTest --tests '*NativeReplyNoticePolicyTest*' --rerun-tasks` in `src-tauri/gen/android` and records the command, the test count and the non-cached run.
- R6. `alertIdle` subscribers (`AlertComp.svelte:318`, `previewRunner.ts:73`) now see "not idle" while reply errors are queued behind a prompt. This is intended (E9). A preview result waiting for idle (`showAfterAlertCloses`) now also waits until queued reply errors are closed.
- R7 (F1). Callers that raise no dialog on a failed request lose the Vertex-auth dialog: triggers, Lua, MCP aiaccess, and possibly subtitles, suggestions and the image-prompt request (PARTIAL). The person still sees the reason in the trigger variable or the Lua result, and the main reply on the same model shows it as a reply error. This is OQ-4.

Known limitations (named in the PR, together with stage 7's K1..K12 and 7b Gate 2 r1 E1, O-12):

- L1. Direct `alertError` calls outside sites 1-6 that can fire during a reply stay unqueued and unlabelled:
  - the request layer's tool-loop alerts (5 sites)
  - translator (4), tts (9), stableDiff internals
  - user-content alerts (trigger effect, Lua)
  - the MCP approvals notice
  (see "Out of scope")
- L2. A body throw under `/command` (`command.ts:310`), `.po` multisend (`multisend.ts:99`) or the dev autopilot (`devToolActions.ts:123`, `runAutopilot` calls `sendChat` with no catch) is not caught by a send-path site. It reaches the page's unhandled-rejection `alertError` (`bootstrap.ts:627`) unqueued and unlabelled. INFERRED from the call chain; `sendMain` (`composerActions.svelte.ts:369`) has no catch. The coder confirms.
- L3. The label is the chat name when the failure is raised. A rename while the error is queued keeps the old name.
- L4. A closeless progress cover that keeps updating re-covers a shown entry on each write (existing notice behaviour).
- L5. A hidden send that throws gets both the failure chip and the queued alert, because `dialogRaised` is set only for units noted as alerted (already so today).
- L6. A preview counts as a reply in the card count.
- L7. Native's `nativeOutcome` card change applies only to a named card of the same target. Under the count card, a native-announced finish while the page is frozen leaves "N replies writing" until the page syncs.
- L8. Task cards (`alertTask`) are not ordered with the lane, so a reply error can show while a task card is up (existing notice behaviour).
- L9. Reconcile notes stay plain notices without the "Character: chat" line.
- L10 (conditional). E15d, if the catch path cannot be driven.
- L12 (F4). hanurai's "too much token" alert (`hanuraiMemory.ts:67`) is a reply failure but stays unqueued and unlabelled. Its unit is not noted as failed, an existing quirk (`index.svelte.ts:2263-2265`), so it counts toward neither the chip suppression nor the card's Failed close. Fixing it needs hanurai to return its error for `throwError` instead of alerting, which is a memory-module change outside 5d.
- L13 (conditional). V2, if no end-to-end harness runs the real `google.ts` through `sendChat`.

L11 (r1) is removed: the K17 harness exists.

## Premises

Re-pin at ca8f2db2e: `git diff --name-only c736d40a7 HEAD` lists 52 files. Among the files this plan cites, only `src/ts/bootstrap.ts`, `src/ts/nativeReply/reconcile.ts` (not cited for a line) and the 8 `src/lang/*.ts` files appear. The `bootstrap.ts` anchors were re-read: `noticesSettled` `:320`, unhandled rejection `:627`, notes `:855-860`, `notice: queueNotice` `:878`. Every other cited line is unchanged by construction. The anchors this revision leans on were re-grepped at ca8f2db2e: `index.svelte.ts` (`:286`, `:301`, `:451`, `:454`, `:498`, `:517`, `:899`, `:1074-1136`, `:2263-2265`, `:3034-3035`, `:3798-3809`), `alertPrompts.ts` (`:52`, `:56`, `:69-78`, `:81`, `:121`, `:141-147`, `:242`, `:255`, `:265`), `inFlightWork.ts`, `keepAliveService.ts`, `moduleEnsure.ts:72-86` and the Kotlin files.

REOPENED in this revision:

- P18 (F1). `google.ts:511-544`: both Vertex auth branches alert, then return `fail` with the same text. `requestGoogleCloudVertex` is called from `request.ts:742` with `targ = arg` (`:663`). The `requestChatData` callers (non-test `src`, 18 sites, COMPLETE for that grep) and their `fail` handling were scanned in the 30 lines after each call. Scan output: `C:\Users\yor42\AppData\Local\Temp\claude\4698cb3b0426773c\33cf7d4a-85b1-4349-ae45-cf448603bff1\scratchpad\failhandling.txt`. `subtitleRequest.ts`, `suggestionRequest.ts` and `index.svelte.ts:3621` showed no `fail` branch within the window: PARTIAL.
- P19 (F1). The request layer has 70 `type: 'fail'` returns (`git grep -c`) and 7 `alertError` calls, 2 of them paired with a `fail` return (`google.ts:516,536`).
- P20 (F1). `vertexAuthIncomplete` is referenced only at `google.ts:516-537` outside `src/lang` (`git grep`), so no test asserts the alert.
- P21 (F3). `KeepAliveNotice.kt`: `stoppable` `:75-76`; `stopTapped` `:365-372`; `nativeCancelWanted` `:374-376`; `deliverStopTap` `:160-174`. `NativeReplyNoticePolicy.kt`: `stopPressed` `:140-146`; `StopMark`/`stopMark` `:168-175`; `onStopTap` `:177-180`. Production callers: `KeepAliveService.kt:149` (`enterStopTap`) and `:217` (`deliverStopTap`). `NativeReplyNotices.kt:18,26`: process-level `tokens`.
- P22 (F3). `streamed_fetch.rs:203-223`: `cancel_chat` filters on `entry.tags.chat_stop` alone.
- P23 (F3, F7j). `NativeReplyNoticePolicyTest.kt`: d6 `:349-369`; d7 `:371-395`; direct `stopPressed(a)` `:418`; `StopMark(a)` `:449`; helpers `armFor` `:51`, `card` `:54-71`, `generating` `:73-77`, `tap` `:80-83`. No existing test covers a Speaking card's mark (grep SPEAKING in this file: 0).
- P24 (F6). `previewRunner.ts`: `closeIfOurs` `:115-119`, `alertWait(…, onCancel)` `:121`, `sendChat` `:131`, close on no result `:138-140`, doc comment `:86-103`, `alertIdle` subscription `:73`.
- P25 (F7). `lastCharacterRestore.ts:14,65,107,143`: `bootNoticeShowing` reads `noticeShowing()`.
- P26 (F7). `replyNotice.ts:120-121`: the owner is "the character or group the chat belongs to"; `namesOf` `:128-138`.
- P27 (F5). `ensureModulesOrAlert` callers (non-test `src`, COMPLETE): `characters.ts:432`, `composerActions.svelte.ts:362`, `index.svelte.ts:454`, `messageActions.svelte.ts:182,257`.
- P28 (F7). `sendChat(` callers: `command.ts:310`, `devToolActions.ts:123`, `previewRunner.ts:131` (plus `multisend.ts:99` and `composerActions` from Gate 1's COMPLETE grep).
- P29 (F7e). `keepAliveService.ts:548-586`: `pushLive` sends only on change, resend or no service; the count timer runs for any `generating` payload.
- Free keys: `git grep` for the 4 new key names in `src` gives no match.

INHERITED FROM r1 (REOPENED there at c736d40a7; files unchanged since, confirmed by Gate 1's premise table): P1-P11, P13, P14, P16, P17 (path corrected: `src/lib/ChatShell/sidebar/ShellChatRow.svelte:52,207`). P12's Rust inference is now REOPENED as P22.

INHERITED FROM SIZING / STAGE_HANDOFF: the stage 5a-7e mechanism, the decisions list and the order (7c before 5d, now merged). From `s5-plan-r2.md`: AM4 and the E10 exclusion.

INHERITED FROM GATE 1 (not re-read here): the 297-line `alertError` enumeration and the per-file classification behind L1 (PARTIAL by the verdict's own note); `startKeepAliveService` appears 19 times in `keepAliveService.test.ts`.

Not verified: that vitest throws on access, not on import, of a missing factory export (R2). The coder sees it in the first sweep run.

## Open items

Product question (the orchestrator asks, or rules it derivable; the recommended option is first):

- OQ-4 (F1 side effect). Blocks only the `google.ts` edit, V1, V1b and M18. When a Vertex request fails because its auth is incomplete, callers that do not raise a dialog on a failed request (triggers, Lua scripts, MCP aiaccess, possibly subtitles and suggestions) either:
  - (a) show no dialog, like every other provider failure today. The reply path shows one labelled dialog (or inline only with inline errors on). Recommended: smallest, removes an inconsistency, and the reason is still in the trigger variable or Lua result.
  - (b) keep today's dialog for those callers. A new request flag set by the main send, the emotion request and the memory summaries suppresses the `google.ts` alert only for them. This adds a field to `requestDataArgument` and three call-site edits, and needs a plan revision.

Process items for the orchestrator:

- O-4. D-2 and D-2b are internal and boot-only. Gate 1 accepted D-2; D-2b is new and for Gate 2 to note.
- O-6. MC-3959 is in `Agents/mc/596.md` (uncommitted). Add OQ-4's answer there if asked.
- O-7. Translator: the 4 keys in 7 locales in the same PR (MC-058), and run localeParity.
- O-8. The Kotlin JVM tests are not in CI. The session runs gradle locally with `--rerun-tasks` and records the command, the count and the result (R5).
- O-9. Gate 2 routing: off the critical contract (Gate 1 confirmed), so Sonnet by default.
- O-10. Device row after merge (asked by this ticket's session; Note 9, synthetic):
  - two native replies give "2 replies writing", and the notification Stop gives "2 replies stopped"
  - no "Replied" notification follows the Stop
  - one visible toast for the hidden chat, counted excluding `toast-live-*`
  - two mock failures in two chats give two labelled alerts, one after another
  - a confirm up during a failure: the error waits
  - optional: one mock failure plus a notification Stop of the other chat gives the failed chat's named Failed card
- O-11. DV carry-over (b) is closed as an observation artifact unless T3 or the device row disagrees.
- O-12 (F7). #596 closes with this PR. The PR body carries stage 7's known limitations K1..K12 (`s7-plan.md`) and the 7b Gate 2 r1 E1 limitation (STAGE_HANDOFF), as well as L1-L13 here. This designer did not read those files (not named inputs). The session copies them.

Artifacts (scratch, outside the repository):

- `C:\Users\yor42\AppData\Local\Temp\claude\4698cb3b0426773c\33cf7d4a-85b1-4349-ae45-cf448603bff1\scratchpad\failhandling.txt`: the `requestChatData` caller `fail`-handling scan (P18).
- This plan: `C:\Users\yor42\AppData\Local\Temp\risu-b715\b61\596-s2\s5d-plan-r2.md`. r1's scratch copies under `s5d-design\` are unchanged.
