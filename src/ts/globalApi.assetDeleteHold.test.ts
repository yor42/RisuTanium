/**
 * Guard: while a store2 asset deletion is pending, the three same-page asset save paths (`saveAsset`, the streaming
 * `saveAssetFromPieces`, the Blob-keeping `saveAssetFromBlob`) do not look at, write or finish the key they are about to
 * name; once the delete settles the write happens. A save that notes its key and waits can never lose its file to a
 * delete that was already in flight. The store is a recording stand-in; nothing here proves native behaviour or the
 * sweep itself: the hold is taken by a stand-in remover, not by the sweep in `store2/sweep/run.ts`, so every test is a
 * guard killed by dropping a settle await.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { ByteStore, PieceWriter, StoreCapabilities } from 'src/ts/storage/store/contract'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn(), keys: vi.fn(async () => []) }) },
}))

// Read per call: the module graph is imported as a web page, and the first path then answers as a desktop store would.
const platform = vi.hoisted(() => ({ isTauri: false }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platform.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { state: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
    CharEmotion: writable({}),
    MobileGUIStack: writable([]),
    OpenRealmStore: writable(false),
    frozenSaveKeysStore: writable([]),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/process/coldstorage.svelte'), async (importOriginal) => ({
    ...await importOriginal(),
    getColdStorageItem: vi.fn(async () => null),
}))

import { saveAsset, saveAssetFromBlob, saveAssetFromPieces, listAssetsWrittenThisPage } from 'src/ts/globalApi.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { holdAssetDeletion, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'

interface Calls {
    has: string[]
    write: string[]
    writeBlob: string[]
    finish: string[]
}

interface Rig {
    store: ByteStore
    calls: Calls
}

const CAPABILITIES: StoreCapabilities = { conditionalWrites: false }
const BYTES = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])

/** A recording store: `has` is false everywhere, as a Tauri store answers once the sweep removed the asset. */
function rig(): Rig {
    const calls: Calls = { has: [], write: [], writeBlob: [], finish: [] }
    const blobs = new Map<string, Blob>()
    const store = {
        capabilities: CAPABILITIES,
        has: async (key: string) => {
            calls.has.push(key)
            return false
        },
        write: async (key: string) => {
            calls.write.push(key)
            return { version: null }
        },
        delete: async () => undefined,
        writeBlob: async (key: string, blob: Blob) => {
            calls.writeBlob.push(key)
            blobs.set(key, blob)
            return { version: null }
        },
        readBlob: async (key: string) => blobs.get(key) ?? null,
        openWriter: (): PieceWriter => ({
            write: async () => undefined,
            finish: async (finalKey?: string) => {
                calls.finish.push(finalKey ?? '')
            },
            abort: async () => undefined,
        }),
    } as unknown as ByteStore
    return { store, calls }
}

async function* pieces(): AsyncGenerator<Uint8Array, void, undefined> {
    yield BYTES
}

/** Lets pending microtasks and a macrotask run, so a save that was not held would have reached its store call. */
async function settleTurns(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
}

function gate(): { promise: Promise<void>, open: () => void } {
    let open: () => void = () => undefined
    const promise = new Promise<void>((resolve) => {
        open = resolve
    })
    return { promise, open }
}

const FINAL_KEY = /^assets\/(?!incoming-)[^/]+\.png$/

interface Path {
    name: string
    kind: 'tauri'
    start: () => Promise<string>
    /** Store calls that name the final key. */
    finalCalls: (calls: Calls) => string[]
}

const PATHS: Path[] = [
    {
        name: 'saveAsset (saveAssetBytes)',
        kind: 'tauri',
        start: () => saveAsset(BYTES, 'guard-fixed', 'a.png'),
        finalCalls: (calls) => [...calls.has, ...calls.write].filter((key) => FINAL_KEY.test(key)),
    },
    {
        name: 'saveAssetFromPieces',
        kind: 'tauri',
        start: () => saveAssetFromPieces(pieces(), { fileName: 'a.png', sizeBound: BYTES.length, minPieceBytes: 1 }),
        finalCalls: (calls) => calls.finish.filter((key) => FINAL_KEY.test(key)),
    },
    {
        name: 'saveAssetFromBlob (saveAssetBlobKept)',
        kind: 'tauri',
        start: () => saveAssetFromBlob(new Blob([BYTES as unknown as Uint8Array<ArrayBuffer>]), 'a.png', { minPieceBytes: 1 }),
        finalCalls: (calls) => [...calls.has, ...calls.writeBlob].filter((key) => FINAL_KEY.test(key)),
    },
]

beforeEach(() => resetAssetDeleteHoldForTests())
afterEach(() => {
    resetAssetDeleteHoldForTests()
    injectAppStore(null)
    platform.isTauri = false
})

describe('same-page asset saves wait for a pending asset deletion', () => {
    test.each(PATHS)('guard: $name touches its final key only after the delete settles, then writes it', async (path) => {
        const { store, calls } = rig()
        injectAppStore(store, path.kind)
        platform.isTauri = path.kind === 'tauri'
        const delayed = gate()
        const held = holdAssetDeletion(() => delayed.promise)

        const saving = path.start()
        await settleTurns()

        expect(path.finalCalls(calls)).toEqual([])

        delayed.open()
        await held
        const key = await saving

        expect(key).toMatch(FINAL_KEY)
        expect(path.finalCalls(calls).length).toBeGreaterThan(0)
        // The key was noted before the wait, so a sweep that ran meanwhile would have left it alone.
        expect(listAssetsWrittenThisPage()).toContain(key)
    })

    test.each(PATHS)('guard: $name does not wait when no delete is pending', async (path) => {
        const { store, calls } = rig()
        injectAppStore(store, path.kind)
        platform.isTauri = path.kind === 'tauri'

        await path.start()

        expect(path.finalCalls(calls).length).toBeGreaterThan(0)
    })
})
