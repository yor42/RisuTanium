# Chat screen: gestures, message actions, streaming render (source trace)

Source: read-only checkout `C:\Projects\RisuAI` (paths below are relative to it). Static source reading only; nothing was run on device or in a browser.

Maintainer complaints being grounded:
- "Overall lack of animation feedback and gesture based controls - such as swipe reroll not having visual feedback at all, and non-touch reactive sidebar."
- "Streaming display shows CoT, image or CSS in plain text before generation completes the syntax or trigger scripts."

## Headline findings (OBSERVED)

1. There is no touch swipe on chat messages. "Swipe" in this app means the arrow-button pair (left/right) that steps through alternatives; the setting is labelled "Use Swipe for Regeneration" (`src/lang/en.ts:1282`, `src/ts/setting/accessibilitySettingsData.ts:27-31`). So "swipe reroll has no visual feedback" is literally true: there is no drag at all, and the stepped text is swapped in place.
2. The phone sidebar gesture is a trigger-only recognizer. Its own header says "the overlay does not follow the finger, so a stroke either triggers once or changes nothing" (`src/lib/SideBars/panelGesture.ts:3-4`). The panel then plays a fixed width animation.
3. Mid-stream raw syntax has two causes. First, unclosed `<Thoughts>` and unclosed `<style>` are intentionally left as literal text by the parsers (`thoughts.ts:7-8`, `parser.svelte.ts:997`). Second, with the default streaming mode `off`, every chunk remounts the message component and re-runs the full display pipeline.

## 1. Message alternatives ("swipe"/reroll)

| Aspect | Observed | Where |
|---|---|---|
| Touch/drag detection on messages | None. No touchstart/pointer handler in ChatScreens other than ResizeBox and the delete long-press. | grep of `src/lib/ChatScreens`: only `ResizeBox.svelte:49-94`, `Chat.svelte:1219` (longpress) |
| Control | Two icon buttons ArrowLeft/ArrowRight (size 22) when `DBState.db.swipe` (default true); else one RefreshCcw icon (size 20). | `Chat.svelte:1258-1276`; default `database.svelte.ts:116-117` |
| Only on last message | Buttons carry class `dyna-icon`; CSS hides it everywhere except `.chat-message-container:first-of-type`. Container is `flex-col-reverse`, so first-of-type = newest message. | `styles.css:511-517`, `Chats.svelte:263`, `Chat.svelte:1261` |
| Handler | Right arrow = `reroll()`, left arrow = `unReroll()` in `composerActions.svelte.ts`. Both no-op while `doingChat` or the composer window is busy. | `composerActions.svelte.ts:442-525`, wired `DefaultChatScreen.svelte:359-364,882-883` |
| What right arrow does | First tries stored candidates for this generation (`Prereroll`), then reroll history (`stepRerollHistory`), and only if neither has a "next" does it cut the chat back and call `sendChatMain` (new generation). So the same button means "show next alternative" or "generate a new one". | `composerActions.svelte.ts:472-488`; `prereroll.ts:30-42`; `rerollHistory.ts:161+` |
| Left arrow | Steps back through candidates/history; does nothing at index 0. | `composerActions.svelte.ts:517-520`, `prereroll.ts:45-57` |
| Index display ("2/5") | Only for the first message with alternate greetings: `{currentPage}/{totalPages}`, gated by `firstMessage && swipe && showFirstMessagePages`. Reroll candidates/history have no counter: `entry.index` and `history.cursor` are internal. | `Chat.svelte:1264-1266`; `DefaultChatScreen.svelte:931-932`; `prereroll.ts:60-62` |
| Feedback on step | The message `data` is replaced; the component remounts (hash includes message data) and `ChatBody` re-parses. No transition, no direction cue, no "n/N". The only cross-fade in Chat is the draft-restore marker (150 ms). | `composerActions.svelte.ts:433-438`; `Chats.svelte:111-120`; `Chat.svelte:1036` |
| First-message alternatives | Separate path: `fmIndex` cycles, wrapping -1..N-1 both directions. | `DefaultChatScreen.svelte:904-929` |
| Desktop equivalents | Hotkeys Ctrl+Alt+R (reroll) / Ctrl+Alt+F (unreroll), implemented by `clickQuery('.button-icon-reroll' / '.button-icon-unreroll')`, i.e. they click the first matching DOM element. | `defaulthotkeys.ts:10-22`; `hotkey.ts:142-148,494-500` |
| Other horizontal swipe | `initMobileGesture` (only when `betaMobileGUI` and width <= 800, or Lite build): touchend dx > 50 px and |dy| < |dx| steps `MobileGUIStack` / `MobileSideBar`. Starts on BUTTON/INPUT/SELECT/TEXTAREA are ignored. Not used for message alternatives; no follow-finger. | `hotkey.ts:511-569`; `bootstrap.ts:594-596` |

## 2. Phone sidebar

Scope: phone overlay in the normal (non-MobileGUI) layout, `DynamicGUI` path. Installed only while the overlay backdrop exists (`panelGestureBinding.ts:127-130`; attached at `Sidebar.svelte:353`).

| Aspect | Observed | Where |
|---|---|---|
| Open by button | `SideBarArrow`: 48x48 (`h-12 w-12`) tab at top-left, `opacity-50`, sets `sideBarClosing=false; sideBarStore=true`. Carries `data-panel-handle`. | `UI/GUI/SideBarArrow.svelte:13-15` |
| Open by swipe | Rightward stroke starting in a 32 CSS px strip at the left edge, offset by the OS back-gesture inset; or starting on the handle from anywhere. | `panelGesture.ts:12,26-28`; `panelGestureBinding.ts:283-291` |
| Close | X button in panel (18 px icon), tap on dark backdrop (`data-panel-surface`), leftward swipe on panel/backdrop (not on `data-rail-root`), Android Back. | `Sidebar.svelte:300-312,353-358`; `panelGestureBinding.ts:291-296,329-342` |
| Thresholds | slop 6 px; axis ratio |dx| >= 1.5|dy|; trigger at 40 px travel in direction; or fling > 0.4 px/ms over 100 ms with >= 3 samples; unclaimed stroke abandoned after 250 ms dwell; stroke watchdog 1000 ms. | `panelGesture.ts:35,38,41,47-48,54,60`; `panelGestureBinding.ts:21` |
| Follows finger? | No. At trigger it calls the same open/close store write as a tap, then keeps swallowing the rest of the stroke (`preventDefault`). | `panelGestureBinding.ts:173-199` |
| Animation | CSS keyframes on width (0 to `--sidebar-size`), close also shifts `right`; backdrop fades 0 to 0.5 black. Duration `var(--risu-animation-speed)`; setting default 0.4 s (CSS fallback 0.2 s). Width animation, not transform: layout-affecting. | `Sidebar.svelte:375-496`; `styles.css:172`; `database.svelte.ts:407`; `gui/animation.ts:5` |
| Close completion | Panel `onanimationend` flips `sideBarStore` false. Binding adds a forced finish after `animationSpeed + 300 ms` in case `animationend` never fires. | `Sidebar.svelte:293-298`; `panelGestureBinding.ts:27,84-91,153-156,314-325` |
| Gesture yields to | input/textarea/select/contenteditable, `[role=slider]`, `[data-panel-gesture=off]`, `.sortable-chosen`, horizontally scrollable ancestors, any `position:fixed` ancestor (for open); also skipped while a modal/alert covers the page or panel is closing; multi-touch cancels. | `panelGestureBinding.ts:30-31,98-112,266-300` |
| Back integration | `registerBackHandler(backHook)`: Back while open sets `sideBarClosing=true` and returns true (consumed). Host: `OnBackPressedCallback` calls `window.__risuTaniumBack()`; non-true answer or 1 s timeout falls back to default Back. A second unhandled Back within 2 s quits (toast on first). | `panelGestureBinding.ts:329-343`; `backHandlers.ts:17,50-73,88-110`; `MainActivity.kt:48-76` |
| Android edge-gesture conflict | `MainActivity` stores `systemGestures.left - bars.left` in dp (= CSS px) in `GestureInsetHolder`; exposed as `window.__risuTaniumGestureInset.left()`. The page reads it per touch only when `clientX < 128`, clamps to [0, 96], and the 32 px open strip starts at that inset. Absent/throwing/non-finite = 0. | `MainActivity.kt:99-106,122`; `GestureInsetBridge.kt:8-18`; `panelGestureBinding.ts:67-82,286`; `panelGesture.ts:19-28` |
| Consequence | On gesture-nav phones the usable open strip is a 32 px band beginning after the OS back strip; the visible handle tab is the fallback. | derived from the rows above |

## 3. Message actions

Per-message toolbar `iconButtons` (right-aligned row, `ml-2 gap-2`, icons 20 px, no padding classes, `hover:text-blue-500` only; no explicit min touch-target size; no focus-visible styling on these buttons): `Chat.svelte:1152-1192`.

| Action | Condition | Where it renders | Notes |
|---|---|---|---|
| Translate | translator set, not blank, not streaming | inline | `1229-1242` |
| Edit | `idx > -1`, not streaming | inline | `1243-1255`; also click-text-to-edit if `clickToEdit` (`1106-1110`) |
| Copy | `useChatCopy` and not blank | inline (width >= 640) or inside "..." popup (< 640) | `1196-1207`; copy status text appears in `aria-live` span (`1165`) |
| TTS | voice mode on, non-group | same as Copy | `1208-1217` |
| Delete | `idx > -1` | same as Copy | `1218-1226` |
| Bookmark | `enableBookmark`, `idx > -1` | "..." popup (PopupButton) always | `1280-1290` |
| Branch | `idx > -1` | popup | `1292-1330`; copies chat up to this message, optionally into a "Branches of ..." folder, switches to the new chat |
| Disable message / disable above | `idx > -1` | popup | `1332-1352` |
| Copy as card | clipboard API available | popup | `1355-1362` |
| Reroll / swipe arrows | newest message only | inline, after the others | section 1 |

- Width switch is `window.innerWidth >= 640` evaluated at render (`Chat.svelte:1168`), not a reactive media query. Below 640, Copy/TTS/Delete move into the popup together with the minor items and only the translate/edit icons and arrows stay inline (`1175-1186`).
- Visibility: always rendered, no hover reveal, but per-message so a long chat shows a row of ~20 px icons under every message. User and character messages use the same snippet; user messages get no reroll arrows because `dyna-icon` only shows on the newest container, and reroll on a user-last chat is a different path (not traced).
- Destructive confirmation: Delete runs `rm()`. Shift-click deletes this message and everything after it with no confirm (`Chat.svelte:258-265`). Otherwise confirm only if `askRemoval` (`276`); if `instantRemove` or long-press, a 3-choice select (only this / cancel / this and following) (`281-293`). Touch long-press = 500 ms, 10 px move cancels, swallows the following click (`ts/gui/longtouch.ts:10-17`). Delete control is `select-none` with `-webkit-touch-callout:none` (`Chat.svelte:1219`).
- Keyboard: hotkeys Ctrl+Alt+R/F (reroll), T (translate), D (remove), E (edit, then focuses `.message-edit-area`), C (copy) (`defaulthotkeys.ts`, `hotkey.ts:141-164`). They act on the first matching DOM element via `document.querySelector`, i.e. the first in DOM order = newest message, not a focused or selected message. Toolbar buttons are native `<button>`s so Tab/Enter works; icon-only buttons have no `aria-label` or `title` in these snippets (only the sidebar close button has one).
- Edit has its own discard confirm and draft restore marker (`Chat.svelte:410-416,1036-1064`).

## 4. Streaming render pipeline

Setting `streamingDisplayOptimizationMode` = `off | balanced | strong`, default `off`, shown only when `useExperimental` is on (`database.svelte.ts:713`; `setting/advancedSettingsData.ts:145-157`). Help text: `lang/en.ts:547-552`.

Per-chunk path (function names):

| Step | Function | `off` | `balanced` | `strong` |
|---|---|---|---|---|
| Chunk read | stream loop in `sendChat` | each chunk | each chunk | each chunk |
| Output regex scripts | `processAndWriteReply` -> `processScriptFull(..., 'editoutput', ..., 'bypass')` | every chunk (awaited) | coalesced, `setTimeout(125ms)` then `requestAnimationFrame` flush | skipped; raw text written |
| Write into chat | `writeReplyData` sets `message[i].data`, bumps `reloadKeys` | every chunk | per flush | per flush |
| Final pass | `processAndWriteReply(...)` once at end | n/a | n/a | yes, after stream |
| Output trigger scripts | `runTrigger(currentChar,'output')` | only after stream ends | same | same |
| Inlay screen | `runInlayScreen` | after stream | same | same |

Refs: `process/index.svelte.ts:2133-2232` (flush machinery), `2239-2275` (loop), `2291-2293` (strong final pass), `2323-2351` (post-stream triggers, inlay, listeners).

Render path of the message (UI side):

1. `Chats.svelte` `updateChatBody` hashes each message and mounts one `Chat` per hash with imperative `mount()`/`unmount()`. In `off` mode `activeStreamingIndex = -1`, so the streaming message's data is part of the hash (`Chats.svelte:94-96,110-111,117`) and every chunk causes unmount of the old component and mount of a new one. In `balanced`/`strong` the streaming message hashes with empty data and is instead updated through `updateStreamingDisplay` (`Chats.svelte:158-164`; `Chat.svelte:248-256`).
2. `Chat.svelte`: `$effect.pre -> updateDisplayedMessage -> displaya -> risuChatParser(message, displayParseOptions())` (CBS macros) on every change (`Chat.svelte:623-630,741-750`). In `strong` mode with a streaming message it returns early (`742-744`) and `ChatBody` is told `renderRawStreaming`.
3. `ChatBody.svelte`: `markParsing -> ParseMarkdown(msgDisplay, ...)` on each `msgDisplay` change (`ChatBody.svelte:268`), result rendered with `{@await}` and `{@html addMetadataToElement(trimMarkdown(...))}` (`283-287`). The `{#await}` pending branch shows `lastParsed`, the previous result.
4. `ParseMarkdown` (`parser.svelte.ts:790-831`): `parseAdditionalAssets` -> `processScriptFull(..., 'editdisplay')` (display regex scripts) -> second `parseAdditionalAssets` if changed -> `parseInlayAssets` -> `parseThoughtsAndTools` -> `encodeStyle` -> `renderHighlightableMarkdown` -> (`trimMarkdown` = DOMPurify).
5. In `strong` mode the same message is shown as `<span class="whitespace-pre-wrap">{rawStreamingText}</span>`: literally raw text, including any `<Thoughts>`, `<img>`, `<style>`, macro or script syntax (`ChatBody.svelte:70,280-281`). `balanced` is not raw but is not throttled at the parse stage (see below).

Why raw CoT / image / CSS text appears mid-stream (OBSERVED mechanisms, inference marked):

| Symptom | Mechanism | Where |
|---|---|---|
| CoT shows as plain text with literal `<Thoughts>` | `replaceThoughtsBlocks` only converts a closed, exact-case `<Thoughts>...</Thoughts>`; "An unclosed block is left as text". During a stream the close tag has not arrived, so the whole block is plain markdown text until `</Thoughts>` is received. Then it becomes `<details><summary>{language.cot}</summary>...`. | `parser/thoughts.ts:1-30`; `parser.svelte.ts:783-788` |
| CSS shows as text | `encodeStyle` uses regex `/<style>(.+?)<\/style>/gms`, which needs the closing tag; an incomplete `<style>` is not encoded and flows to markdown/DOMPurify as ordinary content. | `parser.svelte.ts:997-1000` |
| Inline image/asset syntax shows as text | `parseAdditionalAssets`/`parseInlayAssets` and display regexes match complete syntax; a partial `{{img::...` or partial tag cannot match. After render, `checkImg` repairs `<img>` via asset lookup only for `newImageHandlingBeta`. (Exact asset regexes not read; inference from "needs full syntax".) | `parser.svelte.ts:735`; `ChatBody.svelte:188-266` |
| Everything raw in `strong` mode | Deliberate: post-processing skipped until the stream ends, then replaced in one step (no transition). | `process/index.svelte.ts:2207-2209,2291-2293`; `ChatBody.svelte:280` |
| Trigger scripts | `runTrigger(...,'output')` runs only after the whole reply is received, so trigger-driven UI appears at completion regardless of mode. | `process/index.svelte.ts:2330` |
| Final swap is abrupt | Completion sets `isStreaming=false`, bumps `reloadKeys`; the hash changes, so the component remounts and the body flips from partial/raw HTML to the final HTML with no animation. | `process/index.svelte.ts:2296-2306`; `Chats.svelte:117` |

Throttling that exists: only the `off|balanced|strong` store-write coalescing (125 ms timer + rAF) at the producer. There is no throttle or rAF coalescing in `Chat.svelte`/`ChatBody` parse, so `balanced` still runs the full display pipeline once per flush, and `off` per chunk (plus remount). A `streaming` note `interrupted` shows only after the stream ends (`Chat.svelte:1134-1136`). A stream-time `{{inlay}}`/image generation spinner or placeholder does not exist in what I read.

## 5. Motion utilities and reduced-motion

| Item | Observed | Where |
|---|---|---|
| Global speed token | `--risu-animation-speed`, set from `db.animationSpeed` in seconds; default 0.4; setting label "Animation Speed". Used by sidebar keyframes. 0 disables SidebarRail transition/smooth-scroll. | `gui/animation.ts:5`; `database.svelte.ts:407`; `setting/displaySettingsData.svelte.ts:223-226`; `SidebarRail.svelte:178,1172` |
| `prefers-reduced-motion` | Honored in exactly two places: draft-restore marker fade in `Chat.svelte` (150 ms to 0) and `SourceDisclosure.svelte` (300 ms to 0). Not honored by sidebar keyframes, toast, spinners, `animate-*` classes. | `Chat.svelte:169-180`; `UI/SourceDisclosure.svelte:83-111` |
| Low-power / battery mode | No setting or check found (grep for lowPower/reduceMotion/batterySaver outside tests: none). Nearest is the streaming optimization mode above. | grep |
| Other keyframes | toast (`AlertComp.svelte:1151`), `TransitionImage.svelte:95-104` (fade in/out), several spinners (`styles.css:488` saving), IrisModal bounce dots. Svelte `fade` is the only Svelte transition seen in Chat. | grep |
| Reroll/step, message appear, scroll-to-bottom, button press states | No animation found; buttons use `transition-colors` only. | `Chat.svelte:1152-1363` |

## Design suggestions (separate from the observations above)

- Reroll/alternatives: add a real horizontal drag on the newest char message with finger-following translate and a threshold-based commit and spring-back; show "n/N" (needs an exposed count from `prereroll` and `rerollHistory`), and make the "next past the end = generate new" case visually distinct (e.g. a "new" glyph/spinner on the right edge) so the same swipe never silently triggers a paid generation. Keep arrow buttons as the accessible equivalent. Must not collide with the sidebar swipe or text selection.
- Sidebar: make it follow the finger using `transform: translateX` on the panel and opacity on the backdrop, committing on release by distance/velocity (reuse existing 40 px and 0.4 px/ms values as a starting point). Keep the edge-inset logic; the Back and close-timer behavior can stay.
- Actions: one stable per-message action row or long-press / tap bottom sheet with 44 px targets, labels in the sheet, delete separated and confirmed or undoable instead of the Shift-click / long-press variants; label icon-only buttons.
- Streaming: render a "thinking" placeholder (collapsed block with live indicator) as soon as `<Thoughts>` opens, and hide an unclosed `<style>`/partial tag/partial image macro behind a skeleton until it closes. This is a streaming-aware tolerant parse step before `ParseMarkdown`, plus an animated cross-fade on completion.
- Motion: gate all new motion on `prefers-reduced-motion` and `animationSpeed === 0`; prefer transform/opacity over width.
- Open product decisions: whether swipe should trigger a paid new generation at the end of the alternatives list; whether CoT should be collapsed live or only on completion; whether `strong` mode should become the default behavior with a tolerant live view.

## Limits

- Static reading only: no device, WebView, or browser run; no frame timing or gesture-feel evidence.
- Not traced: the MobileGUI layouts (`src/lib/Mobile/*`), other chat themes (`mobilechat`, `cardboard`, `customHTML` renderers), group-chat reroll specifics, user-last-message reroll path, `PartialEditController`, `SidebarRail` long-press drag, `Suggestion.svelte`, scroll/"new message" button behavior.
- Not read in detail: `parseAdditionalAssets`, `parseInlayAssets`, `renderHighlightableMarkdown`, `risuChatParser` internals, `processScriptFull`/`runScriptPass` (so which display regex scripts leak partial syntax is inferred from "needs a complete match"), `sendChat` body outside the streaming block, provider stream adapters (how reasoning/thinking is emitted into `<Thoughts>`), `rerollHistory.ts` internals beyond the stepping function.
- Tests (`panelGesture*.test.ts`, `Chat.*.test.ts`, `hotkey.mobileGesture.test.ts`) were not read except by grep; behavior is taken from source.
- Did not touch `Agents/` evidence folders, key files, or community code.
