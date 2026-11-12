# CHORE-726: drag a chat bottom sheet down to close it (cloud lane, 2026-11-12)

Branch `cloud/chore-726`, cut from `origin/main` 2665ccb05. Decisions: MC-1527 (cloud scope), MC-058. Environment: Linux cloud container, Node 22.22.0, 4 CPUs. Hooks note: see `CHORE-585.md`.

## What changed

- `src/ts/chatShell/sheetDrag.ts` (new, pure): `createSheetDrag()`; offset = max(0, dy) after a 4 px slop; release closes past 30 % of the sheet's height or on a downward fling faster than 0.5 px/ms (the mockup's `sheetDragInit` values); a fling back up always keeps the sheet; cancel keeps it.
- `src/lib/ChatShell/ShellSheet.svelte`:
  - A handle (`chat-sheet-handle`, the registered part; aria-hidden; `touch-action: none`; a 44 px full-width strip that absorbs the sheet's top padding, with a grab bar) as the first child of every sheet except `wide-menu`, hidden for `side` from 900 px up. It scrolls with the content, so the callers' own sticky title bars (This chat, Toggles) keep the top of the sheet.
  - Touch or pen on the handle (mouse ignored, like the mockup; one pointer at a time): the sheet follows the finger (`translateY`), the scrim fades with it through a `--sheet-drag` variable (`opacity: calc(var(--opacity-scrim) * (1 - var(--sheet-drag, 0)))`, the theme's opacity at rest).
  - Release: stay → back to rest over the settle; close → off screen over the settle, then the normal `close()` (so `onclose`, Back, Escape, `chat:sheetclosed` and any confirmation are unchanged). The settle duration is read from the computed style after the state applies; 0 or unreadable → immediate. Escape/Back/scrim during the travel close once; presses during a settle are ignored; the drag state and timer are reset on open and on close.
  - `data-moved` keeps the entry animation off (`!important`) for the rest of the open, so its fill can never take the transform back.
  - Settle durations: `--chat-dur-base`; reduced motion (the OS query, scoped `html:not(.rm-off)` to pair with CHORE-585, and `html.rm`) `--chat-dur-fast` (120 ms); low power `--dur-lowpower-cap`; both together fast. Only transform and opacity transition.

## Plan and reviews

| Gate | Reviewer | Verdict | Notes |
|---|---|---|---|
| Gate 1 round 1 | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | 6 substantive (entry animation vs inline transform, state across reopen, handle layout, theme hiding the handle, close timing, the speculative "kept open" branch) written into rev 2 |
| Gate 1 round 2 | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | 4 substantive implementation points (cascade under rm/low power, duration read after the style applies, pointerup/lostpointercapture order and presses during travel, untracked reset) folded in as rev 3 |
| Gate 2 | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | major: the sticky handle collided with ThisChatSheet's and TogglesPanel's sticky title bars → the handle is no longer sticky; minors accepted (below) |
| Gate 2 remediation | adversarial-reviewer (fresh) | [APPROVE] | collision resolved; the new pointer-id test kills its mutant |

## Red on origin/main

New tests in a scratch worktree of `origin/main`: 24 fail (the handle tests fail because the handle does not exist, i.e. the feature is absent; the CSS guards fail on their assertions; `sheetDrag.test.ts` fails to import the absent module, import-level only). "A wide menu has no handle" passes on main (compatibility guard). The existing scrim-touch, inner-Escape and caller tests are compatibility guards and pass unchanged.

## Mutants (scratch copy outside the tree)

21 mutants (thresholds 0.3 → 0.9 and 0.5 → 5, the slop, the upward-fling rule, negative offsets, mouse drags, presses during a settle, a second finger, a lost capture after release, the resets on open and on close, the travel duration, seconds vs ms, the scrim on close and during a drag, the wide-menu handle, `!important` on the animation-off rule, the reduced-motion settle duration, the spring-back target, the settle never clearing, the scrim formula). First pass 17 killed; S7 (a press during a settle) and S19 (the spring-back keeps its offset until the settle ends) were killed after two tests were added (db6f8d7). **19 / 21 killed.** Survivors, accepted: S10 and S11 each remove one of the two drag-state resets (on open, on close); either alone suffices, and a travel timer firing after close is a no-op through `close()`'s guard (defence in depth).

## Checks

- `pnpm check` (6 GB heap): 7786 files, 0 errors, 2 warnings (pre-existing tsconfig notices).
- Targeted: ShellSheet, the callers (ActionSheet, PlusSheet, ThisChatSheet, PersonaSheet, CustomizeButtonsSheet, TogglesPanel, sidebar) and `sheetDrag`: 37 files, 538 tests passed before the remediation; ShellSheet + ThisChatSheet + TogglesPanel + sheetDrag 18 files, 240 passed after it; `ShellSheet.drag` 21 passed with the added test.
- Full `pnpm test`, started on `45bca3e` (the test-only commit db6f8d7 landed during the run; its file passes alone, 22 tests), 36 min 36 s: 1826 files passed, 1 failed, 1 skipped; **37,619 passed, 2 failed, 30 skipped**. The 2 are the known `replay/actors.test.ts` environment timeouts.
- `pnpm build`: 7614 modules transformed, built in 24.67 s, exit 0.

## Known failures, not fixed here

- `replay/actors.test.ts`: 2 timeouts, the environment failure recorded in `Agents/Lanes/lane-cloud-records.md` (storage code, untouched).

## New en.ts keys

None (the handle is aria-hidden; Back, Escape and the scrim stay the accessible ways to close).

## Left out and accepted limitations

- Drag starts from the handle only (the brief's handle-only option, as the mockup); content scrolling is never part of the gesture. A scrolled sheet is closed by scrolling back to the top and dragging, or by Back, Escape or the scrim.
- A caller that kept a sheet open after `onclose` would leave it off screen; no caller does (every `onclose` clears its state; the delete confirmation is a separate layer).
- A drag during the 200 ms entry animation drops the entry; the sheet goes to the finger.
- A press on the handle while renaming in This chat blurs the field and commits the rename, as any press outside it does today.
- A theme that hides `chat-sheet-handle` removes drag-close only.

## Integration notes

- With CHORE-585 merged, the reduced-motion settle rule's `html:not(.rm-off)` scope becomes live (the user's "off" then keeps the 200 ms settle); ShellSheet's existing media rules are scoped the same way on that branch, so expect a textual merge in the `<style>` block but no semantic conflict.
- CHORE-727 touches ShellMessage only; no overlap.

## Device checks for lane B

- Note 9: open the + menu, the action sheet and This chat; drag the handle down slowly: the sheet follows the finger 1:1 and the scrim fades; release below a third: it springs back; past a third or a quick flick: it slides off and closes; focus returns to the opener.
- Normal motion, release: no flash or jump back (the entry animation must not replay); repeat right after opening.
- Scrolled This chat / Toggles: the title bar stays visible and tappable at the top; scroll back up to drag the handle.
- Reduced motion on: the finger still drives; the settle is a short 120 ms move. Low power: settle at most 120 ms.
- Long-press a message to open the action sheet and lift: the sheet stays open (the scrim grace); a later tap on the scrim closes it.
- TalkBack: the handle is not announced; Back closes.
