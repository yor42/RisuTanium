// The append-only attempt ledger and the pre-registered INVALID procedure of the S0 gate. It is the only place that
// decides whether another attempt may run, and its schema has no field for a verdict number.
//
// The verdict builder rare: GATE then GATE_R (MC-2661); FALLBACK and FALLBACK_R stay reserved and unspent:
//   - an attempt is always the whole attempt (all cells, both styles, from the first chats);
//   - an INVALID attempt may be rerun on the SAME seed family only with a recorded defect (a reproducer test id plus the
//     Gate 2 verdict path) and byte-identical settings (DEFECT, at most 2);
//   - without a recorded defect the failure counts as noise: exactly one rerun on the fresh R family with the same
//     settings hash (NOISE, at most 1);
//   - at most 3 attempts per builder; a NOISE rerun that is INVALID, a second NOISE rerun and a fourth attempt all end in
//     MAINTAINER REPORT, which refuses every later attempt;
//   - the first valid attempt (PASS, FAIL or INCONCLUSIVE) is final: no further attempt for that builder;
//   - settings must be recorded by the orchestrator before any attempt.
// INCONCLUSIVE and the maintainer: INCONCLUSIVE is a valid attempt and final for its settings. A larger run the maintainer
// authorises is a new epoch: appendOverride records the maintainer's override with a NEW procedure block (new settings
// sha256) and a fresh seed; it is not a NOISE rerun and does not use up the NOISE cap of the earlier epoch.
import fs from 'node:fs';

export const VERDICT_BUILDER = 'rare';
export const FAMILIES = { rare: { primary: 'GATE', rerun: 'GATE_R' } };
export const SEED_OF = { GATE: 610001, GATE_R: 620001, FALLBACK: 710001, FALLBACK_R: 720001 };
export const CAPS = { noise: 1, defect: 2, attempts: 3 };
export const VERDICT_LABELS = ['PASS', 'PASS (BORDERLINE)', 'FAIL', 'INCONCLUSIVE'];
export const INVALID_CLASSES = ['CONTROL', 'GENERATOR'];
// Keys that would carry an engine-arm statistic on verdict cues: never written to the ledger.
const FORBIDDEN = new Set(['recall', 'd', 'ci', 'lo', 'hi', 'width', 'lb', 'ub', 'lb95', 'ub95', 'engine', 'delivered', 'baseline', 'baselineunits', 'baselinewhole', 'point', 'widths']);

export const emptyLedger = () => ({ schema: 1, recordedSettings: {}, entries: [] });

// The only keys a control row may carry: control statistics, never an engine-arm statistic.
const CONTROL_KEYS = new Set(['cell', 'style', 'control', 'point', 'boot', 't', 'threshold', 'failConfirmed', 'notConfirmed', 'alpha', 'comparator']);

function scanKeys(obj, path, bad) {
  if (Array.isArray(obj)) { obj.forEach((x, i) => scanKeys(x, path + '[' + i + ']', bad)); return; }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN.has(k.toLowerCase())) bad.push(path + '.' + k);
      scanKeys(v, path === '' ? k : path + '.' + k, bad);
    }
  }
}

// The schema check of an attempt entry. A verdict number (any engine-arm statistic) is refused; an INVALID entry takes
// no verdict at all. Control statistics (the rows under `controls`) are not engine-arm statistics and are allowed.
export function validateAttempt(e) {
  const err = [];
  if (!FAMILIES[e.builder]) err.push('builder');
  if (!['FIRST', 'NOISE', 'DEFECT', 'OVERRIDE'].includes(e.kind)) err.push('kind');
  if (!SEED_OF[e.seedFamily] && e.kind !== 'OVERRIDE') err.push('seedFamily');
  if (!Number.isInteger(e.drawSeed)) err.push('drawSeed');
  if (!/^[0-9a-f]{64}$/.test(e.settingsSha ?? '')) err.push('settingsSha');
  if (!e.harness || typeof e.harness.commit !== 'string' || typeof e.harness.diffHash !== 'string') err.push('harness');
  if (e.outcome === 'INVALID') {
    if (!INVALID_CLASSES.includes(e.invalidClass)) err.push('invalidClass');
    if ('verdict' in e) err.push('verdict field on an INVALID entry');
  } else if (e.outcome === 'VALID') {
    if (!VERDICT_LABELS.includes(e.verdict)) err.push('verdict label');
  } else err.push('outcome');
  const bad = [];
  scanKeys(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'controls')), '', bad);
  for (const b of bad) err.push('verdict number: ' + b);
  for (const row of e.controls ?? []) for (const k of Object.keys(row)) if (!CONTROL_KEYS.has(k)) err.push('control row key: ' + k);
  return err;
}

const attemptsOf = (ledger, builder) => ledger.entries.filter((x) => x.builder === builder);

// The state of one builder from its entries, counted from its latest override (a new epoch).
export function builderState(ledger, builder) {
  const all = attemptsOf(ledger, builder);
  const ov = all.map((x, i) => (x.type === 'override' ? i : -1)).filter((i) => i >= 0);
  const epoch = ov.length ? all.slice(ov[ov.length - 1]) : all;
  const att = epoch.filter((x) => x.type === 'attempt');
  const last = att[att.length - 1] ?? null;
  const lastIdx = last ? epoch.indexOf(last) : -1;
  return {
    attempts: att,
    last,
    valid: att.find((x) => x.outcome === 'VALID') ?? null,
    noise: att.filter((x) => x.kind === 'NOISE').length,
    defects: att.filter((x) => x.kind === 'DEFECT').length,
    report: epoch.some((x) => x.type === 'report'),
    defectRecorded: epoch.slice(lastIdx + 1).some((x) => x.type === 'defect'),
    override: ov.length ? epoch[0] : null,
    epochSha: ov.length ? epoch[0].newSettingsSha : null,
  };
}

const refuse = (reason, markReport = false) => ({ ok: false, reason, markReport });

// May this attempt run? req: { builder, kind, seedFamily, settingsSha, defect? }. Pure: it never changes the ledger.
export function checkAttempt(ledger, req) {
  const fam = FAMILIES[req.builder];
  if (!fam) return refuse('unknown builder');
  const st = builderState(ledger, req.builder);
  if (st.report) return refuse('MAINTAINER REPORT: no further attempt for ' + req.builder + ' until the maintainer answers');
  if (ledger.recordedSettings[req.builder] !== req.settingsSha && st.epochSha !== req.settingsSha) return refuse('settings hash not recorded');
  if (st.epochSha && req.settingsSha !== st.epochSha) return refuse('settings hash differs from the override');
  if (st.valid) return refuse('a verdict is already issued for ' + req.builder);
  if (st.attempts.length >= CAPS.attempts) return refuse('attempt cap reached: MAINTAINER REPORT', true);
  const last = st.last;
  if (req.kind === 'OVERRIDE') {
    if (!st.override) return refuse('no maintainer override recorded');
    if (st.attempts.length) return refuse('the override run is already used');
    if (req.drawSeed !== st.override.drawSeed) return refuse('override seed mismatch');
    return { ok: true };
  }
  if (st.override && !st.attempts.length) return refuse('the first attempt of an override epoch must be kind OVERRIDE');
  if (req.kind === 'FIRST') {
    if (st.attempts.length) return refuse('FIRST only before any attempt');
    if (req.seedFamily !== fam.primary) return refuse('FIRST must use ' + fam.primary);
    return { ok: true };
  }
  if (!last || last.outcome !== 'INVALID') return refuse('a rerun needs a preceding INVALID attempt');
  if (req.settingsSha !== last.settingsSha) return refuse('settings sha256 differs from the failed attempt');
  if (req.kind === 'DEFECT') {
    if (!st.defectRecorded) return refuse('DEFECT rerun needs a recorded defect entry');
    if (st.defects >= CAPS.defect) return refuse('DEFECT cap reached: MAINTAINER REPORT', true);
    if (req.seedFamily !== last.seedFamily) return refuse('a DEFECT rerun uses the same seed family');
    return { ok: true };
  }
  if (req.kind === 'NOISE') {
    if (st.defectRecorded) return refuse('a defect is recorded: use DEFECT');
    if (st.noise >= CAPS.noise) return refuse('second NOISE rerun refused: MAINTAINER REPORT', true);
    if (req.seedFamily !== fam.rerun) return refuse('NOISE rerun uses ' + fam.rerun);
    return { ok: true };
  }
  return refuse('kind');
}

const clone = (x) => JSON.parse(JSON.stringify(x));

// The orchestrator records a settings hash before any attempt (the settings sha256 covers the procedure block).
export function recordSettings(ledger, builder, sha) {
  const l = clone(ledger);
  l.recordedSettings[builder] = sha;
  return l;
}

// Records a demonstrated defect: a reproducer test that fails on the pre-fix harness and the Gate 2 verdict path.
export function appendDefect(ledger, { builder, reproducerTest, gate2Path }) {
  if (!reproducerTest || !gate2Path) throw new Error('a defect entry needs a reproducer test id and a Gate 2 verdict path');
  const l = clone(ledger);
  l.entries.push({ type: 'defect', builder, reproducerTest, gate2Path });
  return l;
}

// The maintainer's override of an INCONCLUSIVE or MAINTAINER REPORT stop: a new epoch with a new settings hash and seed.
// cap (optional): the chat cap of the larger run, recorded with the override so the run cannot choose its own.
export function appendOverride(ledger, { builder, newSettingsSha, drawSeed, ref, cap }) {
  if (!/^[0-9a-f]{64}$/.test(newSettingsSha ?? '') || !Number.isInteger(drawSeed) || !ref) throw new Error('override needs newSettingsSha, drawSeed and ref');
  if (cap !== undefined && !(Number.isInteger(cap) && cap > 0)) throw new Error('override cap must be a positive integer');
  const old = builderState(ledger, builder);
  if (newSettingsSha === ledger.recordedSettings[builder] && !old.epochSha) throw new Error('an override carries a new procedure block with a new settings hash');
  const l = clone(ledger);
  l.entries.push({ type: 'override', builder, newSettingsSha, drawSeed, ref, ...(cap !== undefined ? { cap } : {}) });
  return l;
}

// Checks, validates and appends an attempt. A refused attempt that marks MAINTAINER REPORT appends the report entry.
// A NOISE rerun that ends INVALID also ends in MAINTAINER REPORT: no defect is demonstrated.
export function tryAttempt(ledger, entry) {
  const req = { builder: entry.builder, kind: entry.kind, seedFamily: entry.seedFamily, settingsSha: entry.settingsSha, drawSeed: entry.drawSeed };
  const c = checkAttempt(ledger, req);
  if (!c.ok) {
    const l = clone(ledger);
    if (c.markReport && !builderState(ledger, entry.builder).report) l.entries.push({ type: 'report', builder: entry.builder, reason: c.reason });
    return { ok: false, reason: c.reason, ledger: l };
  }
  const bad = validateAttempt(entry);
  if (bad.length) return { ok: false, reason: 'schema: ' + bad.join('; '), ledger };
  const l = clone(ledger);
  l.entries.push({ type: 'attempt', ...clone(entry) });
  if (entry.kind === 'NOISE' && entry.outcome === 'INVALID') l.entries.push({ type: 'report', builder: entry.builder, reason: 'NOISE rerun INVALID with no defect demonstrated' });
  const st = builderState(l, entry.builder);
  if (!st.valid && !st.report && st.attempts.length >= CAPS.attempts) l.entries.push({ type: 'report', builder: entry.builder, reason: 'attempt cap reached' });
  return { ok: true, ledger: l };
}

// ---- file ----
export function loadLedger(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : emptyLedger();
}
// Append-only: the file's existing entries must be a prefix of the new ledger's entries.
export function saveLedger(file, ledger) {
  const old = loadLedger(file);
  const same = old.entries.every((e, i) => JSON.stringify(e) === JSON.stringify(ledger.entries[i]));
  if (!same || ledger.entries.length < old.entries.length) throw new Error('the attempt ledger is append-only');
  fs.writeFileSync(file, JSON.stringify(ledger, null, 1), 'utf8');
}
