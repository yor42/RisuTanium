import fs from 'node:fs';
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
function available(s, key, now) {
  const h = s.routeHealth[key];
  return !h || (h.resetAt && Date.parse(h.resetAt) <= now);
}
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
    && !/^(\.claude|\.github|docs\/(workflow|wiki|branding))\//i.test(file)
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
function resourceKey(resource) {
  const normalized = normalizeResource(resource);
  return normalized.replace(/^(checkout|build|output):/, 'filesystem:');
}
function validateScheduling(d) {
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
    if (!d.resources.some(resource => resource.startsWith('device:'))) throw Error('Device track requires its explicit device resource');
    if (d.devicePhase === 'build') {
      if (!d.resources.some(resource => resource.startsWith('checkout:'))) throw Error('Device build must reserve its source checkout');
    } else if (!/^[a-f0-9]{64}$/i.test(d.artifact?.sha256 ?? '') || !d.artifact?.sourceRevision) throw Error('Device run requires pinned artifact hash and source revision');
  }
}
export async function selectRoute({ root = defaultRoot, jobId, mode, role, workClass, testOnly = false, legacy = false, escalation, gate, effortReason, changedContracts = [], scoutEffort = 'medium', now = Date.now() }) {
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
    routes = [{ provider: 'claude', model: p.nativeOnlyRoles[role], role, effort: 'high' }];
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
    if (role && role !== p.scheduling.devicePrimary.role || changedContracts.length) throw Error('Device primary cannot perform substantive design, code or review');
    routes = [p.scheduling.devicePrimary];
  }
  if (!legacy && mode === 'implement' && testOnly) {
    if (role && role !== p.scheduling.testPrimary.role || changedContracts.length) throw Error('Test primary writes test files only and cannot carry critical contracts');
    routes = [p.scheduling.testPrimary];
  }
  for (const route of routes) {
    const key = route.provider;
    if (!available(s, key, now)) { blocked.push(`${key}: cached unavailable`); continue; }
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
  const route = await selectRoute({ root, jobId: input.logicalJobId, mode: input.mode, role: input.role, workClass, testOnly: input.testOnly === true, escalation: input.escalation, gate: input.gate, effortReason: input.effortReason, changedContracts, scoutEffort: input.effort ?? 'medium' });
  if (!route.provider) throw Error(`No eligible route; park: ${route.blocked.join(', ')}`);
  if (input.provider && input.provider !== route.provider || input.model && input.model !== route.model || input.effort && input.effort !== route.effort) throw Error('Dispatch does not match eligible policy route');
  const d = { ...input, provider: route.provider, model: route.model, effort: route.effort, role: route.role ?? input.role, requestedRole: input.role ?? null, timeoutMinutes: input.timeoutMinutes ?? route.timeoutMinutes, changedContracts, workClass, schedulingAmendment: p.scheduling.amendment, policyRevision: p.revision, repoRoot: input.repoRoot ?? root, coordinatorRoot: root };
  if (!Number.isInteger(d.timeoutMinutes) || d.timeoutMinutes < 1 || d.timeoutMinutes > p.timeouts.maximum) throw Error('Timeout outside policy');
  for (const list of ['readScope', 'allowedWrites']) {
    d[list] ??= []; if (!Array.isArray(d[list])) throw Error('Dispatch paths must be arrays');
    d[list].forEach(relativePath);
  }
  if (d.mode !== 'implement' && d.allowedWrites.length) throw Error('Read-only mode cannot grant source writes');
  if (d.provider === 'agy' && d.mode !== 'scout') throw Error('Flash only scouts');
  if (!Array.isArray(d.resources ?? [])) throw Error('Resources must be an array');
  d.resources = resourceClaims(d, root);
  validateScheduling(d);
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
    const job = s.jobs[d.logicalJobId] ?? { mode: d.mode, role: d.requestedRole, changedContracts, correctionCount: 0, failedRoutes: [], attempts: [] };
    if (job.role !== d.requestedRole) throw Error('Logical job role changed');
    const priorClass = job.workClass ?? (job.attempts.length ? schedulingClass(s.dispatches[job.attempts[0]]) : d.workClass);
    if (priorClass !== d.workClass) throw Error('Logical job cannot change scheduling class');
    if (job.attempts.some(id => active.has(s.dispatches[id].status))) throw Error('Duplicate live logical job');
    if (job.status === 'completed') throw Error('Completed job requires a distinct new question, not a rerun');
    if (job.needsCorrection) {
      if (d.correction !== true || job.correctionCount >= p.maxCorrectionAttempts) throw Error('One explicit bounded correction required');
      job.correctionCount++; job.needsCorrection = false;
    } else if (d.correction) throw Error('Correction must follow observed failure');
    const live = Object.values(s.dispatches).filter(x => active.has(x.status));
    if (codeWriter(d) && live.filter(codeWriter).length >= p.maxImplementationTracks) throw Error('Implementation track cap');
    if (d.workClass === 'records' && live.filter(x => schedulingClass(x) === 'records').length >= p.scheduling.maxRecordsTracks) throw Error('Records track cap');
    if (d.workClass === 'device' && live.filter(x => schedulingClass(x) === 'device').length >= p.scheduling.maxDeviceTracks) throw Error('Device track cap');
    for (const other of live) {
      if (codeWriter(d) && codeWriter(other) && pathKey(other.repoRoot ?? other.workdir ?? root) === pathKey(d.repoRoot)) throw Error('Code writer checkout ownership overlaps; use separate source worktrees');
      const writes = new Set((other.allowedWrites ?? []).map(fileKey));
      if (d.allowedWrites.some(file => writes.has(fileKey(file)))) throw Error('Exact file ownership overlaps');
      const claims = new Set(resourceClaims(other, root).map(resourceKey));
      if (d.resources.some(resource => claims.has(resourceKey(resource)))) throw Error('Declared resource ownership overlaps');
    }
    if (d.independentOf) {
      const prior = s.dispatches[d.independentOf];
      if (!prior || active.has(prior.status) || prior.owner === d.owner) throw Error('Independent review requires a finished different owner');
    }
    atomicWrite(receipt, d); wroteReceipt = true;
    s.dispatches[d.id] = { hash: digest(d), logicalJobId: d.logicalJobId, mode: d.mode, provider: d.provider, model: d.model, role: d.role, owner: d.owner, workdir: d.workdir, repoRoot: d.repoRoot, allowedWrites: d.allowedWrites, workClass: d.workClass, resources: d.resources, status: 'registered' };
    job.workClass = d.workClass; job.attempts.push(d.id); job.status = 'registered'; s.jobs[d.logicalJobId] = job;
    return d;
  }); } catch (e) { if (wroteReceipt) { try { fs.unlinkSync(receipt); } catch {} } throw e; }
}
export async function validateDispatch(d, { root = defaultRoot, claim = false } = {}) {
  const p = loadPolicy(root); const s = loadState(root); const entry = s.dispatches[safeId(d.id)];
  if (s.activation !== 'active' || s.activeRevision !== p.revision) throw Error('Workflow frozen');
  if (!entry || entry.hash !== digest(d) || digest(savedDispatch(root, d.id)) !== entry.hash || d.policyRevision !== p.revision || entry.status !== 'registered') throw Error('Unregistered, changed, stale or already consumed dispatch');
  const route = await selectRoute({ root, jobId: d.logicalJobId, mode: d.mode, role: d.requestedRole, workClass: d.workClass, testOnly: d.testOnly === true, legacy: !d.schedulingAmendment, escalation: d.escalation, gate: d.gate, effortReason: d.effortReason, changedContracts: d.changedContracts, scoutEffort: d.effort });
  if (route.provider !== d.provider || route.model !== d.model) throw Error('Route changed before dispatch');
  if (claim) mutateState(root, s.generation, next => { if (next.dispatches[d.id].status !== 'registered') throw Error('Dispatch already claimed'); next.dispatches[d.id].status = 'running'; });
  return d;
}
export function finishDispatch({ root = defaultRoot, id, status, reason, resetAt, evidence }) {
  if (!['completed', 'partial', 'failed'].includes(status)) throw Error('Invalid completion status');
  if (reason && !['quota', 'unavailable', 'failed'].includes(reason)) throw Error('Invalid failure reason');
  if (resetAt && (!Number.isFinite(Date.parse(resetAt)) || Date.parse(resetAt) <= Date.now())) throw Error('Reset must be a future provider-observed timestamp');
  return mutateState(root, null, s => {
    const entry = s.dispatches[safeId(id)]; if (!entry || !active.has(entry.status)) throw Error('No live dispatch');
    const job = s.jobs[entry.logicalJobId]; entry.status = status; entry.evidence = evidence ?? null; job.status = status;
    if (reason === 'quota' || reason === 'unavailable') {
      s.routeHealth[entry.provider] = { reason, resetAt: resetAt ?? null, evidence: evidence ?? 'host error; explicit refresh required', observedAt: new Date().toISOString() };
      job.needsCorrection = false;
    } else if (status !== 'completed') {
      if (job.correctionCount < 1) job.needsCorrection = true;
      else { job.needsCorrection = false; job.failedRoutes.push(entry.provider); }
    }
    return { id, status, correctionCount: job.correctionCount };
  });
}
export function checkDevice({ root = defaultRoot, claim, result, required = false, evidence }) {
  safeId(claim);
  return mutateState(root, null, s => {
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
  if (['SessionStart', 'SubagentStart'].includes(payload.hook_event_name)) return { hookSpecificOutput: { hookEventName: payload.hook_event_name, additionalContext: `Workflow ${p.revision}; activation=${s.activation}; generation=${s.generation}. Parent Sonnet. Read Agents/Workflow-State.json and docs/workflow/subscription-first.md. External-first code/scouting; native Haiku record-clerk is primary for new clerical records. Keep two authorized disjoint code worktrees ready while separate records/device tracks progress; wait only on declared dependencies/resources. No parallel Claude duplicate. Preserve accepted scoped receipts and parked checks. Ready queue (order only for actual dependencies): ${s.queue.join(' -> ')}. Register every Agent dispatch; use [workflow-dispatch:ID] in prompt. Paid fallback currently ${p.openrouter.enabled ? 'requires activation proof' : 'disabled until verified cost bounds'}.` } };
  if (payload.hook_event_name !== 'PreToolUse' || payload.tool_name !== 'Agent') throw Error('Unexpected governance event');
  const match = payload.tool_input?.prompt?.match(/\[workflow-dispatch:([a-zA-Z0-9_.-]+)\]/);
  if (!match) throw Error('Register bounded dispatch first; native Agent requires [workflow-dispatch:ID]');
  const d = savedDispatch(root, match[1]);
  if (d.provider !== 'claude' || payload.tool_input.subagent_type !== d.role || payload.tool_input.model && payload.tool_input.model !== d.model) throw Error('Native role/model differs from registered route');
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
    const { jobs, dispatches, ...summary } = s;
    return { ...summary, jobCount: Object.keys(jobs).length, dispatchCount: Object.keys(dispatches).length, liveDispatches: Object.entries(dispatches).filter(([, entry]) => active.has(entry.status)).map(([id, entry]) => ({ id, ...entry })) };
  }
  if (command === 'route') return selectRoute({ root, jobId: a.job, mode: a.mode, role: a.role, workClass: a['work-class'], testOnly: a['test-only'] === 'true', gate: a.gate, effortReason: a['effort-reason'], escalation: a.trigger ? { kind: a.trigger, evidence: a.evidence } : undefined, changedContracts: a.contracts?.split(',').filter(Boolean), scoutEffort: a.effort });
  if (command === 'register') return registerDispatch(read(a.file), { root });
  if (command === 'finish' || command === 'failure') return finishDispatch({ root, id: a.id, status: a.status ?? 'failed', reason: a.reason, resetAt: a.reset, evidence: a.evidence });
  if (command === 'refresh') return mutateState(root, null, s => { if (!['codex', 'agy', 'openrouter', 'claude'].includes(a.provider)) throw Error('Invalid provider'); delete s.routeHealth[a.provider]; return { refreshed: a.provider }; });
  if (command === 'device') return checkDevice({ root, claim: a.claim, result: a.result, required: a.required === 'true', evidence: a.evidence });
  if (command === 'state') return mutateState(root, Number(a.generation), s => {
    const patch = read(a.file); const allowed = ['batch', 'stage', 'queue', 'acceptedReceipts', 'pendingClaims', 'parkedChecks', 'integrations', 'cutoverEvidence', 'activation', 'activeRevision'];
    for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw Error(`State field not patchable: ${key}`);
    Object.assign(s, patch); return { generation: s.generation + 1 };
  });
  if (command === 'hook') {
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    return hook(JSON.parse(input), { root });
  }
  return { usage: ['status', 'route --job ID --mode scout|implement|review [--role ROLE] [--work-class code|records|device|documents]', 'register --file ABS_DISPATCH_JSON', 'finish --id ID --status completed|partial|failed --evidence PATH', 'failure --id ID --reason quota|unavailable|failed [--reset ISO] --evidence PATH', 'refresh --provider NAME', 'state --file PATCH_JSON --generation N', 'device --claim ID --result pass|inconclusive|fail --required true --evidence PATH'], notes: 'No model invocation. State and dispatch locks fail closed; inspect owner before removing abandoned locks.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(`Workflow blocked: ${error.message}`); process.exitCode = process.argv[2] === 'hook' ? 2 : 1; });
}
