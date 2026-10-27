// @vitest-environment node
/**
 * The commit meter of a measurement build, observed through a real store2 session over the in-memory backend. A pass
 * says nothing about a device; it shows what the meter records, that it records nothing when the measurement flag is
 * off, and that a failing meter never fails a commit.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { createFakeStore } from '../blockStoreHarness'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { IMPORT_REPLACES_BASE, type CommitRequest, type CommitResult, type Committer } from 'src/ts/storage/store2/commit'
import { meterCommitter, type CommitMeterHandle } from 'src/ts/storage/store2/commitMeter'
import { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, seedStore, testEnv, treeRequest, type BuildRecord } from './commitFixtures'

const ORDINARY_EXTRA = 5
const BULK_EXTRA = 49

type MeterGlobal = { __risuCommitMeter?: CommitMeterHandle }

function meterOf(): CommitMeterHandle | undefined {
    return (globalThis as MeterGlobal).__risuCommitMeter
}

async function open(): Promise<{ committer: Committer, memory: Store2Backend }> {
    const env = testEnv(createClock(), 71)
    const memory = createMemoryBackend()
    await seedStore(memory, env)
    const session = await Store2Session.open(createFakeStore({ versioned: false }), {
        kind: 'tauri', backend: memory, env, reflushAttempts: 1, upstreamMainFile: async () => false,
    })
    if (session.committer === null) {
        throw new Error('The session has no committer.')
    }
    meterOf()?.reset()
    return { committer: session.committer, memory }
}

async function sizesOf(memory: Store2Backend, keys: string[], manifestKey: string): Promise<{ units: number, manifest: number }> {
    const read = await memory.readUnits(keys)
    let units = 0
    let manifest = 0
    for (const [key, bytes] of read) {
        if (bytes === null) {
            throw new Error(`${key} is missing.`)
        }
        if (key === manifestKey) {
            manifest += bytes.length
        } else {
            units += bytes.length
        }
    }
    return { units, manifest }
}

function committed(result: CommitResult): Extract<CommitResult, { status: 'committed' }> {
    if (result.status !== 'committed') {
        throw new Error(`Expected committed, got ${result.status}.`)
    }
    return result
}

beforeEach(() => {
    flag.measure = true
    delete (globalThis as MeterGlobal).__risuCommitMeter
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuCommitMeter
})

describe('commit meter in a measurement build', () => {
    test('an ordinary commit is recorded with its unit, manifest and commit-key bytes', async () => {
        const { committer, memory } = await open()
        const record: BuildRecord[] = []
        const result = committed(await committer.commit(await committer.readCommit(), treeRequest(ORDINARY_EXTRA, { record })))
        const sizes = await sizesOf(memory, record[0].keys, result.manifestKey)

        const meter = meterOf()
        expect(meter).toBeDefined()
        const last = meter?.last()
        expect(last).toMatchObject({
            kind: 'ordinary',
            outcome: 'committed',
            unitBytes: sizes.units,
            manifestBytes: sizes.manifest,
            commitKeyBytes: result.bytes.length,
            overlapped: false,
        })
        expect(last?.totalBytes).toBe(sizes.units + sizes.manifest + result.bytes.length)
        expect(last?.units).toBe(record[0].keys.length)
        expect(last?.ms).toBeGreaterThanOrEqual(0)
        expect(meter?.all()).toHaveLength(1)
    })

    test('a bulk commit counts the marker write and the final commit-key write, and every staged unit', async () => {
        const { committer, memory } = await open()
        const record: BuildRecord[] = []
        const result = committed(await committer.commit(await committer.readCommit(), treeRequest(BULK_EXTRA, { record, label: 'import' })))
        expect(result.mode).toBe('bulk')
        const sizes = await sizesOf(memory, record[0].keys, result.manifestKey)

        const last = meterOf()?.last()
        expect(last).toMatchObject({ kind: 'bulk', outcome: 'committed', unitBytes: sizes.units, manifestBytes: sizes.manifest })
        expect(last?.commitKeyBytes).toBeGreaterThan(result.bytes.length)
        expect(last?.totalBytes).toBe(sizes.units + sizes.manifest + (last?.commitKeyBytes ?? 0))
    })

    test('a forced commit and a restore carry their kind, and reset empties the record', async () => {
        const { committer } = await open()
        const first = committed(await committer.commit(await committer.readCommit(), treeRequest(ORDINARY_EXTRA, { tag: 'a' })))
        committed(await committer.commit(await committer.readCommit(), { ...treeRequest(ORDINARY_EXTRA, { tag: 'b' }), force: true }))
        expect(meterOf()?.last()?.kind).toBe('forced')
        const restored = await committer.restore(await committer.readCommit(), first.manifestKey)
        expect(restored.status).toBe('committed')
        expect(meterOf()?.last()).toMatchObject({ kind: 'restore', outcome: 'committed' })
        expect(meterOf()?.all()).toHaveLength(3)
        meterOf()?.reset()
        expect(meterOf()?.all()).toEqual([])
        expect(meterOf()?.last()).toBeNull()
    })

    test('a meter that fails never fails the commit', async () => {
        const { committer } = await open()
        vi.spyOn(console, 'log').mockImplementation(() => {
            throw new Error('meter output failed')
        })
        const result = committed(await committer.commit(await committer.readCommit(), treeRequest(ORDINARY_EXTRA)))
        expect(result.mode).toBe('ordinary')
        const again = await committer.commit(await committer.readCommit(), treeRequest(ORDINARY_EXTRA, { tag: 'again' }))
        expect(again.status).toBe('committed')
    })

    test('a rejection of commit, saveMine and restore reaches the caller as the same object, recorded as threw', async () => {
        const sentinel = new Error('sentinel')
        const calls: unknown[][] = []
        const settle = (...args: unknown[]) => {
            calls.push(args)
            return Promise.reject(sentinel)
        }
        const inner: Committer = {
            owner: 'probe',
            readCommit: () => Promise.reject(new Error('unused')),
            commit: settle as Committer['commit'],
            saveMine: settle as Committer['saveMine'],
            restore: settle as Committer['restore'],
            pin: settle as Committer['pin'],
            unpin: settle as Committer['unpin'],
            dropSnapshot: settle as Committer['dropSnapshot'],
            abandonClear: settle as Committer['abandonClear'],
            clearMarker: settle as Committer['clearMarker'],
        }
        const read = { bytes: null, token: { kind: 'bytes' as const, bytes: null } }
        const request: CommitRequest = { newUnits: 1, build: () => { throw new Error('unused') }, carry: IMPORT_REPLACES_BASE }
        const target: MeterGlobal = {}
        const metered = meterCommitter(createMemoryBackend(), () => inner, target)
        target.__risuCommitMeter?.reset()

        await expect(metered.commit(read, request)).rejects.toBe(sentinel)
        await expect(metered.saveMine(read, request)).rejects.toBe(sentinel)
        await expect(metered.restore(read, 'k')).rejects.toBe(sentinel)
        expect(target.__risuCommitMeter?.all().map(record => record.outcome)).toEqual(['threw', 'threw', 'threw'])
        expect(calls).toEqual([[read, request], [read, request], [read, 'k']])
        expect(calls[0][0]).toBe(read)
        expect(calls[0][1]).toBe(request)
    })
})

describe('commit meter in a normal build', () => {
    test('with the flag off nothing is recorded and no global exists', async () => {
        flag.measure = false
        const { committer } = await open()
        committed(await committer.commit(await committer.readCommit(), treeRequest(ORDINARY_EXTRA)))
        committed(await committer.commit(await committer.readCommit(), treeRequest(BULK_EXTRA, { tag: 'bulk' })))
        expect(meterOf()).toBeUndefined()
        expect('__risuCommitMeter' in globalThis).toBe(false)
        expect(console.log).not.toHaveBeenCalled()
    })
})
