# Slice 3 research: how group chats work today

Source-reading only. Nothing was built or run. Paths are relative to `C:\Projects\Risutanium-UI-Rework\src`. OBSERVED = read at the cited line. INFERRED = reasoned from read code, not run. UNVERIFIED = not confirmed. No proposals appear in sections 1-9; design-relevant leftovers are only in "Open questions".

Builds on `layout-perf-navigation.md` §6 and `slice2-background-generation.md`; those facts are not repeated except where re-checked.

## 0. Data model (OBSERVED)

| Fact | Source |
|---|---|
| A group is a `groupChat` in `DBState.db.characters` with `type:'group'`, its own `chats`, `chaId`, `name`, `image`, `firstMessage`, `characters` (member `chaId`s), `characterTalks:number[]`, `characterActive:boolean[]`, `orderByOrder?`, `viewScreen: 'single'\|'multiple'\|'none'\|'emp'`, `globalLore`, `customscript`, `emotionImages`, `ttsMode?`, `autoMode`, `useCharacterLore`, `oneAtTime?` | `ts/storage/database.svelte.ts:1562-1594` |
| Each message may carry `saying` (speaker `chaId`) | `ts/storage/database.svelte.ts:1907` |
| `autoMode`, `useCharacterLore` and `oneAtTime` are never read as behavior anywhere outside type/default (grep over non-test `src`: only the type and the `createNewGroup` defaults) | `ts/characters.ts:48-49`; absent elsewhere |
| Member lookup is by `chaId` among non-group characters; a missing id yields a blank character named `'Unknown Character'` | `ts/util.ts:348-360` |
| On load, `characterTalks`/`characterActive` are reset to `4/6` and `true` for ALL members if their length differs from `characters.length` | `ts/characters.ts:724-737` |

## 1. Speaker identity on screen and in the prompt

### 1.1 Where `saying` is and is not used for display

| Surface | Behavior | Source |
|---|---|---|
| Main chat list (all themes) | Does NOT use `saying`. `Chats.svelte` passes the same props to every char message: `name: currentCharacter.name` (the GROUP's name), `img: getCharImage(currentCharacter.image)` (the GROUP's image), `character: createSimpleCharacter(currentCharacter)`, which returns `null` for a group. `saying` is not read in `Chat.svelte` or `Chats.svelte` (grep of `src/lib/ChatScreens`: no `saying`). | `lib/ChatScreens/Chats.svelte:84-86, 131-139`; `ts/stores.svelte.ts:92-95` |
| default theme | Shows `{name}` (group name) above the text, plus the group icon. | `lib/ChatScreens/Chat.svelte:1582-1585` |
| cardboard theme | `<h2>{name}</h2>` (group name) under the icon. | `Chat.svelte:1528-1537` |
| mobilechat theme | Shows no name at all, only the icon (group icon) and bubble. Same for single characters. | `Chat.svelte:1484-1527` |
| customHTML theme | Renders `DBState.db.guiHTML` through `risuChatParser(html, {cbsConditions})` with no `chara` argument. How `{{char}}`/name resolves here for a group is UNVERIFIED. | `Chat.svelte:1565-1566, 767-776` |
| MobileGUI | A layout flag, not a separate message renderer. `lib/Mobile/*` has no message component; chat messages still come from `Chat.svelte`. | `lib/Mobile/` file list; `CharConfig.svelte:213, 321` use `$MobileGUI` |
| Message edit | Edits `message.data` only. `saying` has no editor. | `Chat.svelte` has no `saying` reference |
| Copy / copy-as-card | Use the prop `name` (group name). | `Chat.svelte:688-705, 867` |
| Per-message "speak" button | Hidden for groups entirely (`speakerButtonShown` requires `type !== 'group'`). | `Chat.svelte:722-724` |
| Message debug/info modal | Shows the raw `saying` chaId under the label "Saying" (not the name). | `lib/Others/AlertComp.svelte:548-549` |
| Bookmarks list | The only UI that resolves `saying` to a person: for groups it finds the speaker by id and renders `Chat` with the speaker's name, image and `largePortrait`. | `lib/Others/BookmarkList.svelte:42-47, 184-196` |
| Export as text | `--<speaker name>\n<data>`, using `saying` when set; the group's own `firstMessage` is not prepended for groups. | `ts/characters.ts:452-463` |
| Export as HTML | Name = speaker via `saying`, else char name/user. | `ts/characters.ts:345` |
| Export as JSON / chat-card variant at line 416 | Same `saying` -> name rule. | `ts/characters.ts:416` |
| Per-message first-message selector (`idx -1`) | Not rendered for groups; the group's `firstMessage` and `alternateGreetings` are never shown. | `lib/ChatScreens/DefaultChatScreen.svelte:890-891` |
| Side emotion/portrait panel | Per `viewScreen`: `multiple` and `emp` list all members, `single` picks the member with the newest emotion entry. Uses each member's own `viewScreen === 'emotion' \| 'imggen'` and images. | `ts/util.ts:399-467`; `lib/ChatScreens/ChatScreen.svelte:56-58` |
| Notifications / Android keep-alive | Generic "generating / working" text. No speaker or chat name. | `ts/android/keepAliveService.ts:78-85` |
| Sidebar chat/character list previews | No last-message preview was found: `ChatList.svelte` and `SideChatList.svelte` contain no `saying`/last-message reads; grid catalog and rail only show a `Users` icon for groups when there is no image. | `lib/Others/GridCatalog.svelte:843-849`; grep results |
| TTS | Voice is the member's (`currentChar.ttsMode`), spoken after the reply. No on-screen indicator of who speaks. | `ts/process/index.svelte.ts:2472-2488` |

### 1.2 Macros: `{{char}}` and relatives

| Context | Resolves to | Source |
|---|---|---|
| Building a member's prompt | The MEMBER (`chara: currentChar` where `currentChar = member`). Used for main prompt, jailbreak, global note, description, personality, scenario, author note, lorebook entries, persona prompt, and each chat message body. | `ts/process/index.svelte.ts:768, 871-1005, 1361` |
| `risuChatParser` given a group object as `chara` (any caller that passes the group) | The speaker of the chat's LAST message (by `saying`); if the chat is empty, the literal `'bot'`; if the last message has no/unknown `saying`, `chara` stays null (INFERRED). | `ts/parser/parser.svelte.ts:1625-1641` |
| Display of a message in the chat | `Chat.svelte` passes `chara: name`, a string, i.e. the GROUP's name, for every message including a member's reply. | `Chat.svelte:615, 619, 651` |
| Display scripts and asset parsing | `ParseMarkdown(.., character = null)` for groups: `if(char)` blocks are skipped, so `editdisplay` regex/custom scripts and additional-asset substitution do not run in the on-screen render of a group chat. The `display` trigger is also skipped for groups. | `Chat.svelte:497-499`; `ts/parser/parser.svelte.ts:764-779`; `ts/process/scripts.ts:234-237` |
| Command `/speak`, `/trigger` | Groups: `/speak` no-op ("NOT IMPLEMENTED"), `/trigger` returns without running. | `ts/process/command.ts:174-183, 330-333` |

### 1.3 What the model sees as the speaker

| Fact | Source |
|---|---|
| Each prior char message is named by `saying` (member name), else `currentChar.name`. The name is computed (`name`) for the token counter. | `index.svelte.ts:1364-1372` |
| In a group, a message is wrapped in `DBState.db.groupTemplate` (default `<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>`, with `{{char}}` = the message's speaker) and its role set to `groupOtherBotRole` (default `'user'`) when the speaker is not the current member, OR when `groupOtherBotRole === 'assistant'`. Result: the current member's own earlier lines are plain `assistant`; other members' lines appear as role `user` wrapped with the speaker name. | `index.svelte.ts:1439-1456`; `ts/storage/database.svelte.ts:579` (default `'user'`) |
| Source read suggests the same condition also catches USER messages in a group (`msg.saying` is undefined for them, so the lookup returns "Unknown Character" with a different `chaId`). Whether user turns really get wrapped as `<Unknown Character's Message>` was not run or confirmed. | `index.svelte.ts:1439-1445` (INFERRED, flag as UNVERIFIED) |
| A system line is appended at the end of the prompt: `[Write the next reply only as <member name>]`. | `index.svelte.ts:927-933` |
| `groupOtherBotRole` and `groupTemplate` are global (stored with bot presets), edited in Prompt Settings, not per group. | `lib/Setting/Pages/PromptSettings.svelte:282-297`; `database.svelte.ts:2150-2151, 2287-2288` |
| Lorebook scan labels char messages by `msg.name ?? saying-name ?? char.name`. | `ts/process/lorebook.svelte.ts:197` |
| Embedding "additional info" lookup labels with raw `saying` id (not name). | `ts/process/embedding/addinfo.ts:24` |
| Supa memory summary text drops the name for groups (`''`). | `ts/process/memory/supaMemory.ts:352, 361` |

## 2. One send in a group

| Question | Observation | Source |
|---|---|---|
| Messages produced | Zero to N, one per speaker chosen for the round, each its own message with `saying = member chaId`, own `chatId`/`generationId`, own `generationInfo`. | `index.svelte.ts:2111-2120, 2418-2426` |
| Sequence | Sequential, not parallel. `sendChatBody` loops `order[]` and `await`s `sendChatRecursion` per member. The next member's prompt is built after the previous reply is written, so it sees it. | `index.svelte.ts:734-756` |
| Streaming | Each member streams into its own freshly pushed empty message (`interrupted:true` until the stream ends). There is a single global `isStreaming` flag on the chat; it is set per stream and cleared when each stream ends. | `index.svelte.ts:2108-2135, 2293-2303` |
| What is shown between speakers | Nothing group-specific. The previous reply finishes (output triggers, inlay, TTS awaited, optional auto-continue) before the next begins. The busy button's `loadmove` indicator reflects `chatProcessStage` (stage 0-4) and is the only per-turn progress element; nothing names who is about to speak. INFERRED from loop structure: the pause between speakers equals the full processing of the earlier one. | `index.svelte.ts:2469-2530`; `DefaultChatScreen.svelte:665-672` |
| TTS timing | `sayTTS` is awaited inside the member's turn, so (INFERRED) the next member's request starts after speech playback synthesis/play returns. Not traced to playback end. | `index.svelte.ts:2485` |
| Stop mid-turn | Stop (busy button) calls `abortChat`, which aborts the unit's controller; `sendChatBody` checks `abortSignal.aborted` before each member and the member returns false, so all remaining speakers are dropped, not only the current one. It also clears `autoModeRunning`. A partially streamed reply stays in the chat. | `composerActions.svelte.ts:609-634`; `index.svelte.ts:734-737, 749-751, 2309-2311` |
| Error for one speaker | A member call that returns false makes the whole loop `return false`, so later speakers do not run. With `inlayErrorResponse` on, the error is appended to that member's reply as a ```` ```risuerror ```` block, or posted as a new message with `saying = currentChar.chaId` (the member, if known). Otherwise an alert modal. A member that is gone, absent from the group list, or a duplicate id returns true and is skipped silently (the next member still runs). | `index.svelte.ts:540-595, 614-656, 749-751` |
| Not-found member in the `else` branch | `throwError(characterNotFound)` and returns false. | `index.svelte.ts:762-767` |
| Preview (dry-run) | Walks the same order and stops at the first member that writes a body. | `index.svelte.ts:727-760` |

## 3. Regenerate, alternatives, continue

| Question | Observation | Source |
|---|---|---|
| What reroll does to the chat | `rerollBase` walks back from the end and stops at the last user message, or at the nearest earlier message with the same speaker as the last message. The chat is cut to that point (so ALL later messages, including other members' replies, are removed as one "piece") and a fresh group round is generated. Rerolling therefore replaces the whole trailing round, not one speaker's line. | `ts/process/rerollHistory.ts:119-146, 216-252`; `composerActions.svelte.ts:442-494` |
| Which member re-speaks | Whoever the new round chooses (same ordering logic as a send, section 4/5), computed against the new last message. The speaker CAN change; other members can appear; the count can change. | `index.svelte.ts:704-760` |
| Alternatives | Two mechanisms, tried in order: (a) provider-returned candidates, keyed by `generationInfo.generationId` of the LAST message only; (b) the per-chat reroll history of whole trailing pieces (max 5 chats, module memory only, never saved). Pieces are deep copies, so each piece keeps its messages' `saying`. | `composerActions.svelte.ts:423-440, 472-477`; `rerollHistory.ts:18-27, 161-205` |
| Un-reroll | Steps back through (a) then (b). Same screen action as forward. | `composerActions.svelte.ts:496-525` |
| Reroll with nothing to anchor | If the walk reaches the start of the chat without a stop (for example only two greeting messages from two members), `beginRegeneration` returns null and the action does nothing, silently. | `rerollHistory.ts:126-146, 216-223` |
| Continue (menu "Continue response") | Menu item is dimmed/no-op unless the chat has 2+ messages and the last is a char message. In `sendChatBody`'s group branch, the member calls are built WITHOUT the `continue` flag (`sendChatRecursion` arg list lacks it). So, by source reading, Continue in a group does not extend the last reply; it runs a normal group round with no new user message (and any text typed in the composer is first pushed as a user message). Per-member auto-continue (`autoContinueChat`/`autoContinueMinTokens`) does work inside each member turn because it recurses with the member origin. | `DefaultChatScreen.svelte:975-986`; `composerActions.svelte.ts:338-387`; `index.svelte.ts:738-748, 2505-2520` (INFERRED, not run) |
| "Say nothing" empty-send filler | Disabled for groups. | `composerActions.svelte.ts:322` |

## 4. Auto mode

| Question | Observation | Source |
|---|---|---|
| Entry | Composer menu item "Auto Mode" (dice icon), rendered only for `type === 'group'`. | `DefaultChatScreen.svelte:957-962` |
| Loop | `runAutoMode`: if already running, a second invocation just turns it off. Otherwise requires `!doingChat` and a closed composer window; captures origin; sets `autoModeRunning = true`, opens the composer window; loops `while(autoModeRunning)`: stop if `doingChat` or the chat shown is no longer the origin; `await sendChatMain(target)` (a full group round with NO user message, `chatProcessIndex -1`); stop if it did not complete or the chat is no longer shown; count quiet ticks; stop at the cap; `await yieldToEventLoop()`; repeat. | `composerActions.svelte.ts:661-722` |
| `MAX_QUIET_TICKS = 50` | Auto mode stops after 50 CONSECUTIVE ticks in which no member reached its generation setup. | `composerActions.svelte.ts:24-30, 696-704` |
| Quiet tick | A tick where `turnsReachedCount()` did not change: `noteTurnReached()` is called only after a member has passed the group dispatch and member checks. Causes: random order picked nobody after the last-speaker filter (the order guarantees at least one pick before the filter, but the filter removes the last speaker, so a group whose only eligible member just spoke gives an empty order); all members inactive or talkness 0; members skipped as gone/duplicate/not in group. The source comment cites about 83% quiet per tick in the "worst setting". | `index.svelte.ts:705-726, 774`; `generationOwnership.svelte.ts:48-60`; `composerActions.svelte.ts:24-29` |
| Stops by | (1) Stop/busy button (`abortChat` clears the flag). (2) Menu "Auto Mode" again. (3) Switching to another chat or character (checked after the tick in flight; the in-flight tick finishes). (4) Deleting the chat (registration stop). (5) A tick that returns false (abort, member error, origin gone). (6) 50 quiet ticks. (7) `finally` always resets the flag, even on throw. | `composerActions.svelte.ts:609-634, 693-704, 713-721, 680` |
| Can the user type | The textarea is not disabled by auto mode, but Send is replaced by the busy/cancel button while the composer window is open, and `sendMain` returns when `doingChat` or the window is open. So the user can type but cannot send until they stop the loop. | `DefaultChatScreen.svelte:665-681`; `composerActions.svelte.ts:203-208` |
| UI surfaces that show it is running | Only one: the busy button's `loadmove` element gets class `autoload` (`isAutoModeActive()`). The same busy button appears for any generation, and `autoload` is just a class on it; no label, no toast, no sidebar indicator. The menu item text is the same "Auto Mode" whether running or not. | `DefaultChatScreen.svelte:665-672, 957-962` |
| Persisted state | `groupChat.autoMode` exists in the data model and is initialized false, but is not read; running state is module memory only. | `database.svelte.ts:1575`; `characters.ts:48`; `composerActions.svelte.ts:50` |
| Reroll / unreroll / send / continue during auto mode | All refuse while the window is open (silent return). | `composerActions.svelte.ts:446-452, 500-505, 203-208` |

## 5. Members

### 5.1 Talkness, active, ordering

| Fact | Source |
|---|---|
| UI: six clickable bars per member set `characterTalks[i] = barIndex/6` (1/6 ... 1.0). Default for a newly added member is 4/6 (about 0.667). A separate checkbox sets `characterActive[i]`. No zero-talk bar: clicking cannot set 0; the only ways to silence are untick Active or edit data. | `lib/SideBars/CharConfig.svelte:262-300`; `process/group.ts:50-51` |
| Talkness is used as a per-round probability. Members with `characterActive` false get talkness `-1`; members with talkness `<= 0` are filtered out before ordering. | `index.svelte.ts:710-718` |
| Random mode (default, `orderByOrder` false): (1) mention pass: split the last message (user's or the last member's) on spaces/newlines, lowercase, and for each word find the first member whose lowercased name-words contain it; push that member (no talkness roll). The pass does not dedupe, so a name mentioned twice can add that member twice (INFERRED). (2) every other member in shuffled order speaks with probability `talkness >= Math.random()`. (3) if the order is still empty, one random member. (4) then the member who spoke the last message is removed from the order. Matching is whole-word only, so punctuation attached to a name defeats it. | `process/group.ts:74-127`; `index.svelte.ts:719-726` |
| `orderByOrder` (labelled "Talk by Order"): skip `groupOrder` and the last-speaker filter; every active member with talkness above 0 speaks each round in member-list order. | `index.svelte.ts:719-726` |
| The `orderByOrder` toggle lives in two places: the character settings panel (desktop, not MobileGUI) and the chat-list side panel under the toggles. | `CharConfig.svelte:321-328`; `lib/SideBars/SideChatList.svelte:481-486` |
| Group member rows are reordered only by add/remove; no drag UI was found (UNVERIFIED beyond `CharConfig.svelte:257-308`). | `CharConfig.svelte:257-308` |

### 5.2 Add, remove, duplicates

| Fact | Source |
|---|---|
| Add: "+" in the member panel calls `addGroupChar` -> character picker modal (`selectChar`) listing non-group, non-trashed, non-hidden characters as avatar buttons only (no names). Choosing a member already in `characters` shows an error and aborts. | `process/group.ts:10-19`; `lib/Others/AlertComp.svelte:458-482` |
| Member added after a confirm "load first message?": if accepted, the member's `firstMessage` is pushed into the CURRENT chat (`group.chats[chatPage]`) as a char message with `saying`. Then the member is appended with talkness 4/6, active true. An archived member is restored first; if its unit cannot be restored the member is still added, with no greeting offered, and the user is told its name. | `process/group.ts:20-52` |
| Remove: clicking a member's avatar in the member list calls `rmCharFromGroup(i)`; splices the three arrays; no confirmation. Past messages keep their `saying`. | `CharConfig.svelte:264-281`; `process/group.ts:58-66` |
| Same character twice: blocked by `addGroupChar`. A same-`chaId` twin held by two character objects makes that member "ambiguous" and it is skipped. A duplicate id inside `group.characters` through data edit/import is not guarded (UNVERIFIED). | `process/group.ts:16-18`; `index.svelte.ts:628-656` |
| Delete/trash a member: `removeChar` does not edit any group's `characters` list (no group reference in it). Picker hides trashed characters. In a turn, a permanently removed, unrestorable member is skipped silently; its old messages show "Unknown Character" in exports/bookmarks. A TRASHED member is still found by id (trash is a flag), so whether it still speaks is INFERRED yes. Warning dialog: deleting a member of a busy group shows no extra "busy" warning because work belongs to the group. | `ts/characters.ts:939-1000, 944-945`; `util.ts:357-359` |
| Archived (cold storage) member: opening the group restores all archived members first (`restoreGroupMembers`); failures produce one alert listing names, and the group still opens. New chat creation does not restore members, so an archived member gets no greeting in a new chat. Mid-turn, a gone member that is archived is restored when its turn comes; a failed restore skips that member (alert from the restore helper) and the others continue. | `characters.ts:1344-1401, 1456-1473, 70-93`; `index.svelte.ts:629-652`; `process/coldMemberRestore.ts:27-54` |
| Keep-set: while a group is selected, its members are protected from being put back into cold storage. | `process/memory/keepSet.ts:9-30` |

## 6. Group-specific settings: from the member vs from the group

| Setting | Source of truth in a member's reply | Source |
|---|---|---|
| System prompt (`systemPrompt`), `replaceGlobalNote`, `desc`, `personality`, `scenario`, `utilityBot`, `additionalAssets`, `image` for `{{asset_prompt::icon}}`, `inlayViewScreen` | The MEMBER (`currentChar`). | `index.svelte.ts:817, 849-877, 905-919, 1009, 1469-1484` |
| Author note (per-chat note) | The group's chat (`currentChat.note`), parsed with the member as `{{char}}`. | `index.svelte.ts:884-895`; `CharConfig.svelte:311-319` |
| Lorebook | The GROUP's `globalLore` + the chat's `localLore` + modules. Members' own lorebooks are not loaded (`useCharacterLore` is unused). Lore settings come from the group's `loreSettings`. | `lorebook.svelte.ts:136-153`; `characters.ts:49` |
| Custom scripts / regex / trigger scripts | Prompt-side scripts run via `processScriptFull(nowChatroom ...)` (the GROUP). Groups use `getModuleTriggers` only (no own triggers). On-screen display scripts do not run for groups (section 1.2). Output trigger on a member reply runs on `currentChar` (MEMBER). | `index.svelte.ts:1361, 2328`; `process/scriptings.ts:1589, 1625`; `Chat.svelte:497-499` |
| Persona binding | Per chat, not per character; applies to the group chat. | `DefaultChatScreen.svelte:371-390` |
| Toggles (custom prompt toggles) | Global DB toggle values; the panel is shown for groups. | `CharConfig.svelte:322`; `SideChatList.svelte:477-479` |
| Memory (Hypa/Supa), `lowLevelAccess` | Group-level fields exist and the Advanced tab is shown. | `CharConfig.svelte:1054-1284` |
| TTS (auto speech and voice) | MEMBER's `ttsMode`; group's own TTS tab is hidden. Menu "Stop TTS" appears when any member has a voice mode. | `index.svelte.ts:2472-2488`; `process/ttsModes.ts:17-26`; `DefaultChatScreen.svelte:965-973` |
| Emotion/expression images and `viewScreen` | Group `viewScreen` chooses layout (`none/single/multiple/emp`); the images shown are each member's own `viewScreen`/`emotionImages`. Group `emotionImages` field exists but its Display tab only exposes the group's mode and icon. | `CharConfig.svelte:466-487`; `ts/util.ts:399-467` |
| Group icon | Own `image` (set manually, or composited from member images). Used for every message avatar. | `CharConfig.svelte:359-368, 459-463`; `characters.ts:835-900` |
| Sticker (`useChatSticker`) button | Hidden for groups. | `DefaultChatScreen.svelte:580` |
| Bias, convert-to-module, etc. | Hidden/no-op for groups. | `CharConfig.svelte:1058, 1262-1266` |

CharConfig tabs, by `$CharConfigSubMenu`: 0 basic (name, member grid, author note, toggles, order toggle), 1 display, 3 lorebook, 2 advanced are shown for groups. 5 (TTS, speaker icon), 4 (scripts/regex, braces icon) and 6 (share) are hidden for groups; an effect forces menus 4 and 5 back to 0. The group basic tab has no description or first-message editor; the group's `firstMessage` is editable nowhere and never shown. `CharConfig.svelte:213-241, 169-174, 244-255`.

## 7. Creating a group

| Item | Observation | Source |
|---|---|---|
| Entry points | One flow: "add character" (rail "+" and mobile character list "+") opens `alertAddCharacter`, a modal with choices Import from Realm, Import character, Create from scratch, **Create Group Chat**, Cancel. Selecting it calls `createNewGroup()`. | `characters.ts:1310-1342`; `lib/Others/AlertComp.svelte:698-727`; callers `lib/SideBars/SidebarRail.svelte:1256`, `lib/Mobile/MobileCharacters.svelte:165` |
| Fields at creation | None. No dialog for name or members. The group is pushed with: `name: ""`, `firstMessage: ""`, one chat named "Chat 1" with `message: []`, `viewScreen:'none'`, empty `characters`, `characterTalks`, `characterActive`, `useCharacterLore:true`, `autoMode:false`. Then `changeChar` selects it and the mobile stack is set to 1. | `characters.ts:31-60, 1337-1341` |
| After creation | User must open the character settings panel, set a name (placeholder "group name"), add members one at a time via avatar-only picker, and optionally generate a group icon. Until members exist, the group panel shows "no character". | `CharConfig.svelte:254-308` |
| Group first message | There is none in the sense of a group greeting. Greetings come from members: (a) adding a member can push that member's `firstMessage` into the current chat after a confirm; (b) every "New Chat" in a group seeds the chat with one char message per non-archived member (in member order, `saying` set, member `firstMessage` only; members' alternate greetings are not used), with no confirm. A brand new group's first chat is empty. | `process/group.ts:20-47`; `characters.ts:70-93`; `DefaultChatScreen.svelte:890-891` |
| Prompt effect of greetings | They are ordinary chat messages in a group (first-message special-casing is off for groups). | `index.svelte.ts:512-514` |

## 8. Hotkeys, menus, composer items, SideChatList check

| Item | Observation | Source |
|---|---|---|
| Hotkeys | `ts/hotkey.ts` has no group-specific logic (no `group` match). | grep `hotkey.ts` |
| Composer menu | "Auto Mode" (groups only), "Stop TTS" (when any member has voice), "Continue response", chat list, etc. The sticker button is hidden for groups. | `DefaultChatScreen.svelte:953-986, 580` |
| `SideChatList` "order by order" check | In the chat-list side panel, below the toggles, a `CheckInput` "Talk by Order" bound with a function binding to `chara.orderByOrder ?? false`. The comment says binding a missing flag directly would write `false` into the group on mount. Shown only when `chara.type === 'group'`. It duplicates the toggle in CharConfig basic tab (which is not shown under MobileGUI). | `lib/SideBars/SideChatList.svelte:477-486`; `CharConfig.svelte:321-328` |
| Chat commands | `/speak` and `/trigger` are no-ops in groups; `/send` pushes a user message. | `ts/process/command.ts:174-192, 330-333` |
| Module apply | Applying a module to a group returns immediately. | `ts/process/modules.ts:854-856` |

## 9. Group chats and slice 2 background generation

| Item | Observation | Source |
|---|---|---|
| Switching away mid-round | Group turns and `runAutoMode` pass an explicit `origin`; each member call carries `origin.memberChaId` and re-resolves by id. So a plain Send round keeps running to its end after a chat switch (once the `changeChar` guard is lifted, as slice 2 proposes). Auto mode does not: it checks after each tick that the origin is still the chat on screen and ends (the tick in flight finishes). | `index.svelte.ts:738-748`; `composerActions.svelte.ts:693, 698` |
| Cold member restore mid-turn | Already built into the turn: if the member is `gone` and its holder is in cold storage, the turn awaits `restoreColdCharacterByChaId`, re-resolves, and proceeds or skips; a failure alerts by name through `alertError` (a modal that would appear over whatever chat is shown). It runs as part of the same unit, with the `doingChat` flag held. | `index.svelte.ts:628-656`; `coldMemberRestore.ts` |
| Keep-set | Members of the SELECTED group and the previous selection are protected from archiving; whether a group generating in the background keeps its members protected after the user selects another character depends on `isWriting` registration (slice 2 §2) and `characterPutBack.ts` (not re-read). UNVERIFIED for member-specific protection. | `memory/keepSet.ts:9-30`; slice 2 research §2 |
| Save marks | `settleSendChatCall` marks the group AND the member for save after each call. | `index.svelte.ts:283-287` |
| Delete during a round | Work registered for the group is stopped when the group is removed; deleting a member does not stop the round and no extra warning appears. | `characters.ts:944-945, 986-989` |
| Streaming/interrupted markers | `addActiveStream` records `memberChaId`; the `interrupted` flag on a reply is hidden while its stream is active. | `process/activeStreams.ts:14-35`; `Chats.svelte:116` |
| Android keep-alive notification | Generic text; no per-speaker progress. | `keepAliveService.ts:78-85` |

## Open questions for design

1. Should a message in a group show the speaking member (name, avatar)? Today every message shows the group's name and icon, and mobilechat shows no name. This is the largest gap; the data (`saying`) already exists.
2. How should `largePortrait`, theme layouts (cardboard h2, mobilechat), and `customHTML` templates treat a per-message speaker? `customHTML` behavior for groups is not verified.
3. Display regex/scripts and additional-asset parsing do not run for group messages today. Is that intended, or should they run with the speaker as the character?
4. Does Continue in a group currently mean "another round" by design? Source suggests the `continue` flag is dropped for member calls. Confirm in a running build before the design treats it as "extend this line".
5. Which control does the user expect for reroll in a group: replace the whole last round (today) or just one speaker's line? Today a reroll can change which members speak.
6. Should Stop mean "stop current speaker" or "stop the round"? Today it stops everything remaining.
7. What should show that auto mode is running, and its stop reason after 50 quiet ticks (there is no feedback today)?
8. Group first message: UI never shows the group's own `firstMessage`/alternates. Is the seeded per-member greeting on New Chat (no confirm) meant to remain, and what about members' alternate greetings?
9. User messages in a group prompt: confirm at runtime whether user turns are wrapped as `<Unknown Character's Message>` (source read at `index.svelte.ts:1439-1445`). Affects whether the speaker name UX can assume a clean `groupTemplate`.
10. Deleted/trashed members: groups keep dangling ids and show "Unknown Character". Should the member list mark them?
11. Where should talkness be edited (six bars today; 0 not reachable), and should mention-by-name be explained in the UI?
12. Order is not editable beyond add/remove (no drag UI found). Is member ordering a requirement for "Talk by Order"?
13. In background generation, who is announced as speaking, and how are cold-restore failure alerts surfaced when the user is elsewhere?

## Search limits

- Source reading only; no running build, no screenshots, no tests executed. INFERRED and UNVERIFIED tags above are not runtime-confirmed.
- Grep-based sweeps for `saying`, `group`, `orderByOrder`, `characterTalks/Active` covered non-test `src`; test files were used only to confirm field usage, not behavior. Test expectations were not read to confirm the Continue-in-group or user-message-wrapping readings.
- Not opened: `lib/Mobile/MobileCharacters.svelte` beyond the `addCharacter` call site, `SidebarRail.svelte` beyond its call, `ChatList.svelte` internals, `chatOrigin.ts` beyond member resolution, `characterPutBack.ts`, the TTS playback end-of-speech chain, the `customHTML` GUI template defaults, and `saveOnHide`. Group import/export (`characterCards.ts`) and `risuaccess` MCP group handling were not traced.
- Nothing under `Agents/Evidences of Investigations/` or secret files was read.
