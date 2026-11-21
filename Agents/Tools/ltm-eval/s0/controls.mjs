// Validity controls of the S0 gate. A control shows that the experiment can discriminate; a confirmed failure makes
// the attempt an INVALID EXPERIMENT and the verdict is never computed. Only a gating-style (ask) failure counts
// (MC-2661); an allude failure is reported.
//   ORACLE-RANK   packing ceiling: gold units first, then the ranker's order. Must reach 0.9.
//   ORACLE-QUERY  scorer, tokeniser and corpus ceiling: one query per gold plant sentence through the scorer, merged
//                 round-robin (MC-2653): rank 0 of every span's list, then rank 1, and so on. A fused (RRF) merge lets a
//                 unit that is second in every list outrank each list's own gold unit, so it measures the merge, not the ceiling.
//   NULL          each fact turn's cue replaced by a same-category donor cue of another fact key (MC-2653), filler
//                 unchanged. Its recall must not
//                 exceed max(baseline units, RANDOM) by more than 0.05.
//   RANDOM        per turn the mean recall of 20 uniform shuffles of the D0 units (streams 9101 + j).
// Each control is a one-sided Bonferroni interval test on the cell's final sample, per cell and style; a control is
// FAIL-CONFIRMED only when both the chat-cluster bootstrap bound and the cluster-t bound exclude its threshold.
import { rng } from '../gen/lib.mjs';
import { tokenize } from './lexical.ts';
import { ChatSim, goldUnitIdx, orderFor, packFor, recallOf } from './sim.mjs';
import { B_CONTROL, GATING_STYLES, STYLES, clusterSE, kthLargest, kthSmallest, ratioOf, resampleRatios, tQuantile } from './stats.mjs';
import { allKey } from './turns.mjs';

export const ORACLE_FLOOR = 0.9;
export const NULL_SLACK = 0.05;
export const FAMILYWISE = 0.05;
export const RANDOM_SHUFFLES = 20;
export const RANDOM_SEED = 9101;

// ---- NULL donor ----
// cands: [{ castTokens: Set, cue(category, style, excludeKey) -> string | null }], i the recipient's position in the
// cell, key the recipient turn's fact key. The donor is the first same-category turn, in cyclic order i+1, i+2, ... (never
// chat i), of a chat whose cast-name tokens are disjoint from chat i's, and never one that asks the recipient's own fact
// key (MC-2653): such a donor would carry the recipient's answer and make NULL measure the cue, not its absence. If no
// chat qualifies, chat i+1's turn is used and counted as a fallback.
export function pickDonor(cands, i, category, style, key) {
  const n = cands.length;
  const mine = cands[i].castTokens;
  for (let d = 1; d < n; d++) {
    const j = (i + d) % n;
    const c = cands[j].cue(category, style, key);
    if (c !== null && [...cands[j].castTokens].every((t) => !mine.has(t))) return { j, cue: c, fallback: false };
  }
  for (let d = 1; d < n; d++) {
    const j = (i + d) % n;
    const c = cands[j].cue(category, style, key);
    if (c !== null) return { j, cue: c, fallback: true };
  }
  return null;
}

export const castTokensOf = (chat) => new Set(tokenize((chat.nf?.cast ?? []).join(' ')));

// A cell context entry for a chat: its cast tokens and, per category and style, its fact turns' cues in order with their
// fact key. cue() returns the first cue whose key differs from excludeKey.
export function donorEntry(chat, turns) {
  const byId = new Map(chat.questions.map((q) => [q.id, q]));
  const cues = new Map();
  for (const t of turns) {
    if (t.kind !== 'fact') continue;
    const k = t.category + '|' + t.style;
    const q = byId.get(t.qid);
    if (!cues.has(k)) cues.set(k, []);
    cues.get(k).push({ key: q ? allKey(q) : null, cue: t.cue });
  }
  return { castTokens: castTokensOf(chat), cue: (category, style, excludeKey) => (cues.get(category + '|' + style) ?? []).find((e) => e.key !== excludeKey)?.cue ?? null };
}

// Round-robin merge of ranked id lists: rank 0 of every list in list order, then rank 1, and so on, skipping ids taken.
export function roundRobin(lists) {
  const seen = new Set();
  const out = [];
  const depth = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let r = 0; r < depth; r++) for (const l of lists) if (r < l.length && !seen.has(l[r])) { seen.add(l[r]); out.push(l[r]); }
  return out;
}

// The ORACLE-QUERY unit order: one query per gold plant sentence in D0 through the scorer, merged round-robin in span
// order, then every unit the queries did not hit, newest first. The ranker is never read.
export function oracleQueryOrder(sim, q, d0, first, hooks) {
  const scorer = hooks?.scorer ?? ((index, tokens) => index.scoreTokens(tokens));
  const all = d0.units.map((_, i) => i);
  const lists = [];
  for (const sp of q.goldSpans) {
    if (sp.msg >= first) continue;
    const s = scorer(d0.index, tokenize(sim.chat.messages[sp.msg].text.slice(sp.start, sp.end)));
    lists.push(all.filter((i) => s[i] > 0).sort((a, b) => s[b] - s[a] || b - a));
  }
  const merged = roundRobin(lists);
  const seen = new Set(merged);
  return merged.concat(all.filter((i) => !seen.has(i)).reverse());
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

// ORACLE-QUERY alone, for the tune eligibility rule; null for a gold-kept turn.
export function oracleQueryHit(sim, turn, q, settings, hooks) {
  const t = sim.trim(turn, settings.C);
  const d0 = sim.d0(t.first, settings.L ?? null);
  if (recallOf(q, d0.units, new Set(), t.first).kept) return null;
  const order = oracleQueryOrder(sim, q, d0, t.first, hooks);
  return +recallOf(q, d0.units, new Set(packFor(sim, order.map((i) => d0.units[i]), settings.budget).picks), t.first).hit;
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
  // ORACLE-QUERY: the scorer directly, one query per gold plant sentence in D0, merged round-robin; the ranker is never read
  const oracleQuery = hit(oracleQueryOrder(sim, q, d0, t.first, hooks));
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
    const donor = donorOf(turn.category, turn.style, allKey(byId.get(turn.qid)));
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
// Both styles are tested, with the same alpha; only the gating styles (ask) can make an attempt invalid, and the family
// is m = cells x gating styles x 3, alpha_c = 0.05 / m (MC-2661). An allude row that fails is reported, never INVALID.
export function controlTests(cells, { B = B_CONTROL, familywise = FAMILYWISE, m: mOverride = null } = {}) {
  const names = Object.keys(cells);
  const m = mOverride ?? names.length * GATING_STYLES.length * 3;
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
  return { m, alpha, rank: k, B, tests, invalid: tests.some((x) => x.failConfirmed && GATING_STYLES.includes(x.style)) };
}
