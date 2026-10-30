// Studio slice 4's registry for chat's pack-install validator (DD-149, DD-155, DD-159; chat/checks/th/packlint.mjs is imported unchanged, same as Settings does in settings/checks/th/packlint-settings.mjs).
// A registry is { critical, safe, surfaces, tokens } (DS-075): the slice 4 part names, the surfaces its critical text sits on, and its own token defaults. strictSafe stays false: the spec does not ask for it (positioning of the safe parts is judged by chat's rule).
//   node packlint-studio.mjs ../../themes/origin-navy.css      exits 1 if a file is rejected
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chat from '../../../chat/checks/th/packlint.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const rd = (f) => { try { return fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
// Studio's token defaults: the first :root block of st4.css (the ladder and the role tokens); later blocks (html[data-layout], html[data-input]) are the same names under a root attribute, which a pack may also set (DD-159)
const readTokens = (css, into) => { for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) into.set(m[1], m[2].trim()); return into; };
// DD-200: the ladder moved to studio-tokens.css (shared by slices 1-4); the role tokens of slice 4 stay in st4.css. Both first :root blocks are the defaults.
const rootOf = (f) => { const m = /:root\s*\{([^}]*)\}/.exec(rd(f)); return m ? m[1] : ''; };
export const STUDIO_TOKENS = readTokens(rootOf('../../st4.css'), readTokens(rootOf('../../studio-tokens.css'), new Map()));

// the protected parts: the risky section with its own child parts, and the question sheet with its own child parts (spec section 12, items 3 and 5)
const S4_CRITICAL = ['studio-risky', 'studio-risky-header', 'studio-risky-warning', 'studio-risky-flag', 'studio-risky-switch', 'studio-risky-explain',
  'studio-risky-confirm', 'studio-risky-confirm-title', 'studio-risky-confirm-body', 'studio-risky-confirm-cancel', 'studio-risky-confirm-ok',
  // the question that opens a private-licence character's content (DD-188), with its own child parts
  'studio-private-confirm', 'studio-private-confirm-title', 'studio-private-confirm-body', 'studio-private-confirm-cancel', 'studio-private-confirm-ok'];
// parts the app guarantees are never protected, never hold a protected element and never sit inside one: every other part of the slice 4 forms. studio-form itself is NOT here: it is the ancestor of the risky section.
const S4_SAFE = ['studio-form-section', 'studio-form-section-header', 'studio-form-section-body', 'studio-field', 'studio-field-label', 'studio-field-help', 'studio-field-control', 'studio-field-note', 'studio-field-chip',
  'studio-addfield', 'studio-addfield-list', 'studio-addfield-item', 'studio-segments', 'studio-segment', 'studio-portrait-main', 'studio-portrait-alt', 'studio-thumb', 'studio-thumb-placeholder',
  'studio-emotion-row', 'studio-emotion-name', 'studio-asset-row', 'studio-asset-name', 'studio-row-handle', 'studio-row-menu', 'studio-image-picker', 'studio-image-picker-item', 'studio-bias-row',
  'studio-member-list', 'studio-member-row', 'studio-member-avatar', 'studio-member-talk', 'studio-member-active', 'studio-order-mode', 'studio-private-notice'];
// DD-200: the parts of slices 1-3 come from the builders' registries (checks/th/parts-shell|tgb|lte.json: generated from a census of the running pages, re-verified by the th section on every run).
const pj = (f) => { try { return JSON.parse(fs.readFileSync(path.join(here, '..', 'th', f), 'utf8')); } catch { return {}; } };
const SH = pj('parts-shell.json'), TG = pj('parts-tgb.json'), LT = pj('parts-lte.json');
// Studio fix round (review M2, studio/checks/th/reach-moves.json): the save chip is protected while its state is failed or conflict, its icon and text are its protected children, and Retry is protected while visible. A static list cannot say 'while', so the names are critical always:
// a pack styles them through tokens only. studio-header and studio-save-slot now contain a protected element, so they leave the safe tier (reach, below).
export const SAVE_CRITICAL = ['studio-save-chip', 'studio-save-chip-icon', 'studio-save-chip-text', 'studio-save-retry'];
export const STUDIO_CRITICAL = [...new Set([...SAVE_CRITICAL, ...S4_CRITICAL, ...(SH.critical || []), ...(SH.parts || []).filter((p) => p.child).map((p) => p.name), ...(TG.critical || []), ...(TG.criticalChildren || []), ...(LT.critical || []), ...(LT.criticalChildren || [])])];
export const STUDIO_SAFE = [...new Set([...S4_SAFE, ...(SH.safe || []), ...(TG.safe || []), ...(LT.safe || [])])].filter((n) => !STUDIO_CRITICAL.includes(n) && n !== 'studio-header' && n !== 'studio-save-slot');   // these two hold a protected element: reach only
// critical text and the surfaces it sits on: the question sheet is an opaque sheet; the risky section's tint is drawn over the canvas
export const STUDIO_SURFACES = [['--nexus-text', 'canvas', 'the canvas', 4.5], ['--nexus-text', 'sheet', 'the question sheet', 4.5], ['--nexus-text-secondary', 'canvas', 'the canvas', 4.5], ['--nexus-danger', 'canvas', 'the canvas', 4.5], ['--nexus-ring', 'canvas', 'the canvas', 3], ['--nexus-ring', 'sheet', 'the sheet', 3],
  // DD-200: the Undo toast, the sheets of slices 1-3 (restore point, apply, conflict, leave) and their danger text
  ['--nexus-text', 'toast', 'the Undo toast', 4.5], ['--nexus-accent', 'toast', 'the Undo toast action', 4.5], ['--nexus-danger', 'sheet', 'the sheet', 4.5]];
// DD-182 + DD-192: floors for every token the protected parts read ("match chat's critical rules"): text >= 11 px, buttons and switches >= 32 px, padding and gaps >= 4 px, alpha >= half the Deep Nexus value, and the danger edge and tint.
// A floor applies wherever the pack sets the token (:root, a root attribute, any selector); a value that cannot be resolved to a number fails closed.
export const STUDIO_MINIMUMS = {
  '--studio-font-xs': '11px', '--studio-font-sm': '11px', '--studio-font-md': '11px', '--studio-font-base': '11px', '--studio-font-lg': '11px', '--studio-font-xl': '11px', '--studio-form-label-size': '11px',
  '--studio-size-touch': '32px', '--studio-form-row-height': '32px',
  '--studio-space-1': '4px', '--studio-space-2': '4px', '--studio-space-3': '4px', '--studio-space-4': '4px', '--studio-form-section-padding': '4px', '--studio-form-field-gap': '4px', '--studio-form-group-gap': '4px',
  '--studio-alpha-5': 0.25, '--studio-form-risky-edge-width': '2px', '--studio-form-risky-tint-alpha': 0.05,
  // DD-195 / re-review N-2 and m-9: the line height of the warning and explanations, the hairline and divider of the section, the weight of its heading, the corner of its box
  '--studio-leading-body': 1.2, '--studio-leading-tight': 1.2, '--studio-size-hairline': '1px', '--studio-weight-strong': 500, '--studio-weight-medium': 400, '--studio-radius-3': '4px',
  // DD-197 (re-check R-2, the user chose looser floors): layout sizes a pack may shrink (compact packs, DD-151), but not collapse; the floors are half of the first proposal.
  '--studio-form-max-width': '140px', '--studio-form-fold-row-height': '16px', '--studio-form-talk-segment-width': '16px', '--studio-form-talk-segment-height': '16px',
  '--studio-form-thumb-size': '20px', '--studio-form-portrait-size': '48px', '--studio-form-portrait-alt-size': '28px', '--studio-form-member-avatar-size': '12px', '--studio-form-depth-width': '28px', '--studio-alpha-disabled': 0.3,
  // DD-200: what the slice 1-3 protected surfaces (restore point, apply, conflict, leave, Undo toast, alert banners) read
  '--studio-size-touch-sm': '28px', '--studio-size-touch-lg': '32px', '--studio-dialog-width': '240px', '--studio-menu-width': '200px', '--studio-toast-max-width': '200px', '--studio-header-height': '32px',
  '--studio-sp-10px': '4px', '--studio-sp-14px': '4px'
};
// DD-195: the other direction. A 300 px font or padding pushes the question's Cancel and OK off the sheet; a full-strength tint hides the heading; a 60 px edge eats the section.
export const STUDIO_MAXIMUMS = {
  '--studio-font-xs': '24px', '--studio-font-sm': '24px', '--studio-font-md': '24px', '--studio-font-base': '24px', '--studio-font-lg': '24px', '--studio-font-xl': '28px', '--studio-form-label-size': '24px',
  '--studio-size-touch': '72px', '--studio-form-row-height': '72px',
  '--studio-space-1': '24px', '--studio-space-2': '24px', '--studio-space-3': '24px', '--studio-space-4': '24px', '--studio-space-5': '32px', '--studio-space-6': '32px', '--studio-space-7': '32px', '--studio-space-8': '40px',
  '--studio-form-section-padding': '32px', '--studio-form-field-gap': '32px', '--studio-form-group-gap': '40px',
  '--studio-form-risky-edge-width': '12px', '--studio-form-risky-tint-alpha': 0.3,
  '--studio-leading-body': 2.2, '--studio-leading-tight': 2.2, '--studio-size-hairline': '4px', '--studio-weight-strong': 900, '--studio-weight-medium': 900, '--studio-radius-1': '32px', '--studio-radius-2': '32px', '--studio-radius-3': '32px',
  '--studio-size-touch-sm': '72px', '--studio-size-touch-lg': '72px', '--studio-dialog-width': '720px', '--studio-menu-width': '480px', '--studio-toast-max-width': '720px', '--studio-header-height': '96px',
  '--studio-sp-10px': '16px', '--studio-sp-14px': '16px', '--studio-radius-row': '32px', '--studio-radius-card': '32px'
};
// DD-242 (fail closed): the pack-settable tokens are the colour roles of Studio (channels, backgrounds, the on-colours, the diff pair, the editor highlights and syntax colours) and the 22 role tokens of THEME_AUDIT; every token with a floor or a
// ceiling above is settable by that. The internal ladders (--studio-sz-*, --studio-sp-*, --studio-font-*, --studio-leading-*, --studio-radius-N, --studio-opacity-*, --studio-scale-*, --studio-z-*) are not, unless listed with a bound.
// The two ring tokens and the three widths the review (B2, M6) found unbounded are listed with limits here: ring size 1 to 8 px, tree 160 to 480 px, side column 240 to 560 px. (--risu-animation-speed stays unlisted: not pack-settable.)
export const STUDIO_SETTABLE = [/^--studio-(?:[a-z0-9-]+-rgb|[a-z0-9-]+-bg|on-(?:accent|danger|warning)|knob|lt-hl-\d+|diff-(?:add|del)|syn-[a-z]+)$/,
  /^--studio-(?:header-height|tree-width|side-width|splitter-width|tree-head-height|tree-row-height(?:-fine|-owner|-owner-fine)?|tab-height|dialog-width|menu-width|search-width|toast-max-width|content-max-width|gutter-width|code-card-min-height|code-min-height|skip-hidden-offset|size-touch(?:-sm|-lg)?|radius-row|radius-card)$/];
// DD-260: ceilings for the Studio size role tokens that had none (px; the sheet-height rule judges the sum)
for (const [n, v] of Object.entries({ '--studio-splitter-width': '24px', '--studio-tree-head-height': '96px', '--studio-tree-row-height': '96px', '--studio-tree-row-height-fine': '96px', '--studio-tree-row-height-owner': '120px', '--studio-tree-row-height-owner-fine': '120px',
  '--studio-tab-height': '96px', '--studio-search-width': '720px', '--studio-content-max-width': '1400px', '--studio-gutter-width': '96px', '--studio-code-card-min-height': '480px', '--studio-code-min-height': '480px' })) STUDIO_MAXIMUMS[n] ??= v;
// fix round: the minimum width of a protected banner, the Undo toast and a question (M3). Settable with a floor at the page default (160 px) and a ceiling that still fits a phone; --studio-tab-size (the editor's tab width) replaces --tab-size.
STUDIO_MINIMUMS['--studio-critical-min-width'] = '160px'; STUDIO_MAXIMUMS['--studio-critical-min-width'] = '320px'; STUDIO_MINIMUMS['--studio-tab-size'] = 1; STUDIO_MAXIMUMS['--studio-tab-size'] = 8;
STUDIO_MINIMUMS['--studio-size-ring'] = '1px'; STUDIO_MAXIMUMS['--studio-size-ring'] = '8px';
STUDIO_MINIMUMS['--studio-tree-width'] = '160px'; STUDIO_MAXIMUMS['--studio-tree-width'] = '480px';
STUDIO_MINIMUMS['--studio-side-width'] = '240px'; STUDIO_MAXIMUMS['--studio-side-width'] = '560px';
// DD-243: navigation (the header with back, menu and the tree and side toggles, the tree column and rows, the side tabs, the focus-mode back controls), Apply and why-disabled, Undo and Redo, the failed-save chip with Retry, and Stop of a test run
export const STUDIO_REACH = ['studio-header', 'studio-header-back', 'studio-header-menu', 'studio-header-side-toggle', 'studio-header-tree-toggle', 'studio-header-search', 'studio-header-crumbs', 'studio-header-crumb', 'studio-header-title-button',
  'studio-tree-col', 'studio-tree', 'studio-tree-head', 'studio-tree-row', 'studio-tree-row-label', 'studio-tree-row-add', 'studio-side', 'studio-side-tabs', 'studio-side-tab', 'studio-side-close', 'studio-lt-focus-header', 'studio-lt-focus-back', 'studio-lt-focus-undo', 'studio-lt-focus-redo',
  'studio-tgb-page-back', 'studio-item-apply', 'studio-item-apply-why', 'studio-header-undo', 'studio-header-redo', 'studio-save-slot', 'studio-test-stop'];
// DD-242 pairs: the label on each filled button (accent, danger, warning), the diff pair on the sheet, the warning line on the sheet and the toast
export const STUDIO_PAIRS = [['--studio-on-accent', '--nexus-accent', 4.5, 'the accent fill'], ['--studio-on-danger', '--nexus-danger', 4.5, 'the danger fill'], ['--studio-on-warning', '--color-warning', 4.5, 'the warning fill'],
  ['--studio-diff-add', '--color-surface-sheet', 4.5, 'the conflict sheet'], ['--studio-diff-del', '--color-surface-sheet', 4.5, 'the conflict sheet'], ['--color-warning', '--color-surface-sheet', 4.5, 'the sheet'], ['--color-warning', '--color-surface-toast', 4.5, 'the toast']];
// the status colours (saved, info, warm) are drawn on the canvas as marks and tints: 3:1 as non-text UI
STUDIO_PAIRS.push(['--studio-ok-rgb', '--nexus-canvas', 3, 'the canvas (status mark)'], ['--studio-info-rgb', '--nexus-canvas', 3, 'the canvas (status mark)'], ['--studio-warm-rgb', '--nexus-canvas', 3, 'the canvas (status mark)']);
// the channels the tints and veils are drawn from (T24, T25 of the review: --studio-canvas-rgb white on a dark pack; --studio-sheet-rgb equal to the text) keep the text readable on them. They need not equal --nexus-canvas: Banana Cocoa veils in white on a blue canvas.
STUDIO_PAIRS.push(['--nexus-text', '--studio-canvas-rgb', 4.5, 'the canvas veil'], ['--nexus-text', '--studio-sheet-rgb', 4.5, 'the sheet tint'], ['--nexus-ring', '--studio-sheet-rgb', 3, 'the sheet tint']);
// DD-260 / DD-256 geometry models (estimates of the DOM, to calibrate): the ancestors of the form and of the sheets, and the height of a protected sheet at 360 px (title, body, two stacked buttons)
// CALIBRATED against rendered pages at 360x640 touch, Korean (theme/checks/measure/, theme/checks/calibration.txt). The ancestry is the real DOM ancestry: shell > body > main > form-host > (form > risky section | tgb-banners > carry-over | tgb-merged > section > alert),
// shell > sheet-root > the sheet, shell > toast-box > the Undo toast. A sheet has max-height 86% and its .studio-critical-content scrolls, so the rule judges the room left for the scroller (fixed: grab bar and title).
export const STUDIO_CHAINS = [{ name: 'the form chain (studio-shell > studio-body > studio-main > studio-form-host > studio-form)', parts: ['studio-shell', 'studio-body', 'studio-main', 'studio-form-host', 'studio-form'], defaults: { 'studio-form-host': 24 } }, { name: 'the banner chain (studio-form-host > studio-tgb-banners)', parts: ['studio-shell', 'studio-body', 'studio-main', 'studio-form-host', 'studio-tgb-banners'], defaults: { 'studio-form-host': 24 } }, { name: 'the merged-section chain (studio-form-host > studio-tgb-merged > studio-tgb-merged-section)', parts: ['studio-shell', 'studio-body', 'studio-main', 'studio-form-host', 'studio-tgb-merged', 'studio-tgb-merged-section'], defaults: { 'studio-form-host': 24, 'studio-tgb-merged-section': 18 } }, { name: 'the sheet root', parts: ['studio-sheet-root'] }, { name: 'the toast box', parts: ['studio-toast-box'] }];
export const STUDIO_SHEET_TERMS = (p) => [{ px: 24 }, { text: { chars: p.title, size: '--studio-font-lg', lead: 1.5, hfixed: 32 } }, { px: 28 }, { text: { chars: p.body, size: '--studio-font-md', lead: 1.5, hfixed: 40 } }, { px: p.extra || 0 }, { px: 4 }, { t: '--studio-size-touch-lg', n: p.nBtn }, { px: 2 * (p.nBtn - 1) + 4 }];
export const STUDIO_SHEET_REF = { title: 24, body: 180, nBtn: 4, extra: 251 };
export const STUDIO_SHEETS = [{ name: 'studio protected sheet', terms: STUDIO_SHEET_TERMS(STUDIO_SHEET_REF), fixed: [{ px: 24 }, { text: { chars: STUDIO_SHEET_REF.title, size: '--studio-font-lg', lead: 1.5, hfixed: 32 } }], cap: 550 }];
export const STUDIO_REGISTRY = { fixedWidth: ['studio-sheet-root'], chains: STUDIO_CHAINS, sheets: STUDIO_SHEETS, critical: STUDIO_CRITICAL, safe: STUDIO_SAFE, reach: STUDIO_REACH, controls: STUDIO_REACH, surfaces: STUDIO_SURFACES, tokens: STUDIO_TOKENS, minimums: STUDIO_MINIMUMS, maximums: STUDIO_MAXIMUMS, strictSafe: false, settable: STUDIO_SETTABLE, pairs: STUDIO_PAIRS, transparentOk: ['--studio-count-error-bg'] };

/* DD-195: the colour part, which the shared lint's per-token pass cannot do. The risky section's tint is the danger channel at --studio-form-risky-tint-alpha over the canvas. Its heading is drawn in --nexus-danger; the warning in
   --nexus-text; the explanations in --nexus-text-secondary. Each must keep 4.5:1 on THAT tinted surface in the worst case the pack allows, and --nexus-danger-rgb (the tint's channel) must be the colour of --nexus-danger. */
const tokfile = (f) => { try { return fs.readFileSync(path.join(here, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
const APP_T = readTokens(tokfile('../../../theme/nexus-tokens.css'), new Map());
const hexRgb = (s) => { const m = /^#([0-9a-f]{3,8})$/i.exec(s.trim()); if (!m) return null; let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]); };
const parseCol = (s) => {
  s = String(s).trim().toLowerCase(); const h = hexRgb(s); if (h) return h;
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[\/,]\s*([\d.]+%?))?\s*\)$/.exec(s); if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])];
  const t3 = /^([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)$/.exec(s); if (t3) return [+t3[1], +t3[2], +t3[3], 1];   // a channel triple (--nexus-danger-rgb)
  return null;
};
const lum = (c) => { const f = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]);
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export function riskyColourPass(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } }).toLowerCase();
  const errs = []; const fail = (prop, why) => errs.push({ selector: ':root', prop, why });
  const cand = (n) => { const out = []; for (const m of text.matchAll(new RegExp('(?<![\\w-])' + n + '\\s*:\\s*([^;}]+)', 'g'))) out.push(m[1].replace(/!important/g, '').trim()); return out; };
  const resolveVar = (v, depth = 0) => (depth > 6 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (m, n, fb) => { const c = cand(n); return resolveVar(c.length ? c[c.length - 1] : APP_T.has(n) ? APP_T.get(n) : fb || m, depth + 1); }));
  const colours = (n, ctxAlpha) => { const raw = cand(n).length ? cand(n) : [APP_T.get(n) || '']; const out = []; for (const r of raw) { const v = resolveVar(r); let c = /^rgb\(\s*var\(/.test(v) ? null : parseCol(v); if (!c) { const mm = /^rgb\(\s*([^)]+)\)$/.exec(v); if (mm) c = parseCol(mm[1]); } if (!c) { fail(n, `a colour that cannot be checked against the risky section (${r.slice(0, 30)})`); return null; } out.push(c); } return out; };
  const canvas = colours('--nexus-canvas'), rgbs = colours('--nexus-danger-rgb'), txt = colours('--nexus-text'), sec = colours('--nexus-text-secondary');
  if (!canvas || !rgbs || !txt || !sec) return errs;
  // --nexus-danger: derived from the channel unless the pack states it; when it does, the two must be one colour
  const dangerRaw = cand('--nexus-danger'); let dangers = rgbs;
  if (dangerRaw.length) { dangers = []; for (const r of dangerRaw) { const v = resolveVar(r); let c = parseCol(v); if (!c) { const mm = /^rgb\(\s*([^)]+)\)$/.exec(v); if (mm) c = parseCol(mm[1]); } if (!c) { fail('--nexus-danger', `a colour that cannot be checked (${r.slice(0, 30)})`); return errs; } dangers.push(c); } }
  for (const d of dangers) for (const r of rgbs) if ([0, 1, 2].some((i) => Math.abs(d[i] - r[i]) > 8)) { fail('--nexus-danger-rgb', `--nexus-danger-rgb (${r.slice(0, 3).map(Math.round).join(' ')}) is not the colour of --nexus-danger (${d.slice(0, 3).map(Math.round).join(' ')}): the tint of the risky section must be the danger colour`); return errs; }
  for (const d of dangers) for (const x of txt) if ([0, 1, 2].every((i) => Math.abs(d[i] - x[i]) <= 24)) { fail('--nexus-danger-rgb', 'the danger colour is the text colour: the risky section would lose its colour cue (the heading and edge must stay distinguishable from body text)'); return errs; }
  const alphas = cand('--studio-form-risky-tint-alpha').map((v) => parseFloat(resolveVar(v))).filter((x) => !Number.isNaN(x)); if (!alphas.length) alphas.push(0.1);
  const a = Math.max(...alphas);
  for (const cv of canvas) for (const rg of rgbs) {
    const surf = over([rg[0], rg[1], rg[2], a], over(cv, [0, 0, 0, 1]));
    for (const [n, list, need] of [['--nexus-danger', dangers, 4.5], ['--nexus-text', txt, 4.5], ['--nexus-text-secondary', sec, 4.5]]) for (const c of list) {
      const flat = over(c, surf); const k = cr(flat, surf); if (k < need) { fail(n, `${n.replace('--nexus-', '')} would be ${k.toFixed(2)}:1 on the risky section's tint (alpha ${a} of the danger colour over the canvas; needs ${need}:1)`); return errs; }
    }
  }
  return errs;
}

export function lintPack(css, name = '', reg = STUDIO_REGISTRY) {
  const r = chat.lintPack(css, name, reg);
  if (reg === STUDIO_REGISTRY) { const extra = riskyColourPass(css); if (extra.length) { r.errors.push(...extra); r.ok = false; } }
  return r;
}
export function lintSelector(sel, reg = STUDIO_REGISTRY) { return chat.lintSelector(sel, reg); }
if (process.argv[1] && process.argv[1].endsWith('packlint-studio.mjs')) {
  let bad = 0;
  for (const f of process.argv.slice(2)) { const r = lintPack(fs.readFileSync(f, 'utf8'), f); console.log((r.ok ? 'OK       ' : 'REJECTED ') + f + (r.ok ? '' : '\n  ' + r.errors.map((e) => `${e.selector} { ${e.prop} }: ${e.why}`).join('\n  '))); if (!r.ok) bad++; }
  process.exit(bad ? 1 : 0);
}
