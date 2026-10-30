# Settings slice 5c-1: 화면·읽기 and 입력·접근성

Rev 1, 2026-10-28.

- **Decisions:**
  - DS-152..DS-168 in [DECISIONS-settings.md](DECISIONS-settings.md);
  - DS-101 (full refine);
  - DD-223 and DD-250 in [../DECISIONS.md](../DECISIONS.md).
- **Research:** [research/slice5c1-display-input.md](research/slice5c1-display-input.md), cited below as **R**. Anchors (`DSD:`, `ASD:`, `DB:`, `EN:`) are R's abbreviations.
- **Builds on:** slices 1–5b.
- **Slice 5c-2** (데이터·백업, 고급, 언어, DD-228 and the patterns/ adoption) comes later. Do not build its pages here.

## 0. Decisions in force

- **DS-152 Cut.** This slice covers:
  - 화면·읽기;
  - 입력·접근성;
  - the DD-250 all-modes-hidden repair state;
  - DD-223 across every Settings slice.
- **DS-154 Depth.** Full refine:
  - regroup, plain labels and real controls;
  - remove invented rows, fix dead or misleading options;
  - everything sourced from R §1.
- **DS-155 / DS-156 Mode visibility.**
  - A new profile-wide stored set of visible modes (`rp`, `hybrid`, `utility`) plus a hide-unused flag.
  - Any one mode may be the only visible one.
- **DS-157 Motion.** Low power (on/off) and reduce motion (follow system/on/off) become real new stored settings. They are engine items.
- **DS-158 Invented accessibility rows.**
  - Keep, tagged `새 기능`: haptics off, edge swipe, reduce transparency.
  - Remove: screen-reader hints, focus ring.
  - Large targets has no source and isn't in the keep list, so it is removed too.
- **DS-159 Dead settings.** Hide `showMemoryLimit`, `memoryLimitThickness` and `moveInsteadOfCopyOnCMPConvert` from both the page and search. Also hide `chatfeat.memLimit` from 5b's data.
- **DS-160 Chat themes.** All five chat themes with plain names and a thumbnail. The dead `custom` value is not offered.
- **DS-161 Colour schemes.** All 16 colour schemes plus custom, as swatches.
- **DS-162 Animation speed.** A 느림–빠름 slider; the stored duration is reversed behind it.
- **DS-163 Misplaced rows.** These move to their owning page (§3.4).
- **DS-164 API keys.** The `hideApiKey` switch is retired; keys get a per-field reveal.
- **DS-165 Notifications.** One switch plus a permission status line.
- **DS-166 Undo toasts.** Every undo toast says how long undo lasts.
- **DS-167 Quote boxes.** They appear only when custom quotes is on, with a live preview.
- **DS-168 Legacy GUI.** `useLegacyGUI` is dropped.

## 1. Where things live

- **화면·읽기 (`display`).** Six groups, in this order:
  1. 모드 (only shown in the repair state, and at the top; §4);
  2. 테마와 색;
  3. 글꼴과 크기;
  4. 채팅 표시;
  5. 소리와 알림;
  6. 움직임과 성능.
  
  Then a collapsed 고급 (custom CSS, beta mobile GUI). R §8.1 is the starting point.
- **입력·접근성 (`input`).** Six groups:
  1. 보내기와 입력창;
  2. 메시지 편집;
  3. 스크롤;
  4. 제스처와 터치;
  5. 메뉴와 사이드바;
  6. 삭제와 확인.
  
  Then a short 보기 쉽게 group pointing to the real readability settings on 화면·읽기 (text colour high contrast, text size, input sizes), each as a jump link, not a duplicate row. The page title stays 입력·접근성.
- **Section ids.**
  - Keep the existing `display.*` and `input.*` section ids where a group survives.
  - Add new ids with the same prefix.
  - Deep links to removed sections fall back to the page with the not-found notice (existing rule).

## 2. 화면·읽기 rows (from R §1.1–1.3)

Every row names its stored field and uses the real type, default and bounds from R. The mockup's invented values (R §2.2) are replaced.

### 2.1 테마와 색

- **채팅 테마 (`theme`).** A radio card group with thumbnails:
  - 기본 (`''`), 와이푸 (`waifu`), 모바일 채팅 (`mobilechat`), 카드보드 (`cardboard`), 직접 만든 HTML (`customHTML`).
  - Thumbnails are small CSS drawings (no images), each with a one-line description.
- **Theme-dependent rows.**
  - 와이푸 shows 채팅 폭 (`waifuWidth`, 50–200 %) and 캐릭터 크기 (`waifuWidth2`, 20–150 %).
  - 직접 만든 HTML shows the HTML editor (`guiHTML`, a multiline code field with a short help line).
  - Hidden rows are not in the DOM.
- **색 구성 (`colorSchemeName`).**
  - A swatch grid of the 16 real presets (R §1.1 list, ids and capitalised names) plus 직접 만들기.
  - Each swatch is a radio with its name.
  - 직접 만들기 opens the custom colour editor: 10 colours plus a 어두운/밝은 type, as colour fields with hex input. It lives on a sub-view `view=custom-colors`.
  - Swatches use flat colour blocks, not `conic-gradient`. This keeps the Pi 3 cheap and is fine for a mockup.
- **글자 색 (`textTheme`).**
  - Options: 기본, 고대비 (`highcontrast`), 직접 만들기.
  - 직접 만들기 opens a small editor (`customTextTheme`: normal, italic, bold colours).
- **배경 이미지 (`customBackground`).**
  - A switch with a file pick (png, webp, gif; simulated).
  - It shows the chosen file name and size, with 바꾸기 and 지우기.
  - Cancelling the pick leaves the old value.
  - A GIF shows a low-power hint: "움직이는 배경은 저전력 기기에서 느릴 수 있어요".
- **채팅 화면.** A small subgroup, with a live preview tile:
  - 화면 색 (`textScreenColor`, optional colour);
  - 테두리 색 (`textScreenBorder`, optional colour);
  - 둥근 모서리 (`textScreenRounded`);
  - 글자 윤곽선 (`textBorder`).

### 2.2 글꼴과 크기

- **글꼴 (`font`).**
  - Options: 기본, Times New Roman, 직접 입력.
  - 직접 입력 shows a labelled text field (`customFont`; app bug: it has no label) with a help line.
- **채팅 글자 크기 (`zoomsize`).** 50–200 %, step 5, with a reset to 100. Help says it also scales the message editor.
- **줄 간격 (`lineHeight`).** 0.5–3, step 0.05, default 1.25.
- **프로필 사진 크기 (`iconsize`).** 50–200 %. The label is plain because the stored name is "icon".
- **입력창 크기 (`textAreaSize`).** −5..5, as a named-step slider. The KO step names replace the app's hard-coded English (R §1.2).
- **입력창 글자 크기 (`textAreaTextSize`)** and **사이드바 폭 (`sideBarSize`).** 0..3, named steps.
- **에셋 이미지 최대 폭 (`assetWidth`).**
  - A segmented choice: 제한 없음 (−1), 숨기기 (0), 직접 정하기.
  - 직접 정하기 shows a slider of 1–40 rem.
  - This removes the special values hidden in the slider.
- **설정 닫기 버튼 크기 (`settingsCloseButtonSize`).** 16–48 px. Shown on desktop layouts only; on phone layout, show a note instead.

### 2.3 채팅 표시

- **Quotes.**
  - 따옴표 꾸미기 끄기 (`unformatQuotes`): reworded positively as "따옴표 꾸미기" with the inverse value. Say so in an engine note.
  - 인용문 꾸미기 (`blockquoteStyling`).
  - 따옴표 직접 정하기 (`customQuotes`): when on, show the four boxes (`customQuotesData`, default “ ” ‘ ’) and a live preview line (DS-167).
- **첫 메시지 넘기기 표시 (`showFirstMessagePages`).** Dimmed with explain-only when 스와이프 (`swipe`) is off, with a jump link to it.
- **Other rows:**
  - 메시지 복사 버튼 (`useChatCopy`);
  - 저장 중 아이콘 (`showSavingIcon`, default off);
  - 둥근 프로필 사진 (`roundIcons`);
  - 폴더 이름 표시 (`showFolderName`);
  - 모든 이미지 숨기기 (`hideAllImages`; help lists what is hidden, EN:684);
  - RisuRealm 숨기기 (`hideRealm`).
- **채팅 스티커 (`useChatSticker`).** Inside 고급 with the "추천하지 않아요" note (it shows only with `showUnrecommended` in the app; mirror that).

### 2.4 소리와 알림

- **메시지 알림음 (`playMessage`).** Help says it plays a short sound, not reading aloud.
- **번역 끝 알림음 (`playMessageOnTranslateEnd`).**
- **알림 (`notification`, DS-165).**
  - One switch, plus a status line: 허용됨, 차단됨 (브라우저 설정에서 바꿔요), or 이 기기에서는 지원하지 않아요.
  - Turning it on simulates the permission prompt. On denial the switch turns itself off, and the line says so (app behaviour, R §1.3).

### 2.5 움직임과 성능 (DS-157, DS-162)

- **저전력 모드 (`lowPower`, new).** On/off. Wire it to the existing mockup low-power mode (slice 1 `setLowPower`), so it is one control, not two.
- **움직임 줄이기 (`reducedMotion`, new).** 시스템 설정 따르기 / 켜기 / 끄기. Wire it to the existing `S.rm` logic.
- **애니메이션 속도 (`animationSpeed`).**
  - A 느림–빠름 slider.
  - The stored value is 1 − position, in 0.05 steps, with 0 s = 즉시 at the 빠름 end (label it).
  - Reduce motion or low power on → dimmed with explain-only ("움직임 줄이기가 켜져 있어 지금은 쓰지 않아요").
- **진동 끄기 (haptics, new, tagged `새 기능`).** Touch devices only; desktop shows a note.

### 2.6 고급 (collapsed)

- **사용자 CSS (`customCSS`).** A code field with help. Remove the unverified Ctrl+. promise (R §1.3).
- **새 모바일 화면 (베타) (`betaMobileGUI`).** Help: "폭 800px 이하에서만, 새로고침 후 적용돼요".
- **전체 화면 (`fullScreen`).** Tauri desktop only. In the mockup, show it on the `desktop-app` fixture only.

### 2.7 Removed from the page

- Dead rows (DS-159).
- `useLegacyGUI` (DS-168).
- `hideApiKey` (DS-164). Search for it finds the 연결 keys note: "키는 항상 가려져요 · 칸마다 보기 버튼이 있어요". Check that slice 3's key fields have a per-field reveal; if they don't, add one in 5c1's layer.
- Invented `display.background` network/solid choices and `display.streamOpt`. Streaming optimisation is retired by DD at DECISIONS.md:520.
- `display.keepAlive`, which belongs to 고급 and goes to 5c-2.

## 3. 입력·접근성 rows (from R §1.4)

### 3.1 보내기와 입력창

- **Enter로 보내기 (`sendWithEnter`).** Help: "꺼져 있으면 Shift+Enter로 보내요". Move the note here from `fixedChatTextarea`.
- **입력창을 화면 아래에 고정 (`fixedChatTextarea`).** The plain label only.
- **보조 메뉴 rows:**
  - 채팅 목록 메뉴 (`showMenuChatList`);
  - 기억 요약 창 메뉴 (`showMenuHypaMemoryModal`);
  - 옆 메뉴 다시 생성 버튼 (`sideMenuRerollButton`).
  - Use the real defaults (off, R §2.2).

### 3.2 메시지 편집

- **글자를 눌러 편집 (`clickToEdit`).**
- **길게 눌러 편집 창 열기 (`longPressToPopupEditor`).** Touch.
- **끌어 선택해 부분 편집 (`enableDragPartialEdit`).**
- **마우스를 올려 부분 편집 (`enableBlockPartialEdit`).** On a touch-only fixture, explain-only: "마우스가 있어야 써요".

### 3.3 스크롤

- **새 메시지로 자동 스크롤 (`autoScrollToNewMessage`, default on).**
- **항상 스크롤 (`alwaysScrollToNewMessage`).** Shown only when auto-scroll is on.
- **새 메시지 버튼 위치 (`newMessageButtonStyle`).**
  - Shown only when auto-scroll is on and always-scroll is off.
  - A small position picker with 6 positions, drawn as a phone outline with dots: 아래 가운데, 아래 오른쪽, 아래 왼쪽, 떠 있는 원, 오른쪽 가운데, 위 막대.
  - Help: "위로 올려 보고 있을 때 나타나요".

### 3.4 제스처와 터치

- **스와이프로 다시 생성 (`swipe`, default on).**
- **가장자리 스와이프로 사이드바 열기 (new, `새 기능`).**
- **메뉴 버튼을 사이드바 아래로 (`hamburgerButtonBottom`).**
- **진동 끄기.** Lives on 화면·읽기 §2.5; here it is only a jump link.

### 3.5 메뉴와 사이드바

- **사이드바 (`menuSideBar`).** Plain label: "사이드바 보이기"; default off (the app stores no default, DS-172); help says what it shows.
- **시작할 때 캐릭터 메뉴 열기 (`botSettingAtStart`).** Fix the mockup's "Start in settings" (R §2.2).
- **사이드바 항목 직접 정하기 (`customSidebarItems`).**
  - A list with add (search any setting) and remove.
  - Remove gets undo (DS-166) rather than the app's instant delete.
  - A sub-view `view=sidebar-items`.
- **고급 도구 보이기 (`enableRisuaiProTools`).** One row here (DS-173); 고급 has only a jump link. Default on when plugins exist. Help names what appears.
- **투명도 줄이기 (new, `새 기능`).**

### 3.6 삭제와 확인

- **메시지 지울 때 확인 (`askRemoval`, default on).**
- **지울 때 범위 묻기 (`instantRemove`, DS-169; fix round 1).**
  - Renamed for what it does: when on, deleting a message asks "이 메시지만 / 이 메시지와 뒤의 대화" (Chat.svelte:272-303); nothing deletes automatically.
  - No caution line and no dialog on the switch itself.
- **분기할 때 폴더 만들기 (`createFolderOnBranch`, default on).**
- **오류를 채팅에 표시 (`inlayErrorResponse`, default off).**
- **번역 중 표시 (`showTranslationLoading`).**

### 3.7 Moved out (DS-163)

Each row leaves this page; search finds it at its new home.

- **Prompt comparison (`showPromptComparison`):** to 모델·프리셋 › 프리셋, next to `models.compare`.
- **Apply parameters to all models (`applyAdditionalParamsToAll`):** to 모델·프리셋 › 파라미터 (slice 4's page).
- **Additional-asset preview, local activation in global lorebook, lorebook bulk enabling** (`useAdditionalAssetsPreview`, `localActivationInGlobalLorebook`, `bulkEnabling`): to Studio.
  - Settings keeps a search-only entry that says "스튜디오에서 바꿔요", with a Studio deep link (`studioHref`, `display`).
  - It is not a row.
- **Go to character on import, request info in chat** (`goCharacterOnImport`, `requestInfoInsideChat`): to 데이터·백업 and 고급 respectively.
  - Those pages are refined in 5c-2.
  - Add the rows to the existing pages now, plainly labelled, and 5c-2 regroups them.

## 4. DD-250 repair state (DS-155, DS-156)

- **Fixture.** `?fixture=all-modes-hidden-repair` (Home's link: `page=display&fixture=all-modes-hidden-repair`, plus `from=home&mode=<m>`).
  - Visible modes are Home's `mode` only, and hide-unused is on.
  - Without `mode`, use `hybrid`.
- **Placement.** 화면·읽기 opens with the 모드 group first, preceded by a warning banner (the critical warning part): "홈에 {모드} 모드만 보이고 있어요".
- **모드 group** (also shown outside the fixture, as the first group of 화면·읽기):
  - Three checkboxes, 롤플레이 (`rp`), 하이브리드 (`hybrid`) and 유틸리티 (`utility`), each with a one-line description. Use Home's names: read home/data.js for the labels, and do not edit it.
  - **The mode Home is in stays checked.** Its checkbox is disabled with a reason "지금 쓰고 있는 모드예요". The last checked mode is disabled with "하나는 보여야 해요". Any mode may be the only one (DS-156).
  - **사용하지 않는 모드 숨기기** (the hide-unused flag): a switch.
  - **모든 모드 보이기**: a primary button. It opens one confirm that names the modes to show, and says hide-unused turns off; Cancel is focused. On confirm, all modes become visible and hide-unused turns off.
  - The status line (role=status) says "모드 3개가 모두 보여요". Toast: "모든 모드를 다시 보이게 했어요", with 되돌리기 for 10 s (DS-166 wording).
  - Back still goes Home (DD-210). The new visibility is simulated; the mockup does not write Home's storage.
  - With all modes visible, the button is disabled, with "이미 모두 보여요".
- **Storage.** A new profile-wide `visibleModes` set and `hideUnusedModes` flag (proposed names; engine item).

## 5. DD-223 / DS-166 undo windows (all Settings slices)

- **One rule.** Every toast with 되돌리기 shows for 10 s (`CFG.undoMs`).
- **Its sub line says how long undo lasts:**
  - If Alt+Z or Ctrl+Z still works after the toast (the LU stack): "이 화면을 떠나기 전까지 Alt+Z로 되돌릴 수 있어요" / "Undo with Alt+Z until you leave this page". On Mac use ⌘Z wording (DS-109).
  - If undo ends at 10 s (5b cache clear): "10초 동안만 되돌릴 수 있어요" / "Undo is available for 10 s".
  - If it ends earlier on a condition, say the condition:
    - a purge in 최근 삭제: "영구 삭제하면 되돌릴 수 없어요";
    - a preset switch: "이전 프리셋을 지우면 되돌릴 수 없어요";
    - a connection: "되돌려도 키는 다시 넣어야 해요" (merge it with the existing Set-key toast).
- **Implementation.** A single helper in this slice's layer (or slice2's toast, if that is where the one `psToast` lives) that takes `{until: 'page'|'10s'|<reason key>}`. Apply it to every toast in R §4's table, 5c-1's own toasts included.
  - Editing slices 2–5b is allowed for this.
  - Change only the toast calls and the helper; keep everything else.
  - Earlier suites' assertions on toast text change only where this adds the sub line; list each one.
- **Pre-existing toasts with a sub line** (5a persona delete): the until-line is appended as a second line, not a replacement.

## 6. Keyboard, motion, accessibility

- **Controls.**
  - Swatches and theme cards are radio groups: arrow keys move, Space and Enter select, one tab stop.
  - The position picker is a radio group with visible labels.
  - Named-step sliders announce the step name (`aria-valuetext`).
  - The 느림–빠름 slider announces "빠름, 0.15초" style text.
- **Dependent rows.** They appear and disappear without moving focus. When a row the user is on disappears (a toggle hides its children), focus stays on the toggle.
- **Motion.** Reduce motion: theme thumbnail transitions off and preview tiles static. Low power: no blur or shadow animation and no preview transitions.
- **Layout.** At 360 px, swatches wrap three per row with names under them (KO names may wrap to two lines). The 6-dot picker fits 360.
- **Language.** KO and EN, Korean first, with lucide icons on icon buttons.

## 7. Integration map (Lane A)

The builder writes "Engine items" at the end of this spec. They must cover at least:

- the new stored fields (`visibleModes`, `hideUnusedModes`, `lowPower`, `reducedMotion`, the haptics off flag, the edge-swipe and reduce-transparency proposals) and their migration defaults;
- the inverse presentation of `unformatQuotes` and `animationSpeed`;
- `customFont`'s missing label;
- the `newMessageButtonStyle` dependency;
- the moved rows (DS-163);
- the `hideApiKey` retirement and the per-field reveal;
- hidden dead fields;
- the `useLegacyGUI` removal;
- `customSidebarItems` remove with undo;
- notification permission handling (guard `Notification.requestPermission`, R §5);
- the DD-223 toast helper;
- the step-name strings that replace hard-coded English.

## 8. The mockup

### 8.1 Files

- `slice5c1.html`, `slice5c1.css` (`--p5c-*` tokens) and `slice5c1.js` (hooks on `SS1_EXT`, loaded after `slice5b.js`).
- `data5c1.js`: rows replacing `display.*` and `input.*`, the moved rows, the copy, and the fixtures.
- **Shared and earlier files.**
  - Slices 1–5b keep their pages and stay green.
  - The allowed edits outside the new files are: the DD-223 toast helper and its call sites; `themes/banana-cocoa.css` rules for the new parts (use `--pack-*` helpers only; DD-258); and `index.html`'s target, which moves to `slice5c1.html` once 5c-1 is accepted. Change that target in the final round, not before.
- **Theme.** Add parts and `data-part-critical` for the repair banner, the 모드 group's controls.
  - Write a new `checks/th5c1/registry5c1.mjs` that extends `REG5B`, including the `settable` pattern for `--p5c-*`.
  - Do not edit existing registries; they are the lint builder's. Report what Lane A must merge.
  - Floors and ceilings: any `--p5c-*` size token gets a ceiling (DD-260), and the banner edge gets a floor.

### 8.2 Fixtures (`?set=` and `?fixture=`)

| Set or fixture | Contents |
|---|---|
| `demo` | Standard theme, scheme `default`, Korean, notification permission "allowed", 3 custom sidebar items. |
| `touch` | A touch-only device: hover rows explain-only, haptics shown. |
| `desktop-app` | The Tauri desktop app, so the full-screen row is shown. |
| `custom` | The `customHTML` theme with HTML, a custom colour scheme, custom quotes on, a custom font, and a GIF background. |
| `denied` | Notification permission blocked. |
| `?fixture=all-modes-hidden-repair` | §4, combined with `mode=`. |

### 8.3 States (`?state=`)

- **di-:** `di-theme-waifu`, `di-theme-html`, `di-swatches`, `di-custom-colors`, `di-text-custom`, `di-bg-gif`, `di-asset-custom`, `di-quotes-on`, `di-notify-denied`, `di-motion-reduced`, `di-lowpower`, `di-advanced-open`.
- **in-:** `in-scroll-picker`, `in-scroll-hidden` (always-scroll on), `in-instant-caution`, `in-sidebar-items`, `in-sidebar-undo`, `in-touch-hover`.
- **mo-:** `mo-repair`, `mo-repair-confirm`, `mo-repair-done`, `mo-last-mode`.
- **un-:** `un-toast-page`, `un-toast-10s`, `un-toast-reason` (DD-223 samples).
- **se-:** `se-hideapikey`, `se-lorebook-moved`, `se-memlimit-none` (finds nothing).

### 8.4 Checks

- **New suite `ss5c1`.** It covers every row's field, default, bounds and visibility rule against R, and every state.
  - Keyboard: radio groups, sliders' `aria-valuetext`, focus kept when rows hide.
  - The repair flow at 360 and 1280 in KO and EN, including Back to Home with `return`.
  - DD-223 sub lines on each toast family across slices 2–5b; low power and reduce motion; the search rules for removed and moved rows; phone layout 360; no console errors.
- **New suite `th5c1`.** Parts, critical names, the floor and ceilings, and default look.
- **Regression, one at a time:** ss1–ss5b, hr, th, th4, th5a and th5b. The theme suites run only after main's lint fix list has landed (check `checks/builder-checks-thfix.md` exists and reports green before relying on them).
- Use distinct `--tag`s and logs in `checks/logs/`. Run at most 3 Chrome workers. Leave no processes.

## 9. Korean copy

Filled by the builder from `data5c1.js` (generated by `checks/tools/gen-copy5c1.mjs`). The table covers every label, explanation, warning, failure and empty state above; `koen` reads it back and compares it with the page. Korean first (해요체), 첫 메시지 and never "greeting".

| Key | 한국어 | English |
|---|---|---|
| **Sections** | | |
| `group:display.modes` | 모드 | Modes |
| `group:display.theme` | 테마와 색 | Theme and colours |
| `group:display.font` | 글꼴과 크기 | Fonts and sizes |
| `group:display.chat` | 채팅 표시 | Chat display |
| `group:display.sound` | 소리와 알림 | Sound and notifications |
| `group:display.lowpower` | 움직임과 성능 | Motion and performance |
| `group:display.advanced` | 고급 | Advanced |
| `group:input.send` | 보내기와 입력창 | Sending and the input box |
| `group:input.edit` | 메시지 편집 | Editing messages |
| `group:input.scroll` | 스크롤 | Scrolling |
| `group:input.gestures` | 제스처와 터치 | Gestures and touch |
| `group:input.menu` | 메뉴와 사이드바 | Menus and the sidebar |
| `group:input.confirm` | 삭제와 확인 | Deleting and confirming |
| `group:input.a11y` | 보기 쉽게 | Easier to read |
| **Catalogue rows: label and description (search and the rows of the pages)** | | |
| `row:display.modeRp` | 롤플레이 모드 보이기 | Show Roleplay mode |
| `row:display.modeHybrid` | 하이브리드 모드 보이기 | Show Hybrid mode |
| `row:display.modeUtility` | 유틸리티 모드 보이기 | Show Utility mode |
| `row:display.hideUnused` | 쓰지 않는 모드 숨기기 | Hide unused modes |
| `rowdesc:display.hideUnused` | 켜면 체크를 푼 모드는 홈에서 사라져요 | When on, modes you unchecked disappear from Home |
| `row:display.showAllModes` | 모든 모드 보이기 | Show all modes |
| `row:display.theme` | 채팅 테마 | Chat theme |
| `rowdesc:display.theme` | 채팅 화면의 전체 모양을 골라요 | Pick the overall look of the chat screen |
| `row:display.waifuWidth` | 채팅 폭 | Chat width |
| `rowdesc:display.waifuWidth` | 와이푸 테마에서 대화 칸의 폭이에요 | The width of the chat column in the Waifu theme |
| `row:display.waifuSize` | 캐릭터 크기 | Character size |
| `rowdesc:display.waifuSize` | 와이푸 테마에서 캐릭터 그림의 크기예요 | The size of the character picture in the Waifu theme |
| `row:display.guiHtml` | 채팅 HTML | Chat HTML |
| `row:display.colorScheme` | 색 구성 | Colour scheme |
| `rowdesc:display.colorScheme` | 앱 전체 색을 골라요 | Pick the colours of the whole app |
| `row:display.customColors` | 직접 만든 색 고치기 | Edit your colours |
| `row:display.textTheme` | 글자 색 | Text colour |
| `rowdesc:display.textTheme` | 고대비는 글자를 더 또렷하게 보여요 | High contrast makes text stand out more |
| `row:display.customTextTheme` | 글자 색 직접 만들기 | Edit your text colours |
| `row:display.background` | 배경 이미지 | Background image |
| `rowdesc:display.background` | png, webp, gif 파일을 배경으로 써요 | Use a png, webp or gif file as the background |
| `row:display.textScreenColor` | 화면 색 | Screen colour |
| `rowdesc:display.textScreenColor` | 채팅 칸 뒤에 깔 색이에요. 끄면 색 구성을 따라요 | The colour behind the chat. Off follows the colour scheme |
| `row:display.textScreenBorder` | 테두리 색 | Border colour |
| `rowdesc:display.textScreenBorder` | 채팅 칸 둘레의 테두리 색이에요. 끄면 테두리가 없어요 | The colour of the border around the chat. Off means no border |
| `row:display.textScreenRounded` | 둥근 모서리 | Rounded corners |
| `rowdesc:display.textScreenRounded` | 채팅 칸의 모서리를 둥글게 해요 | Rounds the corners of the chat area |
| `row:display.textBorder` | 글자 윤곽선 | Text outline |
| `rowdesc:display.textBorder` | 글자 둘레에 윤곽선을 둘러 읽기 쉽게 해요 | Draws an outline around text so it is easier to read |
| `row:display.font` | 글꼴 | Font |
| `row:display.customFont` | 글꼴 이름 | Font name |
| `row:display.zoom` | 채팅 글자 크기 | Chat text size |
| `rowdesc:display.zoom` | 메시지 편집 칸의 글자도 같이 커져요 | The message editor scales with it |
| `row:display.lineHeight` | 줄 간격 | Line spacing |
| `row:display.iconSize` | 프로필 사진 크기 | Profile picture size |
| `rowdesc:display.iconSize` | 채팅에 나오는 캐릭터 사진의 크기예요 | The size of the character picture in chat |
| `row:display.textAreaSize` | 입력창 크기 | Input box size |
| `row:display.textAreaText` | 입력창 글자 크기 | Input box text size |
| `row:display.sidebarSize` | 사이드바 폭 | Sidebar width |
| `row:display.assetWidth` | 에셋 이미지 최대 폭 | Asset image max width |
| `rowdesc:display.assetWidth` | 채팅에 나오는 에셋 이미지의 폭이에요 | The width of asset images shown in chat |
| `row:display.assetRem` | 최대 폭 | Max width |
| `row:display.settingsCloseSize` | 설정 닫기 버튼 크기 | Settings close button size |
| `row:display.quoteStyle` | 따옴표 꾸미기 | Style quotes |
| `rowdesc:display.quoteStyle` | 따옴표 안의 글을 다른 색으로 보여요 | Shows quoted text in a different colour |
| `row:display.blockquote` | 인용문 꾸미기 | Style block quotes |
| `rowdesc:display.blockquote` | 따옴표로 묶은 말을 따로 한 덩어리로 띄워 보여요 | Sets quoted dialogue apart as its own block |
| `row:display.customQuotes` | 따옴표 직접 정하기 | Choose your own quote marks |
| `rowdesc:display.customQuotes` | 켜면 따옴표 네 개를 직접 정해요 | When on, you choose the four quote marks |
| `row:display.firstPages` | 첫 메시지 넘기기 표시 | Show first-message pages |
| `rowdesc:display.firstPages` | 첫 메시지에 “1/3” 같은 쪽 표시를 보여요 | Shows a “1/3” pager on the first message |
| `row:display.copyBtn` | 메시지 복사 버튼 | Message copy button |
| `rowdesc:display.copyBtn` | 메시지마다 복사 버튼을 보여요 | Shows a copy button on every message |
| `row:display.savingIcon` | 저장 중 아이콘 | Saving icon |
| `rowdesc:display.savingIcon` | 저장하는 동안 작은 아이콘을 보여요 | Shows a small icon while saving |
| `row:display.roundIcons` | 둥근 프로필 사진 | Round profile pictures |
| `row:display.folderName` | 폴더 이름 표시 | Show folder names |
| `row:display.hideImages` | 모든 이미지 숨기기 | Hide all images |
| `row:display.hideRealm` | RisuRealm 숨기기 | Hide RisuRealm |
| `row:display.playMessage` | 메시지 알림음 | Message sound |
| `rowdesc:display.playMessage` | 답이 오면 짧은 알림음이 나요. 소리 내어 읽어 주는 건 아니에요 | Plays a short sound when a reply arrives. It does not read the reply aloud |
| `row:display.playTranslate` | 번역 끝 알림음 | Translation-done sound |
| `row:display.notification` | 알림 | Notifications |
| `rowdesc:display.notification` | 답이 오면 기기 알림으로 알려요 | Tells you about new replies with a device notification |
| `row:display.lowPower` | 저전력 모드 | Low-power mode |
| `rowdesc:display.lowPower` | 흐림·그림자·장식 애니메이션을 끄고 전환을 짧게 해요 | Turns off blur, shadows and decorative animation, and shortens transitions. |
| `row:display.reducedMotion` | 움직임 줄이기 | Reduce motion |
| `rowdesc:display.reducedMotion` | 화면이 움직이는 효과를 줄여요 | Cuts the moving effects on screen |
| `row:display.animSpeed` | 애니메이션 속도 | Animation speed |
| `rowdesc:display.animSpeed` | 빠름 끝은 즉시(0초)예요 | The fast end is instant (0 s) |
| `row:display.haptics` | 진동 끄기 | Turn off vibration |
| `rowdesc:display.haptics` | 버튼을 누를 때 나는 진동을 꺼요 | Stops the vibration when you press things |
| `row:display.customCss` | 사용자 CSS | Custom CSS |
| `row:display.betaMobileGui` | 새 모바일 화면 (베타) | New mobile layout (beta) |
| `row:display.fullScreen` | 전체 화면 | Full screen |
| `rowdesc:display.fullScreen` | 데스크톱 앱에서만 쓸 수 있어요 | Only available in the desktop app |
| `row:display.sticker` | 채팅 스티커 | Chat stickers |
| `rowdesc:display.sticker` | 추천하지 않아요 | Not recommended |
| `row:input.sendWithEnter` | Enter로 보내기 | Send with Enter |
| `rowdesc:input.sendWithEnter` | 꺼져 있으면 Shift+Enter로 보내요 | When off, Shift+Enter sends |
| `row:input.fixedInput` | 입력창을 화면 아래에 고정 | Pin the input box to the bottom of the screen |
| `row:input.menuChatList` | 채팅 목록 메뉴 | Chat list menu |
| `rowdesc:input.menuChatList` | 입력창 메뉴에 채팅 목록을 넣어요 | Adds the chat list to the input box menu |
| `row:input.menuHypa` | 기억 요약 창 메뉴 | Memory summary menu |
| `rowdesc:input.menuHypa` | 입력창 메뉴에 기억 요약 창을 여는 항목을 넣어요 | Adds an item that opens the memory summary window |
| `row:input.menuReroll` | 옆 메뉴 다시 생성 버튼 | Side-menu regenerate button |
| `rowdesc:input.menuReroll` | 옆 메뉴에 답을 다시 만드는 버튼을 넣어요 | Adds a button that regenerates the reply |
| `row:input.clickEdit` | 글자를 눌러 편집 | Tap text to edit |
| `row:input.longPressEdit` | 길게 눌러 편집 창 열기 | Long-press to open the editor |
| `rowdesc:input.longPressEdit` | 터치 기기에서 메시지를 길게 누르면 편집 창이 열려요 | On touch devices, a long press on a message opens the editor window |
| `row:input.dragEdit` | 끌어 선택해 부분 편집 | Select text to edit part of it |
| `row:input.blockEdit` | 마우스를 올려 부분 편집 | Hover to edit part of a message |
| `rowdesc:input.blockEdit` | 마우스를 문단에 올리면 그 부분만 고칠 수 있어요 | Hover over a paragraph to edit just that part |
| `row:input.autoScroll` | 새 메시지로 자동 스크롤 | Scroll to new messages |
| `row:input.alwaysScroll` | 항상 스크롤 | Always scroll |
| `rowdesc:input.alwaysScroll` | 위로 올려 보고 있어도 새 메시지가 오면 맨 아래로 가요 | Jumps to the bottom on a new message even if you scrolled up |
| `row:input.newMsgButton` | 새 메시지 버튼 위치 | New-message button position |
| `row:input.swipe` | 스와이프로 다시 생성 | Swipe to regenerate |
| `rowdesc:input.swipe` | 답을 옆으로 밀어 다시 만들어요 | Swipe a reply sideways to make a new one |
| `row:input.edgeSwipe` | 가장자리 스와이프로 사이드바 열기 | Open the sidebar with an edge swipe |
| `rowdesc:input.edgeSwipe` | 화면 가장자리에서 밀면 사이드바가 열려요 | Swipe in from the screen edge to open the sidebar |
| `row:input.menuBottom` | 메뉴 버튼을 사이드바 아래로 | Move the menu button to the bottom of the sidebar |
| `rowdesc:input.menuBottom` | 한 손으로 누르기 쉬워요 | Easier to reach with one hand |
| `row:input.hapticsLink` | 진동 끄기 | Turn off vibration |
| `rowdesc:input.hapticsLink` | 화면·읽기 › 움직임과 성능에 있어요 | It lives in Display › Motion and performance |
| `row:input.menuSidebar` | 사이드바 보이기 | Show the sidebar |
| `rowdesc:input.menuSidebar` | 켜면 화면 옆에 사이드바가 나와요. 끄면 사이드바가 사라져요 | Shows the sidebar beside the screen. Off hides it |
| `row:input.botAtStart` | 시작할 때 캐릭터 메뉴 열기 | Open the character menu at start |
| `row:input.customSidebar` | 사이드바 항목 직접 정하기 | Choose sidebar items |
| `rowdesc:input.customSidebar` | 사이드바에 넣을 항목을 더하고 빼요 | Add and remove the items in the sidebar |
| `row:input.proTools` | 고급 도구 보이기 | Show advanced tools |
| `rowdesc:input.proTools` | 플러그인 도구와 플러그인 설정 항목이 나타나요 | Shows the plugin tools and the plugin settings entry |
| `row:input.reduceTransparency` | 투명도 줄이기 | Reduce transparency |
| `rowdesc:input.reduceTransparency` | 반투명 배경을 불투명하게 바꿔요 | Makes see-through surfaces solid |
| `row:input.askRemoval` | 메시지 지울 때 확인 | Confirm before deleting a message |
| `row:input.instantRemove` | 지울 때 범위 묻기 | Ask what to delete |
| `rowdesc:input.instantRemove` | 켜면 메시지를 지울 때 ‘이 메시지만’ 또는 ‘이 메시지와 뒤의 대화’를 골라요 | When on, deleting a message asks: this message only, or this message and the conversation after it |
| `row:input.branchFolder` | 분기할 때 폴더 만들기 | Make a folder when branching |
| `row:input.inlayError` | 오류를 채팅에 표시 | Show errors in the chat |
| `rowdesc:input.inlayError` | 켜면 오류가 채팅 메시지로 나와요 | Errors appear as a chat message |
| `row:input.showTransLoading` | 번역 중 표시 | Show when translating |
| `row:input.easyContrast` | 글자 색 (고대비) | Text colour (high contrast) |
| `rowdesc:input.easyContrast` | 화면·읽기에서 글자를 더 또렷하게 바꿔요 | Make text stand out more in Display |
| `row:input.easySize` | 글자 크기 | Text size |
| `rowdesc:input.easySize` | 화면·읽기에서 채팅 글자를 키워요 | Make chat text bigger in Display |
| `row:input.easyInput` | 입력창 크기 | Input box size |
| `rowdesc:input.easyInput` | 화면·읽기에서 입력창과 그 글자를 키워요 | Make the input box and its text bigger in Display |
| `row:models.showCompare` | 프리셋 비교 보이기 | Show preset comparison |
| `rowdesc:models.showCompare` | 프리셋 편집에 비교 버튼을 보여요 | Shows the compare button in the preset editor |
| `row:data.goCharOnImport` | 가져온 뒤 캐릭터로 이동 | Go to the character after import |
| `rowdesc:data.goCharOnImport` | RisuRealm에서 가져오면 그 캐릭터로 바로 가요 | After importing from RisuRealm, jump to that character |
| `row:adv.requestInfo` | 채팅에 요청 정보 보이기 | Show request info in the chat |
| `rowdesc:adv.requestInfo` | 모델, 토큰 같은 요청 정보를 메시지 아래에 보여요 | Shows request details such as the model and tokens under messages |
| **Copy: Modes and the repair state** | | |
| `mdNote` | 홈에 보일 모드를 골라요. 하나는 항상 보여야 해요. | Choose the modes Home shows. One has to stay visible. |
| `mdLegend` | 홈에 보일 모드 | Modes shown on Home |
| `modeName('rp')` | 롤플레이 | Roleplay |
| `modeDesc('hybrid')` | 캐릭터와 함께 글쓰기나 코딩 같은 일을 해요 | Work on writing or code together with a character |
| `mdLockHome` | 지금 쓰고 있는 모드예요 | The mode you are using now |
| `mdLockLast` | 하나는 보여야 해요 | One has to stay visible |
| `mdLockOff` | 숨기기가 꺼져 있어요 | Hiding is off |
| `mdBanner('하이브리드')` | 홈에 하이브리드 모드만 보이고 있어요 | Home shows only 하이브리드 |
| `mdBannerSub` | 아래에서 다시 보이게 할 수 있어요. | You can show the others again below. |
| `mdStatusAll` | 모드 3개가 모두 보여요 | All 3 modes are visible |
| `mdStatusSome(1,'유틸리티')` | 모드 3개 중 1개가 보여요: 유틸리티 | 1 of 3 modes are visible: 유틸리티 |
| `mdShowAll` | 모든 모드 보이기 | Show all modes |
| `mdAlready` | 이미 모두 보여요 | All modes are already visible |
| `mdConfirmT` | 모든 모드를 보일까요? | Show all modes? |
| `mdConfirmBody('롤플레이·하이브리드')` | 롤플레이·하이브리드 모드가 홈에 다시 보여요. ‘쓰지 않는 모드 숨기기’도 꺼져요. | 롤플레이·하이브리드 will show on Home again. “Hide unused modes” turns off too. |
| `mdConfirmDo` | 모두 보이기 | Show all |
| `mdDone` | 모든 모드를 다시 보이게 했어요 | All modes are visible again |
| `mdDoneSub` | 홈으로 돌아가면 바로 보여요 | They show on Home as soon as you go back |
| `mdToggled('롤플레이',true)` | 롤플레이 모드를 보이게 했어요 | 롤플레이 is now shown |
| **Copy: Theme and colours** | | |
| `thLegend` | 채팅 테마 | Chat theme |
| `thDesc('waifu')` | 캐릭터 그림을 크게 두고 옆에 대화를 보여요 | A large character picture with the chat beside it |
| `scLegend` | 색 구성 | Colour scheme |
| `scCustom` | 직접 만들기 | Custom |
| `scName('dark')` | dark | dark |
| `edColorsT` | 직접 만든 색 | Your colours |
| `edColorsNote` | 앱 전체에 쓸 색 아홉 개와 어두운·밝은 종류를 정해요. 색 구성에서 ‘직접 만들기’를 고르면 이 색을 써요. | Set nine colours for the whole app and whether it is dark or light. Choose “Custom” under Colour scheme to use them. |
| `edType` | 종류 | Type |
| `edDark` | 어두운 색 | Dark colours |
| `edLight` | 밝은 색 | Light colours |
| `edTextT` | 직접 만든 글자 색 | Your text colours |
| `edTextNote` | 글자 종류마다 색을 정해요. 글자 색에서 ‘직접 만들기’를 고르면 이 색을 써요. | Set a colour for each kind of text. Choose “Custom” under Text colour to use them. |
| `edTextPrev` | 미리보기 | Preview |
| `ckBg` | 배경 | Background |
| `ckDarkbg` | 어두운 배경 | Dark background |
| `ckBorderc` | 테두리 | Border |
| `ckSelected` | 선택한 항목 | Selected item |
| `ckDraculared` | 위험·삭제 | Danger and delete |
| `ckTextcolor` | 글자 | Text |
| `ckTextcolor2` | 보조 글자 | Secondary text |
| `ckDarkBorderc` | 어두운 테두리 | Dark border |
| `ckDarkbutton` | 어두운 버튼 | Dark button |
| `tkFontColorStandard` | 보통 글자 | Normal text |
| `tkFontColorItalic` | 기울인 글자 | Italic text |
| `tkFontColorBold` | 굵은 글자 | Bold text |
| `tkFontColorItalicBold` | 굵은 기울임 | Bold italic |
| `tkFontColorQuote1` | 큰따옴표 안 | Inside double quotes |
| `tkFontColorQuote2` | 작은따옴표 안 | Inside single quotes |
| `hexOf('배경')` | 배경 (16진수) | 배경 (hex) |
| `hexBad` | #과 여섯 자리 16진수로 적어 주세요. 예: #1a2b3c | Write # and six hex digits. Example: #1a2b3c |
| `pickOf('배경')` | 배경 색 고르기 | Pick the 배경 colour |
| `bgNone` | 고른 파일이 없어요 | No file chosen |
| `bgPick` | 파일 고르기 | Choose a file |
| `bgChange` | 바꾸기 | Change |
| `bgClear` | 지우기 | Clear |
| `bgPickT` | 배경 이미지 고르기 | Choose a background image |
| `bgPickDo` | 이 파일 쓰기 | Use this file |
| `bgPickHint` | png, webp, gif 파일만 쓸 수 있어요 (모의 파일 목록) | Only png, webp and gif files work (a made-up file list) |
| `bgBad` | 이 형식은 쓸 수 없어요. png, webp, gif만 골라 주세요 | That format does not work. Choose png, webp or gif |
| `bgOkLine('rain-window.gif')` | rain-window.gif · 쓸 수 있어요 | rain-window.gif · works |
| `bgGif` | 움직이는 배경은 저전력 기기에서 느릴 수 있어요 | An animated background can be slow on low-power devices |
| `bgSet` | 배경 이미지를 바꿨어요 | Background image changed |
| `bgCleared` | 배경 이미지를 지웠어요 | Background image cleared |
| `bgLu` | 배경 이미지 지우기 | clear the background image |
| `bgSize(3270)` | 3.2 MB | 3.2 MB |
| `chatScreen` | 채팅 화면 | Chat screen |
| `pvLabel` | 미리보기 | Preview |
| `pvText` | 안녕하세요, 오늘은 어디로 갈까요? | Hello, where shall we go today? |
| `scrollNoteOff` | 자동 스크롤이 꺼져 있어서 항상 스크롤과 새 메시지 버튼 위치는 나오지 않아요 | Auto-scroll is off, so Always scroll and the new-message button position are not shown |
| `scrollNoteAlways` | 항상 스크롤이 켜져 있어서 새 메시지 버튼 위치는 나오지 않아요 | Always scroll is on, so the new-message button position is not shown |
| **Copy: Fonts, sizes and chat display** | | |
| `stepName(1)` | 크게 | Big |
| `stepOf(1,'크게')` | 1: 크게 | 1: 크게 |
| `closeOnlyWide` | 설정 닫기 버튼 크기는 넓은 화면에서만 쓰여요 | The settings close button size only applies on wide screens |
| `qLegend` | 따옴표 모양 | Quote marks |
| `qOpenD` | 여는 큰따옴표 | Opening double quote |
| `qCloseD` | 닫는 큰따옴표 | Closing double quote |
| `qOpenS` | 여는 작은따옴표 | Opening single quote |
| `qCloseS` | 닫는 작은따옴표 | Closing single quote |
| `qPrev` | 미리보기 | Preview |
| `qSample('“','”','‘','’')` | “안녕하세요” ‘괜찮아요’ | “Hello” ‘It is fine’ |
| `qOne` | 한두 글자까지 쓸 수 있어요 | One or two characters each |
| `fpReason` | 스와이프가 꺼져 있어서 지금은 쓰지 않아요 | Swipe is off, so this is not used right now |
| `fpGo` | 스와이프로 이동 | Go to Swipe |
| **Copy: Sound and notifications** | | |
| `nsGranted` | 브라우저 권한: 허용됨 | Browser permission: allowed |
| `nsDenied` | 브라우저 권한: 차단됨 (브라우저 설정에서 바꿔요) | Browser permission: blocked (change it in the browser settings) |
| `nsDefault` | 켜면 브라우저가 허용을 물어봐요 | When you turn it on, the browser asks for permission |
| `nsUnsupported` | 이 기기에서는 지원하지 않아요 | Not supported on this device |
| `nsOffByDeny` | 알림이 차단돼서 껐어요 (브라우저 설정에서 바꿔요) | Notifications are blocked, so they were turned off (change it in the browser settings) |
| `nsAsk` | 알림을 허용할까요? | Allow notifications? |
| `nsAskBody` | 브라우저가 묻는 창이에요 (모의). 허용하면 새 답이 왔을 때 알려 드려요. | This stands in for the browser prompt (simulated). If you allow it, you are told when a new reply arrives. |
| `nsAllow` | 허용 | Allow |
| `nsBlock` | 차단 | Block |
| `nsOn` | 알림을 켰어요 | Notifications are on |
| `nsOff` | 알림을 껐어요 | Notifications are off |
| `nsDismissed` | 묻는 창을 닫아서 알림은 꺼져 있어요 | The prompt was closed, so notifications stay off |
| **Copy: Motion and performance** | | |
| `asSlow` | 느림 | Slow |
| `asFast` | 빠름 | Fast |
| `asName(0.15)` | 빠름 | Fast |
| `asText('빠름',0.15)` | 빠름, 0.15초 | 빠름, 0.15 s |
| `asAria` | 애니메이션 속도, 느림에서 빠름까지 | Animation speed, from slow to fast |
| `asDimRm` | 움직임 줄이기가 켜져 있어 지금은 쓰지 않아요 | Reduce motion is on, so this is not used right now |
| `asDimSys` | 시스템이 움직임 줄이기를 쓰고 있어 지금은 쓰지 않아요 | The system asks for reduced motion, so this is not used right now |
| `asDimLp` | 저전력 모드가 켜져 있어 지금은 쓰지 않아요 | Low-power mode is on, so this is not used right now |
| `hapticsDesktop` | 진동은 터치 기기에서만 써요 | Vibration only works on touch devices |
| **Copy: Input and accessibility** | | |
| `hoverOnly` | 마우스가 있어야 써요 | Needs a mouse |
| `hoverOnlyReason` | 이 기기는 터치만 쓸 수 있어서 마우스를 올릴 수 없어요 | This device is touch only, so there is nothing to hover with |
| `npLegend` | 새 메시지 버튼 위치 | New-message button position |
| `npNote` | 위로 올려 보고 있을 때 나타나요 | Appears when you have scrolled up |
| `inputMenuH` | 입력창 메뉴 | Input box menu |
| `sbCount(3)` | 항목 3개 | 3 items |
| `sbOpen` | 고치기 | Edit |
| `sbT` | 사이드바 항목 | Sidebar items |
| `sbNote` | 사이드바에 넣을 항목을 더하고 빼요 | Add and remove the items in the sidebar |
| `sbEmpty` | 아직 항목이 없어요 | No items yet |
| `sbAdd` | 항목 더하기 | Add an item |
| `sbRemove` | 지우기 | Remove |
| `sbRemoveOf('프리셋')` | 프리셋 지우기 | Remove 프리셋 |
| `sbRemoved` | 사이드바 항목을 지웠어요 | Sidebar item removed |
| `sbLu` | 사이드바 항목 지우기 | remove a sidebar item |
| `sbAddedT` | 사이드바 항목을 더했어요 | Sidebar item added |
| `sbAddT` | 항목 더하기 | Add an item |
| `sbSettingQ` | 설정 찾기 | Find a setting |
| `sbSettingHint` | 더할 설정을 찾아서 골라요 | Find the setting to add and pick it |
| `sbNoHit` | 맞는 설정이 없어요 | No setting matches |
| `sbBack` | 종류 다시 고르기 | Pick another kind |
| `sbTypeFirst` | 더할 항목의 종류를 골라요 | Pick the kind of item to add |
| `easyNote` | 글자 색, 글자 크기, 입력창 크기는 화면·읽기에 있어요 | Text colour, text size and input box size are in Display & reading |
| **Copy: Undo and reset** | | |
| `undo` | 되돌리기 | Undo |
| `luModes` | 모드 보이기 바꾸기 | change visible modes |
| `luShowAll` | 모든 모드 보이기 | show all modes |
| `resetDone('채팅 글자 크기')` | 기본값으로 되돌렸어요: 채팅 글자 크기 | Reset to its default: 채팅 글자 크기 |
| `luReset('채팅 글자 크기')` | 채팅 글자 크기 기본값으로 | reset 채팅 글자 크기 |
| `luSkip` | 그 사이에 바뀌어서 되돌리지 않았어요 | It changed in the meantime, so nothing was undone |
| **Copy: Key reveal** | | |
| `revShow` | 키 보기 | Show key |
| `revHide` | 키 가리기 | Hide key |
| `revOf('OpenAI 키')` | OpenAI 키 보기 | Show OpenAI 키 |
| `revHideOf('OpenAI 키')` | OpenAI 키 가리기 | Hide OpenAI 키 |
| **Copy: Search** | | |
| `stGo` | 스튜디오에서 바꿔요 | Change it in Studio |
| `stLabel('로어북 한꺼번에 켜기')` | 로어북 한꺼번에 켜기 · 스튜디오에서 바꿔요 | 로어북 한꺼번에 켜기 · change it in Studio |
| **Copy: Page, back and tags** | | |
| `title` | 설정 슬라이스 5c-1 · 화면·읽기, 입력·접근성 목업 | Settings slice 5c-1 · Display and input mockup |
| `cancel` | 취소 | Cancel |
| `ok` | 확인 | OK |
| `newTag` | 새 기능 | New |
| `newTagTitle` | 앱에 없던 새 기능이에요 (제안) | A new feature the app did not have (proposal) |
| `moreTitle` | 이 설정의 메뉴 | Menu for this setting |
| `back` | 돌아가기 | Back |
| `backDisplay` | 화면·읽기로 돌아가기 | Back to Display & reading |
| `backDisplayS` | 화면·읽기 | Display & reading |
| `backInput` | 입력·접근성으로 돌아가기 | Back to Input & accessibility |
| `backInputS` | 입력·접근성 | Input & accessibility |
| `jump` | 이동 | Go |
| **Copy: Demo panel** | | |
| `demo5c` | 슬라이스 5c-1 | Slice 5c-1 |
| `demoSet` | 데이터 세트 | Data set |
| `demoPerm` | 알림 권한 | Notification permission |
| `demoMode` | 홈의 모드 | Home’s mode |
| `demoFix` | 모드 복구 상태 | Mode repair state |
| `demoState` | 상태 (5c-1) | State (5c-1) |
| `demoGo` | 열기 | Open |
| `setDemo` | 기본 | Default |
| `setTouch` | 터치 기기 | Touch device |
| `setDesktop` | 데스크톱 앱 | Desktop app |
| `setCustom` | 직접 만든 설정 | Custom setup |
| `setDenied` | 알림 차단 | Notifications blocked |
| `permGranted` | 허용됨 | Allowed |
| `permDefault` | 아직 안 물음 | Not asked yet |
| `permDenied` | 차단됨 | Blocked |
| `permUnsupported` | 지원 안 함 | Not supported |
| **Copy: other** | | |
| `resetTo100` | 100%로 | To 100% |
| `bqReason` | 따옴표 꾸미기가 꺼져 있어서 지금은 쓰지 않아요 | Style quotes is off, so this is not used right now |
| `bqGo` | 따옴표 꾸미기로 이동 | Go to Style quotes |
| `posName('top-bar')` | 위 막대 | Top bar |
| `ceExport` | 색 내보내기 | Export colours |
| `ceImport` | 색 가져오기 | Import colours |
| `ceExported` | 직접 만든 색을 파일로 내보냈어요 | Your colours were exported to a file |
| `ceImportT` | 색 파일 가져오기 | Import a colour file |
| `ceImportDo` | 이 파일 쓰기 | Use this file |
| `ceImportHint` | 직접 만든 색 파일(.json)을 골라요 (모의 파일 목록) | Pick a custom colour file (.json) (a made-up file list) |
| `ceImportBad` | 이 파일은 색 파일이 아니에요. 내용이 깨졌거나 다른 종류예요 | This is not a colour file. It is broken or another kind of file |
| `ceImportOk('ocean-night.json')` | ocean-night.json · 색 아홉 개와 종류가 들어 있어요 | ocean-night.json · holds nine colours and the type |
| `ceImported` | 색 파일을 가져왔어요 | Colour file imported |
| `ceLu` | 색 가져오기 | import colours |

## 10. Design defaults to confirm (not product decisions; listed for review)

- The mode Home is in cannot be hidden from Settings. This carries over from the older mockup. DS-156 still allows any single mode.
- `assetWidth` uses a segmented choice plus slider.
- The 6-position picker is drawn as a phone outline.
- `unformatQuotes` is shown positively.
- 보기 쉽게 on 입력·접근성 is made of jump links only.

## 11. Open questions

None from the decisions. The builder raises these for the review (they are assumptions of the build, listed under Build notes):

- **B-1:** §2.1 says the colour editor has 10 colours; the source has 9 colours plus the dark/light type. Nine are built.
- **B-2:** §2.1 names three text colours (normal, italic, bold); the source has six. Six are built.
- **B-3:** §1 says the 모드 group is "only shown in the repair state"; §4 says it is also shown outside the fixture. Built as §4 (always first); only the banner is repair-only.
- **B-4:** how hide-unused and the boxes combine (with hide-unused off every mode shows whatever the boxes say).
- **B-5:** `display.keepAlive` is re-homed to 고급 for now (a plain row); `adv.lbBulk` and `adv.lbLocal` are removed from 고급 (they belong to Studio, DS-163).
- **B-6:** Korean names for the 16 colour schemes (the app derives English names from the ids).

## Build notes (builder, 2026-10-28)

What was built, and where it differs from the text above. DS-152 to DS-168, DD-223 and DD-250 are honoured; the deviations are listed here and in `checks/builder-checks-ss5c1.md`.

- **Files:** `slice5c1.html`, `slice5c1.css` (8 `--p5c-*` tokens), `slice5c1.js` (hooks on `SS1_EXT`, loaded after `slice5b.js`), `data5c1.js` (rows, fixtures, 5 sets, about 220 copy keys). Slice 1's invented `display.*` and `input.*` rows are replaced only in 5c-1's own data layer; slices 1 to 5b keep their pages and stay green. The edits outside the new files are the DD-223 toast helper and its call sites (`slice2.js` `psToast`, `untilLine`; `slice3.js`, `slice4.js`, `slice5a.js`, `slice5b.js` call sites; `checks/tools/dd223-patch.mjs` lists them), the `themes/banana-cocoa.css` rules for the new parts, and (last) `index.html`'s forward target.
- **Store first (DS-067):** every compound value (visible modes, hide-unused, custom colours, text colours, the background file, the chat screen colours, the quote boxes, the sidebar items, the notification permission) is `window.SS5C1_DATA.ST`; every page reads it by id at render time and `DC.reset()` puts it back to a set before each state.
- **States:** 28, in the names of §8.3. `?state=` runs one; `__ss5c1.runState` runs another after load; `__ss5c1Ready` holds the state name.
- **Assumptions the builder made** (not decided by a DS entry), for the review:
  - **Colour editor:** the source has nine colours and the dark/light type (ten stored properties), not ten colours as §2.1 says; the editor shows nine plus the type.
  - **Text colour editor:** the source `customTextTheme` has six colours (normal, bold, italic, bold italic, double-quote, single-quote); the editor shows all six, not only normal, italic and bold.
  - **모드 group:** §1 says the group is "only shown in the repair state", §4 says it is also shown outside the fixture as the first group. The builder follows §4: the group is always first; the warning banner is only in the repair state and goes when the modes are repaired.
  - **Hide-unused (DS-170):** with the switch off all three boxes are checked and locked with the reason "숨기기가 꺼져 있어요"; turning it on brings back the remembered set. The mode Home is in is locked (when opened from Home with `mode=`), otherwise the last checked mode is locked.
  - **keepAlive:** `display.keepAlive` is re-homed as `adv.keepAlive` on 고급 (a plain row; the help says it is not shown on Android, which already runs as a service, review S-7) so the setting stays searchable until 5c-2 regroups it. `adv.lbBulk` and `adv.lbLocal` (lorebook bulk enabling, local activation) are removed from 고급 because DS-163 moves them to Studio. `adv.mobileGuiBeta` moves to 화면·읽기 › 고급; `adv.legacyGui` is dropped.
  - **Notification:** a fourth line, "켜면 브라우저가 허용을 물어봐요", for the not-yet-asked permission; the prompt is a made-up dialog, and closing it (Escape) leaves the permission at "not asked" (only Block is a refusal). A blocked permission disables the switch with the reason; the granted line reads "브라우저 권한: 허용됨".
  - **Animation speed:** slice 1's `applyFlags` reads `animSpeed || 0.4`, which turns an instant 0 back into 0.4; the page re-applies the real number after every flag change (the one inline style the scripts write).
  - **Names of the 16 schemes** are Korean in KO (기본, 어둡게 ...) and the capitalised ids in EN, not the English ids in both.
  - **A reset (⋯) of a row on these pages** shows a "기본값으로 되돌렸어요" toast with a 10 s Undo (DD-223); the cards, swatches, mode boxes, the background and the notification rows have no reset menu (they carry no default marker).
- **Fix round 1 (review, DS-169 to DS-175):** `input.instantRemove` is renamed "지울 때 범위 묻기" and the caution (and its critical part `settings-caution`) is gone (DS-169); the hide-unused boxes follow DS-170; every undo line names Alt+Z, shown ⌥Z on a Mac, never Ctrl+Z or ⌘Z (DS-171), and the lines now say how long and what ends it ("앱을 닫을 때까지 ... (최근 50개까지)", the preset switch: "다른 변경을 하거나 이전 프리셋을 지우면 끝나요", purge: plus "영구 삭제하면 끝나요", a connection that needs a key: plus "키는 다시 넣어야 해요", the cache clear: "10초 안에 ...", the restore point: "이 알림의 되돌리기 버튼은 10초 동안만 있어요" because it pushes no library entry); `menuSideBar` defaults off (DS-172); one Pro Tools row on 입력·접근성 and a jump link on 고급 (DS-173); the colour editor has simulated export and import and the `lite` scheme is the 17th preset (DS-174, 경량); the 모드 group stays (DS-175); 인용문 꾸미기 is dimmed while 따옴표 꾸미기 is off (S-1); zoom and profile picture sliders step by 1 (N-2); the 고급 summary lists only the rows that are there (N-4); locked mode boxes announce through the live region only (N-7); the sidebar item action reads "지우기" (N-8); Korean names use `word-break: keep-all` (S-10); the English banner says "A and B" (N-1); a note under the scroll rows says why the button position is not shown (N-6, final round); turning 따옴표 꾸미기 off dims 인용문 꾸미기 at once (S-1, final round). **Skipped nits:** N-3 (the close-button size on a phone is a design decision for the main session; the note says so), N-5 (the search focus on `models.showCompare` is slice 2's section renderer), N-9 (the wrapped ⋯ button is slice 1's row layout), N-10 (no source says whether low power stops a GIF), N-11 (dimming a locked box would take its text out of the contrast sweep's exemption; the reason line is visible), N-13 (demo chrome).
- **DD-223:** one helper, `psToast(msg, { until })` in `slice2.js`, writes a second `.pt-sub.pt-until` line under the toast's own sub line (a sub line a call site passes is never replaced). `until` is `'page'` (Alt+Z, ⌘Z on a Mac), `'10s'`, or a reason key `'purge'`, `'prev'`, `'conn'`. Every Undo toast of slices 2 to 5b and 5c-1 carries one (the cover scan in `ss5c1/dd223.mjs` fails on a call site without it); the toast stays 10 s everywhere.

### Integration notes

- **Home's mode storage** is simulated: the page never writes Home's storage and Home does not see the repair until the main session stores `visibleModes` and `hideUnusedModes` (engine items below). The Back to Home contract (DD-210) is unchanged.
- **Registry:** `checks/th5c1/registry5c1.mjs` extends `registry5b.mjs` with the 23 names (5 critical, 4 safe, 14 reach), the floors (`--p5c-bar` 2px and seven size floors) and the ceilings of the eight `--p5c-*` tokens. The main session lifts the names, `MINIMUMS5C1` and `MAXIMUMS5C1` into `packlint-settings.mjs` (and the earlier registries' lists) when it integrates 5c-1.
- **DD-223 at integration:** the "until" texts live in `slice2.js` copy (`untilPage` ... `untilConn`); move them to the shared Settings strings and make the toast one component.
- **Per-field key reveal** is added by a DOM observer in 5c-1's layer to slice 3's key form, slice 3's add dialog and slice 5b's service dialog; at integration the reveal belongs in the shared key field component, not in an observer.
- **Banana Cocoa** gained one block of rules for the new parts (white cards, banana edge on the chosen one): pack-private `--pack-*` helpers plus the existing ladder reads that earlier rules already use (`--nexus-edge`, `--radius-9`, `--nexus-surface-flat`; DD-258).

### Engine items

- **5c1-1:** two new profile-wide fields: `visibleModes` (a subset of `rp`, `hybrid`, `utility`, default all three) and `hideUnusedModes` (bool, default false). Migration: existing profiles get all three modes and false. Any single mode may be the only visible one (DS-155, DS-156); Home reads them; the repair state restores both.
- **5c1-2:** two new device-or-profile settings, `lowPower` (bool, default false; the mockup's slice 1 `setLowPower`) and `reducedMotion` (`system` | `on` | `off`, default `system`; the mockup's `S.rm`). `reducedMotion` supersedes the two components that read `prefers-reduced-motion` today. Scope (device or profile) is a main-session choice (the mockup marks low power as this device).
- **5c1-3:** three tagged proposals with no stored field today (`menuSideBar` has no default assignment in the app, so it is off; the mockup mirrors that, DS-172): `hapticsOff` (bool, default false, touch only; the app hard-codes `navigator.vibrate?.(15)` in `SidebarRail` and `GridCatalog`), `edgeSwipeSidebar` (bool, default true: the gesture exists in `panelGesture.ts` and is always on) and `reduceTransparency` (bool, default false; it should also follow `prefers-reduced-transparency`).
- **5c1-4:** inverse presentation. `unformatQuotes` is shown positively as "따옴표 꾸미기" and stored as the inverse; `animationSpeed` stays a duration in seconds (0 to 1, default 0.4) and the slider shows `1 - position` in 0.05 steps, with 0 labelled 즉시. No stored value changes.
- **5c1-5:** `customFont` has no label today (`fallbackLabel: ''`); it needs "글꼴 이름" with its help line. `customQuotesData`'s box fallback in the UI is straight quotes while the stored default is curly; use the stored default.
- **5c1-6:** `newMessageButtonStyle` is shown only when `autoScrollToNewMessage` is on and `alwaysScrollToNewMessage` is off (ASD:173); the picker draws the six values as a phone outline. The `assetWidth` is one number (-1 unlimited, 0 hidden, 1 to 40 rem) shown as a three-way choice plus a slider.
- **5c1-7:** moved rows (DS-163). `showPromptComparison` goes next to the compare button of 프리셋; `applyAdditionalParamsToAll` stays in 파라미터 (already there); `goCharacterOnImport` goes to 데이터·백업 and `requestInfoInsideChat` to 고급 (5c-2 regroups them); `useAdditionalAssetsPreview`, `localActivationInGlobalLorebook` and `bulkEnabling` are Studio settings: Settings keeps only search entries with a Studio link (character owner; `display` and `lore` kinds), and the 고급 rows `adv.lbBulk` and `adv.lbLocal` go.
- **5c1-0:** `instantRemove` keeps its meaning and gets its true name, "지울 때 범위 묻기": when on, deleting a message asks "이 메시지만 / 이 메시지와 뒤의 대화" (Chat.svelte:272-303). It never deletes anything by itself, so no caution is shown (DS-169).
- **5c1-8:** `hideApiKey` is retired (the field stays in the profile, ignored); every key field has its own show button, masked again when it is closed or saved. The retired note answers a search for it.
- **5c1-9:** dead fields are hidden, not deleted: `showMemoryLimit`, `memoryLimitThickness` and `moveInsteadOfCopyOnCMPConvert` have no readers today; the stored values are untouched and they are neither on a page nor searchable. The dead `theme: 'custom'` value and `CustomGUISettingMenu` are not offered.
- **5c1-10:** `useLegacyGUI` is dropped (BotSettings and OtherBotSettings read it too: they lose the flag in the same change). The redesigned Settings has one layout.
- **5c1-11:** `customSidebarItems`: removing an item has a 10 s Undo (DD-223) instead of the immediate delete; adding by type (model, preset, loadout, persona, setting) and the settings search stay.
- **5c1-12:** notification (the app today calls `Notification.requestPermission()` only when the Permissions API reports `denied`, so on a first `prompt` it never asks; the mockup asks on "not asked", which needs that condition fixed): guard `Notification.requestPermission` (it is called unguarded today, so a WebView without the API throws); show the status line (allowed, blocked, not asked, not supported) and turn the switch off by itself on a refusal.
- **5c1-15:** `enableRisuaiProTools` is one row on 입력·접근성 (고급 도구 보이기); 고급 shows a jump link and the Easy panel entry follows that one field (DS-173). `colorScheme`: add export and import of a custom scheme to the editor (existing app feature, `CustomColorSchemeEditor.svelte:54-66`), a broken file is refused with a message; the `lite` scheme is a listed preset (경량), and `lite` build forces it as today.
- **5c1-16:** `animationSpeed` is not used while low power or reduce motion is on (the slider says so); the engine must make that true (low power and reduce motion override the duration). `blockquoteStyling` only runs while quote styling is on (`parser.svelte.ts:184`); the row is dimmed with the reason otherwise. The undo stack (Alt+Z) lives for the app session, 50 entries; Ctrl+Z / ⌘Z run the preset parameter undo and are never named by a toast (DS-171).
- **5c1-13:** the DD-223 helper (`until`) and the line texts (page, 10 s, purge, previous preset, connection, restore point); chat and Studio change from 6 s to 10 s in their own lanes.
- **5c1-14:** step names: `guiSizeText` returns English words today; the Korean names (가장 작게 ... 가장 크게) and the English words move to the locale files. The 16 scheme names are Korean in KO and the capitalised ids in EN.

## Appendix: Parts (theme readiness, DD-142 to DD-161)

Filled by the builder (2026-10-28) from `slice5c1.js`; `checks/th5c1/parts.mjs` reads this table and fails if the pages carry a name that is not listed here or in the slice 1 to 5b appendices, if an element carrying a name does not match the Selector, if a main element class carries no part, or if a name is never seen. Slice 5c-1 adds **23 names** (5 critical, 4 safe, 14 reach); the pages also use `settings-section`, `-rows`, `-row`, `-row-label`, `-row-description`, `-field`, `-segmented`, `-toggle`, `-toggle-row`, `-page-body`, `-page-header`, `-section-title`, `-jump-chips`, `-warning-banner`, `-button`, `-note`, `-dim-reason`, `-disclosure` and the dialog and menu parts of slices 1 to 3. Rows marked **critical** carry `data-part-critical`: a pack cannot name them, so cannot hide or recolour them. **Safe** leaves are never critical, never hold a critical element and never sit inside one (a pack may hide them: the row or the field beside them carries what they repeat). **Reach** parts hold critical parts or controls with no other way: a pack may restyle them but not hide them.

| Part | Selector | Notes |
|---|---|---|
| `settings-mode-banner` | `.p5c-mbanner` | the repair banner "홈에 {모드} 모드만 보이고 있어요" (only in the repair state, while fewer than three modes are visible); **critical** |
| `settings-mode-group` | `.p5c-modes` | the fieldset of the three mode boxes; reach |
| `settings-mode-option` | `.p5c-mopt` | one mode checkbox card (name, one line, its lock reason); `data-current` (checked), `data-lock` (`home`, `last` or `off`: hiding is off, DS-170); **critical** |
| `settings-mode-showall` | `.p5c-showall` | the 모든 모드 보이기 button (`aria-disabled` with the reason "이미 모두 보여요" when nothing is hidden); **critical** |
| `settings-mode-status` | `.p5c-mstatus` | the status line (role=status): "모드 3개가 모두 보여요" ...; **critical** |
| `settings-theme-list` | `.p5c-themes` | the radio group of the five chat themes (a fieldset with its legend); reach |
| `settings-theme-card` | `.p5c-tcard` | one theme card (drawing, radio, name, one line); `data-current`; reach |
| `settings-theme-thumb` | `.p5c-thumb` | the CSS drawing of a theme (decorative, `aria-hidden`); **safe** |
| `settings-swatch-list` | `.p5c-swatches` | the radio group of the 16 colour schemes and 직접 만들기; reach |
| `settings-swatch` | `.p5c-sw` | one swatch (art, radio, name); `data-current`; reach |
| `settings-swatch-art` | `.p5c-swart` | the flat four-colour block of a swatch (SVG rectangles, decorative); **safe** |
| `settings-color-field` | `.p5c-cfield` | a colour field: label, colour picker and hex field (the colour editors, the chat screen colours); reach |
| `settings-preview` | `.p5c-pv`, `.p5c-cprev`, `.p5c-tprev`, `.p5c-qprev` | the live preview tiles and the quote preview line (the values are also in the fields beside them); **safe** |
| `settings-bg-file` | `.p5c-bgfile` | the chosen background file (name, size, 바꾸기, 지우기); `data-state` `image` or `gif`; reach |
| `settings-notify-status` | `.p5c-nstatus` | the permission status line of 알림 (role=status); `data-state` `granted`, `default`, `denied` or `unsupported`; **critical** |
| `settings-anim-speed` | `.p5c-animctl` | the 느림–빠름 slider with its two end labels and its value; reach |
| `settings-quote-boxes` | `.p5c-qboxes` | the four quote boxes with their preview and note (only while custom quotes is on); reach |
| `settings-position-picker` | `.p5c-pos` | the radio group of the six new-message button positions; reach |
| `settings-position-option` | `.p5c-popt` | one position (phone outline with a dot, radio, name); `data-current`; reach |
| `settings-sidebar-list` | `.p5c-slist` | the custom sidebar items list; reach |
| `settings-sidebar-item` | `.p5c-sitem` | one sidebar item (name, kind, remove button); reach |
| `settings-new-tag` | `.p5c-new` | the "새 기능" mark of a proposal row (edge swipe, reduce transparency, vibration); **safe** |
| `settings-reveal` | `.p5c-reveal` | the per-field show / hide button of a key field (slice 3's key form and add dialog, slice 5b's service dialog); `aria-pressed`; reach |

Critical in this slice (`data-part-critical`):
- the one way back from a hidden-modes state (DD-250): the banner, the mode boxes with their locks, the show-all button and the status line;
- a blocked notification permission (`settings-notify-status`), so a blocked permission says so;
- the reason lines of the dimmed rows (`settings-dim-reason`, slice 5b) and every dialog with a danger button.

Why the safe leaves may be hidden: the drawing of a theme repeats its name and sentence, the swatch art repeats the name beside it, the previews repeat the values of the fields next to them, and the "새 기능" mark is a label. The cards, the groups, the picker, the lists, the fields and the reveal button hold controls with no other way, so they are reach tier: restyled, not hidden.

State attributes: `data-current` (mirrored by `theme.js` from `.cur`) on the chosen theme card, swatch, position and checked mode box; `data-lock` and `data-state` are written by the templates in `slice5c1.js`, as slices 4 to 5b did (the integration moves them into the one mirror table). `th5c1` checks each is on exactly the elements in that state.

New role tokens (declared at the top of `slice5c1.css`, read only through `var()`; the main session merges them into `theme-tokens.css`): `--p5c-thumb-h` (the theme drawing, 5.5rem, ceiling 160px), `--p5c-swatch` (the swatch art, 44px, ceiling 96px), `--p5c-grid-min` (the narrowest theme card, 8rem, ceiling 240px), `--p5c-card-min` (the narrowest swatch or position card, 5.5rem, ceiling 160px), `--p5c-phone-w` (the phone outline of the picker, 32px, ceiling 64px), `--p5c-pv-h` (the chat screen preview, 64px, ceiling 160px), `--p5c-list-max` (the tallest the sidebar dialog's hits get, 18rem, ceiling 480px) and `--p5c-bar` (the edge of the banner and a chosen card, 4px, floor 2px, ceiling 12px). Everything else reads the existing ladder, `--nexus-*`, slice 4's `--param-dim-opacity` and slice 5b's `--p5b-bar` through the reused reason-line and note classes. Fix round 1 added **floors** (px) for the size tokens that can crush a control: `--p5c-card-min` 64px, `--p5c-grid-min` 96px, `--p5c-list-max` 128px, `--p5c-phone-w` 20px, `--p5c-swatch` 24px, `--p5c-thumb-h` 48px, `--p5c-pv-h` 32px (review S-9).

The pack registry (`checks/th/packlint-settings.mjs`) is left as it was; `checks/th5c1/registry5c1.mjs` extends slice 5b's registry with the 23 names (5 critical, 4 safe, 14 reach), the **floor** (`minimums`, chat DD-182/DD-187, judged over the worst case by DD-195) `--p5c-bar` 2px and the seven size floors above, and the **ceilings** (`maximums`, DD-260) of all eight `--p5c-*` tokens, in px only. A pack that sets a token beyond its limit, under a root attribute, inside `@media` or through a `var()` fallback is rejected with "below the critical minimum" or "above the critical maximum". The earlier floors (`--param-dim-opacity`, `--param-warn-bar`, `--p5-warn-bar`, `--p5b-bar`) stay.
