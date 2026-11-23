import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each controller call resolves the root many times and a git spawn costs seconds under load, so the
// common directory is read from the .git layout once per process; git stays the fallback for other layouts.
const rootCache = new Map();
function commonDirFromLayout(root) {
  const dotGit = path.join(root, '.git'); const stat = fs.statSync(dotGit);
  if (stat.isDirectory()) return fs.existsSync(path.join(dotGit, 'commondir')) ? null : dotGit;
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
  if (!pointer) return null;
  const gitDir = path.resolve(root, pointer[1]); const commondir = path.join(gitDir, 'commondir');
  return fs.existsSync(commondir) ? path.resolve(gitDir, fs.readFileSync(commondir, 'utf8').trim()) : null;
}
export function canonicalRoot(root) {
  root = path.resolve(root);
  if (rootCache.has(root)) return rootCache.get(root);
  if (!fs.existsSync(path.join(root, '.git'))) return root;
  let common = commonDirFromLayout(root);
  if (common == null) {
    const result = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw Error('Cannot resolve shared workflow root');
    common = result.stdout.trim();
  }
  if (path.basename(common) !== '.git') throw Error('Unsupported git-common directory; shared ledger root must be explicit before paid use');
  const resolved = fs.realpathSync(path.dirname(common)); rootCache.set(root, resolved); return resolved;
}
export const defaultRoot = canonicalRoot(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const ident = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const active = new Set(['registered', 'running']);
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const stateFile = root => path.join(canonicalRoot(root), 'Agents/Workflow-State.json');
const dispatchDir = root => path.join(canonicalRoot(root), '.claude/scratch/dispatches');
export function safeId(id) { if (!ident.test(id ?? '')) throw Error('Expected a bounded ID'); return id; }
export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(s => !s || s === '.' || s === '..') || /[\x00-\x1f*?]/.test(value)) throw Error('Expected exact relative path');
  return value;
}
// Lock windows are mutable so tests can shorten them; a lock older than staleMs belongs to a killed writer.
// fsOps is the seam tests use to provoke transient Windows rename refusals.
// breakerStaleMs stays below waitMs so a killed breaker cannot outlast every waiter's deadline.
export const lockOptions = { waitMs: 8000, staleMs: 60000, breakerStaleMs: 5000 };
export const fsOps = { renameSync: (from, to) => fs.renameSync(from, to) };
const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const jitter = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
const errCode = (e, ...codes) => codes.includes(e?.code);
const transient = e => errCode(e, 'EPERM', 'EBUSY', 'EACCES');
// beforeRename runs after the temp is durable and immediately before it replaces the target, so a check
// placed there leaves only the rename itself unguarded.
export function atomicWrite(file, value, beforeRename) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try {
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    beforeRename?.();
    // Windows refuses a rename over a file another process has open; retry briefly.
    for (let attempt = 1; ; attempt++) {
      try { fsOps.renameSync(temp, file); return; } catch (e) { if (!transient(e) || attempt >= 10) throw e; sleepSync(jitter(20, 100)); }
    }
  } catch (e) { try { fs.unlinkSync(temp); } catch {} throw e; }
}
// Only one process at a time may break a stale lock, and it re-checks staleness while holding the breaker
// directory, so a lock created after an earlier break is never removed as stale.
export function breakStaleLock(lock) {
  const breaker = `${lock}.break`;
  try { fs.mkdirSync(breaker); } catch (e) {
    if (!errCode(e, 'EEXIST')) { if (transient(e)) return; throw e; }
    try { if (Date.now() - fs.statSync(breaker).mtimeMs > lockOptions.breakerStaleMs) fs.rmdirSync(breaker); } catch {}
    return;
  }
  try { if (Date.now() - fs.statSync(lock).mtimeMs > lockOptions.staleMs) fs.unlinkSync(lock); } catch (e) { if (!errCode(e, 'ENOENT') && !transient(e)) throw e; }
  finally { try { fs.rmdirSync(breaker); } catch {} }
}
function acquireLock(lock) {
  const deadline = Date.now() + lockOptions.waitMs; const token = `${process.pid} ${crypto.randomUUID()}`;
  for (;;) {
    let fd = null;
    try { fd = fs.openSync(lock, 'wx'); fs.writeFileSync(fd, token); return { fd, token }; } catch (e) {
      if (fd != null) { try { fs.closeSync(fd); fs.unlinkSync(lock); } catch {} throw e; }
      if (!errCode(e, 'EEXIST') && !transient(e)) throw e;
    }
    try { if (Date.now() - fs.statSync(lock).mtimeMs > lockOptions.staleMs) breakStaleLock(lock); } catch (e) { if (!errCode(e, 'ENOENT') && !transient(e)) throw e; }
    if (Date.now() >= deadline) throw Error(`EEXIST: workflow state lock still held after ${lockOptions.waitMs} ms: ${lock}`);
    sleepSync(jitter(25, 250));
  }
}
const ownsLock = (lock, token) => { try { return fs.readFileSync(lock, 'utf8') === token; } catch { return false; } };
// Release is best effort: an error here must not mask the action's own error, and a leftover lock is
// broken after the stale window.
function releaseLock(lock, { fd, token }) {
  try { fs.closeSync(fd); } catch {}
  try { if (ownsLock(lock, token)) fs.unlinkSync(lock); } catch {}
}
export function loadPolicy(root = defaultRoot) {
  root = canonicalRoot(root);
  const p = read(path.join(root, '.claude/workflow-policy.json'));
  if (p.version !== 1 || p.maxCorrectionAttempts !== 1 || p.nativePaidUsage !== false || p.openrouter.perJobUSD !== 0.5 || p.openrouter.perDayUSD !== 5 || p.openrouter.perMonthUSD !== 30) throw Error('Unsupported or unsafe policy');
  // MC-2748 fixes the health-check window at 7 days and limits opt-in to Codex and Antigravity; a policy
  // written before those fields existed gets the same values.
  p.routeHealthMaxAgeDays ??= 7; p.optInProviders ??= ['codex', 'agy'];
  if (p.routeHealthMaxAgeDays !== 7 || !Array.isArray(p.optInProviders) || p.optInProviders.some(x => !['codex', 'agy'].includes(x))) throw Error('Unsupported or unsafe policy');
  if (Object.values(p.nativeModelChoices ?? {}).some(list => !Array.isArray(list))) throw Error('Unsupported or unsafe policy');
  if (p.scheduling.deviceRoles !== undefined && (!Array.isArray(p.scheduling.deviceRoles) || p.scheduling.deviceRoles.some(r => r !== p.scheduling.devicePrimary.role && !p.nativeFallbackRoles.implement?.[r]))) throw Error('Unsupported or unsafe policy');
  if (p.devicePool !== undefined) validateDevicePool(p.devicePool);
  return p;
}
export function loadState(root = defaultRoot) {
  const s = read(stateFile(root)); const p = loadPolicy(root);
  if (s.policyRevision !== p.revision || !Number.isInteger(s.generation)) throw Error('Policy/state revision mismatch');
  return s;
}
export function mutateState(root, expectedGeneration, action) {
  const file = stateFile(root); const lock = `${file}.lock`;
  const held = acquireLock(lock);
  try {
    const s = loadState(root); const loaded = s.generation;
    if (expectedGeneration != null && s.generation !== expectedGeneration) throw Error('Stale state generation');
    const result = action(s); s.generation++;
    // Re-checked just before the rename: if the lock was taken from us or another writer moved the
    // generation, this write must not replace theirs.
    atomicWrite(file, s, () => { if (!ownsLock(lock, held.token) || read(file).generation !== loaded) throw Error('Concurrent state write'); });
    return result;
  } finally { releaseLock(lock, held); }
}
// A policy revision bump would otherwise freeze every caller until the shared state names the new revision.
// The state moves only from the predecessor the policy itself names, under the state lock, and an
// already-adopted state is left alone so a repeated call is harmless.
export function adoptRevision({ root = defaultRoot, from }) {
  const p = loadPolicy(root); const file = stateFile(root); const lock = `${file}.lock`;
  if (!from || p.previousRevision !== from) throw Error('The policy does not name that revision as its predecessor');
  const held = acquireLock(lock);
  try {
    const s = read(file); const loaded = s.generation;
    if (!Number.isInteger(loaded)) throw Error('State generation is not an integer');
    if (s.policyRevision === p.revision) return { adopted: false, revision: p.revision, generation: loaded };
    if (s.policyRevision !== from) throw Error('State is not at the named predecessor revision');
    s.policyRevision = p.revision;
    // A frozen state stays frozen on its old activeRevision; only an active one moves with the policy.
    if (s.activeRevision === from) s.activeRevision = p.revision;
    s.generation++;
    atomicWrite(file, s, () => { if (!ownsLock(lock, held.token) || read(file).generation !== loaded) throw Error('Concurrent state write'); });
    return { adopted: true, from, revision: p.revision, activeRevision: s.activeRevision, generation: s.generation };
  } finally { releaseLock(lock, held); }
}
export async function paidActivation(root, policy) {
  root = canonicalRoot(root);
  if (!policy.openrouter.enabled) return { active: false, reasons: ['Paid activation disabled pending verified provider bounds/rates/key cap'] };
  try {
    const module = await import('./openrouter-worker.mjs');
    const config = read(path.join(root, policy.openrouter.activationFile));
    if (!module.assessActivation) return { active: false, reasons: ['Paid adapter activation interface unavailable'] };
    return await module.paidAssessment({ config, apiKeyAvailable: !!process.env.OPENROUTER_API_KEY, ledgerPath: path.join(root, policy.openrouter.ledgerFile) });
  } catch { return { active: false, reasons: ['Paid activation evidence missing or invalid'] }; }
}
const dayMs = 24 * 60 * 60 * 1000;
// A marker without a provider reset time expires routeHealthMaxAgeDays after it was observed; one with no
// observation date never expires on its own and needs a refresh or a passed health check.
function available(s, key, now, maxAgeMs) {
  const h = s.routeHealth[key];
  if (!h || h.reason === 'passed') return true;
  if (h.resetAt) return Date.parse(h.resetAt) <= now;
  return Date.parse(h.observedAt) + maxAgeMs <= now;
}
// A health-check probe exists to re-test a route marked unavailable, so only a provider-observed future
// reset (quota) holds it back.
const probeAvailable = (s, key, now) => { const h = s.routeHealth[key]; return !h?.resetAt || Date.parse(h.resetAt) <= now; };
const freshCheck = (s, key, now, maxAgeMs) => {
  const h = s.routeHealth[key]; const age = now - Date.parse(h?.checkedAt);
  return h?.reason === 'passed' && age >= 0 && age < maxAgeMs;
};
const classes = new Set(['code', 'records', 'device', 'documents']);
const isWindows = process.platform === 'win32';
const pathKey = value => {
  const win = /^[a-z]:[\\/]/i.test(value);
  const api = win ? path.win32 : path;
  const full = api.resolve(value);
  const trimmed = full.length > api.parse(full).root.length ? full.replace(/[\\/]+$/, '') : full;
  return win || isWindows ? trimmed.toLowerCase() : trimmed;
};
const fileKey = value => isWindows ? value.toLowerCase() : value;
const documentPath = file => /\.md$/i.test(file)
  && !/^(src|src-tauri|server)\//i.test(file) && !/(^|\/)\./.test(file)
  && !/^docs\/workflow\//i.test(file) && !/(^|\/)(AGENTS|CLAUDE|GEMINI|SKILL)\.md$/i.test(file);
export function schedulingClass(d) {
  if (d.workClass) { if (!classes.has(d.workClass)) throw Error('Unknown scheduling class'); return d.workClass; }
  const writes = d.allowedWrites ?? [];
  if (d.role === 'record-clerk' || d.requestedRole === 'record-clerk') return 'records';
  if (writes.length && writes.every(file => /^Agents\/(Maintainer-Context|Investigation-Ledger|Roadmap|Live-State|Carry-Forward)\.md$|^Agents\/Archive\/[^\r\n]+\.md$/i.test(file))) return 'records';
  return writes.some(file => !documentPath(file)) ? 'code' : 'documents';
}
function testPath(file) { return /(^|\/)(tests?|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /\.harness\.[jt]s$/.test(file); }
function codeWriter(d) { return d.mode === 'implement' && (d.allowedWrites?.length ?? 0) > 0 && schedulingClass(d) === 'code'; }
function clerkPath(file) {
  return documentPath(file) && !/^(AGENTS\.md|CLAUDE\.md|Agents\/(Maintainer-Context|README|Decision-Index)\.md)$/i.test(file)
    && !/^(\.claude|\.github|docs\/(workflow|wiki|branding)|Agents\/mc)\//i.test(file)
    && !/^docs\/(Terms-of-Services|Privacy-Policy)\.md$/i.test(file);
}
export function normalizeResource(resource) {
  if (typeof resource !== 'string' || /[\r\n\x00]/.test(resource)) throw Error('Invalid resource identity');
  const match = resource.match(/^(device|tcp|pool|checkout|build|output):(.+)$/i);
  if (!match) throw Error('Use a canonical device, tcp, pool, checkout, build or output resource');
  const kind = match[1].toLowerCase(); const value = match[2];
  if (kind === 'tcp') {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw Error('Declare TCP ports individually, not overlapping ranges');
    return `tcp:${Number(value)}`;
  }
  if (['checkout', 'build', 'output'].includes(kind)) {
    if (!path.isAbsolute(value) && !path.win32.isAbsolute(value)) throw Error('Filesystem resource must be absolute');
    return `${kind}:${pathKey(value)}`;
  }
  if (!value.trim() || /\s/.test(value)) throw Error('Resource names cannot contain whitespace');
  return `${kind}:${value.toLowerCase()}`;
}
function resourceClaims(d, root) {
  const claims = (d.resources ?? []).map(normalizeResource);
  if (codeWriter(d)) claims.push(normalizeResource(`checkout:${d.repoRoot ?? d.workdir ?? root}`));
  return [...new Set(claims)];
}
// ---- Device pool leases -------------------------------------------------------------------------
// Every lease read-modify-write runs inside one mutateState call, so a grant, an expiry and a release are
// serialized by the state lock. Liveness is the single predicate leaseLive; the stored status is bookkeeping.
// HELPER_RE is a hard-coded constant: no flag, environment variable or state file can widen it. The device
// guard (adbg) carries the same pattern.
const HELPER_RE = /^dev\.risu\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const TOKEN_RE = /^[A-Za-z0-9-]{16,128}$/;
const TICKET_RE = /^[A-Za-z0-9-]{1,32}$/;
const unsafePolicy = () => Error('Unsupported or unsafe policy');
const expandTemp = resource => resource.replace(/^([A-Za-z]+:)%TEMP%/, (_, kind) => kind + os.tmpdir());
function poolMembers(dp) {
  const out = [];
  for (const [pool, def] of Object.entries(dp.pools)) for (const m of def.members) out.push({ pool, resource: normalizeResource(expandTemp(m.resource)), ports: m.ports ?? null, prefix: m.prefix === true });
  return out;
}
function validateDevicePool(dp) {
  const bad = () => { throw unsafePolicy(); };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(dp) || !isObj(dp.pools) || !Object.keys(dp.pools).length) bad();
  const seen = new Set(); const taken = [];
  for (const [name, def] of Object.entries(dp.pools)) {
    if (!ident.test(name) || !isObj(def) || !Array.isArray(def.members) || !def.members.length) bad();
    for (const m of def.members) {
      if (!isObj(m) || typeof m.resource !== 'string') bad();
      let resource; try { resource = normalizeResource(expandTemp(m.resource)); } catch { bad(); }
      if (seen.has(resource)) bad(); seen.add(resource);
      if (resource.startsWith('device:')) {
        const [min, max] = m.ports ?? [];
        if (!Array.isArray(m.ports) || m.ports.length !== 2 || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 65535 || max - min + 1 > 128) bad();
        if (taken.some(([a, b]) => min <= b && max >= a)) bad();
        taken.push([min, max]);
      } else if (resource.startsWith('build:')) { if (m.ports !== undefined) bad(); } else bad();
    }
  }
  const names = Object.keys(dp.pools);
  if (!Array.isArray(dp.lockOrder) || dp.lockOrder.length !== names.length || new Set(dp.lockOrder).size !== names.length || dp.lockOrder.some(n => !names.includes(n))) bad();
  if (!Array.isArray(dp.priorityClasses) || !dp.priorityClasses.length || new Set(dp.priorityClasses).size !== dp.priorityClasses.length || dp.priorityClasses.some(c => typeof c !== 'string' || !ident.test(c))) bad();
  const num = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (![dp.leaseTtlSeconds, dp.heartbeatSeconds, dp.queueTtlSeconds, dp.pollSeconds, dp.retainEndedHours].every(num) || dp.heartbeatSeconds >= dp.leaseTtlSeconds || dp.pollSeconds >= dp.queueTtlSeconds || !Number.isInteger(dp.maxWaiting) || dp.maxWaiting < 1) bad();
  const standing = dp.standingPackages;
  if (!Array.isArray(standing) || new Set(standing).size !== standing.length || standing.some(x => typeof x !== 'string' || !PACKAGE_RE.test(x) || HELPER_RE.test(x))) bad();
}
function devicePool(p) { if (!p.devicePool) throw Error('No device pool in policy'); return p.devicePool; }
// The pool member a normalized resource belongs to: the member itself, a port inside a device member's
// range, or a build path under a prefix member.
function memberOf(dp, resource) {
  for (const m of poolMembers(dp)) {
    if (resource === m.resource) return m;
    if (m.prefix && resource.startsWith('build:') && resource.startsWith(m.resource)) return m;
    const port = /^tcp:(\d+)$/.exec(resource);
    if (m.ports && port && Number(port[1]) >= m.ports[0] && Number(port[1]) <= m.ports[1]) return m;
  }
  return null;
}
const leaseRequests = s => s.deviceLeases?.requests ?? {};
function leaseLive(req, p, now) {
  return !!req && !!p.devicePool && req.status === 'granted' && Date.parse(req.heartbeatAt) + p.devicePool.leaseTtlSeconds * 1000 > now;
}
const isDeviceMember = resource => resource.startsWith('device:');
// Bookkeeping only: it keeps stored state consistent with leaseLive. Decisions never depend on it having run.
function sweepLeases(s, p, now) {
  const dp = p.devicePool; const L = s.deviceLeases; const iso = new Date(now).toISOString();
  for (const [id, req] of Object.entries(L.requests)) {
    if (req.status === 'granted' && !leaseLive(req, p, now)) {
      req.status = 'expired'; req.endedAt = iso;
      if (isDeviceMember(req.member)) L.members[req.member] = { ...memberState(L, req.member), needsReset: true, reason: 'lease-expired', since: iso };
    } else if (req.status === 'waiting' && Date.parse(req.lastPollAt) + dp.queueTtlSeconds * 1000 <= now) { req.status = 'dropped'; req.endedAt = iso; }
    else if (!['waiting', 'granted'].includes(req.status) && Date.parse(req.endedAt) + dp.retainEndedHours * 3600000 <= now) delete L.requests[id];
  }
}
const memberState = (L, member) => L.members[member] ?? { needsReset: false, reason: null, since: null, stranded: [] };
const ensureLeases = s => { s.deviceLeases ??= { requests: {}, members: {} }; s.deviceLeases.requests ??= {}; s.deviceLeases.members ??= {}; return s.deviceLeases; };
// A lapsed lease stops its dispatch from claiming pool resources only; every other claim stays.
function effectiveClaims(entry, s, p, now, root) {
  const claims = resourceClaims(entry, root);
  if (!entry.lease || !p.devicePool || leaseLive(leaseRequests(s)[entry.lease], p, now)) return claims;
  return claims.filter(c => !memberOf(p.devicePool, c));
}
function busyMembers(s, p, now, root) {
  const dp = p.devicePool; const busy = new Set();
  for (const req of Object.values(leaseRequests(s))) if (leaseLive(req, p, now)) busy.add(req.member);
  for (const entry of Object.values(s.dispatches)) {
    if (!active.has(entry.status)) continue;
    for (const claim of effectiveClaims(entry, s, p, now, root)) { const m = memberOf(dp, claim); if (m) busy.add(m.resource); }
  }
  return busy;
}
function waitingQueue(s, p, pool) {
  const classes = p.devicePool.priorityClasses;
  return Object.entries(leaseRequests(s)).filter(([, r]) => r.pool === pool && r.status === 'waiting')
    .sort(([ia, a], [ib, b]) => classes.indexOf(a.priority) - classes.indexOf(b.priority) || Date.parse(a.enqueuedAt) - Date.parse(b.enqueuedAt) || (ia < ib ? -1 : ia > ib ? 1 : 0)).map(([id]) => id);
}
function freeMembers(s, p, pool, now, root) {
  const busy = busyMembers(s, p, now, root); const L = s.deviceLeases ?? { members: {} };
  const free = poolMembers(p.devicePool).filter(m => m.pool === pool && !busy.has(m.resource));
  const dirty = m => (L.members?.[m.resource]?.needsReset ? 1 : 0);
  return free.map((m, i) => [m, i]).sort(([a, i], [b, j]) => dirty(a) - dirty(b) || i - j).map(([m]) => m);
}
function grantView(s, p, id, now) {
  const req = leaseRequests(s)[id]; const dp = p.devicePool;
  const out ={ request: id, pool: req.pool, status: 'granted', member: req.member };
  if (isDeviceMember(req.member)) { out.serial = req.member.slice('device:'.length); out.ports = { min: req.ports[0], max: req.ports[1] }; }
  Object.assign(out, { expiresAt: new Date(Date.parse(req.heartbeatAt) + dp.leaseTtlSeconds * 1000).toISOString(), ttlSeconds: dp.leaseTtlSeconds, heartbeatSeconds: dp.heartbeatSeconds, resetRequired: req.resetRequired === true, strandedPackages: [...(s.deviceLeases.members[req.member]?.stranded ?? [])], standingPackages: [...dp.standingPackages], helperPattern: HELPER_RE.source });
  return out;
}
const tokenMatches = (req, token) => typeof token === 'string' && req.tokenHash === digest(token);
function leaseRequest(s, id, token) {
  const req = leaseRequests(s)[safeId(id)];
  if (!req || !tokenMatches(req, token)) throw Error('Request belongs to another holder');
  return req;
}
function evaluateGrant(s, p, id, now, root) {
  const L = s.deviceLeases; const req = L.requests[id];
  const rank = waitingQueue(s, p, req.pool).indexOf(id); const free = freeMembers(s, p, req.pool, now, root);
  if (rank < 0 || rank >= free.length) return { status: 'waiting', position: rank + 1, ahead: rank, free: free.length, pollSeconds: p.devicePool.pollSeconds };
  const m = free[rank]; const iso = new Date(now).toISOString(); const member = memberState(L, m.resource);
  L.members[m.resource] = member;
  Object.assign(req, { status: 'granted', member: m.resource, ports: m.ports ? [...m.ports] : null, grantedAt: iso, heartbeatAt: iso, resetRequired: member.needsReset === true });
  return null;
}
export function leaseAcquire({ root = defaultRoot, pool, request, token, holder, priority, ticket }) {
  const p = loadPolicy(root); const dp = devicePool(p);
  // The clock is read under the state lock so enqueue order is the order the lock was won.
  return mutateState(root, null, s => {
    const now = Date.now();
    const L = ensureLeases(s); sweepLeases(s, p, now);
    safeId(request); safeId(holder);
    if (!TOKEN_RE.test(token ?? '')) throw Error('Invalid lease token');
    if (!TICKET_RE.test(ticket ?? '')) throw Error('Invalid ticket');
    if (!dp.pools[pool]) throw Error('Unknown pool');
    if (!dp.priorityClasses.includes(priority)) throw Error('Unknown priority class');
    const iso = new Date(now).toISOString(); let req = L.requests[request];
    // A new request and a waiting re-poll are both refused while the ticket holds a live lease on a later pool.
    const lockOrderCheck = () => {
      const order = dp.lockOrder.indexOf(pool);
      for (const other of Object.values(L.requests)) if (other !== req && leaseLive(other, p, now) && other.ticket === ticket && dp.lockOrder.indexOf(other.pool) > order) throw Error(`Lock order: release ${other.pool} first`);
    };
    if (req) {
      if (!tokenMatches(req, token)) throw Error('Request belongs to another holder');
      if (req.pool !== pool || req.priority !== priority || req.holder !== holder || req.ticket !== ticket) throw Error('Request identity cannot change');
      if (req.status === 'granted') return grantView(s, p, request, now);
      if (req.status !== 'waiting') return { request, status: req.status };
      lockOrderCheck();
      req.lastPollAt = iso;
    } else {
      lockOrderCheck();
      if (Object.values(L.requests).filter(r => r.pool === pool && r.status === 'waiting').length >= dp.maxWaiting) throw Error('Queue full');
      req = L.requests[request] = { pool, holder, ticket, priority, tokenHash: digest(token), status: 'waiting', enqueuedAt: iso, lastPollAt: iso, member: null, ports: null, grantedAt: null, heartbeatAt: null, endedAt: null, resetRequired: false, resetEvidence: null, releaseCensus: null };
    }
    const waiting = evaluateGrant(s, p, request, now, root);
    return waiting ? { request, pool, ...waiting } : grantView(s, p, request, now);
  });
}
export function leaseRenew({ root = defaultRoot, request, token }) {
  const p = loadPolicy(root); devicePool(p);
  return mutateState(root, null, s => {
    const now = Date.now();
    const req = leaseRequest(s, request, token);
    if (req.status === 'expired' || req.status === 'granted' && !leaseLive(req, p, now)) throw Error('Lease expired; stop using the device');
    if (req.status !== 'granted') throw Error('Lease not granted');
    req.heartbeatAt = new Date(now).toISOString();
    return { request, status: 'granted', expiresAt: new Date(now + p.devicePool.leaseTtlSeconds * 1000).toISOString() };
  });
}
const absoluteFile = file => typeof file === 'string' && path.isAbsolute(file) && fs.existsSync(file) && fs.statSync(file).isFile();
export function leaseRelease({ root = defaultRoot, request, token, clean }) {
  const p = loadPolicy(root); devicePool(p);
  return mutateState(root, null, s => {
    const now = Date.now();
    const L = ensureLeases(s); leaseRequest(s, request, token); sweepLeases(s, p, now);
    const req = L.requests[request]; const iso = new Date(now).toISOString();
    if (req.status === 'waiting') { req.status = 'withdrawn'; req.endedAt = iso; return { request, status: 'withdrawn', member: null, needsReset: false }; }
    if (req.status !== 'granted') return { request, status: req.status, member: req.member, needsReset: L.members[req.member]?.needsReset === true };
    req.status = 'released'; req.endedAt = iso;
    if (isDeviceMember(req.member)) {
      const member = memberState(L, req.member);
      // A lease that never acknowledged its reset leaves the member's reset obligation in place.
      if (!req.resetRequired) {
        if (clean !== undefined && absoluteFile(clean)) { req.releaseCensus = clean; member.needsReset = false; }
        else Object.assign(member, { needsReset: true, reason: 'released-unchecked', since: iso });
      }
      L.members[req.member] = member;
    }
    return { request, status: 'released', member: req.member, needsReset: L.members[req.member]?.needsReset === true };
  });
}
export function leaseResetDone({ root = defaultRoot, request, token, evidence, stranded }) {
  const p = loadPolicy(root); const dp = devicePool(p);
  return mutateState(root, null, s => {
    const now = Date.now();
    const L = ensureLeases(s); leaseRequest(s, request, token);
    const req = L.requests[request];
    if (!leaseLive(req, p, now)) throw Error('Lease expired; stop using the device');
    if (!absoluteFile(evidence)) throw Error('Reset needs an existing absolute evidence file');
    const names = stranded ? stranded.split(',').filter(Boolean) : [];
    for (const name of names) if (!PACKAGE_RE.test(name) || HELPER_RE.test(name) || dp.standingPackages.includes(name)) throw Error(`Cannot mark ${name} stranded`);
    const member = memberState(L, req.member);
    member.stranded = [...new Set([...(member.stranded ?? []), ...names])]; member.needsReset = false;
    L.members[req.member] = member; req.resetRequired = false; req.resetEvidence = evidence;
    return { request, resetRequired: false, stranded: member.stranded };
  });
}
export function leaseStatus({ root = defaultRoot, pool, now = Date.now() }) {
  const p = loadPolicy(root); const dp = devicePool(p);
  const s = structuredClone(loadState(root)); ensureLeases(s); sweepLeases(s, p, now);
  const busy = busyMembers(s, p, now, root); const out = {};
  for (const name of Object.keys(dp.pools)) {
    if (pool && pool !== name) continue;
    const members = poolMembers(dp).filter(m => m.pool === name).map(m => {
      const holder = Object.entries(s.deviceLeases.requests).find(([, r]) => leaseLive(r, p, now) && r.member === m.resource);
      const st = memberState(s.deviceLeases, m.resource);
      return { resource: m.resource, busy: busy.has(m.resource), holder: holder?.[1].holder ?? null, ticket: holder?.[1].ticket ?? null, needsReset: st.needsReset, reason: st.reason, stranded: st.stranded };
    });
    const waiting = waitingQueue(s, p, name).map((id, i) => ({ request: id, position: i + 1, priority: s.deviceLeases.requests[id].priority, holder: s.deviceLeases.requests[id].holder }));
    out[name] = { members, waiting };
  }
  return { pools: out };
}
function resourceKey(resource) {
  const normalized = normalizeResource(resource);
  return normalized.replace(/^(checkout|build|output):/, 'filesystem:');
}
function validateScheduling(d, p) {
  const kind = schedulingClass(d);
  if (kind === 'records') {
    if (d.mode !== 'implement' || d.role !== 'record-clerk' || d.changedContracts.length || d.allowedWrites.some(file => !clerkPath(file))) throw Error('Records class is clerical Haiku authoring only; authoritative decisions/governance require a parent-applied scratch draft');
  }
  if (d.testOnly === true) {
    if (d.mode !== 'implement' || kind !== 'code' || !d.allowedWrites.length || d.allowedWrites.some(file => !testPath(file))) throw Error('Test-only dispatch is an implement dispatch whose every write is a test file');
  }
  if (d.role === 'record-clerk' && kind !== 'records') throw Error('New record-clerk dispatch requires records class');
  if (kind === 'documents' && d.allowedWrites.some(file => !documentPath(file))) throw Error('Documents class cannot carry application/configuration writes');
  if (kind === 'device') {
    if (d.allowedWrites.length) throw Error('Device track cannot write application or repository records');
    const buildSlot = d.devicePhase === 'build' && p.devicePool && d.resources.some(resource => resource.startsWith('build:') && memberOf(p.devicePool, resource));
    if (!buildSlot && !d.resources.some(resource => resource.startsWith('device:'))) throw Error('Device track requires its explicit device resource');
    if (d.devicePhase === 'build') {
      if (!d.resources.some(resource => resource.startsWith('checkout:'))) throw Error('Device build must reserve its source checkout');
    } else if (!/^[a-f0-9]{64}$/i.test(d.artifact?.sha256 ?? '') || !d.artifact?.sourceRevision) throw Error('Device run requires pinned artifact hash and source revision');
  }
}
export async function selectRoute({ root = defaultRoot, jobId, mode, role, workClass, testOnly = false, legacy = false, escalation, gate, effortReason, changedContracts = [], scoutEffort = 'medium', optIn = null, healthCheck = false, model = null, now = Date.now() }) {
  safeId(jobId); const p = loadPolicy(root); const s = loadState(root);
  if (!['scout', 'implement', 'review'].includes(mode)) throw Error('Invalid mode');
  if (changedContracts.some(c => !p.criticalContracts.includes(c))) throw Error('Unknown critical contract');
  let routes = p.routes[mode];
  if (mode === 'scout' && !p.nativeOnlyRoles[role]) {
    if (!['low', 'medium'].includes(scoutEffort)) throw Error('Scout effort must be low or medium');
    routes = routes.map(route => route.provider === 'agy' ? { ...route, effort: scoutEffort, model: `gemini-3.8-flash-${scoutEffort}` } : route.provider === 'codex' ? { ...route, effort: scoutEffort } : route);
  }
  if (role && !p.nativeOnlyRoles[role] && !p.nativeFallbackRoles[mode]?.[role]) throw Error('Role not eligible for this mode');
  if (role && p.nativeFallbackRoles[mode]?.[role]) routes = routes.map(route => route.provider === 'claude' ? { ...route, role, model: p.nativeFallbackRoles[mode][role] } : route);
  if (role && p.nativeOnlyRoles[role]) {
    if (role !== 'designer' && !(role === 'opus-reviewer' && changedContracts.length)) {
      const kinds = role === 'opus-reviewer' ? ['dispute', 'three-reject', 'maintainer'] : ['dispute', 'investigation-conflict', 'three-reject', 'expensive-plan', 'maintainer'];
      if (!kinds.includes(escalation?.kind) || typeof escalation.evidence !== 'string' || !escalation.evidence.trim()) throw Error('Native escalation needs a named eligible trigger and evidence');
    }
    let chosen = p.nativeOnlyRoles[role];
    // MC-3643: a cheaper model is only ever an explicit choice. Critical contracts and escalations keep the default.
    if (model && p.nativeModelChoices?.[role]?.includes(model)) {
      if (changedContracts.length || escalation) throw Error('A critical contract or escalation keeps the default model');
      chosen = model;
    }
    routes = [{ provider: 'claude', model: chosen, role, effort: 'high' }];
  }
  if (mode === 'review' && changedContracts.length) routes = [{ provider: 'claude', model: 'opus', role: 'opus-reviewer', effort: 'high' }];
  const persistence = changedContracts.some(c => c !== 'security-boundary');
  if (mode === 'review' && gate === 'Gate2' && persistence) routes = routes.map(route => ({ ...route, effort: 'xhigh' }));
  if (scoutEffort === 'xhigh' && routes.every(route => route.provider === 'claude')) {
    if (!effortReason?.trim() && !(mode === 'review' && gate === 'Gate2' && persistence)) throw Error('Raised native effort requires a named reason');
    routes = routes.map(route => ({ ...route, effort: 'xhigh' }));
  }
  const job = s.jobs[jobId];
  if (job && (job.mode !== mode || JSON.stringify(job.changedContracts) !== JSON.stringify(changedContracts))) throw Error('Job identity cannot change mode or critical contracts');
  const blocked = [];
  if (!legacy && mode === 'implement' && (workClass === 'records' || role === 'record-clerk')) {
    if (role && role !== 'record-clerk' || changedContracts.length) throw Error('Records primary cannot perform substantive design, code or review');
    routes = [p.scheduling.recordsPrimary];
  }
  if (!legacy && mode === 'implement' && workClass === 'device') {
    const deviceRoles = p.scheduling.deviceRoles ?? [p.scheduling.devicePrimary.role];
    if (role && !deviceRoles.includes(role) || changedContracts.length) throw Error('Device primary cannot perform substantive design, code or review');
    // A listed role other than the primary runs on its own configured model.
    routes = [role && role !== p.scheduling.devicePrimary.role ? { ...p.scheduling.devicePrimary, role, model: p.nativeFallbackRoles.implement[role], effort: 'low' } : p.scheduling.devicePrimary];
  }
  if (!legacy && mode === 'implement' && testOnly) {
    if (role && role !== p.scheduling.testPrimary.role || changedContracts.length) throw Error('Test primary writes test files only and cannot carry critical contracts');
    routes = [p.scheduling.testPrimary];
  }
  // MC-2748: native routes serve every ordinary dispatch whatever the policy order. An external route is
  // used only when the dispatch names it in optIn and it passed a route-health check inside the window;
  // the health-check probe itself is the one opt-in allowed without a passed check.
  const maxAgeMs = p.routeHealthMaxAgeDays * dayMs;
  if (healthCheck && optIn == null) throw Error('A route-health check names its provider in optIn');
  if (optIn != null) {
    if (!p.optInProviders.includes(optIn)) throw Error('Opt-in names Codex or Antigravity only');
    if (healthCheck && mode === 'implement') throw Error('A route-health check is a read-only scout or review probe');
    const candidates = routes.filter(route => route.provider === optIn);
    if (!candidates.length) throw Error(`No ${optIn} route is eligible for this dispatch`);
    if (!healthCheck && !freshCheck(s, optIn, now, maxAgeMs)) throw Error(`${optIn} opt-in needs a passed route-health check younger than ${p.routeHealthMaxAgeDays} days`);
    routes = candidates;
  } else {
    for (const route of routes) if (route.provider !== 'claude') blocked.push(`${route.provider}: opt-in only`);
    routes = routes.filter(route => route.provider === 'claude');
  }
  for (const route of routes) {
    const key = route.provider;
    if (!(healthCheck ? probeAvailable(s, key, now) : available(s, key, now, maxAgeMs))) { blocked.push(`${key}: cached unavailable`); continue; }
    if (job?.failedRoutes?.includes(key)) { blocked.push(`${key}: bounded correction exhausted`); continue; }
    if (route.provider === 'openrouter') {
      const check = await paidActivation(root, p);
      if (!check.active) { blocked.push(`openrouter: ${check.reasons?.join('; ') ?? 'inactive'}`); continue; }
    }
    return { ...route, mode, timeoutMinutes: p.timeouts[mode], blocked };
  }
  return { provider: null, status: 'parked', blocked };
}
function savedDispatch(root, id) {
  safeId(id); return read(path.join(dispatchDir(root), `${id}.json`));
}
export function registeredDispatch(root, id) {
  root = canonicalRoot(root); const d = savedDispatch(root, id); const s = loadState(root);
  if (!s.dispatches[id] || s.dispatches[id].hash !== digest(d)) throw Error('Registered dispatch receipt changed or missing');
  return d;
}
export async function registerDispatch(input, { root = defaultRoot } = {}) {
  root = canonicalRoot(root);
  const p = loadPolicy(root); safeId(input.id); safeId(input.logicalJobId);
  if (!input.question || !input.acceptance || !input.owner || !input.inputIdentity) throw Error('Dispatch needs question, acceptance, owner and inputIdentity');
  const changedContracts = input.changedContracts ?? [];
  const workClass = schedulingClass(input);
  if (input.optIn != null && typeof input.optIn !== 'string' || input.healthCheck != null && typeof input.healthCheck !== 'boolean') throw Error('optIn is a provider name and healthCheck a boolean');
  const optIn = input.optIn ?? null; const healthCheck = input.healthCheck === true;
  const route = await selectRoute({ root, jobId: input.logicalJobId, mode: input.mode, role: input.role, workClass, testOnly: input.testOnly === true, escalation: input.escalation, gate: input.gate, effortReason: input.effortReason, changedContracts, scoutEffort: input.effort ?? 'medium', optIn, healthCheck, model: input.model ?? null });
  if (!route.provider) throw Error(`No eligible route; park: ${route.blocked.join(', ')}`);
  if (input.provider && input.provider !== route.provider || input.model && input.model !== route.model || input.effort && input.effort !== route.effort) throw Error('Dispatch does not match eligible policy route');
  const d = { ...input, optIn, healthCheck, provider: route.provider, model: route.model, effort: route.effort, role: route.role ?? input.role, requestedRole: input.role ?? null, timeoutMinutes: input.timeoutMinutes ?? route.timeoutMinutes, changedContracts, workClass, schedulingAmendment: p.scheduling.amendment, policyRevision: p.revision, repoRoot: input.repoRoot ?? root, coordinatorRoot: root };
  if (!Number.isInteger(d.timeoutMinutes) || d.timeoutMinutes < 1 || d.timeoutMinutes > p.timeouts.maximum) throw Error('Timeout outside policy');
  for (const list of ['readScope', 'allowedWrites']) {
    d[list] ??= []; if (!Array.isArray(d[list])) throw Error('Dispatch paths must be arrays');
    d[list].forEach(relativePath);
  }
  if (d.mode !== 'implement' && d.allowedWrites.length) throw Error('Read-only mode cannot grant source writes');
  if (d.provider === 'agy' && d.mode !== 'scout') throw Error('Flash only scouts');
  if (!Array.isArray(d.resources ?? [])) throw Error('Resources must be an array');
  d.resources = resourceClaims(d, root);
  validateScheduling(d, p);
  // The token proves the caller holds the lease at registration; it never reaches the receipt or the state.
  const leaseToken = d.leaseToken; delete d.leaseToken;
  if (d.lease != null) safeId(d.lease);
  if (d.provider !== 'claude') {
    for (const key of ['workdir', 'promptFile', 'outFile', 'manifestFile']) if (!path.isAbsolute(d[key] ?? '')) throw Error(`Absolute ${key} required`);
    const manifestBytes = fs.readFileSync(d.manifestFile);
    d.manifestHash = crypto.createHash('sha256').update(manifestBytes).digest('hex');
  }
  const state = loadState(root); const receipt = path.join(dispatchDir(root), `${d.id}.json`); let wroteReceipt = false;
  // The receipt is written inside the mutation; if the state write then fails, a leftover receipt would
  // make every retry fail as "already used".
  try { return mutateState(root, state.generation, s => {
    if (s.activation !== 'active' || s.activeRevision !== p.revision) throw Error('Workflow is frozen');
    if (s.dispatches[d.id] || fs.existsSync(path.join(dispatchDir(root), `${d.id}.json`))) throw Error('Dispatch ID already used');
    const job = s.jobs[d.logicalJobId] ?? { mode: d.mode, role: d.requestedRole, changedContracts, correctionCount: 0, failedRoutes: [], attempts: [], optIn: d.optIn };
    if (job.role !== d.requestedRole) throw Error('Logical job role changed');
    if ((job.optIn ?? null) !== d.optIn) throw Error('Logical job cannot change its opt-in route');
    const priorClass = job.workClass ?? (job.attempts.length ? schedulingClass(s.dispatches[job.attempts[0]]) : d.workClass);
    if (priorClass !== d.workClass) throw Error('Logical job cannot change scheduling class');
    if (job.attempts.some(id => active.has(s.dispatches[id].status))) throw Error('Duplicate live logical job');
    if (job.status === 'completed') throw Error('Completed job requires a distinct new question, not a rerun');
    if (job.needsCorrection) {
      if (d.correction !== true || job.correctionCount >= p.maxCorrectionAttempts) throw Error('One explicit bounded correction required');
      job.correctionCount++; job.needsCorrection = false;
    } else if (d.correction) throw Error('Correction must follow observed failure');
    const now = Date.now();
    if (p.devicePool) {
      const hits = d.resources.map(r => [r, memberOf(p.devicePool, r)]).filter(([, m]) => m);
      if (hits.length && !d.lease) throw Error('Pool resource needs its live lease');
      if (d.lease) {
        const req = leaseRequests(s)[d.lease];
        if (!leaseLive(req, p, now) || !tokenMatches(req, leaseToken)) throw Error('Lease not live or token mismatch');
        if (!hits.length) throw Error('Lease names no leased resource');
        if (hits.some(([, m]) => m.resource !== req.member)) throw Error('Dispatch does not agree with its lease');
        if (d.workClass === 'device' && d.devicePhase !== 'build' && isDeviceMember(req.member) && !d.resources.includes(req.member)) throw Error('Dispatch does not agree with its lease');
      }
    }
    const live = Object.values(s.dispatches).filter(x => active.has(x.status));
    if (codeWriter(d) && live.filter(codeWriter).length >= p.maxImplementationTracks) throw Error('Implementation track cap');
    if (d.workClass === 'records' && live.filter(x => schedulingClass(x) === 'records').length >= p.scheduling.maxRecordsTracks) throw Error('Records track cap');
    if (d.workClass === 'device' && live.filter(x => schedulingClass(x) === 'device' && (!x.lease || leaseLive(leaseRequests(s)[x.lease], p, now))).length >= p.scheduling.maxDeviceTracks) throw Error('Device track cap');
    for (const other of live) {
      const sameCheckout = pathKey(other.repoRoot ?? other.workdir ?? root) === pathKey(d.repoRoot);
      if (codeWriter(d) && codeWriter(other) && sameCheckout) throw Error('Code writer checkout ownership overlaps; use separate source worktrees');
      // allowedWrites are checkout-relative: the same path in another worktree is a different file, and
      // separate worktrees are reconciled when they merge.
      const writes = new Set((other.allowedWrites ?? []).map(fileKey));
      if (sameCheckout && d.allowedWrites.some(file => writes.has(fileKey(file)))) throw Error('Exact file ownership overlaps');
      const claims = new Set(effectiveClaims(other, s, p, now, root).map(resourceKey));
      if (d.resources.some(resource => claims.has(resourceKey(resource)))) throw Error('Declared resource ownership overlaps');
    }
    if (d.independentOf) {
      const prior = s.dispatches[d.independentOf];
      if (!prior || active.has(prior.status) || prior.owner === d.owner) throw Error('Independent review requires a finished different owner');
    }
    atomicWrite(receipt, d); wroteReceipt = true;
    s.dispatches[d.id] = { hash: digest(d), logicalJobId: d.logicalJobId, mode: d.mode, provider: d.provider, model: d.model, role: d.role, owner: d.owner, workdir: d.workdir, repoRoot: d.repoRoot, allowedWrites: d.allowedWrites, workClass: d.workClass, resources: d.resources, ...(d.lease ? { lease: d.lease } : {}), healthCheck: d.healthCheck, status: 'registered' };
    job.workClass = d.workClass; job.attempts.push(d.id); job.status = 'registered'; s.jobs[d.logicalJobId] = job;
    return d;
  }); } catch (e) { if (wroteReceipt) { try { fs.unlinkSync(receipt); } catch {} } throw e; }
}
export async function validateDispatch(d, { root = defaultRoot, claim = false } = {}) {
  const p = loadPolicy(root); const s = loadState(root); const entry = s.dispatches[safeId(d.id)];
  if (s.activation !== 'active' || s.activeRevision !== p.revision) throw Error('Workflow frozen');
  // A receipt registered under the predecessor revision stays claimable across an adopted revision bump;
  // its route is recomputed under the current policy below and must still match.
  const knownRevision = d.policyRevision === p.revision || (p.previousRevision != null && d.policyRevision === p.previousRevision);
  if (!entry || entry.hash !== digest(d) || digest(savedDispatch(root, d.id)) !== entry.hash || !knownRevision || entry.status !== 'registered') throw Error('Unregistered, changed, stale or already consumed dispatch');
  const route = await selectRoute({ root, jobId: d.logicalJobId, mode: d.mode, role: d.requestedRole, workClass: d.workClass, testOnly: d.testOnly === true, legacy: !d.schedulingAmendment, escalation: d.escalation, gate: d.gate, effortReason: d.effortReason, changedContracts: d.changedContracts, scoutEffort: d.effort, optIn: d.optIn ?? null, healthCheck: d.healthCheck === true, model: d.model });
  if (route.provider !== d.provider || route.model !== d.model) throw Error('Route changed before dispatch');
  if (claim) mutateState(root, s.generation, next => { if (next.dispatches[d.id].status !== 'registered') throw Error('Dispatch already claimed');
    if (d.lease && !leaseLive(leaseRequests(next)[d.lease], p, Date.now())) throw Error('Lease no longer live');
    next.dispatches[d.id].status = 'running'; });
  return d;
}
export function finishDispatch({ root = defaultRoot, id, status, reason, resetAt, evidence }) {
  if (!['completed', 'partial', 'failed'].includes(status)) throw Error('Invalid completion status');
  if (reason && !['quota', 'unavailable', 'failed'].includes(reason)) throw Error('Invalid failure reason');
  if (resetAt && (!Number.isFinite(Date.parse(resetAt)) || Date.parse(resetAt) <= Date.now())) throw Error('Reset must be a future provider-observed timestamp');
  return mutateState(root, null, s => {
    const entry = s.dispatches[safeId(id)]; if (!entry || !active.has(entry.status)) throw Error('No live dispatch');
    const job = s.jobs[entry.logicalJobId]; entry.status = status; entry.evidence = evidence ?? null; job.status = status;
    if (entry.healthCheck) {
      // The probe's outcome is the route-health record: completed passes the route for the window, anything
      // else marks it unavailable. A probe is never corrected; the next check is a new probe.
      const observedAt = new Date().toISOString();
      if (status === 'completed' && !evidence) throw Error('A passed route-health check needs its evidence');
      s.routeHealth[entry.provider] = status === 'completed'
        ? { reason: 'passed', checkedAt: observedAt, evidence, dispatch: id }
        : { reason: reason === 'quota' ? 'quota' : 'unavailable', resetAt: resetAt ?? null, evidence: evidence ?? 'route-health check did not pass', observedAt };
      job.needsCorrection = false;
    } else if (reason === 'quota' || reason === 'unavailable') {
      s.routeHealth[entry.provider] = { reason, resetAt: resetAt ?? null, evidence: evidence ?? 'host error; explicit refresh required', observedAt: new Date().toISOString() };
      job.needsCorrection = false;
    } else if (status !== 'completed') {
      if (job.correctionCount < 1) job.needsCorrection = true;
      else { job.needsCorrection = false; job.failedRoutes.push(entry.provider); }
    }
    return { id, status, correctionCount: job.correctionCount };
  });
}
export function checkDevice({ root = defaultRoot, claim, result, required = false, evidence, lease, token }) {
  safeId(claim);
  return mutateState(root, null, s => {
    // A row only counts while its lease is live and any reset it owed has been acknowledged.
    if (lease != null) {
      const p = loadPolicy(root); devicePool(p); const req = leaseRequest(s, lease, token);
      if (!leaseLive(req, p, Date.now())) throw Error('Lease expired; stop using the device');
      if (req.resetRequired) throw Error('Lease reset not acknowledged');
    }
    const item = s.deviceAttempts[claim] ?? { attempts: 0, required };
    if (item.attempts >= 2 && !item.closed) throw Error('Device check parked; changed applicability or maintainer decision required');
    if (item.closed) throw Error('Accepted check is closed');
    item.attempts++; item.evidence = evidence; item.result = result;
    if (result === 'pass') item.closed = true;
    else if (item.attempts >= 2) { item.parked = true; s.parkedChecks.push({ claim, required: item.required, evidence, reason: 'Planned check and one diagnostic retry exhausted' }); }
    s.deviceAttempts[claim] = item; return item;
  });
}
export async function hook(payload, { root = defaultRoot } = {}) {
  const s = loadState(root); const p = loadPolicy(root);
  if (['SessionStart', 'SubagentStart'].includes(payload.hook_event_name)) return { hookSpecificOutput: { hookEventName: payload.hook_event_name, additionalContext: `Workflow ${p.revision}; activation=${s.activation}; generation=${s.generation}. Rules: AGENTS.md, CLAUDE.md and docs/workflow (governance v2). Current state is in Agents/Live-State.md, the latest lane handoff and GitHub project board 1 (issues on yor42/RisuTanium), not in this hook. Routing is native first (MC-2748): ordinary dispatches take the native role; Codex or agy only with optIn on the dispatch after a passed route-health check younger than ${p.routeHealthMaxAgeDays} days (docs/workflow/routing.md). One session, worktree and PR per ticket. Preserve accepted scoped receipts and parked checks named in your brief. Register every Agent dispatch; use [workflow-dispatch:ID] in prompt. Paid fallback currently ${p.openrouter.enabled ? 'requires activation proof' : 'disabled until verified cost bounds'}.` } };
  if (payload.hook_event_name !== 'PreToolUse' || payload.tool_name !== 'Agent') throw Error('Unexpected governance event');
  const match = payload.tool_input?.prompt?.match(/\[workflow-dispatch:([a-zA-Z0-9_.-]+)\]/);
  if (!match) throw Error('Register bounded dispatch first; native Agent requires [workflow-dispatch:ID]');
  const d = savedDispatch(root, match[1]);
  if (d.provider !== 'claude' || payload.tool_input.subagent_type !== d.role || payload.tool_input.model && payload.tool_input.model !== d.model) throw Error('Native role/model differs from registered route');
  // Without a model the Agent tool runs the profile's default, which would differ from a chosen-model receipt.
  if (p.nativeOnlyRoles[d.role] && d.model !== p.nativeOnlyRoles[d.role] && payload.tool_input.model !== d.model) throw Error('A chosen-model dispatch names its model in the Agent call');
  await validateDispatch(d, { root, claim: true });
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `Registered ${d.id}. ${d.question}. Native subscription quota only; stop on quota, no API/extra usage. Report file then finish this dispatch in workflow-control.` } };
}
function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith('--') || args[i + 1] == null) throw Error('Expected --key value'); out[args[i].slice(2)] = args[i + 1]; }
  return out;
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args; const a = flags(rest); const root = a.root ? path.resolve(a.root) : defaultRoot;
  if (command === 'status') {
    const s = loadState(root);
    const { jobs, dispatches, deviceLeases, ...summary } = s;
    return { ...summary, jobCount: Object.keys(jobs).length, dispatchCount: Object.keys(dispatches).length, liveDispatches: Object.entries(dispatches).filter(([, entry]) => active.has(entry.status)).map(([id, entry]) => ({ id, ...entry })) };
  }
  if (command === 'route') return selectRoute({ root, jobId: a.job, mode: a.mode, role: a.role, workClass: a['work-class'], testOnly: a['test-only'] === 'true', gate: a.gate, effortReason: a['effort-reason'], escalation: a.trigger ? { kind: a.trigger, evidence: a.evidence } : undefined, changedContracts: a.contracts?.split(',').filter(Boolean), scoutEffort: a.effort, optIn: a['opt-in'] ?? null, healthCheck: a['health-check'] === 'true' });
  if (command === 'register') return registerDispatch(read(a.file), { root });
  if (command === 'finish' || command === 'failure') return finishDispatch({ root, id: a.id, status: a.status ?? 'failed', reason: a.reason, resetAt: a.reset, evidence: a.evidence });
  if (command === 'refresh') return mutateState(root, null, s => { if (!['codex', 'agy', 'openrouter', 'claude'].includes(a.provider)) throw Error('Invalid provider'); delete s.routeHealth[a.provider]; return { refreshed: a.provider }; });
  if (command === 'adopt-revision') return adoptRevision({ root, from: a.from });
  if (command === 'device') return checkDevice({ root, claim: a.claim, result: a.result, required: a.required === 'true', evidence: a.evidence, lease: a.lease, token: a.token });
  if (command === 'lease-acquire') return leaseAcquire({ root, pool: a.pool, request: a.request, token: a.token, holder: a.holder, priority: a.priority, ticket: a.ticket });
  if (command === 'lease-renew') return leaseRenew({ root, request: a.request, token: a.token });
  if (command === 'lease-release') return leaseRelease({ root, request: a.request, token: a.token, clean: a.clean });
  if (command === 'lease-reset-done') return leaseResetDone({ root, request: a.request, token: a.token, evidence: a.evidence, stranded: a.stranded });
  if (command === 'lease-status') return leaseStatus({ root, pool: a.pool });
  if (command === 'state') return mutateState(root, Number(a.generation), s => {
    const patch = read(a.file); const allowed = ['batch', 'stage', 'queue', 'acceptedReceipts', 'pendingClaims', 'parkedChecks', 'integrations', 'cutoverEvidence', 'activation', 'activeRevision'];
    for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw Error(`State field not patchable: ${key}`);
    Object.assign(s, patch); return { generation: s.generation + 1 };
  });
  if (command === 'hook') {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    return hook(JSON.parse(input), { root });
  }
  return { usage: ['status', 'route --job ID --mode scout|implement|review [--role ROLE] [--work-class code|records|device|documents] [--opt-in codex|agy [--health-check true]]', 'register --file ABS_DISPATCH_JSON', 'finish --id ID --status completed|partial|failed --evidence PATH', 'failure --id ID --reason quota|unavailable|failed [--reset ISO] --evidence PATH', 'refresh --provider NAME', 'adopt-revision --from PREVIOUS_REVISION', 'state --file PATCH_JSON --generation N', 'device --claim ID --result pass|inconclusive|fail --required true --evidence PATH [--lease REQUEST --token TOKEN]', 'lease-acquire --pool P --request R --token T --holder H --priority CLASS --ticket N', 'lease-renew --request R --token T', 'lease-release --request R --token T [--clean CENSUS_PATH]', 'lease-reset-done --request R --token T --evidence PATH [--stranded PKG1,PKG2]', 'lease-status [--pool P]'], notes: 'No model invocation. State and dispatch locks fail closed; inspect owner before removing abandoned locks.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(`Workflow blocked: ${error.message}`); process.exitCode = process.argv[2] === 'hook' ? 2 : 1; });
}
