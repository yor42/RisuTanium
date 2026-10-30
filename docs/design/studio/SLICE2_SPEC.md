# Studio slice 2: toggle list builder

Status: **draft, revision 2.1** (2026-10-26; rev 2.1 = re-review fixes and DD-115 to DD-117, see the changelog). Task: [tasks/2026-10-26-studio.md](../tasks/2026-10-26-studio.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) rev 2.1 (shell, owner map, saving); everything there still holds unless this file says otherwise. Decisions: DD-091 (list builder + text view), DD-095 (hybrid save: toggle definitions are **live** items), DD-096 (combined view in engine order), DD-105 (block `=` and `,`), DD-106 (warn and offer carry-over), DD-107 (key from label, editable), DD-108 (unreadable lines kept as rows), DD-109 (empty groups hidden in the panel), DD-110 (ask again against the last answer), DD-111 (delete a group with its toggles), DD-112 (owner-aware unique fallback keys), DD-113 (CBS uses of a renamed key), DD-114 (carry-over is its own step), DD-115 (an unanswered question is kept on the device), DD-116 (update all is one cross-owner step), DD-117 (update all skips sources that still define the old key) in [DECISIONS.md](../DECISIONS.md). Re-review: [reviews/2026-10-26-studio-slice2-rereview.md](../reviews/2026-10-26-studio-slice2-rereview.md). Review: [reviews/2026-10-26-studio-slice2-review.md](../reviews/2026-10-26-studio-slice2-review.md). Panel look: [chat/TOGGLES_SPEC.md](../chat/TOGGLES_SPEC.md) rev 3.

Changelog: **rev 2.1** (re-review round; findings N-1..N-10 mapped in [checks/builder-checks-s2.md](checks/builder-checks-s2.md) §2c) keeps an unanswered carry question **on the device** with the drafts so it comes back when the item reopens, also after a reload (DD-115); makes "update all" **one history step across owners** with an all-or-nothing undo that names the owner that changed since (DD-116, new shell function `crossEdit`); makes "update all" **skip sources that still define the old key**, listing them with a per-source "also update" (DD-117); limits the carry's own undo to **the current visit to the item** and says so (N-4); **stops moving focus** to 값 옮기기 (the question is announced and the banner sits directly under the header, N-3); look-alike keys also ignore `_` (Q-2); a pending write is flushed before **any** item switch (N-5); a rename is only recognised by the same name and kind (N-10); a move reorders two DOM blocks instead of rebuilding the list (N-6); the "cancelled" case is announced (N-7); the owner part of a fallback key is cut at a word boundary (N-9); `?state=` scripts never wait for `requestAnimationFrame` (hidden tab). **Rev 2** (fix round; findings M-1..M-7, m-1..m-15, n-1..n-3 mapped in [checks/builder-checks-s2.md](checks/builder-checks-s2.md) §2b) rewrites §5 (the question compares with the **last answered** state and asks again every time, names the global value and pinned chats with no invented count, lists CBS uses of a renamed key with an "update all", carries as its **own undo step**, warns on overwriting another source's value, is an item-level live banner that persists), changes §0/§8 to DD-109 (the redesigned panel hides an empty group; today's app draws a switch), §4 to DD-112 (fallback key `<owner>_t1`, unique across every owner of the app; app-wide shared-key check; soft key hints), §6 (text-view renames and reorders raise the same question; a pasted group is placed outside and closed), §3 (a stray group end line is a flagged row; the per-group add button moves into the group row), §9 (names, keys and options are written after a short pause or at composition end; typing re-renders only the changed row), §7 (a group closed by a later source is not a spill). **Rev 1.1** (builder, [checks/builder-checks-s2.md](checks/builder-checks-s2.md)) corrects §0 (an **empty group is drawn as an on/off switch**, not hidden: `Toggles.svelte:117-177` falls through to the final `{:else}`), fixes the row-editor host rule in §2 (by editor-column width, not only by viewport), records that the text view is its own small code field and not the slice 1 editor (§6), adds the soft "unclosed group" warning and the off-module list to §7, says that preview groups start folded (§8), adds the builder's extra copy (kept in `studio/data2.js`) and lists the real state names (§12). Rev 1 text that no longer holds is replaced, not kept.

Scope: the 토글 정의 item of each owner (preset, module, character): the list builder, the row editor, the text view, the panel preview, the combined view with duplicate and spill checks (slice 1 O-6), and the rename/reorder carry-over. Out of scope: the long-text editor (slice 3), other forms.

## 0. Today (parent source-read)

| Fact | Anchor |
|---|---|
| One line per entry, `key=label[=type[=options]]`; `line.split('=')` keeps only the first four parts; options split on `,`. No escaping. | `src/ts/util.ts:788-828` |
| Types: none/unknown → on/off; `select`; `text`; `textarea`; `group`; `groupEnd`; `divider` (label optional); `caption` (needs a label). Lines without key and label that are not group/groupEnd/divider are dropped silently. | `util.ts:799-820` |
| Groups do **not nest**: a `group` line while a group is open starts a new top-level group. `groupEnd` key/label are ignored. **Today an empty group is not hidden**: the `{#if toggle.type === 'group' && toggle.children.length > 0}` branch is skipped and the line falls through the `else if` chain to the final `{:else}`, which draws an on/off switch named after the group line (bound to `toggle_<group key>`). Source-read only; not run. **DD-109: the redesigned panel hides an empty group** (a small change for lane A); the builder's preview shows the redesigned behaviour and the list flags the empty group row. | `Toggles.svelte:77-92, :117-123, :169-177` |
| The three owners' texts are **joined into one text** (preset, then enabled modules in load order, then character) before parsing, so a group left open in one owner swallows the next owner's toggles. | `Toggles.svelte:70-75`; `process/modules.ts:819-831` |
| Repeated dividers with the same label in a row collapse to one. | `Toggles.svelte:159-160` |
| Values: **one app-wide entry per key** (`db.globalChatVariables`, `chatVar.svelte.ts:107-125`; the same value for every character, module and preset that uses the key), as chat variable `toggle_<key>`; on/off stores `'1'`/`'0'`; select stores the **option index** as text; text/textarea store the text. A chat can pin its own copy (📌, `useLocallySetGlobalVariables`, `chat.GLGlobalVariables`). | `Toggles.svelte:106-174, :217-221`; `chatVar.svelte.ts:107-125` |
| CBS reads them as `{{getglobalvar::toggle_<key>}}`. | `lang/en.ts:599-600` |

## 1. Where it lives

- Studio › owner › **토글 정의** (preset, each module, character). Live item (DD-095): status chip, owner undo/redo with step names, restore point, delete with durable undo, changed-elsewhere notice. Deep link `kind=toggles` and the chat toggles panel's "정의 편집" (TOGGLES_SPEC) open it as in slice 1 §1.
- The slice 1 placeholder text field is replaced by this builder. The 토글 정의 merged view (§7) replaces the slice 1 merged list for this kind.

## 2. Layout

The item has two views, a segmented control under the item header: **목록** (default) and **텍스트**. Both edit the same definition; switching keeps undo history and selection (row ↔ line).

- **≥ 1024 px:** list (left) + row editor (right) in the editor area; the **panel preview** sits in slice 1's side panel as its 미리보기 tab (the test panel frame), open by default for this kind.
- **600–1023 px:** list full width; the row editor opens as a side sheet; preview via the side panel button.
- **< 600 px (phone floor, Note 9):** list full width; tapping a row opens the row editor as a full page with Back (DD-098 rules); preview is a bottom sheet from a `eye` button in the item header. No drag on phone (§3 move buttons instead).
- **Rev 1.1 rule:** the row editor sits beside the list only when the editor column is at least 560 px wide (1280 px window: 634 px). A 1024 px window has the wide shell but a 378 px editor column, so it uses the side sheet like 600–1023 px. The `eye` button is in the item header below 1024 px only; at ≥ 1024 px the preview is the open tab of the side panel.

## 3. The list

- One row per entry in file order. Row: type icon (lucide), label (or 이름 없음 muted), key in small mono under it, a short type summary on the right (선택: "3개 중 하나", 짧은 글/긴 글, 묶음: "4개"), `grip-vertical` handle (pointer ≥ fine only), `ellipsis` menu: 복제, 위로, 아래로, 묶음으로 옮기기 › (group list / 묶음 밖으로), 삭제.
- **Groups** are a header row with an indented child list and a chevron to collapse. The builder never shows `groupEnd`; it writes it (§6). Because groups do not nest (§0), the move menu and drag never offer "into a group" for a group row; dropping a group inside another is refused with the note "묶음 안에는 묶음을 넣을 수 없어요".
- Dividers and captions are thin rows (line icon / `text` icon) with their text.
- **Rev 2:** an **empty group** row says "빈 묶음 · 채팅에는 나오지 않아요. 채우거나 지워 주세요" (DD-109); a **stray `groupEnd`** (no open group) is a flagged row "짝 없는 묶음 끝 줄" with its raw line (m-8); the add button of a group lives in the group row (a button directly inside a tree is not valid ARIA, m-13); the row's accessible name carries its flags (shared key, few options, open question); the unreadable-lines note reads "읽을 수 없는 줄 N개 · 채팅에는 나오지 않아요" (the preview says "보이지 않아요", m-2); dragging scrolls the list near its edges (m-15).
- **Add**: a `plus` button at the end of the list and at the end of each group opens a type picker (grid of 7 with icon + name + one-line hint): 켜기/끄기, 선택, 짧은 글, 긴 글, 묶음, 구분선, 설명. New row is inserted, selected, label focused.
- **Reorder**: drag (fine pointer), keyboard **Alt+↑/↓** on the focused row, and the menu's 위로/아래로 (phone). Every move is one undo step ("‘전투 모드’ 옮김").
- **Unreadable rows (DD-108)**: lines the engine would drop appear as flagged rows (`triangle-alert`, "읽을 수 없는 줄") showing the raw text in mono; selecting one opens a single text field holding that line and the reason ("키와 이름이 필요해요", "설명에는 글이 필요해요"). They are written back verbatim until fixed or deleted. They do not appear in the preview.
- Empty state: "아직 토글이 없어요" + the type picker inline, and a one-line hint of where toggles appear (채팅의 토글 패널).

## 4. Row editor

Fields by type (all labels KO-first; EN in §10):

| Type | Fields |
|---|---|
| 켜기/끄기 | 이름 (label), 키 (advanced) |
| 선택 | 이름, 선택지 (an ordered sub-list: one field per option, add/remove/reorder; at least 2), 키 |
| 짧은 글 / 긴 글 | 이름, 키 |
| 묶음 | 이름 (group title), 키 (advanced, written but unused by the engine) |
| 구분선 | 이름 (optional, shown beside the line) |
| 설명 | 글 (required) |

- **Type change** from the editor's type select keeps label and key; turning a 선택 into anything else drops the options with an undo toast.
- **Key (DD-107)**: under a collapsed 고급 disclosure, shown as "키 · combat" in the row. New rows get a key from the label: lowercase ASCII letters/digits from the label joined with `_`; if none (e.g. a Korean label) **`<owner>_t1`, `<owner>_t2`…** (DD-112: the owner part is the English name of the character/module/preset slug, e.g. `seraphina_t1`, `scene_cards_t1`; the next free number across **every owner of the app**, all characters, modules and presets, because values are app-wide). A suggestion that is taken gets `_2`, `_3`. The suggestion follows the label until the author edits the key or copies the CBS snippet; after that it is fixed. The disclosure shows the CBS snippet `{{getglobalvar::toggle_<key>}}` with a `copy` button.
- **Blocked characters (DD-105)**: `=` in 이름/키/선택지 and `,` in 선택지 show an inline error under the field ("‘=’는 쓸 수 없어요 — 토글 형식이 이 글자에서 줄을 나눠요") and the field's value is **not written** to the definition (status chip stays at the last good value; the row shows `circle-alert`). Leading/trailing spaces are kept (the engine keeps them) but a soft hint warns when a key has them; a key with an **interior space** and a key that differs from another key **only by case or spaces** get a soft hint too (Q-5). A refused text stays in its field with its error until the author changes it (m-10). A newline cannot be typed in single-line fields; pasting one splits nothing and shows the same kind of error.
- **Rev 2:** editing a row rewrites it canonically, so a row with a fourth-part tail or an unknown kind warns before ("이 줄을 고치면 넷째 ‘=’ 뒤의 글자는 지워져요"); a choice with no options part stays `key=label=select` (m-4). **Names, keys and options are written after a short pause (40 ms) and at once on blur or `compositionend`, never in the middle of an IME composition** (Q-4).
- **Within-owner checks**: empty key (non-structural types) → error; duplicate key in the same owner → error on both rows ("같은 키가 두 번 있어요"); a 선택 with fewer than 2 options → warning.

## 5. Rename and reorder carry-over (DD-106, DD-110, DD-113, DD-114)

What is stored: **one value per key for the whole app** (the global value), plus a copy in each chat that pinned the value. The question therefore never promises a per-chat count and says so.

- **Trigger and baseline (DD-110):** the builder compares the current text with the **last answered state** (the restore point until the first answer; after "값 옮기기" or "그대로 두기" the text at that answer). Every rename, option reorder or removal, kind change and value-to-divider conversion that would detach or reinterpret a stored value asks again; renaming the key you just answered about asks again; typing the answered key back cancels it. A row added in this visit never asks. Appending an option, renaming one option in place and editing a name do not ask. Checked when a key field is left, after option and kind changes, and when the **text view** is left (M-3: the same question for edits typed there).
- **Where and how it appears (M-4, rev 2.1):** an **item-level banner directly under the item header** (above the 목록/텍스트 switch; in the row-editor sheet while that sheet is open), a labelled group. When it appears it is **announced** in the polite live region; **focus is not moved** (the author keeps typing where they were; Tab and Enter behave normally). When typing the old key back cancels it the live region says "저장된 값을 확인할 일이 없어졌어요". It stays until answered: when another row is selected, on a phone after Back, after leaving the item and coming back, with a row flag, a Problems entry and a tree marker, and **across a reload (DD-115): the question and the baseline it compares with are kept on this device with the drafts** (device-only, like drafts and history, DD-099).
- **Wording by kind (M-2):** key rename → the old key's value no longer follows the toggle (global value and pinned chats named); options reordered or removed → **the saved option number now means another option**, and 값 옮기기 only renumbers to the new order (Q-6); kind change → the value is not erased but is read differently (a choice is saved as a number) and cannot be converted; value row turned into a divider/note → nobody reads the value any more. Kind changes and drops offer only "확인" (nothing to carry).
- **값 옮기기 / 그대로 두기:** carrying moves the global value and the pinned chats' values (key rename) or renumbers them (options). It is **its own history step** ("값 옮김: 키 combat → battle") with its own undo (toast and a button on the result line, "값 옮김 되돌리기") **while the author is still in this visit to the item** (N-4: after opening another item the result line is gone and an undo of that old step only moves the history and says the values are not reopened); undoing it re-opens the question, the rename stays one earlier step (DD-114). 그대로 두기 is not a step. No count is shown. If the target key is also used by another source, the question warns that carrying **overwrites that value** and names the sources; if the old key is used elsewhere it says their value stays.
- **CBS uses (DD-113):** for a key rename the question lists where `toggle_<old>` is read (every non-toggle item of every owner: character text, lorebook, regex, scripts), opens an item from the list, offers **"모두 새 키로 바꾸기"** and **"검색에서 보기"** (Studio search with `toggle_<old>`). **DD-117:** uses inside a source that **still defines the old key** are skipped (they may mean that source's own toggle); the skipped sources are listed with their use counts and a per-source **"{owner}도 바꾸기"**. **DD-116:** "update all" is **one history step across owners** (the shell's `crossEdit`: each owner records its own step with a shared id); one Ctrl+Z or one toast "모두 되돌리기" undoes every owner together, and redo redoes them; if an owner changed afterwards the undo does **nothing** and says "되돌리지 못했어요: {owner}이(가) 그 뒤에 바뀌었어요 …" (all or nothing, never half).
- The carry-over is an app-side migration; lane A owns it (§11).

## 6. Text view and round trip

- A code field (**rev 1.1: a small separate field, not the slice 1 editor** — `studio/editor.js` is bound to the Lua/plugin/CBS modes, its single DOM panel and its own checks, so a toggle mode would have meant editing a shared 110 KB file; the builder has its own line-number gutter, mono text, per-line marks and no wrap) holding the exact text. Edits in the text view are live like any field (debounced; status chip). Lint marks per line: unreadable (DD-108 reasons), blocked characters cannot occur here (the text *is* the format) but extra `=` parts beyond four are flagged "넷째 ‘=’ 뒤는 무시돼요", duplicate keys, unclosed group (§7).
- A collapsible **형식 도움말** shows the syntax with one example per type (the help text today documents only `key=label`).
- **Round trip**: the builder writes only rows it changed. Untouched lines (including spacing, unknown types, comments-as-unreadable lines) are kept byte-for-byte. New/changed lines are written canonically: `key=label`, `key=label=select=a,b,c`, `key=label=text`, `key=label=textarea`, `key=label=group` … `key=label=groupEnd` (the end line repeats the group's key with `_end` and the label), `=label=divider` (or `==divider`), `=text=caption`. **Every group the builder makes is closed**, also at the end of the owner's text.
- Paste: pasting several lines into the list (Ctrl+V on the list, or 텍스트로 붙여넣기 in the add picker) parses them into rows at the selection. **Rev 2 (m-1):** lines are kept as written, but a pasted `group` never lands inside a group (it goes after it, with a toast) and a pasted group without an end line gets one.

## 7. Combined view (토글 정의 across owners; O-6)

The slice 1 merged view for this kind becomes:

- Groups per owner in **engine order**: 프리셋 → 모듈 (load order, active only; inactive tagged and dimmed per DD-101) → 캐릭터, each listing its entries (label + key), leading with the owner (slice 1 §3).
- **Duplicate keys across owners** → info badge on both ("같은 키 · 서술 스타일과 값을 함께 써요"); both show in the panel and share one value. Not an error.
- **Off modules** (rev 1.1): listed after the active sources under "꺼진 모듈", dimmed, tagged 꺼짐, not numbered and analysed alone (they never take part in the join).
- **Rev 2 (m-6):** a group left open by one source and **closed by a later source's `groupEnd`** holds nothing and is not a spill (an info line "묶음의 끝 줄이 다른 출처에 있어요"). **Shared keys look at every owner of the app** (other characters, off modules, other presets), not only the joined ones.
- **Spill** → if an owner's text ends with a group still open and a later source has toggles, an error on that owner (rev 1.1: when nothing follows, i.e. the character's own last group or an off module, it is only a warning "묶음이 닫히지 않았어요"; the fix button is the same). The later sources show "앞 출처의 열린 묶음 안으로 들어가요" while their entries are swallowed. A group line in a later source starts a new group and ends the spill, as the engine does: "묶음이 닫히지 않아 다음 출처의 토글이 이 묶음 안으로 들어가요", with a 묶음 닫기 fix button that appends the end line (one undo step). The preview shows the spill as it will really happen.
- 전체 미리보기 button opens the panel preview of the joined result.

## 8. Panel preview

- Renders the joined definition the way the chat toggles panel does (TOGGLES_SPEC rev 3 look: sections, groups as accordions that **start folded** and open when one of their rows is selected, select/text controls, divider labels, captions, collapsing repeated dividers). Rev 2 (DD-109): an **empty group is hidden**, as in the redesigned panel. An **unset choice is blank** (the app reads '' until a value exists: segmented control with nothing checked, a select showing "(값 없음)", m-9); rows whose labels repeat show their key under the label and every row has the key as a tooltip (n-3). Values are a sandbox: flipping a control changes only the preview ("미리보기 값 · 채팅에는 저장되지 않아요").
- Scope switch: **이 출처만** (default when opened from an owner) / **합쳐진 결과** (what the chat really shows: preset + active modules + character). The current owner's rows are outlined in the joined result. Selecting a control in the preview selects its row in the list.
- Unreadable rows are absent from the preview, with a count note ("읽을 수 없는 줄 2개는 보이지 않아요").

## 9. Keyboard, motion, low power, accessibility

- List is a single tab stop with arrow-key roving focus; Enter opens the row editor; Alt+↑/↓ moves; Delete deletes (undo toast, DD-100); Ctrl+Z / Ctrl+Shift+Z owner undo/redo (slice 1). Type picker is a grid with arrow keys.
- **Rev 2 (M-7):** typing writes the row after a short pause and re-renders **only the changed row**; the tree, Problems and the preview are updated after the typing pause (not per keystroke); the preview is only rendered while it is visible. Measured: about 100 ms per keystroke at 4x CPU throttle with 66 rows before, under 40 ms after (a desktop proxy, not a device).
- Drag has a non-drag equivalent everywhere (WCAG 2.5.7). Live announcements for moves ("‘전투 모드’ 3번째로"), errors and carry-over.
- Motion: row move uses transform only; reduced motion and low power → no move animation (instant), sheets fade ≤ 120 ms as slice 1.
- Targets ≥ 44 dp on coarse pointers; the row's ⋯ button is the move path on phone.
- Note 9 floor: list of 60 rows + preview renders without jank; no blur, no shadows on rows.

## 10. Copy (proposed keys, ko / en)

| Key | KO | EN |
|---|---|---|
| tgViewList / tgViewText | 목록 / 텍스트 | List / Text |
| tgAdd | 토글 추가 | Add toggle |
| types | 켜기/끄기 · 선택 · 짧은 글 · 긴 글 · 묶음 · 구분선 · 설명 | On/off · Choice · Short text · Long text · Group · Divider · Note |
| tgKey / tgAdvanced | 키 / 고급 | Key / Advanced |
| tgOptions / tgAddOption | 선택지 / 선택지 추가 | Options / Add option |
| tgErrEq | ‘=’는 쓸 수 없어요 — 토글 형식이 이 글자에서 줄을 나눠요 | You can't use ‘=’ — the toggle format splits lines at it |
| tgErrComma | 선택지에는 ‘,’를 쓸 수 없어요 | Options can't contain ‘,’ |
| tgDupKey | 같은 키가 두 번 있어요 | This key is used twice |
| tgShared | 같은 키 · {owner}와 값을 함께 써요 | Same key · shares its value with {owner} |
| tgSpill | 묶음이 닫히지 않아 다음 출처의 토글이 이 묶음 안으로 들어가요 | This group is never closed, so the next source's toggles fall into it |
| tgCloseGroup | 묶음 닫기 | Close group |
| tgUnreadable | 읽을 수 없는 줄 | Unreadable line |
| tgCarryAsk | 저장된 값이 있는 채팅이 있을 수 있어요. 이 변경 뒤에는 이전 값이 이 토글과 이어지지 않아요. | Some chats may have saved values. After this change, the old values no longer belong to this toggle. |
| tgCarryYes / tgCarryNo | 값 옮기기 / 그대로 두기 | Carry values over / Leave them |
| tgCarried | 채팅 {n}개의 값을 옮겼어요 | Moved values in {n} chats |
| tgPreviewNote | 미리보기 값 · 채팅에는 저장되지 않아요 | Preview values · not saved to any chat |
| tgScopeOwner / tgScopeAll | 이 출처만 / 합쳐진 결과 | This source only / Combined result |
| tgNoGroupInGroup | 묶음 안에는 묶음을 넣을 수 없어요 | A group can't go inside a group |
| tgEmpty | 아직 토글이 없어요 | No toggles yet |

Rev 2 copy (kept in `studio/data2.js`, KO and EN): `tgErrEq` now reads "‘=’는 쓸 수 없어요 — 토글 형식이 ‘=’로 칸을 나눠요" (the format splits fields, not lines); `tgCarryAsk*` (key / options / type / drop), `tgCarryYes` 값 옮기기 / `tgCarryNo` 그대로 두기 / `tgCarryOk` 확인, `tgCarried` "값을 옮겼어요 (전역 값과 값을 고정한 채팅)" (no count), `tgRefs*`, `tgKeyInner`, `tgKeyTwin`, `tgEmptyGroup`, `tgOrphanEnd`, `tgBadList`, `tgPvUnset`, `tgRowMenu` 줄 메뉴, `tgNotWritten` "이 글자는 반영되지 않았어요", `tgCopy` 복사하기. The rev 1 key `tgCarryAsk`/`tgCarried {n}` and its "채팅 {n}개" wording are retired.

Say "first message" (첫 메시지) where relevant; never "greeting".

## 11. Integration map (lane A; nothing here edits these files)

| Design piece | Today | Change |
|---|---|---|
| Builder replaces three text fields | `PromptSettings.svelte:288-289`, `ModuleMenu.svelte:255-256`, `CharConfig.svelte:1135-1136` | Studio form bound to `customPromptTemplateToggle` / `module.customModuleToggle` / `character.customModuleToggle`; string stays the storage format. |
| Parser | `util.ts:788-828` | Unchanged. The builder needs a lossless line-level parse (keep raw line per row) on the UI side. |
| Spill and duplicates | `Toggles.svelte:70-92` | Unchanged engine; checks are UI-side over the joined text. |
| Carry-over (DD-106) | none | New migration: rename `toggle_<old>` → `toggle_<new>` in global chat vars and each chat's pinned set; remap select indices. |
| Preview | `Toggles.svelte` | Reuse the panel component with a sandbox value store. |

## 12. States the mockup shows (`?state=tg-…`)

Builder with each type; group collapsed/expanded; type picker; row editor per type; key auto from EN label and `<owner>_t1` from KO label; key edited (stops following); `=` error in label, `,` error in option; duplicate key in owner; select with 1 option warning; unreadable rows (two reasons); text view with lint; paste lines into list; carry-over question → 값 옮기기 → toast + its own undo, asked again after a second rename, from the text view, with CBS uses and "update all"; kind change and value-to-divider questions; move by drag, Alt+↑/↓ and menu; group-into-group refused; combined view with shared key across preset and module, and with a spill + 묶음 닫기; preview this-source / combined, sandbox values, selecting from preview; empty state; round trip keeps untouched lines byte-for-byte. Widths 360×740, 412×915, 768×1024, 1280×800; KO/EN; keyboard only; reduced motion; low power; forced colours.

Rev 2 state names (`?state=` on `slice2.html`, also in the demo controls): `tg-list`, `tg-list-char`, `tg-group-expanded`, `tg-group-collapsed`, `tg-picker`, `tg-editor-check|select|text|textarea|group|divider|caption`, `tg-key-auto` (EN label → `combat_mode`), `tg-key-auto-ko` (`seraphina_t1`), `tg-key-edited`, `tg-err-eq`, `tg-err-comma`, `tg-dup-key`, `tg-select-warn`, `tg-unreadable`, `tg-unreadable-caption`, `tg-orphan-end`, `tg-empty-group`, `tg-text-lint`, `tg-text-lint-long`, `tg-paste`, `tg-paste-sheet`, `tg-carry-notice|yes|no|undo|again|refs-updated|type|options|text|drop`, `tg-move-alt|menu|drag`, `tg-group-in-group`, `tg-delete`, `tg-combined-shared`, `tg-combined-spill`, `tg-spill-owner`, `tg-preview-owner|all|sandbox|select`, `tg-empty`, `tg-roundtrip`. Keyboard-only, drag, reduced motion (`&reduced=1` or the OS setting), low power (`&lowpower=1`) and forced colours are exercised by the checks, not by a state.

## 13. Open questions

- **Decided in the fix round:** O2-3 → DD-109 (hide empty groups in the panel), O2-4 → DD-110 (ask again against the last answer), O2-5 → DD-111 (delete the group with its rows).
- **Decided (rev 2.1):** O2-6 → DD-115 (kept on the device), O2-7 → DD-116 (one cross-owner step). Open for lane A: how the app stores the pending question (device-only drafts, DD-099) and a cross-owner step in the real history.
- **O2-1** Should module authors be able to mark a toggle as "chat only" or set a default value? Not in the format today (engine change); not in this slice.
- **O2-2** (closed by DD-114) No count is shown: the question names the global value and the pinned chats only.

## 14. Design defaults to confirm

- Canonical `groupEnd` line repeats the key with `_end` (§6).
- Phone has no drag; menu moves only.
- (rev 2, builder defaults) Names, keys and options are written 40 ms after the last keystroke or at once on blur/composition end; the tree, Problems and preview follow 150 ms after typing stops. Unknown `?state=` shows a notice. The 종류 select never offers 묶음 and a group row has no 종류 select (a group's lines are paired). Adding or moving something to the end of a list whose last group was never closed first closes that group (the builder never produces a spill). Drag drops onto the lower half of an open group header go to the first place inside it. A refused text stays in its field. Duplicated rows keep the stem of the key: `<key>_copy`, `<key>_copy_2` (also non-ASCII). "Update all" rewrites `toggle_<old>` in the string fields of every non-toggle item (and Lua code text), matching the whole key only.
