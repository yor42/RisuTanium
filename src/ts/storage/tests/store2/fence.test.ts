// @vitest-environment node
/**
 * The fence policy layer over the memory, IndexedDB (fake-indexeddb) and Node
 * (real server process) backends: the readers' verdicts, the exit's steps (1) to
 * (3) and their order, and the discard. Tauri is not run here: the `flushed`
 * contract is exercised through a recording wrapper that overrides the reported
 * flush status, which is not evidence about the native commands.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2UnknownOutcomeError, createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { discardFence, fenceExit, readFenceVerdict } from 'src/ts/storage/store2/fence'
import { encodeUnit, keyOfTail, readUnit, tailOfKey, UNIT_TYPE, type FenceRecord } from 'src/ts/storage/store2/format'
import { bytesOf, unitKey } from './backendConformance'
import { FENCE_BACKENDS, plantCommit, plantFence, plantUnit, traced, type OpenedBackend } from './fenceFixtures'
import { GOLDEN_VECTORS, hexToBytes } from './goldenVectors'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

function vector(prefix: string): Uint8Array {
    const found = GOLDEN_VECTORS.find(entry => entry.id.startsWith(prefix))
    if (!found) {
        throw new Error(`No golden vector ${prefix}.`)
    }
    return hexToBytes(found.hex)
}

function fenceBytes(record: object): Uint8Array {
    return encodeUnit(UNIT_TYPE.fenceRecord, record)
}

function base64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url')
}

async function storedFence(backend: Store2Backend): Promise<FenceRecord> {
    const read = await backend.readFence()
    if (read.bytes === null) {
        throw new Error('No fence is stored.')
    }
    const unit = readUnit(read.bytes, UNIT_TYPE.fenceRecord)
    if (unit.status !== 'ok') {
        throw new Error(`The stored fence is ${unit.status}.`)
    }
    return unit.value.body as FenceRecord
}

async function listedTails(backend: Store2Backend): Promise<string[]> {
    return (await backend.listStore2()).map(tailOfKey).sort()
}

/** A damaged commit key's bytes, as an exit reads them verbatim. */
const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])

describe.each(FENCE_BACKENDS.map(fixture => [fixture.name, fixture] as const))('fence on the %s backend', (_name, fixture) => {
    async function open(): Promise<Store2Backend> {
        const entry = await fixture.open()
        opened.push(entry)
        return entry.backend
    }

    describe('reader verdicts', () => {
        test('an absent fence is unfenced and its token is the one a first fence write presents', async () => {
            const backend = await open()
            const verdict = await readFenceVerdict(backend)
            expect(verdict.state).toBe('absent')
            expect(verdict.token).not.toBeNull()
            await backend.casFence(verdict.token!, fenceBytes({ v: 1, at: 1, priorCommits: [], keys: [] }))
            expect((await readFenceVerdict(backend)).state).toBe('fenced')
        })

        test('a parsable fence is fenced and names its keys as full store2 keys (vectors F1 and F4)', async () => {
            const backend = await open()
            await plantFence(backend, vector('fence-F1-'))
            const verdict = await readFenceVerdict(backend)
            expect(verdict.state).toBe('fenced')
            if (verdict.state === 'fenced') {
                expect([...verdict.keys]).toEqual([keyOfTail('m-00000000000000000000000000')])
            }
            await plantFence(backend, vector('fence-F4-'))
            const second = await readFenceVerdict(backend)
            expect(second.state).toBe('fenced')
            if (second.state === 'fenced') {
                expect(second.keys.size).toBe(0)
            }
        })

        test('an unparsable fence blocks every deleter (vectors F2 and F6, and raw junk)', async () => {
            const backend = await open()
            for (const bytes of [vector('fence-F2-'), vector('fence-F6-'), Uint8Array.from([1, 2, 3])]) {
                await plantFence(backend, bytes)
                const verdict = await readFenceVerdict(backend)
                expect(verdict).toMatchObject({ state: 'blocked', reason: 'unparsable' })
                expect(verdict.token).not.toBeNull()
            }
        })

        test('a too-new fence blocks every deleter (vector F3 and a fence body of v 2)', async () => {
            const backend = await open()
            await plantFence(backend, vector('fence-F3-'))
            expect(await readFenceVerdict(backend)).toMatchObject({ state: 'blocked', reason: 'too-new' })
            await plantFence(backend, fenceBytes({ v: 2, at: 1, priorCommits: [], keys: [] }))
            expect(await readFenceVerdict(backend)).toMatchObject({ state: 'blocked', reason: 'too-new' })
        })

        test('a fence frame of another unit type is unparsable, not an empty fence', async () => {
            const backend = await open()
            await plantFence(backend, encodeUnit(UNIT_TYPE.shard, { v: 1, entries: [] }))
            expect(await readFenceVerdict(backend)).toMatchObject({ state: 'blocked', reason: 'unparsable' })
        })

        test('an unreadable fence blocks every deleter and has no token', async () => {
            const backend = await open()
            const verdict = await readFenceVerdict(traced(backend, { failReadFence: true }).backend)
            expect(verdict).toMatchObject({ state: 'blocked', reason: 'unreadable', token: null })
        })

        test('the verdict token is what a deleter batch carries: it deletes when the fence is unchanged and conflicts after a change', async () => {
            const backend = await open()
            await plantFence(backend, vector('fence-F1-'))
            await plantUnit(backend, unitKey(1), bytesOf(1))
            const verdict = await readFenceVerdict(backend)
            const commit = (await backend.readCommit()).token
            await backend.removeBatch([unitKey(1)], commit, verdict.token!)
            expect(await backend.listStore2()).not.toContain(unitKey(1))
            await fenceExit(backend, { damagedCommitBytes: null })
            await expect(backend.removeBatch([unitKey(1)], commit, verdict.token!)).rejects.toMatchObject({ kind: 'fence-conflict' })
        })
    })

    describe('exit', () => {
        test('creates the fence over an absent one with the listing, the damaged commit key verbatim and its own time', async () => {
            const backend = await open()
            await plantUnit(backend, unitKey(1), bytesOf(1))
            await plantUnit(backend, unitKey(2), bytesOf(2))
            const result = await fenceExit(backend, { damagedCommitBytes: DAMAGED_COMMIT, now: () => 100 })
            expect(result.status).toBe('written')
            const record = await storedFence(backend)
            expect(record).toMatchObject({ v: 1, at: 100, keys: await listedTails(backend), priorCommits: [{ at: 100, bytes: base64Url(DAMAGED_COMMIT) }] })
            expect(record.priorFences).toBeUndefined()
            if (result.status === 'written') {
                expect(result.replacedUnparsable).toBe(false)
                expect(result.keys).toEqual(record.keys)
                expect(result.attempts).toBe(1)
            }
            expect((await readFenceVerdict(backend)).state).toBe('fenced')
        })

        test('records null when the commit key was absent or unreadable', async () => {
            const backend = await open()
            await fenceExit(backend, { damagedCommitBytes: null, now: () => 5 })
            expect((await storedFence(backend)).priorCommits).toEqual([{ at: 5, bytes: null }])
        })

        test('a second exit writes a superset: old keys stay, new keys join, priorCommits grows, the first time is kept', async () => {
            const backend = await open()
            await plantUnit(backend, unitKey(1), bytesOf(1))
            await fenceExit(backend, { damagedCommitBytes: DAMAGED_COMMIT, now: () => 100 })
            await plantUnit(backend, unitKey(2), bytesOf(2))
            const second = await fenceExit(backend, { damagedCommitBytes: null, now: () => 200 })
            expect(second.status).toBe('written')
            const record = await storedFence(backend)
            expect(record.at).toBe(100)
            expect(record.keys).toEqual(await listedTails(backend))
            expect(record.keys).toHaveLength(2)
            expect(record.priorCommits).toEqual([{ at: 100, bytes: base64Url(DAMAGED_COMMIT) }, { at: 200, bytes: null }])
        })

        test('keeps a key the old fence names that is no longer listed', async () => {
            const backend = await open()
            await plantFence(backend, fenceBytes({ v: 1, at: 1, priorCommits: [], keys: ['m-0000000zzzzzzzzzzzzzzzzzzz'] }))
            await plantUnit(backend, unitKey(1), bytesOf(1))
            await fenceExit(backend, { damagedCommitBytes: null, now: () => 2 })
            const record = await storedFence(backend)
            expect(record.keys).toContain('m-0000000zzzzzzzzzzzzzzzzzzz')
            expect(record.keys).toContain(tailOfKey(unitKey(1)))
        })

        test('carries unknown fields of the record and of every prior entry, and old priorFences', async () => {
            const backend = await open()
            await plantFence(backend, fenceBytes({
                v: 1, at: 1, futureTop: { n: 1 }, keys: [],
                priorCommits: [{ at: 1, bytes: 'AAAA', futureEntry: 'e' }],
                priorFences: [{ at: 1, bytes: 'BBBB', futureFenceEntry: 'f' }],
            }))
            await fenceExit(backend, { damagedCommitBytes: null, now: () => 2 })
            const record = await storedFence(backend) as unknown as Record<string, unknown> & FenceRecord
            expect(record.futureTop).toEqual({ n: 1 })
            expect((record.priorCommits[0] as unknown as Record<string, unknown>).futureEntry).toBe('e')
            expect(record.priorCommits[0].bytes).toBe('AAAA')
            expect((record.priorFences![0] as unknown as Record<string, unknown>).futureFenceEntry).toBe('f')
        })

        test('over an unparsable fence (vectors F2 and F6, the F5 shape): keys are the full listing and the damaged bytes are kept in priorFences', async () => {
            const backend = await open()
            await plantUnit(backend, unitKey(1), bytesOf(1))
            await plantUnit(backend, unitKey(2), bytesOf(2))
            const damaged = vector('fence-F6-')
            await plantFence(backend, damaged)
            const result = await fenceExit(backend, { damagedCommitBytes: null, now: () => 3 })
            expect(result.status).toBe('written')
            const record = await storedFence(backend)
            expect(record.keys).toEqual(await listedTails(backend))
            expect(record.keys).toHaveLength(2)
            expect(record.priorFences).toEqual([{ at: 3, bytes: base64Url(damaged) }])
            expect(record.priorCommits).toEqual([{ at: 3, bytes: null }])
            expect(record.at).toBe(3)
            if (result.status === 'written') {
                expect(result.replacedUnparsable).toBe(true)
            }
            expect((await readFenceVerdict(backend)).state).toBe('fenced')
        })

        test('over a fence whose frame is intact but whose body is junk (vector F2) the old bytes are kept verbatim', async () => {
            const backend = await open()
            const damaged = vector('fence-F2-')
            await plantFence(backend, damaged)
            await fenceExit(backend, { damagedCommitBytes: DAMAGED_COMMIT, now: () => 4 })
            const record = await storedFence(backend)
            expect(Buffer.from(record.priorFences![0].bytes, 'base64url').equals(Buffer.from(damaged))).toBe(true)
            expect(record.priorCommits[0].bytes).toBe(base64Url(DAMAGED_COMMIT))
        })

        test('over a too-new fence the exit is not offered and the fence is untouched', async () => {
            const backend = await open()
            const newer = vector('fence-F3-')
            await plantFence(backend, newer)
            const result = await fenceExit(backend, { damagedCommitBytes: null })
            expect(result).toMatchObject({ status: 'not-offered', reason: 'fence-too-new' })
            expect([...(await backend.readFence()).bytes!]).toEqual([...newer])
        })

        test('reads the fence first, then lists, then writes the fence; it never reads or writes the commit key', async () => {
            const backend = await open()
            await plantUnit(backend, unitKey(1), bytesOf(1))
            await plantCommit(backend, DAMAGED_COMMIT)
            const before = (await backend.readCommit()).bytes
            const { backend: wrapped, log } = traced(backend)
            expect((await fenceExit(wrapped, { damagedCommitBytes: DAMAGED_COMMIT })).status).toBe('written')
            expect(log).toEqual(['readFence', 'listStore2', 'casFence'])
            expect([...(await backend.readCommit()).bytes!]).toEqual([...before!])
        })

        test('a fence changed between the read and the write conflicts, and the exit re-runs from the fence read with the foreign key kept', async () => {
            const backend = await open()
            await plantUnit(backend, unitKey(1), bytesOf(1))
            const { backend: wrapped, log } = traced(backend, {
                after: async (name, count) => {
                    if (name === 'listStore2' && count === 1) {
                        await plantFence(backend, fenceBytes({ v: 1, at: 7, priorCommits: [], keys: ['m-0000000yyyyyyyyyyyyyyyyyyy'] }))
                    }
                },
            })
            const result = await fenceExit(wrapped, { damagedCommitBytes: null, now: () => 50 })
            expect(result).toMatchObject({ status: 'written', attempts: 2 })
            expect(log).toEqual(['readFence', 'listStore2', 'casFence', 'readFence', 'listStore2', 'casFence'])
            const record = await storedFence(backend)
            expect(record.keys).toContain('m-0000000yyyyyyyyyyyyyyyyyyy')
            expect(record.keys).toContain(tailOfKey(unitKey(1)))
            expect(record.at).toBe(7)
        })

        test('a fence that keeps changing ends as contended after the attempt cap, writing nothing of its own', async () => {
            const backend = await open()
            let n = 0
            const { backend: wrapped } = traced(backend, {
                after: async (name) => {
                    if (name === 'listStore2') {
                        n++
                        await plantFence(backend, fenceBytes({ v: 1, at: n, priorCommits: [], keys: [] }))
                    }
                },
            })
            const result = await fenceExit(wrapped, { damagedCommitBytes: DAMAGED_COMMIT, maxAttempts: 2 })
            expect(result).toEqual({ status: 'contended', attempts: 2 })
            expect((await storedFence(backend)).priorCommits).toEqual([])
        })

        test('a listing that fails means the exit is not offered and nothing is written', async () => {
            const backend = await open()
            const { backend: wrapped, log } = traced(backend, { failList: true })
            const result = await fenceExit(wrapped, { damagedCommitBytes: DAMAGED_COMMIT })
            expect(result).toMatchObject({ status: 'not-offered', reason: 'listing-failed' })
            expect(log).toEqual(['readFence', 'listStore2'])
            expect((await backend.readFence()).bytes).toBeNull()
        })

        test('a fence that cannot be read means the exit is not offered', async () => {
            const backend = await open()
            const { backend: wrapped, log } = traced(backend, { failReadFence: true })
            expect(await fenceExit(wrapped, { damagedCommitBytes: null })).toMatchObject({ status: 'not-offered', reason: 'fence-unreadable' })
            expect(log).toEqual(['readFence'])
        })

        test('a backend that reports an unflushed fence write gets a not-durable result, never a success', async () => {
            const backend = await open()
            const { backend: wrapped } = traced(backend, { fenceFlushed: false })
            const result = await fenceExit(wrapped, { damagedCommitBytes: DAMAGED_COMMIT, now: () => 9 })
            expect(result.status).toBe('not-durable')
            expect((await storedFence(backend)).priorCommits).toEqual([{ at: 9, bytes: base64Url(DAMAGED_COMMIT) }])
            const rerun = await fenceExit(backend, { damagedCommitBytes: DAMAGED_COMMIT, now: () => 10 })
            expect(rerun.status).toBe('written')
            expect((await storedFence(backend)).priorCommits).toHaveLength(2)
        })

        test('a backend that reports a flushed fence write succeeds with flushed true; one that does not report succeeds with undefined', async () => {
            const backend = await open()
            const flushed = await fenceExit(traced(backend, { fenceFlushed: true }).backend, { damagedCommitBytes: null })
            expect(flushed).toMatchObject({ status: 'written', flushed: true })
            const unreported = await fenceExit(traced(backend, { fenceFlushed: undefined }).backend, { damagedCommitBytes: null })
            expect(unreported).toMatchObject({ status: 'written', flushed: undefined })
        })
    })

    describe('discard', () => {
        test('deletes a parsable fence at the token just read', async () => {
            const backend = await open()
            await plantFence(backend, vector('fence-F1-'))
            const verdict = await readFenceVerdict(backend)
            expect(await discardFence(backend, verdict.token!)).toMatchObject({ status: 'discarded' })
            expect((await readFenceVerdict(backend)).state).toBe('absent')
        })

        test('deletes an unparsable fence at the bytes just read (vector F6)', async () => {
            const backend = await open()
            await plantFence(backend, vector('fence-F6-'))
            const verdict = await readFenceVerdict(backend)
            expect(verdict.state).toBe('blocked')
            expect(await discardFence(backend, verdict.token!)).toMatchObject({ status: 'discarded' })
            expect((await readFenceVerdict(backend)).state).toBe('absent')
        })

        test('a fence changed after the read conflicts, deletes nothing, and a re-read lets the caller ask again', async () => {
            const backend = await open()
            await plantFence(backend, vector('fence-F1-'))
            const stale = await readFenceVerdict(backend)
            await fenceExit(backend, { damagedCommitBytes: null })
            const extended = (await backend.readFence()).bytes!
            expect(await discardFence(backend, stale.token!)).toEqual({ status: 'conflict' })
            expect([...(await backend.readFence()).bytes!]).toEqual([...extended])
            const fresh = await readFenceVerdict(backend)
            expect(await discardFence(backend, fresh.token!)).toMatchObject({ status: 'discarded' })
        })
    })
})

describe('fence exit over a failing write (memory)', () => {
    test('a lost response on the fence write is a failed result carrying the cause, and a re-run reads the fence first', async () => {
        const memory = createMemoryBackend()
        memory.injectFault(3, 'lose-response')
        const result = await fenceExit(memory, { damagedCommitBytes: null, now: () => 1 })
        expect(result.status).toBe('failed')
        if (result.status === 'failed') {
            expect(result.cause).toBeInstanceOf(Store2UnknownOutcomeError)
        }
        const rerun = await fenceExit(memory, { damagedCommitBytes: null, now: () => 2 })
        expect(rerun.status).toBe('written')
        expect((await storedFence(memory)).priorCommits).toHaveLength(2)
    })
})
