# Warning and task-progress motion contract

Owner: motion-planner (Opus), 2026-10-28. Builder: motion-designer (Sonnet). Task: [2026-10-28-warnings-and-progress](../tasks/2026-10-28-warnings-and-progress.md).

Inputs: DD-219..222, DD-211 (the mark keeps animating in low power and stops under reduced motion, review option 9b(a)), DD-212 (the background loop pauses behind dialogs), DD-151, DD-149/DD-155/DS-075 (critical surfaces, value bounds about 600 ms), DS-008 (low power turns non-essential motion off). Reused code: `brand/nexus-mark.css`, `brand/nexusMark.ts`, `boot/nexus-boot.css` (bar tiers), `mockups/startup.html` (step list, hand-over focus) and `theme/nexus-tokens.css`.

Names: the pattern spec ([WARNINGS_AND_PROGRESS.md](WARNINGS_AND_PROGRESS.md), being written in parallel) owns part names and copy. The `data-part` names below are proposals. If the spec names a part differently, use the spec's name and keep this contract's motion. Token names are set here.

Storyboard: [motion/timelines.svg](motion/timelines.svg) (W1, T5 and T7 on one time axis).

---

## 1. Direction

**One live thing, everything else settles.** Each surface has at most one continuous loop, the Nexus mark, plus the bar sweep while work has no count. Every other change is a single transition of 120 to 340 ms that ends at rest. Motion only marks a state change or progress.

- Severity is static: colour, glyph shape, headline wording and a static edge band. Motion never carries it. There is no shake, flash, pulse loop or count-up animation in a warning.
- Progress is monotonic. The fill never moves back (keep the largest fraction shown, as `bootFraction` callers do). The mark changes at most once per step, never once per item.
- Only `transform` and `opacity` are animated or transitioned. Colour, border and height changes snap.
- Rejected: FLIP-morphing the dialog into the toast (a large moving area on the Pi 3 software path, with little gain); a height-animated disclosure (layout every frame); a scale-in panel (WebKitGTK re-rasterises text on every frame).

## 2. Tokens

All durations are nominal. A component uses `calc(var(--token) * var(--risu-animation-speed, 1))`. Packs may set any token below within its floor and ceiling; the pack-install rule (DS-075) rejects values outside them, because warnings and danger dialogs are critical surfaces (DD-149). Packs cannot change which properties animate, iteration counts or the parts animated. Every easing a pack sets must be a `cubic-bezier` with both y values in [0, 1], so nothing overshoots.

### 2a. Shared, additive in `theme/nexus-tokens.css`

Add these after the DD-145 block. Nothing existing changes. The parent arbitrates shared tokens.

| Token | Default | Floor | Ceiling | Use |
|---|---|---|---|---|
| `--nexus-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | y in [0,1] | y in [0,1] | Entrances (the same value as `--chat-ease-out` and `--studio-ease-enter`) |
| `--nexus-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | y in [0,1] | y in [0,1] | Exits |
| `--nexus-duration-exit` | `160ms` | 0 | 300ms | Dialog, sheet and toast exit |
| `--nexus-duration-lowpower-cap` | `120ms` | 0 | 200ms | Low power caps every non-loop duration at this (the same value as chat's `--dur-lowpower-cap`) |
| `--nexus-dialog-enter-distance` | `8px` | 0 | 16px | Centred dialog: rise on enter |
| `--nexus-sheet-enter-distance` | `16px` | 0 | 24px | Phone bottom sheet: rise on enter |
| `--nexus-scrim-duration` | `200ms` | 0 | 300ms | Scrim fade in (exit uses `--nexus-duration-exit`) |

The existing tokens keep their values: `--nexus-ease` (state crossfades and the fill), `--nexus-duration-press` (150 ms), `--nexus-duration-enter` (220 ms). The mark's own `--nm-morph` (0.45 s) belongs to the brand. Packs do not tune it.

### 2b. Task progress (`--task-*`, defined on `:root` in `patterns/motion.css`)

| Token | Default | Floor | Ceiling | Use |
|---|---|---|---|---|
| `--task-step-enter-dur` | `180ms` | 0 | 300ms | One step row's fade and rise when the list first appears |
| `--task-step-enter-distance` | `4px` | 0 | 8px | Rise of a step row |
| `--task-step-stagger` | `30ms` | 0 | 60ms | Delay between rows |
| `--task-step-stagger-max` | `150ms` | 0 | 240ms | Cap on the total stagger; later rows share the last delay |
| `--task-tick-dur` | `220ms` | 0 | 300ms | Step icon change (dot to check, cross or dash) |
| `--task-tick-scale-from` | `0.6` | 0.5 | 1 | Starting scale of the check glyph (done only) |
| `--task-fill-dur` | `320ms` | 0 | 600ms | Bar fill `scaleX` transition; it retargets on each update |
| `--task-fill-ease` | `var(--nexus-ease-out)` | y in [0,1] | y in [0,1] | Bar fill easing |
| `--task-sweep-period` | `1400ms` | 1000ms | 3000ms | Indeterminate sweep loop (the floor keeps it under 1 Hz) |
| `--task-hold-period` | `1600ms` | 1200ms | 3200ms | Paused or cancelling hold pulse (alternate) |
| `--task-state-dur` | `150ms` | 0 | 300ms | Opacity crossfades: sweep in and out, Cancel enabled/disabled, toast text swap, stopped fill dim |
| `--task-mark-dwell` | `600ms` | 300ms | 1200ms | Minimum time a mark status is shown before the next one applies (read by JS) |
| `--task-count-interval` | `250ms` | 100ms | 1000ms | Throttle for count text, `aria-valuenow`/`aria-valuetext` and fill writes (read by JS) |
| `--task-badge-delay` | `300ms` | 0 | 450ms | Skip badge appears after the done morph starts |
| `--task-badge-dur` | `220ms` | 0 | 300ms | Skip badge fade and scale |
| `--task-badge-scale-from` | `0.6` | 0.5 | 1 | Skip badge starting scale |
| `--task-result-delay` | `450ms` | 0 | 600ms | Gap between the terminal mark status and the result card (lets the morph read) |
| `--task-result-enter-dur` | `220ms` | 0 | 400ms | Result card fade and rise |
| `--task-result-distance` | `8px` | 0 | 16px | Result card rise |
| `--task-result-row-delay` | `60ms` | 0 | 120ms | First skipped-item row, after the card starts |
| `--task-result-row-stagger` | `30ms` | 0 | 60ms | Between skipped-item rows; at most 5 rows animate (`--task-result-rows-max`, fixed at 5, not a pack token) |
| `--task-toast-enter-dur` | `220ms` | 0 | 300ms | Background toast fade and rise |
| `--task-toast-distance` | `12px` | 0 | 16px | Background toast rise |
| `--task-toast-overlap` | `40ms` | 0 | 80ms | Toast enter starts this long before the dialog exit ends |
| `--task-toast-done-hold` | `6000ms` | 5000ms | none | Clean-done toast auto-hide (read by JS; paused while hovered or focused; see Q5) |

### 2c. Warnings (`--warning-*`, defined on `:root` in `patterns/motion.css`)

| Token | Default | Floor | Ceiling | Use |
|---|---|---|---|---|
| `--warning-glyph-delay` | `60ms` | 0 | 120ms | Severity glyph starts after the panel |
| `--warning-glyph-dur` | `220ms` | 0 | 300ms | Glyph fade and scale |
| `--warning-glyph-scale-from` | `0.85` | 0.7 | 1 | Glyph starting scale |
| `--warning-halo-delay` | `280ms` | 200ms | 400ms | Danger halo starts once the glyph has settled |
| `--warning-halo-dur` | `600ms` | 0 | 900ms | Danger halo: one expansion, `iteration-count: 1`, fixed |
| `--warning-halo-scale-to` | `1.4` | 1 | 1.6 | Halo end scale |
| `--warning-halo-opacity` | `0.5` | 0 | 0.6 | Halo starting opacity (it fades to 0) |
| `--warning-bullet-delay` | `80ms` | 0 | 160ms | First consequence bullet, after the panel |
| `--warning-bullet-stagger` | `40ms` | 0 | 60ms | Between bullets (2 or 3 per DD-220) |
| `--warning-bullet-dur` | `180ms` | 0 | 300ms | Bullet fade and rise |
| `--warning-bullet-distance` | `4px` | 0 | 8px | Bullet rise |
| `--warning-detail-dur` | `150ms` | 0 | 200ms | Disclosure content fade in, and the caret turn |
| `--warning-press-scale` | `0.97` | 0.94 | 1 | Confirm and cancel press |
| `--warning-press-dur` | `var(--nexus-duration-press)` | 0 | 200ms | Press in and out |
| `--warning-arm-delay` | `250ms` | 150ms | 400ms | Confirm ignores activation this long after open (read by JS; see Q4) |
| `--warning-swap-out-dur` | `120ms` | 0 | 200ms | Warning body fades out when confirm starts a task in place |
| `--warning-swap-in-dur` | `180ms` | 0 | 300ms | Progress body fades in after the swap |

## 3. Layers

All parts carry `data-part`. Warning and task surfaces are `data-part-critical` (DD-149), so packs reach them only through the tokens above.

| Part | Anchor and bounds | Animated | Notes |
|---|---|---|---|
| `task-root` | The dialog or sheet body | none | `data-task-state` = `idle`, `running`, `paused`, `cancelling`, `done`, `done-skips`, `failed` or `cancelled`. `data-task-mode` = `determinate` or `indeterminate` |
| `task-mark` | Fixed box, 48 px in a dialog and 24 px in a toast, `overflow: visible`, reserved so morphs never shift layout | mark-internal | Hosts `.nexus-mark` from `markSvg`. Never set `data-progress` (the bar is the determinate indicator; the ring's `stroke-dashoffset` paints on every update) |
| `task-mark-badge` | Absolutely placed at the `task-mark` box's bottom-right, 40% of the mark size, inside the reserved box | opacity, transform (scale, origin centre) | Only in `done-skips`. Warning colour, with a glyph, not colour alone. The count text sits beside it in `task-headline` |
| `task-headline` | Text row | none (text swaps) | The visible state label. A sibling `role="status"` region announces step and state changes only (`bootAnnouncement` rule) |
| `task-steps` / `task-step` | `ol`. Every row is in the DOM from `idle` | Rows: opacity, `translateY` (first appearance only) | `data-at` = `next`, `now`, `done`, `skipped` or `failed`. Text colour snaps |
| `task-step-icon` | 14 px box, two stacked glyph layers (`-was`, `-is`) | opacity; scale on `-is` for done only | Crossfades the old glyph to the new one |
| `task-step-count` | Right-aligned, `tabular-nums`, `min-width` in `ch` reserved for the widest `n / N` | none | Throttled writes |
| `task-bar` | Mirrors `.nexus-boot-bar` (6 px track, `overflow: hidden`) | children only | `data-state` = `running`, `waiting`, `failed` or `ready`, plus `data-low-power`. The same five tiers and cascade rule as `boot/nexus-boot.css` |
| `task-bar-fill` | `inset: 0`, `transform-origin: left` | transform (`scaleX`) | `will-change: transform` only while `running` or `paused` |
| `task-bar-sweep` | The current step's share (`left`/`width` from index and steps; snaps on step change) or the whole track when there are no steps | `::before` transform (loop), opacity (hold) | `will-change: transform` only while sweeping |
| `task-bar-ticks` | Step boundaries | none | |
| `task-cancel` | Button in the footer | transform (press), opacity (enabled to disabled) | Disabled uses `aria-disabled` and stays in place (no layout shift) |
| `task-result` | Card below the bar (the panel height snaps on insert, at opacity 0) | opacity, `translateY` | `role="alert"` region when failed, `role="status"` otherwise |
| `task-result-row` | Skipped or failed item rows | opacity, `translateY` | The first 5 animate; the rest appear with row 5 |
| `task-toast` | Bottom of the viewport, above the dock and safe area, max 2 visible | opacity, `translateY` | `role="status"`. Holds `task-mark` (24 px), the count and actions. A 3 px mini bar uses `task-bar-fill` only (no sweep in the toast) |
| `warning-scrim` | `fixed`, `inset: 0`, a solid `rgb()` | opacity | No `backdrop-filter` |
| `warning-panel` | Centred dialog (`data-layout` wide or mid) or bottom sheet (phone) | opacity, `translateY` | `data-severity` = `caution` or `danger`. Opaque `--color-surface-sheet`, no `backdrop-filter`. The static severity band is a border (no motion) |
| `warning-glyph` | 40 px icon box at the head | opacity, scale | Lucide glyph or `.nexus-mark` per the spec. A mark here is `data-still` (warnings do not loop) |
| `warning-halo` | `::after` of `warning-glyph`, the same box, `pointer-events: none` | opacity, scale | `danger` only. Hidden in forced colours |
| `warning-headline` | Text | with the panel | |
| `warning-bullets` / `warning-bullet` | `ul`, 2 or 3 items | opacity, `translateY` | Numbers are static text. No count-up |
| `warning-detail` | `details` | content opacity; caret `rotate` 0 to 90deg | Height snaps. Close is instant |
| `warning-confirm` / `warning-cancel` | Footer buttons | transform (press) | |

## 4. Mark status map

`task-root` state to `data-status` on `task-mark`. No new mark statuses (the boot precedent in `bootMarkStatus`).

| Task state | `data-status` | Extra |
|---|---|---|
| `idle` | `idle` | Static (the mark never animates while idle, DESIGN_PHILOSOPHY section 8) |
| `running` | the step's kind: read or verify = `scanning`, export or write out = `transfer_out`, import or restore = `transfer_in`, build or prepare = `preparing`, finalise or clean up = `finishing` | The step declares its kind. One status per step |
| `paused` (waiting on the person) | `waiting` | |
| `cancelling` | `finishing` | |
| `cancelled` | `stopped` | |
| `done` | `done` | |
| `done-skips` | `done` | plus `task-mark-badge` |
| `failed` | `error` | The shake is suppressed in the pattern: `[data-part="task-mark"] .nexus-mark[data-status="error"] .nm-body { animation: none; }` (specificity 0,4,0 beats the brand's 0,3,0; see Q1) |

**Dwell (JS):** apply a new status only after the current one has shown for `--task-mark-dwell`. While waiting, keep only the latest pending status. Terminal statuses wait for the dwell too, then apply. Steps faster than the dwell never flicker the mark.

## 5. Timelines

Times are in ms from the trigger, at nominal speed with full motion. "Rise" means `translateY(distance)` to `none` together with `opacity` 0 to 1.

### T1. Task start

Two triggers: Start pressed in an idle task panel, or a warning confirm that starts the task in place.

| t | Part | Change | Dur / ease |
|---|---|---|---|
| 0 | `warning-confirm` / Start | press out; `aria-disabled` at once (no double start) | `--warning-press-dur` |
| 0 | warning body (from a warning only) | opacity 1 to 0 | `--warning-swap-out-dur`, `--nexus-ease-in` |
| 120 | panel | height snaps while the body is at opacity 0; width is unchanged | instant |
| 120 | progress body | opacity 0 to 1 | `--warning-swap-in-dur`, `--nexus-ease-out` |
| 120 | `warning-glyph` to `task-mark` | the glyph is hidden and the mark is shown at the same box, inside the body fade | with the body |
| 120 + min(i × `--task-step-stagger`, `--task-step-stagger-max`) | `task-step` i | rise | `--task-step-enter-dur`, `--nexus-ease-out` |
| 120 | `task-step` 0 | `data-at=now`, the dot glyph is shown | `--task-state-dur` |
| 120 | `task-mark` | `idle` to the step status (the brand morph runs internally) | `--nm-morph` |
| 120 | `task-bar-sweep` | indeterminate: the loop starts. Determinate: the fill is at 0 | `--task-sweep-period`, `--nexus-ease`, infinite |

A task panel opened directly (with no warning) uses W1's panel and scrim rows, and its steps start at 0 instead of 120.

### T2. Progress update and step tick

| Trigger | Part | Change | Dur / ease |
|---|---|---|---|
| A count arrives (throttled to `--task-count-interval`) | `task-bar-fill` | `scaleX` to max(shown, new) | `--task-fill-dur`, `--task-fill-ease` (retargets) |
| | `task-step-count`, `aria-valuetext` | text write | none |
| The first count for an indeterminate step | `task-bar-sweep` | opacity to 0, then hidden; `data-task-mode=determinate` | `--task-state-dur` |
| Step k ends with k+1 next | `task-step-icon` k | `-was` (dot) opacity to 0; `-is` (check) opacity 0 to 1 and scale `--task-tick-scale-from` to 1 | `--task-tick-dur`, `--nexus-ease-out` |
| | `task-step` k+1 | `data-at=now`, the dot fades in | `--task-state-dur` |
| | `task-bar-sweep` | `left` snaps to the next share; the loop restarts | instant |
| | `task-mark` | the next step status (subject to dwell) | `--nm-morph` |
| | live region | step label | none |
| Step k skipped | `task-step-icon` k | crossfade to a dash glyph (opacity only, no scale) | `--task-tick-dur` |

### T3. Paused (waiting on the person) and resume

| t | Part | Change | Dur / ease |
|---|---|---|---|
| 0 | `task-mark` | `waiting` (the brand's dim pulse) | `--nm-morph` |
| 0 | `task-bar` | `data-state=waiting`: the sweep becomes the hold pulse in the current share; the fill holds | `--task-hold-period`, `--nexus-ease`, alternate infinite |
| 0 | `task-step-icon` now | crossfade to a pause glyph | `--task-state-dur` |
| 0 | question card (spec) | rise; focus moves to its primary action at 0 | `--nexus-duration-enter`, `--nexus-dialog-enter-distance` |
| On resume | question card | opacity to 0, then removed; focus goes to `task-bar` (`tabindex=-1`, the startup precedent) | `--nexus-duration-exit`, `--nexus-ease-in` |

### T4. Cancel

| t | Part | Change | Dur / ease |
|---|---|---|---|
| 0 (press) | `task-cancel` | scale 1 to `--warning-press-scale` and back | `--warning-press-dur` |
| release | `task-root` | `cancelling`; `task-cancel` gets `aria-disabled` and the label "취소하는 중…" (the spec owns copy), opacity to 0.55 | `--task-state-dur` |
| release | `task-mark` | `finishing` | dwell |
| release | `task-bar` | `data-state=waiting` (hold pulse); the fill holds | `--task-hold-period` |
| on stop | `task-mark` | `stopped` | dwell |
| on stop | `task-bar-fill` | opacity to 0.5; the sweep is hidden | `--task-state-dur` |
| on stop + `--task-result-delay` | `task-result` | the cancelled card rises, as in T5 | as T5 |
| Cancel becomes unsafe or safe again | `task-cancel` | opacity 1 to 0.55 (or back), `aria-disabled` toggles, and `aria-describedby` points at the reason | `--task-state-dur` |

### T5. Finish: done, done with skips, failed

| t | Part | Change | Dur / ease |
|---|---|---|---|
| 0 | `task-bar-fill` | `scaleX(1)` (done or skips); failed holds its value | `--task-fill-dur` |
| 0 | `task-bar` | `data-state=ready` (the sweep is hidden) or `failed` (danger tint, which snaps) | instant |
| 0 | last `task-step-icon` | check (done), or a cross, opacity only (failed) | `--task-tick-dur` |
| 0 (after dwell) | `task-mark` | `done` (the brand pop and flash, once) or `error` (no shake) | `--nm-morph` |
| `--task-badge-delay` | `task-mark-badge` (skips) | opacity 0 to 1, scale `--task-badge-scale-from` to 1 | `--task-badge-dur`, `--nexus-ease-out` |
| `--task-result-delay` | `task-result` | inserted at opacity 0 (height snaps), then rises. Focus moves to its heading at insertion (`preventScroll: false`, scroll behaviour `auto`, never smooth) | `--task-result-enter-dur`, `--nexus-ease-out`, `--task-result-distance` |
| + `--task-result-row-delay` + i × `--task-result-row-stagger` (i < 5) | `task-result-row` i | rise | `--task-step-enter-dur`, `--task-step-enter-distance` |
| after the card | `will-change` | removed from the fill and sweep | — |

### T6. Background hand-off and completion in a toast

Trigger: "Continue in background", or closing a running task panel where the spec allows it.

| t | Part | Change | Dur / ease |
|---|---|---|---|
| 0 | focus | returns to the control that opened the task | — |
| 0 | `warning-panel` / task panel | opacity to 0 and `translateY(0)` to `translateY(4px)`, then removed (its mark goes with it) | `--nexus-duration-exit`, `--nexus-ease-in` |
| 0 | `warning-scrim` | opacity to 0; the network loop resumes (DD-212) | `--nexus-duration-exit` |
| exit − `--task-toast-overlap` (120) | `task-toast` | rises from `--task-toast-distance`. Its 24 px mark is now the only live mark. The status announces it politely | `--task-toast-enter-dur`, `--nexus-ease-out` |
| updates | toast count and mini fill | throttled, as in T2 | `--task-fill-dur` |
| terminal | toast mark | `done` or `error`, plus the badge for skips | as T5 |
| terminal | toast text | opacity crossfade, old to new | `--task-state-dur` |
| clean done + `--task-toast-done-hold` | `task-toast` | exits; the timer pauses on hover, focus or touch | `--nexus-duration-exit` |
| toast tapped (Open or View result) | toast to panel | the toast exits and the panel enters as in W1 (no glyph or halo; the mark is present at once). Focus goes to the panel heading, or to the result heading if the task has finished | W1 rows |

Two toasts at most. An older running toast's mark gets `data-still` (only the newest animates; see Q6). A toast never takes focus.

### W1. Warning opens

| t | Part | Change | Dur / ease |
|---|---|---|---|
| 0 | network background | the loop pauses (DD-212) | — |
| 0 | `warning-scrim` | opacity 0 to 1 | `--nexus-scrim-duration`, `--nexus-ease` |
| 0 | `warning-panel` | rises from `--nexus-dialog-enter-distance` (dialog) or `--nexus-sheet-enter-distance` (sheet). Focus moves at 0 to the spec's default action (Cancel for danger). Input is accepted from frame 0 except confirm (arm) | `--nexus-duration-enter`, `--nexus-ease-out` |
| `--warning-glyph-delay` (60) | `warning-glyph` | opacity 0 to 1, scale `--warning-glyph-scale-from` to 1 | `--warning-glyph-dur`, `--nexus-ease-out` |
| `--warning-bullet-delay` + i × `--warning-bullet-stagger` (80, 120, 160) | `warning-bullet` i | rise | `--warning-bullet-dur`, `--nexus-ease-out` |
| `--warning-halo-delay` (280), danger only | `warning-halo` | scale 1 to `--warning-halo-scale-to`, opacity `--warning-halo-opacity` to 0, once, `fill-mode: forwards` | `--warning-halo-dur`, `--nexus-ease-out` |
| 0 to `--warning-arm-delay` (250) | `warning-confirm` | activation is ignored (pointer, Enter, Space, including key repeat from the trigger). Nothing changes visually | — |

Everything is at rest by 340 ms (880 ms with the danger halo).

### W2. Disclosure

| Trigger | Part | Change | Dur / ease |
|---|---|---|---|
| open | `warning-detail` content | the height snaps open; content opacity 0 to 1 | `--warning-detail-dur`, `--nexus-ease-out` |
| open / close | caret | `rotate(0)` to `rotate(90deg)` and back | `--warning-detail-dur` |
| close | content | hidden at once | instant |

### W3. Confirm press and close

| Trigger | Part | Change | Dur / ease |
|---|---|---|---|
| `pointerdown`, or Space/Enter `keydown` | `warning-confirm` / `warning-cancel` | scale 1 to `--warning-press-scale` | `--warning-press-dur`, `--nexus-ease` |
| `pointerup`, `keyup` or `pointercancel` | same | back to 1 | `--warning-press-dur` |
| activation (armed) | `warning-confirm` | `aria-disabled` at once; a second activation does nothing | — |
| it starts a task | panel | T1 in place | — |
| the action is instant, or Cancel | panel and scrim | exit as in T6 row 2; focus returns to the trigger; a lane Undo toast (if any) enters with its own lane motion | `--nexus-duration-exit`, `--nexus-ease-in` |

There is no colour flash, no spinner on the button, and no shake for a blocked action. A blocked confirm stays `aria-disabled` and states its reason in text.

## 6. Modes

Precedence: forced colours, then reduced motion, then low power, then base. Reduced motion is `@media (prefers-reduced-motion: reduce)` **or** `html.rm` (the mockups' toggle); both must give identical results. Low power is `.nexus-low-power` on the root, or `data-low-power` on the part.

| Item | Base | Reduced motion | Low power |
|---|---|---|---|
| Panel and sheet enter | rise 220 | opacity only, `--nexus-duration-press` | opacity only, `--nexus-duration-lowpower-cap` |
| Exits and toast | fade and 4 px / 12 px move | opacity only, `--nexus-duration-press` | opacity only, the cap |
| Scrim | fade 200 | fade `--nexus-duration-press` | fade, the cap |
| Steps and bullets enter | rise with stagger | all appear with the panel fade (no stagger, no move) | opacity only, stagger 0, the cap |
| Step tick | crossfade and scale | glyph swaps (opacity only, `--nexus-duration-press`) | opacity only, the cap |
| Bar fill | `scaleX` transition 320 | snaps (`transition: none`, the boot precedent) | transition kept, capped |
| Sweep (indeterminate) | loop | still tint at 4:1 against the track (boot tier 3) | still tint (boot tier 3) |
| Hold pulse (paused or cancelling) | loop | still tint | still tint |
| Status mark | loops and morphs | stopped: `data-still` is set when `html.rm` is on (the brand's media rule already covers the OS setting); poses snap and opacity fades | **keeps animating** with `data-low-power` (no glow, one copy of each layer; DD-211) |
| Mark in an older toast | `data-still` | `data-still` | `data-still` |
| Skip badge | fade and scale | appears with the done pose (opacity, press duration) | opacity only, the cap |
| Glyph enter | fade and scale | with the panel fade | opacity only, the cap |
| Danger halo | once | none | none |
| Result card and rows | rise and stagger | `--task-result-delay` is 0; opacity only, press duration, no stagger | delay kept (the mark still morphs), opacity only, the cap, stagger 0 |
| Disclosure | fade and caret turn | instant | instant |
| Press scale | 0.97 | none (the `:active` colour state from the lane stays) | kept (one transform on one element) |
| Arm, dwell and throttle | on | on (they are safety and noise rules, not motion) | on |

Reduced motion and low power together: the reduced-motion column applies, and the mark stops.

Forced colours: no motion changes, except that the halo is hidden. The bar uses the boot tier-5 colours.

Hidden tab (`document.hidden`): skip count and fill writes and apply the latest one on `visibilitychange`. CSS loops are left to the browser's throttling.

## 7. Frame budget (Note 9 / Android 10 WebView; Pi 3 / WebKitGTK)

| Rule | Why |
|---|---|
| At most one infinite animation outside `.nexus-mark` per surface (the sweep or the hold pulse), and one live mark per viewport | Steady state is two small layers: a 48 px mark and a 6 px strip |
| No `backdrop-filter` on the scrim, panel, sheet or toast while any loop runs; use opaque `--color-surface-sheet` / `--color-surface-toast` | Blur over animation re-blurs every frame (DESIGN_PHILOSOPHY section 6) |
| Pause the network background while a warning or task panel is open (DD-212) | It frees the frame for the panel |
| Panels translate and fade, never scale | WebKitGTK without GPU compositing re-rasterises scaled text on every frame |
| Scale is used only on small boxes (14 px tick, 40 px glyph and halo, badge, buttons) | It keeps repaint areas small on the software path |
| `will-change: transform` only on `task-bar-fill` and the `task-bar-sweep::before` while active, removed at terminal states. Nowhere else | The Pi 3's GPU memory split is small (64 to 128 MB) |
| Count, ARIA and fill writes are throttled (`--task-count-interval`) and batched in one `requestAnimationFrame`. Count spans reserve width with `tabular-nums` and `ch` | No layout per item; text paint at 4 Hz or less |
| No layout property is transitioned. Height and `left` snap only at opacity 0 or between frames | Zero layout work per animation frame |
| No `stroke-dashoffset` progress ring on the mark in this pattern | It paints on every update |
| Transient overlap is at most four transitions at once (W1 at 80 to 220 ms: panel, scrim, glyph, bullet) | All are compositor-only and finish within 340 ms |
| Device timing has **not** been measured. Target: no long task over 16 ms during W1, T5 or T6, and steady state under 4 ms per frame (script and style) on the Note 9 class. A device run is required before wiring; Pi 3 users are offered low power (DS-008) | Honest limits |

## 8. Builder scope

Writable:

- `docs/design/patterns/motion.css`: the `--task-*` and `--warning-*` tokens on `:root`; the keyframes `task-sweep`, `task-hold`, `task-rise`, `task-tick`, `task-badge`, `warning-glyph`, `warning-halo` and `task-fade`; part rules; the mode overrides (section 6); and the shake suppression. Use `var()` only on regular elements; keyframes on `.nexus-mark` SVG children keep literal offsets (AUD-07), and this file adds none.
- `docs/design/patterns/motion.js`: dwell queue, count throttle, arm guard, toast hold timer, `html.rm` to `data-still` sync, and a helper that reads ms tokens with `getComputedStyle`.
- `docs/design/theme/nexus-tokens.css`: additive section 2a block only, after parent approval (shared-token arbitration).
- `docs/design/patterns/checks/**`: the motion checks below, plus results JSON and logs.
- The component and demo files named by the pattern spec, for motion wiring only.

Read-only: `brand/*`, `boot/*`, `mockups/*` (startup keeps `nexus-boot.css` as is; adopting the tokens there is an integration-map item), and lane CSS (chat, Settings, Studio).

## 9. Acceptance checks

Record each check as observed or not run. A static pass is not a runtime pass.

1. **Properties:** an `animated-props` scan (port `chat/checks/animated-props.mjs`) of `patterns/motion.css` and the component finds only `transform` and `opacity` in `transition` and `@keyframes`.
2. **Tokens:** outside the `:root` token blocks, motion declarations in `patterns/*.css` contain no literal ms, s, `cubic-bezier` or px distance.
3. **Timelines:** using the Web Animations API (`getAnimations()`, paused, `currentTime` stepped), W1, T1, T5 (all three outcomes) and T6 start and end within ±16 ms of section 5. Everything is at rest by 340 ms (W1 caution), 880 ms (W1 danger) and `--task-result-delay` + 400 ms (T5).
4. **Reduced motion:** run with both the media emulation and `html.rm`. No running animation has a transform keyframe or transition. Every fade is 150 ms or less. The mark has no running animation. The fill has `transition: none`. Screenshots of the 8 task states and 2 severities are pairwise distinct.
5. **Low power:** the mark in `running` has at least one running animation and carries `data-low-power`. The sweep and hold have none. No translate or scale except press. Every non-loop duration is 120 ms or less.
6. **Reduced motion and low power together:** the mark is stopped.
7. **No shake:** in `failed`, `.nm-body` inside `task-mark` has computed `animation-name: none`. Nothing in the pattern animates `translateX` back and forth.
8. **Flash and vestibular:** every infinite opacity animation has a period of at least 1000 ms; every translate distance is 16 px or less (24 px for the sheet); there is no animated scale on `warning-panel`, the task panel or the toast.
9. **Arm:** confirm activated at 100 ms is ignored, and at 300 ms is accepted. Enter held from the trigger (key repeat) does not confirm. A second activation does nothing.
10. **Dwell and throttle:** 20 steps of 50 ms produce no more than one mark status change per 600 ms. 1000 counts per second produce no more than 4 text and ARIA writes per second. The fill never decreases.
11. **Focus:** W1 focus is on the default action at open. Close and T6 return focus to the trigger. T5 foreground focuses the result heading. The toast never takes focus. Resume after pause focuses the bar.
12. **Budget:** in steady `running`, infinite animations outside `.nexus-mark` number 1 or fewer per surface. Computed `backdrop-filter` is `none` on the scrim, panel, sheet and toast. `will-change` is gone after a terminal state.
13. **Pack bounds:** packlint fixtures reject `--warning-halo-dur: 2s`, `--task-sweep-period: 200ms`, `--nexus-dialog-enter-distance: 40px`, `--task-fill-ease: cubic-bezier(.3,1.6,.6,1)` and `--warning-arm-delay: 0ms`, and accept the defaults.
14. **Layouts:** W1, T5 (skips) and T6 are run and screenshotted at desktop 1280×800 and phone 390×844, in Deep Nexus and one acceptance pack. The mark box causes no layout shift (layout-shift entries during morphs total 0).
15. **Device:** a Note 9 and Pi 3 trace is marked "not run" until a device request; it is listed in the handoff.

## 10. Open questions (recommendation first)

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | The brand `error` pose shakes once (0.5 s, ±5 units). Keep it in task failure? | (a) Suppress it in this pattern only; (b) keep the brand shake; (c) remove it app-wide in `nexus-mark.css` (brand lane) | **(a)** It meets DD-222's no-shake rule with no brand change. Raise (c) with the brand owner later |
| Q2 | How does the mark show "done with skips"? | (a) The `done` pose plus a warning badge on the mark box, with the count in text; (b) a new mark status `done_partial` (amber centre); (c) text only | **(a)** No new mark status (the boot precedent), and it is still distinct in low power and reduced motion |
| Q3 | Should a danger warning get any motion cue? | (a) One halo expansion after open, danger only, off in reduced motion and low power; (b) no motion (severity entirely static) | **(a)** One non-repeating, low-opacity cue on a 40 px box; it is not a flash. (b) is acceptable if the user prefers strictly static |
| Q4 | Confirm arm delay after open | (a) 250 ms invisible guard; (b) no guard; (c) hold-to-confirm for danger | **(a)** It stops ghost taps and key repeat from the opening press confirming a destructive action, without slowing deliberate use |
| Q5 | When does the completion toast leave? | (a) Persist on skips or failure; auto-hide a clean done after 6 s, pausing on hover or focus; (b) always persist until dismissed; (c) always auto-hide | **(a)** Skips and failures need action; a 6 s minimum with pause meets the WCAG 2.2.1 intent |
| Q6 | Several background tasks at once | (a) One toast per task, 2 visible, older marks still, then a "+N" chip; (b) one combined toast | **(a)** Each task keeps its own Cancel and result. Product may prefer (b) on phone |

Assumption to confirm with the spec: `paused` means waiting on the person (the boot `waiting` sense). DD-221 has no user-pressed Pause control; if one is added, it uses the same T3 motion.
