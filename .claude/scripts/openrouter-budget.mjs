import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const MODEL = 'deepseek/deepseek-v4.1-flash';
export const CAPS = Object.freeze({ job: 500000, day: 5000000, month: 30000000 });
const SCALE = 1000000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = now => new Date(now ?? Date.now()).toISOString();
const identifier = value => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error('Invalid budget identity.');
    return value;
};
const money = value => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Cost must be a finite nonnegative USD number.');
    const result = Math.ceil(value * SCALE - 1e-9);
    if (!Number.isSafeInteger(result)) throw new Error('Cost exceeds safe accounting range.');
    return result;
};
export function periods(now) {
    const kst = new Date(new Date(now ?? Date.now()).getTime() + 9 * 3600000).toISOString();
    return { day: kst.slice(0, 10), month: kst.slice(0, 7) };
}
function validateLedger(ledger) {
    if (ledger.version !== 1 || !ledger.jobs || !Array.isArray(ledger.charges) || !Array.isArray(ledger.violations)) throw new Error('Invalid budget ledger; paid calls blocked.');
    for (const [id, job] of Object.entries(ledger.jobs)) {
        identifier(id);
        if (!Number.isSafeInteger(job.spent) || job.spent < 0 || !Array.isArray(job.requests)) throw new Error('Corrupt logical-job ledger.');
        if (job.hold && (!Number.isSafeInteger(job.hold.amount) || job.hold.amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(job.hold.day) || !/^\d{4}-\d{2}$/.test(job.hold.month))) throw new Error('Corrupt reservation.');
        for (const req of job.requests) {
            identifier(req.id);
            if (!Number.isSafeInteger(req.bound) || req.bound < 0 || !['committed', 'unknown', 'reconciled', 'violation'].includes(req.status)) throw new Error('Corrupt request commitment.');
        }
    }
    for (const charge of ledger.charges) if (!Number.isSafeInteger(charge.amount) || charge.amount < 0) throw new Error('Corrupt actual-cost entry.');
}
async function transact(ledgerPath, action) {
    if (!ledgerPath || !path.isAbsolute(ledgerPath)) throw new Error('An absolute shared ledgerPath is required.');
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    const lock = `${ledgerPath}.lock`;
    const started = Date.now();
    for (;;) {
        try { await fs.mkdir(lock); break; }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (Date.now() - started > 10000) throw new Error('Budget lock unavailable; inspect owner before recovering it.');
            await wait(20);
        }
    }
    let temp;
    try {
        await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: stamp() }), { flag: 'wx' });
        let ledger;
        try { ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            ledger = { version: 1, currency: 'USD', unit: 'microUSD', timezone: 'Asia/Seoul', jobs: {}, charges: [], violations: [] };
        }
        validateLedger(ledger);
        const result = await action(ledger);
        validateLedger(ledger);
        temp = `${ledgerPath}.${crypto.randomUUID()}.tmp`;
        const file = await fs.open(temp, 'wx');
        try { await file.writeFile(JSON.stringify(ledger, null, 2) + '\n'); await file.sync(); }
        finally { await file.close(); }
        await fs.rename(temp, ledgerPath);
        temp = undefined;
        return result;
    } finally {
        if (temp) await fs.unlink(temp).catch(() => {});
        await fs.unlink(path.join(lock, 'owner.json')).catch(() => {});
        await fs.rmdir(lock);
    }
}
function assertSettled(ledger) {
    if (ledger.violations.length) throw new Error('A provider/accounting violation blocks paid calls.');
    if (Object.values(ledger.jobs).some(job => job.requests.some(req => ['committed', 'unknown'].includes(req.status)))) throw new Error('An unresolved request holds its liability; reconcile before any new paid call.');
}
function available(ledger, period, excludeId) {
    const spentDay = ledger.charges.filter(x => x.day === period.day).reduce((sum, x) => sum + x.amount, 0);
    const spentMonth = ledger.charges.filter(x => x.month === period.month).reduce((sum, x) => sum + x.amount, 0);
    const other = Object.entries(ledger.jobs).filter(([id]) => id !== excludeId).map(([, job]) => job.hold).filter(Boolean);
    return {
        day: CAPS.day - spentDay - other.filter(x => x.day === period.day).reduce((sum, x) => sum + x.amount, 0),
        month: CAPS.month - spentMonth - other.filter(x => x.month === period.month).reduce((sum, x) => sum + x.amount, 0)
    };
}
export async function reserveJob({ ledgerPath, jobId, now }) {
    identifier(jobId);
    return transact(ledgerPath, ledger => {
        assertSettled(ledger);
        const job = Object.hasOwn(ledger.jobs, jobId) ? ledger.jobs[jobId] : { spent: 0, requests: [], hold: null };
        const period = periods(now);
        const funds = available(ledger, period, jobId);
        const amount = Math.min(CAPS.job - job.spent, funds.day, funds.month);
        if (amount <= 0) throw new Error('OpenRouter logical-job, daily or monthly cap reached.');
        job.hold = { amount, ...period, boundAt: stamp(now) };
        ledger.jobs[jobId] = job;
        return { jobId, reservedUSD: amount / SCALE, ...period };
    });
}
export function requestBound(proof, { now, maxOutputTokens } = {}) {
    const current = new Date(now ?? Date.now()).getTime();
    if (!proof || proof.model !== MODEL || proof.completionBoundIncludesReasoning !== true || proof.singleAttempt !== true || proof.noProviderRetries !== true || proof.textOnly !== true) throw new Error('Unverified full-request/provider contract; paid calls disabled.');
    if (!/^https:\/\/(?:openrouter\.ai|api-docs\.deepseek\.com)\//.test(proof.sourceURL ?? '') || !/^[a-f0-9]{64}$/i.test(proof.evidenceSHA256 ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9/._-]+$/.test(proof.providerSlug ?? '')) throw new Error('Provider proof lacks source identity.');
    const checked = Date.parse(proof.verifiedAt);
    const expiry = Date.parse(proof.expiresAt);
    if (!Number.isFinite(checked) || !Number.isFinite(expiry) || checked > current || expiry <= current || expiry - checked > 86400000) throw new Error('Provider bound proof is stale or invalid.');
    if (!Number.isSafeInteger(proof.contextLength) || proof.contextLength <= 0 || !Number.isSafeInteger(proof.maxOutputTokens) || proof.maxOutputTokens <= 0 || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > proof.maxOutputTokens || maxOutputTokens >= proof.contextLength) throw new Error('Unbounded input/output tokens.');
    for (const field of ['inputUSDPerToken', 'outputUSDPerToken', 'requestFeeUSD']) money(proof[field]);
    // The entire provider context is charged at the verified cache-miss ceiling; no tokenizer estimate is trusted.
    return money(proof.contextLength * proof.inputUSDPerToken + maxOutputTokens * proof.outputUSDPerToken + proof.requestFeeUSD) / SCALE;
}
export async function commitRequest({ ledgerPath, jobId, requestId, boundUSD, model, proof, maxOutputTokens, now }) {
    identifier(jobId); identifier(requestId);
    if (model !== MODEL) throw new Error('Paid model outside singleton allowlist.');
    const provenBound = requestBound(proof, { now, maxOutputTokens });
    const bound = money(boundUSD);
    if (bound < money(provenBound) || bound === 0) throw new Error('Request commitment is below its complete bound.');
    return transact(ledgerPath, ledger => {
        assertSettled(ledger);
        const job = ledger.jobs[jobId];
        const period = periods(now);
        if (!job?.hold || job.hold.day !== period.day || job.hold.month !== period.month) throw new Error('Reserve/rebind the logical job in the current KST periods first.');
        if (job.requests.some(req => req.id === requestId)) throw new Error('Request identity already used; a retry needs its own commitment.');
        if (bound > job.hold.amount || bound > CAPS.job - job.spent) throw new Error('Complete request bound exceeds remaining reservation.');
        job.requests.push({ id: requestId, model, bound, ...period, committedAt: stamp(now), proofSHA256: crypto.createHash('sha256').update(JSON.stringify(proof)).digest('hex'), status: 'committed' });
        return { jobId, requestId, boundUSD: bound / SCALE, status: 'committed' };
    });
}
export async function reconcileRequest({ ledgerPath, jobId, requestId, actualCostUSD, actualModel, generationId, now }) {
    identifier(jobId); identifier(requestId);
    return transact(ledgerPath, ledger => {
        const job = ledger.jobs[jobId];
        const request = job?.requests.find(req => req.id === requestId);
        if (!request) throw new Error('Unknown request commitment.');
        if (['reconciled', 'violation'].includes(request.status)) throw new Error('Request already reconciled.');
        if (actualCostUSD == null || !generationId || !actualModel) {
            if (generationId) {
                identifier(generationId);
                if (request.generationId && request.generationId !== generationId) throw new Error('Generation identity changed.');
                request.generationId = generationId;
            }
            request.status = 'unknown';
            request.updatedAt = stamp(now);
            return { status: 'unknown', blocked: true, retainedBoundUSD: request.bound / SCALE };
        }
        identifier(generationId);
        if (request.generationId && request.generationId !== generationId) throw new Error('Generation identity changed.');
        if (ledger.charges.some(charge => charge.generationId === generationId)) throw new Error('Generation already accounted under another commitment.');
        const actual = money(actualCostUSD);
        job.spent += actual;
        if (job.hold) job.hold.amount = Math.max(0, job.hold.amount - actual);
        ledger.charges.push({ jobId, requestId, generationId, amount: actual, day: request.day, month: request.month, reconciledAt: stamp(now) });
        request.actual = actual;
        request.generationId = generationId;
        request.actualModel = actualModel;
        request.status = actual > request.bound || actualModel !== MODEL ? 'violation' : 'reconciled';
        if (request.status === 'violation') ledger.violations.push({ jobId, requestId, actualModel, actual, bound: request.bound, at: stamp(now) });
        return { status: request.status, blocked: request.status === 'violation', actualCostUSD: actual / SCALE, remainingJobUSD: Math.max(0, CAPS.job - job.spent) / SCALE };
    });
}
export async function releaseJob({ ledgerPath, jobId }) {
    identifier(jobId);
    return transact(ledgerPath, ledger => {
        const job = ledger.jobs[jobId];
        if (!job) throw new Error('Unknown logical job.');
        if (job.requests.some(req => ['committed', 'unknown'].includes(req.status))) throw new Error('Cannot release an unresolved liability.');
        job.hold = null;
        return { jobId, status: 'released', remainingJobUSD: Math.max(0, CAPS.job - job.spent) / SCALE };
    });
}
export async function inspectBudget({ ledgerPath, now }) {
    return transact(ledgerPath, ledger => {
        const period = periods(now);
        const funds = available(ledger, period);
        const pending = Object.entries(ledger.jobs).flatMap(([jobId, job]) => job.requests.filter(req => ['committed', 'unknown'].includes(req.status)).map(req => ({ jobId, requestId: req.id, generationId: req.generationId ?? null, status: req.status, boundUSD: req.bound / SCALE })));
        return { version: 1, timezone: 'Asia/Seoul', capsUSD: { job: 0.5, day: 5, month: 30 }, ...period, availableUSD: { day: funds.day / SCALE, month: funds.month / SCALE }, pending, violations: ledger.violations, blocked: pending.length > 0 || ledger.violations.length > 0 };
    });
}
