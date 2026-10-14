import { describe, expect, test } from 'vitest'
import { Store2BackendFailureError, Store2CommitConflictError, Store2FenceConflictError, Store2UnknownOutcomeError, createMemoryBackend } from 'src/ts/storage/store2/backend'
import { absentCommit, absentFence, bytesOf, runBackendConformance, unit, unitKey } from './backendConformance'

runBackendConformance('memory', async () => {
    const backend = createMemoryBackend()
    return { backend, plant: async (key, bytes) => backend.poke(key, bytes) }
}, { compare: 'bytes', atomicUnits: true })

describe('memory backend fault injection', () => {
    test('a failed call changes nothing and reports a definite failure', async () => {
        const backend = createMemoryBackend()
        const absent = await absentCommit(backend)
        backend.injectFault(1, 'fail')
        await expect(backend.commitOrdinary(absent, [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
        expect(backend.snapshot().size).toBe(0)
    })

    test('a lost response applies the call and reports an unknown outcome', async () => {
        const backend = createMemoryBackend()
        const absent = await absentCommit(backend)
        backend.injectFault(1, 'lose-response')
        await expect(backend.commitOrdinary(absent, [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        expect(backend.snapshot().has(unitKey(1))).toBe(true)
        expect([...(await backend.readCommit()).bytes!]).toEqual([1])
    })

    test('the n-th call is hit, once, and a retry at the old token then conflicts', async () => {
        const backend = createMemoryBackend()
        const absent = await absentCommit(backend)
        backend.injectFault(3, 'lose-response')
        await backend.readCommit()
        await backend.readFence()
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
        await expect(backend.casCommit(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2CommitConflictError)
        await backend.casCommit((await backend.readCommit()).token, bytesOf(2))
    })

    test('a lost response on a call that would have conflicted is an unknown outcome, not the conflict', async () => {
        const backend = createMemoryBackend()
        const absent = await absentCommit(backend)
        await backend.casCommit(absent, bytesOf(1))
        backend.injectFault(1, 'lose-response')
        const error = await backend.casCommit(absent, bytesOf(2)).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Store2UnknownOutcomeError)
        expect((error as Store2UnknownOutcomeError).cause).toBeInstanceOf(Store2CommitConflictError)
        backend.injectFault(1, 'lose-response')
        const noFence = await absentFence(backend).catch((e: unknown) => e)
        expect(noFence).toBeInstanceOf(Store2UnknownOutcomeError)
    })

    test('a lost response on an argument error stays the RangeError', async () => {
        const backend = createMemoryBackend()
        backend.injectFault(1, 'lose-response')
        await expect(backend.putUnit('assets/a', bytesOf(1))).rejects.toBeInstanceOf(RangeError)
    })

    test('a fault at call zero, a negative call or a fraction is refused', () => {
        const backend = createMemoryBackend()
        for (const call of [0, -1, 1.5, Number.NaN]) {
            expect(() => backend.injectFault(call, 'fail')).toThrowError(RangeError)
        }
    })
})

describe('memory backend write results', () => {
    test('every writing method reports no flush status, never true', async () => {
        const backend = createMemoryBackend()
        const results = [
            await backend.casCommit(await absentCommit(backend), bytesOf(1)),
            await backend.casFence(await absentFence(backend), bytesOf(1)),
            await backend.putUnit(unitKey(1), bytesOf(1)),
            await backend.commitOrdinary((await backend.readCommit()).token, [unit(2)], bytesOf(2)),
            await backend.removeBatch([unitKey(1)], (await backend.readCommit()).token, (await backend.readFence()).token),
        ]
        for (const result of results) {
            expect(result).toEqual({ flushed: undefined })
            expect('flushed' in result).toBe(true)
        }
    })
})

describe('memory backend tokens', () => {
    test('a revision token belongs to the Node backend and is refused with a RangeError, writing nothing', async () => {
        const backend = createMemoryBackend()
        const revision = { kind: 'revision', revision: 0, present: false } as const
        await expect(backend.casCommit(revision, bytesOf(1))).rejects.toBeInstanceOf(RangeError)
        await expect(backend.casFence(revision, null)).rejects.toBeInstanceOf(RangeError)
        await expect(backend.commitOrdinary(revision, [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
        await expect(backend.removeBatch([unitKey(1)], revision, revision)).rejects.toBeInstanceOf(RangeError)
        expect(backend.snapshot().size).toBe(0)
    })
})

describe('memory backend fence conflict reporting', () => {
    test('a fence conflict under a lost response is also unknown', async () => {
        const backend = createMemoryBackend()
        const absent = await absentFence(backend)
        await backend.casFence(absent, bytesOf(1))
        backend.injectFault(1, 'lose-response')
        const error = await backend.casFence(absent, bytesOf(2)).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Store2UnknownOutcomeError)
        expect((error as Store2UnknownOutcomeError).cause).toBeInstanceOf(Store2FenceConflictError)
    })
})
