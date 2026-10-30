# Chat hooks batch 1

Status: **draft, revision 3** (2026-10-27; **sections J and I override earlier sections where they differ**: review fixes DD-130 to DD-137 and Settings DS-055 / DS-056). Task: [tasks/2026-10-25-chat-conversation.md](../tasks/2026-10-25-chat-conversation.md). Builder notes and results: [checks/builder-checks-hooks1.md](checks/builder-checks-hooks1.md). Builds on [SLICE1_SPEC.md](SLICE1_SPEC.md), [SLICE2_SPEC.md](SLICE2_SPEC.md) (sheets, This chat, Back stack) and [TOGGLES_SPEC.md](TOGGLES_SPEC.md) rev 3 §14.

Three queued cross-lane items, in this order:

- **A. The failed-reply card** (Settings DS-043; shape agreed with the Settings lane on 2026-10-27, see [settings/SLICE3_SPEC.md](../settings/SLICE3_SPEC.md) §6): `window.__chat.failReply`.
- **B. The preset chip in the chat header** (Settings DS-020, DS-023, DS-026, DS-042; contract in [settings/SLICE2_SPEC.md](../settings/SLICE2_SPEC.md) §6 and §9): chip, a stand-in switcher, a stand-in model picker, Ctrl+P / Ctrl+1–9 / Ctrl+M.
- **C. The shared-file hooks** that TOGGLES_SPEC §14 listed: nine asked for, eight done in full, one with a remainder (§C.10).

Marked **(design default)** = chosen here within decided intent, open to veto. Everything is synthetic: persistence, providers and Settings navigation are simulated. A mockup pass is not proof of native behaviour or performance.

## 0. Entry points

| What | URL (from `docs/design/chat/`) |
|---|---|
| Failed-reply card, one state per reason | `slice1.html?state=hk-fail-key`, `-model`, `-quota`, `-network`, `-server` |
| A failed New reply on a reply that has alternatives | `slice1.html?state=hk-fail-regen` |
| The round trip from Settings | `slice1.html?state=hk-fail-return`, or the real shape `slice1.html?from=settings&retry=<msgId>` |
| Chip and switcher states | `hooks1.html?state=hk-chip`, `hk-chip-long`, `hk-chip-switcher`, `hk-chip-search`, `hk-chip-menu`, `hk-chip-alert`, `hk-chip-alert-switcher`, `hk-chip-toast`, `hk-pal`, `hk-model`, `hk-slot-empty` |
| Parameters | `lang=ko\|en`, `reduced=1`, `lowpower=1`, `preset=linux-desktop` (wide layout), `w=<px>` (frame the app), `active=<preset id>` and `char=long` (chip page) |
| Demo controls | `hooks1.html` sidebar › "채팅 훅 데모": open the switcher / menu / model picker, switch the failed save on and off, long names, one button per failure reason, "다음 시도도 실패" |
| Checks | `cd docs/design/chat/checks; node run-fast.mjs hk [section …] [--base http://localhost:<port>/chat]` (own server: `node serve.mjs 6176`) |

Why the chip lives on its own page: the chip needs slice 2's header (character name plus chat-name subtitle). Putting it in `slice2.html` would change the header of every existing page and suite; `hooks1.html` is slice 1 + slice 2 + `hooks1.js`, so the existing pages are untouched except by the hooks (C) and the failed-reply card (A, which is slice 1 and invisible until `failReply` is called). In the app the chip is always on (SLICE2_SPEC §6).

## A. The failed-reply card (DS-043)

### A.1 API (the agreed shape, kept exactly)

```js
window.__chat.failReply(msgId, { reason: 'key'|'model'|'quota'|'network'|'server',
                                 fix: 'key'|'model'|null, conn: '<id>', detail?: '<short text>',
                                 chat?: '<chat id>' })   // -> true | false (unknown message, or not a reply). chat is new in rev 2 (I.5); calls without it behave as before
```

- An unknown `reason` falls back to `'server'`; an unknown `fix` to none; `conn` is stringified.
- Single-reply path (slice 1). Slice 3 group rounds drive their own streams and are not covered.
- Other members of `window.__chat`, used by the demo controls and the checks:

| Member | Does |
|---|---|
| `retryFail(msg)` | 다시 시도: regenerates the failed reply in place |
| `failNext(opts, afterMs = 700)` | the next generation fails after `afterMs` with `opts` (`null` clears) |
| `demoFail(reason, { after, immediate, regen, override })` | starts a reply that fails with the synthetic failure for that reason |
| `history()` | what a request would send: every message except a failed reply |
| `actionToast({ text, actions: [{ label, icon, href?, run?, close?, title? }], ms = 10000, onClose })` → `{ close, el }` and `closeActionToast(animate)` | a status line with buttons (§D) |
| `restoreFromSettings()` | the return handling (A.4), runs at load |
| `openPlus` | C-6 |
| `DEMO_FAIL`, `FAIL_REASONS` | the synthetic failures and the reason list |

Message model: a failed reply is a normal message with `m.fail = { reason, fix, conn, detail }` and (after a Settings round trip) `m.fcReturn = true`. It has **no** text of its own.

### A.2 The card

Replaces the streaming reply inside the message (the `.reply-body`), under the usual name row.

```
[circle-alert]  {one-line reason}
                자세히: {detail}              (only when detail is given, secondary text)
[wrench 고치기]  [rotate-ccw 다시 시도]       (고치기 only when fix is set)
```

- `role="alert"`; the node is created once, so it is announced once. A language switch, a refresh or a re-render updates its text in place and inserts no second alert. A screen-reader-only prefix "답변을 만들지 못했어요: " gives the reason its context.
- Icons: lucide `circle-alert`, `wrench`, `rotate-ccw`.
- **고치기** is a real link: `../settings/slice3.html?fix=<fix>&conn=<id>&back=chat&msg=<msgId>` (exactly these five parameters since rev 2: `fix`, `conn`, `reason`, `back=chat`, `msg`; see I.7). Opens in place, not a dialog.
- **다시 시도** is a button. It regenerates **in place** (A.3).
- The card takes the focus ring (`outline-offset: -2px`: the stage clips outside outlines), has `tabindex="-1"` so it can receive focus after a return, and its two buttons join the roving tab order of the active message.
- Layout: a bordered block with a faint red tint (no blur), buttons 44 dp, wraps at 360 px.

Copy (Korean first; one line each, one per reason):

| reason | fix | 한국어 | English |
|---|---|---|---|
| `key` | `key` | API 키가 없거나 맞지 않아요 | The API key is missing or was rejected |
| `model` | `model` | 고른 모델을 쓸 수 없어요 | The selected model isn't available |
| `quota` | `key` (connection detail: key and test, Settings table) | 사용량 한도를 넘었어요 | The usage limit was reached |
| `network` | none (`key` for a 호환 URL, if the caller passes it) | 서비스에 연결하지 못했어요 | Couldn't reach the service |
| `server` | none | 서비스에 문제가 생겼어요 | The service had a problem |

The fix column is the Settings table; this lane displays whatever `fix` the caller passes. Buttons: 고치기 / Fix, 다시 시도 / Try again. Detail line: 자세히: {detail} / Details: {detail}.

### A.3 Where the failed reply sits

- **Keeps its place.** It is the same message that was streaming (same id, same position). A reply to a new user message becomes a message with the card and no alternatives; a New reply on a reply that already has alternatives keeps those alternatives and the position you were looking at (5 alternatives showing the 3rd stay 5, showing the 3rd).
- **Not a swipe.** The empty alternative the generation had started is dropped. The pager, the "New reply" button, swipe, the pull-to-regenerate and the arrow keys are off for a failed reply (it is never an alternative).
- **Not history.** `__chat.history()` leaves it out; a request builder must do the same.
- **A name row always shows** on a failed reply, even after a reply from the same speaker, so the message pins sit in the name row and never on the card.
- **다시 시도** (button, Ctrl+Alt+R with focus on the reply, or the return row): clears `m.fail`, starts a new generation in the **same message**; a reply that has alternatives gets the new one appended (5 → 6) and the message keeps focus. Fails again → the card again with the new reason. A failed reply that already has later messages after it keeps its place there and its 다시 시도 regenerates there too (design default; the other option, removing it when the user sends again, was not chosen).
- **Delete** works like any message (undo row); Undo puts the same card back in the same place.
- The card is not touched by `hideAI`, bookmark and the other message actions (they act on an empty message; nothing to show).

### A.4 The round trip

```
failed reply ── 고치기 ──► settings/slice3.html?fix=…&conn=…&reason=…&back=chat&msg=27 ──► (fix) ──► chat/slice1.html?from=settings&retry=27[&changed=1]
```

- Loading `slice1.html?from=settings&retry=<msgId>` reopens the chat with the failed reply back in its place, **focus on that card**, and an inline status row under it: **"설정을 바꿨어요 · 다시 시도할까요?"** with **다시 시도** (rotate-ccw) and **닫기** (x). The Settings spec calls this a toast; it is an inline row here because slice 1 DD-029 keeps everything off the transcript (§D lists the floating action toast, which the other flows use).
- **It never retries by itself.** The row stays until you retry or dismiss it (design default: no timeout; the decision to retry can take as long as reading the fix).
- 닫기 removes the row, keeps the card and moves focus to it.
- `retry=` without `from=settings` does nothing.
- **Simulated persistence.** A real app keeps the failed message in the chat; the mockup page is reloaded by the navigation, so `failReply` stores `{ id, reason, fix, conn, detail }` in `sessionStorage['hk1.failed']` (dropped on retry) and the return rebuilds the card from it. Without an entry (a fresh tab, a link typed by hand) the card is rebuilt from `?reason=&fix=&conn=` if present, else as `reason=key, fix=key`. A `retry` id that already belongs to an ordinary message is left alone and a new failed reply is added.

### A.5 States

`slice1.html?state=hk-fail-key|model|quota|network|server` (one card each), `hk-fail-regen` (a failed New reply on a reply with 5 alternatives), `hk-fail-return` (card + return row + focus, as after Settings). Demo controls start a real generation that fails after 0.7 s (any reason; "New reply fails"; "다음 시도도 실패" makes the retry fail too).

## B. The preset chip (DS-020, DS-023, DS-026, DS-042)

### B.1 What it is

A pill in the chat header's right group, before `⋯`: `bookmark` icon + "프리셋 · 모델", e.g. "균형 · Sonnet 4.5". It is a 44 dp target around a 36 dp pill (the same trick as the message-extras chips). It never moves into the This chat sheet (DS-020).

### B.2 Width rule

Implemented as measured, not as media queries, because the character name has priority and the real widths depend on the name. "Header width" is the header row's width (on wide screens that is the main column, not the window).

| Header width | Chip | Cap |
|---|---|---|
| ≥ 480 px | icon + name + model | 40 % of the header: **the model drops first**, then the name truncates |
| 400–479 px | icon + name | 30 %: if fewer than **6 characters** of the name stay readable (R-10), icon only |
| < 400 px | icon only (44 dp) | — |
| any width | icon only when **the character name would show fewer than 8 characters** with the chip in its current form | — |

- "Readable characters" count the ellipsis as one em (a text cut to "아주 길고…" is 5 characters, not 6).
- The ladder per header is `full → name → icon`; the first form that satisfies the cap and both character rules wins. The result is on the element (`data-mode`, `data-tier`, `data-why`: `model`, `name<6`, `char<8`) and is recomputed on resize, language change, preset change and chat change (C-4).
- **Accessible name and tooltip** are always the whole thing: "프리셋: 균형 · Sonnet 4.5" (English "Preset: 균형 · Sonnet 4.5"), also in the icon-only form.
- While the switch toast is up the name says what changed: "프리셋: 번역용 · Haiku 4.5 · 방금 ‘균형’에서 바꿨어요". It returns to the plain form with the toast.
- `aria-haspopup="dialog"`, `aria-expanded` while the switcher or menu is open, `aria-keyshortcuts="Control+P"`.

### B.3 Opening it

| Gesture | Result |
|---|---|
| Tap, click, Enter, Space | the switcher: a **380 px popover** under the chip on wide screens (≥ 900 px), a **tall sheet** on phones (the 768 px layout is still the phone layout) |
| Long-press (touch, 0.5 s, moving > 10 px cancels), right-click, **Shift+F10**, the Menu key | a menu: **프리셋 관리** (→ `../settings/slice2.html?page=models&section=models.presets&view=library&from=chat`) and **모델·프리셋 설정 열기** (→ `…&section=models.presets&from=chat`) |
| Ctrl+P (anywhere, text fields included) | the switcher as a **560 px palette** centred near the top on wide screens; the tall sheet on phones; again = close |
| Ctrl+1–9 | the preset in that slot, with the switch toast; an empty slot says "Ctrl+5에 지정된 프리셋이 없어요" with **지정하기** (→ the library; a deep link to the slot dialog is not defined, §F) |
| Ctrl+M (DS-042) | the model picker stand-in |

Keys follow DS-023: they work in text fields (the message box too) and are ignored during IME composition (`isComposing`, keyCode 229, or between compositionstart and compositionend) and in inline rename inputs; they are left alone while any other sheet or menu is open. `preventDefault` stops the browser's print dialog (Ctrl+P) and tab mute (Ctrl+M in Firefox, not checked).

After a long-press the lift must neither close the menu nor take focus out of it: the tap guards of slice 1 restart from the lift.

### B.4 The switcher and the picker are stand-ins

**The real switcher is the Settings slice 2 switcher** (SLICE2_SPEC §2: recents, ★ favourites, folders, search with 초성, 300-preset budget, failed-save guard, library undo). The stand-in only needs to prove the chip's behaviour: search field (44 dp, focused first; combobox + listbox + `aria-activedescendant`), 최근 / ★ 즐겨찾기 / 모든 프리셋 with each preset once, name + model + slot badge + check, search by name, folder and model, Up/Down/Home/End/Enter/Esc, 프리셋 관리 in the footer. The model picker is the same list over six synthetic models; choosing one edits the active preset's model with an undo toast (Settings slice 3 §5 and DS-042: "choosing closes it and shows the chat toast with undo"). The real picker is the slice 3 picker.

- Switching closes the sheet, puts focus back on the chip (or the message box for Ctrl+P), and shows the toast **"프리셋을 바꿨어요 · ‘{name}’"** with **실행 취소**, 10 s. Choosing the active preset only closes.
- A reply that is still being written keeps going; the chip changes at once and the next request uses the new preset (the Settings default).
- Korean wording note: Settings §2.3 wrote "‘{name}’(으)로 바꿨어요". Settings DS-038 says no particle may follow a user-supplied name, so the toast puts the quoted name last.

### B.5 The alert state (DS-026)

A failed preset save: the chip shows `triangle-alert` instead of `bookmark`, a red outline (a 3 px double outline in forced colours), data-alert="1", and its name and tooltip end with "· 저장 실패". Entering the state is announced once ("프리셋을 저장하지 못했어요 …"). The switcher then shows a failure row above the search: **다시 시도** (simulated save succeeding → "저장했어요") and **변경 취소** ("변경을 취소했어요"), both clear it. The Settings guard that asks before switching (R-07, N-07) is the real switcher's; the stand-in does not block a switch.

### B.6 States

`hooks1.html?state=hk-chip` (plain), `hk-chip-long` (41-character preset, 21-character character name), `hk-chip-switcher`, `hk-chip-search` (`q=` optional, default 롤 / casual), `hk-chip-menu`, `hk-chip-alert`, `hk-chip-alert-switcher`, `hk-chip-toast`, `hk-pal` (Ctrl+P), `hk-model` (Ctrl+M), `hk-slot-empty` (Ctrl+5). Widths are the viewport (360, 412, 480, 768, 1280).

## C. Shared-file hooks (TOGGLES_SPEC §14)

Where: `slice1.js` (sheets, icons) and `slice2.js` (This chat, Back stack); `toggles.js` now uses them instead of its workarounds. Event and hook names are the API.

| # | Hook | API | What `toggles.js` no longer does |
|---|---|---|---|
| C-1 | **`openSheet` resets the body class** | `body.className = 'sheet-body'` before the builder runs. Fixes the real bug: the toggles panel's `tgp-body` (and slice 2's `s2-this`) stayed on the sheet body and collapsed the next sheet (the + menu was 49 px high). A builder that sets its own class still gets it. | the observer that removed `tgp-body` |
| C-2 | **Sheet-closed event** | `document` event `chat:sheetclosed`, `detail: { kind: 'sheet'\|'menu', opener, restored }`. Fires once for every way a sheet closes (Back, Esc, backdrop, drag, an item, code), after the focus restore, never for `swapSheet`. | the observer on `#sheetRoot`; also makes an inert dock safe (focus is already restored when the event fires) |
| C-3 | **`pushBack` stack** | `__slice2.pushBack(fn)` adds a Back layer for the sheet that is open (valid however often it is swapped); Esc / Back pops and runs the top; `__slice2.popBack()` drops the top without running it. A closed sheet empties the stack. `S2.sheetBack` stays as a one-layer accessor for slice 3 (assigning `{ fn, at }` replaces the stack, `null` clears it). New: `Sh.gen` in slice 1, counting `openSheet` calls. | the hand-written `{ fn, at }` slot, the re-registration after every layer and the "register again" after Esc in the inline editor |
| C-4 | **Chat-switch hook** | `window.__s2hooks.chatChanged(chat, character)`; runs at the end of slice 2's header update: chat open or switch, no chat (`chat` is null), language change. | the observer on `#hdrChat` |
| C-5 | **Replace or skip the toggles group** | `__s2hooks.togglesGroup(body, chat, helpers)`; return `true` after appending your own section and the built-in group is not built; falsy = built as before. `helpers` = `{ grp, swRow, btnRow, mkEl, flash, ic2, t2, ic }`. Plus `__s2hooks.thisChatBuilt(body, chat)` after the sheet is complete. | building the group and replacing it afterwards; the one-frame window |
| C-6 | **`openPlus` export** | `__slice1.openPlus()` (also `__chat.openPlus`): the same + menu as the button. | `#plusBtn.click()` after an option list |
| C-7 | **Slice 1 menu keys over `[role^="menuitem"]`** | `menuitem`, `menuitemcheckbox`, `menuitemradio`: Up/Down/Home/End wrap over all of them. | its own Up/Down/Home/End handler with `stopImmediatePropagation` (it keeps Left/Right for the chip row, which slice 1 has no concept of) |
| C-8 | **Filled icons** | `ic(name, size, cls)` unchanged; the third argument may also be `{ cls, fill: true }`; `item([name, { fill: true }], …)` passes it through. | its own filled star SVG and the icon swap in the row menu |
| C-9 | **One scope-aware accessor** | `__s2hooks.access = { get(key, chat), set(key, value, chat), label(key, chat), scope(key, chat) }` for `'jailbreak'` (the switch) and `'memory'` (the row text); without it slice 2 reads and writes `TG.jb` and shows `TG.memory` as before. `scope()` returns `'chat'` or `'all'` and picks the saved note. | the capture-phase `change` listener and the text patch on the memory row |

### C.10 Not done, or done in part

- **The DD-086 regrouping still moves two DOM nodes.** While chat-only is on, the jailbreak switch and the memory row sit in the "이 채팅" group (TOGGLES_SPEC §11). That is a layout choice, not a value; it now runs from `thisChatBuilt` once per build instead of from a MutationObserver, but it is still DOM surgery. A clean hook would let slice 2 ask `access.scope()` and place the rows itself; that needs a layout decision in slice 2 and was left.
- **`swapSheet` does not reset the body class** (only `openSheet`, as the hook list asked). Every current swap builder sets its own class. A reset there would risk the layers that rely on keeping `s2-this` between a swap and a rebuild.
- **Slice 3 still uses the one-slot `S2.sheetBack`** (kept working, covered by checks); migrating it to `pushBack` touches slice 3's group builder and was not needed.
- **A non-modal right-panel slot in the shell** (TOGGLES_SPEC §14, last item, not in the list for this batch) stays: the dock is still the panel's own `<aside>`. The new event makes an inert dock possible; it was not switched on, to keep the toggles behaviour exactly as pinned.

## D. The action toast (shared helper; rev 2: an inline row, see I.1)

`__chat.actionToast({ text, actions, ms, onClose })`: one status line with buttons above the composer, below any open sheet (z-index 40 < 50) so it never covers a dialog's actions. At least `min(100vw − 32 px, 360 px)` wide, the message wraps to two lines before the verb is cut. `role="status"`, text set 40 ms after insertion so it is announced once. **The timer pauses while the pointer or focus is inside and resumes with the time it had left** (at least 800 ms), so a toast is shown for at least `ms` in total (Settings R-04). One at a time: a new toast replaces the old one and the old one's timer cannot close the new one. If focus is inside when it closes, focus moves to the active message or the composer, never to the body. Buttons can be links (`href`) or actions. Reduced motion: opacity fade 0.12 s; low power: none; forced colours: outlined, `LinkText` buttons.

## E. Integration map (lane A; nothing here edits these files)

| Change | Where (read-only reference) |
|---|---|
| A typed failure on the request path: `{ reason: key\|model\|quota\|network\|server, fix, conn, detail }` instead of a string. Pre-send check for a missing key or model. | `src/ts/process/request/request.ts` and the providers (`anthropic.ts`, `openAI/requests.ts`, `google.ts`); Settings SLICE3_SPEC §8 asks for the same typing |
| Today an error is `alertError(error)` (a modal) or, with `inlayErrorResponse`, a ` ```risuerror ` block **appended to the reply's text**, which then travels as history in later requests. New: the failure goes on the message (`Message.fail`), not into its text, and the history builder skips it. | `src/ts/process/index.svelte.ts:551-606` (`throwError`), `Message` at `src/ts/storage/database.svelte.ts:1941`, the history build in `sendChat` |
| The card (reason, 고치기, 다시 시도, focus ring, role=alert once) replaces the reply body; pager / New reply / swipe off for a failed message | `src/lib/ChatScreens/Chat.svelte` and the message list in `DefaultChatScreen.svelte` |
| 다시 시도 = the regenerate path on the same message (a new alternative if it has any) | the regenerate/reroll call in `index.svelte.ts` |
| 고치기 / return: an in-app route to the exact connection or model field (`fix`, `conn`, the failing row), and back to the chat with the failed message id (the stable chat id; the mockup's `msg` / `retry` parameters carry it). The failed message must survive the trip (it is a message, so it does) | Settings lane; app router/overlay stack |
| Return row: "설정을 바꿨어요 · 다시 시도할까요?" as an inline status row under the card | chat message component |
| Header chip + the width rule | the chat header (chat slice 1 integration map; Settings SLICE2_SPEC §9) |
| Real switcher (popover / sheet / palette), the slot keys, the failed-save guard | Settings lane (slice 2 §2, §7, R-07); replaces the stand-in. **The slot keys (Ctrl+1–9) and Ctrl+P go through the same failed-save guard as the chip** (DD-134, I.6) |
| Failure on a chat that is not open: the typed failure carries the chat id and waits on that chat's message (I.5) | `src/ts/process/index.svelte.ts` (a generation that outlives its chat view), the chat list status in slice 2's integration map |
| Ctrl+M model picker, Ctrl+P / Ctrl+1–9 in text fields | `src/ts/hotkey.ts:309-366`, `src/ts/defaulthotkeys.ts:64-77` (`modelSelect`, `presetSlot1..9`) |
| Action toast with buttons, pause on hover/focus | `src/ts/alert.ts` (`alertToast` has text only today) |
| C-1…C-9 | the sheet/menu host and the This chat builder of the redesigned shell: reset the sheet body per sheet, one close event, a Back stack, a header-change event, an override for the toggles group, an exported "open + menu", menu keys over all `menuitem*` roles, a fill option on the icon helper, and one accessor for the two scope-dependent values |
| Strings | `src/lang/en.ts`, `ko.ts` (§G) |

## F. Open questions (nothing here is decided)

- **O-1 Language across the trip.** The agreed link has no `lang` parameter, the chat mockup defaults to English and Settings to Korean. Add `&lang=` to both directions?
- **O-2 A failed New reply on a reply with alternatives.** The card hides the pager, so the earlier alternatives cannot be reached until the card is gone (delete, or a successful retry). Should the card get a third action (e.g. "이전 답변 보기") or a dismiss?
- **O-3 Return row lifetime.** Stays until acted on; a timeout (and its length) is open.
- **O-4 `detail`.** Shown as a visible secondary line. Technical strings (HTTP 401, model ids) may confuse; hide behind a disclosure?
- **O-5 Failed message after the next send.** Kept in place (default here). Alternative: drop it when the user sends again.
- **O-6 Persistence of a failed message** across restarts, exports, branching and copy: not specified (the mockup only simulates the return trip).
- **O-7 지정하기 destination** for an empty slot: the library today; Settings has no deep link to the slot dialog.
- **O-8 Chip default.** Always on in the app (SLICE2_SPEC §6); in the mockup it is on `hooks1.html` only.
- **O-9 Switch toast.** 10 s with pause is the Settings default; the wording follows DS-038.
- **O-10 Preset names in the chip** are user data in any language and are never translated; the model's short name is whatever Settings provides.

## G. Copy keys (proposed, en / ko)

| Key | en | ko |
|---|---|---|
| fcFailed | Couldn't write the reply | 답변을 만들지 못했어요 |
| fcReason_key / model / quota / network / server | (A.2 table) | (A.2 table) |
| fcFix / fcRetry / fcClose | Fix / Try again / Close | 고치기 / 다시 시도 / 닫기 |
| fcChanged | Settings changed · Try again? | 설정을 바꿨어요 · 다시 시도할까요? |
| fcDetail | Details: {detail} | 자세히: {detail} |
| chipLabel | Preset: {name} · {model} | 프리셋: {name} · {model} |
| chipChanged | Preset: {name} · {model} · just changed from "{from}" | 프리셋: {name} · {model} · 방금 ‘{from}’에서 바꿨어요 |
| chipAlert | {label} · save failed | {label} · 저장 실패 |
| menuManage / menuOpen | Manage presets / Open model and preset settings | 프리셋 관리 / 모델·프리셋 설정 열기 |
| swTitle / swSearch | Switch preset / Search presets | 프리셋 바꾸기 / 프리셋 검색 |
| swRecent / swFav / swAll | Recent / Favourites / All presets | 최근 / 즐겨찾기 / 모든 프리셋 |
| switched | Switched to "{name}" | 프리셋을 바꿨어요 · ‘{name}’ |
| switchedBack | Switched back to "{name}" | 프리셋을 되돌렸어요 · ‘{name}’ |
| slotEmpty / assign | No preset is assigned to {key} / Assign | {key}에 지정된 프리셋이 없어요 / 지정하기 |
| alertNote / retry / discard | Couldn't save the preset / Retry save / Undo the change | 프리셋을 저장하지 못했어요 / 저장 다시 시도 / 변경 취소 |
| mdTitle / mdSet | Choose a model / Model changed to "{model}" | 모델 고르기 / 모델을 바꿨어요 · ‘{model}’ |

The full tables are at the top of `hooks1.js` (`HKI`) and in `slice1.js` (`fc*`, `at*`).

## H. Motion and accessibility

Only `transform` and `opacity` animate; no blur. Reduced motion (the toggle, `?reduced=1`, or the OS media query): the return row and the toast fade 0.12 s, the palette has no slide. Low power: no row animation, no toast or palette transition, sheet durations ≤ 0.12 s. Forced colours: the card keeps a 2 px `CanvasText` outline on `Canvas`, the 고치기 link is `LinkText`, the chip pill is outlined and the alert chip has a 3 px double outline. Targets 44 dp. The card's focus ring is inside the card. Floor (Note 9 / Pi 3): no new JavaScript newer than what slice 1 already uses; flex `gap` is used the way slice 1 already uses it (no fallback added); `:has()` only dims the palette's backdrop and degrades to no dimming.

## I. Revision 2: review fixes (the maintainer decisions DD-130 to DD-137, Settings DS-055 / DS-056)

Review: [reviews/2026-10-27-chat-hooks1-review.md](../reviews/2026-10-27-chat-hooks1-review.md). Where this section differs from A to H, this section wins.

### I.1 Confirmations are an inline row, not a toast (DD-130, review F-1, F-15)

The preset switch, the empty slot and the model change no longer float. `__chat.actionToast(…)` keeps its signature and now draws one **status row in the flow above the input bar** (a child of the main column, between the extras and the composer; the same look as the delete undo row and the return row: dashed edge, 44 dp, `role="status"`). The transcript shrinks to make room and stays at the bottom, so the failed card, the pager and the last lines are never covered (checked at 360 × 740 and 360 × 560 with the reviewer's repro: fail a reply, switch preset). Everything else of D stays: 10 s, the pause while the pointer or focus is inside and the resume with the time left, one at a time, text set after insertion, focus never drops to the body, reduced motion = a 0.12 s opacity fade, low power = none, forced colours = outlined with `LinkText` buttons. The old z-index-below-sheets rule is moot; the row is in the flow.

### I.2 Alt+Z undoes the switch (DD-131, F-2)

An action with `undo: true` is also run by **Alt+Z** from anywhere in the chat while its row is up, text fields included. Ctrl+Z stays with text fields (and slice 1's delete undo). The undo button advertises it (`aria-keyshortcuts="Alt+Z"`, title "실행 취소 (Alt+Z)"). Reach by Tab: at most 12 stops from the chip and 4 Shift+Tab presses from the message box (the row sits right above the composer). Alt+Z does nothing when no row is up and after the row has closed. It also undoes a model change. Matched by `code` (`KeyZ`), so it works on a Hangul layout.

### I.3 The return row has no retry button (DD-132, F-8)

"설정을 바꿨어요 · 다시 시도할까요?" is text plus 닫기. On return, focus goes to **the card's 다시 시도**; 닫기 also moves focus there. One retry control per failed reply, three tab stops in the reply (고치기, 다시 시도, 닫기). The Settings lane aligns SLICE3 §6 (this lane does not change the Settings-side wording).

### I.4 The row only after a change (Settings DS-055)

`slice1.html?from=settings&retry=<msg>[&changed=1]`. With `changed=1` (a Settings change that can affect the failing request): rebuild the card, focus its 다시 시도, show the row. Without it: rebuild the card and focus its 다시 시도, **no row**. Any other value of `changed` is "no row". Nothing retries by itself in either case.

### I.5 One failed card for open and background chats (DD-133, F-4)

`failReply(msgId, { …, chat })`: `chat` is a chat id. For the open chat (or no `chat`) it takes the route of A.3. For another chat, slice 2's hook `S.hooks.failElsewhere(chatId, msgId, fail)` (returns `false` = open chat, `1` = done, `0` = unknown message) marks the message failed where it lives; the generation that was running there is stopped, its unfinished alternative is dropped (same count and position as before it started), the sidebar status, the strip note and the announcement stay, and the card is there when the chat is opened (announced once, then). It **replaces slice 2's red "답변을 쓰지 못했어요" note**, which is no longer drawn; slice 2's demo failure (the provider times out half way) now ends in a card with reason `network`, detail "timeout" and no 고치기. A call without `chat` for a message that is not in the open chat returns false as before (documented, not silent: it is logged).

### I.6 The failed-save guard (DD-134, F-5)

Every way of switching goes through DS-026 / R-07: choosing a row in the switcher, Ctrl+1–9. When the chip shows "저장 실패" they open a three-way choice **다시 시도 / 변경 취소 / 취소** ("프리셋을 바꾸기 전에"): 다시 시도 (the simulated save succeeds) and 변경 취소 clear the alert and then the switch goes ahead; 취소 changes nothing. The alert is never moved to the newly selected preset. Ctrl+P opens the switcher, which shows the failure row on top and applies the same guard to the choice. The slot keys therefore need the same guard in the app (added to §E). Copy: guardTitle "Before switching preset" / "프리셋을 바꾸기 전에", guardBody "Couldn't save the preset. What now?" / "프리셋을 저장하지 못했어요. 어떻게 할까요?"; the three choices reuse retry / discard (§G) and Cancel / 취소.

### I.7 Smaller fixes

- **Link** (Settings DS-055): `../settings/slice3.html?fix=<fix>&conn=<id>&reason=<reason>&back=chat&msg=<msgId>`; `fix` stays `'key'|'model'|null`. A hosted provider's network error has `fix: null` (DS-056), so there is no 고치기 for it; the null handling already covers this. Checked for every reason that has a fix (key, model, quota); network and server have no link.
- **A failed reply's actions (DD-135, F-3):** only delete (and "Customize buttons") plus the card's two buttons. Copy, select text, edit, translate, read aloud, previous / next / New reply, branch, bookmark and hide are not offered (pins, hover row, menu); Ctrl+C on it copies nothing and shows no "복사했어요"; arrow keys no longer step behind it.
- **Pins never sit on the card (F-6):** a failed reply always has its pin row, also with "이름과 아바타 숨기기"; the card has an 8 px top margin so the hit areas do not overlap it.
- **Letters by code (F-7):** Ctrl+P / Ctrl+M use a Latin `e.key` when there is one (Dvorak, AZERTY) and the physical key (`KeyP`, `KeyM`) when `e.key` is a Hangul jamo. The IME guard is unchanged. Digits already used `code`.
- **The browser's own action (F-13):** Ctrl+P, Ctrl+M and Ctrl+1–9 are prevented even when the chat ignores them (another sheet open, Home, the phone sidebar), so a browser build does not print or mute. Inside inline rename inputs and during composition they are left entirely alone.
- **A cut-off composition (F-16):** a blur resets the composing flag.
- **URL and storage (F-9):** a retry, a dismiss or a delete removes `from`, `retry`, `changed`, `reason`, `fix`, `conn` from the address (`history.replaceState`); delete also drops the stand-in storage entry (Undo puts it back). A reload after a successful retry shows no card.
- **Fix validation (F-10):** the return fallback accepts `fix` only as `key` or `model`.
- **Only a reply can fail (F-11):** `failReply` on a message the user wrote returns false.
- **Accent (F-18):** 고치기 is drawn in the accent colour; 다시 시도 is not.
- **`aria-current` for "in use" (F-20):** switcher rows use `aria-current` for the active preset and `aria-selected` for the highlighted row (the one `aria-activedescendant` names).
- **세라핀 (DD-137, F-12):** slice 1's sample character, chat title and sample messages say 세라핀 (particles adjusted: 세라핀이 / 은 / 을 / 과). No existing check hard-coded the old spelling.

### I.8 Not changed, on purpose

- **DD-136:** the card keeps covering the pager; no "show previous" action.
- **F-21 (buttons inside the `role="alert"` node):** kept, because the agreed shape says the card has `role="alert"`; the announcement reads the two button names after the reason. Moving the actions out of the alert is a one-line change if the Settings lane agrees.
- **F-14 / Q-5 (the chip changes form with the preset name):** as built. Korean glyphs are full width, so 30 % of a 412 px header shows about 5 Hangul characters; a nine-character preset name is therefore icon only at 412 and shows its name at 440. The label always carries everything.
- **F-19 (resize while a sheet is open):** not fixed. It exists in slice 1 (This chat sheet, baseline) and is not new; the 380 px popover adds one more case.
- **F-17:** Settings' own switch wording (a particle after a user-supplied name) is the Settings lane's to align; this lane keeps the DS-038 wording.

## J. Revision 3: second review round (DD-138 to DD-141, Settings DS-056, re-review F-R1 to N-3)

Re-review: [reviews/2026-10-27-chat-hooks1-rereview.md](../reviews/2026-10-27-chat-hooks1-rereview.md). Where this section differs from A to I, this section wins.

### J.1 Settings' own connection ids (DD-138, F-R1)

The synthetic failures use ids that exist in Settings (`settings/data3.js`, the default `demo` set), so 고치기 lands on a real connection instead of "add connection":

| Case | `conn` | Why |
|---|---|---|
| key | `c-google` | its test result is `badkey` (`simForce: 'badkey'`) |
| quota | `c-openrouter` | the quota case agreed with the Settings lane (the `c-x*` quota connections exist only in Settings' `stress` set) |
| model | `c-anthropic` | a hosted connection that exists |
| network, hosted | `c-anthropic` | hosted: `fix: null` |
| network, address | `c-home` | address-based, its test is `unreachable` |
| server | `c-anthropic` | `fix: null` |

The old placeholder `conn-anthropic` appears nowhere. The chip's preset and model names (균형, Sonnet 4.5, …) stay chat-side synthetic data; they are not Settings' preset list.

### J.2 fix: 'address' (Settings DS-056)

`fix` is `key | model | address | null`. `address` is valid only together with `reason: 'network'` on an address-based connection (`c-home`); the link is `../settings/slice3.html?fix=address&conn=c-home&reason=network&back=chat&msg=<id>&lang=<ko|en>`. A hosted provider's network error and every server error keep `fix: null` (no 고치기); quota keeps `fix: 'key'`. `failReply` and the return fallback turn `address` into none for any other reason, and an unknown `fix` into none. State: `slice1.html?state=hk-fail-network-addr`.

### J.3 The link carries the language (DD-139, F-R3)

The 고치기 link ends with `&lang=<ko|en>` taken from the current UI language (updated in place when the language is switched); the full shape is `…?fix=<fix>&conn=<id>&reason=<reason>&back=chat&msg=<msgId>&lang=<ko|en>`. On return the chat honours `lang` from the URL (slice 1 already read it); the Settings lane carries it back. This closes O-1.

### J.4 IME and the chords (DD-140, F-R2) (replaces the composition lines of B.3 and I.7)

During IME composition (`isComposing`, keyCode 229, or between compositionstart and compositionend) **Ctrl+P and Ctrl+M open nothing and are prevented**, so a browser build never prints or mutes in the middle of a Korean composition. Ctrl+1–9 and ordinary typing are left alone (not handled, not prevented). Inline rename inputs are still left entirely alone. Integration note for §E: the hotkey layer must call `preventDefault` for the two chords in composition and must not for the digit chords.

### J.5 A failed reply keeps "이 메시지와 이후 메시지 삭제" (DD-141)

The failed reply's menu: 삭제, 이 메시지와 이후 메시지 삭제, 버튼 사용자 지정, plus the card's 고치기 and 다시 시도. (I.7 said "delete only"; the delete-after item stays by decision.)

### J.6 Smaller

- **Alt+Z with the switcher open (N-1):** the undo runs and the open list is redrawn, so the "in use" mark moves back; the sheet stays open (refresh, not close).
- **The two retries (N-2, resolved):** the failed-save choices say **저장 다시 시도 / Retry save** (the guard and the switcher's failure row), the card says 다시 시도 / Try again. Settings uses the same label; the guard's choices are 저장 다시 시도 / 변경 취소 / 취소.
- **Demo strings (N-3):** the long-name demo says 세라핀 다이애나.
- **Copy keys:** `retry` is now "Retry save" / "저장 다시 시도" (§G).

### J.7 Open copy and product questions that remain

None new. The earlier §F items stay (O-1 is closed by J.3, O-2 by DD-136, O-5 and O-7 as before).


## K. Revision 4: which model failed (Settings DS-063)

`window.__chat.failReply(msgId, { reason, fix, conn, detail?, chat?, model?, row? })` takes two more optional fields for model failures.

- **`model`** is an opaque string (a model id); it is URL-encoded in the link and never interpreted. **`row`** is one of `main | sub | mem | trans | emo | suggest | other`; anything else is dropped.
- **Link.** For `reason: 'model'` with both `model` and `row` present: `../settings/slice3.html?fix=model&conn=<id>&reason=model&model=<id>&row=<row>&back=chat&msg=<msgId>&lang=<ko|en>` (this parameter order). With either missing, both are left out and Settings falls back to its main row. For any other reason `model` and `row` are discarded (not stored, never in the link).
- **Demo.** `hk-fail-model` passes `model: 'claude-sonnet-45'` (a model of `c-anthropic`: the "Anthropic" catalog in `settings/data.js`, which `settings/data3.js` builds on; it is also Settings' default main model) with `row: 'main'`. The card's detail text still reads "claude-sonnet-4-9 · 404", a synthetic string that was not changed.
- **Stash.** The sessionStorage stash of a failed card keeps `model` and `row`, so a card rebuilt after the trip through Settings links the same way (also checked with `lang=en`). The return URL itself carries no model or row; the stash is the only source.
- **Return language.** Chat already reads whatever `lang` comes back (`?from=settings&retry=<id>&lang=…`, DD-139); no change was needed.
- **Checks.** Five assertions in `checks/hk/fx2.mjs` (`HK-FX2-model-row-{link,missing,other,stash}`, `HK-FX2-row-validation`). `HK-A-link-model` (`checks/hk/fail.mjs`) now expects the extra two parameters for the model case.
