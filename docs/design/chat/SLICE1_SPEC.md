# Chat slice 1 — phone chat shell and gesture/motion system

Status: **revision 2.1, accepted with minor notes** (2026-10-25; re-review [reviews/2026-10-25-chat-slice1-rereview.md](../reviews/2026-10-25-chat-slice1-rereview.md), its notes applied in §12). Task: [tasks/2026-10-25-chat-conversation.md](../tasks/2026-10-25-chat-conversation.md). Decisions: DD-011 to DD-033 in [DECISIONS.md](../DECISIONS.md). Source facts: [research/gestures-actions-streaming.md](research/gestures-actions-streaming.md), [research/layout-perf-navigation.md](research/layout-perf-navigation.md), checked in [reviews/2026-10-25-chat-research-check.md](../reviews/2026-10-25-chat-research-check.md). Review of revision 1: [reviews/2026-10-25-chat-slice1-review.md](../reviews/2026-10-25-chat-slice1-review.md); every finding is answered in §11. Mockup: [slice1.html](slice1.html).

Scope (DD-013): the RP chat screen, designed phone-first (360–412 px) but for every platform and input (DD-017, [PLATFORMS.md](../PLATFORMS.md)): Windows, Windows on ARM (planned), Linux x86/ARM, Android, web host; touch, mouse/trackpad and keyboard, often mixed on one device.

**Input rule for this slice:** width decides layout; the input in use decides interaction. Gestures key on `pointerType === 'touch'` (or `pen`), hover rows on `(hover: hover)` and a recent mouse pointer, and every action also has a click path and a keyboard path. "Phone" here means the narrow layout and "desktop" the wide layout, not a platform. Out of scope: chat switching and the "This chat" sheet (slice 2), group speaker identity (slice 3), list virtualization (slice 4). Modes (RP/Hybrid/Utility) are not touched.

No open decisions remain in this slice (§9). Marked **(design default)** = chosen by the design session within the decided intent, open to the maintainer's veto.

## 0. Today, in one table (source-checked)

| Area | Today | Source |
|---|---|---|
| Phone chrome | No header; floating 3rem arrow opens the sidebar. Composer is the first child of a `flex-col-reverse` scroller, sticky only with `fixedChatTextarea`. Attachments, suggestions, translate box, plugin panels stack above it. | layout note §1 |
| Keyboard | WebView shrinks above the IME (ADJUST_RESIZE); no caret/scroll-into-view handling in the chat. | `MainActivity.kt:84-106` |
| "Swipe" reroll | Arrow buttons on the newest message only (also on a user-last message). Right arrow: stored candidates → reroll history → **starts a new generation silently**. No transition. Counter only for first-message alternatives and only with `showFirstMessagePages` (default off). With the `swipe` setting off, a single refresh icon instead of arrows. | `composerActions.svelte.ts:442-494`, `Chat.svelte:1260-1273`, `database.svelte.ts:241-242` |
| Sidebar gesture | Trigger-only: a 32 px edge strip after the OS back inset (left only), fires at 40 px or a 0.4 px/ms fling, then a width + background keyframe animation (0.4 s). The panel never follows the finger. | `src/lib/SideBars/panelGesture.ts`, `panelGestureBinding.ts:10-13`, `Sidebar.svelte:375-496` |
| Message actions | Always rendered icons (20–24 px, no padding, no aria-label). Below 640 px copy/TTS/delete sit in a "…" popup. Delete: Shift-click deletes this and all later with no confirm; plain click confirms only with `askRemoval`; 500 ms long-press → 3-choice prompt. Hotkeys click `.button-icon-reroll` etc. on the newest message, with an `e.repeat` guard. | `Chat.svelte:258-293, 1152-1363`, `hotkey.ts:73, 142-148` |
| Streaming | Every chunk remounts the message and re-runs the full display pipeline. Unfinished thinking text shows as plain prose; partial `{{img::…` shows raw; an unclosed `<style>` is hidden but may apply its partial CSS. CSS leaks the maintainer sees are in code/markdown (DD-016). Trigger scripts run at the end. | gestures note §4, check (d) |
| Composer | One `text-xl` textarea, unlimited growth; send and stop share a button; ~12 actions in an unlabelled popover; Enter guard only `!e.isComposing`; translated input unguarded; persona switch not in the chat. Send starts the reply. | layout note §4, `DefaultChatScreen.svelte:593` |
| Motion | One knob, `--risu-animation-speed`; reduced motion honoured in two places; no low-power path in the chat. | gestures note §5 |

## 1. Layout (phone)

```
┌──────────────────────────────────────────┐
│ [☰] (◉) Seraphina           [⋮]          │  header 48 dp, hides while reading (C-3)
├──────────────────────────────────────────┤
│ (◉) Seraphina            [✎] [🗑] [⋯]    │  meta row: name + pinned buttons (DD-019)
│ Reply text …                             │
│ ‹ 2 / 5 ›                    [⟳ 새 답변] │  alternatives row, newest reply only (DD-020)
│                                          │
│ ▏Juno                    [✎] [🗑] [⋯]    │
│ ▏User turn as prose, full width …        │
├──────────────────────────────────────────┤
│ [chips: 📎 image.png ✕ | suggestion …]   │  only when present, one row, scrolls sideways
│ [+] [ Juno로 ▾ ] [ Message…        ][➤]  │  composer, docked
└──────────────────────────────────────────┘
```

- **Header (48 dp):** sidebar button (Lucide `panel-left`), avatar 28 dp + character name (one line, ellipsis), overflow `ellipsis-vertical` (the slice-2 "This chat" sheet; a placeholder here).
- **Header hiding (C-3, DD-024), narrow layout only:** hides after 24 dp of scrolling toward older messages; returns on any scroll toward newer, when a reply finishes, when focus enters it (`:focus-within`), or when keyboard navigation starts. It is never hidden in the wide layout, nor while a hardware keyboard has been used since the last touch (§7.2). Hidden means translated away and then `visibility: hidden` after the transition; never `inert`, so it can always take focus back. Reduced motion: fades.
- **Composer, docked** at the bottom always. Row: `+` (44×44, §5.4), persona chip, textarea, Send/Stop.
- **Extras strip:** attachments, suggestions and the translate preview in one sideways-scrolling chip row above the composer, only when non-empty. Chips are 44 dp tall hit areas (visual 32); a chip's remove `✕` has a 44×44 hit area around a 20 px glyph. Plugin panels go into the `+` sheet.
- **Reading-space targets** (acceptance): at 360×740 without keyboard the transcript gets ≥ 70 % of the height (header shown) and ≥ 78 % hidden; with a 300 px keyboard ≥ 35 % of the full height with a one- or two-line draft. Revision 1 measured 85 % and 45 % (review).
- **Keyboard:** when the textarea gains focus and the viewport shrinks, keep the newest message's bottom edge in view if the user was at the bottom. The textarea grows to 5 lines, then scrolls; with the keyboard up its max is 30 % of the remaining height.
- **Wide layout (≥ 900 px):** header always shown; sidebar docked. Pinned buttons stay; the hover/focus row (§5.3) adds the rest. On a touch-only wide screen `⋯` and long-press are the paths.
- **Edge zones (both sides, design default):** a gesture that starts within 24 dp of either screen edge (or the host inset, `__risuTaniumGestureInset`, mirrored to the right when the host gives only the left) belongs to the system Back gesture or to the sidebar (left, §4); it never starts a message swipe and never arms. Zones are **not overlays**: the decision is made in a document-level `pointerdown` from the start x; nothing is laid over content, no element gets `touch-action: none`, and controls inside the zone (the `+` button, header buttons) take taps and scrolls as normal (fixes P1-1).

### 1.1 Message presentation: prose, not bubbles (DD-018)

- Every message is a **full-width, left-aligned prose block** with the same text width (max 72 ch on wide layouts). No bubble backgrounds, no right-aligned user side.
- A slim **meta row** above each turn: avatar 24 dp, name, then the **pinned action buttons** and `⋯` at the right (§5.1). Consecutive turns by the same speaker drop the meta row; there the pinned buttons and `⋯` float as a cluster at the block's top-right (the block gets right padding for it), shown on hover/focus with a mouse and always with touch.
- The **alternatives row** sits under the newest character reply only (§3.1).
- **User turns** get a 2 px left rule in `--nexus-edge-strong` and the persona name in secondary text; character names use `--nexus-warm` (people only). Nothing else differs, so a novel reads as one text.
- Turn spacing 20 dp; paragraph spacing 0.75 em.
- **Hide names and avatars (C-6, DD-024):** a per-chat reading mode, default off, switched in the slice-2 "This chat" sheet (a demo toggle in the mockup). Names, avatars and meta rows go; spacing and the user rule remain; pinned buttons and `⋯` move to the floating cluster; the alternatives row stays.
- Each message is an `article` with `aria-labelledby` pointing at its name (and, in hide-names mode, a visually hidden name), not an `aria-label` that could replace its content.

## 2. Motion system

Tokens (extend `theme/nexus-tokens.css`; all multiplied by the existing `--risu-animation-speed`, default 1):

| Token | Value | Use |
|---|---|---|
| `--chat-dur-fast` | 120 ms | press feedback, chip state, crossfades under reduced motion |
| `--chat-dur-base` | 200 ms | message enter, sheet open, header show/hide, undo row |
| `--chat-dur-slow` | 260 ms | snap-back, commit slide |
| `--chat-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | everything that lands |
| `--chat-ease-spring` | `cubic-bezier(0.34, 1.3, 0.64, 1)` | snap-back only; `--chat-ease-out` under reduced motion |

1. **Only `transform` and `opacity` animate.** No width, height or colour keyframes on large surfaces.
2. **Direct manipulation is not decoration.** Under reduced motion things still follow the finger; only automatic travel after release becomes a 120 ms crossfade or an instant move.
3. **Press feedback everywhere:** 120 ms scale 0.96 + tint on `:active`.
4. **Low power** (the app's single switch): no neighbour peeks, no shimmer, no spring, no infinite spinners (a static "in progress" glyph instead, including the Stop ring), transitions ≤ 120 ms; gestures still follow the finger.
5. **Haptics (C-1, DD-024):** a 10 ms tick (`navigator.vibrate`) at swipe commit and at the arm point, for touch gestures only, where the platform supports it (Android); an off switch in Settings. Never on scroll. No control where unsupported.
6. **No `backdrop-filter`** in the chat on any layout (dim only); full-screen blur is a likely cost on Pi 3 software compositing.

## 3. Swipe through alternatives (DD-014, DD-020, DD-021, DD-027)

Applies to the **newest character message**. A user-last chat with nothing generating shows a "답변 생성" (Generate reply) button under the last message; no swipe there.

The **first message** (첫 메시지) with alternatives: the alternatives row reads "첫 메시지 2 / 3" and browses with buttons, swipe, wheel and keys; there is no "새 답변" and no arming on it (design default; lane A to confirm today's reroll on a first message).

### 3.1 The alternatives row (DD-020)

- Shown under the newest character reply when it has more than one alternative, or always on the newest reply when it can be regenerated: `‹  2 / 5  ›` at the left (44 dp targets), a labelled **"⟳ 새 답변" (New reply)** button at the right, separated by the row's free space (never less than 24 dp, also at 320 px).
- `‹ ›` only browse. `›` is **disabled at N/N** (and `‹` at 1/N), with `aria-disabled` and a tooltip "마지막 답변" / "첫 번째 답변"; nothing moves into its place.
- "새 답변" ignores activation for 500 ms after the page changed or after the pointer arrived from a `‹ ›` press, so a double-tap on the pager never lands on it.
- The current position is in the group's accessible name ("답변 5개 중 3번째"), and changes are announced with `aria-live="polite"`. The visible "3 / 5" stays (C-2, design default).
- With today's `swipe` setting off (DD-027): the same row and button; only the gesture (§3.2) is off.

### 3.2 The gesture

| Phase | Behaviour |
|---|---|
| Start | Horizontal pan on the message body, touch or pen. Slop 10 px; axis lock when \|dx\| > 1.5·\|dy\|, otherwise vertical scroll wins. Ignored when it starts in an edge zone (§1), inside a child that actually scrolls sideways (`scrollWidth > clientWidth`), or after a long-press began (§5.2). |
| Drag | The block moves 1:1 up to 40 % of its width, then with resistance (0.35×). The neighbour alternative peeks in (first two lines, 60 % opacity) with a "3 / 5" chip. |
| Commit | Release beyond 30 % of the width, or a fling > 0.5 px/ms that way → slide out (`--chat-dur-slow`), neighbour settles, counter updates, haptic tick. |
| Cancel | Otherwise → spring back. |
| At 1 / N, swiping right | Resistance from the start, chip "첫 번째 답변", no commit. |
| **Past the last** (N / N, swiping left; DD-021, DD-033) | Like pull-to-refresh, sideways. Resistance from the start, and a **fill meter** (a ring beside the message's trailing edge, `refresh-cw` inside) with the chip "저장된 답변 없음" (No more saved replies). The meter fills with the pull: 0 → 70 % as the finger travels to **160 dp** past the start, then 70 → 100 % while the finger is **held** there for **300 ms** at a speed under 0.15 px/ms. Full = **armed**: the ring turns accent, the chip reads "놓으면 새 답변 생성" (Let go to generate a new reply), haptic tick. **Sliding back** toward the centre drains the meter and, inside 160 dp, disarms (no tick, no generation). **Letting go while armed:** the message **springs back to the centre** (`--chat-dur-slow`, spring) and the new reply N+1 starts streaming in it (counter `N+1 / N+1`). Letting go unarmed: spring back, nothing generated. A release faster than 0.5 px/ms never generates, armed or not; a fling never arms. `pointercancel` never generates. The distance is fixed in dp, the same on phone and tablet. Reduced motion: the meter still fills (opacity steps, no rotation), the return is a 120 ms move. Low power: the meter is a static ring that fills without animation between steps. |
| On a streaming message | A 24 dp rubber-band and a short note "답변을 아직 쓰는 중이에요" (Still writing the reply); no commit. |

- Reduced motion: drag still follows the finger; commit is a 120 ms crossfade, cancel instant.
- Low power: no peek (chip only); commit is a 120 ms crossfade.
- **Mouse / trackpad:** no click-drag swipe. A horizontal trackpad swipe or Shift+wheel over the message steps one alternative per gesture when the gesture's accumulated \|dx\| ≥ 40 px and \|dx\| > 2·\|dy\| (a gesture ends after 160 ms without wheel events; further steps locked for 450 ms). It **never** generates, even at N / N.
- **Keyboard:** ← / → step alternatives when the message has focus (at N/N → says "마지막 답변", never generates); "새 답변" is reached by Tab or by the hotkey (§5.5).
- **Pen:** as touch.

## 4. Sidebar that follows the finger

- Narrow (overlay) layout with touch or pen. Mouse and keyboard use the header button; Esc and the mouse back button close. Wide layout: docked, no gesture.
- **Open:** a drag starting in the left edge zone (§1) just inside the system inset, or on the header's sidebar button. The panel (`min(85vw, 360px)`) translates with the finger; the backdrop's opacity follows progress (0 → 0.5), no blur.
- **Release:** open if progress > 40 % or a fling > 0.4 px/ms toward open; else close. Settle `--chat-dur-base`, transform only.
- **Close:** drag left and release below 60 % open (or a fling toward closed), tap the backdrop, Back, Esc.
- **While overlaid it is modal:** `role="dialog"`, `aria-modal="true"`, labelled "사이드바"; the rest of the page is `inert`; focus moves into it and returns to the opener on close.
- Reduced motion: follows the finger; settle is a 120 ms move.
- Today's thresholds (40 px trigger, 0.4 px/ms) stay as values for a tap-and-flick.

## 5. Message actions

### 5.1 Pinned buttons outside `⋯` (DD-019)

- Every message's meta row (or floating cluster) shows the user's **pinned actions** as 44 dp icon buttons with tooltips and `aria-label`s, then `⋯` for the rest. **Defaults: Edit, Delete.**
- **"버튼 사용자 지정" (Customize buttons)** is the last item of every `⋯` sheet/menu and a line in Settings › Chat. It opens a sheet listing every action with a pin switch and order controls (drag handle for touch/mouse; "위로" / "아래로" buttons for keyboard), "기본값으로" (Restore defaults), and a live preview row. Limit: 3 pinned on the narrow layout, 6 on the wide one; extra pins wait in order and show when space allows. The layout is global (not per chat).
- **Slot model, for a future plugin extension (no plugin API is specified here):** an action is `{ id, labelKey, icon, scope: any | newest | character | user, available(msg) → true | reason, run(msg) }` from a source `builtin` (later `plugin:<id>`). The user's layout is an ordered list of ids; ids that no longer exist (a removed plugin) are skipped silently; a new action starts unpinned in `⋯`. A disabled action shows its reason as a tooltip and in the sheet.

### 5.2 Action sheet / menu

- Opened by `⋯`, long-press with touch (500 ms; a ring fills under the finger from 200 ms; release early = nothing), right-click, Shift+F10 or the Menu key.
- **Right-click with a text selection inside the message keeps the browser's native menu** (copy, search, spelling); Shift+right-click forces the app menu. In the app menu, "복사" copies the selection when one exists inside the message, else the whole message (design default; fixes P2-4).
- Content, with labels (no icon-only items), grouped:
  1. A labelled icon grid: 복사 · 텍스트 선택 · 편집 · 번역 · 읽어 주기 ("텍스트 선택" turns on native selection for that message until the user taps elsewhere.)
  2. Alternatives (newest character reply only): 이전 답변 · 다음 답변 · 새 답변
  3. 여기서 분기 · 북마크 · AI에게서 숨기기
  4. **삭제** · **이 메시지와 이후 메시지 삭제** (destructive colour, separated)
  5. 버튼 사용자 지정
- Pinned actions also stay in the sheet (the sheet is the complete list). At 360×740 the sheet opens at ≤ 60 % of the height with group 4 visible without scrolling.
- Narrow: bottom sheet; wide: anchored menu at the pointer (right-click) or under `⋯`, flipping to stay on screen. Drag down, Esc, mouse back or Android Back closes; focus is trapped while open and returns to the message (or per §5.6).

### 5.3 Wide layout with a hover-capable pointer

The pinned buttons plus a compact row of the next most used actions on hover or keyboard focus; `⋯` holds the rest.

### 5.4 The `+` sheet (composer actions)

Today's ~12-item popover becomes a labelled sheet (narrow) / menu (wide) with `role="menu"`: attachments, image, translate input, suggestions, continue, impersonate, plugin panels, and so on (list from `layout-perf-navigation.md` §3). Keys follow the APG menu pattern: ↑/↓, Home/End, Enter/Space; **Tab closes the menu** and moves on; Esc closes and returns focus to `+`. The skip link and everything outside are `inert` while it is open.

### 5.5 Keyboard

- Messages are focusable (`tabindex=-1`, roving focus via ↑/↓ in the transcript). Enter opens the actions menu for the focused message.
- Hotkeys act on the **focused** message, falling back to the newest: Delete (single delete, §5.6), Shift+Delete ("this and after" confirm), Ctrl+C on a focused message with no selection copies it.
- **Ctrl+Alt+R keeps today's meaning** (design default): next saved alternative, and at N/N a new reply, because a hotkey is a deliberate act. It ignores `e.repeat`, and the N/N step obeys the 500 ms guard of §3.1, so holding the keys never starts more than one reply.
- The app's hooks: today's hotkeys `clickQuery('.button-icon-reroll')`; the new pager and "새 답변" buttons keep matching stable hooks (lane A).

### 5.6 Delete (DD-022, DD-023)

- **One message (DD-023, DD-029, DD-031):** deleted at once. The message's place collapses to a slim inline row (one line, 44 dp tall) "메시지를 삭제했어요 · **실행 취소**" for 6 s, `role="status"`; nothing floats over the transcript or the composer. The Undo button is reachable by Tab, and Ctrl+Z works while the row is there; the timer pauses on hover or focus. Focus moves to the next message, or the previous one if none. One pending undo at a time: a new delete commits the earlier one, and so does starting a generation (Send, 새 답변, the armed pull, Ctrl+Alt+R). After 6 s the row collapses (`--chat-dur-base`). Undo restores the message in place with all its alternatives.
- **This and the N after it:** always confirms, naming the target: "“{excerpt…}” 이후 메시지 4개도 함께 삭제됩니다" with **취소** focused first, then "5개 삭제". No undo after confirming (design default; undo for a multi-delete can be added later).
- **The generating message, or a range that includes it:** the confirm reads **"중지하고 삭제"** (Stop and delete). Confirming stops the reply first; once the stop is acknowledged the message (or range) is removed, the composer returns to idle (Send), and the single-message undo row applies. Generation never outlives its message, and the end-of-stream path tolerates a missing message (no stuck "Stop").
- Other actions on a streaming message: Edit, Translate, Read aloud, Branch and "새 답변" are disabled with the reason "답변을 쓰는 중이에요"; Copy copies what is written so far. A UI language change mid-stream changes labels only; the stream continues.
- Shift+click on the Delete button = "this and after" confirm (replaces today's silent Shift-click delete).

## 6. Streaming display (DD-015, DD-016, DD-025, C-5)

A **streaming-safe view** of the reply runs while it generates; the full pipeline runs once at completion, as now.

| Unfinished construct | Placeholder while open | On close |
|---|---|---|
| Thinking block (`<Thoughts>`, provider reasoning) | Chip "생각 중…" (Thinking…) with a live word count; collapsed | The normal collapsible thinking block |
| Image syntax: `{{img::`, `{{inlay::`, `{{inlay`, `<img` without its `>` | Image skeleton, 1:1, 160 dp, static tint (shimmer only when not low power / reduced motion) | The image |
| Other macro fragment: `{{` without `}}` (e.g. `{{user`) | Hidden; if no `}}` arrives within 64 characters, shown as text | Normal |
| `<style>` without `</style>` | Nothing rendered **and no CSS applied** | Normal pipeline applies the style |
| Code fence (```` ``` ```` or `~~~`) without its close (DD-016) | Chip "코드 작성 중… 12줄" (Writing code… 12 lines); tap to peek raw, monospaced | Normal pipeline renders it (display scripts may style it) |
| **Tag-less CSS** (DD-025, DD-030): a rule opener — selector-like text and `{`, at a line start, inline after text, or a whole one-line rule — **only when a known CSS property followed by `:` comes right after the `{`** (e.g. `color`, `background`, `margin`, `font-size`, custom `--x`); `interface Button {`, `enum Label {` or a `{` followed by prose never qualify | Chip "스타일 작성 중…" (Writing styles…) until the matching `}`; if no `}` in 40 lines, the lines show as text; a closed one-line rule outside a display script shows as text | Normal pipeline (display scripts may turn it into styling) |
| Trailing incomplete HTML tag (`<div cla`) | Hidden until `>` | Normal |
| Unclosed emphasis `*…` / `**…` in the last paragraph | The marker is hidden and the open text shows plain | Normal emphasis |

- A lone `{` (JSON, maths, prose) is never a trigger; only the openers above are.
- **Render-when-complete (C-5, DD-024):** a per-character option, default off, set where the character's display settings live (Studio; a demo toggle here). With it on, the reply shows a "답변 작성 중…" (Writing the reply…) line with a live character count instead of text, and renders in full at completion. It is the fallback where the tag-less heuristic misses.
- **Append-only rendering:** finished paragraphs are rendered once and never re-rendered while streaming; only the last, open paragraph is re-rendered. A text selection in finished paragraphs survives the stream. The message component does not remount per chunk.
- **Adaptive cadence:** render at most every 100 ms, rAF-aligned; if a render takes longer than 8 ms, back off to 250 ms, then 500 ms; return to 100 ms after five fast renders. Low power: 250 ms minimum.
- **Containment:** messages other than the newest three get `content-visibility: auto` with `contain-intrinsic-size` from their last measured height.
- Completion: changed blocks crossfade (`--chat-dur-fast`); scroll anchored so the swap does not jump.
- **Performance acceptance is on the floor devices, not a number in Chromium:** with a 7.5 k-character reply streamed by the mock provider, no long task over 50 ms from the streaming view and scrolling stays responsive on the Note 9 (Android 10 WebView) and the Pi 3 (WebKitGTK). Lane A measures this at integration; the mockup's throttled-desktop numbers are indicative only.

## 7. Composer

### 7.1 Send / Stop

One 44 dp slot; the icon morphs `send` → `square` (120 ms). **Send starts the reply** (as today). Stop has its own accessible name and a ring while running (static in low power).

### 7.2 Enter (C-4, DD-026)

- **Hardware keyboard detected → Enter sends, Shift+Enter adds a line. Otherwise Enter adds a line and the button sends.**
- Detection (DD-026, DD-032): "hardware keyboard seen" is set only by a trusted `keydown` of a navigation key (arrows, Home/End, PageUp/PageDown, Tab, Esc) or a Ctrl/Alt shortcut, while focus is in the chat. Backspace, Delete, Enter, digits and letters never set it (on-screen keyboards can send them as real keys; Hangul may report 229). It is cleared when, while a text field is focused, `visualViewport.height` drops by more than 150 px (an on-screen keyboard appeared), and on each app start. Lane A checks the key events on device (Gboard and Samsung Keyboard; Tab S9 keyboard cover).
- A visible **per-device setting** overrides: "Enter 키: 자동 / 보내기 / 줄바꿈" (Enter key: Automatic / Send / New line), default Automatic. Today's send-on-Enter setting maps onto it.
- **IME guard (both inputs, including the translated-input box):** ignore Enter when `e.isComposing`, `e.keyCode === 229`, or within 30 ms after `compositionend` (device check on the Note 9).

### 7.3 Other

- **Persona chip** "Juno로" opens a persona picker sheet (particle rule §8).
- **Growth:** 1–5 lines, then internal scroll; with the keyboard up ≤ 30 % of the remaining height.

## 8. Korean copy (proposed keys, en / ko)

Register: status lines and notices in 해요체 (…이에요, …했어요); buttons and labels as noun phrases; standard spacing (읽어 주기, 써 주기).

| Key | en | ko |
|---|---|---|
| replyOf | Reply {n} of {total} | 답변 {total}개 중 {n}번째 |
| firstMessageOf | First message {n} of {total} | 첫 메시지 {total}개 중 {n}번째 |
| firstReply | First reply | 첫 번째 답변 |
| lastReply | Last reply | 마지막 답변 |
| noMoreSaved | No more saved replies | 저장된 답변 없음 |
| releaseToGenerate | Release to generate a new reply | 놓으면 새 답변 생성 |
| newReply | New reply | 새 답변 |
| generateReply | Generate reply | 답변 생성 |
| stillWriting | Still writing the reply | 답변을 아직 쓰는 중이에요 |
| thinking | Thinking… | 생각 중… |
| writingCode | Writing code… {n} lines | 코드 작성 중… {n}줄 |
| writingStyles | Writing styles… | 스타일 작성 중… |
| writingReply | Writing the reply… {n} characters | 답변 작성 중… {n}자 |
| deleteThis | Delete | 삭제 |
| deleteThisAndAfter | Delete this and the messages after it | 이 메시지와 이후 메시지 삭제 |
| deleteRangeConfirm | "{excerpt}" and the {n} messages after it will be deleted | “{excerpt}” 이후 메시지 {n}개도 함께 삭제됩니다 |
| deleteCount | Delete {n} | {n}개 삭제 |
| stopAndDelete | Stop and delete | 중지하고 삭제 |
| deleted | Message deleted | 메시지를 삭제했어요 |
| undo | Undo | 실행 취소 |
| customizeButtons | Customize buttons | 버튼 사용자 지정 |
| restoreDefaults | Restore defaults | 기본값으로 |
| readAloud | Read aloud | 읽어 주기 |
| enterKey | Enter key: Automatic / Send / New line | Enter 키: 자동 / 보내기 / 줄바꿈 |
| asPersona | as {name} | {name}(으)로 |

`asPersona` picks the particle from the name: last syllable without a final consonant, or with final ㄹ → "로" (주노로); otherwise "으로" (세라핀으로); non-Hangul last character → "(으)로". Labels are translator-owned outside en/ko. "첫 메시지" / First message is the term for the character's opening message; never "greeting".

## 9. Decisions in this slice

| ID | Question | Outcome |
|---|---|---|
| C-1 | Haptic tick at commit and at the arm point | On, off switch — DD-024 |
| C-2 | Counter "n / N" always visible when N > 1 | Always visible — design default |
| C-3 | Header hides while reading older messages | On, narrow layout only — DD-024 |
| C-4 | Enter on hardware vs on-screen keyboards | Detect typing + setting — DD-026 |
| C-5 | Per-character "render only when complete" | Offer, default off — DD-024 |
| C-6 | "Hide names and avatars" reading mode | Per chat, default off — DD-024 |
| — | Where "New reply" lives | Own button, `›` disables at N/N — DD-020 |
| — | Arming | 160 dp + 300 ms hold, no fling — DD-021 |
| — | Delete on a generating message | Stop, then delete — DD-022 |
| — | Mistaken deletes | Undo for one, confirm for many — DD-023 |
| — | Tag-less CSS | Heuristic chip, needs a CSS property, + C-5 — DD-025, DD-030 |
| — | Undo place / commit | Inline row in the gap; a generation commits it — DD-029, DD-031 |
| — | Hardware-keyboard keys | Navigation keys and shortcuts only — DD-032 |
| — | `swipe` setting off | Pager + New reply, no gesture — DD-027 |
| — | Buttons outside `⋯` | Edit + Delete default, customizable, plugin-ready slots — DD-019 |

## 9a. Platform checks for this slice

Touch-only, mouse-only and keyboard-only passes; a mixed pass (touch + hardware keyboard, Tab S9 with a keyboard); a WebKit pass (WebKitGTK or Safari) for pointer capture, `wheel` deltaX, `inert`, `content-visibility` and scroll anchoring, or a note that it was not run. Device checks for lane A: right-edge Back conflicts on Android 10 gesture navigation; `compositionend`/Enter order; the Enter detection on the Tab S9 with a keyboard cover and on a Bluetooth keyboard; haptics; the §6 performance acceptance on Note 9 and Pi 3.

## 10. Integration map (lane A; nothing here edits these files)

| App file | Change |
|---|---|
| `src/lib/ChatScreens/Chat.svelte` | Meta row with pinned buttons and `⋯`; alternatives row with separate "새 답변"; action sheet/menu; focusable messages with `aria-labelledby`; long-press ring; stable hooks for hotkeys |
| `src/lib/ChatScreens/Chats.svelte`, `ChatBody.svelte` | Streaming-safe view, append-only, adaptive cadence, containment, completion crossfade, scroll anchoring |
| `src/ts/process/composerActions.svelte.ts` | Split "next alternative" from "generate new"; new reply only from "새 답변", the sheet, the armed pull or Ctrl+Alt+R; stop-then-delete; delete with undo |
| `src/lib/SideBars/panelGesture.ts`, `src/lib/SideBars/panelGestureBinding.ts`, `src/lib/SideBars/Sidebar.svelte` | Progress-driven drag (transform), release thresholds, modal overlay; drop width/colour keyframes; right-edge inset |
| `src/ts/parser/parser.svelte.ts`, `src/ts/parser/thoughts.ts` | Streaming-safe tokenizer for the §6 rows; never emit a partial `<style>` |
| `src/ts/hotkey.ts`, `src/ts/gui/longtouch.ts` | Focused-message targets; repeat guard kept; visible long-press progress |
| Composer component(s) (layout note §4, `DefaultChatScreen.svelte`) | Docked layout, Send/Stop morph, Enter detection + setting, IME guard on both inputs, persona chip, `+` menu |
| Settings › Chat | Customize buttons, Enter key, haptics switch |
| `src/styles.css` | Motion tokens, press states, reduced-motion, low-power and forced-colors rules |
| `src/lang/*.ts` | Keys in §8 |

## 11. Review answers (revision 1 → 2)

| Finding | Answer |
|---|---|
| P1-1 edge strip dead zone | §1 edge zones: no overlay, decided at `pointerdown`, controls in the zone work |
| P1-2 delete while generating | §5.6, DD-022 |
| P1-3 `›` turns into New reply | §3.1, DD-020, 500 ms guard |
| P1-4 flick arms | §3.2, DD-021 |
| P2-1 sidebar not modal | §4 |
| P2-2 header hide on wide / inert | §1 header hiding |
| P2-3 focus in sheets, confirm focus, which message, undo | §5.2, §5.4, §5.6, DD-023 |
| P2-4 right-click on a selection | §5.2 |
| P2-5 right-edge Back | §1 edge zones; device check §9a |
| P2-6 streaming coverage, selection | §6 rows, DD-025, append-only |
| P2-7 floor performance, blur | §6 cadence/containment/acceptance; §2 rule 6 |
| P2-8 Enter contradiction | §7.2, DD-026 |
| P3-1 paths, hotkey semantics | §10; §5.5 |
| P3-2 `swipe` off | §3.1, DD-027 |
| P3-3 mid-stream feedback | §3.2 last row; §5.6 disabled reasons |
| P3-4 a11y details | §3.1 group name; §1.1 `aria-labelledby`; forced-colors (§10 styles; armed chip gets a `Highlight` border); §1 target sizes; §3.2 overflow-only exclusion; §2 rule 4 spinners |
| P3-5 wheel jitter | §3.2 accumulation rule |
| P3-6 Korean | §8 register, 첫 메시지 keys, spacing; §3 first message label |
| P3-7 misleading demo | §7.1 Send starts the reply; §3 first message; §5.2 sheet height; Android Back simulated by Esc/mouse back only (mockup limit, stated in its notes) |

## 12. Re-review notes applied (revision 2 → 2.1)

| Re-review item | Answer |
|---|---|
| P2-N1 snackbar covers Generate/New reply | §5.6 inline undo row (DD-029) |
| P2-N2 Backspace sets the hardware flag | §7.2 (DD-032) |
| P2-N3 keyboard reorder of a plugin action loses focus | Mockup bug: ids with `:` must survive focus restore |
| P2-N4 unclosed `<` hides the rest of the reply | §6: a trailing incomplete tag is hidden only while it looks like a tag (`<` + a letter, no space before the name) and for at most 64 characters; then it shows as text (`if x<y then…` stays visible) |
| P3-N1 tag-less CSS coverage | §6 (DD-030) |
| P3-N2 empty excerpt in the stop-and-delete confirm | §5.6: when nothing is written yet, the confirm names the position ("답변 6/6") instead of an excerpt |
| P3-N3 undo after a new generation | §5.6 (DD-031) |
| P3-N4 arming needs room | Accepted per DD-021; the DD-033 fill meter shows the progress from the first dp, so a short pull visibly needs more (no separate hint) |
| P3-N5 hidden header and TalkBack | Device check for lane A (TalkBack linear navigation); fallback: the header reappears when accessibility focus enters the transcript's first visible message |
| `<style media=…>`, `<STYLE>` | §6: `<style` matches any attributes and is case-insensitive |
| `~~~` scene break | §6: a fence opens only when the `~~~`/```` ``` ```` line is followed by more text before a blank line or has an info string; a lone `~~~` line between paragraphs is a scene break |
| Stray `*` flash | §6: covered by the unclosed-emphasis row (the marker is hidden while open) |
| Delete below the fold at 320×640 | §5.2: at heights under 700 px the grid row shows 4 items and the fifth moves to a second row after the delete group |
| §0 line numbers drifted | Line numbers are indicative; lane A re-locates by function name |
| Builder deviation 9 (36 dp hover row) | The hover row shows only while the last input was a mouse; touch uses pinned 44 dp buttons |
