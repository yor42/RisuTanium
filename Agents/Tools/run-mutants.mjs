/**
 * Mutant runner: proves that named vitest files fail when one source file is
 * deliberately broken, without ever writing to the repository.
 *
 * Usage (from anywhere inside the checkout or a worktree):
 *   node Agents/Tools/run-mutants.mjs --spec <spec.json> [--repo <root>] [--out <dir>] [--timeout-s N]
 *
 * Spec JSON:
 *   { "source": "src/ts/x.ts",
 *     "tests":  ["src/ts/x.test.ts"],
 *     "mutants": [ { "id": "M1", "find": "a < b", "replace": "a <= b",
 *                    "occurrence": 0, "note": "optional" } ] }
 *
 * Mechanism: the repository is never touched. A scratch vitest config (written
 * under --out) extends the repo's own vitest.config.ts and adds a Vite plugin
 * whose load() hook returns the mutated text when the module id equals the
 * absolute source path. The mutated text lives in memory and in a scratch JSON
 * state file. The scratch config also pins `include` to exactly the named test
 * files (never a folder or glob) and moves the Vite/vitest cache into --out, so
 * nothing is written under the repo or its node_modules.
 *
 * Flow: one baseline run with no mutant; if it is not green the tool stops with
 * exit 2. Then each valid mutant runs alone, one vitest process at a time.
 *
 * Matching: `find` is matched against the source text exactly as read from disk
 * (utf8, no normalisation). A CRLF file therefore needs "\r\n" inside multi-line
 * find/replace strings; a single-line find is unaffected. The find must occur
 * exactly once; otherwise the mutant is INVALID and not run. With `occurrence`
 * (0-based, non-overlapping matches counted left to right) the n-th match is
 * replaced and the find may repeat. A replace equal to the find is INVALID.
 *
 * The Vite load hook also writes a marker file into the run's scratch dir when
 * the source module is requested, so a source the named tests never load is
 * detected: the baseline stops with exit 2 ("source not loaded by the named
 * tests"), and a mutant run that did not load it is NOT-LOADED.
 *
 * Verdicts (read from vitest's JSON reporter; every row also carries the
 * passed/failed/skipped test counts):
 *   KILLED    failed tests > 0 (names listed), unless every failure is a
 *             transform/syntax/module-load error (then ERROR, see below).
 *   SURVIVED  at least one test passed, none failed, and the source was loaded.
 *   ERROR     no failed test but the run is not green: a collection, import or
 *             transform error (failed suites / file-level failure), zero passed
 *             tests (none ran, or all skipped), or no readable JSON. Also ERROR:
 *             failed tests whose every failureMessage is a transform, syntax,
 *             parse or module-load error (for example "Transform failed",
 *             "SyntaxError", "Failed to load url", "Failed to resolve import",
 *             "Cannot find module"): a mutant that cannot be compiled or
 *             imported is not proof that a test detects behaviour. A failure
 *             whose message is anything else (an assertion, "x is not a
 *             function", a fast-check "Property failed" wrapper) stays KILLED.
 *   NOT-LOADED the run never requested the source module, so the tests cannot
 *             have exercised the mutant.
 *   INVALID   find missing, ambiguous, occurrence out of range, or no-op replace.
 *   TIMEOUT   exceeded --timeout-s (default 240); only the process tree this
 *             tool started is killed.
 *
 * Output: a table on stdout, results.json and per-run logs in --out (default
 * %TEMP%\risu-mutants\<timestamp>; a dir inside the repo is refused).
 * Exit: 0 only when every listed mutant is KILLED (an INVALID mutant is a spec
 * mistake and also gives 1, so it cannot pass silently), 1 otherwise,
 * 2 baseline failure or usage error.
 *
 * No install, no network. node_modules (possibly a junction in a worktree) is
 * resolved read-only. Never point this at a whole folder of tests such as
 * Agents/Tools/save-gen/, whose harness rewrites tracked goldens.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function usage(message) {
    if (message) console.error(`run-mutants: ${message}`)
    console.error('usage: node Agents/Tools/run-mutants.mjs --spec <spec.json> [--repo <root>] [--out <dir>] [--timeout-s N]')
    process.exit(2)
}

function parseArgs(argv) {
    const opts = { spec: null, repo: null, out: null, timeoutS: 240 }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        const value = () => {
            if (i + 1 >= argv.length) usage(`${arg} needs a value`)
            return argv[++i]
        }
        if (arg === '--spec') opts.spec = value()
        else if (arg === '--repo') opts.repo = value()
        else if (arg === '--out') opts.out = value()
        else if (arg === '--timeout-s') opts.timeoutS = Number(value())
        else usage(`unknown argument ${arg}`)
    }
    if (!opts.spec) usage('--spec is required')
    if (!Number.isFinite(opts.timeoutS) || opts.timeoutS <= 0) usage('--timeout-s must be a positive number')
    return opts
}

function norm(p) {
    const resolved = path.resolve(p).replace(/\\/g, '/')
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInside(parent, child) {
    const rel = path.relative(path.resolve(parent), path.resolve(child))
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function findMatches(text, find) {
    const positions = []
    let from = 0
    for (;;) {
        const at = text.indexOf(find, from)
        if (at < 0) break
        positions.push(at)
        from = at + find.length
    }
    return positions
}

function buildMutant(sourceText, mutant) {
    if (typeof mutant.id !== 'string' || typeof mutant.find !== 'string' || typeof mutant.replace !== 'string' || mutant.find === '') {
        return { invalid: 'mutant needs string id, non-empty find and string replace' }
    }
    if (mutant.find === mutant.replace) return { invalid: 'replace equals find (no-op)' }
    const positions = findMatches(sourceText, mutant.find)
    if (positions.length === 0) {
        const hint = mutant.find.includes('\n') && !mutant.find.includes('\r') && sourceText.includes('\r\n')
            ? ' (source is CRLF: use \\r\\n in a multi-line find)' : ''
        return { invalid: `find not present${hint}` }
    }
    let index = 0
    if (mutant.occurrence === undefined) {
        if (positions.length !== 1) return { invalid: `find matches ${positions.length} times; set occurrence (0-based) to pick one` }
    } else {
        if (!Number.isInteger(mutant.occurrence) || mutant.occurrence < 0 || mutant.occurrence >= positions.length) {
            return { invalid: `occurrence ${mutant.occurrence} out of range (${positions.length} matches)` }
        }
        index = mutant.occurrence
    }
    const at = positions[index]
    return { text: sourceText.slice(0, at) + mutant.replace + sourceText.slice(at + mutant.find.length) }
}

function killTree(child) {
    if (!child.pid) return
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
}

function runVitest(ctx, label, mutatedText) {
    const dir = path.join(ctx.out, label)
    fs.mkdirSync(dir, { recursive: true })
    const statePath = path.join(dir, 'state.json')
    const jsonPath = path.join(dir, 'vitest.json')
    const configPath = path.join(dir, 'vitest.mutant.config.mts')
    const markerPath = path.join(dir, 'loaded.marker')
    // A reused --out must not leak the previous run's report or load marker into this run.
    fs.rmSync(jsonPath, { force: true })
    fs.rmSync(markerPath, { force: true })
    fs.writeFileSync(statePath, JSON.stringify({
        root: ctx.repo,
        target: ctx.sourceAbs,
        marker: markerPath,
        text: mutatedText,
        include: ctx.tests,
        cacheDir: path.join(ctx.out, '.cache'),
    }))
    fs.writeFileSync(configPath, ctx.configSource)
    const args = [
        ctx.vitestBin, 'run', '--config', configPath, '--reporter=json', `--outputFile=${jsonPath}`,
        '--no-watch', '--passWithNoTests=false', ...ctx.tests,
    ]
    const started = Date.now()
    return new Promise((resolve) => {
        const log = fs.createWriteStream(path.join(dir, 'vitest.log'))
        const child = spawn(process.execPath, args, {
            cwd: ctx.repo,
            env: { ...process.env, RISU_MUTANT_STATE: statePath, CI: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            windowsHide: true,
        })
        child.stdout.pipe(log, { end: false })
        child.stderr.pipe(log, { end: false })
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true; killTree(child) }, ctx.timeoutS * 1000)
        child.on('close', (code) => {
            clearTimeout(timer)
            log.end()
            resolve({ code, timedOut, ms: Date.now() - started, jsonPath, loaded: fs.existsSync(markerPath), logPath: path.join(dir, 'vitest.log') })
        })
        child.on('error', () => {
            clearTimeout(timer)
            log.end()
            resolve({ code: null, timedOut: false, ms: Date.now() - started, jsonPath, loaded: fs.existsSync(markerPath), logPath: path.join(dir, 'vitest.log'), spawnError: true })
        })
    })
}

const LOAD_ERROR_PATTERN = /Transform failed|SyntaxError|ParseError|PARSE_ERROR|Failed to parse|Failed to load url|Failed to resolve import|Cannot find module|Error when evaluating SSR module|Unexpected token/

// Pure: maps one run (timeout flag, report path, loaded flag) to a verdict. Exported for the scratch falsification script.
export function classify(run) {
    const none = { passed: null, failed: null, skipped: null }
    if (run.timedOut) return { verdict: 'TIMEOUT', failing: [], detail: 'timed out', ...none }
    let report = null
    try { report = JSON.parse(fs.readFileSync(run.jsonPath, 'utf8')) } catch { /* handled below */ }
    if (!report) return { verdict: 'ERROR', failing: [], detail: `no readable JSON report (exit ${run.code}); see ${run.logPath}`, ...none }
    const failing = []
    const failureMessages = []
    for (const file of report.testResults ?? []) {
        for (const test of file.assertionResults ?? []) {
            if (test.status === 'failed') {
                failing.push(test.fullName ?? test.title)
                failureMessages.push((test.failureMessages ?? []).join('\n'))
            }
        }
    }
    const counts = {
        passed: report.numPassedTests ?? 0,
        failed: report.numFailedTests ?? failing.length,
        skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    }
    if (!run.loaded) return { verdict: 'NOT-LOADED', failing: [], detail: 'the source module was never requested by the named tests', ...counts }
    if (failing.length > 0) {
        if (failureMessages.every((message) => LOAD_ERROR_PATTERN.test(message))) {
            return { verdict: 'ERROR', failing: [], detail: `every failing test is a transform/syntax/module-load error: ${failureMessages[0].split('\n')[0]}`, ...counts }
        }
        return { verdict: 'KILLED', failing, detail: '', ...counts }
    }
    if (counts.passed === 0) {
        return { verdict: 'ERROR', failing: [], detail: `zero passed tests (${counts.skipped} skipped; collection or import error?)`, ...counts }
    }
    if (report.numFailedTestSuites > 0 || report.success === false) {
        const message = (report.testResults ?? []).find((file) => file.status === 'failed')?.message ?? ''
        return { verdict: 'ERROR', failing: [], detail: `suite-level failure without a failed test: ${message.split('\n')[0]}`, ...counts }
    }
    return { verdict: 'SURVIVED', failing: [], detail: '', ...counts }
}

function printTable(rows) {
    const header = ['id', 'verdict', 'ms', 'p/f/s', 'failing tests / detail']
    const body = rows.map((row) => [
        row.id,
        row.verdict,
        row.ms === null ? '-' : String(row.ms),
        row.passed === null || row.passed === undefined ? '-' : `${row.passed}/${row.failed}/${row.skipped}`,
        row.failing.length > 0 ? row.failing.join(' | ') : (row.detail || ''),
    ])
    const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)))
    const fmt = (cells) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ')
    console.log(fmt(header))
    console.log(widths.map((w, i) => (i === widths.length - 1 ? '-'.repeat(Math.min(w, 60)) : '-'.repeat(w))).join('  '))
    for (const row of body) console.log(fmt(row))
}

async function main() {
    const opts = parseArgs(process.argv.slice(2))

    let repo = opts.repo
    if (!repo) {
        const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
        if (top.status !== 0) usage('not inside a git checkout; pass --repo')
        repo = top.stdout.trim()
    }
    repo = path.resolve(repo)

    let spec
    try { spec = JSON.parse(fs.readFileSync(path.resolve(opts.spec), 'utf8')) } catch (error) { usage(`cannot read spec: ${error.message}`) }
    if (typeof spec.source !== 'string' || !Array.isArray(spec.tests) || spec.tests.length === 0 || !Array.isArray(spec.mutants)) {
        usage('spec needs source (string), tests (non-empty array) and mutants (array)')
    }
    for (const test of spec.tests) {
        if (typeof test !== 'string' || /[*?{}[\]]/.test(test) || !/\.(test|spec)\.[cm]?[jt]sx?$/.test(test)) {
            usage(`tests must be explicit test file paths, not folders or globs: ${test}`)
        }
    }

    const sourceAbs = path.resolve(repo, spec.source)
    if (!isInside(repo, sourceAbs) || !fs.existsSync(sourceAbs)) usage(`source not found inside repo: ${spec.source}`)
    const testsAbs = spec.tests.map((test) => path.resolve(repo, test))
    for (const test of testsAbs) if (!isInside(repo, test) || !fs.existsSync(test)) usage(`test file not found inside repo: ${test}`)

    const vitestBin = path.join(repo, 'node_modules', 'vitest', 'vitest.mjs')
    const vitestConfigApi = path.join(repo, 'node_modules', 'vitest', 'dist', 'config.js')
    const repoConfig = path.join(repo, 'vitest.config.ts')
    for (const needed of [vitestBin, vitestConfigApi, repoConfig]) if (!fs.existsSync(needed)) usage(`missing ${needed}`)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const out = path.resolve(opts.out ?? path.join(os.tmpdir(), 'risu-mutants', stamp))
    if (isInside(repo, out)) usage('--out must be outside the repository')
    fs.mkdirSync(out, { recursive: true })

    const sourceText = fs.readFileSync(sourceAbs, 'utf8')
    const mutatedIds = new Set()
    for (const mutant of spec.mutants) {
        if (mutatedIds.has(mutant.id)) usage(`duplicate mutant id ${mutant.id}`)
        mutatedIds.add(mutant.id)
    }

    // Absolute specifiers keep the scratch config independent of any node_modules next to it.
    const importPath = (p) => JSON.stringify(p.replace(/\\/g, '/'))
    const configSource = [
        `import { mergeConfig } from ${importPath(vitestConfigApi)}`,
        `import base from ${importPath(repoConfig)}`,
        `import fs from 'node:fs'`,
        `const state = JSON.parse(fs.readFileSync(process.env.RISU_MUTANT_STATE, 'utf8'))`,
        `const norm = (p) => { const r = p.split('?')[0].replace(/\\\\/g, '/'); return process.platform === 'win32' ? r.toLowerCase() : r }`,
        `const target = norm(state.target)`,
        `const mutantPlugin = {`,
        `    name: 'risu-mutant',`,
        `    enforce: 'pre',`,
        `    load(id) {`,
        `        if (norm(id) !== target) return null`,
        `        fs.writeFileSync(state.marker, '1')`,
        `        return state.text`,
        `    },`,
        `}`,
        `export default mergeConfig(base, {`,
        `    root: state.root,`,
        `    cacheDir: state.cacheDir,`,
        `    plugins: [mutantPlugin],`,
        `    test: { include: state.include },`,
        `})`,
        ``,
    ].join('\n')

    const ctx = { repo, out, sourceAbs, tests: spec.tests, vitestBin, configSource, timeoutS: opts.timeoutS }
    const wallStart = Date.now()
    console.log(`repo: ${repo}`)
    console.log(`source: ${spec.source}   tests: ${spec.tests.length}   mutants: ${spec.mutants.length}   out: ${out}`)

    const baselineRun = await runVitest(ctx, 'baseline', null)
    const baseline = classify(baselineRun)
    const rows = []
    const writeResults = (exitCode) => {
        fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({
            repo, source: spec.source, tests: spec.tests, out,
            baseline: {
                verdict: baseline.verdict === 'SURVIVED' ? 'GREEN' : baseline.verdict, ms: baselineRun.ms, failing: baseline.failing, detail: baseline.detail,
                passed: baseline.passed, failed: baseline.failed, skipped: baseline.skipped, loaded: baselineRun.loaded,
            },
            mutants: rows, wallMs: Date.now() - wallStart, exitCode,
        }, null, 2))
    }
    if (baseline.verdict !== 'SURVIVED') {
        if (baseline.verdict === 'NOT-LOADED') {
            console.error(`BASELINE: source not loaded by the named tests (${spec.source}); no mutant of it can be tested by them`)
        } else {
            console.error(`BASELINE NOT GREEN: ${baseline.verdict} ${baseline.failing.join(' | ')} ${baseline.detail}`)
        }
        console.error(`log: ${baselineRun.logPath}`)
        writeResults(2)
        process.exit(2)
    }
    console.log(`baseline: green (${baselineRun.ms} ms; ${baseline.passed} passed, ${baseline.failed} failed, ${baseline.skipped} skipped)\n`)

    for (const mutant of spec.mutants) {
        const built = buildMutant(sourceText, mutant)
        if (built.invalid) {
            rows.push({ id: mutant.id, verdict: 'INVALID', failing: [], detail: built.invalid, ms: null, note: mutant.note ?? null })
            continue
        }
        const run = await runVitest(ctx, `mutant-${mutant.id.replace(/[^\w.-]/g, '_')}`, built.text)
        const result = classify(run)
        rows.push({
            id: mutant.id, verdict: result.verdict, failing: result.failing, detail: result.detail, ms: run.ms, note: mutant.note ?? null,
            passed: result.passed, failed: result.failed, skipped: result.skipped, loaded: run.loaded,
        })
    }

    printTable(rows)
    const allKilled = rows.length > 0 && rows.every((row) => row.verdict === 'KILLED')
    const exitCode = allKilled ? 0 : 1
    console.log(`\nwall: ${Date.now() - wallStart} ms   results: ${path.join(out, 'results.json')}`)
    writeResults(exitCode)
    process.exit(exitCode)
}

// Importing this file (the scratch falsification script) must not start a run.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`run-mutants: ${error.stack ?? error}`)
        process.exit(2)
    })
}
