# Slice 2 feasibility: switch chat or character while a reply generates (DD-039)

Source-reading only. No app builds, no tests run, nothing executed. Paths are under `C:\Projects\Risutanium-UI-Rework\src`. OBSERVED means read in source at the cited line. INFERRED means reasoned from that source and not run.

Line-number note: the brief pointed at `globalApi.svelte.ts` ~4700. That file has 4349 lines, and `changeChatTo` is at `ts/globalApi.svelte.ts:4273`.

## Verdict

Feasible. The engine already writes by chat identity, not by selection. The only hard block is the `doingChat` guard in `changeChar`. The remaining work is mostly UI scoping of the one global `doingChat` flag.

## 1. How `sendChat` identifies its target chat (OBSERVED)

- The target is an `Origin` (`chaId` + `chatId`, optional `memberChaId`), fixed at entry.
  - `enterSendChat` (`ts/process/index.svelte.ts:224-274`) takes the origin from `arg.origin`. The composer supplies it.
  - The only selection read is the fallback at `:248-249`, used when no origin is passed.
- The composer captures the origin before generation.
  - `sendMain` (`ts/process/composerActions.svelte.ts:210-224`) reads `selectedCharID` and `chatPage` once and calls `beginWork`.
  - `sendChatMain` (`:532-553`) passes `origin` and `originHint` to `sendChat`. Its comment at `:534-538` says explicitly that the selection "may be another chat, another character or Home by the time the send is handed over or has finished".
- Every write re-resolves the origin through `subject.resolve()`.
  - Sites: `index.svelte.ts:477, 519, 547, 621, 659, 1337, 1556-1622, 2087, 2299, 2313, 2345, 2361, 2414, 2440`.
  - `ts/process/chatOrigin.ts:213-214` documents that `resolveOrigin` "Never reads `selectedCharID` or `chatPage`".
- Streaming writes go to the origin's chat object.
  - `streamCtx.chat.message.push(...)` is at `index.svelte.ts:2111`.
  - `isStreaming` is set on that chat at `:2133` and cleared at `:2301`.
  - The reply is tracked by message id (`replyId`, `locateReply`, `:380-465`), not by index.
- `settleSendChatCall` (`:283-287`) marks the origin's owner for save "whatever the selection has moved to since". Its comment (`:277-282`) says hotkeys, Playground and Home already change selection mid-generation without checking `doingChat`.
- Group turn loops (`:738-748`) and `runAutoMode` pass `origin` explicitly. No selection read happens in the loop.

## 2. What else assumes the on-screen chat

| Area | Finding | Evidence |
|---|---|---|
| Triggers `start` / `output` | Take `currentChar` / `currentChat` objects, not selection. | `index.svelte.ts:1331, 2328, 2456` (OBSERVED). `runTrigger` builds its subject from `arg.origin` (`ts/process/triggers.ts:1124`); the origin passes via `createRunSubject`. |
| Request trigger | Uses the origin when `arg.subject` is set. The selection fallback `getCurrentCharacter()` / `getCurrentChat()` is only for callers with no subject. | `ts/process/request/request.ts:247-273` (OBSERVED). Whether `sendChat`'s own request always passes `subject` is INFERRED, not traced. |
| Display trigger | `processScriptFull` mode `editdisplay` uses `getCurrentCharacter()` / `getCurrentChat()`. | `ts/process/scripts.ts:234-241` (OBSERVED). This is render-time and follows the shown chat. That is correct for display, and inert for the background chat. |
| Trigger `v2UpdateChatAt` | Bumps `ReloadChatPointer[index]` by message index only, which could re-render the wrong visible message. Cosmetic. | `triggers.ts:2578-2583` (OBSERVED). |
| Lua scripting | Origin-aware via `ownerFor` with `state.subject`. Without an origin it falls back to the selection. | `ts/process/scriptings.ts:65-72, 177-182` (OBSERVED). `sendChat` passing a subject is INFERRED from `scripts.ts:232`. |
| Modules | `getModules(subject)` uses the subject. | `ts/process/modules.ts:718-731` (OBSERVED). |
| Memory (Hypa v2/v3, supa) | Receive `currentChat`, `nowChatroom` and `subject`. Results are written through `subject.resolve()`. | `index.svelte.ts:1548-1605` (OBSERVED). |
| TTS auto-speech | Reads the stored reply via `resolveReply()`, then `sayTTS(currentChar, ...)`. It plays regardless of which chat is shown. | `index.svelte.ts:2472-2486`; `ts/process/tts.ts:163-175` (OBSERVED). The `getCurrentCharacter()` fallback only applies when no character is given. Whether audio from a hidden chat is wanted is a product question. |
| Image generation and emotion | `stableDiff(currentChar, msgStr, subject)` is subject-aware. Emotion state is keyed by `currentChar.chaId`. | `index.svelte.ts:2794, 2600` (OBSERVED). |
| `abortChat` | The module-level controller is global, not per chat. `abortUnitInProgress()` aborts the one published unit. | `ts/process/composerActions.svelte.ts:609-634`; `ts/process/generationOwnership.svelte.ts:27-44` (OBSERVED). It aborts from any chat, and the busy button shows in every chat (see §4). |
| Keep-alive bridge | Driven by the in-flight kinds registry (`beginInFlight('chat')` at `index.svelte.ts:330`). Stop calls `composer.abortChat()`. | `ts/android/keepAliveService.ts:194-213` (OBSERVED). Selection-independent, so unaffected. |
| Auto mode | Stops itself after the in-flight tick when the origin is no longer shown. | `composerActions.svelte.ts:693, 698` (OBSERVED). Switching away therefore ends the auto-mode run, but not the tick in flight. |
| `doingChat` | One global writable. `sendChat` refuses while it is set (`index.svelte.ts:311`) and sets it at `:331`. | OBSERVED. This is the single-background-reply invariant, and it is already enforced. |
| Delete / archive of the generating chat | Delete aborts via the registration stop (`index.svelte.ts:314-317`, `:571`). Cold-storage archive refuses while `doingChat` or `chat.isStreaming` (`ts/process/coldstorage.svelte.ts:884, 892`). The keep-set protects any character a registered unit writes (`ts/process/memory/characterPutBack.ts:6-11`, `isWriting` import at `:29`). | OBSERVED. |
| Post-reply Suggestion component | Subscribes to `doingChat`. On false it calls `requestSuggestions()` for the selected chat, with no check that the finished reply belongs to the shown chat. On true it clears suggestions. | `lib/ChatScreens/Suggestion.svelte:127-134, 50-63` (OBSERVED). INFERRED consequence: when a background reply ends, a sub-model suggestion request fires for whichever chat is shown, with no new message there. |

## 3. Composer draft and chat-window reset

- Composer draft: safe (OBSERVED). Drafts are keyed by `{chaId, chatId}`.
  - `DefaultChatScreen.svelte:83-87` builds the key; `composerDrafts.peek(key)` reads it at `:102-106`.
  - `take` and `putBack` are key-addressed (`composerActions.svelte.ts:233, 295, 406`). They write to the origin's record "whether or not that record is on screen".
  - The record store has a cap with eviction, and the on-screen key is protected (`composerDrafts.svelte.ts:75-90`). INFERRED: with many chats, an off-screen record could be evicted. The cap value was not read.
  - `take` empties the origin's draft at send. Returning to that chat during generation shows an empty composer. After a refusal or abort the text is put back.
- Chat-window reset: safe (OBSERVED). `chatWindowKey(chaId, chat)` is recomputed in `$effect.pre`, and the policy resets `loadPages` only when the key changes (`DefaultChatScreen.svelte:179-190`). INFERRED: returning to the generating chat re-windows to the initial page and scrolls to the bottom. The reply is still visible, since `isStreaming` lives on the chat object (`Chats.svelte:91-94`).
- `changeChatTo` runs `flushSync()` and `ReloadGUIPointer.set(...)` (`globalApi.svelte.ts:4307-4308`). It has no `doingChat` check.

## 4. Guards that block switching mid-reply

- Character switching has one guard: `changeChar` returns when `get(doingChat)` (`ts/characters.ts:1417-1419`). The same flag is re-checked after the cold restore at `:1445` and `:1460`. The comments at `:1403-1407` and `:1425-1427` also describe the guard.
- Everything user-facing that selects a character goes through `changeChar`:
  - rail: `lib/SideBars/SidebarRail.svelte:835, 842`
  - mobile list: `lib/Mobile/MobileCharacters.svelte:126`
  - grid catalog: `lib/Others/GridCatalog.svelte:141`
  - hotkeys: `ts/hotkey.ts:219, 242`
- Chat switching within a character has no guard (OBSERVED). `changeChatTo` is called from `lib/Others/ChatList.svelte:29`, `lib/SideBars/SideChatList.svelte:240, 336` and `lib/ChatScreens/Chat.svelte:1017`, with no `doingChat` condition. So chat switching during a reply already works today.
- Paths that clear selection are also unguarded: `selectedCharID.set(-1)` in `Sidebar.svelte`, `MobileHeader.svelte:19` and `hotkey.ts:185`.
- Existing tests encode the current refusal, so the main session will need to update them: `ts/hotkeyCharSwitch.svelte.test.ts:380, 477`, `ts/characters.coldRestore.svelte.test.ts:662, 672`, `ts/characters.coldGroup.svelte.test.ts:501`.

## Conclusions

**(a) Minimal version is feasible** (one background reply, free switching, no new send elsewhere until it finishes).

Required changes (proposed for the main session; nothing was edited here):

1. Remove the `doingChat` guards in `changeChar` (`ts/characters.ts:1417, 1445, 1460`). Update the doc comments at `:1403-1407` and `:1425-1427`.
2. Expose what is generating. The origin is available inside `enterSendChat` / `sendChat` (`index.svelte.ts:224, 309`). Publish it, for example via a store or `generationOwnership.svelte.ts`, so the UI can tell "this chat is generating" from "another chat is generating". There is currently no such signal.
3. Scope the composer UI to that signal.
   - The stop-or-send toggle at `DefaultChatScreen.svelte:665` and the retry disable at `:862` read global `$doingChat` and `isComposerBusy()`. In another chat they would show a spinner and a Stop button that aborts the background reply (`abortChat` is global).
   - Needed: a different state for "another chat is generating". It must also explain the refusal, because `sendMain`, `reroll`, `unReroll` and `runAutoMode` return silently on `doingChat` (`composerActions.svelte.ts:203, 446, 500, 669`).
4. Scope `Suggestion.svelte:127-134` so it reacts only to its own chat finishing.
5. Add a finished-in-background signal: an unread badge or toast on the finished chat or character in rail, chat list and mobile. Nothing in the engine provides one today.
6. Product decision on side effects of a hidden reply: TTS audio, the `playMessage` sound (`composerActions.svelte.ts:568-571`) and the keep-alive notification label. See open decisions.

**(b) What breaks if the guards are simply removed**

- Nothing in the write path (INFERRED from the origin-based writes in §1).
- Visible breakage:
  - Stop button and spinner show in the wrong chat. Clicking Stop in chat B aborts chat A's reply.
  - Send in the other chat silently does nothing.
  - Suggestions fire for the wrong chat when the background reply ends.
  - TTS can speak a reply the user cannot see.
  - Auto mode silently ends after its current tick.

**(c) Fallback if the above is not wanted**

- Keep the `changeChar` guard and offer within-character chat switching only, which already works, or
- Keep the block but explain it (disabled rail items with a "generating" hint). This contradicts DD-039, so it is a degradation, not an alternative.

**(d) Risks lane A must test** (UI behavior, not run here)

1. Start a reply in A, switch to chat B of the same character, then to character C. Verify the stream completes in A, with no text in B or C, and A saved: reload and check.
2. Streaming display when returning to A mid-stream. Check chat-window reset, scroll position, `isStreaming` rendering.
3. Stop button and spinner in B/C. Clicking Stop there. Send, reroll, continue and auto mode in B while A generates: what the user sees.
4. A's composer draft and any unsent text in B survive. Eviction cap with many chats.
5. Group chat in the background: member turns after switching. Cold-storage member restore mid-turn.
6. Delete or archive the generating chat or character from another chat. The delete should abort; archive should refuse.
7. Switching to a cold-stored character during a reply: the restore path at `characters.ts:1428-1472` without the guard.
8. TTS and sound output from a hidden reply. Android keep-alive notification content.
9. Suggestions on completion in a different chat.
10. Triggers and Lua with selection fallbacks: `scripts.ts:234-241`, `scriptings.ts:177-182`, `request.ts:265-272` when selection has moved.
11. Errors in a background reply: `throwError` / `alertError` modal appearing over an unrelated chat.
12. Existing tests listed in §4 that assert refusal.
13. Mobile shell: character list and header navigation while generating.

## Open decisions (not decided here)

- Whether Stop is allowed from another chat, and where. It could be a per-chat badge or a global control.
- How the "reply running elsewhere" state is shown in the composer, and whether send is disabled or queued. DD-039 as given says no new send; queueing is not specified.
- The finished-in-background indicator (unread badge, toast, none).
- TTS and sound for a hidden reply: speak, mute, or defer until the chat is opened.
- Error display for a hidden reply.
- Whether auto mode should continue across a switch. Today it ends after the tick in flight.

## Not checked

- Not run: nothing was executed, so the claims in §1-§4 are static source reading only.
- Not traced: `request.ts` call paths from `sendChat` to confirm `arg.subject` is always set (`request.ts:247`); the composer draft eviction cap; Android keep-alive notification text; `Chats.svelte` re-attachment behavior; plugin hooks (`pluginV2`, `v3.svelte.ts:1537`).
