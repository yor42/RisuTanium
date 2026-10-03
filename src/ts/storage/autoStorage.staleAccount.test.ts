/**
 * I6 (Agents/Reports/28-risuaccount-removal-plan.md): `AutoStorage.Init()`
 * must detect a stale account-sync profile, land on
 * whatever backend the platform would normally choose, and leave every
 * account-sync `localStorage` key untouched (removal is boot's job, not
 * `Init()`'s -- see `bootstrap.staleAccountProfile.svelte.test.ts` for the
 * removal-on-acknowledgement behaviour).
 *
 * Three cases, each with `accountst`, `dosync` and
 * `fallbackRisuToken` set as a returning account-sync profile would leave
 * them. Every case asserts both that `staleAccountProfile` becomes `true`
 * and that the backend is positively the platform's native one: the real
 * `NodeStorage`, or (for the static cases, with or without `opfs_flag!`) the
 * exact object `localforage.createInstance({ name: 'risuai' })` returns.
 *
 * Real, unmocked: `AutoStorage`, `NodeStorage` (this file's
 * subject); `alert.ts` (a thin wrapper `AutoStorage` imports `alertStore`
 * from, needing only mocked leaves); `src/lang` (real, needed by `alert.ts`
 * and `NodeStorage`).
 *
 * Mocked: `localforage` (`createInstance` is a spy, so a test can assert
 * identity against its return value), `src/ts/platform` (an `isNodeServer`
 * getter backed by a hoisted flag, toggled per test; `isTauri` fixed `false`,
 * since `Init()`'s stale-profile detection is a non-Tauri-only path),
 * `globalApi.svelte` (`tabPresenceLockAcquired` and a no-op
 * `recordStorageEpoch`), `storage/database.svelte` (just
 * `getDatabase`, needed by `alert.ts`), `util` (the handful of leaves
 * `alert.ts`/`NodeStorage` import but never call in any
 * scenario here), `stores.svelte` (just `alertStore`, needed by `alert.ts`).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

const platformState = vi.hoisted(() => ({ isNodeServer: false }))

const localforageCreateInstanceMock = vi.hoisted(() => vi.fn((_opts: { name: string }) => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => { }),
    removeItem: vi.fn(async () => { }),
    keys: vi.fn(async () => []),
})))

vi.mock('localforage', () => ({
    default: {
        createInstance: localforageCreateInstanceMock,
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isNodeServer() { return platformState.isNodeServer },
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    tabPresenceLockAcquired: Promise.resolve(),
    recordStorageEpoch: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

import { AutoStorage } from './autoStorage'
import { NodeStorage } from './nodeStorage'

/** Minimal shape `AutoStorage.Init()` actually reads off the global `FileSystemFileHandle` (a truthy `prototype.createWritable`); never constructed or called here. */
interface MinimalFileSystemFileHandle {
    prototype: {
        createWritable: () => Promise<{ write: (data: unknown) => Promise<void>, close: () => Promise<void> }>
    }
}

/** Leaves `localStorage` exactly as a real returning account-sync profile would: every account-sync key present, none of them account-sync-specific state cleared. */
function setStaleAccountFlags() {
    localStorage.setItem('accountst', 'able')
    localStorage.setItem('dosync', 'sync')
    localStorage.setItem('fallbackRisuToken', JSON.stringify({ token: 'stale-token' }))
}

function expectFlagsUntouched() {
    expect(localStorage.getItem('accountst')).toBe('able')
    expect(localStorage.getItem('dosync')).toBe('sync')
    expect(localStorage.getItem('fallbackRisuToken')).toBe(JSON.stringify({ token: 'stale-token' }))
}

beforeEach(() => {
    localStorage.clear()
    platformState.isNodeServer = false
    localforageCreateInstanceMock.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
})

describe('AutoStorage.Init() detects a stale account-sync profile and lands on the native backend (I6)', () => {
    test('static build, LocalForage backend', async () => {
        setStaleAccountFlags()
        const storage = new AutoStorage()

        await storage.Init()

        // Init() must fall through to the LocalForage `risuai` instance the
        // platform would otherwise choose whenever accountst === 'able', and
        // must record the detection on staleAccountProfile.
        expect(localforageCreateInstanceMock).toHaveBeenCalledWith({ name: 'risuai' })
        expect(storage.realStorage).toBe(localforageCreateInstanceMock.mock.results[0].value)
        expect(storage.staleAccountProfile).toBe(true)
        expectFlagsUntouched()
    })

    test('static build with opfs_flag! set (regression reproducer): the storage object still lands on LocalForage and leaves the flag for the page store to decide', async () => {
        setStaleAccountFlags()
        localStorage.setItem('opfs_flag!', 'able')
        Object.defineProperty(window.navigator, 'storage', {
            value: { getDirectory: vi.fn(async () => ({})) },
            configurable: true,
        })
            ; (globalThis as unknown as { FileSystemFileHandle: MinimalFileSystemFileHandle }).FileSystemFileHandle = {
                prototype: {
                    createWritable: async () => ({
                        write: async () => { },
                        close: async () => { },
                    }),
                },
            }

        const storage = new AutoStorage()

        await storage.Init()

        expect(storage.realStorage).toBe(localforageCreateInstanceMock.mock.results[0].value)
        expect(storage.staleAccountProfile).toBe(true)
        expect(localStorage.getItem('opfs_flag!')).toBe('able')
        expectFlagsUntouched()
    })
    test('Node server backend', async () => {
        setStaleAccountFlags()
        platformState.isNodeServer = true
        const storage = new AutoStorage()

        await storage.Init()

        // Same invariant again, on the Node server backend.
        expect(storage.realStorage).toBeInstanceOf(NodeStorage)
        expect(storage.staleAccountProfile).toBe(true)
        expectFlagsUntouched()
    })
})
