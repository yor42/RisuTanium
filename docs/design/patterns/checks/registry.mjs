// The registry FRAGMENT of the warning and task-progress pattern (DD-226: "one registry fragment adds floors and ceilings in every lane"; spec 6.3 / 6.5; MOTION_CONTRACT 2 / 9.13).
// A lane keeps its own registry and merges this fragment into it; chat's validator (chat/checks/th/packlint.mjs) is imported UNCHANGED, the way Settings, Studio and Home do it.
//
//   import { mergeRegistry, lintPattern } from '../../patterns/checks/registry.mjs';
//   export const REG = mergeRegistry(MY_LANE_REGISTRY);            // critical, safe, surfaces, tokens, minimums, maximums
//   export const lint = (css, name) => lintPattern(css, name, MY_LANE_REGISTRY);   // chat.lintPack(css, name, merged) + the supplement below
//
// What the fragment carries:
//   critical   every pattern part that the spec 6.3 table protects. A pack selector may not name them (nor data-part-critical), so a pack reaches them only through tokens.
//   safe       none. A safe leaf must never sit inside a protected element (packlint.mjs rule 4); every pattern part either is critical or sits inside pattern-task-root / pattern-warn-root / pattern-dialog,
//              which are. The decorative parts (mark, title, subtitle, steps, step, detail, chip, ...) are therefore the REACH tier: a pack may recolour, reborder, respace and re-font them, not hide or move them.
//   surfaces   the contrast pairs the pattern's text, edges and bar sit on (sheet and toast).
//   minimums / maximums   the floors and ceilings of spec 6.5 (look) and MOTION_CONTRACT 2 (motion), judged in the worst case over every declaration of the token in the pack (DD-182, DD-195).
// What the supplement adds (the gaps the shared validator cannot express, found while writing it):
//   a. --pm-* (the internal mode switches of motion.css) are locked: a pack may not set them, so it cannot turn reduced motion or low power off.
//   b. easings: any pack token whose name contains "ease" must be a cubic-bezier with every y in [0, 1] (no overshoot), or a plain keyword.
//   c. pairs the surfaces list cannot express: --pattern-on-accent on the accent, --pattern-on-danger on the danger fill (4.5:1); the bar fill and the failed fill against the track (3:1);
//      caution and danger edges must differ by at least 60 in RGB distance (spec 6.5 "severity separability"; the number is a proposal, the spec left it open).
//   d. url(), image-set(), src() anywhere: a pack carries no resources (Home's supplement, lifted).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chat from '../../chat/checks/th/packlint.mjs';
import { decls } from '../../chat/checks/th/csslit.mjs';
import { packHeights, VIEW_H, VIEW_W } from './sheet-height.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const rd = (rel) => { try { return fs.readFileSync(path.resolve(here, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); } catch { return ''; } };
const readTokens = (css, into) => { for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) into.set(m[1], m[2].trim()); return into; };

// ---- tokens: nexus-tokens.css (channels, the 7 shared motion tokens) then pattern-tokens.css
export const NEXUS_TOKENS = readTokens(rd('../../theme/nexus-tokens.css'), new Map());
export const PATTERN_TOKENS = readTokens(rd('../../theme/pattern-tokens.css'), new Map());

// ---- parts
export const PATTERN_CRITICAL = [
  'pattern-layer', 'pattern-scrim', 'pattern-dialog',
  'pattern-warn-root', 'pattern-warn-mark', 'pattern-warn-headline', 'pattern-warn-consequences', 'pattern-warn-consequence', 'pattern-warn-detail-toggle', 'pattern-warn-actions',
  'pattern-warn-action-cancel', 'pattern-warn-action-primary', 'pattern-warn-action-secondary', 'pattern-warn-undo', 'pattern-warn-ack',
  'pattern-task-root', 'pattern-task-status', 'pattern-task-cancel', 'pattern-task-cancel-reason', 'pattern-task-actions', 'pattern-task-result', 'pattern-task-result-headline', 'pattern-task-result-summary',
  'pattern-task-result-skipped', 'pattern-task-result-skip', 'pattern-task-result-more', 'pattern-task-result-leftout', 'pattern-task-result-actions', 'pattern-task-guidance', 'pattern-task-retry', 'pattern-task-close',
  'pattern-task-undo-import', 'pattern-task-bar', 'pattern-task-bar-fill', 'pattern-task-count', 'pattern-toast-undo',
];
// reach tier: not critical, not safe (they sit inside a protected root). Listed for documentation and for the checks; nothing reads this list.
export const PATTERN_REACH = [
  'pattern-warn-caret', 'pattern-warn-detail', 'pattern-mock-tag',
  'pattern-task-mark', 'pattern-task-mark-badge', 'pattern-task-title', 'pattern-task-subtitle', 'pattern-task-steps', 'pattern-task-step', 'pattern-task-step-icon', 'pattern-task-step-count',
  'pattern-task-bar-sweep', 'pattern-task-bar-ticks', 'pattern-task-detail', 'pattern-task-result-code', 'pattern-task-background', 'pattern-task-resume',
  'pattern-task-chip', 'pattern-task-toast', 'pattern-task-toasts', 'pattern-task-toast-line', 'pattern-task-toast-open', 'pattern-task-toast-dismiss', 'pattern-task-toast-more',
];
export const PATTERN_SAFE = [];
// DD-242 fail-closed lint: the role tokens a pack may set, the colour tokens whose names the lint cannot recognise, the surfaces that must stay opaque, and token-on-token contrast. Every token the registry bounds
// below (minimums / maximums) is settable already; these are the unbounded ones (looks, colours, easings). Same regex as `node theme/checks/pattern-gap.mjs` suggests, widened to the motion groups.
export const PATTERN_SETTABLE = [/^--pattern-[a-z0-9-]+$/, /^--(task|warning)-[a-z0-9-]+$/];
export const PATTERN_COLOURS = [/^--pattern-(warn-rgb-|warn-edge-(notice|caution|confirm|danger|blocked)$|tint-|fill-(confirm|danger)$|on-|skip-edge$|warn-scrim$|surface|task-bar-(track|fail|sweep|fill-from|fill-to|fill-end)$)/];
export const PATTERN_OPAQUE = ['--pattern-surface', '--pattern-surface-toast'];
export const PATTERN_PAIRS = [['--pattern-on-accent', '--nexus-accent', 4.5, 'a confirm button'], ['--pattern-on-danger', '--nexus-danger', 4.5, 'a danger button']];

export const PATTERN_SURFACES = [
  ['--nexus-text', 'sheet', 'the pattern sheet', 4.5], ['--nexus-text', 'toast', 'the toast', 4.5],
  ['--nexus-text-secondary', 'sheet', 'the pattern sheet', 4.5], ['--nexus-text-secondary', 'toast', 'the toast', 4.5], ['--nexus-text-muted', 'sheet', 'the pattern sheet', 4.5],
  ['--nexus-ring', 'sheet', 'the pattern sheet', 3], ['--nexus-ring', 'toast', 'the toast', 3], ['--nexus-danger', 'sheet', 'the pattern sheet', 4.5],   // the failed step's text sits on the sheet; a toast shows a failure with an edge, not danger-coloured text
  // severity edges and the skipped-list edge are non-text cues: 3:1 (spec 6.5 "severity edge against the surface 3:1")
  ['--pattern-warn-edge-notice', 'sheet', 'the pattern sheet', 3], ['--pattern-warn-edge-caution', 'sheet', 'the pattern sheet', 3], ['--pattern-warn-edge-confirm', 'sheet', 'the pattern sheet', 3],
  ['--pattern-warn-edge-danger', 'sheet', 'the pattern sheet', 3], ['--pattern-warn-edge-blocked', 'sheet', 'the pattern sheet', 3], ['--pattern-skip-edge', 'sheet', 'the pattern sheet', 3], ['--pattern-skip-edge', 'toast', 'the toast', 3],
  ['--pattern-task-bar-fail', 'sheet', 'the pattern sheet', 3], ['--pattern-task-bar-fill-to', 'sheet', 'the pattern sheet', 3],
];

// ---- floors and ceilings. px, ms or plain numbers only (a relative unit fails closed). [token, floor, ceiling]; null = not bounded on that side.
const LOOK = [
  ['--pattern-warn-headline-size', '13px', '24px'], ['--pattern-warn-body-size', '11px', '24px'], ['--pattern-task-count-size', '11px', '24px'],
  ['--pattern-warn-action-height', '32px', '72px'], ['--pattern-warn-padding', '4px', '32px'], ['--pattern-warn-gap', '4px', '32px'], ['--pattern-task-step-gap', '4px', '32px'],
  ['--pattern-warn-edge-width', '2px', '12px'], ['--pattern-warn-tint-alpha', 0.05, 0.3], ['--pattern-warn-headline-leading', 1.2, 2.2], ['--pattern-warn-body-leading', 1.2, 2.2],
  ['--pattern-task-bar-height', '4px', '16px'], ['--pattern-task-bar-height-compact', '2px', '8px'], ['--pattern-warn-mark-size', '16px', '96px'], ['--pattern-warn-mark-size-banner', '16px', '96px'],
  ['--pattern-task-mark-size', '16px', '96px'], ['--pattern-task-mark-size-compact', '16px', '96px'], ['--pattern-skip-edge-width', '1px', '8px'],
  ['--pattern-warn-headline-weight', 400, 900], ['--pattern-warn-radius', null, '32px'], ['--pattern-warn-action-radius', null, '32px'], ['--pattern-warn-width', '280px', '640px'], ['--pattern-toast-width', '280px', '480px'], ['--pattern-toast-gap', null, '32px'],
  ['--pattern-z-layer', 40, 100], ['--pattern-z-toast', 40, 101],
  // the geometry the component rules read (all absolute units, so each can be judged)
  ['--pattern-icon-size', '10px', '48px'], ['--pattern-step-icon-size', '10px', '48px'], ['--pattern-step-dot', '4px', '24px'], ['--pattern-step-dot-now', '4px', '24px'], ['--pattern-step-ring-width', '1px', '6px'],
  ['--pattern-bullet-size', '3px', '16px'], ['--pattern-bullet-top', 0, '32px'], ['--pattern-bullet-inset', 0, '16px'], ['--pattern-list-indent', 0, '48px'], ['--pattern-ack-size', '14px', '32px'],
  ['--pattern-count-width', '24px', '120px'], ['--pattern-line-min', '12px', '48px'], ['--pattern-action-basis', '64px', '240px'], ['--pattern-pill-radius', 0, '999px'], ['--pattern-tick-gap', '1px', '4px'],
  ['--pattern-disabled-opacity', 0.4, 0.85], ['--pattern-dim-opacity', 0.3, 1], ['--pattern-fail-sweep-opacity', 0.3, 1], ['--pattern-focus-width', '1px', '8px'], ['--pattern-focus-offset', 0, '6px'], ['--pattern-ring-width', '1px', '6px'],
  ['--pattern-weight-strong', 400, 900],
];
const MOTION = [   // MOTION_CONTRACT 2a (shared), 2b (--task-*), 2c (--warning-*)
  ['--nexus-duration-exit', 0, '300ms'], ['--nexus-duration-lowpower-cap', 0, '200ms'], ['--nexus-dialog-enter-distance', 0, '16px'], ['--nexus-sheet-enter-distance', 0, '24px'], ['--nexus-scrim-duration', 0, '300ms'],
  ['--task-step-enter-dur', 0, '300ms'], ['--task-step-enter-distance', 0, '8px'], ['--task-step-stagger', 0, '60ms'], ['--task-step-stagger-max', 0, '240ms'], ['--task-tick-dur', 0, '300ms'], ['--task-tick-scale-from', 0.5, 1],
  ['--task-fill-dur', 0, '600ms'], ['--task-sweep-period', '1000ms', '3000ms'], ['--task-hold-period', '1200ms', '3200ms'], ['--task-state-dur', 0, '300ms'], ['--task-mark-dwell', '300ms', '1200ms'],
  ['--task-count-interval', '100ms', '1000ms'], ['--task-badge-delay', 0, '450ms'], ['--task-badge-dur', 0, '300ms'], ['--task-badge-scale-from', 0.5, 1], ['--task-result-delay', 0, '600ms'], ['--task-result-enter-dur', 0, '400ms'],
  ['--task-result-distance', 0, '16px'], ['--task-result-row-delay', 0, '120ms'], ['--task-result-row-stagger', 0, '60ms'], ['--task-toast-enter-dur', 0, '300ms'], ['--task-toast-distance', 0, '16px'], ['--task-toast-overlap', 0, '80ms'],
  ['--task-toast-done-hold', '5000ms', null],
  ['--warning-glyph-delay', 0, '120ms'], ['--warning-glyph-dur', 0, '300ms'], ['--warning-glyph-scale-from', 0.7, 1], ['--warning-halo-delay', '200ms', '400ms'], ['--warning-halo-dur', 0, '900ms'], ['--warning-halo-scale-to', 1, 1.6],
  ['--warning-halo-opacity', 0, 0.6], ['--warning-bullet-delay', 0, '160ms'], ['--warning-bullet-stagger', 0, '60ms'], ['--warning-bullet-dur', 0, '300ms'], ['--warning-bullet-distance', 0, '8px'], ['--warning-detail-dur', 0, '200ms'],
  ['--warning-press-scale', 0.94, 1], ['--warning-press-dur', 0, '200ms'], ['--warning-arm-delay', '150ms', '400ms'], ['--warning-swap-out-dur', 0, '200ms'], ['--warning-swap-in-dur', 0, '300ms'],
];
export const PATTERN_MINIMUMS = {}; export const PATTERN_MAXIMUMS = {};
for (const [n, lo, hi] of [...LOOK, ...MOTION]) { if (lo !== null) PATTERN_MINIMUMS[n] = lo; if (hi !== null) PATTERN_MAXIMUMS[n] = hi; }
export const PATTERN_TOKEN_NAMES = [...LOOK, ...MOTION].map((x) => x[0]);

export const PATTERN_FRAGMENT = { critical: PATTERN_CRITICAL, safe: PATTERN_SAFE, reach: PATTERN_REACH, settable: PATTERN_SETTABLE, colours: PATTERN_COLOURS, opaque: PATTERN_OPAQUE, pairs: PATTERN_PAIRS, surfaces: PATTERN_SURFACES, tokens: new Map([...NEXUS_TOKENS, ...PATTERN_TOKENS]), minimums: PATTERN_MINIMUMS, maximums: PATTERN_MAXIMUMS };

// ---- merging into a lane registry. Union of parts and tokens; a bound that both sides state keeps the stricter value (higher floor, lower ceiling); the lane's strictSafe and positionable stay.
const tonum = (v) => { if (typeof v === 'number') return v; const m = /^(-?[\d.]+)(px|ms|s|rem)?$/.exec(String(v).trim()); if (!m) return NaN; return parseFloat(m[1]) * ({ px: 1, ms: 1, s: 1000, rem: 16 }[m[2] || ''] ?? 1); };
export function mergeRegistry(lane = {}) {
  const union = (a, b) => [...new Set([...(a ? [...a] : []), ...(b ? [...b] : [])])];
  const surfaces = [...(lane.surfaces || chat.CHAT_REGISTRY.surfaces)];
  for (const s of PATTERN_SURFACES) if (!surfaces.some((x) => x[0] === s[0] && x[1] === s[1])) surfaces.push(s);
  const mins = { ...(lane.minimums || {}) }; for (const [k, v] of Object.entries(PATTERN_MINIMUMS)) mins[k] = k in mins && tonum(mins[k]) > tonum(v) ? mins[k] : v;
  const maxs = { ...(lane.maximums || {}) }; for (const [k, v] of Object.entries(PATTERN_MAXIMUMS)) maxs[k] = k in maxs && tonum(maxs[k]) < tonum(v) ? maxs[k] : v;
  return {
    ...lane,
    critical: union(lane.critical, PATTERN_CRITICAL), safe: union(lane.safe, PATTERN_SAFE), reach: union(lane.reach, PATTERN_REACH), surfaces,
    settable: [...(lane.settable || []), ...PATTERN_SETTABLE], colours: [...(lane.colours || []), ...PATTERN_COLOURS], opaque: union(lane.opaque, PATTERN_OPAQUE), pairs: [...(lane.pairs || []), ...PATTERN_PAIRS],
    tokens: new Map([...PATTERN_FRAGMENT.tokens, ...(lane.tokens ? [...lane.tokens] : [])]),   // the lane's own values win on a shared name (a lane may alias a pattern token)
    minimums: mins, maximums: maxs,
  };
}

// ---- the supplement
const solve = (v, T, d = 0) => (d > 14 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (m, n, fb) => (T.has(n) ? solve(T.get(n), T, d + 1) : fb !== undefined ? solve(fb, T, d + 1) : m)));
const rgbOf = (s) => {
  s = s.trim().toLowerCase(); let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) { let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]); }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[\/,]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])];
  return null;
};
const lum1 = (c) => { const f = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const ratio = (a, b) => { const x = lum1(a), y = lum1(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const flat = (f, b) => (f[3] < 1 ? [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]) : f);
export const SEVERITY_MIN_DISTANCE = 60;   // proposal: Deep Nexus is 105 apart, Origin Navy 74, Banana Cocoa 88; shape and wording separate the levels too
export function patternSupplement(css) {
  const errs = []; const fail = (selector, prop, why) => errs.push({ selector, prop, why });
  const text = chat.normalise(css);
  for (const m of text.matchAll(/(?<![\w-])(url|image-set|image|src|element)\s*\(/g)) fail('(stylesheet)', m[1] + '()', `${m[1]}() loads or draws a resource: a pack carries none`);
  const T = new Map([...NEXUS_TOKENS, ...PATTERN_TOKENS]); const own = [];
  for (const d of decls(text)) { if (!d.prop.startsWith('--')) continue; own.push(d); if (d.ctx.selector.trim() === ':root') T.set(d.prop, d.value.replace(/\s*!important\s*$/, '').trim()); }
  for (const d of own) {
    if (/^--pm-/.test(d.prop)) fail(d.ctx.selector.trim(), d.prop, `${d.prop} is locked: the mode switches of motion.css decide reduced motion and low power, and a pack cannot turn them off`);
    if (/-shadow$/.test(d.prop)) {   // a shadow token is read by the critical sheet and toast: no length over 64 px (packlint.mjs globalBan, the same limit for a rule)
      const big = [...solve(d.value, T).matchAll(/(-?\d*\.?\d+)(px|rem|em|vw|vh)/g)].map((m) => Math.abs(parseFloat(m[1])) * ({ px: 1, rem: 16, em: 16, vw: 12.8, vh: 8 }[m[2]])).filter((n) => n > 64);
      if (big.length) fail(d.ctx.selector.trim(), d.prop, `a shadow of ${Math.max(...big)} px can cover what is around a protected surface (the limit is 64 px)`);
    }
    if (/ease/.test(d.prop)) {
      const v = solve(d.value.replace(/\s*!important\s*$/, '').trim(), T);
      const cb = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(v);
      if (cb) { const [x1, y1, x2, y2] = cb.slice(1).map(Number); if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1 || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) fail(d.ctx.selector.trim(), d.prop, `an easing that overshoots (${v}): every control value must stay in 0..1`); }
      else if (!/^(ease|ease-in|ease-out|ease-in-out|linear)$/.test(v)) fail(d.ctx.selector.trim(), d.prop, `an easing that cannot be checked (${v.slice(0, 40)})`);
    }
  }
  const col = (n, onto) => { const c = rgbOf(solve(T.get(n) || '', T)); return c ? flat(c, onto || [0, 0, 0, 1]) : null; };
  const sheet = col('--color-surface-sheet', col('--nexus-canvas')), acc = col('--nexus-accent', sheet), dng = col('--nexus-danger', sheet);
  const pair = (fg, bg, need, prop, what) => { if (!fg || !bg) { fail(':root', prop, `${what} cannot be checked (a colour that does not resolve)`); return; } const k = ratio(flat(fg, bg), bg); if (k < need) fail(':root', prop, `${what} would be ${k.toFixed(2)}:1 (needs ${need}:1)`); };
  pair(col('--pattern-on-accent', acc), acc, 4.5, '--pattern-on-accent', 'the label of a confirm button on the accent');
  pair(col('--pattern-on-danger', dng), dng, 4.5, '--pattern-on-danger', 'the label of a danger button on the danger fill');
  const track = col('--pattern-task-bar-track', sheet);
  pair(col('--pattern-task-bar-fill-to', sheet), track, 3, '--pattern-task-bar-fill-to', 'the bar fill against the track');
  pair(col('--pattern-task-bar-fail', sheet), track, 3, '--pattern-task-bar-fail', 'the failed fill against the track');
  // e. DD-256: the worst-case height of a sheet on a 360 x 640 phone (checks/sheet-height.mjs: the formula, the reference copy and the numbers)
  const hh = packHeights(css, chat.normalise);
  if (hh.unresolved.length) fail(':root', hh.unresolved[0], `a geometry value that cannot be resolved to px (${hh.unresolved.join(', ')}): the sheet height cannot be judged`);
  else if (hh.max > VIEW_H) fail(':root', '(sheet height)', `the worst-case sheet is ${hh.max} px tall at ${VIEW_W} x ${VIEW_H} (warning ${hh.warn}, task ${hh.task}, result ${hh.result}); its buttons would sit below the screen`);
  const cau = col('--pattern-warn-edge-caution', sheet), dgr = col('--pattern-warn-edge-danger', sheet);
  if (cau && dgr) { const dist = Math.hypot(cau[0] - dgr[0], cau[1] - dgr[1], cau[2] - dgr[2]); if (dist < SEVERITY_MIN_DISTANCE) fail(':root', '--pattern-warn-edge-caution', `caution and danger edges are only ${dist.toFixed(0)} apart in RGB (needs ${SEVERITY_MIN_DISTANCE}): a pack may not flatten the levels`); }
  return errs;
}
export function lintPattern(css, name = '', laneRegistry) {
  const r = chat.lintPack(css, name, mergeRegistry(laneRegistry)); const extra = patternSupplement(css);
  if (extra.length) { r.errors.push(...extra); r.ok = false; } return r;
}

if (process.argv[1] && process.argv[1].endsWith('registry.mjs')) {
  let bad = 0;
  for (const f of process.argv.slice(2)) { const r = lintPattern(fs.readFileSync(f, 'utf8'), f); console.log((r.ok ? 'OK       ' : 'REJECTED ') + f + (r.ok ? '' : '\n  ' + r.errors.map((e) => `${e.selector} { ${e.prop} }: ${e.why}`).join('\n  '))); if (!r.ok) bad++; }
  process.exit(bad ? 1 : 0);
}
