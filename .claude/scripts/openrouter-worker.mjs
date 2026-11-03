import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { MODEL, reserveJob, requestBound, commitRequest, reconcileRequest, releaseJob, inspectBudget } from './openrouter-budget.mjs';

const ROOT = 'https://openrouter.ai/api/v1';
const SYSTEM = 'You are a bounded coding worker. Use only the supplied sanitized files and task. Return one JSON object with status, findings, changedPaths, checks, limitations, and edits. edits is an array of {path, operation:write|delete, content} using exact repository-relative paths. Do not run commands, use tools, call other models, integrate code, claim tests ran, or declare acceptance. For scout or review, edits must be empty. Report incomplete context as a limitation.';

export function assessActivation({ config, apiKeyAvailable = Boolean(process.env.OPENROUTER_API_KEY), now } = {}) {
    const reasons = [];
    if (config?.enabled !== true) reasons.push('Paid transport is disabled in project policy.');
    if (!apiKeyAvailable) reasons.push('OPENROUTER_API_KEY is unavailable.');
    if (config?.dedicatedKey !== true) reasons.push('A dedicated capped key has not been confirmed.');
    if (!config?.contractEvidence?.path || !/^[a-f0-9]{64}$/i.test(config?.contractEvidence?.sha256 ?? '')) reasons.push('Host-reviewed full-request contract evidence is missing.');
    if (config?.contractEvidence?.sha256 !== config?.proof?.evidenceSHA256) reasons.push('Bound proof and reviewed evidence identities differ.');
    try { requestBound(config?.proof, { now, maxOutputTokens: config?.maxOutputTokens }); }
    catch (error) { reasons.push(error.message); }
    if (config && Object.keys(config).some(key => !['enabled', 'dedicatedKey', 'contractEvidence', 'proof', 'maxOutputTokens', 'timeoutSeconds'].includes(key))) reasons.push('Unsupported configuration could expand paid routing.');
    if (config?.timeoutSeconds != null && (!Number.isSafeInteger(config.timeoutSeconds) || config.timeoutSeconds < 1 || config.timeoutSeconds > 1800)) reasons.push('Invalid paid request timeout.');
    return { active: reasons.length === 0, model: MODEL, reasons, required: ['fresh reviewed provider pricing/context/output+reasoning/retry contract', 'dedicated capped key in environment', 'host-shared budget ledger', 'successful runtime key-cap check'] };
}
export function buildRequest({ prompt, mode, config }) {
    if (!['scout', 'implement', 'review'].includes(mode) || typeof prompt !== 'string' || !prompt.length || Buffer.byteLength(prompt) > 4 * 1024 * 1024) throw new Error('Invalid bounded prompt or mode.');
    return {
        model: MODEL,
        provider: {
            only: [config.proof.providerSlug], order: [config.proof.providerSlug], allow_fallbacks: false, require_parameters: true,
            max_price: { prompt: config.proof.inputUSDPerToken * 1000000, completion: config.proof.outputUSDPerToken * 1000000, request: config.proof.requestFeeUSD }
        },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Mode: ${mode}\n${prompt}` }],
        max_tokens: config.maxOutputTokens,
        stream: false,
        plugins: [],
        response_format: { type: 'json_object' }
    };
}
async function jsonResponse(response) {
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}; reconcile the request before further paid usage.`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 10 * 1024 * 1024) throw new Error('Oversized provider response.');
    return JSON.parse(text);
}
function validateResult(value, mode) {
    if (!value || typeof value !== 'object' || typeof value.status !== 'string' || !Array.isArray(value.findings) || !Array.isArray(value.changedPaths) || !Array.isArray(value.checks) || !Array.isArray(value.limitations) || !Array.isArray(value.edits)) throw new Error('Worker returned no valid bounded result.');
    if (mode !== 'implement' && value.edits.length) throw new Error('Read-only paid worker attempted edits.');
    for (const edit of value.edits) {
        if (!edit || typeof edit.path !== 'string' || !['write', 'delete'].includes(edit.operation) || (edit.operation === 'write' && typeof edit.content !== 'string')) throw new Error('Invalid proposed edit.');
    }
    return value;
}
export async function runOpenRouter({ ledgerPath, logicalJobId, requestId = crypto.randomUUID(), prompt, mode, config, apiKey = process.env.OPENROUTER_API_KEY, fetchImpl = fetch, now }) {
    const activation = assessActivation({ config, apiKeyAvailable: Boolean(apiKey), now });
    if (!activation.active) return { status: 'unavailable', provider: 'openrouter', activation };
    const evidence = await fs.readFile(config.contractEvidence.path);
    if (crypto.createHash('sha256').update(evidence).digest('hex').toLowerCase() !== config.contractEvidence.sha256.toLowerCase()) throw new Error('Host-reviewed contract evidence changed.');
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const timeout = (config.timeoutSeconds ?? 1200) * 1000;
    const key = await jsonResponse(await fetchImpl(`${ROOT}/key`, { headers, redirect: 'error', signal: AbortSignal.timeout(Math.min(timeout, 30000)) }));
    if (!key.data || !Number.isFinite(key.data.limit) || key.data.limit <= 0 || key.data.limit > 30 || !Number.isFinite(key.data.limit_remaining) || key.data.limit_remaining <= 0 || ![null, 'daily', 'monthly'].includes(key.data.limit_reset)) throw new Error('A usable dedicated key cap at or below $30 is required; no key or budget changes were made.');
    const body = buildRequest({ prompt, mode, config });
    const boundUSD = requestBound(config.proof, { now, maxOutputTokens: config.maxOutputTokens });
    await reserveJob({ ledgerPath, jobId: logicalJobId, now });
    await commitRequest({ ledgerPath, jobId: logicalJobId, requestId, boundUSD, model: MODEL, proof: config.proof, maxOutputTokens: config.maxOutputTokens, now });
    let generationId;
    let accounted = false;
    try {
        // One HTTP attempt, one provider endpoint and no model/provider retries. The host owns all future continuations.
        const response = await jsonResponse(await fetchImpl(`${ROOT}/chat/completions`, { method: 'POST', headers, redirect: 'error', body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }));
        generationId = response.id;
        if (typeof generationId !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(generationId)) throw new Error('Provider generation identity unavailable.');
        const metadata = await jsonResponse(await fetchImpl(`${ROOT}/generation?id=${encodeURIComponent(generationId)}`, { headers, redirect: 'error', signal: AbortSignal.timeout(Math.min(timeout, 30000)) }));
        if (metadata.data?.id !== generationId || typeof metadata.data.total_cost !== 'number' || !Number.isFinite(metadata.data.total_cost) || typeof metadata.data.model !== 'string') throw new Error('Actual generation cost/model reconciliation unavailable.');
        const actualModel = response.model !== MODEL ? (response.model ?? 'missing') : metadata.data.model;
        const reconciliation = await reconcileRequest({ ledgerPath, jobId: logicalJobId, requestId, generationId, actualCostUSD: metadata.data.total_cost, actualModel, now });
        accounted = true;
        if (response.model !== MODEL || reconciliation.blocked) throw new Error('Provider response/model/cost violated the committed request.');
        const content = response.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('No structured worker content.');
        const result = validateResult(JSON.parse(content), mode);
        await releaseJob({ ledgerPath, jobId: logicalJobId });
        return { version: 1, provider: 'openrouter', model: MODEL, requestId, generationId, costUSD: reconciliation.actualCostUSD, status: 'completed', result, acceptance: 'untrusted-input', editsApplied: false };
    } catch (error) {
        if (!accounted) await reconcileRequest({ ledgerPath, jobId: logicalJobId, requestId, actualCostUSD: null, generationId, now });
        throw error;
    }
}

export async function paidAssessment(options) {
    const activation = assessActivation(options);
    if (activation.active) {
        try {
            const evidence = await fs.readFile(options.config.contractEvidence.path);
            if (crypto.createHash('sha256').update(evidence).digest('hex') !== options.config.contractEvidence.sha256.toLowerCase()) throw new Error('changed');
        } catch {
            activation.active = false;
            activation.reasons.push('Reviewed contract evidence is unavailable or changed.');
        }
    }
    if (!options?.ledgerPath) return activation;
    const budget = await inspectBudget(options);
    return { ...activation, active: activation.active && !budget.blocked && budget.availableUSD.day > 0 && budget.availableUSD.month > 0, budget };
}
