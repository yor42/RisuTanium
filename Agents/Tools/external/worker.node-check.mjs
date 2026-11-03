import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandFor, resultSchema, validateResult, applyProposedEdits, subscriptionEnvironment, cliQuota } from './worker.mjs';

test('Codex model, effort, sandbox and ambient configuration are pinned per mode', () => {
    const base = { provider: 'codex', workdir: 'C:/fixture/workspace with spaces', outFile: 'C:/host/result.json', effort: 'medium', allowedWrites: ['a.ts'] };
    for (const mode of ['scout', 'implement', 'review']) {
        const model = mode === 'scout' ? 'gpt-6-luna' : 'gpt-6-sol';
        const command = commandFor({ ...base, mode, model }, 'C:/host/schema with spaces.json');
        assert.ok(command.args.includes('--ignore-user-config')); assert.ok(command.args.includes('--ignore-rules'));
        assert.ok(command.args.includes('--ephemeral')); assert.ok(command.args.includes('--output-schema'));
        assert.ok(!command.args.includes('--worktree')); assert.ok(!command.args.includes('--dangerously-bypass-approvals-and-sandbox'));
        assert.equal(command.args[command.args.indexOf('-s') + 1], mode === 'implement' ? 'workspace-write' : 'read-only');
        assert.equal(command.args.includes('windows.sandbox="elevated"'), process.platform === 'win32');
        assert.equal(command.args[command.args.indexOf('-C') + 1], base.workdir);
    }
    assert.throws(() => commandFor({ ...base, mode: 'implement', model: 'gpt-6.1-sol' }, 'schema'), /model/);
    assert.throws(() => commandFor({ ...base, mode: 'implement', model: 'gpt-6-sol', effort: 'high' }, 'schema'), /effort/);
});

test('Flash stays read-only lower-tier scouting, paid models cannot enter subscription runner', () => {
    const base = { provider: 'agy', mode: 'scout', model: 'gemini-3.8-flash-low', effort: 'low' };
    const command = commandFor(base, 'schema');
    assert.ok(command.args.includes('--sandbox')); assert.ok(command.args.includes('--disable-slash-commands'));
    assert.equal(command.args[command.args.indexOf('--mode') + 1], 'plan');
    assert.throws(() => commandFor({ ...base, mode: 'implement' }, 'schema'), /scouting/);
    assert.throws(() => commandFor({ ...base, model: 'gemini-4-argon-low' }, 'schema'), /scouting/);
    assert.throws(() => commandFor({ ...base, provider: 'openrouter' }, 'schema'), /bounded paid adapter/);
});
test('text-only Sol authoring is read-only and subscription processes receive no API billing environment', () => {
    const command = commandFor({ provider: 'codex', mode: 'implement', model: 'gpt-6-sol', effort: 'medium', allowedWrites: [], workdir: 'fixture', outFile: 'answer' }, 'schema');
    assert.equal(command.args[command.args.indexOf('-s') + 1], 'read-only');
    assert.deepEqual(subscriptionEnvironment({ Path: 'tools', USERPROFILE: 'profile', OPENAI_API_KEY: 'fixture-only', ANTHROPIC_API_KEY: 'fixture-only', OPENROUTER_API_KEY: 'fixture-only', GEMINI_API_KEY: 'fixture-only', CODEX_API_KEY: 'fixture-only', ANTHROPIC_BASE_URL: 'fixture-only' }), { Path: 'tools', USERPROFILE: 'profile' });
});
test('host CLI errors on JSON stdout detect quota without trusting agent prose', () => {
    assert.equal(cliQuota('', JSON.stringify({ type: 'error', message: 'You hit your usage limit' })), true);
    assert.equal(cliQuota('', JSON.stringify({ type: 'turn.failed', error: { message: 'quota exceeded' } })), true);
    assert.equal(cliQuota('', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'quota exceeded' } })), false);
});

test('result schema identity and claims cannot substitute host provenance', () => {
    const result = { dispatchId: 'one', inputDigest: 'digest', status: 'complete', findings: [], changedPaths: [], checks: [], limitations: [] };
    assert.equal(validateResult(result, { id: 'one' }, { digest: 'digest' }), result);
    for (const changed of [{ dispatchId: 'wrong' }, { inputDigest: 'wrong' }, { status: 'approved' }, { accepted: true }, { checks: [true] }]) {
        assert.throws(() => validateResult({ ...result, ...changed }, { id: 'one' }, { digest: 'digest' }));
    }
    assert.equal(resultSchema.additionalProperties, false);
});

test('paid edits are exact, validated as a whole and never applied to main checkout by the adapter', t => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-paid-edits-'));
    t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(workdir, 'a.ts'), 'before');
    const dispatch = { mode: 'implement', workdir, allowedWrites: ['a.ts'] };
    assert.throws(() => applyProposedEdits(dispatch, [{ path: 'a.ts', operation: 'write', content: 'after' }, { path: '../escape', operation: 'write', content: 'bad' }]));
    assert.equal(fs.readFileSync(path.join(workdir, 'a.ts'), 'utf8'), 'before');
    assert.throws(() => applyProposedEdits({ ...dispatch, mode: 'review' }, [{ path: 'a.ts', operation: 'delete' }]));
    assert.throws(() => applyProposedEdits(dispatch, [{ path: 'a.ts', operation: 'delete' }, { path: 'a.ts', operation: 'write', content: 'dup' }]));
    applyProposedEdits(dispatch, [{ path: 'a.ts', operation: 'write', content: 'after\r\n' }]);
    assert.equal(fs.readFileSync(path.join(workdir, 'a.ts'), 'utf8'), 'after\r\n');
});
