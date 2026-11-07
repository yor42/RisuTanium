/**
 * Machine-wide cooperative lock for full test-suite runs started through
 * Agents/Tools/run-full-tests.mjs. Only helper runs are serialised.
 *
 * Files in the lock directory:
 *   risu-fullrun.lock   created with the exclusive flag; holds the holder record.
 *   risu-fullrun.guard  exclusive short-lived guard. Every removal or rewrite of the
 *                       lock (release, child update, stale reclaim) happens while the
 *                       guard is held and re-reads the lock first, acting only when the
 *                       token still equals the one judged. A waiter therefore never
 *                       removes a lock acquired after its judgement.
 *
 * A holder is stale only when its process is gone (dead, or alive with a different OS
 * start time) and the recorded vitest child is gone as well. A failed or ambiguous
 * probe means held. No process is ever signalled here.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const LOCK_NAME = 'risu-fullrun.lock'
export const GUARD_NAME = 'risu-fullrun.guard'
export const START_TIME_TOLERANCE_MS = 1000
export const UNREADABLE_AGE_MS = 60_000
export const GUARD_STALE_AGE_MS = 60_000
export const DEFAULT_MAX_WAIT_MS = 30 * 60_000
export const DEFAULT_POLL_MS = 10_000
const REPROBE_MS = 60_000
const WAIT_NOTICE_MS = 60_000

export function defaultLockDir() {
    const base = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir()
    return path.join(base, 'risu-fullrun')
}

// Returns {state:'ALIVE', startTime} | {state:'DEAD'} | {state:'UNKNOWN'}. Windows only.
export function probeProcess(pid) {
    if (process.platform !== 'win32') throw new Error('probeProcess is supported on win32 only')
    if (!Number.isInteger(pid) || pid <= 0) return { state: 'UNKNOWN' }
    try {
        process.kill(pid, 0)
    } catch (error) {
        if (error && error.code === 'ESRCH') return { state: 'DEAD' }
        if (!error || error.code !== 'EPERM') return { state: 'UNKNOWN' }
    }
    try {
        const out = execFileSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-Command',
            `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
        ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const startTime = out.trim()
        if (Number.isNaN(Date.parse(startTime))) return { state: 'UNKNOWN' }
        return { state: 'ALIVE', startTime }
    } catch (error) {
        const text = `${error && error.stderr ? error.stderr : ''}${error && error.stdout ? error.stdout : ''}`
        if (/Cannot find a process/i.test(text)) return { state: 'DEAD' }
        return { state: 'UNKNOWN' }
    }
}

function safeProbe(probe, pid) {
    try {
        const result = probe(pid)
        if (result && (result.state === 'ALIVE' || result.state === 'DEAD')) return result
        return { state: 'UNKNOWN' }
    } catch {
        return { state: 'UNKNOWN' }
    }
}

// Pure. Returns 'GONE', 'ALIVE' or 'UNKNOWN' for one recorded process against a probe result.
function processStatus(recorded, probed) {
    if (probed.state === 'DEAD') return 'GONE'
    if (probed.state !== 'ALIVE') return 'UNKNOWN'
    const recordedMs = Date.parse(recorded.startTime)
    const probedMs = Date.parse(probed.startTime)
    if (Number.isNaN(recordedMs) || Number.isNaN(probedMs)) return 'UNKNOWN'
    return Math.abs(recordedMs - probedMs) > START_TIME_TOLERANCE_MS ? 'GONE' : 'ALIVE'
}

// Pure. probes = {holder, child}: probe results for the recorded holder and child.
export function judgeHolder(record, probes) {
    const holder = processStatus({ startTime: record.startTime }, probes.holder)
    if (holder === 'ALIVE') return { verdict: 'HELD', reason: 'holder-alive' }
    if (holder === 'UNKNOWN') return { verdict: 'HELD', reason: 'holder-unknown' }
    if (record.child) {
        const child = processStatus(record.child, probes.child ?? { state: 'UNKNOWN' })
        if (child === 'ALIVE') return { verdict: 'HELD', reason: 'child-alive' }
        if (child === 'UNKNOWN') return { verdict: 'HELD', reason: 'child-unknown' }
    }
    return { verdict: 'STALE', reason: probes.holder.state === 'DEAD' ? 'holder-dead' : 'holder-reused' }
}

function judgeRecord(record, probe) {
    const holder = safeProbe(probe, record.pid)
    const holderStatus = processStatus({ startTime: record.startTime }, holder)
    let child = null
    if (holderStatus === 'GONE' && record.child) child = safeProbe(probe, record.child.pid)
    return judgeHolder(record, { holder, child })
}

function readLockText(lockPath) {
    try {
        const stat = fs.statSync(lockPath)
        return { text: fs.readFileSync(lockPath, 'utf8'), mtimeMs: stat.mtimeMs }
    } catch (error) {
        if (error && error.code === 'ENOENT') return null
        throw error
    }
}

function parseRecord(text) {
    try {
        const value = JSON.parse(text)
        if (value && typeof value === 'object' && typeof value.token === 'string' && Number.isInteger(value.pid)) return value
    } catch { /* unparseable */ }
    return null
}

function writeRecordExclusive(lockPath, record) {
    const fd = fs.openSync(lockPath, 'wx')
    try {
        fs.writeSync(fd, JSON.stringify(record))
        fs.fsyncSync(fd)
    } catch (error) {
        fs.closeSync(fd)
        try { fs.unlinkSync(lockPath) } catch { /* best effort */ }
        throw error
    }
    fs.closeSync(fd)
}

// Runs fn while holding the guard. Returns {status:'DONE', value} | {status:'BUSY'} | {status:'OLD-GUARD', guard}.
async function withGuard(dir, sleep, attempts, fn) {
    const guardPath = path.join(dir, GUARD_NAME)
    for (let attempt = 0; attempt < attempts; attempt++) {
        let fd = null
        try {
            fd = fs.openSync(guardPath, 'wx')
        } catch (error) {
            if (!error || error.code !== 'EEXIST') throw error
        }
        if (fd !== null) {
            try {
                fs.writeSync(fd, JSON.stringify({ pid: process.pid, time: new Date().toISOString() }))
            } finally {
                fs.closeSync(fd)
            }
            try {
                return { status: 'DONE', value: fn() }
            } finally {
                try { fs.unlinkSync(guardPath) } catch { /* already gone */ }
            }
        }
        let stat = null
        try { stat = fs.statSync(guardPath) } catch { /* released meanwhile */ }
        if (stat && Date.now() - stat.mtimeMs > GUARD_STALE_AGE_MS) {
            let content = ''
            try { content = fs.readFileSync(guardPath, 'utf8') } catch { /* released meanwhile */ }
            return { status: 'OLD-GUARD', guard: { path: guardPath, content } }
        }
        if (attempt + 1 < attempts) await sleep(25)
    }
    return { status: 'BUSY' }
}

function defaultSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function holderSummary(record) {
    return {
        pid: record.pid,
        startTime: record.startTime,
        cwd: record.cwd ?? null,
        repo: record.repo ?? null,
        head: record.head ?? null,
        startedAt: record.startedAt ?? null,
        child: record.child ?? null,
    }
}

/**
 * identity: {pid, startTime, cwd, repo, head}. Returns
 *   {status:'ACQUIRED', handle, reclaimed:[...], waitedMs}  or
 *   {status:'BLOCKED', reason, holder|null, guard?, waitedMs}.
 */
export async function acquireLock({
    dir, identity, probe = probeProcess, now = Date.now, sleep = defaultSleep,
    maxWaitMs = DEFAULT_MAX_WAIT_MS, pollMs = DEFAULT_POLL_MS, onWait = () => {},
}) {
    fs.mkdirSync(dir, { recursive: true })
    const lockPath = path.join(dir, LOCK_NAME)
    const guardPath = path.join(dir, GUARD_NAME)
    const started = now()
    const reclaimed = []
    let lastJudgeAt = null
    let lastJudgedToken = null
    let lastJudgement = null
    let lastNoticeAt = null
    for (;;) {
        const record = {
            schema: 1,
            token: crypto.randomBytes(16).toString('hex'),
            pid: identity.pid,
            startTime: identity.startTime,
            cwd: identity.cwd ?? null,
            repo: identity.repo ?? null,
            head: identity.head ?? null,
            startedAt: new Date().toISOString(),
            child: null,
        }
        try {
            writeRecordExclusive(lockPath, record)
            const handle = { dir, lockPath, guardPath, token: record.token, sleep }
            return { status: 'ACQUIRED', handle, reclaimed, waitedMs: now() - started }
        } catch (error) {
            if (!error || error.code !== 'EEXIST') throw error
        }

        const current = readLockText(lockPath)
        if (current === null) continue
        const held = parseRecord(current.text)
        let judgement
        let holder = null
        if (held) {
            holder = holderSummary(held)
            const due = lastJudgedToken !== held.token || lastJudgeAt === null || now() - lastJudgeAt >= REPROBE_MS
            if (due) {
                lastJudgement = judgeRecord(held, probe)
                lastJudgedToken = held.token
                lastJudgeAt = now()
            }
            judgement = lastJudgement
        } else {
            lastJudgedToken = null
            judgement = Date.now() - current.mtimeMs > UNREADABLE_AGE_MS
                ? { verdict: 'STALE', reason: 'unreadable-old' }
                : { verdict: 'HELD', reason: 'unreadable-fresh' }
        }

        if (judgement.verdict === 'STALE') {
            const outcome = await withGuard(dir, sleep, 1, () => {
                const again = readLockText(lockPath)
                if (again === null) return 'GONE'
                const againRecord = parseRecord(again.text)
                if (held) {
                    if (!againRecord || againRecord.token !== held.token) return 'CHANGED'
                } else if (againRecord || Date.now() - again.mtimeMs <= UNREADABLE_AGE_MS) {
                    return 'CHANGED'
                }
                fs.unlinkSync(lockPath)
                return 'REMOVED'
            })
            if (outcome.status === 'OLD-GUARD') {
                return { status: 'BLOCKED', reason: 'old-guard', holder, guard: outcome.guard, waitedMs: now() - started }
            }
            if (outcome.status === 'DONE') {
                if (outcome.value === 'REMOVED') {
                    reclaimed.push({ holder, reason: judgement.reason })
                    lastJudgedToken = null
                }
                continue
            }
        }

        const waited = now() - started
        if (waited >= maxWaitMs) {
            return { status: 'BLOCKED', reason: 'timeout', holder, waitedMs: waited }
        }
        if (lastNoticeAt === null || now() - lastNoticeAt >= WAIT_NOTICE_MS) {
            lastNoticeAt = now()
            onWait({ holder, reason: judgement.reason, waitedMs: waited })
        }
        await sleep(pollMs)
    }
}

// Replaces the recorded vitest child while the token still matches. Returns true when written.
export async function updateLockChild(handle, child) {
    const outcome = await withGuard(handle.dir, handle.sleep ?? defaultSleep, 200, () => {
        const current = readLockText(handle.lockPath)
        const record = current ? parseRecord(current.text) : null
        if (!record || record.token !== handle.token) return false
        record.child = child
        const fd = fs.openSync(handle.lockPath, 'r+')
        try {
            fs.ftruncateSync(fd, 0)
            fs.writeSync(fd, JSON.stringify(record), 0)
            fs.fsyncSync(fd)
        } finally {
            fs.closeSync(fd)
        }
        return true
    })
    return outcome.status === 'DONE' && outcome.value === true
}

// Removes the lock only when it still carries this handle's token. Returns true when removed.
export async function releaseLock(handle) {
    const outcome = await withGuard(handle.dir, handle.sleep ?? defaultSleep, 200, () => {
        const current = readLockText(handle.lockPath)
        const record = current ? parseRecord(current.text) : null
        if (!record || record.token !== handle.token) return false
        fs.unlinkSync(handle.lockPath)
        return true
    })
    return outcome.status === 'DONE' && outcome.value === true
}
