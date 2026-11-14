import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { registerDispatch, validateDispatch, selectRoute, finishDispatch, loadState, mutateState, hook, checkDevice, lockOptions, canonicalRoot, fsOps, breakStaleLock } from './workflow-control.mjs';

let currentFixture;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-control-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true }); fs.mkdirSync(path.join(root, 'Agents'));
  fs.copyFileSync(new URL('../workflow-policy.json', import.meta.url), path.join(root, '.claude/workflow-policy.json'));
  const state = JSON.parse(fs.readFileSync(new URL('../../Agents/Workflow-State.json', import.meta.url)));
  // The queue is pinned so no assertion depends on the live queue text of the repository state.
  Object.assign(state, { generation: 0, activation: 'active', activeRevision: state.policyRevision, queue: ['SR2 fixture queue entry'], jobs: {}, dispatches: {}, routeHealth: {}, parkedChecks: [], deviceAttempts: {} });
  fs.writeFileSync(path.join(root, 'Agents/Workflow-State.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(root, 'host.manifest.json'), '{}'); currentFixture = root; return root;
}
const job = (extra = {}) => ({ id: 'd1', logicalJobId: 'j1', mode: 'implement', question: 'Fix bounded fixture', acceptance: ['Fixture holds'], owner: 'worker-context-1', inputIdentity: 'fixture-snapshot', workdir: path.join(currentFixture, 'isolated-fixture'), promptFile: path.join(currentFixture, 'prompt.md'), outFile: path.join(currentFixture, 'result.json'), manifestFile: path.join(currentFixture, 'host.manifest.json'), readScope: ['src/a.ts'], allowedWrites: ['src/a.ts'], ...extra });
test('subscription first; observed quota is cached through fallback until reset', async t => {
  const root = fixture(t); assert.equal((await selectRoute({ root, jobId: 's', mode: 'scout' })).provider, 'agy');
  const d = await registerDispatch(job(), { root });
  finishDispatch({ root, id: d.id, status: 'failed', reason: 'quota', evidence: 'host log' });
  const next = await selectRoute({ root, jobId: 'j1', mode: 'implement' }); assert.equal(next.provider, 'claude'); assert.match(next.blocked.join(), /Paid activation disabled/);
  const native = await registerDispatch(job({ id: 'd2' }), { root }); assert.equal(native.role, 'sonnet-coder');
  assert.equal((await validateDispatch(native, { root })).id, 'd2');
});
test('no parallel duplicate or changed dispatch, execution claim consumed once', async t => {
  const root = fixture(t); const d = await registerDispatch(job(), { root });
  await assert.rejects(registerDispatch(job({ id: 'd2' }), { root }), /Duplicate/);
  await assert.rejects(validateDispatch({ ...d, model: 'gpt-6.1-sol' }, { root }), /changed/);
  await validateDispatch(d, { root, claim: true }); await assert.rejects(validateDispatch(d, { root, claim: true }), /consumed/);
});
test('one correction persists across failure, context and provider fallback', async t => {
  const root = fixture(t); await registerDispatch(job(), { root }); finishDispatch({ root, id: 'd1', status: 'failed', reason: 'failed' });
  await assert.rejects(registerDispatch(job({ id: 'd2' }), { root }), /correction/);
  await registerDispatch(job({ id: 'd2', correction: true }), { root }); finishDispatch({ root, id: 'd2', status: 'failed', reason: 'failed' });
  const native = await registerDispatch(job({ id: 'd3' }), { root }); assert.equal(native.provider, 'claude');
  finishDispatch({ root, id: 'd3', status: 'failed', reason: 'failed' });
  assert.equal((await selectRoute({ root, jobId: 'j1', mode: 'implement' })).status, 'parked');
});
test('ordinary native duplicate denied; actual critical-contract review uses Opus', async t => {
  const root = fixture(t);
  await assert.rejects(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'sonnet-coder', prompt: 'Do it' } }, { root }), /Register/);
  await assert.rejects(registerDispatch(job({ provider: 'claude', model: 'sonnet' }), { root }), /eligible/);
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
test('compact context preserves queue and parked checks; device stops after one retry', async t => {
  const root = fixture(t);
  checkDevice({ root, claim: 'oddity', result: 'inconclusive', evidence: 'first' }); checkDevice({ root, claim: 'oddity', result: 'inconclusive', evidence: 'retry' });
  assert.throws(() => checkDevice({ root, claim: 'oddity', result: 'inconclusive' }), /parked/);
  assert.equal(loadState(root).parkedChecks.length, 1);
  const output = await hook({ hook_event_name: 'SessionStart', source: 'compact' }, { root });
  assert.match(output.hookSpecificOutput.additionalContext, /parked checks/); assert.match(output.hookSpecificOutput.additionalContext, /SR2/);
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
  const root = fixture(t); const route = await selectRoute({ root, jobId: 'scout-low', mode: 'scout', scoutEffort: 'low' }); assert.equal(route.model, 'gemini-3.8-flash-low');
  mutateState(root, null, s => { for (const provider of ['agy', 'codex', 'claude']) s.routeHealth[provider] = { reason: 'quota', resetAt: null }; });
  assert.equal((await selectRoute({ root, jobId: 'all-empty', mode: 'implement' })).status, 'parked');
});
test('device class routes straight to the native device primary without a Codex attempt; other roles are refused', async t => {
  const root = fixture(t);
  const route = await selectRoute({ root, jobId: 'dev-1', mode: 'implement', workClass: 'device' });
  assert.equal(route.provider, 'claude'); assert.equal(route.role, 'sonnet-coder'); assert.equal(route.model, 'sonnet');
  await assert.rejects(selectRoute({ root, jobId: 'dev-2', mode: 'implement', workClass: 'device', role: 'designer' }), /Device primary/);
  await assert.rejects(selectRoute({ root, jobId: 'dev-3', mode: 'implement', workClass: 'device', changedContracts: ['dirty-dependencies'] }), /Device primary/);
  assert.equal((await selectRoute({ root, jobId: 'code-1', mode: 'implement' })).provider, 'codex');
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
  assert.equal((await selectRoute({ root, jobId: 'code-1', mode: 'implement' })).provider, 'codex');
});
