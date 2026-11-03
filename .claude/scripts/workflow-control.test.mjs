import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerDispatch, validateDispatch, selectRoute, finishDispatch, loadState, mutateState, hook, checkDevice } from './workflow-control.mjs';

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
  fs.writeFileSync(path.join(root, 'Agents/Workflow-State.json.lock'), 'held');
  assert.throws(() => mutateState(root, null, () => {}), /EEXIST/);
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
