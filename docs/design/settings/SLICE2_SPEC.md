# Settings & models slice 2: presets

Status: **draft, revision 2.1** (2026-10-26; §14 and §15 override earlier sections where they differ). Task: [tasks/2026-10-26-settings-models.md](../tasks/2026-10-26-settings-models.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) rev 2.1 (shell, rows, search, Back stack, KO register). Decisions in [DECISIONS-settings.md](DECISIONS-settings.md):
- DS-001: presets are hard to manage, the list grows long, the quick switch is capped, and presets can't be organised.
- DS-005: "prompt presets" means the bot preset list.
- DS-017: a switcher plus assigned slots.
- DS-018: folders and favourites.
- DS-019: edits save live, with undo.
- DS-020: a chip in the chat header.
- DS-021: one active preset for the whole app.
- DS-022: favourites and slots are separate.

Research: [research/today-settings.md](research/today-settings.md) §5.

Lane split (agreed with the main session): this lane owns the preset list, switching, organising, the preset's model parameters and the save model. Studio owns the preset's regex, toggle definitions and prompt-block text. Each preset offers "스튜디오에서 열기", which opens `../studio/slice1.html?from=settings&owner=preset:<id>`.

Marked **(design default)** = chosen here within the decided intent, open to veto.

## 0. Today (source-read)

| Fact | Source |
|---|---|
| A preset is a snapshot of the working settings. Edits change live `db` fields. They are written into the preset only by `saveCurrentPreset()`, on switch, copy or export. There is no dirty marker, no save and no revert. | `src/ts/storage/database.svelte.ts:2178-2219` |
| Ctrl+1–9 are hard-coded to presets 0–8 by list position. There is no Ctrl+0, and the keys are not in the hotkey table. Reordering or deleting a preset changes which preset a digit selects. | `src/ts/hotkey.ts:309-366`, `botpreset.svelte:194` |
| One flat array with no folders, tags, favourites, search or sort. Reordering is HTML5 drag only, so there is no keyboard or touch path. | `database.svelte.ts:1636-1735`, `botpreset.svelte:28-69` |
| "Add" clones a built-in template, not the current preset. "Copy" appends " Copy" at the end. Rename is a global edit mode. | `botpreset.svelte:300-309`, `database.svelte.ts:2201-2208` |
| Delete asks for confirmation, blocks deleting the last preset, then always jumps to the first preset. There is no undo. | `botpreset.svelte:244-263` |
| Preset chain and loadouts refer to presets by **name**, so renaming a preset breaks them. | `process/index.svelte.ts:597-612`, `loadout.ts:62` |
| The icon is set in Chat bot › Others, away from the list that shows it. Compare is hidden behind a Display toggle. | `BotSettings.svelte:810-844`, `botpreset.svelte:72-91` |
| There is no switcher in the chat. The list is reached through Ctrl+P, the Chat bot "Presets" button, a custom sidebar item, or the Ctrl+` quick menu. | `stores.svelte.ts:42`, `hotkey.ts:188-191` |
| Three hidden lock flags make a preset switch skip aux models, fallbacks and separate parameters. | `database.svelte.ts:2303-2333` |

## 1. Where presets live

### 1.1 The 프리셋 section of 모델·프리셋

The section's top rows:
1. **Active preset card**:
   - icon (tap to change; it moves here from Chat bot › Others), name, main model;
   - save status and undo (§5);
   - `⋯` with: 이름 바꾸기, 복제, 단축키 지정, 폴더로 이동, 내보내기, 스튜디오에서 열기, 복원 지점.
2. **"모든 프리셋 (60)"** (`library-big` icon, `chevron-right`): opens the **preset library** (§3).
3. "프리셋을 바꿔도 유지" sub-group: the three lock flags as switches, with plain descriptions:
   - 기능별 모델 유지
   - 대체 모델 유지
   - 기능별 파라미터 유지
4. 프리셋 체인 (`presetChain`): a link row to a small editor that **picks presets from the list** (stored by id), instead of a comma-separated name field.
5. 비교: a link row that picks two presets and opens the existing compare view. It is no longer behind a Display toggle.

### 1.2 The library is a sub-page

- Breadcrumb: 모델·프리셋 › 프리셋 › 모든 프리셋.
- Deep link: `?page=models&section=models.presets&view=library`.
- Back returns to the 프리셋 section, with focus on "모든 프리셋".
- Search results for a preset (slice 1 §5.3) open the library with that row focused. Enter on a row opens its menu (§3.4), as in slice 1 R-15.

## 2. The switcher (DS-017, DS-020)

### 2.1 Openers

- **Ctrl+P** (existing hotkey, kept) anywhere outside text fields, including inside Settings.
- The **chat header chip** (§6).
- The slice 1 search, with an "프리셋 바꾸기…" hit for queries like "프리셋 바꾸기" or "switch preset".

### 2.2 Layout

| Width | Layout |
|---|---|
| Wide, from the chip | A popover, 380 px wide, anchored under the chip. |
| Wide, from Ctrl+P | A palette, 560 px wide, centred near the top. |
| Phone | A tall sheet (chat slice 2's 92 % sheet, with Back to close). |

Top to bottom:
1. Search field, focused, placeholder "프리셋 검색".
2. **최근**: the last 5 presets switched to, excluding the active one.
3. **★ 즐겨찾기**.
4. **Folders**, in library order. In the switcher they are expanded and their rows are flat; there is no collapsing here.
5. **폴더 없음**.

While searching, results are one flat list with the folder as a breadcrumb.

### 2.3 Rows and switching

- Each row shows: icon, name, main model short name, slot badge ("Ctrl+3") if any, and `check` on the active preset.
- Search matches name, folder name and model. It supports 초성 and the shared word-start rules from slice 1 (R-01).
- Enter or a tap switches presets, closes the switcher and shows a toast: "‘롤플레이 긴 답변’(으)로 바꿨어요" with "실행 취소", for 10 s. Undo switches back.
- A reply that is still generating keeps the preset it started with. The chip changes at once and the next request uses the new preset (design default).
- Footer: "프리셋 관리" opens the library.
- With 300 presets the switcher opens in ≤ 100 ms at 4× CPU, and typing stays ≤ 16 ms per keystroke. Rows render only for visible groups plus 30 search results, with "더 보기" beyond that (design default).

## 3. The library (DS-018)

### 3.1 Header

- Back and title "모든 프리셋 (60)".
- Search field. On phones it is the `search` button, as in slice 1.
- Sort, a segmented control or menu: **직접 정렬** (default) / **최근 사용** / **이름**. In 최근 and 이름, drag and the move commands are disabled, with a hint: "직접 정렬에서 순서를 바꿀 수 있어요".
- `folder-plus` "새 폴더"; `plus` "새 프리셋"; `download` "가져오기"; `list-checks` "선택".

### 3.2 Groups, top to bottom

- **★ 즐겨찾기**: a virtual group. A favourite also stays in its folder, where its row shows a filled ★.
- **Folders**:
  - Collapsible. The header shows name, count, `chevron-down` and `⋯` (이름 바꾸기, 위로, 아래로, 폴더 삭제).
  - Collapsed state is remembered per device.
  - The folder holding the active preset is open on first show.
- **폴더 없음**: always last; hidden when empty.

### 3.3 Rows

- A row shows:
  - a drag handle (`grip-vertical`, fine pointer only), icon, name, then the model as a subtitle;
  - badges: slot "Ctrl+3", "사용 중" on the active preset;
  - the ★ toggle and `⋯`.
- Rows are 56 dp on touch and 44 px with a fine pointer.

### 3.4 Row menu

`⋯`, right-click, long-press and Shift+F10 all open the same menu. Enter or a tap on the row opens it too (slice 1 R-15: never a silent switch). Items:
- 이 프리셋으로 바꾸기
- 즐겨찾기 추가/해제
- 단축키 지정…
- 이름 바꾸기 (inline field; F2)
- 복제
- 폴더로 이동…
- 위로 / 아래로 (Alt+Up/Down)
- 내보내기
- 스튜디오에서 열기
- 삭제

### 3.5 Reorder

- **Pointer:** drag by the handle.
- **Touch:** long-press the row, then drag. The menu opens if the finger does not move within 300 ms.
- **Keyboard:** Alt+Up/Down within a folder. Alt+Up on a folder's first row moves the preset to the end of the previous folder.
- Every move is announced: "‘균형’ 이동: 롤플레이 폴더 2번째".
- **Folders** reorder the same ways, using their header.

### 3.6 Select mode

- `list-checks` shows checkboxes.
- The action bar offers: 폴더로 이동, 즐겨찾기, 내보내기 (a bundle), 삭제.
- Esc or "완료" leaves select mode.
- Shift+click selects a range; Space toggles the focused row.

### 3.7 Folders

- **Create:** name first, with nothing stored until confirmed (as slice 1's module rule).
- **Delete:** a folder with presets asks: "‘롤플레이’ 폴더를 지울까요? 안의 프리셋 12개는 ‘폴더 없음’으로 옮겨져요". Presets are never deleted with a folder.
- **Nesting:** none; one level only (design default).

### 3.8 Search

- Search filters in place. Matching rows stay inside their groups, and groups with no match are hidden.
- A count is shown: "‘롤’ 결과 14개".
- No results: "‘{q}’에 맞는 프리셋이 없어요" with "검색어 지우기".

### 3.9 Empty and stress

- With one preset the library still shows the full header; deleting that preset is blocked (§4).
- The `stress` fixture holds 300 presets in 25 folders. The library renders collapsed folders without their rows (floor devices), and expanding a folder of 60 rows stays under 50 ms at 4× CPU.

## 4. Creating, copying, deleting, importing

- **새 프리셋** dialog:
  - Name (required). A duplicate name is allowed but warned about: "같은 이름이 있어요".
  - **시작점**: "지금 프리셋 복사" (default) / "기본 템플릿".
  - Folder: defaults to the active preset's folder.
  - The dialog does not switch to the new preset unless "만들고 바로 사용" is checked (design default: unchecked).
- **복제:** creates "{name} 사본" right after the original, in the same folder, not favourited, with no slot.
- **삭제:**
  - A dialog names the preset and shows its folder, slot and favourite.
  - The last preset cannot be deleted: "프리셋이 하나는 있어야 해요".
  - Deleting the active preset switches to the **most recent other** preset, not the first.
  - A toast offers "실행 취소" for 10 s. Undo restores the preset with its position, folder, favourite, slot and chain membership.
- **가져오기:**
  - The file is simulated in the mockup.
  - A preview dialog shows the name, model, and what is included (parameters, prompt, regex count, toggles count). It notes: "API 키는 파일에 들어 있지 않아요".
  - Options: target folder; a name clash becomes "균형 (2)".
  - Bundles: each preset is listed with a checkbox.
- **내보내기:**
  - Single preset: as today (.risup).
  - A bundle from select mode: one file with several presets.
  - Folder, favourite and slot are **not** exported; they are this user's organisation (design default).
- **이름 바꾸기:** presets get a stable id, so preset chain and loadouts keep working after a rename. This needs the lane A data change in §9.

## 5. Live save with undo (DS-019)

- Rows in preset-scoped sections (모델, 파라미터, 프롬프트 설정, plus the reverse-proxy rows) save into the **active preset immediately**. Switching presets no longer has a hidden save step.
- **Status:**
  - The slice 1 section line "이 섹션은 프리셋 ‘균형’에 저장돼요" gains a status: "저장됨" / "저장 중…" / "저장 실패 · 다시 시도". Saving is simulated in the mockup; a fixture forces a failure.
  - The active preset card shows the same status.
- **Undo:**
  - The `undo-2` button on the section line and the card undoes the last change in the active preset.
  - Ctrl+Z does the same when focus is not in a text field.
  - Redo is `redo-2` and Ctrl+Shift+Z.
  - The undo history holds 50 steps per preset and lasts for the session (design default).
  - An undo that changes a row out of view says which row: "‘온도’ 0.8 → 1.0 되돌렸어요".
- **Restore points:**
  - **Taken automatically:** when a preset becomes active (first edit after switching), and once a day for each edited preset. At most 10 per preset; the oldest drop off (design default).
  - **Opened from:** the card's `⋯` › "복원 지점…".
  - **Listing:** time, plus "변경 12개".
  - **Restoring:** asks first. The restore itself becomes an undo step, and a new restore point "복원 전" is taken first.
- **Global rows** (keys, display and so on) are unchanged: they apply at once and have no preset undo.
- **Switching while a field is mid-edit:**
  - A text field commits on blur.
  - The switcher commits the focused field before switching.

## 6. Chat header chip (DS-020)

- A chip sits in the chat header's right group, before `⋯`. It shows the `bookmark` icon, the preset name and the model short name: "균형 · Sonnet 4.5".
- **Width rule.** The chat header already holds the avatar, the character name with the chat-name subtitle (DD-042), and `⋮`. The character name always keeps priority over the chip.
  - **≥ 480 px:** icon, name and model. The chip is at most 40 % of the header; the model drops first, then the name truncates.
  - **400–479 px:** icon and name only, at most 30 % of the header, with the name truncated. The model moves into the accessible name and the tooltip.
  - **< 400 px, or when the character name would truncate below 8 characters:** icon only, as a 44 dp button. Its accessible name and tooltip read "프리셋: 균형 · Sonnet 4.5".
  - The chip never moves into the This chat sheet (DS-020).
- **Activating the chip:**
  - A tap or click opens the switcher (§2), as a popover on wide screens and a sheet on phones.
  - Long-press, right-click or Shift+F10 opens a menu: 프리셋 관리 / 모델·프리셋 설정 열기.
- The chip updates at once when the preset changes from anywhere. While the switch toast is up, the chip's accessible name says what changed.
- The chat header belongs to chat slice 1, a shared file owned by the main session. This mockup shows the chip in its own origin stub; the hook is listed in §9 and in the message to the main session.

## 7. Slots and shortcuts (DS-017, DS-022)

- **단축키 지정… dialog:**
  - Nine slot buttons, 1–9. Each shows its current preset or "비어 있음", plus "없음".
  - Picking an occupied slot shows: "Ctrl+3은 ‘번역용’에서 이 프리셋으로 옮겨져요". It is confirmed in the same dialog with the button "옮기기".
- **단축키 page:**
  - A new section **프리셋 단축키** lists nine rows: slot n → preset name (a select over all presets plus 없음), and its key combo.
  - The key combo can be recorded again with the slice 1 hotkey capture pattern (Esc cancels; conflicts with the hotkey table are named).
  - Defaults are Ctrl+1–9.
  - On phones this section is the read-only reference (slice 1).
- **Pressing a slot key:**
  - Pressing a slot key switches presets with the §2 toast.
  - An empty slot gives the toast "Ctrl+5에 지정된 프리셋이 없어요" with the button "지정하기".
  - Slot keys are ignored inside text fields.
- **Migration** (lane A, design default): existing users get slots 1–9 = their first nine presets in today's order, so muscle memory keeps working. A one-time notice in 프리셋 says this: "Ctrl+1~9는 이제 순서가 아니라 지정한 프리셋으로 바뀌어요".
- Favourites are separate (DS-022). A ★ preset gets no slot automatically.

## 8. Keyboard, motion, accessibility

- **Switcher:** combobox plus listbox (slice 1 §5.1 pattern). Up/Down, Home/End, Enter, Esc. The live region announces "프리셋 {n}개".
- **Library:**
  - Groups are `role="group"` with a heading.
  - Rows use roving tabindex across the whole list: Up/Down, Home/End.
  - Left/Right collapse and expand a folder from its header.
  - Rows support F2, Alt+Up/Down, Delete (opens the delete dialog), Space in select mode, and the menu key or Shift+F10.
- **Back stack** (slice 1 order), each step undone before the next:
  1. A dialog or menu.
  2. The switcher.
  3. Select mode.
  4. Search.
  5. The library sub-page.
- **Motion:**
  - The switcher popover and sheet use the chat tokens.
  - Reorder: the moved row slides into place with `transform`, base duration; neighbours shift with `transform`.
  - Reduced motion uses a 120 ms crossfade; low power is instant.
  - Only `transform` and `opacity` animate.
- **Targets and forced colours:**
  - Targets are 44 dp on touch.
  - The drag handle is 44 × 44 on fine pointers too; it is hidden on touch, where long-press replaces it.
  - In forced colours, the slot and active badges get borders.

## 9. Integration map (lane A; nothing here edits these files)

| Change | Where |
|---|---|
| Stable `id` per preset. Add `folderId`, `favorite`, `slot`, `lastUsed` (or a separate `presetMeta` map); add `db.presetFolders`. Chain and loadouts refer to ids. | `database.svelte.ts:1636-1735`, `process/index.svelte.ts:597-612`, `loadout.ts:6-17,61-66` |
| Live write-through: preset-scoped edits update `botPresets[botPresetsId]` at once (or the active preset becomes the source of truth). Retire save-on-switch. Add an undo stack and restore points per preset. | `database.svelte.ts:2094-2339` (`presetFromWorkingSettings`, `saveCurrentPreset`, `changeToPreset`, `setPreset`) |
| Delete switches to the most recent other preset, with undo. "Add" copies the current preset. Import gets a preview, name-clash handling and a target folder. Export gets bundles and strips organisation fields. | `botpreset.svelte:244-309`, `database.svelte.ts:2355-2514` |
| Slot keys become hotkey entries `presetSlot1..9` (rebindable), with slot lookup instead of position. One-time migration of slots from the current order. | `hotkey.ts:309-366`, `defaulthotkeys.ts` |
| A new switcher component; the preset overlay is replaced by the library sub-page | `botpreset.svelte`, `stores.svelte.ts:42` (`openPresetList`), `App.svelte:243-244` |
| Chat header chip | the chat header (chat slice 1 integration map; main session) |
| The preset icon and compare move into Settings › 프리셋; the `showPromptComparison` gate is retired | `BotSettings.svelte:810-844`, `botpreset.svelte:72-91` |
| Strings | `src/lang/en.ts`, `ko.ts` |

## 10. Korean copy (proposed keys, en / ko)

| Key | en | ko |
|---|---|---|
| allPresets | All presets ({n}) | 모든 프리셋 ({n}) |
| searchPresets | Search presets | 프리셋 검색 |
| recentPresets / favourites / noFolder | Recent / Favourites / No folder | 최근 / 즐겨찾기 / 폴더 없음 |
| sortManual / sortRecent / sortName | Manual / Recently used / Name | 직접 정렬 / 최근 사용 / 이름 |
| sortHint | Switch to manual order to rearrange | 직접 정렬에서 순서를 바꿀 수 있어요 |
| switchedPreset | Switched to "{name}" | ‘{name}’(으)로 바꿨어요 |
| undo / redo | Undo / Redo | 실행 취소 / 다시 실행 |
| inUse | In use | 사용 중 |
| managePresets | Manage presets | 프리셋 관리 |
| newPreset / newFolder | New preset / New folder | 새 프리셋 / 새 폴더 |
| startFrom / copyCurrent / defaultTemplate | Start from / Copy current preset / Default template | 시작점 / 지금 프리셋 복사 / 기본 템플릿 |
| useNow | Create and use now | 만들고 바로 사용 |
| duplicateName | A preset with this name exists | 같은 이름이 있어요 |
| copySuffix | {name} copy | {name} 사본 |
| deletePresetQ | Delete "{name}"? | ‘{name}’ 프리셋을 지울까요? |
| lastPreset | You need at least one preset | 프리셋이 하나는 있어야 해요 |
| deletedPreset | Deleted "{name}" | ‘{name}’ 프리셋을 지웠어요 |
| deleteFolderQ | Delete the "{name}" folder? Its {n} presets move to No folder. | ‘{name}’ 폴더를 지울까요? 안의 프리셋 {n}개는 ‘폴더 없음’으로 옮겨져요 |
| moveToFolder | Move to folder | 폴더로 이동 |
| assignShortcut | Assign shortcut | 단축키 지정 |
| slotEmpty | Empty | 비어 있음 |
| slotMoveNote | {key} moves from "{from}" to this preset | {key}은(는) ‘{from}’에서 이 프리셋으로 옮겨져요 |
| move | Move | 옮기기 |
| slotUnassigned | No preset is assigned to {key} | {key}에 지정된 프리셋이 없어요 |
| assign | Assign | 지정하기 |
| slotMigrated | Ctrl+1–9 now go to the presets you assign, not to list positions | Ctrl+1~9는 이제 순서가 아니라 지정한 프리셋으로 바뀌어요 |
| saved / saving / saveFailed | Saved / Saving… / Couldn't save · Retry | 저장됨 / 저장 중… / 저장 실패 · 다시 시도 |
| undoneChange | Undid "{row}" {from} → {to} | ‘{row}’ {from} → {to} 되돌렸어요 |
| restorePoints | Restore points | 복원 지점 |
| changesCount | {n} changes | 변경 {n}개 |
| beforeRestore | Before restore | 복원 전 |
| keepOnSwitch | Keep on preset switch | 프리셋을 바꿔도 유지 |
| importPreview / keysNotIncluded | Import preview / API keys are not in the file | 가져오기 미리 보기 / API 키는 파일에 들어 있지 않아요 |
| select / done | Select / Done | 선택 / 완료 |
| movedAnnounce | Moved "{name}": {folder}, position {n} | ‘{name}’ 이동: {folder} {n}번째 |
| presetResults | {n} presets | 프리셋 {n}개 |
| noPresetMatch | No presets match "{q}" | ‘{q}’에 맞는 프리셋이 없어요 |

Particles (으)로, 은(는) and 을(를) follow the chat slice 1 §8 rule.

## 11. The mockup

### 11.1 Files

- `settings/slice2.html`, `slice2.css`, `slice2.js`, and `data2.js` (preset fixtures and folders). It loads slice 1's `slice1.css`, `slice1.js` and `data.js`.
- Slice 1 files may be changed where a hook is needed, since they belong to this lane. If they are, the **ss1 suite must stay green**: re-run it, and record the change in `checks/builder-checks.md`.
- The origin stub's chat header gets the chip in slice 2 only.

### 11.2 Fixtures (`?set=`)

| Set | Contents |
|---|---|
| `demo` | 60 presets in 8 folders, 6 favourites, slots 1–5 assigned, 5 recents |
| `stress` | 300 presets in 25 folders |
| `one` | a single preset |
| `fresh` | 12 presets, no folders, slots migrated 1–9, the migration notice showing |

### 11.3 States (`?state=`)

- **Switcher:** `ps-switcher-chip` (wide popover), `ps-switcher-palette`, `ps-switcher-phone`, `ps-switcher-search` (`q=롤`), `ps-switcher-chosung`.
- **After switching:** `ps-switched-toast`.
- **Library:** `ps-library`, `ps-library-sorted-name`, `ps-library-search`, `ps-library-select`, `ps-row-menu`, `ps-rename`, `ps-reorder-kb` (after Alt+Down).
- **Folders:** `ps-folder-new`, `ps-folder-delete`.
- **Create, delete, import:** `ps-new`, `ps-delete-active`, `ps-delete-undo`, `ps-delete-last`, `ps-import-preview`.
- **Slots:** `ps-slot-assign`, `ps-slot-move`, `ps-slot-empty-key`, `ps-hotkeys-slots`, `ps-migrated`.
- **Saving:** `ps-live-saved`, `ps-save-failed`, `ps-undo`, `ps-restore-points`.
- **Chip:** `ps-chip-narrow` (360 px), `ps-chip-menu`.
- **Fixtures:** `ps-stress-library`, `ps-one`.

Plus slice 1's parameters (`lang`, `w`, `reduced`, `lowpower`, `from`). The page sets `window.__ss2Ready` and exposes `window.__ss2`.

### 11.4 Checks

Suite `ss2` in `settings/checks/` (extend `run.mjs`). Same rules as slice 1:
- at most 3 Chrome workers;
- own profiles, deleted afterwards;
- the server at 6141, not stopped;
- KO and EN;
- widths 360 / 412 / 768 / 1024 / 1280.

Sections:

| Section | Covers |
|---|---|
| switcher | All openers; layout per width; search incl. 초성 and model match; recents; switching + toast + undo; generating reply keeps its preset (stub flag); the 300-preset timing |
| library | Groups; collapse memory; sort modes and the disabled-drag hint; search; select mode; row menu parity (⋯, right-click, long-press, Shift+F10); rename F2; reorder by pointer drag, touch long-press drag and Alt+Up/Down across folders, with announcements; folder create (name first), rename, delete (presets kept) |
| crud | New (both start points, duplicate-name warning, use-now off); duplicate placement; delete active → most recent other; undo restores everything; last-preset block; import preview + clash naming; export bundle |
| save | Live status; failure + retry; undo/redo buttons and Ctrl+Z / Ctrl+Shift+Z outside fields; the out-of-view undo message; restore points list + restore + "복원 전"; commit-on-blur before a switch |
| slots | Assign dialog; move confirmation; slot key switches; empty slot toast; ignored in text fields; 단축키 section rows; key re-capture + conflict; migration notice |
| chip | Content and truncation at 360/480/1280; menu; updates on every switch path; accessible name |
| a11y/modes | Roving focus; Back stack order; reduced motion / low power (transform/opacity only); forced colours; 200 % text |
| koen, stills, console | As slice 1 |
| ss1 regression | The full ss1 suite re-run if slice 1 files changed |

## 12. Open questions

- O-1 **Export of organisation:** should folder and favourite travel in a bundle export, for moving to a new device? The design default is no. A full backup keeps them in any case.
- O-2 **Restore-point storage** on floor devices: 10 per preset across 300 presets is a lot of data. Should there be a cap per app instead?
- O-3 **Preset chain UI:** the picker editor is proposed; does anyone still use chains?
- O-4 **Ctrl+0:** should it be a tenth slot, or open the switcher?

## 13. Design defaults to confirm

- Recents: 5.
- Switching mid-generation keeps the running reply's preset.
- Switcher layouts per width.
- Collapsed folders remembered per device.
- One folder level.
- New preset not used at once.
- Duplicate placement right after the original.
- Delete switches to the most recent other preset.
- Undo: 50 steps per session.
- Restore points: on activation and daily, 10 per preset.
- Organisation not exported.
- Slot migration from today's order.
- The chip shows the name only below 480 px.


## 14. Review answers (rev 2)

Review: [reviews/2026-10-26-settings-slice2-review.md](../reviews/2026-10-26-settings-slice2-review.md). Maintainer answers DS-023..033. Where this section differs from §1–§13, this section wins. Minor findings take the reviewer's suggested fix unless stated.

| Finding | Answer |
|---|---|
| R-01 | DS-023: Ctrl+P and Ctrl+1–9 work in text fields, as today. Ignored only during IME composition (`isComposing` / keyCode 229) and in inline rename inputs. Replaces the text-field rule in §2.1 and §7. Fix the `SLOT-ignored-composer` check to assert the opposite. |
| R-02, R-03, R-06 | DS-024 + DS-028: one **library undo stack** (preset delete, folder delete, bulk move, reorder, rename, slot change; at least 20 steps). Each toast undoes its own action; a later toast does not cancel an earlier action's undo, which stays in the stack. Ctrl+Z in the library (and in "최근 삭제") undoes the last library action; Ctrl+Z on the active preset card keeps meaning the parameter history (§5). Undoing a preset delete whose folder is gone puts it in "폴더 없음" and says so. Add a **"최근 삭제"** entry in the library toolbar ⋯ and at the end of the list: deleted presets with date, 복원 and 영구 삭제 (confirm); kept until restart or 30 days (mockup: session only). Counts in titles update on every change. |
| R-04 | Toast timer pauses while focus or pointer is in it, and for at least 10 s after it was announced; Alt+Z (or the platform undo) restores from anywhere in Settings without reaching the toast. On expiry with focus inside, focus moves to the logical next item (the row after the deleted one, or the list), never to body. One announcement per toast. |
| R-05 | Undo that would take back a slot now held by another preset restores the preset without the slot and says "Ctrl+n은 다른 프리셋이 쓰고 있어서 비워 뒀어요". |
| R-07 | DS-026: a failed save keeps the value, shows a lasting failed state on the field row, the card status and the chat-header chip (`alert-triangle`), and before switching preset, leaving Settings or closing the switcher pick it asks: 다시 시도 / 변경 취소 / 취소. Not forgotten on switch. |
| R-08 | DS-025: a lock stores its fields outside the preset while on. Rows under a lock show a `lock` marker and "모든 프리셋 공통" (this is where the DS-016 chip returns). Turning a lock on copies the active preset's values to the shared store; turning it off writes them back into the active preset only (say so in the confirm text). Switching never changes locked fields. |
| R-09 | DS-027: secret fields (proxy key and any key-like field) are never written to undo history or restore points. Restoring says "키는 그대로 두었어요". |
| R-10 | Chip at 400–479 px: if fewer than 6 visible characters of the preset name fit, use the icon-only form. Tooltip and accessible name keep the full name. |
| R-11 | Slot re-capture refuses Ctrl/Cmd + C, V, X, A, Z, Y, P, F, R, W, T, N, L, Tab, and Ctrl+0; only Ctrl+1–9 (DS-033). |
| R-12 | The 단축키-page select asks "Ctrl+n을 ‘이름’에서 옮길까요?" when the slot is taken, and announces the move with undo (library stack). |
| R-13 | DS-031: names max 60 characters (counter appears at 50); duplicate names warn inline on create, rename, duplicate, import and folders, never block. Long names truncate with ellipsis on one line in the card, rows, slot dialog and toast; full name in the tooltip. |
| R-14 | ★ group is collapsible like folders. The switcher shows each preset once: recents first; ★ and the rest skip anything already shown. |
| R-15 | Use one particle helper everywhere: picks by the final Hangul syllable, digits by Korean reading, Latin by a small table, falling back to "(으)로" style only when unknown. Fix the empty-name clear-slot announcement. |
| R-16 | Icon picker buttons get Korean names (북마크, 말풍선, 번역…) in KO. |
| R-17 | Import failure states: unreadable file, wrong format, newer version, partially valid bundle (import the valid ones, list the rest). Each with a message and no change to the library. |
| R-18 | DS-030: delete dialog lists chain and loadout uses ("체인 2개, 로드아웃 1개에서 빠져요"); undo restores them; rename updates references. Synthetic loadouts added to data2.js. |
| R-19 | Floor-device fallbacks: no reliance on `inert` (also set `aria-hidden` and trap focus in script), `inset` written out, `gap` in flex replaced or backed by margins, `:focus-visible` with a `:focus` fallback. Static grep check for each. |
| R-20 | Replace the tautological export check with one that runs a real export of a filed, starred preset and inspects the output; add cross-feature sequences (R-02, two deletes, fail + switch, lock + switch, secret in history). |
| R-21–R-24 | Reviewer's suggested fixes. |
| DS-029 | A message keeps the preset it was generated with for regenerate, continue and swipe. Show it in the message's info (mockup: tooltip on the chat stub message), no new UI otherwise. |
| DS-032 | Single export never includes folders/★. Bundle export has "폴더·즐겨찾기 포함", off by default. Resolves O-1. |
| DS-033 | Ctrl+0 unassigned. Resolves O-4. |

## 15. Re-review answers (rev 2.1)

Re-review: [reviews/2026-10-26-settings-slice2-rereview.md](../reviews/2026-10-26-settings-slice2-rereview.md) (R verdicts 16 fixed / 7 partly / 1 not; new N-01..N-18). Maintainer answers DS-034..038. Partly-fixed R items and N findings take the re-reviewer's suggested fix unless stated.

| Item | Answer |
|---|---|
| DS-034 | 최근 삭제 keeps presets 30 days across restarts; copy says only that. N-06: a preset permanently deleted from 최근 삭제 is never brought back by any undo. |
| DS-035 | Single export writes locked fields with the shared values in use (fixes the N-18 export part). |
| DS-036 | Ctrl+Z (library) and Alt+Z (anywhere in Settings) both listed in 단축키 and in the undo toast/button tooltips; Alt+Z reserved from slot capture; match by `code`, not `key` (N-09). Alt+Z also undoes a preset switch (R-04/N-10). |
| DS-037 | Create, duplicate and import join the library undo stack. |
| DS-038 | Messages embedding a user name are reworded so no particle follows the name (R-15/N-11), in KO; EN unchanged. |
| R-11 | Slot capture accepts only Ctrl+1–9 with no other modifier. |
| N-01/R-12 | Undo of a slot move restores both the old slot and any displaced owner; no false conflict message. Choosing a preset that owns another slot asks first. |
| N-02 | Every dialog opens with focus inside it; add a check over all dialogs. |
| N-03 | Toast at least min(100vw − 32 px, 360 px) wide on phones; message wraps to two lines before truncating; the verb is never cut. |
| N-04 | With a lock on, Ctrl+Z, 변경 취소 and restore act on the shared value the row shows. |
| N-05 | A toast never covers an open dialog's actions: it moves above the dialog footer or waits until the dialog closes. |
| N-07 | Failed-save guard also covers a switch during saving (wait for the result) and undoing a delete. |
| N-08/R-19 | Hidden toast and backgrounds are removed from the Tab order without `inert` (tabindex/aria-hidden in script). |
| N-12/R-13 | 50/60 counter on every name field: new, rename (inline and dialog), duplicate, folder. |
| N-13, N-14, N-15 | Fix copy: bundle export dialog agrees with its checkbox; delete dialog counts "체인 N곳" / "N chains" in future tense ("will be removed from"); toast label localised. |
| N-16 | Switcher search field 44 px. |
| N-17, R-21 | Low power drops the 0.12 s transitions; chip 44 px hit area (visual height may stay 36 px with padding to 44). |
| N-18, R-20 | Reviewer's fixes; add seam checks for every major (N-01..N-04) and N-05/N-06/N-08 as failing-first sequences. |
| DS-039 | Capturing a key that another preset holds asks "Ctrl+n을 ‘이름’과 바꿀까요?" (reworded per DS-038 so no particle follows the name: "Ctrl+n 바꾸기: ‘이름’ ↔ ‘이름’"); on yes the keys swap (the other preset gets this preset's old key or none), undoable. Same rule for the 단축키-page select. |

## Appendix: Parts (theme readiness, DD-142 to DD-159)

Added by the theme-readiness pass and extended by its fix round; the screen's behaviour is unchanged. Rule: [THEMING.md](../THEMING.md). Tokens: [theme-tokens.css](theme-tokens.css); loader and state mirror: [theme.js](theme.js); the pass: [THEME_AUDIT.md](THEME_AUDIT.md). A part is `data-part="settings-<role>"` on the element the Selector column names (the `th` suite reads this column: every element that carries the part must match it, and every instance of a main element class must carry some part). Names describe a role, not a look, and do not change once published. `data-part-critical` marks a surface a pack gives tokens to and never a rule; the pack-install rule (`checks/th/lint.mjs`) rejects a selector that can reach one. The slice 1 appendix lists the shell, row, dialog and state parts this slice builds on; slice 2's own parts:

| Part | Selector | Notes |
|---|---|---|
| `settings-preset-card` | `.row.ps-card` | the active preset's card at the top of the preset section: icon, name, save status, undo and redo |
| `settings-preset-chip` | `.o2-chip` | the preset chip in the origin stub's chat header; `data-mode` is `full`, `name` or `icon`; `data-failed` and **critical** after a failed save; `data-no-model` when the model name is dropped |
| `settings-preset-toast` | `#psToast` | the toast with an action; `data-on` while shown. **Critical** while it carries the Undo after a delete (`data-kind` is `delete`, `folder` or `conn-delete`) |
| `settings-toast-text` | `.pt-txt` | the text of a normal toast (`settings-critical-body` while it is the delete Undo) |
| `settings-toast-action` | `.pt-act` | the action of a normal toast (`settings-critical-action` while it is the delete Undo) |
| `settings-switcher` | `.sw-root` | the switcher layer: popover under the chip, palette (Ctrl+P) or phone sheet; `data-mode`, `data-open` |
| `settings-switcher-scrim` | `.sw-scrim` | its dim layer |
| `settings-switcher-panel` | `.sw-panel` | its dialog panel |
| `settings-switcher-search` | `.sw-q` | its search field |
| `settings-switcher-option` | `.sw-opt` | one preset or a "show more" line; `data-active` (the cursor), `data-current` (the preset in use) |
| `settings-switcher-option-name` | `.sw-name` | the name in it |
| `settings-preset-library` | `.ps-lib` | the library list (all presets, folders) |
| `settings-preset-group` | `section.ps-grp` | the favourites group, a folder, or the no-folder group; `data-closed` for a collapsed folder |
| `settings-preset-row` | `li.ps-li` | one preset in the library; `data-current` (the preset in use), `data-selected`, `data-dragging`, `data-lifted`, `data-renaming`, `data-highlight` |
| `settings-preset-row-main` | `.ps-main` | the main button of a preset row (icon, name, detail) |
| `settings-preset-row-name` | `.ps-name` | its name |
| `settings-preset-row-detail` | `.ps-sub` | its second line |
| `settings-preset-warning` | `.ps-warn` | the failed-save badge in a library row; **critical** |
| `settings-preset-selbar` | `.ps-selbar` | the bulk toolbar while selecting; `role="toolbar"` |
| `settings-notice` | `.ps-notice` | the one-time migration notice of the preset slots |
| `settings-restore-points` | `ul.ps-rps` | the list of restore points (and of 최근 삭제 entries) inside its dialog. **Critical** as part of a critical dialog |
| `settings-save-retry` | `.ps-retry` | **Critical.** The save-failed status and its retry button; the failed row (`.row.ps-failed`, a `settings-row` that gets `data-part-critical` and `data-failed`) is critical with it |

Critical in this slice: every dialog with a danger button (delete a preset, delete a folder, purge from 최근 삭제, the failed-save guard's discard), and by choice the last-preset warning, restore points and the restore confirmation, the import and export previews, 최근 삭제, the lock-off ask, the key swap and the slot take (`critical: true` at the call); the save-failed retry, the failed row and the failed chip; the Undo toast after a delete. A dialog's backdrop, title, body, footer and buttons are `settings-critical-*` while it is critical.

State attributes added here: `data-current` (`.is-active`, the preset in use), `data-selected`, `data-dragging`, `data-lifted`, `data-renaming`, `data-open`, `data-on`, `data-closed`, `data-failed`, `data-shared`, `data-selecting`, `data-capturing`, `data-no-model`; the table is in the slice 1 appendix and in [theme.js](theme.js).
