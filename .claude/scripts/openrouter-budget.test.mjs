import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MODEL, periods, reserveJob, commitRequest, reconcileRequest, releaseJob, inspectBudget, requestBound } from './openrouter-budget.mjs';

const now = '2026-11-03T01:00:00.000Z';
const proof = () => ({ model: MODEL, sourceURL: 'https://openrouter.ai/test-contract', evidenceSHA256: 'a'.repeat(64), providerSlug: 'deepseek', verifiedAt: now, expiresAt: '2026-11-04T00:59:59.000Z', contextLength: 1000, maxOutputTokens: 100, inputUSDPerToken: 0.0001, outputUSDPerToken: 0.001, requestFeeUSD: 0, completionBoundIncludesReasoning: true, singleAttempt: true, noProviderRetries: true, textOnly: true });
async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'risu-budget-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    return path.join(dir, 'ledger.json');
}
async function spend(ledgerPath, jobId, requestId, cost = 0.2, at = now) {
    const p = { ...proof(), verifiedAt: at, expiresAt: new Date(Date.parse(at) + 3600000).toISOString() };
    await reserveJob({ ledgerPath, jobId, now: at });
    await commitRequest({ ledgerPath, jobId, requestId, boundUSD: 0.2, model: MODEL, proof: p, maxOutputTokens: 100, now: at });
    await reconcileRequest({ ledgerPath, jobId, requestId, actualCostUSD: cost, actualModel: MODEL, generationId: `gen-${jobId}-${requestId}`, now: at });
    await releaseJob({ ledgerPath, jobId });
}
test('KST day and month reset use UTC+9 boundaries', () => {
    assert.deepEqual(periods('2026-11-30T14:59:59Z'), { day: '2026-11-30', month: '2026-11' });
    assert.deepEqual(periods('2026-11-30T15:00:00Z'), { day: '2026-12-01', month: '2026-12' });
});
test('unknown costs retain known generation identity across restart and forbid rebinding it', async t => {
    const ledgerPath = await fixture(t);
    await reserveJob({ ledgerPath, jobId: 'resume', now });
    await commitRequest({ ledgerPath, jobId: 'resume', requestId: 'one', boundUSD: 0.2, model: MODEL, proof: proof(), maxOutputTokens: 100, now });
    await reconcileRequest({ ledgerPath, jobId: 'resume', requestId: 'one', generationId: 'gen-known', actualCostUSD: null, now });
    assert.equal((await inspectBudget({ ledgerPath, now })).pending[0].generationId, 'gen-known');
    await assert.rejects(reconcileRequest({ ledgerPath, jobId: 'resume', requestId: 'one', generationId: 'gen-other', actualCostUSD: 0.1, actualModel: MODEL, now }), /identity changed/);
    await reconcileRequest({ ledgerPath, jobId: 'resume', requestId: 'one', generationId: 'gen-known', actualCostUSD: 0.1, actualModel: MODEL, now });
});
test('request bound charges full context at cache-miss rates and all allowed output plus fees', () => {
    assert.equal(requestBound(proof(), { now, maxOutputTokens: 100 }), 0.2);
    assert.equal(requestBound({ ...proof(), requestFeeUSD: 0.01 }, { now, maxOutputTokens: 100 }), 0.21);
    for (const mutation of [{ singleAttempt: false }, { noProviderRetries: false }, { completionBoundIncludesReasoning: false }, { inputUSDPerToken: undefined }, { model: 'other/model' }, { expiresAt: now }]) {
        assert.throws(() => requestBound({ ...proof(), ...mutation }, { now, maxOutputTokens: 100 }));
    }
});
test('logical-job cap survives releases, corrections, restart and rollover', async t => {
    const ledgerPath = await fixture(t);
    await spend(ledgerPath, 'stage1', 'first');
    await spend(ledgerPath, 'stage1', 'correction');
    const next = '2026-12-03T01:00:00Z';
    assert.equal((await reserveJob({ ledgerPath, jobId: 'stage1', now: next })).reservedUSD, 0.1);
    await assert.rejects(commitRequest({ ledgerPath, jobId: 'stage1', requestId: 'continuation', boundUSD: 0.2, model: MODEL, proof: { ...proof(), verifiedAt: next, expiresAt: '2026-12-03T02:00:00Z' }, maxOutputTokens: 100, now: next }), /remaining reservation/);
});
test('concurrent local processes share the $5 daily allowance', async t => {
    const ledgerPath = await fixture(t);
    const moduleURL = new URL('./openrouter-budget.mjs', import.meta.url).href;
    const workers = Array.from({ length: 12 }, (_, index) => new Promise(resolve => {
        const code = `import { reserveJob } from ${JSON.stringify(moduleURL)}; try { await reserveJob(${JSON.stringify({ ledgerPath, jobId: `job${index}`, now })}); process.exit(0); } catch { process.exit(9); }`;
        const child = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, stdio: 'ignore' });
        child.once('error', error => resolve({ error }));
        child.once('exit', exit => resolve({ exit }));
    }));
    const results = await Promise.all(workers);
    assert.equal(results.filter(x => x.exit === 0).length, 10);
    assert.equal(results.filter(x => x.exit === 9).length, 2);
    assert.equal((await inspectBudget({ ledgerPath, now })).availableUSD.day, 0);
});
test('daily funds bound a final job and monthly cap spans days', async t => {
    const ledgerPath = await fixture(t);
    for (let day = 1; day <= 6; day++) {
        const at = `2026-11-${String(day).padStart(2, '0')}T01:00:00Z`;
        for (let index = 0; index < 10; index++) {
            const jobId = `d${day}-${index}`;
            await spend(ledgerPath, jobId, 'r1', 0.2, at);
            await spend(ledgerPath, jobId, 'r2', 0.2, at);
            await reserveJob({ ledgerPath, jobId, now: at });
            const p = { ...proof(), verifiedAt: at, expiresAt: new Date(Date.parse(at) + 3600000).toISOString(), maxOutputTokens: 1, inputUSDPerToken: 0, outputUSDPerToken: 0, requestFeeUSD: 0.1 };
            await commitRequest({ ledgerPath, jobId, requestId: 'r3', model: MODEL, boundUSD: 0.1, proof: p, maxOutputTokens: 1, now: at });
            await reconcileRequest({ ledgerPath, jobId, requestId: 'r3', generationId: `gen-${jobId}-r3`, actualCostUSD: 0.1, actualModel: MODEL, now: at });
            await releaseJob({ ledgerPath, jobId });
        }
        await assert.rejects(reserveJob({ ledgerPath, jobId: `extra${day}`, now: at }), /cap reached/);
    }
    await assert.rejects(reserveJob({ ledgerPath, jobId: 'newday', now: '2026-11-07T01:00:00Z' }), /cap reached/);
    assert.equal((await reserveJob({ ledgerPath, jobId: 'newmonth', now: '2026-12-01T01:00:00Z' })).reservedUSD, 0.5);
});
test('pending and unknown costs retain reservations across rollover and block reuse', async t => {
    const ledgerPath = await fixture(t);
    await reserveJob({ ledgerPath, jobId: 'job', now });
    await commitRequest({ ledgerPath, jobId: 'job', requestId: 'req', boundUSD: 0.2, model: MODEL, proof: proof(), maxOutputTokens: 100, now });
    await assert.rejects(commitRequest({ ledgerPath, jobId: 'job', requestId: 'reuse', boundUSD: 0.2, model: MODEL, proof: proof(), maxOutputTokens: 100, now }), /unresolved/);
    await reconcileRequest({ ledgerPath, jobId: 'job', requestId: 'req', actualCostUSD: null, now });
    await assert.rejects(reserveJob({ ledgerPath, jobId: 'other', now: '2026-12-01T01:00:00Z' }), /unresolved/);
    await assert.rejects(releaseJob({ ledgerPath, jobId: 'job' }), /unresolved/);
    assert.equal((await inspectBudget({ ledgerPath, now })).pending[0].boundUSD, 0.2);
    await reconcileRequest({ ledgerPath, jobId: 'job', requestId: 'req', actualCostUSD: 0.1, generationId: 'gen-req', actualModel: MODEL, now });
    assert.equal((await reserveJob({ ledgerPath, jobId: 'job', now: '2026-12-01T01:00:00Z' })).reservedUSD, 0.4);
});
test('reservation is bounded by the last available daily funds rather than granting a fresh job cap', async t => {
    const ledgerPath = await fixture(t);
    for (let index = 0; index < 12; index++) {
        await spend(ledgerPath, `job${index}`, 'a');
        await spend(ledgerPath, `job${index}`, 'b');
    }
    assert.equal((await reserveJob({ ledgerPath, jobId: 'final', now })).reservedUSD, 0.2);
    await assert.rejects(reserveJob({ ledgerPath, jobId: 'no-funds', now }), /cap reached/);
});
test('old-period reservation must rebind before spend', async t => {
    const ledgerPath = await fixture(t);
    await reserveJob({ ledgerPath, jobId: 'job', now: '2026-11-02T14:59:59Z' });
    await assert.rejects(commitRequest({ ledgerPath, jobId: 'job', requestId: 'req', boundUSD: 0.2, model: MODEL, proof: proof(), maxOutputTokens: 100, now }), /rebind/);
});
test('server model substitution or over-bound cost freezes subsequent paid work', async t => {
    for (const actual of [{ actualCostUSD: 0.21, actualModel: MODEL }, { actualCostUSD: 0.1, actualModel: 'other/model' }]) {
        const ledgerPath = await fixture(t);
        await reserveJob({ ledgerPath, jobId: 'job', now });
        await commitRequest({ ledgerPath, jobId: 'job', requestId: 'req', boundUSD: 0.2, model: MODEL, proof: proof(), maxOutputTokens: 100, now });
        assert.equal((await reconcileRequest({ ledgerPath, jobId: 'job', requestId: 'req', generationId: 'gen-violation', ...actual, now })).blocked, true);
        await assert.rejects(reserveJob({ ledgerPath, jobId: 'another', now }), /violation/);
    }
});
