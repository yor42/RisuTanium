/**
 * I6 (Agents/Reports/28-risuaccount-removal-plan.md): `AutoStorage.Init()`
 * must detect a stale account-sync profile, land on
 * the Node server backend, and leave every
 * account-sync `localStorage` key untouched (removal is boot's job, not
 * `Init()`'s -- see `bootstrap.staleAccountProfile.svelte.test.ts` for the
 * removal-on-acknowledgement behaviour).
 *
 * Both cases set `accountst`, `dosync` and `fallbackRisuToken` as a
 * returning account-sync profile would leave them. On a Node-served page
 * `staleAccountProfile` becomes `true` and the backend is the real
 * `NodeStorage`. A page the Node server does not serve has no backend
 * (CHORE-557): `Init()` rejects before reading `localStorage`, opens no
 * LocalForage instance and leaves the flags in place.
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
    test('a page the Node server does not serve has no backend and reads nothing', async () => {
        setStaleAccountFlags()
        const getItem = vi.spyOn(Storage.prototype, 'getItem')
        const storage = new AutoStorage()

        await expect(storage.Init()).rejects.toThrow('No storage backend')

        expect(getItem).not.toHaveBeenCalled()
        getItem.mockRestore()
        expect(localforageCreateInstanceMock).not.toHaveBeenCalled()
        expect(storage.realStorage).toBeUndefined()
        expect(storage.staleAccountProfile).toBe(false)
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
