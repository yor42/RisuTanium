// DD-256: the worst-case height of a pattern sheet on a phone, computed from the geometry tokens, so a legal pack cannot push the buttons below the screen.
//   node sheet-height.mjs            prints the formula, the reference copy and the numbers (default, both packs, every geometry token at its ceiling)
//   worstCaseHeights(T)              T(name) -> px (or a unitless leading); returns { warn, task, result, max } in px
//   packHeights(css)                 the same for a pack: each token takes its LARGEST value anywhere in the pack (every selector, every @media block) or its default; the model is monotone in every token
//                                    (a bigger token never makes a sheet shorter), so the largest value of each is the worst case
//   RULE: max(warn, task, result) <= VIEW_H (640) at VIEW_W (360).
// The model is the grid of pattern.css, with these stated assumptions (each one is a constant below, so the lint builder can change it):
//   a Korean glyph is 1 em wide (a Latin one about half, so English wraps less); lines = ceil(characters / floor(width / (font size * GLYPH)));
//   the reference copy is what DD-257 and spec 3.1 allow: a headline of 36 characters, three bullets of 40, three skipped rows of 36 + the reason, a title of 36;
//   the tallest action layout is three stacked actions on a warning, two rows on a card; a detail toggle and the acknowledgment are both present.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decls } from '../../chat/checks/th/csslit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
export const VIEW_W = 360, VIEW_H = 640, GLYPH = 1;
// Calibrated against the rendered sheets at 360 x 640 touch, Korean (checks/measure-heights.mjs, 2026-10-28): warning with detail open 464 px (model 466), running card 282 (model 362), import result with skips 541 (model below).
export const COPY = { headline: 36, bullets: 3, bullet: 40, title: 30, resultHeadline: 24, summaryLines: 1, skipRows: 3, skipRow: 30, undoLines: 1, statusLines: 2 };
// the tokens the model reads, with the unit each is read in
export const HEIGHT_TOKENS = ['--pattern-warn-padding', '--pattern-warn-gap', '--pattern-warn-edge-width', '--pattern-warn-mark-size', '--pattern-warn-headline-size', '--pattern-warn-headline-leading', '--pattern-warn-body-size', '--pattern-warn-body-leading',
  '--pattern-warn-action-height', '--pattern-list-indent', '--pattern-bullet-inset', '--pattern-task-step-gap', '--pattern-task-bar-height', '--pattern-task-mark-size', '--pattern-step-icon-size', '--pattern-line-min', '--pattern-skip-edge-width', '--pattern-task-count-size'];

const ceil = Math.ceil, floor = Math.floor;
const lines = (chars, size, width) => ceil(chars / Math.max(1, floor(width / (size * GLYPH))));
export function worstCaseHeights(T) {
  const P = T('--pattern-warn-padding'), G = T('--pattern-warn-gap'), E = T('--pattern-warn-edge-width'), M = T('--pattern-warn-mark-size'), HS = T('--pattern-warn-headline-size'), HL = T('--pattern-warn-headline-leading'),
    BS = T('--pattern-warn-body-size'), BL = T('--pattern-warn-body-leading'), A = T('--pattern-warn-action-height'), LI = T('--pattern-list-indent'), BI = T('--pattern-bullet-inset'), SG = T('--pattern-task-step-gap'),
    BH = T('--pattern-task-bar-height'), TM = T('--pattern-task-mark-size'), SI = T('--pattern-step-icon-size'), LM = T('--pattern-line-min'), SE = T('--pattern-skip-edge-width');
  const line = BS * BL, hline = HS * HL, border = 2;   // the dialog's 1 px border, top and bottom
  // ---- 1. a warning sheet (confirm, danger): grid [mark | text], the actions across
  //   H_warn = border + 2P + r1 + r2 + r3 + r4 + r5 + 4G
  //   w_text = 360 - 2 - 2P - E - M - P                       (the text column beside the mark)
  //   r1 = max(M, lines(headline, HS, w_text) * HS*HL)        r2 = nb * (lines(bullet, BS, w_text - LI) * BS*BL) + (nb-1) * G
  //   r3 = A (detail toggle)   r4 = A (acknowledgment)   r5 = 3A + 2G (cancel, secondary, primary stacked)
  const wText = VIEW_W - 2 - 2 * P - E - M - P;
  const r1 = Math.max(M, lines(COPY.headline, HS, wText) * hline), r2 = COPY.bullets * lines(COPY.bullet, BS, wText - LI) * line + (COPY.bullets - 1) * G, r5 = 3 * A + 2 * G;
  const warn = border + 2 * P + r1 + r2 + A + A + r5 + 4 * G;
  // ---- 2. the running task card: head, three steps (the phone shows the current one and its neighbours), bar, count, status, two rows of actions
  //   H_task = border + 2P + head + steps + BH + LM + status + (2A + G) + 5G,   head = max(TM, lines(title, HS, w_card - TM - P) * HS*HL),   steps = 3 * max(SI, line) + 2 * SG,   status = max(LM, 2 lines)
  const wCard = VIEW_W - 2 - 2 * P, head = Math.max(TM, lines(COPY.title, HS, wCard - TM - P) * hline);
  const steps = 3 * Math.max(SI, line) + 2 * SG, status = Math.max(LM, COPY.statusLines * line);
  const task = border + 2 * P + head + steps + BH + LM + status + (2 * A + G) + 5 * G;
  // ---- 3. the result card (a terminal state): the same head, steps and bar, then the result: headline (2 lines), summary (2 lines), the skipped list (heading, 3 rows of two lines, "more"), the undo line, two rows of actions
  //   H_result = border + 2P + head + steps + BH + LM + R + 4G + (result padding G + border 1),   R = 7 gaps' worth of G between the result's children + the children
  //   skipped = 2G + line + 3 * (lines(row, BS, wCard - 2P?) ...) : each skipped row is `lines * line`, rows separated by BI
  const skipRow = lines(COPY.skipRow, BS, Math.max(40, wCard - 2 * P - SE)) * line;
  const skipped = 2 * G + line + BI + COPY.skipRows * skipRow + (COPY.skipRows - 1) * BI + A /* the "more" button */;
  //   the result is one grid item with its own gap G between 5 children (headline, summary, skipped, undo line, actions) = 4 gaps, a top padding G and a 1 px top border
  const resultBody = G + 1 + (lines(COPY.resultHeadline, HS, wCard) * hline) + COPY.summaryLines * line + skipped + COPY.undoLines * line + (2 * A + G) + 4 * G;
  const result = border + 2 * P + head + steps + BH + LM + resultBody + 4 * G;   // the card's own grid: head, steps, bar, count line, result = 4 gaps
  return { warn: Math.round(warn), task: Math.round(task), result: Math.round(result), max: Math.round(Math.max(warn, task, result)) };
}

// ---- token values: defaults from theme/pattern-tokens.css (the touch height, 44, is the default; the 40 under html[data-input=hover] is not taller), then a pack's declarations
const readTokens = (css, into) => { for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) into.set(m[1], m[2].trim()); return into; };
const DEFAULTS = readTokens(strip(fs.readFileSync(path.resolve(here, '../../theme/pattern-tokens.css'), 'utf8')), new Map()); DEFAULTS.set('--pattern-warn-action-height', '44px');
const solve = (v, T, d = 0) => (d > 14 ? v : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (m, n, fb) => (T.has(n) ? solve(T.get(n), T, d + 1) : fb !== undefined ? solve(fb, T, d + 1) : m)));
const px = (s) => { s = String(s).trim(); let m = /^(-?[\d.]+)px$/.exec(s); if (m) return parseFloat(m[1]); m = /^(-?[\d.]+)rem$/.exec(s); if (m) return parseFloat(m[1]) * 16; m = /^(-?[\d.]+)$/.exec(s); return m ? parseFloat(m[1]) : NaN; };
export function packHeights(css, normalise = (x) => x) {
  const text = normalise(css); const own = new Map();
  for (const d of decls(text)) { if (!HEIGHT_TOKENS.includes(d.prop)) continue; if (!own.has(d.prop)) own.set(d.prop, []); own.get(d.prop).push(d.value.replace(/\s*!important\s*$/, '').trim()); }
  const T = new Map(DEFAULTS); for (const [k, vs] of own) if (vs.length) T.set(k, vs[vs.length - 1]);
  const worst = (n) => { const alts = [...(own.get(n) || [])]; if (!(own.get(n) || []).length) alts.push(DEFAULTS.get(n)); let best = NaN; for (const a of alts) { const v = px(solve(a, new Map([...DEFAULTS, ...[...own].map(([k, vs]) => [k, vs[vs.length - 1]])]))); if (Number.isNaN(v)) return NaN; if (Number.isNaN(best) || v > best) best = v; } return best; };
  const bad = HEIGHT_TOKENS.filter((n) => Number.isNaN(worst(n)));
  const h = worstCaseHeights((n) => worst(n));
  return { ...h, unresolved: bad };
}
export const CEILINGS = { '--pattern-warn-padding': 32, '--pattern-warn-gap': 32, '--pattern-warn-edge-width': 12, '--pattern-warn-mark-size': 96, '--pattern-warn-headline-size': 24, '--pattern-warn-headline-leading': 2.2, '--pattern-warn-body-size': 24, '--pattern-warn-body-leading': 2.2,
  '--pattern-warn-action-height': 72, '--pattern-list-indent': 48, '--pattern-bullet-inset': 16, '--pattern-task-step-gap': 32, '--pattern-task-bar-height': 16, '--pattern-task-mark-size': 96, '--pattern-step-icon-size': 48, '--pattern-line-min': 48, '--pattern-skip-edge-width': 8, '--pattern-task-count-size': 24 };

if (process.argv[1] && process.argv[1].endsWith('sheet-height.mjs')) {
  const fmt = (h) => `warn ${h.warn}  task ${h.task}  result ${h.result}  -> max ${h.max} px (limit ${VIEW_H}, ${VIEW_H - h.max >= 0 ? 'fits, ' + (VIEW_H - h.max) + ' spare' : 'OVER by ' + (h.max - VIEW_H)})`;
  console.log(`Worst-case sheet height at ${VIEW_W} x ${VIEW_H} (DD-256). Reference copy: ${JSON.stringify(COPY)}; glyph ${GLYPH} em.`);
  console.log('default tokens      ', fmt(packHeights('')));
  for (const f of ['origin-navy', 'banana-cocoa']) console.log(f.padEnd(20), fmt(packHeights(fs.readFileSync(path.resolve(here, `../themes/${f}.css`), 'utf8'))));
  console.log('every ceiling       ', fmt(worstCaseHeights((n) => CEILINGS[n])));
}
