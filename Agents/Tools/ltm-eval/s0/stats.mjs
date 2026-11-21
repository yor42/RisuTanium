// Statistics of the S0 gate. A series is one value per chat, { n, v }: n usable fact turns and v the sum of the turn
// values (recall hits, or engine minus baseline hits). The estimate is the turn-weighted ratio sum(v) / sum(n).
// Two interval methods: the chat-cluster percentile bootstrap (chats resampled whole, rng 9001, one resample stream
// shared by every series, style and control) and the cluster-robust t interval of the ratio estimator (linearised
// variance, n - 1 degrees of freedom).
import { rng } from '../gen/lib.mjs';

export const STYLES = ['ask', 'allude'];
// MC-2661: ask turns gate; allude turns are computed and reported only, and carried to S3.
export const GATING_STYLES = ['ask'];
export const BOOT_SEED = 9001;
export const B_VERDICT = 4000;
export const B_CONTROL = 20000; // its first B_VERDICT resamples are the verdict interval's resamples
export const STOP = { minChats: 12, minTurns: 120, cap: 48, step: 4, width: 0.15 };

const drawMemo = new Map();
// Resample index rows, generated in one sequence per chat count, so a prefix of the rows is the smaller bootstrap.
export function bootstrapDraws(nChats, B, seed = BOOT_SEED) {
  const key = nChats + ':' + seed;
  let d = drawMemo.get(key);
  if (!d) { d = { rows: [], r: rng(seed) }; drawMemo.set(key, d); }
  while (d.rows.length < B) { const row = new Int32Array(nChats); for (let i = 0; i < nChats; i++) row[i] = d.r.int(nChats); d.rows.push(row); }
  return d.rows;
}

export const ratioOf = (chats, idx = null) => {
  let n = 0, v = 0;
  if (idx) for (const i of idx) { n += chats[i].n; v += chats[i].v; } else for (const c of chats) { n += c.n; v += c.v; }
  return n ? v / n : 0;
};

// Ratio of every resample, in resample order.
export function resampleRatios(chats, B) {
  const rows = bootstrapDraws(chats.length, B);
  const out = new Float64Array(B);
  for (let b = 0; b < B; b++) out[b] = ratioOf(chats, rows[b]);
  return out;
}

export const sortedCopy = (a) => Float64Array.from(a).sort();
export const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
// The k-th smallest value (1-based) of an unsorted array.
export const kthSmallest = (a, k) => sortedCopy(a)[k - 1];
export const kthLargest = (a, k) => sortedCopy(a)[a.length - k];

// ---- Student t ----
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const cj of c) s += cj / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
function betacf(a, b, x) {
  const TINY = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
export function tCdf(t, df) {
  const x = df / (df + t * t);
  const tail = 0.5 * betai(df / 2, 0.5, x);
  return t > 0 ? 1 - tail : tail;
}
// Quantile of Student t, p in (0.5, 1). Closed forms for 1 and 2 degrees of freedom, bisection otherwise.
export function tQuantile(p, df) {
  if (df === 1) return Math.tan(Math.PI * (p - 0.5));
  if (df === 2) return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
  let lo = 0, hi = 1;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// Cluster-robust standard error of the ratio estimator (linearised variance).
export function clusterSE(chats) {
  const m = chats.length;
  const N = chats.reduce((a, c) => a + c.n, 0);
  if (m < 2 || N === 0) return { se: Infinity, point: ratioOf(chats) };
  const R = ratioOf(chats);
  let ss = 0;
  for (const c of chats) ss += (c.v - R * c.n) ** 2;
  return { se: Math.sqrt((m / (m - 1)) * ss) / N, point: R };
}

// Two-sided 95% intervals of one series: bootstrap (B resamples) and cluster-t.
export function intervals(chats, B = B_VERDICT, level = 0.95) {
  const a = (1 - level) / 2;
  const sorted = sortedCopy(resampleRatios(chats, B));
  const boot = { lo: percentile(sorted, a), hi: percentile(sorted, 1 - a) };
  boot.width = boot.hi - boot.lo;
  const { se, point } = clusterSE(chats);
  const crit = chats.length >= 2 ? tQuantile(1 - a, chats.length - 1) : Infinity;
  const t = { lo: point - crit * se, hi: point + crit * se, se };
  t.width = t.hi - t.lo;
  return { point, boot, t };
}

// Per-chat series of a cell for one style: chats[k][style] = { n, e, b } (engine hits, baseline hits).
export const seriesOf = (cellChats, style, kind) => cellChats.map((c) => ({ n: c[style].n, v: kind === 'recall' ? c[style].e : c[style].e - c[style].b }));

export function cellStats(cellChats, B = B_VERDICT) {
  const out = {};
  for (const style of STYLES) out[style] = { recall: intervals(seriesOf(cellChats, style, 'recall'), B), d: intervals(seriesOf(cellChats, style, 'd'), B), n: cellChats.reduce((a, c) => a + c[style].n, 0) };
  return out;
}

// The stop rule may fire only with at least minChats chats and at least minTurns fact turns in each gating style, and
// when the recall width and the d width of each gating style, by both methods, are below `width`. It never reads the
// pass state and never reads allude (MC-2661).
export function stopRuleMet(cellChats, p = STOP, B = B_VERDICT) {
  if (cellChats.length < p.minChats) return false;
  const st = cellStats(cellChats, B);
  for (const style of GATING_STYLES) {
    if (st[style].n < p.minTurns) return false;
    for (const k of ['recall', 'd']) if (!(st[style][k].boot.width < p.width && st[style][k].t.width < p.width)) return false;
  }
  return true;
}

// Grows one cell: minChats chats first, then step more until the rule is met or the cap is reached.
// sampleChat(k) returns the per-chat record of chat k. status CAP means INCONCLUSIVE for the cell.
export function growCell(sampleChat, p = STOP, B = B_VERDICT) {
  const chats = [];
  const take = (to) => { while (chats.length < to) chats.push(sampleChat(chats.length)); };
  take(p.minChats);
  for (;;) {
    if (stopRuleMet(chats, p, B)) return { chats, status: 'STOPPED' };
    if (chats.length >= p.cap) return { chats, status: 'CAP' };
    take(Math.min(p.cap, chats.length + p.step));
  }
}

// The outcome of an attempt whose controls passed, read only after every cell has stopped: a cell at the cap makes the
// attempt INCONCLUSIVE (not a pass, MC-2631); otherwise the verdict rule applies.
// grown: { cell: { chats, status } } with status STOPPED or CAP.
export function outcomeOf(grown, B = B_VERDICT) {
  for (const g of Object.values(grown)) if (g.status !== 'STOPPED' && g.status !== 'CAP') throw new Error('a cell has not stopped: no verdict yet');
  if (Object.values(grown).some((g) => g.status === 'CAP')) return { verdict: 'INCONCLUSIVE', rows: [] };
  return verdictOf(Object.fromEntries(Object.entries(grown).map(([k, g]) => [k, g.chats])), B);
}

// Verdict over stopped cells (never called while any cell is CAP or any control is FAIL-CONFIRMED).
// A cell passes when, in each gating style (ask, MC-2661), the point recall is at least 0.5 and the point d at least
// 0.15. Allude rows are computed and listed with reportOnly: true; they never set pass or borderline.
export function verdictOf(cells, B = B_VERDICT) {
  const rows = [];
  let pass = true, borderline = false;
  for (const [name, chats] of Object.entries(cells)) {
    const st = cellStats(chats, B);
    for (const style of STYLES) {
      const gating = GATING_STYLES.includes(style);
      const rc = st[style].recall.point, d = st[style].d.point;
      const ok = rc >= 0.5 && d >= 0.15;
      const border = ok && (st[style].recall.boot.lo < 0.5 || st[style].d.boot.lo < 0.15);
      if (gating && !ok) pass = false;
      if (gating && border) borderline = true;
      rows.push({ cell: name, style, recall: rc, d, n: st[style].n, ok, borderline: border, recallCI: st[style].recall.boot, dCI: st[style].d.boot, recallT: st[style].recall.t, dT: st[style].d.t, ...(gating ? {} : { reportOnly: true }) });
    }
  }
  return { verdict: pass ? (borderline ? 'PASS (BORDERLINE)' : 'PASS') : 'FAIL', rows };
}
