// The only supported way to run the analyzer on a real `.bin`. The harness runs as a child process whose stdio is
// discarded, so nothing it prints (the application logs block names and error messages on the import path) can reach
// a terminal. This launcher reads no output file and prints exactly one fixed line with the child's exit code.
//
// Environment: LTM_ROOT, LTM_BIN, LTM_OUT (required); LTM_HEAP_MIB (optional, the child's old-space size);
// LTM_REPO_ROOT (optional, a repository copy to run from; default: three levels above this file).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.LTM_REPO_ROOT ? path.resolve(process.env.LTM_REPO_ROOT) : path.resolve(here, '..', '..', '..');
const evalDir = path.join(repo, 'Agents', 'Tools', 'ltm-eval');

for (const name of ['LTM_ROOT', 'LTM_BIN', 'LTM_OUT']) {
  if (!process.env[name]) { console.log('ltm-eval real run: missing ' + name); process.exit(2); }
}

const env = { ...process.env, LTM_SEALED: '1' };
delete env.LTM_IMPL_DIR;
if (process.env.LTM_HEAP_MIB) env.NODE_OPTIONS = '--max-old-space-size=' + process.env.LTM_HEAP_MIB;

const child = spawnSync(process.execPath, [
  path.join(repo, 'node_modules', 'vitest', 'vitest.mjs'), 'run',
  '--config', path.join(evalDir, 'vitest.ltm.config.ts'),
  path.join(evalDir, 'bin-analyzer.harness.ts'),
  '-t', 'ltm real run',
], { cwd: repo, stdio: 'ignore', env });

const code = child.status === null ? 1 : child.status;
console.log('ltm-eval real run: exit ' + code);
process.exit(code);
