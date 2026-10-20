/**
 * The `.bin` import of a store2 page decodes the database once to confirm what the file leaves out, and then keeps
 * working for as long as the asset copy and the commit take. The decoded tree of that first decode must not stay
 * reachable from the restore function across that work: only the salvage map it yielded is kept.
 *
 * Runs `LoadLocalBackup()` over the real store2 loop in a world of its own (the harness of `storeImport.svelte.test.ts`),
 * against an in-memory backend. The tree of the first decode is observed through a weak reference while the restore
 * function is running and, after a forced collection, asked whether it was collected. This does not reproduce the
 * memory growth measured on a device, and a mocked world proves nothing about native storage.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { breakDataChecksum } from 'src/ts/storage/tests/risuSaveBlockFile'

vi.setConfig({ testTimeout: 60_000 })

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const platformBox = vi.hoisted(() => ({ isNodeServer: false }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platformBox.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 1024 * 1024,
}) as unknown as typeof import('src/ts/storage/nodeBodyLimit'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    platformBox.isNodeServer = false
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
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
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(async () => {
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, get isNodeServer() { return platformBox.isNodeServer }, isIOS: () => false }))
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Page {
    w: World
    k: Store2Kit
    db: Entry
    alert: typeof import('src/ts/alert')
}

async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const page: Page = { w, k, db: h.db, alert: await import('src/ts/alert') }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

function binEntry(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, data.length, true)
    out.set(data, 8 + nameBytes.length)
    return out
}

function binOf(...entries: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(entries.reduce((total, entry) => total + entry.length, 0))
    let offset = 0
    for (const entry of entries) {
        out.set(entry, offset)
        offset += entry.length
    }
    return out
}

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

/** A block-format backup whose last block is damaged: its decode yields a salvage map and the person is asked. */
async function damagedBackup(page: Page): Promise<Uint8Array> {
    const source = makeDb('backup', ['alpha', 'beta', 'gamma'])
    const encoder = new page.w.risuSave.RisuSaveEncoder()
    await encoder.init(source as unknown as Database, { compression: false })
    await encoder.set(source as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    const damaged = breakDataChecksum(new Uint8Array(encoder.encode()!), 'alpha')
    return binOf(binEntry('golden-avatar.png', new Uint8Array([1, 2, 3, 4])), binEntry('database.risudat', damaged))
}

async function loadBin(bytes: Uint8Array): Promise<void> {
    const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
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
        LoadLocalBackup()
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    } finally {
        spy.mockRestore()
    }
}

/**
 * Wraps the world's decoders so the tree of the first decode is watched weakly, and answers, at each later
 * `alertWait` of the import, whether a forced collection has reclaimed it.
 */
function watchFirstTree(page: Page): { probes: () => { text: string, collected: boolean }[], watched: () => boolean } {
    let held: object | null = null
    let ref: WeakRef<object> | null = null
    const watch = (tree: unknown): void => {
        if (ref !== null || held !== null || typeof tree !== 'object' || tree === null) {
            return
        }
        held = tree
        // A weak reference created in a job stays alive until that job ends: it is created in a later one.
        setTimeout(() => {
            ref = new WeakRef(held as object)
            held = null
        }, 0)
    }
    const risuSave = page.w.risuSave
    const decodeOriginal = risuSave.decodeRisuSave
    const salvageOriginal = risuSave.salvageRisuSave
    const decodeSpy = vi.spyOn(risuSave, 'decodeRisuSave').mockImplementation(async (...args: Parameters<typeof decodeOriginal>) => {
        const tree = await decodeOriginal(...args)
        watch(tree)
        return tree
    })
    const salvageSpy = vi.spyOn(risuSave, 'salvageRisuSave').mockImplementation(async (...args: Parameters<typeof salvageOriginal>) => {
        const salvaged = await salvageOriginal(...args)
        watch(salvaged.db)
        return salvaged
    })
    const probes: { text: string, collected: boolean }[] = []
    vi.mocked(page.alert.alertWait).mockImplementation((text: string) => {
        if (ref !== null) {
            // A spy records every argument and result it saw: the decoders' results, and the tree the block
            // decoder logs. Those records would keep the tree alive.
            decodeSpy.mockClear()
            salvageSpy.mockClear()
            vi.mocked(console.log).mockClear()
            gc()
            gc()
            probes.push({ text, collected: ref.deref() === undefined })
        }
        return { type: 'wait', msg: text }
    })
    return { probes: () => probes, watched: () => ref !== null }
}

describe('the validity-probe decode of a store2 .bin import', () => {
    // Regression reproducer (red when the restore function awaits the decoded tree itself). Not a measure of device memory.
    async function expectTreeCollected(backup: (page: Page) => Promise<Uint8Array>): Promise<void> {
        const page = await openPage()
        const bytes = await backup(page)
        const probe = watchFirstTree(page)

        await loadBin(bytes)

        expect(probe.watched(), 'the first decode must have produced a tree to watch').toBe(true)
        const last = probe.probes().filter((entry) => entry.text === 'Loading backup...')
        expect(last.length, 'the import must have reached its load phase').toBeGreaterThan(0)
        expect(last.every((entry) => entry.collected)).toBe(true)
    }

    test('regression: the tree of the first decode of a legacy-format file is collected once the restore function has moved on to the copy', async () => {
        await expectTreeCollected(async () => golden('upstream-full.bin'))
    })

    test('regression: the tree of the first decode of a block-format salvage is collected once the restore function has moved on to the copy', async () => {
        await expectTreeCollected(damagedBackup)
    })

    // Compatibility guard: passes before and after; the left-out question and the import's outcome do not change.
    test('guard: a salvage asks the left-out question exactly once and the import completes', async () => {
        const page = await openPage()
        const bytes = await damagedBackup(page)
        const reload = vi.mocked(window.location.reload)

        await loadBin(bytes)

        expect(vi.mocked(page.alert.alertConfirm).mock.calls).toHaveLength(1)
        expect(reload).toHaveBeenCalledTimes(1)
    })
})
