// Parallel exhaustive explorer: shared visited table (96-bit fingerprints, lock-free insert) + seeded DFS workers.
// Usage: node pexplore.mjs <preset> [--workers 24] [--bits 28] [--seeds 20000] [--all] [--out file.json] [--set k=v ...]
// Every state is expanded exactly once (by whichever worker inserts its fingerprint first); the union of all
// workers' expansions is the full reachable space. Violations are reported with the full path from the start.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DEFAULT, initial, successors, invariant, enc } from './model.mjs';
import { PRESETS } from './presets.mjs';
import fs from 'node:fs';

import crypto from 'node:crypto';
// 96-bit fingerprint: the first 12 bytes of SHA-1 of the canonical state string
function hash3(str) {
  const b = crypto.hash('sha1', str, 'buffer');
  return [b.readInt32LE(0), b.readInt32LE(4), b.readInt32LE(8)];
}

// slot = 3 x int32: w0 claimed by CAS (never 0), w1 (never 0) published after the claim, w2
function insert(t, mask, str) {
  let [a, b, c] = hash3(str);
  if (a === 0) a = 1; if (b === 0) b = 1;
  let i = (a >>> 0) & mask;
  for (;;) {
    const o = 3 * i;
    const cur = Atomics.compareExchange(t, o, 0, a);
    if (cur === 0) { Atomics.store(t, o + 2, c); Atomics.store(t, o + 1, b); return true; }
    if (cur === a) {
      let w1; while ((w1 = Atomics.load(t, o + 1)) === 0) { /* publisher is between claim and publish */ }
      if (w1 === b && Atomics.load(t, o + 2) === c) return false;
    }
    i = (i + 1) & mask;
  }
}

if (isMainThread) {
  const args = process.argv.slice(2);
  const presetName = args[0];
  let workers = 24, bits = 28, nSeeds = 20000, all = false, outFile = null;
  const sets = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--workers') workers = +args[++i];
    else if (args[i] === '--bits') bits = +args[++i];
    else if (args[i] === '--seeds') nSeeds = +args[++i];
    else if (args[i] === '--all') all = true;
    else if (args[i] === '--out') outFile = args[++i];
    else if (args[i] === '--set') { const [k, v] = args[++i].split('='); sets[k] = v === 'true' ? true : v === 'false' ? false : (isNaN(+v) ? v : +v); }
  }
  const cfg = { ...DEFAULT, ...PRESETS[presetName], ...sets };
  const t0 = Date.now();
  const sab = new SharedArrayBuffer(3 * 4 * (2 ** bits));
  const table = new Int32Array(sab);
  const mask = 2 ** bits - 1;
  const ctl = new Int32Array(new SharedArrayBuffer(16)); // 0 next seed, 1 stop flag, 2 states-so-far (approx)
  const stats0 = { cats: new Map(), maxRetry: 0, boundHit: 0, c409(c, r) { const k = c + ' => ' + r; this.cats.set(k, (this.cats.get(k) || 0) + 1); }, noteRetry(n) { if (n > this.maxRetry) this.maxRetry = n; }, obs(m) { const k = 'OBS: ' + m; this.cats.set(k, (this.cats.get(k) || 0) + 1); } };

  // seed phase: BFS (single thread) until the frontier is large enough
  const init = initial(cfg);
  let states = 0, transitions = 0, terminals = 0, both0 = 0;
  const violations = [];
  insert(table, mask, enc(init)); states++;
  let frontier = [{ st: init, path: [] }];
  let depth = 0;
  while (frontier.length < nSeeds && frontier.length > 0) {
    const next = [];
    for (const f of frontier) {
      const ss = successors(f.st, cfg, stats0);
      if (ss.length === 0) terminals++;
      for (const sc of ss) {
        transitions++;
        const msg = sc.viol || invariant(sc.st, cfg);
        if (msg) { violations.push({ msg, trace: f.path.concat([sc.l]) }); continue; }
        if (insert(table, mask, enc(sc.st))) { states++; if (sc.st.h === 3) both0++; next.push({ st: sc.st, path: f.path.concat([sc.l]) }); }
      }
    }
    frontier = next; depth++;
    if (violations.length && !all) break;
  }
  // seeds were already inserted by the BFS above; workers must still expand them: mark them via a per-seed flag
  const seeds = frontier;
  console.error(`seed phase: depth ${depth}, ${seeds.length} seeds, ${states} states, ${violations.length} violations, ${(Date.now() - t0) / 1000}s`);

  let done = 0; const agg = { states: 0, transitions: 0, terminals: 0, both: both0, maxDepth: 0, maxRetry: stats0.maxRetry, boundHit: stats0.boundHit, cats: new Map(stats0.cats) };
  const finish = () => {
    const r = {
      preset: presetName, mode: 'parallel (shared 96-bit fingerprint table)', cfg, workers, tableSlots: 2 ** bits,
      states: states + agg.states, transitions: transitions + agg.transitions, maxDepth: depth + agg.maxDepth,
      terminalStates: terminals + agg.terminals, statesWithBothDevicesCommitted: agg.both, violations: violations.length,
      seconds: (Date.now() - t0) / 1000, maxRetryObserved: Math.max(agg.maxRetry, stats0.maxRetry), retryBoundHits: agg.boundHit,
      c409: Object.fromEntries(agg.cats),
    };
    console.log(JSON.stringify(r, null, 1));
    if (violations.length) {
      const v = violations[0];
      console.log('\nVIOLATION: ' + v.msg + `\nTrace (${v.trace.length} steps):`);
      v.trace.forEach((l, i) => console.log(String(i + 1).padStart(3) + '. ' + l));
    }
    if (outFile) fs.writeFileSync(outFile, JSON.stringify({ result: r, violations: violations.slice(0, 20) }, null, 1));
    process.exit(violations.length ? 2 : 0);
  };
  if (seeds.length === 0 || (violations.length && !all)) finish();
  const ws = [];
  for (let w = 0; w < workers; w++) {
    const wk = new Worker(new URL(import.meta.url), { workerData: { cfg, seeds, sab, ctlBuf: ctl.buffer, mask, all } });
    wk.on('message', (m) => {
      if (m.type === 'full') { console.error('TABLE NEARLY FULL: rerun with larger --bits'); process.exit(4); }
      else if (m.type === 'violation') { violations.push(m.v); if (!all) { Atomics.store(ctl, 1, 1); } }
      else if (m.type === 'done') {
        agg.states += m.states; agg.transitions += m.transitions; agg.terminals += m.terminals; agg.both += m.both; agg.maxDepth = Math.max(agg.maxDepth, m.maxDepth);
        agg.maxRetry = Math.max(agg.maxRetry, m.maxRetry); agg.boundHit += m.boundHit;
        for (const [k, v] of m.cats) agg.cats.set(k, (agg.cats.get(k) || 0) + v);
        if (++done === workers) finish();
      }
    });
    wk.on('error', (e) => { console.error('worker error', e); process.exit(3); });
    ws.push(wk);
  }
  setInterval(() => console.error(`  ~${(Atomics.load(ctl, 2) * 65536 / 1e6).toFixed(0)}M states (worker-side), seed ${Atomics.load(ctl, 0)}/${seeds.length}, ${((Date.now() - t0) / 1000).toFixed(0)}s`), 30000).unref();
} else {
  const { cfg, seeds, sab, ctlBuf, mask, all } = workerData;
  const table = new Int32Array(sab); const ctl = new Int32Array(ctlBuf);
  const stats = { cats: new Map(), maxRetry: 0, boundHit: 0, c409(c, r) { const k = c + ' => ' + r; this.cats.set(k, (this.cats.get(k) || 0) + 1); }, noteRetry(n) { if (n > this.maxRetry) this.maxRetry = n; }, obs(m) { const k = 'OBS: ' + m; this.cats.set(k, (this.cats.get(k) || 0) + 1); } };
  let states = 0, transitions = 0, terminals = 0, maxDepth = 0, nviol = 0, both = 0;
  for (;;) {
    if (!all && Atomics.load(ctl, 1)) break;
    const idx = Atomics.add(ctl, 0, 1);
    if (idx >= seeds.length) break;
    const seed = seeds[idx];
    // seeds were inserted by the seed phase but never expanded: expand each exactly once (the claim is the index)
    const ss0 = successors(seed.st, cfg, stats);
    if (ss0.length === 0) terminals++;
    const stack = [{ succ: ss0, i: 0 }]; const path = seed.path.slice();
    let local = 0;
    while (stack.length) {
      if (!all && (local & 1023) === 0 && Atomics.load(ctl, 1)) break;
      const fr = stack[stack.length - 1];
      if (fr.i >= fr.succ.length) { stack.pop(); path.pop(); continue; }
      const sc = fr.succ[fr.i++];
      transitions++;
      if (stack.length > maxDepth) maxDepth = stack.length;
      const msg = sc.viol || invariant(sc.st, cfg);
      if (msg) {
        nviol++;
        parentPort.postMessage({ type: 'violation', v: { msg, trace: path.concat([sc.l]) } });
        if (!all || nviol > 20) { Atomics.store(ctl, 1, 1); if (!all) break; }
        continue;
      }
      if (!insert(table, mask, enc(sc.st))) continue;
      states++; local++; if (sc.st.h === 3) both++;
      if ((states & 0xffff) === 0) { const tot = Atomics.add(ctl, 2, 1) + 1; if (tot * 65536 > 0.85 * (mask + 1)) { parentPort.postMessage({ type: 'full' }); Atomics.store(ctl, 1, 1); } }
      const ss = successors(sc.st, cfg, stats);
      if (ss.length === 0) terminals++;
      path.push(sc.l);
      stack.push({ succ: ss, i: 0 });
    }
  }
  parentPort.postMessage({ type: 'done', both, states, transitions, terminals, maxDepth, maxRetry: stats.maxRetry, boundHit: stats.boundHit, cats: [...stats.cats] });
}
