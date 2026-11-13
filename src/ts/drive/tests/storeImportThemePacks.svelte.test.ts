/**
 * Theme packs over the `.bin` import of a store2 page: a `.bin` carries no pack (the export leaves both fields out), so the
 * profile keeps the page's own `themePacks` and `activeThemePack`, by value and as they are now, and drops whatever the
 * file's database entry carries under those keys. A boot import has no page and installs none.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`)
 * against an in-memory store2 backend and a fake Web Locks manager, as `storeImport.svelte.test.ts` does. A mocked success
 * here is not evidence of native backend behaviour.
 *
 * Titles: `reproducer` fails when the carry or the drop is absent; `guard` passes before and after. The records here use
 * short archive strings in the file's database entry: msgpackr under Node refuses a string of 64 or more characters.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { readUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { fakeLists, seededEnv } from 'src/ts/storage/tests/store2/codecFixtures'
import { readerOver } from 'src/ts/storage/tests/store2/legacyFixtures'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Database } from 'src/ts/storage/database.svelte'

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
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
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
    flush(): void
    alert: typeof import('src/ts/alert')
}

async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const page: Page = { w, k, db: h.db, flush: flushSync, alert: await import('src/ts/alert') }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer as Committer } as unknown as Store2Session)
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

async function currentKey(page: Page): Promise<string | undefined> {
    return (await page.k.commitKey()).current?.key
}

async function storedDatabase(page: Page): Promise<Entry> {
    const read = await readTreeBytes(page.k.memory, (await currentKey(page)) as string)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return assembleDatabase(read.tree.manifest, read.tree.source) as unknown as Entry
}

// ---- .bin construction ----

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

async function blockFileBytes(page: Page, db: Entry): Promise<Uint8Array> {
    const encoder = new page.w.risuSave.RisuSaveEncoder()
    await encoder.init(db as unknown as Database, { compression: false })
    await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode()!)
}

const AVATAR = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

/** Drives the real `LoadLocalBackup()` with `bytes` as the chosen file and awaits its change handler. */
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

// ---- fixtures ----

const PAGE_ARCHIVE = `assets/tp-${'ab'.repeat(32)}.risutheme`

/** A stored record v1, the shape `installThemePack` emits, here with the page's full-length archive key. */
function pageRecord(id: string, archive = PAGE_ARCHIVE): Entry {
    return {
        v: 1, id, packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }], archive, bytes: 4096, installedAt: 1_700_000_000_000,
    }
}

/** The file's own record, with a short archive string (see the header). */
function fileRecord(id: string): Entry {
    return { ...pageRecord(id, 'assets/tp-file.risutheme'), name: 'From the file' }
}

/** A `.bin` whose database entry is a block-format save of a profile holding `fileFields`. */
async function binWith(page: Page, fileFields: Entry): Promise<Uint8Array> {
    const source = { ...makeDb('backup', ['alpha']), ...fileFields } as Entry
    return binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, source)))
}

async function pageHolds(page: Page, fields: Entry): Promise<void> {
    await nextCommit(page.w, () => {
        Object.assign(page.db, fields)
        page.flush()
    })
}

describe('theme packs over the .bin import of a store2 page', () => {
    test('T2-15 reproducer: the page\'s packs and active id are kept by value, an unreadable entry included; the file\'s own are dropped', async () => {
        const page = await openPage()
        await pageHolds(page, { themePacks: [pageRecord('page-1'), { v: 99, future: { deep: ['assets/tp-x.risutheme'] } }], activeThemePack: 'page-1' })

        await loadBin(await binWith(page, { themePacks: [fileRecord('file-1')], activeThemePack: 'file-1' }))

        const stored = await storedDatabase(page)
        const kept = stored.themePacks as Entry[]
        expect(stored.mainPrompt).toBe('backup')
        expect(kept.map((pack) => pack.id)).toEqual(['page-1', undefined])
        expect(kept[0]).toEqual(pageRecord('page-1'))
        expect(kept[1]).toEqual({ v: 99, future: { deep: ['assets/tp-x.risutheme'] } })
        expect(stored.activeThemePack).toBe('page-1')
        expect(JSON.stringify(stored)).not.toContain('file-1')
    })

    test('T2-15 reproducer: with no packs on the page, the file\'s own list creates none and no active id', async () => {
        const page = await openPage()

        await loadBin(await binWith(page, { themePacks: [fileRecord('file-1')], activeThemePack: 'file-1' }))

        const stored = await storedDatabase(page)
        expect(Object.hasOwn(stored, 'themePacks')).toBe(false)
        expect(Object.hasOwn(stored, 'activeThemePack')).toBe(false)
    })

    test('T2-15 reproducer: the active id is carried alone: a page on a built-in theme with no record keeps it', async () => {
        const page = await openPage()
        await pageHolds(page, { activeThemePack: 'builtin:origin-navy' })

        await loadBin(await binWith(page, { activeThemePack: 'file-1' }))

        const stored = await storedDatabase(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(stored.activeThemePack).toBe('builtin:origin-navy')
        expect(Object.hasOwn(stored, 'themePacks')).toBe(false)
    })

    test('T2-15 reproducer: the list is carried alone: a page with records and no active id keeps the records and sets no id', async () => {
        const page = await openPage()
        await pageHolds(page, { themePacks: [pageRecord('page-1')] })

        await loadBin(await binWith(page, { activeThemePack: 'file-1' }))

        const stored = await storedDatabase(page)
        expect(stored.mainPrompt).toBe('backup')
        expect((stored.themePacks as Entry[]).map((pack) => pack.id)).toEqual(['page-1'])
        expect(Object.hasOwn(stored, 'activeThemePack')).toBe(false)
    })

    test('T2-15 guard: a page with no pack field and a file with none leaves the profile without either key', async () => {
        const page = await openPage()

        await loadBin(await binWith(page, {}))

        const stored = await storedDatabase(page)
        expect(Object.hasOwn(stored, 'themePacks')).toBe(false)
        expect(Object.hasOwn(stored, 'activeThemePack')).toBe(false)
    })
})

describe('theme packs over the imports that have no page', () => {
    /** The config fields of a built commit: the field table of its config unit, decoded. */
    function configOf(built: { units: { bytes: Uint8Array }[] }): Entry | null {
        for (const unit of built.units) {
            if (unit.bytes[5] === UNIT_TYPE.configRoot) {
                const read = readUnit(unit.bytes, UNIT_TYPE.configRoot)
                if (read.status === 'ok' || read.status === 'stale') {
                    return (read.value.body as unknown as { f: Entry }).f
                }
            }
        }
        return null
    }

    async function buildConfig(tree: Entry, request: Entry): Promise<Entry> {
        const { prepareImport, buildImport } = await import('src/ts/storage/store2/legacy/importTree')
        const { createKeyMint } = await import('src/ts/storage/store2/commit')
        const source = { tree: tree as unknown as Database }
        const prepared = await prepareImport({ source, reader: readerOver(new Map()), lists: fakeLists, env: seededEnv(5), ...request }, {
            async confirmIncomplete() { return true },
        })
        if ('status' in prepared) {
            throw new Error(`The import stopped: ${prepared.status}`)
        }
        const built = await buildImport(prepared.plan).build({ mint: createKeyMint(seededEnv(6), null).mint, seq: 1, now: 1 })
        const config = configOf(built as unknown as { units: { bytes: Uint8Array }[] })
        if (config === null) {
            throw new Error('The build holds no config unit.')
        }
        return config
    }

    test('T2-14 reproducer: prepareImport drops the tree\'s own fields when no carry is passed (the boot import passes none)', async () => {
        await openPage()
        const { makeDb: freshDb } = await import('src/ts/storage/tests/saveLoopSupport')
        const tree = { ...freshDb('file', ['alpha']), themePacks: [fileRecord('file-1')], activeThemePack: 'file-1' } as Entry

        const config = await buildConfig(tree, {})

        expect(Object.hasOwn(config, 'themePacks')).toBe(false)
        expect(Object.hasOwn(config, 'activeThemePack')).toBe(false)
    })

    test('T2-15 reproducer: prepareImport sets the carry the request names, and the tree\'s own are gone', async () => {
        await openPage()
        const { makeDb: freshDb } = await import('src/ts/storage/tests/saveLoopSupport')
        const tree = { ...freshDb('file', ['alpha']), themePacks: [fileRecord('file-1')], activeThemePack: 'file-1' } as Entry

        const config = await buildConfig(tree, { themePacks: [pageRecord('page-1')], activeThemePack: 'builtin:origin-navy' })

        expect(config.themePacks).toBeDefined()
        expect((config.themePacks as Entry[]).map((pack) => pack.id)).toEqual(['page-1'])
        expect(config.activeThemePack).toBe('builtin:origin-navy')
    })

    test('T2-14 guard: the page\'s own legacy-to-store2 conversion keeps the fields: the resolve step removes only the task presets', async () => {
        await openPage()
        const { resolveLegacyTree } = await import('src/ts/storage/store2/legacy/resolve')
        const { makeDb: freshDb } = await import('src/ts/storage/tests/saveLoopSupport')
        const tree = { ...freshDb('page', ['alpha']), themePacks: [pageRecord('page-1')], activeThemePack: 'page-1' } as unknown as Database

        const resolved = await resolveLegacyTree(tree, readerOver(new Map()), { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 })

        const database = resolved.database as unknown as Entry
        expect((database.themePacks as Entry[]).map((pack) => pack.id)).toEqual(['page-1'])
        expect(database.activeThemePack).toBe('page-1')
    })
})
