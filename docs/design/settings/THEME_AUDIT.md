# Settings & models theme audit (theme-readiness pass)

> **Final round (2026-10-27)** applied DS-075 to DS-078 and the second review's findings R-01 to R-16; see "Final round" at the end, which is current where it differs.
>
> **Fix round 1 (2026-10-27)** applied DD-145 to DD-159 and DS-069 to DS-074 and the review's findings T-01 to T-17; see "Fix round 1" at the end. Where it differs from the text below (token and part counts, critical marking, the re-skins' selectors, the findings), the end of this file is current. The first pass is kept as it was.

Standing rule: [THEMING.md](../THEMING.md), [DD-142](../DECISIONS.md), [DD-143](../DECISIONS.md) (geometry is tokenised too), [DD-144](../DECISIONS.md) (state is exposed as `data-*`). Scope: the three Settings pages (slice 1, slice 2 presets, slice 3 connections and model choice), their stylesheets, `data.js` / `data2.js` / `data3.js` and the inline styles their scripts set. Method and shape follow the chat pass ([chat/THEME_AUDIT.md](../chat/THEME_AUDIT.md)); the scanner is a copy of its `csslit.mjs`. Deep Nexus is the baseline and must not change: **the default look is pixel-identical before and after, 44 screenshot pairs (22 states, 3 pages, 360 and 1280), 0 differing pixels**, three full runs in a row. Nothing here touches the app, chat, Studio or the shared theme files.

Files: `theme-tokens.css` (the one token block), `theme.js` (the `?theme=` loader and the state mirror), `themes/origin-navy.css`, `themes/banana-cocoa.css`. Regeneration record: `checks/th/tokenize.mjs` (the token sweep, frozen: it refuses to run without `--force`), `checks/th/patch-parts.mjs` (part names, critical marks, loader and token sheet in the pages and scripts; every replacement matches exactly the stated number of times), `checks/th/before/settings/` and `checks/th/before/theme/` (the untouched pre-sweep copy of the three pages, their data files and the shared theme, served from there for the pixel diff and the counts). The suite is `node checks/run.mjs --suite th`; results and timing are in [checks/builder-checks-theme.md](checks/builder-checks-theme.md).

## How literals were counted

`checks/th/csslit.mjs` walks each stylesheet declaration by declaration and judges the value outside `var()`, `url()`, strings and `env()`. It is the scanner of the chat pass (copied, unchanged) and the same scanner runs in the suite (`TH-S-literals`, with a self-test on a probe rule, `TH-S-scanner-selftest`). The kinds (colour, font, radius, spacing, stroke, shadow, effect, motion, geometry) and the allowlist are the ones in the chat audit: `0`, `1px` hairlines, percentages used for layout math, keywords, `steps()`, counts and stacking (`z-index`, `flex: 1`), system colours inside `@media (forced-colors)`, and token definitions inside `theme-tokens.css` and the `:root` rules of a theme.

Synthetic fixture content that may stay literal: **none**. Settings has no sample images, avatar thumbnails or sample colours (the data files hold names, ids, labels and numbers; icons are lucide path data in `slice1.js` `ICONS`, which is markup, not a style value; the origin stub's avatar is painted from `--nexus-warm-*`).

## Counts

Literals judged by the scanner under the DD-143 allowlist, before the sweep (`checks/th/before/settings/*.css`) and after (`slice1.css`, `slice2.css`, `slice3.css`):

| Kind | Before | After | Distinct values before |
|---|---:|---:|---:|
| spacing | 540 | 0 | 29 |
| geometry | 216 | 0 | 62 |
| font | 165 | 0 | 18 |
| radius | 73 | 0 | 14 |
| colour | 70 | 0 | 34 |
| stroke | 38 | 0 | 3 |
| motion | 22 | 0 | 7 |
| shadow | 19 | 0 | 7 |
| effect (opacity, blur) | 13 | 0 | 9 |
| **Total** | **1156** | **0** | **183** |

By file, before: slice1.css 428, slice2.css 356, slice3.css 372. 11 of the 42 colour and motion hits in slice1.css were the old `:root` block and the low-power rule (`--danger`, `--panel`, the duration and easing custom properties, the 120 ms cap), which moved into `theme-tokens.css`. No blur is used anywhere in Settings (`backdrop-filter` count 0 before and after), so the blur kind is empty.

Inline styles and literals set from the scripts and pages, before and after:

| Where | Before | After |
|---|---|---|
| `style="..."` attributes in the three pages | 0 | 0 |
| `slice3.js` details buttons of the phone picker: `style="top:${Math.round(t + (h - 44) / 2)}px"` | 1 | `top` is computed per row; the 44 is read from `--size-touch` once (`settingsTheme.num`) |
| `slice2.js` switcher popover placement: width 380, gaps 8 and 6, clamp 240 to 560, margin 12 | 6 numbers | read once from `--sheet-width-panel`, `--offset-6`, `--offset-5`, `--switcher-min-height`, `--switcher-max-height`, `--offset-9` |
| `slice2.js` reduced-motion row move: `li.style.opacity = '0.4'` | 1 | `'var(--opacity-disabled)'` |
| `slice1.js` / `slice2.js` / `slice3.js` per-frame geometry (`transform` of a dragged row, the drop line, `left`, `top`, `maxHeight`, `maxWidth`, `--frame-w`, `--risu-animation-speed`) | many | unchanged: measured or computed per call, not a theme value |
| Inline SVG icons: `stroke-width="2"` in the `ic()` template | 1 (all icons) | `.ic { stroke-width: var(--stroke-icon) }` takes over (same 2 user units, so the pixels are the same) |
| Inline SVG icons: `width`/`height` from the call site (`ic(name, 14 to 28)`) | many | unchanged (see finding 8) |

The `th` suite fails if a page gains an inline `style` attribute or a script sets a literal colour, type, radius, spacing, shadow, opacity or motion value inline (`TH-S-pages`, `TH-S-js-inline`).

## Tokens

One block, `theme-tokens.css`, on `:root`: **208 custom properties** (89 of them rank-named scale steps, 33 of those "extra" steps chat does not have). 130 names are shared with `chat/theme-tokens.css` (122 with the same Deep Nexus value, 8 with a different one, finding 1); 78 are Settings-only. The shared `--nexus-*` tokens (`../theme/nexus-tokens.css`) are reused unchanged (13 are read by the Settings CSS, and the canvas through --color-on-accent, --color-on-avatar and the shared .nexus-canvas class). Names are shared wherever the role and the value are the same in chat: the sweep reads chat's token file and reuses its name when chat has the value for the same kind (`--space-7` is 8px in both), and gives values chat lacks an `x` name (`--space-x1` is 32px). Role names carry the role where it was clear (`--radius-control`, `--size-touch`, `--shadow-popup`, `--color-surface-sheet`, ...); everything else is a rank on a scale, as in chat.

| Group | Count | Names |
|---|---:|---|
| colour | 39 | `--color-scheme`, `--danger`, `--panel`; surfaces `--color-surface-sheet\|menu\|toast\|drag\|selbar\|demo\|chips`; `--color-scrim`, `--color-scrim-dialog`; `--color-option-bg\|option-text`, `--color-on-accent`, `--color-on-avatar`, `--color-knob`, `--color-switch-off`, `--color-chip`, `--color-chip-hover`; tints `--color-tint-faint\|tint-strong`, `--color-field`, `--color-hover\|hover-soft\|hover-card\|hover-menu`, `--color-text-dim\|text-dim-strong`; accent tints `--color-accent-tint-faint\|note\|pressed\|tint\|strong\|mark-soft\|mark`; `--color-danger-tint`, `--color-warning`, `--color-success` |
| type | 20 | `--font`, `--mono`, `--font-size-xs\|sm\|md\|base\|lg\|xl`, `--font-size-x1\|x2`, `--font-size-glyph-13`, `--font-weight-regular\|medium\|semibold\|bold\|extrabold`, `--leading-125\|150\|160\|170` |
| spacing scale | 24 | `--space-1` (2px) to `--space-24` (56px) in chat's names, `--space-x1..x6` (32, 52, 64, 72, 80, 88px); a density pack overrides the steps |
| radius | 19 | `--radius-1..13` (the steps in use), `--radius-pill`, `--radius-circle`, roles `--radius-control` (12), `--radius-card` (14), `--radius-field` (10), `--radius-sheet` (16), `--radius-popup` (14), `--radius-menu` (12), `--radius-search` (20) |
| stroke | 6 | `--stroke-bold\|heavy\|xheavy`, `--stroke-icon`, `--focus-ring-w`, `--focus-ring-w-forced` |
| shadow | 3 | `--shadow-popup`, `--shadow-drag`, `--shadow-menu` |
| opacity | 11 | `--opacity-hover\|press\|subtle\|disabled\|ghost\|half\|icon-off`, `--opacity-lifted`, `--opacity-scrim-switcher\|scrim-picker\|scrim-popover` |
| motion | 12 | `--chat-dur-fast\|base\|slow`, `--dur-fast-nominal\|base-nominal\|slow-nominal`, `--dur-lowpower-cap`, `--chat-ease-out\|spring`, `--ease-linear`, `--dur-spin`, `--risu-animation-speed` |
| geometry (DD-143) | 74 | roles `--size-touch\|touch-lg\|touch-sm`, `--size-avatar`, `--index-width`, `--index-width-mid`, `--search-width`, `--page-max-width`, `--dialog-width`, `--picker-width`, `--picker-detail-width`, `--palette-width`, `--sheet-width-panel`, `--demo-width`, `--switcher-min-height\|max-height`, `--angle-diagonal\|turn`, `--scale-press`; scales `--size-N`, `--size-xN` (box dimensions, 27 steps), `--offset-N`, `--offset-xN` (top, left, inset, translate distances, 12 steps), `--size-rel-N`, `--size-rel-xN` (rem, em, ch, vh and vw measures, 16 steps). Negative values are `calc(var(--x) * -1)`. The picker's and the palette's left offset is `calc(50% - var(--picker-width) / 2)`, so one token moves both |

Every default equals the literal it replaced. Reduced motion and low power are unchanged: `html.rm` and `html.nexus-low-power` still override `--chat-dur-*` and the spring, now from `--dur-*-nominal` and `--dur-lowpower-cap`. Loading order, in every page: `nexus-tokens.css`, `theme-tokens.css`, the slice stylesheets, then `theme.js`, which appends `themes/<name>.css` for `?theme=origin-navy|banana-cocoa` and sets `data-theme` on the root. No parameter, or an unknown name, loads nothing.

## Parts

`data-part="settings-<role>"` on **59 part names** (32 in slice 1, 12 added by slice 2, 15 by slice 3). No DOM order, role or label changed: every part is an added attribute. The names, elements and notes are in the "Appendix: Parts" section of [SLICE1_SPEC.md](SLICE1_SPEC.md), [SLICE2_SPEC.md](SLICE2_SPEC.md) and [SLICE3_SPEC.md](SLICE3_SPEC.md), and the `th` suite reads those appendices and fails if a page carries a name they do not list or they list one no page carries (`TH-P-documented`, `TH-P-all-seen`). Singletons (`settings-frame`, `-shell`, `-header`, `-search`, `-body`, `-index`, `-page`, `-results`, `-index-foot`, `-toast`, `-origin`) exist once per screen in every state of a 27-state tour (`TH-P-unique`).

Slice 1: `settings-frame`, `-origin`, `-shell`, `-header`, `-search`, `-body`, `-index`, `-index-item`, `-index-link`, `-index-foot`, `-page`, `-page-body`, `-page-header`, `-banner`, `-jump-chips`, `-section`, `-section-title`, `-rows`, `-row`, `-toggle-row`, `-toggle`, `-list-item`, `-callout`, `-results`, `-result-group`, `-result`, `-no-results`, `-dialog-backdrop`, `-dialog`, `-menu`, `-menu-item`, `-toast`. Slice 2: `settings-preset-card`, `-preset-chip`, `-preset-toast`, `-switcher`, `-switcher-panel`, `-switcher-option`, `-preset-library`, `-preset-group`, `-preset-row`, `-preset-selbar`, `-notice`, `-restore-points`. Slice 3: `settings-connection-list`, `-connection-card`, `-connection-detail`, `-fallback-editor`, `-fallback-item`, `-model-group`, `-model-row`, `-picker`, `-picker-panel`, `-picker-search`, `-picker-row`, `-picker-details`, `-fix-banner`, `-chat-error-card`, `-chat-status-row`. A row is `settings-row`; a row whose control is a switch is `settings-toggle-row` (a pack that styles every row selects both); rows without a control carry `data-row-kind="link|nav|note|unavailable"` and controls rows `data-type="switch|select|..."`.

Not given a part: the demo chrome (the wrench button and its panel, which are not part of the screen), the controls inside rows (inputs, selects, segmented groups, sliders: they are styled by tokens and by `settings-row` descendants in a pack's own part CSS), the origin stub's internals (header, transcript, composer: the chat mockups name those), and the per-row sub-elements.

### State attributes (DD-144)

State a pack may style is mirrored as `data-*` attributes by `theme.js`, from one table, derived from the class (or media query) and never set by hand elsewhere (`TH-A-one-place`). The classes stay for existing code and checks. The observer sees every class change and every node that is added to the page and runs before the next paint, so a pack never sees a class without its attribute.

| Attribute | On | Values | Mirrors |
|---|---|---|---|
| `data-changed`, `data-stack`, `data-highlight` | rows | present | `.changed`, `.stack`, `.hl` |
| `data-current` | index item, picker row, switcher option | present | `.cur` |
| `data-active` | search result, switcher option, preset row, picker row | present | `.act`, `.is-active` |
| `data-selected`, `data-selecting`, `data-dragging`, `data-lifted` | preset rows, library, cards | present | `.is-sel`, `.selecting`, `.dragging`, `.lifted` |
| `data-unavailable` | search result | present | `.unav` |
| `data-open`, `data-on`, `data-closed` | layers, toast and toggles, folders | present | `.open`, `.on` and `.ps-on`, `.closed` |
| `data-needs-connection` | picker row | present | `.need` |
| `data-bad`, `data-failed`, `data-shared` | connection card and model row, preset chip and row, shared-value row | present | `.bad` and `.c3-bad`, `.ps-failed` and `.is-failed`, `.ps-shared` |
| `data-capturing` | hotkey capture button | present | `.capturing` |
| `data-result` | connection test result | `ok`, `badkey`, `unreachable`, `quota`, `none`, `run` | `.c3-tres.<state>` |
| `data-motion` | `<html>` | `reduced`, `full` | `html.rm` |
| `data-power` | `<html>` | `low`, `normal` | `html.nexus-low-power` |
| `data-text` | `<html>` | `large`, `normal` | `html.big` |
| `data-input` | `<html>` | `touch`, `hover` | `(pointer: coarse)` |
| `data-overlay` | `<body>` | `dialog`, `switcher`, `picker` | `body.dlg-open`, `sw-open`, `mp-open` |
| `data-search` | `<body>` | `open` | `body.s-open` |
| `data-lay` | `<body>` | `wide`, `mid`, `phone` | existing |

`TH-A-sync` walks 15 states of the three pages and checks, for every element, that it carries an attribute exactly when it carries one of the mapped classes (and that `data-result` follows `.c3-tres`); `TH-A-covered` fails unless the tour met each attribute; `TH-A-follow-keyboard`, `-row-changed`, `-root`, `-input-*` and `-overlay` change state after load and read the attributes again.

### Critical surfaces

`data-part-critical` marks a surface a pack gives tokens to, never a rule. `settings-dialog` is one part for every dialog of every slice; `openDialog` takes a `critical` option and 14 call sites pass it:

| Surface | Where | Marked |
|---|---|---|
| Reset / destructive row confirmation | slice 1 `confirmDialog` | dialog |
| Failed-save guard (cancel, discard, retry) | slice 2 `openFailDialog` | dialog |
| Delete a preset; the last preset can't be deleted; delete a folder | slice 2 | dialog |
| Restore points; the restore confirmation | slice 2 | dialog (the list inside is `settings-restore-points`) |
| Import preview; export bundle | slice 2 | dialog |
| 최근 삭제 (the trash) and its purge confirmation | slice 2 | dialog |
| Unverified-model ask | slice 3 | dialog |
| Delete a connection (with the presets that use it); remove a key | slice 3 | dialog |
| The 고치기 banner | slice 3 `settings-fix-banner` | **while the fix is not saved** (it carries the error); `data-saved="1"` drops the mark |
| The failed-reply card of the chat stub (`role="alert"`) | slice 3 `settings-chat-error-card` | always |

Not critical, on purpose: the lock-off ask, new and rename, move to folder, slot assign and key swap, icon pick, compare, chain, add connection, add or edit model, module name, About and Terms, the help of the reset row. Which of these should be critical is finding 3.

## Re-skins

Both load through `?theme=` (`theme.js`), both have stills at 360 and 1280 in Korean (13 states) and English (3 states) in `checks/shots/th-<theme>-<page>-<state>-<width>[-en].png`, and neither adds a blur, a transition or an animation (`TH-E-themes-no-effects`).

**Origin Navy** (`themes/origin-navy.css`): tokens only, no part CSS, no selector but `:root` (and `:root[data-power="low"]` for the reduced-effects path). 55 custom properties: 18 shared `--nexus-*` (the same palette as chat's Origin Navy, so the two screens agree) and 37 Settings tokens (the panels written as near-black navy, the white and cyan tints restated for the navy palette, the status colours, three radii). On all three pages at 360 and 1280 it recolours the page, header, search field and text and moves nothing: every part's rect equals the default look's within 0.5 px, and the part list is the same (`TH-N-nomove-*`, 23, 20 and 30 parts). The recolour reaches the model picker panel (`TH-N-picker`).

**Banana Cocoa** (`themes/banana-cocoa.css`): light pastel, 71 custom properties (46 Settings, 18 shared, 7 pack-local `--pack-*`) and 17 part rules. Settings has no chat layout, so the rearrangement is the shell and the rows: the screen is a padded sheet with a floating, rounded header; the index is a rounded card holding one card per page, the current one banana yellow (`[data-current]`); every settings row is its own white card with a gap (the rows container loses its frame and becomes a grid; a changed row gets a banana edge from `[data-changed]`; hover darkens the border); section titles are yellow pills; the connection cards, model rows and list items get the same card treatment. DOM order, focus order (first 24 Tab stops), roles and accessible names (106 and 108 focusable or landmark elements) are identical to the default look's, opening a page from the index, searching and Escape behave the same, hover and the keyboard focus ring work, and nothing overflows at 360 or 1280 (`TH-B-*`).

Both override the derived tints and every light-canvas colour (finding 2): Origin Navy restates 34 of the 39 colour tokens (not `--color-scheme`, `--color-knob`, `--color-on-accent`, `--color-on-avatar`, `--color-scrim`: they follow the shared tokens or stay), Banana Cocoa 37 (not `--color-knob`, `--color-scrim`). Contrast: 60 text pairs per re-skin (text, secondary and muted text on every surface, accent, danger, warning and success, text on accent, on-avatar, dim text, chips and marks, translucent surfaces composited over what is behind them) meet WCAG AA 4.5:1 (lowest 4.53 for Origin Navy, 4.73 for Banana Cocoa), Banana's own pairs (cocoa on banana yellow 10.7, on white 13.7) and the computed text of the yellow index card, the section title and a row label do too (`TH-K-*`). For reference, the Deep Nexus pairs measured the same way have a lowest of 5.7.

### Tokens and parts the re-skins forced

- **`--color-on-avatar`** (new token). The origin stub's avatar initials took `--nexus-canvas`, which is near-white on Banana's cream canvas. Origin Navy needs nothing for it (its default is `var(--nexus-canvas)`).
- **`--color-surface-chips`** (the sweep named it, both re-skins must override it). The sticky jump chips sit on `rgb(0 1 28 / 0.97)`, a hard-coded copy of the canvas; left alone it drew a dark band across the light canvas in the first Banana still.
- **`--stroke-icon`** (new token). Not forced by a failure: the inline SVG icons carry `stroke-width="2"`, which is a literal outside the CSS; the property now reads the token, and Banana Cocoa uses 1.75px.
- **`:root[data-power="low"]` and `@media (prefers-reduced-transparency: reduce)`** in both themes (rule 4): the two glass surfaces become flat colours. This needed the `data-power` mirror on the root. The selectors are still `:root` rules; `TH-S-navy-only-root` allows a state qualifier.
- **Danger tint of Origin Navy**: upstream's `#ff5555` on its own 10 % tint over the sheet is 4.46:1, below AA, so the tint is 6 % there (4.5 or more).
- **Parts Banana selects beyond the brief's examples** (shell, index, page header, section, row, toggle row, search, results): `settings-body` (the column gap), `settings-index-item` and `-index-link` (the index cards), `settings-index-foot` (its corners, so the foot does not poke out of a rounded index card), `settings-rows` (the container loses its frame), `settings-section-title` (the pills), `settings-model-row`, `settings-connection-card` and `settings-list-item` (the same cards on the other pages). All were named before the re-skin from the same reading; the re-skin confirmed each.
- **State attributes Banana reads**: `data-current` (the selected index card) and `data-changed` (a changed row); both are mirrors of classes (`.cur`, `.changed`) that part CSS could not otherwise address without class selectors.
- **Selector forms beyond `[data-*]` and `:hover`**: `:last-child` (the base rule `.row:last-child { border-bottom: 0 }` has specificity 0,2,0 and out-ranks a part rule, so each card needs its own) and `::after` (the highlight ring of a row gets `border-radius: inherit` so it follows the card's corners). The suite's selector check allows both.

## Findings that need a decision

1. **Same token name, different Deep Nexus default, chat versus Settings.** Eight names are shared with chat but carry a different baseline value, because the baseline must stay pixel-identical: `--font` (Settings puts NanumSquare Neo first), `--color-surface-sheet` (`#0e0f2c` / chat `#0e0f2a`), `--color-surface-toast` (`#1b1d4a` / `#1c1e45`), `--color-warning` (`#ffd479` / `#ffd166`), `--color-accent-tint-faint` (0.07 / 0.06), `--color-accent-tint-strong` (0.16 / 0.14), `--radius-field` (10 / 14), `--radius-sheet` (16 / 20). A pack that sets one of them once changes both screens, but the two baselines start apart. Unifying the defaults is a small visible change to one of the screens (the radii are the visible ones); keeping them needs the pack author to know they differ.
2. **Derived colours are duplicated.** The accent, danger and hover tints, the chip and field tints and the two dim-text colours (22 tokens) restate the accent, danger and text colours as `rgb(... / a)`. A pack that changes `--nexus-accent`, `--danger` or `--nexus-text` must restate them; both re-skins do. `color-mix()` would derive them but is not on the Android 10 WebView floor (`TH-S-floor` checks that none is used). One floor-safe way is channel tokens, for example `--nexus-accent-rgb: 56 217 255` and `rgb(var(--nexus-accent-rgb) / 0.12)`, which the shared `nexus-tokens.css` already does for the network colours. That is a change to the shared file, which this pass was not allowed to make; it is reported, not done.
3. **Critical is opt-in per dialog call.** `openDialog` is critical only when the caller passes `critical: true` (14 call sites do); a dialog added later is not critical until someone marks it. Opt-out (critical by default, a dialog says `critical: false`) would fail safe; opt-in is what is built. Separately, which of the non-critical prompts should be critical (lock-off, key swap, slot take, add connection) is a product call.
4. **The index cannot change side.** `body[data-lay="mid"] .body { grid-template-columns }` (0,2,1) out-ranks any part rule, and `.index-foot` and `.results` are placed by `left: var(--index-width)`, so a pack can restyle the index but not move it (to the right, or to the bottom as a tab bar on a phone). Making the columns a token (`--body-columns`) and the offsets follow it would open this; Banana Cocoa therefore keeps the index on the left and rearranges around it. Related: `.idx-li.cur > .idx` (0,3,0) ties with `[data-part][data-current] > [data-part]` and wins only by source order (the theme loads last); a base rule that sets state paint should read a token instead.
5. **A pack that pads the shell narrows in-flow critical surfaces.** Banana's 12 px sheet padding makes the 고치기 banner 312 px instead of 336 at 360 (the card, its structure and its buttons are untouched). Dialogs are fixed to the viewport and keep their size exactly. Is a pack allowed to change the width a critical banner or card has, or only its tokens?
6. **Deep Nexus has no reduced-transparency path.** The Settings CSS uses the glass tokens (`--nexus-surface`, `-raised`, a 3 % and a 6 % white) directly, not the shared `.nexus-surface` class, so `html.nexus-low-power` and `prefers-reduced-transparency` do not flatten them in the baseline (unchanged by instruction). The re-skins carry the fallback (`TH-E-lowpower-flat`, `TH-E-reduced-transparency`); the baseline does not. Adding it to the baseline changes the look in those two modes only.
7. **Vocabulary differs from chat.** Settings keeps `body[data-lay="wide|mid|phone"]` (existing) where chat mirrors `html[data-layout="wide|narrow"]`; `data-input` is read from `(pointer: coarse)` here because Settings has no `touch-ui` class. A pack written for both screens needs to know both.
8. **Icon sizes are call-site numbers.** The icons are inline SVG whose `width` and `height` attributes come from `ic(name, size)` (14 to 28); the scanner reads CSS, so they are outside the zero-literal count. A pack can set one stroke (`--stroke-icon`) but can only resize icons by a `.ic` rule that overrides every size. Size tokens (`--icon-sm|md|lg`) would need the call sites to name a size, not a number.
9. **A pack can set `--size-touch` below 44 dp** (as in chat, finding 1 there): the minimum hit area is a pack-review rule, not something the CSS enforces.
10. **Pre-existing, not changed: the `ss-changed` state opens the row menu while the page is still settling**, so the menu's x position is off by a fraction of a pixel that differs from load to load (164.5, 164.7, 165.4 seen, also between two loads of the *old* page). The pixel diff therefore reopens that menu once the page is at rest, on both sides.

## What was not run

- No device or native run: headless desktop Chrome only. Android 10 WebView on a Note 9 and a Raspberry Pi 3 were not tried; the floor is checked by source only (`TH-S-floor`: no `color-mix()`, `:has()`, `@container`, `backdrop-filter` and the like in anything this pass added).
- Not rendered under the re-skins: 200 % text (`data-text` is mirrored and tested, but there is no still), forced colours, `html.rm` and low-power visuals beyond the opacity of the glass tokens and the page-change animation name, drag and lift states, press states, the hotkey capture state, the switcher palette and phone sheet, the slice 2 trash and purge dialogs and the key-swap and slot dialogs (they share the `settings-dialog` markup that the 13 critical surfaces that were run use).
- English is rendered under both re-skins for three states per width (`slice1` display page, the preset library, the models page); every other state is Korean only.
- No keyboard walk-through of the dialogs, the picker or the switcher under a re-skin beyond the Tab order of the page and the focus ring of one control; the existing `ss1` to `ss3` suites cover those flows in the default look only.
- The shared `theme/nexus-tokens.css` was not changed or tested for a change (finding 2).
- No timing-sensitive performance numbers were taken in this pass; `ss3` `pickerperf` passed with its own budgets on a machine that was shared with another session's checks.
- Reviewer pass: none. This is the builder's own evidence.

## Fix round 1

Applies the decisions DD-145 to DD-159 and DS-069 to DS-074 and fixes the independent review's findings T-01 to T-17 ([the review](../reviews/2026-10-27-settings-theme-review.md); its probes were reused for the checks). Checks: [checks/builder-checks-theme.md](checks/builder-checks-theme.md), part "Fix round 1". Totals at 3 workers: `th` 257 / 257 (93.5 s), `ss1` 578 / 578 (72.1 s), `ss2` 650 / 650 (88.4 s), `ss3` 775 / 775 (99.4 s).

### What changed, by decision

| Decision | What was done |
|---|---|
| **DD-145** one meaning per shared name | The 8 local copies (`--font`, `--color-surface-sheet`, `--color-surface-toast`, `--color-warning`, `--color-accent-tint-faint`, `--color-accent-tint-strong`, `--radius-field`, `--radius-sheet`) are gone from `theme-tokens.css`; Settings reads `theme/nexus-tokens.css`. What Settings really meant differently is `--settings-font` (NanumSquare Neo first, then the shared stack) and `--settings-radius-dialog` (a centred dialog, palette or picker panel: 16px; the shared `--radius-sheet` is the top corners of a bottom sheet). Visible changes: table below. |
| **DD-146 / DD-158** channels | Every tint, hover, shadow, scrim and dim-text colour is `rgb(var(--nexus-<accent, danger, overlay or shade>-rgb) / a)`; two Settings channels (`--settings-canvas-rgb`, `--settings-scrim-rgb`) cover the night-blue scrim and the canvas behind the sticky chips. `--danger` is `var(--nexus-danger)`. **The nexus edit has landed**: `theme/nexus-tokens.css` has `--nexus-accent: rgb(var(--nexus-accent-rgb));` and `--nexus-danger: rgb(var(--nexus-danger-rgb));` (those two lines only). `ss1/console.mjs` compares the computed colour. Both re-skins set each colour once (`TH-S-pack-states-once`, `TH-S-nexus-solids-derived`). Alphas a pack may need to move for contrast are tokens, not restated colours: `--alpha-switch-off`, `--alpha-text-dim`, `--alpha-text-dim-strong`, `--alpha-mark`, `--alpha-mark-soft`. |
| **DD-147 / DD-159** layout and input | `html[data-layout=wide\|mid\|phone]` (set by slice1.js from the app width) replaces `body[data-lay]` and `#hdr[data-lay]`; `html[data-input=touch\|hover]` follows the one rule (`(hover: hover) and (pointer: fine)` is hover, else touch). Packs may set tokens under both (the index-right fixture does). |
| **DD-148** role tokens | 75 new tokens (208 to 283): about 60 role tokens that are the pack contract (list below), the DD-153 hooks, the alpha tokens and the breakpoints. The ranked ladder (`--space-N`, `--size-N`, `--offset-N`, `--radius-N`, 89 names) is internal: components read a role token where there is one, and it defaults to the ladder step it replaced. `--focus-ring-offset` (8 rules), `--icon-size-xs\|sm\|md\|lg\|xl\|2xl`, `--settings-icon-size-inline\|mark\|feature`, `--icon-stroke` (was `--stroke-icon`; chat's name), `--icon-scale`. The 178 `ic()` call sites take a size name and the markup carries no width, height or stroke-width (`TH-S-ic-sizes`). Breakpoints (`--breakpoint-wide\|mid\|sheet\|chip-full\|chip-name`, the chip ratios, the popup margins) are custom properties read once by `settingsTheme.num`; the CSS that depends on the layout reads `html[data-layout]` (a media query cannot read a property). The scanner's blind spot is fixed (below). |
| **T-09** timers | `settingsTheme.afterMotion(el, fn, pad)` runs on `transitionend` / `animationend`, with the computed duration plus a margin as the fallback, read in the next frame (reading it at once forced a style recalculation inside the first search keystroke: `ss1` P-key-4x p95 went from 10 to 85 ms until it moved). The page-slide `.off`, the library FLIP and the toast's `gone` follow it; `TH-S-js-constants-timers` forbids a fixed timer there. |
| **DD-149 / DD-155 / DS-072** critical | Critical by default: `openDialog` marks any dialog with a danger button (`critical: false` opts out, `true` opts in). Also critical: the save-failed retry (`settings-save-retry`), the failed row and the failed chip (`data-part-critical`), the Undo toast after a delete (`data-kind` delete, folder or conn-delete), the lock-off ask, the key swap and the slot take. The backdrop is marked with its dialog; title, body, footer and buttons are `settings-critical-title\|body\|actions\|action` (a normal dialog: `settings-dialog-title\|body\|actions` and `settings-button`). The dialog survives a hidden backdrop in script (display or visibility restored inline, a document-level Escape). Chat's pack-install rule is run over both packs and over negative fixtures (below). |
| **DD-153 / DD-156** parts and states | 92 parts (from 59): buttons, fields, segmented controls, row label / description / control, dialog title / body / actions, preset-row, connection-card and picker-row innards, scrims, the test result, the migration notice's own name. **Every picker model row carries `settings-picker-row`** (T-04). Selection, scrollbar and caret tokens; the accent-tint selection stays (DD-156). In use is `data-current`, the cursor is `data-active`, everywhere; new: `data-renaming`, `data-dragging` (the library too), `data-no-model`, `data-top`, `data-same`. `data-overlay` is one value, dialog > picker > switcher; the picker no longer borrows `sw-open` (T-05). |
| **DS-071** rendered contrast | `TH-R`: 42 items photographed in the rendered page, text 4.5:1, non-text 3:1 (switch tracks, field borders). Navy and Banana pass; `--color-placeholder` is defined in `theme-tokens.css`. |
| **DS-073** | In Deep Nexus, low-power mode and `prefers-reduced-transparency` swap the glass for two opaque tokens (`--settings-surface-opaque`, `--settings-surface-raised-opaque`; a pack states those two). |
| **DS-074** | The index side and column widths are role tokens (`--body-columns`, `--body-columns-mid`, `--index-column`, `--page-column`); the index footer and the search results are grid items in their column, so no `left:` offset is left; the `.idx-li.cur` tie is fixed by specificity (`.idx[aria-current="page"]`, 0,2,0, against the pack's 0,3,0). |
| **DS-069** copy | `keyLocal` in SLICE3_SPEC §2 and §9, `slice3.js` KO and EN, and the `koen` check. KO: "키는 이 기기에만 저장돼요. 실행 취소와 복원 지점에 남지 않고, 공유용 내보내기에도 들어가지 않아요. 전체 백업에는 키가 들어가요." EN: "Keys aren't kept in undo or restore points, and aren't included in exports for sharing. Full backups keep them." The integration row of SLICE3_SPEC follows. |

### Visible changes to the default look

Everything else in Deep Nexus is pixel-identical to the pre-round copy (`checks/th/before-r1`, which carries the intended changes below so the diff isolates the rest): 50 screenshot pairs at 360, 900 and 1280, 0 differing pixels (`TH-D`). The intended differences, each read from the original pre-sweep page and the current one, with stills (`checks/shots/th-r1-intended-<id>-before.png` and `-after.png`; `TH-I`):

| Change | Before | After | Why |
|---|---|---|---|
| Dialog, palette, picker panel, switcher sheet surface (`--color-surface-sheet`) | `#0e0f2c` | `#0e0f2a` | DD-145 |
| Text fields, selects, segmented controls (`--radius-field`) | 10px | 14px | DD-145 |
| Top corners of the phone bottom sheets (`--radius-sheet`) | 16px | 20px | DD-145 (a centred dialog keeps 16px: `--settings-radius-dialog`) |
| Toast, demo button (`--color-surface-toast`) | `#1b1d4a` | `#1c1e45` | DD-145 |
| Unverified tag, warning marks (`--color-warning`) | `#ffd479` | `#ffd166` | DD-145 |
| Accent tint, faint (active preset in a list, notices) | 7 % | 6 % | DD-145 |
| Accent tint, strong (a pressed filter chip) | 16 % | 14 % | DD-145 |
| Selected text | the browser's blue | accent tint, 35 % | DD-156 |
| Header, rows, index and raised surfaces in low power and with reduced transparency | translucent (header 94 %, rows 3 %) | opaque (stills `th-r1-lowpower-default-before.png`, `-after.png`) | DS-073, in those two modes only |
| The key row's help line (slice 3 connection page) | "…실행 취소·복원 지점·내보내기에 들어가지 않아요." | the DS-069 copy (two sentences) | DS-069 |

The body face is unchanged (NanumSquare Neo first, then the shared stack): a check reads it in both pages. Placeholders keep the browser's grey as a token (`--color-placeholder`, `rgb(117 117 117)`), so the default look is unchanged there.

### Role tokens (the Settings pack contract)

Shared with chat by name and default: `--control-gap`, `--control-padding-x`, `--focus-ring-offset`, `--icon-stroke`, `--icon-scale`, `--icon-size-xs\|sm\|md\|lg\|xl\|2xl`, `--selection-bg`, `--selection-text`, `--scrollbar-color`, `--scrollbar-width`, `--caret-color` (chat holds its own copy of each; finding 3). Settings: `--field-padding-x\|y`, `--field-min-height`, `--settings-button-padding-x`; header (`--settings-header-height`, `-height-phone`, `-padding-x\|y`, `-padding-x-phone`, `-gap`); index (`--settings-index-padding`, `-padding-phone`, `--settings-index-item-height`, `-height-touch`, `-height-phone`, `-padding`, `-gap`); page (`--settings-page-padding-x`, `-padding-x-phone`, `-padding-bottom`, `--page-max-width`); sections (`--settings-section-gap`, `-gap-first`, `--settings-section-title-gap`, `--settings-section-title-width`); rows (`--settings-rows-gap`, `--settings-rows-overflow`, `--settings-row-padding-start`, `-padding-end`, `-padding-y`, `-min-height`, `-last-border-width`, `-ring-radius`); dialog (`--settings-dialog-padding`, `--dialog-width`, `--settings-dialog-actions-gap`, `-actions-margin-top`, `--settings-radius-dialog`); layout (`--body-columns`, `--body-columns-mid`, `--index-column`, `--page-column`, `--index-width`, `--index-width-mid`); icons (`--settings-icon-size-inline\|mark\|feature`); contrast (`--alpha-*`, `--color-placeholder`, `--color-link`); reduced transparency (`--settings-surface-opaque`, `--settings-surface-raised-opaque`).

The scanner now flags a focus-ring offset and a 1px padding or margin (T-08). The count before the sweep is 1172 under the stricter rules (spacing 548, geometry 224), after 0; the 8 rings are `--focus-ring-offset`, the 8 one-pixel measures `--hairline`.

### Re-skins after the round

**Origin Navy**: 45 tokens, only `:root`, no media rule (the reduced-transparency swap is the default look's now). It sets the accent, danger, overlay and canvas channels once. Four values differ from upstream's default scheme, all found by the rendered gate: `--nexus-danger-rgb` is `255 110 110` (`#ff5555` measured 3.97:1 on a raised button and 4.11:1 on a tinted row), `--nexus-edge-strong` is `#7482b8` (a field's border was 2.86:1 against its row), `--alpha-switch-off` is 0.4 (the off track was 1.73:1) and `--alpha-mark` 0.16 (the search highlight put its text at 4.12:1). DD-150 asks Navy to keep upstream's colours; these are the exceptions, each with its reason in the file (finding 5). **Banana Cocoa**: 65 tokens and 17 part rules, all on the pack-install rule's allowlist; what needed `display`, `overflow`, `:last-child` or `::after` is a role token now (`--settings-rows-gap`, `-rows-overflow`, `-row-last-border-width`, `-row-ring-radius`, `-section-title-width`). Its off switch is `--alpha-switch-off: 0.6` (T-10: 1.99 became 3.27:1); `--color-placeholder` and `--color-link` are cocoa; the dim text and the highlight are tuned (4.12 became 4.5 or more).

Rendered contrast (`TH-R`, 1280, 42 items each): Origin Navy lowest 3.41 (the off track), 3.61 (a field's border), 4.52 (a placeholder), 4.58 (a danger button); Banana Cocoa lowest 3.04 (a field's border), 3.27 (the off track), 5.14 (a danger button). Deep Nexus is measured as information: the off track 1.62:1, a field's border 1.8:1 and a placeholder 3.79:1 are below the rule (finding 1).

### Pack-install rule (DD-149, DD-155)

`checks/th/lint.mjs` runs chat's validator (`chat/checks/th/packlint.mjs`, imported, not changed) over both packs: both accepted. The negative fixtures (`checks/th/fixtures/`) are rejected: a hidden backdrop (the review's `display: none`), a backdrop that moves the dialog, the footer in `row-reverse` (named by part, and the review's `.dlg-f` under the frame), `[data-dlg="cancel"]{display:none}`, a hidden row, a hidden retry, a faded Undo toast. The positive fixture `index-right.css` (the index on the right through role tokens) is accepted. The Settings part lists are appended to packlint's exported arrays by `packlint-settings.mjs` (notes for the main session in finding 2).

### Checks that can fail now (T-12)

`TH-P-on-the-documented-element` (a part must sit on the element the spec's Selector column names), `TH-P-no-unnamed-main-element` (71 main classes: any instance without a part fails; it found the HTML buttons, the toast text, the library header and six kinds of row), `TH-P-safe-leaves` (the parts packlint treats as safe are never inside a critical element), `TH-A-map-equals-expectation` and `TH-A-class-census` (a state class missing from both the mirror and the check is found), the rendered gate with its own teeth test, and the lint fixtures. The token-pair line that recorded `true` by construction is gone; the rule-5 reorder is exercised by the index-right fixture (DOM and focus order unchanged with the index moved).

### Open findings after the round

1. **Deep Nexus fails non-text contrast**: the switch's off track 1.62:1 and a field's border 1.8:1 (3:1 needed), and a placeholder 3.79:1 (4.5 needed). The baseline is unchanged by instruction. Raising `--alpha-switch-off` and the field edge in Deep Nexus is a visible change that needs a decision.
2. **packlint is written for chat**: its `CRITICAL_PARTS` and `SAFE_LEAVES` are module constants (this round appends Settings' names to the exported collections), and its default tokens are read from chat's `theme-tokens.css`. The part lists should be parameters or a per-screen registry; critical elements that carry no critical part (the failed row, the failed chip, the Undo toast) are judged by the conservative "reach" tier. No change was made to packlint.
3. **Names defined twice**: chat and Settings each define `--control-gap`, `--control-padding-x`, `--focus-ring-offset`, `--icon-*`, `--selection-*`, `--scrollbar-*` and `--caret-color` with the same defaults. The shared file would hold them once (DD-145's rule); `--color-placeholder`, `--alpha-*` and the breakpoints are candidates.
4. **A card pack narrows in-flow critical surfaces** (unchanged, finding 5 of the first pass): Banana's shell padding makes the fix banner 312 px against 336 at 360. `TH-C` compares a dialog's size and an in-flow surface's layout properties and the order of its choices, not its width.
5. **Origin Navy deviates from upstream's values in four tokens** for AA (above). Confirm, or move the gate's threshold for Navy.
6. **`ps-row-menu` and `ss-changed` are unstable in the original page** (before against before: 8696, 3890, 8696 and 333, 333, 255 differing pixels). `ps-row-menu` is not in the pixel diff; `ss-changed` reopens its menu at rest.
7. **The slot-take dialog is critical by choice but no check opens it** (the call carries `critical: true`; `TH-C-asks-marked` reads the source).
8. **T-15** (the DD-144 observer cost) is left as it is: the review measured 1.5 to 9 % inside the callback and the keystroke budget holds (`ss1` P-key-4x p95 10 to 11 ms). **T-17** is a comment in `theme.js` (`num()` caches the first read).

### What was not run (fix round 1)

No device, WebView or Pi 3. The rendered gate runs at 1280 only (not 360) and takes "the text colour" as the colour farthest from the background in the element's rectangle; gradients and images are not measured. Forced colours, 200 % text, drag and press states, the trash, purge and slot-take dialogs under the re-skins, and English beyond three states per width were not run. The chat suite did not get the rendered gate (the main session owns it). No independent re-review of this round.


## Final round (2026-10-27)

Applies DS-075 to DS-078, the re-review's findings R-01 to R-16 ([reviews/2026-10-27-settings-theme-rereview.md](../reviews/2026-10-27-settings-theme-rereview.md), its probes in `reviews/settings-theme-rereview/` reused as fixtures and gates) and the two design defaults taken with the answers (Q2 warnings critical, Q5 key copy). The parent and this builder check it; there is no further re-review. Where this part differs from "Fix round 1", this part is current. Boundary kept: only `docs/design/settings/**` written; `theme/nexus-tokens.css` not touched this round (the shared values are proposed below); `chat/**` not touched (chat's `packlint.mjs` and `cdp.mjs` imported unchanged).

### Decisions applied

| Decision | What was done |
|---|---|
| **DS-075 / R-01 / R-02 / R-10** pack-install rule bounds values | `checks/th/packlint-settings.mjs` rewritten. It calls chat's `lintPack` first and keeps every chat error, then adds only what chat does not say (below). The part lists are a parameter (`lintPack(css, name, registry)`); chat's module lists are set for the one call and restored, so nothing stays mutated (`TH-L-registry-param`). 73 fixtures in `checks/th/fixtures/attacks.mjs` (60 must be rejected, 13 must be accepted) plus the 7 file fixtures of round 1. |
| **Re-review Q2** (design default) warnings are critical | `data-part-critical` and a part on: the connection card's reason (`.c3-cwarn`, part `settings-connection-warning`) and its status line while the connection has a problem (`settings-connection-card-status`); a test result that is not `ok` (`settings-test-result`); the picker warning and the key-needed mark (`.mp-warn`, `.mp-need`, part `settings-picker-warning`, on a row and in the details pane); the fix mark button (`.c3-markbtn`, `settings-fix-mark`, found by the rendered gate on a selected library row); the failed-save badge on a library row (`settings-preset-warning`); the warning notices, the deeplink banner and the index notice (`p.banner.warn`, `settings-warning-banner`; plain notices stay `settings-banner`). Seven new critical names, 16 in all. Parts that hold one of these left the safe list (found by `TH-P-safe-leaves`): `settings-index` (the phone index notice sits in it), the connection list, card and card main, the picker, its panel, row, row detail, row tags and details pane, the model group and model row. 31 parts are safe now. |
| **DS-077** Deep Nexus meets the contrast it asks of packs | Settings-owned tokens only (`theme-tokens.css`): `--alpha-switch-off` 0.18 to 0.36, new role token `--settings-field-border` (white at 34 %, read by fields, search, the segmented control and the composer instead of the shared `--nexus-edge-strong`), `--color-placeholder` `#757575` to `#888aaa`. Both packs state `--settings-field-border: var(--nexus-edge-strong)` so they do not move. Measured in the rendered page (1280 / 360): off track 1.62 to **3.23 / 3.31**, field border 1.80 to **3.41 / 3.47**, key placeholder 3.79 to **5.21 / 4.74**. Details and stills below. |
| **DS-078 / R-03** inset focus rings | `--focus-ring-offset-inset` (`calc(var(--focus-ring-w) * -1)`) is the outline offset of `.rl`, `.seg-b` (slice 1), `.ps-main`, `.ps-fmain`, `.ps-more`, `.ps-fmore` (slice 2), `.c3-mbtn` and `.c3-markbtn.lib` (slice 3): elements that fill a clipping parent. A sticky selection bar covered a focused fix mark at 360 (found by the new ring check, not by the review): `#pageScroll` gets a `scroll-padding-bottom` as tall as the bar while selecting. |
| **DS-078 / R-04** the gate at both widths, the list, the sweep | `TH-R` runs at 1280 and 360 (44 items each; `ps-library-select` and the selected library row's fix mark are on the list; 43 exist on a phone). The border sample is the best of three rows, because a fractional y missed the 1px border at 360. `TH-S-sweep-*` is the re-review's computed sweep as a second gate: every visible text and placeholder in all 96 states at both widths, three looks (exempt: disabled controls and the avatar gradient). `TH-F-ring-pixels-*` photographs 11 tour states per width (231 keyboard stops per look) and requires every stop to change pixels. |
| **DS-076 / R-05** Navy | Header comment: "upstream's scheme, adjusted for AA (DS-076)"; the danger red `#ff6e6e` and the field edge `#7482b8` are the only colour changes; the Settings alphas are the pack's own tokens and are no longer listed as deviations. To keep AA in a library row the pack also states `--nexus-surface` at 8 % (it was 10 %: the red key warning on an unselected row read 4.497:1 in the computed sweep) and `--alpha-accent-tint: 0.05` (a new Settings token, default 0.12; the selected row was 3.83:1, now 4.52:1). These are pack values for the glass and the Settings tint, not colour changes from upstream. |
| **Re-review Q5** (design default) key copy | KO: "키는 실행 취소·복원 지점·공유용 내보내기에는 들어가지 않아요. 전체 백업에는 들어가요." EN unchanged. SLICE3_SPEC §2 and §9, `slice3.js`, `ss3/koen.mjs`, `ss3/conn2.mjs`, `TH-M-key-copy`; the frozen `before-r1` copy carries it so the pixel diff stays about everything else. |

### Pack-install rule: what chat already says, and what Settings adds

Reused from chat as they are (a Settings pack goes through chat's `lintPack` first): the selector reach rules; the protected part names (`CRITICAL_PARTS`, here with the Settings registry); tokens only on `:root` and `html[data-input|data-layout]`; the reach tier's declaration allowlist; the global bans (`position: fixed|sticky`, `z-index`, `animation`, `transition`, `filter`, `transform`, `content` ...); `tokenCheck` (critical text 4.5:1 on the sheet and the bubble, `--size-touch-lg` >= 32, `--size-touch` >= 24, font sizes >= 11, sheet / control / item padding and gap <= 48, `--focus-ring-w` >= 1).

Added by Settings (`packlint-settings.mjs`, `extraPass`), and only these:

1. **Role-token bounds** where chat has no limit. Padding, gaps and margins of the dialog, actions, rows, header, sections and page reuse chat's 48 px. `--dialog-width` 280 to 640 px; `--page-max-width` 480 to 960; `--index-width(-mid)` 160 to 360; panel widths 200 to 960; header height 32 to 96; row minimum 32 to 120; field minimum 24 to 64; `--dur-fast|base|slow-nominal` and `--dur-lowpower-cap` 0 to 600 ms; radii <= 32; hairline <= 4; icon sizes 10 to 48; ranges for `--icon-scale`, `--icon-stroke`, `--focus-ring-offset`; alphas (dim text >= 0.6, switch off >= 0.1, highlight <= 0.4, selection tint 0.02 to 0.3); `--body-columns(-mid)` tracks 120 to 560 px; `--index-column` and `--page-column` one each of 1 and 2; section title width auto, fit-content or >= 120 px. Values are evaluated through `var()` and `calc()`; a value that cannot be bounded is refused.
2. **Contrast on the Settings surfaces** (chat checks the sheet and the bubble): `--nexus-text` 4.5:1 on the canvas, the row glass, a raised surface and the toast; `--nexus-text-secondary` on the canvas and the row glass; `--nexus-danger` 4.5:1 on the dialog, the canvas and the row glass; `--nexus-ring` 3:1 on the canvas and the dialog; `--settings-field-border` 2:1 (a gross "invisible" test; the rendered gate does the real 3:1); `--selection-text` not transparent.
3. **A safe-tier declaration list** (chat skips the allowlist for safe leaves): no `position` other than `static` or `relative`, no `top|right|bottom|left|inset*`, no `float`, no width or height beyond 480 px or a relative one, no negative margin.
4. **Named colours, `hsl()`, gradients and backgrounds** (chat's `colourUnsafe` waves any bare word through): the 148 named colours and `hsl()` are resolved; `color` on a reach subject must be 3:1 (chat's own threshold) on the dialog, the canvas and the row glass, unless the same rule sets its own readable pair; `background` and `background-color` on a reach subject must leave `--nexus-text` 3:1 (unless the rule sets its own 4.5:1 pair) and `--nexus-danger` 3:1 always; every stop of a gradient is tested.

Every escape of the re-review is a negative fixture that is rejected (`TH-L-value-reject`): 400px dialog padding, a 60 s fade (also fast and slow), a 120px and a 5000px dialog, a 10px page width, 5000px and 0px index columns, an index and a page in one column, a 300px row gap, a 3000px row, a 0px header, a 1px field, a 2px section title, a 100px hairline, a 900px radius, 0px icons, a transparent ring, hidden selected text, near-invisible dim text, danger in the colour of the sheet, a positioned header, search, results, chips and scrim (`position:absolute;inset:0`), a 100vh header, a negative index margin, `color:black` on Cancel, on both dialog buttons, the row, the body, the shell and the page, a named dark colour, black `hsl()`, a white row background (hex, named, gradient, and with its own pair that leaves the danger marker at 2.7:1), a white shell, a white page behind a dialog, a white Cancel, and the seven warning parts by name. 13 fixtures that a card pack legitimately needs are accepted (`TH-L-value-accept`). Both packs are accepted.

#### Proposed upstream change to chat's `packlint.mjs` (a diff against its current rules, for the main session)

Chat's rule has the right shape; the gaps are in what it reads. This is the smallest change that gives Settings, and any later screen, the same protection without a Settings-only copy:

```
- export const CRITICAL_PARTS = [...]; export const SAFE_LEAVES = new Set([...]);            // module constants
+ export const lintPack = (css, name = '', reg = CHAT_REGISTRY, T0 = APP) => ...              // reg = { critical, safe, surfaces }
+ // analyse(), reachAllowed(), tokenCheck() take reg; a screen no longer mutates module state
- const APP = readTokens(tokenFile('../../theme-tokens.css'), ...)                            // chat's token file only
+ // APP is a parameter (the screen's theme-tokens.css), default chat's

  tokenCheck():
+   a BOUNDS table (name pattern -> [min, max, unit, why]); chat's own six checks (sheet-padding-x <= 48,
+     control-padding-x <= 48, item-gap <= 48 ...) become rows of it, so a screen adds rows, not code
+   surfaces: the screen's critical surfaces (token + layer) replace the fixed [sheet, bubble] pairs
+   --nexus-ring >= 3:1 on every critical surface (chat only requires --focus-ring-w >= 1)
+   --dur-*-nominal <= 600 ms
  colourUnsafe():
-   /^[a-z]+$/ -> ''                    // any bare word passes, so color:black is fine
+   resolve the 148 CSS named colours and hsl()/hwb(); refuse unknown words
  reachAllowed():
+   background / background-color: every colour stop (gradients included) keeps the critical text >= 3:1 and the
+     danger text >= 3:1, unless the rule also sets a readable colour pair
+   color: >= 3:1 on every surface of reg.surfaces (not only the sheet), unless the rule sets its own background pair
  safe tier (analyse() tier 'safe'):
+   a short declaration list: position only static/relative; no top/right/bottom/left/inset; no float;
+   no width/height beyond 480 px or relative; no negative margin
```

`packlint-settings.mjs` is a working implementation of every `+` line (about 190 lines, no browser needed) with 73 fixtures; it can be lifted into `packlint.mjs` as it is, with chat's registry as the default argument. Chat's own critical-part and safe-leaf censuses would then run over the same registry.

### Visible changes to the default look (Deep Nexus) this round

Everything else in the default look is pixel-identical to `before-r1` (50 pairs at 360, 900 and 1280: 0 differing pixels). The baseline carries the DS-077 values so the diff keeps meaning "nothing else moved"; `TH-I` reads each change against the ORIGINAL pre-sweep page. Stills are in `checks/shots/`.

| Change | Before to after (computed in the original page and the current one) | Rendered ratio | Stills |
|---|---|---|---|
| Switch off track (DS-077) | white at 18 % to 36 % (`--alpha-switch-off`) | 1.62:1 to 3.23 (1280), 3.31 (360), against the row | `th-fr-intended-switch-off-track-before.png`, `-after.png` |
| Field border (DS-077): text field, select, search, segmented control, composer | white at 16 % to 34 % (`--settings-field-border`) | 1.80:1 to 3.41 (1280), 3.47 (360) | `th-fr-intended-field-border-before.png`, `-after.png` |
| Placeholder (DS-077) | `#757575` to `#888aaa` (`--color-placeholder`) | 3.79:1 to 5.21 (1280, key field), 4.74 (360) | `th-fr-intended-placeholder-before.png`, `-after.png` |
| Focus ring of a full-bleed link row, segment, library row, model row (DS-078) | outline offset 2px outside to 2px inside; before it was cut by the frame (0 changed pixels when focused) | a ring is visible at every one of the 231 stops of the tour | `th-fr-intended-focus-ring-link-row-before.png`, `-after.png` |
| Reduced motion (R-14) | with reduced motion the toast does not slide, a pressed button does not shrink and the switch knob does not transition; short fades stay | no pixel change in normal mode | none |

Not visible in any look: the warning parts and critical marks, the selection bar's scroll padding, the safe-list changes.

### Proposed shared values for `theme/nexus-tokens.css` (the main session applies them; this round did not touch the file)

Measured on the real surfaces, 1280 / 360, in the Deep Nexus pages above:

| Shared name | Now | Proposed | Measured | Note |
|---|---|---|---|---|
| `--nexus-edge-strong` (or a new `--nexus-field-border`) | `rgb(255 255 255 / 0.16)` | `rgb(255 255 255 / 0.34)` | 3.41:1 / 3.47:1, a field border against its row | Raising `--nexus-edge-strong` also raises every bordered control that reads it (buttons, chips, dialog edges, in Settings and chat); a new `--nexus-field-border` limited to fields leaves the rest as it is. Settings reads `--settings-field-border`, which the main session can point at the shared name afterwards. |
| switch off track (candidate shared `--alpha-switch-off`) | 0.18 (Settings) | 0.36 on white | 3.23:1 / 3.31:1 against the row | Settings-owned today; listed because chat's switches would need the same. |
| placeholder (candidate shared `--color-placeholder`) | the browser grey `#757575` | `#888aaa` (`rgb(136 138 170)`) | 5.21:1 on the key field (1280), 4.74:1 (360); needs 4.5:1 | The shared `--nexus-text-muted` is `rgb(255 255 255 / .55)`; `#888aaa` is a flat equivalent with a blue cast. |

### Re-review findings, one by one

| # | Status | Where |
|---|---|---|
| R-01, R-02, R-10 | Fixed in `packlint-settings.mjs` (value bounds, safe tier list, named colours, backgrounds, parameters); every escape is a fixture. Chat's file not changed; proposal above. | `TH-L-value-*`, `TH-L-registry-param` |
| R-03 | Fixed (inset rings); the ring pixels are a check. | `TH-F-ring-pixels-*`, `TH-I-focus-ring-link-row` |
| R-04 | Fixed: both widths, the `ps-library-select` item, the sweep as a second gate; the Navy key warning in a selected row 3.83 to 4.52. | `TH-R-*`, `TH-S-sweep-*` |
| R-05 | Navy header and this audit reworded (DS-076). | `themes/origin-navy.css` |
| R-06 | Fixed (Q2). | `TH-P-critical-census` |
| R-07 | Fixed (Q5). | `TH-M-key-copy` |
| R-08 | `TH-P-safe-seen`: every safe part must be rendered in the tour; the tour includes slice 1 and slice 2 pages (the callout, list item and chat status row). | `parts.mjs` |
| R-09 | Fixed (DS-077). | above |
| R-11 | Not changed: defence in depth, as the review says (the install rule rejects those attacks; the code comment describes the guard accurately). | |
| R-12 | Fixed: the Undo toast loses `data-part-critical` once it is hidden (`slice2.js`). | `TH-C-delete-undo-toast-*` |
| R-13 | A pack note, not a defect: a pack that moves the index to the right changes the visual order of focus (DOM and Tab order stay the default's: search, index, page; the eye goes right to left). DS-074 chose this; a pack that does it should say so in its notes (WCAG 1.3.2, 2.4.3). | `TH-X-*` |
| R-14 | Fixed (`html.rm`: no slide, no press shrink, no knob transition). | `slice1.css` |
| R-15 | Not changed: the ring of an `aria-disabled` button is dimmed with the button (2.3 to 2.9:1). WCAG exempts inactive components from the 3:1 rule, and the alternative (a ring on a wrapper) changes the markup of every disabled button. Recorded for a decision. | |
| R-16 | Not changed, with a reason: the 고치기 link's shape is agreed in SLICE3_SPEC 6.1 and DS-055 (`fix=&conn=&reason=&back=chat&msg=[&chat=]`), and `F1-card-href` and `R-15-stub-link-shape` check it; adding `lang` is a cross-session contract change, proposed for the main session (the link back to chat already carries `lang` and `theme`). The link carries `theme` (T-16). | |
| T-01, T-03, T-12, T-16 | T-01 and T-03 closed (the gate and the warnings), T-12 closed (teeth in the lint, the rendered gate, the sweep and the ring check), T-16 closed for `theme` and open for `lang` (R-16). | |

### Open items after the round

1. **`--settings-field-border` and `--alpha-switch-off` are Settings-owned copies of values the shared file should own** (proposal above); `--color-placeholder`, the `--alpha-*` family and the breakpoints too.
2. **Chat's `packlint.mjs` still has the module constants and the bare-word colour hole** until the main session lifts the proposal; Settings is protected by its own wrapper meanwhile, chat's critical sheets are not.
3. **`.sw-warn`** (the failed-preset icon in a switcher option) and `.c3-mark` are not marked critical: they repeat a state that `settings-preset-warning` and `settings-fix-mark` carry. Say so if they should be.
4. **Forced-colours focus rings** keep the inset offset with a 3px ring (1px sits outside the clip); not run.
5. **Two Navy pack values are tuned to the AA gates** (`--nexus-surface` 8 %, `--alpha-accent-tint` 0.05); a Navy with upstream's exact glass fails the sweep by 0.003.

### What was not run (final round)

No device, WebView or Pi 3. Not run: forced colours, 200 % text, touch and drag (focus rings were photographed with the keyboard only), the slot-take, trash and purge dialogs under the re-skins, the clipping scan of the review's `ring.mjs` (the pixel check replaces it), contrast over gradients and images beyond the avatar exemption, English beyond the states of `ss3 koen`. No independent re-review (by instruction).

**R-16 closed (2026-10-28).** The main session confirmed DD-139 already has chat's 고치기 link carry `lang` (`chat/slice1.js` `settingsHref`). Settings' stand-in card (`slice3.js` `cardHTMLChat`) now adds `&lang=<lang>` after `msg` too. `renderReplies` rebuilds the card when the language changes, so the link follows the current language. `F1-card-href` and `R-15-stub-link-shape` expect the new shape, and SLICE3_SPEC 6.1 is updated. T-16 is now closed for `lang` as well.

**DD-160 shared names (2026-10-28).** Settings now uses the shared tokens from `theme/nexus-tokens.css`. `--settings-field-border` became `--nexus-field-border` in slice1/2 CSS, both packs, packlint-settings (and its `--lint-head` copy) and the attack fixture. The local `--color-placeholder` and `--alpha-switch-off` are dropped; packs still override them. The default-look values are unchanged: the th intended and rendered checks pass.
