# Settings & models slice 1: shell and search

Status: **draft, revision 2** (2026-10-26). Revision 2 applies the [independent review](../reviews/2026-10-26-settings-slice1-review.md) and DS-010..013; §13 lists every change and overrides earlier sections where they differ. Task: [tasks/2026-10-26-settings-models.md](../tasks/2026-10-26-settings-models.md). Decisions: DS-001 (pain points), DS-002 (scope: everything), DS-003 (build on N09/N10), DS-004 (this slice first), DS-005 ("prompt presets" = the bot preset list), DS-006 (regroup by task), DS-007 (search finds settings, pages and named things), DS-008 (low-power switch + one-time suggestion when slow), DS-009 (full page, back to the origin) in [DECISIONS-settings.md](DECISIONS-settings.md). Research: [research/today-settings.md](research/today-settings.md), [research/october-mockups-inventory.md](research/october-mockups-inventory.md). Uses chat slice 1 motion tokens, icon helper and KO register ([../chat/SLICE1_SPEC.md](../chat/SLICE1_SPEC.md) §2, §8) and [../PLATFORMS.md](../PLATFORMS.md).

Marked **(design default)** = chosen here within the decided intent, open to veto.

Lane split with Studio (main session, DD-094): Studio owns preset regex, toggle definitions, prompt-block text, module and plugin code. This lane owns connections, models, parameters, the preset list, and every global setting. Settings rows that edit Studio-owned things are **deep links** (§3.3).

## 0. Today (source-read)

| Fact | Source |
|---|---|
| 11 menu entries named after code files (Chat bot, Persona, Other bots, Display, Language, Accessibility, Modules, Plugin, Backup and files, Hotkey, Advanced) + plugin callbacks + Easy panel. | `src/lib/Setting/Settings.svelte:36-169` |
| No search anywhere in the shell; no breadcrumb; no changed-from-default marker. Each page remounts on switch and forgets its sub-tab. | `Settings.svelte:180` |
| A partial schema exists: `SettingItem` (id, type, labelKey, helpKey, bindKey, condition, options, `keywords` "for future search"), about 185 items (Display, Accessibility, Language, Advanced, Parameters, chat format). `getFullSettingsData(search)` already filters label + keywords, but only the custom sidebar uses it, it omits Language, and items carry no page/tab locator. | `src/ts/setting/types.ts:105-187`, `src/ts/setting/utils.ts:81-104` |
| The rest (model/provider/keys, prompt, Other bots, persona, plugin, module, backup, hotkeys) is hand-written with no schema record. | research §1b |
| Settings live in odd places: hide API key in Display, preset chain and aux-model placement in Advanced, Pro tools in Accessibility, the OpenAI key on both Chat bot and Other bots › TTS. Advanced is one 62-item scroll; Other bots is 1186 lines. | research "Pain points evidence" 1 |
| Below 700 px it is index → detail. Desktop close X closes settings; Ctrl+S toggles it; Esc closes it. The Hotkey entry is visible on phones but its page only says the screen is too small. | `Settings.svelte:22-32,208-224`, `hotkey.ts:180-183,379` |
| No low-power or performance mode; Lite is a build flag. | `src/ts/lite.ts:6` |

## 1. Entry and leaving (DS-009)

- Settings is a **full page at every width**. It replaces the chat (or Home, Library, Studio) it was opened from.
- Entry points: the chat sidebar `settings` button, the This chat sheet "설정", Home's settings button, Ctrl+S (existing hotkey, kept; ignored inside text fields), and deep links (§7).
- Header Back (`arrow-left`) **names the origin**: "← 세라핀과의 채팅" / "← Chat with Seraphina", "← 홈", "← 스튜디오". On phones only the arrow shows and the name is the button's accessible label plus a subtitle under the page title.
- Returning restores the origin exactly: unsent draft, caret, scroll anchor, open sheet state is closed; focus goes back to the control that opened Settings. Generation running in the background keeps running (chat slice 2).
- Back stack (DD-040 order): search open → clear/close search; phone page → index; otherwise → origin. Android Back, Esc (outside text fields), the mouse back button and browser Back all use it.

## 2. Layout

| Width | Layout |
|---|---|
| ≥ 1024 px | **Index** column 280 px (left) + **page** column, content max 720 px, left-aligned with 32 px gutter. Header spans both: Back · title · search field (360 px). |
| 600–1023 px | Index 240 px + page; search field shrinks to fill the header. |
| < 600 px | Index → page drill-in. The index is the first screen; a page opens full-width with Back to the index. Header: Back · title · `search` button (opens the field over the title). |

- Header height 56 px (48 on < 600). The page scrolls in its own column; the index scrolls separately and keeps the selected row in view.
- Long Korean labels wrap; controls never shrink below 44 dp on coarse pointers. At < 600 or when a label exceeds ~60 % of the row, the control moves under the label (row becomes stacked).
- Font: NanumSquare Neo for UI text (DD-034) with the system Korean stack as fallback (the woff2 files are not shipped in this package; the mockup lists the family first and falls back).

## 3. Index and pages (DS-006)

### 3.1 Groups

Ten index entries, each with a lucide icon. Entries are pages; big pages have **sections** (h2) shown as an in-page jump list at the top (chips on phones, a sticky sub-list under the selected index row on wide screens) (design default).

| # | Index entry (ko / en) | Icon | Sections | Comes from today |
|---|---|---|---|---|
| 1 | 모델·프리셋 / Models & presets | `cpu` | 연결 · 모델 · 파라미터 · 프리셋 · 프롬프트 설정 | Chat bot (Model, Parameters, Others), Prompt template Settings tab, hide API key (Display), custom models + dynamic registry + preset chain (Advanced), Easy panel |
| 2 | 대화 기능 / Chat features | `message-square` | 장기 기억 · 음성 · 감정 이미지 · 이미지 생성 · 번역 | Other bots (all four tabs), translator settings (Language) |
| 3 | 화면·읽기 / Display & reading | `palette` | 테마 · 글꼴·크기 · 채팅 표시 · 저전력·동작 | Display Theme/Size/Others, animation speed, low power (new, DS-008) |
| 4 | 입력·접근성 / Input & accessibility | `hand` | 보내기·편집 · 제스처 · 접근성 · 메뉴·사이드바 | Accessibility (send with Enter, swipe, click to edit, scroll…), custom sidebar config, hamburger position |
| 5 | 언어 / Language | `languages` | 앱 언어 | Language (UI language only; translation moves to 2) |
| 6 | 페르소나 / Personas | `user-round` | — | Persona |
| 7 | 확장 / Extensions | `puzzle` | 플러그인 · 모듈 · (plugin-defined pages) | Plugin, Modules, `additionalSettingsMenu` |
| 8 | 데이터·백업 / Data & backup | `database` | 백업 · 저장 공간 | Backup and files, storage maintenance |
| 9 | 단축키 / Shortcuts | `keyboard` | — | Hotkey |
| 10 | 고급 / Advanced | `sliders-horizontal` | 요청 · 로어북 · 표시할 기능 · 실험적 기능 · 개발 | Advanced (minus moved items), legacy GUI / mobile GUI beta / Pro tools / show unrecommended (scattered today) |

Footer of the index: 정보·라이선스 / About & licences, 약관·개인정보 / Terms & privacy (`SettingsLegalLinks`).

Moves worth naming (each also gets the old name as a search synonym, §5.2):
- 연결 holds every provider key and the "API 키 숨기기" switch; TTS's OpenAI key becomes a reference to the OpenAI connection ("연결에서 관리" link), not a second field.
- 프리셋 holds preset chain (`presetChain`) and the three "keep on preset switch" locks, so what a preset switch changes is visible in one place.
- 모델 holds main, sub and per-feature models; the "aux models under model settings" placement toggle is retired (they are always here).
- 고급 › 표시할 기능 gathers mode-like switches: legacy GUI, mobile GUI beta, Pro tools (Easy panel), show unrecommended, experimental.

### 3.2 This slice builds the shell, not the complex pages

- Every page and section exists with its **real rows** as plain controls (switch, select, segmented, slider, number, text, button, link row), so search has real targets and the shell is judged with true density. Rows come from a synthetic catalog (`settings/data.js`) mirroring today's settings (§9.1).
- Pages redesigned in later slices show a slim banner: "이 화면은 다음 단계에서 새로 디자인해요 (슬라이스 2: 프리셋)" and list today's rows plainly: 모델·프리셋 (slices 2–4), 대화 기능 and 페르소나, 확장, 단축키 (slice 5). 화면·읽기, 입력·접근성, 언어, 데이터·백업 and 고급 are rendered fully in this slice's row style (their content is schema rows today); slice 5 may still refine them.
- Hotkey page on phones: a read-only reference list with "키보드를 연결하면 바꿀 수 있어요", never a "screen too small" dead end.

### 3.3 Row anatomy

- Label (one line, wraps) · optional one-line description under it (`textcolor2`) · control on the right (stacked below on narrow rows).
- `info` button when help exists: expands the help text inline under the row (no popover), `aria-expanded` (design default).
- **Changed from default**: a 6 px dot before the label + "기본값과 다름" in the row's accessible name; the row's `⋯` (or long-press / right-click / Shift+F10) offers "기본값으로" (design default; the schema has no defaults today, see §10).
- **Scope chip** when the row is not a plain global setting: `smartphone` "이 기기" (device), `bookmark` "프리셋: 균형" (lives in the active preset), `message-square` "이 채팅". Global rows have no chip.
- Changes apply immediately (today's behaviour). No global Save. A select/segmented/switch change announces nothing visually beyond the new value; a destructive button confirms in a dialog.
- **Deep-link rows** (Studio-owned content): `external-link`-free row with `chevron-right` and a trailing label "스튜디오에서 열기"; it opens `studio/slice1.html?from=settings&owner=<preset|module|plugin>:<id>&kind=<kind>` (proposed by the main session, not final). Used in this slice for: 프롬프트 설정 › "프롬프트 블록 편집", 모듈 rows, 플러그인 "코드 편집".
- Module "+" asks for the name first (dialog) and stores nothing until confirmed (main-session note; `ModuleSettings.svelte:163-169` stores a blank module today).
- **Unavailable rows** (condition false, e.g. a parameter the selected model does not take, or an experimental item while experimental is off) are **not rendered on the page** (as today) but are reachable from search with the reason (§5.3).

## 4. Low power (DS-008)

- Switch: 화면·읽기 › 저전력·동작 › "저전력 모드" / "Low-power mode", scope chip "이 기기". Description: "흐림·그림자·장식 애니메이션을 끄고 전환을 짧게 해요" / "Turns off blur, shadows and decorative animation, and shortens transitions."
- Effect follows chat slice 1 §2 rule 4: no shimmer, no spring, no infinite spinners, transitions ≤ 120 ms, no shadows/blur, gestures still follow the finger. Independent of reduced motion (both can be on). In this mockup it toggles `html.nexus-low-power`.
- **Suggestion when slow:** the app samples frame times while the chat is streaming or scrolling (requestAnimationFrame deltas). If, in a 10 s window, more than 30 % of frames take over 50 ms, for two windows in a row, and low power is off, it shows **once per device** a notice card in the chat (above the composer, not modal): "화면이 느린 것 같아요. 저전력 모드를 켤까요?" with "켜기" and "괜찮아요" (`x`). Either answer stores "asked" for the device; the setting row shows "느릴 때 한 번 제안했어요" as its description afterwards (design default for the thresholds). The mockup simulates it from the demo controls in the origin stub; no real detection is required to pass.
- In low power, search stays synchronous (the index is small, §5.4).

## 5. Search (DS-007)

### 5.1 Field

- Wide: a field in the header, placeholder "설정 검색" / "Search settings". Phones: `search` button; the field replaces the title, with `x` to close.
- Ctrl+K and `/` (outside text fields) focus it. Typing filters immediately (no debounce needed for ~400 entries; §5.4).
- Results replace the **page column** on wide screens (the index stays, without a selected row) and replace the index on phones. Clearing the field restores the previous page and scroll.
- Pattern: combobox + listbox (`aria-activedescendant`); Up/Down move the active result, Enter opens it, Esc clears then closes. A polite live region says "결과 12개" / "12 results" after typing settles (500 ms).

### 5.2 What it matches

Sources (one flat index built when Settings opens):
1. **Settings**: every catalog row: KO and EN label, description, help text, synonyms (including old page names and old labels, e.g. "다른 봇", "Other bots", "API key hide"), and section/page names. Both languages match regardless of UI language (design default; people follow English guides).
2. **Pages and sections**.
3. **Named things**: presets (by name), models (catalog name and id), connections (provider names), personas, plugins, modules.

Matching: case-insensitive; normalised spacing (`채팅봇` = `채팅 봇`); Korean **초성** on names and labels with the rule shared with TOGGLES_SPEC §6 and Studio §4 (one jamo = word start, two or more = consecutive initials). Multiple words AND together. No fuzzy matching (design default).

Ranking within a group: exact label → label prefix → word start → synonym → description/help. Groups in this order: 설정, 페이지, 프리셋, 모델, 연결, 페르소나, 플러그인, 모듈; each shows at most 5 with "모두 보기 (12)" to expand (design default).

### 5.3 Result rows

- Icon of the kind (setting rows use their page icon), label with the match marked (`<mark>`, not colour only), breadcrumb "화면·읽기 › 글꼴·크기", and for settings the **current value** ("켬", "100%", "Nanum Gothic").
- Opening a **setting**: the page opens, the row scrolls into view (centred, instant under reduced motion), gets a 2 s highlight (an outline layer fading by opacity), and focus moves to its control. Help is expanded if the match was in the help text.
- Opening a **page/section**: the page opens at that section, focus on the section heading.
- Opening a **named thing**: preset → 모델·프리셋 › 프리셋 with that preset's row focused; model → 모델 with the main-model row focused and the matched model named; connection → 연결 at that provider; persona → 페르소나 with it focused; plugin/module → 확장 at its row. Later slices replace these targets with their own detail screens.
- **Unavailable settings** appear at the end of the 설정 group, dimmed, with the reason as the description: "지금 모델(Claude …)은 이 값을 쓰지 않아요" / "The current model doesn't use this", "실험적 기능을 켜면 보여요" / "Shown when experimental features are on", "이 기기에서는 쓸 수 없어요". Opening one goes to the page and shows an inline notice in place of the row with the reason and, where a switch reveals it, a button to that switch ("실험적 기능 켜기로 이동") (design default).
- No results: "‘{q}’에 맞는 설정이 없어요" with two buttons: "검색어 지우기", "모든 설정 보기".

### 5.4 Cost

- Index: ~300 settings rows + ~40 pages/sections + named things (fixtures: 60 presets, 120 models, 12 personas, 15 plugins, 20 modules). Built once on open, kept while Settings is open; named things refreshed on open.
- Target in the mockup: building the index ≤ 30 ms and each keystroke's filter + render ≤ 16 ms on desktop Chrome, measured at 4× CPU throttle as a stand-in for the floor (reported, not a device claim). Results render at most 5 per group plus expanded groups; no virtualisation needed.

## 6. Keyboard, motion, accessibility

- Landmarks: header (`banner`), index (`nav`, "설정 메뉴"), page (`main`). Index entries are links/buttons with `aria-current="page"`; Up/Down move between them, Home/End jump, Enter/Space opens (focus stays in the index on wide screens; moves to the page heading on phones).
- F6 / Shift+F6 cycles header → index → page. Tab order otherwise follows the DOM.
- Page change: page content fades in with an 8 px upward move, `--chat-dur-base`, `--chat-ease-out`; phone drill-in slides the page in from the right (100 %), Back slides it out. Reduced motion: 120 ms crossfade; low power: instant. Only `transform` and `opacity` animate; no `backdrop-filter` anywhere.
- Press feedback on rows and buttons: chat slice 1 rule 3.
- Touch targets ≥ 44 dp on coarse pointers; index rows 48 dp touch / 36 px fine pointer.
- Text size to 200 %: rows stack, nothing clips, the header keeps Back and search.
- Forced colours: selected index row and highlights use `Highlight`/`CanvasText`, the changed dot gets a border.
- Icons are lucide (inline SVG, `aria-hidden`); every icon-only button has a KO/EN accessible name and a tooltip on hover-capable pointers.

## 7. Deep links and state

- `settings/slice1.html?page=<pageId>&section=<sectionId>&q=<query>&from=<chat|home|studio>` opens there. Later slices and other screens use the same ids (`models.connections`, `display.lowpower`, …). Unknown ids fall back to the index with a notice "찾는 설정이 없어요".
- Settings remembers the last page per device for the next open (design default) but always starts with an empty search.

## 8. Korean copy (proposed keys, en / ko)

Register as chat slice 1 §8: status in 해요체, labels and buttons as noun phrases.

| Key | en | ko |
|---|---|---|
| settings | Settings | 설정 |
| backTo | Back to {origin} | {origin}(으)로 돌아가기 |
| originChat | Chat with {name} | {name}와(과)의 채팅 |
| originHome | Home | 홈 |
| searchSettings | Search settings | 설정 검색 |
| resultsCount | {n} results | 결과 {n}개 |
| showAll | Show all ({n}) | 모두 보기 ({n}) |
| noResults | No settings match "{q}" | ‘{q}’에 맞는 설정이 없어요 |
| clearSearch | Clear search | 검색어 지우기 |
| browseAll | Browse all settings | 모든 설정 보기 |
| groupSettings / groupPages / groupPresets / groupModels / groupConnections / groupPersonas / groupPlugins / groupModules | Settings / Pages / Presets / Models / Connections / Personas / Plugins / Modules | 설정 / 페이지 / 프리셋 / 모델 / 연결 / 페르소나 / 플러그인 / 모듈 |
| changedFromDefault | Changed from default | 기본값과 다름 |
| resetToDefault | Reset to default | 기본값으로 |
| scopeDevice | This device | 이 기기 |
| scopePreset | Preset: {name} | 프리셋: {name} |
| scopeChat | This chat | 이 채팅 |
| openInStudio | Open in Studio | 스튜디오에서 열기 |
| redesignLater | This screen is redesigned in a later step ({slice}) | 이 화면은 다음 단계에서 새로 디자인해요 ({slice}) |
| unavailModel | The current model ({model}) doesn't use this | 지금 모델({model})은 이 값을 쓰지 않아요 |
| unavailExperimental | Shown when experimental features are on | 실험적 기능을 켜면 보여요 |
| unavailDevice | Not available on this device | 이 기기에서는 쓸 수 없어요 |
| goToSwitch | Go to "{name}" | ‘{name}’(으)로 이동 |
| lowPower | Low-power mode | 저전력 모드 |
| lowPowerDesc | Turns off blur, shadows and decorative animation, and shortens transitions. | 흐림·그림자·장식 애니메이션을 끄고 전환을 짧게 해요 |
| lowPowerSuggest | The screen seems slow. Turn on low-power mode? | 화면이 느린 것 같아요. 저전력 모드를 켤까요? |
| turnOn / noThanks | Turn on / No thanks | 켜기 / 괜찮아요 |
| lowPowerAsked | Suggested once when the app was slow | 느릴 때 한 번 제안했어요 |
| hotkeysPhone | Connect a keyboard to change shortcuts | 키보드를 연결하면 바꿀 수 있어요 |
| settingNotFound | That setting wasn't found | 찾는 설정이 없어요 |
| moduleNameFirst | Name the new module | 새 모듈 이름 |

`backTo` / `goToSwitch` pick 로/으로 and `originChat` picks 와/과 from the last syllable (rule in chat slice 1 §8). Index entry and section names are in §3.1. "첫 메시지" is the term for the character's opening message wherever a setting mentions it; never "greeting" / "인사말".

## 9. The mockup

### 9.1 Files and data

- `settings/slice1.html`, `slice1.css`, `slice1.js`, `data.js` (catalog + named-thing fixtures), served from `docs/design/` (`/settings/slice1.html`), also working from `file://`. Loads `../theme/nexus-tokens.css`. No dependency on `chat/**` files at runtime except that icon paths and motion tokens are copied, not imported (shared files stay untouched).
- Catalog: every row of today's settings that the research lists, with KO/EN labels taken from `src/lang/ko.ts` / `en.ts` where a key exists (reference reading; nothing in `src/` is changed), synthetic values, a `page`/`section` locator, synonyms, optional help, scope, default, and an optional `unavailable` reason. Provider names are real proper nouns; keys and URLs are fake (`fake-key-0000`, `.invalid`). Named things are synthetic (preset names such as "균형", "롤플레이 긴 답변", "번역용"…; personas, plugins, modules invented).
- An **origin stub**: a minimal chat screen (title, a few messages, composer with a draft, sidebar `settings` button) to prove Back, draft and scroll retention, and to host the low-power suggestion.

### 9.2 Demo controls and parameters

Collapsed "설정 데모 컨트롤" panel (as the chat mockups): language, width presets, reduced motion, low power, origin (chat/home/studio), model (to change unavailable reasons), experimental on/off, trigger the slow suggestion, state picker. Query parameters: `lang=ko|en`, `state=`, `page=`, `section=`, `q=`, `from=`, `reduced=1`, `lowpower=1`, `w=`. The page sets `window.__ss1Ready` when a state has finished its steps and exposes `window.__ss1` for checks.

### 9.3 States (`?state=`)

`ss-origin` (chat stub), `ss-index` (phone index / wide default page), `ss-page-display`, `ss-page-models` (later-slice banner), `ss-page-advanced` (sections, long page), `ss-search-typing` (`q=글꼴`), `ss-search-chosung` (`q=ㅈㅈㄹ`), `ss-search-en` (`q=temperature` in KO UI), `ss-search-named` (`q=균형`), `ss-search-unavail` (a parameter the current model lacks), `ss-search-none`, `ss-search-expand`, `ss-hit` (setting opened from search, highlight on), `ss-help-open`, `ss-changed` (changed dots + reset menu), `ss-hotkeys-phone`, `ss-module-new` (name-first dialog), `ss-deeplink-bad`, `ss-lowpower-suggest`, `ss-lowpower-on`, `ss-large-text` (200 %), `ss-back` (returned to the origin with draft and scroll kept).

### 9.4 Checks (headless Chrome, `settings/checks/`)

Own runner `settings/checks/run.mjs` (suite `ss1`), importing `../../chat/checks/cdp.mjs` (unchanged), at most 3 parallel Chrome workers, own profile dirs deleted on close. Server: the existing static server at `http://localhost:6141/` if it answers, else the builder's own on another port (stopped afterwards). Sections and what they must assert:

- **layout**: 360, 412 (Note 9 CSS width), 768, 1024, 1280, 1920 widths; no horizontal overflow; index/page/header geometry per §2; stacked rows at 360; 200 % text.
- **nav**: every index entry opens its page; phone drill-in and Back; sections jump list; F6 cycle; Up/Down/Home/End in the index; focus targets on open/back.
- **search**: KO, EN cross-language, 초성 rules (one jamo word start, multi-jamo), AND words, spacing normalisation, ranking order, groups and caps, show-all, current value text, unavailable reasons, no-results buttons, Esc order, live-region count, combobox ARIA, open-a-hit (scroll, highlight, focus, help expanded), named-thing targets.
- **rows**: changed dot + reset via ⋯, right-click and Shift+F10; help expand; scope chips; deep-link URLs; module name-first (nothing stored on cancel); hotkeys phone reference.
- **origin**: open from the stub and Back with draft, caret and scroll restored and focus on the opener; Android-Back-equivalent order (search → page → index → origin); background generation indicator (if shown) keeps running.
- **modes**: reduced motion and low power (computed transition durations, no animations other than transform/opacity — reuse the approach of `chat/checks/animated-props.mjs` without editing it), low-power suggestion once per device and the row description afterwards, forced colours emulation.
- **perf**: index build time and per-keystroke filter+render at 1× and 4× CPU (reported, budget §5.4).
- **ko/en**: every visible string in both languages (no key names leaking, no English in KO except proper nouns and ids), particle rules for `backTo` / `originChat`.
- **stills**: each §9.3 state at 412×915 and 1280×800, KO, plus a few EN, into `settings/checks/shots/`.
- **console**: no errors, no network requests beyond the page's own files.

## 10. Integration map (lane A; nothing here edits these files)

| Change | Where |
|---|---|
| New index (10 entries), page host keeping section state across switches (drop `{#key}` remount), origin-aware Back, phone drill-in | `src/lib/Setting/Settings.svelte`, `src/ts/stores.svelte.ts` (`SettingsMenuIndex` → a page id) |
| Locator on every schema item (`page`, `section`), `default`, synonyms filled; schema records for today's hand-written pages (at least label, locator, current-value getter) so search can reach them | `src/ts/setting/types.ts:105-187`, `src/ts/setting/*SettingsData*`, `botSettingsParamsData.ts` |
| Global search over items + pages + named things (`db.botPresets`, `getModelList`, personas, plugins, modules); include `languageSettingsItems` | `src/ts/setting/utils.ts:81-104` (extend `getFullSettingsData` or add a sibling) |
| Unavailable reasons: keep `condition(ctx)` but return a reason code for search | `SettingRenderer.svelte:33`, `types.ts` `condition` |
| Moves of misplaced items (hide API key, preset chain, aux placement, Pro tools, TTS OpenAI key) | `displaySettingsData.svelte.ts:299`, `advancedSettingsData.ts:39,166,213`, `accessibilitySettingsData.ts:214`, `OtherBotSettings.svelte:986` |
| Plugin-defined entries as rows under 확장 | `stores.svelte.ts:148`, `plugins/apiV3/v3.svelte.ts:1175-1187` |
| Low-power mode + slow-frame suggestion | new `db` device setting; `html.nexus-low-power` class (as the mockups); frame sampler in the chat screen |
| Hotkey page phone reference | `Pages/HotkeySettings.svelte:8-11` |
| Module name-first | `Pages/Module/ModuleSettings.svelte:163-169` |
| Strings | `src/lang/en.ts`, `ko.ts` (+ parity test keeps other locales in step) |

## 11. Open questions

- O-1 **Defaults per setting** for "changed from default" and reset: the schema has none; defaults live in `database.svelte.ts` and preset templates. Should reset exist for every row, or only rows with a clear default? (Mockup shows it for rows whose catalog default is known.)
- O-2 **Plugin-defined settings**: today a callback that opens the plugin's own UI. Rows under 확장 that open the callback (mockup) vs real in-shell pages (needs a plugin API change).
- O-3 **Remember last page** across opens (design default yes) vs always start at the index.

## 12. Design defaults to confirm

Section jump list; inline help (not popovers); changed dot + per-row reset; cross-language matching; no fuzzy matching; 5 results per group; dimmed unavailable results with a reason and a jump to the revealing switch; slow-frame thresholds (30 % of frames > 50 ms, two 10 s windows, once per device); Ctrl+K and `/` for search; last page remembered.

## 13. Revision 2: review answers (overrides §1–§12 where they differ)

Decisions: DS-010 (marker/reset only on real defaults), DS-011 (all keys in 연결), DS-012 (device scope only for new settings), DS-013 (model first). Review IDs refer to [the review](../reviews/2026-10-26-settings-slice1-review.md).

| Review | Change |
|---|---|
| R-10, Q1 → DS-010 | The changed dot and 기본값으로 appear only on rows with a default known in today's code; fixtures use today's defaults (hide API key **on** = masked, `database.svelte.ts:565`; line height 1.25 `:552`; animation speed 0.4 `:403`; send with Enter on `:370`; others per source). Rows without a known default show neither. No reset on preset-scoped rows (slice 2 decides the preset model). Q2 answered by this: keys are masked by default. |
| R-17, Q4 → DS-011 | 연결 holds every service key (LLM, ElevenLabs/TTS, DeepL/DeepLX, WaveSpeed/NovelAI image…). Each feature that needs a key shows one reference row "연결: {provider} · 설정됨/없음" linking to it. 장기 기억·번역·감정 이미지 sections get a "모델: {model} · 모델·프리셋에서 바꾸기" link row to their per-feature model. On phones each index row shows a one-line summary of its sections. |
| R-12, Q3 → DS-012 | 이 기기 chip only on low-power mode (and the suggestion state). Existing settings carry no device chip. Preset scope: one section-level line "이 섹션은 프리셋 ‘균형’에 저장돼요" instead of per-row chips; a row chip only where its scope differs from its section. |
| R-16, Q5 → DS-013 | 모델·프리셋 order: 모델 › 파라미터 › 프리셋 › 연결 › 프롬프트 설정. 연결 shows configured providers (fixture: 3) plus one "다른 서비스 (27)" row that expands the rest. |
| R-01 | Matching works per word token: a query word matches at a token start (any length) or inside a token only when the query word is ≥ 3 characters and the match does not cross a separator. Spacing normalisation keeps "채팅봇" = "채팅 봇" by indexing both the joined and the split forms. |
| R-02 | Ids and source keys are hidden match terms only, never rendered. The result's context line shows the breadcrumb and, when the hit came from a synonym, only that synonym word ("‘다크’와 일치"). Kind words are not indexed on named things. |
| R-03 | Synonym pass: Hangul names of providers and models (클로드, 소넷, 제미나이, 챗지피티, 딥엘…), intent words (다크/어둡게, 배터리/성능, 목소리, 글자 크기, 초기화/리셋 → a help hit "기본값으로 되돌리는 법"). Acceptance: a list of 30 everyday KO phrases and 15 EN phrases in the checks, each with its expected first hit. |
| R-04, Q8 | When the query equals or prefixes a page or section name, that page/section is pinned as a **top hit** above the groups; rows that matched only through their breadcrumb collapse into one "이 섹션의 설정 {n}개 보기" row (design default). |
| R-05, Q9 | Unavailable results sort after available results of the **same match tier**, not after all results (design default). |
| R-06, Q6 | Opening a hit keeps the query. Back (or Esc outside a field) from a page opened from search returns to the results with the opened hit active; a second Back clears search (design default). |
| R-07 | Entering the phone layout with a query opens the search field. |
| R-08 | Broad queries (1 character or > 200 hits) stop collecting after 50 hits per group before sorting. |
| R-09 | New unavailable reason `dependency`: "‘{switch}’을(를) 켜면 보여요" / "{select}을(를) {value}(으)로 바꾸면 보여요", with "‘{name}’(으)로 이동". On pages, dependent rows hide/show live with their switch or select (show unrecommended, 기능별 모델 따로 쓰기, voice engine, image engine, memory type…). Easy panel entry: a row in 고급 › 표시할 기능 next to Pro tools. |
| R-11 | Right-click and long-press never intercept `input`, `textarea`, `select` or contenteditable; long-press opens the row menu only from the label/description area. ⋯ is visible on rows with a default when changed, and on hover/focus otherwise. |
| R-13 | Each page keeps its scroll position and open help for the session. |
| R-14 | `?section=` alone resolves its page; an unknown section opens the page with the "찾는 설정이 없어요" notice; an unknown `from` falls back to chat with a console warning in the mockup; `?row=<rowId>` opens and highlights a row like a search hit. |
| R-15 | A preset hit focuses the preset's row; Enter/Space on it opens a small menu (이 프리셋으로 바꾸기 / 스튜디오에서 열기) rather than switching at once. |
| R-18 | Section jump chips live at the top of the page column at every width (no sub-list in the index); footer links come after the page in tab order. |
| R-19 | Add the missing rows the research lists (preset icon, bias, custom flags, module integration/tools, OpenRouter routing, Ooba mode, NovelAI adventure/append name, ban character set, persona description/portrait/export/remove, the five fallback lists) as plain or link rows, so search reaches them. |
| R-20 | `aria-controls` only when the listbox exists; unavailable options `aria-disabled="true"` plus the reason in `aria-describedby`; the open dialog makes the rest `inert`; "모두 보기" announces the new count. |
| R-21 | Selected segmented option and switch-on track meet 4.5:1 text / 3:1 non-text (dark text on the accent or a darker fill). |
| R-22 | Ctrl+S does nothing inside any text field, including search. |
| R-23 | The EN UI never gets Korean defaults (new module note); "저전력·동작" → "저전력·움직임"; "표시할 기능" → "메뉴에 보일 기능"; no internal names in labels (하이파 모달 → a plain description). |
| R-24, Q7 | The sampler ignores the first 10 s after launch or resume, any time the page is hidden, and single frames over 1 s; it runs only while the chat streams or scrolls. "괜찮아요" re-arms after 30 days, at most twice; "켜기" never re-asks (design default). |

## 14. Re-review notes applied (revision 2 → 2.1)

From [the re-review](../reviews/2026-10-26-settings-slice1-rereview.md) and DS-014..016.

- **DS-014 / N-10:** 연결 holds service addresses too (VOICEVOX, Fish Speech, WebUI, ComfyUI, DeepLX…); features show reference rows.
- **DS-015 / N-01:** multi-word queries with no result retry looser: drop filler words, retry joined/split spacing, then any-word matches under "일부 단어만 일치" / "Some words match".
- **DS-016:** the "모든 프리셋 공통" chip is removed.
- **N-05:** the Back stack closes an open dialog or menu first (Android Back, browser Back, mouse back, Esc), then the §1/§13 order; focus returns to the dialog's opener.
- **R-01 / N-02:** one-letter query words match only at a label token start (never breadcrumbs or in-word).
- **R-03:** synonym pass extended with the re-review's fresh phrases that have a real target; acceptance list grows accordingly.
- **N-03:** multi-word queries that equal a page/section name or an old page name ("화면 설정", "다른 봇") pin that page/section.
- **R-14 / N-04:** on phones an unknown `page=` shows the notice on the index screen.
- **N-06:** while a search is pending behind a page, Back's label reads "검색 결과로" / "Back to results".
- **N-07:** Esc in a text-entry control first leaves the field to its row, a second Esc follows the Back order (design default).
- Jump return (re-review Q1): after "‘{name}’(으)로 이동", Back returns to the referring row (design default).
- **N-08:** no Korean in the EN UI. **N-09:** dependent rows appearing/disappearing are announced politely ("설정 3개가 나타났어요"). **N-11..N-14:** as suggested in the re-review.
- Low-power re-offers (re-review Q6): unchanged, initial plus two after 30-day cool-offs (design default).

## Appendix: Parts (theme readiness, DD-142 to DD-159)

Added by the theme-readiness pass and extended by its fix round; the screen's behaviour is unchanged. Rule: [THEMING.md](../THEMING.md). Tokens: [theme-tokens.css](theme-tokens.css); loader and state mirror: [theme.js](theme.js); the pass: [THEME_AUDIT.md](THEME_AUDIT.md). A part is `data-part="settings-<role>"` on the element the Selector column names (the `th` suite reads this column: every element that carries the part must match it, and every instance of a main element class must carry some part). Names describe a role, not a look, and do not change once published. `data-part-critical` marks a surface a pack gives tokens to and never a rule; the pack-install rule (`checks/th/lint.mjs`) rejects a selector that can reach one. Slice 2 and slice 3 add their own parts to these (their appendices); the pages of those slices carry all of them.

| Part | Selector | Notes |
|---|---|---|
| `settings-frame` | `.app` | the whole mockup frame: the Settings screen and the origin stub it replaces; one per page |
| `settings-origin` | `section.origin` | the origin stub (chat, home or Studio) the screen returns to |
| `settings-shell` | `.settings` | the Settings screen: header and body |
| `settings-header` | `header.hdr` | Back, title and search |
| `settings-search` | `.search` | the search field with its icon and clear button |
| `settings-body` | `.body` | index, page and results in one grid row (one column on a phone); carries `data-view` |
| `settings-index` | `nav.index` | the page list |
| `settings-index-item` | `li.idx-li` | one row of the page list; `data-current` while it is the open page |
| `settings-index-link` | `button.idx` | the button inside it (`aria-current="page"`) |
| `settings-index-foot` | `.index-foot` | the About and Terms links under the index |
| `settings-page` | `main.page` | the open page |
| `settings-page-body` | `.pg` | one page's content; `data-page` names it |
| `settings-page-header` | `.pg-head` | the page title and the notices under it |
| `settings-banner` | `p.banner:not(.warn)` | a plain notice: the "redesigned later" and phone-keyboard notes |
| `settings-warning-banner` | `p.banner.warn` | a warning notice: the deeplink / index notice and the page notice. **Critical** (`data-part-critical`, re-review Q2): a pack may colour it and nothing else |
| `settings-jump-chips` | `nav.chips` | the sticky section chips of a page |
| `settings-section` | `section.sec` | one settings section |
| `settings-section-title` | `h2.sec-h` | its heading |
| `settings-rows` | `.rows` | the container of a section's rows |
| `settings-row` | `.row` | one setting, link, note or unavailable note; `data-type` is the control type, `data-row-kind` is `link`, `nav`, `note` or `unavailable` for rows without a control; `data-changed`, `data-stack`, `data-highlight` |
| `settings-toggle-row` | `.row[data-type="switch"]` | a row whose control is a switch (same state attributes as `settings-row`) |
| `settings-row-label` | `.r-label` | the label of a row (also in link rows and unavailable notes) |
| `settings-row-description` | `.r-desc` | the description under a label |
| `settings-row-control` | `.r-ctl` | the control column of a row |
| `settings-toggle` | `.sw` | the switch control inside a row |
| `settings-segmented` | `.seg` | a segmented control |
| `settings-field` | `.inp` | a text field, number field, select or text area |
| `settings-button` | `.btn` | any button that is not named otherwise (row actions, dialog buttons of a non-critical dialog, toolbar buttons); `data-on` while toggled on |
| `settings-list-item` | `button.thing` | a preset or persona in a list on its page; `aria-current="true"` marks the active one |
| `settings-callout` | `.callout` | "model found" with the use-as-main button |
| `settings-results` | `section.results` | the search results area |
| `settings-result-group` | `.grp` | a group of results (top, settings, pages, presets, ...) |
| `settings-result` | `.opt` | one result or a "show more" line; `data-active` (the cursor), `data-unavailable` |
| `settings-no-results` | `.nores` | the empty state with its two buttons |
| `settings-dialog-backdrop` | `.dlg-back` | the dim layer behind a dialog and the flex box that centres it. **Critical** when its dialog is |
| `settings-dialog` | `.dlg` | every dialog of every slice. **Critical** (`data-part-critical`) by default when it has a danger button, and by choice for an ask that moves or drops data (see "Critical surfaces" in THEME_AUDIT.md) |
| `settings-dialog-title` | `.dlg-t` | the title of a normal dialog |
| `settings-dialog-body` | `.dlg-b` | its body |
| `settings-dialog-actions` | `.dlg-f` | its footer; the buttons are `settings-button` |
| `settings-critical-title` | `.dlg-t` | **Critical.** The title of a critical dialog |
| `settings-critical-body` | `.dlg-b`, `.pt-txt` | **Critical.** The body of a critical dialog, or the text of the Undo toast after a delete |
| `settings-critical-actions` | `.dlg-f` | **Critical.** The footer of a critical dialog |
| `settings-critical-action` | `.dlg-f > .btn`, `.pt-act` | **Critical.** A button of a critical dialog, or the Undo button of the toast after a delete |
| `settings-menu` | `.menu` | a row or list menu |
| `settings-menu-item` | `.mi` | an item in it |
| `settings-toast` | `#toast` | the transient message |

### State attributes

View state that existing code keeps as classes or media queries is mirrored as `data-*` attributes by [theme.js](theme.js) (one table, derived from the class, never set by hand elsewhere). The classes stay. **In use and cursor are two words everywhere:** `data-current` is the one in use, `data-active` is where the keyboard cursor is.

| Attribute | On | Values | Mirrors |
|---|---|---|---|
| `data-changed`, `data-stack`, `data-highlight` | rows | present | `.changed`, `.stack`, `.hl` |
| `data-current` | index item, switcher option, picker row, preset row | present | `.cur`, `.is-active` (the one in use) |
| `data-active` | search result, switcher option, picker row | present | `.act` (the cursor) |
| `data-selected`, `data-selecting`, `data-renaming`, `data-dragging`, `data-lifted` | preset rows, library, cards | present | `.is-sel`, `.selecting`, `.renaming`, `.dragging` and `.is-dragging`, `.lifted` |
| `data-unavailable` | search result | present | `.unav` |
| `data-open`, `data-on`, `data-closed` | layers, toast and toggles, folders | present | `.open`, `.on` and `.ps-on`, `.closed` |
| `data-needs-connection` | picker row | present | `.need` |
| `data-bad`, `data-failed`, `data-shared`, `data-no-model` | connection card and model row, preset chip and row, shared-value row, chip | present | `.bad` and `.c3-bad`, `.ps-failed` and `.is-failed`, `.ps-shared`, `.no-model` |
| `data-capturing` | hotkey capture button | present | `.capturing` |
| `data-result` | connection test result | `ok`, `badkey`, `unreachable`, `quota`, `none`, `run` | `.c3-tres.<state>` |
| `data-layout` | `<html>` | `wide`, `mid`, `phone` | set by slice1.js from the app width (DD-147); the same names as chat |
| `data-input` | `<html>` | `touch`, `hover` | `(hover: hover) and (pointer: fine)` is hover, else touch (DD-147) |
| `data-motion` | `<html>` | `reduced`, `full` | `html.rm` |
| `data-power` | `<html>` | `low`, `normal` | `html.nexus-low-power` |
| `data-text` | `<html>` | `large`, `normal` | `html.big` (200 % text) |
| `data-overlay` | `<body>` | `dialog`, `picker`, `switcher` | the topmost open layer, in that priority; absent when none is open |
| `data-search` | `<body>` | `open` | `body.s-open` (the phone search field) |
