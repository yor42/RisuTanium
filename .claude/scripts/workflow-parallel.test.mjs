import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { registerDispatch, validateDispatch, selectRoute, finishDispatch, loadState, mutateState, hook, schedulingClass, normalizeResource, canonicalRoot } from './workflow-control.mjs';
import { exportSnapshot } from '../../Agents/Tools/external/workspace.mjs';
import { prepareWorker } from '../../Agents/Tools/external/worker.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-parallel-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'risu-parallel-')); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true }); fs.mkdirSync(path.join(root, 'Agents'));
  fs.copyFileSync(new URL('../workflow-policy.json', import.meta.url), path.join(root, '.claude/workflow-policy.json'));
  const state = JSON.parse(fs.readFileSync(new URL('../../Agents/Workflow-State.json', import.meta.url)));
  Object.assign(state, { generation: 0, activation: 'active', activeRevision: state.policyRevision, jobs: {}, dispatches: {}, routeHealth: {}, integrations: [] });
  fs.writeFileSync(path.join(root, 'Agents/Workflow-State.json'), JSON.stringify(state));
  const make = (id, extra = {}) => {
    const manifestFile = path.join(root, `${id}.manifest.json`); fs.writeFileSync(manifestFile, '{}');
    const promptFile = path.join(root, `${id}.md`); fs.writeFileSync(promptFile, 'Synthetic assignment');
    return { id, logicalJobId: id, mode: 'implement', owner: `${id}-context`, question: 'Bounded fixture', acceptance: ['Fixture only'], inputIdentity: 'fixture', changedContracts: [], repoRoot: path.join(root, `${id}-source`), workdir: path.join(root, `${id}-export`), manifestFile, promptFile, outFile: path.join(root, `${id}.out.json`), readScope: [], allowedWrites: [`src/${id}.ts`], ...extra };
  };
  return { root, make };
}
test('code tracks up to the policy cap, one records draft, one pinned device and readonly work coexist; one more code is refused', async t => {
  const { root, make } = fixture(t);
  const codeCap = JSON.parse(fs.readFileSync(path.join(root, '.claude/workflow-policy.json'), 'utf8')).maxImplementationTracks;
  assert.ok(Number.isInteger(codeCap) && codeCap >= 1);
  for (let i = 0; i < codeCap; i++) await registerDispatch(make(`code-${i}`), { root });
  const records = await registerDispatch(make('records', { workClass: 'records', repoRoot: root, allowedWrites: ['Agents/Roadmap.md'] }), { root });
  assert.equal(records.model, 'haiku'); assert.equal(records.role, 'record-clerk');
  await registerDispatch(make('device', { mode: 'scout', workClass: 'device', repoRoot: root, allowedWrites: [], resources: ['device:fixture-serial', 'tcp:6450'], artifact: { sha256: 'a'.repeat(64), sourceRevision: 'fixture-base' } }), { root });
  await registerDispatch(make('readonly', { mode: 'review', workClass: 'code', allowedWrites: [] }), { root });
  await assert.rejects(registerDispatch(make('code-over'), { root }), /Implementation track cap/);
  assert.equal(Object.keys(loadState(root).dispatches).length, codeCap + 3);
});
test('the same relative file in two separate checkouts is not an ownership overlap', async t => {
  const { root, make } = fixture(t);
  await registerDispatch(make('wt-a', { allowedWrites: ['src/lang/en.ts', 'docs/shared.md'] }), { root });
  await registerDispatch(make('wt-b', { allowedWrites: ['src/lang/en.ts', 'src/b.ts'] }), { root });
  await assert.rejects(registerDispatch(make('doc-same', { repoRoot: path.join(root, 'wt-a-source'), workClass: 'documents', allowedWrites: ['docs/shared.md'] }), { root }), /file ownership overlaps/);
  await registerDispatch(make('doc-other', { repoRoot: path.join(root, 'wt-b-source'), workClass: 'documents', allowedWrites: ['docs/shared.md'] }), { root });
  assert.deepEqual(Object.keys(loadState(root).dispatches).sort(), ['doc-other', 'wt-a', 'wt-b']);
});
test('same code checkout is exclusive while a disjoint records edit may share it', async t => {
  const { root, make } = fixture(t);
  await registerDispatch(make('code-a', { repoRoot: root }), { root });
  await registerDispatch(make('records', { workClass: 'records', repoRoot: root, workdir: root, allowedWrites: ['Agents/Roadmap.md'] }), { root });
  await assert.rejects(registerDispatch(make('code-b', { repoRoot: root }), { root }), /checkout ownership overlaps/);
});
test('primary records require registered Haiku identity and preserve authority boundaries', async t => {
  const { root, make } = fixture(t);
  const route = await selectRoute({ root, jobId: 'clerk', mode: 'implement', workClass: 'records' });
  assert.deepEqual([route.provider, route.role, route.model, route.effort], ['claude', 'record-clerk', 'haiku', 'low']);
  const records = await registerDispatch(make('records', { workClass: 'records', allowedWrites: [] }), { root });
  await assert.rejects(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'sonnet-coder', model: 'sonnet', prompt: '[workflow-dispatch:records]' } }, { root }), /role\/model/);
  await hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'record-clerk', model: 'haiku', prompt: '[workflow-dispatch:records]' } }, { root });
  assert.equal(loadState(root).dispatches[records.id].status, 'running');
  for (const file of ['src/a.ts', 'package.json', 'Agents/Maintainer-Context.md', 'Agents/Decision-Index.md', 'Agents/Workflow-State.json', 'docs/workflow/routing.md', 'AGENTS.md', '.gemini/GEMINI.md', '.antigravity/GEMINI.md', 'GEMINI.md', 'nested/AGENTS.md']) {
    await assert.rejects(registerDispatch(make('bad', { workClass: 'records', allowedWrites: [file] }), { root }), /clerical Haiku/);
  }
  await assert.rejects(registerDispatch(make('critical', { workClass: 'records', allowedWrites: [], changedContracts: ['save-format'] }), { root }), /Records primary/);
  await assert.rejects(registerDispatch(make('doc-bypass', { workClass: 'documents', allowedWrites: ['src/a.ts'] }), { root }), /Documents class/);
  for (const file of ['.claude/agents/record-clerk.md', '.claude/skills/campaign-records/SKILL.md', 'AGENTS.md', 'docs/workflow/routing.md', '.gemini/GEMINI.md', '.antigravity/GEMINI.md', 'GEMINI.md', 'nested/AGENTS.md']) {
    await assert.rejects(registerDispatch(make('doc-config', { workClass: 'documents', allowedWrites: [file] }), { root }), /Documents class/);
  }
  await assert.rejects(registerDispatch(make('device-bypass', { workClass: 'device' }), { root }), /Device track cannot write/);
});
test('exact destinations and normalized resources stay exclusive across scheduling classes', async t => {
  const { root, make } = fixture(t);
  await registerDispatch(make('code', { workClass: 'code', repoRoot: root, allowedWrites: ['Agents/Roadmap.md'], resources: ['tcp:06450', 'build:C:\\Temp\\Owned\\'] }), { root });
  await assert.rejects(registerDispatch(make('records', { workClass: 'records', repoRoot: root, allowedWrites: ['Agents/Roadmap.md'] }), { root }), /file ownership overlaps/);
  await assert.rejects(registerDispatch(make('docs', { workClass: 'documents', allowedWrites: ['docs/example.md'], resources: ['build:c:/temp/owned'] }), { root }), /resource ownership overlaps/);
  await assert.rejects(registerDispatch(make('cross-kind', { workClass: 'documents', allowedWrites: ['docs/other.md'], resources: ['output:c:/temp/owned/'] }), { root }), /resource ownership overlaps/);
  await assert.rejects(registerDispatch(make('device', { mode: 'scout', workClass: 'device', allowedWrites: [], resources: ['device:fixture', 'tcp:6450'], artifact: { sha256: 'b'.repeat(64), sourceRevision: 'base' } }), { root }), /resource ownership overlaps/);
  assert.equal(normalizeResource('build:C:\\TEMP\\Owned\\'), normalizeResource('build:c:/temp/owned'));
  assert.throws(() => normalizeResource('tcp:6450-6499'), /individually/);
});
test('records has one slot and device the policy cap; builds reserve mutable source independently of code caps', async t => {
  const { root, make } = fixture(t);
  const deviceCap = JSON.parse(fs.readFileSync(path.join(root, '.claude/workflow-policy.json'), 'utf8')).scheduling.maxDeviceTracks;
  assert.ok(Number.isInteger(deviceCap) && deviceCap >= 2);
  await registerDispatch(make('records-a', { workClass: 'records', allowedWrites: [] }), { root });
  await assert.rejects(registerDispatch(make('records-b', { workClass: 'records', allowedWrites: [] }), { root }), /Records track cap/);
  await registerDispatch(make('build', { mode: 'scout', workClass: 'device', allowedWrites: [], devicePhase: 'build', resources: ['device:phone', `checkout:${root}`] }), { root });
  await assert.rejects(registerDispatch(make('code', { repoRoot: root }), { root }), /resource ownership overlaps/);
  await registerDispatch(make('device-b', { mode: 'scout', workClass: 'device', allowedWrites: [], resources: ['device:other'], artifact: { sha256: 'c'.repeat(64), sourceRevision: 'base' } }), { root });
  for (let i = 2; i < deviceCap; i++) await registerDispatch(make(`device-x${i}`, { mode: 'scout', workClass: 'device', allowedWrites: [], resources: [`device:extra${i}`], artifact: { sha256: 'e'.repeat(64), sourceRevision: 'base' } }), { root });
  await assert.rejects(registerDispatch(make('device-c', { mode: 'scout', workClass: 'device', allowedWrites: [], resources: ['device:third'], artifact: { sha256: 'd'.repeat(64), sourceRevision: 'base' } }), { root }), /Device track cap/);
});
test('legacy registered and running records keep hashes/routes and do not occupy code slots', async t => {
  const { root, make } = fixture(t);
  const old = { ...make('legacy'), provider: 'claude', model: 'sonnet', role: 'sonnet-coder', requestedRole: 'sonnet-coder', effort: 'medium', policyRevision: '2026-11-03.1', allowedWrites: ['Agents/Maintainer-Context.md', 'Agents/Live-State.md'] };
  const bytes = JSON.stringify(old); const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.join(root, '.claude/scratch/dispatches'), { recursive: true }); fs.writeFileSync(path.join(root, '.claude/scratch/dispatches/legacy.json'), bytes);
  mutateState(root, null, s => {
    s.dispatches.legacy = { ...old, hash, status: 'registered' };
    s.jobs.legacy = { mode: 'implement', role: 'sonnet-coder', changedContracts: [], failedRoutes: ['codex'], correctionCount: 1, attempts: ['legacy'] };
  });
  assert.equal(schedulingClass(loadState(root).dispatches.legacy), 'records');
  await validateDispatch(old, { root, claim: true });
  await registerDispatch(make('code-a'), { root }); await registerDispatch(make('code-b'), { root });
  await assert.rejects(registerDispatch(make('records-new', { workClass: 'records', allowedWrites: [] }), { root }), /Records track cap/);
  finishDispatch({ root, id: 'legacy', status: 'completed', evidence: 'fixture' });
  assert.equal(fs.readFileSync(path.join(root, '.claude/scratch/dispatches/legacy.json'), 'utf8'), bytes);
  assert.equal(loadState(root).jobs.legacy.correctionCount, 1);
});
test('continuation cannot relabel its scheduling class', async t => {
  const { root, make } = fixture(t); await registerDispatch(make('code'), { root }); finishDispatch({ root, id: 'code', status: 'partial', reason: 'failed' });
  await assert.rejects(registerDispatch(make('correction', { logicalJobId: 'code', correction: true, workClass: 'records', allowedWrites: [] }), { root }), /cannot change scheduling class/);
});
test('temporary Git worktrees use the explicit base and one shared coordinator', async t => {
  const { root, make } = fixture(t);
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/a.ts'), 'a'); fs.writeFileSync(path.join(root, 'src/b.ts'), 'b');
  git(['add', 'src']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']); const base = git(['rev-parse', 'HEAD']);
  for (const id of ['a', 'b']) {
    const repoRoot = path.join(root, `tree-${id}`); git(['worktree', 'add', '--detach', repoRoot, base]);
    assert.equal(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), base);
    assert.equal(canonicalRoot(repoRoot), canonicalRoot(root));
    const workdir = path.join(root, `export-${id}`); const exported = exportSnapshot({ repo: repoRoot, dest: workdir });
    const d = await registerDispatch(make(`code-${id}`, { repoRoot, workdir, manifestFile: exported.manifestFile, inputIdentity: exported.digest, allowedWrites: [`src/${id}.ts`] }), { root });
    prepareWorker(d);
  }
  assert.equal(Object.keys(loadState(root).dispatches).length, 2);
});
