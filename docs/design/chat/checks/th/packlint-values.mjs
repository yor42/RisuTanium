// DS-075 value-space fixtures, copied from settings/checks/th/fixtures/attacks.mjs (the Settings lane's file, read-only) with the Settings part registry they are judged under (copied from packlint-settings.mjs).
// They run against chat's own lintPack (checks/th/lint.mjs): 60 must be rejected, 13 accepted.
export const SETTINGS_CRITICAL = ['settings-dialog', 'settings-dialog-backdrop', 'settings-critical-title', 'settings-critical-body', 'settings-critical-actions', 'settings-critical-action', 'settings-save-retry', 'settings-fix-banner', 'settings-chat-error-card',
  // Final round (re-review Q2, rule 3 names warnings): the inline warnings and failure results
  'settings-connection-warning', 'settings-connection-card-status', 'settings-test-result', 'settings-picker-warning', 'settings-fix-mark', 'settings-preset-warning', 'settings-warning-banner'];
// parts that are never critical, never hold a critical element and never sit inside one (asserted in the browser by parts.mjs over the whole tour)
export const SETTINGS_SAFE = ['settings-header', 'settings-search', 'settings-index-item', 'settings-index-link', 'settings-index-foot', 'settings-section-title', 'settings-jump-chips', 'settings-list-item', 'settings-toggle', 'settings-menu', 'settings-menu-item',
  'settings-callout', 'settings-banner', 'settings-toast', 'settings-results', 'settings-result', 'settings-result-group', 'settings-no-results', 'settings-switcher', 'settings-switcher-panel', 'settings-switcher-option', 'settings-switcher-option-name', 'settings-switcher-search', 'settings-switcher-scrim',
  'settings-picker-search', 'settings-picker-row-name', 'settings-picker-chip', 'settings-picker-scrim',
  'settings-connection-card-name', 'settings-fallback-item', 'settings-segmented'];

// the surfaces Settings' critical text sits on, and the strict safe tier (no position, no inset)
export const SETTINGS_SURFACES = [['--nexus-text', 'canvas', 'the canvas', 4.5], ['--nexus-text', 'glass', 'the row glass', 4.5], ['--nexus-text', 'raised', 'a raised surface', 4.5], ['--nexus-text', 'toast', 'the toast', 4.5], ['--nexus-text-secondary', 'canvas', 'the canvas', 4.5], ['--nexus-text-secondary', 'glass', 'the row glass', 4.5], ['--nexus-danger', 'sheet', 'the dialog', 4.5], ['--nexus-danger', 'canvas', 'the canvas', 4.5], ['--nexus-danger', 'glass', 'the row glass', 4.5], ['--nexus-field-border', 'glass', 'the row glass', 2], ['--nexus-ring', 'canvas', 'the canvas', 3], ['--nexus-ring', 'sheet', 'the dialog', 3]];
export const SETTINGS_REGISTRY = { critical: SETTINGS_CRITICAL, safe: SETTINGS_SAFE, surfaces: SETTINGS_SURFACES, strictSafe: true };
export const REJECT = {
  // R-01: role tokens with no bounds
  'tok-dialog-padding-400': [':root{--settings-dialog-padding:400px}', 'message body 0 px wide, title 0 wide'],
  'tok-dialog-actions-gap': [':root{--settings-dialog-actions-gap:300px}', 'actions pushed off the dialog'],
  'tok-dialog-actions-margin': [':root{--settings-dialog-actions-margin-top:900px}', 'actions pushed off the dialog'],
  'tok-dur-60s': [':root{--dur-base-nominal:60s}', 'dialog opens at opacity 0.01 and stays near-invisible'],
  'tok-dur-fast-60s': [':root{--dur-fast-nominal:60s}', 'toast and press states take a minute'],
  'tok-dur-slow-ms': [':root{--dur-slow-nominal:6000ms}', 'six seconds'],
  'tok-dialog-width-120': [':root{--dialog-width:120px}', 'dialog 120 px wide, 661 px tall'],
  'tok-dialog-width-5000': [':root{--dialog-width:5000px}', 'dialog wider than the screen'],
  'layout-dialog-width-120': ['html[data-layout="phone"]{--dialog-width:20px}', 'the same through a layout block'],
  'tok-page-max-10': [':root{--page-max-width:10px}', 'failed row 0 px wide, fix banner 26 px wide'],
  'tok-body-columns-5000': ['html[data-layout="wide"]{--body-columns:5000px 1fr}', 'index column 5000 px, the page squeezed'],
  'tok-body-columns-0': ['html[data-layout="wide"]{--body-columns:0px 1fr;--index-column:0px}', 'index column of 0 px'],
  'tok-index-column-3': [':root{--index-column:3;--page-column:3}', 'index and page in the same column'],
  'tok-rows-gap-300': [':root{--settings-rows-gap:300px}', 'rows 300 px apart'],
  'tok-row-min-3000': [':root{--settings-row-min-height:3000px}', 'every row 3000 px tall'],
  'tok-header-0': [':root{--settings-header-height:0px;--settings-header-height-phone:0px}', 'header of no height'],
  'tok-field-min-1': [':root{--field-min-height:1px}', 'fields 1 px tall'],
  'tok-section-title-2': [':root{--settings-section-title-width:2px}', 'section titles 2 px wide'],
  'tok-hairline-100': [':root{--hairline:100px}', 'hairline measure of 100 px'],
  'tok-radius-900': [':root{--settings-radius-dialog:900px}', 'dialog corners eat the content'],
  'tok-icon-0': [':root{--icon-size-xl:0px;--icon-size-lg:0px}', 'icon buttons without icons'],
  'tok-field-border-transparent': [':root{--nexus-field-border:transparent}', 'field borders vanish (DS-077)'],
  'tok-accent-tint-1': [':root{--alpha-accent-tint:0.9}', 'a selected row as bright as the text'],
  'tok-ring-transparent': [':root{--nexus-ring:transparent}', 'no focus ring colour'],
  'tok-selection-hidden': [':root{--selection-text:transparent}', 'selected text disappears'],
  'tok-alpha-dim-0': [':root{--alpha-text-dim:0.1}', 'dim text nearly invisible'],
  'tok-danger-on-canvas': [':root{--nexus-danger-rgb:14 15 42}', 'danger text the colour of the sheet'],
  'tok-text-low': [':root{--nexus-text:#0e0f2a}', 'text the colour of the sheet'],
  // R-01: the safe tier let position / inset / large sizes through
  'safe-header-cover': ['[data-part="settings-header"]{position:absolute;inset:0;width:100%;height:100%}', 'the header covers the retry, the failed row and the banners'],
  'safe-header-inset': ['[data-part="settings-header"]{top:0;left:0}', 'inset on a safe part'],
  'safe-header-position-only': ['[data-part="settings-header"]{position:absolute}', 'position on a safe part'],
  'safe-header-height-big': ['[data-part="settings-header"]{height:100vh}', 'a large header'],
  'safe-search-cover': ['[data-part="settings-search"]{position:absolute;inset:0;width:100%;height:100%}', 'search covers the page'],
  'safe-results-cover': ['[data-part="settings-results"]{position:absolute;inset:0;height:100vh;width:100vw}', 'results cover the page'],
  'safe-jumpchips-cover': ['[data-part="settings-jump-chips"]{position:absolute;top:0;left:0;width:100vw;height:100vh}', 'chips cover the deeplink banner'],
  'safe-scrim-cover': ['[data-part="settings-picker-scrim"]{position:absolute;inset:0;width:100vw;height:100vh}', 'a scrim over everything'],
  'safe-index-neg-margin': ['[data-part="settings-index"]{margin-left:-600px}', 'a negative margin on a safe part'],
  'safe-header-width-2000': ['[data-part="settings-header"]{min-width:2000px}', 'a safe part wider than the screen'],
  // R-02: named colours and backgrounds
  'color-black-cancel': ['[data-dlg="cancel"]{color:black;background:transparent;border-color:transparent}', 'Cancel 1.29:1'],
  'color-black-dlg': ['[data-dlg]{color:black}', 'both buttons'],
  'color-black-row': ['[data-part="settings-row"]{color:black}', 'failed-row title 1.07:1'],
  'color-black-body': ['[data-part="settings-body"]{color:black}', 'failed-row title 1.07:1 through an ancestor'],
  'color-black-shell': ['[data-part="settings-shell"]{color:black}', 'through the shell'],
  'color-black-page': ['[data-part="settings-page"]{color:black}', 'through the page'],
  'color-name-navy': ['[data-part="settings-row"]{color:midnightblue}', 'a named dark colour'],
  'color-hsl-black': ['[data-part="settings-row"]{color:hsl(0 0% 0%)}', 'hsl cannot be checked, here it is dark'],
  'bg-white-row': ['[data-part="settings-row"]{background:#fff}', 'failed-row title 1.00:1, marker 2.74:1'],
  'bg-white-name-row': ['[data-part="settings-row"]{background-color:white}', 'the same by name'],
  'bg-gradient-row': ['[data-part="settings-row"]{background:linear-gradient(#fff,#fff)}', 'a gradient of white'],
  'bg-white-overlay': ['[data-overlay="dialog"]{background:#fff}', 'a white page behind a dark dialog'],
  'bg-white-own-pair': ['[data-part="settings-row"]{background:#fff;color:#000}', 'a readable pair that still leaves the danger marker at 2.7:1'],
  'bg-white-shell': ['[data-part="settings-shell"]{background:#fff}', 'a white shell'],
  'bg-white-dialog-btn': ['[data-dlg="cancel"]{background:#fff}', 'a white Cancel with light text'],
  // the names that stay protected (R-06)
  'name-connection-warning': ['[data-part="settings-connection-warning"]{color:#fff}', 'a critical warning named'],
  'name-card-status-hidden': ['[data-part="settings-connection-card-status"]{display:none}', 'the bad-card status removed'],
  'name-card-status-transparent': ['[data-part="settings-connection-card-status"]{color:transparent}', 'the bad-card status invisible'],
  'name-warning-banner-hidden': ['[data-part="settings-warning-banner"]{display:none}', 'the deeplink warning removed'],
  'name-picker-warning': ['[data-part="settings-picker-warning"]{font-size:0}', 'the picker warning shrunk away'],
  'name-test-result': ['[data-part="settings-test-result"]{opacity:0}', 'the test failure invisible'],
  'name-preset-warning': ['[data-part="settings-preset-warning"]{display:none}', 'the failed-preset badge removed'],
};
export const ACCEPT = {
  // what a card pack, a different index side and a denser pack need
  'card-row': ['[data-part="settings-row"]{border-radius:14px;border:1px solid #ccc;background:rgb(36 38 90)}', 'a row card'],
  'shell-gap': ['[data-part="settings-shell"]{padding:0 12px 12px;gap:6px}', 'spacing on an ancestor'],
  'header-colour': ['[data-part="settings-header"]{background:#fffaf0;border-bottom:1px solid #d8c8a8;padding:6px 10px;border-radius:0 0 14px 14px}', 'a safe part keeps colour, border, padding, radius'],
  'safe-opacity': ['[data-part="settings-header"]{opacity:0.9}', 'opacity on a safe part is its own business'],
  'safe-width-100': ['[data-part="settings-search"]{width:100%;max-width:360px}', 'a bounded width on a safe part'],
  'safe-relative': ['[data-part="settings-header"]{position:relative}', 'relative is allowed (no inset to go with it)'],
  'dur-300': [':root{--dur-base-nominal:300ms;--dur-slow-nominal:400ms}', 'a slower pack inside the bound'],
  'dur-zero': [':root{--dur-base-nominal:0s}', 'no motion at all'],
  'padding-24': [':root{--settings-dialog-padding:24px;--settings-row-padding-y:14px}', 'roomier'],
  'width-wide': [':root{--dialog-width:30rem;--page-max-width:840px}', 'wider inside the bounds'],
  'index-right': ['html[data-layout="wide"]{--body-columns:minmax(0, 1fr) 280px;--index-column:2;--page-column:1}', 'DS-074: the index on the right'],
  'selection-hint': [':root{--selection-bg:rgb(255 200 0 / 0.4)}', 'selection colour'],
  'part-colour-dark-on-light': [':root{--nexus-canvas:#fff8ee;--color-surface-sheet:#fff8ee;--nexus-surface:rgb(255 255 255 / 0.7);--nexus-surface-raised:#fff;--nexus-text:#2a1a0a;--nexus-text-secondary:#5a4630;--nexus-text-muted:#6b5a45;--nexus-danger-rgb:176 32 32;--nexus-ring:#8a4b12;--nexus-accent-rgb:138 75 18;--nexus-overlay-rgb:0 0 0;--color-surface-toast:#fffdf8}[data-part="settings-row"]{color:#2a1a0a}', 'a light pack that states its whole scheme (DD-242: muted text too, it sits on the sheet)'],
};
