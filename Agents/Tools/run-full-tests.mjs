/**
 * Full-suite runner: takes the machine-wide cooperative lock, runs the whole vitest
 * suite with a worker cap, reruns each failed file alone once, classifies the result
 * and writes a scratch record. Windows only.
 *
 * Usage:
 *   node Agents/Tools/run-full-tests.mjs [--repo <root>] [--out <dir>] [--max-workers N]
 *        [--max-wait-min M] [--timeout-min T] [--flake-list <file>] [--lock-dir <dir>]
 *        [--vitest-bin <file>]
 *
 * Exit codes: 0 PASS, 1 FAIL or FAIL-ERROR, 2 usage/setup or unsupported platform,
 * 3 PASS-RECOVERED, 4 BLOCKED. The last stdout line is
 *   FULLRUN <verdict> exit=<code> record=<path>
 * A PASS-RECOVERED run never exits 0 and keeps the first-run failure in the record.
 *
 * The run environment differs from a plain `vitest run` only by --maxWorkers, one added
 * reporter and the RISU_FULLRUN_SUMMARY variable that only that reporter reads. The
 * lock is cooperative: only runs started through this helper are serialised, and no
 * process this tool did not start is ever signalled.
 */
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyFirstRun, classifyRerun, fileVerdict, loadFlakeList, overallVerdict } from './full-run/classify.mjs'
import { acquireLock, defaultLockDir, DEFAULT_MAX_WAIT_MS, probeProcess, releaseLock, updateLockChild } from './full-run/lock.mjs'

export const DEFAULT_MAX_WORKERS = 8
const DEFAULT_TIMEOUT_MIN = 90
const RERUN_TIMEOUT_MS = 10 * 60_000
const UNTRACKED_HASH_LIMIT = 5 * 1024 * 1024

const here = path.dirname(fileURLToPath(import.meta.url))
const reporterPath = path.join(here, 'full-run', 'fullrun-reporter.mjs')

function usage(message) {
    if (message) console.error(`run-full-tests: ${message}`)
    console.error('usage: node Agents/Tools/run-full-tests.mjs [--repo <root>] [--out <dir>] [--max-workers N] [--max-wait-min M] [--timeout-min T] [--flake-list <file>] [--lock-dir <dir>] [--vitest-bin <file>]')
    process.exit(2)
}

function parseArgs(argv) {
    const opts = { repo: null, out: null, maxWorkers: DEFAULT_MAX_WORKERS, maxWaitMin: DEFAULT_MAX_WAIT_MS / 60_000, timeoutMin: DEFAULT_TIMEOUT_MIN, flakeList: null, lockDir: null, vitestBin: null }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        const value = () => {
            if (i + 1 >= argv.length) usage(`${arg} needs a value`)
            return argv[++i]
        }
        if (arg === '--repo') opts.repo = value()
        else if (arg === '--out') opts.out = value()
        else if (arg === '--max-workers') opts.maxWorkers = Number(value())
        else if (arg === '--max-wait-min') opts.maxWaitMin = Number(value())
        else if (arg === '--timeout-min') opts.timeoutMin = Number(value())
        else if (arg === '--flake-list') opts.flakeList = value()
        else if (arg === '--lock-dir') opts.lockDir = value()
        else if (arg === '--vitest-bin') opts.vitestBin = value()
        else usage(`unknown argument ${arg}`)
    }
    if (!Number.isInteger(opts.maxWorkers) || opts.maxWorkers < 1) usage('--max-workers must be a positive integer')
    if (!Number.isFinite(opts.maxWaitMin) || opts.maxWaitMin < 0) usage('--max-wait-min must be a non-negative number')
    if (!Number.isFinite(opts.timeoutMin) || opts.timeoutMin <= 0) usage('--timeout-min must be a positive number')
    return opts
}

function isInside(parent, child) {
    const rel = path.relative(path.resolve(parent), path.resolve(child))
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function git(repo, args) {
    return spawnSync('git', ['--no-optional-locks', '-C', repo, ...args], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, windowsHide: true })
}

function snapshot(repo) {
    const text = (args) => {
        const result = git(repo, args)
        return result.status === 0 ? result.stdout.toString('utf8') : null
    }
    const head = text(['rev-parse', 'HEAD'])
    const status = text(['status', '--porcelain=v1', '-z'])
    const diff = git(repo, ['diff', 'HEAD', '--binary'])
    const untrackedRaw = text(['ls-files', '--others', '--exclude-standard', '-z'])
    const untracked = (untrackedRaw ?? '').split('\0').filter(Boolean).map((file) => {
        const full = path.join(repo, file)
        try {
            const stat = fs.statSync(full)
            const sha256 = stat.size <= UNTRACKED_HASH_LIMIT ? crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') : null
            return { file, size: stat.size, sha256 }
        } catch {
            return { file, size: null, sha256: null }
        }
    })
    return {
        head: head ? head.trim() : null,
        statusEntries: status === null ? null : status.split('\0').filter(Boolean),
        diffSha256: diff.status === 0 ? crypto.createHash('sha256').update(diff.stdout).digest('hex') : null,
        untracked,
    }
}

function nodeProcessCount() {
    const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
    if (result.status !== 0) return null
    return result.stdout.split('\n').filter((line) => /^"node\.exe"/i.test(line)).length
}

function killTree(child) {
    if (!child.pid) return
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

function readSummary(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

// Runs vitest as a child of this tool under the lock. A summary left by an earlier run is removed first.
function runVitest({ repo, vitestBin, args, summaryPath, logPath, timeoutMs, lockHandle, current }) {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true })
    fs.rmSync(summaryPath, { force: true })
    const started = Date.now()
    return new Promise((resolve) => {
        const log = fs.createWriteStream(logPath)
        const child = spawn(process.execPath, [vitestBin, 'run', ...args, '--reporter=default', `--reporter=${reporterPath}`], {
            cwd: repo,
            env: { ...process.env, RISU_FULLRUN_SUMMARY: summaryPath },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        })
        current.child = child
        const tee = (stream, target) => stream.on('data', (chunk) => { log.write(chunk); target.write(chunk) })
        tee(child.stdout, process.stdout)
        tee(child.stderr, process.stderr)
        let timedOut = false
        const timer = setTimeout(() => { timedOut = true; killTree(child) }, timeoutMs)
        const finish = (code, spawnError) => {
            clearTimeout(timer)
            current.child = null
            log.end()
            resolve({ exitCode: code, timedOut, spawnError, ms: Date.now() - started, summary: readSummary(summaryPath), logPath })
        }
        child.on('close', (code) => finish(code, false))
        child.on('error', () => finish(null, true))
        if (child.pid) {
            const childProbe = probeProcess(child.pid)
            const startTime = childProbe.state === 'ALIVE' ? childProbe.startTime : null
            updateLockChild(lockHandle, { pid: child.pid, startTime }).catch(() => {})
        }
    })
}

function writeRecord(out, record) {
    fs.mkdirSync(out, { recursive: true })
    const jsonPath = path.join(out, 'fullrun-record.json')
    fs.writeFileSync(jsonPath, `${JSON.stringify(record, null, 2)}\n`)
    const lines = [`${record.verdict}`, '', `- exit code: ${record.exitCode}`, `- repo: ${record.repo}`, `- head: ${record.snapshot?.head ?? 'unknown'}`,
        `- max workers: ${record.maxWorkers}`, `- lock: ${record.lock.status}${record.lock.nonDefault ? ' (non-default lock dir)' : ''}, waited ${record.lock.waitedMs} ms`]
    if (record.lock.holder) lines.push(`- blocked by pid ${record.lock.holder.pid}, start time ${record.lock.holder.startTime}`)
    if (record.lock.reason) lines.push(`- blocked reason: ${record.lock.reason}`)
    if (record.first) lines.push(`- first run: ${record.first.kind}${record.first.reason ? ` (${record.first.reason})` : ''}, ${record.first.ms} ms, exit ${record.first.exitCode}`)
    for (const entry of record.files ?? []) lines.push(`- ${entry.path}: ${entry.category} -> ${entry.verdict}${entry.rerunReason ? ` (${entry.rerunReason})` : ''}`)
    fs.writeFileSync(path.join(out, 'fullrun-record.md'), `${lines.join('\n')}\n`)
    return jsonPath
}

async function main() {
    if (process.platform !== 'win32') usage('unsupported platform: the lock probe needs Windows')
    const opts = parseArgs(process.argv.slice(2))
    let repo = opts.repo
    if (!repo) {
        const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })
        if (top.status !== 0) usage('not inside a git checkout; pass --repo')
        repo = top.stdout.trim()
    }
    repo = path.resolve(repo)
    const vitestBin = path.resolve(opts.vitestBin ?? path.join(repo, 'node_modules', 'vitest', 'vitest.mjs'))
    if (!fs.existsSync(vitestBin)) usage(`missing ${vitestBin}`)
    const flakePath = path.resolve(opts.flakeList ?? path.join(repo, 'Agents', 'Tools', 'full-run', 'flake-list.json'))
    let flakeSet
    try { flakeSet = loadFlakeList(flakePath) } catch (error) { usage(`cannot read flake list: ${error.message}`) }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const out = path.resolve(opts.out ?? path.join(os.tmpdir(), 'risu-fullrun', stamp))
    if (isInside(repo, out)) usage('--out must be outside the repository')
    fs.mkdirSync(out, { recursive: true })

    const record = {
        schema: 1, startedAt: new Date().toISOString(), repo, out, maxWorkers: opts.maxWorkers, flakeList: flakePath,
        snapshot: snapshot(repo), runtime: null, lock: null, first: null, files: [], verdict: null, exitCode: null,
    }
    const finishWith = (verdict, exitCode) => {
        record.verdict = verdict
        record.exitCode = exitCode
        record.finishedAt = new Date().toISOString()
        const jsonPath = writeRecord(out, record)
        console.log(`FULLRUN ${verdict} exit=${exitCode} record=${jsonPath}`)
        return exitCode
    }

    const self = probeProcess(process.pid)
    if (self.state !== 'ALIVE') usage('cannot read this process start time')
    const lockDir = path.resolve(opts.lockDir ?? defaultLockDir())
    const acquired = await acquireLock({
        dir: lockDir,
        identity: { pid: process.pid, startTime: self.startTime, cwd: process.cwd(), repo, head: record.snapshot.head },
        maxWaitMs: opts.maxWaitMin * 60_000,
        onWait: (info) => console.log(`waiting for the full-run lock: pid ${info.holder?.pid} since ${info.holder?.startTime}, cwd ${info.holder?.cwd}, head ${info.holder?.head} (${info.reason}, ${Math.round(info.waitedMs / 1000)} s)`),
    })
    record.lock = {
        status: acquired.status, dir: lockDir, nonDefault: Boolean(opts.lockDir), waitedMs: acquired.waitedMs,
        reclaimed: acquired.reclaimed ?? [], holder: acquired.holder ?? null, reason: acquired.reason ?? null, guard: acquired.guard ?? null,
    }
    if (acquired.status !== 'ACQUIRED') return finishWith('BLOCKED', 4)

    const current = { child: null }
    const release = async () => { await releaseLock(acquired.handle).catch(() => {}) }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
        process.on(signal, () => {
            if (current.child) killTree(current.child)
            release().finally(() => process.exit(130))
        })
    }
    try {
        record.runtime = {
            node: process.version,
            vitest: (() => { try { return JSON.parse(fs.readFileSync(path.join(repo, 'node_modules', 'vitest', 'package.json'), 'utf8')).version } catch { return null } })(),
            cpus: os.cpus().length,
            nodeExeCount: nodeProcessCount(),
        }
        const firstRun = await runVitest({
            repo, vitestBin, args: [`--maxWorkers=${opts.maxWorkers}`], summaryPath: path.join(out, 'first', 'summary.json'),
            logPath: path.join(out, 'first', 'vitest.log'), timeoutMs: opts.timeoutMin * 60_000, lockHandle: acquired.handle, current,
        })
        const first = classifyFirstRun({ exitCode: firstRun.exitCode, timedOut: firstRun.timedOut, summary: firstRun.summary, repo })
        record.first = { kind: first.kind, reason: first.reason ?? null, exitCode: firstRun.exitCode, timedOut: firstRun.timedOut, ms: firstRun.ms }
        if (first.kind === 'PASS') return finishWith('PASS', 0)
        if (first.kind === 'FAIL-ERROR') return finishWith('FAIL-ERROR', 1)

        const verdicts = []
        for (const [index, file] of first.files.entries()) {
            const second = await runVitest({
                repo, vitestBin, args: [file.path, '--maxWorkers=1'], summaryPath: path.join(out, 'rerun', String(index + 1), 'summary.json'),
                logPath: path.join(out, 'rerun', String(index + 1), 'vitest.log'), timeoutMs: RERUN_TIMEOUT_MS, lockHandle: acquired.handle, current,
            })
            const classified = classifyRerun({ exitCode: second.exitCode, timedOut: second.timedOut, summary: second.summary, target: file.path, repo })
            const verdict = fileVerdict(file, classified, flakeSet)
            verdicts.push(verdict)
            record.files.push({ path: file.path, category: file.category, messages: file.messages, rerun: classified.kind, rerunReason: classified.reason ?? null, rerunMs: second.ms, verdict })
        }
        const overall = overallVerdict(first, verdicts)
        if (overall === 'PASS-RECOVERED') return finishWith('PASS-RECOVERED', 3)
        return finishWith(overall, 1)
    } finally {
        await release()
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then((code) => process.exit(code)).catch((error) => {
        console.error(`run-full-tests: ${error.stack ?? error}`)
        process.exit(2)
    })
}
