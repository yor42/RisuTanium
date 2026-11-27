// One-step reset and census helper for the holder of a live Note 9 lease (#846; live-checks "Reset after a lapse"
// and "Census and helper cleanup"; BRIEF-TEMPLATE sections 5, 7 and 8).
//
//   node workflow-device-reset.mjs start --request R --token T [--run DIR] [--stranded PKG1,PKG2] [--apk FILE --apk-sha256 HEX]
//   node workflow-device-reset.mjs end   --request R --token T [--run DIR]
//
// start: census through the guard, class every package, run only the allowed resets, census again, write the evidence
//        file and call lease-reset-done. Any package that cannot be classed stops the run before anything is changed.
// end:   remove leftover dev.risu.* helpers, census, and release with --clean only when that census equals the one
//        `start` recorded. Every other outcome releases WITHOUT --clean (the phone is marked for the next holder's reset).
//
// The only serials this file will drive are the two Note 9 playground phones; the serial comes from the lease grant and
// is checked against NOTE9 here before any call, and every call goes through the guard (adbg), never raw adb.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultRoot, leaseGrant, leaseResetDone, leaseRelease, HELPER_RE, PACKAGE_RE, safeId } from './workflow-control.mjs';

// Mirrors PLAYGROUND_SERIALS in the guard; a test keeps the two in step. No flag or state can widen it.
export const NOTE9 = Object.freeze(['29f3cde9193f7ece', '2ac80128013f7ece']);
const OWN_APP = 'io.github.yor42.risutanium';

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const lines = set => [...set].sort().map(n => `package:${n}\n`).join('');
const stop = (phase, reasons, extra = {}) => ({ status: 'stop', phase, reasons, ...extra });

// The only guard calls this helper may send. Anything else is a bug here, so it throws before reaching the device.
function allowedCall(args) {
  const j = args.join(' ');
  if (j === 'shell pm list packages -3' || j === `shell pm clear ${OWN_APP}`) return true;
  if (args.length === 2 && args[0] === 'uninstall') return HELPER_RE.test(args[1]);
  if (args.length === 3 && args[0] === 'install' && args[1] === '-r') return path.isAbsolute(args[2]);
  return false;
}

// The guard is launched from the checkout this script itself runs from, never from the lease root: the lease root is the
// shared main checkout, whose guard may be older than the helper (#864). A missing file or verb fails here, naming both.
const OWN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function guardRunner(guardRoot = OWN_ROOT, { verbs = [], spawn = spawnSync } = {}) {
  const adbg = path.resolve(guardRoot, 'Agents/Tools/device-guard/adbg.mjs');
  if (!fs.existsSync(adbg)) throw Error(`Device guard not found at ${adbg}; the helper never falls back to raw adb`);
  const source = fs.readFileSync(adbg, 'utf8');
  for (const verb of verbs) if (!source.includes(`'${verb}'`)) throw Error(`Device guard at ${adbg} has no '${verb}' verb; update that checkout before running the helper`);
  return argv => {
    const r = spawn(process.execPath, [adbg, ...argv], { encoding: 'utf8', windowsHide: true, timeout: 600000 });
    return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}

function makeContext({ root, request, token, run, guard }) {
  safeId(request);
  const grant = leaseGrant({ root, request, token });
  if (grant.pool !== 'note9' || !NOTE9.includes(grant.serial) || grant.member !== `device:${grant.serial}`) throw Error('The lease does not name a Note 9 playground phone; the helper touches nothing else');
  const tmp = path.resolve(os.tmpdir());
  const runDir = path.resolve(run ?? path.join(tmp, `risu-reset-${request}`));
  const rel = path.relative(tmp, runDir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('The run folder must be a folder under %TEMP%');
  fs.mkdirSync(runDir, { recursive: true });
  const log = path.join(runDir, 'adb-commands.log');
  const commands = [];
  const adb = (...args) => {
    if (!allowedCall(args)) throw Error(`Refusing a call outside the helper's list: ${args[0]}`);
    const r = guard(['--serial', grant.serial, '--log', log, '--', ...args]);
    commands.push({ cmd: args.join(' '), code: r.code });
    return r;
  };
  return { root, request, token, grant, serial: grant.serial, runDir, log, adb, commands, guard };
}

function census(ctx, label) {
  const r = ctx.adb('shell', 'pm', 'list', 'packages', '-3');
  if (r.code !== 0) return { error: `${label} census failed with exit ${r.code}` };
  const names = new Set();
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^package:([^\s=]+)$/.exec(line.trim());
    if (!m || !PACKAGE_RE.test(m[1])) return { error: `${label} census has an unreadable line` };
    names.add(m[1]);
  }
  if (!names.size) return { error: `${label} census is empty` };
  return { names };
}

// Standing, stranded, keep-helper, helper, passed-through stranded, or stop: the order and meaning are the doc's.
export function classify(name, grant, strandedArg = []) {
  if (grant.standingPackages.includes(name)) return 'standing';
  if (grant.strandedPackages.includes(name)) return 'stranded';
  if (grant.keepHelpers.includes(name)) return 'keep-helper';
  if (HELPER_RE.test(name)) return 'helper';
  if (strandedArg.includes(name)) return 'stranded-new';
  return 'stop';
}

function strandedNames(grant, value) {
  const names = value ? value.split(',').filter(Boolean) : [];
  for (const n of names) if (!PACKAGE_RE.test(n) || HELPER_RE.test(n) || n.startsWith('io.github.yor42.') || grant.standingPackages.includes(n)) throw Error(`Cannot mark ${n} stranded`);
  return [...new Set(names)];
}

function writeFile(ctx, name, text) { const file = path.join(ctx.runDir, name); fs.writeFileSync(file, text); return file; }
function evidenceText(ctx, title, rows, outcome) {
  return [`# ${title}`, '', `serial: ${ctx.serial}`, `request: ${ctx.request}`, '', '## Packages', ...rows.map(r => `- ${r.name}: ${r.cls}${r.action ? `, ${r.action}` : ''}`), '', '## Guard calls', ...ctx.commands.map(c => `- ${c.cmd} (exit ${c.code})`), '', `## Outcome`, outcome, ''].join('\n');
}

function removeHelpers(ctx, names) {
  const removed = [];
  for (const name of names) {
    const r = ctx.adb('uninstall', name);
    if (r.code !== 0) return { failed: name, removed };
    removed.push(name);
  }
  return { removed };
}

export function resetStart({ root = defaultRoot, request, token, run, stranded, apk, apkSha256, spawn, guard = guardRunner(OWN_ROOT, { verbs: apk !== undefined ? ['apk-readback'] : [], spawn }) }) {
  const ctx = makeContext({ root, request, token, run, guard });
  const { grant } = ctx;
  const strandedArg = strandedNames(grant, stranded);
  if ((apk === undefined) !== (apkSha256 === undefined)) throw Error('--apk and --apk-sha256 go together');
  if (apk !== undefined) {
    if (!path.isAbsolute(apk) || !fs.existsSync(apk) || !fs.statSync(apk).isFile()) throw Error('--apk must be an existing absolute file');
    if (!/^[0-9a-f]{64}$/i.test(apkSha256) || sha256File(apk).toLowerCase() !== apkSha256.toLowerCase()) throw Error('--apk does not match --apk-sha256');
  }
  const pre = census(ctx, 'start');
  const fail = (reasons, rows = []) => {
    const evidence = writeFile(ctx, 'reset-start-evidence.md', evidenceText(ctx, 'Reset start: STOP', rows, `STOP: ${reasons.join('; ')}\nNothing was marked done. Release WITHOUT --clean and hand back.`));
    return stop('start', reasons, { evidence });
  };
  if (pre.error) return fail([pre.error]);
  writeFile(ctx, 'census-pre.txt', lines(pre.names));
  const rows = [...pre.names].map(name => ({ name, cls: classify(name, grant, strandedArg) }));
  const unknown = rows.filter(r => r.cls === 'stop').map(r => r.name);
  if (unknown.length) return fail([`unclassed package(s): ${unknown.join(', ')}`], rows);
  const missing = strandedArg.filter(n => !pre.names.has(n));
  if (missing.length) return fail([`--stranded names not in the census: ${missing.join(', ')}`], rows);
  // From here on the device is changed, and only by the allowed resets.
  if (grant.resetRequired) {
    const r = ctx.adb('shell', 'pm', 'clear', OWN_APP);
    if (r.code !== 0) return fail([`pm clear ${OWN_APP} failed with exit ${r.code}`], rows);
  }
  const helpers = rows.filter(r => r.cls === 'helper');
  const gone = removeHelpers(ctx, helpers.map(h => h.name));
  for (const h of helpers) h.action = gone.removed.includes(h.name) ? 'uninstalled' : 'uninstall failed';
  if (gone.failed) return fail([`uninstall ${gone.failed} failed`], rows);
  if (apk !== undefined) {
    const inst = ctx.adb('install', '-r', apk);
    if (inst.code !== 0) return fail([`install -r returned exit ${inst.code}; a signer mismatch is the PR session's call under the device-run rules, never this helper's`], rows);
    const back = ctx.guard(['apk-readback', '--serial', ctx.serial, '--log', ctx.log, '--expect-sha256', apkSha256]);
    ctx.commands.push({ cmd: 'apk-readback', code: back.code });
    if (back.code !== 0) return fail([`apk-readback failed with exit ${back.code}`], rows);
  }
  const post = census(ctx, 'post-reset');
  if (post.error) return fail([post.error], rows);
  const expected = new Set([...pre.names].filter(n => !helpers.some(h => h.name === n)));
  const post2 = [...post.names].sort().join('\n'); const exp2 = [...expected].sort().join('\n');
  if (post2 !== exp2) return fail(['the census after the resets differs from what the resets should leave'], rows);
  const startCensus = writeFile(ctx, 'census-start.txt', lines(post.names));
  writeFile(ctx, 'reset-state.json', JSON.stringify({ request, serial: ctx.serial, baseline: [...post.names].sort() }));
  const evidence = writeFile(ctx, 'reset-start-evidence.md', evidenceText(ctx, 'Reset start', rows, `Baseline census: ${startCensus}`));
  let resetDone = false;
  if (grant.resetRequired || strandedArg.length) { leaseResetDone({ root, request, token, evidence, stranded: strandedArg.join(',') || undefined }); resetDone = true; }
  return { status: 'ok', phase: 'start', serial: ctx.serial, resetDone, census: startCensus, evidence, removedHelpers: gone.removed, stranded: strandedArg };
}

export function resetEnd({ root = defaultRoot, request, token, run, spawn, guard = guardRunner(OWN_ROOT, { spawn }) }) {
  const ctx = makeContext({ root, request, token, run, guard });
  const { grant } = ctx;
  const finish = (reasons, rows = []) => {
    const evidence = writeFile(ctx, 'reset-end-evidence.md', evidenceText(ctx, 'Reset end: not clean', rows, `NOT CLEAN: ${reasons.join('; ')}\nReleased without --clean; the next holder owes a reset.`));
    const rel = leaseRelease({ root, request, token });
    return stop('end', reasons, { evidence, released: rel.status, needsReset: rel.needsReset });
  };
  if (grant.resetRequired) return finish(['the lease still owes its reset: run start first']);
  let baseline;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(ctx.runDir, 'reset-state.json'), 'utf8'));
    if (st.request !== request || st.serial !== ctx.serial || !Array.isArray(st.baseline)) throw Error('mismatch');
    baseline = new Set(st.baseline);
  } catch { return finish(['no start baseline for this request and phone in the run folder']); }
  const first = census(ctx, 'end');
  if (first.error) return finish([first.error]);
  const rows = [...first.names].map(name => ({ name, cls: classify(name, grant) }));
  const unknown = rows.filter(r => r.cls === 'stop').map(r => r.name);
  if (unknown.length) return finish([`unclassed package(s): ${unknown.join(', ')}`], rows);
  const helpers = rows.filter(r => r.cls === 'helper');
  const gone = removeHelpers(ctx, helpers.map(h => h.name));
  for (const h of helpers) h.action = gone.removed.includes(h.name) ? 'uninstalled' : 'uninstall failed';
  if (gone.failed) return finish([`uninstall ${gone.failed} failed`], rows);
  const end = census(ctx, 'final');
  if (end.error) return finish([end.error], rows);
  const endFile = writeFile(ctx, 'census-end.txt', lines(end.names));
  const extra = [...end.names].filter(n => !baseline.has(n)); const lost = [...baseline].filter(n => !end.names.has(n));
  if (extra.length || lost.length) return finish([`the end census differs from the start census (extra: ${extra.join(', ') || 'none'}; missing: ${lost.join(', ') || 'none'})`], rows);
  const evidence = writeFile(ctx, 'reset-end-evidence.md', evidenceText(ctx, 'Reset end', rows, `End census equals the start census: ${endFile}`));
  const rel = leaseRelease({ root, request, token, clean: endFile });
  return { status: 'ok', phase: 'end', serial: ctx.serial, census: endFile, evidence, released: rel.status, needsReset: rel.needsReset, removedHelpers: gone.removed };
}

function parse(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith('--') || args[i + 1] == null) throw Error('Expected --key value'); out[args[i].slice(2)] = args[i + 1]; }
  return out;
}
export function main(args = process.argv.slice(2)) {
  const [phase, ...rest] = args; const a = parse(rest); const root = a.root ? path.resolve(a.root) : defaultRoot;
  if (phase === 'start') return resetStart({ root, request: a.request, token: a.token, run: a.run, stranded: a.stranded, apk: a.apk, apkSha256: a['apk-sha256'] });
  if (phase === 'end') return resetEnd({ root, request: a.request, token: a.token, run: a.run });
  return { usage: ['start --request R --token T [--run DIR] [--stranded PKG1,PKG2] [--apk FILE --apk-sha256 HEX]', 'end --request R --token T [--run DIR]'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const out = main();
    console.log(JSON.stringify(out, null, 2));
    if (out.status === 'stop') { console.error(`STOP: ${out.reasons.join('; ')}`); process.exitCode = 3; }
  } catch (error) { console.error(`Reset helper blocked: ${error.message}`); process.exitCode = 1; }
}
