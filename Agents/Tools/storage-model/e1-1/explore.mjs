// Exhaustive explorer. Usage: node explore.mjs <preset> [--mode dfs|bfs|exact] [--bits 27] [--set k=v ...] [--all]
// dfs   : depth-first, visited set = 2x32-bit hashes (reported as the reduction); first violation stops unless --all
// exact : depth-first with an exact string Set (used to prove the hashed count equals the exact count)
// bfs   : breadth-first with exact strings and parent links; gives a SHORTEST counterexample
import { DEFAULT, initial, successors, invariant, enc } from './model.mjs';
import { PRESETS } from './presets.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);
const presetName = args[0];
let mode = 'dfs', bits = 27, all = false, outFile = null, maxStates = Infinity;
const sets = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--mode') mode = args[++i];
  else if (args[i] === '--bits') bits = +args[++i];
  else if (args[i] === '--all') all = true;
  else if (args[i] === '--out') outFile = args[++i];
  else if (args[i] === '--max') maxStates = +args[++i];
  else if (args[i] === '--set') { const [k, v] = args[++i].split('='); sets[k] = v === 'true' ? true : v === 'false' ? false : (isNaN(+v) ? v : +v); }
}
const cfg = { ...DEFAULT, ...(PRESETS[presetName] || (() => { throw new Error('unknown preset ' + presetName); })()), ...sets };

const stats = {
  cats: new Map(), maxRetry: 0, boundHit: 0,
  c409(cat, remedy) { const k = cat + ' => ' + remedy; this.cats.set(k, (this.cats.get(k) || 0) + 1); },
  noteRetry(n) { if (n > this.maxRetry) this.maxRetry = n; },
  obs(m) { const k = 'OBS: ' + m; this.cats.set(k, (this.cats.get(k) || 0) + 1); },
};

// ---- hashing ----
function hash2(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9747b28c, h4 = 0x85ebca6b;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 2246822519); h4 = Math.imul(h4 ^ c, 3266489917);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 15), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  return [(h1 ^ h3) >>> 0, (h2 ^ h4) >>> 0];
}
class HashSet {
  constructor(bits) { this.n = 1 << bits; this.mask = this.n - 1; this.a = new Uint32Array(this.n); this.b = new Uint32Array(this.n); this.used = new Uint8Array(this.n); this.size = 0; }
  add(str) { // true if new
    const [x, y] = hash2(str);
    let i = x & this.mask;
    while (this.used[i]) { if (this.a[i] === x && this.b[i] === y) return false; i = (i + 1) & this.mask; }
    if (this.size > this.n * 0.8) throw new Error('hash table full; raise --bits');
    this.used[i] = 1; this.a[i] = x; this.b[i] = y; this.size++; return true;
  }
}

const init = initial(cfg);
const t0 = Date.now();
let transitions = 0, maxDepth = 0, terminals = 0, violations = [];
const termKinds = new Map();

function report(extra) {
  const r = {
    preset: presetName, mode, cfg, states: extra.states, transitions, maxDepth, terminalStates: terminals,
    violations: violations.length, seconds: (Date.now() - t0) / 1000,
    maxRetryObserved: stats.maxRetry, retryBoundHits: stats.boundHit,
    c409: Object.fromEntries(stats.cats),
  };
  return r;
}

function finish(states) {
  const r = report({ states });
  console.log(JSON.stringify(r, null, 1));
  if (violations.length) {
    const v = violations[0];
    console.log('\nVIOLATION: ' + v.msg + `\nTrace (${v.trace.length} steps):`);
    v.trace.forEach((l, i) => console.log(String(i + 1).padStart(3) + '. ' + l));
  }
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ result: r, violations }, null, 1));
  process.exit(violations.length ? 2 : 0);
}

function isTerminal(st) { return successors(st, cfg, { c409() {}, noteRetry() {}, obs() {}, boundHit: 0 }).length === 0; }

if (mode === 'bfs') {
  const seen = new Map(); // enc -> index
  const nodes = [{ st: init, parent: -1, l: '(initial)' }];
  seen.set(enc(init), 0);
  let head = 0, depth = 0, states = 1;
  const bad0 = invariant(init, cfg);
  if (bad0) { violations.push({ msg: bad0, trace: ['(initial)'] }); finish(1); }
  let levelEnd = 1;
  while (head < nodes.length) {
    if (head === levelEnd) { depth++; levelEnd = nodes.length; }
    const nd = nodes[head];
    const succ = successors(nd.st, cfg, stats);
    if (succ.length === 0) terminals++;
    for (const sc of succ) {
      transitions++;
      let msg = sc.viol || invariant(sc.st, cfg);
      const e = enc(sc.st);
      if (msg) {
        const trace = [sc.l]; let p = head; while (p > 0) { trace.push(nodes[p].l); p = nodes[p].parent; }
        trace.reverse(); violations.push({ msg, trace });
        if (!all) { maxDepth = depth + 1; finish(seen.size); }
      }
      if (!seen.has(e)) { seen.set(e, nodes.length); nodes.push({ st: sc.st, parent: head, l: sc.l }); }
    }
    nd.st = null; // free memory once expanded
    head++;
    if (seen.size > maxStates) { console.log('STATE CAP reached'); break; }
  }
  maxDepth = depth;
  finish(seen.size);
} else {
  // DFS with explicit stack
  const exact = mode === 'exact' ? new Set() : null;
  const hs = mode === 'exact' ? null : new HashSet(bits);
  const addNew = (s) => (exact ? (exact.has(s) ? false : (exact.add(s), true)) : hs.add(s));
  const sizeOf = () => (exact ? exact.size : hs.size);
  addNew(enc(init));
  const bad0 = invariant(init, cfg);
  if (bad0) { violations.push({ msg: bad0, trace: ['(initial)'] }); finish(1); }
  const stack = [{ succ: successors(init, cfg, stats), i: 0 }];
  const path = [];
  if (stack[0].succ.length === 0) terminals++;
  while (stack.length) {
    const fr = stack[stack.length - 1];
    if (fr.i >= fr.succ.length) { stack.pop(); path.pop(); continue; }
    const sc = fr.succ[fr.i++];
    transitions++;
    if (stack.length > maxDepth) maxDepth = stack.length;
    const msg = sc.viol || invariant(sc.st, cfg);
    if (msg) {
      violations.push({ msg, trace: path.concat([sc.l]) });
      if (!all) finish(sizeOf());
      if (violations.length > 50) finish(sizeOf());
      continue; // do not extend beyond a violating state
    }
    if (!addNew(enc(sc.st))) continue;
    const ss = successors(sc.st, cfg, stats);
    if (ss.length === 0) terminals++;
    path.push(sc.l);
    stack.push({ succ: ss, i: 0 });
    const n = sizeOf();
    if (n % 5000000 === 0) console.error(`  ${n} states, ${transitions} transitions, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (n > maxStates) { console.log('STATE CAP reached'); finish(n); }
  }
  finish(sizeOf());
}
