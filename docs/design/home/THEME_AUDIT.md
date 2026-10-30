# Home theme audit (after the retrofit)

2026-10-28. Before: [reviews/2026-10-28-home-review.md](../reviews/2026-10-28-home-review.md) section 3 (about 575 literal values, 54 inline `style=""` attributes, 17 shared tokens used, no `data-part`, no `data-layout`). This file records the state after the retrofit and what a pack can rely on. Standing rule: [THEMING.md](../THEMING.md), DD-142..161, 182, 192, 195, 197.

## Result in numbers

| Measure | Before | After | How measured |
|---|---|---|---|
| Literal colour, size, radius, font size, duration or z-index in component CSS | about 575 | **0** in `home.css` (376 lines) | `checks/csslit.mjs` (also section `static` of the suite) |
| Inline `style=""` in the product DOM | 54 | **0** (a character's hue is `data-hue` plus one generated rule per hue; the tooltip position is one generated rule) | suite `static`, 22 page states; the seasonal wordmark subtree and `svg.nexus-mark` are excluded (not Home tokens) |
| `--home-*` tokens defined | 0 | 259 in `home-tokens.css` | count of declarations |
| `var(--home-*)` / `var(--nexus-*)` uses in `home.css` | 0 / 132 | 634 / 142 | grep |
| `data-part` names | 0 | 119 seen over 32 states (`checks/parts-found.json`), 23 of them critical | suite `parts`, lint check |
| Root attributes | none | `data-layout` (wide >= 1200, mid >= 768, phone), `data-input`, `data-power`, `data-motion`, `data-lang`, `data-theme` | `theme.js` |
| JS motion numbers read from tokens | 0 of 8 | stage 220 ms, top bar 180 ms, rail fade 180 ms, stage shift 14 px, top-bar shift 8 px, toast 2500 ms, tap slop 10 px, tap 500 ms, mark sizes | suite `tokens` changes the token and watches the behaviour follow |
| State kept in classes (`.collapsed .open .manage .nexus-selected .idle .loaded .placed .animate`) | 8 | 0 (all `data-*`) | suite `parts` |

Literals that remain, on purpose: `0`, `1px` hairlines, percentages and `100vh`; unitless layout counts in `repeat()`/`calc()`/`flex`; the two container-query breakpoints (`@container page (max-width: 860px)` for the Hybrid/Utility decks and `(max-width: 1000px)` for the Roleplay side column), which cannot be tokens; the media features `prefers-reduced-transparency`, `prefers-contrast` and `forced-colors`; the two `@font-face` blocks (descriptors and URLs cannot use `var()`). The three layout bands are owned by `theme.js` (`--home-bp-mid`, `--home-bp-wide` document them).

## Shared tokens Home consumes

`--nexus-canvas`, `-canvas-bloom`, `-canvas-warm` (the per-mode alpha is `--home-bloom-alpha-*`), `-surface`, `-surface-raised`, `-surface-flat`, `-edge`, `-edge-strong`, **`-field-border`** (search, selects; DD-160), `-blur`, `-text`, `-text-secondary`, `-text-muted`, `-accent` and `-accent-rgb`, `-ring`, `-core-from/to`, `-warm`, `-danger` and `-danger-rgb`, `-overlay-rgb`, `-shade-rgb`, `-ease`, `-duration-enter`, `--font`, `--color-placeholder` (every placeholder), `--color-surface-sheet` (dialogs), `--color-surface-toast`, `--color-accent-tint-strong`, `--radius-field`.

## Names Home had to add (candidates for promotion into `theme/nexus-tokens.css`, DD-145)

| Name | Why Home needs it | Proposal |
|---|---|---|
| `--home-warm-rgb` | the upstream tag edge and the presence glow need a tint of `--nexus-warm` | promote `--nexus-warm-rgb` (a pack states warm once, like accent) |
| `--home-success-rgb`, `--home-warning-rgb` | success edge, setup-note edge, finished-reply dot | promote `--nexus-success-rgb`, use the existing `--color-warning` as a channel |
| `--home-ring-rgb`, `--home-scrim-rgb`, `--home-composer-bg`, `--home-on-accent`, `--home-on-avatar` | colours with no shared name | keep Home-only; chat and Settings define their own `--color-scrim`, `--color-on-accent` with other values, so promote one agreed value each |
| `--home-touch` / `--home-hover-control` / `--home-control-height` | DD-213 (44 under touch, 40 under hover) | chat and Settings both have `--size-touch`; align the three |
| `--home-focus-w`, `--home-focus-offset` | focus ring | chat has the same pair |
| `--home-radius-*`, `--home-space-*`, `--home-text-*` | ladders | internal; only the role tokens below are the contract |

Role tokens a pack may set (DD-148): `--home-control-height`, `-control-radius`, `-control-pad-x`, `-control-gap`, `-card-radius`, `-card-pad`, `-card-gap`, `-row-height`, `-pill-height`, `-field-radius`, `-rail-width-*`, `-drawer-width`, `-topbar-pad-*`, `-main-pad-*`, `-center-width*`, `-side-width`, `-avatar-*`, `-portrait-height`, `-realm-min-height`, `-run-mark-size`, `-dialog-width`, the motion durations, `-toast-ms`.

## `data-part` list (119 names; stable role names)

- **Shell:** `home-shell`, `home-network`, `home-skip-link`, `home-drawer-scrim`, `home-rail` (+ `-item`, `-avatar`, `-bottom`, `-top`, `-new`, `-collapse`, `-section-title`, `-sep`, `-tooltip`), `home-topbar` (+ `-left`, `-right`), `home-brand`, `home-brand-mark`, `home-modes-wrap`, `home-mode-switch`, `home-mode-option`, `home-mode-thumb`, `home-menu-button`, `home-tasks-button`, `home-pill`, `home-badge`, `home-main`, `home-toast`.
- **Roleplay:** `home-greeting`, `home-eyebrow`, `home-shelf-section`, `home-shelf`, `home-story` (+ `-portrait`, `-body`, `-meta`), `home-memory-tag`, `home-tag`, `home-bg-badge`, `home-library`, `home-library-tools`, `home-search`, `home-sort`, `home-count`, `home-lib-tab`, `home-lib-msg`, `home-folder-chip`, `home-selection-bar`, `home-char-grid`, `home-char-card`, `home-char-row`, `home-avatar`, `home-trash-row`, `home-empty-hero`, `home-realm` (+ `-status`, `-list`, `-item`, `-more`, `-link`, `-announce`, `-consent-action`, `-gate`), `home-community`, `home-community-link`, `home-hub`.
- **Hybrid and Utility:** `home-presence`, `home-companion-portrait`, `home-framing`, `home-framing-option`, `home-composer` (+ `-field`, `-bar`, `-button`), `home-send`, `home-run-count`, `home-tasks-panel`, `home-run-card` (+ `-mark`, `-status`, `-progress`, `-actions`, `-stop`), `home-thread-row`, `home-quick-list`, `home-quick-start`, `home-chip-list`, `home-chip`.
- **Overlays:** `home-dialog` (+ `-title`, `-body`, `-actions`, `-action`), `home-picker`, `home-picker-item`, `home-task-list`, `home-task-group`, `home-task-row`, `home-task-actions`, `home-task-open`.
- **Leaves a pack may position (DD-161):** `home-avatar`, `home-rail-avatar`, `home-story-portrait`, `home-run-mark`, `home-companion-portrait`. (`home-bg-badge` left this list when DD-262 made it reach tier.)

## State attributes (DD-144)

Root: `data-layout`, `data-input`, `data-power`, `data-motion`, `data-lang`, `data-theme`, `data-quit` (simulated). Body: `data-mode`, `data-libfocus`. Parts: `data-current` (rail items, switcher, picker), `data-selected="true|false"` (mode options, segments, chips, tabs, toggles, rows; always a string, never an empty attribute), `data-status` (`running|done|failed` on stories, rail avatars, char cards, badges; the run status on `home-run-card` and rows), `data-state` (`active|queued|ended|idle`), `data-manage`, `data-library-view`, `data-realm` (`consent|pending|populated|failed|empty|offline`), `data-provider` (`ready|no-model|no-key`), `data-slim`, `data-collapsed`, `data-open`, `data-modes` (`all|only`), `data-kind`, `data-variant`, `data-size`, `data-shape`, `data-loaded`.

## Critical surfaces (`data-part-critical`, DD-149/155)

23 protected part names (registry `HOME_CRITICAL`): `home-leave-dialog` (the unsent-message warning), `home-agree-dialog` + `-links` + `-link` (the upstream agreement), `home-confirm` + `-title`, `-body`, `-actions`, `-action` (Move to Recently deleted, Delete permanently, and the dialog's children), `home-realm-gate`, `home-realm-consent-action`, `home-realm-status` (critical in the consent state), `home-trash-empty`, `home-trash-scope` (the sentence that says what emptying deletes), `home-bulk-result` (partial failure with Retry), `home-restore-error` (role alert), `home-setup-note` + `-action`, `home-composer-note` (the error line; kept outside the `<form>` so the composer stays a safe leaf), `home-draft-choice` + `-action` (Replace discards the draft), `home-run-retry`, `home-run-error`. Reach tier (they hold a protected child, so a pack may restyle but not hide or re-lay them): `home-shell`, `home-main`, `home-library`, `home-library-tools`, `home-empty-hero`, `home-realm`, `home-trash-row`, `home-tasks-panel`, `home-run-card`, `home-run-actions`, and the dialog frame (`home-dialog*`, because hiding it strands a modal on touch). Everything else is a safe leaf; the lint check proves in 27 live page states that no safe leaf contains or sits inside a protected element.

## Re-skins

- **Origin Navy** (`themes/origin-navy.css`, tokens only): chat's palette with the danger colour lifted to 255 128 128 (255 85 85 fails 4.5:1 on a raised card inside glass). Text 14.8:1, muted on raised 4.61:1, ring 11.4:1, field border 3.36:1.
- **Banana Cocoa** (`themes/banana-cocoa.css`, part CSS): a messenger skin. Shelf and library become chat-list rows, the rail items a light strip, Send sits inside the composer field, run cards read as bubbles. Walls the shared lint puts in front of a Home messenger layout (nothing was weakened): no bottom tab bar (needs `position: fixed` on a reach part), reach parts cannot be re-flowed, no pseudo-elements (no tails, no unread dots), no transitions, and class-compound page selectors force the pack to prefix `html[data-theme=...]`.
- **Stays Deep Nexus-coloured under both packs:** the status mark (`brand/nexus-mark.css`, 10 literal hexes) and the seasonal wordmark (`seasonal/seasonal-wordmark.css`, 14 hexes) are outside Home's tokens. Under Origin Navy the "Risu" half follows `--nexus-core-from` and reads slate (about 3.3:1 as large text).
- Stills: `stills/{deep-nexus,origin-navy,banana-cocoa}-{rp,hybrid}-{360,1280}.png` (12).

## What the pixel diff shows

[checks/diff/summary.md](checks/diff/summary.md): six pairs against the old page, with and without the font change. The page differs 13 to 40 percent; most of it is the Neo face re-flowing text, the page loading idle (Hybrid/Utility no longer start with a run, review m8), the switcher moving into the top-bar slot (DD-209), the persona chip and caption (DD-203), 44/40 px controls (DD-213), the 34 percent field border (DD-160) and the Recently deleted tab (DD-214).

## Changes to the default look worth knowing (Deep Nexus)

Neo UI face; field border 34 percent; controls 44 (touch) or 40 (hover) high; dialogs use `--color-surface-sheet` (opaque, about 1 percent different from the old 94 percent flat tint); memory tag edge uses the accent channel instead of the ring colour; danger text is `--nexus-danger` (lighter pink `#ff8fa0` retired); story portrait initials are light (they were unreadable dark on dark); status mark keeps animating in low power. The shared `--nexus-field-border` (white at 34 percent) measures 2.92:1 on `#00011c`, under the 3:1 DD-160 asks for: 36 percent would pass (a finding for the main session, shared file not edited).

## Open items

1. `home-pill` is one visual role on a link, a button and a static span; the suite accepts it. Decide whether the static context chip gets its own name.
2. The composer field and Send are safe leaves, so a pack may legally hide the primary input (chat's rule); product decision.
3. `--nexus-core-from` drives both the wordmark's first half and the progress bar fill.
4. Unnamed text children (name line, time, button label, run title) block Banana Cocoa from re-laying rows; names for them would widen what packs can do.

## Update 2026-10-28 (fix round 2 and the lint follow-up)

**14 leaf names added (DD-240)**, now in the registry: `home-story-name`, `home-story-branch`, `home-story-snippet`, `home-story-time`, `home-char-text`, `home-char-name`, `home-char-chats`, `home-thread-title`, `home-thread-time`, `home-run-title`, `home-run-meta` (swaps to `home-run-error` on a failed run), `home-hero-mark`, `home-rail-label`, `home-send-label`. Safe leaves except `home-rail-label` and `home-send-label` (their text is an accessible name: reach tier). Total names on the page: 133.

**DD-235 aliases (done):** `--home-touch` = `--nexus-touch`, `--home-focus-w` / `--home-focus-offset` = `--nexus-focus-ring-width` / `-offset`, `--home-warm-rgb` = `--nexus-warm-rgb`, `--home-success-rgb` = `--nexus-success-rgb`, `--home-warning-rgb` = `--nexus-warning-rgb`. The four Deep Nexus stills (rp and hybrid at 360 and 1280) differ from the pre-alias stills by 0 pixels at tolerance 24 (`checks/alias-diff.mjs`). `--home-ring-rgb`, `--home-scrim-rgb`, `--home-composer-bg`, `--home-on-accent` and `--home-on-avatar` stay Home-only.

**Banana Cocoa after DD-241/243:** the composer is reach tier, so the pack no longer re-lays it out; Send stays in the bar. The pack re-skins it with colour and radius only. Private helper variables are `--pack-*` (DD-258). Wall 6 (hidden Send label) is gone with the re-layout.

**Default field border:** `--nexus-field-border` is 36 percent (DD-236); an empty pack is accepted by the lint.

## DD-262 (2026-10-28)

`home-bg-badge`, `home-run-status` and the Tasks `home-badge` moved from safe to reach tier. They are the only signal that a reply or run is active, so a pack may restyle them but not hide, shrink or move them. Fixtures H17a-H17f in `checks/lint-home.mjs` show hiding is rejected.
