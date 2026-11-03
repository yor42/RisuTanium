import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { MODEL, inspectBudget } from './openrouter-budget.mjs';
import { assessActivation, buildRequest, runOpenRouter, paidAssessment } from './openrouter-worker.mjs';

const now = '2026-11-03T01:00:00Z';
async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'risu-paid-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const evidence = 'SYNTHETIC provider contract, not production activation evidence.';
    const evidencePath = path.join(dir, 'contract.txt');
    await fs.writeFile(evidencePath, evidence);
    const sha256 = crypto.createHash('sha256').update(evidence).digest('hex');
    return {
        ledgerPath: path.join(dir, 'ledger.json'), logicalJobId: 'stage1', requestId: 'request1', prompt: 'Review supplied fixture only.', mode: 'review', apiKey: 'synthetic-not-a-real-key', now,
        config: { enabled: true, dedicatedKey: true, contractEvidence: { path: evidencePath, sha256 }, maxOutputTokens: 100, timeoutSeconds: 1, proof: { model: MODEL, sourceURL: 'https://openrouter.ai/synthetic-contract', evidenceSHA256: sha256, providerSlug: 'deepseek', verifiedAt: now, expiresAt: '2026-11-04T00:59:59Z', contextLength: 1000, maxOutputTokens: 100, inputUSDPerToken: 0.0001, outputUSDPerToken: 0.001, requestFeeUSD: 0, completionBoundIncludesReasoning: true, singleAttempt: true, noProviderRetries: true, textOnly: true } }
    };
}
function responses(overrides = {}) {
    const requests = [];
    const result = { status: 'partial', findings: [], changedPaths: [], checks: [], limitations: ['Synthetic provider only.'], edits: [] };
    const fetchImpl = async (url, options) => {
        requests.push({ url, options });
        const body = url.endsWith('/key') ? { data: { limit: 30, limit_remaining: 30, limit_reset: 'monthly' } }
            : url.endsWith('/chat/completions') ? { id: 'gen-fixture', model: overrides.responseModel ?? MODEL, choices: [{ message: { content: JSON.stringify(overrides.result ?? result) } }] }
                : { data: { id: 'gen-fixture', total_cost: 0.01, model: overrides.metadataModel ?? MODEL } };
        if (url.includes('/generation') && overrides.metadataUnavailable) throw new Error('Delayed accounting.');
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    return { fetchImpl, requests };
}
test('missing activation proof/key never calls the paid provider', async () => {
    let called = false;
    const result = await runOpenRouter({ config: { enabled: false }, fetchImpl: async () => { called = true; } });
    assert.equal(result.status, 'unavailable');
    assert.equal(called, false);
    assert.equal(assessActivation({ config: { enabled: true }, apiKeyAvailable: false, now }).active, false);
});
test('single bounded request has no hidden model, provider fallback, plugins or tools', async t => {
    const options = await fixture(t);
    const body = buildRequest(options);
    assert.equal(body.model, MODEL);
    assert.deepEqual(body.provider.only, ['deepseek']);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.equal(body.provider.require_parameters, true);
    assert.deepEqual(body.provider.max_price, { prompt: 100, completion: 1000, request: 0 });
    assert.equal(body.max_tokens, 100);
    assert.deepEqual(body.plugins, []);
    assert.equal(body.models, undefined);
    assert.equal(body.tools, undefined);
    const fake = responses();
    const result = await runOpenRouter({ ...options, fetchImpl: fake.fetchImpl });
    assert.equal(result.editsApplied, false);
    assert.equal(result.acceptance, 'untrusted-input');
    assert.equal(fake.requests.filter(x => x.options.method === 'POST').length, 1);
    assert.equal((await inspectBudget(options)).blocked, false);
});
test('unknown reconciliation retains liabilities without retrying inference', async t => {
    const options = await fixture(t);
    const fake = responses({ metadataUnavailable: true });
    await assert.rejects(runOpenRouter({ ...options, fetchImpl: fake.fetchImpl }), /Delayed accounting/);
    assert.equal(fake.requests.filter(x => x.options.method === 'POST').length, 1);
    const budget = await inspectBudget(options);
    assert.equal(budget.blocked, true);
    assert.equal(budget.pending[0].status, 'unknown');
});
test('both response and billing metadata model substitutions are rejected and frozen', async t => {
    for (const substitution of [{ responseModel: 'other/model' }, { metadataModel: 'other/model' }]) {
        const options = await fixture(t);
        const fake = responses(substitution);
        await assert.rejects(runOpenRouter({ ...options, fetchImpl: fake.fetchImpl }), /violated/);
        assert.equal((await inspectBudget(options)).violations.length, 1);
    }
});
test('read-only worker edits are rejected and never written', async t => {
    const options = await fixture(t);
    const fake = responses({ result: { status: 'done', findings: [], changedPaths: ['src/a.ts'], checks: [], limitations: [], edits: [{ path: 'src/a.ts', operation: 'write', content: 'bad' }] } });
    await assert.rejects(runOpenRouter({ ...options, fetchImpl: fake.fetchImpl }), /Read-only/);
    await assert.rejects(fs.stat(path.join(path.dirname(options.ledgerPath), 'src/a.ts')), { code: 'ENOENT' });
});
test('changed evidence, unknown settings and missing dedicated cap fail before inference', async t => {
    const options = await fixture(t);
    assert.equal(assessActivation({ ...options, apiKeyAvailable: true, config: { ...options.config, models: ['other/model'] } }).active, false);
    await fs.writeFile(options.config.contractEvidence.path, 'changed');
    let called = false;
    await assert.rejects(runOpenRouter({ ...options, fetchImpl: async () => { called = true; } }), /evidence changed/);
    assert.equal(called, false);
    assert.equal((await paidAssessment({ ...options, apiKeyAvailable: true })).active, false);
});
