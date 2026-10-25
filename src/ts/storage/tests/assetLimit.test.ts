/**
 * The largest asset the page's selected store takes (`storeAssetLimitBytes`) and the import bound built on it
 * (`assetByteLimit`). The limit follows the store kind `appStore.ts` selected and, for the Node store, whether it has
 * recorded that its server takes pieces; the platform flags are not consulted. Stores are synthetic.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { injectAppStore, type AppStoreKind } from 'src/ts/storage/store/appStore'
import { NODE_ASSET_LIMIT_BYTES, NODE_BODY_LIMIT_BYTES, WEB_ASSET_LIMIT_BYTES } from 'src/ts/storage/nodeBodyLimit'
import { selectedStoreIsIndexedDb, storeAssetLimitBytes } from 'src/ts/storage/assetLimit'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { assetByteLimit, charxLimits } from 'src/ts/process/processzip'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn(), keys: vi.fn(async () => []) }) },
}))

vi.mock(import('src/ts/platform'), async (importOriginal) => {
    const actual = await importOriginal()
    // The platform flags must not decide a limit: they say Node while the tests select other stores.
    return Object.defineProperty({ ...actual }, 'isNodeServer', { get: () => true, enumerable: true }) as typeof actual
})

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = { forageStorage: {} }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({ alertStore: { set: vi.fn(), subscribe: vi.fn() } }) as unknown as typeof import('src/ts/alert'))

const MIB = 1024 * 1024
const GIB = 1024 * MIB

let store: MemoryByteStore

function select(kind: AppStoreKind, piecesRecorded?: boolean): void {
    if (piecesRecorded !== undefined) {
        Object.assign(store, { piecesRecorded: () => piecesRecorded })
    }
    injectAppStore(store, kind)
}

beforeEach(() => {
    store = createMemoryByteStore()
    injectAppStore(null)
})

describe('guard: selectedStoreIsIndexedDb answers for the selected store kind only', () => {
    test.each([['indexeddb', true], ['opfs-transitional', false], ['tauri', false], ['node', false]] as const)('the %s store answers %s', (kind, expected) => {
        select(kind)
        expect(selectedStoreIsIndexedDb()).toBe(expected)
    })

    test('guard: before a selection, and for a store injected without a kind, it answers false', () => {
        expect(selectedStoreIsIndexedDb()).toBe(false)
        injectAppStore(store)
        expect(selectedStoreIsIndexedDb()).toBe(false)
    })
})

describe('the asset limit follows the selected store', () => {
    // Reproducer: both were 100 MiB (Node) or 200 MiB before.
    test('the desktop and Android store takes 1 GiB', () => {
        select('tauri')
        expect(storeAssetLimitBytes()).toBe(GIB)
        expect(assetByteLimit()).toBe(GIB)
    })

    // Reproducer.
    test('a Node store whose server takes pieces takes 1 GiB', () => {
        select('node', true)
        expect(storeAssetLimitBytes()).toBe(NODE_ASSET_LIMIT_BYTES)
        expect(assetByteLimit()).toBe(GIB)
    })

    // Guard: passes before and after.
    test('a Node store without recorded pieces keeps one request, 100 MiB', () => {
        select('node', false)
        expect(storeAssetLimitBytes()).toBe(NODE_BODY_LIMIT_BYTES)
        expect(assetByteLimit()).toBe(100 * MIB)
    })

    test('a Node store that cannot say (no record) is treated as without pieces', () => {
        select('node')
        expect(storeAssetLimitBytes()).toBe(NODE_BODY_LIMIT_BYTES)
    })

    // Reproducer: the plain browser store holds large values as Blobs, so its limit is the 1 GiB of the piece-writing stores, above the 200 MiB whole-value web limit.
    test('the indexeddb store takes 1 GiB', () => {
        select('indexeddb')
        expect(storeAssetLimitBytes()).toBe(NODE_ASSET_LIMIT_BYTES)
        expect(assetByteLimit()).toBe(GIB)
    })

    // Guard: the transitional OPFS store still holds a value whole, so it keeps 200 MiB.
    test('the opfs-transitional store keeps 200 MiB', () => {
        select('opfs-transitional')
        expect(storeAssetLimitBytes()).toBe(WEB_ASSET_LIMIT_BYTES)
        expect(assetByteLimit()).toBe(200 * MIB)
    })

    // The Node platform flag is on in this file, so a browser store reading 200 MiB shows the flag does not decide.
    test('before a store is selected, and for a store injected without a kind, the smallest limit applies', () => {
        expect(storeAssetLimitBytes()).toBe(NODE_BODY_LIMIT_BYTES)
        injectAppStore(store)
        expect(storeAssetLimitBytes()).toBe(NODE_BODY_LIMIT_BYTES)
    })

    test('a lowered import bound still applies below the store limit', () => {
        select('tauri')
        const saved = charxLimits.assetBytes
        charxLimits.assetBytes = 2 * MIB
        try {
            expect(assetByteLimit()).toBe(2 * MIB)
        } finally {
            charxLimits.assetBytes = saved
        }
    })

    test('the import bound itself is 1 GiB', () => {
        expect(charxLimits.assetBytes).toBe(GIB)
    })
})
