// @vitest-environment node
/**
 * The store2 Tauri backend over the real `createTauriFilesStore` with the desktop
 * transport selected, on the desktop command and file system stand-ins: the shared
 * conformance suite, then what is specific to this backend (the mutex, the flush
 * gate in front of the commit key, outcome classification). The stand-in
 * `write_durable` answers `{ flushed }` the way the Rust command does, so a test
 * can make a unit or the commit key report an unflushed directory. A pass is not
 * evidence about the Rust commands or the plugin on a device.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const CAP_BYTES = 4 * 1024 * 1024
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const fake = await import('src/ts/storage/tests/tauriDesktopFake')
    const desktop = fake.createDesktopInvoke(fs, { cap: CAP_BYTES })
    const bounded = fake.createBoundedFs(fs, { cap: CAP_BYTES })
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    /** What a durable write reports for a key: `null` is a flushed directory. */
    const flush: { fault: ((key: string) => 'failed' | 'unreported' | null) | undefined } = { fault: undefined }
    async function invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
        const answer = await desktop.invoke(command, args, options)
        if (command !== 'write_durable') {
            return answer
        }
        const key = decodeURIComponent(options?.headers?.['x-risu-key'] ?? '')
        const fault = flush.fault?.(key) ?? null
        return fault === 'unreported' ? undefined : { flushed: fault === null }
    }
    return { fs, desktop, bounded, paths, flush, invoke }
})

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

import {
    Store2BackendFailureError,
    Store2CommitConflictError,
    Store2FenceConflictError,
    Store2OverwriteRefusedError,
    Store2UnknownOutcomeError,
    createTauriBackend,
    type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY, SWEEP_KEY } from 'src/ts/storage/store2/format/keys'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { absentCommit, absentFence, bytesOf, runBackendConformance, tokenOf, unit, unitKey } from './backendConformance'

function reset(): void {
    h.fs.reset()
    h.desktop.reset()
    h.bounded.reset()
    h.paths.reset()
    h.flush.fault = undefined
    h.desktop.chunk.reportFlushes()
    h.fs.setPlatform('windows')
    resetByteTransportForTests()
}

function open(): { store: ByteStore, backend: Store2Backend } {
    const store = createTauriFilesStore({ platform: 'windows' })
    return { store, backend: createTauriBackend(store) }
}

function peek(key: string): number[] | null {
    const bytes = h.fs.files.get(key)
    return bytes === undefined ? null : [...bytes]
}

// Units are kept (an atomic step across units is not available: each unit is its own file), and compare is of full bytes.
runBackendConformance('tauri (desktop transport)', async () => {
    reset()
    const { backend } = open()
    return {
        backend,
        plant: async (key, bytes) => {
            // A file named like the unit directory cannot exist beside that directory on a real file system.
            if (key !== 'store2') {
                h.fs.plant(key, bytes)
            }
        },
    }
}, { compare: 'bytes', atomicUnits: false })

describe('tauri backend', () => {
    beforeEach(reset)

    describe('durability gate in front of the commit key', () => {
        test.each(['failed', 'unreported'] as const)('a unit whose write is %s stops the commit before the commit key, which stays as it was', async (fault) => {
            const { backend } = open()
            await backend.casCommit(await absentCommit(backend), bytesOf(9))
            const base = await backend.readCommit()
            h.flush.fault = (key) => key === unitKey(2) ? fault : null
            h.fs.durableLog.length = 0

            await expect(backend.commitOrdinary(base.token, [unit(1), unit(2), unit(3)], bytesOf(10))).rejects.toBeInstanceOf(Store2BackendFailureError)

            expect(peek(COMMIT_KEY)).toEqual([9])
            expect(h.fs.durableLog).not.toContain(COMMIT_KEY)
            // The unit that was reported unflushed was never named by a commit; the one after it was not attempted.
            expect(h.fs.durableLog).toEqual([unitKey(1), unitKey(2)])
            expect(peek(unitKey(3))).toBeNull()
        })

        test('a commit whose units all report flushed writes the commit key last and returns the flush status of the commit key', async () => {
            const { backend } = open()
            h.flush.fault = (key) => key === COMMIT_KEY ? 'failed' : null
            h.fs.durableLog.length = 0

            const result = await backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(5))

            expect(result).toEqual({ flushed: false })
            expect(h.fs.durableLog).toEqual([unitKey(1), unitKey(2), COMMIT_KEY])
            expect(peek(COMMIT_KEY)).toEqual([5])
        })

        test('a commit whose units and commit key all flush reports flushed true', async () => {
            const { backend } = open()
            expect(await backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(5))).toEqual({ flushed: true })
        })

        test('a commit key or fence write whose command reports no flush status is flushed false, while a unit keeps its unreported status', async () => {
            const { backend } = open()
            h.flush.fault = () => 'unreported'

            expect(await backend.casCommit(await absentCommit(backend), bytesOf(1))).toEqual({ flushed: false })
            expect(await backend.casFence(await absentFence(backend), bytesOf(2))).toEqual({ flushed: false })
            expect(await backend.commitOrdinary((await backend.readCommit()).token, [], bytesOf(3))).toEqual({ flushed: false })
            expect(await backend.putUnit(unitKey(1), bytesOf(4))).toEqual({ flushed: undefined })
            expect(peek(COMMIT_KEY)).toEqual([3])
            expect(peek(FENCE_KEY)).toEqual([2])
        })

        test('a unit that already exists stops the commit before any write, and the commit key is unchanged', async () => {
            const { backend } = open()
            h.fs.plant(unitKey(2), bytesOf(1))
            h.fs.durableLog.length = 0

            await expect(backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(5))).rejects.toBeInstanceOf(Store2OverwriteRefusedError)

            expect(h.fs.durableLog).toEqual([])
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test('a commit-key mismatch is reported before any unit is written', async () => {
            const { backend } = open()
            const stale = await absentCommit(backend)
            h.fs.plant(COMMIT_KEY, bytesOf(1))
            h.fs.durableLog.length = 0

            await expect(backend.commitOrdinary(stale, [unit(1)], bytesOf(5))).rejects.toBeInstanceOf(Store2CommitConflictError)

            expect(h.fs.durableLog).toEqual([])
        })

        test('the store2 kinds go through the durable command and a plain key does not', async () => {
            const { backend } = open()
            await backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(5))
            await backend.casFence(await absentFence(backend), bytesOf(6))
            await backend.putUnit(unitKey(2), bytesOf(7))

            expect(h.fs.durableLog).toEqual([unitKey(1), COMMIT_KEY, FENCE_KEY, unitKey(2)])
            // The sweep marker is a plain write the backend never makes itself; planting it must not show up as durable.
            h.fs.plant(SWEEP_KEY, bytesOf(1))
            expect(h.fs.durableLog).not.toContain(SWEEP_KEY)
        })

        test('putUnit refuses an existing key and returns the store flush status', async () => {
            const { backend } = open()
            expect(await backend.putUnit(unitKey(1), bytesOf(1))).toEqual({ flushed: true })
            await expect(backend.putUnit(unitKey(1), bytesOf(2))).rejects.toBeInstanceOf(Store2OverwriteRefusedError)
            expect(peek(unitKey(1))).toEqual([1])
            h.flush.fault = () => 'unreported'
            expect(await backend.putUnit(unitKey(2), bytesOf(1))).toEqual({ flushed: undefined })
        })
    })

    describe('the mutex', () => {
        test('two concurrent casCommit calls on the same token: one wins, the other conflicts with the winner as current', async () => {
            const { backend } = open()
            await backend.casCommit(await absentCommit(backend), bytesOf(1))
            const base = (await backend.readCommit()).token

            const settled = await Promise.allSettled([backend.casCommit(base, bytesOf(2)), backend.casCommit(base, bytesOf(3))])

            expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
            const lost = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
            expect(lost?.reason).toBeInstanceOf(Store2CommitConflictError)
            const winner = peek(COMMIT_KEY)
            expect([[2], [3]]).toContainEqual(winner)
            expect([...((lost?.reason as Store2CommitConflictError).current.bytes ?? [])]).toEqual(winner)
        })

        test('two backends over one store object share the mutex', async () => {
            const store = createTauriFilesStore({ platform: 'windows' })
            const first = createTauriBackend(store)
            const second = createTauriBackend(store)
            const base = await absentCommit(first)

            const settled = await Promise.allSettled([first.casCommit(base, bytesOf(2)), second.casCommit(base, bytesOf(3))])

            expect(settled.map((s) => s.status).sort()).toEqual(['fulfilled', 'rejected'])
        })

        test('a commit and a concurrent casCommit from the same base do not both apply', async () => {
            const { backend } = open()
            const base = await absentCommit(backend)

            const settled = await Promise.allSettled([backend.commitOrdinary(base, [unit(1)], bytesOf(2)), backend.casCommit(base, bytesOf(3))])

            expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
        })

        test('first life: a commit key that appeared between the read and the create conflicts and is not overwritten', async () => {
            const { backend } = open()
            const absent = await absentCommit(backend)
            h.fs.plant(COMMIT_KEY, bytesOf(4, 4))

            const error = await backend.casCommit(absent, bytesOf(1)).catch((e: unknown) => e)

            expect(error).toBeInstanceOf(Store2CommitConflictError)
            expect([...((error as Store2CommitConflictError).current.bytes ?? [])]).toEqual([4, 4])
            expect(peek(COMMIT_KEY)).toEqual([4, 4])
        })

        test('first life of the fence: a fence that appeared between the read and the create conflicts', async () => {
            const { backend } = open()
            const absent = await absentFence(backend)
            h.fs.plant(FENCE_KEY, bytesOf(8))

            await expect(backend.casFence(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2FenceConflictError)
            expect(peek(FENCE_KEY)).toEqual([8])
        })
    })

    describe('removeBatch', () => {
        async function seeded(): Promise<{ backend: Store2Backend, commit: Awaited<ReturnType<Store2Backend['readCommit']>>, fence: Awaited<ReturnType<Store2Backend['readFence']>> }> {
            const { backend } = open()
            await backend.casCommit(await absentCommit(backend), bytesOf(1))
            await backend.putUnit(unitKey(1), bytesOf(1))
            await backend.putUnit(unitKey(2), bytesOf(2))
            return { backend, commit: await backend.readCommit(), fence: await backend.readFence() }
        }

        test('a fence that appeared since the read deletes nothing', async () => {
            const { backend, commit, fence } = await seeded()
            h.fs.plant(FENCE_KEY, bytesOf(9))

            await expect(backend.removeBatch([unitKey(1), unitKey(2)], commit.token, fence.token)).rejects.toBeInstanceOf(Store2FenceConflictError)

            expect(peek(unitKey(1))).toEqual([1])
            expect(peek(unitKey(2))).toEqual([2])
        })

        test('a commit key that changed since the read deletes nothing, and is reported before the fence', async () => {
            const { backend, commit, fence } = await seeded()
            h.fs.plant(COMMIT_KEY, bytesOf(2))
            h.fs.plant(FENCE_KEY, bytesOf(9))

            await expect(backend.removeBatch([unitKey(1)], commit.token, fence.token)).rejects.toBeInstanceOf(Store2CommitConflictError)

            expect(peek(unitKey(1))).toEqual([1])
        })

        test('matching tokens remove the units', async () => {
            const { backend, commit, fence } = await seeded()
            await backend.removeBatch([unitKey(1), unitKey(2), unitKey(3)], commit.token, fence.token)
            expect(peek(unitKey(1))).toBeNull()
            expect(peek(unitKey(2))).toBeNull()
        })
    })

    describe('tokens and outcomes', () => {
        test('a revision token is refused with a RangeError before anything is touched', async () => {
            const { backend } = open()
            const revision = { kind: 'revision', revision: 1, present: false } as const
            await expect(backend.casCommit(revision, bytesOf(1))).rejects.toBeInstanceOf(RangeError)
            await expect(backend.casFence(revision, null)).rejects.toBeInstanceOf(RangeError)
            await expect(backend.commitOrdinary(revision, [], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
            await expect(backend.removeBatch([], revision, tokenOf(null))).rejects.toBeInstanceOf(RangeError)
            expect(h.fs.durableLog).toEqual([])
        })

        test('a commit-key write that rejects is an unknown outcome and a unit write that rejects is a definite failure of the commit', async () => {
            const { backend } = open()
            h.fs.failDurableWrites('transport lost', (key) => key === COMMIT_KEY)
            await expect(backend.casCommit(await absentCommit(backend), bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
            await expect(backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)

            h.fs.clearFaults()
            h.fs.failDurableWrites('disk full', (key) => key === unitKey(2))
            await expect(backend.commitOrdinary(await absentCommit(backend), [unit(2)], bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test('a removeBatch whose later removal fails after an earlier one succeeded is an unknown outcome, not a definite failure', async () => {
            const { backend } = open()
            await backend.casCommit(await absentCommit(backend), bytesOf(1))
            await backend.putUnit(unitKey(1), bytesOf(1))
            await backend.putUnit(unitKey(2), bytesOf(2))
            const commit = await backend.readCommit()
            const fence = await backend.readFence()
            h.fs.failRemoves('transport lost', (path) => path.endsWith(unitKey(2)))

            const error = await backend.removeBatch([unitKey(1), unitKey(2)], commit.token, fence.token).catch((e: unknown) => e)

            expect(error).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(error).not.toBeInstanceOf(Store2BackendFailureError)
            expect(peek(unitKey(1))).toBeNull()
            expect(peek(unitKey(2))).toEqual([2])
        })

        test('a fence delete that rejects is an unknown outcome, not a definite failure', async () => {
            const { backend } = open()
            await backend.casFence(await absentFence(backend), bytesOf(6))
            const present = await backend.readFence()
            h.fs.failRemoves('transport lost', (path) => path.endsWith(FENCE_KEY))

            const error = await backend.casFence(present.token, null).catch((e: unknown) => e)

            expect(error).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(error).not.toBeInstanceOf(Store2BackendFailureError)
        })

        test('listStore2 and countPrefix leave out the top-level keys', async () => {
            const { backend } = open()
            await backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(1))
            await backend.casFence(await absentFence(backend), bytesOf(2))
            h.fs.plant(SWEEP_KEY, bytesOf(1))

            expect(await backend.listStore2()).toEqual([unitKey(1), unitKey(2)])
            expect(await backend.countPrefix('store2/')).toBe(2)
        })
    })
})
