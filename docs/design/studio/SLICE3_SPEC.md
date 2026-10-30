# Studio slice 3: long-text editor

Status: **draft, revision 2.2** (rev 2.2: DD-126..DD-129 and the re-review [reviews/2026-10-26-studio-slice3-rereview.md](../reviews/2026-10-26-studio-slice3-rereview.md); rev 2.1: O3-4 settled by the engine, toggles are read with `getglobalvar`) (2026-10-27: fix round after the independent review [reviews/2026-10-26-studio-slice3-review.md](../reviews/2026-10-26-studio-slice3-review.md) and DD-122..DD-125; revision 1.1 was the build, 2026-10-26; built as `studio/slice3.html`, see §15 for what each revision changed; checks in [checks/builder-checks-s3.md](checks/builder-checks-s3.md)). Task: [tasks/2026-10-26-studio.md](../tasks/2026-10-26-studio.md). Discovery: [research/long-text.md](research/long-text.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) rev 2.1 (shell, owner map, live saving, test panel) and [SLICE2_SPEC.md](SLICE2_SPEC.md) rev 2.1 (list + text view pattern). Decisions: DD-089 ("cramped text boxes"), DD-094 (all forms in Studio), DD-095 (live items), DD-099 (device-only drafts/history), DD-100 (durable delete undo), **DD-118 (one light editor), DD-119 (tokens: preset model, estimate fallback), DD-120 (lists + text view), DD-121 (sandbox preview), DD-122 (alternate first messages: cards only, "paste several"), DD-123 (example message marker rule = the engine's), DD-124 (a start line typed in a card splits it), DD-125 (stray `}}`), DD-126 (a visible "목업" tag on the stand-in count), DD-127 (plain text while typing in very long fields), DD-128 (a typed start line splits when the caret leaves it), DD-129 (paste several: blank lines or `---`)** in [DECISIONS.md](../DECISIONS.md).

Scope: one long-text editor ("LT") used by every long text field Studio shows, its focus mode, CBS highlighting, `{{` autocomplete, CBS problems, find/replace, token counts, the sandboxed CBS preview, and structured lists for example messages and alternate first messages. Out of scope: the rest of the character forms (slice 4), regex/lorebook/trigger testers.

## 0. Today (discovery, parent-verified where marked)

| Fact | Anchor |
|---|---|
| Every long field is a fixed 160 px box, `resize-none`, internal scroll, 12 px text by default; same size for a 5-line list and a 4 000-token description. | `TextAreaInput.svelte:3-43` |
| CBS highlighting is **off app-wide**: the highlight branch needs `$disableHighlight` false, and it is `writable(true)` and never changed. `{{` autocomplete lives only in that dormant branch and is skipped on mobile. *(parent-verified)* | `stores.svelte.ts:125`; `TextAreaInput.svelte:41, :193-277` |
| The popup editor (Monaco) opens only by Ctrl+X or an off-by-default right-click setting; no visible button, no label, no Cancel (close always writes), no Escape/focus trap. Its CBS mode is disabled and `registerCBSMonaco` is empty. *(parent-verified)* | `PopupEditor.svelte:50-116`; `cbsMonaco.ts:22-24` |
| Token counts only on description, first message, chat author note, lorebook content; `tokenizeAccurate` = CBS parse then the main model's tokenizer; no debounce. | `tokenizer.ts:82-169, :415-427`; `CharConfig.svelte:60-97` |
| Bound value updates about every 11th keystroke (`optimaizedInput`); no composition handling. | `TextAreaInput.svelte:50-62` |
| No validation of `{{ }}` or `{{#if}}` balance; the macro list is kept twice (runtime `registerCBS` and hand-copied arrays in `highlight.ts`). | `highlight.ts:127-181`; `cbs.ts:217-244` |
| Example messages are one field using `<START>` blocks by convention (help text only); alternate first messages are a table of 160 px boxes. | `CharConfig.svelte:1104, :1166-1189`; `lang/en.ts:525-529` |

## 1. Fields that use LT

All long text Studio shows (slice 1 placeholders are replaced): character description, first message, alternate first messages (list, §6), example messages (list, §6), system prompt, global note replacement, additional description, personality and scenario (when shown), author's note (chat owner), background HTML, translator note, default variables (plain mode, no CBS), image-generation prompts; lorebook entry content; regex replace; preset prompt item text and inner format, preset main prompt / jailbreak / global note; module texts; persona prompt. Code (Lua, plugin) keeps the slice 1 code editor. Toggle definitions keep the slice 2 builder.

Each field declares a **mode**: `cbs` (default: highlighting, autocomplete, problems, preview, tokens), `html+cbs` (background HTML, first messages: also tag colouring), `plain` (default variables, translator note: no CBS features, tokens only if the field reaches the prompt).

## 2. The field (inline)

- A textarea that **grows with its content** from 3 lines up to a cap (about 60 % of the viewport height on phone, 70 % on desktop), then scrolls inside; a bottom-edge drag handle (fine pointer) can set the cap per field (remembered on the device). Text at reading size (≥ 15 px on phone, follows the Studio text size setting), proportional font (the chat reading font for prose fields; mono only in `plain` key=value fields).
- Field header row: label, owner tag where helpful, **token chip** (§7), and icon buttons (lucide, labelled for AT): `maximize-2` focus mode, `braces` insert macro, `eye` preview (opens slice 1's test panel in CBS preview for this field), `search` find (in focus mode; inline opens focus mode with find open).
- Saving is live (DD-095): status chip and owner undo as slice 1. Writes happen after composition ends plus a short debounce, never mid-composition; the owner history coalesces typing into one step per pause (as slice 2).
- Highlight is a **mirror overlay** behind a transparent textarea (no contenteditable): the textarea stays the real input, so native caret, selection, IME, spellcheck and undo keep working. The overlay re-tokenises only after a pause and never during composition; for text over about 20 000 characters only the visible lines plus a margin are coloured. If the overlay can't keep up (measured frame budget, or low power), it turns off for that field and a quiet note says so. **While keys arrive (DD-127):** up to 20 000 characters the last overlay stays on screen and each edit is applied to it in place, so colours do not blink; in a longer (windowed) field the text is drawn plain by the textarea while typing and the colours return after the 250 ms pause. That is accepted, not a bug.
- Colours: `{{macro}}` names, `::` arguments, block macros `{{#if …}} … {{/if}}` with matched-pair emphasis when the caret is in one, `{{// comment}}`, decorators (`@@depth` etc.) in lorebook content, deprecated forms (`<char>`, `<user>`, `@@end`) underlined. Never colour alone: problems also get an underline style and a Problems entry.

## 3. `{{` autocomplete and insert macro

- **Typing** `{{` opens a small list under the caret (also on phone, as a strip above the keyboard): name, short argument signature, one-line description, KO-first. Filter by prefix and 초성 (TOGGLES_SPEC §6 rule). Moving the caret into an existing macro (arrows, click, tap) never opens it. **Enter** inserts when an item was chosen with the arrows or at least one letter of a name has been typed; with nothing typed after `{{` Enter is a new line. **Tab** inserts only an item chosen with the arrows; otherwise it leaves the field as usual. The text is never rewritten by either key. Esc closes, arrows move; tapping inserts on phone. During IME composition the list stays open and keeps filtering (read only; nothing is written until the composition ends). The number of matches is announced in the live region; on phone the strip follows the visual viewport when the keyboard comes or goes. Inserts `{{name}}`, `{{name::}}` with the caret inside, or a block skeleton `{{#if }}` + `{{/if}}` with the caret at the condition.
- The `braces` button (or **Ctrl+Shift+Space**; plain Ctrl+Space stays free for the OS/IME) opens the same list as a searchable sheet grouped by kind (character and user, variables, time and random, display, blocks, toggles: lists `toggle_<key>` from the merged toggle definitions, slice 2).
- One macro list for both features. **Integration note:** the app must generate it from the runtime registry (`registerCBS`) instead of the hand-copied arrays (§11). The mockup uses a synthetic subset of about 60 macros with KO/EN descriptions.

## 4. CBS problems

Checked after a pause and shown in slice 1's Problems panel and as a gutter-less underline:
- an unclosed `{{` (error); a stray `}}` is **not a problem in `html+cbs` fields** (the engine reads it as text, CSS and script braces are common there) and a quiet **info** note in prose fields (DD-125); a block opened and not closed or closed without opening (error) for the engine's block registry: `#if`, `#if_pure`, `#when`, `#each`, `#func`, `#pure`, `#pure_display`, `#puredisplay` and `#escape` (`#while` is not a block there, `src/ts/cbs.ts`); unknown macro name (warning, "앱이 모르는 매크로예요"); deprecated form (info, with a fix "{{char}}로 바꾸기"); `{{slot}}` outside a prompt item inner format (warning; **not** warned inside `#each`, where `{{slot::i}}` is the loop variable). **No unknown-macro warning inside `#pure`, `#escape`, `#each` and `#func` bodies** (N-R3: the engine does not evaluate those bodies as CBS at that point, `parser.svelte.ts:1759-1764`); balance is still checked there.
- Each problem names the line and jumps there; fixes are one undo step.

## 5. Focus mode

- `maximize-2` (or **Ctrl+E** in a field) opens the field full screen: header with Back, field label and owner breadcrumb, status chip, token chip, undo/redo; the same LT editor with more room; a toolbar row with find, insert macro, preview toggle.
- **Desktop ≥ 1024 px**: editor and live preview side by side (preview optional). **Phone**: full page with Back (DD-098); preview is a tab (편집 / 미리보기), not split.
- **열었을 때로 되돌리기** (revert to when opened): one undoable step that restores the text from when focus mode opened. Closing never asks (saving is live); Esc and Back close.
- Find/replace: match count, next/previous, case toggle, replace one / all (one undo step), works in the field only. Ctrl+F inside focus mode; Ctrl+H for replace.
- Focus trap and `role="dialog"` on desktop; focus returns to the field on close.

## 6. Lists: example messages and alternate first messages (DD-120)

- **Alternate first messages (DD-122)**: cards only, no persistent text view and no separator line. One card per message (the main first message stays its own field above). Card: handle (a real button), number, first line as title, LT editor (collapsed to 4 lines until focused), token chip, ⋯ menu (복제, 위로, 아래로, **대표 첫 메시지와 서로 바꾸기**, 삭제). "Swap" exchanges the card with the main first message, so nothing is lost and a second use undoes the first. Add at the end; reorder by drag (fine pointer), **Alt+↑/↓ only while the handle or the ⋯ button has focus** (inside the text the keys keep their editing meaning), menu (phone). Delete with durable undo (DD-100).
- **여러 개 붙여넣기 (paste several)**, one-time: a sheet with a text box, the rule, a live count and a preview of the cards it would make, then "카드로 추가" (adds the cards at the end as **one undo step**) or "닫기" (changes nothing). The split rule, stated in the sheet (DD-129): **two or more blank lines separate messages; one blank line stays inside a message; blank lines at the ends are dropped** (a "blank" line may hold spaces or tabs). One choice sits in the same sheet, **"‘---’만 있는 줄에서 나누기" / "Split on lines holding only ---"** (a labelled checkbox, off by default): when on, a line holding only `---` (three or more dashes) separates messages **instead of** the blank-line rule (blank lines then stay inside). In both modes **nothing splits inside a code block**: blank lines or `---` between a line starting with three backticks and its closing line do not count, and an unclosed opening runs to the end of the text. The count and preview follow the choice at once. The pasted text is not kept as a view.
- **Example messages**: one card per marker block, with **the engine's marker rule (DD-123)**: a marker is a line that is exactly `<start>` after trimming and lower-casing (`src/ts/process/exampleMessages.ts:59`), so `  <Start>  ` counts and `<START>{{user}}: hi` or `x <START>` does not. Inside a card the conversation is shown as turns but stays one LT editor (no per-turn fields). The engine's speaker rule is drawn: a line starting `{{char}}:`, `<bot>:`, `<name>:`, `{{user}}:` or `<user>:` starts a turn, and because the engine reads a turn as `split(':', 2)[1]`, **everything after a second colon in that line is dropped**; the mockup marks that text as "not used" (struck through, never colour alone) and the card subtitle says how many lines it affects. Text before the first marker is a normal **opening card** ("시작 표시 없는 대화"; subtitle: it is read as a conversation) with a menu item that gives it a start mark; it is not a warning.
- **A start line typed or pasted inside a card splits it (DD-124, refined by DD-128):** a **pasted or dropped** marker splits at once. A **typed** marker splits only when the caret **leaves the marker line** (Enter, an arrow key, a click or tap elsewhere, or leaving the field). While the caret is still on it nothing is written, so deleting the marker never splits and never leaves an empty card. The card becomes two (or more) cards at the marker as **one undo step** ("예시 대화 나눔"), caret in the new card. The stored-block and card order stays one-to-one (fixed at the root in rev 2; rev 1 could write the wrong block, F-01).
- **Text view** (목록 / 텍스트 switch, 44 × 44 under 600 px, as slice 2): the raw stored text. Round trip keeps untouched blocks byte-for-byte; new or changed cards are written as `<START>\n…` blocks. **Line endings are kept:** a CRLF text stays CRLF line by line; an edit rewrites only the lines it touched, and a change of trailing blanks only adds no undo step.
- Counting: list total and per card.

## 7. Token counts (DD-119)

- Chip on every `cbs`/`html+cbs` field and on list cards and totals: "토큰 1,234 · GPT-4o" when the active preset's model tokenizer is available (the real model name is kept; the tooltip says "목업 계산 · 실제 토크나이저가 아니라 목업이 만든 값이에요", because the mockup loads no tokenizer); **"약 1,200토큰 · 추정"** (with an info disclosure naming the model: "오프라인이라 GPT-4o의 토크나이저를 쓸 수 없어요" or "GPT-4o은(는) 온라인 토크나이저만 있어요") when it isn't. The estimate carries its unit and no extra "≈". The estimate rule is stated in the disclosure (characters-based; Korean and English weighted differently). The disclosure is a button with `aria-expanded`/`aria-controls` to a `role="group"` panel (not `role="tooltip"`: it holds several lines and can be reached by keyboard and tap). **Mockup mark (DD-126):** the exact chip also wears a small dashed **"목업" / "Mock"** tag next to the number (not only in the tooltip), and the demo drawer option is named "목업 계산" / "Mockup calculation". Remove both (the tag, `.lt-mock`, `ltMockTag`/`ltMockTagTip`, the tooltip sentence and the drawer name) when a real tokenizer is wired in; the estimate chips never carry the tag.
- Counted after CBS is filled in with the preview sandbox values (§8), so the chip names that: tooltip "미리보기 값으로 채운 뒤 셌어요". Random/time macros make counts vary: the chip then says so (a "≈" in front of an exact count only). Macros such as `{{description}}` and `{{lastmessage}}` are counted by their sandbox expansion (the character's own description, invented sample lines), with a guard against a field that contains itself; changing a field's text alone does not recount other fields until the preview values change.
- Cadence: after typing pauses (about 500 ms), never during composition; only for the focused field and visible chips; off-screen chips count on reveal. Low power: count only on blur or on tap.
- The count is not the per-turn prompt cost (wrappers, inner format, history are excluded); the tooltip says so.

## 8. CBS preview sandbox (DD-121)

- The slice 1 test panel's CBS preview gains a **값** section: sample values for `{{user}}`, `{{char}}`, variables and toggles used by the field (auto-listed from the text), editable. **이 채팅 값 가져오기** copies the current chat's variables and toggle values into the sandbox (needs a chat context; disabled with a reason otherwise). Nothing is written back; macros that write (`setvar`, etc.) change only the sandbox and are listed ("이 글은 변수 2개를 바꿔요 · 미리보기 안에서만"). **Two variable tables:** chat variables (`getvar`, `setvar`, `addvar`, `setdefaultvar`) and global chat variables (`getglobalvar`, where the toggles `toggle_<key>` live) are separate in the evaluator; the toggle rows say "전역 변수 · toggle_<key>" / "Global variable · toggle_<key>". A global variable that is not a toggle reads as `null` in the sandbox and is not listed (the mockup has no editor for it).
- Render: Markdown/HTML rendered as the chat would (sanitised, no scripts), with a "원문" toggle to see the parsed text. **The sanitiser keeps no `class`, `id` or `style` from the source** (a card cannot style itself over the Studio or take another element's id) and the output box is contained (`contain: paint`). Stale state as slice 1 (re-run after pause).

## 9. Keyboard, motion, low power, accessibility

- Field: **Ctrl+E / Cmd+E** focus mode, **Ctrl+Shift+Space** macro list (plain Ctrl+Space does nothing), `{{` autocomplete (listbox with `aria-activedescendant`), Alt+↑/↓ only on a card's handle or ⋯ button. Focus mode: Ctrl+F, Ctrl+H, Esc. Cmd+E is checked as a key event only; it was not tried on a Mac. The overlay is `aria-hidden`; the textarea carries the label, the token chip text and problem count via `aria-describedby`.
- IME: no keydown interception of Enter/Tab while composing; an open autocomplete list stays open and keeps filtering during composition, and nothing is written, coloured or counted until it ends. (Small targets and wording, rev 2.2: the token info button in focus mode is 44 x 44; the focus mode ⋯ button has `aria-haspopup="menu"`; English singular forms read "1 line", "1 turn", "1 macro".)
- While typing, the last overlay stays on screen (never a blank flash); edits are applied in place to the overlay's text and recoloured after the pause.
- Replace all and revert on very long text (over 20 000 characters) write once through the field's value with the caret and scroll kept and one owner-history step (the browser's own undo for that edit is not kept; the owner history is).
- Motion: focus mode opens with opacity + small transform; reduced motion / low power → fade ≤ 120 ms. No blur.
- Low power: highlighting limited to the focused field; token counts on blur/tap; no live preview while typing (manual refresh).
- Floor: a 100 000-character field types without visible lag at 4× CPU throttle (proxy; real device not available).

## 10. Copy (proposed keys, ko / en)

| Key | KO | EN |
|---|---|---|
| ltFocus / ltFocusClose | 크게 편집 / 닫기 | Edit full screen / Close |
| ltInsertMacro | 매크로 넣기 | Insert macro |
| ltPreview | 미리보기 | Preview |
| ltRevert | 열었을 때로 되돌리기 | Revert to when opened |
| ltFind / ltReplace / ltReplaceAll | 찾기 / 바꾸기 / 모두 바꾸기 | Find / Replace / Replace all |
| ltTokens | 토큰 {n} · {model} | {n} tokens · {model} |
| ltTokensEst | 약 {n}토큰 · 추정 | About {n} tokens · estimate |
| ltTokEstOffline | 오프라인이라 {model}의 토크나이저를 쓸 수 없어요 | Offline, so the {model} tokenizer isn't available |
| ltTokEstOnline | {model}은(는) 온라인 토크나이저만 있어요 | {model} only has an online tokenizer |
| ltTokNote | 미리보기 값으로 채운 뒤 셌어요 · 대화 한 번의 비용과는 달라요 | Counted after filling in preview values · not the cost of one turn |
| ltHlOff | 글이 길어 이 칸의 색 표시를 껐어요 | Colouring is off for this long field |
| cbsUnbalanced | ‘{{’와 ‘}}’의 짝이 맞지 않아요 | ‘{{’ and ‘}}’ don't pair up |
| cbsUnclosed | {block}이(가) 닫히지 않았어요 | {block} is never closed |
| cbsUnknown | 앱이 모르는 매크로예요 | The app doesn't know this macro |
| ltAltTitle / ltExTitle | 다른 첫 메시지 / 예시 대화 | Alternate first messages / Example messages |
| ltOpening | 시작 표시 없는 대화 | Dialogue without a start mark |
| ltMakeMain | 대표 첫 메시지와 서로 바꾸기 | Swap with the first message |
| ltMockTag / dTokExact | 목업 / 목업 계산 | Mock / Mockup calculation |
| ltPmDash | ‘---’만 있는 줄에서 나누기 | Split on lines holding only --- |
| sbGlobal | 전역 변수 | Global variable |
| sbValues / sbCopyChat | 값 / 이 채팅 값 가져오기 | Values / Copy this chat's values |
| sbWrites | 이 글은 변수 {n}개를 바꿔요 · 미리보기 안에서만 | This text changes {n} variables · only inside the preview |

Say "first message" (첫 메시지); never "greeting" (also for alternate first messages, even though the code calls them `alternateGreetings`).

## 11. Integration map (lane A; nothing here edits these files)

| Design piece | Today | Change |
|---|---|---|
| LT field | `UI/GUI/TextAreaInput.svelte` | New component: textarea + overlay, grow-with-content, composition-safe writes; retire the dormant contenteditable branch and `optimaizedInput` batching for LT fields. |
| Macro list | `ts/gui/highlight.ts:127-181` (hand-copied) | Generate from `registerCBS` (`cbs.ts`) with signatures and KO/EN descriptions; one source for highlight, autocomplete and problems. |
| Problems | none | A CBS balance/unknown-name checker (UI side) over the same tokenizer as the highlighter. |
| Focus mode | `Others/PopupEditor.svelte` + Monaco | Replaced for text by LT focus mode; Monaco stays for Lua/plugin code only. |
| Token chip | `CharConfig.svelte:60-97`, `LoreBookData.svelte:46-50` | Shared debounced counter on `tokenizeAccurate` with a tokenizer-availability check and estimate fallback. |
| Preview sandbox | `risuChatParser` reads live state | Call with a sandbox var store (`var`/`runVar` options, semantics to confirm). |
| Lists | `exampleMessage` string; `alternateGreetings[]` | Example messages stay one stored string (cards are a view; marker rule and speaker split as the engine, `exampleMessages.ts`); alternate first messages stay the array (cards only, "paste several" is a one-time action). |

## 12. States the mockup shows (`?state=lt-…`)

Field grows from short to cap; drag cap; highlight of macros, blocks with matched pair, comment, decorators, deprecated; autocomplete open (desktop, phone strip), 초성 filter, block skeleton insert; macro sheet; problems (unbalanced, unclosed block, unknown, deprecated + fix); focus mode desktop split and phone tabs; find/replace with count and replace all + undo; revert to when opened; token chip exact, estimate offline, estimate online-only, "≈" with random macro, low power on blur; preview sandbox with values, copy this chat's values, writes listed, no chat context; alternate first messages list (add, move, swap with the main message, delete + undo) and the "paste several" sheet with preview; example messages cards with turns, the opening card, the second-colon "not used" marking, a start line typed inside a card splitting it; text view round trip; paste of several `<START>` blocks; autocomplete not opening from caret movement; 100 000-character field with highlight limited to the viewport and the "colouring off" note in low power; IME composition (synthetic). Widths 360×740, 412×915, 768×1024, 1280×800; KO/EN; keyboard only; reduced motion; low power; forced colours.

## 13. Open questions

- **O3-1** Typical and worst-case sizes per field are unknown (no hints in source); the mockup uses design targets: description up to 30 000 characters, 40 example blocks, 20 alternate first messages, lorebook content up to 5 000.
- **O3-2** RTL text (Arabic/Hebrew) is not handled today; the mockup sets `dir="auto"` on LT and checks only that LTR is unharmed.

- **O3-3** (rev 1.1, **decided rev 2, DD-122**) The text view of the alternate first messages needed a separator that is not valid message text. Decided: no text view and no separator; cards only, plus a one-time "paste several" (rule in §6). `<<<NEXT>>>` in a message is now just text.
- **O3-6** (rev 2, **decided rev 2.2 by DD-129**) The "paste several" rule stays blank lines by default, with a "split on `---` lines" choice and a code-fence guard in the same sheet (rule in §6).
- **O3-7** (rev 2, shown rev 2.2 by DD-126) The mockup's "exact" token count is a stand-in rule, so the chip carries a visible "목업" tag and the tooltip says "목업 계산"; in the app the tokenizer decides and both go away (§7).
- **O3-4** (rev 1.1, **decided rev 2.1 by the engine**) Toggle insert shape: `{{getglobalvar::toggle_<key>}}`. In this clone `getvar` reads chat variables (`getChatVar`, `src/ts/cbs.ts:888`) and `getglobalvar` reads global chat variables (`:957`); toggle values are global chat variables, so the macro list, slice 1 fixtures and slice 3 fixtures use `getglobalvar`, as slice 2's builder already did. Other variables (`{{getvar::hp}}`) are unchanged. Slice 2's "CBS uses of the old key" search (DD-113) matches `toggle_<key>` and still finds them.
- **O3-5** (rev 1.1) The sandbox evaluator (`lte-core.js` `evalCbs`) covers about 40 of the macros in the synthetic list (names, variables, `#when`/`#if`, time and random, text and logic helpers). Macros it cannot resolve stay as written and are counted ("풀지 못한 매크로 N개"). Which macros the real preview must support is open; the integration note (§11) says to call the real parser with a sandbox var store.

## 14. Design defaults to confirm

- Ctrl+E / Cmd+E opens focus mode (Ctrl+P and Ctrl+1–9 belong to the preset switcher, DS-023; Ctrl+K is Studio search). Ctrl+Shift+Space opens the macro list (picked in rev 2; Ctrl+Space belongs to IME and OS input switching).
- Highlight turns off per field above the frame budget or in low power, with a note.
- Example message cards keep one editor per block (no per-turn fields).

## 15. Build notes and changelog

**rev 2.2 (2026-10-27, builder; final fix round, DD-126..DD-129 and re-review defaults).** Changelog line: *exact chip carries a visible "목업" tag; plain text while typing in fields over 20 000 characters is stated as accepted; a typed start line splits only when the caret leaves it; paste several gets a `---` choice and a code-fence guard; no unknown-macro warnings in pure bodies; chat and global variables are two tables; focus info button 44 x 44, `aria-haspopup` on the more button, English singulars.* Spec text changed in §2, §4, §6, §7, §8, §9, §13 as marked. Notes in [checks/builder-checks-s3.md](checks/builder-checks-s3.md) §2c.

**rev 2 (2026-10-27, builder; fix round after the independent review, decisions DD-122..DD-125).** Spec text changed in §3, §4, §6, §7, §8, §9, §10, §12, §13, §14 as marked there. Changelog line: *alternate first messages are cards only with a stated "paste several" rule; example messages follow the engine's marker and speaker rules and split on a typed start line; stray `}}` is info/none; autocomplete opens from typing only; Ctrl+Shift+Space replaces Ctrl+Space; Alt+arrows only on the handle; chips carry units and a mockup note; sanitiser strips class/id/style; 360 px focus toolbar fits; the reduced-motion side column bug is fixed in `slice1.css`.* Finding-by-finding notes are in [checks/builder-checks-s3.md](checks/builder-checks-s3.md) §2b.

**rev 1.1 (2026-10-26, builder, no maintainer decision changed).** Spec text unchanged except the status line, O3-3..O3-5 and this section. What the build did, and where it differs from rev 1:

| Spec | Build |
|---|---|
| §2 header "owner tag where helpful" | Not shown on the field: the item header above already names the owner. Focus mode shows the owner in its breadcrumb (hidden under 600 px). |
| §2 "re-tokenises only after a pause" | One adaptive pause for write, colour and chip: 50 ms normally; longer for a field over 20 000 characters (250 ms) and when the last write was slow (2.5 times its cost, at most 450 ms). The write is made first; the colouring and the shell's tree/Problems refresh run in later tasks so a key pressed meanwhile is served first. While a write is pending the text is drawn by the textarea itself (the overlay is hidden), so typing is never behind the colouring. |
| §2 "frame budget" | A paint over 150 ms twice in a row turns the overlay off for that field with the note `ltHlOffBudget` (the spec's `ltHlOff` is used for the long-field case). |
| §2 colour for "problems also get an underline style" | Underline styles: dotted yellow (old form), wavy yellow (unknown), wavy red (unbalanced, unclosed). Colour never carries a problem alone: each also has a line in the field's own list and in the Problems tab. |
| §3 block skeleton | Written on three lines (`{{#when::}}`, a blank body line, `{{/when}}`) with the caret at the condition. |
| §4 Problems | Strict pairing (an inner `}}` closes the nearest `{{`), so a stray `}}` or a last unclosed `{{` is reported, ambiguous text is not guessed. The shell's Problems tab lists the first 30 per field and says how many more (a 100 000-character field held 424 old-form hits). The `{{` being typed while the list is open is not reported as an error. Fixes exist only for `<char>`, `<user>`, `<bot>`; `@@end` and the other old decorators are info without a fix. |
| §5 focus mode | Same editor in a second textarea bound to the field (not a moved element), so Esc, Back, undo from the header and a rebuilt form all keep working; the header mirrors the shell's status chip and undo/redo state. On phones and tablets under 1024 px the preview is a tab; from 1024 px it is a split. Preview and token chip in focus mode use the same sandbox values. |
| §5 find | Plain text (not regex), case toggle, count `i / n`, current match drawn differently from the others, replace one and replace all (one owner-history step). Matches are not drawn above 20 000 characters (find still selects them). |
| §6 example cards "turns" | Turns are not separate controls. The speaker labels `{{user}}:` and `{{char}}:` (and `<USER>`, `<BOT>`) are tinted inside the one editor, and the card says how many turns it holds. |
| §6 text view of alternates | Removed in rev 2 (DD-122, O3-3). |
| §7 chips | The estimate rounds (`약 1,200토큰 · 추정` since rev 2); "≈" is added in front of an exact count when the text holds random or time macros. Chips off screen count when revealed; chips in view recount when sandbox values change; low power counts on blur or on tap of the chip. The "exact" number is a synthetic stand-in rule (no tokenizer is loaded). |
| §8 sandbox | Values are listed from the text (user, char, variables, toggles); variable defaults come from the character's default variables field; "이 채팅 값 가져오기" copies a synthetic chat's variables and toggles and is disabled with a reason when no chat is open. The render is sanitised in the page (allow-list; images become a placeholder; no links). |
| §9 keyboard | Added (rev 1.1; Ctrl+Space became Ctrl+Shift+Space in rev 2): Ctrl+Space (macro sheet), Tab/Enter in the popup, Alt+Up/Down on a card, Esc layering (popup, tooltip, find, then the mode). A first `keydown` listener (`lte-early.js`) lets the editor take those keys before the shell's own. |
| §11 integration | Unchanged. Additional hooks the mockup needed in slice 1 (additive, `ST.ext.*`): `afterForm`, `cbsRender`, `cbsRun`, `gotoPos`, `problems` for every kind; `l.modal` layers; `isFormField` also accepts the focus-mode textarea. |

**Fixed in rev 2 (was: found while building).** In `slice1.css` the rule `html.rm .studio .side { opacity: 0 }` applied to every layout, so with reduced motion the wide layout's plain side column (Problems, Test, History) was invisible but still reachable. The rule is now scoped to the `mid` and `phone` bottom sheet at its source, so slice 1, 2 and 3 are all right and the `lte.css` override was removed. Checked on `slice1.html`, `slice2.html` and `slice3.html` at 1280, 768 and 412 with reduced motion (the `MO-F09-*` checks).
