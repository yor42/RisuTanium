# Chat screen: layout, performance, navigation (source-backed notes)

Scope: read-only trace of `C:\Projects\RisuAI` (paths below relative to `src/` unless noted). Observations are from reading source only; nothing was run on a device or in a browser. "DCS" = `lib/ChatScreens/DefaultChatScreen.svelte`.

## 1. Phone chat layout

OBSERVED:

| Fact | Source |
|---|---|
| Two shells exist. Default shell: `Sidebar` + `ChatScreen`. Beta "Mobile GUI" shell (`MobileHeader`/`MobileBody`/`MobileFooter`) only when `db.betaMobileGUI` is on AND width <= 800 (or Lite build). It is opt-in. | `App.svelte:211-232`, `ts/bootstrap.ts:594-597` |
| `DynamicGUI` = window width <= 1024; `sideBarStore` starts open only when width > 1024. So a phone starts with the sidebar closed, plus a 3rem (w-12 h-12) arrow button floating at top-left of the chat (`absolute top-3 left-0`, opacity 50%) as the only visible entry. | `ts/stores.svelte.ts:15,34`, `lib/UI/GUI/SideBarArrow.svelte:11-17` |
| Default shell has NO chat header: the chat column is `ChatScreen` > `DefaultChatScreen` (a `flex-col-reverse overflow-y-auto` scroller). No character name/avatar/title bar is shown in the default phone chat. | `ChatScreen.svelte:51-62`, DCS:563 |
| The composer is NOT a separate bottom bar. It is the first child of the same `flex-col-reverse` scroller, so it renders at the bottom of the scroll content. Default: it scrolls with the content (`mt-2 mb-2`). With `db.fixedChatTextarea`: `sticky bottom-0 pt-2 pb-2 bg-bgcolor z-index:29`. | DCS:563, 577-580 |
| Below the composer row (in DOM order, so above it visually because of col-reverse) can stack: translated-input textarea, staged attachment thumbnails (max 48 x 48 rem units `max-w-48 max-h-48`), sticker `AssetInput`, `Suggestion` chips, plugin `chatPanelStore` panels. All push message content up. | DCS:709-816 |
| Composer row sizing: textarea `text-xl` (1.25rem), `p-2`, `ml-4`; Send button `p-3`; menu button `p-3 mr-2`; optional sticker button `w-12 h-12`. Input height auto-grows via `scrollHeight`, with no max height (no cap found). | DCS:581-693, 399-417 |
| Message row: `ml-4 mr-4 p-2 mt-1 mb-1`, avatar + name on the left (avatar size = `iconsize * 3.5/100` rem, default `iconsize` 100 so 3.5rem), then text; every message adds `px` of ~2.5rem horizontal gutter + avatar + `ml-4` before text. Per-message text column therefore loses roughly 6-7rem of a 360px-wide phone (~22.5rem). | `lib/ChatScreens/Chat.svelte:1551,1636-1638`, `ts/storage/database.svelte.ts:152-153` |
| Each message shows an action row (copy, TTS, remove, translate, edit, reroll/unreroll, bookmark, branch, disable, disable-above, copy-as-card) via `iconButtons`. | `Chat.svelte:1197-1360` |
| Beta Mobile header: `h-16` (4rem) with back + name + hamburger; chat footer area only appears on non-chat pages. Opening the hamburger swaps the whole body to a 3-tab view (Chat list / Character config / DevTool) with its own tab strip (`py-1`). Character config tabs add a footer bar (`p-4`, icon + 0.75rem label). | `lib/Mobile/MobileHeader.svelte:13-27`, `MobileBody.svelte:17-55`, `MobileFooter.svelte:1-71` |
| Android keyboard: `MainActivity` sets `SOFT_INPUT_ADJUST_RESIZE` (needed below API 30), then pads the content view with `bottom = max(navBar, ime)`, and hands the WebView the insets reduced by that padding. The WebView window is therefore physically shrunk above the keyboard; the page is not asked to compute IME height. | `src-tauri/gen/android/app/src/main/java/io/github/yor42/risutanium/MainActivity.kt:84-106` |
| Page reaction: no `visualViewport`, `focus`/`scrollIntoView` handler for the textarea, or `env(safe-area-*)` use found in chat code. Height comes from `html,body { height: var(--risu-height-size) }`, set by `db.heightMode` (`auto`/`percent` = 100%, `vh`, `dvh`, `lvh`, `svh`). A user-selectable height mode exists because the correct unit varies by WebView. | `styles.css:182,246-249`, `ts/bootstrap.ts:1024-1046`, grep of `ChatScreens/` |
| Consequence in the default (non-fixed) composer: when the keyboard opens, the scroller shrinks, but because the composer is the last visual child inside a `flex-col-reverse` scroller it stays at the bottom of the scroll content (scrollTop 0 = bottom). Not verified on device whether the caret stays visible on a multi-line input. | inferred from DCS:563 + MainActivity; UNVERIFIED |
| Floating extras over the chat: "new message" pill (6 style variants, `z-50`, `bottom-16/20/36`), plugin floating action buttons (`fixed top-4 right-4`), `isScrollingToMessage` full overlay. | DCS:507-553, 1121-1131 |
| Optional `ResizeBox` (character view/emotion image box) is rendered above the chat inside the same column unless `inlayViewScreen` is set; width/height come from `ViewBoxsize` (default 12rem x 12rem). | `ChatScreen.svelte:55-59`, `ts/stores.svelte.ts:36` |
| `classicMaxWidth` constrains the chat to `max-w-6xl`; theme `waifu` splits width into image + chat halves. | `ChatScreen.svelte:35-54` |

## 2. Message list rendering

OBSERVED:

| Fact | Source |
|---|---|
| No true virtualization of the message list. It is a window by count: the newest `loadPages` messages are mounted (default initial 30, additional 15 per scroll-to-top, both configurable via `chatLoadInitialPages` / `chatLoadAdditionalPages`; "pages" = messages). Older messages are not in the DOM. | `ts/chatLoadPages.ts:1-2`, `Chats.svelte:87-105` |
| "Load more" trigger: scroll within 100px of the top (col-reverse scrollTop math) bumps `loadPages` by the additional count; no spinner. Separate `Load more` button only for the folded-chat state. | DCS:563-568, 835-844 |
| Growth is unbounded while scrolling: loadPages is only reset when the chat identity changes (and no message editor is open). | DCS:180-191, `ts/chatWindowPolicy.ts:1-36` |
| Jump to message (bookmarks/search): forces `loadPages` large enough, polls DOM up to 5s, waits up to 4s for all images in the container, scroll-into-view up to 3 times. | DCS:278-340 |
| Each message is imperatively `mount()`ed as its own Svelte component into a hand-created div, keyed by a 32-bit string hash of data + chatId + index + portrait + disabled + reload pointer. Changed hash = unmount + remount of that message. | `Chats.svelte:64-185` |
| `updateChatBody` iterates the whole window on every reactive pass (re-hashes every message text; `Set.difference` for removal). | `Chats.svelte:77-185` |
| Message body markdown/translation is parsed asynchronously per message (`ParseMarkdown`, `{#await}`), and on translated chats also calls the translator (optional auto-translate). Screen-reader/image-repair pass (`checkImg`) scans each message body for unresolved `<img>`. | `ChatBody.svelte:268-287`, `188-266` |
| Known perf work: `streamingDisplayOptimizationMode` `off|balanced|strong` (renders the actively streaming message as raw `whitespace-pre-wrap` text instead of re-parsing markdown per chunk); chat-window reset on chat switch ("Stage A / A-lite"); chat-window `MEASURE` instrumentation; cold-storage placeholder chats (`coldStorageHeader`) loaded on demand with "loading chat data" text. | `Chats.svelte:90-98,111-120`, `ChatBody.svelte:70,280-281`, `ts/storage/database.svelte.ts:713`, DCS:818-833 |
| `lowPower` setting: NO match for `lowPower`/low-power anywhere under `lib/ChatScreens`, `lib/SideBars`, `App.svelte`, `styles.css` (grep). The only motion preference in chat is `prefers-reduced-motion` for the draft-restored marker (150ms fade) and `SourceDisclosure`. The sidebar animation uses `db.animationSpeed` via `--risu-animation-speed`. | grep; `Chat.svelte:164-180`; `Sidebar.svelte` styles |
| Avatars: each message instantiates its own `senderIcon`, which resolves `img` (a Promise from `getCharImage(..., 'css')`, awaited per message) and renders a `<div>` with `background-image` (not `<img>`), so animated images are decoded by the browser at full source size (no `loading="lazy"`/`decoding` attribute possible on a CSS background). Placeholder block shown while pending. | `Chats.svelte:84-85`, `Chat.svelte:1365-1399` |
| The sidebar rail uses a different path: `getCharImage(path, "thumb")` (thumbnails) and its own windowing (`railWindow`, mounts viewport + 1 viewport overscan, min 2 rows). This is the only real virtualized list in the chat-adjacent UI. | `lib/SideBars/SidebarRail.svelte:1081,1130,332,568`, `railConstants.ts:62-68` |
| Chat-list sidebar (`SideChatList`) renders EVERY chat of the character (`{#each chara.chats}` plus a filter per folder), no window, no search, no counts, no timestamps; SortableJS for drag reorder; per-row filter `chara.chats.filter(...)` recomputed each render, and `chara.chats.indexOf(chat)` in loops (O(n^2) for big chat lists). | `lib/SideBars/SideChatList.svelte:119-390` |
| Full-chat screenshot loads the whole chat (`runWithFullWindow`), then rasterises every message to canvas and merges them. | DCS:440-494 |

## 3. Composer

OBSERVED:

| Fact | Source |
|---|---|
| Single `<textarea class="text-input-area">` (`text-xl`), bound to a per-chat draft record (`composerDrafts`), so unsent text and attachments survive chat switches. A localDrafts registration marks the screen "dirty" while text/attachments exist. | DCS:84-114, 248-265, 588-663 |
| Auto-resize: set `height:0`, read `scrollHeight`, apply px; runs in a `$effect` after any draft write. Same for the translated-input textarea. No max-height or inner scroll cap found. | DCS:399-430 |
| Send/stop: one button swaps. While `$doingChat` / composer busy / input-translating: a spinner (`.loadmove`, coloured by `chatProcessStage` 1-4, a different colour when auto mode) that calls `abortChat`. Otherwise Send icon. Button height follows the textarea. The textarea is `readonly` (not disabled) while the composer is locked. | DCS:591, 666-682, 1134-1157 |
| Menu button (hamburger) right of Send opens a popover (`right-2 bottom-16`, `p-5`, `gap-3`, `fixed` when fixed textarea) with: auto mode (groups only), stop TTS (when applicable), continue response, chat list (if `showMenuChatList`), Easy Panel (`enableRisuaiProTools`), plugin menu items, HypaMemory modal (if `showMenuHypaMemoryModal`), auto-translate-input toggle, screenshot, post file, auto-suggest toggle, modules, reroll (if `sideMenuRerollButton`). Click-outside closes. Menu items are `div`s with onclick (no role/tab). | DCS:954-1115 |
| Attachments: Post File menu item (file picker via `postChatFile`), paste of image from clipboard (only image mime), and sticker/asset picker button (`useChatSticker`, non-group only) which inserts `{{img::name}}` text. Staged files appear as thumbnails with an X. Drag-and-drop onto the composer: not found in this file. | DCS:581-584, 607-660, 737-798, 1061-1087 |
| Persona switch: NOT in the composer or chat. The active persona (icon + name) is read from the chat's `bindedPersona` else `db.selectedPersona`, shown on user messages. Changing it: persona list (`openPersonaList`) via a custom-sidebar `persona` item, a hotkey, or the hotkey "quick actions" select; binding a persona to a chat is in the chat-row menu (MenuIcon) of `SideChatList`. | DCS:372-392, `lib/SideBars/CustomSidebar.svelte:48-62`, `ts/hotkey.ts:192,452`, `SideChatList.svelte:238-260` |
| IME / Enter: `onkeydown` sends on Enter when `!e.isComposing` and `sendWithEnter` is set (Shift+Enter inserts newline); with `sendWithEnter` off, Shift+Enter sends. There is no `compositionstart/end` listener and no `keyCode === 229` check in this file. The translated-input textarea's Enter handler does not check `isComposing`. Ctrl+M triggers reroll. | DCS:592-606, 718-729 |
| Translation toggles: composer menu toggles `useAutoTranslateInput`, which shows a second textarea (translate-to-English input) whose `oninput` runs translation both ways (`updateInputTransateMessage`). Per-message translate button in message actions. Auto-translate on messages is `db.autoTranslate` + `autoTranslateCachedOnly`. | DCS:709-735, 1044-1052, `ChatBody.svelte:84-114` |
| Suggestion chips (`useAutoSuggestions`) appear below composer; also `chatPanelStore` plugin panels. | DCS:800-816 |
| Mobile on-screen keyboard: no `enterkeyhint`/`inputmode`/`autocapitalize` attributes found on the main textarea. | DCS:588-663 |

## 4. Switching chats and characters

OBSERVED:

| Fact | Source |
|---|---|
| Characters: `SidebarRail` (5rem-wide `w-20` rail) lists characters and folders with thumbnail avatars, virtualized, drag-and-drop reorder with long press 500ms on touch, scroll position and open folders remembered on device. Selecting calls `changeChar(index)`. | `Sidebar.svelte:60-170`, `SidebarRail.svelte`, `railConstants.ts:7-12`, `railMemory` |
| A full character catalog (`GridCatalog`/`GridChars`) via the rail "Character" button or the hamburger grid icon. It has a search field (`createCharacterSearch`) and sections. The Mobile GUI uses `MobileCharacters` with search and relative "ago" time and chat count per row. | `GridCatalog.svelte:26,50-62`, `lib/Mobile/MobileCharacters.svelte:28,93-115` |
| `changeChar` is a no-op while a reply is being generated (`doingChat`). It also restores cold-stored characters/group members before selecting and bumps `lastInteraction`. | `ts/characters.ts:1433-1442` |
| Chats of the current character: `Sidebar` tab "Chat" shows `SideChatList` (panel opens with the sidebar; panel width `w-96` = 24rem normal, up to `w-138`, over-wide for a 360px phone: no max-width cap found, overlay with a tap-away dark strip `grow min-w-12`). | `Sidebar.svelte:199-297` |
| `SideChatList` content: "New chat" button, folders (collapsible, colourable, drag to reorder), flat list of chats by name only (no date, message count or preview), per-row icon cluster (menu: copy / bind persona, rename pencil, export, delete), footer icons (export all, import, rename mode, branch viewer, bookmark list, new folder), then `Toggles` and, for groups, the "order by order" check. No search field. | `SideChatList.svelte:119-486` |
| Quick alternative: composer menu "Chat list" item opens `ChatList` modal (w-72, name + per-row rename/export/delete, scroll, no search), only when `showMenuChatList` is on. | DCS:990-998, `lib/Others/ChatList.svelte:15-77` |
| `changeChatTo(index)` sets `chatPage`; `ReloadGUIPointer` bumps; chat window reset to the initial 30 on identity change (unless a message editor is open); composer draft is per chat key (chaId + chatId) so each chat keeps its own unsent text. | `ts/globalApi.svelte.ts:4700-4725`, DCS:84-107,180-191 |
| State kept per character: `chatPage` (last selected chat), `chatFolders`, and per-chat `bindedPersona`, `note`, `modules`, `hypaV2Data`. State kept per device: rail scroll/open folders. Not kept: chat scroll position (window resets and scrolls to bottom). | `ts/characters.ts:45,683`; `Chats.svelte:224-236` |
| Mobile (beta) shell: back arrow (also hooked into Android back handler) exits chat to list; hamburger opens Chat list/Character/DevTool tabs. | `MobileHeader.svelte:15-34`, `lib/Mobile/mobileBack.ts` |
| Default shell on phone: chat to chat or character to character requires open sidebar, tap, then sidebar stays open until closed (X button or tap dim strip). Android back behavior inside the default shell was not traced. | `Sidebar.svelte:199-246` |

## 5. Side panels and chat-level settings: where each opens from

OBSERVED (all reached from the chat screen):

| Surface | Reached via | Source |
|---|---|---|
| Sidebar (rail + panel) | Floating arrow at top-left; X in panel; dark strip | `SideBarArrow.svelte`, `Sidebar.svelte:199-246` |
| Sidebar tab "Chat" (`SideChatList`) | default sidebar tab | `Sidebar.svelte:250-277` |
| Sidebar tab "Character" (`CharConfig`; `botMakerMode`) | second tab in panel header | `Sidebar.svelte:258-265` |
| DevTool tab | third tab if `enableDevTools` | `Sidebar.svelte:266-272` |
| QuickSettings GUI (replaces the tab content) | `QuickSettings.open` store | `Sidebar.svelte:274-276` |
| Character settings sub-pages: basic info, display (images/emotion), lorebook (sub 3), TTS (5, characters only), scripts (4, characters only), advanced (2), share (6, characters only) | icon strip inside CharConfig (24px icons) or the Mobile GUI footer | `CharConfig.svelte:213-241`, `MobileFooter.svelte:36-70` |
| Chat-level author note ("note") and per-chat toggles (module/custom prompt toggles, jailbreak toggle, memory toggle) | CharConfig basic tab (under description) AND `Toggles` at the bottom of `SideChatList` (also shown in CharConfig). Both places expose toggles. | `CharConfig.svelte:311-330`, `SideChatList.svelte:456-460`, `Toggles.svelte:181-194` |
| Lorebook (character-level) | CharConfig tab 3; also module/global lorebooks elsewhere in Settings | `CharConfig.svelte:677-681` |
| Memory: HypaV2 alert or HypaV3 modal | Composer menu item (needs `showMenuHypaMemoryModal` and the model/option enabled); memory on/off toggle is in `Toggles`; reset in CharConfig advanced | DCS:1020-1042, `Toggles.svelte:194`, `App.svelte:255-257` |
| Scripts (regex/trigger/background HTML) | CharConfig tab 4 (characters only; groups get redirected to tab 0) | `CharConfig.svelte:170-172,682-722` |
| Modules for this chat | Composer menu "Modules" -> `ModuleChatMenu` modal | DCS:1098-1105, `ChatScreen.svelte:64-68` |
| Chat list modal | Composer menu "Chat list" | DCS:990-998 |
| Bookmark list, branches viewer | Icons in SideChatList footer | `SideChatList.svelte:364-380` |
| Persona list | custom sidebar item / hotkey | see section 3 |
| App Settings (global: models, presets, etc.) | Rail "Settings" button or hamburger; replaces the entire chat screen (`$settingsOpen`) | `Sidebar.svelte:78-93`, `App.svelte:208-210` |
| Easy panel | Composer menu (Pro tools) | DCS:1001-1008 |
| Screenshot | Composer menu | DCS:1054-1059 |
| Plugin menus / FAB / panels | `additionalChatMenu`, `additionalFloatingActionButtons` (fixed top-right), `chatPanelStore` (inline) | DCS:1010-1018,1121-1131,808-816 |
| Presets / loadouts | Custom sidebar items, hotkey | `CustomSidebar.svelte:33-47` |

So chat-related controls are spread over: composer popover, sidebar tabs (Chat/Character/DevTool/QuickSettings), sidebar footer icons, modals (chat list, modules, bookmarks, Hypa), per-message action row, hotkeys, full Settings.

## 6. Group chats

OBSERVED:

| Fact | Source |
|---|---|
| A group is a character record with `type: 'group'`: `characters: string[]` (member chaIds), `characterTalks: number[]` (0 to 1, set in sixths), `characterActive: boolean[]`, `orderByOrder`, `autoMode`, plus normal chats. | `ts/storage/database.svelte.ts:1563-1588` |
| Add/remove members in CharConfig basic tab: member avatar grid (tap avatar = remove), 6-segment "talkness" bar, "active" checkbox, plus (+) opens character picker; adding offers to append that member's first message with `saying: id`. New member default talkness 4/6. | `CharConfig.svelte:254-305`, `ts/process/group.ts:10-66` |
| Turn order on send (no explicit speaker selector): members with `active` and talkness > 0 are collected; if `orderByOrder` is off, `groupOrder` first pulls members whose name words appear in the last message (in message-word order), then each remaining member (shuffled) speaks with probability = talkness, at least one random speaker guaranteed; the member who sent the last message is excluded. If `orderByOrder` is on, list order is used unfiltered. Each speaker gets its own LLM call in sequence with `[Write the next reply only as {name}]`. | `ts/process/index.svelte.ts:705-760`, `ts/process/group.ts:74-116`, `index.svelte.ts:928-935` |
| Auto mode (menu item "Auto mode"): loops sends until `MAX_QUIET_TICKS` quiet turns, toggle to stop. Only offered for groups. | DCS:958-963, `composerActions.svelte.ts:661-706` |
| Per-message speaker: messages carry `saying`, but no reference to `saying` exists in `lib/ChatScreens/*.svelte` (grep): `Chats.svelte` passes `name={currentCharacter.name}` (the group name) and `charImage` of the group for every non-user message. So the chat UI as read does not show which member is speaking. UNVERIFIED at runtime: model output may include names. | `Chats.svelte:129-139`, grep |
| Group chats hide: sticker button, first-message card (`Chat` with `firstMessage` is non-group only), TTS/scripts tabs; `ResizeBox` shows the group view image (`viewScreen` single / multiple / emp). | DCS:581,892; `CharConfig.svelte:170-172`; `ChatScreen.svelte:56` |
| Group controls live in two places: the member grid in CharConfig and `orderByOrder` checkbox (in CharConfig below toggles AND at bottom of SideChatList). No on-chat member picker, no "next speaker" override, no mute/skip per member from the composer. | `CharConfig.svelte:323-330`, `SideChatList.svelte:480-486` |
| Group members that were archived are restored before the group opens; failures raise an alert. | `ts/characters.ts:1478-1491` |

## Design suggestions (separate from observations; proposals only)

1. Phone chrome: add a slim one-row chat header (back/list, name + avatar, one overflow) that can auto-hide on scroll; drop the floating 3rem arrow. Target <= 48px header, <= 56px single-line composer.
2. Composer: make it an explicit bottom dock (not part of the scroller), cap input height (e.g. 5-6 lines then internal scroll), move rarely used actions to one sheet, keep Send/Stop in place; keep the keyboard-aware behaviour that MainActivity already provides (page shrinks), and test caret visibility on Note 9.
3. IME: send on Enter only when not composing and not keyCode 229; add `compositionstart/end` guard for Korean; set `enterkeyhint="send"` when sendWithEnter is on; apply the same guard to the translated-input box.
4. Message density: reduce gutters on narrow screens, avatar optional or small on phone, collapse per-message action row behind a tap/long-press.
5. Long chats: keep count-window (it is cheap) but add real DOM recycling or `content-visibility: auto` for older messages, `Set` of pre-hashed rows to avoid re-hashing the whole window per update, and thumbnails for message avatars (the rail already uses `thumb`); add `lowPower` handling (no animated avatars/blur, fewer mounted messages) for Note 9 / Pi 3.
6. Switching: one "switcher" surface with search (characters first, then that character's chats with last-message preview/date/count), recent characters on top; keep unsent drafts and scroll position per chat.
7. Panels: replace the 24rem sidebar overlay on phones with full-screen sheets; unify chat-level settings (note, toggles, persona, modules, memory) under one "This chat" sheet and character-level under "Character"; keep Settings separate.
8. Groups: show the speaking member (avatar + name) per message from `saying`; add a speaker strip above the composer with tap-to-force-next-speaker, per-member mute, and an order mode switch.
9. Persona: a small persona chip in the composer for switch/bind, since the current location is a hotkey/sidebar item.

## Limits

- Source reading only; no runtime, device, or browser verification. Keyboard behaviour on the Note 9 and Pi 3 is inferred from `MainActivity.kt` and CSS, not measured.
- `lowPower` was searched by name in the chat/sidebar/App/styles files only; other low-power-like settings (e.g. `animationSpeed`, streaming optimization, `chatLoadInitialPages`) were noted but their settings UI was not traced.
- `Chat.svelte` (1670 lines) was read in sections (imports, avatar snippet, message shell); the per-message action-bar logic, edit mode and TTS were not traced in detail.
- Settings pages, Realm/Grid details, HypaV3 modal internals, the custom sidebar config, hotkeys beyond persona, and Android back handling in the default shell were not traced.
- `src/` reading used the main checkout `C:\Projects\RisuAI` (not worktrees). No files under `Agents/Evidences of Investigations/`, secrets or keystores were read.
- The chat height and `heightMode` default were not traced in the settings UI. The default `iconsize` of 100 comes from a nullish fallback only.
- "Pages" in `chatLoadPages` equal message counts (per `Chats.svelte` slice math); no pagination UI exists.
