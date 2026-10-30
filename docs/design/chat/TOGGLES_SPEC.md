# Chat toggles panel

Status: **draft, revision 3** (2026-10-26). Task: [tasks/2026-10-25-chat-conversation.md](../tasks/2026-10-25-chat-conversation.md). Refines the 토글 group of the "This chat" sheet in [SLICE2_SPEC.md](SLICE2_SPEC.md) §3 (scope switch DD-045, scope tags DD-043); uses slice 1 sheets, motion tokens and the KO register. Decisions: DD-077 (own panel), DD-078 (by source), DD-079 (search, filter, favourites, + chips), DD-080 (sized for 20–50), DD-081 (title pill), DD-082 (jailbreak and memory chat-scoped), DD-083 ("on" wording), DD-084 (default open by total), DD-085 (row cap on the default), DD-086 (jailbreak and memory rows under chat-only) in [DECISIONS.md](../DECISIONS.md). Reviews: [review](../reviews/2026-10-26-chat-toggles-review.md), [re-review](../reviews/2026-10-26-chat-toggles-rereview.md). Builder notes: [checks/builder-checks-toggles.md](checks/builder-checks-toggles.md).

Changelog: **rev 3** applies DD-085 (default open capped at about 25 rows), DD-086 (jailbreak and memory rows move into the "이 채팅" group of the This chat sheet while chat-only is on; memory keeps its real type), re-review N-03 (keyboard hint under the search row, fine pointer only), N-04 (result line counts unique keys) and records N-05 (one-jamo rule unchanged). **Rev 2** folds in the rev 1 build deviations (builder notes), review F-01..F-12 and DD-081..DD-084: persistent scope pill, jailbreak/memory in the scope switch, "on" wording instead of "changed", default open by total count, unique-key counts and mixed-type duplicates, debounced search, 초성 rule, keyboard hint, inline segmented controls, dock and 900–1023 px behaviour, chip roles. Rev 1 text that no longer holds is replaced, not kept.

Marked **(design default)** = chosen here within the decided intent, open to veto.

## 0. Today (source-read)

| Fact | Source |
|---|---|
| Toggles come from three texts joined into one: the prompt's `customPromptTemplateToggle`, every enabled module's `customModuleToggle`, and the character's `customModuleToggle`. The source of each toggle is lost. | `src/lib/SideBars/Toggles.svelte:70-92`, `src/ts/process/modules.ts:819-831` |
| Syntax per line `key=label[=type[=options]]`; types: check (default), `select` (comma options), `text`, `textarea`, `caption`, `divider`, `group`…`groupEnd` (collapsible accordion). No default-value syntax. | `src/ts/util.ts:788-828` |
| Values are chat variables `toggle_<key>` (global unless the chat's local switch is on, DD-045). Check = `'1'`/`'0'`, select = option index, text = the string. Unset reads as `'null'`, which the UI cannot tell from off. | `Toggles.svelte:94-176`, `src/ts/parser/chatVar.svelte.ts:90-126` |
| With more than 4 entries the whole list sits in a fixed 192 px (`h-48`) scroll box under the chat list. In that branch the "this chat only" switch is not rendered at all. | `Toggles.svelte:181-224` |
| Extra rows mixed in: the jailbreak toggle (`DBState.db.jailbreakToggle`, a global setting) and the memory toggle (`chara.supaMemory`, per character). Neither is a chat variable today. A 📌 button marks values held locally and removes them. | `Toggles.svelte:185-196, 103-111, 187, 194` |
| Two sources can define the same key; both rows then drive one variable. | inferred from the shared `toggle_<key>` naming |

## 1. Entry points (DD-077)

- **This chat sheet:** the 토글 group becomes one row: `toggle-right` icon, "토글", value "23 toggles · 5 on" / "23개 · 5개 켜짐" (unique variables, §3), `chevron-right`. Its scope tag follows DD-043 (shared → `globe` tag; chat-only → none); the tag wraps below the label when the row is narrow, the label never wraps. Tapping opens the panel.
- **Composer + sheet:** a "토글" item (same counts), plus the **favourite chips** (§5). With stars the item and the chips lead the menu and the sheet uses slice 1's `.tall` (86 %); without stars the item is the last entry.
- **Keyboard:** Ctrl+Shift+T opens the panel from the message box or the chat (design default). Ignored while a sheet or menu is open, on Home, with the phone sidebar open and in other text fields. It is an app-window shortcut: a normal browser tab reserves it for "reopen tab"; the + sheet and the This chat row are the visible paths.
- **Layout:** phones (< 900 px) — slice 2's tall sheet (92 %, drag handle, Back closes, DD-040 stack). 900–1023 px — slice 2's 380 px modal side sheet (backdrop, covers the transcript). ≥ 1024 px (app width) — a 400 px **docked** right panel in the app shell: non-modal, the chat column ends where it starts, no backdrop, the transcript and message box stay usable so effects can be seen in the next reply (design default). Resizing across a threshold moves the panel to the other host and keeps search, filter and section state.

## 2. Panel structure

Top to bottom:

1. **Title bar:** "토글", a scope marker (below), the "saved to" flash (§7), close (`x`).
   - Scope switch off: the `globe` tag "모든 채팅에 적용" (DD-043).
   - Scope switch on: a persistent **"이 채팅" pill** (`message` icon, 44 dp target) replaces the globe tag (**DD-081**). Tapping it scrolls to and focuses the scope switch.
2. **Search field** (`search`) and a **filter chip** "켜진 것만" / "On only" (`filter`) on one row, pinned while the list scrolls. A result line "10개 표시 · 전체 39개" (unique keys, like every other count) appears under it while a search or filter is active. Under it, a one-line keyboard hint "행에서 Shift+F10을 누르면 즐겨찾기 같은 옵션이 나와요. 오른쪽 화살표로 ⋯ 버튼에 갈 수 있어요." is shown **only for a fine pointer** (slice 1's hover-ui state; never on touch, where ⋯ is visible); it sits under the search row so it is found without scrolling (design default).
3. **List** (a named region, "토글 목록"; it takes initial focus on phones, the dock focuses the search field), scrolling, containing in order:
   - the **scope switch** "이 채팅만 따로 설정" with its note ("켜면 지금 값이 복사되고, 이 채팅에서만 바뀌어요" / off: "모든 채팅에 적용돼요"). Always shown (fixes today's missing switch). It scrolls with the list (design default; only the search row is pinned, because pinning title + switch + search leaves about 3 rows at 360×740 with the keyboard up); the pill keeps the mode visible. After switching off, a status row "이 채팅의 설정값을 지웠어요 · 실행 취소" stays for **10 s** (slice 2's inline row uses 6 s; the panel is a longer task, DD-045);
   - the **즐겨찾기** section (§5), only when something is starred and no search/filter is active;
   - the **source sections** (§3);
   
Empty state (no toggles anywhere): title bar and "토글이 없어요" with a line explaining that prompts and modules can add them (no link to editors in this mockup); no search, switch or hint. The summary row value reads "없음".

## 3. Source sections (DD-078, DD-084)

- Order: **프롬프트** (the active prompt's toggles + the jailbreak toggle when used), then **each enabled module by name** in module order, then **캐릭터** (the character's toggles + the memory toggle). Each section header: source icon (`file-text` prompt, `puzzle` module, `user` character), name, the prompt's or character's own name as muted text, and a count "8 toggles · 2 on" / "8개 · 2개 켜짐". Headers stick while their section scrolls. Module sections follow the module switches of the This chat sheet.
- **Counts.** Section and group counts count their own rows. The summary row, the + item and the result line count **unique variables** (keys): a key defined by two sources counts once (rev 1 double counted; review F-08).
- **"On" (DD-083).** Until an author default syntax exists (O-1) the panel does not claim "changed": a toggle is *on* when a check is on, a select is not at its first option, or a text is not empty. Dots, counts and the filter all mean "on".
- **Default open state (DD-084, DD-085).** With up to 20 toggles in total every section starts open. Above that the **first section** opens, then **sections that have a toggle on**, in order, until about **25 rows** show (rows outside folded author groups; a section is added while the running total is below 25); the rest start folded (header + count act as a table of contents). The default is computed when the panel opens and then frozen (switching the last toggle of a section off does not fold it under the user). The user's own open/closed choice is remembered per source (per user, in memory in the mockup) and always wins.
- **Collapsible:** tap the header. Author groups (`group`…`groupEnd`) render as nested collapsible sub-sections inside their source, collapsed by default, with their own counts. `caption` renders as secondary text; `divider` as a labelled rule (today's de-duplication of repeated dividers kept).
- **Duplicate keys** across sources: both rows drive one variable. When the kinds match, each row shows a `link` badge "같은 값: {other source}". When the kinds differ (check vs select) each row shows a warning badge "같은 키, 종류가 달라요: {other source}" and no link badge; the variable is still counted once (lane A: the same `toggle_<key>` collision is an author bug today).
- **100+ toggles:** rows of folded sections and groups are not rendered; open rows use `content-visibility:auto` with an intrinsic size, so off-screen rows are skipped by the engine (no JS windowing; design default). Floor WebViews (Android 10 / Chromium < 85, Pi 3 Chromium): `content-visibility` is ignored and rows simply render (cost bounded by the folded sections); flex `gap` (< 84) falls back to margins through `@supports not (gap: 1px)`. A device measurement is still open.

## 4. Rows

48 dp minimum, label left, control right, the whole row a target for checks.

| Type | Control |
|---|---|
| check | switch (on/off) |
| select with 2 short options (EN ≤ 7, KO ≤ 4 chars; label EN ≤ 16, KO ≤ 10) | segmented control **on the label's line**, right-aligned |
| select with 2–3 short options (EN ≤ 12, KO ≤ 8) otherwise | segmented control on its own line under the label (radio group, one Tab stop) |
| select otherwise | value + `chevron-down`, opens a list sheet/popup with the options (radio), Esc/Back closes |
| text | value preview (1 line, muted "(비어 있음)" when empty) + `pencil`; tap opens an inline single-line field; Enter/blur saves, Esc reverts |
| textarea | 2-line preview + `pencil`; tap opens an editor sheet with Save/Cancel |

The control kind never depends on the UI language (both languages must fit).

- **On marker:** a 6 dp accent dot before the label when the toggle is on (§3); the row's accessible name adds "켜짐" / "on". The filter "켜진 것만" shows these rows (and, with the scope switch on, rows with chat-only values).
- **Chat-only value marker:** when the scope switch is on and the value differs from the shared value, a small "이 채팅" tag (12 px) and its menu entry "모든 채팅 값으로 되돌리기" (replaces today's 📌 button).
- **Row menu** (⋯ button; also long-press, right-click, Shift+F10 / the Menu key on the row control): 즐겨찾기 추가/해제, 위로/아래로 (favourites section only), the reset entry, and (chat-only) 모든 채팅 값으로 되돌리기. **Reset (DD-083):** "끄기" for a check, "첫 번째 값으로" for a select, "비우기" for text and textarea (EN "Turn off", "Use the first option", "Clear"); it sets off / index 0 / empty, not an author default.
- **Menu button visibility:** visible on touch (DD-044 pattern), shown on hover and focus with a pointer, not a Tab stop (one stop per row). Every row control carries `aria-keyshortcuts="Shift+F10"`; Right Arrow on a switch or button row control moves to its ⋯ button, Left Arrow back. The hint line (§2) explains this.
- A star mark (small, filled) shows on source rows that are starred; there is no star on other rows.
- Labels wrap to 2 lines, then ellipsis with the full label in the accessible name and a tooltip.

## 5. Favourites (DD-079)

- Starred toggles appear first in a **즐겨찾기** section (same row controls, with a breadcrumb line; they also stay in their source section). Order = star order; reorder by the row menu's "위로/아래로" (non-drag, WCAG 2.5.7). Drag reorder is optional and not built in the mockup.
- Stored per user, keyed by source + key (design default; lane A), so a module's starred toggle stays starred in every chat that uses the module.
- A star whose toggle no longer exists (module off or removed) disappears silently from the section and returns, in its place, when the source does.
- The section is not shown while a search or filter is active, so each hit appears once.
- **+ sheet chips:** starred toggles as chips, up to 8 then "더 보기" (opens the panel at 즐겨찾기). Check: an on/off chip (check mark + accent outline when on; `menuitemcheckbox` with `aria-checked`, because `aria-pressed` is not valid on a menu item and the + sheet is a menu). Select: chip shows "{label}: {value}", tap opens the option list and returns to the + sheet. Text/textarea: chip opens the panel at that row (scrolled into view, briefly outlined, focused). Chips follow the scope switch. Arrow keys walk the "토글" item and the chips; Tab closes the menu.

## 6. Search and the on-only filter (DD-079, DD-083)

- Search matches the toggle label, its key, section and group names, and select option labels (case-insensitive; 초성 for Korean like the slice 2 sidebar). **초성 rule (F-07):** a query of two or more consonant jamo matches anywhere; **one** jamo only matches the start of a word (otherwise "ㅇ" matched 35 of 40 rows). Matching rows show their section and group path as a breadcrumb ("서술 스타일 › 문체") and, when only an option matched, "옵션: 대담하게". The list filters 120 ms after the last keystroke (the clear button reacts at once; Esc cancels a pending filter); a polite count ("토글 2개 표시") follows.
- While searching or filtering, folded sections/groups that contain hits open; sections without hits are hidden; headers are not collapsible; header counts stay the section totals; afterwards everything is restored. The user's own open/closed state is never rewritten by a search.
- "켜진 것만" shows only rows that are on (and, with the scope switch on, chat-only values), keeping section headers with counts for sections that still show rows. Combined with search: both apply.
- No results: "찾는 토글이 없어요" + "검색 지우기" / "필터 끄기" (each only while it applies).
- Esc layers on every host: inline editor → search text → the panel itself (one Back layer each, DD-040). Search and filter reset when the panel is opened anew; they survive a layer and a resize. On the dock, Esc with focus in the chat also closes the panel (it is a Back layer).

## 7. Saving and feedback

Changes apply immediately (as today). A short polite announcement per change ("{label} 켜짐"); no toast. Slice 2's "saved to: 모든 채팅 / 이 채팅" flash appears in the panel title area for 1.5 s after the first change in a session (design default).

## 8. Motion

Section collapse: expanding fades the new content in (opacity + a few px of `transform`) and the following sections move with a `transform` transition (FLIP; no height animation); collapsing moves the following sections; chevron rotates. All of it is instant under reduced motion and low power. Dock entry: short slide-fade (fade only under reduced motion, none under low power). Phone panel open/close: slice 1 sheet motion. Row highlight after "open at that row": an opacity fade. On dot: none. Only transform and opacity animate; no `backdrop-filter`.

## 9. Korean copy (keys, en / ko)

| Key | en | ko |
|---|---|---|
| togglesTitle | Toggles | 토글 |
| togglesSummary | {n} toggles · {on} on | {n}개 · {on}개 켜짐 |
| togglesScopeNoteOn / Off | Copied from current values; changes apply only to this chat / Applies to every chat | 켜면 지금 값이 복사되고, 이 채팅에서만 바뀌어요 / 모든 채팅에 적용돼요 |
| togglesSearch | Search toggles | 토글 검색 |
| togglesChangedOnly (rev 1 name kept) | On only | 켜진 것만 |
| togglesFavorites | Favourites | 즐겨찾기 |
| togglesSourcePrompt / Character | Prompt / Character | 프롬프트 / 캐릭터 |
| togglesSectionCount | {n} toggles · {on} on | {n}개 · {on}개 켜짐 |
| togglesChangedA11y (rev 1 name kept) | on | 켜짐 |
| togglesChatValue | This chat | 이 채팅 |
| togglesRevertShared | Use the all-chats value | 모든 채팅 값으로 되돌리기 |
| togglesReset / tgResetSelect / tgResetText | Turn off / Use the first option / Clear | 끄기 / 첫 번째 값으로 / 비우기 |
| togglesStar / Unstar | Add to favourites / Remove from favourites | 즐겨찾기 추가 / 즐겨찾기 해제 |
| togglesMoveUp / Down | Move up / Move down | 위로 / 아래로 |
| togglesSameValue | Same value: {source} | 같은 값: {source} |
| tgDupMismatch | Same key, different kind: {source} | 같은 키, 종류가 달라요: {source} |
| togglesMore | More | 더 보기 |
| togglesNone / NoneHelp | No toggles / Prompts and modules can add toggles. | 토글이 없어요 / 프롬프트나 모듈이 토글을 추가할 수 있어요. |
| togglesNoMatch | No matching toggles | 찾는 토글이 없어요 |
| togglesClearSearch / FilterOff | Clear search / Turn off filter | 검색 지우기 / 필터 끄기 |
| togglesOnA11y / OffA11y | {label} on / {label} off | {label} 켜짐 / {label} 꺼짐 |
| tgHint, tgList, tgPillGo, tgResults, tgOption, … | (extra keys, see the TGI table at the top of `chat/toggles.js`; they join this table in lane A) | |
| jailbreakToggle | (existing key) | (existing key) |

## 10. States the mockup must show

~40 synthetic toggles (39 unique keys, 10 on; a 100-toggle variant where every source has an on value shows the 25-row cap): prompt (12, two author groups, a caption, dividers, a select with 2 options and one with 6, a text, a textarea, the jailbreak toggle), modules "서술 스타일" (10), "장면 카드" (8), "메모리 도우미" (4, one key duplicating a prompt key), character (5 + memory toggle). Values: on in 프롬프트 (6), 서술 스타일 (3) and 캐릭터 (1), so 장면 카드 and 메모리 도우미 start folded. States: sheet summary row; panel default; sections collapsed/expanded; group expanded; each control type and its editor; on markers; scope switch off/on with the pill, chat-only tags and revert; slice 2's jailbreak switch and memory row agreeing with the panel; search (label, key, option, 초성, breadcrumb, auto-expand); on-only; both; no results; favourites section with reorder by menu; + sheet chips (check, select, text, "더 보기"); 100-toggle stress set (on values only in the prompt and memory sections); empty state. 360×740, 412×915, 1280×800 (docked), 960 (side sheet); KO/EN; keyboard only; reduced motion; low power; forced colours.

## 11. Integration map (lane A; nothing here edits these files)

| App file | Change |
|---|---|
| `src/lib/SideBars/Toggles.svelte` | Replaced by the panel; remove the 192 px box; scope switch always shown |
| `src/ts/process/modules.ts:819-831` (`getModuleToggles`) | Return toggles with their module id/name instead of concatenated text |
| `src/ts/util.ts:788-828` (`parseToggleSyntax`) | Carry source; keep group nesting |
| `src/ts/parser/chatVar.svelte.ts` | Unchanged storage for `toggle_<key>`; "off" = check off / select 0 / empty text (no default syntax yet) |
| **Chat-scoped jailbreak and memory (DD-082)** — `DBState.db.jailbreakToggle` (global) and `chara.supaMemory` (per character) | New chat-level fields (e.g. on the chat object) for both, used when the chat's scope switch is on and **falling back to today's global / per-character value** when unset; DD-045 copy-on-enable copies the effective value, discard drops the chat field; the generation code reads the chat field first. Slice 2's separate "모든 채팅" jailbreak switch and memory row must show and write the value for the current scope (one value per scope) |
| Slice 2 This chat sheet under chat-only (DD-086) | While the chat's scope switch is on, the jailbreak switch and the memory row are shown in the "이 채팅" group with a "이 채팅" tag (memory as "{type} · 꺼짐" when off, never "없음"); with it off they sit under "모든 채팅" / "이 캐릭터" as today. No "모든 채팅" label next to a chat-only value |
| New: favourites store (per user, source + key) | §5 |
| Composer + sheet (slice 1/2) | 토글 item and favourite chips |
| `src/lang/*.ts` | Keys in §9 |

## 12. Open questions

- **O-1** A default-value syntax for toggle authors (today none) would let the panel say "changed" and make reset mean the author's default. Until then the panel says "on" (DD-083). Stays open for lane A.
- **O-2** Should module authors be able to mark toggles as "recommended favourites"? Not asked.
- **O-3** Real windowing for very long open sections (> ~200 rows) and a device measurement on Note 9 / Pi 3 (WebView version).
- **O-4** Drag reorder of favourites (optional).

## 13. Design defaults to confirm

Ctrl+Shift+T (app window); docked non-modal right panel at ≥ 1024 px, side sheet at 900–1023 px; open state by total count (threshold 20, cap about 25 rows); duplicate-key rows linked (warning badge for mixed kinds); star in the row menu, small star mark on starred rows; favourites per user; favourites section hidden while filtering; 초성 single-jamo = word prefix (N-05: "ㄱ" still lists about half of the rows; a "type one more character" prompt is a possible refinement, not built); 120 ms search debounce; scope row scrolls with the list (pill keeps the mode visible); 10 s undo; "saved to" flash once per session; unique-key counts.

## 14. Hooks the builder would need in shared files (not added; slice 1–4 untouched)

A hook to replace/skip the slice 2 toggles group (today: DOM observation); `openPlus` export or a re-render helper; slice 1 menu keys over `[role^="menuitem"]`; `openSheet` resetting the body class (a real slice 1 bug: the panel's class leaked into the next sheet); a sheet-closed event (also allows an inert dock); a `pushBack` stack instead of the single `S2.sheetBack` slot; a chat-switch hook; a filled icon option in `ic()`; a non-modal right-panel slot in the shell; slice 2 jailbreak/memory surfaces reading and writing through one scope-aware accessor (today: DOM observation and a capture-phase listener). See the builder notes for how each is worked around.
