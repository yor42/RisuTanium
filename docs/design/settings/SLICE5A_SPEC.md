# Settings & models slice 5a: 단축키, 페르소나, 확장

Status: **draft, revision 1** (2026-10-28). Task: [tasks/2026-10-26-settings-models.md](../tasks/2026-10-26-settings-models.md). Builds on:
- [SLICE1_SPEC.md](SLICE1_SPEC.md) rev 2.1: the shell, rows, search, the changed dot and 기본값으로, and the phone rule for 단축키 in §3.2;
- [SLICE2_SPEC.md](SLICE2_SPEC.md): live save, the undo stack and 최근 삭제 (DS-024), and the slot keys (DS-022, DS-023);
- [SLICE3_SPEC.md](SLICE3_SPEC.md): the picker and Ctrl+M (ENGINE_CHANGES 3-10);
- [SLICE4_SPEC.md](SLICE4_SPEC.md): the explain-only pattern (DS-096) and the 모듈 연동 field (§5.5).

Slice 5 is cut into 5a (this one), 5b (대화 기능) and 5c (the refine pass over the pages slice 1 drew) (DS-100, DS-101, DS-105).

Decisions in [DECISIONS-settings.md](DECISIONS-settings.md):
- **DS-103, 단축키:** press-to-record keys, conflict warnings, reset one or all, and the Ctrl+1–9 preset keys listed. Phones get a read-only list.
- **DS-106, recording:** the whole combo is recorded from one keypress. A conflict names the action that has the combo and offers 바꾸기 (swap) or cancel.
- **DS-107, preset keys:** Ctrl+1–9 become ordinary rebindable rows. Esc and Enter are listed read-only.
- **DS-108, dead actions:** actions with no handler are hidden until they work. Model select (Ctrl+M) is listed once ENGINE_CHANGES 3-10 lands; voice toggle and webcam stay hidden.
- **DS-109, Mac:** Ctrl means ⌘ on Mac and is shown as ⌘. One synced set of keys, with no per-device overrides.
- **DS-110, persona list:** cards with icon, name, the note's first line and the number of chats using the persona. The active persona is marked.
- **DS-111, persona edits:** live save. Removing a persona gives an undo toast.
- **DS-112, plugin rows:** version and API version. Install stays file-only, with no author field and no install from URL.
- **DS-113, plugin safety:** an access line per plugin. Enabling a V2/V2.1 (full-access) plugin asks once.
- **DS-102, DS-104, modules:** library plus a module **info page** with "Studio에서 열기" (Open in Studio). Contents are edited in Studio; there is no second contents editor.
- **DS-114, low-level access:** a '고급 권한' badge on the card and the info page. Turning such a module on asks once.
- **DS-115, where a module is on:** the info page lists all four layers (global, presets, characters, chats), each changeable there or linked to where it is changed.
- **DS-116, creating a module:** a name dialog. The module is added only on 만들기, then its info page offers Studio에서 열기.
- **DS-117, deleting a module:** the confirm gives the usage count, and an undo toast follows.

Earlier decisions that still bind:
- **Live save and undo:** DS-019, DS-024, DS-036 and DS-037 (Ctrl+Z in lists, Alt+Z anywhere in Settings).
- **Store-first (DS-067):** read by id at render time and keep no long-lived copies.
- **Shortcut keys in text fields (DS-023):** Ctrl+P and the slot keys work in text fields, except during IME composition and inline rename.
- **Korean register:** slice 1 §8. No particle directly after a user-chosen name (DS-038). Say "첫 메시지", never "greeting".

Research:
- [research/slice5a-lists.md](research/slice5a-lists.md) (anchors for every "today" fact below);
- [research/today-settings.md](research/today-settings.md) §2 and §6.

**Lane split:**
- **This lane:** the three pages, their search entries, and the module info page.
- **Studio** ([studio/SLICE1_SPEC.md](../studio/SLICE1_SPEC.md)): module contents (lorebook, regex, scripts, toggles, background HTML, display and assets) and the module 고급 kind, which holds the low-level-access flag. Studio links back with `from=settings` to `page=ext&section=ext.modules` / `ext.plugins`.
- **The chat lane:** the per-chat module menu and Bind Persona. This slice only links to them.

Marked **(design default)** = chosen here within the decided intent, open to veto.

## 0. Today (source read)

| Fact | § |
|---|---|
| 25 default hotkeys. Capture stores raw `e.key`, with Ctrl/Shift/Alt as separate unlabelled toggles. No conflict check, no reset, no Cmd, Tab trapped. Three actions have no handler. Ctrl+1–9, Esc and Enter are hard-coded outside the table. Below 768 px the page shows only "screen too small". | 1 |
| The persona grid is icons with no names, and edits reach the list lazily (working copy). Remove is a silent no-op on the last persona. A new image changes the persona `id`, which breaks chat bindings (INFERRED). Export drops `largePortrait`. Per-chat binding exists; per-character binding does not. | 2 |
| Plugin rows never show version or permissions. Install is file-only. The update check is silent. The args panel select shows the letter "a"; the template download is never clicked. Nested buttons sit inside a `role=button` row. | 3 |
| Modules have four enablement layers. Create pushes a nameless module at once. Edit aliases the live object. `lowLevelAccess` sits in the Trigger tab. MCP rows have inert buttons and no visible URL. Delete leaves stale ids. Character-level enable is right-click or long-press only. | 4 |

## 1. Where things live

- **Index entries:** 단축키 (`keys`), 페르소나 (`persona`) and 확장 (`ext`, with sections `ext.plugins`, `ext.modules` and `ext.pluginpages`). Slice 1's "later" banners on these pages go.
- **Sub-pages:**
  - `view=module&id=<id>`: the module info page.
  - `view=persona&id=<id>`: the persona editor. On wide screens it shows beside the list.
  - `view=plugin&id=<id>`: the plugin's settings.
  - Each sub-page is a drill-in with Back, like slice 4's task sub-page.
- **Search:** finds every action name (KO, EN and the code name, e.g. `reroll`, "다시 생성"), each persona, plugin and module by name, and module namespaces. A result opens the row or the sub-page and highlights it.

## 2. 단축키

### 2.1 Layout

- **Groups** (design default; `h3` each):
  - 메시지: the 7 Ctrl+Alt message operations;
  - 이동: settings, home, presets, persona, previous/next character, quick menu, quick settings, loadout, and focus input;
  - 프리셋 슬롯: 1–9 (DS-107);
  - 도구: safe mode, log, request preview and the pop-up editor;
  - 고정 키: Esc and Enter, read-only, with what they do.
- **Rows:**
  - Each row shows the action label (KO/EN), its chord as key caps (e.g. `Ctrl` `Alt` `R`, or `⌘` `⌥` `R` on Mac, DS-109), and a `⋯` menu with 바꾸기, 기본값으로 and 지우기 (unbind).
  - The changed dot marks a chord that differs from the default.
  - A row whose chord is unbound reads "지정 안 됨".
- **Conditional rows:** scrollToActiveChar shows only while its setting is on, as today. Dead actions are not listed (DS-108). Model select appears when the `modelSelect` handler exists; the mockup has a demo toggle for it.
- **Page header:** `rotate-ccw` "모두 기본값으로" opens a confirm that says how many keys change, then gives an undo toast.

### 2.2 Recording (DS-106)

- **Starting:** 바꾸기 (or Enter on the chord) puts the row into recording: "키를 누르세요 · Esc 취소". The chord area becomes a live region.
- **What gets recorded:** the first non-modifier keydown, together with its modifier state, is the new chord. Modifier-only presses update the preview without committing.
- **Keys that can't be recorded:**
  - IME composition (`isComposing`) is ignored.
  - Esc cancels.
  - Tab and Shift+Tab leave recording without change, so focus is never trapped.
  - **Every shortcut needs a modifier (Ctrl, Alt or ⌘) or is an F-key (DS-118).** A bare letter, digit, Enter, Space, Backspace, Delete, Tab, Esc or arrow is refused with its reason: "이 키는 단독으로 쓸 수 없어요 · Ctrl이나 Alt와 함께 눌러요" or, for navigation and editing keys, "이동·편집 키는 단독으로 쓸 수 없어요". Space alone is allowed only for focus input. Shift with a printable key is refused too ("Shift만으로는 쓸 수 없어요"), as are F5, F11 and F12 (browser).
  - A press that is not what it seems is refused with its reason: AltGr ("AltGr은 쓸 수 없어요"), the Windows or Super key (never recorded as Ctrl: "Windows 키는 쓸 수 없어요"), and on a Mac the Control key ("Mac에서는 ⌘를 써요", DS-120).
  - **Recording ends** on Esc, on any click or focus move away from the chord button, and when the window loses focus; typing in the search field is never swallowed (R5-2).
- **Reserved combos:**
  - Browser-reserved combos (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+L, Ctrl+R, Ctrl+Tab, Ctrl+Shift+T/N/W, Alt+F4) are refused with "브라우저가 쓰는 키예요".
  - Two defaults sit on such keys (Ctrl+L log, Ctrl+X pop-up editor). They **stay** as defaults (DS-119) and their rows carry a note ("브라우저가 이 키를 먼저 가져갈 수 있어요" / "텍스트 편집이 이 키를 먼저 가져갈 수 있어요"); recording them anew is still refused.
  - Ctrl+V, Ctrl+C, Ctrl+X, Ctrl+A and Ctrl+Z are refused with "편집 키예요" (design default).
- **Conflicts:** a chord used by another action (fixed keys included) shows an inline warning under the row that names the combo that was pressed: "Ctrl+H · '{action}'에 이미 지정돼 있어요" and what 바꾸기 gives the other action ("바꾸면 '{action}' 키: {old chord | 지정 안 됨}", R5-1). It offers:
  - 바꾸기: give this action the chord and give the other action this action's old chord;
  - 취소.
  - Fixed keys can't be swapped; they only say "고정 키예요".
- **Committing:** saves live, with an undo toast ("단축키를 바꿨어요 · 되돌리기"). Focus returns to the row's chord button.
- **Existing duplicates in stored data:** both rows show the conflict warning on load, with no auto-fix. The banner reads "겹치는 단축키 {n}개".
- **Mac (DS-109, DS-120):** recording reads `metaKey` as the Ctrl slot and shows `⌘`, `⌥` and `⇧`. The physical Control key is not recorded (refused with "Mac에서는 ⌘를 써요"); on other systems the Windows/Super key is never recorded as Ctrl.

### 2.3 Phones and tablets (read-only by input capability, R5-5)

- **Read-only list:** below 768 px with no fine pointer and no keyboard seen, the page shows the same groups and caps as on wide screens, with the banner "키보드를 연결하면 바꿀 수 있어요". No edit control (⋯, 바꾸기, 취소, recording line, reset all) is shown in this state, an open conflict included. A narrow desktop window with a mouse (`hover: hover` and `pointer: fine`) is never read-only.
- **Keyboard detected:** a keydown with Ctrl, Alt or ⌘ (Shift is not a signal: soft keyboards set it) turns editing on. The mockup's demo toggle is `?kbd=1`.
- **Page title:** 단축키, as on wide screens.

## 3. 페르소나

### 3.1 List (DS-110)

- **Cards:** each card has the icon (or an initial on a tinted disc), the name, the note's first line (when notes are on), and "연결된 채팅 {n}개" (explicit bindings only, DS-125). The active persona also says "지정 없는 채팅에도 써요", because it is used wherever no persona is bound.
- **Active persona:** a `check` badge with "사용 중".
- **Layout:** one column on phones, two from 768 px, and a list beside the editor at 1024 px and up.
- **Header:**
  - "+ 페르소나" opens a menu: 새로 만들기, 가져오기 (PNG).
  - A search field appears from 8 personas (design default).
- **Reorder:**
  - drag on a handle (pointer only: the handle is not focusable; the keyboard uses Alt+↑/↓ on the card, R5-9);
  - the menu items "위로" and "아래로";
  - Alt+↑/↓ on a focused card (design default).
- **Choosing a card:** opens the editor. "사용하기" (or the card's menu) makes it active. Opening and activating are separate actions; today one click does both.

### 3.2 Editor (DS-111)

- **Fields, saved live:**
  - the portrait: choose an image, with a "큰 초상화" switch that previews the effect;
  - 이름;
  - 메모, shown only when the advanced `personaNote` is on, and its label hides with it;
  - 설명, a textarea with a character count.
- **Actions:** 사용하기, 내보내기 (PNG), 복제 (design default) and 삭제.
- **Removing:**
  - Delete gives an undo toast and goes into 최근 삭제 (DS-024).
  - On the last persona, delete is disabled with "페르소나가 하나는 있어야 해요". Today it fails silently.
  - Deleting a persona bound to chats says "채팅 {n}개가 이 페르소나로 연결돼 있어요 · 지우면 지금 쓰는 페르소나를 따라가요: {name}" (there is no "기본 페르소나"; DS-125). Deleting the active persona also says which persona becomes the one in use. Undo restores the bindings and the id (DS-122).
  - 영구 삭제 in 최근 삭제 is permanent: it takes the undo step with it, and the toast does not offer undo (R5-8a).
- **New persona:** created as "새 페르소나" (KO) or "New persona" (EN), and selected. Name and description may be empty. Export warns that empty fields are left out; it no longer refuses.
- **Import:** shows a preview card (name, icon, description start). 가져오기 adds and selects it. Several files go in one batch summary.
- **Bindings:** "이 페르소나를 쓰는 채팅" lists bound chats as links (synthetic). The binding itself stays in the chat menu.

### 3.3 Engine notes (for §8)

- An image change must keep the persona `id` (fixes INFERRED broken bindings).
- Export includes `largePortrait` (design default).
- Remove the working copy: the editor writes `personas[i]` directly (DS-067). The live mirror fields (`db.username` and so on) are derived.

## 4. 확장 › 플러그인

### 4.1 List (DS-112, DS-113)

- **Each row:**
  - the name (display name);
  - "v{versionOfPlugin} · API {3.0|2.1|2|1}";
  - an access line (below);
  - a switch "켜짐" whose accessible name is the plugin name (the role carries the state; R5-10), the protected part `settings-plugin-switch`;
  - a `⋯` menu: 설정 (when it has visible args), 업데이트 확인, 설정 파일 (export/import arg values), 내보내기, links (`customLink`), 삭제.
- **No nesting:** the row is not a button around other buttons. Its name is a link to `view=plugin`.
- **Access lines** (DS-113, design-default wording):
  - API 3.0: "제한된 권한 · 허용된 기능만 써요". When `allowedIPC` is present: "+ {n}개 앱 기능".
  - API 2.1/2: "전체 권한 · 저장된 데이터와 캐릭터를 읽고 바꿀 수 있어요", with a warning tone and an `alert-triangle` icon.
  - API 1: "더 이상 지원하지 않아요 · API 3 버전이 필요해요". The switch is disabled; export and delete stay.
- **Enabling a full-access plugin** (V2/V2.1) opens the confirm on **every** off → on, from any path (DS-124): "전체 권한으로 실행돼요" with the plugin name and the access line, 켜기 / 취소. It doesn't ask again while the plugin stays on.
- **Updates:**
  - **Checking (DS-126):** the header `refresh-cw` "업데이트 확인" checks on request; and the page checks by itself at most once a day when it opens (the time is stored). Results are always shown, whichever started the check; a reopen within a day shows the last results without a new check. "업데이트 있음 · v{new}" shows as a row chip with 업데이트, which asks to confirm.
  - A check ends with one of three results:
    - "모두 최신이에요";
    - "{n}개 업데이트 있음";
    - "{n}개를 확인하지 못했어요" with the plugin names. A failed check is never silent.
- **Header:**
  - "+ 플러그인" picks one or more files (`.js`/`.ts`); several files go to a batch review;
  - a `code` menu: 개발 모드로 가져오기, 시작 템플릿 받기 (works; today it is never clicked);
  - the page-top warning, reworded: "플러그인은 앱 안에서 코드를 실행해요 · 믿을 수 있는 것만 설치하세요".
- **Hot-reload:** plugins being hot-reloaded show a "개발 중" chip.
- **Remove (DS-122):** a confirm that says "지우면 플러그인이 저장한 데이터는 되돌리기로도 돌아오지 않을 수 있어요", then an undo toast; undo restores the plugin itself, not data it saved elsewhere. Importing a plugin's settings file is one undo step and says how many values it replaced.

### 4.2 Plugin settings (`view=plugin`)

- **Controls:** schema rows in slice 1's row style:
  - string → text, or a textarea;
  - radio → segmented (≤ 4 options) or select;
  - string[] → select, with real labels (fixes "a");
  - int → number, or a switch (checkbox meta);
  - divider → `h3`, or a separator.
- **Help:** each arg's description sits under it, and the placeholder is kept.
- **Saving:** values commit on blur or Enter (not per keystroke); numbers are validated; live save with undo.
- **Reset:** "기본값으로" per arg where the script declares a default (`//@arg` default), otherwise none (DS-010).
- **Hidden args:** `hidden_` args are not shown.
- **API v1:** shows the not-supported line and nothing else.

## 5. 확장 › 모듈

### 5.1 Library

- **Each row:** the module icon (`puzzle`, or `waypoints` for MCP), the name, a description line (or "설명 없음" in secondary text), and chips:
  - "고급 권한" (DS-114), warning tone;
  - "MCP";
  - the namespace (`at-sign {ns}`);
  - "에셋 {n}";
  - where it's on: "전체", "프리셋", "캐릭터 {n}", "채팅 {n}".
- **Global switch:** accessible name "{module}: 전체에서 사용"; the protected part `settings-module-switch`. Turning on a low-level module confirms first, on every off → on (§5.3).
- **Row `⋯` menu:** 정보, Studio에서 열기, 내보내기, 캐릭터로 변환, 삭제.
- **No more hidden modes:** today's "convert to character" mode and icon-only buttons go.
- **Header:**
  - "+ 모듈" opens a menu: 새로 만들기 (DS-116), 파일 가져오기, MCP 연결.
  - Search covers name, description and namespace.
  - Sort: 이름 / 최근 추가 (design default).
  - Filter chips: 켜진 것, 고급 권한, MCP.
- **MCP rows:** export and Studio에서 열기 are absent from the menu, not inert. The info page shows the MCP URL read-only, has no Studio link at all, and says "MCP 모듈은 내용이 서버에 있어서 Studio에서 고칠 내용이 없어요" where the contents would be (R5-13).

### 5.2 Info page (`view=module&id=`; DS-104, DS-115)

- **Header:**
  - the name, the badges, and the primary button `external-link` "Studio에서 열기";
  - the link is `../studio/slice1.html?owner=module:<id>&from=settings`. Studio's Back returns to `slice1.html?from=studio&page=ext&section=ext.modules&view=module&id=<id>`, which opens that module's info page (R5-15; Studio is asked to pass `view=module&id=` — integration map).
- **기본 정보, saved live:**
  - 이름 (required; empty restores the last name with "이름이 비어 있으면 저장하지 않아요");
  - 설명 (multi-line);
  - 네임스페이스 (a change repaints the 프리셋 layer at once and, if it stops a preset enabling the module, says "프리셋 {n}개에서 더 이상 켜지지 않아요"; no comma or space: presets read a comma-separated list; a bad entry is refused with "쉼표나 공백은 쓸 수 없어요" and restored on leaving), with help: "프리셋의 '모듈 연동'에 이 이름을 쓰면 그 프리셋에서 켜져요";
  - "아이콘 숨기기" (`hideIcon`).
  - These are the same store fields Studio's 기본 정보 edits; store-first, no copies.
- **권한:**
  - read-only, "고급 권한: 켜짐 / 꺼짐", with what it means;
  - the link "Studio에서 바꾸기" (`kind=advanced`), because Studio's 고급 owns the flag (design default; DS-104 keeps contents in Studio).
- **내용, read-only counts:**
  - 로어북 {n}, 정규식 {n}, 스크립트 {n}, 토글 {n}, 에셋 {n}, 배경 HTML 있음/없음 (DS-123: the asset count with its Studio link, as built);
  - each is a link that opens Studio at that kind (`kind=lore|regex|scripts|toggles|display|html`).
  - Asset editing stays in Studio's 표시와 에셋 (design default; DS-104's "assets" is read as showing them here).
- **MCP:** only for MCP modules. The server URL is read-only, with a copy button and "다시 연결" (synthetic).
- **어디서 켜져 있나요** (DS-115). Four rows:
  - **전체:** the global switch.
  - **프리셋:** the presets whose 모듈 연동 text names this namespace, as links to each preset's 모듈 연동 field (slice 4 §5.5). With no namespace: "네임스페이스가 없어서 프리셋으로 켤 수 없어요".
  - **캐릭터:** the characters with it on, each with a remove `x` (undo toast), plus "+ 캐릭터에 켜기", which opens a character picker (synthetic).
  - **채팅:** the chats with it on, each with a remove `x`, plus a link to the chat (synthetic). New chat-level enables stay in the chat menu.
  - A globally-on module dims the character and chat rows with "전체에서 켜져 있어서 따로 켤 필요 없어요" (today's chat menu greys them the same way).
- **ID:** `id`, read-only with copy, in a collapsed "자세히" (design default).
- **Actions:** 내보내기 (CharX recommended / `.risum`), 캐릭터로 변환 (toast with a link, as Studio DD-176), 삭제.

### 5.3 Low-level access (DS-114)

- **Where it shows:** the badge "고급 권한" on the row, the info page and search results.
- **Turning on:** every off → on of such a module, at any layer (global, character, or a namespace edit that makes a preset switch it on) and on every path, asks (DS-124); cancelling a namespace edit restores the field:
  - "'{name}'은 AI 모델과 저장 공간에 직접 접근할 수 있어요";
  - buttons 켜기 / 취소.
- **Import:** keeps today's import confirm. Nothing is written until the whole batch is confirmed; Esc at any step adds nothing and says "가져오기를 취소했어요 · 추가한 모듈은 없어요" (R5-7).

### 5.4 Create, import, delete

- **새로 만들기 (DS-116):** a dialog with 이름 (required), 설명 (optional) and 네임스페이스 (optional). 만들기 adds the module, opens its info page and offers Studio에서 열기. Cancel stores nothing. An undo toast removes it again (Studio's slice 1 has the same rule).
- **파일 가져오기:** `.risum`, `.charx`, `.json` and `.lorebook`, one or several files, with a batch summary. Low-level content confirms (today's copy). A re-import with the same id says "같은 모듈이 있어요 · 바꾸기 / 따로 추가".
- **MCP 연결:** a URL field with suggestions (today's list, KO labels). Accepted schemes are as today; others are refused with a reason. The result is a module named after the server.
- **삭제 (DS-117):**
  - The confirm says "캐릭터 {a}개 · 채팅 {b}개 · 프리셋 {c}개가 이 모듈을 쓰고 있어요".
  - Afterwards an undo toast; the module goes into 최근 삭제 (DS-024).
  - Delete also cleans the character and chat ids (engine note). Undo restores them.

## 6. Store-first (DS-067)

- **Reading:** every page reads personas, plugins, modules and hotkeys from the store by id at render time.
- **External writes:** a write from elsewhere (the chat menu, Studio) shows up on return. Exposed as `__ss5a.storeWrite`.
- **Drafts** exist only for:
  - a text field being typed in;
  - the recording state;
  - an open dialog.
  - Nothing else holds a copy.

## 7. Keyboard, motion, accessibility

- **Chord buttons:** each row's chord is a button with the name "{action}, 단축키 Ctrl Alt R, 바꾸려면 Enter".
  - While recording, the button has `aria-pressed=true`, and the status line announces "키를 누르세요".
  - On commit it announces the new chord or the conflict.
- **Cards and rows:** cards are `listitem`s with one primary link each; actions sit in `⋯`. Persona reordering announces the new position.
- **Switches:** native checkboxes with `role=switch`; the accessible name is the item name only (plugin name; "{module}: 전체에서 사용"), never "켜기" (R5-10). A switch is not an undo step.
- **Dialogs:** focus is trapped while open and returns to the opener afterwards. Esc cancels.
- **Back stack:**
  1. dialog or menu;
  2. recording (Esc cancels);
  3. sub-page;
  4. then slice 1's order.
- **Motion:** card and row insertions fade in at token durations. Reduced motion is a 120 ms crossfade; low power is instant.
- **Targets:** 44 dp on touch.
- **Forced colours:** chips and badges keep borders; the conflict warning keeps its icon and text.
- **Contrast:** the warning tone of the full-access and low-level badges meets 4.5:1 on its surfaces.

## 8. Integration map (Lane A; nothing here edits these files)

| Change | Where |
|---|---|
| Hotkeys:<br>- the chord recorder (key + modifiers from one event, IME and Tab rules);<br>- conflict check and swap;<br>- reserved list;<br>- reset one or all, and unbind;<br>- `metaKey` matching on Mac;<br>- Ctrl+1–9 become table rows (`presetSlot1..9`), with stored rows migrated in;<br>- dead actions hidden. | `HotkeySettings.svelte`, `hotkey.ts:94-139, 309-366, 457-472`, `defaulthotkeys.ts` |
| Persona:<br>- cards with name and binding count;<br>- the working copy retired;<br>- id kept on image change;<br>- export includes `largePortrait`;<br>- remove with undo and the last-persona guard;<br>- binding cleanup on delete. | `PersonaSettings.svelte`, `persona.ts:28-65`, `DefaultChatScreen.svelte:372` |
| Plugins:<br>- row metadata and access line;<br>- full-access confirm;<br>- visible update check results;<br>- args panel fixes (select labels, commit on blur, defaults);<br>- template download fixed;<br>- no nested buttons. | `PluginSettings.svelte`, `plugins.svelte.ts:82-120, 393-420` |
| Modules:<br>- library chips and search over description and namespace;<br>- info page;<br>- create via dialog (no ghost);<br>- delete with usage count, undo and id cleanup;<br>- low-level confirm on enable;<br>- MCP URL shown;<br>- the convert mode retired. | `ModuleSettings.svelte`, `ModuleMenu.svelte` (retired as an editor), `ModuleChatMenu.svelte`, `modules.ts` |
| Studio return link (R5-15): Studio's Back and "설정에서 열기" return to `slice1.html?from=studio&page=ext&section=ext.modules&view=module&id=<id>`. | Studio lane (`studio/slice1.js` back target) |
| Low-level rule for slice 4's 모듈 연동 field (DS-124): adding a namespace that switches a low-level module on through a preset must ask the same critical confirm. | slice 4 `ss4` preset field; `modules.ts` |
| Daily automatic update check (DS-126): last-check time stored, at most one automatic check a day, results always shown. | `plugins.svelte.ts` |
| Strings: about 160 new keys. | `src/lang/en.ts`, `ko.ts` |
| ENGINE_CHANGES.md gains items 5a-1 to 5a-15, the final list in Build notes ("Engine items this slice proposes"). | this lane |

## 9. Korean copy (proposed, ko / en)

Filled by the builder from the mockup's own strings (`checks/tools/gen-copy5a.mjs` writes the rows; the ss5a `koen` section reads them back and fails if the page and this table differ). **Key** is the key in `data5a.js` (`K.ko` / `K.en`); a function key is shown with sample arguments, and `action:<code>` and `group:<section>` are the labels of the shortcut rows and sections. The page never says "greeting".

Rule kept (DS-038): no Korean particle directly after a user-chosen name, so names stand on a line of their own or after a colon. Two wordings of this spec that put a particle after a plugin or module name ("'{name}'은 전체 권한으로 실행돼요" and "'{name}'은 AI 모델과 저장 공간에 직접 접근할 수 있어요") are written as a title plus a name line (`plFullT`, `moLowT`); see Build notes.

| Key | ko | en |
|---|---|---|
| **Shortcuts: groups, refusals, conflicts, resets** | | |
| `group:keys.msg` | 메시지 | Messages |
| `group:keys.nav` | 이동 | Navigation |
| `group:keys.slots` | 프리셋 슬롯 | Preset slots |
| `group:keys.tools` | 도구 | Tools |
| `group:keys.fixed` | 고정 키 | Fixed keys |
| `hkUnbound` | 지정 안 됨 | Not set |
| `hkRecPrompt` | 키를 누르세요 · Esc 취소 | Press a key · Esc to cancel |
| `hkBare` | 이 키는 단독으로 쓸 수 없어요 · Ctrl이나 Alt와 함께 눌러요 | This key can't be used on its own · press it with Ctrl or Alt |
| `hkNavKey` | 이동·편집 키는 단독으로 쓸 수 없어요 | Navigation and editing keys can't be used on their own |
| `hkShiftOnly` | Shift만으로는 쓸 수 없어요 · Ctrl이나 Alt와 함께 눌러요 | Shift alone isn't enough · press it with Ctrl or Alt |
| `hkMacCtrl` | Mac에서는 ⌘를 써요 | On a Mac, use ⌘ |
| `hkSuper` | Windows 키는 쓸 수 없어요 | The Windows key can't be used |
| `hkAltGr` | AltGr은 쓸 수 없어요 | AltGr can't be used |
| `hkSwapOutcome('홈','Ctrl+Alt+R')` | 바꾸면 ‘홈’ 키: Ctrl+Alt+R | Swapping gives “홈”: Ctrl+Alt+R |
| `hkBrowser` | 브라우저가 쓰는 키예요 | The browser uses this key |
| `hkEdit` | 편집 키예요 | This is an editing key |
| `hkAria('다시 생성','Ctrl Alt R')` | 다시 생성, 단축키 Ctrl Alt R, 바꾸려면 Enter | 다시 생성, shortcut Ctrl Alt R, press Enter to change |
| `hkAriaNone('다시 생성')` | 다시 생성, 지정 안 됨, 지정하려면 Enter | 다시 생성, not set, press Enter to set |
| `hkConflict('홈')` | ‘홈’에 이미 지정돼 있어요 | Already used by “홈” |
| `hkAlso('로드아웃')` | ‘로드아웃’에도 지정돼 있어요 | Also used by “로드아웃” |
| `hkFixed('Alt+Z')` | 고정 키예요 · Alt+Z | Fixed key · Alt+Z |
| `hkSwap` | 바꾸기 | Swap |
| `hkSet` | 단축키를 바꿨어요 | Shortcut changed |
| `hkSwapped` | 단축키를 서로 바꿨어요 | Shortcuts swapped |
| `hkCleared` | 단축키를 지웠어요 | Shortcut removed |
| `hkMenuRec` | 바꾸기 | Change |
| `hkMenuReset` | 기본값으로 | Reset to default |
| `hkMenuClear` | 지우기 | Remove |
| `hkResetAll` | 모두 기본값으로 | Reset all to defaults |
| `hkResetNone` | 바꾼 단축키가 없어요 | No shortcut was changed |
| `hkResetAllQ(2)` | 단축키 2개를 기본값으로 되돌릴까요? | Reset 2 shortcuts to the defaults? |
| `hkResetAllBody` | 바꾼 키가 모두 기본 키로 돌아가요. 되돌리기로 다시 바꿀 수 있어요 | Every changed key goes back to its default. You can undo it |
| `hkResetAllDone(2)` | 단축키 2개를 기본값으로 되돌렸어요 | 2 shortcuts reset to the defaults |
| `hkDupBanner(1)` | 겹치는 단축키 1개 | 1 shortcut overlaps |
| `hkPhone` | 키보드를 연결하면 바꿀 수 있어요 | Connect a keyboard to change shortcuts |
| `hkSlotEmpty` | 비어 있음 | Empty |
| `hkSlotWho('균형')` | 이 키에 연결된 프리셋: 균형 | Preset on this key: 균형 |
| **Shortcuts: action labels** | | |
| `action:reroll` | 다시 생성 | Regenerate |
| `action:unreroll` | 이전 답변으로 | Previous reply |
| `action:translate` | 번역 | Translate |
| `action:remove` | 메시지 삭제 | Delete message |
| `action:edit` | 메시지 수정 | Edit message |
| `action:copy` | 메시지 복사 | Copy message |
| `action:send` | 보내기 | Send |
| `action:settings` | 설정 열기 | Open settings |
| `action:home` | 홈 | Home |
| `action:presets` | 프리셋 목록 | Preset list |
| `action:persona` | 페르소나 바꾸기 | Change persona |
| `action:prevChar` | 이전 캐릭터 | Previous character |
| `action:nextChar` | 다음 캐릭터 | Next character |
| `action:quickMenu` | 빠른 메뉴 | Quick menu |
| `action:quickSettings` | 빠른 설정 | Quick settings |
| `action:loadout` | 로드아웃 | Loadout |
| `action:focusInput` | 입력창으로 이동 | Focus the input |
| `action:scrollToActiveChar` | 현재 캐릭터로 스크롤 | Scroll to the active character |
| `action:modelSelect` | 모델 선택 | Select model |
| `action:toggleCSS` | 안전 모드 켜고 끄기 | Toggle safe mode |
| `action:toggleLog` | 로그 켜고 끄기 | Toggle log |
| `action:previewRequest` | 요청 미리보기 | Preview request |
| `action:popupEditor` | 팝업 편집기 | Popup editor |
| `action:esc` | 창 닫기 | Close |
| `action:enter` | 확인 | Confirm |
| `action:undoLib` | 프리셋 목록에서 되돌리기 | Undo in the preset list |
| `action:undoAlt` | 마지막 작업 되돌리기 | Undo the last action |
| **Personas** | | |
| `perCount(6)` | 페르소나 6개 | 6 personas |
| `perChats(2)` | 연결된 채팅 2개 | 2 linked chats |
| `perChatsActive(0)` | 연결된 채팅 0개 · 지정 없는 채팅에도 써요 | 0 linked · also used where no persona is set |
| `perActive` | 사용 중 | In use |
| `perAdd` | 페르소나 | Persona |
| `perNew` | 새로 만들기 | Create new |
| `perImportMenu` | 가져오기 (PNG) | Import (PNG) |
| `perSearch` | 페르소나 찾기 | Find a persona |
| `perUp` | 위로 | Move up |
| `perDown` | 아래로 | Move down |
| `perMoved('주노',2,6)` | 주노: 6개 중 2번째 | 주노: 2 of 6 |
| `perNoName` | (이름 없음) | (no name) |
| `perNewName` | 새 페르소나 | New persona |
| `perName` | 이름 | Name |
| `perNote` | 메모 | Note |
| `perDesc` | 설명 | Description |
| `perDescCount(40)` | 40자 | 40 characters |
| `perLarge` | 큰 초상화 | Large portrait |
| `perUse` | 사용하기 | Use |
| `perUsed` | 사용 중이에요 | In use |
| `perExport` | 내보내기 (PNG) | Export (PNG) |
| `perExportEmpty` | 이름이나 설명이 비어 있어요 · 빈 항목은 빼고 내보내요 | The name or description is empty · empty fields are left out |
| `perDup` | 복제 | Duplicate |
| `perDelete` | 삭제 | Delete |
| `perDelTitle` | 페르소나를 지울까요? | Delete this persona? |
| `perDeleted` | 페르소나를 지웠어요 | Persona deleted |
| `perLast` | 페르소나가 하나는 있어야 해요 | There must be at least one persona |
| `perBoundQ(2,'주노')` | 채팅 2개가 이 페르소나로 연결돼 있어요 · 지우면 지금 쓰는 페르소나를 따라가요: 주노 | 2 chats are linked to this persona · after deleting it they follow the persona in use: 주노 |
| `perNewActive('주노')` | 지금 쓰는 페르소나가 바뀌어요: 주노 | The persona in use changes to: 주노 |
| `perBoundNoneActive` | 연결한 채팅이 없어요 · 지정 없는 채팅에서 써요 | No linked chats · used in chats with no persona set |
| `perBoundList` | 이 페르소나를 쓰는 채팅 | Chats that use this persona |
| `perBoundNone` | 연결한 채팅이 없어요 | No linked chats |
| `perBoundHint` | 연결은 채팅 메뉴에서 바꿔요 | The binding is changed in the chat menu |
| `perImportTitle` | 페르소나 가져오기 | Import a persona |
| `perImportBad` | 페르소나 정보가 없는 파일이에요 | This file has no persona data |
| `perImportSummary(1,1)` | 가져올 파일 1개 · 건너뛸 파일 1개 | 1 to import · 1 skipped |
| `perImportDone(1)` | 페르소나 1개를 가져왔어요 | Imported 1 persona |
| **Plugins** | | |
| `plWarn` | 플러그인은 앱 안에서 코드를 실행해요 · 믿을 수 있는 것만 설치하세요 | Plugins run code inside the app · install only ones you trust |
| `plAdd` | 플러그인 | Plugin |
| `plDevImport` | 개발 모드로 가져오기 | Import in development mode |
| `plTemplate` | 시작 템플릿 받기 | Get the starter template |
| `plTemplateDone` | 시작 템플릿을 받았어요 | Starter template saved |
| `plCheck` | 업데이트 확인 | Check for updates |
| `plChecking` | 확인하는 중… | Checking… |
| `plAllLatest` | 모두 최신이에요 | Everything is up to date |
| `plSomeUpd(2)` | 2개 업데이트 있음 | 2 updates available |
| `plFailed(1,'Count Words')` | 1개를 확인하지 못했어요: Count Words | Could not check 1: Count Words |
| `plMeta("1.2.3","3.0")` | v1.2.3 · API 3.0 | v1.2.3 · API 3.0 |
| `plAccLimited` | 제한된 권한 · 허용된 기능만 써요 | Limited access · only the features it is allowed |
| `plAccIpc(2)` | + 2개 앱 기능 | + 2 app features |
| `plAccFull` | 전체 권한 · 저장된 데이터와 캐릭터를 읽고 바꿀 수 있어요 | Full access · can read and change stored data and characters |
| `plAccV1` | 더 이상 지원하지 않아요 · API 3 버전이 필요해요 | No longer supported · needs an API 3 version |
| `plOn` | 켜짐 | On |
| `plOff` | 꺼짐 | Off |
| `plSwAria('Dice Roller')` | Dice Roller | Dice Roller |
| `plDevChip` | 개발 중 | In development |
| `plUpdChip("2.1.0")` | 업데이트 있음 · v2.1.0 | Update available · v2.1.0 |
| `plUpdBtn` | 업데이트 | Update |
| `plUpdQ` | 업데이트할까요? | Update the plugin? |
| `plFullT` | 전체 권한으로 실행돼요 | It runs with full access |
| `plFullNote` | 켜면 저장된 데이터와 캐릭터를 읽고 바꿀 수 있어요. 믿을 수 있는 플러그인만 켜세요 | When on, it can read and change stored data and characters. Turn on only plugins you trust |
| `plFullOn` | 켜기 | Turn on |
| `plRemoveT` | 플러그인을 지울까요? | Delete this plugin? |
| `plRemoveNote` | 지우면 플러그인이 저장한 데이터는 되돌리기로도 돌아오지 않을 수 있어요 | Data the plugin saved may not come back, even with undo |
| `plFileReplaced(2)` | 2개 값을 바꿨어요 | 2 values replaced |
| `plLuFile('Dice Roller')` | 플러그인 설정 파일: Dice Roller | Plugin settings file: Dice Roller |
| `plRemoved` | 플러그인을 지웠어요 | Plugin deleted |
| `plMenuSettings` | 설정 | Settings |
| `plMenuCheck` | 업데이트 확인 | Check for updates |
| `plMenuFile` | 설정 파일 | Settings file |
| `plMenuExport` | 내보내기 | Export |
| `plMenuDelete` | 삭제 | Delete |
| `plNone` | 설치한 플러그인이 없어요 · + 플러그인으로 파일을 골라요 | No plugins installed · pick a file with + Plugin |
| `plArgReset` | 기본값으로 | Reset to default |
| `plArgDefault("d20")` | 기본값 d20 | Default d20 |
| `plArgNum` | 숫자로 입력해요 | Enter a number |
| `plArgRange(2,100)` | 2에서 100 사이의 숫자로 입력해요 | Enter a number from 2 to 100 |
| `plNoArgs` | 바꿀 수 있는 설정이 없어요 | Nothing to change here |
| **Modules** | | |
| `moNone` | 모듈이 없어요 | No modules |
| `moNoMatch` | 찾는 모듈이 없어요 | No module matches |
| `moSearch` | 모듈 찾기 | Find a module |
| `moSortName` | 이름 | Name |
| `moSortRecent` | 최근 추가 | Recently added |
| `moFiltOn` | 켜진 것 | On |
| `moFiltLow` | 고급 권한 | Advanced access |
| `moFiltMcp` | MCP | MCP |
| `moAdd` | 모듈 | Module |
| `moMenuNew` | 새로 만들기 | Create new |
| `moMenuImport` | 파일 가져오기 | Import files |
| `moMenuMcp` | MCP 연결 | Connect MCP |
| `moNoDesc` | 설명 없음 | No description |
| `moBadgeLow` | 고급 권한 | Advanced access |
| `moChipAssets(24)` | 에셋 24 | 24 assets |
| `moWhereGlobal` | 전체 | Everywhere |
| `moWherePreset` | 프리셋 | Preset |
| `moWhereChars(1)` | 캐릭터 1 | 1 character |
| `moWhereChats(2)` | 채팅 2 | 2 chats |
| `moSwAria('주사위 규칙')` | 주사위 규칙: 전체에서 사용 | 주사위 규칙: used everywhere |
| `moGlobalSw` | 전체에서 켜기 | Turn on everywhere |
| `moInfo` | 정보 | Info |
| `moStudio` | Studio에서 열기 | Open in Studio |
| `moExport` | 내보내기 | Export |
| `moConvert` | 캐릭터로 변환 | Convert to a character |
| `moDelete` | 삭제 | Delete |
| `moBasic` | 기본 정보 | Basics |
| `moName` | 이름 | Name |
| `moDesc` | 설명 | Description |
| `moNs` | 네임스페이스 | Namespace |
| `moNsHelp` | 프리셋의 '모듈 연동'에 이 이름을 쓰면 그 프리셋에서 켜져요 | Write this name in a preset's 'Module integration' and the module turns on in that preset |
| `moNsBad` | 쉼표나 공백은 쓸 수 없어요 | No commas or spaces in a namespace |
| `moNsLost(1)` | 프리셋 1개에서 더 이상 켜지지 않아요 | Turned off in 1 preset |
| `moMcpNoStudio` | MCP 모듈은 내용이 서버에 있어서 Studio에서 고칠 내용이 없어요 | An MCP module keeps its content on the server, so there is nothing to edit in Studio |
| `moImpCancelled` | 가져오기를 취소했어요 · 추가한 모듈은 없어요 | Import cancelled · no module was added |
| `moHideIcon` | 아이콘 숨기기 | Hide the icon |
| `moNameEmpty` | 이름이 비어 있으면 저장하지 않아요 | An empty name is not saved |
| `moPerm` | 권한 | Permission |
| `moPermOn` | 고급 권한: 켜짐 | Advanced access: on |
| `moPermOff` | 고급 권한: 꺼짐 | Advanced access: off |
| `moPermOnHelp` | AI 모델과 저장 공간에 직접 접근할 수 있어요 | It can reach the AI model and your storage directly |
| `moPermChange` | Studio에서 바꾸기 | Change in Studio |
| `moContent` | 내용 | Content |
| `moLore(12)` | 로어북 12 | Lorebook 12 |
| `moRegex(2)` | 정규식 2 | Regex 2 |
| `moScripts(5)` | 스크립트 5 | Scripts 5 |
| `moToggles(3)` | 토글 3 | Toggles 3 |
| `moHtml(false)` | 배경 HTML 없음 | Background HTML: no |
| `moMcpUrl` | 서버 주소 | Server address |
| `moReconnect` | 다시 연결 | Reconnect |
| `moWhere` | 어디서 켜져 있나요 | Where it is on |
| `moLayerGlobal` | 전체 | Everywhere |
| `moLayerPreset` | 프리셋 | Presets |
| `moLayerChars` | 캐릭터 | Characters |
| `moLayerChats` | 채팅 | Chats |
| `moNoNs` | 네임스페이스가 없어서 프리셋으로 켤 수 없어요 | There is no namespace, so a preset can't turn it on |
| `moNoPreset` | 이 이름을 쓰는 프리셋이 없어요 | No preset names this namespace |
| `moAddChar` | 캐릭터에 켜기 | Turn on for a character |
| `moOffFor('세라핀')` | 끄기: 세라핀 | Turn off: 세라핀 |
| `moDimmed` | 전체에서 켜져 있어서 따로 켤 필요 없어요 | It is on everywhere, so there's no need to turn it on here |
| `moDetails` | 자세히 | Details |
| `moLowT` | AI 모델과 저장 공간에 직접 접근할 수 있어요 | It can reach the AI model and your storage directly |
| `moLowTAll` | 전체에서 켤까요? | Turn it on everywhere? |
| `moLowTChar` | 이 캐릭터에서 켤까요? | Turn it on for this character? |
| `moLowTPreset` | 프리셋의 모듈 연동으로 켤까요? | Turn it on through a preset link? |
| `moLowLineChar('세라핀')` | 캐릭터: 세라핀 | Character: 세라핀 |
| `moLowLinePreset('dice-rules')` | 네임스페이스: dice-rules | Namespace: dice-rules |
| `moLowOn` | 켜기 | Turn on |
| `moNewT` | 새 모듈 | New module |
| `moNewName` | 이름 | Name |
| `moNewDesc` | 설명 (선택) | Description (optional) |
| `moNewNs` | 네임스페이스 (선택) | Namespace (optional) |
| `moNewNeed` | 이름을 입력해야 만들 수 있어요 | Enter a name to create the module |
| `moNewDo` | 만들기 | Create |
| `moNewDone` | 모듈을 만들었어요 | Module created |
| `moDelT` | 모듈을 지울까요? | Delete this module? |
| `moDelUse(1,0,1)` | 캐릭터 1개 · 채팅 0개 · 프리셋 1개가 이 모듈을 쓰고 있어요 | 1 character, 0 chats and 1 preset use this module |
| `moDelNone` | 쓰고 있는 곳이 없어요 | Nothing uses it |
| `moDeleted` | 모듈을 지웠어요 | Module deleted |
| `moExportCharx` | CharX (권장) | CharX (recommended) |
| `moImpDup` | 같은 모듈이 있어요 | The same module exists |
| `moImpDupAsk("dice-rules.charx")` | dice-rules.charx: 같은 모듈이 이미 있어요 · 바꾸기 / 따로 추가 | dice-rules.charx: the same module is already here · replace / add separately |
| `moImpReplace` | 바꾸기 | Replace |
| `moImpSep` | 따로 추가 | Add separately |
| `moImpSkip` | 건너뛰기 | Skip |
| `moImpLowQ` | 이 콘텐츠는 고급 권한(Low Level Access)을 써서 AI 모델과 저장 공간에 직접 접근할 수 있어요. 정말 가져올까요? | This content uses Low Level Access, which means it can reach the AI model and your storage directly. Do you really want to import it? |
| `moImpBad` | 지원하지 않는 형식이에요 | Not a supported format |
| `moMcpT` | MCP 연결 | Connect MCP |
| `moMcpDo` | 연결 | Connect |
| `moMcpErrEmpty` | 주소를 입력해야 해요 | Enter an address |
| `moMcpErrHttp` | http는 이 기기(localhost)에서만 쓸 수 있어요 | http works only on this device (localhost) |
| `moMcpErrScheme` | 지원하지 않는 주소예요 · https, internal, stdio, plugin 중 하나로 시작해야 해요 | Unsupported address · it must start with https, internal, stdio or plugin |
| **Shared** | | |
| `undo` | 되돌리기 | Undo |
| `cancel` | 취소 | Cancel |
| `trashBtn` | 최근 삭제 | Recently deleted |
| `restore` | 복원 | Restore |
| `purge` | 영구 삭제 | Delete for good |
| `trashEmpty` | 최근에 지운 항목이 없어요 | Nothing was deleted recently |

Empty states: the page keeps `perLast` where an empty persona list would be (there is always one), `plNone` and `moNone` for no plugins and no modules, and `moNoMatch` / `perNone` when a search matches nothing (all in the rows above or in `data5a.js`).

## 10. The mockup

### 10.1 Files

- **New files:** `settings/slice5a.html`, `slice5a.css`, `slice5a.js` and `data5a.js`. They load slices 1–4 and extend them through `window.SS1_EXT` and the existing hooks. Slice 1's later banners for `keys`, `persona` and `ext` are replaced.
- **Earlier slices:** if their files get hooks, **ss1–ss4, th and th4 stay green**.
- **Data:** synthetic only, with no network. Plugin "code" is a stub string; nothing runs. The update check, MCP connect, import and export are simulated. Studio links point at the real Studio mockup path (it may not open the exact module; that is fine).

### 10.2 Fixtures (`?set=`)

| Set | Contents |
|---|---|
| `demo` | **Hotkeys:** the 25 defaults minus the 3 dead ones, plus Ctrl+1–9. One user duplicate (two actions on Ctrl+K). scrollToActive on. Model select hidden (toggle `?msel=1`).<br>**Personas:** 6, with mixed KO/EN names; one empty description; 2 without an icon; one `largePortrait`; one bound to 2 chats; notes on.<br>**Plugins:** 6. API 3.0 ×4 (one with an update; one with 8 args covering every control type, a divider and a default; one with only `hidden_` args), 2.1 ×1, 1 ×1; one hot-reload; two links.<br>**Modules:** 14, three with a namespace, one low-level, one hideIcon, two MCP, asset counts 0–40, 2 global, 1 namespace-matched through a preset, 1 character, 1 chat. |
| `mac` | `demo` with a Mac platform, so ⌘ caps show. |
| `empty` | 1 persona, no plugins, no modules, hotkeys at defaults. |
| `many` | 40 modules and 12 personas, to test search, sort and long lists. |

### 10.3 States (`?state=`)

- **단축키:** `hk-page`, `hk-recording`, `hk-conflict`, `hk-swap-done`, `hk-reserved`, `hk-dup-banner`, `hk-reset-all`, `hk-phone` (360), `hk-phone-kbd`, `hk-mac`.
- **페르소나:** `pe-list`, `pe-editor`, `pe-delete-bound`, `pe-last`, `pe-import-preview`, `pe-reorder`.
- **플러그인:** `pl-list`, `pl-confirm-full`, `pl-update-results`, `pl-settings`, `pl-v1`, `pl-remove`.
- **모듈:** `mo-list`, `mo-filter-lowlevel`, `mo-info`, `mo-info-mcp`, `mo-where`, `mo-lowlevel-confirm`, `mo-create`, `mo-delete`, `mo-import-dup`, `mo-mcp-connect`.
- **Search:** `se-hotkey` (`q=다시 생성`), `se-module-ns` (by namespace), `se-persona`.
- **Parameters:** slice 1's (`lang`, `w`, `reduced`, `lowpower`, `theme`). The page sets `window.__ss5aReady` and exposes `window.__ss5a`.

### 10.4 Checks

The `ss5a` suite lives in `settings/checks/` (sections in `checks/ss5a/`), and `th5a` covers theme readiness. They follow `checks/speed-pass.md` and the slice 4 suite's shape.

**Budget and rules:**
- about 90 s wall at 3 workers;
- at most 3 Chrome workers, one per worker;
- own profiles, deleted afterwards;
- never stop the server on 6141;
- no fixed sleeps;
- a `.timing.json` with `slowest5`;
- KO and EN at 360 / 412 / 768 / 1024 / 1280.

| Section | Covers |
|---|---|
| hkrecord | Chord recording from one event, IME ignored, Esc cancels, Tab leaves, the bare-key rules, reserved and edit-key refusals, Mac caps, focus back to the row |
| hkconflict | Conflict warning, swap (both rows change, one undo step), cancel, fixed keys can't be swapped, the stored-duplicate banner |
| hkreset | Per-row reset and unbind, reset-all confirm with count, undo, the changed dot, presetSlot rows, dead actions absent, scrollToActive follows its setting, model select toggle |
| hkphone | The read-only list under 768 px, keyboard-detected editing, no "too small" page |
| persona | Cards (name, note line, chat count, active), open vs activate, live edits reach the card at once, delete with undo and binding restore, the last-persona guard, import preview, reorder by keys and drag |
| plugin | Row metadata and access lines, full-access confirm once, v1 disabled, update results (all three outcomes), args controls with real labels, commit on blur, defaults, no nested interactive elements, remove with undo |
| modinfo | Info fields live and store-first, Studio links (URL shape for each kind), low-level read-only with the Studio link, content counts, MCP URL |
| modwhere | The four layers, preset links, character add and remove with undo, chat remove, dimming when global |
| modlib | Chips, search over name, description and namespace, sort, filters, menu without inert items, low-level confirm on every enable path |
| modcreate | Create dialog (nothing stored on cancel; undo), import batch and duplicate, MCP connect validation, delete confirm counts, undo, id cleanup |
| store | `__ss5a.storeWrite` from "outside" shows on every page, no stale copies |
| search | Hotkeys by KO, EN and code name, personas, plugins, modules by namespace; a result opens and highlights |
| a11y/modes | Roles and names, Back order, reduced motion and low power, forced colours, 200 % text, 44 dp |
| th5a | Parts and critical marks for the new parts; rendered contrast and ring for the new states in the three looks; pack lint over the new names (registry extension in `checks/th5a/registry5a.mjs`, as slice 4 did) |
| koen, stills, console | As slice 4 |
| regression | ss1–ss4, th and th4 if their files changed |

The builder lists the five slowest sections in `checks/builder-checks-ss5a.md`.

## 11. Open questions

- **O-1:** should a persona have a per-character binding (today: per chat only)? Out of scope unless the maintainer wants it.
- **O-2:** should "Ctrl" on Mac also accept the physical Control key, as well as ⌘? DS-109 says Ctrl means ⌘; the physical Control key is unspecified.
- **O-3:** plugin remove with undo (design default here): can a plugin's own stored data really come back? If not, should the confirm alone stay?

## 12. Design defaults to confirm

These are listed in the order they appear above:
- the hotkey groups;
- the reserved and edit-key lists;
- the persona search threshold and Alt+↑/↓ reorder;
- 복제 on a persona;
- export with `largePortrait`;
- the access-line wording;
- plugin remove with undo;
- module sort and filters;
- low-level flag read-only here, changed in Studio;
- assets as a count with a Studio link;
- the id in 자세히.

## Appendix: Parts (theme readiness, DD-142 to DD-161)

Filled by the builder (2026-10-28) from `slice5a.js`; `checks/th5a/parts.mjs` reads this table and fails if the pages carry a name that is not listed here or in the slice 1 to 4 appendices, if an element carrying a name does not match the Selector, if a main element class carries no part, or if a name is never seen. Slice 5a adds **40 names** (15 critical, 10 safe, 15 reach); the pages also use `settings-section`, `-rows`, `-row`, `-row-label`, `-row-description`, `-field`, `-segmented`, `-page-body`, `-page-header`, `-section-title`, `-jump-chips`, `-warning-banner`, `-button` and the dialog parts of slices 1 to 3. Rows marked **critical** carry `data-part-critical`: a pack cannot name them, so cannot hide or recolour them. **Safe** leaves are never critical, never hold a critical element and never sit inside one (a pack may hide them: the row or the critical part beside them carries what they repeat). **Reach** parts hold critical parts: a pack may restyle them but not hide them.

| Part | Selector | Notes |
|---|---|---|
| `settings-hotkey-row` | `.p5-hk` | one shortcut row (action label, chord, ⋯); `data-changed` (from `.changed`), `data-conflict` while it has a conflict warning; reach |
| `settings-hotkey-chord` | `.p5-chord` | the chord as key caps: a button that starts recording, or a read-only span (fixed keys, phones without a keyboard); `aria-pressed` while recording; **critical** |
| `settings-hotkey-recording` | `.p5-recline` | the live status line while recording ("키를 누르세요 · Esc 취소" or the refusal); **critical** |
| `settings-hotkey-conflict` | `.p5-conflict` | "‘{action}’에 이미 지정돼 있어요" with 바꾸기 and 취소, or the fixed-key line, or the stored-duplicate line (`data-kind` swap / fixed / dup); **critical** |
| `settings-hotkey-conflict-action` | `.p5-confb .btn` | 바꾸기 and 취소 inside the warning: protected children with a name of their own; **critical** |
| `settings-hotkey-banner` | `.banner` | the page banners of the shortcut page ("겹치는 단축키 {n}개", "키보드를 연결하면 바꿀 수 있어요"); **safe** |
| `settings-list-tools` | `.p5-tools` | the bar above a list (add, search, 최근 삭제, update check); **safe** |
| `settings-search-field` | `.p5-search` | the search field of the persona and module lists; **safe** |
| `settings-empty` | `.p5-empty` | the empty state of a list ("설치한 플러그인이 없어요 …", "모듈이 없어요"); **safe** |
| `settings-persona-list` | `.p5-grid` | the card grid (one column on a phone, two from 768 px, beside the editor from 1024 px); reach |
| `settings-persona-card` | `.p5-card` | one persona: icon or initial, name, note line, chat count, active mark; `data-current` (the active persona), `data-selected` (the one open in the editor); reach |
| `settings-persona-handle` | `.p5-handle` | the drag handle; **safe** |
| `settings-persona-active` | `.p5-active` | the check mark with "사용 중"; **critical** |
| `settings-persona-count` | `.p5-cnt` | "채팅 {n}개"; **safe** |
| `settings-persona-editor` | `.p5-ed` | the editor (portrait, name, note, description, actions, bound chats); reach |
| `settings-persona-portrait` | `.p5-portrait` | the portrait button with the 큰 초상화 preview; **safe** |
| `settings-persona-guard` | `.p5-guard` | "페르소나가 하나는 있어야 해요" under the disabled 삭제 of the last persona; **critical** |
| `settings-persona-bound` | `.p5-bound` | "이 페르소나를 쓰는 채팅" with links; **safe** |
| `settings-plugin-list` | `.p5-list` | the plugin list; reach |
| `settings-plugin-row` | `.p5-plrow` | one plugin (name link, version line, access line, switch, ⋯); `data-level` (limited / full / v1), `data-enabled`, `data-dev`; reach |
| `settings-plugin-meta` | `.p5-meta` | "v{version} · API {version}"; **safe** |
| `settings-plugin-chip` | `.p5-chip` | "개발 중" and "업데이트 있음 · v{new}"; **safe** |
| `settings-plugin-access` | `.p5-access` | what the plugin can reach (제한된 권한 / 전체 권한 / 더 이상 지원하지 않아요), also inside the full-access confirm and the batch review; `data-level`; **critical** |
| `settings-plugin-result` | `.p5-updres` | the update-check result ("모두 최신이에요", "{n}개 업데이트 있음", "{n}개를 확인하지 못했어요: …"); a failed check is never silent; `data-kind`; **critical** |
| `settings-plugin-warning` | `.p5-plwarn` | "플러그인은 앱 안에서 코드를 실행해요 · 믿을 수 있는 것만 설치하세요"; **critical** |
| `settings-plugin-args` | `.p5-args` | the body of a plugin's settings page; reach |
| `settings-plugin-arg` | `.p5-arg`, `.p5-argdiv`, `.p5-argsep` | one argument row, a divider title or a bare divider; `data-kind` is the control; `data-changed`; reach |
| `settings-plugin-unsupported` | `.p5-unsup` | the not-supported line of an API 1 plugin's page; **critical** |
| `settings-plugin-switch` | `.p5-plrow .sw` | the switch of a plugin row: the only control that turns the plugin off, so a pack cannot hide it (R5-11); **critical** |
| `settings-module-list` | `.p5-list` | the module library list; reach |
| `settings-module-row` | `.p5-mdrow` | one module (icon, name link, description, chips, switch, ⋯); `data-low`, `data-mcp`, `data-enabled` (on globally); reach |
| `settings-module-badge` | `.p5-badge` | the "고급 권한" badge on a row, the info page and (as text) in search results; **critical** |
| `settings-module-chip` | `.p5-chip` | MCP, the namespace, "에셋 {n}" and where it is on (전체, 프리셋, 캐릭터 n, 채팅 n); **safe** |
| `settings-module-studio` | `.p5-studio` | the primary "Studio에서 열기" link of the info page; **critical** |
| `settings-module-access` | `.p5-perm`, `.p5-lowline` | the 권한 block of the info page ("고급 권한: 켜짐 / 꺼짐" and the link "Studio에서 바꾸기") and the line inside the low-level confirm; `data-low`; **critical** |
| `settings-module-counts` | `.p5-counts` | the content counts as links to Studio; **safe** |
| `settings-module-mcp` | `.p5-mcp` | the MCP server URL (read-only), copy and 다시 연결; **safe** |
| `settings-module-where` | `.p5-where` | the 어디서 켜져 있나요 block; reach |
| `settings-module-layer` | `.p5-layer` | one layer (전체, 프리셋, 캐릭터, 채팅); `.dim` while the module is on globally; reach |
| `settings-module-switch` | `.p5-mdrow .sw`, `.p5-layer .sw` | the global switch of a module row and of the info page; **critical** (R5-11) |

Critical in this slice (`data-part-critical`):
- the shortcut itself and its states: the chord (`settings-hotkey-chord`), the recording line and the conflict warning with its two buttons;
- the active mark and the last-persona guard;
- what a plugin can reach, and how to turn it off: the access line, the page-top warning, the update result, the not-supported line and the plugin's switch;
- what a module can reach, and how to turn it off: the 고급 권한 badge, the permission block, the Studio button and the module's global switch;
- every dialog with a danger button (`settings-dialog`, its backdrop and actions): the full-access confirm, the low-level confirm, the delete confirms and the reset-all confirm.

Why the safe leaves may be hidden: the banner repeats what the rows and the conflict warnings say; the chat count and the chips repeat what the info page and the layers state; the drag handle has 위로 / 아래로 and Alt+↑/↓ as other ways; the bound-chat list is a list of links (the binding itself is changed in the chat menu); the content counts duplicate the Studio button; the version line is repeated on the plugin's page; the empty state's instruction is also the label of the + button; the search field narrows a list that stays complete without it. Parts that hold a control with no other way (the tool bars, the portrait button, the MCP box) are reach tier: restyled, not hidden.

State attributes: `data-changed`, `data-current`, `data-selected`, `data-highlight` and `data-open` are mirrored from classes by `theme.js` (the persona card carries `is-sel` and `cur` for that reason). `data-conflict`, `data-level`, `data-enabled`, `data-dev`, `data-low`, `data-mcp`, `data-kind` are written by the templates in `slice5a.js`, as slice 4 did (the integration moves them into the one mirror table). `th5a` checks each one is on exactly the elements in that state.

New role tokens (declared at the top of `slice5a.css`, read only through `var()`; the main session merges them into `theme-tokens.css`): `--p5-card-min` (the narrowest persona card), `--p5-list-width` (the list beside the editor), `--p5-avatar` and `--p5-avatar-large` (the icon disc), `--p5-portrait-large` (the large portrait preview), `--p5-enter-offset` (the slide of a new card or row), `--p5-warn-bar` (the bar of a conflict warning, an access line and a guard), `--p5-cap-min` (the narrowest key cap), `--p5-field-gap` and `--p5-list-gap` (spacing of the editor and the lists). Everything else reads the existing ladder and `--nexus-*` tokens.

The pack registry (`checks/th/packlint-settings.mjs`) is left as it was; `checks/th5a/registry5a.mjs` extends slice 4's registry with the 40 names (15 critical, 10 safe, 15 reach) and the **floor** (`minimums`, chat DD-182/DD-187, judged over the worst case by DD-195): `--p5-warn-bar` 2px (the smallest bar at which the warning still reads as an edge), in px only. A pack that sets it lower, under a root attribute, inside `@media` or through a `var()` fallback is rejected with "below the critical minimum". The main session lifts the names and `MINIMUMS5` into `packlint-settings.mjs` when slice 5a is integrated.

## Build notes

Built in `slice5a.html/.css/.js` and `data5a.js` (copy and fixtures), checks in `checks/ss5a` and `checks/th5a`. Notes by the builder, not a review. Details, timings and what was not verified: `checks/builder-checks-ss5a.md`.

- **Layering.** Slices 1 to 4 JS/CSS are untouched; slice 5a attaches through the `SS1_EXT` hooks (`pageHTML`, `rendered`, `nav`, `back`, `backLabel`, `headerTitle`, `closing`, `indexExtra`, `lang`, `demoPanel`, `afterInit`, `boot`, `ready`). Outside the new files only `checks/run.mjs` (the `ss5a` and `th5a` suites) and `themes/banana-cocoa.css` (seven part rules for the new cards, none on a critical part) changed; ss1 (`--instant-scroll`), ss2, ss3, ss4, th and th4 were re-run and stay green.
- **Where the data lives (DS-067).** The shortcut rows are rows of slice 1's catalogue (type `key`, `v` = the chord, `d` = the default); the nine preset slot rows read and write slice 2's `SLOTKEY`, so one place holds them. Personas, plugins and modules are the arrays of `SS1_DATA`; characters and chats (with their module and persona bindings) are `SS5A_DATA` stores. Pages read them by id at render time; the view state holds ids, flags and text only (`ss5a/store` checks it). Deleted items live in a per-page 최근 삭제 list for the session (slice 2's trash is preset-shaped).
- **Undo.** Every list action (a shortcut change or swap, reset all, persona create, duplicate, delete, move, import, use, edit; plugin install, update, remove, argument change; module create, import, MCP connect, layer change, edit, delete) is one entry of slice 2's undo stack: its toast, Ctrl+Z in these lists and Alt+Z anywhere in Settings reach it.
- **Deviations from the spec text.** (1) The shortcut groups are `h2`, not `h3`: the page has no section level above them. (2) The two confirm titles that would put a particle after a plugin or module name are written as a title plus a name line (DS-038): `plFullT` "전체 권한으로 실행돼요" and `moLowT` "AI 모델과 저장 공간에 직접 접근할 수 있어요", each with the name beneath. (3) "고급 권한" in search results is a tag in the result's breadcrumb line ("확장 › 모듈 · 고급 권한"), because slice 1's result row has no badge slot; a full-access plugin gets "전체 권한" the same way. (4) The page banner counts overlapping chords, not rows ("겹치는 단축키 1개" for two rows on Ctrl+K). (5) Only Enter and Space alone are refused as bare keys; any other bare key (a letter) is accepted, as the spec lists only those two. (6) Persona drag is a small pointer-event drag of the card in the DOM (one store write on release), not SortableJS. (7) The module preset layer lists and links; adding a namespace through a preset link is done in slice 4's 모듈 연동 field, so the preset path of the low-level confirm is an integration item.
- **Design defaults taken, open to veto.** The reserved lists apply to recording only: the defaults Ctrl+L (log) and Ctrl+X (pop-up editor) are themselves on those lists and stay; "기본값으로" restores them without the reserved check (a conflict with another action still asks). A conflict on a reset to default asks like a recording. On a Mac only the command key fills the Ctrl slot; a physical Control alone adds no modifier (O-2). `?kbd=1` and the demo switch stand for "a hardware keyboard was seen"; the real signals are a keydown with a modifier or a `(pointer: fine)` change.
- **New tokens and parts.** Ten `--p5-*` role tokens (the Appendix) and 40 parts: 15 critical, 10 safe, 15 reach. One floor, `--p5-warn-bar` 2px, in `registry5a.mjs` (units px only, as DD-195 asks). To merge: the tokens into `theme-tokens.css`, the state attributes into the one mirror table (and `is-sel` / `cur` stay the mirrored classes of a card), the names and `MINIMUMS5` into `packlint-settings.mjs`.
- **Engine items this slice proposes (final list, for ENGINE_CHANGES.md as 5a-1 to 5a-15, not written there).** 5a-1 a chord recorder (key and modifiers from one event, IME and Tab rules, reserved list; every shortcut needs a modifier or is an F-key, DS-118; recording ends on click, focus move or window blur); 5a-2 `metaKey` matching on a Mac with the Control key refused, the Windows/Super key never recorded as Ctrl, AltGr refused (DS-120); 5a-3 Ctrl+1–9 as table rows (`presetSlot1..9`) with stored rows migrated in, and the hidden dead actions; 5a-4 persona: no working copy, the id kept on an image change, `largePortrait` in the export, delete with undo, the last-persona guard and binding cleanup; 5a-5 a per-plugin access line from the API version and `allowedIPC`, and the once-per-enable confirm for V2/V2.1; 5a-6 visible update-check results (including failures) and a "check now"; 5a-7 the args panel: real labels on `string[]` selects, commit on blur or Enter, validation, defaults; 5a-8 the starter template download that is actually clicked; 5a-9 the module info page, the name dialog that adds only on 만들기 and delete with usage count, undo and id cleanup; 5a-10 the low-level confirm on every enable path (global, character, preset namespace); 5a-11 the MCP URL stored as readable data and the convert mode retired; 5a-12 the shortcut list is read-only by input capability (`hover/fine`, a keyboard seen) rather than width alone; 5a-13 a stored last-check time and at most one automatic plugin update check a day, results always shown (DS-126); 5a-14 plugin removal that says saved data may not come back, plugin settings-file import as one undo step; 5a-15 namespace rules for modules (no comma or space, a preset layer that follows edits, the low-level confirm when an edit would enable a module through a preset; slice 4's 모듈 연동 field needs the same rule). Integration notes, not engine items: enable switches are not undo steps (a switch is its own undo); and the theme registry has no "restyle but not hide" leaf tier, so the plugin and module switches are critical (cannot be restyled away) while safe leaves can be hidden by a pack.
- **Open for the maintainer** (only what no DS entry decides): the three questions of §11 (O-1 per-character persona binding, O-2 the physical Control key on a Mac, O-3 whether a removed plugin's own stored data can really come back), plus two from the build: whether a bare printable key (a letter with no modifier) may be a shortcut, and whether the defaults Ctrl+L and Ctrl+X should move off the browser and editing keys.
- **Not verified.** See the end of `checks/builder-checks-ss5a.md`: no Note 9 or Raspberry Pi 3, no screen reader, Chrome only, no real keyboard layouts or IME, nothing of the native hotkey engine.
- **Fix round 1 (review R5-1 to R5-27, DS-118 to DS-126).** Decisions applied as written in §2.2, §2.3, §3, §4.1, §5. Notes: undo of a layer switched off restores the accepted state without a new confirm; Shift with a printable key is refused as well as Shift alone (an extra, same reason); the persona drag autoscrolls near the page edge (final round); plugin and module switches are not undo steps (R5-20); the sample plugin check is synthetic, so the once-a-day timer is checked by setting the stored time (R5-24/DS-126). Done as nits: R5-14, R5-16, R5-17, R5-19, R5-21, R5-25, R5-26 (partly), R5-27 (extended). Left: pointer drag with a real touch long-press.
