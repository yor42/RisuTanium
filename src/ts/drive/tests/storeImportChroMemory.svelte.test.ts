/**
 * The ChroMemory choice and settings over the `.bin` import of a store2 page: a `.bin` carries neither key (the export
 * leaves both out), so the profile keeps the page's own `ltmEngine` and `ltmSettings`, by value, beside the file's own legacy
 * engine flags, and drops whatever the file's database entry carries under those names. A boot import has no page and
 * installs none. The kept choice then outranks the imported legacy flags (MC-3035).
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own, as `storeImportUsage.svelte.test.ts` does, in
 * the whole and the stream arm. A mocked success here is not evidence of native backend behaviour.
 *
 * Titles: `reproducer` fails when the keep or the drop is absent; `guard` passes before and after.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { UNIT_TYPE, readUnit } from 'src/ts/storage/store2/format'
import { fakeLists, seededEnv } from 'src/ts/storage/tests/store2/codecFixtures'
import { readerOver } from 'src/ts/storage/tests/store2/legacyFixtures'
import { memoryEngineOf } from 'src/ts/process/memory/memoryEngine'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Database } from 'src/ts/storage/database.svelte'
import * as kitCommit from 'src/ts/storage/store2/commit'

vi.setConfig({ testTimeout: 60_000 })

type ImportStreamModule = typeof import('src/ts/storage/store2/legacy/importStream')
type Arm = 'whole' | 'stream'

/** The arm the running test is in, and what the streamed prepare decided in it (`onPrepared`, once per attempt that reached it). */
const armBox = vi.hoisted(() => ({ arm: 'whole' as 'whole' | 'stream', verdicts: [] as string[] }))

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
    armBox.verdicts = []
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
    // The arm seam: production never passes `minUnits`, so the streamed prepare is steered here, through the module the
    // page's import loads. The whole arm never reaches the threshold; the stream arm always does.
    vi.doMock('src/ts/storage/store2/legacy/importStream', async () => {
        const actual = await vi.importActual<ImportStreamModule>('src/ts/storage/store2/legacy/importStream')
        return {
            ...actual,
            prepareImportStream: (request: Parameters<ImportStreamModule['prepareImportStream']>[0], hooks: Parameters<ImportStreamModule['prepareImportStream']>[1]) => actual.prepareImportStream({
                ...request,
                stream: {
                    ...request.stream,
                    minUnits: armBox.arm === 'stream' ? 0 : Number.POSITIVE_INFINITY,
                    onPrepared: (verdict) => {
                        armBox.verdicts.push(verdict)
                        request.stream.onPrepared?.(verdict)
                    },
                },
            }, hooks),
        }
    })
    // A streamed commit always runs under a bulk marker and fails with the kit's `Store2BulkAbortError`, which the import
    // must recognise by class as it does in the one graph of the app.
    vi.doMock('src/ts/storage/store2/commit', async () => ({
        ...await vi.importActual<typeof import('src/ts/storage/store2/commit')>('src/ts/storage/store2/commit'),
        Store2BulkAbortError: kitCommit.Store2BulkAbortError,
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
    const encoder = new page.w.encoderFixture.RisuSaveEncoder()
    await encoder.init(db as unknown as Database, { compression: false })
    await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode()!)
}

const AVATAR = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

/** Drives the real `LoadLocalBackup()` with `bytes` as the chosen file and awaits its change handler. */
async function loadBin(page: Page, bytes: Uint8Array): Promise<void> {
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

const PAGE_SETTINGS: Entry = { budgetTokens: 1800, future: { deep: [1] } }
const FILE_SETTINGS: Entry = { budgetTokens: 900 }

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

for (const arm of ['whole', 'stream'] as const) describe(`ChroMemory over the .bin import of a store2 page (${arm} arm)`, () => {
    beforeEach(() => { armBox.arm = arm })

    test('I2i reproducer: the page keeps its ChroMemory choice and settings, the file keeps its hypaV3, and ChroMemory still wins', async () => {
        const page = await openPage()
        await pageHolds(page, { ltmEngine: true, ltmSettings: PAGE_SETTINGS })

        await loadBin(page, await binWith(page, { hypaV3: true }))

        const stored = await storedDatabase(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(stored.ltmEngine).toBe(true)
        expect(stored.ltmSettings).toEqual(PAGE_SETTINGS)
        expect(stored.hypaV3).toBe(true)
        expect(memoryEngineOf(stored as unknown as Parameters<typeof memoryEngineOf>[0])).toBe('chroMemory')
    })

    test('I2i reproducer: the file\'s own ChroMemory keys do not survive, whatever the page holds', async () => {
        const page = await openPage()
        await pageHolds(page, { ltmEngine: true, ltmSettings: PAGE_SETTINGS })

        await loadBin(page, await binWith(page, { ltmEngine: false, ltmSettings: FILE_SETTINGS }))

        const stored = await storedDatabase(page)
        expect(stored.ltmEngine).toBe(true)
        expect(stored.ltmSettings).toEqual(PAGE_SETTINGS)
    })

    test('I2i reproducer: a page without ChroMemory drops the file\'s own keys', async () => {
        const page = await openPage()

        await loadBin(page, await binWith(page, { ltmEngine: true, ltmSettings: FILE_SETTINGS }))

        const stored = await storedDatabase(page)
        expect(Object.hasOwn(stored, 'ltmEngine')).toBe(false)
        expect(Object.hasOwn(stored, 'ltmSettings')).toBe(false)
    })

    test('IM1 guard (passes before and after): settings held while the engine is off survive a full-replace restore, shadow key included', async () => {
        const settings: Entry = { budgetTokens: 1800, shadow: true, future: { deep: [1] } }
        const page = await openPage()
        await pageHolds(page, { ltmEngine: false, ltmSettings: settings })

        await loadBin(page, await binWith(page, { ltmSettings: FILE_SETTINGS }))

        const stored = await storedDatabase(page)
        expect(stored.ltmEngine).toBe(false)
        expect(stored.ltmSettings).toEqual(settings)
    })

    test('IM1 guard (passes before and after): settings on a page that never set ltmEngine survive a full-replace restore', async () => {
        const settings: Entry = { budgetTokens: 1800, shadow: true, future: { deep: [1] } }
        const page = await openPage()
        await pageHolds(page, { ltmSettings: settings })

        await loadBin(page, await binWith(page, { ltmSettings: FILE_SETTINGS }))

        const stored = await storedDatabase(page)
        expect(stored.ltmSettings).toEqual(settings)
    })

    test('I2i guard: a page that chose another engine keeps its false flag and the file\'s legacy flags decide (passes before and after for the legacy flags)', async () => {
        const page = await openPage()
        await pageHolds(page, { ltmEngine: false })

        await loadBin(page, await binWith(page, { hypaV3: true }))

        const stored = await storedDatabase(page)
        expect(stored.hypaV3).toBe(true)
        expect(memoryEngineOf(stored as unknown as Parameters<typeof memoryEngineOf>[0])).toBe('hypaV3')
    })
})

describe('ChroMemory over the imports that have no page', () => {
    function configOf(built: { units: { bytes: Uint8Array }[] }): Entry {
        for (const unit of built.units) {
            if (unit.bytes[5] === UNIT_TYPE.configRoot) {
                const read = readUnit(unit.bytes, UNIT_TYPE.configRoot as never)
                if (read.status === 'ok' || read.status === 'stale') {
                    return (read.value.body as unknown as Entry).f as Entry
                }
            }
        }
        throw new Error('The build holds no config unit.')
    }

    async function build(tree: Entry, request: Entry): Promise<Entry> {
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
        return configOf(built as unknown as { units: { bytes: Uint8Array }[] })
    }

    test('I3i reproducer: prepareImport drops the tree\'s own ChroMemory keys when no carry is passed (the boot import passes none)', async () => {
        await openPage()
        const { makeDb: freshDb } = await import('src/ts/storage/tests/saveLoopSupport')
        const tree = { ...freshDb('file', ['alpha']), ltmEngine: true, ltmSettings: FILE_SETTINGS } as Entry

        const config = await build(tree, {})

        expect(Object.hasOwn(config, 'ltmEngine')).toBe(false)
        expect(Object.hasOwn(config, 'ltmSettings')).toBe(false)
    })

    test('I3i reproducer: with a carry the request names, the build holds the page\'s choice and settings and none of the tree\'s', async () => {
        await openPage()
        const { makeDb: freshDb } = await import('src/ts/storage/tests/saveLoopSupport')
        const tree = { ...freshDb('file', ['alpha']), ltmEngine: false, ltmSettings: FILE_SETTINGS } as Entry

        const config = await build(tree, { ltmEngine: true, ltmSettings: PAGE_SETTINGS })

        expect(config.ltmEngine).toBe(true)
        expect(config.ltmSettings).toEqual(PAGE_SETTINGS)
    })
})
