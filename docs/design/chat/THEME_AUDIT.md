# Chat theme audit (theme-readiness pass)

Standing rule: [THEMING.md](../THEMING.md) and its "Contract refinements"; decisions [DD-142](../DECISIONS.md) (tokens, parts, the two acceptance re-skins), DD-143 (geometry is tokenised too), DD-144 and DD-153 (state as `data-*`, more parts and hooks), DD-145 (one meaning per shared name), DD-146 (colour channels), DD-147 (one layout and input attribute set), DD-148 (role tokens), DD-149 (protected surfaces enforced at pack install), DD-150 (Origin Navy follows upstream's default scheme), DD-151 (no size floor), DD-152 (own-message actions). Review: [2026-10-27-chat-theme-review.md](../reviews/2026-10-27-chat-theme-review.md). Deep Nexus is the baseline and must not change: the default look is pixel-identical before and after the sweeps (the `th` pixel diff, [builder-checks-theme.md](checks/builder-checks-theme.md)). Nothing here touches the app.

Files: `theme-tokens.css` (the one chat token block), `theme.js` (the `?theme=` loader and the root-state mirror), `themes/origin-navy.css`, `themes/banana-cocoa.css`, and in `../theme/nexus-tokens.css` (shared, additive only) the colour channels and the 8 names chat shares with Settings. Records: `checks/th/tokenize.mjs` (first sweep, frozen), `tokenize-geometry.mjs` (DD-143, run once), `tokenize-roles.mjs` (DD-148, run once), `patch-parts.mjs`, `patch-parts2.mjs` (parts, states, critical, kinds), `checks/th/before/` (the untouched pre-sweep copy, for the pixel diff and the counts).

## How literals are counted

`checks/th/csslit.mjs` walks each stylesheet declaration by declaration and judges **every property** (no property is exempt by name; review M1 found `outline-offset` hidden behind the outline rule, 16 values). The same scanner produces the numbers below and runs in the `th` suite (`TH-S-literals`), with self-tests on 76 planted cases of the first review and 83 of the re-review (`checks/th/plants.mjs`). Round 3 added keyword sizes (`font-size: larger`, `thin`, `medium`), percent opacity, every CSS unit in either case (`dvw`, `svh`, `lh`, `cqw`, `Q`, `12PX`), upper-case colour functions, system colours outside forced-colors, `url(data:...)` images, `env()` fallbacks, font shorthand weights, `calc()` weights and line heights, `font-variation-settings` numbers and gradient stop percentages.

| Kind | Judged | Counts as a literal |
|---|---|---|
| colour | every property, custom properties in component rules too | hex, `rgb()/rgba()/hsl()/hwb()/lab()/lch()/oklab()/oklch()/color-mix()/color()` in any case, any named colour, a system colour outside `@media (forced-colors)`, an embedded `url(data:...)` image |
| font | `font-family`, `font-size`, `font`, `font-weight`, `line-height`, `letter-spacing` | a family without `var()`, any digit or `bold` in a weight (also inside `calc()` and the `font` shorthand), unitless line height other than 1, any length, a keyword size (`larger`, `xx-large`, `small`, `thin`, `medium`) |
| radius | `border-radius` and corner longhands | any non-zero length or percentage |
| spacing | `padding*`, `margin*`, `gap*` | any length other than 0 and 1px |
| stroke | border and outline widths, `stroke-width` | any width other than 0 and 1px |
| shadow | `box-shadow`, `text-shadow` | any offset, blur or spread other than 0 and 1px |
| effect | `opacity` (also inside `calc()`), `filter` amounts, blur | any amount other than 0 and 1, `50%` included |
| motion | `transition*`, `animation*` | any non-zero duration or delay, `cubic-bezier()`, `linear`, `ease*` |
| geometry (DD-143) | every other property | any CSS length or angle unit in either case (`px`, `rem`, `em`, `ch`, `lh`, `vh`, `dvw`, `svh`, `cqw`, `vi`, `pt`, `Q`, `deg`, `turn`, ...) other than 0 and 1px; `scale()` other than 1; unitless dash values and `aspect-ratio`; gradient stop percentages other than 0 and 100; a px fallback inside `var(--x, 70px)` or `env(x, 12px)` |

Allowed literals, exactly: `0`, `0px`, `1px` hairlines, percentages used for layout math, unitless `1`, keywords (`transparent`, `currentColor`, `none`, `auto`, `inherit`), `steps()` timing, counts and stacking that are not measures (`z-index`, `order`, `flex: 1`, `-webkit-line-clamp`, grid `fr`), system colours inside forced-colors only, text inside strings, and token definitions (the token block and `:root` rules of a pack). Media-query breakpoints cannot use `var()` and stay literal. Not judged by the CSS scanner: synthetic fixture content in the scripts (SVG sample art, avatar thumbnails, sample folder colours, demo CSS shown inside sample messages).

Counts with the final scanner (it judges every property; the first round, with geometry exempt and the outline offsets hidden, reported 1225 before and 0 after; the pre-sweep copy `checks/th/before/` is rescanned each run, `TH-S-counts`):

| Kind | Before the sweeps | After |
|---|---:|---:|
| spacing | 638 | 0 |
| geometry | 438 | 0 |
| font | 247 | 0 |
| colour | 101 | 0 |
| radius | 96 | 0 |
| stroke | 49 | 0 |
| shadow | 36 | 0 |
| motion | 32 | 0 |
| effect (opacity, blur) | 23 | 0 |
| **Total** | **1660** | **0** |

(Round 2 added 16 `outline-offset` values and one mask colour; round 3 added the avatar mask image, three gradient stop percentages and the keyword and unit classes above, 5 more real findings (all now tokens: `--icon-mask-users`, `--stop-shimmer-*`), so the real CSS is at 0 under the stricter scanner.)
The script side is guarded by an **allowlist** (`checks/th/jsguard.mjs`): a script may assign only `transform`, `translate`, `opacity`, `height`, the width and height limits, `left`, `top`, `containIntrinsicSize`, `pointerEvents`, `flexWrap`, `overflowY`, `strokeDashoffset`, `animationDelay` and `transitionDuration`, never to a fixed value, a bare number (except 0 and 1) or an expression with a two-digit layout constant (`h + 12`, `${y + 24}px`, `17 + 'px'`); custom properties by `setProperty` only. Refused outright: `cssText`, `el.style = ...`, `Object.assign(el.style, ...)`, `setAttribute('style')`, `style="..."`, `style='...'` and unquoted `style=` strings (except `--n:${n}`), `animate()`, `insertRule`, `replaceSync`, a `<style>` element created from script, `setAttribute('fill'|'stroke'|...)` with a literal, an SVG colour attribute that is not `none`/`currentColor`, a CSS rule written as a string. One explicit waiver (`guard-ok`, the scoped reply CSS that is sample content, asserted to be exactly one). The six scripts are clean; all 17 + 36 planted lines behave as expected. Layout constants a script used (44 dp per pin, popup widths, drawer cap, keyboard height, composer minimum, swipe nudge, edge-zone extra, scrubber thumb, full turn) are read from tokens (`tokNum`). The loading probe is a class (`.probe`). The HTML pages may carry no `style` attribute of any quoting.

## Tokens

One chat block, `theme-tokens.css` (345 custom properties), plus the 39 in `../theme/nexus-tokens.css`. Existing names (`--nexus-*`, `--chat-dur-*`, `--chat-ease-*`, `--chat-speaker-*`, `--danger`) were kept because earlier check suites read them.

**The contract is the role layer (DD-148).** A pack sets named roles; the numbered ladder underneath is internal and may be renumbered without notice, so a pack must not set `--space-N`, `--size-N`, `--offset-N`, `--size-rel-N`, `--radius-N` or `--leading-N` (about 125 tokens, 37 percent). The ladder exists because the geometry sweep ranked every distinct value; role tokens default to the ladder step the rule used before, so the default look is unchanged.

| Group | Count | Names (contract unless marked internal) |
|---|---:|---|
| layout roles (DD-148) | 24 | `--control-gap`, `--control-padding-x`, `--header-height`, `--transcript-padding-top`, `--transcript-padding-top-strip`, `--transcript-padding-x`, `--transcript-padding-bottom`, `--message-gap`, `--message-meta-gap`, `--message-name-row-height`, `--message-inset-start`, `--composer-gap`, `--composer-padding-x`, `--composer-padding-y`, `--composer-field-padding-x`, `--composer-field-padding-y`, `--composer-field-height`, `--sheet-padding-x`, `--sheet-padding-bottom`, `--item-gap`, `--item-padding-x`, `--row-padding-start`, `--row-padding-end`, `--status-row-padding-start` |
| size roles | 27 | `--size-touch`, `--size-touch-lg`, `--size-touch-sm` (minimum hit areas, 44/48/36), `--size-avatar-sm\|avatar\|avatar-md\|avatar-lg\|avatar-xl`, `--size-kbd`, `--sidebar-width`, `--sidebar-width-phone`, `--sidebar-width-max`, `--sheet-width-popup\|tall\|panel\|wide\|dock`, `--angle-diagonal\|right\|sheen\|turn\|start`, `--scale-press\|swap\|ring-start\|pulse`, `--meter-circumference` |
| shape | 16 | `--radius-pill`, `--radius-circle`, `--radius-control`, `--radius-popup`, `--radius-bubble`, `--radius-bubble-tail` and the internal `--radius-N` ranks; `--radius-sheet` and `--radius-field` are shared (below) |
| colour | 49 | `--color-surface-bar\|kbd`, `--color-key`, `--color-scrim`, `--color-on-brand`, `--color-on-accent`, `--color-on-avatar`, `--color-knob`, `--color-code-bg\|code-bg-inline\|syntax-keyword`, tints (`--color-tint-faint\|strong\|tile`, `--color-field`, `--color-skeleton`, `--color-skeleton-line`, `--color-shimmer`, `--color-switch-off`), danger (`--color-danger-tint\|edge\|edge-soft\|edge-strong`, `--color-zone-edge`), `--color-accent-tint`, `--color-accent-soft`, `--color-hit`, `--color-hit-bg`, `--color-hit-rgb`, six avatar hues, scope tags (`--color-scope-character\|all-text\|edge\|bg\|rgb`), `--color-avatar-group-text`, `--color-scheme` |
| bubble hooks | 12 | `--color-bubble-char\|user`, `--color-bubble-char-text\|user-text`, `--radius-bubble`, `--radius-bubble-tail`, `--bubble-pad-y\|start\|end`, `--bubble-max-width`, `--thread-max-width`, `--cl-spacer-display` |
| type | 30 | `--font-size-2xs..2xl`, `--font-size-glyph-10..18`, `--font-weight-*`, `--mono`, internal `--leading-N` |
| stroke and focus | 9 | `--stroke-medium\|bold\|heavy\|xheavy`, `--focus-ring-w`, `--focus-ring-w-forced`, `--focus-ring-offset`, `--focus-ring-offset-inset`, `--focus-ring-offset-wide` (review M1: the offset is a token) |
| decoration hooks (DD-153) and round 3 | 22 | `--icon-stroke`, `--icon-scale`, `--icon-size-2xs\|xs\|sm\|md\|lg\|xl\|2xl`, `--selection-bg`, `--selection-text`, `--scrollbar-color`, `--scrollbar-width`, `--caret-color`, `--mask-opaque`, `--icon-mask-users`, `--stop-shimmer-start|mid|end`, `--swipe-nudge`, `--scrub-thumb-height`, `--edge-zone-extra` |
| shadow, opacity, motion | 38 | `--shadow-popup\|drag\|drag-sm\|float\|float-sm`, `--opacity-*`, `--chat-dur-*`, `--dur-*`, `--ease-linear`, `--risu-animation-speed` |
| internal ladder | about 125 | `--space-1..27`, `--size-1..40`, `--offset-N`, `--size-rel-1..21`, `--radius-1..13`, `--leading-110..155` |
| other | 10 | `--danger` (= `--nexus-danger`), `--chat-speaker-0..7`, `--s4-sk` |

**Colour channels (DD-146).** `../theme/nexus-tokens.css` gains `--nexus-accent-rgb`, `--nexus-danger` / `--nexus-danger-rgb`, `--nexus-overlay-rgb` (the colour glass tints are drawn in; a light pack sets `0 0 0`) and `--nexus-shade-rgb` (shadows and wells); chat adds `--color-hit-rgb`, `--color-scope-character-rgb`, `--color-scope-all-rgb`. All chat tints are `rgb(var(--...-rgb) / alpha)`. A pack states each colour once as a channel triplet (Origin Navy: accent and danger; Banana Cocoa: accent, danger, overlay) and may derive the solid with `--nexus-accent: rgb(var(--nexus-accent-rgb))`. The shared file keeps `--nexus-accent` as its original hex so nothing that compares its text breaks; a pack that changes the accent sets both, once, as above.

**Shared names (DD-145).** `--font`, `--color-surface-sheet`, `--color-surface-toast`, `--color-warning`, `--color-accent-tint-faint`, `--color-accent-tint-strong`, `--radius-field` and `--radius-sheet` now live only in `../theme/nexus-tokens.css`, with chat's values as the shared default (the accent tints derive from the accent channel). The nexus file was edited additively: every custom property it had at HEAD keeps its value (`TH-R-nexus-additive`). Other chat tokens that look app-wide and are candidates to move next (not moved): `--mono`, `--color-scheme`, `--color-surface-bar`, `--color-on-brand`, `--color-on-accent`, `--color-on-avatar`, `--color-scrim`, `--color-field`, `--color-tint-*`, `--color-danger-*`, `--color-accent-tint`, `--color-accent-soft`, `--radius-control`, `--radius-popup`, `--radius-pill`, `--radius-circle`, `--stroke-*`, `--focus-ring-*`, `--shadow-*`, `--opacity-*`, `--chat-dur-*` and `--chat-ease-*` (motion), `--size-touch*`, `--font-size-*`, `--font-weight-*`.

**No size floor (DD-151).** The touch-target and text-size tokens are fully pack-settable; Deep Nexus and the acceptance packs keep 44/48 dp. The checks assert no floor.

Loading order, in every page: `nexus-tokens.css`, `theme-tokens.css`, the slice stylesheets, then `theme.js`, which writes the pack stylesheet into the head while the page is parsed, so it blocks the first paint (review n2: no flash of Deep Nexus). Pack motion must use the duration tokens: `html.rm` and `html.nexus-low-power` cap the tokens, not a pack's own `transition` (review n4). The tokens are grouped by owner above: pack hooks (bubble, decoration, roles) first, chat-internal ladder last (review n5).

## Parts

`data-part="chat-<name>"` on 59 part names. `data-part-critical` marks the surfaces a pack may only give tokens to. No DOM order, role or label changed; every part is an added attribute. `chat-message` also carries `data-role=user|char|system` (the system role is the thread's banner note). One element has one part, so the generic role of a control is the separate `data-kind` attribute (below).

| Part | Where | Notes |
|---|---|---|
| `chat-shell` | `.app` | the whole screen |
| `chat-sidebar`, `chat-sidebar-header`, `chat-sidebar-toggle` | `aside#sidebar`, its head, the button that opens it | phone drawer or desktop column |
| `chat-sidebar-search`, `chat-sidebar-strip`, `chat-sidebar-footer` | slice 2 and later | the search field, the character strip, the footer buttons |
| `chat-list` | `#s2List` | the scrolling list |
| `chat-list-row` | `.chat-item` (slice 1), `.s2-row.chat` | one chat; states `data-current`, `data-unread`, `data-status` |
| `chat-list-row-main`, `chat-list-row-name`, `chat-list-row-time`, `chat-list-row-last`, `chat-list-row-count`, `chat-list-row-mark`, `chat-list-row-menu` | inside a chat row | the row's button, name, time, last-message line, message count, status mark, menu button |
| `chat-list-folder`, `chat-list-character` | folder and character rows | `data-open` on folders, `data-current` on characters |
| `chat-header`, `chat-header-avatar`, `chat-header-title`, `chat-header-menu` | `header#hdr` and its inner parts | |
| `chat-preset-chip` | `#hkChip` (hooks 1) | the preset chip |
| `chat-gen-strip` | `#genStrip` | the pinned generation strip |
| `chat-transcript` | `#scroller` (`role=log`) | |
| `chat-message` | `.msg`, and the banner note | `data-role=user`, `char` or `system`; the state attributes below |
| `chat-message-name-row` | `.meta` | avatar, name, badges and actions of a turn; has no role or label, so `display: contents` on it is the supported technique (DD-152) |
| `chat-message-avatar`, `chat-message-name`, `chat-message-badges` | inside the name row | the name is the message's accessible name |
| `chat-message-actions`, `chat-message-actions-hover`, `chat-message-actions-float` | pinned buttons, the wide-layout hover row, the floating cluster of a turn without a name row | |
| `chat-message-spacer` | `.cl-spacer` | reserves room for the floating cluster inside the body; display is the token `--cl-spacer-display` |
| `chat-message-stage` | `.stage` | the swipe stage around the body |
| `chat-message-body`, `chat-message-text` | `.card`, `.reply-body` | the bubble and its rendered text |
| `chat-message-alts` | `.altrow` | reply pager and New reply |
| `chat-composer`, `chat-composer-input`, `chat-composer-plus`, `chat-composer-persona`, `chat-send` | the form and its controls | |
| `chat-status-row` | `.undo-row`, `.fc-return`, `#atoast`, `.s3-notice` | the inline status line in the flow (`role=status`) |
| `chat-sheet`, `chat-sheet-scrim`, `chat-sheet-header`, `chat-sheet-handle`, `chat-sheet-title`, `chat-sheet-body`, `chat-sheet-item` | the sheet, popup or panel and its inner parts | |
| `chat-toast` | `#toast` | |
| `chat-failed-card` | `.failcard` | **critical** (`role=alert`) |
| `chat-save-guard` | `.hk-guard` | **critical**: the failed-save guard's choices |
| `chat-critical-body`, `chat-critical-action` | text and buttons inside a critical surface | **critical children** (DD-149): the failed card's lines and buttons, and every explanation and choice of a critical sheet |
| `chat-critical-header`, `chat-critical-handle`, `chat-critical-title` | the sheet's own header, grab handle and title **while the sheet is critical** | **protected** (DD-155 stopgap): `markCritical` renames `chat-sheet-header|handle|title` to these and `openSheet` / `swapSheet` give the ordinary names back |

### Generic kind (DD-153): `data-kind`

Every `button.btn`, `a.btn`, `button.chip` and every `input`, `textarea` and `select` gets `data-kind` when it is inserted (`slice1.js` `stampKinds`, one observer): `button` (has text), `icon-button` (no text), `chip`, `field` (text field, textarea, select), `switch` (checkbox, radio), `range`. A pack styles all buttons or all fields with `[data-kind="button"]` or `[data-kind="field"]` without a part name. It is set once, at insertion; a control that later changes between text and icon keeps its kind. A subject made only of `data-kind` can match inside a critical surface, so `packlint` limits what it may do.

### State attributes (DD-144, DD-153)

State a pack may style is mirrored as `data-*`. The classes stay for existing code and checks; the attributes are derived from the same data and kept in sync by one coalesced pass after every refill, every child change of `#thread`, every streaming start or end, and every class change on a message.

| Attribute | On | Values | Mirrors |
|---|---|---|---|
| `data-run` | `chat-message` | `first`, `middle`, `last`, `single` | speaker sequence: same role and group member as the neighbour before and after |
| `data-meta` | `chat-message` | `shown`, `none` | `.metaless` (no name row) |
| `data-fail` | `chat-message` | present | the reply failed (the failed card is in its body) |
| `data-streaming` | `chat-message` | present | the reply is being written |
| `data-hidden` | `chat-message` | present | hidden from the AI (`.hidden-ai`) |
| `data-bookmarked` | `chat-message` | present | the message is bookmarked |
| `data-selected` | `chat-message` | present | text-select mode (`.selectable`) |
| `data-current` | `chat-list-row`, `chat-list-character` | present | the open chat or character (`.cur`) |
| `data-unread` | `chat-list-row` | present | the chat has a new reply |
| `data-status` | `chat-list-row` | `none`, `new`, `gen`, `fail`, `draft` | the row's status mark (`draft` is a chat with an unsent draft) |
| `data-open` | `chat-list-folder` | present | the folder is expanded |
| `data-kind` | controls | see above | the control's generic role |
| `data-icon-size` | every icon `svg.ic` | the call-site size in px (`11`, `12`, `14`, `16`, `18`, `20`, `22`) | the size the script asked for; CSS reads `--icon-size-*` and `--icon-scale` through it, so a pack resizes all icons of one size with one token |
| `data-names` | `<html>` | `shown`, `hidden` | `html.hide-names` |
| `data-input` | `<html>` | `touch`, `hover` | the one input rule: `html.touch-ui` means touch, `html.hover-ui` means hover (slice1.js sets them from the platform preset or from `(hover: hover) and (pointer: fine)`); until the page has decided, that media query answers, so the attribute is never absent (review n3) |
| `data-layout` | `<html>` | `wide`, `mid`, `phone` | `html.is-desktop` is wide (900 px and up); otherwise mid from 600 px, phone below. Same names as Settings (DD-147) |
| `data-motion` | `<html>` | `reduced`, `full` | `html.rm` |
| `data-power` | `<html>` | `low`, `normal` | `html.nexus-low-power` |

`data-theme` (on `<html>`, set by the loader) names the active pack. A pack selects state like parts: `[data-role="char"][data-run="first"] [data-part="chat-message-body"]`, `[data-input="hover"] [data-meta="none"] ...`.

### Critical surfaces (DD-149)

- **Marked by default by the component, not by the loader (review m5).** `slice1.js` `markCritical` marks a sheet critical when it contains a danger button (`.dangerous`) or a choice that drops data (`data-drops-data`), and gives its explanation `chat-critical-body` and every choice `chat-critical-action`. Marked flows: delete messages, delete a chat, stop a running reply and switch, redo a round, discard a half-built group, **regenerate an earlier reply** (it drops the later replies), **remove a missing member**, **discard an edit draft (slice 4)** and the failed-save guard; the failed-reply card is critical with `chat-critical-body` lines and `chat-critical-action` buttons. The message-actions sheet is not critical.
- **Enforced at install, by reach (DD-155, DD-159).** `checks/th/packlint.mjs` is a stand-in for the pack-install rule. The pack text is normalised first (comments removed, CSS escapes decoded so `\64isplay` is `display`, case folded), then:
  1. Selectors: only `:root` / `html` and `[data-*="value"]` with `:hover`, `:focus-within`, `:focus-visible`; no tag, class, id, `*`, `:not`, `:is`, `:has`, pseudo-element, nesting or attribute operator other than equals. At-rules: `@media` only (no `@keyframes`, `@import`, `@font-face`, `@property`, `@supports`, `@layer`, `@container`).
  2. A selector may not name a protected surface: `data-part-critical`, `chat-failed-card`, `chat-save-guard`, `chat-critical-body|action|header|handle|title`.
  3. Tokens (custom properties and `color-scheme`) may be set on `:root`, on `html[data-input=...]`, on `html[data-layout=...]` and on their combinations (DD-159); those selectors cannot reach a part. The resulting tokens are checked: critical text keeps 4.5:1 on the sheet and on the bubble, choices stay at least 32 px, text at least 11 px, sheet padding at most 48 px, a focus ring stays (N8; stand-in thresholds, DD-151 keeps the app floor off).
  4. Every other rule is judged by **what its subject can reach**. A subject is a safe leaf only if the app guarantees it never contains, is, or sits inside a protected element: the leaf parts (message avatar, name, badges, actions, alts, name row, header, sidebar, list, composer, send, toast, status row, sheet scrim) and anything inside a user or system message (a protected element is only ever in a character message or a sheet; `census-g` asserts the guarantee in six critical states). Every other subject (an ancestor such as `chat-message-body`, a sheet part, any subject naming no part such as `[data-fail]` or `[data-kind]`) may be, hold or sit inside a protected element, so its declarations must be on an **allowlist**: colours (never translucent, never within 3:1 of the surface), borders up to 16 px, radii, shadows, font family, style and weight, font size 11 to 40 px, line height 1 to 3, letter spacing up to 2 px, widths `auto|none|fit-content|100%` or at least 50%, padding, margin and gap up to 64 px (token values are resolved) and never negative. Anything else (display, visibility, opacity, overflow, heights, flex and grid layout, order, float, `-webkit-text-fill-color`, ...) is rejected.
  5. For every subject: `position: fixed|sticky`, `z-index`, `animation`, `transition`, `filter`, `backdrop-filter`, `mix-blend-mode`, `transform`, `content`, `contain`, `direction`, `all`, masks and clips, and shadows, outlines and borders over 64 px are rejected, because they can cover a protected surface from anywhere.
  Both packs pass; the first review's 6 hostile rules, 17 more, the re-review's 75 (4 borderline controls allowed) and 6 abuses of the root-attribute rule are rejected. `lintlive` injects every rule marked as damaging into the real delete-confirmation sheet at 360 and 1280 and shows it breaks the sheet, so the list stays honest; the benign rules and both packs leave it intact.

## Pack techniques

- Own-message actions beside the bubble on mouse input (DD-152): `display: contents` on `chat-message-name-row` lets the actions join the message's flex row; DOM order is unchanged; on touch they stay on the line above.
- A tail corner on the first bubble of a run only: `[data-run="first"]` and `[data-run="single"]`.
- A turn without a name row on touch: `[data-input="touch"] [data-meta="none"] [data-part="chat-message-actions-float"] { position: relative }`.
- A light pack must restate the eight group-chat speaker colours (`--chat-speaker-0..7`) and the six `--color-scope-*` tokens, which are pastels for a dark canvas, and the text and disabled-state tokens must clear 4.5:1 (checked per page state by `TH-K-*`).

## Findings status

- DD-143 (geometry) and DD-144 / DD-153 (state, parts, hooks), DD-145 to DD-149, DD-152: done; checked by `th`.
- DD-156: Deep Nexus keeps the accent-tint text selection (`--selection-bg`, `--selection-text`); it is the one deliberate change to the default look and the pixel diff does not cover states with selected text.
- DD-158 (derive `--nexus-accent` and `--nexus-danger` from their channels) is not done here: Settings adopts the shared values first. Until then the shared file keeps the original hex and a pack that changes the accent sets `--nexus-accent-rgb` and `--nexus-accent`.
- DD-150: Origin Navy keeps upstream's default scheme (a charcoal-slate with a blue cast, `#21222c` / `#282a36`), not the "galaxy" navy; its file header says so and nothing else claims it is navy.
- DD-151: no size floor; recorded above.
- Still open, outside the chat folder: the shared canvas gradient shape in `../theme/nexus-tokens.css` (a pack can recolour it, not reshape it); and moving the candidate names above to the shared file once Settings has adopted the first eight.

## Focus rings and loader (2026-10-27)

A pack may recolour the ring (`--nexus-ring`, `--focus-ring-w`, offsets) but the checks require it to stay visible: `th` section `TH-F-ring-*` focuses every control and fails a ring that is clipped or under 3:1. Rows, strips and header buttons draw their ring inside through `--focus-ring-offset-inset`. `?theme=` accepts only the own keys of the pack map in `theme.js`.

## Shared contrast values (DD-160 / DS-077, 2026-10-27)

A deliberate change of the default look: `theme/nexus-tokens.css` adds `--nexus-field-border` (the overlay colour at 34%, text-field borders), `--alpha-switch-off` 0.36 (switch off track) and `--color-placeholder` #888aaa; `--nexus-edge-strong` stays at 16%. Chat's text fields, switches and placeholders read them; both packs keep their own field border and placeholder colour. Parts that move: the border of the composer field and of the search, note, select, input and editor fields, the off track of every switch, and placeholder text. The pixel-diff baseline carries the same values for those parts only. Pack-install rule: `packlint.mjs` now includes the Settings value-space rules (DS-075) and takes the part registry, the contrast surfaces and the safe-tier strictness as parameters.

### Positionable safe leaves (DD-161)

In the pack-install rule only these chat parts may be positioned (`position: absolute|relative`, offsets and negative margins within 64 px): `chat-message-avatar`, `chat-message-actions`, `chat-message-actions-hover`, `chat-message-actions-float`, `chat-message-alts`. Every other safe part is under the strict ban. Banana Cocoa positions the avatar and shifts the actions and the alternatives only.

Registry shape (final): `lintPack(css, name = '', registry?)` with `registry = { critical?: string[], safe?: string[], surfaces?: [token, surface, label, ratio][], strictSafe?: boolean, positionable?: string[], tokens?: Map }`. `tokens` is the screen's own token defaults, merged over chat's (`app = new Map([...chat, ...tokens])`), used to resolve `var()` in a pack and to judge "unchanged default".

Registry shape (with DD-182): `{ critical?, safe?, surfaces?, strictSafe?, positionable?, tokens?: Map, minimums?: { token: floor } }`. `minimums` floors critical tokens (a string with a unit such as "2px", or a number); a pack that sets one below its floor, anywhere, is rejected with "below the critical minimum"; var() chains resolve through the app defaults and the pack :root, and an unresolvable value fails closed. Chat default: empty.

Registry shape (with DD-195): `{ critical?, safe?, surfaces?, strictSafe?, positionable?, tokens?: Map, minimums?: { token: floor }, maximums?: { token: ceiling } }`. Limits are judged over the worst case: every declaration of the token and of every token in its var() chain, in :root, root attributes, @media blocks and any selector. Only px, rem (16 px), ms, s and plain numbers are accepted on limited tokens; vw, vh, %, em, ch and the rest, and anything unresolvable, fail closed. Reasons: "below the critical minimum" / "above the critical maximum". Chat default: empty maps.

Structure (R-1): `lintPack` rejects a stylesheet with unbalanced braces or parentheses, an unterminated string or an unterminated comment, reason "unbalanced or unterminated", before anything else is judged (a browser still applies an unclosed block). `structureErrors(css)` is exported.
