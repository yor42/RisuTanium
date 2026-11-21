// The S0 gate. One attempt for one builder: sample the four gate cells under the stop rule, evaluate the validity controls
// on every cell's final sample, and only then compute the verdict. A confirmed control failure makes the attempt an
// INVALID EXPERIMENT: nothing the engine arm produced is written, printed or returned, and the ledger records the controls.
//
//   node Agents/Tools/ltm-eval/s0/gate.mjs --draw 610001 --settings <out>/settings-rare.json --real-agg <aggregates> <outDir>
//   gate.mjs record-settings --builder <b> --settings <file> --ledger <file>   (the orchestrator, before any attempt)
//   gate.mjs record-defect --builder <b> --reproducer <test id> --gate2 <verdict path> --ledger <file>
//   gate.mjs record-override --builder <b> --settings <new settings> --draw <fresh seed> --cap <chats> --ref <MC id> --ledger <file>
//       (the maintainer's larger run after an INCONCLUSIVE stop; then gate.mjs --kind OVERRIDE --draw <that seed> ...)
//   gate.mjs verdict --builder <b> --ledger <file>   (prints a recorded verdict; refuses an INVALID attempt)
// The ledger is --ledger, else the fixed default (defaultLedgerPath), never a path derived from the out dir.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FAMILIES, SEED_OF, VERDICT_BUILDER, appendDefect, appendOverride, builderState, loadLedger, recordSettings, saveLedger, tryAttempt, checkAttempt } from './attempts.mjs';
import { controlTests, controlsRecord, donorEntry, pickDonor } from './controls.mjs';
import { SEEDS, assertSeedsDisjoint, drawWithReserve } from './corpus.mjs';
import { loadCounter } from './counter.mjs';
import { realProfile, specProfile } from './profile.mjs';
import { assertOutsideRepo, repoRoots, sha256, sha256File, writeReport } from './report.mjs';
import { evalChatRecord } from './sim.mjs';
import { B_CONTROL, STOP, STYLES, cellStats, growCell, outcomeOf, verdictOf } from './stats.mjs';
import { buildTurns, capOk } from './turns.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GATE_CELLS = [{ corpus: 'M4', lang: 'en' }, { corpus: 'M4', lang: 'ko' }, { corpus: 'NF-real', lang: 'en' }, { corpus: 'NF-real', lang: 'ko' }];
export const REPLACEMENT_LIMIT = 0.05;
export const cellName = (c) => `${c.corpus}-${c.lang}`;
export const familyOf = (drawSeed) => Object.keys(SEED_OF).find((k) => SEED_OF[k] === drawSeed) ?? null;

// The settings digest: sha256 of the settings JSON without its own sha256 field.
export function settingsDigest(settings) {
  const { sha256: _omit, ...rest } = settings;
  return sha256(JSON.stringify(rest, null, 1));
}

// The ledger is one fixed file per machine: a run with another out dir must find the same attempt history.
export const defaultLedgerPath = () => path.join(os.tmpdir(), 'ltm-s0', 'gate-attempts.json');
export const resolveLedgerPath = (argv) => arg(argv, '--ledger') ?? defaultLedgerPath();

// Request-level refusals (before the ledger is consulted): the tune seed is never a gate seed, a gate seed belongs to
// its builder's family, settings must come from the tune draw, and the tune must predict PASS at the final settings
// (MC-2661). An OVERRIDE run takes a fresh seed instead of a family seed: never a protected seed, and disjoint from
// every protected family's chat seeds.
export function assertGateBuilder(builder) {
  if (builder !== VERDICT_BUILDER) throw new Error(`the ${builder} builder is report-only and carries no S0 verdict (MC-2661): no gate attempt or settings record for it`);
}

// The gate runs only on settings the tune itself calls PASS (MC-2661). Missing evidence is refused; the digest covers
// `evidence`, so a flag cannot be edited away without failing the sha256 check first.
export function assertTunePredictsPass(settings) {
  const ev = settings.evidence;
  const refuse = (why) => { throw new Error(`the gate runs only when the tune predicts PASS (MC-2661): ${why}`); };
  if (ev === undefined || ev === null || typeof ev !== 'object') refuse('the settings carry no tune evidence');
  if (ev.budgetFlag !== null) refuse(`evidence.budgetFlag is ${JSON.stringify(ev.budgetFlag) ?? 'absent'}`);
  if (ev.finalFlag !== null) refuse(`evidence.finalFlag is ${JSON.stringify(ev.finalFlag) ?? 'absent'}`);
  if (ev.oracleFlag !== undefined && ev.oracleFlag !== null) refuse(`evidence.oracleFlag is ${JSON.stringify(ev.oracleFlag)}`);
}

export function checkGateArgs({ drawSeed, builder, settings, kind }) {
  assertGateBuilder(builder);
  if (drawSeed === SEEDS.TUNE) throw new Error('the gate refuses the TUNE draw seed');
  if (kind === 'OVERRIDE') {
    if (!FAMILIES[builder]) throw new Error('unknown builder ' + builder);
    if (!Number.isInteger(drawSeed) || Object.values(SEEDS).includes(drawSeed)) throw new Error('an override needs a fresh draw seed, not a protected one: ' + drawSeed);
    assertSeedsDisjoint([drawSeed]);
  } else {
    const fam = familyOf(drawSeed);
    if (!fam) throw new Error('not a gate seed: ' + drawSeed);
    if (!FAMILIES[builder] || ![FAMILIES[builder].primary, FAMILIES[builder].rerun].includes(fam)) throw new Error(`seed ${drawSeed} is not a ${builder} gate seed`);
  }
  if (settings.tuneDrawSeed !== SEEDS.TUNE) throw new Error('the gate refuses settings whose tuneDrawSeed is not the TUNE seed');
  if (settings.builder !== builder) throw new Error('settings belong to builder ' + settings.builder);
  if (settings.sha256 !== settingsDigest(settings)) throw new Error('settings sha256 does not match its content');
  assertTunePredictsPass(settings);
}

// `gate.mjs record-settings`: the digest and builder checks, then the tune must predict PASS before the hash is recorded.
export function recordSettingsCommand(ledger, { builder, settings }) {
  assertGateBuilder(builder);
  if (settings.sha256 !== settingsDigest(settings) || settings.builder !== builder) throw new Error('settings do not match their sha256 or builder');
  assertTunePredictsPass(settings);
  return recordSettings(ledger, builder, settings.sha256);
}

// Read-only git identity of the harness: the commit and a hash of the working-tree diff plus untracked files.
export function harnessIdentity() {
  const g = (a) => execFileSync('git', a, { cwd: HERE, encoding: 'utf8' });
  const dir = path.resolve(HERE, '..');
  let blob = g(['diff', 'HEAD', '--', dir]);
  for (const f of g(['ls-files', '-o', '--exclude-standard', '--', dir]).split('\n').filter(Boolean)) blob += f + '\n' + fs.readFileSync(path.resolve(HERE, f), 'utf8');
  return { commit: g(['rev-parse', 'HEAD']).trim(), diffHash: sha256(blob) };
}

const profileForTurns = (corpus, profiles) => (corpus === 'NF-real' ? profiles.real : specProfile(corpus === 'M4' || corpus === 'NF-specShort' ? 'short' : 'long'));

// `gate.mjs verdict`: a recorded verdict label, never for an INVALID attempt.
export function gateVerdictCommand(ledger, builder) {
  const st = builderState(ledger, builder);
  if (!st.attempts.length) throw new Error('no attempt recorded for ' + builder);
  const last = st.attempts[st.attempts.length - 1];
  if (last.outcome === 'INVALID') throw new Error('the last attempt is recorded INVALID: no verdict exists');
  return last.verdict;
}

// `gate.mjs record-override`: the maintainer's larger run after an INCONCLUSIVE stop, as a new epoch. The settings are a
// new file with a new digest (a new procedure block); the cap must exceed the ordinary cap; the seed is fresh.
export function recordOverrideCommand(ledger, { builder, settings, drawSeed, cap, ref }) {
  checkGateArgs({ drawSeed, builder, settings, kind: 'OVERRIDE' });
  if (!Number.isInteger(cap) || cap <= STOP.cap) throw new Error(`an override run is larger than the ordinary cap: --cap above ${STOP.cap}`);
  const st = builderState(ledger, builder);
  if (!(st.valid?.verdict === 'INCONCLUSIVE' || (st.report && !st.valid))) throw new Error('an override follows a recorded INCONCLUSIVE attempt or a MAINTAINER REPORT stop of ' + builder);
  return appendOverride(ledger, { builder, newSettingsSha: settings.sha256, drawSeed, ref, cap });
}

// The report-only cells of MC-2627: NF-specLong and NF-specShort, EN and KO, a fixed number of chats on the attempt's draw,
// read after the verdict is issued and recorded. They are never part of the verdict, the controls or the ledger.
export const REPORT_ONLY_CELLS = [{ corpus: 'NF-specLong', lang: 'en' }, { corpus: 'NF-specLong', lang: 'ko' }, { corpus: 'NF-specShort', lang: 'en' }, { corpus: 'NF-specShort', lang: 'ko' }];
export const REPORT_ONLY_CHATS = 12;
export function reportOnlyCells({ drawSeed, settings, counter, profiles, hooks, regime = 'POOL', lenMode, cells = REPORT_ONLY_CELLS, n = REPORT_ONLY_CHATS, drawCtx = {} }) {
  const out = {};
  for (const cell of cells) {
    // A cell that fails is recorded under its own name and the other cells still run: a report-only cell never aborts the rest.
    try {
      const profile = profileForTurns(cell.corpus, profiles);
      const recs = [];
      let replacements = 0;
      for (let k = 0; k < n; k++) {
        const { chat, replacements: rep } = drawWithReserve({ drawSeed, corpus: cell.corpus, lang: cell.lang, i: k }, { profiles, ...drawCtx });
        replacements += rep.length;
        recs.push(evalChatRecord(chat, counter, settings, { profile, regime, lenMode, hooks }));
      }
      const st = cellStats(recs);
      out[cellName(cell)] = { chats: recs.length, replacements, styles: Object.fromEntries(STYLES.map((s) => [s, { n: st[s].n, recall: st[s].recall.point, recallCI: st[s].recall.boot, d: st[s].d.point, dCI: st[s].d.boot }])) };
    } catch (e) {
      out[cellName(cell)] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

// opts: { builder, kind, drawSeed, settings, ledger, counter, profiles, cells, stop, hooks, controlsB, log, diagnostics,
//         sensitivityCounter, regime, lenMode, onLedger, reportOnlyCells, drawCtx }
// onLedger(ledger) is called with the ledger holding the issued verdict before the report-only cells and the
// diagnostics run, so a crash in either cannot lose the attempt; a failure there is returned as <name>Error.
// Returns { status: 'VALID' | 'INVALID' | 'REFUSED', ledger, ... }.
export async function runGateAttempt(opts) {
  const { builder, kind, drawSeed, settings, counter, profiles, hooks } = opts;
  const log = opts.log ?? (() => {});
  const cells = opts.cells ?? GATE_CELLS;
  const stop = { ...STOP, ...(opts.stop ?? {}) };
  const family = opts.seedFamily ?? (kind === 'OVERRIDE' ? 'OVERRIDE' : familyOf(drawSeed)); // opts.seedFamily lets tests run a named family on a test seed
  const req ={ builder, kind, seedFamily: family, settingsSha: settings.sha256, drawSeed };
  const chk = checkAttempt(opts.ledger, req);
  if (!chk.ok) return { status: 'REFUSED', reason: chk.reason, ledger: tryAttempt(opts.ledger, { ...req, harness: {}, outcome: 'INVALID' }).ledger };
  const regime = opts.regime ?? 'POOL';
  const sampled = {};
  for (const cell of cells) {
    const name = cellName(cell);
    const chats = [], reps = [], gen = [];
    const profile = profileForTurns(cell.corpus, profiles);
    const ctx = { profiles, build: opts.build };
    const grown = growCell((k) => {
      const { chat, replacements } = drawWithReserve({ drawSeed, corpus: cell.corpus, lang: cell.lang, i: k }, ctx);
      chats.push(chat);
      reps.push(replacements.length);
      gen.push({ nout: chat.meta.Nout, factor: chat.meta.factor, floor: chat.meta.floorFlag });
      return evalChatRecord(chat, counter, settings, { profile, regime, lenMode: opts.lenMode, hooks, totalTokens: true });
    }, stop);
    sampled[name] = { cell, chats, recs: grown.chats, status: grown.status, reps, gen, profile };
    log(`cell ${name}: ${grown.chats.length} chats, ${grown.status}`);
  }
  const names = Object.keys(sampled);
  const base = { builder, kind, seedFamily: family, drawSeed, settingsSha: settings.sha256, harness: harnessIdentity(), attemptNo: builderState(opts.ledger, builder).attempts.length + 1 };
  const cellChats = Object.fromEntries(names.map((n) => [n, sampled[n].recs.length]));
  const replacements = Object.fromEntries(names.map((n) => [n, sampled[n].reps.reduce((a, b) => a + b, 0)]));
  const provenance = { ...base.harness, node: process.version, counter: counter.kind, settingsSha: settings.sha256 };
  const finishInvalid = (invalidClass, extra) => {
    const entry = { ...base, outcome: 'INVALID', invalidClass, cellChats, ...extra.entry };
    const t = tryAttempt(opts.ledger, entry);
    if (!t.ok) throw new Error('ledger refused the attempt: ' + t.reason);
    log('INVALID EXPERIMENT (' + invalidClass + ')');
    return { status: 'INVALID', invalidClass, ledger: t.ledger, builder, kind, seedFamily: family, drawSeed, attemptNo: base.attemptNo, provenance, cellChats, replacements, validity: extra.validity, fallbackShare: extra.fallbackShare, history: builderState(t.ledger, builder).attempts.map((a) => ({ kind: a.kind, seedFamily: a.seedFamily, outcome: a.outcome, invalidClass: a.invalidClass, verdict: a.verdict })) };
  };
  const turnsByCell = Object.fromEntries(names.map((n) => [n, sampled[n].chats.map((c) => buildTurns(c, { regime: 'POOL', profile: sampled[n].profile, lenMode: opts.lenMode }))]));
  // generator check: more than 5% replacements in a cell, or more than 5% allude turns over the overlap cap. The allude
  // read is intentionally style-independent (MC-2661): it checks that the generator built its allude turns within the
  // cap, a corpus-validity check, so a generator that breaks its own construction is not trusted for the ask turns.
  const capShare = {};
  for (const n of names) {
    const al = turnsByCell[n].flat().filter((t) => t.kind === 'fact' && t.style === 'allude');
    capShare[n] = al.length ? al.filter((t) => !capOk([t.overlap])).length / al.length : 0;
  }
  for (const n of names) if (replacements[n] / sampled[n].recs.length > REPLACEMENT_LIMIT || capShare[n] > REPLACEMENT_LIMIT) return finishInvalid('GENERATOR', { entry: { replacements }, validity: null, fallbackShare: null });
  // controls, on each cell's final sample, only after every cell has stopped
  const controlCells = {};
  const fallbackShare = {};
  for (const n of names) {
    const s = sampled[n];
    const turnsOf = turnsByCell[n];
    const cands = s.chats.map((c, i) => donorEntry(c, turnsOf[i]));
    const recs = s.chats.map((c, i) => {
      const memo = new Map();
      const donorOf = (category, style, key) => { const k = category + '|' + style + '|' + key; if (!memo.has(k)) memo.set(k, pickDonor(cands, i, category, style, key)); return memo.get(k); };
      return controlsRecord(c, counter, settings, turnsOf[i], donorOf, hooks);
    });
    controlCells[n] = recs;
    const tot = recs.reduce((a, r) => a + STYLES.reduce((x, st) => x + r[st].n, 0), 0);
    fallbackShare[n] = tot ? recs.reduce((a, r) => a + STYLES.reduce((x, st) => x + r[st].fallback, 0), 0) / tot : 0;
  }
  const validity = controlTests(controlCells, { B: opts.controlsB ?? B_CONTROL });
  if (validity.invalid) {
    const failed = validity.tests.map(({ cell, style, control, point, boot, t, threshold, failConfirmed, notConfirmed, alpha, comparator }) => ({ cell, style, control, point, boot, t, threshold, failConfirmed, notConfirmed, alpha, ...(comparator ? { comparator } : {}) }));
    return finishInvalid('CONTROL', { entry: { controls: failed, fallbackShare }, validity: { ...validity, tests: failed }, fallbackShare });
  }
  // the verdict
  const cellRecs = Object.fromEntries(names.map((n) => [n, sampled[n].recs]));
  const v = outcomeOf(Object.fromEntries(names.map((n) => [n, { chats: sampled[n].recs, status: sampled[n].status }])));
  const verdict = v.verdict;
  const entry = { ...base, outcome: 'VALID', verdict, cellChats, controls: validity.tests.map(({ cell, style, control, point, boot, t, threshold, failConfirmed, notConfirmed, alpha, comparator }) => ({ cell, style, control, point, boot, t, threshold, failConfirmed, notConfirmed, alpha, ...(comparator ? { comparator } : {}) })), fallbackShare, replacements };
  const t = tryAttempt(opts.ledger, entry);
  if (!t.ok) throw new Error('ledger refused the attempt: ' + t.reason);
  const result = {
    status: 'VALID', verdict, ledger: t.ledger, builder, kind, seedFamily: family, drawSeed, attemptNo: base.attemptNo, provenance, cellChats, replacements, validity, fallbackShare,
    rows: v.rows, settings, history: builderState(t.ledger, builder).attempts.map((a) => ({ kind: a.kind, seedFamily: a.seedFamily, outcome: a.outcome, invalidClass: a.invalidClass, verdict: a.verdict })),
    generator: Object.fromEntries(names.map((n) => [n, { chats: sampled[n].gen.length, floorChats: sampled[n].gen.filter((g) => g.floor).length, extendedMean: sampled[n].gen.reduce((a, g) => a + g.nout, 0) / sampled[n].gen.length }])),
    tokens: Object.fromEntries(names.map((n) => [n, sampled[n].recs.reduce((a, r) => a + (r.tokens ?? 0), 0)])),
    nofact: Object.fromEntries(names.map((n) => { const all = sampled[n].recs.flatMap((r) => r.nofact); const by = (k) => { const x = all.filter((y) => y.kind === k); return { n: x.length, packedShare: x.length ? x.filter((y) => y.packedAny).length / x.length : 0, meanT: x.length ? x.reduce((a, y) => a + y.T, 0) / x.length : 0 }; }; return [n, { abstention: by('abstention'), filler: by('filler') }]; })),
    breakdown: Object.fromEntries(names.map((n) => { const rows = sampled[n].recs.flatMap((r) => r.rows); const grp = (f) => { const m = {}; for (const r of rows) { const k = f(r); (m[k] ||= { n: 0, e: 0, b: 0, bw: 0 }); m[k].n++; m[k].e += r.hit; m[k].b += r.base; m[k].bw += r.baseW; } return m; }; return [n, { byCategory: grp((r) => r.category), byCueInTail: grp((r) => String(r.cueInTail)), byStyle: grp((r) => r.style), mergedKU: rows.filter((r) => r.merged).length, tokensPerSendMean: rows.reduce((a, r) => a + r.T, 0) / (rows.length || 1), evictedMean: rows.reduce((a, r) => a + r.evicted, 0) / (rows.length || 1) }]; })),
  };
  if (opts.onLedger) opts.onLedger(t.ledger);
  const settle = async (key, fn) => { try { result[key] = await fn(); } catch (e) { result[key + 'Error'] = e instanceof Error ? e.message : String(e); } };
  if (opts.reportOnlyCells) await settle('reportOnly', () => reportOnlyCells({ drawSeed, settings, counter, profiles, hooks, regime, lenMode: opts.lenMode, drawCtx: { ...opts.drawCtx, build: opts.build }, ...(Array.isArray(opts.reportOnlyCells) ? { cells: opts.reportOnlyCells } : {}), ...(opts.reportOnlyChats ? { n: opts.reportOnlyChats } : {}) }));
  if (opts.diagnostics) await settle('diagnostics', () => opts.diagnostics({ sampled, settings, counter, hooks, regime, cellRecs, verdict }));
  return result;
}

// Diagnostics on the final sample (they never change the verdict): other filler regimes with the FILLER-SENSITIVE flag,
// the C sweep, the whole-turn query (MC-2632), the filler-length sweep and the o200k sensitivity counter.
export async function standardDiagnostics({ sampled, settings, counter, hooks, regime, verdict, o200k }) {
  const out = {};
  const label = (recsByCell) => { const r = verdictOf(recsByCell).verdict; return r.replace(' (BORDERLINE)', ''); };
  const evalAll = (st, extra = {}, ctr = counter) => Object.fromEntries(Object.entries(sampled).map(([n, s]) => [n, s.chats.map((c) => evalChatRecord(c, ctr, st, { profile: s.profile, regime, hooks, nofact: false, ...extra }))]));
  const pointOf = (recsByCell) => Object.fromEntries(Object.entries(cellStatsAll(recsByCell)));
  out.regimes = {};
  for (const rg of ['DISJOINT', 'SELF']) { const r = evalAll(settings, { regime: rg }); out.regimes[rg] = { verdict: label(r), points: pointOf(r) }; }
  out.fillerSensitive = out.regimes.DISJOINT.verdict !== label(Object.fromEntries(Object.entries(sampled).map(([n, s]) => [n, s.recs])));
  out.cSweep = {};
  for (const C of [16384, 65536, 131072]) out.cSweep[C] = pointOf(evalAll({ ...settings, C }));
  const whole = evalAll({ ...settings, tailChars: 1e9 });
  out.wholeTurnQuery = { points: pointOf(whole) };
  out.lengthSweep = { 0: pointOf(evalAll(settings, { lenMode: 0 })), 200: pointOf(evalAll(settings, { lenMode: 200 })) };
  if (o200k) out.o200k = { verdict: label(evalAll(settings, {}, o200k)) };
  out.pooledVerdict = verdict;
  return out;
}

function cellStatsAll(recsByCell) {
  return Object.fromEntries(Object.entries(recsByCell).map(([n, recs]) => { const st = cellStats(recs); return [n, { ask: { recall: st.ask.recall.point, d: st.ask.d.point }, allude: { recall: st.allude.recall.point, d: st.allude.d.point } }]; }));
}

// ---- CLI ----
function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }

async function main(argv) {
  const cmd = ['record-settings', 'record-defect', 'record-override', 'verdict'].includes(argv[0]) ? argv[0] : 'run';
  const ledgerPath = resolveLedgerPath(argv);
  fs.mkdirSync(assertOutsideRepo(path.dirname(ledgerPath), 'the attempt ledger'), { recursive: true });
  assertOutsideRepo(ledgerPath, 'the attempt ledger');
  if (cmd === 'record-override') {
    const s = JSON.parse(fs.readFileSync(arg(argv, '--settings'), 'utf8'));
    saveLedger(ledgerPath, recordOverrideCommand(loadLedger(ledgerPath), { builder: arg(argv, '--builder'), settings: s, drawSeed: Number(arg(argv, '--draw')), cap: Number(arg(argv, '--cap')), ref: arg(argv, '--ref') }));
    console.log('override recorded', s.builder, arg(argv, '--draw'));
    return;
  }
  if (cmd === 'record-settings') {
    const builder = arg(argv, '--builder');
    const s = JSON.parse(fs.readFileSync(arg(argv, '--settings'), 'utf8'));
    saveLedger(ledgerPath, recordSettingsCommand(loadLedger(ledgerPath), { builder, settings: s }));
    console.log('recorded', builder, s.sha256);
    return;
  }
  if (cmd === 'record-defect') {
    saveLedger(ledgerPath, appendDefect(loadLedger(ledgerPath), { builder: arg(argv, '--builder'), reproducerTest: arg(argv, '--reproducer'), gate2Path: arg(argv, '--gate2') }));
    console.log('defect recorded');
    return;
  }
  if (cmd === 'verdict') { console.log(gateVerdictCommand(loadLedger(ledgerPath), arg(argv, '--builder'))); return; }
  const settingsPath = arg(argv, '--settings'), aggPath = arg(argv, '--real-agg');
  const drawSeed = Number(arg(argv, '--draw'));
  const outDir = argv[argv.length - 1];
  assertOutsideRepo(aggPath, '--real-agg');
  assertOutsideRepo(outDir, 'the out dir');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const kind = arg(argv, '--kind') ?? 'FIRST';
  checkGateArgs({ drawSeed, builder: settings.builder, settings, kind });
  const led = ledgerPath;
  console.log('settings sha256', settings.sha256, 'aggregates sha256', sha256File(aggPath));
  const counter = await loadCounter('llama3');
  const o200k = await loadCounter('o200k');
  const ledger = loadLedger(led);
  const ov = kind === 'OVERRIDE' ? builderState(ledger, settings.builder).override : null;
  const res = await runGateAttempt({ builder: settings.builder, kind, drawSeed, settings, ledger, counter, profiles: { real: realProfile(aggPath) }, log: (m) => console.log(m), ...(ov?.cap ? { stop: { cap: ov.cap } } : {}), onLedger: (l) => saveLedger(led, l), reportOnlyCells: true, diagnostics: (d) => standardDiagnostics({ ...d, o200k }) });
  saveLedger(led, res.ledger);
  if (res.status === 'REFUSED') { console.log('REFUSED:', res.reason); process.exitCode = 2; return; }
  const { ledger: _l, ...report } = res;
  writeReport(outDir, report);
  console.log(res.status === 'VALID' ? `verdict ${res.verdict}` : `INVALID EXPERIMENT (${res.invalidClass}); no verdict computed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
