
// The only supported way to run the analyzer on a real `.bin`. The harness runs as a child process whose stdio is
// discarded, so nothing it prints (the application logs block names and error messages on the import path) can reach
// a terminal. This launcher reads no output file and prints exactly one fixed line with a launcher exit code.
//
// Environment: LTM_ROOT, LTM_BIN, LTM_OUT (required); LTM_HEAP_MIB (optional, the child's old-space size);
// LTM_REPO_ROOT (optional, a repository copy to run from; default: three levels above this file).
//
// Exit codes (the launcher's own; the child's status is mapped, never passed through):
//   0 the analysis completed       1 the test failed or the worker crashed (ltm-status.json says how far it got)
//   2 a required variable is missing   3 the path guard refused the layout (nothing was spawned or written)
//   4 launcher-side failure: a signal, a spawn failure, or an exception in the launcher itself
//   5 the child ended with any other status   134 the child's main process aborted (for example out of memory)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function finish(code) {
  console.log('ltm-eval real run: exit ' + code);
  process.exit(code);
}

/** The launcher code for a child status: only 0, 1 and 134 keep their value; a signal or spawn failure is 4. */
function mapChildStatus(child) {
  if (child.error || child.status === null) return 4;
  if (child.status === 0 || child.status === 1 || child.status === 134) return child.status;
  return 5;
}

try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = process.env.LTM_REPO_ROOT ? path.resolve(process.env.LTM_REPO_ROOT) : path.resolve(here, '..', '..', '..');
  const evalDir = path.join(repo, 'Agents', 'Tools', 'ltm-eval');

  for (const name of ['LTM_ROOT', 'LTM_BIN', 'LTM_OUT']) {
    if (!process.env[name]) { console.log('ltm-eval real run: missing ' + name); process.exit(2); }
  }

  // One base for the guard, the stale-file removal and the child: the child gets absolute paths, so it cannot
  // resolve a relative path against a different directory (its cwd is the repository).
  const root = path.resolve(process.env.LTM_ROOT);
  const bin = path.resolve(process.env.LTM_BIN);
  const out = path.resolve(process.env.LTM_OUT);

  const { checkRunPaths } = await import(pathToFileURL(path.join(evalDir, 'analyzer', 'runPaths.mjs')).href);
  if (checkRunPaths({ bin, out, root, repoRoot: repo }).length > 0) finish(3);

  // A stale result of an earlier run must not sit beside this run's status.
  fs.rmSync(path.join(out, 'ltm-status.json'), { force: true });
  fs.rmSync(path.join(out, 'ltm-aggregates.json'), { force: true });

  const env = { ...process.env, LTM_ROOT: root, LTM_BIN: bin, LTM_OUT: out, LTM_SEALED: '1' };
  delete env.LTM_IMPL_DIR;
  if (process.env.LTM_HEAP_MIB) env.NODE_OPTIONS = '--max-old-space-size=' + process.env.LTM_HEAP_MIB;

  const child = spawnSync(process.execPath, [
    path.join(repo, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
    '--config', path.join(evalDir, 'vitest.ltm.config.ts'),
    path.join(evalDir, 'bin-analyzer.harness.ts'),
    '-t', 'ltm real run',
  ], { cwd: repo, stdio: 'ignore', env });

  finish(mapChildStatus(child));
} catch {
  finish(4);
}
