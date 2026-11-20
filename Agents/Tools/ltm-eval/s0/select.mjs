// Output selection of the S0 tune run, on the TUNE draw only, per builder (full text, idf), by lower bounds.
// ev(settings, regime) -> { recs: { cell: [chat record] }, oracle: { cell: { style: point } } } is the evaluator; a chat
// record is { ask: {n, e, b, dl}, allude: {...}, nf: {n, empty} }. All choices read chat-cluster bootstrap bounds
// (B = 4000, rng 9001) or paired differences between settings, never a point estimate alone.
import { B_VERDICT, STYLES, intervals } from './stats.mjs';

export const TUNE_CHATS = 24;          // chats per gate cell on the tune draw
export const GRID_L = [300, 500, 800, 1200];
export const GRID_K = [4, 6, 8, 12, 16];
export const K_DEFAULT = 8;
export const L_DEFAULT = 800;          // the default point of the delta rule (trigger L is reported beside it)
export const BUDGETS = [400, 600, 800, 1200, 1600, 2400, 3600];
export const BUDGET_DEFAULT = 1200;
export const TAUS = [0.002, 0.005, 0.01, 0.02, 0.05];
export const FS = [2, 3, 4];
export const ORACLE_FLOOR = 0.9;
export const C_GATE = 32768;
export const BUDGET_CAP_SHARE = 0.15;  // of (C + 2000)

const cellsOf = (r) => Object.keys(r.recs);
const series = (chats, style, key) => chats.map((c) => ({ n: c[style].n, v: c[style][key] }));
const iv = (chats, style, key) => intervals(series(chats, style, key), B_VERDICT);
const paired = (refChats, candChats, style, key) => refChats.map((c, i) => ({ n: c[style].n, v: c[style][key] - candChats[i][style][key] }));
const dseries = (chats, style) => chats.map((c) => ({ n: c[style].n, v: c[style].e - c[style].b }));

// O(s): the minimum over cells and styles of the LB95 of recall.
export function objective(r) {
  let o = Infinity;
  for (const cell of cellsOf(r)) for (const s of STYLES) o = Math.min(o, iv(r.recs[cell], s, 'e').boot.lo);
  return o;
}
// Eligible only when both ceilings reach the floor (MC-2653): ORACLE-RANK for the packing, ORACLE-QUERY for the scorer.
const oracleOk = (r) => cellsOf(r).every((cell) => STYLES.every((s) => (r.oracle?.[cell]?.[s] ?? 1) >= ORACLE_FLOOR && (r.oracleQuery?.[cell]?.[s] ?? 1) >= ORACLE_FLOOR));

// delta: the smallest half-width of the tune 95% CI of recall at the default point.
export function deltaOf(r) {
  let d = Infinity;
  for (const cell of cellsOf(r)) for (const s of STYLES) { const b = iv(r.recs[cell], s, 'e').boot; d = Math.min(d, (b.hi - b.lo) / 2); }
  return d;
}

// Cleared by the lower bound: LB95 recall >= 0.5 and LB95 d >= 0.15 in every cell and style.
function clears(r) {
  for (const cell of cellsOf(r)) for (const s of STYLES) {
    if (iv(r.recs[cell], s, 'e').boot.lo < 0.5) return false;
    if (intervals(dseries(r.recs[cell], s), B_VERDICT).boot.lo < 0.15) return false;
  }
  return true;
}

// Largest paired loss UB95 of ref against cand, over the given cells and styles.
function lossUB(refR, candR, key = 'e', cells = cellsOf(refR)) {
  let ub = -Infinity;
  for (const cell of cells) for (const s of STYLES) ub = Math.max(ub, intervals(paired(refR.recs[cell], candR.recs[cell], s, key), B_VERDICT).boot.hi);
  return ub;
}

const capOf = (C) => Math.floor(BUDGET_CAP_SHARE * (C + 2000));

// grid overrides the candidate sets only for tune-lite runs in tests (L, K, budgets, budgetDefault, taus, Fs).
export function selectSettings(ev, { builder, C = C_GATE, procedure = {}, tuneDrawSeed = null, grid = {} } = {}) {
  const G = { L: GRID_L, K: GRID_K, budgets: BUDGETS, budgetDefault: BUDGET_DEFAULT, taus: TAUS, Fs: FS, ...grid };
  const BUDGET_DEFAULT_ = G.budgetDefault;
  const base = { builder, C, L: grid.L?.[0] ?? L_DEFAULT, k: K_DEFAULT, budget: BUDGET_DEFAULT_, queries: 1, tau: null, F: 2 };
  const memo = new Map();
  const run = (st, regime = 'POOL') => { const key = JSON.stringify([st, regime]); if (!memo.has(key)) memo.set(key, ev(st, regime)); return memo.get(key); };
  const delta = deltaOf(run(base));
  const evidence = { delta };

  // 1. L (and k for idf): the maximum O among eligible candidates; within delta of the best, a larger L, then k nearest 8.
  const pickGrid = (budget) => {
    const cands = [];
    for (const L of G.L) for (const k of builder === 'idf' ? G.K : [K_DEFAULT]) {
      const st = { ...base, L, k, budget, oracle: true }; // oracle: the evaluator also measures ORACLE-RANK and ORACLE-QUERY here
      const r = run(st);
      cands.push({ L, k, O: objective(r), ok: oracleOk(r) });
    }
    const ok = cands.filter((c) => c.ok);
    const pool = ok.length ? ok : cands;
    const best = Math.max(...pool.map((c) => c.O));
    const near = pool.filter((c) => c.O >= best - delta);
    near.sort((a, b) => b.L - a.L || Math.abs(a.k - K_DEFAULT) - Math.abs(b.k - K_DEFAULT));
    return { pick: near[0], cands, eligible: ok.length > 0 };
  };
  const cap = capOf(C);
  let g = pickGrid(BUDGET_DEFAULT_);
  // A bigger budget is allowed wherever no candidate passes both oracle checks at the default (MC-2654); the first
  // budget above the default, within the cap, with an eligible candidate becomes the grid budget.
  let gridBudget = BUDGET_DEFAULT_;
  if (!g.eligible) {
    for (const b of G.budgets.filter((x) => x > BUDGET_DEFAULT_ && x <= cap)) {
      const h = pickGrid(b);
      if (h.eligible) { g = h; gridBudget = b; break; }
    }
    if (!g.eligible) evidence.oracleFlag = 'no oracle-eligible L/budget';
  }
  let L = g.pick.L, k = g.pick.k;
  evidence.grid = g.cands;
  evidence.gridBudget = gridBudget;

  // 2. budget: clear the floor by the lower bound, then the cheapest within delta of 1200; never below the grid budget.
  const budgets = G.budgets.filter((b) => b <= cap && (gridBudget === BUDGET_DEFAULT_ || b >= gridBudget));
  const E = budgets.filter((b) => clears(run({ ...base, L, k, budget: b })));
  let budget, flag = null;
  if (E.includes(BUDGET_DEFAULT_)) {
    const ref = run({ ...base, L, k, budget: BUDGET_DEFAULT_ });
    budget = Math.min(...E.filter((b) => b <= BUDGET_DEFAULT_ && lossUB(ref, run({ ...base, L, k, budget: b })) <= delta));
  } else if (E.some((b) => b > BUDGET_DEFAULT_)) budget = Math.min(...E.filter((b) => b > BUDGET_DEFAULT_));
  else { budget = BUDGET_DEFAULT_; flag = 'tune predicts FAIL'; }
  evidence.budgetClears = E;
  evidence.budgetFlag = flag;
  if (budget !== gridBudget) { // L and k are rechecked once at the chosen budget
    g = pickGrid(budget);
    evidence.recheck = { L: g.pick.L, k: g.pick.k, changed: g.pick.L !== L || g.pick.k !== k };
    L = g.pick.L; k = g.pick.k;
  }
  const at = { ...base, L, k, budget };

  // 3. query count: three only if O improves by more than delta.
  const o1 = objective(run(at)), o3 = objective(run({ ...at, queries: 3 }));
  const queries = o3 - o1 > delta ? 3 : 1;
  evidence.queries = { o1, o3 };
  const withQ = { ...at, queries };

  // 4. admission tau: the smallest qualifying value of a possibly non-contiguous set.
  // nofact: the evaluator also runs the no-fact turns, whose empty-pack share only this step reads
  const off = { POOL: run({ ...withQ, nofact: true }, 'POOL'), DISJOINT: run({ ...withQ, nofact: true }, 'DISJOINT') };
  const qual = G.taus.filter((tau) => ['POOL', 'DISJOINT'].every((regime) => {
    const on = run({ ...withQ, tau, nofact: true }, regime);
    for (const cell of cellsOf(on)) {
      const gain = on.recs[cell].map((c, i) => ({ n: c.nf.n, v: c.nf.empty - off[regime].recs[cell][i].nf.empty }));
      if (intervals(gain, B_VERDICT).boot.lo < 0.05) return false;
    }
    return lossUB(off[regime], on) <= delta;
  }));
  const tau = qual.length ? Math.min(...qual) : null;
  evidence.tauQualifying = qual;
  const withT = { ...withQ, tau };

  // 5. snippet floor: 0.75 when the LB95 recall at 0.75 x budget is below 0.5; the share stays 1.0 before S5.
  const lowB = run({ ...withT, budget: Math.floor(0.75 * budget) });
  let minLb = Infinity;
  for (const cell of cellsOf(lowB)) for (const s of STYLES) minLb = Math.min(minLb, iv(lowB.recs[cell], s, 'e').boot.lo);
  const snippetFloor = minLb < 0.5 ? 0.75 : 0.5;

  // 6. F: the largest F whose paired delivered-recall loss against F = 2 on NF-real has UB95 <= delta.
  const nfCells = cellsOf(run(withT)).filter((c) => c.startsWith('NF-real'));
  const ref2 = run({ ...withT, F: 2 });
  let F = 2;
  for (const f of G.Fs) if (f > 2 && lossUB(ref2, run({ ...withT, F: f }), 'dl', nfCells) <= delta) F = f;

  return { builder, C, L, k: builder === 'idf' ? k : null, budget, queries, tau, F, snippetFloor, snippetShare: 1.0, regime: 'POOL', delta, tuneDrawSeed, evidence, procedure };
}
