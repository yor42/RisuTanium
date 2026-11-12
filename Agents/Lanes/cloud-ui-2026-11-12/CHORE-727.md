# CHORE-727: finish the chat reply swipe feedback: peek, fill ring, long-press ring (cloud lane, 2026-11-12)

Branch `cloud/chore-727`, cut from `origin/main` 2665ccb05. Decisions: MC-1087 (deferred "peek and ring later"), MC-1527 (cloud scope), MC-058. Environment: Linux cloud container, Node 22.22.0, 4 CPUs; timings are not Note 9 evidence. Hooks note: see `CHORE-585.md` (the PowerShell hooks block here; files written through Bash with the scope kept by hand; reviews ran as Workflow subagents).

## What changed

- `src/lib/ChatShell/ShellMessage.svelte`: the body now sits in the registered `chat-message-stage` part (`position: relative; overflow-x: clip`), which also holds:
  - **Peek** (`chat-swipe-peek`, aria-hidden, `pointer-events: none`, opacity `--opacity-soft` 0.6): while a reply is dragged toward an existing neighbour, the neighbour's chip `n / N` and its first two lines as plain text (`peekText`: macros innermost-first, tags, markdown marks removed; text interpolation only; at most 200 chars from the first 800). It travels with the finger (`translateX(calc(dragX ± (100% + 16px)))`) and is looked up once per gesture direction (`siblingsAt(chat, idx)` for reply rows; a new optional `neighbourText` prop supplied by `ShellMessageList` for the first message's greetings, index k → `fmIndex` k − 2). At 1 / N swiping right the chip "First reply" shows and nothing peeks.
  - **Slide-out**: a committed step with motion allowed moves the body by the stage's width + 16 px with `transform var(--chat-dur-slow) var(--chat-ease-out)` while the peek settles at the centre; the step lands after the slow duration. While it is out (`settling`): `browse()` (pager, keys, wheel, sheet), `act()` steps and New reply from the sheet, the end control and a new touch are ignored; at landing the step is re-checked (busy now, the row's position moved some other way, the message gone from the chat) and refused steps spring back. A row that does not remount (the first message) is reset in place. Under reduced motion or low power the step lands at release with the existing crossfade. A step the row cannot take at release (busy) springs back instead of committing.
  - **Fill-ring meter** (`chat-swipe-meter`): past the last reply, an SVG ring (track + arc, `stroke-dashoffset` set per sample as direct manipulation, never transitioned) with the lucide refresh icon rotated by fill × 360°; accent colour when armed (`data-armed`). The last 30 % fills during the hold: a poll timer (`nextPollMs`: one frame, or exactly when the hold completes) updates it and arms on time, haptic once. Reduced motion or low power: quarter steps, no rotation.
  - **Long-press ring**: positioned under the finger relative to the stage, from 200 ms; normal `lp-fill` (scale + opacity over `--dur-ring` 300 ms), reduced motion `lp-fade` (opacity only), low power static. The glyph `◌` is gone.
- `src/ts/chatShell/swipeGesture.ts`: pure `meterFill`, `peekNeighbour`, `peekText`.
- `src/styles/chat-tokens.css`: unchanged in the end. A `--swipe-peek-opacity` token was added at first; the full suite's `chatTokens.test.ts` pins the design block at 345 names, so the peek reads `--opacity-soft` directly (commit 8e43fbd).
- `src/lib/ChatShell/ShellMessageList.svelte`: `neighbourText` for the first-message row.
- Tests changed for the new timing: `ShellMessage.gestures` "horizontal commit browses and ticks once", `ShellMessage.pager` "a right swipe, the wheel and the arrow key ..." and "... go through the runner as well" now advance the slow duration (they pass on main too: compatibility guards); `ShellMessage.swipe` "a committed step marks the slide direction ..." became the reduced-motion compatibility guard; "past the first alternative ... rubber band" now expects the spec's "First reply" chip.

## Plan and reviews

| Gate | Reviewer | Verdict | Notes |
|---|---|---|---|
| Gate 1 round 1 | adversarial-reviewer (fresh) | [REJECT] | 7 substantive: stage part name (`chat-message-stage` is registered), delayed-step race, refusal after slide-out, hold fill never animated, neighbour text sourcing, test plan, article positioning |
| Gate 1 round 2 | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | all 7 accepted except the guard wording; 5 substantive items (in-flight flag across the awaited step, every step path guarded, stage-width distance, peek lifetime, first-message source) folded in as rev 3 |
| Gate 2 | adversarial-reviewer (fresh) | [APPROVE WITH CHANGES] | major: three guards unpinned by tests (its mutants survived); minors: liveIndex refusal at landing, bound peekText input, a New reply test |
| Gate 2 remediation | adversarial-reviewer (fresh) | [APPROVE] | each guard now pinned (the reviewer re-ran the mutants: killed) |
| Post-Gate-2 check | adversarial-reviewer (fresh) | [APPROVE] | the accent CSS guard (3fa89a6) and the token fix after the full run (8e43fbd) |

Plans and reviews: cloud session scratchpad `727/`.

## Red on origin/main

New tests copied into a scratch worktree of `origin/main`: **25 fail on assertions** (the stage, peek forward/back, low-power chip only, slide-out timing and distance, low-power crossfade, the settling guard, the key-before-landing guard, busy at release, busy at landing, meter fill/rotation/arm/hold, rm and low-power quarter steps, long-press ring position, first-reply chip, the CSS guards, the first-message peeks and landing); the `swipeGesture` helper tests fail because the functions are absent (TypeError). Compatibility guards (pass before and after): the rewritten gestures/pager timing tests, the reduced-motion commit test, the existing layers and swipe tests.

## Mutants (scratch copy outside the tree)

30 mutants. 27 killed in the first pass; N26 (no accent when armed, CSS) was killed after the CSS guard was added. **28 / 30 killed.** Survivors, accepted:
- N8: removing the settling guard at `act()` entry survives because every step it could take also goes through the guarded `browse()`, and New reply from the sheet behaves like the button (refused at landing). Defence in depth only.
- N29: removing the 800-char bound on `peekText`'s input changes only the cost on a pathological nested-macro message, not the result (performance guard; no timing test, to avoid flakiness).

## Checks

- `pnpm check` (8 GB heap): 7783 files, 0 errors, 2 warnings (the pre-existing tsconfig `sw.js` / `rpack_js.js` notices).
- Targeted: `src/lib/ChatShell/ShellMessage*` and `swipeGesture`: 33 files, 343 tests passed (the remediation reviewer's run); after the last commit, `ShellMessage.swipeCss.test.ts` 7 passed.
- Full `pnpm test` on `8f50f5b` (the snapshot before the two test/CSS commits), 34 min 39 s: 1826 files; **37,618 passed, 3 failed, 30 skipped**. The 3: `src/styles/tests/chatTokens.test.ts` "the design block ... 345 names once" (this ticket's added token; fixed in 8e43fbd, after which `chatTokens.test.ts`, `ShellMessage.swipeCss` and `ShellMessage.swipe` pass, 59 tests) and the 2 known `replay/actors.test.ts` environment timeouts.
- After 8e43fbd the change is a CSS value and a test assertion; `pnpm check` was not repeated (no TypeScript changed since the 0-error run).
- `pnpm build` on `8f50f5b`: 7613 modules transformed, built in 22.75 s, exit 0.

## Known failures, not fixed here

- `replay/actors.test.ts`: 2 timeouts, the environment failure recorded in `Agents/Lanes/lane-cloud-records.md` (storage code, untouched).

## New en.ts keys

None (existing keys reused: `chatShellFirstReply`, `chatShellNoSavedReplies`, `chatShellReleaseNewReply`).

## Left out

- Design-registry rows for the new parts `chat-swipe-peek`, `chat-swipe-meter` (`docs/design/chat/THEME_AUDIT.md`, packlint): docs/design is the design lane's; lane A registers them at integration.
- A timing test for the `peekText` bound (performance only).
- The long-press ring can be clipped by the stage near a side edge (accepted: it is a cue).

## Integration notes

- With CHORE-585 merged: ShellMessage's `motionReduced()` becomes `reducedMotionActive()` (same meaning); the new reduced-motion media rule already carries the `html:not(.rm-off)` scope that branch introduces.
- CHORE-726 touches `ShellSheet.svelte` only; no overlap.

## Device checks for lane B

- Note 9: drag a reply with 3 alternatives slowly both ways: the neighbour's two lines follow the finger at 60 %; release past 30 %: the body slides out and the neighbour settles in one motion, no flash; quick taps on the pager during the slide do nothing extra.
- Pull past the last reply: the ring fills with the pull, keeps filling while held still, turns accent with one haptic tick; let go armed → spring back and the new reply streams.
- Long press: the ring grows under the finger from 200 ms and the sheet opens at 500 ms.
- Reduced motion on: the peek still follows; release crossfades; the ring fills in steps without turning. Low power: chip only, static ring, crossfade.
- Note 9 performance: the drag stays smooth on a long chat (the peek adds one absolutely positioned element per dragged row).
- TalkBack: the peek, meter and ring are hidden; the "No more saved replies" / "Let go to generate a new reply" status still announces.
