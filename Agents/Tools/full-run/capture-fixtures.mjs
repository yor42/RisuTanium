/**
 * Captures the classifier fixtures from real vitest runs.
 *
 * Usage: node Agents/Tools/full-run/capture-fixtures.mjs <outDir>
 *
 * Synthetic spec sources (held below as strings) are written into a fresh scratch
 * project outside every repository and run through the installed vitest with the real
 * fullrun-reporter. The scratch root is replaced by <ROOT> in each summary. Committed
 * spec files never exist, so nothing here enters `pnpm test`. A vitest upgrade
 * requires running this again: the classifier depends on the reporter summary shape
 * and on vitest's message text.
 *
 * An outDir inside a git checkout is refused unless it is exactly this checkout's
 * Agents/Tools/full-run/fixtures.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..')
const reporter = path.join(here, 'fullrun-reporter.mjs')
const vitestBin = path.join(repo, 'node_modules', 'vitest', 'vitest.mjs')

const TARGET = 'target.spec.mjs'
const HANG_TIMEOUT = "it('t', () => new Promise(() => {}), 50)"
const timeoutFiles = (count) => Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`f${String(index + 1).padStart(2, '0')}.spec.mjs`, HANG_TIMEOUT]),
)

// name -> { files, filter? }. Every case that a rerun fixture pairs with uses the TARGET file name.
const CASES = {
    'all-pass': { files: { [TARGET]: "it('ok', () => {})" } },
    'test-timeout': { files: { [TARGET]: HANG_TIMEOUT } },
    'assertion': { files: { [TARGET]: "it('a', () => { expect(1).toBe(2) })" } },
    'assert-quotes-timeout': { files: { [TARGET]: "it('q', () => { expect('x').toBe('Test timed out in 5ms.') })" } },
    'collect-error': { files: { [TARGET]: "import './does-not-exist.mjs'; it('c', () => {})" } },
    'describe-hook-timeout': { files: { [TARGET]: "describe('d', () => { beforeAll(() => new Promise(() => {}), 50); it('a', () => {}) })" } },
    'top-hook-timeout': { files: { [TARGET]: "beforeAll(() => new Promise(() => {}), 50); it('a', () => {})" } },
    'mixed-timeout-assertion': { files: { [TARGET]: `${HANG_TIMEOUT}\nit('a', () => { expect(1).toBe(2) })` } },
    'unhandled-after-pass': { files: { [TARGET]: "it('u', () => { setTimeout(() => { throw new Error('late boom') }, 1); return new Promise((r) => setTimeout(r, 30)) })" } },
    'top-afterall-plus-timeout': { files: { [TARGET]: `${HANG_TIMEOUT}; afterAll(() => { throw new Error('teardown broke') })` } },
    'describe-afterall-plus-timeout': { files: { [TARGET]: "describe('d', () => { it('t', () => new Promise(() => {}), 50); afterAll(() => { throw new Error('suite teardown broke') }) })" } },
    'throw-empty-object': { files: { [TARGET]: "it('o', () => { throw {} })" } },
    'two-failed-files': { files: { 'a.spec.mjs': HANG_TIMEOUT, 'b.spec.mjs': HANG_TIMEOUT } },
    'mass-11-timeouts': { files: timeoutFiles(11) },
    'rerun-pass': { files: { [TARGET]: "it('ok', () => {})" }, filter: TARGET },
    'rerun-zero-tests': { files: { [TARGET]: "it.skip('s', () => {})" }, filter: TARGET },
    'rerun-two-files': { files: { 'x1.spec.mjs': "it('ok', () => {})", 'x2.spec.mjs': "it('ok', () => {})" }, filter: 'spec' },
}

function usage(message) {
    if (message) console.error(`capture-fixtures: ${message}`)
    console.error('usage: node Agents/Tools/full-run/capture-fixtures.mjs <outDir>')
    process.exit(2)
}

function insideGitCheckout(dir) {
    let current = path.resolve(dir)
    for (;;) {
        if (fs.existsSync(path.join(current, '.git'))) return true
        const parent = path.dirname(current)
        if (parent === current) return false
        current = parent
    }
}

function replaceRoot(text, root) {
    const forward = root.replace(/\\/g, '/')
    const escaped = JSON.stringify(root).slice(1, -1)
    return [forward, escaped, root]
        .reduce((accumulated, variant) => accumulated.split(variant).join('<ROOT>'), text)
}

function main() {
    const outArg = process.argv[2]
    if (!outArg || process.argv.length > 3) usage('exactly one <outDir> is required')
    const outDir = path.resolve(outArg)
    const allowed = path.join(repo, 'Agents', 'Tools', 'full-run', 'fixtures')
    if (insideGitCheckout(outDir) && outDir.toLowerCase() !== allowed.toLowerCase()) {
        usage(`refusing outDir inside a git checkout: ${outDir}`)
    }
    for (const needed of [vitestBin, reporter]) if (!fs.existsSync(needed)) usage(`missing ${needed}`)
    fs.mkdirSync(outDir, { recursive: true })

    const vitestVersion = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', 'vitest', 'package.json'), 'utf8')).version
    const meta = { schema: 1, vitestVersion, nodeVersion: process.version, cases: {} }
    for (const [name, spec] of Object.entries(CASES)) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-fullrun-capture-'))
        try {
            fs.writeFileSync(path.join(root, 'vitest.config.mjs'),
                "export default { test: { globals: true, environment: 'node', include: ['*.spec.mjs'] } }\n")
            for (const [file, source] of Object.entries(spec.files)) fs.writeFileSync(path.join(root, file), `${source}\n`)
            const summaryPath = path.join(root, 'summary.raw.json')
            const args = [
                vitestBin, 'run', ...(spec.filter ? [spec.filter] : []),
                '--root', root, '--config', path.join(root, 'vitest.config.mjs'), '--maxWorkers=2',
                '--reporter=default', `--reporter=${reporter}`,
            ]
            const run = spawnSync(process.execPath, args, {
                cwd: root, encoding: 'utf8', env: { ...process.env, RISU_FULLRUN_SUMMARY: summaryPath }, timeout: 180_000, windowsHide: true,
            })
            if (!fs.existsSync(summaryPath)) usage(`case ${name}: vitest produced no summary (exit ${run.status})`)
            const text = replaceRoot(fs.readFileSync(summaryPath, 'utf8'), root)
            if (text.includes(path.basename(root))) usage(`case ${name}: scratch path leaked into the summary`)
            fs.writeFileSync(path.join(outDir, `${name}.summary.json`), text.endsWith('\n') ? text : `${text}\n`)
            meta.cases[name] = {
                exitCode: run.status,
                files: Object.keys(spec.files),
                command: ['node', '<REPO>/node_modules/vitest/vitest.mjs', 'run', ...(spec.filter ? [spec.filter] : []),
                    '--root', '<ROOT>', '--config', '<ROOT>/vitest.config.mjs', '--maxWorkers=2', '--reporter=default',
                    '--reporter=<REPO>/Agents/Tools/full-run/fullrun-reporter.mjs'].join(' '),
            }
            console.log(`${name}: exit ${run.status}`)
        } finally {
            fs.rmSync(root, { recursive: true, force: true })
        }
    }
    fs.writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
    console.log(`wrote ${Object.keys(CASES).length} summaries and meta.json to ${outDir}`)
}

main()
