// The engine simulation of spec 4 and 5.6 over one chat: trim, units, rank, pack, baselines, make-room and recall.
// Two injection points exist for tests; everything else stays real:
//   scorer(index, tokens) -> one score per unit        (BM25 over the built query tokens)
//   ranker(turn, d0, scorer, settings) -> unit order   (best first; the engine arm and the NULL arm use it)
import { Bm25Index, admits, rrf, tokenize, topIdfTerms } from './lexical.ts';
import { chatCost } from './counter.mjs';
import { buildTurns, tailOf } from './turns.mjs';

export const HEADER = 'Earlier in this chat';
export const MIN_LEFT = 8;       // the pack walk stops when fewer than this many tokens remain
export const WRAP_OVERHEAD = 3;  // per-message overhead of the assembled memory message
export const SENTENCE_BREAK = /(?<=[.!?…。"”])\s+/g;

const cpLen = (s) => Array.from(s).length;

// ---- units ----
// Splits one record into pieces of at most L code points: paragraphs first, then sentences joined greedily inside a
// paragraph; a sentence longer than L is hard-cut at L code points. A piece keeps its offset in the record text.
export function splitRecord(text, L) {
  const paras = [];
  let pos = 0;
  for (const m of text.matchAll(/\n{2,}/g)) { paras.push([pos, m.index]); pos = m.index + m[0].length; }
  paras.push([pos, text.length]);
  const pieces = [];
  const push = (a, b) => { if (b > a) pieces.push({ off: a, text: text.slice(a, b) }); };
  for (const [a, b] of paras) {
    if (b <= a) continue;
    const sents = [];
    let sp = a;
    const body = text.slice(a, b);
    for (const m of body.matchAll(SENTENCE_BREAK)) { sents.push([sp, a + m.index]); sp = a + m.index + m[0].length; }
    sents.push([sp, b]);
    let cur = null;
    for (const [sa, sb] of sents) {
      if (cur && cpLen(text.slice(cur[0], sb)) <= L) { cur[1] = sb; continue; }
      if (cur) push(cur[0], cur[1]);
      cur = null;
      if (cpLen(text.slice(sa, sb)) <= L) { cur = [sa, sb]; continue; }
      // a sentence longer than L: hard cut every L code points
      let at = sa;
      const chars = Array.from(text.slice(sa, sb));
      for (let i = 0; i < chars.length; i += L) {
        const seg = chars.slice(i, i + L).join('');
        push(at, at + seg.length);
        at += seg.length;
      }
    }
    if (cur) push(cur[0], cur[1]);
  }
  return pieces;
}

// Units over records: whole records (L null) or pieces. rec is the record index.
export function makeUnits(records, L, firstRec = 0) {
  const units = [];
  records.forEach((r, k) => {
    if (L === null) units.push({ rec: firstRec + k, off: 0, text: r.text });
    else for (const p of splitRecord(r.text, L)) units.push({ rec: firstRec + k, off: p.off, text: p.text });
  });
  return units;
}

// ---- trim ----
// The newest suffix whose cost sum is at most C, counted lazily from the newest message. The newest message (the turn)
// is always kept. Returns the index of the first kept message and the kept costs, oldest first.
export function trimCosts(costOf, n, C) {
  const costs = new Map();
  const cost = (i) => { if (!costs.has(i)) costs.set(i, costOf(i)); return costs.get(i); };
  let sum = 0, first = n;
  while (first > 0 && sum + cost(first - 1) <= C) { sum += cost(first - 1); first--; }
  if (first === n) { first = n - 1; sum = cost(n - 1); }
  const kept = [];
  for (let i = first; i < n; i++) kept.push(cost(i));
  return { first, kept, sum };
}

// ---- pack ----
// order: unit objects, best first. count(text) is the token count; nameOf(rec) the speaker name.
// A unit that does not fit is skipped and the walk stops when fewer than MIN_LEFT tokens remain. The block is assembled
// chronologically; its true count T = count(block) + WRAP_OVERHEAD, and while T > budget the lowest-ranked unit goes.
export function packUnits({ order, budget, count, nameOf }) {
  const lineOf = (u) => `[#${u.rec}] ${nameOf(u.rec)}: ${u.text}`;
  const lineCost = (u) => (u._c ??= count(lineOf(u)) + 1);
  let run = count(HEADER) + 1;
  let picks = [];
  for (const u of order) {
    const c = lineCost(u);
    if (run + c <= budget) { picks.push(u); run += c; }
    if (budget - run < MIN_LEFT) break;
  }
  const assemble = (ps) => {
    const sorted = [...ps].sort((a, b) => a.rec - b.rec || a.off - b.off);
    const block = [HEADER, ...sorted.map(lineOf)].join('\n');
    return { block, T: count(block) + WRAP_OVERHEAD };
  };
  if (!picks.length) return { picks, block: '', T: 0, assemble };
  let a = assemble(picks);
  while (a.T > budget && picks.length) { picks = picks.slice(0, -1); a = picks.length ? assemble(picks) : { block: '', T: 0 }; }
  return { picks, block: a.block, T: a.T, assemble };
}

// ---- make room ----
// Continue the trim on the kept set down to C - T by dropping the oldest kept messages, never below F kept messages.
// If that cannot fit, drop the lowest-ranked pack unit and retry; an empty pack leaves the kept set unchanged.
// keptCosts is oldest first. Returns the delivered pack, T, the dropped kept count and the evicted kept tokens.
export function makeRoom({ keptCosts, T, C, F, pack }) {
  let picks = pack.picks, curT = T;
  for (;;) {
    if (!picks.length) return { picks: [], T: 0, droppedCount: 0, evicted: 0 };
    const limit = C - curT;
    let sum = keptCosts.reduce((a, b) => a + b, 0), i = 0, evicted = 0;
    while (sum > limit && keptCosts.length - i > F) { sum -= keptCosts[i]; evicted += keptCosts[i]; i++; }
    if (sum <= limit) return { picks, T: curT, droppedCount: i, evicted };
    picks = picks.slice(0, -1);
    curT = picks.length ? pack.assemble(picks).T : 0;
  }
}

// ---- recall ----
// Units overlapping a span, in the units of its record.
export function unitsOverSpan(units, sp) {
  return units.filter((u) => u.rec === sp.msg && u.off < sp.end && u.off + u.text.length > sp.start);
}

// 1 when every gold span in D0 is fully covered: every unit overlapping the span is packed. Gold in the kept set K0
// is left out; a turn whose gold is all in K0 is "gold-kept" and in neither population. KU gold is the new value.
export function recallOf(q, units, packed, first) {
  const inD0 = q.goldSpans.filter((sp) => sp.msg < first);
  if (!inD0.length) return { kept: true, hit: null, staleOnly: null };
  const covered = (sp) => { const us = unitsOverSpan(units, sp); return us.length > 0 && us.every((u) => packed.has(u)); };
  const hit = inD0.every(covered);
  const staleD0 = q.staleSpans.filter((sp) => sp.msg < first);
  const stale = staleD0.length > 0 && staleD0.every(covered);
  return { kept: false, hit, staleOnly: stale && !hit };
}

// ---- the per-chat simulator ----
export const defaultScorer = (index, tokens) => index.scoreTokens(tokens);

export class ChatSim {
  constructor(chat, counter) {
    this.chat = chat;
    this.counter = counter;
    this.costs = new Map();
    this.d0cache = new Map();
    this.nameOf = (rec) => (chat.messages[rec].role === 'char' ? chat.names.char : chat.names.user);
  }
  msgCost(i) {
    let c = this.costs.get(i);
    if (c === undefined) { c = chatCost(this.counter, this.chat.messages[i]); this.costs.set(i, c); }
    return c;
  }
  // Appends the turn as the newest user message and trims to C.
  trim(turn, C) {
    const n = this.chat.messages.length + 1;
    const tc = chatCost(this.counter, { role: 'user', text: turn.text });
    const r = trimCosts((i) => (i === n - 1 ? tc : this.msgCost(i)), n, C);
    return { ...r, n };
  }
  d0(first, L) {
    const key = first + ':' + L;
    let d = this.d0cache.get(key);
    if (!d) {
      if (this.d0cache.size >= 8) this.d0cache.clear();
      const units = makeUnits(this.chat.messages.slice(0, first), L);
      const index = new Bm25Index();
      for (const u of units) index.add(u.text);
      d = { first, L, units, index, tokens: units.map((u) => tokenize(u.text)) };
      this.d0cache.set(key, d);
    }
    return d;
  }
  // Query 1 is the turn's tail; queries 2 and 3 are the tails of the two newest messages before it. The tail length is
  // 500 code points (MC-2632); settings.tailChars exists only for the whole-turn diagnostic.
  queryTexts(turn, queries, tailChars) {
    const m = this.chat.messages;
    const n = tailChars ?? 500;
    const qs = [tailOf(turn.text, n)];
    if (queries === 3) for (const j of [1, 2]) if (m.length - j >= 0) qs.push(tailOf(m[m.length - j].text, n));
    return qs;
  }
  count(text) { return this.counter.len(text); }
}

// The real ranker: BM25 per query over the built query, RRF for three queries, then the admission filter.
export function engineRanker(sim, turn, d0, scorer, settings) {
  const { index, units } = d0;
  const rankings = [];
  const qTokens = new Set();
  for (const q of sim.queryTexts(turn, settings.queries ?? 1, settings.tailChars)) {
    const toks = settings.builder === 'idf' ? topIdfTerms(index, q, settings.k ?? 8) : tokenize(q);
    for (const t of toks) qTokens.add(t);
    const s = scorer(index, toks);
    const ids = [];
    for (let i = 0; i < units.length; i++) if (s[i] > 0) ids.push(i);
    ids.sort((a, b) => s[b] - s[a] || b - a);
    rankings.push(ids);
  }
  let order = rankings.length === 1 ? rankings[0] : rrf(rankings);
  const tau = settings.tau ?? null;
  if (tau !== null) order = order.filter((i) => admits(index, d0.tokens[i], [...qTokens], tau));
  else {
    const seen = new Set(order);
    const rest = [];
    for (let i = units.length - 1; i >= 0; i--) if (!seen.has(i)) rest.push(i);
    order = order.concat(rest);
  }
  return order;
}

const newestFirst = (units) => units.map((_, i) => i).sort((a, b) => units[b].rec - units[a].rec || units[b].off - units[a].off);

// Unit order of the engine arm: the injected ranker if any, the real ranker otherwise. The ranker receives the turn
// with its question (turn.q), the scorer, the settings and { chat, sim } so a test oracle can look the chat up.
export function orderFor(sim, turn, q, d0, settings, hooks = {}) {
  const scorer = hooks.scorer ?? defaultScorer;
  const tu = { ...turn, q };
  return hooks.ranker ? hooks.ranker(tu, d0, scorer, settings, { chat: sim.chat, sim }) : engineRanker(sim, tu, d0, scorer, settings);
}

export const goldUnitIdx = (d0, q) => {
  const out = [];
  d0.units.forEach((u, i) => { if (q.goldSpans.some((sp) => sp.msg < d0.first && sp.msg === u.rec && u.off < sp.end && u.off + u.text.length > sp.start)) out.push(i); });
  return out;
};

export const packFor = (sim, order, budget) => packUnits({ order, budget, count: (s) => sim.count(s), nameOf: sim.nameOf });

// One turn through the engine and the baselines. hooks: { scorer, ranker } (test injection points).
// Returns per-arm results; a turn whose gold is all in K0 has kept = true and is in neither population.
export function runTurn(sim, chat, turn, q, settings, hooks = {}) {
  const C = settings.C;
  const t = sim.trim(turn, C);
  const d0 = sim.d0(t.first, settings.L ?? null);
  const order = orderFor(sim, turn, q, d0, settings, hooks).map((i) => d0.units[i]);
  const pk = (ord) => packFor(sim, ord, settings.budget);
  const engine = pk(order);
  const rec = q ? recallOf(q, d0.units, new Set(engine.picks), t.first) : null;
  const out = { trim: t, d0, engine, recall: rec, settings };
  if (!q) return out;
  out.kept = rec.kept;
  if (rec.kept) return out;
  const room = makeRoom({ keptCosts: t.kept, T: engine.T, C, F: settings.F ?? 2, pack: engine });
  out.room = room;
  out.delivered = recallOf(q, d0.units, new Set(room.picks), t.first).hit;
  const bu = pk(newestFirst(d0.units).map((i) => d0.units[i]));
  out.baseUnits = recallOf(q, d0.units, new Set(bu.picks), t.first).hit;
  const whole = sim.d0(t.first, null);
  const bw = pk(newestFirst(whole.units).map((i) => whole.units[i]));
  out.baseWhole = recallOf(q, whole.units, new Set(bw.picks), t.first).hit;
  return out;
}

const STYLE_LIST = ['ask', 'allude'];

// Evaluates every turn of one chat at one setting and returns the compact record the statistics read.
// opts: { profile, regime, lenMode, hooks, turns, nofact (default true), totalTokens }.
export function evalChatRecord(chat, counter, settings, opts) {
  const turns = opts.turns ?? buildTurns(chat, { regime: opts.regime ?? 'POOL', profile: opts.profile, lenMode: opts.lenMode });
  const sim = new ChatSim(chat, counter);
  const byId = new Map(chat.questions.map((q) => [q.id, q]));
  const rows = [], nofact = [];
  const kept = { ask: 0, allude: 0 };
  for (const turn of turns) {
    if (turn.kind === 'fact') {
      const q = byId.get(turn.qid);
      const r = runTurn(sim, chat, turn, q, settings, opts.hooks);
      if (r.kept) { kept[turn.style]++; continue; }
      rows.push({
        style: turn.style, qid: q.id, category: q.category, hit: +r.recall.hit, base: +r.baseUnits, baseW: +r.baseWhole, delivered: +r.delivered,
        T: r.engine.T, evicted: r.room.evicted, packed: r.engine.picks.length, cueInTail: turn.cueInTail, ov: turn.overlap, merged: q.mergedKU, staleOnly: r.recall.staleOnly,
      });
    } else if (opts.nofact !== false) {
      const r = runTurn(sim, chat, turn, null, settings, opts.hooks);
      nofact.push({ style: turn.style, kind: turn.qid ? 'abstention' : 'filler', packedAny: r.engine.picks.length > 0, T: r.engine.T });
    }
  }
  const rec = { id: chat.id, rows, nofact, kept, counted: sim.costs.size, nf: { n: nofact.length, empty: nofact.filter((x) => !x.packedAny).length } };
  for (const s of STYLE_LIST) {
    const rs = rows.filter((x) => x.style === s);
    const sum = (k) => rs.reduce((a, x) => a + x[k], 0);
    rec[s] = { n: rs.length, e: sum('hit'), b: sum('base'), bw: sum('baseW'), dl: sum('delivered') };
  }
  if (opts.totalTokens) rec.tokens = chat.messages.reduce((a, _, i) => a + sim.msgCost(i), 0);
  return rec;
}
