# Chat slice 4: long-chat performance (source-backed notes)

Scope: read-only trace of this clone's `src/` (paths relative to `src/`), campaign records in `Agents/` (reference only), plus one synthetic browser bench in `docs/design/chat/research/slice4/`. Nothing here was run in the app. "DCS" = `lib/ChatScreens/DefaultChatScreen.svelte`. Observations and proposals are separated; proposals are only in section 8.

Correction to the brief: `MEASURE` in `src/` is the memory/cold-retainer flag (`ts/process/memory/measureFlag`, used in `ts/process/coldRetained.ts:136-145`, `characterPutBack.ts:47`). I found no chat-window `MEASURE` instrumentation in `Chats.svelte`, `ChatBody.svelte` or DCS.

## 1. Cost centres that scale with TOTAL message count (not the window)

Window facts: initial 30, +15 per scroll-to-top, no cap besides `messages.length` (`ts/chatLoadPages.ts:1-2`, DCS:565-566); reset only on chat-identity change (DCS:179-190).

| When | What scales with total N | Source | Status |
|---|---|---|---|
| Select a character / open chat | Save-tracker rebuilds one effect per chat and one per message, for EVERY chat of the selected character, on each selection; each message effect does `$state.snapshot(message[j])` | `ts/storage/dbChangeEffects.svelte.ts:287-379` (message loop 340-349) | Mechanism in source. Cost share unmeasured (Report 19 §2.6; selection at fresh window of 30 measured 19-46 ms at 300 msgs, 141-199 ms at 1000, 358-445 ms at 3000, about 0.12-0.15 ms/msg, i9, `Agents/Reports/19-chat-list-window-plan.md` §1) |
| Open chat (UI) | Not N: only the window is mounted (`Chats.svelte:87-105`). Cold-storage chats load a placeholder first and refuse sending until loaded | `Chats.svelte:87-105`, `ts/process/index.svelte.ts:235-237,250-253` | observed |
| Send (every send) | `splitSentMessages` walks all N (`ts/cbs.ts:111-136`). Then EVERY non-disabled message is run through `processScriptFull` + `risuChatParser`, inlay/asset regexes, and `tokenizer.tokenizeChat` before any trimming | `ts/process/index.svelte.ts:1294-1301`, loop `1359-1509` | observed. Trim to context happens only afterwards (`1612-1621`) or via memory (`1528-1609`) |
| Send | `console.log(JSON.stringify(chats, null, 2))` of the whole formatted history, every send | `ts/process/index.svelte.ts:1510` | observed (cost unmeasured; strongest on Android WebView, UNVERIFIED) |
| Send | Tokenizer LRU holds 1500 entries keyed by full text+model; script cache holds 1000 entries, oldest evicted, hits do not refresh. Chats over about 1000 messages (script cache) or 1500 (tokenizer; other prompt parts share it, so earlier) miss on every message | `ts/tokenizer.ts:15-17,87-100`, CHORE-45 `Agents/Roadmap.md:2594-2622` (warm 10-13 ms vs cold 60 ms at 998 msgs, i9; phones "10-15x slower" is the record's estimate) | observed / recorded |
| Send with memory | `supaMemory` / `hypaMemoryV2` / `hypaMemoryV3` / `hanuraiMemory` receive the whole `chats` array and token counts | `ts/process/index.svelte.ts:1528-1609` | trigger observed; internals NOT traced (UNVERIFIED) |
| Send with lorebook | Scan is bounded by `searchDepth`: `messages.slice(messages.length - arg.searchDepth)` | `ts/process/lorebook.svelte.ts:173` | observed; bounded |
| Each stream tick | Not N: window-bound. `updateChatBody` re-hashes every windowed message text; `checkIfAtBottom` forces layout. Streaming write coalescing exists only for `balanced`/`strong` (125 ms + rAF); default `off` writes per chunk | `Chats.svelte:77-185,196-204`, `ts/process/index.svelte.ts:2139-2141,2216-2230` | observed. Report 19 §1: 124 ms/chunk at 600 mounted vs 6-11 ms at 30 (whole action); §8.1 isolated: about 16 ms (78% style+layout). The two sets are not comparable (Report 19 §8.1) |
| Save after any change (send, stream, edit, delete) | Debounce 500 ms, then the character block is re-encoded via `JSON.stringify(character)`, i.e. all chats of that character, not just the edited chat. `toSave.chat` pairs are tracked but no `toSave.chat` reader exists in `risuSave.ts` | `ts/globalApi.svelte.ts:1588`, `ts/storage/risuSave.ts:601-617`, `dbChangeEffects.svelte.ts:226-243` | observed (grep of `risuSave.ts` only; other consumers of `tracker.chat` UNVERIFIED) |
| Save, numbered backup | When the backup interval is due and committed state is not in the backups, `encoder.encode()` snapshots the whole file | `ts/globalApi.svelte.ts:1752-1786,1810-1836` | observed; whole DB, not per chat |
| Edit / delete message | Same save path; bookmark list rebuilds a Map over all N when open | `ts/globalApi.svelte.ts:1588`, `lib/Others/BookmarkList.svelte:16-28` | observed |
| Switch chat | Old window fan-out of `ReloadGUIPointer` before unmount (fixed: `flushSync` in `changeChatTo`); window resets to 30 (Stage A) unless a message editor is open | Report 19 §3, §9; `Chats.svelte`/DCS:179-190 | recorded as shipped (`96311c4a`, `c99f914b`). Report 19 §9.3.1: 104.4 -> 66.2 ms at 600 mounted, i9 |
| Switch character | Rebuilds tracker effects (row 1), unmounts old window; 682 ms from 600 mounted (Report 19 §1) | `dbChangeEffects.svelte.ts:287-379` | recorded |
| Search | No in-chat message search found: grep of `ts/` and `lib/ChatScreens` for chat search found only character search (`ts/gui/characterSearch.svelte.ts:53`). Chat list has no search (`lib/SideBars/SideChatList.svelte`, per `layout-perf-navigation.md` §4) | grep | UNVERIFIED beyond grep |
| Bookmark / branch jump | `scrollToMessage` sets `loadPages = total - index + 5`, i.e. mounts EVERY message newer than the target; polls DOM up to 5 s, waits up to 4 s for all `<img>` in the container, 3 scrolls | DCS:277-339 (math at 281-286) | observed. Jump to message 100 of 20,000 mounts about 19,900 |
| Screenshot | `runWithFullWindow` sets window to full chat; each `.risu-chat` rasterized serially with `html-to-image`, canvases merged into one tall canvas, PNG dataURL | DCS:439-493; policy `ts/chatWindowPolicy.ts` | observed. Canvas size limits not checked in source (UNVERIFIED) |
| Export | `exportChat(page)` / `exportAllChats()` exist (`ts/characters.ts:293,616`); cost not traced | | UNVERIFIED |

## 2. Scrolling back

| Fact | Source |
|---|---|
| Trigger: scroll within 100 px of top (col-reverse math) adds `getAdditionalChatLoadPages` (default 15, min 1) while `message.length > loadPages`. No spinner, no upper bound, never shrinks except on chat change/reset | DCS:562-567; `ts/chatLoadPages.ts:21-23` |
| Each load re-runs `updateChatBody` over the whole grown window (re-hash all, mount only new hashes) | `Chats.svelte:77-185` |
| Measured, i9 best case, real app, 3000 x 1 KB chat: each +15 step cost 24-113 ms early and 104-204 ms at 400-600 mounted; 600 mounted = 21,642 DOM nodes, +62 MB heap | Report 19 §1 |
| Scroll anchoring on prepend in `flex-col-reverse` held identically with and without `content-visibility` in the app dev build (offsets -4,000 to -24,000 px); Chrome reports negative `scrollTop` | Report 19 §8.4 |
| Each message mounts its own Svelte component, async markdown parse (`ParseMarkdown` runs regex scripts + asset parsing; no cache inside ParseMarkdown that I found) and `isEqual(lastCharArg, charArg)` deep compare | `ChatBody.svelte:72-182,264-283`, `ts/parser/parser.svelte.ts:753-778` |
| Late-loading images have no reserved size in the code I read; the jump path works around layout shift by waiting for images (up to 4 s) | DCS:306-325 |
| Jump-to-bottom: the only affordance is the "new message" pill (6 position variants). It appears only when `autoScrollToNewMessage` is on AND a new char reply arrives while the user is not near the bottom and `alwaysScrollToNewMessage` is off; hidden again when scrolled near bottom. No persistent "jump to latest" while scrolled back and idle | `Chats.svelte:242-255`, DCS:70,506-547,568-574, `ts/setting/accessibilitySettingsData.ts:154-173` |
| `scrollToLatestMessage` = `scrollIntoView` on the first child; it does not shrink the window | `Chats.svelte:206-213` |
| Per-effect-run `console.log('Updating Chats')` | `Chats.svelte:219` |

## 3. Images and heavy content in history

| Fact | Source |
|---|---|
| Inline images are plain `<img src=...>` emitted by the parser (assets, `{{inlay::}}`); no `loading="lazy"` or `decoding` in chat code. The only `loading`/`decoding`/`content-visibility`/`contain` hits in all of `src/` (non-test) are two settings thumbnails | `ts/parser/parser.svelte.ts:544,594,610,721`; grep of `src/` |
| Asset URL resolution is cached per path in an unbounded Map (not for `data:` URLs) | `parser.svelte.ts:440-452` |
| Inlay render URL form (blob vs data URI) not checked | `parser.svelte.ts:699-727` UNVERIFIED |
| Per-message avatar is a CSS `background: url(...)` of the full source image (`getCharImage(..., 'css')`), so no `<img>` attributes apply; the rail uses a `thumb` path instead | `ts/characters.ts:96-134`, `Chats.svelte:84-85` |
| `hideAllImages` setting swaps everything for a placeholder | `ts/characters.ts:105-111`, `ts/setting/displaySettingsData.svelte.ts:264` |
| `newImageHandlingBeta` runs `checkImg` (querySelectorAll + fuzzy asset matching with `getDistance` over all assets) after each parse | `ChatBody.svelte:184-273` |
| Custom theme HTML parsed per message; a theme `<style>` becomes one `<style>` per message | `Agents/Roadmap.md:6562` (F10, cites `Chat.svelte:759-768,1555`; not re-verified here; cost unmeasured) |
| Animated avatar/asset decode cost, GIF/APNG/WebP behaviour | UNVERIFIED (nothing measured) |
| Autoplay `<video>`/`<audio controls>` can be emitted for inlays | `parser.svelte.ts:724,727` |

## 4. What the campaign already measured or decided (references only)

All numbers: dev build, i9-13900K ("best case"), 3000-message / ~1 KB fixtures. No phone, Note 9 or Pi number exists for chat windows. `Agents/Live-State.md:67`: Note 9 / phone measurements "need their own live checks; none is claimed to have passed". `MC-010`: other stage measurements were on an i9-13900K / RTX 3090.

| ID / source | Content |
|---|---|
| `MC-021` (`Maintainer-Context.md:412`) | Four slowdowns: opening a long chat, sluggish after scrolling far back, streaming lag, typing lag |
| Report 19 `Agents/Reports/19-chat-list-window-plan.md` | §1 table (above); Stage A "A-lite" window reset on chat switch (shipped `96311c4a`); `changeChatTo` fan-out fix (`c99f914b`; 104.4 -> 66.2 ms at 600 mounted); §8 containment experiment |
| Report 19 §8.2 | `content-visibility:auto` + `contain-intrinsic-size:auto 297px` saved about 12% of one streamed write (12.0 -> 10.1 ms layout), nothing for typing; `contain: layout style` was worse (+20%); a wrong estimate (`auto 220px`) shrank scroll height 25.3% |
| Report 19 §8.3, §8.6, §3 | "Containment is not a substitute for bounding N"; recommended not to ship containment alone; order approved: Stage A, drafts, A2 shrink, B streaming, D tracker, E virtual scrolling only after durable drafts |
| Open | Durable drafts (foundational), A2 shrink on return to bottom, B (streaming), D (tracker selection cost, proceed only if >= 25% share), E (real windowing). `Agents/Roadmap.md:192` item 3: "real windowing of the chat list ... still open" |
| `CHORE-155` (`Roadmap.md:6553`) | One `ReloadGUIPointer` bump re-parses and remounts every windowed `ChatBody`; 20 writer sites; F7 hash loop model 0.11 ms (30 x 1 KB) to 4.3 ms (600 x 5 KB) per run |
| `CHORE-156` / `MC-257` (`Roadmap.md:6566`, `Maintainer-Context.md:8909`) | Decided: default streaming mode becomes "balanced" (not yet changed; existing-profile behaviour undecided), one Lua engine per script, superseded streaming parses finish but are not shown. Open measurement: share of each chunk on a mid-range phone and Pi-class with default mode |
| `CHORE-45` | Script cache cliff at about 999 messages; waits on memory-footprint work (`MC-119`) |
| `CHORE-157` | `ScriptingEditDisplayIds` never cleared (unbounded growth) |
| `MC-135` (`Maintainer-Context.md:4017`) | Maintainer's own save: longest chat 62 messages (488 KB), median message 5.4 KB; "chrome straight up crashes if chat gets long enough", so chats are kept short; "long chats that goes up to size of megabytes are common among the community" |
| `MC-136` | Cold storage archives whole characters when not open (stage 1); chat-level cold placeholders exist (`coldStorageHeader`) |

## 5. Existing user settings that affect long chats

| Setting (db key) | Default | UI definition | Source |
|---|---|---|---|
| `chatLoadInitialPages` "Initial Chat Load Count" | 30, min 1 | Advanced settings data | `ts/setting/advancedSettingsData.ts:98`, `lang/en.ts:580,1204` |
| `chatLoadAdditionalPages` | 15, min 1 | Advanced settings data | `advancedSettingsData.ts:102`, `ts/chatLoadPages.ts:2` |
| `streamingDisplayOptimizationMode` off/balanced/strong | off (labelled experimental per MC-257) | Advanced settings data | `advancedSettingsData.ts:148`, `ts/storage/database.svelte.ts:709` |
| `autoScrollToNewMessage`, `alwaysScrollToNewMessage`, `newMessageButtonStyle` | not checked | Accessibility settings data | `ts/setting/accessibilitySettingsData.ts:154-173` |
| `fixedChatTextarea` | not checked | Accessibility settings data | `accessibilitySettingsData.ts:48` |
| `hideAllImages`, `animationSpeed` | not checked | Display settings data | `ts/setting/displaySettingsData.svelte.ts:264,223` |
| `showMenuHypaMemoryModal` and memory toggles | not checked | Accessibility settings data | `accessibilitySettingsData.ts:98` |

The three `*SettingsData` files name the pages (Advanced, Accessibility, Display) but I did not trace the exact menu labels or navigation path (UNVERIFIED). There is no `lowPower` setting in chat code (`layout-perf-navigation.md` §2).

## 6. Synthetic experiment (indicative, NOT the app)

Files: `slice4/bench.html`, `slice4/run.mjs` (CDP driver, Node 24 global WebSocket, no dependencies), `slice4/results.json`. Headless Chrome 155 (Windows, 32 logical cores, same machine class as best case), 360 px wide `flex-direction:column-reverse` scroller, ~18 elements per message (avatar block + 2-5 paragraphs with inline tags), plain DOM (no Svelte, no markdown parse, no images). Variants: none vs `content-visibility:auto; contain-intrinsic-size:auto 220px` on each message wrapper. CPU throttle via `Emulation.setCPUThrottlingRate`. One run per cell, medians of 15 (stream) / 3 (load-more) reps; timings include a forced layout. Single run, noisy; read orders of magnitude only.

Streaming tick = grow newest message text + force layout. Load-more = prepend 15 messages + force layout. Rehash = JS hash of all message text (like `updateChatBody`).

| N mounted | CPU | stream tick, none / CV (ms) | load-more 15, none / CV (ms) | build all, none / CV (ms) | rehash (ms) |
|---|---|---|---|---|---|
| 30 | 1x | 0.1 / 0.0 | 0.6 / 0.2 | 45 / 1 | 0.9 |
| 600 | 1x | 0.4 / 0.4 | 3.4 / 0.6 | 67 / 19 | 3.5 |
| 600 | 4x | 6.0 / 2.8 | 33 / 4.0 | 515 / 149 | 19 |
| 600 | 6x | 9.0 / 3.8 | 33 / 7.6 | 1024 / 195 | 12 |
| 1000 | 4x | 7.5 / 4.9 | 52 / 5.3 | 869 / 135 | 22 |
| 5000 | 1x | 11.8 / 3.6 | 13.5 / 4.7 | 597 / 122 | 23 |
| 5000 | 4x | 80.6 / 39.8 | 78 / 53 | 4680 / 1303 | 103 |
| 5000 | 6x | 158.8 / 69.6 | 218 / 80 | 9958 / 2691 | 153 |
| 20000 | 1x | 156 / 20 | 271 / 17 | 4123 / 737 | 65 |
| 20000 | 4x | 846 / 154 | 1443 / 229 | 26878 / 6739 | 236 |

Reading (observations of this synthetic page only):
- Cost per layout pass scales roughly linearly with mounted count; the build cost is about 0.1 ms/message at 1x and 0.9-1.7 ms/message at 4x-6x in this plain-DOM model, a floor under the real app (Svelte component per message, async markdown, avatar promise).
- Under 6x throttle (a crude stand-in for a weak phone, not calibrated to a Note 9), 600 mounted messages cost a 9 ms layout per stream tick before any app work; with `content-visibility` 3.8 ms. The app also pays script work not modelled here.
- `content-visibility` shrank layout cost by 2-8x here at N >= 600, a larger effect than the app's own 12% (Report 19 §8.2). Likely reasons: my messages are simpler and my page has no per-message JS; the app's remaining cost is script and per-box. Do not treat this as contradicting Report 19.
- Scroll height with CV is wrong by construction in this bench (estimate 220 px; real about 760 px at 360 px width: 600 msgs 147,172 vs 458,047 px), which repeats Report 19's warning that a bad `contain-intrinsic-size` distorts scroll geometry.
- Not tested: real scrolling anchoring, images, Svelte mount, markdown, WebKit/Android WebView, paint.

## 7. Open questions for design

1. Is the target "bound the DOM" (true windowing/recycling, Report 19 stage E, which the maintainer sequenced behind durable drafts) or "make the unbounded window cheaper" (content-visibility, thumbnails, lighter message nodes)? Report 19 §3 order was maintainer-approved; changing it is theirs.
2. Should the redesign shrink the window when the user returns to the bottom (Report 19 A2)? That depends on durable drafts.
3. What device floor must slice 4 meet (Note 9? Pi 3?)? No chat number exists below the i9.
4. Default streaming mode: MC-257 decided "balanced"; the slice 1 append-only proposal changes this. Which owns it?
5. Long-chat affordances to design, not in the app today: persistent "jump to latest" when scrolled back, an in-chat search, a position/progress indicator for a 5k-20k chat, a visible "N older messages not loaded" boundary. Which are in scope for slice 4 vs a later slice? (Search needs a data design: search scans memory, cold storage, or both.)
6. `scrollToMessage` mounts everything newer than the target. Is a window "centred on target" acceptable, given the edit-draft constraints of Report 19?
7. Chat-level archiving: `MC-135` item 3 keeps it in scope; the UI for loading/failed/archived chats must be designed (cold placeholder text exists at DCS:818-833).
8. Is it acceptable for the design package to assume a chat-granular save (cost no longer per character), or should it stay UI-only? The current save is whole-character JSON, so very long chats make every edit or stream-end save heavier regardless of UI.

## 8. Proposals (not facts)

- Treat Report 19's order as the base. UI-side additions that need no data-layer change: height estimate from measured heights (not constants) if `content-visibility` is used; thumbnails for message avatars; `loading="lazy" decoding="async"` for inline images; reserve image space; a persistent jump-to-latest control that also shrinks the window; an "older messages" boundary row instead of silent growth.
- Define explicit design budgets: per stream tick and per +15 load on a stated slow profile (for example 6x CPU throttle) and record against the numbers in section 6 only as a floor.
- Replace the 4 s image wait + DOM poll in jump with a window-centred-on-target mount plus a visible loading state.
- Adaptive/append-only streaming and `content-visibility` are already proposed in `SLICE1_SPEC.md` §6; keep slice 4 to window policy, jump/search/position UI and archive states.

## 9. Search limits

- Source reading only; no app run, no device, no WebKit/Android measurement. Synthetic bench is plain DOM, one run per cell, and unrelated to Svelte.
- Not traced: memory modules (`hypamemory`, `hypav2/3`, `supaMemory`, `hanurai`) internals; `exportChat`/`exportAllChats`/branch copy cost; `ChatList.svelte` and `SideChatList` cost; inlay render URL type; `Chat.svelte` themes/custom HTML (taken from Roadmap citations); exact settings menu paths and defaults other than the chat-load and streaming ones.
- Save-granularity claim rests on `risuSave.ts` (`encodeCharacterBlock`, grep for `toSave.chat`) and `dbChangeEffects.svelte.ts`; other save paths (cold storage, node store) were not read.
- Campaign records read: Report 19 in full, `MC-021`, `MC-135`, `MC-257`, `CHORE-45/155/156/157` entries, Decision-Index and Roadmap grep hits. `Live-State.md` was grepped only (long lines omitted). `chatperf\packet.md` / `verify.md` cited by the Roadmap were not located or read. `Agents/Evidences of Investigations/` and `Agents/Reports/` beyond Report 19 were not read. No secrets, no network.
