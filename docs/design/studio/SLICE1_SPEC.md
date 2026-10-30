# Studio slice 1: shell, owner map, saving

Status: **draft, revision 2.1** (2026-10-26). Task: [tasks/2026-10-26-studio.md](../tasks/2026-10-26-studio.md). Discovery: [research/today-authoring.md](research/today-authoring.md). Review: [reviews/2026-10-26-studio-slice1-review.md](../reviews/2026-10-26-studio-slice1-review.md). Decisions: DD-089 (pain points), DD-090 (full authoring, sliced), DD-091 (toggle builder, later slice), DD-092 (build on `mockups/studio.html`), DD-093 (this slice first), DD-094 (all forms in Studio), DD-095 (hybrid save), **DD-096 (combined view per kind), DD-097 (one script list), DD-098 (phone Back), DD-099 (device-only drafts), DD-100 (durable delete undo), DD-101 (search scope), DD-102 (live item changed elsewhere), DD-103 (script mode memory), DD-104 (multi-word search)** in [DECISIONS.md](../DECISIONS.md). Shares the chat mockups' tokens, sheets, Back stack (DD-040), scope tags (DD-043) and KO register.

**Changelog.** rev 2.1 (2026-10-26): applies the re-review (N-01..N-08) and DD-103, DD-104: search matches every word of the query in any order (초성 per word); each script mode keeps its own list; distinct status icons and a visible failure text on phones; "changed elsewhere" is kept per item and marked in the tree; Back never drops a pending or failed save; clearer restore wording; script items are named by their mode; forward History steps are visible; deep-link notices are persistent; **Ctrl+K is the only search shortcut** (Ctrl+P is the global preset switcher). rev 2 (2026-10-26): applies the independent review (F-01..F-22) and DD-096..102; merges Lua and triggers into one `스크립트` kind with modes; per-kind source-verified combined order; search covers off modules and other presets; phone header and item toolbar fit one row each; live-item "changed elsewhere" state; device-only drafts and history; durable delete undo; deep links and Settings return ids; folds in the builder's accepted deviations and proposals P-1..P-7; adds the finding-to-fix table (section 15) and `requires lane A` markers with degraded UI (section 11). rev 1: first draft.

Scope: the Studio screen, how it is reached and left, the owner tree and search, the item header, the save/undo/restore model for live items, the draft/Check/Apply model for code, and the test panel frame. Out of scope (later slices): the real forms for each kind (toggle builder, long-text editor, character forms, regex, lorebook, V2 rules); this slice shows them as simple placeholder forms good enough to exercise saving.

Marked **(design default)** = chosen here within the decided intent, open to veto. Marked **requires lane A** = needs app work that does not exist yet; each has a degraded UI in section 11.

## 0. Today (source-read, research §1-5)

| Fact | Source |
|---|---|
| Authoring is scattered: the character editor is a 7-tab sidebar with icon-only tabs; modules have their own 5-tab editor under Settings; preset fields sit in a long settings page. | `CharConfig.svelte:213-241`, `ModuleMenu.svelte:198-241`, `PromptSettings.svelte:288-299` |
| The same kinds live in several owners with no cross-owner view: toggle definitions ×3, regex ×3 (character, module, preset), scripts ×2, lorebook ×3 (character, chat, module), background HTML ×2. | research §1b |
| Triggers and Lua share **one list per owner**; V1, V2 and Lua are mutually exclusive and switching confirms, then wipes the list. | `TriggerList.svelte:18, 33-39` |
| Text boxes are fixed at 160 px, not resizable; the only larger editor is a popup reached by hotkey or right-click, and closing it always commits. | `TextAreaInput.svelte:9-31, 43`; `PopupEditor.svelte:52` |
| Every field binds straight to the database and saves through the global debounced loop: no status where you edit, no undo beyond the textarea's, no recovery. Module edits are live with no cancel; "+" stores a blank module before it is named. | `globalApi.svelte.ts:1531-1613`; `ModuleSettings.svelte:114-122, 163-206` |
| Testing: no regex preview, no trigger/Lua run, no plugin console. Only DevTool (hidden behind a setting) and the popup editor's CBS preview. | research §3 |
| Plugins have no code editor in the app; `studio.html`'s Plugin mode is new. | `PluginSettings.svelte` |
| The engine merges kinds in different orders: regex = preset, character, modules; lorebook = character, chat, modules; toggles = preset, modules, character. | `scripts.ts:264`; `lorebook.svelte.ts:139`; `Toggles.svelte:70-75` |

## 1. Entry points and leaving (DD-094, DD-098)

Studio is one screen, `스튜디오`. Every authoring entry opens it at the right place:

| From | Opens at |
|---|---|
| This chat sheet "캐릭터 설정 열기" (chat slice 2) | the character, 기본 정보 |
| This chat sheet "채팅 로어북" | 이 채팅 › 로어북 |
| Toggles panel section ⋯ "정의 편집" (TOGGLES_SPEC) | that source › 토글 정의 |
| Library/Home character card ⋯ "스튜디오에서 열기" | the character |
| Settings › Modules row, Settings › Prompt | that module / the active preset |
| Studio's own search (§4) | the hit |
| A link (`?owner=…`, below) | that owner and kind |

- Opening from a chat sets the **context chat**: the tree shows that chat's character, its modules and the preset, and "이 채팅에서 켜짐" badges are computed for it. Opened without a chat (library, settings), the context is the character or owner alone and badges about a chat are hidden; a module that is only on in a chat then moves to 다른 모듈.
- **Leaving:** the header Back (`arrow-left`), Android Back and the mouse Back button return to where Studio was opened, with focus on the control that opened it (DD-040 stack: open layers close first). Nothing is lost by leaving: live items are saved, drafts persist on this device (§6). **Back never drops a save (N-05):** with a save pending it waits for it ("저장하는 중이에요. 끝나면 나갈게요") and then leaves; if the save failed it asks once with **다시 시도 / 그냥 나가기 / 머무르기**, and "그냥 나가기" leaves a note on the origin screen that changes were left unsaved.
- **Phones (DD-098):** Back from a screen Studio opened straight into (an item or owner from a chat, library or Settings entry, or a deep link) goes **directly to the origin**; the owner list is one tap away on the header title (`chevron-down` on the title). After the user opened the list and picked an item from it, Back goes item → list → origin.
- **Settings return:** with `from=settings` Back opens `../settings/slice1.html?from=studio&page=<page>&section=<section>`: preset owners `page=models&section=models.presets`; preset prompt/advanced `page=models&section=models.prompt`; module owners `page=ext&section=ext.modules`; plugin owners `page=ext&section=ext.plugins`; other owners no page (Settings index). Ids are the Settings lane's (`settings/checks/builder-checks.md`).
- Wide (≥ 1024 px): a full screen of its own, not a sidebar (design default; the work needs width).

**Deep links** (for Settings, Library, chat): `slice1.html?owner=<character|chat|preset|module|plugin>:<id>[&kind=<kind>][&item=<id>][&from=chat|library|settings]`. `kind` is `basic, display, lore, regex, scripts, toggles, html, advanced, plugin`; aliases `lua` and `trigger` → `scripts`, `plugincode` → `plugin`. Owner and supported kind → that owner's kind overview (breadcrumb owner › kind, owner revealed, kind row selected); `item` that exists in it → the item; item missing → the kind overview and a notice. Every notice below is a **persistent bar under the header** (role status, announced, dismissible, cleared when the user navigates on) and is recorded for tests (`__st1.notice`). Kind not supported by that owner type → the owner root and the notice "그 종류는 {owner}에 없어요. {owner} 루트로 열었어요". Owner id unknown, wrong type for the id or malformed → the tree with no selection and the notice **찾을 수 없어요**. `character:<other>` switches the context character with the notice "{이름} 캐릭터로 열었어요" and drops the chat context; `chat:` turns it on; `kind` without `owner` is ignored.

## 2. Layout

| Width | Layout |
|---|---|
| ≥ 1024 px | Three columns: **owner tree** 280 px (resizable 220-400), **editor** flexible, **side panel** 360 px (Problems / Test / History; collapsible, remembered). |
| 600-1023 px | Tree becomes a left drawer (`panel-left` button, opens over the editor); side panel becomes a bottom sheet (one `panel-bottom` button in the item toolbar opens it; the three tabs are inside). |
| < 600 px | List → detail: the tree is the first screen; choosing an item opens the editor full-screen. The side panel is the same bottom sheet. |

- **Header (all widths), one row of 48 px:** Back · breadcrumb **owner › kind › item** (each part a button; the kind is not repeated when the item has the kind's name) · **save status** (§5) · undo · redo · `panel-right` (wide only) · `search` · `⋯` (restore point, history, help, demo).
- **Phones (F-11):** the header is **one row**: Back · the item name with owner › kind as subtitle (the whole title is a button to the owner list) · status icon (each state has its own icon: saving spinner, saved check, draft file-pen, failed cloud-off, changed elsewhere git-compare, none of them the problems triangle; the accessible name says which; a failure also shows its short text "저장 안 됨" and the retry button) · `search` · `⋯`. Undo and redo are the first two items of `⋯`, named like the tooltips. The item toolbar is one row: Check · Apply (code) · panel button (badge = problems) · `⋯`; the 사용 switch is an item of `⋯` on phones. The page title is not repeated in the item head.
- **Item toolbar (all widths):** the switch 사용 only for kinds that have an enabled flag (로어북, 정규식, 스크립트, 배경 HTML, 플러그인 코드); character basics and display cannot be switched off.

## 3. Owner tree (DD-089 "hard to find")

Root nodes, in this order (only those that exist in the context):

0. **합쳐서 보기** (combined view, below).
1. **캐릭터** (or **그룹**) — the context character.
2. **이 채팅** — chat-only items (chat lorebook). Only with a context chat.
3. **모듈** — each module active for the context, in load order, each with a badge: "이 채팅에서 켜짐" / "모든 채팅" (globally enabled) / "캐릭터에 포함". A collapsed **다른 모듈 (n)** group lists installed modules not active here. `+` adds a module (name first, below).
4. **프리셋** — the active preset by name; a collapsed **다른 프리셋** group.
5. **플러그인** — installed plugins (global).

Under each owner, the **kinds it supports**, in a fixed order, each with a count:

| Kind | Owners | Save |
|---|---|---|
| 기본 정보 (name, description, first messages…) | character | live |
| 표시와 에셋 | character, module | live |
| 로어북 | character, chat, module | live |
| 정규식 | character, module, preset | live |
| **스크립트** (one list with a mode: V2 규칙 / Lua / V1) | character, module | V2 and V1 live; **Lua draft** |
| 토글 정의 | character, module, preset | live |
| 배경 HTML | character, module | live |
| **고급** (character: prompts and the low-level access flag; module: its options and the low-level access flag; preset: prompt options) | character, module, preset | live |
| 플러그인 코드 | plugin | **draft** |

- Kinds with no items are shown dimmed with `plus` "추가" (only where the owner supports them), so the user learns where things can live. Hide-empty toggle in the tree `⋯` (design default: shown).
- Each item row: icon, name, and markers: `•` unsaved draft (code), `alert-triangle` problems count, `circle-off` disabled item; a scripts row also shows its mode ("Lua", "V2 규칙").
- **Roll-ups (F-13):** a collapsed owner row shows the total item count, its draft count ("초안 n개") and a problems marker (`alert-triangle` with the count over all its items); a collapsed kind row shows its count and the problems/draft markers of its items. The marker moves down to the items when the row is expanded.
- Owner rows carry the scope icon from the chat mockups: `user` character, `message-square` this chat, `puzzle` module, `file-text` preset, `plug` plugin.
- **Scripts kind (DD-097):** one `스크립트` item per owner; "추가" on an empty kind creates it in V2 mode, on a non-empty kind opens the existing one. The item shows its mode as a segmented control (V2 규칙 / Lua; V1 only when the list is V1). **Switching mode never wipes and each mode keeps its own list (DD-103):** switching stores the current list (and any Lua draft) under its mode, and switching to a mode brings back that mode's last list (a mode that never had one starts empty; Lua: a stub). An untouched empty list never replaces a stored one, so Lua → V2 → Lua → V2 with nothing typed loses nothing. The item lists the stored lists with a Restore button each, the mode buttons carry a dot when a list is stored, and every switch is a History step (undoable). Stored lists are device-only (§6). The item is **named by its mode** ("Lua 스크립트", "V2 규칙"), not "스크립트" under "스크립트".
- **Merged view (DD-096, F-01, F-02, F-04): "합쳐서 보기"** lists, per kind, every item from every owner in the order the engine merges *that kind*, one group per kind:

| Group | Order | Numbered | Source |
|---|---|---|---|
| 토글 정의 | preset, modules, character | yes | `Toggles.svelte:70-75` (`customPromptTemplateToggle + getModuleToggles + charToggle`) |
| 정규식 | preset, character, modules | yes | `scripts.ts:264` (`presetRegex.concat(char.customscript).concat(getModuleRegexScripts)`) |
| 로어북 | character, chat, modules | yes | `lorebook.svelte.ts:139` (`characterLore.concat(chatLore).concat(moduleLorebook)`) |
| 스크립트 (V2 규칙 / Lua across owners) | not verified | **no** ("실행 순서는 아직 확인되지 않아 번호를 붙이지 않아요") | n/a |

  Modules are in load order. Rows **lead with the owner** (bold) and name the thing underneath: the toggle keys for 토글 정의 ("combat · lantern · mood"), the item name for 정규식/로어북, the mode for 스크립트; choosing one opens it in its owner. Numbers appear only where the order is verified; no copy claims an order for the scripts group. (Duplicate toggle keys across owners are not detected today; flagging them is a later slice.)
- Keyboard: tree pattern (↑/↓, ←/→ collapse/expand, Home/End, type-ahead), Enter opens; `+`/Insert on a kind row adds; the menu key or Shift+F10 opens a row menu (add, move, delete, expand/collapse); the tree remembers expansion per owner. Add buttons are 44 dp tap targets.
- **Module creation** fixes today's ghost module: "+ 모듈" asks for a name first; nothing is stored until it has one. Its toast Undo removes it again.

## 4. Search everywhere (DD-101)

- `search` button or **Ctrl+K** (the only shortcut: Ctrl+P is the global preset switcher): one field over the tree. Matches item names, kind names, and **content**: regex find/replace, lorebook keys and content, toggle keys/labels, script text (V2 rules and Lua), character text fields. Korean 초성 on names (as in TOGGLES_SPEC §6, **one jamo only matches the start of a word**, two or more anywhere).
- **Several words (DD-104):** the query is split on spaces (runs of spaces collapse, ends are trimmed); an item matches when **every word** matches somewhere in it (name, kind name, or any field), in **any order**; each word follows the 초성 rule on its own (a single jamo word matches only at the start of a word, two or more anywhere). Every matched word is marked in the result line and snippet; Enter selects the first matched word in the field.
- Results grouped by owner, each line: kind icon, item, a snippet with the match marked, owner tag. Enter opens the item and, for content hits, selects the match in the field or editor.
- Filter chips by kind ("정규식", "로어북", "토글", "스크립트", "정보"); a chip with an empty query lists the kind.
- **Scope (default):** the context owners **plus off modules and other presets**, which carry a "꺼짐" tag on their group and rows (the commonest "where is it" miss is a script in a module that is off). The switch **"다른 캐릭터까지"** adds other characters. **Low power** keeps the switch but searches other characters by name only (no content); the default scope is small enough to stay on. Search runs in idle chunks with cancel. A hit in another character switches the Studio context to it (no chat) with the notice "{이름} 캐릭터로 열었어요".

## 5. Live items: status, undo, restore point (DD-095, DD-100, DD-102)

Applies to every kind marked live in §3.

- **Status** (header, `aria-live=polite`, one announcement per state change): "저장됨" (`check`), "저장 중…" (spinner, after 300 ms of pending only), "저장 안 됨 · 다시 시도" (`alert-triangle`, button retries; the field keeps its text; sticky until retry; further edits queue behind it), "다른 곳에서 바뀜" (below). **requires lane A:** a per-change acknowledgement from the save loop (§11 has the degraded mode).
- **Changed elsewhere (DD-102, F-07, N-04):** the state is kept **per item**, so several can coexist: the chip says "다른 곳에서 바뀜" ("· 2" for two), each changed item carries a `git-compare` marker in the tree, collapsed kind and owner rows roll the count up, and an open item shows a banner "이 항목이 다른 탭이나 기기에서 바뀌었어요. 지금 저장하면 그 변경 위에 덮어써요." with **다시 불러오기** (takes the other version, one History step; the banner says the user's own edit can be brought back with Undo, and undoing that step does) and **내 것 유지** (keeps mine; the next save overwrites). History steps and the restore point never silently undo the other change (below).
- **Undo/redo:** one history per **owner** for this Studio visit, covering field edits, add, remove, reorder, enable/disable and applied code. Typing in one field coalesces into one step after ~1 s pause. Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) outside text fields; inside a text field the browser's own undo runs first (until the field is back at the value it had when focused), then the owner history. The header buttons always act on the owner history, **named with the owner** in label and tooltip ("세라핀: 되돌리기: 정규식 '말투' 삭제"); with no owner selected they say "항목이나 소유자를 고르면 되돌리기를 쓸 수 있어요". The code editor has its own text history (its toolbar buttons are named "편집기 되돌리기…"); typing inside it is not an owner step, Apply, Discard and Use-applied-version are. Forward steps in History read "다시 실행: …" as visible text.
- **Delete (DD-100, F-14)** never asks first (also for live Lua and plugin code): it removes, shows **one toast per delete** (up to three stack; each pauses while hovered or focused and lasts 6 s) with Undo, and moves focus to the next row (or the previous one), never to the page. **The undo is durable:** the toast's Undo and the History panel's "삭제한 항목" list restore that exact item (with its draft and prior list) at its old position even after later edits; the list lasts until Studio is closed. Ctrl+Z restores it while it is still the latest step.
- **Restore point:** the first edit to an owner in a Studio visit snapshots it. `⋯` › "스튜디오를 연 시점으로 되돌리기" shows a summary of changes since (counts per kind, changed items listed) and restores in one undoable step. **Items changed elsewhere since are listed with a "되돌리지 않기(내 편집도 유지)" switch, on by default**: with it on the item stays exactly as it is now, **including the user's own edits to it**; with it off, the user's edits and the change from elsewhere are both undone (the sheet says so). History reverts apply the same protection; undo and redo of ordinary steps keep only the field that changed elsewhere.
- **History panel** (side panel tab): this visit's steps per owner, newest first; choosing a step reverts to it (one undoable step); lists deleted items; says that drafts and history stay on this device (§6).
- Chat effect: live changes reach the context chat on its next generation, as today; no reload prompt.

## 6. Code items: draft, Check, Apply (DD-095, DD-099)

Applies to `스크립트` in **Lua mode** and to plugin code (and any future code kind). V2/V1 rules are live items.

- The editor is **`mockups/studio.html`'s editor and lint engine** (DD-092), ported without changing rule behaviour (`studio/lint.js` is generated byte for byte from it): Problems, quick fixes, Find/Replace, Test (simulated), completion, undo. Rule titles and messages stay English source text (marked `lang="en"`), the interface around them is Korean/English.
- Editing creates a **draft**; the live version keeps running in chats. Header status "초안 · 적용 안 됨" (`file-pen`); the tree item gets `•`; the owner row says "초안 n개". A draft exists exactly while its text differs from the applied text.
- **Device-only (DD-099, F-09):** drafts, owner history, prior script lists and the replaced live versions are stored **on this device only** and never in exports, character cards or sync. The draft banner says so ("초안과 기록은 이 기기에만 저장돼요…"), as does the History panel. If the device cannot store a draft the banner says "초안을 이 기기에 저장하지 못했어요. 창을 닫으면 사라질 수 있어요" (**requires lane A** for the store itself; the message is the fallback).
- **Check** (`shield-check`, Ctrl+S) runs the linter under the owner's **real** low-level setting and stamps the draft "검사함 · 오류 0". **Apply** (`upload`) is enabled when the latest Check has no errors (warnings allowed, listed in the confirm). A Check made under the editor's "assume low-level access on" what-if is shown as "가정 기준" and **cannot** be applied.
- **Why Apply is disabled is visible text beside it (F-08):** "검사해서 오류가 0개일 때 적용할 수 있어요", or for the what-if "가정 기준 검사는 적용에 쓸 수 없어요. 실제 설정으로 다시 검사해 주세요" with a link **낮은 수준 접근 설정 열기** to the owner's 고급 kind (character and module both have one; Studio never changes the flag from a Check).
- Apply asks once, replaces the live version, announces "적용됨", and the previous live version is kept (a History step, and device-only as the owner's *previous applied version* until the next Apply, reopenable as a draft from the item `⋯`).
- **Discard draft** in `⋯` (undoable toast).
- Drafts persist across leaving Studio and reloading (device-local). Leaving with drafts never blocks; the tree and owner rows show them on return.
- **Conflict (F-19):** if the live version changed elsewhere after the draft started, Apply opens the conflict view (E03): focus starts on the comparison; the choices run from the safest: **적용된 버전 쓰기** (discard my draft, open the applied version; undoable), **내 것 따로 보관** (my draft kept as a new item, or for scripts as the stored prior list), **내 것 유지** (my draft may be applied; the current applied version is kept as the previous applied version), 취소.
- Lua's low-level access is never changed by Studio (2026-10-17 decision); LUA-E01 links to the owner's setting (character and module 고급).

## 7. Test panel frame (DD-089 "no test")

Side panel tab **테스트**; this slice builds the frame and two working testers, later slices add the rest:

- Frame: an input area ("시험할 메시지"), a run button (`play`), a result area with a status line ("결과 · 방금 · 초안 기준" / "… 적용된 버전 기준"), and a scope line naming what ran. Results are labelled with the revision they ran on; editing after a run marks the result "이전 내용 기준" (stale).
- Working in slice 1: **CBS preview** for any long-text field of a live item (today's popup-editor preview, moved here, with the toggles that affect it shown as switches; `{{char}}`, `{{user}}` and `{{lastusermessage}}` are filled in, other macros stay literal) and **code Test** from `studio.html` for Lua/plugin drafts (simulated).
- Placeholders: regex, lorebook match and script/trigger testers say which slice will add them.

## 8. Placeholder forms in this slice

To exercise §5-6 the editor area hosts simple forms, clearly marked "임시 양식 · 다음 단계에서 다시 디자인": 기본 정보 (name, description, first message as plain textareas that grow with content), one regex item (name, find, replace, stage), one lorebook entry (keys, content), a toggle-definition text field (the builder is a later slice, DD-091), a V2 rules text field (script mode V2), a 고급 form (text and the low-level switch), Lua and plugin code (the real ported editor).

## 9. Keyboard, motion, low power, accessibility

- Panes: F6 / Shift+F6 cycles tree → editor → side panel → header. **Ctrl+K** search (no Ctrl+P: it is the global preset switcher); Ctrl+S on a draft = Check (live items have nothing to save: Ctrl+S announces "자동으로 저장돼요"); Ctrl+Enter on a checked draft = Apply (asks once). Esc: closes search/menus/sheets, then leaves a text field to the item, then nothing (never leaves Studio; Back does). In the code editor the first Esc arms "Tab leaves the editor" (keyboard-trap safe), the second Esc returns to the item.
- Focus: opening an item puts focus on its first field; Back from an item (phones) returns focus to its tree row; after a delete focus goes to the next or previous row.
- Motion: drawer/sheet motion from chat slice 1 tokens; status changes cross-fade; reduced motion and low power make all of it instant. No layout animation. Only `transform` and `opacity` are transitioned.
- Touch targets 44 dp (including the tree add button); tree rows 44 dp on touch, 32 px with a fine pointer.
- Floor devices: the tree renders collapsed owners without their items and patches only the rows that changed per keystroke; search runs on idle chunks with a cancel; other-character content search is off in low power.

## 10. Korean copy (proposed keys, en / ko) — additions in rev 2

Rev 1 keys stand (`studioTitle`, `studioOpenIn`, owner and kind names, save and draft keys, test keys; the kind keys now read `studioKindScripts` = Scripts / 스크립트 and drop Lua/Trigger). New or changed:

| Key | en | ko |
|---|---|---|
| studioMerged / studioMergedOrdered / studioMergedUnverified | Combined / Applied in this order / The run order is not verified yet, so there are no numbers | 합쳐서 보기 / 적용 순서 / 실행 순서는 아직 확인되지 않아 번호를 붙이지 않아요 |
| studioScriptMode / modes | Script mode / V2 rules, Lua, V1 | 스크립트 방식 / V2 규칙, Lua, V1 |
| studioPriorKept / PriorRestore | Kept the previous {mode} list. It stays on this device only / Restore | 이전 {모드} 목록을 보관했어요. 이 기기에만 있어요 / 복원 |
| studioOff | Off | 꺼짐 |
| studioSearchWide | Include other characters | 다른 캐릭터까지 |
| studioPeerTitle / PeerReload / PeerKeep | Changed elsewhere / Reload / Keep mine | 다른 곳에서 바뀌었어요 / 다시 불러오기 / 내 것 유지 |
| studioRestoreSkip | Do not restore (keeps my edits too) | 되돌리지 않기(내 편집도 유지) |
| studioDraftLocal | Drafts and history stay on this device only. They are not in exports, cards or sync | 초안과 기록은 이 기기에만 저장돼요. 내보내기·카드·동기화에는 들어가지 않아요 |
| studioDraftStoreFail | Could not store the draft on this device… | 초안을 이 기기에 저장하지 못했어요. 창을 닫으면 사라질 수 있어요 |
| studioTakeApplied / CopyAside / KeepMine | Use the applied version / Copy mine aside / Keep mine | 적용된 버전 쓰기 / 내 것 따로 보관 / 내 것 유지 |
| studioRestorePoint | Restore to when Studio was opened | 스튜디오를 연 시점으로 되돌리기 |
| studioStoredLists / ScriptNames | Stored lists / Lua script, V2 rules | 보관 중인 목록 / Lua 스크립트, V2 규칙 |
| studioPeerCount | Changed elsewhere · {n} | 다른 곳에서 바뀜 · {n} |
| studioLeaveFailTitle / Retry / Anyway / Stay | Some changes were not saved / Try again / Leave anyway / Stay | 저장되지 않은 변경이 있어요 / 다시 시도 / 그냥 나가기 / 머무르기 |
| studioDeletedItems | Deleted items | 삭제한 항목 |
| studioWhyCheck / WhyAssume / OpenLowSetting | (reasons beside Apply, section 6) | 검사해서 오류가 0개일 때 적용할 수 있어요 / 가정 기준 검사는… / 낮은 수준 접근 설정 열기 |
| studioNotFound / DeepKindFallback | Not found / That kind does not exist in {owner}. Opened the {owner} root | 찾을 수 없어요 / 그 종류는 {owner}에 없어요. {owner} 루트로 열었어요 |

## 11. Integration map (lane A; nothing here edits these files)

| App file | Change |
|---|---|
| New route/screen `Studio` | §1-2; replaces the character sidebar editor, module editor page and preset text fields as authoring hosts (they become deep links) |
| `lib/SideBars/CharConfig.svelte`, `Setting/Pages/Module/*`, `PromptSettings.svelte` | Entry rows link into Studio; forms move in later slices |
| `ts/globalApi.svelte.ts:1531-1613`, `ts/storage/saveScheduler.ts` | Per-change save acknowledgement (or failure) the status chip can show |
| New: per-owner history + restore point store | §5 |
| New: code drafts store (owner, kind, item, base revision, text, last Check, previous applied version, prior script lists) | §6; DEFERRED ST-03/ST-06 direction |
| `Scripts/TriggerList.svelte:33-39` | Mode switch keeps the previous list instead of wiping it |
| `ModuleSettings.svelte:163-169` | Do not store a module before it is named |
| Module editor | A 고급 host for the module's low-level access flag (`ModuleMenu.svelte:365`) |
| Editor: `MonacoEditor.svelte`, `cbsMonaco.ts`, `luaMonaco.ts`, `pluginListMerge.ts` | Host the ported lint rules (R-09 plan) |
| `src/lang/*.ts` | Keys in §10 |

**What lane A must provide, and what the UI does if it cannot (F-09, F-10, review "promises lane A may not keep"):**

| Promise | requires lane A | Degraded UI if it is not available |
|---|---|---|
| Per-change save acknowledgement and failure (`saved / saving / failed + retry`) | a completion and failure signal from the save loop (`saveScheduler.ts` exposes only `schedule/requestNow/wait/debouncePending` and mark/due/request hooks; nothing reports the end of a save or its failure). Ideal request: `onSaved(changeId)` / `onFailed(changeId, error)`. | The chip says **"자동 저장"** while the loop is pending or running (`debouncePending` or a running flag) and **"저장됨" only after the loop-end event of the last pending change**; failure comes from the existing global failure prompt and shows the sticky "저장 안 됨 · 다시 시도". No per-field promise, no "this edit is saved" claim. |
| Drafts, owner history, prior script lists, replaced live versions | a **device-local** store, never in the main database, exports, character cards, RisuRealm uploads or cloud sync (DD-099) | Drafts live in memory for the visit with the banner "초안을 이 기기에 저장하지 못했어요…"; leaving Studio keeps them in memory until the app closes; no restore point after a reload. |
| Restore point | a visit-start snapshot per owner (device-local) | The "스튜디오를 연 시점으로 되돌리기" menu item is hidden; History still lists steps. |
| Live-item change events (peer tab/device) | an event when a stored item changed elsewhere (today's multi-tab peer-save prompt, `globalApi.svelte.ts:1531-1613`) | No "다른 곳에서 바뀜" state; last write wins and the status never claims otherwise. |
| Module low-level setting host | a 고급 kind (or row) on modules | The Check/Apply reason cannot link to a setting inside Studio; the link opens the module's own settings page. |
| Search across other characters | an index, or chunked scans with cancel | The switch "다른 캐릭터까지" is hidden; default scope (context, off modules, other presets) is unchanged. |
| History rewrite when a script changes elsewhere | invalidate or rewrite the owner's steps | The step list for that owner is cleared with the notice "다른 곳에서 바뀌어서 이 소유자의 기록을 지웠어요". |
| Plugin code editing, hot reload on Apply (O-3) | not designed here | Plugin code is shown read-only with Check available; Apply is hidden. |

## 12. States the mockup shows

Synthetic context: character "세라핀" in chat "등불의 숲", 3 active modules (서술 스타일, 장면 카드, 메모리 도우미) + 2 inactive, preset "기본 롤플레이", 2 plugins, chat lorebook with 3 entries; each module has a 고급 item; scripts: 세라핀 and 서술 스타일 in Lua mode, 메모리 도우미 in V2 mode. Items spread so that the merged views have entries from at least three owners. States (`?state=st-…`): tree default; owner expanded; empty kinds dimmed with 추가; other modules collapsed/expanded; merged view (four groups); search (name, content snippet, 초성, kind chip, wide switch for other characters, off-module hit, no results); item open per kind (basic, regex with error, lore, toggles, V2 script, Lua, plugin); status saved / saving / failed + retry; undo/redo with step names; delete + durable undo (also after a later edit); restore point summary + restore (also with an item changed elsewhere); history panel; script mode switch and restore; Lua draft dirty → Check with errors → fixed → Apply → undo apply; draft persisted after "reload"; draft store failure; code conflict view; live item changed elsewhere; test panel CBS preview and code test, stale result; module "+" name-first; opened from chat (context badges) vs from library (no chat badges); Back returns to origin with focus. 360×740, 412×915, 768×1024, 1280×800; KO/EN; keyboard only; reduced motion; low power; forced colours.

## 13. Open questions

- **O-1** Restore point lifetime and storage (per visit vs time-based) — lane A cost.
- ~~**O-2** merged view for triggers~~ — closed: a scripts group exists (DD-096), unnumbered until the order is verified.
- **O-3** Plugin code editing is new capability (no in-app editor today): where plugin drafts are stored and how hot reload maps to Apply.
- **O-4** Group owners: does a group show its members' items in the tree?
- **O-5** Execution order of scripts and Lua across owners (to number the scripts group).
- **O-6** Detect duplicate toggle keys across owners in the combined view.
- **O-7** Korean translations for the lint rule titles and messages (they are English in slice 1).
- **O-8** Item-level deep links beyond `item=` (fields, lines) for Settings and chat.

## 14. Design defaults to confirm (and decisions made while building)

Studio full-screen on wide screens; resizable tree; empty kinds shown dimmed; combined view per kind (DD-096); one script list per owner (DD-097); search scope context + off modules/presets, switch for other characters (DD-101); status "저장 중…" only after 300 ms; owner-level undo history per visit, header buttons named with the owner; delete without confirm and durable undo (DD-100); restore point per visit, never undoing another change (DD-102); Ctrl+S = Check on drafts; Esc never leaves Studio (double Esc in the code editor returns to the item). Build decisions the reviewer accepted: Check and Apply are icon-only with a visible reason beside Apply; **a Check made under the what-if cannot be applied**; typing in the code editor is the editor's own history, not an owner step; field-first undo is approximated by "changed since focus"; module creation is not an owner history step (its toast Undo works); the CBS preview covers live fields only; the side panel is one bottom sheet for 600-1023 and phones; a wide-search hit in another character switches the context.

## 15. Review findings and where each is fixed

| Finding | Fix (spec section; mockup) |
|---|---|
| F-01 merged order wrong | §3 table: per-kind order with sources, numbers only where verified (DD-096); `buildRows`, `mergeOrder`; check `ST1-merged-order-*` |
| F-02 scripts missing from merged | §3: 스크립트 group (DD-096); `st-merged` |
| F-03 trigger and Lua as separate kinds | §3 scripts kind, §6, §1 deep-link aliases (DD-097); data model `kind: 'scripts', mode`; checks `ST1-scripts-*` |
| F-04 merged rows repeat the kind name | §3: owner leads, keys/mode/name underneath |
| F-05 search dead end | §4: off modules and other presets searched by default, tagged 꺼짐 (DD-101); `ST1-search-off-*` |
| F-06 low power disables the wide switch | §4, §9: switch stays; other characters by name only (DD-101); `ST1-search-lowpower` |
| F-07 live-item conflicts | §5 changed elsewhere, restore protection (DD-102); `st-peer`, `st-restore-peer`, `ST1-peer-*` |
| F-08 Apply reason and module setting | §6 visible reason + link; §3 module 고급; `ST1-apply-why-*` |
| F-09 where drafts live | §6 device-only statement and banner, §11 table (DD-099); `ST1-local-note` |
| F-10 save acknowledgement fallback | §11 table first row: "자동 저장" fallback |
| F-11 phone chrome | §2: one-row header, one-row toolbar, one panel button; `ST1-phone-header-*` |
| F-12 사용 switch everywhere | §2 item toolbar: only kinds with an enabled flag |
| F-13 roll-ups | §3 roll-ups; `ST1-rollup-*` |
| F-14 delete focus/toast/undo | §5 delete (DD-100); `ST1-delete-*` |
| F-15 undo scopes | §5 owner names and editor labels |
| F-16 phone Back from a deep entry | §1 (DD-098); `ST1-entry-phone-*` |
| F-17 add button size and keyboard | §3, §9; shortcut sheet; row menu; `ST1-tree-add-*` |
| F-18 deep link softness | §1 notices and `item=`; `ST1-deep-*` |
| F-19 conflict defaults | §6 order, focus, wording, previous applied version |
| F-20 per-keystroke tree render | §9 patch only changed rows; `ST1-perf-tree-patch` |
| F-21 redundant titles, vague copy | §2 phone title, §3 breadcrumb, §10 copy |
| F-22 history forward steps | §5 "다시 실행: …" |
| N-01 multi-word search | §4 several words (DD-104); `ST1-multiword-*` |
| N-02 one prior slot | §3 scripts kind: one list per mode (DD-103); `ST1-modes-*` |
| N-03 phone status icon | §2 distinct icons, name and failure text; `ST1-status-*` |
| N-04 one global peer slot | §5 per item, marked in the tree, rolled up; `ST1-peer-*` |
| N-05 Back and saves | §1 Back waits or asks; `ST1-leave-*` |
| N-06 restore wording | §5 restore point; `ST1-restore-wording*` |
| N-07 item named like its kind | §3 named by mode; `ST1-script-name-*` |
| N-08 forward steps | §5 visible text; `ST1-forward-text` |
| F-18 notices not observable | §1 persistent notice bar; `ST1-notice-*` |
| Ctrl+P | §4, §9: Ctrl+K only; `ST1-panes-ctrlp-free`, `ST1-ctrlk-*` |
| D-1 .. D-7 | DD-096 .. DD-102 as listed at the top |
| Builder P-1..P-7 | P-1 §2 (phone header), P-2 §3 (merged order, now per kind), P-3 §6 (what-if Check), P-4 §5 (owner history scope), P-5 §1 (deep links), P-6 §4 (wide-search context switch), P-7 §9 (double Esc) |
