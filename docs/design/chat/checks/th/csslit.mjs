// Chat theme-readiness: a small CSS walker and the literal classifier (THEMING.md rule 1, DD-143).
//   decls(css)            -> [{ prop, value, vs, ve, ctx }]   every declaration with the offsets of its value (css.slice(vs, ve) === value)
//   classify(decl)        -> [{ kind, lit }]                  the disallowed literals of one declaration
// Every property is judged (no property is exempt by name). Allowed literals, exactly:
//   0 / 0px, 1px hairlines, percentages used for layout math, unitless 1, keywords (transparent, currentColor, none, auto, inherit ...), steps() timing,
//   counts and stacking that are not measures (z-index, order, flex grow/shrink integers, line-clamp, grid fr), system colours inside @media (forced-colors),
//   anything inside url(...) / strings / env(), and the definitions inside a token block (:root custom properties in theme-tokens.css and in theme packs).
// Judged: colour (hex, rgb/hsl/hwb/lab/lch/oklab/oklch/color-mix/color(), any named colour except system colours, in every property including custom properties in
// component rules), every length and angle unit (px rem em ch ex vh vw vmin vmax pt cm mm in deg turn rad), durations, easing keywords and cubic-bezier,
// unitless opacity / dash / scale / aspect-ratio / filter amounts, font weight and unitless line height, and px fallbacks inside var().
const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const NAMED_RE = new RegExp('(?<![\\w-])(' + NAMED.join('|') + ')(?![\\w-])', 'i');
const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-.*|outline|outline-color|fill|stroke|box-shadow|text-shadow|caret-color|column-rule)$/;

// ---- walker ----
export function decls(css0) {
  const css = css0.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')); const out = []; const stack = []; // block kinds: 'rule' | 'container' | 'keyframes' | 'other'
  let i = 0, segStart = 0, depth = 0; const n = css.length;
  const ctxNow = () => ({ forced: stack.some((b) => b.forced), keyframes: stack.some((b) => b.kind === 'keyframes'), selector: [...stack].reverse().find((b) => b.kind === 'rule')?.prelude || '', at: stack.filter((b) => b.prelude.startsWith('@')).map((b) => b.prelude) });
  const cur = () => stack[stack.length - 1];
  const emit = (a, b) => {
    const seg = css.slice(a, b); const m = /^(\s*)([-\w]+)\s*:/.exec(seg); if (!m) return;
    const vs0 = a + m[0].length; let vs = vs0, ve = b; while (/\s/.test(css[vs])) vs++; while (ve > vs && /\s/.test(css[ve - 1])) ve--;
    out.push({ prop: m[2].toLowerCase(), value: css.slice(vs, ve), vs, ve, ctx: ctxNow() });
  };
  while (i < n) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; if (segStart === i) segStart = end; else { /* comment inside a segment: keep it in the segment text */ } i = end; continue; }
    if (ch === '"' || ch === "'") { let j = i + 1; while (j < n && css[j] !== ch) { if (css[j] === '\\') j++; j++; } i = j + 1; continue; }
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') { depth--; i++; continue; }
    if (depth > 0) { i++; continue; }
    if (ch === '{') {
      const prelude = css.slice(segStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      let kind = 'rule', forced = false;
      if (prelude.startsWith('@')) { const nm = /^@([-\w]+)/.exec(prelude)[1].toLowerCase(); kind = /keyframes$/.test(nm) ? 'keyframes' : /^(media|supports|layer|container|document)$/.test(nm) ? 'container' : 'other'; forced = nm === 'media' && /forced-colors\s*:\s*active/.test(prelude); }
      else if (cur() && cur().kind === 'keyframes') kind = 'frame';
      stack.push({ kind, prelude, forced }); segStart = i + 1; i++; continue;
    }
    if (ch === ';') { const b = cur(); if (b && b.kind !== 'container' && b.kind !== 'keyframes') emit(segStart, i); segStart = i + 1; i++; continue; }
    if (ch === '}') { const b = cur(); if (b && b.kind !== 'container' && b.kind !== 'keyframes') emit(segStart, i); stack.pop(); segStart = i + 1; i++; continue; }
    i++;
  }
  return out;
}

// strip url(...) bodies, strings and env(...) so their contents are not judged
export function bare(v) {
  let s = v.replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/gi, 'url()').replace(/"[^"]*"|'[^']*'/g, '""');
  s = s.replace(/env\(\s*[\w-]+\s*(?:,((?:[^()]|\([^()]*\))*))?\)/gi, (m, fb) => ' ' + (fb || '') + ' ');
  return s;
}
// remove var(--x) wrappers (keeping any fallback visible so a literal fallback is caught); returns the text with var(...) replaced by a marker
function noVar(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const m = /var\(/i.exec(s.slice(i)); if (!m) { out += s.slice(i); break; }
    out += s.slice(i, i + m.index); let j = i + m.index + 4, d = 1, comma = -1;
    while (j < s.length && d > 0) { if (s[j] === '(') d++; else if (s[j] === ')') d--; else if (s[j] === ',' && d === 1 && comma < 0) comma = j; j++; }
    out += 'VAR' + (comma >= 0 ? ' ' + s.slice(comma + 1, j - 1) + ' ' : ''); i = j;
  }
  return out;
}
const NUM = /(-?\d*\.?\d+)(px|rem|ms|s|%|em|ch|deg|vh|vw)?(?![\w.])/g;
const isZero = (x) => parseFloat(x) === 0;

const SYSTEM = /^(Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText)$/i;
const SYSTEM_RE = new RegExp('(?<![\\w-])(' + SYSTEM.source.slice(2, -2) + ')(?![\\w-])', 'gi');
const NO_COLOUR_NAMES = /^(font-family|font|content|animation-name|transition-property|grid-area|grid-template-areas|will-change|cursor|list-style|list-style-type|quotes|src|view-transition-name|counter-.*)$/;
// every unit CSS has (case-insensitive); fr, x, dppx and dpi are not lengths here
const LEN = /(?<![\w.-])(-?\d*\.?\d+)(px|rem|em|ch|ex|cap|ic|lh|rlh|vh|vw|vi|vb|vmin|vmax|[sld]?v[hwib]|[sld]?vmin|[sld]?vmax|cq[whib]|cqmin|cqmax|pt|pc|cm|mm|in|q|deg|turn|rad|grad)\b/gi;
const TIME = /(?<![\w.-])(-?\d*\.?\d+)(ms|s)\b/gi;
const COLOUR_FN = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(/gi;
const SIZE_KW = /(?<![\w-])(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|thin|thick)(?![\w-])/gi;
function kindOfLength(prop) {
  if (/^(font|font-size|line-height|letter-spacing|word-spacing)$/.test(prop)) return 'font';
  if (/radius$/.test(prop)) return 'radius';
  if (/^(padding|margin)|^(gap|row-gap|column-gap|grid-gap)$/.test(prop)) return 'spacing';
  if (/^(border|border-(top|right|bottom|left)|border-width|border-(top|right|bottom|left)-width|outline|outline-width|column-rule|stroke-width)$/.test(prop)) return 'stroke';
  if (/shadow$/.test(prop)) return 'shadow';
  if (/filter$/.test(prop)) return 'effect';
  return 'geometry';
}
export function classify(d) {
  const { prop, ctx } = d; const hits = []; const v0 = bare(d.value); const v = noVar(v0);
  const add = (kind, lit) => hits.push({ kind, lit });
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(v.trim())) return hits;
  const custom = prop.startsWith('--');
  // an embedded image is a bag of literal colours and sizes (DD-143): it is a token (--icon-mask-*)
  if (/url\(\s*["']?data:/i.test(d.value)) add('geometry', 'url(data:...)');
  // colours: every property
  for (const m of v.matchAll(COLOUR_FN)) add('colour', m[0]);
  if (!NO_COLOUR_NAMES.test(prop)) {
    for (const m of v.replace(/\b(?:rgba?|hsla?)\([^)]*\)/gi, '').matchAll(new RegExp(NAMED_RE.source, 'gi'))) add('colour', m[0]);
    if (!ctx.forced) for (const m of v.matchAll(SYSTEM_RE)) add('colour', m[0] + ' (a system colour outside forced-colors)');
  }
  // lengths and angles: every property, 1px allowed
  for (const m of v.matchAll(LEN)) { const x = parseFloat(m[1]); if (x === 0 || (m[2].toLowerCase() === 'px' && Math.abs(x) === 1)) continue; add(kindOfLength(prop), m[0]); }
  // keyword sizes
  if (/^(font-size|border|border-width|border-(top|right|bottom|left)(-width)?|outline|outline-width|column-rule)$/.test(prop)) { for (const m of v.matchAll(SIZE_KW)) add(kindOfLength(prop), m[0]); if (prop !== 'font-size') for (const m of v.matchAll(/(?<![\w-])medium(?![\w-])/gi)) add('stroke', m[0]); }
  // time and easing
  for (const m of v.matchAll(TIME)) { if (parseFloat(m[1]) !== 0) add('motion', m[0]); }
  for (const m of v.matchAll(/cubic-bezier\([^)]*\)/gi)) add('motion', m[0]);
  if (/^(transition|transition-timing-function|animation|animation-timing-function)$/.test(prop)) for (const m of v.matchAll(/(?<![\w-])(linear|ease|ease-in|ease-out|ease-in-out)(?![\w-])/gi)) add('motion', m[0]);
  // percentages that are not layout: gradient stops and opacity
  for (const g of v.matchAll(/(?:linear|radial|conic|repeating-linear|repeating-radial|repeating-conic)-gradient\(((?:[^()]|\([^()]*\))*)\)/gi)) for (const m of g[1].matchAll(/(?<![\w.-])(\d*\.?\d+)%/g)) if (parseFloat(m[1]) !== 0 && parseFloat(m[1]) !== 100) add('geometry', m[0] + ' (a gradient stop)');
  if (custom) return hits;
  // type
  if (prop === 'font-family') { if (!/VAR/.test(v)) add('font', v.trim()); }
  else if (prop === 'font') { const r = v.replace(/VAR[^,;]*/g, ' ').replace(/\binherit\b/gi, ' '); if (/\d|\b(italic|oblique|bold|bolder|lighter|small-caps)\b/i.test(r)) add('font', v.trim()); else if (!/VAR|inherit/.test(v)) add('font', v.trim()); }
  else if (prop === 'font-weight') { if (/\d|bold|bolder|lighter/i.test(v.replace(/VAR/g, ' '))) add('font', v.trim()); }
  else if (prop === 'line-height') { if (/\d/.test(v.replace(/VAR/g, ' ')) && v.trim() !== '1') add('font', v.trim()); }
  else if (/^font-(variation|feature)-settings$/.test(prop)) { if (/\d/.test(v.replace(/VAR/g, ' ').replace(/"[^"]*"/g, ' '))) add('font', v.trim()); }
  // unitless amounts
  if (/^(opacity|fill-opacity|stroke-opacity|flood-opacity|stop-opacity)$/.test(prop)) { for (const m of v.matchAll(/(?<![\w.-])(\d*\.\d+|\d+)(%?)(?![\w.])/g)) { const x = parseFloat(m[1]) / (m[2] ? 100 : 1); if (x !== 0 && x !== 1) add('effect', m[0]); } }
  if (/^(stroke-width)$/.test(prop) && /^[\d.]+$/.test(v.trim()) && parseFloat(v) !== 1) add('stroke', v.trim());
  if (/^(stroke-dasharray|stroke-dashoffset)$/.test(prop) && /\d/.test(v) && !/VAR/.test(v)) add('geometry', v.trim());
  if (prop === 'aspect-ratio' && !/VAR/.test(v) && /\d/.test(v)) add('geometry', v.trim());
  for (const m of v.matchAll(/scale(?:3d|X|Y)?\(([^)]*)\)/gi)) for (const n of m[1].matchAll(/(?<![\w.-])(\d*\.\d+|\d+)(?![\w.%])/g)) if (parseFloat(n[1]) !== 1 && parseFloat(n[1]) !== 0) add('geometry', m[0]);
  if (prop === 'scale' && /\d/.test(v) && !/VAR/.test(v) && v.trim() !== '1') add('geometry', v.trim());
  if (/filter$/.test(prop)) for (const m of v.matchAll(/(brightness|contrast|saturate|grayscale|sepia|invert|opacity)\(([^)]*)\)/gi)) { const x = parseFloat(m[2]); if (!/VAR/.test(m[2]) && x !== 0 && x !== 1) add('effect', m[0]); }
  if (/^(border-image|-webkit-mask-box-image)/.test(prop) && !/VAR|none/.test(v)) add('geometry', v.trim());
  return hits;
}
export function scan(css, file = '') {
  const res = []; const lines = css.split('\n'); const starts = []; let o = 0; for (const l of lines) { starts.push(o); o += l.length + 1; }
  const lineOf = (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; } return lo + 1; };
  for (const d of decls(css)) { for (const h of classify(d)) res.push({ file, line: lineOf(d.vs), prop: d.prop, kind: h.kind, lit: h.lit, sel: d.ctx.selector.slice(0, 60) }); }
  return res;
}