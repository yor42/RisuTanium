import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { registerDispatch } from './workflow-control.mjs';

// Synthetic local messages exercise the installed Claude hook engine without provider inference.
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = fs.mkdtempSync(path.join(process.env.RISU_SMOKE_ROOT ?? os.tmpdir(), 'risu-native-hook-'));
const scripts = path.join(fixture, '.claude/scripts'); fs.mkdirSync(scripts, { recursive: true }); fs.mkdirSync(path.join(fixture, 'Agents'));
for (const name of ['workflow-control.mjs', 'workflow-hook.ps1']) fs.copyFileSync(path.join(source, '.claude/scripts', name), path.join(scripts, name));
fs.copyFileSync(path.join(source, '.claude/workflow-policy.json'), path.join(fixture, '.claude/workflow-policy.json'));
const state = JSON.parse(fs.readFileSync(path.join(source, 'Agents/Workflow-State.json')));
Object.assign(state, { activation: 'active', activeRevision: state.policyRevision, jobs: {}, dispatches: {}, routeHealth: {} });
state.routeHealth = { agy: { reason: 'fixture', resetAt: null }, codex: { reason: 'fixture', resetAt: null } };
fs.writeFileSync(path.join(fixture, 'Agents/Workflow-State.json'), JSON.stringify(state));
await registerDispatch({ id: 'fixture-native', logicalJobId: 'fixture-scout', mode: 'scout', role: 'investigator', question: 'Return fixture completion', acceptance: ['Synthetic only'], owner: 'fixture-child', inputIdentity: 'synthetic', readScope: [], allowedWrites: [] }, { root: fixture });
const broken = process.env.RISU_SMOKE_BROKEN_HOOK === '1';
const command = '$ErrorActionPreference = "Stop"; & "$env:CLAUDE_PROJECT_DIR\\.claude\\scripts\\workflow-hook.ps1"; exit $LASTEXITCODE';
const hook = { type: 'command', command, shell: 'powershell', timeout: 10, onFailure: 'block' };
const settings = { model: 'sonnet', hooks: { SessionStart: [{ hooks: [hook] }], PreToolUse: [{ matcher: 'Agent', hooks: [hook] }] }, enabledPlugins: { 'cheapag@cheapag': false }, permissions: { allow: ['Agent'] } };
if (broken) settings.hooks.PreToolUse[0].hooks[0] = { ...hook, command: command.replace('workflow-hook.ps1', 'missing-hook.ps1') };
fs.writeFileSync(path.join(fixture, '.claude/settings.json'), JSON.stringify(settings));
fs.writeFileSync(path.join(fixture, 'empty-mcp.json'), '{"mcpServers":{}}');
const requests = [];
let turn = 0;
function message(content, stop) { return { id: `msg_fixture_${turn}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }; }
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  let body; try { body = JSON.parse(raw); } catch { body = {}; }
  if (req.url.includes('count_tokens')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"input_tokens":10}'); }
  if (!req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end(); }
  requests.push(body); turn++;
  const content = turn <= 2 ? [{ type: 'tool_use', id: `tool_fixture_${turn}`, name: 'Agent', input: { subagent_type: 'investigator', description: 'Synthetic bounded delegation', prompt: turn === 1 ? 'Unregistered fixture should be denied.' : '[workflow-dispatch:fixture-native] Return synthetic completion.' } }] : [{ type: 'text', text: 'SYNTHETIC_HOOK_SMOKE_COMPLETE' }];
  const msg = message(content, turn <= 2 ? 'tool_use' : 'end_turn');
  if (!body.stream) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(msg)); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  emit('message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null } });
  content.forEach((block, index) => {
    emit('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
    emit('content_block_delta', { type: 'content_block_delta', index, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    emit('content_block_stop', { type: 'content_block_stop', index });
  });
  emit('message_delta', { type: 'message_delta', delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } }); emit('message_stop', { type: 'message_stop' }); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const exe = process.env.CLAUDE_SMOKE_EXE ?? path.join(os.homedir(), '.local/bin/claude.exe');
  const args = ['--print', '--model', 'sonnet', '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', path.join(fixture, 'empty-mcp.json'), '--tools', 'Agent', '--allowedTools', 'Agent', '--agents', JSON.stringify({ investigator: { description: 'Synthetic fixture worker', prompt: 'Return synthetic completion.', tools: [], model: 'sonnet' } }), '--output-format', 'json', '--debug-file', path.join(fixture, 'native.log'), 'Run the synthetic hook check.'];
  const env = { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: 'synthetic-local-fixture', CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_PROJECT_DIR: fixture };
  delete env.CLAUDECODE;
  const child = spawn(exe, args, { cwd: fixture, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
  const timer = setTimeout(() => child.kill(), 45000);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); clearTimeout(timer);
  fs.writeFileSync(path.join(fixture, 'cli-output.txt'), stdout + '\n' + stderr);
  const debug = fs.existsSync(path.join(fixture, 'native.log')) ? fs.readFileSync(path.join(fixture, 'native.log'), 'utf8') : '';
  const transcript = JSON.stringify(requests);
  assert.equal(code, 0, `CLI failed; inspect synthetic fixture ${fixture}`);
  assert.ok(broken ? /blocking.*onFailure/.test(debug) : transcript.includes('Register bounded dispatch first'), `No actual Agent hook denial found; inspect ${fixture}`);
  assert.ok(transcript.includes('Workflow 2026-11-03.1'), `No actual SessionStart context found; inspect ${fixture}`);
  assert.ok(stdout.includes('SYNTHETIC_HOOK_SMOKE_COMPLETE'), `No synthetic completion; inspect ${fixture}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'Agents/Workflow-State.json'))).dispatches['fixture-native'].status, broken ? 'registered' : 'running', 'Registered native Agent admission differed');
  console.log(JSON.stringify({ status: 'PASS', scenario: broken ? 'missing hook fails closed' : 'normal allow/deny', claudeRuntime: 'installed CLI', fixture, messages: requests.length, checks: broken ? ['Missing command blocked by actual runtime onFailure:block', 'SessionStart context injected'] : ['SessionStart context in actual runtime', 'PreToolUse Agent unregistered denial', 'Registered native Agent admitted exactly once', 'Synthetic continuation after denial'], limitations: ['Local fake API, no provider inference or quota evidence; CLI displayed costs are synthetic', 'No Desktop UI evidence', 'Compaction context separately exercised with deterministic hook fixtures'] }, null, 2));
} finally { await new Promise(resolve => server.close(resolve)); }
