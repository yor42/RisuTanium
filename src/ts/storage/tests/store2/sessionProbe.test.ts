// @vitest-environment node
/**
 * The Node open probe (E8): `Store2Session.open` asks the server for its capabilities before it reads anything and
 * opens read-only with `server-capability` when check-only or retire is missing. A probe that fails any other way is
 * `backend-unavailable`, as for any unreachable backend. Only a Node page probes. Each test says what it is: new
 * behaviour, guard, or mutant (red under the named in-memory mutant of the library, kept in the test name).
 */
import { describe, expect, test, vi } from 'vitest'
import type { ByteStore, GuardedCapabilities, GuardedOperations } from 'src/ts/storage/store/contract'
import { NodeHttpError } from 'src/ts/storage/store/nodeHttpStore'
import { ServerLacksCapabilityError, StoreOutcomeUnknownError } from 'src/ts/storage/store/errors'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { Store2Session } from 'src/ts/storage/store2/session'
import { createFakeStore } from '../blockStoreHarness'
import { createClock, seedStore, testEnv } from './commitFixtures'

const FULL: GuardedCapabilities = { checkOnly: true, retire: true, pieces: false }

function guardedWith(probe: () => Promise<GuardedCapabilities>): GuardedOperations {
    return {
        probe,
        writeChecked: async () => { throw new Error('not used') },
        removeChecked: async () => { throw new Error('not used') },
        retireChecked: async () => { throw new Error('not used') },
    }
}

function storeWith(probe: () => Promise<GuardedCapabilities>): { store: ByteStore, probe: ReturnType<typeof vi.fn> } {
    const spy = vi.fn(probe)
    return { store: { ...createFakeStore({ versioned: true }), guarded: guardedWith(spy) }, probe: spy }
}

async function seededBackend() {
    const backend = createMemoryBackend()
    await seedStore(backend, testEnv(createClock(), 5))
    return backend
}

const open = (store: ByteStore, kind: 'node' | 'indexeddb' | 'tauri', backend: ReturnType<typeof createMemoryBackend>) =>
    Store2Session.open(store, { kind, backend, upstreamMainFile: async () => false })

describe('the Node open probe', () => {
    test('new behaviour: a probe that reports check-only missing opens read-only with server-capability and no backend', async () => {
        const { store, probe } = storeWith(async () => ({ ...FULL, checkOnly: false }))
        const session = await open(store, 'node', await seededBackend())
        expect(probe).toHaveBeenCalledTimes(1)
        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'server-capability' })
        expect(session.backend).toBeNull()
        expect(session.committer).toBeNull()
        expect(await session.openGate('gc')).toMatchObject({ status: 'refused' })
    })

    test('new behaviour: retire missing is the same read-only state; the unused pieces flag is not required', async () => {
        const missing = await open(storeWith(async () => ({ ...FULL, retire: false })).store, 'node', await seededBackend())
        expect(missing.decision).toMatchObject({ mode: 'read-only', reason: 'server-capability' })
        const complete = await open(storeWith(async () => ({ checkOnly: true, retire: true, pieces: false })).store, 'node', await seededBackend())
        expect(complete.decision.mode).not.toBe('read-only')
    })

    test('new behaviour: a server that refuses the probe with ServerLacksCapabilityError is server-capability', async () => {
        const { store } = storeWith(async () => { throw new ServerLacksCapabilityError('caps', 'the answer lacks a boolean checkOnly, retire or pieces flag', false) })
        const session = await open(store, 'node', await seededBackend())
        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'server-capability' })
    })

    test('new behaviour: a probe I/O failure is backend-unavailable, not a capability verdict', async () => {
        for (const failure of [new StoreOutcomeUnknownError('caps', new Error('offline')), new NodeHttpError(503, 'caps'), new Error('no auth header')]) {
            const { store } = storeWith(async () => { throw failure })
            const session = await open(store, 'node', await seededBackend())
            expect(session.decision, failure.name).toMatchObject({ row: null, mode: 'read-only', reason: 'backend-unavailable' })
            expect(session.backend).toBeNull()
        }
    })

    test('new behaviour: a Node store without guarded operations opens read-only with backend-unavailable, even with a backend injected', async () => {
        const session = await open(createFakeStore({ versioned: true }), 'node', await seededBackend())
        expect(session.decision).toMatchObject({ row: null, mode: 'read-only', reason: 'backend-unavailable' })
        expect(session.backend).toBeNull()
        expect(session.committer).toBeNull()
    })
    test('guard: a probe success opens normally with a backend and a boot decision', async () => {
        const { store, probe } = storeWith(async () => FULL)
        const session = await open(store, 'node', await seededBackend())
        expect(probe).toHaveBeenCalledTimes(1)
        expect(session.backend).not.toBeNull()
        expect(session.committer).not.toBeNull()
        expect(session.decision.mode).not.toBe('read-only')
        expect(session.commit).toMatchObject({ status: 'parsed' })
    })

    test('mutant "open skips the probe": the probe is asked once and before the commit key is read', async () => {
        const order: string[] = []
        const inner = await seededBackend()
        const backend = {
            ...inner,
            readCommit: () => { order.push('readCommit'); return inner.readCommit() },
        }
        const { store } = storeWith(async () => { order.push('probe'); return FULL })
        await Store2Session.open(store, { kind: 'node', backend, upstreamMainFile: async () => false })
        expect(order[0]).toBe('probe')
        expect(order.filter(name => name === 'probe')).toHaveLength(1)
        expect(order).toContain('readCommit')
    })

    test('guard: no other kind ever calls the probe, even when the capability would be missing', async () => {
        for (const kind of ['indexeddb', 'tauri'] as const) {
            const { store, probe } = storeWith(async () => ({ ...FULL, checkOnly: false }))
            const session = await open(store, kind, await seededBackend())
            expect(probe, kind).not.toHaveBeenCalled()
            expect(session.decision.mode, kind).not.toBe('read-only')
        }
        const { store, probe } = storeWith(async () => FULL)
        const opfs = await Store2Session.open(store, { kind: 'opfs-transitional', backend: await seededBackend(), upstreamMainFile: async () => false })
        expect(probe).not.toHaveBeenCalled()
        expect(opfs.decision).toMatchObject({ reason: 'opfs-transitional' })
    })
})
