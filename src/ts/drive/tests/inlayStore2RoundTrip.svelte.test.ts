/**
 * CHORE-48 compatibility guard: on a store2 page a full `.bin` export carries the app-store inlays, and importing that
 * file restores them with equal ids, fields and body bytes, through the Settings import (`LoadLocalBackup`) and through
 * the start-up import (`loadBackupAtBoot`).
 *
 * Label: compatibility guard. It may pass before and after any change in this stage; it is not a reproducer. Its
 * meaning is pinned by two in-memory mutants (the inlay pass of `writeInlaysToBackup` removed; `restoreCollectedInlays`
 * restoring nothing), each of which turns the named tests red.
 * Harness: the save-loop world over an in-memory store2 backend and a fake Web Locks manager, as in
 * `composedRoundTrip.svelte.test.ts`. Only the app-store inlays are asserted: the old browser inlay store is not part
 * of this harness. A pass says nothing about the Tauri or Node backends or a real browser download.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BootImportResult, BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'

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
        readColdStorageItem: async (key: string) => {
            const { getResidency, isEntityUnitKey } = await import('src/ts/storage/store2/residencyActive')
            const residency = getResidency()
            if (!isEntityUnitKey(key) || residency === null) {
                return { status: 'missing' }
            }
            const read = await residency.readCharacter(key)
            return read.status === 'error' ? { status: 'error', error: read.error, kind: read.kind } : { status: 'ok', value: read.value }
        },
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

afterEach(() => {
    worlds.parkAll()
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Seeded {
    id: string
    fields: Record<string, unknown>
    bytes: Uint8Array
    mime: string
}

/** A blob inlay with image fields and a string inlay, both small. */
const SEEDED: Seeded[] = [
    {
        id: 'guard-inlay-image.png',
        fields: { ext: 'png', name: 'guard-image.png', type: 'image', width: 2, height: 3 },
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 254, 255]),
        mime: 'image/png',
    },
    {
        id: 'guard-inlay-signature',
        fields: { ext: 'svg', name: 'guard-signature', type: 'signature' },
        bytes: new TextEncoder().encode('<svg>guard</svg>'),
        mime: '',
    },
]

interface Page {
    w: World
    store: import('src/ts/storage/store/contract').ByteStore
    alert: typeof import('src/ts/alert')
    written: Uint8Array[]
}

/** A store2 page with the seeded inlays in its app store; the export writer's chunks land in `written`. */
async function openStore2Page(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
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
    const { writeAppInlay, withInlayLock } = await import('src/ts/process/files/inlayStore')
    for (const seeded of SEEDED) {
        const data = seeded.mime === '' ? new TextDecoder().decode(seeded.bytes) : new Blob([seeded.bytes as BlobPart], { type: seeded.mime })
        await withInlayLock(seeded.id, () => writeAppInlay(store, seeded.id, { ...seeded.fields, data }))
    }
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

/** Exports the page through the real `SaveLocalBackup` and removes the seeded inlays from its store. */
async function exportThenEmpty(page: Page): Promise<Uint8Array> {
    const { SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const outcome = await SaveLocalBackup() as { status: string }
    expect(outcome.status).toBe('saved')
    const bytes = concat(page.written)
    const { removeAppInlay, readAppInlayBody } = await import('src/ts/process/files/inlayStore')
    for (const seeded of SEEDED) {
        await removeAppInlay(page.store, seeded.id)
        expect(await readAppInlayBody(page.store, seeded.id)).toBeNull()
    }
    return bytes
}

async function expectSeededRestored(page: Page): Promise<void> {
    const { readAppInlayBody, listAppInlayKeys } = await import('src/ts/process/files/inlayStore')
    expect((await listAppInlayKeys(page.store)).ids.slice().sort()).toEqual(SEEDED.map((seeded) => seeded.id).sort())
    for (const seeded of SEEDED) {
        const restored = await readAppInlayBody(page.store, seeded.id)
        expect(restored).not.toBeNull()
        const { data, ...fields } = restored as unknown as { data: Blob | string } & Record<string, unknown>
        expect(fields).toEqual(seeded.fields)
        const body = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new TextEncoder().encode(data)
        expect(Array.from(body)).toEqual(Array.from(seeded.bytes))
        if (data instanceof Blob) {
            expect(data.type).toBe(seeded.mime)
        }
    }
}

/** Drives a file picker flow: `start` creates the input, the file is handed to its change handler. */
async function pick<T>(start: () => Promise<T>, bytes: Uint8Array): Promise<T> {
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
        const ended = start()
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('the flow did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return await ended
    } finally {
        spy.mockRestore()
    }
}

describe('compatibility guard (CHORE-48): app-store inlays (not the old browser inlay store) survive a store2 full export and import', () => {
    test('guard: the full export carries one entry set per inlay, ahead of the database', async () => {
        const page = await openStore2Page()
        const bytes = await exportThenEmpty(page)

        const { parseInlayEntryName } = await import('src/ts/drive/inlayBackupCodec')
        const names = entryNames(bytes)
        const inlayNames = names.filter((name) => parseInlayEntryName(name) !== null)
        expect(inlayNames).toHaveLength(SEEDED.length)
        expect(names[names.length - 1]).toBe('database.risudat')
    })

    test('guard: the Settings import restores the inlays with equal ids, fields and body bytes', async () => {
        const page = await openStore2Page()
        const bytes = await exportThenEmpty(page)

        const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
        await pick(async () => { LoadLocalBackup() }, bytes)

        expect(vi.mocked(page.alert.alertError).mock.calls).toEqual([])
        await expectSeededRestored(page)
    })

    test('guard: the start-up import restores the inlays with equal ids, fields and body bytes', async () => {
        const page = await openStore2Page()
        const bytes = await exportThenEmpty(page)
        page.w.pageMode.setPageStorageMode({ kind: 'unset' })
        ;(await import('src/ts/storage/store2/residencyActive')).resetResidencyForTest()
        const installed: BootImportResult = { status: 'installed', manifestKey: 'm', flushed: true, repair: { dropped: 0, changed: 0, recovered: 0 } }
        const target: BootImportTarget = {
            readColdStorageItem: async () => ({ status: 'missing' }),
            install: async () => installed,
        }

        const { loadBackupAtBoot } = await import('src/ts/drive/backuplocal')
        const end = await pick(() => loadBackupAtBoot(target), bytes)

        expect(end).toEqual({ kind: 'finished', result: installed })
        await expectSeededRestored(page)
    })
})
