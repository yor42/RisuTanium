import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { resetStart, resetEnd, NOTE9 } from './workflow-device-reset.mjs';
import { main, registerDispatch, validateDispatch, mutateState, loadState, selectRoute } from './workflow-control.mjs';
// The committed state snapshot is not the live state and may lag a policy revision; fixtures take the revision from the policy.
const policyRevision = () => JSON.parse(fs.readFileSync(new URL('../workflow-policy.json', import.meta.url), 'utf8')).revision;
const script = new URL('./workflow-control.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PHONE1 = 'device:29f3cde9193f7ece'; const PHONE2 = 'device:2ac80128013f7ece';
const ttlMs = JSON.parse(fs.readFileSync(new URL('../workflow-policy.json', import.meta.url), 'utf8')).devicePool.leaseTtlSeconds * 1000;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-lease-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'risu-lease-')); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true }); fs.mkdirSync(path.join(root, 'Agents'));
  fs.copyFileSync(new URL('../workflow-policy.json', import.meta.url), path.join(root, '.claude/workflow-policy.json'));
  const state = JSON.parse(fs.readFileSync(new URL('../../Agents/Workflow-State.json', import.meta.url)));
  Object.assign(state, { generation: 0, activation: 'active', policyRevision: policyRevision(), activeRevision: policyRevision(), jobs: {}, dispatches: {}, routeHealth: {}, integrations: [] });
  fs.writeFileSync(path.join(root, 'Agents/Workflow-State.json'), JSON.stringify(state));
  const make = (id, extra = {}) => {
    const manifestFile = path.join(root, `${id}.manifest.json`); fs.writeFileSync(manifestFile, '{}');
    const promptFile = path.join(root, `${id}.md`); fs.writeFileSync(promptFile, 'Synthetic assignment');
    return { id, logicalJobId: id, mode: 'implement', owner: `${id}-context`, question: 'Bounded fixture', acceptance: ['Fixture only'], inputIdentity: 'fixture', changedContracts: [], repoRoot: path.join(root, `${id}-source`), workdir: path.join(root, `${id}-export`), manifestFile, promptFile, outFile: path.join(root, `${id}.out.json`), readScope: [], allowedWrites: [`src/${id}.ts`], ...extra };
  };
  // A pinned device run: the lease names its own phone and ports.
  const device = (id, resources, extra = {}) => make(id, { mode: 'scout', workClass: 'device', repoRoot: root, allowedWrites: [], resources, artifact: { sha256: 'a'.repeat(64), sourceRevision: 'fixture-base' }, ...extra });
  const evidence = name => { const file = path.join(root, name); fs.writeFileSync(file, 'package:io.github.yor42.risutanium\n'); return file; };
  return { root, make, device, evidence };
}
const tok = id => `token-${id}`.padEnd(20, 'x');
const acquire = (root, id, extra = {}) => main(['lease-acquire', '--root', root, '--pool', extra.pool ?? 'note9', '--request', id, '--token', extra.token ?? tok(id), '--holder', extra.holder ?? id, '--priority', extra.priority ?? 'normal', ...(extra.ticket === null ? [] : ['--ticket', extra.ticket ?? '647'])]);
const renew = (root, id) => main(['lease-renew', '--root', root, '--request', id, '--token', tok(id)]);
const release = (root, id, clean, token = tok(id)) => main(['lease-release', '--root', root, '--request', id, '--token', token, ...(clean ? ['--clean', clean] : [])]);
const resetDone = (root, id, evidence, stranded) => main(['lease-reset-done', '--root', root, '--request', id, '--token', tok(id), '--evidence', evidence, ...(stranded ? ['--stranded', stranded] : [])]);
const status = root => main(['lease-status', '--root', root]);
const leases = root => loadState(root).deviceLeases;
// Time is moved by rewriting stored timestamps through the state lock, never by a clock seam.
const age = (root, id, ms, field = 'heartbeatAt') => mutateState(root, null, s => { s.deviceLeases.requests[id][field] = new Date(Date.now() - ms).toISOString(); });
const expire = (root, id) => age(root, id, ttlMs + 1000);
const ports = { [PHONE1]: [6270, 6309], [PHONE2]: [6310, 6329] };
// Writes a granted request in exactly the shape a real lease-acquire stores.
function seedGrant(root, { id, member = PHONE1, ticket = '647', holder = id, priority = 'normal' }) {
  mutateState(root, null, s => {
    s.deviceLeases ??= { requests: {}, members: {} };
    const iso = new Date().toISOString();
    s.deviceLeases.requests[id] = { pool: 'note9', holder, ticket, priority, tokenHash: crypto.createHash('sha256').update(tok(id)).digest('hex'), status: 'granted', enqueuedAt: iso, lastPollAt: iso, member, ports: [...ports[member]], grantedAt: iso, heartbeatAt: iso, endedAt: null, resetRequired: false, resetEvidence: null, releaseCensus: null };
    s.deviceLeases.members[member] ??= { needsReset: false, reason: null, since: null, stranded: [] };
  });
}
const register = (root, d, lease, token = lease && tok(lease)) => registerDispatch({ ...d, ...(lease ? { lease, leaseToken: token } : {}) }, { root });

test('T1 two free phones go to two holders with their own port ranges; a third waits at position 1', async t => {
  const { root } = fixture(t);
  const a = await acquire(root, 'r1'); const b = await acquire(root, 'r2'); const c = await acquire(root, 'r3');
  assert.deepEqual([a.status, a.member, a.serial, a.ports], ['granted', PHONE1, '29f3cde9193f7ece', { min: 6270, max: 6309 }]);
  assert.deepEqual([b.status, b.member, b.ports], ['granted', PHONE2, { min: 6310, max: 6329 }]);
  assert.deepEqual([c.status, c.position, c.free], ['waiting', 1, 0]);
});
test('T2 priority class outranks FIFO: the later mvp-blocker takes the freed phone ahead of the earlier normal request', async t => {
  const { root, evidence } = fixture(t);
  seedGrant(root, { id: 'a', member: PHONE1 }); seedGrant(root, { id: 'b', member: PHONE2 });
  assert.equal((await acquire(root, 'n1')).status, 'waiting'); assert.equal((await acquire(root, 'm1', { priority: 'mvp-blocker' })).position, 1);
  await release(root, 'a', evidence('census.txt'));
  assert.equal((await acquire(root, 'n1')).status, 'waiting');
  const m = await acquire(root, 'm1', { priority: 'mvp-blocker' }); assert.deepEqual([m.status, m.member], ['granted', PHONE1]);
});
test('T3 a re-poll returns the same grant, a wrong token is refused, and a seeded grant has a real acquire record\'s shape', async t => {
  const { root } = fixture(t);
  const first = await acquire(root, 'r1'); const again = await acquire(root, 'r1'); assert.deepEqual(again, first);
  assert.equal(Object.keys(leases(root).requests).length, 1);
  await assert.rejects(acquire(root, 'r1', { token: tok('other') }), /another holder/);
  seedGrant(root, { id: 's1', member: PHONE2 });
  const { requests } = leases(root);
  assert.deepEqual(Object.keys(requests.s1).sort(), Object.keys(requests.r1).sort());
  assert.equal(requests.r1.tokenHash, crypto.createHash('sha256').update(tok('r1')).digest('hex'));
  assert.ok(!JSON.stringify(leases(root)).includes(tok('r1')));
});
test('T4 renew before expiry extends the lease; renew after expiry refuses', async t => {
  const { root } = fixture(t);
  await acquire(root, 'r1'); age(root, 'r1', 600000);
  const before = leases(root).requests.r1.heartbeatAt; await renew(root, 'r1');
  assert.ok(Date.parse(leases(root).requests.r1.heartbeatAt) > Date.parse(before));
  expire(root, 'r1'); await assert.rejects(renew(root, 'r1'), /expired/);
});
test('T5 the grant after an expiry carries resetRequired, and device claims refuse until reset-done', async t => {
  const { root, evidence } = fixture(t);
  await acquire(root, 'r1'); await acquire(root, 'r2'); expire(root, 'r1');
  const g = await acquire(root, 'r3'); assert.deepEqual([g.member, g.resetRequired], [PHONE1, true]);
  const claim = () => main(['device', '--root', root, '--claim', 'row-1', '--result', 'pass', '--evidence', 'x', '--lease', 'r3', '--token', tok('r3')]);
  await assert.rejects(claim(), /reset not acknowledged/);
  await resetDone(root, 'r3', evidence('census.txt'));
  assert.equal((await claim()).closed, true);
  await assert.rejects(main(['device', '--root', root, '--claim', 'row-2', '--result', 'pass', '--evidence', 'x', '--lease', 'r3', '--token', tok('other')]), /another holder/);
});
test('T6a an expired holder cannot renew or release into the new holder\'s lease', async t => {
  const { root } = fixture(t);
  await acquire(root, 'r1'); await acquire(root, 'r2'); expire(root, 'r1');
  const g = await acquire(root, 'r3'); assert.equal(g.member, PHONE1);
  await assert.rejects(renew(root, 'r1'), /expired/);
  assert.equal((await release(root, 'r1')).status, 'expired');
  assert.equal((await acquire(root, 'r3')).status, 'granted'); assert.equal(leases(root).requests.r3.status, 'granted');
});
test('T6b a lapsed lease stops its dispatch from claiming the phone, so the next holder registers', async t => {
  const { root, device } = fixture(t);
  seedGrant(root, { id: 'l1' }); await register(root, device('d1', [PHONE1, 'tcp:6270']), 'l1');
  await assert.rejects(register(root, device('d1b', [PHONE1, 'tcp:6271']), 'l1'), /overlaps/);
  expire(root, 'l1'); seedGrant(root, { id: 'l2' });
  await assert.doesNotReject(register(root, device('d2', [PHONE1, 'tcp:6270']), 'l2'));
});
test('T7 a release with the wrong token refuses and the lease stays granted', async t => {
  const { root } = fixture(t);
  await acquire(root, 'r1');
  await assert.rejects(release(root, 'r1', null, tok('other')), /another holder/);
  assert.equal(leases(root).requests.r1.status, 'granted');
});
test('T8 register agreement: pool resources need their live lease, the other phone is refused, the token never lands in the receipt', async t => {
  const { root, device } = fixture(t);
  await assert.rejects(register(root, device('u1', [PHONE1])), /needs its live lease/);
  await assert.rejects(register(root, device('u2', ['device:fixture-x', 'tcp:6280'])), /needs its live lease/);
  await assert.doesNotReject(register(root, device('u3', ['device:fixture-x', 'tcp:6450'])));
  seedGrant(root, { id: 'l1' });
  await assert.rejects(register(root, device('w1', [PHONE1], {}), 'l1', 'wrong-token-wrong-token'), /token mismatch/);
  await assert.rejects(register(root, device('o1', [PHONE2]), 'l1'), /does not agree/);
  await assert.rejects(register(root, device('o2', [PHONE1, 'tcp:6310']), 'l1'), /does not agree/);
  await assert.rejects(register(root, device('o3', ['device:fixture-x'], {}), 'l1'), /names no leased resource/);
  // E3: a second pool device alongside the leased one is refused, so a device run names exactly its own phone.
  await assert.rejects(register(root, device('e3', [PHONE1, PHONE2]), 'l1'), /does not agree/);
  await assert.rejects(register(root, device('e3b', ['device:fixture-x', 'tcp:6270']), 'l1'), /does not agree/);
  const ok = await register(root, device('ok', [PHONE1, 'tcp:6271', 'tcp:6451']), 'l1');
  assert.equal(ok.leaseToken, undefined); assert.equal(ok.lease, 'l1');
  const receipt = fs.readFileSync(path.join(root, '.claude/scratch/dispatches/ok.json'), 'utf8');
  assert.ok(!receipt.includes('leaseToken') && !receipt.includes(tok('l1')));
  assert.equal(loadState(root).dispatches.ok.lease, 'l1'); assert.ok(!JSON.stringify(loadState(root)).includes(tok('l1')));
});
test('T9 a lapsed leased dispatch leaves the device track cap', async t => {
  const { root, device } = fixture(t);
  const cap = JSON.parse(fs.readFileSync(path.join(root, '.claude/workflow-policy.json'), 'utf8')).scheduling.maxDeviceTracks;
  seedGrant(root, { id: 'l1' }); await register(root, device('d1', [PHONE1]), 'l1');
  for (let i = 1; i < cap; i++) await register(root, device(`x${i}`, [`device:extra${i}`]));
  await assert.rejects(register(root, device('over', ['device:over'])), /Device track cap/);
  expire(root, 'l1');
  await assert.doesNotReject(register(root, device('over', ['device:over'])));
});
test('T10 a receipt whose lease lapsed cannot be claimed', async t => {
  const { root, device } = fixture(t);
  seedGrant(root, { id: 'l1' }); const d = await register(root, device('d1', [PHONE1]), 'l1');
  expire(root, 'l1');
  await assert.rejects(validateDispatch(d, { root, claim: true }), /no longer live/);
  assert.equal(loadState(root).dispatches.d1.status, 'registered');
});
test('T11 a legacy unleased dispatch on phone 1 keeps it from being granted', async t => {
  const { root } = fixture(t);
  mutateState(root, null, s => { s.dispatches.legacy = { hash: 'legacy', logicalJobId: 'legacy', mode: 'scout', provider: 'claude', model: 'sonnet', role: 'sonnet-coder', owner: 'legacy', repoRoot: root, allowedWrites: [], workClass: 'device', resources: [PHONE1, 'tcp:6270'], healthCheck: false, status: 'running' }; });
  const a = await acquire(root, 'r1'); const b = await acquire(root, 'r2');
  assert.deepEqual([a.status, a.member, b.status], ['granted', PHONE2, 'waiting']);
});
test('T12 a waiting request not polled within the queue window is dropped', async t => {
  const { root } = fixture(t);
  await acquire(root, 'r1'); await acquire(root, 'r2'); assert.equal((await acquire(root, 'r3')).status, 'waiting');
  age(root, 'r3', 301000, 'lastPollAt');
  assert.equal((await acquire(root, 'r3')).status, 'dropped');
  assert.deepEqual((await status(root)).pools.note9.waiting, []);
  assert.equal((await acquire(root, 'r3')).status, 'dropped');
});
test('T13 unknown pools, bad input and unsafe device-pool policy are refused', async t => {
  const { root } = fixture(t);
  await assert.rejects(acquire(root, 'r1', { pool: 'tab-s9' }), /Unknown pool/);
  await assert.rejects(acquire(root, 'r1', { ticket: null }), /Invalid ticket/);
  await assert.rejects(acquire(root, 'r1', { priority: 'urgent' }), /Unknown priority/);
  await assert.rejects(acquire(root, 'r1', { token: 'short' }), /Invalid lease token/);
  const file = path.join(root, '.claude/workflow-policy.json'); const original = fs.readFileSync(file, 'utf8');
  const variants = {
    'overlapping ports': p => { p.pools.note9.members[1].ports = [6300, 6329]; },
    '129 ports': p => { p.pools.note9.members[0].ports = [6000, 6128]; },
    'ttl not above heartbeat': p => { p.heartbeatSeconds = p.leaseTtlSeconds; },
    'poll not below queue window': p => { p.pollSeconds = p.queueTtlSeconds; },
    'duplicate member': p => { p.pools['android-build'].members.push({ resource: PHONE1, ports: [7000, 7001] }); },
    'standing helper': p => { p.standingPackages.push('dev.risu.x'); },
    'duplicate standing': p => { p.standingPackages.push('io.github.yor42.tbdriver'); },
    'bad standing shape': p => { p.standingPackages.push('not a package'); },
    'keep helper not helper-shaped': p => { p.keepHelpers = [{ package: 'com.example.app', note: 'n' }]; },
    'keep helper without note': p => { p.keepHelpers = [{ package: 'dev.risu.x', note: ' ' }]; },
    'duplicate keep helper': p => { p.keepHelpers = [{ package: 'dev.risu.x', note: 'n' }, { package: 'dev.risu.x', note: 'n' }]; },
    'bad lock order': p => { p.lockOrder = ['note9', 'note9']; },
    'lock order missing a pool': p => { p.lockOrder = ['note9']; },
    'no priority class': p => { p.priorityClasses = []; },
    'zero queue': p => { p.maxWaiting = 0; },
  };
  for (const [name, change] of Object.entries(variants)) {
    const policy = JSON.parse(original); change(policy.devicePool); fs.writeFileSync(file, JSON.stringify(policy));
    await assert.rejects(main(['status', '--root', root]), /unsafe policy/, name);
  }
  fs.writeFileSync(file, original); await main(['status', '--root', root]);
});
test('T14 state without deviceLeases works, status commands never write, and the state patch cannot set it', async t => {
  const { root } = fixture(t);
  const file = path.join(root, 'Agents/Workflow-State.json'); const before = fs.readFileSync(file, 'utf8');
  assert.equal(loadState(root).deviceLeases, undefined);
  const view = await status(root); assert.equal(view.pools.note9.members.length, 2); assert.ok(view.pools.note9.members.every(m => !m.busy));
  const summary = await main(['status', '--root', root]); assert.equal(summary.deviceLeases, undefined);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const patch = path.join(root, 'patch.json'); fs.writeFileSync(patch, JSON.stringify({ deviceLeases: { requests: {} } }));
  await assert.rejects(main(['state', '--root', root, '--file', patch, '--generation', '0']), /not patchable/);
  await acquire(root, 'r1'); expire(root, 'r1');
  const written = fs.readFileSync(file, 'utf8'); const lapsed = await status(root);
  assert.equal(lapsed.pools.note9.members[0].needsReset, true); assert.equal(fs.readFileSync(file, 'utf8'), written);
});
test('T15 release without a census marks the phone for reset; stranded and helper rules; grants carry the package lists', async t => {
  const { root, evidence } = fixture(t);
  await acquire(root, 'r1'); await acquire(root, 'r4');
  assert.equal((await release(root, 'r1')).needsReset, true);
  const g = await acquire(root, 'r5'); assert.deepEqual([g.member, g.resetRequired], [PHONE1, true]);
  assert.ok(g.standingPackages.includes('io.github.yor42.risutanium') && g.standingPackages.includes('io.github.yor42.tbdriver'));
  assert.deepEqual(g.keepHelpers, JSON.parse(fs.readFileSync(new URL('../workflow-policy.json', import.meta.url), 'utf8')).devicePool.keepHelpers.map(k => k.package));
  assert.equal(g.helperPattern, '^dev\\.risu\\.[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$');
  const census = evidence('census.txt');
  for (const bad of ['dev.risu.x', 'dev.risu.a_b.c2', 'io.github.yor42.tbdriver', 'dev.risu.', 'dev.risu..x', 'not a package']) await assert.rejects(resetDone(root, 'r5', census, bad), /Cannot mark|stranded/, bad);
  await assert.rejects(resetDone(root, 'r5', path.join(root, 'missing.txt')), /evidence/);
  assert.equal((await resetDone(root, 'r5', census, 'com.example.left')).resetRequired, false);
  assert.equal((await release(root, 'r5', census)).needsReset, false);
  const next = await acquire(root, 'r6'); assert.deepEqual([next.member, next.resetRequired, next.strandedPackages], [PHONE1, false, ['com.example.left']]);
  // A release that still owes its reset keeps the obligation even when it names a census file.
  await release(root, 'r4'); const dirty = await acquire(root, 'r7'); assert.equal(dirty.resetRequired, true);
  await assert.rejects(release(root, 'r7', census), /workflow-device-reset/);
  await release(root, 'r7'); assert.equal(leases(root).members[PHONE2].needsReset, true);
});
test('T16 lock order is keyed on the ticket: a ticket holding a phone cannot take the build slot', async t => {
  const { root } = fixture(t);
  await acquire(root, 'p1', { ticket: '7', holder: 'h1' });
  await assert.rejects(acquire(root, 'b1', { pool: 'android-build', ticket: '7', holder: 'h1' }), /Lock order/);
  await assert.rejects(acquire(root, 'b2', { pool: 'android-build', ticket: '7', holder: 'h2' }), /Lock order/);
  const other = await acquire(root, 'b3', { pool: 'android-build', ticket: '8', holder: 'h3' });
  assert.deepEqual([other.status, other.serial, other.ports], ['granted', undefined, undefined]);
  const device = await acquire(root, 'p2', { ticket: '8', holder: 'h3' }); assert.equal(device.status, 'granted');
  assert.equal((await release(root, 'b3')).needsReset, false);
});
test('T16b a ticket that holds a phone cannot keep polling a build-slot request it enqueued earlier', async t => {
  const { root } = fixture(t);
  assert.equal((await acquire(root, 'bA', { pool: 'android-build', ticket: '9', holder: 'hA' })).status, 'granted');
  assert.equal((await acquire(root, 'b1', { pool: 'android-build', ticket: '7', holder: 'h1' })).status, 'waiting');
  assert.equal((await acquire(root, 'p1', { ticket: '7', holder: 'h1' })).status, 'granted');
  await assert.rejects(acquire(root, 'b1', { pool: 'android-build', ticket: '7', holder: 'h1' }), /Lock order/);
  await release(root, 'bA');
  await assert.rejects(acquire(root, 'b1', { pool: 'android-build', ticket: '7', holder: 'h1' }), /Lock order/);
  assert.equal(leases(root).requests.b1.status, 'waiting');
  await release(root, 'p1');
  assert.equal((await acquire(root, 'b1', { pool: 'android-build', ticket: '7', holder: 'h1' })).status, 'granted');
});
test('T24 an expired lease cannot register a dispatch, count a device row, reset, or release clean', async t => {
  const { root, device, evidence } = fixture(t);
  seedGrant(root, { id: 'l1' }); expire(root, 'l1');
  await assert.rejects(register(root, device('g1', [PHONE1]), 'l1'), /not live/);
  await assert.rejects(main(['device', '--root', root, '--claim', 'row-g2', '--result', 'pass', '--evidence', 'x', '--lease', 'l1', '--token', tok('l1')]), /expired/);
  await assert.rejects(resetDone(root, 'l1', evidence('census.txt')), /expired/);
  const rel = await release(root, 'l1', evidence('census2.txt'));
  assert.deepEqual([rel.status, rel.needsReset], ['expired', true]);
  assert.equal(leases(root).members[PHONE1].needsReset, true);
});
test('T29 release --clean while the reset is still owed is refused, names the helper, and leaves the lease granted', async t => {
  const { root, evidence } = fixture(t);
  await acquire(root, 'r1'); await acquire(root, 'r2'); expire(root, 'r1');
  const g = await acquire(root, 'r3'); assert.equal(g.resetRequired, true);
  const census = evidence('census.txt');
  await assert.rejects(release(root, 'r3', census), /workflow-device-reset/);
  assert.equal(leases(root).requests.r3.status, 'granted'); assert.equal(leases(root).members[PHONE1].needsReset, true);
  await resetDone(root, 'r3', census);
  assert.equal((await release(root, 'r3', census)).needsReset, false);
});
test('T25 release --clean needs an existing absolute file; a missing path leaves the phone marked for reset', async t => {
  const { root } = fixture(t);
  await acquire(root, 'r1');
  const rel = await release(root, 'r1', path.join(root, 'missing.txt'));
  assert.deepEqual([rel.status, rel.needsReset], ['released', true]);
  assert.equal(leases(root).members[PHONE1].needsReset, true);
});
test('T26 a request id cannot change pool, priority, holder or ticket on a re-poll', async t => {
  const { root } = fixture(t);
  await acquire(root, 'r1'); await acquire(root, 'r2'); await acquire(root, 'r3');
  await assert.rejects(acquire(root, 'r3', { priority: 'mvp-blocker' }), /identity/);
  await assert.rejects(acquire(root, 'r3', { holder: 'other' }), /identity/);
  await assert.rejects(acquire(root, 'r3', { ticket: '8' }), /identity/);
  await assert.rejects(acquire(root, 'r3', { pool: 'android-build' }), /identity/);
  assert.equal((await acquire(root, 'r3')).status, 'waiting');
});
test('T27 a phone whose leased dispatch lapsed is granted again while that dispatch is still active', async t => {
  const { root, device } = fixture(t);
  seedGrant(root, { id: 'l1' }); await register(root, device('d1', [PHONE1, 'tcp:6270']), 'l1');
  expire(root, 'l1');
  // The clean phone is preferred, so the second acquire is the one that needs the lapsed phone.
  assert.equal((await acquire(root, 'r1')).member, PHONE2);
  const g = await acquire(root, 'r2'); assert.deepEqual([g.status, g.member], ['granted', PHONE1]);
});
test('T28 removing devicePool from policy while a leased dispatch exists does not crash device registration', async t => {
  const { root, device } = fixture(t);
  seedGrant(root, { id: 'l1' }); await register(root, device('d1', [PHONE1]), 'l1');
  const file = path.join(root, '.claude/workflow-policy.json'); const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete p.devicePool; fs.writeFileSync(file, JSON.stringify(p));
  await assert.doesNotReject(register(root, device('d2', ['device:fixture-y'])));
});
test('T17 four concurrent acquires on two free phones grant two, queue two, and leave no lock or temp file', async t => {
  const { root } = fixture(t);
  const run = id => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, 'lease-acquire', '--root', root, '--pool', 'note9', '--request', id, '--token', tok(id), '--holder', id, '--priority', 'normal', '--ticket', '647'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', c => { out += c; }); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(Error(`exit ${code}`)));
  });
  const results = await Promise.all(['c1', 'c2', 'c3', 'c4'].map(run));
  const granted = results.filter(r => r.status === 'granted'); const waiting = results.filter(r => r.status === 'waiting');
  assert.equal(granted.length, 2); assert.equal(new Set(granted.map(r => r.member)).size, 2);
  assert.deepEqual(waiting.map(r => r.position).sort(), [1, 2]);
  assert.deepEqual(fs.readdirSync(path.join(root, 'Agents')).filter(f => /\.(lock|tmp)$/.test(f) || f.endsWith('.break')), []);
});
test('T22 an acquire poll never extends a granted lease; past the ttl it reports expired', async t => {
  const { root } = fixture(t);
  seedGrant(root, { id: 'l1' }); age(root, 'l1', 600000);
  const stamp = leases(root).requests.l1.heartbeatAt;
  assert.equal((await acquire(root, 'l1')).status, 'granted'); assert.equal(leases(root).requests.l1.heartbeatAt, stamp);
  expire(root, 'l1'); assert.equal((await acquire(root, 'l1')).status, 'expired');
});
test('T23 a lapsed dispatch still blocks its non-pool claims', async t => {
  const { root, device } = fixture(t); const checkout = path.join(root, 'shared-checkout');
  seedGrant(root, { id: 'l1' }); await register(root, device('d1', [PHONE1, `checkout:${checkout}`]), 'l1');
  expire(root, 'l1');
  await assert.rejects(register(root, device('d2', ['device:other', `checkout:${checkout}`])), /Declared resource ownership overlaps/);
});
test('T19 the device-runner role routes to haiku and other roles stay refused', async t => {
  const { root } = fixture(t);
  const runner = await selectRoute({ root, jobId: 'dr-1', mode: 'implement', workClass: 'device', role: 'device-runner' });
  assert.equal(runner.model, 'haiku'); assert.equal(runner.role, 'device-runner'); assert.equal(runner.provider, 'claude'); assert.equal(runner.effort, 'low');
  const coder = await selectRoute({ root, jobId: 'dr-2', mode: 'implement', workClass: 'device', role: 'sonnet-coder' });
  assert.equal(coder.model, 'sonnet'); assert.equal(coder.role, 'sonnet-coder');
  assert.equal((await selectRoute({ root, jobId: 'dr-3', mode: 'implement', workClass: 'device' })).model, 'sonnet');
  for (const role of ['designer', 'haiku-editor', 'record-clerk', 'test-warrior']) await assert.rejects(selectRoute({ root, jobId: `dr-x-${role}`, mode: 'implement', workClass: 'device', role }), /Device primary/);
  await assert.rejects(selectRoute({ root, jobId: 'dr-4', mode: 'implement', workClass: 'device', role: 'device-runner', changedContracts: ['dirty-dependencies'] }), /Device primary/);
  const policyFile = path.join(root, '.claude/workflow-policy.json'); const p = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  p.scheduling.deviceRoles = ['sonnet-coder', 'ghost']; fs.writeFileSync(policyFile, JSON.stringify(p));
  await assert.rejects(selectRoute({ root, jobId: 'dr-5', mode: 'implement', workClass: 'device' }), /unsafe policy/);
});
test("T17 the committed standing list keeps the phone apps, has no duplicates and no helper-pattern package; dv603 is a keep-helper", () => {
  const pol = JSON.parse(fs.readFileSync(new URL("../workflow-policy.json", import.meta.url), "utf8")).devicePool;
  const s = pol.standingPackages;
  const helper = /^dev\.risu\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
  assert.equal(new Set(s).size, s.length);
  for (const keep of ["io.github.yor42.risutanium", "io.github.yor42.tbdriver"]) assert.ok(s.includes(keep), keep);
  assert.ok(!s.includes("dev.risu.dv603"));
  assert.deepEqual(s.filter(x => helper.test(x)), []);
  assert.deepEqual(pol.keepHelpers.map(k => k.package), ["dev.risu.dv603"]);
  assert.ok(pol.keepHelpers.every(k => helper.test(k.package) && k.note.length > 0));
});

// ---- #846: the one-step reset helper. The guard is a fake phone; no adb runs.
const POLICY_DP = JSON.parse(fs.readFileSync(new URL('../workflow-policy.json', import.meta.url), 'utf8')).devicePool;
const STANDING = POLICY_DP.standingPackages; const KEEP = POLICY_DP.keepHelpers[0].package;
function phone(pkgs, { failOn = [], readbackCode = 0 } = {}) {
  const d = { pkgs: new Set(pkgs), argv: [], mutations: [] };
  d.guard = argv => {
    d.argv.push(argv);
    if (argv[0] === 'apk-readback') return { code: readbackCode, stdout: '', stderr: '' };
    const args = argv.slice(argv.indexOf('--') + 1); const j = args.join(' ');
    if (failOn.includes(j)) return { code: 1, stdout: '', stderr: '' };
    if (j === 'shell pm list packages -3') return { code: 0, stdout: [...d.pkgs].map(n => `package:${n}\r\n`).join(''), stderr: '' };
    d.mutations.push(j);
    if (args[0] === 'uninstall') d.pkgs.delete(args[1]);
    return { code: 0, stdout: 'Success', stderr: '' };
  };
  return d;
}
const guardCalls = d => d.argv.map(a => a.slice(a.indexOf('--') + 1).join(' '));
const resetGrant = async (root, id = 'rs1') => { await acquire(root, 'old'); await acquire(root, 'hold'); await release(root, 'old'); const g = await acquire(root, id); assert.deepEqual([g.member, g.resetRequired], [PHONE1, true]); return g; };
const hOpts = (root, id, d, extra = {}) => ({ root, request: id, token: tok(id), run: path.join(root, 'run'), guard: d.guard, ...extra });

test('H1 start after a lapse: clear, remove only the helper, mark the vendor preinstall, census, reset-done; rows may count', async t => {
  const { root } = fixture(t); await resetGrant(root);
  const d = phone([...STANDING, 'dev.risu.old', KEEP, 'com.samsung.android.stranded']);
  const out = resetStart(hOpts(root, 'rs1', d, { stranded: 'com.samsung.android.stranded' }));
  assert.equal(out.status, 'ok'); assert.equal(out.resetDone, true);
  assert.deepEqual(d.mutations, ['shell pm clear io.github.yor42.risutanium', 'uninstall dev.risu.old']);
  assert.ok(d.pkgs.has(KEEP) && d.pkgs.has('com.samsung.android.stranded'));
  for (const f of [out.census, out.evidence]) assert.ok(path.isAbsolute(f) && fs.existsSync(f) && f.startsWith(os.tmpdir()));
  assert.ok(!fs.readFileSync(out.census, 'utf8').includes('dev.risu.old'));
  assert.ok(!fs.readdirSync(path.join(root, 'run')).some(f => fs.readFileSync(path.join(root, 'run', f), 'utf8').includes(tok('rs1'))));
  assert.equal(leases(root).members[PHONE1].needsReset, false); assert.deepEqual(leases(root).members[PHONE1].stranded, ['com.samsung.android.stranded']);
  const claim = () => main(['device', '--root', root, '--claim', 'row-1', '--result', 'pass', '--evidence', 'x', '--lease', 'rs1', '--token', tok('rs1')]);
  assert.equal((await claim()).closed, true);
});
test('H2 an unclassed package stops the start with nothing changed and the reset still owed', async t => {
  const { root } = fixture(t); await resetGrant(root);
  const d = phone([...STANDING, 'dev.risu.old', 'com.example.mystery']);
  const out = resetStart(hOpts(root, 'rs1', d));
  assert.equal(out.status, 'stop'); assert.match(out.reasons.join(), /com\.example\.mystery/);
  assert.deepEqual(d.mutations, []); assert.ok(d.pkgs.has('dev.risu.old'));
  assert.equal(leases(root).requests.rs1.resetRequired, true); assert.equal(leases(root).members[PHONE1].needsReset, true);
  assert.ok(fs.existsSync(out.evidence));
});
test('H3 --stranded refuses helpers, standing apps, our own namespace and names the census does not hold, before any change', async t => {
  const { root } = fixture(t); await resetGrant(root);
  for (const bad of ['dev.risu.x', STANDING[0], 'io.github.yor42.other', 'not a package']) {
    const d = phone([...STANDING]);
    assert.throws(() => resetStart(hOpts(root, 'rs1', d, { stranded: bad })), /Cannot mark/, bad); assert.deepEqual(d.argv, []);
  }
  const d = phone([...STANDING]);
  const out = resetStart(hOpts(root, 'rs1', d, { stranded: 'com.samsung.absent' }));
  assert.equal(out.status, 'stop'); assert.deepEqual(d.mutations, []);
});
test('H4 a lapsed lease, a wrong token and a serial outside the two Note 9s are refused before any guard call', async t => {
  const { root } = fixture(t); await resetGrant(root);
  const d = phone([...STANDING]);
  assert.throws(() => resetStart({ ...hOpts(root, 'rs1', d), token: tok('other') }), /another holder/);
  for (const member of ['device:abcdef0123456789', 'device:emulator-5580', 'build:cargo']) {
    mutateState(root, null, s => { s.deviceLeases.requests.rs1.member = member; });
    assert.throws(() => resetStart(hOpts(root, 'rs1', d)), /Note 9 playground phone/, member);
    assert.throws(() => resetEnd(hOpts(root, 'rs1', d)), /Note 9 playground phone/, member);
  }
  mutateState(root, null, s => { s.deviceLeases.requests.rs1.member = PHONE1; });
  expire(root, 'rs1');
  assert.throws(() => resetStart(hOpts(root, 'rs1', d)), /not live/); assert.throws(() => resetEnd(hOpts(root, 'rs1', d)), /not live/);
  assert.deepEqual(d.argv, []);
});
test('H5 the helper drives the two Note 9 serials only, with guard calls from its fixed list only', async t => {
  const { root } = fixture(t); await resetGrant(root);
  const d = phone([...STANDING, 'dev.risu.old']);
  resetStart(hOpts(root, 'rs1', d)); resetEnd(hOpts(root, 'rs1', d));
  assert.ok(d.argv.length >= 4);
  for (const argv of d.argv) assert.ok(NOTE9.includes(argv[argv.indexOf('--serial') + 1]));
  const ok = [/^shell pm list packages -3$/, /^shell pm clear io\.github\.yor42\.risutanium$/, /^uninstall dev\.risu\.[a-z0-9_.]+$/, /^install -r \S+$/];
  for (const c of guardCalls(d)) assert.ok(ok.some(r => r.test(c)), c);
  const guardSrc = fs.readFileSync(new URL('../../Agents/Tools/device-guard/adbg.mjs', import.meta.url), 'utf8');
  const guardSerials = [...guardSrc.matchAll(/PLAYGROUND_SERIALS\s*=\s*new Set\(\[([^\]]*)\]/g)].flatMap(m => [...m[1].matchAll(/'([0-9a-f]+)'/g)].map(x => x[1])).sort();
  assert.deepEqual(guardSerials, [...NOTE9].sort());
  assert.deepEqual(POLICY_DP.pools.note9.members.map(m => m.resource.replace('device:', '')).sort(), [...NOTE9].sort());
});
test('H6 a failed reset call or an unreadable census stops the start and marks nothing done', async t => {
  for (const failOn of [['shell pm clear io.github.yor42.risutanium'], ['uninstall dev.risu.old']]) {
    const { root } = fixture(t); await resetGrant(root);
    const d = phone([...STANDING, 'dev.risu.old'], { failOn });
    const out = resetStart(hOpts(root, 'rs1', d)); assert.equal(out.status, 'stop');
    assert.equal(leases(root).requests.rs1.resetRequired, true);
  }
  const { root } = fixture(t); await resetGrant(root);
  const d = phone([...STANDING]); const g = d.guard; d.guard = a => { const r = g(a); return a.includes('list') ? { ...r, stdout: 'package:ok.app\nWarning: odd line\n' } : r; };
  assert.equal(resetStart(hOpts(root, 'rs1', d)).status, 'stop'); assert.deepEqual(d.mutations, []);
});
test('H7 --apk needs its hash, then installs and reads the hash back; a failed read-back stops', async t => {
  const { root } = fixture(t); await resetGrant(root);
  const apk = path.join(root, 'app.apk'); fs.writeFileSync(apk, 'synthetic apk'); const sha = crypto.createHash('sha256').update('synthetic apk').digest('hex');
  assert.throws(() => resetStart(hOpts(root, 'rs1', phone([...STANDING]), { apk, apkSha256: 'a'.repeat(64) })), /does not match/);
  assert.throws(() => resetStart(hOpts(root, 'rs1', phone([...STANDING]), { apk })), /go together/);
  const bad = phone([...STANDING], { readbackCode: 1 });
  assert.equal(resetStart(hOpts(root, 'rs1', bad, { apk, apkSha256: sha })).status, 'stop');
  const d = phone([...STANDING]);
  assert.equal(resetStart(hOpts(root, 'rs1', d, { apk, apkSha256: sha })).status, 'ok');
  assert.deepEqual(d.mutations, ['shell pm clear io.github.yor42.risutanium', `install -r ${apk}`]);
  assert.ok(d.argv.some(a => a[0] === 'apk-readback' && a.includes(sha)));
});
test('H8 a full run: start, a run-installed helper appears, end removes it and releases clean only on an equal census', async t => {
  const { root } = fixture(t); await resetGrant(root);
  const d = phone([...STANDING, KEEP, 'dev.risu.old']);
  resetStart(hOpts(root, 'rs1', d)); d.pkgs.add('dev.risu.run1');
  const out = resetEnd(hOpts(root, 'rs1', d));
  assert.deepEqual([out.status, out.released, out.needsReset], ['ok', 'released', false]); assert.deepEqual(out.removedHelpers, ['dev.risu.run1']);
  assert.equal(leases(root).requests.rs1.releaseCensus, out.census); assert.equal(leases(root).members[PHONE1].needsReset, false);
  assert.equal((await acquire(root, 'next')).resetRequired, false);
});
test('H9 end refuses the clean release when the census differs, a package is unclassed, the baseline is absent or the reset was never done', async t => {
  const cases = {
    extra: d => d.pkgs.add('com.samsung.newthing'), unknown: d => d.pkgs.add('com.example.mystery'),
    missing: d => d.pkgs.delete(STANDING[0]), failedUninstall: d => { d.pkgs.add('dev.risu.run1'); d.guardFail = true; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const { root } = fixture(t); await resetGrant(root);
    const d = phone([...STANDING]); resetStart(hOpts(root, 'rs1', d)); mutate(d);
    if (d.guardFail) { const g = d.guard; d.guard = a => a.includes('uninstall') ? { code: 1, stdout: '', stderr: '' } : g(a); }
    const out = resetEnd(hOpts(root, 'rs1', d));
    assert.deepEqual([out.status, out.needsReset], ['stop', true], name); assert.equal(leases(root).requests.rs1.releaseCensus, null, name);
    assert.equal((await acquire(root, 'next')).resetRequired, true, name);
  }
  const { root } = fixture(t); await resetGrant(root);
  const noStart = resetEnd(hOpts(root, 'rs1', phone([...STANDING])));
  assert.deepEqual([noStart.status, noStart.needsReset], ['stop', true]); assert.match(noStart.reasons.join(), /still owes its reset/);
  const { root: r2 } = fixture(t); await acquire(r2, 'plain');
  const noBase = resetEnd(hOpts(r2, 'plain', phone([...STANDING]))); assert.match(noBase.reasons.join(), /no start baseline/); assert.equal(noBase.needsReset, true);
});
test('H10 the 2026-11-27 failure: a clean release straight after a lapse is refused and the helper path leaves the phone clean', async t => {
  const { root, evidence } = fixture(t); await resetGrant(root);
  await assert.rejects(release(root, 'rs1', evidence('end.txt')), /workflow-device-reset/);
  const d = phone([...STANDING]); resetStart(hOpts(root, 'rs1', d));
  assert.equal(resetEnd(hOpts(root, 'rs1', d)).needsReset, false);
  assert.equal(leases(root).members[PHONE1].needsReset, false);
});
test('H11 an end run refuses a baseline that belongs to another request or phone', async t => {
  for (const patch of [{ request: 'someone-else' }, { serial: NOTE9[1] }]) {
    const { root } = fixture(t); await resetGrant(root);
    const d = phone([...STANDING]); resetStart(hOpts(root, 'rs1', d));
    const file = path.join(root, 'run', 'reset-state.json'); fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), ...patch }));
    const out = resetEnd(hOpts(root, 'rs1', d)); assert.match(out.reasons.join(), /no start baseline/); assert.equal(out.needsReset, true);
  }
});
test('H12 a run folder outside %TEMP% is refused before any guard call', async t => {
  const { root } = fixture(t); await resetGrant(root);
  const d = phone([...STANDING]); const outside = path.join(path.dirname(path.resolve(os.tmpdir())), 'risu-846-outside');
  assert.throws(() => resetStart(hOpts(root, 'rs1', d, { run: outside })), /under %TEMP%/); assert.throws(() => resetEnd(hOpts(root, 'rs1', d, { run: outside })), /under %TEMP%/);
  assert.deepEqual(d.argv, []); assert.ok(!fs.existsSync(outside));
});
