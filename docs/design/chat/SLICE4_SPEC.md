# Chat slice 4 — long chats

Status: **draft, revision 3** (2026-10-26; revisions 1 and 2 the same day). **Changelog, revision 3:** DD-087 (a hit that cannot be pinpointed outlines the message and says so), DD-088 ("at the bottom" = within 100 px, one constant); re-review items N-01 to N-08 (§18): link destinations not searchable, copied text without screen-reader labels, focus back in the message box, edge stops of real size, the hint at the bottom left. Task: [tasks/2026-10-25-chat-conversation.md](../tasks/2026-10-25-chat-conversation.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md) (§6 streaming: append-only, adaptive cadence, containment; reading-space targets), [SLICE2_SPEC.md](SLICE2_SPEC.md) (switching, scroll anchor per chat, cold load) and [SLICE3_SPEC.md](SLICE3_SPEC.md) (group speakers). Decisions: DD-066 (all four pain points), DD-067 (judged on Note 9 and Pi 3), DD-068 (bounded window), DD-069 (jump to latest, in-chat search, position scrubber, jump to start/date), DD-070 (lane A save note), DD-071 (append-only streaming default), and from the review: DD-072 (the long-chat line is a transient hint), DD-073 (closing search keeps the reading position), DD-074 (what search matches), DD-075 (a reply near the bottom shows jump to latest with a count), DD-076 (Ctrl+F from the message box), and from the re-review DD-087 (search hit that cannot be pinpointed) and DD-088 (how near the bottom counts as "at the bottom") in [DECISIONS.md](../DECISIONS.md). Source facts: [research/slice4-long-chats.md](research/slice4-long-chats.md) (cited R§n) and the campaign's `Agents/Reports/19-chat-list-window-plan.md` (Report 19, read-only reference). Independent review: [reviews/2026-10-26-chat-slice4-review.md](../reviews/2026-10-26-chat-slice4-review.md) (F-01 to F-37) and [re-review](../reviews/2026-10-26-chat-slice4-rereview.md) (N-01 to N-08); the summary by finding is §18.

Scope: how a long chat opens, scrolls, streams and is navigated; the message list's mounting model; search inside one chat; the position scrubber and jump sheet; low-power behaviour; a lane A section for costs the UI cannot fix. Out of scope: storage format (lane A, §10), sidebar list windowing (done in slice 2), Studio.

Marked **(design default)** = chosen here within the decided intent, open to the maintainer's veto. Numbers in desktop Chrome are indicative; acceptance is on the floor devices (§11).

## 0. Today (R§1–6)

| Area | Today |
|---|---|
| Window | Newest 30 mounted; +15 each time the top is reached; never shrinks until the chat changes. 600 mounted ≈ 21.6 k nodes, 62 MB, each +15 step 104–204 ms on an i9 (Report 19). |
| Jump | `scrollToMessage` mounts every message newer than the target, polls up to 5 s, waits up to 4 s for images. |
| Stream tick | Re-hashes every mounted message per chunk in the default mode (`off`); 124 ms/chunk at 600 mounted on an i9. |
| Open | Selecting a character rebuilds a save-tracker effect per message of every chat (~0.12–0.15 ms/msg, i9). |
| Send / save | Every send walks and tokenizes the whole history; every save serialises the whole character with all chats (R§1). |
| Navigation | No in-chat search; "jump to bottom" pill only when a reply arrives while scrolled back with a setting on. |
| Images | No lazy loading; per-message avatars are full-size CSS backgrounds. |
| Low power | No low-power handling in chat. |

## 1. Bounded message list (DD-068)

- **Mounted set:** the messages intersecting the viewport plus an overscan of **1.5 viewports above and 1 below**, capped at **100** mounted messages (design default; 60 under low power). Everything else is a **placeholder** of its last measured height. On a phone screen the overscan decides (14–26 mounted); the cap binds only on very tall screens or when a pinned set is large.
- **Height cache:** each message's rendered height is stored by message id + layout key (**width bucket, language, hide-names, root font size, theme**). Unmeasured messages use an estimate from their text length and kind (role, has image, code block, custom HTML) and the root font size, calibrated by the running average of measured ones. Estimates are replaced as messages mount; the correction is applied **above the anchor** so the reading position never moves (below). A change of font size or theme changes the key at once and the estimated length of the whole chat follows (F-03).
- **Scroll anchor:** the list keeps its own anchor — the topmost visible message id and its offset, **read from the message's real position in the DOM** (not from the height model, which lags behind a height change that has not been measured yet) — and restores it after every mount/unmount/correction. Native scroll anchoring is **switched off** (`overflow-anchor: none`) and not relied on (WebKitGTK support varies; slice 1 §12); `flex-col-reverse` is not used. A height change **below** the anchor (an image without a reserved size) moves the text under it and cannot be corrected: lane A must reserve every image's stored size (F-04).
- **Containment:** `content-visibility: auto` on every mounted message except the newest three, with `contain-intrinsic-size` from the height cache **as a fractional length** (a rounded size makes each skipped message up to 0.5 px wrong and the error adds up to several px).
- **Fast scroll:** a scroll faster than **2.2 px/ms** (design default, tuned per device) or a scrubber drag is "fast": nothing mounts until the scroll has been quiet for 110 ms; the blocks that enter the screen are placeholders showing **skeleton lines** (three static 11 px lines per 120 px, no shimmer; drawn with `forced-color-adjust: none` and `GrayText` in forced colours, so a placeholder of any height is filled, F-37). When the scroll settles, content fills top-down, a **budget of about 9 ms of mounting per frame** (adaptive from the measured mount cost, so a slow device mounts fewer per frame).
- **Pinned (never unmounted):** the streaming message, any message with an open editor, **a text selection (both end messages and everything between, up to the cap minus 24 messages; a longer selection keeps its two ends and says "선택이 너무 길어서 전부는 유지하지 못해요", F-01)**, the message holding focus, the newest message, a search hit being shown (and its tall-message alignment), and a jump target for about a second. Pinned messages outside the overscan count against the cap. The selection's end messages are remembered while it is not collapsed, because the browser moves a range whose nodes were removed to the container.
- **Rows that other features put into the list** (slice 1's Generate reply row, the inline undo row of a delete, a message that an undo re-inserts) stay where they are and are not part of the height model; a message inserted by another feature is adopted into the mounted set. A delete re-keys the mounted set by message id; search hits and the anchor follow the messages by id.
- **Copied text** never contains the screen-reader labels (the hidden position and status labels are `user-select: none`, N-03).
- **Ctrl+A** with focus in the transcript selects the messages **on screen** (message text is unselectable by default in slice 1; Ctrl+A makes it selectable for what is mounted until the selection ends), and says so: "화면에 있는 메시지 n개를 선택했어요. 전체는 “채팅 복사”로 복사해요." **"채팅 복사"** (header ⋮, under the chat's name) copies the whole chat's text (F-02).
- **Durable edit drafts are a prerequisite** (Report 19 sequencing): an editor's draft must survive unmount (lane A); until then editors pin their message.
- **Returning to the bottom** shrinks the mounted set back to the newest viewport + overscan (Report 19 A2).
- **Placeholder look:** an empty block of the cached height; skeleton lines only in fast scroll (above); content fills on the next idle frame, oldest-first within the viewport so text appears top-down.
- **Browser find (Ctrl+F) can't see unmounted text**, so Ctrl+F with focus in the chat **or in the message box** opens in-chat search (DD-076); Ctrl+F in any other text field (an editor, a name field) keeps the browser's find. Ctrl+G stays guarded in every text field.
- **Screen readers (F-27):** the list keeps `role="log"` semantics for new messages; each mounted message exposes its position ("메시지 1,240 / 5,800") in its accessible name and has `aria-posinset` / `aria-setsize`; placeholders are `aria-hidden`. At **both edges of every gap** the list places a **named, focusable stop** ("이전 메시지 12개 읽기" above the mounted block, "다음 메시지 12개 읽기" below it; `tabindex="-1"`, in the accessibility tree as a button). **The stop is a real-size element, not a 1 × 1 px one (N-06):** a full-width, 44 dp tall, transparent button over the edge of the gap, `pointer-events: none` (a tap goes through to the message), shown as a quiet bordered row only while focused. It occupies no layout (absolutely positioned). Focusing or activating it mounts the next 12 messages (pinned for a few seconds) and moves focus into the nearest one, so a swipe past the mounted range never dead-ends; keyboard users get the same from ArrowUp/ArrowDown on a message. The mechanism is built in the mockup and asserted against the browser's accessibility tree; **it is not proven with TalkBack, VoiceOver, NVDA or Orca** (acceptance, §11).
- **Very tall heights:** a list over about 16 million px loses float precision and over about 33 million px hits engine limits; chats near 100,000 messages need a compressed virtual height (lane A, F-05).

## 2. Opening a long chat

- The chat opens **at the newest message** (or the saved per-chat anchor from slice 2): the newest ~one screen renders first, then the overscan fills during idle time. The composer is usable as soon as the first screen renders.
- Heights for the rest come from the height cache (persisted per chat by lane A, design default) or estimates; nothing older is mounted.
- Cold-stored chats keep slice 2's cold-load skeleton (after 300 ms) and failure-with-retry.
- **Very long chats** (more than 2,000 messages, design default threshold) show, **once per chat**, a **transient one-line hint** over the top of the transcript: "긴 채팅이에요 · 메시지 5,800개" (DD-072, F-06). It sits **at the bottom left over the transcript, above the composer** (so it covers no sender name at the top of a message and leaves the jump button free, N-07), is not in the layout (the transcript is exactly as tall with and without it), has no buttons, is announced once, never pinned, and goes away on the reader's first scroll, after about 8 s, or when the search bar or a sheet opens. Search and jump stay reachable from the header ⋮ ("채팅에서 검색", "이동", "채팅 복사"), Ctrl+F / Ctrl+G and the scrubber.
- **Landing on a reply that finished in the background** (slice 2 opens at the start of that reply) in a long chat is a **long jump**: the "돌아가기" chip offers the position the reader left (F-07).
- Timings exclude the generation of a synthetic chat (a mock cost) and, in the mockup, include slice 2's cross-fade.

## 3. Scrolling back

- No load-more steps and no jumps: older messages appear in place as their placeholders enter the overscan.
- **Start of chat:** the first message carries a quiet "채팅의 시작" boundary above it (with the chat's created date).
- **Jump to latest** (DD-069, DD-075): a round 48 dp button (`arrow-down`) at the bottom-right above the composer. It appears when the reader is **more than one screen** from the newest message, **or as soon as a reply arrives while the reader is not "at the bottom"**. **"At the bottom" means within 100 px of the end (DD-088; one constant, `BOTTOM_PX`; measured before slice 1 removes the Generate reply row): a reply that starts within 100 px is followed (no button, no count); further up it shows the button and the count.** The count is cleared only when the reader is back within 100 px of the end, with a count badge ("새 메시지 3"; capped at "99+"). Tap = jump (instant under reduced motion/low power, otherwise a 260 ms scroll capped at 2 screens of animated travel, then a cut). Keyboard: End or Ctrl+End when focus is in the transcript. **It and the "돌아가기" chip sit after the transcript and before the composer in the tab order** (F-30). It replaces today's new-message pill and its two settings (lane A: keep the user's "always scroll to new message" preference as the default behaviour when at the bottom).
- **Only jump to latest animates** (§12); every other jump is a cut.
- Group chats (slice 3): the badge counts replies, not rounds.

## 4. Search in this chat (DD-069, DD-073, DD-074, DD-076)

- **Entry:** header ⋮ → "채팅에서 검색", Ctrl+F (focus in the chat or the message box), the jump sheet, and (before the hint is gone) nothing else: the hint has no buttons. Lucide `search`.
- **Bar:** replaces the header while open. **Row 1 (48 dp):** search icon, field, previous/next (`chevron-up`/`chevron-down`), filter (`sliders-horizontal`), close (`x`). **Row 2 (36 dp, shown once there is a query):** the match counter "3 / 27" on the left and an explicit **"모두 보기"** button (with a `list` icon; 44 dp target extending past the row) on the right (F-16). Enter = next, Shift+Enter = previous, Esc = clear then close, **Back (hardware, browser, mouse button) = close in one step**. **An IME's own Enter (`isComposing` / key code 229) is ignored** (F-09).
- **What is searched (DD-074):** the **stored message text**, normalised **the same way for the query and for the text**: known HTML tags removed (inline tags without a space, block tags as a space; anything else, such as `Array<string>` or `a < b and c > d`, stays as written), `<style>` blocks and image macros removed, markdown emphasis marks (`*`, `~~`, emphasis `_`), code-fence lines, inline-code marks, heading and quote markers removed (literal characters such as `snake_case` and `c#` stay), entities decoded, whitespace and newlines collapsed to one space, NFC, case-insensitive; thinking blocks excluded unless "생각 포함" is on. **Link syntax `[text](url)` and `![alt](url)` is reduced to its text; the address is not searchable (N-02).** **Macros and regex scripts are not expanded** (`{{user}}` is matched as written). Hangul and Latin; no 초성 matching for message text (design default; slice 2's 초성 applies to names only). Disabled/hidden messages are included and labelled "프롬프트에서 숨김".
- **Filters** (sheet): speaker (나 / character / each group member), has image, include thinking, date range (messages that carry `time`; **dates are local days**, the same days the messages are shown with, F-23). "필터 지우기" resets all and rescans.
- **Engine:** runs in slices of at most ~500 messages (250 in low power) **and about 8 ms** per idle slice (or a worker, lane A's choice), newest first, so the first hits arrive fast; the counter reads "27+" until complete and then "27". Changing the query, the filters or the language cancels the previous scan and restarts it (focus and the field's text are kept, F-18). **The first hit is shown (and announced) once the reader has paused typing, about 150 ms**, not on every keystroke (F-17). A 20,000-message chat finishes in the background without blocking typing or scrolling. The searchable text is cached in a side map capped at 3,000 entries, never on the message objects (F-20).
- **Showing a hit:** the list loads around the target (bounded window, §1), pins it, scrolls so that the **match** (not the top of the message) is in the upper third (a message that fits on screen keeps its top at the upper third), and highlights **every occurrence in that message across inline markup** (`mark` with a 2 px outline, not colour only; a match spanning `a **bold** word` is marked in each node, F-11). **When the match cannot be located in the rendered text** (the cleaned text and the shown text differ: line breaks other than `<br>`, entities, emphasis marks the renderer shows literally, tag text), **the whole message is outlined (2 px, like the mark) and a short notice says "일치한 부분이 이 메시지 안에 있어요" (DD-087, N-01)**; a hit is never found-but-invisible. Line breaks (`<br>`, block ends) count as a space when the rendered text is matched. A hit inside the collapsed "Thoughts" block **opens it while the hit is shown** and closes it again afterwards (F-12). A message several screens tall is handled by the match alignment (F-13).
- **Closing (DD-073):** Esc (second press), the close button or Back **keeps the reader where they are**. If search moved the reader more than 50 messages from where they were, the "돌아가기" chip offers the position from before the search (announced, §6). Focus returns to **the message box if the search was opened from it (N-04)**, else to the message it came from if that message is mounted, else to the header menu button.
- **Results list:** "모두 보기" opens a sheet of hits: speaker avatar + name, date, a 2-line snippet with the match marked, newest first; windowed like the slice 2 sidebar. Tap = show that hit and close the sheet.
- **No results:** an **opaque** panel below the bar: "검색 결과가 없어요" with the filter summary and "필터 지우기".

## 5. Position scrubber (DD-069)

- A thin track (4 dp visual) on the right side of the transcript appears while **the reader scrolls (wheel, touch, keys, scrollbar — not a programmatic jump)** and for 1.5 s after, and on hover with a mouse within about 120 px of the right edge. Its thumb's position = position in the chat by message index (not pixels, so estimates don't distort it).
- **Grab target:** the thumb is a 44 × 56 dp pill **inset 28 dp from the screen edge** so it never sits in Android's back-gesture strip or slice 1's edge zones (design default; device check on Android 10 gesture navigation, slice 1 §12). Only the thumb starts a drag; the track itself is not a touch target on touch screens. **A quick tap on the thumb passes through to whatever is under it** (a message's action button); a drag starts after 6 px of movement or a 260 ms hold (F-21).
- **While dragging:** a bubble beside the thumb shows "1,240 / 5,800" and the message date if known; the list shows placeholders + skeletons and fills on release (no mounting while dragging). Haptic tick on each 10 % mark crossed, Android only (DD-024 C-1).
- **Keyboard and screen readers:** the scrubber is not a separate tab stop (design default); the jump sheet (§6) offers the same moves. For mouse users the track is also clickable (page-jump by 0.9 screen towards the click) and the thumb can be dragged.
- Hidden while any sheet (including the search results sheet) is open.

## 6. Jump sheet (DD-069)

Entry: header ⋮ → "이동", Ctrl+G (focus in the chat, not in a text field; design default).

- **처음으로** (first message), **최신으로** (newest), **채팅에서 검색**, **날짜로** (date picker, **local days**; jumps to the first message on or after that day; messages without `time` are skipped and the sheet says "날짜 정보가 없는 메시지는 건너뛰어요" when the chat has any; a day after the last message is refused with a toast), **메시지 번호로** (number field, whole numbers 1–N; anything else is refused with "1부터 20,000 사이의 번호를 입력하세요", F-24), **북마크** (the chat's bookmarks; the heading shows the real count; the list shows the first 60 and says so, F-25).
- Each jump uses the bounded-window load (§1) and puts the target in the upper third; focus moves into the target message. The previous position is kept and the **"돌아가기" chip** appears after a long jump (more than 50 messages), after closing a search that moved the reader (§4) and after landing on a background-finished reply (§2).
- **The chip (F-26):** announced ("이동했어요. “돌아가기”로 이전 위치로 돌아갈 수 있어요."), stays until the reader scrolls on, 15 s have passed, or a tap returns (longer while hovered or focused), sits after the transcript in the tab order. One return point: the origin of the latest long jump.

## 7. Typing and streaming as chats grow (DD-071)

- **Streaming:** slice 1 §6 append-only rendering with adaptive cadence (100/250/500 ms by device and low power) is the only mode; `streamingDisplayOptimizationMode` and its setting are removed. **A stream tick touches only the streaming message** (CHORE-155): no window re-hash, no re-parse, no DOM mutation anywhere else (asserted over a whole reply).
- **Stream start and end** may refresh the controls of the messages **near the screen and the newest three** (the new-reply arrow, the position name); every other mounted message is marked stale and refreshed when it comes within 300 px of the screen (F-33). With 100 mounted, a start-to-end stream touches a few hundred DOM nodes, not several thousand.
- **Typing:** the composer's state is isolated from the transcript — keystrokes never trigger list work. The draft save is debounced and does not trigger a character save (lane A).
- A reply that streams while the reader is scrolled back never moves the reading position; the streaming message is pinned.

## 8. Images and heavy content

- Inline images: `loading="lazy"`, `decoding="async"`, width/height reserved from the image's stored size (or the height cache) so they don't shift the list (**a lane A requirement: the list cannot correct a shift below the anchor, F-04**).
- Message avatars: the thumbnail path (`getCharImage(..., 'thumb')`, as the sidebar rail does) at 2× the displayed size, as `<img>` not CSS background.
- Animated avatars and images: play only while on screen; under low power and reduced motion they show the first frame (not built in the mockup: no animated assets).
- Messages with custom HTML/CSS (slice 1 tokenizer chips) count as "heavy" in the height estimator.

## 9. Low power and the floor devices

Low power (DD-024 C-5 family; device class or the user's setting): cap 60 mounted, overscan 1 viewport each way, skeletons static, no animated jump scroll, avatars static, search slice 250 messages, cadence 500 ms. The Pi 3 runs low power by default (design default; **needs a device class from lane A**, the mockup has only the toggle).

## 10. Lane A: costs the UI cannot fix (DD-070)

Recommendations with targets; storage design is lane A's.

| Cost (R§1) | Recommendation | Target on Note 9 / Pi 3 |
|---|---|---|
| Whole-character JSON per save (`risuSave.ts:601`) | Save per chat (and per message append where possible); backups incremental | A save after a reply in a 5,000-message chat ≤ 100 ms / 250 ms of main-thread work |
| Save tracker per message on select (`dbChangeEffects.svelte.ts:287-379`) | Track per chat, not per message; lazy for chats not open | Selecting a character with 20,000 total messages ≤ 150 ms / 400 ms |
| Whole history walked and tokenized per send (`index.svelte.ts:1359-1509`); `console.log(JSON.stringify(chats))` at `:1510`; tokenizer/script caches smaller than long chats | Trim before processing (walk back only to the context budget); drop the debug log; cache by message id + content hash with capacity ≥ the trimmed span | Prompt assembly for a 5,000-message chat ≤ 300 ms / 800 ms |
| Durable edit drafts (Report 19) | Store drafts outside the mounted component | Prerequisite for §1 unmounting |
| Height cache | Persist per chat (small: id → height per layout key) | Opening at the anchor without visible correction |
| Images without a stored size | Reserve width/height from stored metadata for every inline image and avatar | No visible shift below the anchor |
| Search text | Search the stored text as in §4 (cheap); do **not** run the display pipeline per message | Full scan of 20,000 messages ≤ 3 s / 8 s |
| Chats beyond ~100,000 messages | Compress the virtual height | No precision loss |
| Dismissal of the long-chat hint, open anchor, edit drafts | Persist per chat | — |

## 11. Acceptance (DD-067; lane A measures on the devices)

With synthetic chats of 1,000 / 5,000 / 20,000 messages (mixed lengths, 5 % with images, some custom HTML), Note 9 (Android 10 WebView) and Pi 3 (WebKitGTK, low power):

- **Open:** newest message readable and the composer usable ≤ 1.0 s (Note 9) / 2.0 s (Pi 3) after the chat is selected, excluding cold-storage load and (in a mockup) chat generation.
- **Mounted cap:** never more than 100 (60 low power) messages mounted, including after scrolling to the first message and back; memory returns to within 10 % of the open state after returning to the bottom. A phone screen mounts 14–26; to test the full cap use a pinned set or a forced window (`?minmount=100` in the mockup).
- **Scroll back:** a continuous fling through 20 screens has no long task over 50 ms (Note 9) / 100 ms (Pi 3) from list work, and the reading position never jumps (visible text moves ≤ 2 px after corrections). **State the scroll pace** (screens per second): brisk steady scrolling is not a fling, and a fling above the "fast" threshold shows placeholders until it settles.
- **Streaming:** with 100 mounted messages, a 7.5 k-character reply streams with no long task over 50 ms **from start to end, including the start and end of the stream** (slice 1 §6, unchanged by chat length); input latency while streaming ≤ 100 ms; DOM mutations outside the streaming message limited to §7.
- **Search:** first hit in a 20,000-message chat ≤ 300 ms / 600 ms **after the typing pause**; full scan ≤ 3 s / 8 s in the background with typing and scrolling responsive.
- **Jumps:** to any message (search hit, start, date, number) ≤ 500 ms / 1.0 s to the target readable.
- **Screen readers:** reading a 5,000-message chat upwards with TalkBack (Android WebView) and Orca (WebKitGTK) reaches older messages through the edge stops (§1) without a dead end; not yet verified.
- **Known misses in the mockup at 4× (N-05, disclosed, not a pass):** one long task of about 100 to 130 ms at the start of a stream, 60 to 80 ms at its end and about 120 ms while typing on 20,000 messages; lane A measures these on the devices.
- **A desktop CPU throttle (for example 4×) is a smoke test, not a proxy** for either floor device: it is probably kinder than a Note 9 and far kinder than a Pi 3, and a mockup that fills a message with `innerHTML` (0.4 to 1.5 ms) is far cheaper than the app (1.6 to 7.5 ms per message on an i9, Report 19).

## 12. Motion

Tokens from slice 1. Jump-to-latest button: fade + translateY 8 dp, 120 ms. Jump scroll: 260 ms ease-out, capped travel (above), instant under reduced motion/low power. Scrubber: opacity 120 ms; no width animation. Long-chat hint and "돌아가기" chip: fade 120 ms (none under reduced motion). Search highlight: none (static outline). Skeleton lines: static. Only transform and opacity animate.

## 13. Korean copy (keys, en / ko)

| Key | en | ko |
|---|---|---|
| longChatLine | Long chat · {n} messages | 긴 채팅이에요 · 메시지 {n}개 |
| chatStart | Start of chat · {date} | 채팅의 시작 · {date} |
| jumpLatest | Jump to latest | 최신 메시지로 |
| newCount | {n} new | 새 메시지 {n} |
| searchInChat | Search in chat | 채팅에서 검색 |
| searchPlaceholder | Search this chat | 이 채팅에서 검색 |
| matchCounter / matchCounterPartial | {i} / {n} / {i} / {n}+ | {i} / {n} / {i} / {n}+ |
| searchPrev / searchNext | Previous match / Next match | 이전 결과 / 다음 결과 |
| searchFilters | Filters | 필터 |
| searchAll | See all | 모두 보기 |
| includeThinking | Include thinking | 생각 포함 |
| filterSpeaker / filterHasImage / filterDate | Speaker / Has image / Date | 말한 사람 / 이미지 있음 / 날짜 |
| noResults | No messages found | 검색 결과가 없어요 |
| clearFilters | Clear filters | 필터 지우기 |
| hiddenLabel | Hidden from the prompt | 프롬프트에서 숨김 |
| jumpSheet | Go to | 이동 |
| jumpFirst / jumpNewest | First message / Newest message | 처음으로 / 최신으로 |
| jumpDate / jumpNumber | Go to date / Go to message number | 날짜로 / 메시지 번호로 |
| noTimeSkipped | Messages without a date are skipped | 날짜 정보가 없는 메시지는 건너뛰어요 |
| goBack | Go back | 돌아가기 |
| position | Message {i} of {n} | 메시지 {i} / {n} |
| scrubberBubble | {i} / {n} · {date} | {i} / {n} · {date} |
| **new in revision 2** | | |
| jumpedBack | Moved. “Go back” returns to where you were. | 이동했어요. “돌아가기”로 이전 위치로 돌아갈 수 있어요. |
| readEarlier / readLater | Read {n} earlier messages / Read {n} later messages | 이전 메시지 {n}개 읽기 / 다음 메시지 {n}개 읽기 |
| numberError | Enter a number from 1 to {n} | 1부터 {n} 사이의 번호를 입력하세요 |
| bookmarksFirst | Showing the first {n} | 처음 {n}개만 보여요 |
| copyChat / copiedChat | Copy chat / Copied {n} characters (simulated) | 채팅 복사 / {n}자를 복사했어요 (시뮬레이션) |
| selectedVisible | Selected the {n} messages on screen. “Copy chat” copies all. | 화면에 있는 메시지 {n}개를 선택했어요. 전체는 “채팅 복사”로 복사해요. |
| selectionTrim | The selection is too long to keep in full | 선택이 너무 길어서 전부는 유지하지 못해요 |
| editorCancel / editorDone | Cancel / Done | 취소 / 완료 |
| discardDraft / discardYes / keepEditing | Discard what you wrote? / Discard / Keep editing | 작성한 내용을 버릴까요? / 버리기 / 계속 편집 |
| draftKept | Draft kept | 작성 내용은 그대로 두었어요 |
| matchInside | The match is inside this message | 일치한 부분이 이 메시지 안에 있어요 |

The mockup also uses keys for its own search bar and demo panel (`search`, `go`, `bookmarks`, `noBookmarks`, `closeSearch`, `matchLabel`, `matchLabelPartial`, `speakerMe`/`speakerChar`/`speakerAny`, `from`, `to`, `dismiss`, `noDate`, `navGroup`, the `r*` readout labels and notes, the `d*` demo labels); they are in `S4I` in `slice4.js`.

## 14. States the mockup must show

Synthetic chats of 1,000 / 5,000 / 20,000 messages (generated client-side, mixed lengths, images, code, custom-HTML chips, a group chat). Open at newest; open at a saved anchor; **the long-chat hint (and its absence after the first scroll)**; fling to the start with placeholders/skeletons and the "채팅의 시작" boundary; mounted-count readout (demo panel) staying ≤ 100 / 60; jump-to-latest without and with new-reply count (also near the bottom); search: typing, partial counter, stepping, highlight across markup, tall message, results sheet, filters, no results, Esc keeping the position and the "돌아가기" chip; scrubber idle/visible/dragging with bubble, and a tap through the thumb; jump sheet: first, newest, search, date (with skipped note), number (with error), bookmarks, "돌아가기" chip; edit open on an old message then scrolling far away (pinned), Esc keeping the draft, Cancel with its question; a selection across messages surviving a far scroll; Ctrl+A and "채팅 복사"; screen-reader edge stops; delete and undo in the middle of a long chat; streaming while scrolled back (badge); low power; reduced motion; narrow 360×740 / 412×915 / wide 1280×800; KO and EN; keyboard only; forced colours. Demo panel: mounted / cap, nodes, last long task (with its age), slowest list pass, text moved after correction, layout shift seen, and the mock's own mount cost, each with its caveat.

## 15. Integration map (lane A; nothing here edits these files)

| App file | Change |
|---|---|
| `src/lib/ChatScreens/Chats.svelte:64-255` | Bounded window with height cache, own anchor, pinned set (selection range, focus, editors), placeholders, edge stops; remove per-tick window re-hash; jump-to-latest replaces the pill; `overflow-anchor: none` |
| `src/lib/ChatScreens/DefaultChatScreen.svelte:277-339, 439-493, 562-567` | `scrollToMessage` loads around the target; no load-more step; screenshot pages through the window (or warns above a size) |
| `src/ts/chatLoadPages.ts`, `chatWindowPolicy.ts`, `advancedSettingsData.ts:98,102,148` | Retire load-pages settings and the streaming mode setting (DD-071) |
| `src/lib/ChatScreens/Chat.svelte:1365-1399`, `ts/characters.ts:96-134` | Thumbnail avatars as `<img>`; reserved image sizes |
| `src/ts/parser/parser.svelte.ts:544,594,610,721` | Lazy/async images with reserved size |
| New in-chat search + jump sheet + scrubber + hint + "채팅 복사" | §3–6 |
| `src/ts/storage/*`, `ts/process/index.svelte.ts` | §10 recommendations |
| `src/lang/*.ts` | Keys in §13 |

## 16. Open questions

- **O-1** Persisting the height cache: where (chat metadata vs a side store) — lane A.
- **O-2** Search inside cold-stored *other* chats is out of scope; is a cross-chat search wanted later?
- **O-3** Full-chat screenshot of a 20,000-message chat: page through, cap, or warn (today it loads everything).
- **O-4** Report 19's maintainer-approved stage order (durable drafts before windowing) stays; lane A confirms.
- **O-5** Screen-reader edge stops (§1) must be verified on TalkBack (Android WebView) and Orca/VoiceOver before §1 is accepted.
- **O-6** Search cost with the real display pipeline: DD-074 searches stored text; if the maintainer later wants rendered text, lane A needs per-message cost data first.

Closed by the maintainer after the review: the long-chat line (DD-072), what Esc does after reading around a hit (DD-073), what search matches (DD-074), a reply near the bottom (DD-075), Ctrl+F from the message box (DD-076). Editor Esc/Back keeps the draft per DD-048 (review Q6, recommended option, applied).

## 17. Design defaults to confirm

Overscan 1.5/1 viewports and caps 100/60; fast-scroll threshold 2.2 px/ms, 110 ms quiet, about 9 ms mount budget; Ctrl+G for the jump sheet; hint threshold 2,000 messages and 8 s; no 초성 in message search; thinking excluded by default; first hit after a 150 ms typing pause; scrubber not a tab stop; Pi 3 low power by default; "돌아가기" chip after jumps over 50 messages, kept 15 s or until the next scroll; jump scroll travel capped at 2 screens; selection pin room = cap − 24; edge stops of 12 messages (44 dp full-width); "at the bottom" 100 px (DD-088); hint at the bottom left.

## 18. Revision 2: review findings and where they are handled

Review: [reviews/2026-10-26-chat-slice4-review.md](../reviews/2026-10-26-chat-slice4-review.md) (0 blocker, 12 major, 17 minor, 6 polish). "Not changed" items give the reason; the mockup's assertions are in `checks/s4/review.mjs` (ids `S4R-F..`) and are listed in `checks/builder-checks.md` "Slice 4 — review fixes".

| Finding | Sev | Resolution | Spec |
|---|---|---|---|
| F-01 selection lost on a far scroll | major | Both end messages and everything between pinned (remembered while the selection is not collapsed); too long = ends + a message | §1 |
| F-02 Ctrl+A partial | minor | Ctrl+A selects what is on screen and says so; "채팅 복사" copies all | §1 |
| F-03 layout key lacks font size/theme | minor | Key and estimator include root font size and theme | §1 |
| F-04 growth below the anchor | minor | Lane A reserves image sizes; the demo readout reports the layout shift it cannot correct | §1, §8, §10 |
| F-05 not tested (late images, >20k, height limits) | polish | Lane A acceptance and compressed virtual height; not tested here | §1, §10 |
| F-06 long-chat line pinned band | major | **DD-072**: transient one-line hint, no layout | §2 |
| F-07 background landing not a long jump | minor | Landing offers "돌아가기" | §2, §6 |
| F-08 start boundary OK | polish | No change | — |
| F-09 IME Enter steps to next | major | Ignored while composing | §4 |
| F-10 query and text normalised differently | major | **DD-074**: one normalisation for both; literal characters kept; no macro expansion | §4 |
| F-11 highlight across markup missing | major | Highlight by text offsets across nodes | §4 |
| F-12 hit inside collapsed thinking | minor | The block opens while the hit is shown | §4 |
| F-13 tall message hit off screen | major | The match is aligned, not the message top | §4 |
| F-14 Esc always returns | minor | **DD-073**: stay and offer "돌아가기" | §4, §6 |
| F-15 Ctrl+F from the composer | minor | **DD-076**: opens in-chat search; other fields keep browser find | §1, §4 |
| F-16 bar too tight at 360 | minor | Two rows: field row and counter + "모두 보기" row | §4 |
| F-17 first chunk blocks, keystroke jumps | minor | 8 ms slices; first hit after a 150 ms typing pause | §4 |
| F-18 language switch with search open | minor | Rescan and keep focus | §4 |
| F-19 translucent no-results panel | minor | Opaque, below the bar | §4 |
| F-20 text cache on message objects | polish | Capped side map | §4, §10 |
| F-21 thumb swallows taps | minor | Tap passes through; drag after 6 px or a hold | §5 |
| F-22 thumb discovery, fine drag | polish | **Not changed**: optional coach mark / fine mode left to the maintainer; no evidence yet that it is needed | — |
| F-23 UTC date jump | major | Local days for the jump and the date filter | §4, §6 |
| F-24 number field error | minor | Whole numbers only, plain error text | §6 |
| F-25 bookmarks silently cut at 60 | polish | Says "처음 60개만 보여요" | §6 |
| F-26 chip not announced, timed, last in tab order | minor | Announced, until scroll or 15 s, after the transcript | §3, §6 |
| F-27 screen-reader reading past the mounted range | major (unproven) | Named, focusable edge stops that mount and focus; asserted in the accessibility tree; **device verification still open (O-5)** | §1 |
| F-28 silent replies near the bottom | major | **DD-075**: count whenever not at the bottom; cleared only at the bottom | §3 |
| F-29 uncapped badge | polish | "99+" | §3 |
| F-30 button after the composer in tab order | polish | Moved after the transcript | §3 |
| F-32 Esc in the editor discards | major | Esc/Back keep the draft and leave the box (DD-048); "취소" asks before discarding | §1 (drafts), mockup |
| F-33 stream start/end long task and mutations | major | Near-screen refresh, others stale until close; bars restated to include start/end; mutations asserted | §7, §11 |
| F-34 mock under-represents cost | major | Disclaimers in the readout and the timings file; throttle called a smoke test | §11, timings file |
| F-35 readouts misleading | minor | Layout shift vs residual text movement from the DOM; last long task with age; slowest pass; mock cost; cap note | §14, §11 |
| F-36 platform limits unmeasured | minor | Unchanged (lane A / device work) | §9, §10 |
| F-37 blank skeleton in forced colours | minor | Same repeating lines in `GrayText` with `forced-color-adjust: none` | §1 |
| **Re-review (N-01 to N-08)** | | | |
| N-01 hit not highlightable | minor | **DD-087**: `<br>` counts as a space; when no range can be found the message is outlined and the note is shown | §4 |
| N-02 link destinations searchable | minor | `[text](url)` / `![alt](url)` reduced to the text in the shared normalisation | §4 |
| N-03 copied text has screen-reader labels | minor | Hidden labels are `user-select: none` | §1 |
| N-04 focus after a search from the message box | minor | Focus returns to the box | §4 |
| N-05 4x residuals (typing, stream start/end) | minor | **Disclosure only**: the timings file and §11 state that the mock's numbers do not pass the 50 ms bar at 4x and are a smoke test; lane A measures | §11 |
| N-06 edge stops 1 × 1 px | minor | Full-width 44 dp transparent, pointer-transparent buttons; F-27 stays **not accepted** until a TalkBack / Orca pass (O-5) | §1 |
| N-07 hint covers a sender name | polish | Bottom left above the composer | §2 |
| N-08 undocumented bottom tolerance | polish | **DD-088**: 100 px, one constant | §3 |
| Runner hole (s2, s3) | minor | One OS reduced-motion canary assertion each (`reduce` named explicitly) | checks |
