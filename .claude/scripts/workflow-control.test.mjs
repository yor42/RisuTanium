import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { registerDispatch, validateDispatch, selectRoute, finishDispatch, loadState, mutateState, hook, checkDevice, lockOptions, canonicalRoot, fsOps, breakStaleLock, adoptRevision } from './workflow-control.mjs';
// The committed state snapshot is not the live state and may lag a policy revision; fixtures take the revision from the policy.
const policyRevision = () => JSON.parse(fs.readFileSync(new URL('../workflow-policy.json', import.meta.url), 'utf8')).revision;

let currentFixture;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true }); fs.mkdirSync(path.join(root, 'Agents'));
  fs.copyFileSync(new URL('../workflow-policy.json', import.meta.url), path.join(root, '.claude/workflow-policy.json'));
  const state = JSON.parse(fs.readFileSync(new URL('../../Agents/Workflow-State.json', import.meta.url)));
  // The queue is pinned so no assertion depends on the live queue text of the repository state.
  Object.assign(state, { generation: 0, activation: 'active', policyRevision: policyRevision(), activeRevision: policyRevision(), queue: ['SR2 fixture queue entry'], jobs: {}, dispatches: {}, routeHealth: {}, parkedChecks: [], deviceAttempts: {} });
  fs.writeFileSync(path.join(root, 'Agents/Workflow-State.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(root, 'host.manifest.json'), '{}'); currentFixture = root; return root;
}
const job = (extra = {}) => ({ id: 'd1', logicalJobId: 'j1', mode: 'implement', question: 'Fix bounded fixture', acceptance: ['Fixture holds'], owner: 'worker-context-1', inputIdentity: 'fixture-snapshot', workdir: path.join(currentFixture, 'isolated-fixture'), promptFile: path.join(currentFixture, 'prompt.md'), outFile: path.join(currentFixture, 'result.json'), manifestFile: path.join(currentFixture, 'host.manifest.json'), readScope: ['src/a.ts'], allowedWrites: ['src/a.ts'], ...extra });
test('native first: ordinary dispatches take the native role and external routes are opt-in only', async t => {
  const root = fixture(t); const scout = await selectRoute({ root, jobId: 's', mode: 'scout' });
  assert.deepEqual([scout.provider, scout.role], ['claude', 'investigator']); assert.match(scout.blocked.join(), /agy: opt-in only/);
  const native = await registerDispatch(job(), { root }); assert.deepEqual([native.provider, native.role], ['claude', 'sonnet-coder']);
  assert.equal((await validateDispatch(native, { root })).id, 'd1');
  await assert.rejects(registerDispatch(job({ id: 'd2', logicalJobId: 'j2', provider: 'codex' }), { root }), /eligible/);
});
test('an opt-in route needs a passed route-health check younger than seven days; the probe records it', async t => {
  const root = fixture(t); const day = 24 * 60 * 60 * 1000;
  // A marker without a reset time is what the shared state holds for codex today; the probe must still run.
  mutateState(root, null, s => { s.routeHealth.codex = { reason: 'quota', resetAt: null, observedAt: new Date().toISOString() }; });
  await assert.rejects(registerDispatch(job({ optIn: 'codex' }), { root }), /route-health check younger than 7 days/);
  await assert.rejects(selectRoute({ root, jobId: 'x', mode: 'implement', optIn: 'openrouter' }), /Codex or Antigravity only/);
  await assert.rejects(selectRoute({ root, jobId: 'x', mode: 'implement', optIn: 'agy', healthCheck: true }), /read-only/);
  await assert.rejects(selectRoute({ root, jobId: 'x', mode: 'review', healthCheck: true }), /names its provider/);
  await assert.rejects(selectRoute({ root, jobId: 'x', mode: 'review', optIn: 'codex', changedContracts: ['dirty-dependencies'] }), /No codex route/);
  const probe = await registerDispatch(job({ id: 'probe', logicalJobId: 'probe', mode: 'review', allowedWrites: [], optIn: 'codex', healthCheck: true }), { root });
  assert.equal(probe.provider, 'codex');
  await validateDispatch(probe, { root, claim: true });
  assert.throws(() => finishDispatch({ root, id: 'probe', status: 'completed' }), /needs its evidence/);
  finishDispatch({ root, id: 'probe', status: 'completed', evidence: 'probe.out.json.host.json' });
  const health = loadState(root).routeHealth.codex; assert.equal(health.reason, 'passed'); assert.equal(health.dispatch, 'probe');
  const checked = Date.parse(health.checkedAt);
  assert.equal((await selectRoute({ root, jobId: 'j1', mode: 'implement', optIn: 'codex', now: checked + 7 * day - 1 })).provider, 'codex');
  await assert.rejects(selectRoute({ root, jobId: 'j1', mode: 'implement', optIn: 'codex', now: checked + 7 * day }), /younger than 7 days/);
  assert.equal((await selectRoute({ root, jobId: 'j1', mode: 'implement', now: checked + day })).provider, 'claude');
  const opted = await registerDispatch(job({ optIn: 'codex' }), { root }); assert.equal(opted.provider, 'codex');
  finishDispatch({ root, id: 'd1', status: 'failed', reason: 'failed', evidence: 'fixture' });
  await assert.rejects(registerDispatch(job({ id: 'd2', correction: true }), { root }), /opt-in route/);
});
test('a failed probe marks the route unavailable; a marker without a reset time expires after seven days', async t => {
  const root = fixture(t); const day = 24 * 60 * 60 * 1000;
  await registerDispatch(job({ id: 'probe', logicalJobId: 'probe', mode: 'scout', allowedWrites: [], optIn: 'agy', healthCheck: true }), { root });
  finishDispatch({ root, id: 'probe', status: 'failed', reason: 'failed', evidence: 'probe log' });
  const health = loadState(root).routeHealth.agy; assert.deepEqual([health.reason, health.resetAt], ['unavailable', null]);
  await assert.rejects(selectRoute({ root, jobId: 'x', mode: 'scout', optIn: 'agy' }), /route-health check/);
  const observed = Date.now();
  mutateState(root, null, s => { s.routeHealth.claude = { reason: 'quota', resetAt: null, observedAt: new Date(observed).toISOString() }; });
  assert.equal((await selectRoute({ root, jobId: 'x', mode: 'implement', now: observed + 7 * day - 1 })).status, 'parked');
  assert.equal((await selectRoute({ root, jobId: 'x', mode: 'implement', now: observed + 7 * day })).provider, 'claude');
  // A future provider-observed reset holds even a probe back.
  mutateState(root, null, s => { s.routeHealth.codex = { reason: 'quota', resetAt: new Date(observed + day).toISOString(), observedAt: new Date(observed).toISOString() }; });
  assert.equal((await selectRoute({ root, jobId: 'p2', mode: 'review', optIn: 'codex', healthCheck: true, now: observed })).status, 'parked');
});
test('adopt-revision moves the state from the named predecessor only, once, and old receipts stay claimable', async t => {
  const root = fixture(t); const file = path.join(root, 'Agents/Workflow-State.json');
  const policy = JSON.parse(fs.readFileSync(path.join(root, '.claude/workflow-policy.json'), 'utf8'));
  assert.ok(policy.previousRevision && policy.previousRevision !== policy.revision);
  const old = JSON.parse(fs.readFileSync(file, 'utf8')); old.policyRevision = old.activeRevision = policy.previousRevision; fs.writeFileSync(file, JSON.stringify(old));
  assert.throws(() => loadState(root), /revision mismatch/);
  assert.throws(() => adoptRevision({ root, from: 'not-the-predecessor' }), /predecessor/);
  const result = adoptRevision({ root, from: policy.previousRevision });
  assert.deepEqual([result.adopted, result.revision, result.activeRevision, result.generation], [true, policy.revision, policy.revision, 1]);
  assert.equal(loadState(root).generation, 1);
  assert.equal(adoptRevision({ root, from: policy.previousRevision }).adopted, false); assert.equal(loadState(root).generation, 1);
  // A frozen state keeps its old activeRevision, so adoption never unfreezes it.
  const frozen = JSON.parse(fs.readFileSync(file, 'utf8')); frozen.policyRevision = policy.previousRevision; frozen.activeRevision = 'frozen-at-cutover'; fs.writeFileSync(file, JSON.stringify(frozen));
  assert.equal(adoptRevision({ root, from: policy.previousRevision }).activeRevision, 'frozen-at-cutover');
  const stranger = JSON.parse(fs.readFileSync(file, 'utf8')); stranger.policyRevision = 'some-other'; fs.writeFileSync(file, JSON.stringify(stranger));
  assert.throws(() => adoptRevision({ root, from: policy.previousRevision }), /not at the named predecessor/);
});
test('no parallel duplicate or changed dispatch, execution claim consumed once', async t => {
  const root = fixture(t); const d = await registerDispatch(job(), { root });
  await assert.rejects(registerDispatch(job({ id: 'd2' }), { root }), /Duplicate/);
  await assert.rejects(validateDispatch({ ...d, model: 'gpt-6.1-sol' }, { root }), /changed/);
  await validateDispatch(d, { root, claim: true }); await assert.rejects(validateDispatch(d, { root, claim: true }), /consumed/);
});
test('one correction persists across failure and context; an exhausted native route parks the job', async t => {
  const root = fixture(t); await registerDispatch(job(), { root }); finishDispatch({ root, id: 'd1', status: 'failed', reason: 'failed' });
  await assert.rejects(registerDispatch(job({ id: 'd2' }), { root }), /correction/);
  await registerDispatch(job({ id: 'd2', correction: true }), { root }); finishDispatch({ root, id: 'd2', status: 'failed', reason: 'failed' });
  await assert.rejects(registerDispatch(job({ id: 'd3' }), { root }), /No eligible route/);
  assert.equal((await selectRoute({ root, jobId: 'j1', mode: 'implement' })).status, 'parked');
});
test('ordinary native duplicate denied; actual critical-contract review uses Opus', async t => {
  const root = fixture(t);
  await assert.rejects(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'sonnet-coder', prompt: 'Do it' } }, { root }), /Register/);
  await assert.rejects(registerDispatch(job({ provider: 'claude', model: 'opus' }), { root }), /eligible/);
  const d = await registerDispatch(job({ mode: 'review', changedContracts: ['dirty-dependencies'], allowedWrites: [], owner: 'fresh-reviewer' }), { root });
  assert.equal(d.model, 'opus');
  await hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'opus-reviewer', prompt: '[workflow-dispatch:d1]' } }, { root });
  await assert.rejects(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'opus-reviewer', prompt: '[workflow-dispatch:d1]' } }, { root }), /consumed/);
});
test('write ownership, model escalation and read-only write grant fail closed', async t => {
  const root = fixture(t);
  await assert.rejects(registerDispatch(job({ model: 'gpt-6.1-sol' }), { root }), /eligible/);
  await assert.rejects(registerDispatch(job({ mode: 'scout' }), { root }), /Read-only/);
  await registerDispatch(job(), { root });
  await assert.rejects(registerDispatch(job({ id: 'd2', logicalJobId: 'j2', workdir: path.join(os.tmpdir(), 'other'), owner: 'worker2' }), { root }), /overlaps/);
});
test('generation and lock conflicts block; frozen cutover blocks new work', async t => {
  const root = fixture(t); mutateState(root, 0, s => { s.activation = 'frozen'; });
  assert.throws(() => mutateState(root, 0, () => {}), /Stale/);
  await assert.rejects(registerDispatch(job(), { root }), /frozen/);
  const saved = { ...lockOptions }; t.after(() => Object.assign(lockOptions, saved)); lockOptions.waitMs = 300;
  fs.writeFileSync(path.join(root, 'Agents/Workflow-State.json.lock'), 'held');
  assert.throws(() => mutateState(root, null, () => {}), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(root, 'Agents/Workflow-State.json.lock'), 'utf8'), 'held');
});
test('a linked worktree resolves to the main checkout from the .git layout', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-root-')); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main'); const linked = path.join(base, 'linked'); const gitDir = path.join(main, '.git/worktrees/linked');
  fs.mkdirSync(gitDir, { recursive: true }); fs.mkdirSync(linked);
  fs.writeFileSync(path.join(linked, '.git'), `gitdir: ${gitDir}\n`); fs.writeFileSync(path.join(gitDir, 'commondir'), '../..\n');
  assert.equal(canonicalRoot(linked), fs.realpathSync(main)); assert.equal(canonicalRoot(main), fs.realpathSync(main));
  const relative = path.join(base, 'relative'); const relGitDir = path.join(main, '.git/worktrees/relative');
  fs.mkdirSync(relGitDir, { recursive: true }); fs.mkdirSync(relative);
  fs.writeFileSync(path.join(relative, '.git'), 'gitdir: ../main/.git/worktrees/relative\r\n'); fs.writeFileSync(path.join(relGitDir, 'commondir'), '../..\r\n');
  assert.equal(canonicalRoot(relative), fs.realpathSync(main));
});
const lockFile = root => path.join(root, 'Agents/Workflow-State.json.lock');
const leftovers = root => fs.readdirSync(path.join(root, 'Agents')).filter(f => /\.(lock|stale|tmp)$/.test(f));
test('a lock left by a killed writer is broken after the stale window', t => {
  const root = fixture(t); fs.writeFileSync(lockFile(root), 'killed');
  const old = new Date(Date.now() - 120000); fs.utimesSync(lockFile(root), old, old);
  mutateState(root, null, s => { s.activation = 'frozen'; });
  assert.equal(loadState(root).activation, 'frozen'); assert.deepEqual(leftovers(root), []);
});
test('a fresh lock released by another process during the wait is acquired', async t => {
  const root = fixture(t); const saved = { ...lockOptions }; t.after(() => Object.assign(lockOptions, saved)); lockOptions.waitMs = 6000;
  fs.writeFileSync(lockFile(root), 'busy');
  const child = spawn(process.execPath, ['-e', `setTimeout(() => require('fs').unlinkSync(${JSON.stringify(lockFile(root))}), 300)`], { stdio: 'ignore' });
  await new Promise(resolve => child.once('spawn', resolve));
  mutateState(root, null, s => { s.activation = 'frozen'; });
  assert.equal(loadState(root).activation, 'frozen'); assert.deepEqual(leftovers(root), []);
  await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
});
test('a writer whose lock was taken refuses the write and leaves the new owner\'s lock', t => {
  const root = fixture(t);
  assert.throws(() => mutateState(root, null, s => { s.activation = 'mine'; fs.writeFileSync(lockFile(root), 'other-owner'); }), /Concurrent/);
  assert.equal(fs.readFileSync(lockFile(root), 'utf8'), 'other-owner'); assert.equal(loadState(root).activation, 'active');
  fs.unlinkSync(lockFile(root)); assert.deepEqual(leftovers(root), []);
});
test('a stale lock is not broken while another breaker holds the breaker directory', t => {
  const root = fixture(t); const saved = { ...lockOptions }; t.after(() => Object.assign(lockOptions, saved)); lockOptions.waitMs = 400;
  fs.writeFileSync(lockFile(root), 'killed'); const old = new Date(Date.now() - 120000); fs.utimesSync(lockFile(root), old, old);
  fs.mkdirSync(`${lockFile(root)}.break`);
  assert.throws(() => mutateState(root, null, () => {}), /EEXIST/); assert.equal(fs.readFileSync(lockFile(root), 'utf8'), 'killed');
  fs.utimesSync(`${lockFile(root)}.break`, old, old);
  mutateState(root, null, s => { s.activation = 'frozen'; });
  assert.equal(loadState(root).activation, 'frozen'); assert.deepEqual(leftovers(root), []); assert.equal(fs.existsSync(`${lockFile(root)}.break`), false);
});
test('the breaker re-checks staleness and leaves a lock created after the stale one', t => {
  const root = fixture(t); fs.writeFileSync(lockFile(root), 'fresh-owner');
  breakStaleLock(lockFile(root));
  assert.equal(fs.readFileSync(lockFile(root), 'utf8'), 'fresh-owner'); assert.equal(fs.existsSync(`${lockFile(root)}.break`), false);
  const old = new Date(Date.now() - 120000); fs.utimesSync(lockFile(root), old, old);
  breakStaleLock(lockFile(root)); assert.equal(fs.existsSync(lockFile(root)), false);
});
test('a transient rename refusal is retried and a final failure leaves no temp file', t => {
  const root = fixture(t); const original = fsOps.renameSync; t.after(() => { fsOps.renameSync = original; });
  let refusals = 2; fsOps.renameSync = (from, to) => { if (refusals-- > 0) throw Object.assign(Error('busy'), { code: 'EPERM' }); return original(from, to); };
  mutateState(root, null, s => { s.activation = 'frozen'; }); assert.equal(loadState(root).activation, 'frozen');
  fsOps.renameSync = () => { throw Object.assign(Error('busy'), { code: 'EBUSY' }); };
  assert.throws(() => mutateState(root, null, s => { s.activation = 'active'; }), /busy/);
  assert.equal(loadState(root).activation, 'frozen'); assert.deepEqual(leftovers(root), []);
});
test('a registration whose state write fails removes its receipt so the retry can register', async t => {
  const root = fixture(t); const original = fsOps.renameSync; t.after(() => { fsOps.renameSync = original; });
  fsOps.renameSync = (from, to) => { if (to.endsWith('Workflow-State.json')) throw Object.assign(Error('disk gone'), { code: 'EIO' }); return original(from, to); };
  await assert.rejects(registerDispatch(job(), { root }), /disk gone/);
  assert.equal(fs.existsSync(path.join(root, '.claude/scratch/dispatches/d1.json')), false);
  fsOps.renameSync = original; assert.equal((await registerDispatch(job(), { root })).id, 'd1');
});
test('a generation moved by a concurrent writer refuses the write', t => {
  const root = fixture(t); const file = path.join(root, 'Agents/Workflow-State.json');
  assert.throws(() => mutateState(root, null, s => { fs.writeFileSync(file, JSON.stringify({ ...s, generation: s.generation + 1, activation: 'external' })); s.activation = 'mine'; }), /Concurrent/);
  const after = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(after.activation, 'external'); assert.equal(after.generation, 1);
  assert.deepEqual(leftovers(root), []);
});
test('compact context keeps parked checks without the stale queue; device stops after one retry', async t => {
  const root = fixture(t);
  checkDevice({ root, claim: 'oddity', result: 'inconclusive', evidence: 'first' }); checkDevice({ root, claim: 'oddity', result: 'inconclusive', evidence: 'retry' });
  assert.throws(() => checkDevice({ root, claim: 'oddity', result: 'inconclusive' }), /parked/);
  assert.equal(loadState(root).parkedChecks.length, 1);
  const output = await hook({ hook_event_name: 'SessionStart', source: 'compact' }, { root });
  assert.match(output.hookSpecificOutput.additionalContext, /parked checks/); assert.match(output.hookSpecificOutput.additionalContext, /Live-State/);
  // The stored queue goes stale between handoffs, so the hook points at the current-state sources instead of injecting it.
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /SR2/);
});
test('required claim remains required when diagnostic retry omits the flag', t => {
  const root = fixture(t); checkDevice({ root, claim: 'required-native', result: 'inconclusive', required: true });
  checkDevice({ root, claim: 'required-native', result: 'inconclusive' });
  assert.equal(loadState(root).parkedChecks[0].required, true);
});
test('native specialist fallback retains role, ordinary Opus bypass is denied, persistence Gate2 uses xhigh', async t => {
  const root = fixture(t); mutateState(root, null, s => { s.routeHealth.codex = { reason: 'quota', resetAt: null }; });
  const translator = await registerDispatch(job({ role: 'translator' }), { root }); assert.equal(translator.role, 'translator'); assert.equal(translator.model, 'sonnet');
  await assert.rejects(registerDispatch(job({ id: 'opus', logicalJobId: 'new', mode: 'review', role: 'opus-reviewer', allowedWrites: [] }), { root }), /eligible trigger/);
  const review = await registerDispatch(job({ id: 'review', logicalJobId: 'review', mode: 'review', role: 'opus-reviewer', allowedWrites: [], changedContracts: ['dirty-dependencies'], gate: 'Gate2', effort: 'xhigh' }), { root }); assert.equal(review.effort, 'xhigh');
});
test('low-tier scout effort and native subscription exhaustion park correctly', async t => {
  const root = fixture(t); const route = await selectRoute({ root, jobId: 'scout-low', mode: 'scout', scoutEffort: 'low', optIn: 'agy', healthCheck: true }); assert.equal(route.model, 'gemini-3.8-flash-low');
  mutateState(root, null, s => { for (const provider of ['agy', 'codex', 'claude']) s.routeHealth[provider] = { reason: 'quota', resetAt: null }; });
  assert.equal((await selectRoute({ root, jobId: 'all-empty', mode: 'implement' })).status, 'parked');
});
test('device class routes straight to the native device primary without a Codex attempt; other roles are refused', async t => {
  const root = fixture(t);
  const route = await selectRoute({ root, jobId: 'dev-1', mode: 'implement', workClass: 'device' });
  assert.equal(route.provider, 'claude'); assert.equal(route.role, 'sonnet-coder'); assert.equal(route.model, 'sonnet');
  await assert.rejects(selectRoute({ root, jobId: 'dev-2', mode: 'implement', workClass: 'device', role: 'designer' }), /Device primary/);
  await assert.rejects(selectRoute({ root, jobId: 'dev-3', mode: 'implement', workClass: 'device', changedContracts: ['dirty-dependencies'] }), /Device primary/);
  assert.equal((await selectRoute({ root, jobId: 'code-1', mode: 'implement' })).provider, 'claude');
});
test('test-only dispatches route straight to the native test primary; non-test writes and critical contracts are refused', async t => {
  const root = fixture(t);
  const route = await selectRoute({ root, jobId: 'tst-1', mode: 'implement', testOnly: true });
  assert.equal(route.provider, 'claude'); assert.equal(route.role, 'test-warrior'); assert.equal(route.model, 'sonnet');
  await assert.rejects(selectRoute({ root, jobId: 'tst-2', mode: 'implement', testOnly: true, role: 'designer' }), /Test primary/);
  await assert.rejects(selectRoute({ root, jobId: 'tst-3', mode: 'implement', testOnly: true, changedContracts: ['dirty-dependencies'] }), /Test primary/);
  await assert.rejects(registerDispatch(job({ id: 't-bad', logicalJobId: 'tst-4', testOnly: true, allowedWrites: ['src/ts/characters.ts'] }), { root }), /every write is a test file/);
  const ok = await registerDispatch(job({ id: 't-ok', logicalJobId: 'tst-5', testOnly: true, allowedWrites: ['src/ts/tests/example.test.ts'] }), { root });
  assert.equal(ok.provider, 'claude'); assert.equal(ok.role, 'test-warrior');
  assert.equal((await selectRoute({ root, jobId: 'code-1', mode: 'implement' })).provider, 'claude');
});
