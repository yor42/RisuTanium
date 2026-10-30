// Fail-closed token pass of the shared pack-install validator (DD-242). Called by packlint.mjs lintPack with the normalised pack text and the effective registry.
//   1. ROLE TOKENS ONLY.   A pack may set a custom property only if it is on the pack-settable list: the shared names below, the registry's own `settable` list, any token the registry
//                          deliberately bounds (registry.minimums / registry.maximums, the value space of packlint.mjs). Every other name is rejected with "not a pack-settable token".
//   2. COLOURS RESOLVE.    Every value of a colour token (a --color-*, --nexus-* colour, a -rgb channel, or a token whose default is a colour) must resolve, in EVERY declaration the pack makes of it
//                          (:root, a root attribute, an @media block), to a concrete sRGB colour: hex, rgb(), hsl(), a named colour. color-mix(), oklch(), light-dark(), relative colours, currentcolor,
//                          inherit, unknown functions, an unresolved var() all fail. A fully transparent value fails too (a token whose default is transparent may stay transparent).
//   3. OPAQUE SURFACES.    registry.opaque (shared: the sheet and the toast) must resolve to alpha 1.
//   4. CONTRAST.           registry.pairs ([foreground token, background token, ratio, label]) and registry.surfaces are judged over the WORST CASE of every alternative the pack can produce.
//
// "Alternatives": every declaration of a token anywhere in the pack counts as a possible value; the app's own default counts only while no unconditional :root declaration replaces it.
// A var() chain is expanded through every alternative of every token on the way (as the minimums pass does).
import { decls } from './csslit.mjs';

// ---- the shared pack-settable names (colour roles, shared geometry, the Deep Nexus decoration hooks). Area role tokens come from the registry.
export const SHARED_SETTABLE = [
  /^--nexus-(?!animate-)[a-z0-9-]+$/,      // colours, channels, blur, touch size, focus ring pair, motion basics (the motion ones are bounded in SHARED_MINIMUMS / SHARED_MAXIMUMS of packlint.mjs)
  /^--color-(?!scheme$)[a-z0-9-]+$/,       // every colour role of chat, Settings and Studio
  '--color-scheme', '--font', '--mono', '--alpha-switch-off', '--radius-field', '--radius-sheet', '--radius-control', '--radius-popup',
];

// decorative colours a pack may switch off (the two canvas blooms: upstream's look has none). Everything else that is fully transparent is rejected; a registry adds its own decorative names in `transparentOk`.
export const SHARED_TRANSPARENT_OK = ['--nexus-canvas-bloom', '--nexus-canvas-warm'];

const escapeRe =(s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toRe = (x) => (x instanceof RegExp ? x : new RegExp('^' + escapeRe(x) + '$'));
export function makeMatcher(list) { const res = (list || []).map(toRe); return (n) => res.some((r) => r.test(n)); }

// ---- colours
const NAMED = Object.fromEntries('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32'.split(' ').map((x) => x.split(':')));
const clamp255 = (x) => Math.max(0, Math.min(255, x));
function hsl2rgb(h, s, l) { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
const chan = (s) => { s = s.trim(); if (/^[\d.]+%$/.test(s)) return clamp255(parseFloat(s) * 2.55); if (/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/.test(s)) return clamp255(parseFloat(s)); return NaN; };
const alphaOf = (s) => { if (s === undefined) return 1; s = s.trim(); if (/^[\d.]+%$/.test(s)) return Math.max(0, Math.min(1, parseFloat(s) / 100)); if (/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/.test(s)) return Math.max(0, Math.min(1, parseFloat(s))); return NaN; };
// -> [r, g, b, a] or null (not a concrete sRGB colour)
export function parseConcrete(s) {
  s = String(s).trim().toLowerCase().replace(/\s*!important$/, ''); if (!s) return null;
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = /^#([0-9a-f]+)$/.exec(s); if (m) { let h = m[1]; if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join(''); if (h.length !== 6 && h.length !== 8) return null; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat([h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]); }
  m = /^(rgba?)\(\s*([^()]*)\)$/.exec(s);
  if (m) {
    const body = m[2].trim(); let main = body, a;
    if (body.includes('/')) { const [x, y] = body.split('/'); main = x; a = y; }
    const parts = main.trim().split(/[\s,]+/).filter(Boolean);
    if (!body.includes('/') && parts.length === 4) a = parts.pop();
    if (parts.length !== 3) return null;
    const c = parts.map(chan); const al = alphaOf(a); if (c.some(Number.isNaN) || Number.isNaN(al)) return null; return [...c, al];
  }
  m = /^(hsla?)\(\s*([^()]*)\)$/.exec(s);
  if (m) {
    const body = m[2].trim(); let main = body, a;
    if (body.includes('/')) { const [x, y] = body.split('/'); main = x; a = y; }
    const parts = main.trim().split(/[\s,]+/).filter(Boolean);
    if (!body.includes('/') && parts.length === 4) a = parts.pop();
    if (parts.length !== 3) return null;
    const h = /^[+-]?\d*\.?\d+(deg)?$/.exec(parts[0]); const sat = /^([\d.]+)%$/.exec(parts[1]), lig = /^([\d.]+)%$/.exec(parts[2]); const al = alphaOf(a);
    if (!h || !sat || !lig || Number.isNaN(al)) return null; return [...hsl2rgb(parseFloat(h[0]), Math.min(100, +sat[1]), Math.min(100, +lig[1])), al];
  }
  if (NAMED[s]) return parseConcrete('#' + NAMED[s]);
  return null;
}
// a channel triple "r g b" or "r, g, b" (the value of a -rgb token)
export function parseTriple(s) {
  s = String(s).trim().toLowerCase().replace(/\s*!important$/, ''); const p = s.split(/[\s,]+/).filter(Boolean); if (p.length !== 3) return null;
  const c = p.map((x) => (/^[+-]?\d*\.?\d+$/.test(x) ? parseFloat(x) : NaN)); if (c.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return null; return [...c, 1];
}
const lum = (c) => { const f = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
const flat = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]);
export const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/;
// DD-258: a pack may keep private helper variables under ONE prefix (--pack-). They are INLINED before anything is judged: every var(--pack-x) in the pack is replaced by each value the variable is
// declared with anywhere in the pack (:root, a root attribute, an @media block, other private variables it chains through), the private declarations are dropped, and the whole stylesheet is linted once per
// combination. A private variable therefore cannot carry a value past a floor, a ceiling, a colour, a contrast or an allowlist rule: what reaches a role token or a property is what is judged.
// Returns { variants: [normalised text...], error? }. No private declaration and no private use: the text itself, once.
export function inlinePrivate(text, prefix, limit = 256) {
  const PV = new RegExp('var\\(\\s*(' + escapeRe(prefix) + '[\\w-]+)\\s*(?:,\\s*((?:[^()]|\\([^()]*\\))*))?\\)', 'g');
  const ds = decls(text).filter((d) => d.prop.startsWith(prefix) && !d.ctx.keyframes);
  if (!ds.length && !PV.test(text)) return { variants: [text] };
  PV.lastIndex = 0;
  const raw = new Map(); for (const d of ds) { if (!raw.has(d.prop)) raw.set(d.prop, []); raw.get(d.prop).push(d.value.replace(/\s*!important\s*$/, '').trim()); }
  const memo = new Map();
  const expandStr = (v, depth, stack) => {   // all strings v can be with private variables replaced; null on a cycle or when there are too many
    if (depth > 20) return null; const m = new RegExp(PV.source).exec(v); if (!m) return [v];
    let opts = raw.has(m[1]) ? valuesOf(m[1], depth + 1, stack) : (m[2] !== undefined ? expandStr(m[2].trim(), depth + 1, stack) : [`var(${m[1]})`]);
    if (opts === null) return null; const out = [];
    for (const o of opts) { const rest = expandStr(v.slice(0, m.index) + o.replace(/var\(/g, 'var\u0000(') + v.slice(m.index + m[0].length), depth + 1, stack); if (rest === null) return null; out.push(...rest); if (out.length > limit) return null; }
    return [...new Set(out)].map((s) => s.replace(/var\u0000\(/g, 'var('));
  };
  const valuesOf = (n, depth, stack) => {
    if (memo.has(n)) return memo.get(n); if (stack.includes(n)) return null;
    const out = []; for (const r of raw.get(n)) { const xs = expandStr(r, depth, [...stack, n]); if (xs === null) return null; out.push(...xs); }
    const u = [...new Set(out)]; memo.set(n, u); return u;
  };
  const names = new Set([...raw.keys()]); for (const m of text.matchAll(PV)) names.add(m[1]);
  const alts = new Map(); for (const n of names) { if (!raw.has(n)) continue; const v = valuesOf(n, 0, []); if (v === null) return { variants: [text], error: `${n} chains through private variables without end or has too many values` }; alts.set(n, v); }
  // drop the private declarations (blank them out, keeping offsets)
  let base = text; for (const d of [...ds].sort((a, b) => b.vs - a.vs)) { const s = base.lastIndexOf(d.prop, d.vs); base = base.slice(0, s) + ' '.repeat(d.ve - s) + base.slice(d.ve); }
  const multi = [...alts].filter(([, v]) => v.length > 1).map(([n]) => n); let combos = [new Map()];
  for (const n of multi) { const next = []; for (const c of combos) for (const v of alts.get(n)) next.push(new Map(c).set(n, v)); combos = next; if (combos.length > limit) return { variants: [text], error: `more than ${limit} combinations of private variable values` }; }
  const variants = combos.map((c) => base.replace(PV, (m, n, fb) => (c.has(n) ? c.get(n) : alts.has(n) ? alts.get(n)[0] : fb !== undefined ? fb.trim() : m)));
  // a value that still names a private variable (declared nowhere, no fallback) stays as var(): it is invalid at use time and judged as such
  return { variants };
}

// is this custom property pack-settable under this (effective) registry? (the same test the pass uses)
export function settableTest(reg) {
  const settable = makeMatcher([...SHARED_SETTABLE, ...(reg.settable || [])]);
  const bounded = (n) => Object.prototype.hasOwnProperty.call(reg.minimums || {}, n) || Object.prototype.hasOwnProperty.call(reg.maximums || {}, n) || (reg.isBounded ? reg.isBounded(n) : false);
  const priv = reg.privatePrefix ? (n) => n.startsWith(reg.privatePrefix) : () => false;
  return (n) => settable(n) || bounded(n) || priv(n);
}
export function failClosedPass(text, reg) {
  const errs = []; const fail = (selector, prop, why) => errs.push({ selector, prop, why });
  const ds = decls(text).filter((d) => d.prop.startsWith('--') && !d.ctx.keyframes);
  const app = reg.app || new Map();
  const transparentOk = makeMatcher([...SHARED_TRANSPARENT_OK, ...(reg.transparentOk || [])]);
  const isSettable = settableTest(reg);

  // 1. role tokens only
  const seen = new Set();
  for (const d of ds) {
    if (seen.has(d.prop)) continue; seen.add(d.prop);
    if (!isSettable(d.prop)) fail(d.ctx.selector.trim() || '(no selector)', d.prop, `${d.prop} is not a pack-settable token (a pack may set only the role tokens its registry lists: shared colour and role names, the area's role tokens, and tokens the area bounds with a floor or a ceiling)`);
  }

  // ---- alternatives of a token
  const byName = new Map(); for (const d of ds) { const v = d.value.replace(/\s*!important\s*$/, '').trim(); if (!byName.has(d.prop)) byName.set(d.prop, []); byName.get(d.prop).push({ v, sel: d.ctx.selector.trim(), cond: d.ctx.at.length > 0 }); }
  const unconditional = (n) => (byName.get(n) || []).some((x) => !x.cond && /^(:root|html)$/.test(x.sel));
  const raws = (n) => { const out = (byName.get(n) || []).map((x) => x.v); if (app.has(n) && !unconditional(n)) out.push(app.get(n)); return out; };
  const LIMIT = 512;
  function expand(v, depth) {   // every string v can take with its var() calls substituted; null if something cannot be resolved or there are too many
    if (depth > 14) return null; const m = VAR.exec(v); if (!m) return [v];
    let opts = raws(m[1]).flatMap((x) => expand(x, depth + 1) ?? [null]);
    if (!opts.length) { if (m[2] === undefined) return null; opts = expand(m[2].trim(), depth + 1) ?? [null]; }
    if (opts.some((o) => o === null)) return null;
    opts = [...new Set(opts)]; const out = [];
    for (const o of opts) { const r = expand(v.slice(0, m.index) + o + v.slice(m.index + m[0].length), depth + 1); if (r === null) return null; out.push(...r); if (out.length > LIMIT) return null; }
    return [...new Set(out)];
  }
  const colAlts = (n) => {   // -> { cols: [[r,g,b,a]...], bad: [string...] } for a colour or channel token (name decides which)
    const cols = [], bad = []; const channel = /-rgb$/.test(n) || (app.has(n) && parseTriple(expand(app.get(n), 0)?.[0] ?? '') && !parseConcrete(expand(app.get(n), 0)?.[0] ?? ''));
    for (const r of raws(n)) { const xs = expand(r, 0); if (xs === null) { bad.push(r); continue; } for (const x of xs) { const c = channel ? parseTriple(x) : parseConcrete(x); if (c) cols.push(c); else bad.push(x); } }
    return { cols, bad, channel };
  };
  const NAME_COLOUR = /^--(color-(?!scheme$)|nexus-(canvas|surface|edge|field-border|text|accent|ring|core|warm|danger|network|overlay|shade|warning|success))/;
  const extraColour = makeMatcher(reg.colours);
  const isColourToken = (n) => {
    if (n === '--color-scheme') return false;
    if (/-rgb$/.test(n) || NAME_COLOUR.test(n) || extraColour(n)) return true;
    if (!app.has(n)) return false; const xs = expand(app.get(n), 0); return !!xs && xs.length > 0 && xs.every((x) => !!parseConcrete(x) || !!parseTriple(x));
  };
  const defaultTransparent = (n) => { if (!app.has(n)) return false; const xs = expand(app.get(n), 0); return !!xs && xs.some((x) => { const c = parseConcrete(x); return c && c[3] === 0; }); };
  const selOf = (n) => (byName.get(n) || [{ sel: ':root' }])[0].sel || ':root';

  // 2. colours resolve; 3. opaque surfaces
  const opaque = new Set(reg.opaque || []);
  const checked = new Set([...byName.keys()].filter((n) => isSettable(n) && isColourToken(n)));
  for (const n of opaque) checked.add(n);
  for (const n of checked) {
    const { cols, bad, channel } = colAlts(n);
    if (n === '--color-scheme') continue;
    if (bad.length) { fail(selOf(n), n, `${n}: ${channel ? 'a colour channel that is not three numbers from 0 to 255' : 'a colour that cannot be resolved to a concrete sRGB colour (hex, rgb(), hsl() or a named colour)'}: ${bad[0].slice(0, 50)}`); continue; }
    if (!channel && cols.some((c) => c[3] === 0) && !defaultTransparent(n) && !transparentOk(n)) { fail(selOf(n), n, `${n}: a fully transparent colour (the token would draw nothing)`); continue; }
    if (opaque.has(n) && cols.some((c) => c[3] < 1 - 1e-9)) fail(selOf(n), n, `${n}: a protected surface must resolve to an opaque colour (alpha 1), not ${cols.find((c) => c[3] < 1).map((x, i) => (i < 3 ? Math.round(x) : +x.toFixed(2))).join(' ')}`);
  }
  if (byName.has('--color-scheme')) for (const x of byName.get('--color-scheme')) if (!/^(light|dark)$/.test(x.v)) fail(x.sel, '--color-scheme', '--color-scheme must be light or dark');

  // 4. contrast over the worst case: pairs [foreground, background, ratio, label] (token on token) and surfaces [token, surfaceKey, label, ratio]
  const canvasCols = () => { const r = colAlts('--nexus-canvas').cols; return r.length ? r : [[0, 1, 28, 1]]; };
  const surfAlts = (key) => {   // -> colours (alpha 1) a surface can have; glass layers are flattened onto every canvas
    const tok = { canvas: '--nexus-canvas', sheet: '--color-surface-sheet', toast: '--color-surface-toast', glass: '--nexus-surface', raised: '--nexus-surface-raised' }[key]; if (!tok) return [];
    const base = colAlts(tok).cols; if (key === 'canvas' || key === 'sheet' || key === 'toast') return base.map((c) => (c[3] < 1 ? flat(c, canvasCols()[0]) : c));
    const out = []; for (const cv of canvasCols()) for (const g of base) out.push(flat(g, cv)); return out;
  };
  const judged = new Set();
  const judge = (fgTok, bgCols, need, label, bgName) => {
    const key = fgTok + '|' + bgName + '|' + need; if (judged.has(key)) return; judged.add(key);
    const { cols: fgs, bad } = colAlts(fgTok); if (bad.length || !fgs.length || !bgCols.length) return;   // an unresolvable colour is reported above
    let worst = Infinity;
    for (const bg of bgCols) for (const fg of fgs) { const r = ratio(fg[3] < 1 ? flat(fg, bg) : fg, bg); if (r < worst) worst = r; }
    if (worst < need - 1e-9) fail(selOf(fgTok), fgTok, `${fgTok.replace('--', '')} would be ${worst.toFixed(2)}:1 on ${label} (needs ${need}:1), judged over the worst case of everything the pack sets`);
  };
  // registry.same: [[channel token, colour token, label]]: a channel that stands for a colour (--studio-canvas-rgb for --nexus-canvas) must be that colour in every case (within 8 per channel), so a tint drawn from it cannot disagree with the surface
  for (const [chanTok, colTok, label] of reg.same || []) {
    const a = colAlts(chanTok).cols, b = colAlts(colTok).cols; let bad = null;
    for (const x of a) for (const y of b) if ([0, 1, 2].some((i) => Math.abs(x[i] - y[i]) > 8)) bad = [x, y];
    if (bad) fail(selOf(chanTok), chanTok, `${chanTok} (${bad[0].slice(0, 3).map(Math.round).join(' ')}) is not the colour of ${colTok} (${bad[1].slice(0, 3).map(Math.round).join(' ')}): ${label || 'the channel must stand for the same colour'}`);
  }
  for (const [fg, bg, need, label] of reg.pairs || []) judge(fg, bg.startsWith('--') ? (() => { const c = colAlts(bg).cols; return c.map((x) => (x[3] < 1 ? flat(x, canvasCols()[0]) : x)); })() : surfAlts(bg), need, label || bg, bg);
  for (const [tok, key, label, need] of reg.surfaces || []) judge(tok, surfAlts(key), need, label, 'surface:' + key);
  return errs;
}
