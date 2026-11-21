// Report writing and the real-path refusal of the S0 tools. Real-derived quantiles never reach the repository (MC-2633):
// every path the tools write or read from the maintainer's data is compared by its real path against both checkouts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = (x) => createHash('sha256').update(x).digest('hex');
export const sha256File = (file) => sha256(fs.readFileSync(file));

const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const git = (args, cwd = HERE) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// The worktree top level and the main checkout (the parent of git's common dir), as real paths.
export function repoRoots(cwd = HERE) {
  const top = fs.realpathSync.native(git(['rev-parse', '--show-toplevel'], cwd));
  const common = fs.realpathSync.native(path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd)));
  return [top, path.dirname(common)];
}

// Real path of p, or of its nearest existing ancestor plus the rest, so a not-yet-created out dir is checked too.
function realLoose(p) {
  let cur = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(cur)) { rest.unshift(path.basename(cur)); const up = path.dirname(cur); if (up === cur) break; cur = up; }
  return path.join(fs.realpathSync.native(cur), ...rest);
}

// Throws when the path lies inside the worktree or the main checkout. Junctions and case variants are resolved.
export function assertOutsideRepo(p, what, roots = repoRoots()) {
  const real = fold(realLoose(p));
  for (const root of roots) {
    const r = fold(root);
    const rel = path.relative(r, real);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`${what} lies inside the repository: refused`);
  }
  return realLoose(p);
}

const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
// Allude turns never gate the verdict (MC-2661); their rows and validity rows say so.
const REPORT_ONLY_LABEL = ' (report-only, MC-2661; carried to S3)';

// Markdown of a gate result. An INVALID result carries no engine-arm statistic, so none can be printed.
export function renderReport(r) {
  const L = [];
  L.push(`# S0 gate report: ${r.builder} (${r.seedFamily}, attempt ${r.attemptNo})`, '');
  L.push('## 1. Provenance', `- harness commit ${r.provenance.commit}, working-tree diff hash ${r.provenance.diffHash}`, `- node ${r.provenance.node}, counter ${r.provenance.counter}`, `- settings sha256 ${r.provenance.settingsSha}`, `- draw seed ${r.drawSeed}`, '');
  L.push('## 2. Verdict', `- status ${r.status}${r.status === 'VALID' ? `, verdict ${r.verdict}` : ''}${r.invalidClass ? `, INVALID EXPERIMENT (${r.invalidClass})` : ''}`, '');
  L.push('## Validity block');
  if (r.validity) {
    L.push(`- m = ${r.validity.m}, alpha_c = ${r.validity.alpha}, bootstrap B = ${r.validity.B}, rank ${r.validity.rank}`);
    for (const t of r.validity.tests) L.push(`- ${t.cell} ${t.style} ${t.control}: point ${f3(t.point)}, bootstrap bound ${f3(t.boot)}, t bound ${f3(t.t)}, threshold ${t.threshold}${t.failConfirmed ? ' FAIL-CONFIRMED' : t.notConfirmed ? ' NOT CONFIRMED' : ''}${t.style === 'allude' ? REPORT_ONLY_LABEL : ''}`);
    L.push(`- NULL donor fallback share: ${Object.entries(r.fallbackShare ?? {}).map(([k, v]) => `${k} ${f3(v)}`).join(', ')}`);
    L.push('- Estimates, not measurements: the familywise false-INVALID bound of about 0.05 and the power figures (a control detects an oracle recall below about 0.76 or a NULL delta above about 0.15 at 12 chats, design effect assumed 1.3) are reasoning estimates. The D2 diagnostic measures only the per-test false-INVALID rate.');
  } else L.push('- generator check only');
  L.push('', '- attempt history:', ...(r.history ?? []).map((h) => `  - ${h.kind} ${h.seedFamily} ${h.outcome}${h.invalidClass ? ' ' + h.invalidClass : ''}${h.verdict ? ' ' + h.verdict : ''}`), '');
  L.push('## Cell chat counts', ...Object.entries(r.cellChats ?? {}).map(([k, v]) => `- ${k}: ${v} chats, replacements ${r.replacements?.[k] ?? 0}, floor/extension ${JSON.stringify(r.generator?.[k] ?? {})}`), '');
  if (r.status === 'VALID') {
    L.push('## 3. Cells (pack recall; d = engine minus the units baseline; both interval methods)');
    for (const row of r.rows) L.push(`- ${row.cell} ${row.style}: n ${row.n}, recall ${f3(row.recall)} [boot ${f3(row.recallCI.lo)}, ${f3(row.recallCI.hi)}; t ${f3(row.recallT.lo)}, ${f3(row.recallT.hi)}], d ${f3(row.d)} [boot ${f3(row.dCI.lo)}, ${f3(row.dCI.hi)}; t ${f3(row.dT.lo)}, ${f3(row.dT.hi)}], floor/margin ${row.ok ? 'met' : 'NOT met'}${row.borderline ? ' (BORDERLINE)' : ''}${row.reportOnly ? REPORT_ONLY_LABEL : ''}`);
    if (r.reportOnly) {
      L.push('', '## Report-only cells (MC-2627: reported, never gated; not part of the verdict, the controls or the ledger)');
      for (const [name, c] of Object.entries(r.reportOnly)) if (c.error) L.push(`- ${name}: failed: ${c.error}`); else for (const [style, s] of Object.entries(c.styles)) L.push(`- ${name} ${style}: ${c.chats} chats, n ${s.n}, recall ${f3(s.recall)} [boot ${f3(s.recallCI.lo)}, ${f3(s.recallCI.hi)}], d ${f3(s.d)} [boot ${f3(s.dCI.lo)}, ${f3(s.dCI.hi)}]`);
    }
    if (r.reportOnlyError || r.diagnosticsError) L.push('', `- after the verdict was recorded: ${r.reportOnlyError ? 'report-only cells failed: ' + r.reportOnlyError + '. ' : ''}${r.diagnosticsError ? 'diagnostics failed: ' + r.diagnosticsError + '.' : ''}`);
    L.push('', '## 4 to 7. Breakdowns, no-fact table, outputs, diagnostics', '```json', JSON.stringify({ breakdown: r.breakdown, nofact: r.nofact, tokens: r.tokens, diagnostics: r.diagnostics, settings: r.settings }, null, 1), '```');
    L.push('', 'Optional stopping makes the point estimates optimistic. Tune-predicted versus gate outcome and the synthetic-filler limitation (POOL versus DISJOINT) are in the diagnostics.');
  }
  return L.join('\n');
}

// Writes gate-report.json and gate-report.md into a directory outside the repository.
export function writeReport(outDir, result) {
  const real = assertOutsideRepo(outDir, 'the out dir');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'gate-report.json'), JSON.stringify(result, null, 1), 'utf8');
  fs.writeFileSync(path.join(real, 'gate-report.md'), renderReport(result), 'utf8');
  return real;
}
