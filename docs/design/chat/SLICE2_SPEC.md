# Chat slice 2 — switching chats and the "This chat" sheet

Status: **revision 3** (adds re-review fixes N1 to N6) - was **revision 2** (2026-10-25; applies [the independent review](../reviews/2026-10-25-chat-slice2-review.md) and DD-041 to DD-048; changes are tagged with their DD number or review id). Task: [tasks/2026-10-25-chat-conversation.md](../tasks/2026-10-25-chat-conversation.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) (header, sidebar gesture, sheets, motion tokens, undo row, KO register) and [PLATFORMS.md](../PLATFORMS.md). Decisions: DD-038 (sidebar with chats + characters), DD-039 (keep generating in background), DD-040 (Back goes Home), DD-041 to DD-048 (revision 2: pinned strip row, chat name in the header, scope tags, row menu on touch, toggle copy/undo, undo on switch, Alt+arrows, Esc leaves the message box) in [DECISIONS.md](../DECISIONS.md). Source facts: [research/layout-perf-navigation.md](research/layout-perf-navigation.md) §4–5 and [research/slice2-background-generation.md](research/slice2-background-generation.md).

Scope: the in-chat sidebar's content, switching between chats and characters, background generation while switched away, the "This chat" sheet behind the header's `⋮`, and Back. Out of scope: group speaker identity (slice 3), list virtualization beyond the sidebar list (slice 4), the character editor (Studio), Home (designed in MAIN_MENU.md).

Marked **(design default)** = chosen here within the decided intent, open to the maintainer's veto.

## 0. Today (source-checked)

| Area | Today | Source |
|---|---|---|
| Switching chats | Sidebar tab "Chat" (`SideChatList`): "New chat", folders, chats by **name only** (no date, count or preview), per-row icon cluster, footer icons, then `Toggles`. No search. Panel 24 rem wide, no phone cap. A composer-menu "Chat list" modal exists behind `showMenuChatList`. | `SideChatList.svelte:119-486`, `Sidebar.svelte:199-297`, `ChatList.svelte:15-77` |
| Switching characters | Avatar rail (`SidebarRail`, virtualized, remembered scroll) and a catalog with search. | `SidebarRail.svelte`, `GridCatalog.svelte` |
| During a reply | `changeChar` is a no-op while `doingChat` (three checks); nothing tells the user. `changeChatTo` (chats within a character) has no guard, so that switch already works mid-reply. The engine captures the reply's chat identity once and writes by it, never by the on-screen chat. | `ts/characters.ts:1417, 1445, 1460`, `globalApi.svelte.ts:4273`, `process/index.svelte.ts:224-274`, `chatOrigin.ts:213` |
| Per chat state | Draft (text + attachments) kept per chat, keyed by character + chat; scroll position **not** kept (window resets to the newest 30 and scrolls to the bottom). | `DefaultChatScreen.svelte:83, 179`, `Chats.svelte:224-236` |
| Cold storage | Characters and chats may be cold-stored and restored on open; failures raise an alert. | `ts/characters.ts:1478-1491`, `process/coldstorage.svelte.ts` |
| Chat-level settings | Spread over: CharConfig basic tab (note, toggles), `Toggles` under the chat list, composer menu (Modules, Chat list, memory), sidebar footer (bookmarks, branches). | layout note §5 |
| Setting scopes | Chat `note`, `modules`, `bindedPersona`, `localLore`, `bookmarks` are per chat. Toggles are stored **globally** (`db.globalChatVariables`) unless the chat has `useLocallySetGlobalVariables`. Memory (`supaMemory`) is per character. The jailbreak toggle is global. | `database.svelte.ts:1871-1895`, `parser/chatVar.svelte.ts:115-126`, `Toggles.svelte:181-194` |

The scope column matters: today a toggle in the chat list silently changes every chat. The sheet in §3 labels each setting with its scope.

## 1. Sidebar content (DD-038)

The sidebar of slice 1 §4 (overlay on the narrow layout, docked on the wide layout, follows the finger) gets this content:

```
┌──────────────────────────────┐
│ [🔍 캐릭터나 채팅 검색      ] │  search, Ctrl+K
│ (◉)(◉)(◉)(◉)(◉) [⊞]         │  recent characters, "All characters"
├──────────────────────────────┤
│ 세라핀              [+ 새 채팅]│  current character
│ 정렬: 최근 ▾                 │
│ ● 항구의 밤          3분 전   │  current chat (aria-current)
│   "늦었네요. 오늘은…"   214   │
│ ◌ 등대지기            어제    │  ◌ = generating in background
│   답변을 쓰는 중…        88   │
│ ✎ 첫 항해            10월 3일 │  ✎ = has an unsent draft
│ ▸ 📁 완결 (4)                 │  folder, collapsed
├──────────────────────────────┤
│ [⌂ 홈]                [⚙ 설정]│
└──────────────────────────────┘
```

- **Folders come before unfiled chats** (S5; collapsed folder header rows first, so 1,000 unfiled chats never push a folder far down). **Search** (top, always visible; Enter opens the first visible result, which may be a character, S3; when results exceed the per-group cap the live region says "검색 결과 {n}개 중 {shown}개 표시", S2; the input has no `aria-expanded`, the windowed rows carry `aria-setsize` / `aria-posinset`, S4): one field, results grouped as **캐릭터** (name match), **이 캐릭터의 채팅** (chat name and the last line), **다른 캐릭터의 채팅** (chat name only). Message bodies are not searched (cold storage and 1,000+ chat libraries make it costly; full-text search is a later feature). Results update after 150 ms of no typing; the count is a polite live region. Esc clears the field, a second Esc closes the sidebar. Hangul matches by syllable and by initial consonants (초성: "ㅎㄱ" finds 항구) (design default).
- **Recent characters strip** (S6: four on the 280 px docked column so nothing clips, five on the narrow overlay): the most recently opened characters as 44 dp avatars with names on hover/focus (tooltips) and in their accessible names, the current one ringed in `--nexus-warm`; the last item "모든 캐릭터" (`layout-grid`) goes to the Home library. On the wide layout the strip shows names under the avatars. Characters with a background reply show the ◌ badge.
- **Current character section:** name, "새 채팅" (`plus`; its menu also offers "채팅 가져오기"), a sort control **최근 / 내 순서** remembered per device (default 최근; "내 순서" is today's manual order) (design default), folders (collapsible, coloured, with counts), then chat rows.
- **Chat row** (two lines, 56 dp; one tap target):
  - Line 1: status mark, chat name (ellipsis), relative time of the last message ("3분 전", "어제", "10월 3일").
  - Line 2: the last message's first line as plain text (markup, CSS and hidden blocks stripped, as slice 1 §6 does for streaming), message count at the right.
  - Status marks, one at a time by priority: generating (◌, `loader-circle`, static in low power) › finished in background, not yet seen (accent dot, "새 답변") › failed in background (`circle-alert`) › draft (`pencil`). Each has an accessible name ("답변 생성 중", "새 답변 있음", "답변 실패", "임시 저장 있음").
  - The current chat has `aria-current="page"` and an accent left rule.
- **Touch row menu look (N6):** the touch `⋯` is an icon only (transparent, no tile), 44 dp hit area and focus ring kept.
- **Row actions:** right-click, long-press (500 ms with the slice 1 ring), Shift+F10 / Menu key, or the `⋯` button (DD-044: always visible on touch as a 44 dp button, on hover/focus with a mouse; every row has it, long-press stays) open: 이름 바꾸기, 폴더로 이동, 복제, 내보내기, 삭제. Rename is inline in the row (Enter saves, Esc cancels).
- **Delete a chat:** always confirms, naming the chat and its message count ("“항구의 밤” 채팅과 메시지 214개를 삭제할까요?"), Cancel focused first (design default; a whole chat is heavier than one message, so no undo row here). Deleting the open chat lands on the next most recent chat, or a new empty chat when it was the last. A chat generating in background shows "중지하고 삭제" (as slice 1 DD-022).
- **Reorder** (only in "내 순서"): an "순서 편집" mode with drag handles (touch and mouse) and "위로 / 아래로" buttons (keyboard); long-press keeps opening the row menu, so it never starts a drag. Folders reorder the same way.
- **Footer:** 홈 (`house`) and 설정 (`settings`). Bookmarks and branches move to the "This chat" sheet (§3); export-all and import go to the "새 채팅" menu.
- **Keyboard:** Ctrl+K (⌘K) opens the sidebar with the search focused, on any layout. ↑/↓ move through results or rows (roving), Enter opens, → / ← expand or collapse a folder, Home/End. **Alt+↑/↓ (DD-047)** switch to the previous/next chat in the list (replacing Ctrl+Shift+↑/↓, which collided with text selection); the shortcut and Ctrl+K do nothing while a sheet, menu or modal is open or a text field has focus (K1) without opening the sidebar (design default).
- **Long lists:** rows render in a windowed list (slice 4 owns the general virtualization; the sidebar list keeps at most ~40 rows mounted and recycles), so a character with 1,000 chats opens as fast as one with 10.

## 2. Switching

### 2.1 What a switch does

- Tap a row (or Enter) → the chat opens at once; on the narrow layout the overlay sidebar closes as it starts.
- **Where the user is (DD-042, A1):** the header shows the character name with the **chat name as a second line** (ellipsis), `document.title` starts with the chat name, and a polite live region says "{chat} 채팅을 열었어요". After a keyboard switch focus lands on the transcript (never on the sidebar toggle or `body`); on the docked wide list focus stays in the list while the user navigates it.
- **Pending undo (DD-046, B11):** switching chats commits a pending single-message undo (the deletion becomes final); the deleted message stays deleted when the user comes back (B12).
- **Draft:** kept per chat (as today), text and attachments. "Hide names and avatars" is also per chat (C5, as slice 1 C-6).
- **Scroll position:** kept per chat (new). The app remembers the top visible message id and its offset; returning restores it. Exceptions: if a reply finished in background since the last visit, the chat opens at the start of that new reply; a chat never opened before opens at the bottom.
- **Transition:** the transcript crossfades (`--chat-dur-fast`, old out, new in); the header name and avatar change without motion. Reduced motion and low power: instant.
- **Loading:** a chat or character that has to be restored from cold storage shows the header at once and a transcript skeleton with "채팅 불러오는 중…" after 300 ms (no flash for fast loads). A failure stays in the new chat's frame with "채팅을 불러오지 못했어요" and "다시 시도" / "이전 채팅으로" — never a blocking alert.
- **Switching character** from the strip or search opens that character's last chat (today's `chatPage`), with the same rules.

### 2.2 Background generation (DD-039)

Switching never waits for a reply. **Feasible** per [research/slice2-background-generation.md](research/slice2-background-generation.md) (source reading, nothing run): the engine already targets the reply's own chat; the work is removing the `changeChar` guard and scoping the UI that reads the global `doingChat`. The rules below are that minimal version.

- **One reply at a time, app-wide** (as today's single `doingChat`). While chat A generates and the user is in chat B:
  - A **generation strip** is its own **44 dp row pinned under the 48 dp header row (DD-041)**: two rows inside the 44 dp (N2): row 1 the chat name (bold; cut only when the name itself is too long, about 230 dp of width at 360), row 2 the status in 12 px on one line - `◌ 항구의 밤` / `답변을 쓰는 중이에요  [👁] [■]` (the character name is added, "세라핀 · 항구의 밤", only when A belongs to another character, B5). The strip does **not** hide with the auto-hiding header (B2), so Stop is always reachable; its buttons sit in their own row and never share a column with the header `⋮` (B1). "보기" is an `eye` icon button named "보기: 항구의 밤" (A6) that switches to A; Stop is a 44 dp round button with a filled `square` (B9, labelled "중지") that stops A's reply. The strip starts exactly where the header ends (N5: top 49 dp, no gap). When the header hides, the strip slides up to the top edge and stays opaque and pressable (N1; under reduced motion it jumps to the top with no transition); the entrance animation never holds its end keyframe over that state. The name keeps its own row (B5, N2); row 2 is one line with an ellipsis as the last resort, and the full text is the tooltip and the accessible name. The strip never covers the transcript (the transcript shrinks by 108 dp) and is a polite live region for start and end only.
  - B's **Send** is disabled with the reason "다른 채팅에서 답변을 쓰는 중이에요" (tooltip and accessible description); typing and drafts still work. New reply, the armed pull and Ctrl+Alt+R in B are disabled with the same reason.
  - A's row shows ◌; when it finishes, the row and A's strip avatar get the "새 답변" dot, and the strip reads `✓ 항구의 밤 — 답변을 다 썼어요 [보기]` for 4 s, then hides; it waits while the pointer or keyboard focus is on it (B10) and never disappears under a focused control (B4: focus moves to the transcript or composer when a strip button disappears, after Stop and after View too). A failure reads `답변을 쓰지 못했어요 [보기]` and stays until dismissed or viewed; failures are kept as notes per chat, so a later reply starting or finishing in another chat does not replace it, and a second failure shows "(+1)" and a count button (B6). A reply that finishes while Home is open marks the chat "새 답변" and is announced (B7). The composer placeholder carries the Send reason while blocked, so touch users see it without a tap (B8).
  - Returning to A opens at the start of the new reply (§2.1); the dot clears once that reply has been on screen for 1 s.
- **Scoped to A, never to the chat on screen:** Stop (today a global abort; it stays reachable from the strip, which names A), the Stop/Send morph and retry state (today read from the global `doingChat`), and reply suggestions (today they fire for whichever chat is shown; they must run for A and show only in A).
- **What does not run in background** (design default): TTS auto-play and sounds (today they play regardless; here they play only for a reply finished on screen), and auto-scroll. Trigger scripts and memory summarisation run against A's data, as the engine already does.
- **Errors in background:** no modal over chat B; the strip's failed state and A's row mark carry it, and the error detail shows when A is opened.
- **Silent refusals become visible:** today Send, New reply and auto mode return silently while another reply runs; each now shows the §2.2 reason.
- **Android:** the generation notification (system-surfaces SPEC) keeps naming A, and its tap opens A (DD-007).
- **Group auto mode** today ends after its current turn when its chat leaves the screen; that stays (design default) and the strip says it twice (B3): while the reply is still writing, row 2 reads "쓰는 중이에요 · 자동 진행은 끝나면 멈춰요" (N2: the short form so it fits one line at 360; the accessible name keeps "답변을 쓰는 중이에요 · …"), and on the finished or failed strip, "… · 자동 진행을 멈췄어요" (when nothing was streaming a persistent "{chat} — 자동 진행을 멈췄어요" strip stays until dismissed). Slice 3 owns its controls.
- **Fallback, kept only in case lane A's tests fail** (research §(c); it would contradict DD-039 for character switches): switching mid-reply shows a small prompt "답변을 쓰는 중이에요" with "중지하고 이동" / "기다리기" (Wait is focused first), and the strip is not built. This keeps today's data safety and still explains the block.

## 3. The "This chat" sheet

Opened by the header's `⋮` (slice 1 placeholder), Ctrl+. (design default), or "이 채팅" in a row menu for the open chat. Narrow layout: a bottom sheet that opens at 92 % height with a sticky title; wide layout: a right-side panel 380 px, modal, same content. Focus trap, Esc / Back / drag-down close, focus returns to `⋮`.

Content, grouped **by scope** (each group header names it):

1. **Title block:** chat name (tap to rename inline), character name and avatar, "메시지 214개 · 마지막 3분 전 · 만든 날 10월 3일".
2. **이 채팅** (this chat only)
   - 페르소나: the bound persona with avatar ("기본 페르소나 사용" when none) → persona picker (same as the composer chip, slice 1 §7.3).
   - 작가 노트 (`note`): a multiline field, autosaves after 600 ms idle with "저장됨"; Esc in it leaves the field, not the sheet.
   - 모듈: the modules enabled for this chat, each with a switch; "모듈 관리" opens the full module list.
   - 채팅 로어북: entry count → opens the lorebook editor (Studio; a placeholder here).
   - 북마크: the chat's bookmarks (name, excerpt); tap jumps to the message and closes the sheet.
   - 분기: "분기 보기" opens the branch viewer (a placeholder here).
   - 읽기: "이름과 아바타 숨기기" (slice 1 C-6).
3. **토글** (from the character's toggle definitions): shown with a scope switch at the top, **"이 채팅에만 적용"** (`useLocallySetGlobalVariables`). Off (today's default): the group header reads "모든 채팅에 적용" and a one-line note says changes affect every chat. On: "이 채팅에만 적용". The toggles themselves render as today's types (check, select, text, caption, divider).
4. **이 캐릭터** (all chats of this character)
   - 메모리 (`supaMemory`) with the active memory type's name; "메모리 보기" opens the memory view.
   - 완성 후 표시 (slice 1 C-5).
   - "캐릭터 설정 열기" → the character editor (Studio).
5. **모든 채팅** (app-wide): the jailbreak toggle, when the prompt has one, with the note "모든 채팅에 적용". Everything else app-wide lives in Settings, linked as "전체 설정".
6. **플러그인:** plugin chat menu items (`additionalChatMenu`) as labelled rows, in plugin order; hidden when none.
7. **관리:** 내보내기, 복제, 삭제 (the §1 confirm).

- **Scope tags (DD-043, C1/C2):** the "이 채팅" group carries no tag (it equals the sheet title). "이 캐릭터" and "모든 채팅" (and "토글" while its switch is off) carry an icon + colour tag (`users` violet, `globe` amber) with the scope text, so colour is never the only cue. The toggle scope switch is labelled **"이 채팅만 따로 설정"**, a phrase that no tag reuses.
- **Toggle scope switch (DD-045, C4):** turning it **on** copies the current shared toggle values into the chat (never a stale earlier copy); turning it **off** discards the chat's own values and shows an inline undo row "이 채팅의 설정값을 지웠어요 · 되돌리기" for 6 s (focus stays on the switch; the row is a polite status).
- Changes apply at once; there is no Save button. Each changed setting shows a short, scope-aware confirmation next to it (polite, C3): "저장됨" for this chat, "이 캐릭터에 저장됨", "모든 채팅에 저장됨".
- A character with no chats has a disabled header `⋮` whose name says why (S7: "이 캐릭터에는 아직 채팅이 없어요").
- The composer `+` sheet (slice 1 §5.4) drops "Modules" and "Chat list" (moved here and to the sidebar); it keeps the actions that act on the conversation (continue, impersonate, image, translate, suggestions, screenshot, plugin panels).

## 4. Back and layers (DD-040)

One Back stack for Android Back, Esc, the mouse back button and the browser Back on the web host; all four behave identically (K0), including the delete confirm opened from "이 채팅", which returns to "이 채팅" (not closing the sheet). Order, topmost first: open menu → confirm → sheet ("This chat", action sheet, persona picker) → search text (clears) → overlay sidebar → the chat itself → **Home**. Leaving the chat for Home keeps the chat's draft and scroll position and does not stop a generating reply (the Home "Continue your story" shelf shows it as generating). Predictive back on Android 14+ previews Home behind the chat.

**Esc in the message box (DD-048, K2):** the first Esc blurs the message box (the draft stays, focus moves to the transcript) and the second Esc goes Home. The first Esc in an empty docked search field on the wide layout does the same (N3: focus moves to the transcript; with text, Esc clears the text first); the next Esc goes Home. Esc anywhere else follows the stack above. Alt+↑/↓ also ignores `select` controls (N4). Browser history at Home is the web host's call (K3: exit or blur; the mockup keeps a stand-in that never leaves the page).

## 5. Motion

Slice 1 tokens. Sidebar list: rows enter without motion; the status dot fades in (`--chat-dur-fast`). Generation strip: slides down 44 dp (and up to the top edge with the header, N1) (`--chat-dur-base`), reduced motion fades. Sheet: as slice 1 sheets. Low power: no crossfades, static spinners.

## 6. Korean copy (proposed keys, en / ko)

| Key | en | ko |
|---|---|---|
| searchPlaceholder | Search characters or chats | 캐릭터나 채팅 검색 |
| allCharacters | All characters | 모든 캐릭터 |
| newChat | New chat | 새 채팅 |
| importChat | Import chat | 채팅 가져오기 |
| sortRecent / sortManual | Recent / My order | 최근 / 내 순서 |
| editOrder | Edit order | 순서 편집 |
| statusGenerating | Writing a reply | 답변 생성 중 |
| statusNewReply | New reply | 새 답변 있음 |
| statusFailed | Reply failed | 답변 실패 |
| statusDraft | Unsent draft | 임시 저장 있음 |
| loadingChat | Loading the chat… | 채팅 불러오는 중… |
| loadFailed | Couldn't load the chat | 채팅을 불러오지 못했어요 |
| retry / backToPrevious | Try again / Back to previous chat | 다시 시도 / 이전 채팅으로 |
| stripWriting | {chat} — writing a reply | {chat} — 답변을 쓰는 중이에요 |
| stripDone | {chat} — reply finished | {chat} — 답변을 다 썼어요 |
| stripAutoStopped | {chat} — auto mode stopped | {chat} — 자동 진행을 멈췄어요 |
| stripFailed | {chat} — couldn't write the reply | {chat} — 답변을 쓰지 못했어요 |
| view / stop | View / Stop | 보기 / 중지 |
| sendBlocked | A reply is being written in another chat | 다른 채팅에서 답변을 쓰는 중이에요 |
| deleteChatConfirm | Delete "{chat}" and its {n} messages? | “{chat}” 채팅과 메시지 {n}개를 삭제할까요? |
| thisChat | This chat | 이 채팅 |
| scopeThisChat / scopeCharacter / scopeAll | This chat only / All chats of this character / All chats | 이 채팅에만 적용 / 이 캐릭터의 모든 채팅 / 모든 채팅에 적용 |
| useDefaultPersona | Use the default persona | 기본 페르소나 사용 |
| authorNote | Author's note | 작가 노트 |
| saved | Saved | 저장됨 |
| chatStats | {n} messages · last {time} · created {date} | 메시지 {n}개 · 마지막 {time} · 만든 날 {date} |
| chatOpened | Opened {chat} | {chat} 채팅을 열었어요 |
| stripAutoSoon / autoStoppedShort | auto mode stops after this / auto mode stopped | 자동 진행은 끝나면 멈춰요 / 자동 진행을 멈췄어요 |
| stripWritingShort (row 2 of the writing strip with the auto note) | writing | 쓰는 중이에요 |
| stripFailedN | {n} replies failed, view | 답변 실패 {n}건, 보기 |
| view (accessible name "View: {chat}") / stopBg / dismiss | View / Stop / Dismiss | 보기 / 중지 / 닫기 |
| savedChar / savedAll | Saved for this character / Saved for all chats | 이 캐릭터에 저장됨 / 모든 채팅에 저장됨 |
| toggleScopeLabel | Set separately for this chat | 이 채팅만 따로 설정 |
| togglesDiscarded | This chat’s own toggle values were discarded | 이 채팅의 설정값을 지웠어요 |
| noChats | This character has no chats yet | 이 캐릭터에는 아직 채팅이 없어요 |
| resultsShown | Showing {shown} of {n} results | 검색 결과 {n}개 중 {shown}개 표시 |
| fallbackPrompt / stopAndGo / wait | Writing a reply / Stop and switch / Wait | 답변을 쓰는 중이에요 / 중지하고 이동 / 기다리기 |

## 7. States the mockup must show

Sidebar: default; search with grouped results, empty results, 초성 match; a character with 0 chats; 1,000 synthetic chats (windowing); folders collapsed/expanded; rename inline; row menu; delete confirm; reorder mode. Switching: instant, cold load (skeleton after 300 ms), load failure. Background: strip writing / done / failed, Send blocked in B, row and strip badges, return to A at the new reply; the fallback prompt (a demo toggle). Sheet: every group, toggles in both scopes, persona picker, note autosave, plugin rows present/absent. Back stack walk-through. Narrow 360×740, 412×915, wide 1280×800; KO and EN; reduced motion; low power; keyboard only; forced colours.

## 8. Integration map (lane A; nothing here edits these files)

| App file | Change |
|---|---|
| `src/lib/SideBars/SideChatList.svelte`, `Sidebar.svelte`, `SidebarRail.svelte` | Search, recent strip, two-line rows with status, sort, reorder mode, row menu, windowed list, phone width cap |
| `src/ts/globalApi.svelte.ts:4273` (`changeChatTo`), `src/ts/characters.ts:1417/1445/1460` (`changeChar`) | Remove the three `doingChat` checks; per-chat scroll anchor; cold-load states without alerts. Tests asserting the refusal change: `hotkeyCharSwitch.svelte.test.ts`, `characters.coldRestore.svelte.test.ts`, `characters.coldGroup.svelte.test.ts` |
| `src/ts/process/index.svelte.ts`, `composerActions.svelte.ts` | Publish the generating chat's identity (none exists today); visible refusals instead of silent returns (`composerActions.svelte.ts:203, 446, 500, 669`); finished/failed flags per chat; no TTS/sound for a hidden reply |
| `src/lib/ChatScreens/Suggestion.svelte` | Suggestions for the reply's own chat only (`:127-134`) |
| `src/lib/ChatScreens/DefaultChatScreen.svelte` | Generation strip; Stop/Send and retry scoped to the generating chat (`:665`, `:862`); Send disabled with reason; composer menu items moved |
| New "This chat" sheet (from `CharConfig.svelte` basic tab, `Toggles.svelte`, `ModuleChatMenu`, bookmarks, branches) | Scope-grouped settings; toggle scope switch |
| Back handling (`src/lib/Mobile/mobileBack.ts` and the default shell) | One Back stack per §4 |
| `src/lang/*.ts` | Keys in §6 |

## 9. Design defaults to confirm (not product decisions unless the maintainer says so)

Initial-consonant search; default sort 최근; delete chat confirms without undo; Alt+↑/↓ (DD-047) and Ctrl+. shortcuts; no TTS auto-play for background replies; the sheet's scope grouping.

## 10. Revision 2 summary (2026-10-25)

Rejected review deviations: 5 (folders now precede chats) and 8 (reply suggestions clear on send or new reply). Accepted: 1, 2, 4, 6, 9; 7 accepted together with K0 and DD-048. Not changed (low value or out of this mockup's reach; reasons in [checks/builder-checks.md](checks/builder-checks.md) "Slice 2 — review fixes"): S8, S9, C6, A4, A7, K3, K4. Fix-to-test mapping is in that file.

## 11. Revision 3 summary (re-review N1 to N6)

N1 strip pinned state fixed (fill-mode backwards, `.up` slides to the top edge, reduced motion jumps to top 0); N2 two-row strip with short auto note; N3 first Esc in empty docked search; N4 `select` in the shortcut guard; N5 strip top 49 dp; N6 icon-only touch row menu. Evidence in [checks/builder-checks.md](checks/builder-checks.md) "Slice 2 — re-review fixes".
