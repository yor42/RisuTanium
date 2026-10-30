// Geometry rules of the shared pack-install validator (DD-256, DD-260). Called by packlint.mjs lintPack with the normalised, private-variable-free pack text and the effective registry.
//   1. ANCESTOR PADDING (DD-260, Studio review M3). registry.chains: [{ name, parts: [outer ... inner], budget }]. The horizontal padding and border a pack gives the parts of one chain are SUMMED in the worst case
//      (for each part the largest left + right it gives in any rule); the sum may not exceed the budget (default 120 px: a 360 px phone keeps 240 px for the protected block inside).
//   2. SHEET HEIGHT (DD-256). registry.sheets: [{ name, terms }]. A protected sheet's height at 360 px wide is estimated from the geometry tokens it reads, each at the LARGEST value the pack can give it
//      (every :root, root-attribute and @media alternative; the app default while no unconditional :root declaration replaces it). It may not exceed 640 px (a 360x640 phone), so a pack whose every size is
//      inside its own ceiling but whose sum pushes the buttons off the screen is rejected.
//      terms: { px } a constant; { t: token, n } n times a token; { text: { chars, size: token, lead, hpad: [tokens], hfixed } } a block of text, wrapped at 360 - 2 * (hpad tokens) - hfixed with 1 em per character (Korean). The pattern sheets use their own calibrated model, patterns/checks/sheet-height.mjs, applied by lintPattern.
//      The estimate is a model of the DOM (not a measurement): it is an upper bound built from the part list and token reads, to be calibrated against a browser per area.
import { decls } from './csslit.mjs';
// Same text model as patterns/checks/sheet-height.mjs (DD-256 builder, calibrated there against rendered sheets): a Korean glyph is 1 em wide, lines = ceil(chars / floor(width / size)).
const VIEW_W = 360, VIEW_H = 640, CHAR_EM = 1;
const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/;
const num = (s) => { s = String(s).trim(); let m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(s); if (m) return parseFloat(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1); m = /^calc\((.*)\)$/.exec(s); if (m) { const e = m[1].replace(/(-?\d*\.?\d+)(px|rem|em)\b/g, (x, n, u) => String(parseFloat(n) * (u === 'px' ? 1 : 16))); if (/^[\d.\s+\-*\/()]+$/.test(e)) { try { return Function(`return (${e})`)(); } catch { return NaN; } } } return NaN; };

export function geometryPass(text, reg) {
  const errs = []; const fail = (selector, prop, why) => errs.push({ selector, prop, why });
  const all = decls(text).filter((d) => !d.ctx.keyframes);
  const app = reg.app || new Map();
  const byName = new Map(); for (const d of all) if (d.prop.startsWith('--')) { if (!byName.has(d.prop)) byName.set(d.prop, []); byName.get(d.prop).push({ v: d.value.replace(/\s*!important\s*$/, '').trim(), cond: d.ctx.at.length > 0 || !/^(:root|html)$/.test(d.ctx.selector.trim()) }); }
  const raws = (n) => { const out = (byName.get(n) || []).map((x) => x.v); if (app.has(n) && !(byName.get(n) || []).some((x) => !x.cond)) out.push(app.get(n)); return out; };
  const expand = (v, depth) => { if (depth > 14) return null; const m = VAR.exec(v); if (!m) return [v]; let opts = raws(m[1]).flatMap((x) => expand(x, depth + 1) ?? [null]); if (!opts.length) { if (m[2] === undefined) return null; opts = expand(m[2].trim(), depth + 1) ?? [null]; } if (opts.some((o) => o === null)) return null; const out = []; for (const o of [...new Set(opts)]) { const r = expand(v.slice(0, m.index) + o + v.slice(m.index + m[0].length), depth + 1); if (r === null) return null; out.push(...r); if (out.length > 256) return null; } return [...new Set(out)]; };
  const worst = (tok) => { let w = 0; for (const r of raws(tok)) { const xs = expand(r, 0); if (xs === null) return NaN; for (const x of xs) { const n = num(x); if (Number.isNaN(n)) return NaN; if (n > w) w = n; } } return w; };

  // 1. ancestor padding summed along a chain
  const lens = (v) => { const r = []; for (const x of v.trim().split(/\s+/)) { const n = num(x.replace(/!important/, '')); r.push(Number.isNaN(n) ? (/%/.test(x) ? 0.2 * VIEW_W : 0) : n); } return r; };
  const partsOf = (sel) => [...(sel.trim().split(/[\s>+~]+/).pop() || '').matchAll(/\[data-part="([^"\]]*)"\]/g)].map((m) => m[1]);
  const resolveVars = (v) => { const xs = expand(v, 0); return xs && xs.length ? xs : [v]; };
  const inset = (block) => {   // largest horizontal padding + border width a rule gives, over the alternatives of its var()s
    let best = 0; const val = (p) => block.get(p);
    const cands = []; const sh = val('padding'); if (sh) for (const x of resolveVars(sh)) { const l = lens(x); const [t, r, b, lft] = [l[0], l[1] ?? l[0], l[2] ?? l[0], l[3] ?? l[1] ?? l[0]]; void t; void b; cands.push(r + lft); }
    const side = (p) => { const v = val(p); return v ? Math.max(...resolveVars(v).map((x) => lens(x)[0] || 0)) : 0; };
    const pl = Math.max(side('padding-left'), side('padding-inline-start'), side('padding-inline') ), pr = Math.max(side('padding-right'), side('padding-inline-end'), side('padding-inline'));
    cands.push(pl + pr); const bw = (() => { const v = val('border') || val('border-width') || val('border-left-width') || val('border-right-width'); return v ? Math.max(...resolveVars(v).map((x) => lens(x)[0] || 0)) * 2 : 0; })();
    for (const c of cands) best = Math.max(best, c); return best + bw;
  };
  const hasInset = (block) => ['padding', 'padding-left', 'padding-right', 'padding-inline', 'padding-inline-start', 'padding-inline-end', 'border', 'border-width', 'border-left-width', 'border-right-width'].some((p) => block.has(p));
  const blocks = new Map(); for (const d of all) { if (d.prop.startsWith('--')) continue; const k = d.ctx.selector.trim(); if (!blocks.has(k)) blocks.set(k, new Map()); blocks.get(k).set(d.prop, d.value.trim()); }
  for (const ch of reg.chains || []) {
    // each part has the inset the page gives it (ch.defaults, measured in the DOM); a pack rule that states a horizontal padding or border for the part replaces it (the largest such value counts)
    const per = new Map(ch.parts.map((p) => [p, (ch.defaults || {})[p] || 0])); const packSet = new Map();
    for (const [sel, block] of blocks) for (const s of sel.split(',')) { const ps = partsOf(s); if (!hasInset(block)) continue; const i = inset(block); for (const p of ps) if (per.has(p) && i > (packSet.get(p) ?? -1)) packSet.set(p, i); }
    for (const [p, v] of packSet) per.set(p, v);
    const sum = [...per.values()].reduce((a, b) => a + b, 0), budget = ch.budget ?? 120;
    if (sum > budget) fail(ch.parts.filter((p) => per.get(p) > 0).map((p) => `[data-part="${p}"]`).join(' '), 'padding', `ancestor padding along ${ch.name} sums to ${Math.round(sum)} px of ${VIEW_W} (${[...per].filter(([, v]) => v).map(([p, v]) => p + ' ' + Math.round(v)).join(', ')}): over the ${budget} px budget that keeps ${ch.minInner ?? 240} px for the protected block on a phone (DD-260)`);
  }

  // 2. the worst-case height of each protected sheet
  //    A sheet that SCROLLS (every sheet and dialog of chat, Settings, Studio and Home does: max-height with an overflow scroller, measured in theme/checks/measure) is described by { name, terms, cap, fixed, minScroll }:
  //    `terms` the content estimate (an upper bound, calibrated against rendered pages, reported); `cap` the most the page lets it grow (px); `fixed` the terms that do not scroll (the grab bar and title, the padding outside the scroller).
  //    Its actions stay reachable by scrolling, so what a pack can break is the room left for the scroller: fixed + minScroll (one action row and its padding, default 96 px) must fit under the cap. A sheet with no cap is
  //    judged on its whole height (the pattern sheets do not scroll).
  const sum = (terms, onBad) => {
    let h = 0;
    for (const t of terms) {
      if (t.px !== undefined) { h += t.px; continue; }
      if (t.t) { const w = worst(t.t); if (Number.isNaN(w)) { onBad(t.t); return null; } h += (t.n ?? 1) * w; continue; }
      if (t.text) { const s = worst(t.text.size); if (Number.isNaN(s)) { onBad(t.text.size); return null; } let hp = t.text.hfixed || 0; for (const k of t.text.hpad || []) { const w = worst(k); if (Number.isNaN(w)) { onBad(k); return null; } hp += 2 * w; } const width = Math.max(40, VIEW_W - hp); const lines = Math.ceil(t.text.chars / Math.max(1, Math.floor(width / (s * CHAR_EM)))); h += lines * s * (t.text.lead ?? 1.4); }
    }
    return h;
  };
  for (const sh of reg.sheets || []) {
    let bad = null; const content = sum(sh.terms, (b) => { bad = b; });
    if (bad || content === null) { fail(':root', bad || sh.name, `${sh.name}: the height of the sheet cannot be judged (${bad} does not resolve to a length); a protected sheet must fit a ${VIEW_W}x${VIEW_H} phone (DD-256)`); continue; }
    if (sh.cap) {
      const fixed = sh.fixed ? sum(sh.fixed, (b) => { bad = b; }) : 0;
      if (bad || fixed === null) { fail(':root', bad || sh.name, `${sh.name}: the fixed part of the sheet cannot be judged (${bad})`); continue; }
      (errs.heights ||= []).push([sh.name, Math.round(content), Math.round(Math.min(content, sh.cap)), Math.round(fixed)]);
      if (fixed + (sh.minScroll ?? 96) > sh.cap) fail(':root', sh.name, `${sh.name}: with every size at the largest value this pack gives it, the part of the sheet that does not scroll is about ${Math.round(fixed)} px and leaves no room for the scrolling actions under the ${Math.round(sh.cap)} px the page allows (DD-256)`);
      continue;
    }
    (errs.heights ||= []).push([sh.name, Math.round(content)]);
    if (content > VIEW_H) fail(':root', sh.name, `${sh.name}: with every size at the largest value this pack gives it, the sheet is about ${Math.round(content)} px tall and does not fit a ${VIEW_W}x${VIEW_H} phone (${VIEW_H} px): its buttons would leave the screen (DD-256)`);
  }
  return errs;
}
// the height model of a sheet at the values a pack gives (used by the regression suite to report the margin)
export function sheetHeights(text, reg) { return geometryPass(text, reg).heights || []; }
