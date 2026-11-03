import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { exportSnapshot, loadManifest, inspectDelta, prepareIntegration, applyIntegration, recoverIntegration,
    reconcileIntegration, atomicJson, fingerprint, relativePath } from './workspace.mjs';
import { prepareWorker } from './worker.mjs';
import crypto from 'node:crypto';

function fixture(t) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-workspace-'));
    const repo = path.join(temp, 'repo'); const dest = path.join(temp, 'worker');
    fs.mkdirSync(repo);
    const git = args => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git(['init', '-q']);
    const put = (name, value) => { fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true }); fs.writeFileSync(path.join(repo, name), value); };
    put('src/a.ts', 'original\r\n'); put('src/b.ts', 'b\n'); put('src/helper.ts', 'helper\n'); put('README.md', 'reference\n');
    git(['add', 'src/a.ts', 'src/b.ts', 'src/helper.ts', 'README.md']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const exportIt = (extras = []) => exportSnapshot({ repo, dest, extras });
    return { temp, repo, dest, git, put, exportIt, manifestFile: `${dest}.manifest.json`, journalFile: path.join(temp, 'journal.json') };
}

test('snapshot preserves dirty tracked, deletions and only named untracked relative paths', t => {
    const f = fixture(t);
    f.put('src/a.ts', 'dirty\r\n'); fs.unlinkSync(path.join(f.repo, 'src/b.ts'));
    f.put('notes/sub/named.md', 'named'); f.put('notes/secret-other.md', 'not named');
    f.exportIt(['notes/sub/named.md']);
    const m = loadManifest(f.manifestFile);
    assert.equal(fs.readFileSync(path.join(f.dest, 'src/a.ts'), 'utf8'), 'dirty\r\n');
    assert.equal(m.entries['src/b.ts'].type, 'absent');
    assert.equal(fs.existsSync(path.join(f.dest, 'notes/secret-other.md')), false);
    assert.equal(fs.readFileSync(path.join(f.dest, 'notes/sub/named.md'), 'utf8'), 'named');
    assert.equal(inspectDelta(m, [], ['src/a.ts']).operations.length, 0);
});
test('removed worker instructions and a source-root junction fail closed', t => {
    const f = fixture(t); f.exportIt();
    fs.unlinkSync(path.join(f.dest, 'AGENTS.md'));
    assert.throws(() => inspectDelta(loadManifest(f.manifestFile), [], []), /instructions changed or missing/);
    const alias = path.join(f.temp, 'alias'); fs.symlinkSync(f.repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => exportSnapshot({ repo: alias, dest: path.join(f.temp, 'other-worker') }), /Link\/reparse/);
});

test('secret, protected and ambient instructions are excluded before content reads', t => {
    const f = fixture(t);
    const forbidden = ['src-tauri/key.txt', '.env.local', 'keystore.properties', 'x/test.jks', '.claude/settings.json',
        'AGENTS.md', 'nested/CLAUDE.md', '.codex/config.toml', 'Agents/Evidences of Investigations/Community plugins to solve common pain points/a.js'];
    for (const relative of forbidden) f.put(relative, 'synthetic excluded fixture');
    f.git(['add', '-f', ...forbidden]);
    const read = fs.readFileSync;
    fs.readFileSync = function (file, ...args) {
        if (typeof file === 'string' && forbidden.some(relative => path.resolve(file) === path.join(f.repo, relative))) throw Error('Forbidden content read');
        return read.call(this, file, ...args);
    };
    try { f.exportIt(); } finally { fs.readFileSync = read; }
    for (const relative of forbidden.filter(name => name !== 'AGENTS.md')) assert.equal(fs.existsSync(path.join(f.dest, relative)), false);
    assert.match(fs.readFileSync(path.join(f.dest, 'AGENTS.md'), 'utf8'), /Bounded external worker/);
});

test('exports reject traversal, root overlap, protected extras and link ancestors', t => {
    const f = fixture(t);
    assert.throws(() => exportSnapshot({ repo: f.repo, dest: path.join(f.repo, 'copy') }), /outside/);
    assert.throws(() => f.exportIt(['../outside']), /Unsafe/);
    assert.throws(() => f.exportIt(['src-tauri/key.txt']), /Forbidden/);
    const link = path.join(f.temp, 'linked');
    fs.symlinkSync(f.repo, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => exportSnapshot({ repo: f.repo, dest: path.join(link, 'worker') }), /Link/);
    for (const value of ['/abs', 'x/../a', 'x\\a', 'x:y', 'x/*', 'x/?', 'x/./a', 'x\0y']) assert.throws(() => relativePath(value));
});

test('host observes actual unexpected worker writes, deletes, instruction edits and link output', t => {
    const f = fixture(t); f.exportIt(); const m = loadManifest(f.manifestFile);
    fs.writeFileSync(path.join(f.dest, 'src/a.ts'), 'worker');
    assert.throws(() => inspectDelta(m, [], []), /Unexpected|instructions changed or missing/);
    fs.unlinkSync(path.join(f.dest, 'src/b.ts'));
    assert.throws(() => inspectDelta(m, ['src/a.ts'], []), /Unexpected/);
    const delta = inspectDelta(m, ['src/a.ts', 'src/b.ts'], ['src/helper.ts']);
    assert.equal(delta.operations.length, 2);
    const instructionBytes = fs.readFileSync(path.join(f.dest, 'AGENTS.md'));
    fs.writeFileSync(path.join(f.dest, 'AGENTS.md'), 'malicious instructions');
    assert.throws(() => inspectDelta(m, ['src/a.ts', 'src/b.ts'], []), /instructions changed or missing/);
    fs.writeFileSync(path.join(f.dest, 'AGENTS.md'), instructionBytes);
    fs.symlinkSync(f.repo, path.join(f.dest, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => inspectDelta(m, ['src/a.ts', 'src/b.ts'], []), /link/i);
});

test('relevant helper invalidates applicability; unrelated README change does not', t => {
    const f = fixture(t); f.exportIt(); const m = loadManifest(f.manifestFile);
    f.put('README.md', 'unrelated');
    assert.equal(inspectDelta(m, ['src/a.ts'], ['src/helper.ts']).operations.length, 0);
    f.put('src/helper.ts', 'changed helper');
    assert.throws(() => inspectDelta(m, ['src/a.ts'], ['src/helper.ts']), /dependency changed/);
});

test('integration retains payload and preimages, applies exact delta without acceptance then reconciles', t => {
    const f = fixture(t); f.exportIt();
    fs.writeFileSync(path.join(f.dest, 'src/a.ts'), 'after\r\n');
    fs.unlinkSync(path.join(f.dest, 'src/b.ts'));
    const prepared = prepareIntegration({ manifestFile: f.manifestFile, journalFile: f.journalFile, allowedWrites: ['src/a.ts', 'src/b.ts'], readScope: ['src/helper.ts'], dispatchId: 'fixture' });
    assert.equal(prepared.state, 'prepared'); assert.equal(prepared.operations.length, 2);
    assert.equal(fs.readFileSync(path.join(f.repo, 'src/a.ts'), 'utf8'), 'original\r\n');
    const applied = applyIntegration(f.journalFile);
    assert.equal(applied.state, 'applied-without-acceptance');
    assert.equal(fs.readFileSync(path.join(f.repo, 'src/a.ts'), 'utf8'), 'after\r\n');
    assert.equal(fs.existsSync(path.join(f.repo, 'src/b.ts')), false);
    assert.throws(() => reconcileIntegration(f.journalFile, ''), /receipt/);
    assert.equal(reconcileIntegration(f.journalFile, 'independent-fixture-verdict').state, 'reconciled');
});

test('changed destination and retained payload refuse mutation and preserve unowned data', t => {
    const f = fixture(t); f.exportIt(); fs.writeFileSync(path.join(f.dest, 'src/a.ts'), 'after');
    const journal = prepareIntegration({ manifestFile: f.manifestFile, journalFile: f.journalFile, allowedWrites: ['src/a.ts'], readScope: [], dispatchId: 'fixture' });
    f.put('src/a.ts', 'unowned');
    assert.throws(() => applyIntegration(f.journalFile), /conflict/);
    assert.equal(fs.readFileSync(path.join(f.repo, 'src/a.ts'), 'utf8'), 'unowned');
    f.put('src/a.ts', 'original\r\n'); fs.writeFileSync(journal.operations[0].payload, 'tampered');
    assert.throws(() => applyIntegration(f.journalFile), /payload changed/);
    assert.equal(fs.readFileSync(path.join(f.repo, 'src/a.ts'), 'utf8'), 'original\r\n');
});

test('interrupted multi-file integration classifies result, pending, conflict and needs explicit recovery', t => {
    const f = fixture(t); f.exportIt();
    fs.writeFileSync(path.join(f.dest, 'src/a.ts'), 'after a'); fs.writeFileSync(path.join(f.dest, 'src/b.ts'), 'after b');
    const journal = prepareIntegration({ manifestFile: f.manifestFile, journalFile: f.journalFile, allowedWrites: ['src/a.ts', 'src/b.ts'], readScope: ['src/helper.ts'], dispatchId: 'fixture' });
    journal.state = 'applying'; atomicJson(f.journalFile, journal); f.put('src/a.ts', 'after a');
    assert.deepEqual(recoverIntegration(f.journalFile).observations.map(item => item.disposition), ['result', 'pending']);
    assert.throws(() => applyIntegration(f.journalFile), /explicit recovery/);
    f.put('src/b.ts', 'unowned');
    assert.equal(recoverIntegration(f.journalFile).observations[1].disposition, 'conflict');
    assert.throws(() => applyIntegration(f.journalFile, { recover: true, disposition: 'inspected files' }), /conflict/);
    f.put('src/b.ts', 'b\n');
    assert.equal(applyIntegration(f.journalFile, { recover: true, disposition: 'host inspected pre/post and dependency hashes' }).state, 'applied-without-acceptance');
    assert.equal(fingerprint(f.repo, 'src/a.ts').hash, journal.operations[0].after.hash);
});

test('provider continuation retains partial workspace and original integration preimages with exact host checkpoint', t => {
    const f = fixture(t); f.exportIt(); const manifest = loadManifest(f.manifestFile);
    fs.writeFileSync(path.join(f.dest, 'src/a.ts'), 'partial first-provider edit');
    const promptFile = path.join(f.temp, 'next-prompt.md'); fs.writeFileSync(promptFile, 'Finish pending helper correction only.');
    const dispatch = { id: 'continuation', logicalJobId: 'same-stage', repoRoot: f.repo, workdir: f.dest, manifestFile: f.manifestFile,
        promptFile, outFile: path.join(f.temp, 'next-result.json'), mode: 'implement', allowedWrites: ['src/a.ts'], readScope: ['src/helper.ts'], timeoutMinutes: 20 };
    assert.throws(() => prepareWorker(dispatch), /checkpoint/);
    const checkpointFile = path.join(f.temp, 'prior-result.host.json');
    atomicJson(checkpointFile, { status: 'quota', dispatchId: 'prior', inputDigest: manifest.digest,
        actualDelta: inspectDelta(manifest, dispatch.allowedWrites, dispatch.readScope), accepted: false });
    const checkpointDigest = crypto.createHash('sha256').update(fs.readFileSync(checkpointFile)).digest('hex');
    const ready = prepareWorker({ ...dispatch, checkpointFile, checkpointDigest });
    assert.match(ready.prompt, /prior/);
    assert.equal(ready.manifest.entries['src/a.ts'].hash, fingerprint(f.repo, 'src/a.ts').hash);
    fs.writeFileSync(path.join(f.dest, 'src/a.ts'), 'unverified changed partial');
    assert.throws(() => prepareWorker({ ...dispatch, checkpointFile, checkpointDigest }), /differs from host checkpoint/);
});
