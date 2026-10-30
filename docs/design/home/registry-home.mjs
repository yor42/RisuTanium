// Home's registry for chat's pack-install validator (DD-149, DD-155, DD-159; chat/checks/th/packlint.mjs is imported UNCHANGED, the way Settings and Studio do it).
// A registry is { critical, safe, surfaces, tokens, minimums, maximums, strictSafe, positionable } (DS-075, DD-161, DD-182, DD-195). Everything below comes from the page as it stands
// (home/render.js, app.js, lib.js, home.css, home-tokens.css) and from home/checks/_census.out.txt (114 parts over 20 page states); lint-home.mjs re-verifies the part tiers in a real browser.
//   node registry-home.mjs themes/origin-navy.css      -> OK / REJECTED, exit 1 on a rejection (the file path is relative to the cwd)
// Imported as:  import { lintHome, HOME_REGISTRY } from './registry-home.mjs'
// lintHome(css, name) = chat.lintPack(css, name, HOME_REGISTRY) plus homeSupplement(css): three gaps of the shared validator (resources, alias tokens, the primary button pair) that lint-home.mjs found; section 7 below.
// Nothing in chat/, settings/ or studio/ is edited; the main session can lift the registry and the supplement into packlint.mjs when it integrates Home.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chat from '../chat/checks/th/packlint.mjs';
import { decls } from '../chat/checks/th/csslit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));

// ---- token defaults: the first :root block of home-tokens.css (the ladder and the role tokens). The later blocks (html[data-input], html[data-layout], body[data-mode]) are the same names or Home-only
// aliases under a root attribute, which a pack may also set (DD-159); a pack's own declarations of them are judged wherever they appear.
const rd = (f) => { try { return fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
const readTokens = (css, into) => { for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) into.set(m[1], m[2].trim()); return into; };
const rootOf = (f) => { const m = /:root\s*\{([^}]*)\}/.exec(rd(f)); return m ? m[1] : ''; };
export const HOME_TOKENS = readTokens(rootOf('home-tokens.css'), new Map());

// ---- 1. CRITICAL parts: a pack selector may not name them (and may not name [data-part-critical]); they take tokens only.
// The proposal's 23 names stand. What each one is, and where the page marks it:
//   dialogs       home-leave-dialog (#leave), home-agree-dialog (#agree, the RisuRealm agreement), home-confirm (+ -title -body -actions -action: the #sim dialog while lib.js H.simDialog gets critical:true, e.g. move to
//                 Recently deleted / empty it; the same element is home-dialog while the sim is not critical, so a part name is never both), home-agree-links / home-agree-link (the Terms and Privacy links)
//   consent       home-realm-gate (the consent text that replaces the RisuRealm entry before the agreement), home-realm-consent-action, home-realm-status (critical only in the consent state, the name is protected always)
//   data loss     home-trash-empty ("Delete all"), home-trash-scope (what the delete will touch), home-bulk-result (a failed bulk action), home-restore-error (a failed restore)
//   not silent    home-setup-note / home-setup-action (no provider, no key, repair), home-composer-note (draft and validation feedback), home-draft-choice / home-draft-action (append, replace, cancel: replace drops the draft),
//                 home-run-error / home-run-retry (a failed run and its retry)
// Added to nothing: the page marks exactly these elements data-part-critical (checked per state in lint-home.mjs, section "critical").
export const HOME_CRITICAL = ['home-leave-dialog', 'home-agree-dialog', 'home-agree-links', 'home-agree-link', 'home-confirm', 'home-confirm-title', 'home-confirm-body', 'home-confirm-actions', 'home-confirm-action',
  'home-realm-gate', 'home-realm-consent-action', 'home-realm-status', 'home-trash-empty', 'home-trash-scope', 'home-bulk-result', 'home-restore-error', 'home-setup-note', 'home-setup-action',
  'home-composer-note', 'home-draft-choice', 'home-draft-action', 'home-run-retry', 'home-run-error'];

// ---- 2. REACH tier: parts that are neither critical nor safe, because they hold a critical element (or, for the dialog trio, strand a modal). A pack may recolour, reborder and respace them; it may not hide,
// reposition or re-lay-out them (the allowlist of DD-155).
//   home-shell, home-main                  ancestors of everything
//   home-library                           holds the bulk-result message and the trash list's "Delete all"
//   home-library-tools   (NEW vs proposal) the toolbar of the trash view: it holds home-trash-empty (render.js trashHtml). In the library view it holds search, sort, New, Manage
//   home-empty-hero      (NEW vs proposal) holds R.realmEntry(), which is the consent gate (home-realm-gate) until the agreement is accepted
//   home-realm                             holds home-realm-status and the consent action
//   home-trash-row                         holds home-restore-error
//   home-tasks-panel, home-run-card, home-run-actions   hold home-run-error / home-run-retry
//   home-dialog, home-dialog-actions, home-dialog-action  (NEW vs proposal) the non-critical modal (companion picker, Tasks, a non-critical sim). Hiding its container or its only buttons leaves a modal that is
//                 inert-to-everything-else with no visible way out except Esc, which a touch user does not have. The title, body, list and tag parts of the same dialogs stay safe.
// DD-243 / DD-241 (theme lint round, 2026-10-28): navigation, Tasks, Stop, the composer with Send and the containers that hold them move from the safe tier to the reach tier (restyle, never hide, move or re-lay out;
// no outline may be changed on any part). Source: reviews/2026-10-28-home-rereview.md R4. The containers (topbar, modes wrap, rail top and bottom, composer bar) hold a reach part, so they cannot be safe either.
//   navigation   home-menu-button, home-rail (+ -item, -top, -bottom, -new, -collapse), home-topbar (+ -left, -right), home-modes-wrap, home-mode-switch, home-mode-option, home-skip-link,
//                home-pill (the persona chip and the model pill are links to Settings, or open the setup note: the review's R4 list names it)
//   Tasks, Stop  home-tasks-button, home-run-stop, home-task-actions, home-task-open
//   composer     home-composer, home-composer-field, home-composer-bar, home-composer-button, home-send
export const HOME_REACH_DD243 = ['home-menu-button', 'home-rail', 'home-rail-item', 'home-rail-top', 'home-rail-bottom', 'home-rail-new', 'home-rail-collapse', 'home-topbar', 'home-topbar-left', 'home-topbar-right', 'home-modes-wrap', 'home-mode-switch', 'home-mode-option',
  'home-pill', 'home-skip-link', 'home-tasks-button', 'home-run-stop', 'home-task-actions', 'home-task-open', 'home-composer', 'home-composer-field', 'home-composer-bar', 'home-composer-button', 'home-send',
  // DD-240 (Home fix round): the text of these two is the accessible name of a nav item and of Send, so they cannot be hidden
  'home-rail-label', 'home-send-label',
  // DD-262: the only on-screen signal that a reply or a run is going (the reply badge, the run state line) and the Tasks count: restyle, never hide
  'home-bg-badge', 'home-run-status', 'home-badge'];
export const HOME_REACH = ['home-shell', 'home-main', 'home-library', 'home-library-tools', 'home-empty-hero', 'home-realm', 'home-trash-row', 'home-tasks-panel', 'home-run-card', 'home-run-actions',
  'home-dialog', 'home-dialog-actions', 'home-dialog-action', ...HOME_REACH_DD243];

// ---- 3. SAFE leaves: never critical, never hold a critical element, never sit inside one (asserted in a browser over 14+ states by lint-home.mjs). A pack may hide, lay out and (for the named few) position them.
// The proposal's list minus the five moved to REACH above, plus the two parts the census did not see (home-lib-msg: a non-error library message; home-dialog-body: the text of a non-critical sim dialog).
// Judgement calls kept as proposed: home-run-stop (a pack may hide it on a card; the Tasks dialog and the card's state text are the other ways to see and stop a task), home-selection-bar (its Move to trash
// entry only opens a critical confirm), home-composer / -field / -bar / -send (the composer note is a SIBLING after the form, not inside it), home-picker (inside #picker, which holds nothing critical).
export const HOME_SAFE = [...[ 'home-network', 'home-skip-link', 'home-drawer-scrim', 'home-brand', 'home-brand-mark', 'home-rail', 'home-rail-item', 'home-rail-avatar', 'home-rail-bottom', 'home-rail-top', 'home-rail-new',
  'home-rail-collapse', 'home-rail-section-title', 'home-rail-sep', 'home-rail-tooltip', 'home-topbar', 'home-topbar-left', 'home-topbar-right', 'home-modes-wrap', 'home-mode-switch', 'home-mode-option', 'home-mode-thumb',
  'home-menu-button', 'home-tasks-button', 'home-pill', 'home-badge', 'home-greeting', 'home-eyebrow', 'home-shelf-section', 'home-shelf', 'home-story', 'home-story-portrait', 'home-story-body', 'home-story-meta',
  'home-memory-tag', 'home-tag', 'home-bg-badge', 'home-char-grid', 'home-char-card', 'home-char-row', 'home-avatar', 'home-folder-chip', 'home-lib-tab', 'home-search', 'home-sort', 'home-count', 'home-selection-bar',
  'home-lib-msg', 'home-realm-list', 'home-realm-item', 'home-realm-more', 'home-realm-link', 'home-realm-announce', 'home-community', 'home-community-link', 'home-framing', 'home-framing-option',
  'home-companion-portrait', 'home-presence', 'home-quick-list', 'home-quick-start', 'home-chip-list', 'home-chip', 'home-composer', 'home-composer-button', 'home-composer-field', 'home-composer-bar', 'home-send',
  'home-run-count', 'home-run-mark', 'home-run-progress', 'home-run-status', 'home-run-stop', 'home-thread-row', 'home-task-row', 'home-task-actions', 'home-task-open', 'home-task-group', 'home-task-list',
  'home-picker', 'home-picker-item', 'home-dialog-title', 'home-dialog-body', 'home-toast', 'home-hub',
  // DD-240 (Home fix round): the new named leaves
  'home-story-name', 'home-story-branch', 'home-story-snippet', 'home-story-time', 'home-char-text', 'home-char-name', 'home-char-chats', 'home-thread-title', 'home-thread-time', 'home-run-title', 'home-run-meta', 'home-hero-mark'].filter((p) => !HOME_REACH_DD243.includes(p))];

// ---- 4. POSITIONABLE (DD-161: named leaves only; position absolute|relative|static and offsets within 64 px; negative margins within -64 px): the avatar, the portraits, the run mark and the background-reply badge.
export const HOME_POSITIONABLE = ['home-avatar', 'home-rail-avatar', 'home-story-portrait', 'home-run-mark', 'home-companion-portrait',
  'home-story-time', 'home-thread-time', 'home-char-chats', 'home-run-meta', 'home-hero-mark'];

// ---- 5. SURFACES [token, surface, label, ratio]. What each critical text sits on, and where it comes from in home.css:
//   canvas  the page (text, secondary and muted text of the trash scope, the composer note, the realm gate over a glass card, the setup note's hint)
//   sheet   --home-dialog-bg = --color-surface-sheet: the leave, agree and confirm dialogs (title, body in .muted, buttons, danger button text, the focus ring of every button)
//   glass   --nexus-surface (cards: library, realm, presence, panels, the composer) over the canvas
//   raised  --nexus-surface-raised (the setup note, the draft choice, library messages, run cards, trash rows, char cards, secondary buttons)
//   toast   --color-surface-toast (the toast and the background badge)
// STACKING ALLOWANCE: the surface list judges a token against ONE layer over the canvas, but a raised card sits on a glass card (.card-raised in .glass, the trash row, the char card). In Origin Navy the real stack is 0.44 below
// the single layer (danger #ff5555 would be 4.87:1 on raised-over-canvas and 3.9:1 on raised-over-glass-over-canvas), so the three tokens that carry small critical text on raised cards ask 5:1 there; lint-home.mjs measures the real stack in a browser.
// text 4.5 everywhere it sits; secondary and muted 4.5 (muted is used by .count, small stacks, trash-scope, the trash row's small line); ring 3 (WCAG 2.4.11 style, focus ring on sheet, canvas, raised);
// danger 4.5 (--home-danger-text IS --nexus-danger: the restore error, the composer error note, the Delete all button, the danger confirm action); warm 4.5 (the greeting name and the upstream tag);
// field border 3 on the canvas and the glass cards (DD-160: the library search and the sort select).
export const HOME_SURFACES = [
  ['--nexus-text', 'canvas', 'the canvas', 4.5], ['--nexus-text', 'sheet', 'a dialog sheet', 4.5], ['--nexus-text', 'glass', 'a glass card', 4.5], ['--nexus-text', 'raised', 'a raised card', 4.5], ['--nexus-text', 'toast', 'the toast', 4.5],
  ['--nexus-text-secondary', 'canvas', 'the canvas', 4.5], ['--nexus-text-secondary', 'sheet', 'a dialog sheet', 4.5], ['--nexus-text-secondary', 'glass', 'a glass card', 4.5], ['--nexus-text-secondary', 'raised', 'a raised card', 5],
  ['--nexus-text-muted', 'canvas', 'the canvas', 4.5], ['--nexus-text-muted', 'glass', 'a glass card', 4.5], ['--nexus-text-muted', 'raised', 'a raised card', 5],
  ['--nexus-ring', 'canvas', 'the canvas', 3], ['--nexus-ring', 'sheet', 'a dialog sheet', 3], ['--nexus-ring', 'raised', 'a raised card', 3],
  ['--nexus-danger', 'canvas', 'the canvas', 4.5], ['--nexus-danger', 'sheet', 'a dialog sheet', 4.5], ['--nexus-danger', 'glass', 'a glass card', 4.5], ['--nexus-danger', 'raised', 'a raised card', 5],
  ['--nexus-warm', 'canvas', 'the canvas', 4.5],
  ['--nexus-field-border', 'canvas', 'the canvas', 3], ['--nexus-field-border', 'glass', 'a glass card', 3],
];

// ---- 6. MINIMUMS and MAXIMUMS (DD-182, DD-192, DD-195, DD-197): the worst case over every declaration of the token (and of every token in its var() chain) anywhere in the pack, plus the page's default.
// Units: px, ms or plain numbers only (a relative unit, vw, %, em, ch, fails closed), so no token with such a default is listed (the % and vh ones are left out on purpose: --home-shelf-card-share, --home-picker-max-height,
// --home-measure*, --home-tracking-*, --home-mock-panel-max). The table says which part reads the token, because that is the reason for the bound.
const MIN = {}; const MAX = {};
const bound = (names, lo, hi) => { for (const n of names.split(/\s+/).filter(Boolean)) { if (lo !== null) MIN['--home-' + n] = lo; if (hi !== null) MAX['--home-' + n] = hi; } };
// text: .btn (md), dialog body and h2 (base, lg), notes and hints (sm), the trash row's small line and counts (xs). Defaults 12..16.
bound('text-xs text-sm text-md text-base text-lg', '11px', '24px');
bound('text-xl', '11px', '40px'); bound('text-2xl', '11px', '48px'); bound('text-hero', '11px', '64px');          // greeting and hub headings: not critical, but a 300 px heading pushes the critical blocks off the screen
bound('weight-strong', 500, 900); bound('weight-regular', 400, 600);                                                // the confirm title and the buttons' weight: a 100 weight thins the warning
bound('leading-body leading-tight leading-field', 1.2, 2.2);                                                        // .btn (tight), dialog body (body), the composer field
// controls: .btn in every critical dialog and note, .link-row (agree links), the trash row. DD-151 lets a pack go below 44 dp; DD-182/192 keep 32 px for the critical choices.
bound('touch hover-control control-height pill-height sel-size', '32px', '72px');
bound('row-height', '32px', '96px');
bound('control-pad-x', '4px', '32px'); bound('control-gap', '4px', '24px');
// spacing ladder: floors 4 px for the steps the critical parts read as padding and gaps (space-3..9: dialog pad, realm gate, setup note, draft choice, library message, button rows); space-1 and space-2 are the
// 2 and 4 px hairline gaps of small text stacks (the page's own defaults), so their floor is the default and a pack cannot make them 0. Ceilings 24 / 32 / 40 / 48 / 64 keep a choice on a 360 px screen.
bound('space-1 space-2', '2px', '24px'); bound('space-3 space-4', '4px', '24px'); bound('space-5 space-6 space-7 space-8', '4px', '32px'); bound('space-9 space-10 space-11', '4px', '40px');
bound('space-12 space-13 space-14', null, '48px'); bound('space-15', null, '64px');
// role tokens of the critical surfaces
bound('dialog-pad', '8px', '32px'); bound('dialog-width', '280px', '640px'); bound('dialog-width-wide', '280px', '720px'); bound('dialog-margin', null, '48px');   // a 300 px margin leaves the dialog 60 px on a phone
bound('card-pad card-pad-lg', '4px', '40px'); bound('hero-pad-y', null, '64px');
bound('realm-status-min', null, '240px'); bound('realm-min-height', null, '560px'); bound('realm-list-max', null, '320px');
bound('search-basis note-basis count-basis quick-min shelf-card-min', null, '480px');                               // the flex-basis of the text beside a critical note's buttons: wider than the card means the buttons wrap under it
bound('char-card-min', '80px', '240px');
bound('radius-1 radius-2 radius-3 radius-4 radius-5 radius-6 radius-7 control-radius card-radius dialog-radius field-radius rail-radius mode-radius mode-option-radius presence-radius', null, '32px');
// focus, borders, selection and disabled: the cues a critical surface relies on
bound('focus-w', '1px', '8px'); bound('focus-offset', '-4px', '8px'); bound('hairline', '1px', '4px'); bound('bar-w', '2px', '8px'); bound('bar-height', '2px', '12px'); bound('disabled-opacity', 0.4, 0.85);
bound('icon-size icon-size-sm', '10px', '48px'); bound('icon-stroke', 1, 3);
// page geometry that a token can reach although no pack rule may set it (a token is not a declaration, DD-143: the lint has to bound it): the main and top bar padding, the rail and the columns. Without these a pack
// could make the main column 0 px wide (rail width 2000 px), or squeeze every critical block into a 100 px centre column.
bound('main-pad-x topbar-pad-x', null, '48px'); bound('main-pad-top topbar-pad-top topbar-pad-bottom', null, '64px'); bound('main-pad-bottom', null, '128px'); bound('topbar-gap-x topbar-gap-y', null, '32px');
bound('rail-inset rail-pad-x rail-pad-y', null, '32px'); bound('rail-width-rp rail-width-hybrid rail-width-utility', '48px', '320px'); bound('rail-width-collapsed', '48px', '160px'); bound('drawer-width', '200px', '320px');
bound('rail-icon-size', '28px', '72px'); bound('center-width center-width-narrow', '320px', '1280px'); bound('side-width', '240px', '480px');
bound('shelf-columns', 1, 4);
bound('bloom-alpha-rp bloom-alpha-hybrid bloom-alpha-utility', 0, 0.6);                                              // DD-242: the per-mode bloom behind the canvas is a deliberately listed colour role, a share of the canvas at most 0.6
// time and layering: the dialogs are in the top layer (they cannot be covered), but the notes, the gate and the library are not; --home-z-* is a token, so the "no z-index" rule does not see it
bound('dur-stage dur-topbar dur-mode-bar dur-bloom dur-rail dur-rail-fade dur-progress dur-toast', null, '600ms');
bound('stage-shift topbar-shift', null, '48px'); bound('toast-offset', null, '64px'); bound('tip-gap', null, '24px');
bound('z-sticky z-mock z-scrim z-drawer z-skip z-tip z-toast', null, 50);
// behaviour tokens read by the script (DD-008 Back window, DD-212 tap rule): THEMING rule 5 says a pack changes appearance, never behaviour, so they are bounded to a narrow band
bound('toast-ms', '2000ms', '5000ms'); bound('tap-ms', '300ms', '800ms'); bound('tap-slop', '6px', '16px');
export const HOME_MINIMUMS = MIN; export const HOME_MAXIMUMS = MAX;

// ---- 6b. PACK-SETTABLE role tokens (DD-242, fail closed): the colour roles of Home (channels, the composer and well fills, the on-accent label, the track and presence glow) and the role tokens of THEME_AUDIT
// ("Role tokens a pack may set"). Every token with a floor or a ceiling above (MIN / MAX) is listed by that, so the numbered ladders (--home-space-*, --home-text-*, --home-radius-N, ...) are not settable unless bounded.
// Not listed, so a pack that sets them is rejected: --banana-* style private variables (see THEMING.md, open decision on a private prefix).
export const HOME_SETTABLE = [/^--home-[a-z-]+-rgb$/, '--home-composer-bg', '--home-on-accent', '--home-well-bg', '--home-track', '--home-presence-glow',
  /^--home-(control-height|control-radius|control-pad-x|control-gap|card-radius|card-pad|card-gap|row-height|pill-height|field-radius|rail-width-[a-z]+|drawer-width|topbar-pad-[a-z]+|main-pad-[a-z]+|center-width(-narrow)?|side-width|avatar-[a-z0-9-]+|portrait-height|realm-min-height|run-mark-size|dialog-width|dur-[a-z-]+|toast-ms)$/];
// DD-242: pairs of a token on the protected surface it is drawn on, judged over the worst case (the label of the primary button of every critical dialog is --home-on-accent on --nexus-accent)
export const HOME_PAIRS = [['--home-on-accent', '--nexus-accent', 4.5, 'the accent fill (primary button label)']];
// DD-260 / DD-256 geometry models (estimates of the DOM, to calibrate): the ancestors of the library and the dialogs, and the height of a confirm dialog at 360 px (padding, title, body, two stacked buttons)
// CALIBRATED against rendered pages at 360x640 touch, Korean (theme/checks/measure/, theme/checks/calibration.txt). The real ancestry of the protected blocks is home-shell > home-main > (home-library > bulk result | home-realm > status/gate | draft choice | setup note);
// the critical dialogs are top-layer <dialog>s with no data-part ancestor. A dialog has max-height 100% - 36 px and scrolls as a whole (nothing is fixed), so only the content estimate is reported.
export const HOME_CHAINS = [{ name: 'the library chain (home-shell > home-main > home-library)', parts: ['home-shell', 'home-main', 'home-library'], defaults: { 'home-main': 32, 'home-library': 38 } }, { name: 'the realm chain (home-shell > home-main > home-realm)', parts: ['home-shell', 'home-main', 'home-realm'], defaults: { 'home-main': 32, 'home-realm': 38 } }, { name: 'the dialog', parts: ['home-dialog'] }];
export const HOME_SHEET_TERMS = (p) => [{ t: '--home-dialog-pad', n: 2 }, { text: { chars: p.title, size: '--home-text-lg', lead: 1.55, hpad: ['--home-dialog-pad', '--home-dialog-margin'] } }, { px: 4 }, { text: { chars: p.body, size: '--home-text-base', lead: 1.55, hpad: ['--home-dialog-pad', '--home-dialog-margin'] } }, { text: { chars: p.small || 0, size: '--home-text-sm', lead: 1.55, hpad: ['--home-dialog-pad', '--home-dialog-margin'] } }, { px: p.extra || 0 }, { px: 16 }, { t: '--home-control-height' }];
export const HOME_SHEET_REF = { title: 20, body: 95, small: 14, extra: 98 };
export const HOME_SHEETS = [{ name: 'home confirm dialog', terms: HOME_SHEET_TERMS(HOME_SHEET_REF), fixed: [], cap: 604 }];
export const HOME_REGISTRY = { fixedWidth: ['home-dialog'], chains: HOME_CHAINS, sheets: HOME_SHEETS, critical: HOME_CRITICAL, safe: HOME_SAFE, reach: HOME_REACH, controls: HOME_REACH_DD243, surfaces: HOME_SURFACES, tokens: HOME_TOKENS, minimums: HOME_MINIMUMS, maximums: HOME_MAXIMUMS, strictSafe: false, positionable: HOME_POSITIONABLE, settable: HOME_SETTABLE, pairs: HOME_PAIRS, transparentOk: ['--home-presence-glow'] };

// ---- 7. SUPPLEMENT: three gaps that chat's validator leaves open, found while writing lint-home.mjs (each is a hostile case there). chat's validator is imported unchanged; these run next to it, and the main session
// can lift them into packlint.mjs. lintHome(css, name) is chat.lintPack(css, name, HOME_REGISTRY) plus this pass (nothing it rejects is accepted here, nothing chat rejects is accepted by the supplement).
//   a. url(), image-set(), src(): the shared lint checks url() on the reach tier only, so `[data-part="home-greeting"] { background-image: url(https://...) }` (safe tier) and `cursor: url()` (reach tier) pass. Packs
//      carry no resources (THEMING: images and fonts are out of scope), so any of them anywhere is rejected.
//   b. alias tokens that a critical surface reads in place of the shared token the surfaces check judges: --home-dialog-bg (the sheet; a pack could make it transparent), --home-danger-edge, --home-danger-edge-strong,
//      --home-warning-edge (the cue of the warning notes) and --home-danger-text. They are locked: a pack sets their sources (--color-surface-sheet, --nexus-danger-rgb, --home-warning-rgb) and the checks above judge those.
//   c. --home-on-accent on --nexus-accent: the label of the primary button of every critical dialog is --home-on-accent on --nexus-accent. The surfaces list cannot express a token-on-token pair, so it is checked here (4.5:1).
const rdAbs = (f) => { try { return fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
const APP_TOKENS = readTokens(rootOf('home-tokens.css'), readTokens((() => { const m = /:root\s*\{([^}]*)\}/.exec(rdAbs('../theme/nexus-tokens.css')); return m ? m[1] : ''; })(), new Map()));
const LOCKED = ['--home-dialog-bg', '--home-danger-edge', '--home-danger-edge-strong', '--home-warning-edge', '--home-danger-text'];
const solve = (v, T, d = 0) => (d > 12 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (m, n, fb) => (T.has(n) ? solve(T.get(n), T, d + 1) : fb !== undefined ? solve(fb, T, d + 1) : m)));
const rgbOf = (s) => { s = s.trim().toLowerCase(); let m = /^#([0-9a-f]{3,8})$/.exec(s); if (m) { let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]); }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[\/,]\s*([\d.]+%?))?\s*\)$/.exec(s); if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])]; return null; };
const lum1 = (c) => { const f = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const x = lum1(a), y = lum1(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export function homeSupplement(css) {
  const errs = []; const fail = (selector, prop, why) => errs.push({ selector, prop, why });
  const text = chat.normalise(css);
  for (const m of text.matchAll(/(?<![\w-])(url|image-set|image|src|element)\s*\(/g)) fail('(stylesheet)', m[1] + '()', `${m[1]}() loads or draws a resource: a pack carries none (images and fonts are out of scope, THEMING.md)`);
  const T = new Map(APP_TOKENS); const own = []; for (const d of decls(text)) { if (!d.prop.startsWith('--')) continue; own.push(d); if (d.ctx.selector.trim() === ':root') T.set(d.prop, d.value.replace(/\s*!important\s*$/, '').trim()); }
  for (const d of own) if (LOCKED.includes(d.prop)) fail(d.ctx.selector.trim(), d.prop, `${d.prop} is locked: a critical surface reads it in place of the shared token that the surfaces check judges (set its source instead)`);
  const on = rgbOf(solve(T.get('--home-on-accent') || '', T)), acc = rgbOf(solve(T.get('--nexus-accent') || '', T));
  if (!on || !acc) fail(':root', '--home-on-accent', 'the primary button label and fill cannot be checked (a colour that does not resolve)');
  else { const k = ratio(on[3] < 1 ? [0, 1, 2].map((i) => on[i] * on[3] + acc[i] * (1 - on[3])).concat([1]) : on, acc); if (k < 4.5) fail(':root', '--home-on-accent', `the primary button label would be ${k.toFixed(2)}:1 on --nexus-accent (needs 4.5:1)`); }
  return errs;
}
export const lintHome = (css, name = '') => { const r = chat.lintPack(css, name, HOME_REGISTRY); const extra = homeSupplement(css); if (extra.length) { r.errors.push(...extra); r.ok = false; } return r; };
export const lintHomeSelector = (sel) => chat.lintSelector(sel, HOME_REGISTRY);

if (process.argv[1] && process.argv[1].endsWith('registry-home.mjs')) {
  let bad = 0;
  for (const f of process.argv.slice(2)) { const r = lintHome(fs.readFileSync(f, 'utf8'), f); console.log((r.ok ? 'OK       ' : 'REJECTED ') + f + (r.ok ? '' : '\n  ' + r.errors.map((e) => `${e.selector} { ${e.prop} }: ${e.why}`).join('\n  '))); if (!r.ok) bad++; }
  process.exit(bad ? 1 : 0);
}
