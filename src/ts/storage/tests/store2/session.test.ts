// @vitest-environment node
/**
 * `Store2Session.open`: the Tauri re-flush over the real `createTauriFilesStore`
 * on the desktop command stand-ins (a pass is not evidence about the Rust
 * commands or a device), and the boot decision of every store kind over the
 * memory backend and the Tauri stand-in. The stand-in `write_durable` answers
 * `{ flushed }` the way the Rust command does, so a test can make the commit key
 * or the fence report an unflushed directory or no status at all.
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
    const flush: { fault: ((key: string, call: number) => 'failed' | 'unreported' | null) | undefined, calls: Map<string, number> } = { fault: undefined, calls: new Map() }
    async function invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
        const answer = await desktop.invoke(command, args, options)
        if (command !== 'write_durable' && command !== 'store2_write_top_raw') {
            return answer
        }
        const key = decodeURIComponent(options?.headers?.['x-risu-key'] ?? '')
        const call = (flush.calls.get(key) ?? 0) + 1
        flush.calls.set(key, call)
        const fault = flush.fault?.(key, call) ?? null
        return fault === 'unreported' ? undefined : { flushed: fault === null }
    }
    return { fs, desktop, bounded, paths, flush, invoke }
})

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

import { crc32 } from 'src/ts/storage/blockFrame'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import {
    Store2BackendFailureError, createMemoryBackend, createTauriBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newStagingId, stagingPrefix, UNIT_TYPE, type StagingLabel } from 'src/ts/storage/store2/format'
import type { OwnerIdStore } from 'src/ts/storage/store2/owner'
import { reflushTopLevel, Store2Session } from 'src/ts/storage/store2/session'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { bytesOf } from './backendConformance'
import { createClock, hooked, parsedCommit, plantKey, seedStore, START_TIME, testEnv } from './commitFixtures'
import { plantFence } from './fenceFixtures'

function reset(): void {
    h.fs.reset()
    h.desktop.reset()
    h.bounded.reset()
    h.paths.reset()
    h.flush.fault = undefined
    h.flush.calls.clear()
    h.desktop.chunk.reportFlushes()
    h.fs.setPlatform('windows')
    resetByteTransportForTests()
}

const clock = createClock()
const env = testEnv(clock, 61)
const OWNER = 'c'.repeat(26)

async function openTauri(): Promise<{ store: ByteStore, backend: Store2Backend }> {
    const store = createTauriFilesStore({ platform: 'windows' })
    return { store, backend: await createTauriBackend(store) }
}

function peek(key: string): number[] | null {
    const bytes = h.fs.files.get(key)
    return bytes === undefined ? null : [...bytes]
}

function fenceBytes(): Uint8Array {
    return encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: START_TIME, priorCommits: [], keys: [] })
}

function memoryOwnerStore(initial: string | null): OwnerIdStore & { stored: string | null } {
    const holder = {
        stored: initial,
        read: async () => holder.stored,
        write: async (id: string) => { holder.stored = id },
    }
    return holder
}

async function plantMarker(backend: Store2Backend, label: StagingLabel, owner: string): Promise<void> {
    await plantKey(backend, firstCommitKey({ current: null, staging: { owner, prefix: stagingPrefix(newStagingId(env)), startedAt: START_TIME, label } }, env))
}

describe('Tauri re-flush on every page load', () => {
    beforeEach(reset)

    async function seeded(withFence: boolean): Promise<{ store: ByteStore, backend: Store2Backend }> {
        const opened = await openTauri()
        await seedStore(opened.backend, env)
        if (withFence) {
            await plantFence(opened.backend, fenceBytes())
        }
        return opened
    }

    test('the commit key and the fence are rewritten with identical bytes, commit key first, and seq and epoch do not move', async () => {
        const { store, backend } = await seeded(true)
        const commitBefore = peek(COMMIT_KEY)
        const fenceBefore = peek(FENCE_KEY)
        const keyBefore = await parsedCommit(backend)
        h.fs.durableLog.length = 0

        const session = await Store2Session.open(store, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(h.fs.durableLog).toEqual([COMMIT_KEY, FENCE_KEY])
        expect(peek(COMMIT_KEY)).toEqual(commitBefore)
        expect(peek(FENCE_KEY)).toEqual(fenceBefore)
        const keyAfter = await parsedCommit(backend)
        expect([keyAfter.seq, keyAfter.epoch]).toEqual([keyBefore.seq, keyBefore.epoch])
        expect(session.reflush).toEqual({ ok: true, commit: 'flushed', fence: 'flushed' })
        expect(session.idleReason).toBeNull()
        expect(session.notice).toBeNull()
    })

    test('it runs before the first read of the tree and before the gate can open', async () => {
        const { store, backend } = await seeded(false)
        const watched = hooked(backend)

        const session = await Store2Session.open(store, { kind: 'tauri', backend: watched.backend, upstreamMainFile: async () => false })

        const firstCas = watched.log.indexOf('casCommit')
        expect(firstCas).toBe(1)
        expect(watched.log[0]).toBe('readCommit')
        expect(watched.log.indexOf('readUnits')).toBeGreaterThan(watched.log.indexOf('casCommit'))
        expect(watched.log.indexOf('readUnits')).toBeGreaterThan(watched.log.indexOf('readFence'))
        const before = watched.log.length
        expect((await session.openGate('gc')).status).toBe('open')
        expect(watched.log.length).toBeGreaterThan(before)
    })

    test('absent keys have nothing to re-flush', async () => {
        const { store } = await openTauri()
        h.fs.durableLog.length = 0

        const session = await Store2Session.open(store, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(session.reflush).toEqual({ ok: true, commit: 'absent', fence: 'absent' })
        expect(h.fs.durableLog).toEqual([])
        expect(session.decision).toEqual({ row: 1, mode: 'first-life', action: 'seed' })
    })

    test.each(['failed', 'unreported'] as const)('a commit key flush that stays %s keeps every deleter idle and raises the notice', async (fault) => {
        const { store, backend } = await seeded(false)
        h.flush.calls.clear()
        h.flush.fault = (key) => key === COMMIT_KEY ? fault : null

        const session = await Store2Session.open(store, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(session.reflush).toEqual({ ok: false, commit: 'failed', fence: 'absent' })
        expect(h.flush.calls.get(COMMIT_KEY)).toBe(3)
        expect(session.notice?.reason).toBe('reflush-failed')
        for (const deleter of ['gc', 'sweep', 'inlay-cleanup', 'manual-cleanup'] as const) {
            expect(await session.openGate(deleter)).toMatchObject({ status: 'refused', reason: 'idle' })
        }
        // The data itself is untouched and the page still boots.
        expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
        expect((await parsedCommit(backend)).seq).toBe(1)
    })

    test('a fence flush that stays failed keeps the deleters idle', async () => {
        const { store } = await seeded(true)
        h.flush.fault = (key) => key === FENCE_KEY ? 'failed' : null

        const session = await Store2Session.open(store, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(session.reflush).toEqual({ ok: false, commit: 'flushed', fence: 'failed' })
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused', reason: 'idle' })
    })

    test('a flush that fails once and then succeeds does not idle the deleters', async () => {
        const { store } = await seeded(false)
        h.flush.calls.clear()
        h.flush.fault = (key, call) => key === COMMIT_KEY && call === 1 ? 'failed' : null

        const session = await Store2Session.open(store, { kind: 'tauri', upstreamMainFile: async () => false })

        expect(session.reflush?.ok).toBe(true)
        expect(h.flush.calls.get(COMMIT_KEY)).toBe(2)
        expect((await session.openGate('gc')).status).toBe('open')
    })

    test('a failed re-flush writes no start-up clear', async () => {
        const { store, backend } = await openTauri()
        await plantMarker(backend, 'seed', OWNER)
        const before = peek(COMMIT_KEY)
        h.flush.calls.clear()
        h.flush.fault = (key) => key === COMMIT_KEY ? 'failed' : null

        const session = await Store2Session.open(store, { kind: 'tauri', ownerStore: memoryOwnerStore(OWNER), upstreamMainFile: async () => false })

        expect(session.startupClear).toBeNull()
        expect(peek(COMMIT_KEY)).toEqual(before)
    })

    test('the re-flush helper reports what it did on its own', async () => {
        const { backend } = await seeded(true)

        expect(await reflushTopLevel(backend)).toEqual({ ok: true, commit: 'flushed', fence: 'flushed' })
        h.flush.fault = () => 'failed'
        expect(await reflushTopLevel(backend, 2)).toEqual({ ok: false, commit: 'failed', fence: 'failed' })
    })

    test('a backend failure while reading counts as a failed flush, not a skipped one', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const failing = hooked(memory, { before: (name) => {
            if (name === 'readCommit') {
                throw new Store2BackendFailureError('Injected read failure.')
            }
        } })

        expect((await reflushTopLevel(failing.backend)).commit).toBe('failed')
    })

    test('other kinds do not re-flush', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const watched = hooked(memory)

        const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: watched.backend, upstreamMainFile: async () => false })

        expect(session.reflush).toBeNull()
        expect(watched.count('casCommit')).toBe(0)
        expect(watched.count('casFence')).toBe(0)
    })
})

describe('session decisions', () => {
    beforeEach(reset)

    test('a store in good order boots normally on the memory backend with a gate that opens', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)

        const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: memory, upstreamMainFile: async () => false })

        expect(session.decision).toEqual({ row: 5, mode: 'normal', fence: 'absent' })
        expect(session.tree?.status).toBe('ok')
        expect((await session.openGate('gc')).status).toBe('open')
    })

    test('an empty store with an upstream main file converts and without one seeds', async () => {
        const { store } = await openTauri()
        const converting = await Store2Session.open(store, { kind: 'indexeddb', backend: createMemoryBackend(), upstreamMainFile: async () => true })
        const seeding = await Store2Session.open(store, { kind: 'indexeddb', backend: createMemoryBackend(), upstreamMainFile: async () => false })

        expect(converting.decision).toEqual({ row: 1, mode: 'first-life', action: 'convert' })
        expect(seeding.decision).toEqual({ row: 1, mode: 'first-life', action: 'seed' })
    })

    test('a failed listing blocks conversion and seeding', async () => {
        const memory = createMemoryBackend()
        const failing = hooked(memory, { before: (name) => {
            if (name === 'listStore2') {
                throw new Store2BackendFailureError('Injected listing failure.')
            }
        } })

        const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: failing.backend, upstreamMainFile: async () => true })

        expect(session.decision).toMatchObject({ row: 1, mode: 'blocked', reason: 'presence-unknown' })
    })

    test('a unit with no commit key is row 2 and no main file lookup changes that', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const stored = await memory.readCommit()
        const orphan = createMemoryBackend()
        for (const key of await memory.listStore2()) {
            await orphan.putUnit(key, (await memory.readUnits([key])).get(key) as Uint8Array)
        }
        expect(stored.bytes).not.toBeNull()

        const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: orphan, upstreamMainFile: async () => true })

        expect(session.decision).toEqual({ row: 2, mode: 'recovery' })
    })

    test('a current whose shard is missing is row 6', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const partial = createMemoryBackend()
        const manifestKeys = (await memory.listStore2()).filter(key => key.startsWith('store2/m-'))
        const lacking = (await memory.listStore2()).find(key => key.startsWith('store2/s-')) as string
        for (const key of await memory.listStore2()) {
            if (key !== lacking) {
                await partial.putUnit(key, (await memory.readUnits([key])).get(key) as Uint8Array)
            }
        }
        await partial.casCommit((await partial.readCommit()).token, (await memory.readCommit()).bytes as Uint8Array)

        const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: partial, upstreamMainFile: async () => false })

        expect(manifestKeys).toHaveLength(1)
        expect(session.decision).toMatchObject({ row: 6, mode: 'recovery', tree: 'missing' })
    })

    test('a too-new commit key is read-only with a notice and the gate refuses', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const stored = (await memory.readCommit()).bytes as Uint8Array
        const newer = new Uint8Array(stored)
        newer[6] = 1
        new DataView(newer.buffer).setUint32(12, crc32(newer.subarray(0, 12)), true)
        await memory.casCommit((await memory.readCommit()).token, newer)

        const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: memory, upstreamMainFile: async () => false })

        expect(session.decision).toMatchObject({ row: 3, mode: 'read-only', source: 'commit-key' })
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused', reason: 'commit-too-new' })
    })

    test('a commit key that cannot be read is blocked', async () => {
        const memory = createMemoryBackend()
        const failing = hooked(memory, { before: (name) => {
            if (name === 'readCommit') {
                throw new Store2BackendFailureError('Injected read failure.')
            }
        } })

        const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: failing.backend, upstreamMainFile: async () => false })

        expect(session.decision).toMatchObject({ row: null, mode: 'blocked', reason: 'commit-unreadable' })
        expect(session.commitRead).toBeNull()
    })

    test('the transitional OPFS store is read-only with no backend and every gate refuses', async () => {
        const session = await Store2Session.open((await openTauri()).store, { kind: 'opfs-transitional', backend: createMemoryBackend(), upstreamMainFile: async () => false })

        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'opfs-transitional' })
        expect(session.backend).toBeNull()
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused' })
    })

    test('a Node page whose store has no guarded operations is read-only', async () => {
        const session = await Store2Session.open((await openTauri()).store, { kind: 'node', upstreamMainFile: async () => false })

        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'backend-unavailable' })
    })

    describe('the start-up clear of row 9', () => {
        test('on Tauri the device\'s own marker is cleared at open and the re-run follows from the decision', async () => {
            const { store, backend } = await openTauri()
            await plantMarker(backend, 'seed', OWNER)

            const session = await Store2Session.open(store, { kind: 'tauri', ownerStore: memoryOwnerStore(OWNER), upstreamMainFile: async () => false })

            expect(session.deviceOwner).toBe(true)
            expect(session.decision).toMatchObject({ row: 9, mode: 'rerun', operation: 'seed', clear: 'own' })
            expect(session.startupClear?.status).toBe('cleared')
            const stored = await parsedCommit(backend)
            expect(stored.staging).toBeNull()
            expect(stored.current).toBeNull()
            expect(session.commit).toMatchObject({ status: 'parsed' })
            expect((await Store2Session.open(store, { kind: 'tauri', ownerStore: memoryOwnerStore(OWNER), upstreamMainFile: async () => false })).decision).toEqual({ row: 7, mode: 'recovery' })
        })

        test('a marker of another owner is not cleared on Tauri', async () => {
            const { store, backend } = await openTauri()
            await plantMarker(backend, 'seed', 'd'.repeat(26))
            const before = peek(COMMIT_KEY)

            const session = await Store2Session.open(store, { kind: 'tauri', ownerStore: memoryOwnerStore(OWNER), upstreamMainFile: async () => false })

            expect(session.decision).toMatchObject({ row: 9, clear: 'foreign-path' })
            expect(session.startupClear).toBeNull()
            expect(peek(COMMIT_KEY)).toEqual(before)
        })

        test('on the web no marker is cleared at open', async () => {
            const memory = createMemoryBackend()
            await plantMarker(memory, 'seed', OWNER)
            const before = (await memory.readCommit()).bytes

            const session = await Store2Session.open((await openTauri()).store, { kind: 'indexeddb', backend: memory, upstreamMainFile: async () => false })

            expect(session.decision).toMatchObject({ row: 9, clear: 'foreign-path' })
            expect(session.startupClear).toBeNull()
            expect((await memory.readCommit()).bytes).toEqual(before)
        })

        test('a persisted owner id is written once and read back on the next load', async () => {
            const owners = memoryOwnerStore(null)
            const { store } = await openTauri()

            const first = await Store2Session.open(store, { kind: 'tauri', ownerStore: owners, upstreamMainFile: async () => false })
            const second = await Store2Session.open(store, { kind: 'tauri', ownerStore: owners, upstreamMainFile: async () => false })

            expect(first.ownerId).toBe(owners.stored)
            expect(second.ownerId).toBe(first.ownerId)
        })
    })
})
