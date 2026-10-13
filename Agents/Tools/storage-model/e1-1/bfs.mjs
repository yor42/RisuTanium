// Level-order BFS with a 96-bit fingerprint table and replay-based trace reconstruction: finds a SHORTEST counterexample.
// Usage: node bfs.mjs <preset> [--set k=v ...] [--bits 26] [--cap 100000000] [--out file.json]
// Exit: 2 violation (shortest trace printed), 0 space exhausted without violation, 5 state cap reached (inconclusive).
import { DEFAULT, initial, successors, invariant, enc } from './model.mjs';
import { PRESETS } from './presets.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
const presetName = args[0];
let bits = 26, cap = 100000000, outFile = null;
const sets = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--bits') bits = +args[++i];
  else if (args[i] === '--cap') cap = +args[++i];
  else if (args[i] === '--out') outFile = args[++i];
  else if (args[i] === '--set') { const [k, v] = args[++i].split('='); sets[k] = v === 'true' ? true : v === 'false' ? false : (isNaN(+v) ? v : +v); }
}
if (!PRESETS[presetName]) throw new Error('unknown preset ' + presetName);
const cfg = { ...DEFAULT, ...PRESETS[presetName], ...sets };
const stats = { cats: new Map(), maxRetry: 0, boundHit: 0, c409(c, r) { const k = c + ' => ' + r; this.cats.set(k, (this.cats.get(k) || 0) + 1); }, noteRetry(n) { if (n > this.maxRetry) this.maxRetry = n; }, obs() {} };

const slots = 2 ** bits, mask = slots - 1;
const table = new Int32Array(4 * slots);
let nodes = 0;
const parent = new Int32Array(Math.min(cap + 1, 400000000));
const child = new Uint8Array(parent.length);
function insert(str, idx) {
  const b = crypto.hash('sha1', str, 'buffer');
  let a = b.readInt32LE(0), c = b.readInt32LE(4), d = b.readInt32LE(8);
  if (a === 0) a = 1;
  let i = (a >>> 0) & mask;
  for (;;) {
    const o = 4 * i;
    if (table[o] === 0) { table[o] = a; table[o + 1] = c; table[o + 2] = d; table[o + 3] = idx + 1; return true; }
    if (table[o] === a && table[o + 1] === c && table[o + 2] === d) return false;
    i = (i + 1) & mask;
  }
}
const t0 = Date.now();
const init = initial(cfg);
const bad0 = invariant(init, cfg);
if (bad0) { console.log('VIOLATION at the initial state: ' + bad0); process.exit(2); }
// the initial state is not normalised by successors(); keep it as is (rank 1 already)
insert(enc(init), 0); parent[0] = -1; nodes = 1;
let frontier = [{ st: init, idx: 0 }];
let depth = 0, transitions = 0, found = null, capped = false;
while (frontier.length && !found) {
  const next = [];
  for (const f of frontier) {
    const ss = successors(f.st, cfg, stats);
    for (let i = 0; i < ss.length; i++) {
      transitions++;
      const sc = ss[i];
      const msg = sc.viol || invariant(sc.st, cfg);
      if (msg) { if (!found) found = { msg, parentIdx: f.idx, childI: i }; continue; }
      if (nodes >= parent.length - 1) { capped = true; continue; }
      if (insert(enc(sc.st), nodes)) { parent[nodes] = f.idx; child[nodes] = i; next.push({ st: sc.st, idx: nodes }); nodes++; }
    }
    if (capped) break;
  }
  depth++;
  frontier = next;
  if (nodes > cap) { capped = true; }
  if (capped) break;
  if (depth % 2 === 0) console.error(`depth ${depth}: ${nodes} states, frontier ${frontier.length}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const res = { preset: presetName, states: nodes, transitions, depthCompleted: depth, seconds: (Date.now() - t0) / 1000, bits, cap, capped, violation: !!found };
console.log(JSON.stringify(res));
if (found) {
  // rebuild the child-index path, then replay it
  const path = [found.childI];
  let p = found.parentIdx;
  while (p > 0) { path.push(child[p]); p = parent[p]; }
  path.reverse();
  let st = initial(cfg); const labels = [];
  for (const ci of path) { const ss = successors(st, cfg, stats); labels.push(ss[ci].l); st = ss[ci].st; }
  console.log('\nVIOLATION: ' + found.msg + `\nTrace (${labels.length} steps):`);
  labels.forEach((l, i) => console.log(String(i + 1).padStart(3) + '. ' + l));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ result: res, msg: found.msg, trace: labels }, null, 1));
  process.exit(2);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ result: res }, null, 1));
process.exit(capped ? 5 : 0);
