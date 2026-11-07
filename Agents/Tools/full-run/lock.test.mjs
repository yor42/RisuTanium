// @vitest-environment node
// Lock tests use real files in a fresh temporary directory, an injected process probe and an injected
// clock; none of them touches the default lock directory or waits real time.
// Run: node node_modules/vitest/vitest.mjs run Agents/Tools/full-run/lock.test.mjs
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_MAX_WORKERS } from '../run-full-tests.mjs'
import { acquireLock, DEFAULT_MAX_WAIT_MS, GUARD_NAME, judgeHolder, LOCK_NAME, probeProcess, releaseLock, updateLockChild } from './lock.mjs'

const MAX_WAIT_MS = 30 * 60_000
const POLL_MS = 10_000
const HOLDER_START = '2026-01-01T00:00:00.000Z'
const ME = { pid: 999, startTime: '2026-01-02T00:00:00.000Z', cwd: 'C:/me', repo: 'C:/me', head: 'abc' }

let dir
let lockPath
let guardPath

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-lock-test-'))
    lockPath = path.join(dir, LOCK_NAME)
    guardPath = path.join(dir, GUARD_NAME)
})
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

function fakeClock() {
    const clock = { ms: 0 }
    clock.now = () => clock.ms
    // Yields to the event loop so a runaway wait loop can still be failed by the test timeout, and throws far past the wait.
    clock.sleep = async (ms) => {
        clock.ms += ms
        if (clock.ms > 10 * 3_600_000) throw new Error('wait loop ran past ten hours of fake time')
        await new Promise((resolve) => setImmediate(resolve))
    }
    return clock
}

function writeHolder(overrides = {}) {
    const record = { schema: 1, token: 'old-token', pid: 111, startTime: HOLDER_START, cwd: 'C:/other', repo: 'C:/other', head: 'def', startedAt: HOLDER_START, child: null, ...overrides }
    fs.writeFileSync(lockPath, JSON.stringify(record))
    return record
}

const alive = (startTime = HOLDER_START) => ({ state: 'ALIVE', startTime })
const dead = { state: 'DEAD' }
const probeOf = (table) => (pid) => {
    const entry = table[pid]
    if (entry instanceof Error) throw entry
    return entry ?? dead
}

async function acquire(probe, extra = {}) {
    const clock = fakeClock()
    const waits = []
    const result = await acquireLock({
        dir, identity: ME, probe, now: clock.now, sleep: clock.sleep, maxWaitMs: MAX_WAIT_MS, pollMs: POLL_MS,
        onWait: (info) => waits.push(info), ...extra,
    })
    return { result, clock, waits }
}

const readLock = () => JSON.parse(fs.readFileSync(lockPath, 'utf8'))

describe('lock acquisition', () => {
    it('L1 a free lock is acquired and the file is gone after release', async () => {
        const { result } = await acquire(probeOf({}))
        expect(result.status).toBe('ACQUIRED')
        expect(result.reclaimed).toEqual([])
        expect(readLock()).toMatchObject({ pid: 999, startTime: ME.startTime, token: result.handle.token, child: null })
        expect(await releaseLock(result.handle)).toBe(true)
        expect(fs.existsSync(lockPath)).toBe(false)
        expect(fs.existsSync(guardPath)).toBe(false)
    })

    it('L2 a live holder blocks after the maximum wait and the result names its pid and start time', async () => {
        writeHolder()
        const { result, clock, waits } = await acquire(probeOf({ 111: alive() }))
        expect(result).toMatchObject({ status: 'BLOCKED', reason: 'timeout', holder: { pid: 111, startTime: HOLDER_START } })
        expect(result.waitedMs).toBeGreaterThanOrEqual(MAX_WAIT_MS)
        expect(clock.ms).toBeLessThan(MAX_WAIT_MS + 2 * POLL_MS)
        expect(waits.length).toBeGreaterThan(0)
        expect(readLock().token).toBe('old-token')
    })

    it('L3 a dead holder is reclaimed and the reclaim is reported', async () => {
        writeHolder()
        const { result } = await acquire(probeOf({ 111: dead }))
        expect(result.status).toBe('ACQUIRED')
        expect(result.reclaimed).toHaveLength(1)
        expect(result.reclaimed[0]).toMatchObject({ reason: 'holder-dead', holder: { pid: 111 } })
        expect(readLock().token).toBe(result.handle.token)
    })

    it('L4 a reused pid (alive with a different start time) is reclaimed, a matching start time is not', async () => {
        writeHolder()
        const reused = await acquire(probeOf({ 111: alive('2026-01-01T00:00:05.000Z') }))
        expect(reused.result.status).toBe('ACQUIRED')
        expect(reused.result.reclaimed[0].reason).toBe('holder-reused')
        await releaseLock(reused.result.handle)
        writeHolder()
        const same = await acquire(probeOf({ 111: alive('2026-01-01T00:00:00.400Z') }))
        expect(same.result.status).toBe('BLOCKED')
    })

    it('L5 an unknown probe result or a throwing probe means held and never reclaimed', async () => {
        writeHolder()
        for (const entry of [{ state: 'UNKNOWN' }, new Error('powershell timed out'), alive('not a date')]) {
            const { result } = await acquire(probeOf({ 111: entry }))
            expect(result).toMatchObject({ status: 'BLOCKED', reason: 'timeout' })
            expect(readLock().token).toBe('old-token')
        }
    })

    it('L6 a dead holder whose recorded vitest child is alive stays held; a dead child allows reclaim', async () => {
        writeHolder({ child: { pid: 222, startTime: HOLDER_START } })
        const held = await acquire(probeOf({ 111: dead, 222: alive() }))
        expect(held.result.status).toBe('BLOCKED')
        expect(readLock().token).toBe('old-token')
        const gone = await acquire(probeOf({ 111: dead, 222: dead }))
        expect(gone.result.status).toBe('ACQUIRED')
    })

    it('L6b a dead holder whose recorded vitest child probe fails stays held and the lock is untouched', async () => {
        for (const childEntry of [{ state: 'UNKNOWN' }, new Error('powershell timed out')]) {
            writeHolder({ child: { pid: 222, startTime: HOLDER_START } })
            const { result } = await acquire(probeOf({ 111: dead, 222: childEntry }))
            expect(result).toMatchObject({ status: 'BLOCKED', reason: 'timeout' })
            expect(readLock().token).toBe('old-token')
        }
    })

    it('L9 the default wait and worker cap carry the maintainer answers', () => {
        expect(DEFAULT_MAX_WAIT_MS).toBe(30 * 60_000)
        expect(DEFAULT_MAX_WORKERS).toBe(8)
    })

    it('L7 a lock replaced between judgement and reclaim survives', async () => {
        writeHolder()
        const probe = (pid) => {
            if (pid === 111) {
                fs.writeFileSync(lockPath, JSON.stringify({ schema: 1, token: 'new-token', pid: 222, startTime: HOLDER_START, child: null }))
                return dead
            }
            return alive()
        }
        const { result } = await acquire(probe)
        expect(result).toMatchObject({ status: 'BLOCKED', holder: { pid: 222 } })
        expect(readLock().token).toBe('new-token')
    })

    it('L8 release and child update leave a lock that carries another token', async () => {
        const { result } = await acquire(probeOf({}))
        expect(await updateLockChild(result.handle, { pid: 5, startTime: HOLDER_START })).toBe(true)
        expect(readLock().child).toEqual({ pid: 5, startTime: HOLDER_START })
        fs.writeFileSync(lockPath, JSON.stringify({ schema: 1, token: 'foreign', pid: 333, startTime: HOLDER_START, child: null }))
        expect(await updateLockChild(result.handle, { pid: 6, startTime: HOLDER_START })).toBe(false)
        expect(await releaseLock(result.handle)).toBe(false)
        expect(readLock().token).toBe('foreign')
    })

    it('L9 an old guard blocks with its details and is left in place', async () => {
        writeHolder()
        fs.writeFileSync(guardPath, JSON.stringify({ pid: 4, time: 'long ago' }))
        const past = new Date(Date.now() - 120_000)
        fs.utimesSync(guardPath, past, past)
        const { result } = await acquire(probeOf({ 111: dead }))
        expect(result).toMatchObject({ status: 'BLOCKED', reason: 'old-guard' })
        expect(result.guard.path).toBe(guardPath)
        expect(result.guard.content).toContain('long ago')
        expect(fs.existsSync(guardPath)).toBe(true)
        expect(readLock().token).toBe('old-token')
    })

    it('L10 a fresh unparseable lock is held and an old one is reclaimed', async () => {
        fs.writeFileSync(lockPath, '')
        const fresh = await acquire(probeOf({}))
        expect(fresh.result).toMatchObject({ status: 'BLOCKED', reason: 'timeout' })
        const past = new Date(Date.now() - 120_000)
        fs.utimesSync(lockPath, past, past)
        const old = await acquire(probeOf({}))
        expect(old.result.status).toBe('ACQUIRED')
        expect(old.result.reclaimed[0].reason).toBe('unreadable-old')
    })
})

describe('holder judgement', () => {
    it('is stale only when holder and child are gone', () => {
        const record = { startTime: HOLDER_START, child: null }
        expect(judgeHolder(record, { holder: dead, child: null }).verdict).toBe('STALE')
        expect(judgeHolder(record, { holder: alive(), child: null }).verdict).toBe('HELD')
        expect(judgeHolder({ ...record, child: { pid: 1, startTime: HOLDER_START } }, { holder: dead, child: alive() }).reason).toBe('child-alive')
    })
})

describe('real process probe', () => {
    it.skipIf(process.platform !== 'win32')('L11 reports this process alive with an ISO start time and an exited child dead', () => {
        const self = probeProcess(process.pid)
        expect(self.state).toBe('ALIVE')
        const startMs = Date.parse(self.startTime)
        expect(Number.isNaN(startMs)).toBe(false)
        expect(startMs).toBeLessThanOrEqual(Date.now() + 1000)
        const child = spawnSync(process.execPath, ['-e', ''])
        expect(child.pid).toBeGreaterThan(0)
        expect(probeProcess(child.pid)).toEqual({ state: 'DEAD' })
    }, 60_000)
})
