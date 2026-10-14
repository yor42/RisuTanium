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
    /** Every durable write as it starts and settles, with the most in flight at once; `before` can hold a write by key. */
    const writes: { events: string[], inflight: number, peak: number, before: ((key: string) => Promise<void> | undefined) | undefined } = { events: [], inflight: 0, peak: 0, before: undefined }
    async function invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
        // The store2 top-level keys go through the gated raw command; it is held and flushed like the durable one.
        if (command !== 'write_durable' && command !== 'store2_write_top_raw') {
            return desktop.invoke(command, args, options)
        }
        const key = decodeURIComponent(options?.headers?.['x-risu-key'] ?? '')
        writes.events.push(`start ${key}`)
        writes.inflight++
        writes.peak = Math.max(writes.peak, writes.inflight)
        try {
            await writes.before?.(key)
            await desktop.invoke(command, args, options)
        } finally {
            writes.inflight--
            writes.events.push(`end ${key}`)
        }
        const fault = flush.fault?.(key) ?? null
        return fault === 'unreported' ? undefined : { flushed: fault === null }
    }
    return { fs, desktop, bounded, paths, flush, writes, invoke }
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
    Store2StalePageError,
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
    h.writes.events.length = 0
    h.writes.inflight = 0
    h.writes.peak = 0
    h.writes.before = undefined
    h.desktop.chunk.reportFlushes()
    h.fs.setPlatform('windows')
    resetByteTransportForTests()
}

async function open(): Promise<{ store: ByteStore, backend: Store2Backend }> {
    const store = createTauriFilesStore({ platform: 'windows' })
    return { store, backend: await createTauriBackend(store) }
}

function peek(key: string): number[] | null {
    const bytes = h.fs.files.get(key)
    return bytes === undefined ? null : [...bytes]
}

// Units are kept (an atomic step across units is not available: each unit is its own file), and compare is of full bytes.
runBackendConformance('tauri (desktop transport)', async () => {
    reset()
    const { backend } = await open()
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
            const { backend } = await open()
            await backend.casCommit(await absentCommit(backend), bytesOf(9))
            const base = await backend.readCommit()
            h.flush.fault = (key) => key === unitKey(2) ? fault : null
            h.fs.durableLog.length = 0

            await expect(backend.commitOrdinary(base.token, [unit(1), unit(2), unit(3)], bytesOf(10))).rejects.toBeInstanceOf(Store2BackendFailureError)

            expect(peek(COMMIT_KEY)).toEqual([9])
            expect(h.fs.durableLog).not.toContain(COMMIT_KEY)
            // Units are written concurrently, so which siblings of the unflushed unit were written is not fixed.
            expect(h.fs.durableLog).toContain(unitKey(2))
        })

        test('a commit whose units all report flushed writes the commit key last and returns the flush status of the commit key', async () => {
            const { backend } = await open()
            h.flush.fault = (key) => key === COMMIT_KEY ? 'failed' : null
            h.fs.durableLog.length = 0

            const result = await backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(5))

            expect(result).toEqual({ flushed: false })
            expect([...h.fs.durableLog].sort()).toEqual([COMMIT_KEY, unitKey(1), unitKey(2)].sort())
            expect(h.fs.durableLog[h.fs.durableLog.length - 1]).toBe(COMMIT_KEY)
            expect(peek(COMMIT_KEY)).toEqual([5])
        })

        test('a commit whose units and commit key all flush reports flushed true', async () => {
            const { backend } = await open()
            expect(await backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(5))).toEqual({ flushed: true })
        })

        test('a commit key or fence write whose command reports no flush status is flushed false, while a unit keeps its unreported status', async () => {
            const { backend } = await open()
            h.flush.fault = () => 'unreported'

            expect(await backend.casCommit(await absentCommit(backend), bytesOf(1))).toEqual({ flushed: false })
            expect(await backend.casFence(await absentFence(backend), bytesOf(2))).toEqual({ flushed: false })
            expect(await backend.commitOrdinary((await backend.readCommit()).token, [], bytesOf(3))).toEqual({ flushed: false })
            expect(await backend.putUnit(unitKey(1), bytesOf(4))).toEqual({ flushed: undefined })
            expect(peek(COMMIT_KEY)).toEqual([3])
            expect(peek(FENCE_KEY)).toEqual([2])
        })

        test('a unit that already exists stops the commit before any write, and the commit key is unchanged', async () => {
            const { backend } = await open()
            h.fs.plant(unitKey(2), bytesOf(1))
            h.fs.durableLog.length = 0

            await expect(backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(5))).rejects.toBeInstanceOf(Store2OverwriteRefusedError)

            expect(h.fs.durableLog).toEqual([])
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test('a commit-key mismatch is reported before any unit is written', async () => {
            const { backend } = await open()
            const stale = await absentCommit(backend)
            h.fs.plant(COMMIT_KEY, bytesOf(1))
            h.fs.durableLog.length = 0

            await expect(backend.commitOrdinary(stale, [unit(1)], bytesOf(5))).rejects.toBeInstanceOf(Store2CommitConflictError)

            expect(h.fs.durableLog).toEqual([])
        })

        test('the store2 kinds go through the durable command and a plain key does not', async () => {
            const { backend } = await open()
            await backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(5))
            await backend.casFence(await absentFence(backend), bytesOf(6))
            await backend.putUnit(unitKey(2), bytesOf(7))

            expect(h.fs.durableLog).toEqual([unitKey(1), COMMIT_KEY, FENCE_KEY, unitKey(2)])
            // The sweep marker is a plain write the backend never makes itself; planting it must not show up as durable.
            h.fs.plant(SWEEP_KEY, bytesOf(1))
            expect(h.fs.durableLog).not.toContain(SWEEP_KEY)
        })

        test('putUnit refuses an existing key and returns the store flush status', async () => {
            const { backend } = await open()
            expect(await backend.putUnit(unitKey(1), bytesOf(1))).toEqual({ flushed: true })
            await expect(backend.putUnit(unitKey(1), bytesOf(2))).rejects.toBeInstanceOf(Store2OverwriteRefusedError)
            expect(peek(unitKey(1))).toEqual([1])
            h.flush.fault = () => 'unreported'
            expect(await backend.putUnit(unitKey(2), bytesOf(1))).toEqual({ flushed: undefined })
        })
    })

    describe('concurrent unit writes', () => {
        const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
        const unitKeys = (count: number): string[] => Array.from({ length: count }, (_, i) => unitKey(i + 1))
        const starts = (): string[] => h.writes.events.filter((event) => event.startsWith('start ')).map((event) => event.slice('start '.length))

        /** Holds the durable write of each listed key until `release` is called for it. */
        function hold(keys: readonly string[]): { release: (key: string) => void } {
            const releases = new Map<string, () => void>()
            h.writes.before = (key) => keys.includes(key) ? new Promise<void>((resolve) => { releases.set(key, resolve) }) : undefined
            return { release: (key) => releases.get(key)?.() }
        }

        async function writeStarted(key: string): Promise<void> {
            await vi.waitFor(() => expect(h.writes.events).toContain(`start ${key}`))
        }

        test.each(['casCommit', 'removeBatch'] as const)('a held unit write keeps the mutex: a queued %s does not start until every unit write has settled', async (queuedStep) => {
            const { backend } = await open()
            const base = await absentCommit(backend)
            const fence = await backend.readFence()
            h.fs.failDurableWrites('disk full', (key) => key === unitKey(1))
            const gate = hold([unitKey(2)])
            const commit = backend.commitOrdinary(base, [unit(1), unit(2)], bytesOf(5)).catch((error: unknown) => error)
            await writeStarted(unitKey(2))
            const queued = queuedStep === 'casCommit' ? backend.casCommit(base, bytesOf(7)) : backend.removeBatch([], base, fence.token)
            let queuedDone = false
            void queued.then(() => { queuedDone = true }, () => { queuedDone = true })

            await tick()
            expect(queuedDone).toBe(false)

            gate.release(unitKey(2))
            expect(await commit).toBeInstanceOf(Store2BackendFailureError)
            await queued
            expect(queuedDone).toBe(true)
        })

        test('a failing unit with a slower sibling in flight: the sibling settles before the mutex is released and the commit key is untouched', async () => {
            const { backend } = await open()
            const base = await absentCommit(backend)
            const absent = await absentFence(backend)
            h.fs.failDurableWrites('disk full', (key) => key === unitKey(2))
            const gate = hold([unitKey(3)])
            const commit = backend.commitOrdinary(base, [unit(1), unit(2), unit(3)], bytesOf(5)).catch((error: unknown) => error)
            await writeStarted(unitKey(3))
            const queued = backend.casFence(absent, bytesOf(8))

            await tick()
            expect(h.writes.events).not.toContain(`start ${FENCE_KEY}`)

            gate.release(unitKey(3))
            expect(await commit).toBeInstanceOf(Store2BackendFailureError)
            await queued
            expect(h.writes.events.indexOf(`end ${unitKey(3)}`)).toBeLessThan(h.writes.events.indexOf(`start ${FENCE_KEY}`))
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test('the error names the first failing unit in input order, not the first to fail', async () => {
            const { backend } = await open()
            h.fs.failDurableWrites('disk full', (key) => key === unitKey(1) || key === unitKey(2))
            const gate = hold([unitKey(1)])
            const commit = backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(5)).catch((error: unknown) => error)
            await vi.waitFor(() => expect(h.writes.events).toContain(`end ${unitKey(2)}`))
            gate.release(unitKey(1))

            const error = await commit

            expect(error).toBeInstanceOf(Store2BackendFailureError)
            expect((error as Error).message).toContain(unitKey(1))
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test.each([
            ['failed', 'flush failed'],
            ['unreported', 'flush was not reported'],
        ] as const)('a unit whose flush is %s blocks the commit key and the error names that unit', async (fault, phrase) => {
            const { backend } = await open()
            h.flush.fault = (key) => key === unitKey(1) ? fault : null

            const error = await backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2), unit(3)], bytesOf(5)).catch((e: unknown) => e)

            expect(error).toBeInstanceOf(Store2BackendFailureError)
            expect((error as Error).message).toContain(unitKey(1))
            expect((error as Error).message).toContain(phrase)
            expect(h.fs.durableLog).not.toContain(COMMIT_KEY)
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test('unit writes overlap, and at most four are in flight at once', async () => {
            const { backend } = await open()
            h.writes.before = () => tick(5)

            await backend.commitOrdinary(await absentCommit(backend), unitKeys(7).map((_, i) => unit(i + 1)), bytesOf(5))

            expect(h.writes.peak).toBe(4)
        })

        test('after a failure no new unit write starts, while the writes already started are awaited', async () => {
            const { backend } = await open()
            h.fs.failDurableWrites('disk full', (key) => key === unitKey(1))
            const gate = hold(unitKeys(4).slice(1))
            const commit = backend.commitOrdinary(await absentCommit(backend), unitKeys(7).map((_, i) => unit(i + 1)), bytesOf(5)).catch((error: unknown) => error)
            await vi.waitFor(() => expect(h.writes.events).toContain(`end ${unitKey(1)}`))
            await tick()
            for (const key of unitKeys(4).slice(1)) {
                gate.release(key)
            }

            expect(await commit).toBeInstanceOf(Store2BackendFailureError)

            expect(starts()).toEqual(unitKeys(4))
            expect(h.writes.inflight).toBe(0)
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test('guard: when every unit settles flushed, the commit key is written last, after the last unit write has ended', async () => {
            const { backend } = await open()
            h.writes.before = () => tick(5)

            const result = await backend.commitOrdinary(await absentCommit(backend), unitKeys(7).map((_, i) => unit(i + 1)), bytesOf(5))

            expect(result).toEqual({ flushed: true })
            const commitStart = h.writes.events.indexOf(`start ${COMMIT_KEY}`)
            for (const key of unitKeys(7)) {
                expect(h.writes.events.indexOf(`end ${key}`)).toBeGreaterThanOrEqual(0)
                expect(h.writes.events.indexOf(`end ${key}`)).toBeLessThan(commitStart)
            }
            expect(h.fs.durableLog[h.fs.durableLog.length - 1]).toBe(COMMIT_KEY)
        })
    })

    describe('the mutex', () => {
        test('two concurrent casCommit calls on the same token: one wins, the other conflicts with the winner as current', async () => {
            const { backend } = await open()
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

        test('a second backend over one store object makes the first stale: its decisive writes are refused and nothing it sends lands', async () => {
            const store = createTauriFilesStore({ platform: 'windows' })
            const first = await createTauriBackend(store)
            const second = await createTauriBackend(store)
            const base = await absentCommit(first)

            const settled = await Promise.allSettled([first.casCommit(base, bytesOf(2)), second.casCommit(base, bytesOf(3))])

            expect(settled.map((s) => s.status)).toEqual(['rejected', 'fulfilled'])
            expect((settled[0] as PromiseRejectedResult).reason).toBeInstanceOf(Store2StalePageError)
            expect(peek(COMMIT_KEY)).toEqual([3])
            // Refused before the disk: the stale page's bytes never reached the file system, only the current page's write did.
            expect(h.fs.durableLog).toEqual([COMMIT_KEY])
            expect(h.desktop.topCalls.map((call) => call.gen)).toEqual([1, 2])
        })

        test('a commit and a concurrent casCommit from the same base do not both apply', async () => {
            const { backend } = await open()
            const base = await absentCommit(backend)

            const settled = await Promise.allSettled([backend.commitOrdinary(base, [unit(1)], bytesOf(2)), backend.casCommit(base, bytesOf(3))])

            expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
        })

        test('first life: a commit key that appeared between the read and the create conflicts and is not overwritten', async () => {
            const { backend } = await open()
            const absent = await absentCommit(backend)
            h.fs.plant(COMMIT_KEY, bytesOf(4, 4))

            const error = await backend.casCommit(absent, bytesOf(1)).catch((e: unknown) => e)

            expect(error).toBeInstanceOf(Store2CommitConflictError)
            expect([...((error as Store2CommitConflictError).current.bytes ?? [])]).toEqual([4, 4])
            expect(peek(COMMIT_KEY)).toEqual([4, 4])
        })

        test('first life of the fence: a fence that appeared between the read and the create conflicts', async () => {
            const { backend } = await open()
            const absent = await absentFence(backend)
            h.fs.plant(FENCE_KEY, bytesOf(8))

            await expect(backend.casFence(absent, bytesOf(1))).rejects.toBeInstanceOf(Store2FenceConflictError)
            expect(peek(FENCE_KEY)).toEqual([8])
        })
    })

    describe('removeBatch', () => {
        async function seeded(): Promise<{ backend: Store2Backend, commit: Awaited<ReturnType<Store2Backend['readCommit']>>, fence: Awaited<ReturnType<Store2Backend['readFence']>> }> {
            const { backend } = await open()
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
            const { backend } = await open()
            const revision = { kind: 'revision', revision: 1, present: false } as const
            await expect(backend.casCommit(revision, bytesOf(1))).rejects.toBeInstanceOf(RangeError)
            await expect(backend.casFence(revision, null)).rejects.toBeInstanceOf(RangeError)
            await expect(backend.commitOrdinary(revision, [], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
            await expect(backend.removeBatch([], revision, tokenOf(null))).rejects.toBeInstanceOf(RangeError)
            expect(h.fs.durableLog).toEqual([])
        })

        test('a commit-key write that rejects is an unknown outcome and a unit write that rejects is a definite failure of the commit', async () => {
            const { backend } = await open()
            h.fs.failDurableWrites('transport lost', (key) => key === COMMIT_KEY)
            await expect(backend.casCommit(await absentCommit(backend), bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)
            await expect(backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(1))).rejects.toBeInstanceOf(Store2UnknownOutcomeError)

            h.fs.clearFaults()
            h.fs.failDurableWrites('disk full', (key) => key === unitKey(2))
            await expect(backend.commitOrdinary(await absentCommit(backend), [unit(2)], bytesOf(1))).rejects.toBeInstanceOf(Store2BackendFailureError)
            expect(peek(COMMIT_KEY)).toBeNull()
        })

        test('a removeBatch whose later removal fails after an earlier one succeeded is an unknown outcome, not a definite failure', async () => {
            const { backend } = await open()
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
            const { backend } = await open()
            await backend.casFence(await absentFence(backend), bytesOf(6))
            const present = await backend.readFence()
            h.fs.failRemoves('transport lost', (path) => path.endsWith(FENCE_KEY))

            const error = await backend.casFence(present.token, null).catch((e: unknown) => e)

            expect(error).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(error).not.toBeInstanceOf(Store2BackendFailureError)
        })

        test('listStore2 and countPrefix leave out the top-level keys', async () => {
            const { backend } = await open()
            await backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2)], bytesOf(1))
            await backend.casFence(await absentFence(backend), bytesOf(2))
            h.fs.plant(SWEEP_KEY, bytesOf(1))

            expect(await backend.listStore2()).toEqual([unitKey(1), unitKey(2)])
            expect(await backend.countPrefix('store2/')).toBe(2)
        })
    })
})
