// E1-1 protocol model (extends the S0-5a model: server + actors + step function, pure, no clock).
// Base: the verified S0-5a copy (verify/v-5a-16/modelv/model.mjs, with the verifier's switches noG, dropMarker,
// noPfxSkip, restoreNoIf) plus correction 7 (crash point after the bulk-marker write: nd.cm.wr = 1, taken from s0-5a).
// Every server operation is ONE atomic step (the server serialises per-key locks; sorted lock order is checked
// separately in locks.mjs). Between any two steps of an actor, any other actor steps: unbounded delay.
// With every E1 feature switched off (the DEFAULT) this is the S0-5a model: BFS control traces and state counts match.
//
// E1-1 additions (see results.md for the modelling assumptions):
//  (a) lost responses: cfg.lost per actor (A B G Q R), any write kind;     (b) save-mine (cfg.saveMine, off Node);
//  (c) pins (cfg.pinOps), admission (cfg.admission), restore that always pushes;  (d) abandon-clear (cfg.abandonClear);
//  (f) IndexedDB single-transaction commit + in-transaction GC check (cfg.idb); Tauri variant (cfg.tauri) with flush faults;
//  (g) recovery through the bulk path (actor R) racing GC, with commit-key damage (cfg.damage, cfg.recoveries).

export const DEFAULT = {
  K: 2,               // check-only limit per request
  ordData: 1,         // data units in an ordinary commit (+ manifest = 2 new units <= K)
  bulkData: 2,        // data units in the bulk commit (+ manifest = 3 new units > K)
  RL: 2,              // retained list limit
  RB: 2,              // retry bound
  crashes: 1,         // crashes per actor
  crashPoints: 'writes', // see devCrashPoint; 'all' = after every step
  crashSet: 'ABGQR',  // which actors may crash (A, B = devices, G = GC, Q = restorer, R = recovery)
  ordA: 2, ordB: 2,   // ordinary commits per device
  bulkA: 1,           // bulk commits (device A)
  gcRuns: 1, restores: 1,
  startupClear: true, // owner start-up clear of its own marker
  foreignClear: false,// device B may clear a foreign marker after a prompt
  offNode: false,     // off-Node variant: no check-only, full-bytes CAS (ground-truth version here)
  // protocol switches; the controls turn exactly one off
  gcCheck: true,      // (i) GC remove carries check-only commitKey==R (Node) / in-transaction check (IndexedDB)
  unitCheck: true,    // (ii) writer CAS carries check-only on new units
  sepRetention: false,// (iii) retention list in a separate key
  noMarker: false,    // (iv) bulk without the staging marker
  freshRead: false,   // (v) writer CAS uses a fresh read instead of the base version
  gcAtomicMarks: true,// GC reads all named manifests in one step (immutable data; cross-checked with false)
  normalize: true,    // rank-compress commit-key versions and forget tombstones (see norm)
  reload: false,      // a 409 on the commit key may also RELOAD (re-read, continue) besides PARK
  redo: false,        // with reload: the reloaded device re-applies its edit (ordinary commit / pin), at most RB times per device
  gcOrder: 'any',     // 'any' = GC deletes its candidates in any order; 'sorted' = ascending key order only (smaller, weaker)
  gcBatch: 1,         // keys per atomic /api/remove batch; 1 = most interleavings
  // verifier switches (S0-5a verification)
  noG: false, dropMarker: false, noPfxSkip: false, restoreNoIf: false,
  // ---- E1-1 features: all off = S0-5a ----
  faultCap: Infinity,                 // scope bound: at most this many crash + lost-response events in total across all actors (exhaustive inside the bound)
  recNoCheck: false,                  // (follow-up) fix candidates without the existence check inside the marker write
  recFix: '',                         // F1 fix candidates: 'rec' = marker carries rec (GC treats it as live, clears install it); 'cur' = marker names the chosen manifest as current; both verify the chosen manifest and units inside the marker write (check-only on Node, in-transaction off Node)
  merge: false,                       // reduction R2: GC pass = ONE atomic step (list, read commit key, read manifests, mark); restore begin fused with its read
  lossProp: false,                    // property (L): after an interrupted recovery is cleared, some candidate manifest with all units must remain
  lost: 0, lostSet: 'ABGQR',          // (a) lost responses per actor (applied, response never arrives)
  admission: false,                   // (c) previous current enters retained only by a nondeterministic admit (forced when retained is empty)
  pinOps: 0,                          // (c) pin changes device B may make (pin or unpin one manifest)
  abandonClear: false,                // (d) a bulk owner may abandon-clear its own marker after a conflict
  saveMine: 0,                        // (b) save-mine offers per device (off Node only)
  idb: false,                         // (f) IndexedDB variant (offNode too): ordinary commit = ONE transaction, no mutex
  tauri: false,                       // Tauri variant (offNode too): in-process mutex, durable-write faults
  damage: 0, damageMode: 'silent',    // (g) commit-key damage events; 'silent' = revision unchanged (Node file damage), 'bump' = bytes differ (off Node)
  recoveries: 0,                      // (g) recovery runs (actor R)
  ownerFresh: false,                  // owner id per incarnation (web) instead of stable per device (Tauri)
  seqTrack: false,                    // track commit-key seq (needed only for the seq-only mutant)
  orphanAbs: false,                   // reduction R1: a lost response on a DATA-unit upload leaves no orphan key (see results.md)
  flushFail: 0, ckFlushFail: 0, powerLoss: 0, // Tauri faults: unit flush failures, commit-key flush failures, power losses
  // ---- E1-1 mutants (each must produce a violation) ----
  aclearNoCheck: false,   // abandon-clear without the id-and-prefix check
  aclearNoRead: false,    // no read after an uncertain final CAS: blind abandon-clear, retried at the 409's currentRevision
  restoreDropStg: false,  // restore CAS drops staging
  restoreNoPush: false,   // restore does not push current
  smDropStg: false, smDropPins: false, // save-mine drops staging / pins
  markIgnoresPins: false, // GC mark ignores pins
  reuseUnits: false,      // off Node: a retry after a reload reuses the units uploaded (or planned) earlier
  idbSplit: false,        // IndexedDB commit split across two transactions (units, then commit key)
  gcCheckOutside: false,  // IndexedDB GC check outside its transaction (check step, then delete step)
  ckBeforeUnits: false,   // Tauri: commit-key write before the durable units
  nameUnflushed: false,   // Tauri: a commit names a unit whose flush failed
  tauriGcIgnoresCkFlag: false, // (extra) Tauri GC does not refuse while a commit-key flush is unconfirmed
  recDirect: false,       // recovery installs the chosen manifest's existing units directly (no marker fence, no rewrite)
  recRetryBlind: false,   // (extra) recovery retries the marker CAS at the 409's version without re-reading
  seqOnly: false,         // seq-only compare off Node
  gcOutsidePrefix: false, // GC/retire reaches a key outside the A-lite prefix (the commit key)
  replayV1: false,        // Node restart replayed by the S0-13 version-1 parser (delete records ignored)
};

const UNIT_PFX = ['u/', 'm/', 's/'];

// Crash points. 'all': after every step of the actor. 'writes' (default): only where the actor's own server WRITE has
// happened since its last restart/commit boundary (see S0-5a results for the soundness argument).
function devCrashPoint(d, cfg) {
  if (cfg.crashPoints === 'all') return !(d.pc === 'idle' && d.ord === 0 && d.bulk === 0 && !d.resume);
  if (d.pc === 'up') return !!(d.cm && d.cm.wr);
  if (d.pc === 'cas' || d.pc === 'fresh' || d.pc === 'b3' || d.pc === 'rt' || d.pc === 'unc' || d.pc === 'acCas' || d.pc === 'acBlind') return true;
  if (d.pc === 'idle') return d.seq > 0 && (d.ord > 0 || d.bulk > 0 || d.parked === 1 || (d.base && d.base.stg !== null) || d.pn > 0);
  return false;
}
function cloneDev(d) { return { ...d, cm: d.cm ? { ...d.cm, todo: d.cm.todo.slice(), keys: d.cm.keys.slice(), revs: d.cm.revs.slice() } : null }; }
const nFaults = (st) => st.A.cr + st.A.lr + st.B.cr + st.B.lr + st.G.cr + st.G.lr + st.Q.cr + st.Q.lr + st.R.cr + st.R.lr;
const ownerOf = (cfg, d) => (cfg.ownerFresh ? d.id + d.cr : d.id);
const rOwner = (cfg, r) => (cfg.ownerFresh ? 'R' + r.cr : 'R');

export function initial(cfg) {
  const ck0 = { cur: 'm/0', ret: [], stg: null, pins: [] };
  if (cfg.seqTrack) ck0.seq = 1;
  const s = {
    CK: [ck0, 1, false],
    'm/0': cfg.seqTrack ? [['u/0'], 1, false, 0, 1] : [['u/0'], 1, false],
    'u/0': [null, 1, false],
  };
  if (cfg.sepRetention) s.RT = [{ ret: [] }, 1, false];
  const mk = (id, ord, bulk, pn) => ({
    id, pc: 'idle', base: { v: 1, m: 'm/0', ret: [], stg: null, pins: [], refs: ['u/0'], q: cfg.seqTrack ? 1 : undefined }, tmp: null,
    ord, bulk, inc: 0, seq: 0, bgen: 0, justR: 0, resume: null, cm: null, cr: 0, parked: 0, fc: 0, lr: 0, sm: 0, rl: 0, pn, unc: null, ac: null,
  });
  return {
    s,
    A: mk('A', cfg.ordA, cfg.bulkA, 0),
    B: mk('B', cfg.ordB, 0, cfg.pinOps),
    G: { pc: 'start', listed: [], R: 0, tmp: null, ms: [], mi: 0, marked: [], cand: [], ci: 0, tries: 0, runs: 0, cr: 0, lr: 0, pk: null },
    Q: { pc: 'start', tmp: null, runs: 0, tries: 0, cr: 0, lr: 0 },
    R: { pc: 'start', tmp: null, runs: 0, tries: 0, cr: 0, lr: 0, M: null, n: 0, q: 0, dv: 0, fv: 0, mv: 0, pfx: null, keys: [], todo: [], gen: 0, wr: 0, unc: null },
    env: { dmg: 0, ff: 0, ckff: 0, pl: 0, rs: 0, ckUnf: false, ckdur: null },
    mx: null,
  };
}

// ---- canonical encoding for dedup ----
// Components are immutable once they are part of a successor, so their encodings are cached by object identity.
const cacheS = new WeakMap(), cacheO = new WeakMap();
function encS(s) {
  let r = cacheS.get(s);
  if (r !== undefined) return r;
  const ks = Object.keys(s).sort();
  r = '';
  for (const k of ks) {
    const e = s[k];
    r += k + '=' + JSON.stringify(e[0]) + ',' + e[1] + (e[2] ? 'T' : '') + (e[3] ? 'U' : '') + (e[4] !== undefined ? 'q' + e[4] : '') + (e[5] ? 'G' : '') + ';';
  }
  cacheS.set(s, r);
  return r;
}
function encO(o) {
  let r = cacheO.get(o);
  if (r === undefined) { r = JSON.stringify(o); cacheO.set(o, r); }
  return r;
}
export function enc(st) {
  return encS(st.s) + '|' + encO(st.A) + '|' + encO(st.B) + '|' + encO(st.G) + '|' + encO(st.Q) + '|' + encO(st.R) + '|' + encO(st.env) + '|' + st.mx;
}

// ---- helpers ----
const exists = (s, k) => s[k] && !s[k][2];
function underPrefix(k, stg) { return stg && k.startsWith(stg[1]); }
// retention push: the previous current enters at the front; overflow drops the oldest UNPINNED entry
function pushRet(prev, ret, RL, pins) {
  const l = [prev, ...ret.filter((x) => x !== prev)];
  while (l.length > RL) {
    let i = l.length - 1;
    while (i >= 0 && pins.includes(l[i])) i--;
    if (i < 0) break;
    l.splice(i, 1);
  }
  return l;
}
// admission: forced when retained is empty, otherwise a nondeterministic admit-or-drop (the clock is never a safety input)
function retVariants(b, cfg) {
  if (cfg.sepRetention) return [{ ret: [], tag: '' }];
  const rot = pushRet(b.m, b.ret, cfg.RL, b.pins);
  if (cfg.admission && b.ret.length > 0) return [{ ret: rot, tag: ' [prev admitted]' }, { ret: b.ret, tag: ' [prev dropped by admission]' }];
  return [{ ret: rot, tag: '' }];
}
function mkEntry(cfg, val, q) { return cfg.seqTrack && q !== undefined ? [val, 1, false, 0, q] : [val, 1, false]; }
const view = (cv) => (cv.dmg ? cv.orig : cv); // ground-truth content of a possibly damaged commit key

// Applies a commit-key write. Returns {s, rev, seq, env, viol} or {conflict}. tag/ctx drive properties (g) (h) (p).
// w = {kind, who, ifV, ifSeq, builtFrom, val, units: [[key,rev]...] check-only, mk, rec, seqNew, ckff}
function ckWrite(st, cfg, w) {
  const s = st.s;
  const ck = s.CK;
  const cv = ck[0];
  const old = view(cv);
  const conflict = (cfg.offNode && cfg.seqOnly && !w.rec) ? (cv.dmg || cv.seq !== w.ifSeq) : ck[1] !== w.ifV;
  if (conflict) return { conflict: 'ck' };
  if (!cfg.offNode || w.force) {
    for (const [k, r] of w.units) {
      const e = s[k];
      if (!e || (e[2] && !e[5]) || e[1] !== r) return { conflict: 'unit', key: k };
    }
  }
  let viol = null;
  // (g) the replaced version must be the base the new value was built from
  if (!cfg.noG && w.ifV !== w.builtFrom) viol = `(g) ${w.who} ${w.kind} CAS replaced commit-key version ${w.ifV} but its value was built from version ${w.builtFrom}`;
  // (g') ground truth: a CAS must never succeed against a key other than its base (I3)
  if (!viol && ck[1] !== w.builtFrom) viol = `(g) ${w.who} ${w.kind} CAS succeeded against commit-key version ${ck[1]} but its value was built from version ${w.builtFrom} (compare did not identify the base)`;
  if (!viol && w.kind === 'rbegin' && !cv.dmg && cv.cur !== null) viol = `(g) recovery marker CAS replaced a healthy commit key`;
  // (h) staging marker changes only by allowed transitions
  const o = old.stg, n = w.val.stg;
  if (JSON.stringify(o) !== JSON.stringify(n)) {
    let ok = false;
    if (w.kind === 'bulk-begin') ok = (o === null || o[0] === w.who) && n && n[0] === w.who;
    else if (w.kind === 'bulk-final' || w.kind === 'rfinal') ok = o && o[0] === w.who && n === null;
    else if (w.kind === 'startclear') ok = o && o[0] === w.who && n === null;
    else if (w.kind === 'fclear') ok = o && o[0] !== w.who && n === null;
    else if (w.kind === 'aclear') ok = o && w.mk && o[0] === w.mk[0] && o[1] === w.mk[1] && n === null;
    else if (w.kind === 'rbegin') ok = n && n[0] === w.who;
    else if (w.kind === 'rinstall') ok = true;
    if (!ok && !viol) viol = `(h) ${w.who} ${w.kind} changed staging ${JSON.stringify(o)} -> ${JSON.stringify(n)} outside the allowed transitions`;
  }
  // (p) pins change only by a pin operation (recovery starts with none)
  if (!viol && w.kind !== 'pin' && w.kind !== 'rbegin' && w.kind !== 'rinstall' && JSON.stringify(old.pins) !== JSON.stringify(w.val.pins)) {
    viol = `(p) ${w.who} ${w.kind} changed pins ${JSON.stringify(old.pins)} -> ${JSON.stringify(w.val.pins)}`;
  }
  const nv = w.val;
  let seq;
  if (cfg.seqTrack) { seq = w.seqNew !== undefined ? w.seqNew : (old.seq | 0) + 1; nv.seq = seq; }
  const ns = Object.assign({}, s);
  ns.CK = [nv, ck[1] + 1, false];
  let env = st.env;
  if (cfg.tauri) {
    if (w.ckff) env = { ...env, ckff: env.ckff + 1, ckUnf: true, ckdur: env.ckUnf ? env.ckdur : { val: old, v: ck[1] } };
    else if (env.ckUnf) env = { ...env, ckUnf: false, ckdur: null };
  }
  return { s: ns, rev: ck[1] + 1, seq, env, viol };
}

// ---- the successor function ----
// returns array of {l, st, viol?}
export function successors(st, cfg, stats) {
  const out = [];
  devSucc(st, cfg, stats, 'A', out);
  devSucc(st, cfg, stats, 'B', out);
  gcSucc(st, cfg, stats, out);
  rsSucc(st, cfg, stats, out);
  recSucc(st, cfg, stats, out);
  let res = out;
  if (cfg.offNode && !cfg.idb) res = applyMutex(st, out);
  const envOut = [];
  envSucc(st, cfg, envOut);
  if (envOut.length) res = res.concat(envOut);
  if (cfg.normalize) for (const o of res) o.st = norm(o.st, cfg);
  return res;
}

// Environment faults: damage of the commit key, Node restart with the version-1 replay parser, Tauri power loss.
function envSucc(st, cfg, out) {
  const s = st.s, cv = s.CK[0], env = st.env;
  if (cfg.damage > env.dmg && !cv.dmg && !s.CK[2]) {
    const ns = Object.assign({}, s);
    ns.CK = [{ dmg: true, orig: cv }, cfg.damageMode === 'bump' ? s.CK[1] + 1 : s.CK[1], false];
    out.push({ l: `ENV: commit key DAMAGED (${cfg.damageMode}: revision ${cfg.damageMode === 'bump' ? 'changes' : 'unchanged'}, content unparsable)`, st: { ...st, s: ns, env: { ...env, dmg: env.dmg + 1 } } });
  }
  if (cfg.replayV1 && env.rs < 1) {
    const ns = Object.assign({}, s);
    let any = false;
    for (const k in s) {
      const e = s[k];
      if (k !== 'CK' && k !== 'RT' && e[2] && !e[5]) { ns[k] = [null, 1, true, 0, undefined, 1]; any = true; }
    }
    if (any) out.push({ l: 'ENV: Node RESTART replayed by the version-1 parser (delete records ignored: deleted keys read their old revision again)', st: { ...st, s: ns, env: { ...env, rs: env.rs + 1 } } });
  }
  if (cfg.tauri && cfg.powerLoss > env.pl && (env.ckUnf || Object.keys(s).some((k) => s[k][3] && !s[k][2]))) {
    const ns = {};
    for (const k in s) { const e = s[k]; if (!(e[3] && !e[2])) ns[k] = e; }
    if (env.ckUnf) ns.CK = [env.ckdur.val, s.CK[1] + 1, false];
    const crashed = (d) => ({ ...d, base: null, tmp: null, cm: null, unc: null, ac: null, justR: 1, resume: null, pc: 'rdCK', parked: 0 });
    const A = crashed(st.A), B = crashed(st.B);
    const G = { pc: 'start', listed: [], R: 0, tmp: null, ms: [], mi: 0, marked: [], cand: [], ci: 0, tries: 0, runs: st.G.runs, cr: st.G.cr, lr: st.G.lr, pk: null };
    const Q = { ...st.Q, pc: 'start', tmp: null };
    const R = { ...st.R, pc: 'start', tmp: null, unc: null };
    out.push({ l: 'ENV: POWER LOSS (unflushed unit writes vanish' + (env.ckUnf ? ', commit key reverts to its last durable value' : '') + '; every actor restarts)', st: { s: ns, A, B, G, Q, R, env: { ...env, pl: env.pl + 1, ckUnf: false, ckdur: null }, mx: null }, env: true });
  }
}

// Off-Node mutex variant (Tauri): ONE in-process mutex spans a commit (uploads through CAS), a GC pass (list through delete)
// and a restore. An actor inside its critical section keeps the mutex; a crash releases it.
const CRIT = {
  A: (p) => ['up', 'fresh', 'cas', 'b1', 'b3', 'rt'].includes(p.pc),
  B: (p) => ['up', 'fresh', 'cas', 'b1', 'b3', 'rt'].includes(p.pc),
  G: (p) => ['list', 'rdCK', 'rdRT', 'rdM', 'del'].includes(p.pc),
  Q: (p) => ['rdCK', 'rdRT', 'cas', 'rt'].includes(p.pc),
  R: () => false,
};
function applyMutex(st, out) {
  const res = [];
  for (const o of out) {
    let who = null;
    for (const k of ['A', 'B', 'G', 'Q', 'R']) if (o.st[k] !== st[k]) who = k;
    if (!who) { res.push(o); continue; }
    const before = CRIT[who](st[who]), after = CRIT[who](o.st[who]);
    if (!before && after) { if (st.mx !== null) continue; o.st = { ...o.st, mx: who }; }
    else if (before && !after) { o.st = { ...o.st, mx: null }; }
    else if (before && st.mx !== who) continue;
    res.push(o);
  }
  return res;
}
// Bisimulation-preserving canonicalisation (applied to every successor, reported as part of the reduction):
//  (1) commit-key versions are only ever compared for equality and bumped to a fresh larger value, so the absolute
//      numbers are replaced by their rank among the versions currently in use (order-preserving);
//  (2) tombstones are forgotten (an absent and a tombstoned key behave identically for every later step); replay ghosts stay.
function norm(st, cfg) {
  const s = st.s; const A = st.A, B = st.B, G = st.G, Q = st.Q, R = st.R, env = st.env;
  const va = [s.CK[1]];
  for (const d of [A, B]) { if (d.base) va.push(d.base.v); if (d.tmp && d.tmp.v) va.push(d.tmp.v); if (d.cm && d.cm.fv) va.push(d.cm.fv); }
  if (G.R) va.push(G.R);
  if (Q.tmp && Q.tmp.v) va.push(Q.tmp.v);
  if (R.dv) va.push(R.dv); if (R.fv) va.push(R.fv); if (R.mv) va.push(R.mv); if (R.tmp && R.tmp.v) va.push(R.tmp.v);
  if (env.ckdur) va.push(env.ckdur.v);
  va.sort((x, y) => x - y);
  let k2 = 0; for (let i = 0; i < va.length; i++) if (i === 0 || va[i] !== va[i - 1]) va[k2++] = va[i];
  va.length = k2;
  // fast path: ranks are the identity and the server map is already canonical (no tombstones, live revisions 1)
  let ident = true; for (let i = 0; i < k2; i++) if (va[i] !== i + 1) { ident = false; break; }
  if (ident) {
    let canon = true;
    for (const k in s) {
      if (k === 'CK' || k === 'RT') continue;
      const e = s[k];
      if ((e[2] && !e[5] && !cfg.replayV1) || e[1] !== 1) { canon = false; break; }
    }
    if (canon) return st;
  }
  const vs = va;
  const rank = new Map(va.map((v, i) => [v, i + 1]));
  const ns = {};
  for (const k in s) {
    const e = s[k];
    if (k === 'CK') ns[k] = [e[0], rank.get(e[1]), false];
    else if (k === 'RT') ns[k] = e;
    else if (!e[2] || e[5] || cfg.replayV1) { if (e[1] === 1 && e.length === 3) ns[k] = e; else { const ne = e.slice(); ne[1] = 1; ns[k] = ne; } }
  }
  const rd = (d) => {
    if (!d.base && !(d.tmp && d.tmp.v) && !(d.cm && d.cm.fv)) return d;
    const nd = { ...d };
    if (d.base) nd.base = { ...d.base, v: rank.get(d.base.v) };
    if (d.tmp && d.tmp.v) nd.tmp = { ...d.tmp, v: rank.get(d.tmp.v) };
    if (d.cm && d.cm.fv) nd.cm = { ...d.cm, fv: rank.get(d.cm.fv) };
    return nd;
  };
  const nG = G.R ? { ...G, R: rank.get(G.R) } : G;
  const nQ = Q.tmp && Q.tmp.v ? { ...Q, tmp: { ...Q.tmp, v: rank.get(Q.tmp.v) } } : Q;
  let nR = R;
  if (R.dv || R.fv || R.mv || (R.tmp && R.tmp.v)) {
    nR = { ...R };
    if (R.dv) nR.dv = rank.get(R.dv); if (R.fv) nR.fv = rank.get(R.fv); if (R.mv) nR.mv = rank.get(R.mv);
    if (R.tmp && R.tmp.v) nR.tmp = { ...R.tmp, v: rank.get(R.tmp.v) };
  }
  const nenv = env.ckdur ? { ...env, ckdur: { ...env.ckdur, v: rank.get(env.ckdur.v) } } : env;
  return { s: ns, A: rd(A), B: rd(B), G: nG, Q: nQ, R: nR, env: nenv, mx: st.mx };
}

function withDev(st, id, nd, ns, env) { const r = { ...st, s: ns || st.s }; r[id] = nd; if (env) r.env = env; return r; }

function nUnits(cm) { return cm.nd + 1; }
function keyFor(cfg, d, cm, slot) {
  if (cm.kind === 'b') return `${cm.pfx}${slot === cm.nd ? 'm' : 'd' + slot}${cfg.lost > 0 ? '.g' + cm.gen : ''}`;
  return `${slot === cm.nd ? 'm' : 'u'}/${d.id}${d.seq}.${slot}.g${cm.gen}`;
}

function devSucc(st, cfg, stats, id, out) {
  const d = st[id];
  const own = ownerOf(cfg, d);
  const push = (l, nd, ns, viol, env) => out.push({ l: `${id}: ${l}`, st: withDev(st, id, nd, ns, env), viol: viol ? `${viol}` : undefined });
  const s = st.s;
  const faultOk = nFaults(st) < cfg.faultCap;
  const canLose = faultOk && cfg.lost > (d.lr | 0) && cfg.lostSet.includes(id);
  const lostDev = () => { const nl = cloneDev(d); nl.lr = (d.lr | 0) + 1; return nl; };
  const baseFrom = (r, m, ret, stg, pins, refs, q) => ({ v: r, m, ret, stg, pins, refs, q });

  // crash: any time there is something to lose or resume
  if (faultOk && d.cr < cfg.crashes && cfg.crashSet.includes(id) && devCrashPoint(d, cfg)) {
    const nd = cloneDev(d);
    nd.base = null; nd.tmp = null; nd.cm = null; nd.justR = 1; nd.resume = null; nd.pc = 'rdCK'; nd.cr++; nd.parked = 0; nd.unc = null; nd.ac = null;
    push('CRASH (local state lost, restarts with a new incarnation)', nd);
  }

  // a commit-key conflict (409 or an uncertain commit found not landed): PARK, RELOAD, SAVE-MINE
  const ckConflict = (label, cm) => {
    const np = cloneDev(d); np.pc = 'idle'; np.parked = 1; np.cm = null; np.unc = null; push(`${label}; PARK (node-conflict)`, np);
    if (cfg.reload) {
      const nr = cloneDev(d); nr.pc = 'rdCK'; nr.base = null; nr.justR = 0; nr.unc = null;
      if (cfg.reuseUnits && cfg.offNode && cm && cm.kind === 'o') { nr.cm = { ...cm, keys: cm.keys.slice(), todo: [], revs: cm.revs.slice(), reuse: true }; nr.resume = cfg.idb && !cfg.idbSplit ? 'tx' : 'cas'; }
      else {
        nr.cm = null;
        if (cfg.redo && cm && cm.kind === 'o' && (d.rl | 0) < cfg.RB) { nr.rl = (d.rl | 0) + 1; nr.ord = d.ord + 1; } // the reloaded device re-applies its edit
      }
      push(`${label}; RELOAD (abandon commit, re-read)`, nr);
    }
    if (cfg.saveMine && cfg.offNode && (d.sm | 0) < cfg.saveMine && d.base && cm && cm.kind === 'o') {
      const ns2 = cloneDev(d); ns2.pc = 'sm'; ns2.sm = (d.sm | 0) + 1; ns2.unc = null;
      push(`${label}; SAVE-MINE chosen (rebuild from a fresh read)`, ns2);
    }
  };

  const pc = d.pc;
  if (pc === 'idle') {
    if (d.parked) return;
    if (d.ord > 0) {
      const nd = cloneDev(d); nd.ord--; nd.seq++;
      const n = cfg.ordData + 1;
      nd.cm = { kind: 'o', nd: cfg.ordData, todo: Array.from({ length: n }, (_, i) => i), keys: new Array(n).fill(null), revs: new Array(n).fill(0), gen: 0, retry: 0, fv: 0, wr: 0, pfx: null };
      if (cfg.idb && !cfg.idbSplit) nd.pc = 'tx';
      else if (cfg.ckBeforeUnits) { for (let j = 0; j < n; j++) { nd.cm.keys[j] = keyFor(cfg, nd, nd.cm, j); nd.cm.revs[j] = 1; } nd.cm.todo = []; nd.pc = 'cas'; }
      else nd.pc = 'up';
      push(`begin ordinary commit #${nd.seq}`, nd);
    }
    if (d.bulk > 0) {
      const nd = cloneDev(d); nd.bulk--; nd.seq++; nd.bgen = 0;
      const n = cfg.bulkData + 1;
      nd.cm = { kind: 'b', nd: cfg.bulkData, todo: Array.from({ length: n }, (_, i) => i), keys: new Array(n).fill(null), revs: new Array(n).fill(0), gen: 0, retry: 0, fv: 0, wr: 0, pfx: `s/${id}${nd.seq}.b0/` };
      if (cfg.noMarker) nd.pc = 'up'; else nd.pc = 'b1';
      push(`begin BULK commit #${nd.seq}`, nd);
    }
    if (d.pn > 0 && d.base) {
      const b = d.base;
      const targets = [];
      for (const x of [b.m, ...b.ret]) if (!b.pins.includes(x) && !targets.some((t) => t.x === x)) targets.push({ x, un: false });
      for (const x of b.pins) targets.push({ x, un: true });
      for (const t of targets) {
        const nd = cloneDev(d); nd.pn--; nd.pc = 'pin'; nd.tmp = { px: t.x, un: t.un };
        push(`begin ${t.un ? 'UNPIN' : 'PIN'} of ${t.x}`, nd);
      }
    }
    if (cfg.foreignClear && id === 'B' && d.fc < 1) {
      const nd = cloneDev(d); nd.fc++; nd.pc = 'fcRd';
      push('open foreign-marker prompt (read commit key)', nd);
    }
    return;
  }

  if (pc === 'rdCK') {
    const v = s.CK[0];
    const nd = cloneDev(d);
    if (v.dmg || v.cur === null) { nd.pc = 'idle'; nd.parked = 1; nd.tmp = null; nd.justR = 0; push(`read commit key -> ${v.dmg ? 'UNPARSABLE' : 'no current (recovery in progress)'}; PARK`, nd); return; }
    nd.tmp = { v: s.CK[1], m: v.cur, ret: v.ret.slice(), stg: v.stg, pins: v.pins.slice(), q: v.seq };
    if (cfg.sepRetention) nd.pc = 'rdRT';
    else if (d.justR && cfg.startupClear && v.stg && v.stg[0] === own) nd.pc = 'sc';
    else nd.pc = 'rdM';
    push(`read commit key -> v${s.CK[1]} cur=${v.cur} stg=${JSON.stringify(v.stg)}`, nd);
    return;
  }
  if (pc === 'rdRT') {
    const nd = cloneDev(d);
    nd.tmp = { ...d.tmp, ret: s.RT[0].ret.slice() };
    nd.pc = (d.justR && cfg.startupClear && d.tmp.stg && d.tmp.stg[0] === own) ? 'sc' : 'rdM';
    push(`read retention key -> ${JSON.stringify(s.RT[0].ret)}`, nd);
    return;
  }
  if (pc === 'sc') {
    const t = d.tmp;
    const val = { cur: t.m, ret: cfg.sepRetention ? [] : t.ret, stg: null, pins: t.pins };
    const r = ckWrite(st, cfg, { kind: 'startclear', who: own, ifV: t.v, ifSeq: t.q, builtFrom: t.v, val, units: [] });
    const nd = cloneDev(d);
    if (r.conflict) { nd.pc = 'rdCK'; nd.tmp = null; stats.c409('startclear/ck', 're-read, retry'); push('start-up clear CAS -> 409 (commit key); re-read', nd); return; }
    nd.tmp = { v: r.rev, m: t.m, ret: t.ret, stg: null, pins: t.pins, q: r.seq }; nd.pc = 'rdM'; nd.justR = 0;
    push(`owner start-up clear of own marker -> v${r.rev}`, nd, r.s, r.viol, r.env);
    if (canLose) { const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'sc' }; nl.tmp = null; push(`owner start-up clear applied -> v${r.rev}, RESPONSE LOST`, nl, r.s, r.viol, r.env); }
    return;
  }
  if (pc === 'rdM') {
    const t = d.tmp;
    const nd = cloneDev(d);
    if (!exists(s, t.m)) { nd.pc = 'rdCK'; nd.tmp = null; stats.c409('base manifest read 404', 're-read commit key'); push(`read manifest ${t.m} -> missing; re-read commit key`, nd); return; }
    nd.base = baseFrom(t.v, t.m, t.ret, t.stg, t.pins, s[t.m][0].slice(), t.q);
    nd.tmp = null; nd.justR = 0;
    if (d.resume) { nd.pc = d.resume; nd.resume = null; } else nd.pc = 'idle';
    push(`read manifest ${t.m}; base = v${t.v}`, nd);
    return;
  }

  if (pc === 'up') {
    const cm = d.cm; const j = cm.todo[0];
    const nd = cloneDev(d); const ncm = nd.cm;
    const k2 = keyFor(cfg, nd, cm, j);
    ncm.gen = cm.gen + 1; ncm.wr = 1; // a fresh key for every upload, retries included
    let viol = null;
    if (s[k2]) viol = `(d) ${id} uploaded to key ${k2} which already existed (rev ${s[k2][1]}${s[k2][2] ? ', tombstone' : ''})`;
    let val = null;
    if (j === cm.nd) val = d.base.refs.concat(cm.keys.slice(0, cm.nd));
    const entry = (u) => { const e = mkEntry(cfg, val, j === cm.nd && d.base.q !== undefined ? d.base.q + 1 : undefined); if (u) { while (e.length < 4) e.push(0); e[3] = 1; } return e; };
    const ns = Object.assign({}, s); ns[k2] = entry(false);
    ncm.keys[j] = k2; ncm.revs[j] = 1; ncm.todo.shift();
    const nextPc = () => { if (ncm.todo.length === 0) { if (cm.kind === 'b' && !cfg.noMarker) return 'b3'; return cfg.freshRead ? 'fresh' : 'cas'; } return 'up'; };
    nd.pc = nextPc();
    push(`upload ${k2} (rev 1)`, nd, ns, viol);
    if (canLose) { // applied, response lost: the uncertain write is re-uploaded under a new key (I2)
      if (cfg.orphanAbs && (j !== cm.nd || !cfg.recoveries)) { // reduction R1: the orphan is a dead key; its writer never names it again
        const nl = lostDev(); nl.cm.wr = 1;
        push(`upload ${k2} applied, RESPONSE LOST; re-upload under a new key (orphan abstracted away)`, nl);
      } else {
        const nl = lostDev(); nl.cm.gen = cm.gen + 1; nl.cm.wr = 1;
        push(`upload ${k2} applied, RESPONSE LOST; re-upload under a new key`, nl, ns, viol);
      }
    }
    if (cfg.tauri && st.env.ff < cfg.flushFail) { // the write landed but its directory flush failed: the unit is uncertain
      const nsu = Object.assign({}, s); nsu[k2] = entry(true);
      const env2 = { ...st.env, ff: st.env.ff + 1 };
      if (cfg.nameUnflushed) { const nm = cloneDev(nd); push(`upload ${k2} (rev 1, FLUSH FAILED but treated as written)`, nm, nsu, viol, env2); }
      else { const nf = cloneDev(d); nf.cm.gen = cm.gen + 1; nf.cm.wr = 1; push(`upload ${k2} applied, FLUSH FAILED; re-write under a new key`, nf, nsu, viol, env2); }
    }
    return;
  }
  if (pc === 'fresh') {
    const nd = cloneDev(d); nd.cm.fv = s.CK[1]; nd.pc = 'cas';
    push(`fresh read of commit key at commit time -> v${s.CK[1]}`, nd);
    return;
  }
  if (pc === 'cas' || pc === 'tx') {
    const cm = d.cm; const b = d.base; const n = nUnits(cm);
    let st2 = st, ns0 = s, newM, keys = null;
    if (pc === 'tx') { // IndexedDB: units and commit key in ONE readwrite transaction (all unit bytes ready beforehand)
      keys = cm.reuse && cm.keys[0] ? cm.keys.slice() : Array.from({ length: n }, (_, j) => keyFor(cfg, d, cm, j));
      newM = keys[cm.nd];
      if (!cm.reuse) {
        ns0 = Object.assign({}, s);
        for (let j = 0; j < n; j++) ns0[keys[j]] = j === cm.nd ? mkEntry(cfg, b.refs.concat(keys.slice(0, cm.nd)), b.q !== undefined ? b.q + 1 : undefined) : mkEntry(cfg, null, undefined);
        st2 = { ...st, s: ns0 };
      }
    } else newM = cm.keys[cm.nd];
    let units = [];
    if (cfg.unitCheck && pc === 'cas') units = cm.keys.map((k, i) => [k, cm.revs[i]]);
    if (cm.kind === 'b') units = units.slice(0, cfg.K); // control (iv): only the first K are checkable
    else if (n > cfg.K) throw new Error('ordinary commit exceeds K');
    const variants = retVariants(b, cfg);
    let first = true;
    const ckffOpts = cfg.tauri && st.env.ckff < cfg.ckFlushFail ? [false, true] : [false];
    for (const vr of variants) {
      for (const ckff of ckffOpts) {
        const val = { cur: newM, ret: vr.ret, stg: cfg.dropMarker ? null : b.stg, pins: b.pins };
        const r = ckWrite(st2, cfg, { kind: 'commit', who: own, ifV: cfg.freshRead ? cm.fv : b.v, ifSeq: b.q, builtFrom: b.v, val, units, ckff });
        const nd = cloneDev(d);
        if (!r.conflict) {
          let viol = r.viol;
          const allowed = new Set(pc === 'tx' && !cm.reuse ? keys : [...b.refs, ...cm.keys]);
          if (pc === 'tx' && !cm.reuse) for (const k of b.refs) allowed.add(k);
          for (const k of (r.s[newM] && r.s[newM][0] ? r.s[newM][0] : [])) if (!allowed.has(k)) viol = viol || `(i) ${id} manifest ${newM} names ${k}, outside what it uploaded or its base named`;
          nd.base = baseFrom(r.rev, newM, vr.ret, b.stg, b.pins, (r.s[newM] && r.s[newM][0] ? r.s[newM][0] : []).slice(), r.seq);
          if (cfg.sepRetention) { nd.tmp = { rt: pushRet(b.m, b.ret, cfg.RL, []) }; nd.pc = 'rt'; } else { nd.pc = 'idle'; nd.tmp = null; }
          stats.noteRetry(cm.retry);
          nd.cm = null;
          push(`${pc === 'tx' ? 'IDB transaction: units + ' : ''}commit CAS ok -> v${r.rev}, current=${newM}, retained=${JSON.stringify(vr.ret)}${vr.tag}${ckff ? ' [commit-key FLUSH FAILED]' : ''}`, nd, r.s, viol, r.env);
          if (canLose && !cfg.sepRetention) { const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'c', newM, keys }; push(`commit CAS applied -> v${r.rev}, RESPONSE LOST${vr.tag}`, nl, r.s, viol, r.env); }
          continue;
        }
        if (!first) continue;
        first = false;
        if (r.conflict === 'ck') {
          stats.c409('commit CAS: commit key moved', 'park or reload (never rebuild on the peer index)');
          if (pc === 'tx' && cfg.reuseUnits && cfg.reload) { const cm2 = { ...cm, keys: keys.slice() }; ckConflict('commit CAS -> 409 on commit key', cm2); }
          else ckConflict('commit CAS -> 409 on commit key', cm);
          return;
        }
        // unit mismatch (commit key version still matched)
        stats.c409('commit CAS: new unit mismatch', 're-upload the unit under a new key, retry CAS (<= RB)');
        const i = cm.keys.indexOf(r.key);
        if (cm.kind === 'b') { nd.cm = null; nd.pc = 'idle'; push('commit CAS -> 409 on unit (control path); commit abandoned', nd); return; }
        if (cm.retry < cfg.RB) {
          nd.cm.retry = cm.retry + 1; stats.noteRetry(nd.cm.retry);
          nd.cm.todo = i < cm.nd ? [i, cm.nd] : [i];
          nd.pc = 'up';
          push(`commit CAS -> 409 on unit ${r.key} (commit key matched); retry ${nd.cm.retry}: re-upload under new key`, nd);
        } else {
          stats.boundHit++; nd.cm = null; nd.pc = 'idle';
          push(`commit CAS -> 409 on unit ${r.key}; retry bound ${cfg.RB} exhausted, commit abandoned`, nd);
        }
        return;
      }
    }
    return;
  }
  if (pc === 'rt') {
    const ns = Object.assign({}, s);
    ns.RT = [{ ret: d.tmp.rt }, s.RT[1] + 1, false];
    const nd = cloneDev(d); nd.pc = 'idle'; nd.tmp = null;
    push(`write retention key := ${JSON.stringify(d.tmp.rt)}`, nd, ns);
    return;
  }

  // ---- pin / unpin: a commit-key write built from the base ----
  if (pc === 'pin') {
    const b = d.base; const t = d.tmp;
    const pins2 = t.un ? b.pins.filter((x) => x !== t.px) : [...b.pins, t.px];
    const val = { cur: b.m, ret: b.ret, stg: b.stg, pins: pins2 };
    const r = ckWrite(st, cfg, { kind: 'pin', who: own, ifV: b.v, ifSeq: b.q, builtFrom: b.v, val, units: [] });
    const nd = cloneDev(d); nd.tmp = null;
    if (r.conflict) {
      stats.c409('pin CAS: commit key moved', 'park or reload');
      nd.pc = 'idle'; nd.parked = 1; push(`${t.un ? 'unpin' : 'pin'} CAS -> 409; PARK`, nd);
      if (cfg.reload) {
        const nr = cloneDev(d); nr.pc = 'rdCK'; nr.base = null; nr.tmp = null; nr.justR = 0;
        if (cfg.redo && (d.rl | 0) < cfg.RB) { nr.rl = (d.rl | 0) + 1; nr.pn = d.pn + 1; }
        push(`${t.un ? 'unpin' : 'pin'} CAS -> 409; RELOAD (re-read${cfg.redo && (d.rl | 0) < cfg.RB ? ', re-apply the pin' : ''})`, nr);
      }
      return;
    }
    nd.base = baseFrom(r.rev, b.m, b.ret, b.stg, pins2, b.refs, r.seq); nd.pc = 'idle';
    push(`${t.un ? 'unpin' : 'pin'} ${t.px}: CAS ok -> v${r.rev}, pins=${JSON.stringify(pins2)}`, nd, r.s, r.viol, r.env);
    if (canLose) { const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'pin' }; nl.tmp = null; nl.base = null; push(`${t.un ? 'unpin' : 'pin'} CAS applied -> v${r.rev}, RESPONSE LOST`, nl, r.s, r.viol, r.env); }
    return;
  }

  // ---- save-mine (off Node): rebuild from a fresh read inside ONE critical section ----
  if (pc === 'sm') {
    if (cfg.offNode && !cfg.idb && st.mx !== null) return; // the mutex is held by another actor
    const P = s.CK[0];
    const nd = cloneDev(d);
    if (P.dmg || P.cur === null) { nd.pc = 'idle'; nd.parked = 1; nd.cm = null; push('save-mine: fresh read unusable; PARK', nd); return; }
    const b = d.base; const cm = d.cm;
    const nmine = b.refs.length + cm.nd; // mine = base units + this commit's data units, every one rewritten under a fresh key
    const dk = Array.from({ length: nmine }, (_, i) => `u/${id}${d.seq}.sm${i}.g${d.sm}`);
    const mk2 = `m/${id}${d.seq}.sm.g${d.sm}`;
    const ns = Object.assign({}, s);
    let viol = null;
    for (const k of [...dk, mk2]) if (s[k]) viol = viol || `(d) ${id} save-mine uploaded to key ${k} which already existed`;
    for (const k of dk) ns[k] = mkEntry(cfg, null, undefined);
    ns[mk2] = mkEntry(cfg, dk, P.seq !== undefined ? P.seq + 1 : undefined);
    const val = { cur: mk2, ret: pushRet(P.cur, P.ret, cfg.RL, P.pins), stg: cfg.smDropStg ? null : P.stg, pins: cfg.smDropPins ? [] : P.pins };
    const st2 = { ...st, s: ns };
    const r = ckWrite(st2, cfg, { kind: 'savemine', who: own, ifV: s.CK[1], ifSeq: P.seq, builtFrom: s.CK[1], val, units: [] });
    if (r.conflict) { nd.pc = 'idle'; nd.parked = 1; nd.cm = null; push('save-mine CAS conflict; PARK', nd); return; }
    if (!viol) viol = r.viol;
    nd.base = baseFrom(r.rev, mk2, val.ret, val.stg, val.pins, dk.slice(), r.seq); nd.pc = 'idle'; nd.cm = null;
    push(`SAVE-MINE ok -> v${r.rev}, current=${mk2}, retained=${JSON.stringify(val.ret)} (peer's ${P.cur} pushed), staging/pins kept from the fresh read`, nd, r.s, viol, r.env);
    if (canLose) { const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'c', newM: mk2 }; nl.cm = { ...cm }; nl.sm = nd.sm; push(`save-mine applied -> v${r.rev}, RESPONSE LOST`, nl, r.s, viol, r.env); }
    return;
  }

  // ---- uncertain outcome (a response was lost after the write was applied): read first, then decide ----
  if (pc === 'unc') {
    const u = d.unc; const v = s.CK[0];
    const nd = cloneDev(d); nd.unc = null;
    if (u.k === 'sc') { nd.pc = 'rdCK'; nd.tmp = null; nd.justR = 1; push('uncertain start-up clear: re-read commit key', nd); return; }
    if (u.k === 'pin') { nd.pc = 'rdCK'; nd.base = null; nd.cm = null; nd.justR = 0; push('uncertain pin: reload (re-read everything)', nd); return; }
    if (u.k === 'fc') { nd.pc = 'rdCK'; nd.base = null; nd.justR = 0; push('uncertain foreign clear: prompt closes, reload', nd); return; }
    if (u.k === 'ac') { nd.pc = 'idle'; nd.parked = 1; nd.ac = null; push('uncertain abandon-clear: left as is; PARK', nd); return; }
    if (v.dmg || v.cur === null) { nd.pc = 'idle'; nd.parked = 1; nd.cm = null; push(`uncertain write: read commit key -> ${v.dmg ? 'UNPARSABLE' : 'no current'}; PARK`, nd); return; }
    if (u.k === 'c') { // uncertain ordinary commit / save-mine
      if (v.cur === u.newM && exists(s, v.cur)) {
        nd.base = baseFrom(s.CK[1], v.cur, v.ret.slice(), v.stg, v.pins.slice(), s[v.cur][0].slice(), v.seq); nd.pc = 'idle'; nd.cm = null;
        push(`uncertain commit: read commit key -> my manifest ${v.cur} is current: DONE`, nd); return;
      }
      const cm = d.cm;
      stats.c409('uncertain commit CAS: not mine', 'park or reload');
      ckConflict('uncertain commit: read commit key -> my manifest is not current', cm);
      return;
    }
    if (u.k === 'bm') { // uncertain bulk marker CAS
      if (v.stg && v.stg[0] === u.owner && v.stg[1] === u.pfx && exists(s, v.cur)) {
        nd.base = baseFrom(s.CK[1], v.cur, v.ret.slice(), v.stg, v.pins.slice(), s[v.cur][0].slice(), v.seq);
        nd.pc = 'up'; nd.cm.wr = 1; nd.cm.todo = Array.from({ length: d.cm.nd + 1 }, (_, i) => i); nd.cm.keys = new Array(d.cm.nd + 1).fill(null);
        push('uncertain bulk marker CAS: read commit key -> my marker stands: continue', nd); return;
      }
      bulkConflict(st, cfg, stats, id, d, out, 'begin', own); return;
    }
    if (u.k === 'bf') { // uncertain bulk final CAS
      if (cfg.aclearNoRead && cfg.abandonClear) { // mutant: no read after the uncertain final CAS; abandon-clear straight away
        const na = cloneDev(d); na.unc = null; na.pc = 'acBlind'; na.parked = 1; na.ac = { o: own, p: d.cm.pfx }; na.cm = null;
        push('uncertain final CAS: NO read; abandon-clear straight away (mutant)', na); return;
      }
      if (v.cur === u.newM && exists(s, v.cur)) {
        nd.base = baseFrom(s.CK[1], v.cur, v.ret.slice(), v.stg, v.pins.slice(), s[v.cur][0].slice(), v.seq); nd.pc = 'idle'; nd.cm = null;
        push(`uncertain bulk final CAS: read commit key -> my manifest ${v.cur} is current: DONE, nothing cleared`, nd); return;
      }
      bulkConflict(st, cfg, stats, id, d, out, 'final', own); return;
    }
    return;
  }

  if (pc === 'b1') {
    const b = d.base;
    if (b.stg && b.stg[0] !== own) return; // a foreign marker stands: a second bulk waits (no step)
    const cm = d.cm;
    const nd = cloneDev(d);
    const pfx = `s/${id}${d.seq}.b${d.bgen}/`;
    nd.cm.pfx = pfx;
    const val = { cur: b.m, ret: cfg.sepRetention ? [] : b.ret, stg: [own, pfx], pins: b.pins };
    const r = ckWrite(st, cfg, { kind: 'bulk-begin', who: own, ifV: b.v, ifSeq: b.q, builtFrom: b.v, val, units: [] });
    if (r.conflict) { bulkConflict(st, cfg, stats, id, d, out, 'begin', own); return; }
    nd.base = { ...b, v: r.rev, stg: [own, pfx], q: r.seq };
    nd.pc = 'up'; nd.cm.wr = 1; nd.cm.todo = Array.from({ length: cm.nd + 1 }, (_, i) => i); nd.cm.keys = new Array(cm.nd + 1).fill(null);
    push(`BULK step 1: CAS marker staging=${JSON.stringify([own, pfx])} -> v${r.rev}`, nd, r.s, r.viol, r.env);
    if (canLose) { const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'bm', owner: own, pfx }; nl.cm.pfx = pfx; push(`BULK step 1: marker CAS applied -> v${r.rev}, RESPONSE LOST`, nl, r.s, r.viol, r.env); }
    return;
  }
  if (pc === 'b3') {
    const cm = d.cm; const b = d.base;
    const newM = cm.keys[cm.nd];
    for (const vr of retVariants(b, cfg)) {
      const val = { cur: newM, ret: vr.ret, stg: null, pins: b.pins };
      const r = ckWrite(st, cfg, { kind: 'bulk-final', who: own, ifV: b.v, ifSeq: b.q, builtFrom: b.v, val, units: [] });
      if (r.conflict) { bulkConflict(st, cfg, stats, id, d, out, 'final', own); return; }
      let viol = r.viol;
      const allowed = new Set([...b.refs, ...cm.keys]);
      for (const k of (r.s[newM] && r.s[newM][0] ? r.s[newM][0] : [])) if (!allowed.has(k)) viol = viol || `(i) ${id} bulk manifest ${newM} names ${k}, outside what it uploaded or its base named`;
      const nd = cloneDev(d);
      nd.base = baseFrom(r.rev, newM, vr.ret, null, b.pins, (r.s[newM] && r.s[newM][0] ? r.s[newM][0] : []).slice(), r.seq);
      stats.noteRetry(cm.retry);
      nd.cm = null;
      if (cfg.sepRetention) { nd.tmp = { rt: pushRet(b.m, b.ret, cfg.RL, []) }; nd.pc = 'rt'; } else nd.pc = 'idle';
      push(`BULK step 3: final CAS -> v${r.rev}, current=${newM}, staging cleared${vr.tag}`, nd, r.s, viol, r.env);
      if (canLose && !cfg.sepRetention) {
        const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'bf', newM }; push(`BULK step 3: final CAS applied -> v${r.rev}, RESPONSE LOST${vr.tag}`, nl, r.s, viol, r.env);
      }
    }
    return;
  }

  // ---- abandon-clear: read the commit key; only if its staging has THIS owner id and prefix, CAS it away ----
  if (pc === 'acRd') {
    const v = s.CK[0]; const ac = d.ac;
    const nd = cloneDev(d);
    if (v.dmg) { nd.pc = 'idle'; nd.parked = 1; nd.ac = null; push('abandon-clear: read commit key -> unparsable; nothing cleared; PARK', nd); return; }
    const match = cfg.aclearNoCheck ? v.stg !== null : (v.stg && v.stg[0] === ac.o && v.stg[1] === ac.p);
    if (!match) { nd.pc = 'idle'; nd.parked = 1; nd.ac = null; push(`abandon-clear: read commit key -> staging ${JSON.stringify(v.stg)} is not mine; nothing cleared`, nd); return; }
    nd.tmp = { v: s.CK[1], m: v.cur, ret: v.ret.slice(), stg: v.stg, pins: v.pins.slice(), q: v.seq, rec: v.rec }; nd.pc = 'acCas';
    push(`abandon-clear: read commit key v${s.CK[1]}, staging ${JSON.stringify(v.stg)} matches${cfg.aclearNoCheck ? ' (no id/prefix check)' : ' my owner id and prefix'}`, nd);
    return;
  }
  if (pc === 'acCas') {
    const t = d.tmp; const ac = d.ac;
    const val = { cur: t.rec || t.m, ret: t.ret, stg: null, pins: t.pins };
    const r = ckWrite(st, cfg, { kind: 'aclear', who: own, mk: [ac.o, ac.p], ifV: t.v, ifSeq: t.q, builtFrom: t.v, val, units: [] });
    const nd = cloneDev(d); nd.tmp = null; nd.ac = null; nd.pc = 'idle'; nd.parked = 1;
    if (r.conflict) { stats.c409('abandon-clear CAS: commit key moved', 'leave the marker; PARK'); push('abandon-clear CAS -> 409; marker left standing; PARK', nd); return; }
    push(`abandon-clear: staging cleared -> v${r.rev}`, nd, r.s, r.viol, r.env);
    if (canLose) { const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'ac' }; nl.tmp = null; nl.ac = null; push(`abandon-clear applied -> v${r.rev}, RESPONSE LOST`, nl, r.s, r.viol, r.env); }
    return;
  }
  if (pc === 'acBlind') { // mutant: no read after the uncertain final CAS; clear built from the base, retried at the 409's reported version
    const b = d.base; const ac = d.ac;
    const ifV = s.CK[1] === b.v ? b.v : s.CK[1];
    const val = { cur: b.m, ret: b.ret, stg: null, pins: b.pins };
    const r = ckWrite(st, cfg, { kind: 'aclear', who: own, mk: [ac.o, ac.p], ifV, ifSeq: b.q, builtFrom: b.v, val, units: [] });
    const nd = cloneDev(d); nd.ac = null; nd.pc = 'idle'; nd.parked = 1;
    if (r.conflict) { push('blind abandon-clear -> 409; PARK', nd); return; }
    push(`blind abandon-clear (no read) -> v${r.rev}`, nd, r.s, r.viol, r.env);
    return;
  }

  if (pc === 'fcRd') {
    const v = s.CK[0];
    const nd = cloneDev(d);
    if (!v.dmg && v.stg && v.stg[0] !== own) { nd.pc = 'fcCas'; nd.tmp = { v: s.CK[1], m: v.cur, ret: v.ret.slice(), stg: v.stg, pins: v.pins.slice(), q: v.seq, rec: v.rec }; push(`prompt shown: marker of owner ${v.stg[0]} (v${s.CK[1]}); user CONFIRMS`, nd); }
    else { nd.pc = 'idle'; push('prompt not needed (no foreign marker)', nd); }
    return;
  }
  if (pc === 'fcCas') {
    const t = d.tmp;
    const val = { cur: t.rec || t.m, ret: cfg.sepRetention ? [] : t.ret, stg: null, pins: t.pins };
    const r = ckWrite(st, cfg, { kind: 'fclear', who: own, ifV: t.v, ifSeq: t.q, builtFrom: t.v, val, units: [] });
    const nd = cloneDev(d); nd.tmp = null;
    if (r.conflict) { stats.c409('foreign clear CAS', 'prompt closes, user may reopen'); nd.pc = 'idle'; push('foreign clear CAS -> 409; prompt closes', nd); return; }
    nd.base = null; nd.pc = 'rdCK'; nd.justR = 0;
    push(`foreign clear of ${t.stg[0]}'s marker -> v${r.rev}`, nd, r.s, r.viol, r.env);
    if (canLose) { const nl = lostDev(); nl.pc = 'unc'; nl.unc = { k: 'fc' }; nl.base = null; nl.tmp = null; push(`foreign clear applied -> v${r.rev}, RESPONSE LOST`, nl, r.s, r.viol, r.env); }
    return;
  }
}

// 409 on the commit key while at bulk step 1 or 3 (or an uncertain marker/final CAS found not landed)
function bulkConflict(st, cfg, stats, id, d, out, where, own) {
  stats.c409(`bulk ${where} CAS: commit key moved`, 'park, or reload and restart with a new marker/prefix (<= RB)');
  const np = cloneDev(d); np.pc = 'idle'; np.parked = 1; np.cm = null; np.unc = null;
  out.push({ l: `${id}: BULK ${where} CAS -> 409 on commit key; PARK (own marker, if written, left standing)`, st: withDev(st, id, np) });
  const cm = d.cm;
  const abandon = () => {
    if (!cfg.abandonClear || where !== 'final' || !cm.pfx) return;
    const na = cloneDev(d); na.pc = 'acRd'; na.parked = 1; na.cm = null; na.unc = null; na.ac = { o: own, p: cm.pfx };
    out.push({ l: `${id}: BULK ${where} CAS -> 409 on commit key; ABANDON: clear my marker (id and prefix)`, st: withDev(st, id, na) });
  };
  if (cm.retry < cfg.RB) {
    const nr = cloneDev(d); nr.cm.retry = cm.retry + 1; stats.noteRetry(nr.cm.retry); nr.bgen = d.bgen + 1; nr.unc = null;
    nr.cm.todo = Array.from({ length: cm.nd + 1 }, (_, i) => i); nr.cm.keys = new Array(cm.nd + 1).fill(null);
    nr.resume = 'b1'; nr.pc = 'rdCK'; nr.base = null; nr.justR = 0;
    out.push({ l: `${id}: BULK ${where} CAS -> 409 on commit key; RELOAD and restart bulk with a NEW marker/prefix (retry ${nr.cm.retry})`, st: withDev(st, id, nr) });
  } else {
    stats.boundHit++;
    const ng = cloneDev(d); ng.pc = 'idle'; ng.cm = null; ng.parked = 1; ng.unc = null;
    out.push({ l: `${id}: BULK ${where} CAS -> 409; retry bound exhausted, bulk abandoned (parked)`, st: withDev(st, id, ng) });
  }
  abandon();
}

// ---------------- GC ----------------
function gcSucc(st, cfg, stats, out) {
  const g = st.G; const s = st.s;
  const push = (l, ng, ns, viol, env) => out.push({ l: `GC: ${l}`, st: { ...st, s: ns || s, G: ng, ...(env ? { env } : {}) }, viol });
  const fresh = (x) => ({ pc: 'start', listed: [], R: 0, tmp: null, ms: [], mi: 0, marked: [], cand: [], ci: 0, tries: x.tries, runs: x.runs, cr: x.cr, lr: x.lr, pk: null });
  const faultOk = nFaults(st) < cfg.faultCap;
  const canLose = faultOk && cfg.lost > (g.lr | 0) && cfg.lostSet.includes('G');
  if (faultOk && g.cr < cfg.crashes && cfg.crashSet.includes('G') && (cfg.crashPoints === 'all' ? g.pc !== 'start' : (g.pc === 'del' && g.ci > 0))) {
    const ng = fresh(g); ng.cr = g.cr + 1; ng.tries = 0;
    push('CRASH (restarts a fresh pass)', ng);
  }
  if (g.pc === 'start') {
    if (g.runs >= cfg.gcRuns) return;
    if (cfg.merge && !cfg.sepRetention) {
      // Reduction R2. One atomic step = list, read the commit key at R, read every named manifest, compute the candidates.
      // Sound for safety: a listing taken at the moment of the read has a superset of the keys of any earlier listing, so every
      // deletion the real (list ... read) gap allows is also available here; manifests are write-once and only this actor deletes
      // them, so reading them commutes with every other actor's step.
      const listed = Object.keys(s).filter(k => UNIT_PFX.some(p => k.startsWith(p)) && !s[k][2]).sort();
      if (cfg.gcOutsidePrefix) listed.push('CK');
      const v = s.CK[0];
      if (v.dmg || (cfg.recFix === 'refuse' && v.cur === null) || (cfg.tauri && st.env.ckUnf && !cfg.tauriGcIgnoresCkFlag)) {
        const ng = fresh(g); ng.runs = g.runs + 1;
        stats.c409('GC refuses', v.dmg ? 'unparsable commit key' : 'unconfirmed commit-key flush');
        push(`pass: list, read commit key -> ${v.dmg ? 'UNPARSABLE' : 'commit-key flush unconfirmed'}; GC REFUSES this pass`, ng); return;
      }
      const ms = [...new Set([v.cur, ...v.ret, ...(cfg.markIgnoresPins ? [] : v.pins), ...(v.rec ? [v.rec] : [])].filter((x) => x !== null))];
      let marked = [];
      for (const m of ms) {
        if (!exists(s, m)) {
          stats.c409('GC manifest read 404', 'abort pass, re-list');
          const ng = fresh(g); ng.tries = g.tries + 1;
          if (ng.tries > cfg.RB) ng.runs = g.runs + 1;
          push(`pass: read manifest ${m} -> missing; abort pass`, ng); return;
        }
        marked = marked.concat([m], s[m][0]);
      }
      const mset = new Set(marked);
      const cand = listed.filter(k => !mset.has(k) && (cfg.noPfxSkip || !underPrefix(k, v.stg)));
      const ng = { ...g, R: s.CK[1], cand, ci: 0, pc: cand.length ? 'del' : 'start' };
      if (!cand.length) ng.runs = g.runs + 1;
      push(`pass: list (${listed.length}), read commit key at R=v${s.CK[1]}, read manifest(s) ${ms.join(',')}; mark done, candidates=${JSON.stringify(cand)}`, ng);
      return;
    }
    const ng = { ...g, pc: 'list' }; push('begin pass', ng); return;
  }
  if (g.pc === 'list') {
    const listed = Object.keys(s).filter(k => UNIT_PFX.some(p => k.startsWith(p)) && !s[k][2]).sort();
    if (cfg.gcOutsidePrefix) listed.push('CK');
    push(`list keys (${listed.length})`, { ...g, pc: 'rdCK', listed });
    return;
  }
  if (g.pc === 'rdCK') {
    const v = s.CK[0];
    if (v.dmg || (cfg.recFix === 'refuse' && v.cur === null) || (cfg.tauri && st.env.ckUnf && !cfg.tauriGcIgnoresCkFlag)) {
      const ng = fresh(g); ng.runs = g.runs + 1;
      stats.c409('GC refuses', v.dmg ? 'unparsable commit key' : 'unconfirmed commit-key flush');
      push(`read commit key -> ${v.dmg ? 'UNPARSABLE' : 'commit-key flush unconfirmed'}; GC REFUSES this pass`, ng); return;
    }
    const ng = { ...g, R: s.CK[1], tmp: { cur: v.cur, ret: v.ret.slice(), stg: v.stg, pins: v.pins.slice() } };
    const named = (cur, ret, pins, rec) => [...new Set([cur, ...ret, ...(cfg.markIgnoresPins ? [] : pins), ...(rec ? [rec] : [])].filter((x) => x !== null))];
    if (cfg.sepRetention) ng.pc = 'rdRT';
    else { ng.ms = named(v.cur, v.ret, v.pins, v.rec); ng.mi = 0; ng.marked = []; ng.pc = 'rdM'; }
    push(`read commit key at R=v${s.CK[1]}`, ng);
    return;
  }
  if (g.pc === 'rdRT') {
    const ret = s.RT[0].ret.slice();
    const ng = { ...g, tmp: { ...g.tmp, ret } };
    ng.ms = [...new Set([g.tmp.cur, ...ret])]; ng.mi = 0; ng.marked = []; ng.pc = 'rdM';
    push(`read retention key ${JSON.stringify(ret)}`, ng); return;
  }
  if (g.pc === 'rdM') {
    // gcAtomicMarks: all manifests named by the commit key are read in ONE step (write-once data)
    const upto = cfg.gcAtomicMarks ? g.ms.length : g.mi + 1;
    let marked = g.marked; let mi = g.mi; const readNames = [];
    for (; mi < upto; mi++) {
      const m = g.ms[mi];
      if (!exists(s, m)) { // manifest named by the commit key is missing: abort the pass
        stats.c409('GC manifest read 404', 'abort pass, re-list');
        const ng = fresh(g); ng.tries = g.tries + 1;
        if (ng.tries > cfg.RB) ng.runs = g.runs + 1;
        push(`read manifest ${m} -> missing; abort pass`, ng); return;
      }
      marked = marked.concat([m], s[m][0]); readNames.push(m);
    }
    let ng = { ...g, marked, mi };
    if (mi === g.ms.length) {
      const stg = g.tmp.stg; const mset = new Set(marked);
      const cand = g.listed.filter(k => !mset.has(k) && (cfg.noPfxSkip || !underPrefix(k, stg)));
      ng.cand = cand; ng.ci = 0; ng.pc = cand.length ? 'del' : 'start';
      if (!cand.length) ng.runs = g.runs + 1;
      ng.marked = []; ng.ms = []; ng.listed = []; ng.mi = 0;
    }
    push(`read manifest(s) ${readNames.join(',')}${mi === g.ms.length ? `; mark done, candidates=${JSON.stringify(ng.cand)}` : ''}`, ng);
    return;
  }
  if (g.pc === 'del2') { // mutant (IndexedDB): the check happened in an earlier transaction; this one deletes unconditionally
    const key = g.pk;
    const cvNow = view(s.CK[0]);
    let viol;
    if (underPrefix(key, cvNow.stg)) viol = `(h) GC deleted ${key} which is under the standing staging marker ${JSON.stringify(cvNow.stg)}`;
    const ns = Object.assign({}, s);
    if (s[key] && !s[key][2]) ns[key] = [null, s[key][1] + 1, true];
    const rest = g.cand.filter((x) => x !== key);
    const ng = { ...g, cand: rest, ci: g.ci + 1, pk: null, pc: rest.length ? 'del' : 'start' };
    if (!rest.length) { ng.runs = g.runs + 1; ng.ci = 0; }
    push(`remove [${key}] in a SEPARATE transaction (commit key not re-checked); tombstone`, ng, ns, viol);
    return;
  }
  if (g.pc === 'del') {
    // /api/remove batch of ONE key, chosen in ANY order from the remaining candidates.
    if (cfg.gcCheck && s.CK[1] !== g.R) {
      stats.c409('GC remove: commit key moved', 're-read and retry (<= RB), else GC defers to an idle time');
      const ng = fresh(g); ng.tries = g.tries + 1;
      if (ng.tries > cfg.RB) { ng.runs = g.runs + 1; stats.boundHit++; }
      push(`remove [${g.cand}] (check-only commit key == v${g.R}) -> 409 (now v${s.CK[1]}); ${ng.tries > cfg.RB ? 'retry bound exhausted, GC defers' : 're-list and retry'}`, ng);
      return;
    }
    const cvNow = view(s.CK[0]);
    const stgNow = cvNow.stg;
    const nChoices = cfg.gcOrder === 'sorted' ? 1 : g.cand.length;
    for (let c = 0; c < nChoices; c++) {
      const key = g.cand[c];
      if (cfg.gcCheckOutside) { push(`check commit key == v${g.R} ok (own transaction); next transaction will delete [${key}]`, { ...g, pc: 'del2', pk: key }); continue; }
      let viol;
      if (key === 'CK') viol = '(I4) GC/retire removed the commit key, a key outside the A-lite prefix';
      else if (underPrefix(key, stgNow)) viol = `(h) GC deleted ${key} which is under the standing staging marker ${JSON.stringify(stgNow)}`;
      if (!viol && stats.obs && cvNow.cur === null && key.startsWith('m/')) stats.obs('GC deletes a candidate manifest while the commit key names no current (recovery marker standing or cleared)');
      const ns = Object.assign({}, s);
      if (s[key] && !s[key][2]) ns[key] = [null, s[key][1] + 1, true];
      const rest = g.cand.filter((_, x) => x !== c);
      const ng = { ...g, cand: rest, ci: g.ci + 1 };
      if (!rest.length) { ng.pc = 'start'; ng.runs = g.runs + 1; ng.ci = 0; }
      push(`remove [${key}]${cfg.gcCheck ? ` (check-only commit key == v${g.R} ok)` : ' (NO check-only)'}; revision bumped, tombstone`, ng, ns, viol);
      if (canLose && !viol) { // applied, response lost: the pass is abandoned and restarted (as for a 409)
        const nl = fresh(g); nl.lr = (g.lr | 0) + 1; nl.tries = g.tries + 1;
        if (nl.tries > cfg.RB) { nl.runs = g.runs + 1; stats.boundHit++; }
        push(`remove [${key}] applied, RESPONSE LOST; pass abandoned`, nl, ns, viol);
      }
    }
    return;
  }
}
// ---------------- Restorer ----------------
function rsSucc(st, cfg, stats, out) {
  const q = st.Q; const s = st.s;
  const push = (l, nq, ns, viol, env) => out.push({ l: `RESTORE: ${l}`, st: { ...st, s: ns || s, Q: nq, ...(env ? { env } : {}) }, viol });
  const faultOk = nFaults(st) < cfg.faultCap;
  const canLose = faultOk && cfg.lost > (q.lr | 0) && cfg.lostSet.includes('Q');
  const mkq = (x) => ({ pc: 'start', tmp: null, runs: x.runs, tries: x.tries, cr: x.cr, lr: x.lr });
  if (faultOk && q.cr < cfg.crashes && cfg.crashSet.includes('Q') && (cfg.crashPoints === 'all' ? (q.pc !== 'start' && q.pc !== 'done') : q.pc === 'rt')) push('CRASH (restarts)', { pc: 'start', tmp: null, runs: q.runs, tries: q.tries, cr: q.cr + 1, lr: q.lr });
  const readAndChoose = (qq, pre) => {
    const v = s.CK[0];
    if (v.dmg || v.cur === null) { push(`${pre}read commit key -> ${v.dmg ? 'unparsable' : 'no current'}; nothing to restore`, { pc: 'start', tmp: null, runs: qq.runs + 1, tries: qq.tries, cr: qq.cr, lr: qq.lr }); return; }
    const ret = cfg.sepRetention ? qq.tmp.ret : v.ret.slice();
    const tmp = { v: s.CK[1], cur: v.cur, ret, stg: v.stg, pins: v.pins.slice(), q: v.seq };
    const choices = [...new Set([...ret, ...v.pins])].filter((x) => x !== v.cur);
    if (!choices.length) { push(`${pre}read commit key v${s.CK[1]}: retained list empty, nothing to restore`, { pc: 'start', tmp: null, runs: qq.runs + 1, tries: qq.tries, cr: qq.cr, lr: qq.lr }); return; }
    for (const M of choices) push(`${pre}read commit key v${s.CK[1]}, retained=${JSON.stringify(ret)} pins=${JSON.stringify(v.pins)}; user chooses ${M}`, { ...qq, pc: 'cas', tmp: { ...tmp, M } });
  };
  if (q.pc === 'start') {
    if (q.runs >= cfg.restores) return;
    if (cfg.merge && !cfg.sepRetention) { readAndChoose(q, 'begin restore; '); return; }
    push('begin restore', { ...q, pc: cfg.sepRetention ? 'rdRT' : 'rdCK' }); return;
  }
  if (q.pc === 'rdRT') { push(`read retention key ${JSON.stringify(s.RT[0].ret)}`, { ...q, pc: 'rdCK', tmp: { ret: s.RT[0].ret.slice() } }); return; }
  if (q.pc === 'rdCK') {
    const v = s.CK[0];
    if (v.dmg || v.cur === null) { push(`read commit key -> ${v.dmg ? 'unparsable' : 'no current'}; nothing to restore`, { pc: 'start', tmp: null, runs: q.runs + 1, tries: q.tries, cr: q.cr, lr: q.lr }); return; }
    const ret = cfg.sepRetention ? q.tmp.ret : v.ret.slice();
    const tmp = { v: s.CK[1], cur: v.cur, ret, stg: v.stg, pins: v.pins.slice(), q: v.seq };
    const choices = [...new Set([...ret, ...v.pins])].filter((x) => x !== v.cur);
    if (!choices.length) { push(`read commit key v${s.CK[1]}: retained list empty, nothing to restore`, { pc: 'start', tmp: null, runs: q.runs + 1, tries: q.tries, cr: q.cr, lr: q.lr }); return; }
    for (const M of choices) push(`read commit key v${s.CK[1]}, retained=${JSON.stringify(ret)} pins=${JSON.stringify(v.pins)}; user chooses ${M}`, { ...q, pc: 'cas', tmp: { ...tmp, M } });
    return;
  }
  if (q.pc === 'cas') {
    const t = q.tmp;
    const retNoM = t.ret.filter(x => x !== t.M);
    const ret2 = cfg.restoreNoPush ? retNoM.slice(0, cfg.RL) : pushRet(t.cur, retNoM, cfg.RL, t.pins);
    const val = { cur: t.M, ret: cfg.sepRetention ? [] : ret2, stg: cfg.restoreDropStg ? null : t.stg, pins: t.pins };
    const r = ckWrite(st, cfg, { kind: 'restore', who: 'Q', ifV: cfg.restoreNoIf ? s.CK[1] : t.v, ifSeq: t.q, builtFrom: cfg.restoreNoIf ? s.CK[1] : t.v, val, units: [] });
    if (r.conflict) {
      stats.c409('restore CAS: commit key moved', 're-read, choose again (<= RB)');
      const nq = { pc: 'start', tmp: null, runs: q.runs, tries: q.tries + 1, cr: q.cr, lr: q.lr };
      if (nq.tries > cfg.RB) nq.runs = q.runs + 1;
      push(`restore CAS ifVersion v${t.v} -> 409; ${nq.tries > cfg.RB ? 'give up' : 're-read'}`, nq); return;
    }
    let viol = r.viol;
    // (b) the installed manifest and everything it names must exist
    const ok = exists(r.s, t.M) && r.s[t.M][0].every(k => exists(r.s, k));
    if (!ok) viol = viol || `(b) restore installed ${t.M} which names a missing unit`;
    // (r) a restore always pushes the previous current (so a restore is undoable)
    if (!viol && !cfg.sepRetention && !ret2.includes(t.cur)) viol = `(r) restore did not push the previous current ${t.cur} into retained ${JSON.stringify(ret2)}`;
    const nq = { pc: cfg.sepRetention ? 'rt' : 'start', tmp: cfg.sepRetention ? { rt: ret2 } : null, runs: cfg.sepRetention ? q.runs : q.runs + 1, tries: q.tries, cr: q.cr, lr: q.lr };
    push(`restore CAS ifVersion v${t.v}: current := ${t.M}, retained := ${JSON.stringify(ret2)} -> v${r.rev}`, nq, r.s, viol, r.env);
    if (canLose && !cfg.sepRetention) push(`restore CAS applied: current := ${t.M} -> v${r.rev}, RESPONSE LOST`, { pc: 'unc', tmp: t, runs: q.runs, tries: q.tries, cr: q.cr, lr: q.lr + 1 }, r.s, viol, r.env);
    return;
  }
  if (q.pc === 'unc') { // read the commit key: if my restore landed it is done, else treat as a conflict
    const v = s.CK[0]; const t = q.tmp;
    if (!v.dmg && v.cur === t.M) { push(`uncertain restore: read commit key -> current is ${t.M}: DONE`, { pc: 'start', tmp: null, runs: q.runs + 1, tries: q.tries, cr: q.cr, lr: q.lr }); return; }
    const nq = { pc: 'start', tmp: null, runs: q.runs, tries: q.tries + 1, cr: q.cr, lr: q.lr };
    if (nq.tries > cfg.RB) nq.runs = q.runs + 1;
    push(`uncertain restore: read commit key -> not landed; ${nq.tries > cfg.RB ? 'give up' : 're-read'}`, nq); return;
  }
  if (q.pc === 'rt') {
    const ns = Object.assign({}, s); ns.RT = [{ ret: q.tmp.rt }, s.RT[1] + 1, false];
    push(`write retention key := ${JSON.stringify(q.tmp.rt)}`, { pc: 'start', tmp: null, runs: q.runs + 1, tries: q.tries, cr: q.cr, lr: q.lr }, ns);
    return;
  }
}

// ---------------- Recovery (actor R): damaged commit key -> candidate list -> read tree -> bulk install ----------------
function recSucc(st, cfg, stats, out) {
  const r = st.R; const s = st.s;
  if (!cfg.recoveries) return;
  const own = rOwner(cfg, r);
  const push = (l, nr, ns, viol, env) => out.push({ l: `RECOVER: ${l}`, st: { ...st, s: ns || s, R: nr, ...(env ? { env } : {}) }, viol });
  const faultOk = nFaults(st) < cfg.faultCap;
  const canLose = faultOk && cfg.lost > (r.lr | 0) && cfg.lostSet.includes('R');
  const end = (x) => ({ ...x, pc: 'start', tmp: null, runs: x.runs + 1, tries: 0, unc: null, keys: [], todo: [], wr: 0 });
  const nrc = (extra) => ({ ...r, ...extra });
  if (faultOk && r.cr < cfg.crashes && cfg.crashSet.includes('R') && (cfg.crashPoints === 'all' ? (r.pc !== 'start') : (r.wr === 1 && (r.pc === 'up' || r.pc === 'rf')))) {
    push('CRASH (in-memory tree lost; restarts at boot)', { ...r, pc: 'start', tmp: null, tries: 0, cr: r.cr + 1, unc: null, keys: [], todo: [], wr: 0, M: null });
  }
  if (r.pc === 'start') {
    if (!(st.env.dmg > 0) || r.runs >= cfg.recoveries) return;
    push('boot: read commit key', nrc({ pc: 'rdCK' })); return;
  }
  if (r.pc === 'rdCK') {
    const v = s.CK[0];
    if (v.dmg) { push(`read commit key -> UNPARSABLE (revision/bytes v${s.CK[1]}); recovery screen`, nrc({ pc: 'list', dv: s.CK[1], fv: 0 })); return; }
    if (cfg.recFix === 'refuse' && v.cur === null) { push(`read commit key -> parses but names no current (v${s.CK[1]}); recovery screen`, nrc({ pc: 'list', dv: s.CK[1], fv: 0 })); return; }
    if (cfg.startupClear && v.stg && v.stg[0] === own) { push('read commit key -> parses, my own marker stands (start-up clear)', nrc({ pc: 'sc', tmp: { v: s.CK[1], cur: v.cur, ret: v.ret.slice(), stg: v.stg, pins: v.pins.slice(), q: v.seq, rec: v.rec } })); return; }
    push('read commit key -> parses (healed or recovered by another device); no recovery needed', end(r)); return;
  }
  if (r.pc === 'sc') {
    const t = r.tmp;
    const w = ckWrite(st, cfg, { kind: 'startclear', who: own, rec: true, ifV: t.v, ifSeq: t.q, builtFrom: t.v, val: { cur: t.rec || t.cur, ret: t.ret, stg: null, pins: t.pins }, units: [] });
    if (w.conflict) { push('start-up clear CAS -> 409', end(r)); return; }
    push(`start-up clear of own recovery marker -> v${w.rev}`, end(r), w.s, w.viol, w.env); return;
  }
  if (r.pc === 'list') {
    const cands = Object.keys(s).filter((k) => (k.startsWith('m/') || (k.startsWith('s/') && /\/m(\.g\d+)?$/.test(k))) && exists(s, k)).sort();
    if (!cands.length) { push('candidate list empty', end(r)); return; }
    for (const M of cands) push(`candidate list (${cands.length}); user picks ${M}`, nrc({ pc: 'tree', M }));
    return;
  }
  if (r.pc === 'tree') { // read the chosen manifest and every unit it names, read-only, in one step (a missing unit fails loudly)
    const M = r.M;
    const ok = exists(s, M) && s[M][0].every((k) => exists(s, k));
    if (!ok) {
      const nt = r.tries + 1;
      if (nt > cfg.RB) push(`read tree of ${M} -> a unit is missing; give up`, end(r)); else push(`read tree of ${M} -> a unit is missing (fails loudly); user picks another`, nrc({ pc: 'list', tries: nt }));
      return;
    }
    const n = s[M][0].length; const q = s[M][4] | 0;
    if (cfg.recDirect) push(`read tree of ${M} (${n} units)`, nrc({ pc: 'rd', n, q })); else push(`read tree of ${M} (${n} units) into memory`, nrc({ pc: 'rb', n, q }));
    return;
  }
  if (r.pc === 'rd') { // mutant: install the chosen manifest and its existing units directly, no marker, no rewrite
    const val = { cur: r.M, ret: [], stg: null, pins: [] };
    const w = ckWrite(st, cfg, { kind: 'rinstall', who: own, rec: true, ifV: r.dv, ifSeq: 0, builtFrom: r.dv, val, units: [], seqNew: r.q + 1 });
    if (w.conflict) { push('direct install CAS -> 409', end(r)); return; }
    push(`DIRECT install of ${r.M} (existing units, no marker fence) -> v${w.rev}`, end(r), w.s, w.viol, w.env); return;
  }
  if (r.pc === 'rb') { // marker CAS at the damaged key's revision (Node) / full bytes (off Node); current stays unnamed
    const pfx = `s/R${r.runs}.${r.cr}.b${r.tries}/`;
    const val = { cur: cfg.recFix === 'cur' ? r.M : null, ret: [], stg: [own, pfx], pins: [] };
    if (cfg.recFix === 'rec') val.rec = r.M;
    const ifV = r.fv || r.dv;
    const chk = cfg.recFix && !cfg.recNoCheck ? [r.M, ...(s[r.M] && s[r.M][0] ? s[r.M][0] : ['(gone)'])].map((k) => [k, 1]) : [];
    const w = ckWrite(st, cfg, { kind: 'rbegin', who: own, rec: true, force: !!cfg.recFix, ifV, ifSeq: 0, builtFrom: r.dv, val, units: chk, seqNew: r.q + 1 });
    if (w.conflict === 'unit') { stats.c409('recovery marker CAS: chosen unit gone', 'fails loudly, user picks another'); const nt = r.tries + 1; if (nt > cfg.RB) push('marker CAS -> chosen manifest/unit gone; give up', end(r)); else push('marker CAS -> chosen manifest/unit gone (fails loudly); user picks another', nrc({ pc: 'list', tries: nt })); return; }
    if (w.conflict) {
      stats.c409('recovery marker CAS: commit key changed', 're-read; abandon recovery if it now parses (C2)');
      if (cfg.recRetryBlind) { push('marker CAS -> 409; retry at the 409\'s version without re-reading (mutant)', nrc({ fv: s.CK[1] })); return; }
      push('marker CAS -> 409; re-read the commit key', nrc({ pc: 'rc2' })); return;
    }
    const keys = new Array(r.n + 1).fill(null);
    push(`marker CAS: staging=${JSON.stringify([own, pfx])}, current unnamed -> v${w.rev}`, nrc({ pc: 'up', mv: w.rev, fv: 0, pfx, keys, todo: Array.from({ length: r.n + 1 }, (_, i) => i), gen: 0, wr: 1 }), w.s, w.viol, w.env);
    if (canLose) push(`marker CAS applied -> v${w.rev}, RESPONSE LOST`, nrc({ pc: 'unc', lr: r.lr + 1, unc: { k: 'rb', pfx }, pfx, fv: 0, wr: 1 }), w.s, w.viol, w.env);
    return;
  }
  if (r.pc === 'rc2') {
    const v = s.CK[0];
    if (!v.dmg) { push('re-read -> the commit key parses now (a device healed it): recovery ABANDONED', end(r)); return; }
    const nt = r.tries + 1;
    if (nt > cfg.RB) { push('re-read -> still unparsable; retry bound exhausted, give up', end(r)); return; }
    push(`re-read -> still unparsable (v${s.CK[1]}); retry the marker CAS`, nrc({ pc: 'rb', dv: s.CK[1], tries: nt })); return;
  }
  if (r.pc === 'up') {
    const j = r.todo[0];
    const k2 = `${r.pfx}${j === r.n ? 'm' : 'd' + j}.g${r.gen}`;
    let viol = null;
    if (s[k2]) viol = `(d) R uploaded to key ${k2} which already existed`;
    const ns = Object.assign({}, s);
    ns[k2] = mkEntry(cfg, j === r.n ? r.keys.slice(0, r.n) : null, j === r.n ? r.q + 2 : undefined);
    const keys = r.keys.slice(); keys[j] = k2; const todo = r.todo.slice(1);
    push(`upload ${k2}`, nrc({ pc: todo.length ? 'up' : 'rf', keys, todo, gen: r.gen + 1 }), ns, viol);
    if (canLose) {
      if (cfg.orphanAbs && j !== r.n) push(`upload ${k2} applied, RESPONSE LOST; re-upload under a new key (orphan abstracted away)`, nrc({ lr: r.lr + 1 }));
      else push(`upload ${k2} applied, RESPONSE LOST; re-upload under a new key`, nrc({ lr: r.lr + 1, gen: r.gen + 1 }), ns, viol);
    }
    return;
  }
  if (r.pc === 'rf') {
    const newM = r.keys[r.n];
    const val = { cur: newM, ret: [], stg: null, pins: [] };
    const w = ckWrite(st, cfg, { kind: 'rfinal', who: own, rec: true, ifV: r.mv, ifSeq: 0, builtFrom: r.mv, val, units: [] , seqNew: r.q + 2 });
    if (w.conflict) {
      stats.c409('recovery final CAS: commit key moved', 'give up, or abandon-clear');
      push('final CAS -> 409; give up (marker left standing)', end(r));
      if (cfg.abandonClear) push('final CAS -> 409; ABANDON: clear my marker (id and prefix)', nrc({ pc: 'racRd', pfx: r.pfx, tmp: null }));
      return;
    }
    let viol = w.viol;
    const own2 = new Set(r.keys);
    for (const k of (w.s[newM] && w.s[newM][0] ? w.s[newM][0] : [])) if (!own2.has(k)) viol = viol || `(i) R recovery manifest ${newM} names ${k}, outside what it uploaded`;
    push(`final CAS -> v${w.rev}, current=${newM}, staging cleared, retained empty (disclosed)`, end(r), w.s, viol, w.env);
    if (canLose) push(`final CAS applied -> v${w.rev}, RESPONSE LOST`, nrc({ pc: 'unc', lr: r.lr + 1, unc: { k: 'rf', newM } }), w.s, viol, w.env);
    return;
  }
  if (r.pc === 'unc') {
    const u = r.unc; const v = s.CK[0];
    if (u.k === 'rb') {
      if (!v.dmg && v.stg && v.stg[0] === own && v.stg[1] === u.pfx) { push('uncertain marker CAS: read commit key -> my marker stands: continue', nrc({ pc: 'up', mv: s.CK[1], unc: null, keys: new Array(r.n + 1).fill(null), todo: Array.from({ length: r.n + 1 }, (_, i) => i), gen: 0 })); return; }
      push('uncertain marker CAS: read commit key -> not mine; re-read path', nrc({ pc: 'rc2', unc: null })); return;
    }
    if (u.k === 'rf') {
      if (!v.dmg && v.cur === u.newM) { push(`uncertain final CAS: read commit key -> my manifest ${v.cur} is current: DONE, nothing cleared`, end(r)); return; }
      push('uncertain final CAS: read commit key -> not mine; give up', end(r));
      if (cfg.abandonClear) push('uncertain final CAS: not mine; ABANDON: clear my marker (id and prefix)', nrc({ pc: 'racRd', unc: null }));
      return;
    }
    return;
  }
  if (r.pc === 'racRd') {
    const v = s.CK[0];
    const match = !v.dmg && (cfg.aclearNoCheck ? v.stg !== null : (v.stg && v.stg[0] === own && v.stg[1] === r.pfx));
    if (!match) { push('abandon-clear: staging is not mine; nothing cleared', end(r)); return; }
    push(`abandon-clear: read v${s.CK[1]}, staging matches`, nrc({ pc: 'racCas', tmp: { v: s.CK[1], cur: v.cur, ret: v.ret.slice(), pins: v.pins.slice(), q: v.seq, rec: v.rec } })); return;
  }
  if (r.pc === 'racCas') {
    const t = r.tmp;
    const w = ckWrite(st, cfg, { kind: 'aclear', who: own, rec: true, mk: [own, r.pfx], ifV: t.v, ifSeq: t.q, builtFrom: t.v, val: { cur: t.rec || t.cur, ret: t.ret, stg: null, pins: t.pins }, units: [] });
    if (w.conflict) { push('abandon-clear CAS -> 409; marker left standing', end(r)); return; }
    push(`abandon-clear: staging cleared -> v${w.rev}`, end(r), w.s, w.viol, w.env); return;
  }
}

// ---------------- global invariants ----------------
export function invariant(st, cfg) {
  const s = st.s; const ck = s.CK[0];
  if (s.CK[2]) return '(I4) the commit key does not exist';
  if (ck.dmg) return null;
  if (cfg.lossProp && st.env.dmg > 0 && ck.cur === null && ck.stg === null) {
    const live = Object.keys(s).some((k) => (k.startsWith('m/') || (k.startsWith('s/') && /\/m(\.g\d+)?$/.test(k))) && exists(s, k) && s[k][0].every((u) => exists(s, u)));
    if (!live) return '(L) the commit key names no current and no marker, and no candidate manifest with all its units remains: the profile is unrecoverable';
  }
  const ret = cfg.sepRetention ? s.RT[0].ret : ck.ret;
  const pins = ck.pins || [];
  const names = [...(ck.cur === null ? [] : [ck.cur]), ...ret, ...pins, ...(ck.rec ? [ck.rec] : [])];
  for (const m of names) {
    if (!exists(s, m)) return `(a) manifest ${m} named by the commit key${cfg.sepRetention ? '/retention key' : ''} (${m === ck.cur ? 'current' : m === ck.rec ? 'rec' : pins.includes(m) ? 'pin' : 'retained'}) does not exist`;
    for (const u of s[m][0]) if (!exists(s, u)) return `(a) unit ${u} referenced by manifest ${m} does not exist`;
  }
  return null;
}
