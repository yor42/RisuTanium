// The S0 tune run: 24 chats per gate cell on the TUNE draw, settings chosen for each requested builder (default rare) by
// lower bounds (select.mjs), one settings file per builder written in the same run with its procedure block, plus the
// pre-gate diagnostics (D1, D2).
//   node Agents/Tools/ltm-eval/s0/tune.mjs --real-agg <aggregates> <outDir>
// The out dir and the aggregates must lie outside the repository (report.mjs); nothing real-derived is printed.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { rng } from '../gen/lib.mjs';
import { oracleQueryHit, oracleRankHit, controlsRecord, controlTests, donorEntry, pickDonor } from './controls.mjs';
import { BUDGETS, C_GATE, RARE_SHARES, TUNE_CHATS, selectSettings } from './select.mjs';
import { VERDICT_BUILDER } from './attempts.mjs';
import { SEEDS, drawWithReserve } from './corpus.mjs';
import { loadCounter } from './counter.mjs';
import { GATE_CELLS, cellName, settingsDigest } from './gate.mjs';
import { realProfile, specProfile } from './profile.mjs';
import { assertOutsideRepo, sha256File } from './report.mjs';
import { ChatSim, evalChatRecord, makeUnits } from './sim.mjs';
import { GATING_STYLES, STOP, STYLES, cellStats } from './stats.mjs';
import { buildTurns } from './turns.mjs';

// Pre-registered with the settings: covered by the settings sha256 the orchestrator records before any gate run.
export const PROCEDURE = {
  perStyleRule: 'MC-2661: ask turns pass in all four cells; allude turns are computed and reported, never gating, and carried to S3 (amends MC-2642); fixed in code',
  gatingStyles: GATING_STYLES,
  reportedStyles: ['allude'],
  verdictBuilder: 'rare (MC-2661; supersedes MC-2655 for the verdict); fulltext and idf report-only',
  rare: {
    query: 'the whole user turn (no 500-character tail; amends MC-2632 for this builder); queries 2 and 3 are the last 500 code points of the two newest messages before the turn, through the same term rule; tailChars is ignored',
    terms: 'distinct spec 5.3 tokens with 1 <= df <= max(1, floor(rareShare x N)), N = units in D0',
    empty: 'no qualifying token: every distinct token at the smallest df >= 1 in the query; no indexed token: no scored unit, newest-first fill',
    scoring: 'BM25 k1 1.2, b 0.75 over those tokens; unit ties to the newer unit',
    rareShareGrid: RARE_SHARES,
    tieBreak: 'within delta of the best O: larger L, then rareShare nearest 0.01; the picked rareShare is used in every later selection step and the recheck',
  },
  selection: 'O = min over cells of LB95 recall on gating styles; clears, delta, oracle eligibility, loss guards and the snippet floor read gating styles only',
  budgets: { grid: BUDGETS, cap: 'floor(0.15 x (C + 2000)) (MC-2630, MC-2654); the grid ends at the cap of C = 32768; cheapest clearing budget is chosen and its per-send cost reported' },
  finalBudgetWalk: 'if the final settings do not clear, walk to the next larger budget that cleared at the budget step and redo the later steps, until the final settings clear or no clearing budget remains (MC-2662)',
  gateOnlyIfTunePredictsPass: 'finalFlag = clears() re-run at the final settings; record-settings and every gate run (FIRST, NOISE, DEFECT, OVERRIDE) refuse settings unless evidence.budgetFlag and evidence.finalFlag are null and evidence.oracleFlag is null or absent (MC-2661)',
  controls: {
    kinds: ['ORACLE-RANK', 'ORACLE-QUERY', 'NULL'],
    familywise: 0.05, alphaC: 'familywise / m with m = cells x gating styles x 3', bootstrapB: 20000, bothBoundsRequired: true,
    oracleFloor: 0.9, nullSlack: 0.05, randomShuffles: 20, randomSeedBase: 9101,
    oracleQueryMerge: 'round-robin over per-span lists (MC-2653)',
    nullDonor: 'first same-category, same-style turn of the next cast-disjoint chat in cyclic order, excluding the recipient\'s own fact key (MC-2653); fallback chat i+1, counted',
    sample: 'each cell\'s final sample, evaluated once after every cell stopped; no control-driven stopping',
    reportedStyleControls: 'computed on allude with the same alpha and reported; never INVALID (MC-2661)',
  },
  tuneEligibility: 'ORACLE-RANK and ORACLE-QUERY points >= 0.9 on gating styles; budget walk above the default if none at the default (MC-2654)',
  stop: { ...STOP, styles: 'gating styles only' },
  seeds: { tune: SEEDS.TUNE, rare: { first: SEEDS.GATE, noiseRerun: SEEDS.GATE_R, defectRerun: 'same seed family' }, reservedUnspent: [SEEDS.FALLBACK, SEEDS.FALLBACK_R] },
  caps: { noiseReruns: 1, defectReruns: 2, attempts: 3 },
  firstValidAttemptFinal: true,
  inconclusive: 'a valid attempt and final for its settings; a larger run is a maintainer override with a new settings hash (not a NOISE rerun)',
};

export function checkTuneArgs({ drawSeed }) {
  if (drawSeed !== SEEDS.TUNE) throw new Error('tune accepts only the TUNE draw seed ' + SEEDS.TUNE);
}

const profileOf = (corpus, profiles) => (corpus === 'NF-real' ? profiles.real : specProfile(corpus === 'M4' || corpus === 'NF-specShort' ? 'short' : 'long'));

// The tune evaluator: nChats chats per cell, drawn once; ev(settings, regime) evaluates all of them.
export function makeTuneEvaluator({ cells = GATE_CELLS, nChats, drawSeed, counter, profiles, hooks }) {
  const chats = {};
  for (const cell of cells) {
    const list = [];
    for (let i = 0; i < nChats; i++) list.push(drawWithReserve({ drawSeed, corpus: cell.corpus, lang: cell.lang, i }, { profiles }).chat);
    chats[cellName(cell)] = list;
  }
  const turnMemo = new Map();
  const turnsOf = (cell, k, regime, lenMode = 'hist') => {
    const key = cellName(cell) + k + regime + lenMode;
    if (!turnMemo.has(key)) turnMemo.set(key, buildTurns(chats[cellName(cell)][k], { regime, profile: profileOf(cell.corpus, profiles), lenMode }));
    return turnMemo.get(key);
  };
  const ev = (settings, regime = 'POOL', lenMode = 'hist') => {
    const recs = {}, oracle = {}, oracleQuery = {};
    for (const cell of cells) {
      const name = cellName(cell);
      const profile = profileOf(cell.corpus, profiles);
      const or = { ask: [0, 0], allude: [0, 0] };
      const oq = { ask: [0, 0], allude: [0, 0] };
      recs[name] = chats[name].map((chat, k) => {
        const turns = turnsOf(cell, k, regime, lenMode);
        const rec = evalChatRecord(chat, counter, settings, { profile, regime, hooks, turns, nofact: settings.nofact === true });
        if (settings.oracle === true) {
          const sim = new ChatSim(chat, counter);
          const byId = new Map(chat.questions.map((q) => [q.id, q]));
          for (const t of turns) {
            if (t.kind !== 'fact') continue;
            const q = byId.get(t.qid);
            const h = oracleRankHit(sim, t, q, settings, hooks);
            if (h !== null) { or[t.style][0] += h; or[t.style][1]++; }
            const hq = oracleQueryHit(sim, t, q, settings, hooks);
            if (hq !== null) { oq[t.style][0] += hq; oq[t.style][1]++; }
          }
        }
        return rec;
      });
      oracle[name] = Object.fromEntries(STYLES.map((s) => [s, or[s][1] ? or[s][0] / or[s][1] : 1]));
      oracleQuery[name] = Object.fromEntries(STYLES.map((s) => [s, oq[s][1] ? oq[s][0] / oq[s][1] : 1]));
    }
    return { recs, oracle, oracleQuery };
  };
  return { ev, chats, turnsOf };
}

// Intraclass correlation of per-chat engine recall (one-way ANOVA estimate), used by D2.
export function estimateIcc(recs) {
  const vals = [];
  for (const cell of Object.values(recs)) for (const style of STYLES) { const rs = cell.map((c) => (c[style].n ? c[style].e / c[style].n : null)).filter((x) => x !== null); if (rs.length > 1) vals.push(rs); }
  let num = 0, den = 0;
  for (const rs of vals) { const m = rs.reduce((a, b) => a + b, 0) / rs.length; const v = rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1); const p = Math.min(0.99, Math.max(0.01, m)); num += Math.max(0, v - p * (1 - p) / 10); den += p * (1 - p); }
  return den ? Math.min(0.95, num / den) : 0;
}

// D2: the per-test false-INVALID rate of each control type when its true value sits exactly at the threshold, with
// chat-level heterogeneity given by icc. One test of each type per replicate; the familywise bound is m times the rate.
export function controlErrorRates({ ns = [12, 24], replicates = 500, icc = 0.1, turnsPerChat = 10, m = 4 * GATING_STYLES.length * 3, B = 4000, seed = 777 }) {
  const out = {};
  for (const n of ns) {
    const r = rng(seed + n);
    const norm = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
    const bern = (p) => (r() < p ? 1 : 0);
    const chatP = (p) => Math.min(0.999, Math.max(0.001, p + Math.sqrt(icc * p * (1 - p)) * norm()));
    let oracleHits = 0, nullHits = 0;
    for (let rep = 0; rep < replicates; rep++) {
      const cell = [];
      for (let c = 0; c < n; c++) {
        const po = chatP(0.9), pb = chatP(0.2), pn = Math.min(0.999, pb + 0.05);
        const o = { n: turnsPerChat, or: 0, oq: 0, nl: 0, bu: 0, rd: 0 };
        for (let t = 0; t < turnsPerChat; t++) { o.or += bern(po); o.oq += bern(po); o.nl += bern(pn); o.bu += bern(pb); o.rd += bern(pb); }
        cell.push({ ask: o, allude: o });
      }
      const res = controlTests({ cell }, { B, m });
      const tests = res.tests.filter((x) => x.style === 'ask');
      if (tests.find((x) => x.control === 'ORACLE-RANK').failConfirmed) oracleHits++;
      if (tests.find((x) => x.control === 'NULL').failConfirmed) nullHits++;
    }
    out[n] = { oracleRate: oracleHits / replicates, nullRate: nullHits / replicates, familywiseBound: m * Math.max(oracleHits, nullHits) / replicates, replicates };
  }
  return out;
}

// D1 as a readable status per cell. A control row is FAIL-CONFIRMED (both interval bounds exclude its threshold) or PASS
// (including NOT CONFIRMED, which the gate does not treat as INVALID). A cell is INVALID when any of its gating-style
// rows is FAIL-CONFIRMED, and so is the builder: the gate would be INVALID on the same structure. An allude row that
// fails is shown as FAIL-CONFIRMED (report-only), is never INVALID and is not counted (MC-2661). Names only; no statistic.
export function summarizeControls(controls) {
  const cells = {};
  for (const t of controls.tests) {
    const c = (cells[t.cell] ||= { status: 'PASS', controls: [] });
    const gating = GATING_STYLES.includes(t.style);
    const status = t.failConfirmed ? (gating ? 'FAIL-CONFIRMED' : 'FAIL-CONFIRMED (report-only)') : 'PASS';
    c.controls.push({ style: t.style, control: t.control, status, ...(t.notConfirmed ? { notConfirmed: true } : {}) });
    if (t.failConfirmed && gating) c.status = 'INVALID';
  }
  const failed = Object.values(cells).reduce((a, c) => a + c.controls.filter((x) => x.status === 'FAIL-CONFIRMED').length, 0);
  return { status: failed ? 'INVALID' : 'PASS', failConfirmed: failed, cells };
}

// The stdout lines of a summary, one per cell and one for the builder; they name controls, never values.
export function controlSummaryLines(builder, summary) {
  const lines = Object.entries(summary.cells).map(([name, c]) => `D1 ${builder} ${name}: ${c.status}${c.status === 'INVALID' ? ' (' + c.controls.filter((x) => x.status === 'FAIL-CONFIRMED').map((x) => `${x.style} ${x.control}`).join(', ') + ' FAIL-CONFIRMED)' : ''}`);
  lines.push(`D1 ${builder}: ${summary.status}, ${summary.failConfirmed} FAIL-CONFIRMED control(s)${summary.status === 'INVALID' ? (builder !== VERDICT_BUILDER ? `; ${builder} is report-only (MC-2661): no gate runs it` : '; the gate would be INVALID on this structure: do not run it, ask the maintainer') : ''}`);
  return lines;
}

// Pieces per record per L for the real-profile NF corpus, with the drawn joiners and with the all-paragraph merge.
export function piecesReport(drawSeed, profiles, langs = ['en', 'ko'], grid = [300, 500, 800, 1200], nChats = 2, draw = drawWithReserve) {
  const out = {};
  for (const lang of langs) for (const [label, ctx] of [['drawn', { profiles }], ['allParagraph', { profiles, joinAll: '\n\n' }]]) {
    const row = {};
    for (const L of grid) {
      let pieces = 0, recs = 0;
      for (let i = 0; i < nChats; i++) { const c = draw({ drawSeed, corpus: 'NF-real', lang, i }, ctx).chat; pieces += makeUnits(c.messages, L).length; recs += c.messages.length; }
      row[L] = pieces / recs;
    }
    out[`${lang}-${label}`] = row;
  }
  return out;
}

// The unit-split trigger: the median char-record token count against a quarter of the snippet budget.
export function triggerReport(chats, counter, budget) {
  const toks = chats.flatMap((c) => c.messages.filter((m) => m.role === 'char').map((m) => counter.len(m.text))).sort((a, b) => a - b);
  const median = toks.length ? toks[(toks.length - 1) >> 1] : 0;
  return { median, quarterBudget: budget / 4, triggered: median > budget / 4 };
}

// opts: { drawSeed, counter, profiles, nChats (default TUNE_CHATS), cells, grid, hooks, C, log, makeEvaluator, builders, oracleTrigger }
export async function runTune(opts) {
  const log = opts.log ?? (() => {});
  const nChats = opts.nChats ?? TUNE_CHATS;
  const make = opts.makeEvaluator ?? makeTuneEvaluator;
  const { ev, chats } = make({ cells: opts.cells ?? GATE_CELLS, nChats, drawSeed: opts.drawSeed, counter: opts.counter, profiles: opts.profiles, hooks: opts.hooks });
  const C = opts.C ?? C_GATE;
  const settings = {}, diagnostics = {};
  for (const builder of opts.builders ?? [VERDICT_BUILDER]) {
    const s = selectSettings(ev, { builder, C, procedure: PROCEDURE, tuneDrawSeed: opts.drawSeed, grid: opts.grid });
    s.sha256 = settingsDigest(s);
    settings[builder] = s;
    log(`tuned ${builder}`);
    if (opts.diagnostics === false) continue;
    // D1: the validity controls on the tune draw at the chosen settings, with the same interval rule
    const cellCtl = {};
    for (const cell of opts.cells ?? GATE_CELLS) {
      const name = cellName(cell);
      const profile = profileOf(cell.corpus, opts.profiles);
      const turnsOf = chats[name].map((c) => buildTurns(c, { regime: 'POOL', profile }));
      const cands = chats[name].map((c, i) => donorEntry(c, turnsOf[i]));
      cellCtl[name] = chats[name].map((c, i) => controlsRecord(c, opts.counter, s, turnsOf[i], (cat, st, key) => pickDonor(cands, i, cat, st, key), opts.hooks));
    }
    const controls = controlTests(cellCtl, { B: 20000 });
    diagnostics[builder] = { controls, d1: summarizeControls(controls) };
    for (const line of controlSummaryLines(builder, diagnostics[builder].d1)) log(line);
    const base = ev(s, 'POOL'), dis = ev(s, 'DISJOINT');
    diagnostics[builder].regimeGap = Object.fromEntries(Object.keys(base.recs).map((n) => [n, { pool: cellStats(base.recs[n]), disjoint: cellStats(dis.recs[n]) }]));
    diagnostics[builder].icc = estimateIcc(base.recs);
    // the filler-length sweep: no filler, 200 characters, and the user histogram (the primary runs above)
    diagnostics[builder].lengthSweep = Object.fromEntries([0, 200].map((lm) => { const r = ev(s, 'POOL', lm); return [lm, Object.fromEntries(Object.keys(r.recs).map((n) => [n, cellStats(r.recs[n])]))]; }));
  }
  return { settings, diagnostics, chats };
}

async function main(argv) {
  const i = argv.indexOf('--real-agg');
  const aggPath = argv[i + 1];
  const outDir = argv[argv.length - 1];
  assertOutsideRepo(aggPath, '--real-agg');
  const real = assertOutsideRepo(outDir, 'the out dir');
  checkTuneArgs({ drawSeed: SEEDS.TUNE });
  fs.mkdirSync(real, { recursive: true });
  const counter = await loadCounter('llama3');
  const profiles = { real: realProfile(aggPath) };
  console.log('aggregates sha256', sha256File(aggPath));
  const res = await runTune({ drawSeed: SEEDS.TUNE, counter, profiles, log: (m) => console.log(m) });
  writeTuneOutputs({ real, res, counter, profiles, drawSeed: SEEDS.TUNE, log: (m) => console.log(m) });
}

// The settings files are written before anything that can fail afterwards: they are the tune's product. The
// unit-split trigger on NF-specLong (report-only, MC-2627) records its own error and never stops the run; the same
// steps on gated NF-real data stop it with an error that names the profile.
export function writeTuneOutputs({ real, res, counter, profiles, drawSeed, draw = drawWithReserve, nSpecLong = 12, d2Options = {}, log = () => {} }) {
  for (const b of Object.keys(res.settings)) fs.writeFileSync(path.join(real, `settings-${b}.json`), JSON.stringify(res.settings[b], null, 1), 'utf8');
  for (const b of Object.keys(res.settings)) log(`${b} settings sha256 ${res.settings[b].sha256}`);
  const gated = (what, fn) => { try { return fn(); } catch (e) { throw new Error(`tune stopped: ${what} (gated profile) failed after the settings were written: ${e instanceof Error ? e.message : String(e)}`); } };
  const d2 = gated('control error rates', () => controlErrorRates({ icc: Math.max(...Object.values(res.diagnostics).map((d) => d.icc)), ...d2Options }));
  const nfReal = gated('NF-real unit-split trigger', () => Object.fromEntries(Object.keys(res.settings).map((b) => [b, triggerReport(res.chats['NF-real-ko'], counter, res.settings[b].budget)])));
  let specLong = null, specLongError;
  try {
    const chats = [];
    for (let i = 0; i < nSpecLong; i++) chats.push(draw({ drawSeed, corpus: 'NF-specLong', lang: 'ko', i }, {}).chat);
    specLong = Object.fromEntries(Object.keys(res.settings).map((b) => [b, triggerReport(chats, counter, res.settings[b].budget)]));
  } catch (e) {
    specLongError = e instanceof Error ? e.message : String(e);
    log(`NF-specLong unit-split trigger (report-only) failed: ${specLongError}`);
  }
  const trigger = Object.fromEntries(Object.keys(res.settings).map((b) => [b, { nfReal: nfReal[b], specLong: specLong ? specLong[b] : null }]));
  const pieces = gated('NF-real pieces report', () => piecesReport(drawSeed, profiles, undefined, undefined, undefined, draw));
  fs.writeFileSync(path.join(real, 'tune-report.json'), JSON.stringify({ diagnostics: res.diagnostics, d2, trigger, ...(specLongError ? { specLongError } : {}), pieces }, null, 1), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
