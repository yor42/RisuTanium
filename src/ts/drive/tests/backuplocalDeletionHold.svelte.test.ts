/**
 * Guard: a `.bin` restore on a store2 page writes none of its assets while a store2 asset deletion is pending, and writes
 * them once that delete settles. Covers the picker restore and the restore of a file another app opened (both run
 * `restoreSelectedFile`). The `.bin` is made by the real `SaveLocalBackup` on the page, so its entry set is what the
 * exporter produces; the restore is the real `LoadLocalBackup`.
 *
 * Label: guard (the hold is taken by a stand-in remover, not by the sweep in `store2/sweep/run.ts`, so a pass says
 * nothing about the sweep; passes only while the restore awaits the slot before
 * its first asset write). Harness: the save-loop world over an in-memory store2 backend and a fake Web Locks manager,
 * as in `inlayStore2RoundTrip.svelte.test.ts`. A pass says nothing about the Tauri backend or a real browser.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ByteStore } from 'src/ts/storage/store/contract'

/**
 * The hold module as the restore under test sees it: starting a world resets the module registry, so a static import
 * would name a different slot than the one `backuplocal` awaits.
 */
async function holdModule(): Promise<typeof import('src/ts/storage/assetDeleteHold')> {
    return await import('src/ts/storage/assetDeleteHold')
}

vi.setConfig({ testTimeout: 60_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

// msgpackr passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a long string on the Node running
// the tests; clamping to the room left changes no byte written and lets the real encoder run.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

afterAll(() => {
    utf8WriterProto.utf8Write = nativeUtf8Write
})

beforeEach(() => {
    vi.clearAllMocks()
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Record<string, unknown> }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async () => ({ status: 'missing' }),
        setColdStorageItem: vi.fn(async () => false),
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        isColdStorageBackupData: vi.fn(() => false),
        listColdDataKeys: vi.fn(async () => []),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(async () => {
    (await holdModule()).resetAssetDeleteHoldForTests()
    worlds.parkAll()
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

const ASSET_KEY = 'assets/hold-guard.png'
const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6, 5, 4, 3, 2, 1])

interface Page {
    w: World
    store: ByteStore
    alert: typeof import('src/ts/alert')
    written: Uint8Array[]
}

/** A store2 page whose one character references `ASSET_KEY`, which its app store holds; the export writer's chunks land in `written`. */
async function openStore2Page(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
    ;(h.db.characters as Record<string, unknown>[])[0].image = ASSET_KEY
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    const bootActive = await import('src/ts/storage/store2/bootActive')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    const alert = await import('src/ts/alert')
    vi.mocked(alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)

    const { getAppStore } = await import('src/ts/storage/store/appStore')
    const store = await getAppStore()
    await store.write(ASSET_KEY, ASSET_BYTES, 'unconditional')
    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    return { w, store, alert, written }
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function entryNames(bytes: Uint8Array): string[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const names: string[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        names.push(new TextDecoder().decode(bytes.subarray(offset, offset + nameLength)))
        offset += nameLength
        offset += 4 + view.getUint32(offset, true)
    }
    return names
}

/** Exports the page through the real `SaveLocalBackup`, then removes the asset from its store so a restore must write it. */
async function exportThenRemoveAsset(page: Page): Promise<Uint8Array> {
    const { SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const outcome = await SaveLocalBackup() as { status: string }
    expect(outcome.status).toBe('saved')
    const bytes = concat(page.written)
    expect(entryNames(bytes)).toContain(ASSET_KEY.replace('assets/', ''))
    await page.store.delete(ASSET_KEY, 'unconditional')
    expect((await page.store.read(ASSET_KEY)).bytes).toBeNull()
    return bytes
}

async function assetBytesInStore(page: Page): Promise<Uint8Array | null> {
    return (await page.store.read(ASSET_KEY)).bytes
}

type Route = 'picker' | 'opened'

/** Starts the restore of `bytes` on the chosen route and returns its settled end, without awaiting it. */
async function startRestore(route: Route, bytes: Uint8Array): Promise<{ ended: Promise<unknown> }> {
    const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
    if (route === 'opened') {
        const { importSourceOfBytes } = await import('src/ts/importSource')
        return { ended: LoadLocalBackup(undefined, { source: importSourceOfBytes('backup.bin', bytes), name: 'backup.bin', lastModified: 0 }) }
    }
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    try {
        const ended = LoadLocalBackup()
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('the flow did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        const handled = (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return { ended: Promise.all([handled, ended]) }
    } finally {
        spy.mockRestore()
    }
}

describe('a restore waits for a pending asset deletion before its first asset write', () => {
    test.each<Route>(['picker', 'opened'])('guard: the %s restore writes its asset only after the delete in flight settles', async (route) => {
        const page = await openStore2Page()
        const bytes = await exportThenRemoveAsset(page)

        let removed = false
        let openGate: () => void = () => undefined
        const delayed = new Promise<void>((resolve) => {
            openGate = resolve
        })
        const { holdAssetDeletion, isAssetDeletionHeld } = await holdModule()
        const held = holdAssetDeletion(async () => {
            await delayed
            removed = true
        })
        expect(isAssetDeletionHeld()).toBe(true)

        const { ended } = await startRestore(route, bytes)
        await sleepReal(300)

        expect(removed).toBe(false)
        expect(await assetBytesInStore(page)).toBeNull()

        openGate()
        await held
        await ended

        expect(removed).toBe(true)
        expect(vi.mocked(page.alert.alertError).mock.calls).toEqual([])
        expect(await assetBytesInStore(page)).toEqual(ASSET_BYTES)
    })
})
