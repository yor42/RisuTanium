// Validity controls of the S0 gate. A control shows that the experiment can discriminate; a confirmed failure makes
// the attempt an INVALID EXPERIMENT and the verdict is never computed.
//   ORACLE-RANK   packing ceiling: gold units first, then the ranker's order. Must reach 0.9.
//   ORACLE-QUERY  scorer, tokeniser and corpus ceiling: one query per gold plant sentence through the scorer, fused by RRF.
//   NULL          each fact turn's cue replaced by a same-category donor cue, filler unchanged. Its recall must not
//                 exceed max(baseline units, RANDOM) by more than 0.05.
//   RANDOM        per turn the mean recall of 20 uniform shuffles of the D0 units (streams 9101 + j).
// Each control is a one-sided Bonferroni interval test on the cell's final sample, per cell and style; a control is
// FAIL-CONFIRMED only when both the chat-cluster bootstrap bound and the cluster-t bound exclude its threshold.
import { rng } from '../gen/lib.mjs';
import { rrf, tokenize } from './lexical.ts';
import { ChatSim, goldUnitIdx, orderFor, packFor, recallOf } from './sim.mjs';
import { B_CONTROL, STYLES, clusterSE, kthLargest, kthSmallest, ratioOf, resampleRatios, tQuantile } from './stats.mjs';

export const ORACLE_FLOOR = 0.9;
export const NULL_SLACK = 0.05;
export const FAMILYWISE = 0.05;
export const RANDOM_SHUFFLES = 20;
export const RANDOM_SEED = 9101;

// ---- NULL donor ----
// cands: [{ castTokens: Set, cue(category, style) -> string | null }], i the recipient's position in the cell.
// The donor is the first same-category turn, in cyclic order i+1, i+2, ... (never chat i), of a chat whose cast-name
// tokens are disjoint from chat i's. If no chat qualifies, chat i+1's turn is used and counted as a fallback.
export function pickDonor(cands, i, category, style) {
  const n = cands.length;
  const mine = cands[i].castTokens;
  for (let d = 1; d < n; d++) {
    const j = (i + d) % n;
    const c = cands[j].cue(category, style);
    if (c !== null && [...cands[j].castTokens].every((t) => !mine.has(t))) return { j, cue: c, fallback: false };
  }
  for (let d = 1; d < n; d++) {
    const j = (i + d) % n;
    const c = cands[j].cue(category, style);
    if (c !== null) return { j, cue: c, fallback: true };
  }
  return null;
}

export const castTokensOf = (chat) => new Set(tokenize((chat.nf?.cast ?? []).join(' ')));

// A cell context entry for a chat: its cast tokens and the first cue per category and style among its fact turns.
export function donorEntry(chat, turns) {
  const cues = new Map();
  for (const t of turns) if (t.kind === 'fact') { const k = t.category + '|' + t.style; if (!cues.has(k)) cues.set(k, t); }
  return { castTokens: castTokensOf(chat), cue: (category, style) => cues.get(category + '|' + style)?.cue ?? null };
}

// ORACLE-RANK alone, for the tune eligibility rule; null for a gold-kept turn.
export function oracleRankHit(sim, turn, q, settings, hooks) {
  const t = sim.trim(turn, settings.C);
  const d0 = sim.d0(t.first, settings.L ?? null);
  if (recallOf(q, d0.units, new Set(), t.first).kept) return null;
  const gold = goldUnitIdx(d0, q);
  const goldSet = new Set(gold);
  const fill = orderFor(sim, turn, q, d0, settings, hooks).filter((i) => !goldSet.has(i));
  return +recallOf(q, d0.units, new Set(packFor(sim, [...gold, ...fill].map((i) => d0.units[i]), settings.budget).picks), t.first).hit;
}

// ---- per-turn control arms ----
// Returns hit values for ORACLE-RANK, ORACLE-QUERY, NULL and the mean over the RANDOM shuffles, for one fact turn.
// hooks are the same injection points the engine arm uses; donorCue is the donor's cue text.
export function controlArms(sim, turn, q, settings, hooks, donorCue) {
  const t = sim.trim(turn, settings.C);
  const d0 = sim.d0(t.first, settings.L ?? null);
  if (recallOf(q, d0.units, new Set(), t.first).kept) return null;
  const hit = (order) => +recallOf(q, d0.units, new Set(packFor(sim, order.map((i) => d0.units[i]), settings.budget).picks), t.first).hit;
  const all = d0.units.map((_, i) => i);
  // ORACLE-RANK: the ranker only fills the order after the gold units
  const gold = goldUnitIdx(d0, q);
  const goldSet = new Set(gold);
  const fill = orderFor(sim, turn, q, d0, settings, hooks).filter((i) => !goldSet.has(i));
  const oracleRank = hit([...gold, ...fill]);
  // ORACLE-QUERY: the scorer directly, one query per gold plant sentence in D0, fused by RRF; the ranker is never read
  const scorer = hooks?.scorer ?? ((index, tokens) => index.scoreTokens(tokens));
  const lists = [];
  for (const sp of q.goldSpans) {
    if (sp.msg >= t.first) continue;
    const s = scorer(d0.index, tokenize(sim.chat.messages[sp.msg].text.slice(sp.start, sp.end)));
    const ids = all.filter((i) => s[i] > 0).sort((a, b) => s[b] - s[a] || b - a);
    lists.push(ids);
  }
  const fused = rrf(lists);
  const seen = new Set(fused);
  const oracleQuery = hit(fused.concat(all.filter((i) => !seen.has(i)).reverse()));
  // NULL: the donor cue in place of the cue, filler unchanged, the same ranker as the engine arm
  const nt = { ...turn, cue: donorCue, text: [turn.prefix, donorCue, turn.suffix].filter(Boolean).join(' ') };
  const nul = hit(orderFor(sim, nt, q, d0, settings, hooks));
  let rd = 0;
  for (let j = 0; j < RANDOM_SHUFFLES; j++) rd += hit(rng(RANDOM_SEED + j).shuffle(all));
  // the baseline of the NULL comparison: the same units newest first
  const bu = hit([...all].sort((a, b) => d0.units[b].rec - d0.units[a].rec || d0.units[b].off - d0.units[a].off));
  return { oracleRank, oracleQuery, nul, rand: rd / RANDOM_SHUFFLES, bu };
}

// Control record of one chat: per style sums over its fact turns outside the gold-kept population.
// donors: { ask: Map(category -> {cue, fallback}), allude: ... } for this chat, from pickDonor.
export function controlsRecord(chat, counter, settings, turns, donorOf, hooks) {
  const sim = new ChatSim(chat, counter);
  const byId = new Map(chat.questions.map((q) => [q.id, q]));
  const out = {};
  for (const s of STYLES) out[s] = { n: 0, or: 0, oq: 0, nl: 0, bu: 0, rd: 0, fallback: 0 };
  for (const turn of turns) {
    if (turn.kind !== 'fact') continue;
    const donor = donorOf(turn.category, turn.style);
    if (!donor) continue;
    const a = controlArms(sim, turn, byId.get(turn.qid), settings, hooks, donor.cue);
    if (!a) continue;
    const o = out[turn.style];
    o.n++; o.or += a.oracleRank; o.oq += a.oracleQuery; o.nl += a.nul; o.bu += a.bu; o.rd += a.rand; if (donor.fallback) o.fallback++;
  }
  return out;
}

// ---- interval tests ----
// cells: { name: [ { ask: { n, or, oq, nl, bu, rd }, allude: {...} } per chat ] } on the final sample of each cell.
// m = cells x styles x 3; alpha_c = 0.05 / m.
export function controlTests(cells, { B = B_CONTROL, familywise = FAMILYWISE, m: mOverride = null } = {}) {
  const names = Object.keys(cells);
  const m = mOverride ?? names.length * STYLES.length * 3;
  const alpha = familywise / m;
  const k = Math.ceil(alpha * B);
  const tests = [];
  for (const name of names) {
    const chats = cells[name];
    for (const style of STYLES) {
      const ser = (key) => chats.map((c) => ({ n: c[style].n, v: c[style][key] }));
      const t = (df) => (df >= 1 ? tQuantile(1 - alpha, df) : Infinity);
      for (const [control, key] of [['ORACLE-RANK', 'or'], ['ORACLE-QUERY', 'oq']]) {
        const s = ser(key);
        const { se, point } = clusterSE(s);
        const bootUpper = kthLargest(resampleRatios(s, B), k);
        const tUpper = point + t(s.length - 1) * se;
        const confirmed = bootUpper < ORACLE_FLOOR && tUpper < ORACLE_FLOOR;
        tests.push({ cell: name, style, control, point, boot: bootUpper, t: tUpper, threshold: ORACLE_FLOOR, failConfirmed: confirmed, notConfirmed: !confirmed && point < ORACLE_FLOOR, alpha });
      }
      const nl = ser('nl'), bu = ser('bu'), rd = ser('rd');
      const pBu = ratioOf(bu), pRd = ratioOf(rd);
      const comp = pBu >= pRd ? bu : rd;
      const diff = nl.map((c, i) => ({ n: c.n, v: c.v - comp[i].v }));
      const { se, point } = clusterSE(diff);
      const rn = resampleRatios(nl, B), rb = resampleRatios(bu, B), rr = resampleRatios(rd, B);
      const delta = new Float64Array(B);
      for (let b = 0; b < B; b++) delta[b] = rn[b] - Math.max(rb[b], rr[b]);
      const bootLower = kthSmallest(delta, k);
      const tLower = point - t(diff.length - 1) * se;
      const confirmed = bootLower > NULL_SLACK && tLower > NULL_SLACK;
      tests.push({ cell: name, style, control: 'NULL', point, boot: bootLower, t: tLower, threshold: NULL_SLACK, failConfirmed: confirmed, notConfirmed: !confirmed && point > NULL_SLACK, alpha, comparator: pBu >= pRd ? 'baseline' : 'random' });
    }
  }
  return { m, alpha, rank: k, B, tests, invalid: tests.some((x) => x.failConfirmed) };
}
