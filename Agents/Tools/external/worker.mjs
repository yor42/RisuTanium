import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomicJson, inspectDelta, loadManifest, noLinks, within, relativePath, excluded, fingerprint } from './workspace.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modes = new Set(['scout', 'implement', 'review']);
export const resultSchema = {
    type: 'object', additionalProperties: false,
    required: ['dispatchId', 'inputDigest', 'status', 'findings', 'changedPaths', 'checks', 'limitations'],
    properties: {
        dispatchId: { type: 'string' }, inputDigest: { type: 'string' },
        status: { type: 'string', enum: ['complete', 'partial', 'blocked', 'amendment-requested'] },
        findings: { type: 'array', items: { type: 'string' } },
        changedPaths: { type: 'array', items: { type: 'string' } },
        checks: { type: 'array', items: { type: 'string' } },
        limitations: { type: 'array', items: { type: 'string' } },
    },
};

export function validateResult(value, dispatch, manifest) {
    if (!value || Object.keys(value).some(key => !Object.hasOwn(resultSchema.properties, key))
        || resultSchema.required.some(key => !Object.hasOwn(value, key)) || value.dispatchId !== dispatch.id
        || value.inputDigest !== manifest.digest || !resultSchema.properties.status.enum.includes(value.status)) throw new Error('Invalid or mismatched worker result.');
    for (const key of ['findings', 'changedPaths', 'checks', 'limitations']) {
        if (!Array.isArray(value[key]) || value[key].some(item => typeof item !== 'string')) throw new Error(`Invalid result ${key}.`);
    }
    return value;
}

// --ignore-user-config also drops the user's Windows sandbox setting; without it Codex falls back to a read-only profile
// that can neither read nor write the exported workspace, so the setting is passed explicitly.
function codexWindowsSandbox() {
    return process.platform === 'win32' ? ['-c', 'windows.sandbox="elevated"'] : [];
}

export function commandFor(dispatch, schemaFile) {
    if (!modes.has(dispatch.mode)) throw new Error('Unknown worker mode.');
    if (!['low', 'medium'].includes(dispatch.effort)) throw new Error('Only low/medium effort is allowed.');
    if (dispatch.provider === 'codex') {
        const expected = dispatch.mode === 'scout' ? 'gpt-6-luna' : 'gpt-6-sol';
        if (dispatch.model !== expected || (dispatch.mode !== 'scout' && dispatch.effort !== 'medium')) throw new Error('Disallowed Codex model/effort.');
        return { exe: 'codex', args: ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
            '-s', dispatch.mode === 'implement' && (dispatch.allowedWrites ?? []).length ? 'workspace-write' : 'read-only', ...codexWindowsSandbox(), '-m', dispatch.model,
            '-c', `model_reasoning_effort="${dispatch.effort}"`, '--disable', 'multi_agent',
            '-C', dispatch.workdir, '--output-schema', schemaFile, '--json', '-o', dispatch.outFile, '-'] };
    }
    if (dispatch.provider === 'agy') {
        if (dispatch.mode !== 'scout' || dispatch.model !== `gemini-3.8-flash-${dispatch.effort}`) throw new Error('Antigravity is Flash scouting only.');
        return { exe: 'agy', args: ['--model', dispatch.model, '--effort', dispatch.effort, '--mode', 'plan', '--sandbox',
            '--disable-slash-commands', '--json-schema', schemaFile, '--print'] };
    }
    throw new Error('Subscription runner accepts codex or agy; use the bounded paid adapter for OpenRouter.');
}

function resolveExecutable(command) {
    if (process.platform !== 'win32') return command;
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
        const file = path.join(directory, `${command}.exe`);
        if (fs.existsSync(file)) return file;
    }
    throw new Error(`${command}.exe not found on PATH.`);
}

export function prepareWorker(dispatch) {
    const manifestFile = dispatch.manifestFile ?? `${dispatch.workdir}.manifest.json`;
    if (dispatch.manifestHash && crypto.createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex') !== dispatch.manifestHash) throw new Error('Registered manifest changed.');
    const manifest = loadManifest(manifestFile);
    if (path.resolve(manifest.workspaceRoot) !== path.resolve(dispatch.workdir) || path.resolve(manifest.repositoryRoot) !== path.resolve(dispatch.repoRoot ?? root)) throw new Error('Dispatch snapshot/root mismatch.');
    if (within(root, dispatch.workdir) || within(dispatch.workdir, root)) throw new Error('Worker must be outside the executing checkout.');
    for (const target of [dispatch.promptFile, dispatch.outFile, manifestFile]) {
        if (!target || within(dispatch.workdir, target)) throw new Error('Host prompt, result and manifest must be outside worker directory.');
        noLinks(path.dirname(target), path.basename(target));
    }
    if (!Array.isArray(dispatch.readScope) || !Array.isArray(dispatch.allowedWrites)) throw new Error('Exact scopes required.');
    if (dispatch.mode !== 'implement' && dispatch.allowedWrites.length) throw new Error('Read-only worker cannot own writes.');
    if (!Number.isInteger(dispatch.timeoutMinutes) || dispatch.timeoutMinutes < 1 || dispatch.timeoutMinutes > 30) throw new Error('Timeout must be 1–30 minutes.');
    const initial = inspectDelta(manifest, dispatch.allowedWrites, dispatch.readScope);
    let checkpoint;
    if (initial.operations.length || dispatch.checkpointFile) {
        if (!dispatch.checkpointFile || within(dispatch.workdir, dispatch.checkpointFile) || !/^[a-f0-9]{64}$/i.test(dispatch.checkpointDigest ?? '')) throw new Error('Partial workspace needs a host checkpoint and registered digest.');
        noLinks(path.dirname(dispatch.checkpointFile), path.basename(dispatch.checkpointFile));
        const bytes = fs.readFileSync(dispatch.checkpointFile);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== dispatch.checkpointDigest.toLowerCase()) throw new Error('Host checkpoint changed.');
        checkpoint = JSON.parse(bytes);
        if (checkpoint.inputDigest !== manifest.digest || !checkpoint.actualDelta
            || JSON.stringify(checkpoint.actualDelta) !== JSON.stringify(initial)) throw new Error('Partial delta differs from host checkpoint.');
    }
    for (const file of [dispatch.outFile, `${dispatch.outFile}.log`, `${dispatch.outFile}.err`, `${dispatch.outFile}.host.json`]) {
        if (fs.existsSync(file)) throw new Error(`Refusing to overwrite prior output: ${file}`);
    }
    const task = fs.readFileSync(dispatch.promptFile, 'utf8');
    const envelope = { dispatchId: dispatch.id, logicalJobId: dispatch.logicalJobId, inputDigest: manifest.digest,
        mode: dispatch.mode, readScope: dispatch.readScope, allowedWrites: dispatch.allowedWrites,
        checkpoint: checkpoint ? { dispatchId: checkpoint.dispatchId, status: checkpoint.status, digest: dispatch.checkpointDigest, actualDelta: checkpoint.actualDelta } : null };
    const prompt = `Bounded host assignment:\n${JSON.stringify(envelope)}\n\n${task}\n\nReturn only JSON matching the supplied schema. Findings and tests are evidence inputs; do not claim host acceptance. Do not delegate, use MCP/plugins, inspect home directories, read credentials, install dependencies, invoke external services or mutate outside exact allowedWrites.\n`;
    return { manifest, prompt };
}

function killOwned(child) {
    if (!child.pid) return;
    if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
    } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
}

export function subscriptionEnvironment(environment = process.env) {
    const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'COMSPEC', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'HOMEDRIVE', 'HOMEPATH', 'CODEX_HOME', 'LANG', 'LC_ALL', 'TERM', 'NO_COLOR']);
    return Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key.toUpperCase())));
}

export function cliQuota(stderr, stdout = '') {
    const pattern = /RESOURCE_EXHAUSTED|usage limit|quota exceeded|rate_limit_exceeded/i;
    if (pattern.test(stderr)) return true;
    for (const line of stdout.split(/\r?\n/)) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        const message = event.type === 'error' ? event.message : event.type === 'turn.failed' ? event.error?.message : undefined;
        if (typeof message === 'string' && pattern.test(message)) return true;
    }
    return false;
}

async function execute(command, dispatch, prompt) {
    const logFile = `${dispatch.outFile}.log`; const errFile = `${dispatch.outFile}.err`;
    for (const file of [dispatch.outFile, logFile, errFile]) if (fs.existsSync(file)) throw new Error(`Refusing to overwrite result/log: ${file}`);
    fs.mkdirSync(path.dirname(dispatch.outFile), { recursive: true });
    const log = fs.openSync(logFile, 'wx'); const err = fs.openSync(errFile, 'wx');
    const started = Date.now(); let timedOut = false;
    let exitCode;
    try {
        exitCode = await new Promise((resolve, reject) => {
            const args = dispatch.provider === 'agy' ? [...command.args, prompt] : command.args;
            if (dispatch.provider === 'agy' && prompt.length > 28000) throw new Error('Flash prompt exceeds bounded command-line size.');
            const child = spawn(resolveExecutable(command.exe), args, { cwd: dispatch.workdir, env: subscriptionEnvironment(), shell: false, windowsHide: true,
                detached: process.platform !== 'win32', stdio: ['pipe', log, err] });
            const timer = setTimeout(() => { timedOut = true; killOwned(child); }, dispatch.timeoutMinutes * 60000);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('close', code => { clearTimeout(timer); resolve(code); });
            child.stdin.on('error', () => {});
            child.stdin.end(dispatch.provider === 'agy' ? '' : prompt);
        });
    } finally { fs.closeSync(log); fs.closeSync(err); }
    if (dispatch.provider === 'agy' && !fs.existsSync(dispatch.outFile) && fs.statSync(logFile).size) fs.copyFileSync(logFile, dispatch.outFile);
    const stderr = fs.readFileSync(errFile, 'utf8');
    // Host CLI errors may be stderr or typed JSON events; final model prose never marks a route exhausted.
    const quota = cliQuota(stderr, fs.readFileSync(logFile, 'utf8'));
    return { exitCode, timedOut, quota, seconds: Math.round((Date.now() - started) / 1000), logFile, errFile };
}

export function applyProposedEdits(dispatch, edits) {
    if (!Array.isArray(edits) || (dispatch.mode !== 'implement' && edits.length)) throw new Error('Invalid paid-worker edits.');
    const seen = new Set();
    for (const edit of edits) {
        relativePath(edit.path);
        if (excluded(edit.path) || !dispatch.allowedWrites.includes(edit.path) || seen.has(edit.path)
            || !['write', 'delete'].includes(edit.operation) || (edit.operation === 'write' && typeof edit.content !== 'string')) throw new Error('Paid-worker edit exceeds exact grant.');
        seen.add(edit.path);
        noLinks(dispatch.workdir, edit.path);
        fingerprint(dispatch.workdir, edit.path);
    }
    // Validate the complete proposed operation list before changing the disposable worker copy.
    for (const edit of edits) {
        noLinks(dispatch.workdir, edit.path);
        const target = path.join(dispatch.workdir, edit.path);
        if (edit.operation === 'delete') { if (fs.existsSync(target)) fs.unlinkSync(target); }
        else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, edit.content); }
    }
}

async function executePaid(dispatch, manifest, prompt) {
    const { runOpenRouter, assessActivation } = await import('../../../.claude/scripts/openrouter-worker.mjs');
    const { loadPolicy } = await import('../../../.claude/scripts/workflow-control.mjs');
    const policy = loadPolicy(root);
    if (!policy.openrouter.enabled || dispatch.model !== policy.openrouter.model) throw new Error('Paid fallback is not activated.');
    const commonGit = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const coordinator = fs.realpathSync(path.dirname(commonGit));
    const config = JSON.parse(fs.readFileSync(path.join(coordinator, policy.openrouter.activationFile), 'utf8'));
    config.timeoutSeconds = Math.min(config.timeoutSeconds ?? 1200, dispatch.timeoutMinutes * 60);
    if (!assessActivation({ config }).active) throw new Error('Paid activation evidence unavailable.');
    const files = [];
    for (const relative of new Set([...dispatch.readScope, ...dispatch.allowedWrites])) {
        const state = fingerprint(manifest.workspaceRoot, relative);
        if (state.type === 'absent') { files.push({ path: relative, type: 'absent' }); continue; }
        const bytes = fs.readFileSync(path.join(manifest.workspaceRoot, relative));
        if (bytes.includes(0)) throw new Error('Binary paid-worker inputs require a separately approved bounded adapter.');
        files.push({ path: relative, hash: state.hash, content: bytes.toString('utf8') });
    }
    const paid = await runOpenRouter({ ledgerPath: path.join(coordinator, policy.openrouter.ledgerFile), logicalJobId: dispatch.logicalJobId,
        requestId: dispatch.id, prompt: `${prompt}\nSanitized exact input files:\n${JSON.stringify(files)}`, mode: dispatch.mode, config });
    if (paid.status === 'unavailable') return { exitCode: 1, timedOut: false, quota: false, unavailable: true, activation: paid.activation };
    applyProposedEdits(dispatch, paid.result.edits);
    atomicJson(dispatch.outFile, { dispatchId: dispatch.id, inputDigest: manifest.digest, status: paid.result.status === 'completed' ? 'complete' : paid.result.status,
        findings: paid.result.findings, changedPaths: paid.result.changedPaths, checks: paid.result.checks, limitations: paid.result.limitations });
    return { exitCode: 0, timedOut: false, quota: false, provider: 'openrouter', generationId: paid.generationId, costUSD: paid.costUSD };
}

export async function runRegisteredWorker(dispatchFile, { dryRun = false, mode } = {}) {
    const { validateDispatch, finishDispatch } = await import('../../../.claude/scripts/workflow-control.mjs');
    const raw = JSON.parse(fs.readFileSync(dispatchFile, 'utf8'));
    const validated = await validateDispatch(raw, { root });
    const dispatch = validated ?? raw;
    if (mode && mode !== dispatch.mode) throw new Error('Requested mode differs from registered mode.');
    const { manifest, prompt } = prepareWorker(dispatch);
    const schemaFile = `${dispatchFile}.schema.json`;
    const command = dispatch.provider === 'openrouter' ? { adapter: 'openrouter-worker', model: dispatch.model, attempts: 1, tools: false } : commandFor(dispatch, schemaFile);
    if (dryRun) return { status: 'dry-run', dispatchId: dispatch.id, inputDigest: manifest.digest, command,
        promptHash: crypto.createHash('sha256').update(prompt).digest('hex'), limitation: 'No CLI execution, hook loading, authentication or quota proved.' };
    if (dispatch.provider === 'agy') {
        let receipt;
        try { receipt = JSON.parse(fs.readFileSync(path.join(root, '.claude/scratch/agy-isolation.json'), 'utf8')); } catch {}
        const exeHash = crypto.createHash('sha256').update(fs.readFileSync(resolveExecutable('agy'))).digest('hex');
        const runnerHash = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
        if (receipt?.version !== 1 || receipt.executableHash !== exeHash || receipt.runnerHash !== runnerHash || receipt.noAmbientMcpPlugins !== true
            || !receipt.verifiedBy || !receipt.evidence || Date.parse(receipt.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(receipt.expiresAt))) {
            finishDispatch({ root, id: dispatch.id, status: 'failed', reason: 'unavailable', evidence: 'Agy ambient MCP/plugin isolation not yet independently verified for installed executable. Select next subscription route.' });
            throw new Error('Antigravity ambient MCP/plugin isolation requires a current host verification receipt; route cached unavailable.');
        }
        if (receipt.settings) command.args.push('--settings', JSON.stringify(receipt.settings));
    }
    atomicJson(schemaFile, resultSchema);
    await validateDispatch(dispatch, { root, claim: true });
    let execution;
    try {
        execution = dispatch.provider === 'openrouter' ? await executePaid(dispatch, manifest, prompt) : await execute(command, dispatch, prompt);
    } catch (error) {
        finishDispatch({ root, id: dispatch.id, status: 'failed', reason: 'unavailable', evidence: error.message });
        throw error;
    }
    let delta;
    if (crypto.createHash('sha256').update(fs.readFileSync(dispatch.manifestFile)).digest('hex') !== dispatch.manifestHash) {
        finishDispatch({ root, id: dispatch.id, status: 'failed', reason: 'failed', evidence: 'Registered manifest changed during worker execution.' });
        throw new Error('Registered manifest changed during worker execution.');
    }
    try { delta = inspectDelta(manifest, dispatch.allowedWrites, dispatch.readScope); } catch (error) {
        atomicJson(`${dispatch.outFile}.host.json`, { status: 'rejected-delta', dispatchId: dispatch.id, execution, error: error.message });
        finishDispatch({ root, id: dispatch.id, status: 'failed', reason: 'failed', evidence: `${dispatch.outFile}.host.json` });
        throw error;
    }
    let result; let resultError;
    try { result = validateResult(JSON.parse(fs.readFileSync(dispatch.outFile, 'utf8')), dispatch, manifest); } catch (error) { resultError = error.message; }
    const status = execution.unavailable ? 'unavailable' : execution.timedOut ? 'timeout' : execution.quota ? 'quota' : execution.exitCode !== 0 ? 'failed'
        : resultError ? 'invalid-result' : result.status;
    const host = { status, dispatchId: dispatch.id, inputDigest: manifest.digest, execution, actualDelta: delta,
        workerResult: result, resultError, accepted: false, limitation: 'Host delta is provenance, not independent review or native acceptance.' };
    atomicJson(`${dispatch.outFile}.host.json`, host);
    finishDispatch({ root, id: dispatch.id, status: status === 'complete' ? 'completed' : 'partial',
        reason: status === 'quota' ? 'quota' : status === 'unavailable' ? 'unavailable' : status === 'complete' ? undefined : 'failed', evidence: `${dispatch.outFile}.host.json` });
    return host;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const values = {};
    for (let index = 2; index < process.argv.length; index += 2) values[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];
    try {
        const result = await runRegisteredWorker(values['dispatch-file'], { dryRun: values['dry-run'] === 'true', mode: values.mode });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (!['complete', 'dry-run'].includes(result.status)) process.exitCode = result.status === 'timeout' ? 2 : result.status === 'quota' ? 3 : 1;
    } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
