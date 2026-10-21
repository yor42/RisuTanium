/**
 * The size pre-flight of a `.bin` export (MC-223, hard limit): before the writer opens, everything a backup entry cannot
 * hold (4 GiB or more, `UPSTREAM_HARD_LIMIT_BYTES` in `drive/exportInline.ts`) is named in one confirm. Declining writes
 * nothing; continuing leaves the named items out and the report repeats them.
 *
 * Assets are sized only where the desktop listing gives sizes (a full backup on Tauri), so the asset cases fake that
 * listing and the batch read (`tauriAssetBatch`) and inject a store of kind `tauri`; no 4 GiB of data exists anywhere:
 * the size is metadata. A unit or stub entry is sized from its bytes, so those cases lower the limit with the
 * `limitBytes` option instead.
 *
 * Titles: `reproducer` fails when the pre-flight is absent (the export opens its writer and fails or writes the item
 * mid-way); `guard` holds with and without it. A passing test is no evidence about the real Tauri listing, the writers'
 * behaviour at 4 GiB, or the web and Node pages, where asset sizes are unknown (the known limit in `exportInline.ts`).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], opened: 0, failWrites: false }))
const sizedBox = vi.hoisted(() => ({ items: [] as Array<{ key: string, size: number }>, batchReads: [] as string[][] }))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => { }),
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => 'backup-output.bin'),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => {
            backupSink.opened++
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => {
                            if (backupSink.failWrites) {
                                throw new Error('the download stream failed')
                            }
                            backupSink.writes.push(chunk.slice())
                        },
                        close: async () => { },
                    }),
                },
            }
        },
    },
}))

// The desktop listing and batch read, answered from `sizedBox`; the sizes are metadata only.
vi.mock('src/ts/storage/tauriAssetBatch', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriAssetBatch')>()),
    isAssetBatchAvailable: () => true,
    listAssetsSized: async () => sizedBox.items.map((item) => ({ ...item })),
    readAssetBatch: async (keys: readonly string[]) => {
        sizedBox.batchReads.push([...keys])
        return keys.map((key) => ({ status: 'ok' as const, bytes: new TextEncoder().encode(`bytes of ${key}`) }))
    },
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: alertNormalMock,
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        getItem = forageGetItemMock
        setItem = vi.fn(async () => { })
        keys = forageKeysMock
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

//#endregion

const unitMem = new Map<string, Uint8Array>()

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => ({
            async getFileHandle(name: string) {
                throw new MockNotFoundError('not found: ' + name)
            },
            async removeEntry() { },
            entries() {
                return {
                    [Symbol.asyncIterator]() {
                        return { async next() { return { done: true as const, value: undefined } } }
                    },
                }
            },
        }),
    },
})

import { SaveLocalBackup, SavePartialLocalBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { UPSTREAM_HARD_LIMIT_BYTES } from 'src/ts/drive/exportInline'
import { endOfExport } from 'src/ts/drive/operationEnd'
import { language } from 'src/lang'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry, type UnitSource } from 'src/ts/storage/store2/codec'
import { type ShardEntry } from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

//#region helpers

const decoder = new TextDecoder()
const NOW = 1_700_000_000_000
const OVERSIZE_PROMPT = '4 GiB or more'

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

interface WrittenEntry {
    name: string
    data: Uint8Array
}

function writtenEntries(): WrittenEntry[] {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: WrittenEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

const entryNames = (): string[] => writtenEntries().map((entry) => entry.name)
const unitEntryNames = (): string[] => entryNames().filter((name) => name.startsWith('coldstorage_'))
const entryText = (name: string): string | null => {
    const entry = writtenEntries().find((e) => e.name === name)
    return entry ? decoder.decode(entry.data) : null
}

async function exportedCharacters(): Promise<Array<Record<string, unknown>>> {
    const entry = writtenEntries().find((e) => e.name === 'database.risudat')
    if (!entry) {
        throw new Error('the export wrote no database entry')
    }
    return ((await decodeRisuSave(entry.data)) as unknown as { characters: Array<Record<string, unknown>> }).characters
}

/** The confirms that name items too large for the file. */
const oversizePrompts = (): string[] => alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((text) => text.includes(OVERSIZE_PROMPT))

/** The prompt of the incomplete-data question, which this file never expects. */
const incompletePrompts = (): string[] => alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('Create the incomplete backup anyway?'))

function shortened(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.slice(0, 50)
    }
    if (Array.isArray(value)) {
        return value.map(shortened)
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shortened(inner)]))
    }
    return value
}

interface Page {
    memory: MemoryBackend
    db: Database
    entries: ShardEntry[]
    source: UnitSource
}

/** A store2 page: the first character resident, the other two stubs of their entities. */
async function pageOf(): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(3)) as Obj), archiveCharacters: true } as unknown as Database
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(fixture)) as Database, env, fakeLists)
    const residentId = (fixture.characters[0] as unknown as Obj).chaId
    const read = await readTreeBytes(memory, seeded.manifestKey, {
        resident: (input) => new Set(input.entries.filter((entry) => entry.chaId === residentId).map((entry) => entry.u)),
    })
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree read ${read.status}.`)
    }
    const db = assembleDatabase(read.tree.manifest, read.tree.source, {
        character: (entry, units) => (entry.chaId === residentId ? assembleCharacter(entry, units) : stubFromEntry(entry)),
    })
    const previous = previousOfTree(read.tree)
    const all = (previous.objects?.shards ?? []).flatMap((shard) => shard.entries)
    const entries = fixture.characters.map((slot) => (slot as unknown as Obj).chaId).map((chaId) => all.find((entry) => entry.chaId === chaId) as ShardEntry)
    const context = { lists: fakeLists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW }) }
    registerResidency(createResidency({ backend: memory, context }))
    const full = await readTreeBytes(memory, seeded.manifestKey)
    if (full.status !== 'ok') {
        throw new Error('The full read failed.')
    }
    getDatabaseMock.mockImplementation(() => db)
    return { memory, db, entries, source: full.tree.source }
}

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>

/** The desktop listing of a full backup: assets with their sizes (metadata only), in listing order. */
function listAssets(...items: Array<[string, number]>): void {
    sizedBox.items = items.map(([key, size]) => ({ key, size }))
}

const FOUR_GIB = UPSTREAM_HARD_LIMIT_BYTES

describe('the limit', () => {
    test('guard: it is 2^32 bytes, the first length the 32-bit entry length field of a backup cannot state', () => {
        expect(UPSTREAM_HARD_LIMIT_BYTES).toBe(2 ** 32)
    })
})

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.opened = 0
    backupSink.failWrites = false
    sizedBox.items = []
    sizedBox.batchReads.length = 0
    unitMem.clear()
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    resetResidencyForTest()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    injectAppStore(createForageBackedStore({
        getItem: async (key) => (key.startsWith('coldstorage/') ? (unitMem.get(key) ?? null) : forageGetItemMock(key)),
        setItem: async (key, value) => { if (key.startsWith('coldstorage/')) { unitMem.set(key, value) } },
        keys: async () => [...(await forageKeysMock()), ...unitMem.keys()],
        removeItem: async (key) => { unitMem.delete(key) },
    }), 'tauri')
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('SaveLocalBackup, assets sized by the desktop listing', () => {
    test('reproducer: an asset of 4 GiB is named, with its size and what uses it, before the writer opens', async () => {
        const page = await pageOf()
        ;(page.db.characters[0] as unknown as Obj).image = 'assets/huge-avatar'
        listAssets(['assets/aaa-small', 10], ['assets/huge-avatar', FOUR_GIB], ['assets/zzz-small', 12])
        let openedAtPrompt = -1
        let writesAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(OVERSIZE_PROMPT)) {
                openedAtPrompt = backupSink.opened
                writesAtPrompt = backupSink.writes.length
            }
            return true
        })

        await SaveLocalBackup()

        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain('4.00 GiB')
        expect(oversizePrompts()[0]).toContain(`'Main Image' from ${page.entries[0].name}`)
        expect(openedAtPrompt).toBe(0)
        expect(writesAtPrompt).toBe(0)
    })

    test('reproducer: declining writes nothing, never opens the writer, and resolves declined', async () => {
        await pageOf()
        listAssets(['assets/aaa-small', 10], ['assets/huge-avatar', FOUR_GIB])
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(OVERSIZE_PROMPT))

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual({ status: 'declined', cause: 'oversize-declined' })
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
        expect(sizedBox.batchReads).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('reproducer: continuing leaves the asset out, writes the others under their own names with their own bytes, and repeats it in the report', async () => {
        await pageOf()
        listAssets(['assets/aaa-small', 10], ['assets/huge-avatar', FOUR_GIB], ['assets/zzz-small', 12])

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        const names = entryNames()
        expect(names).not.toContain('huge-avatar')
        expect(entryText('aaa-small')).toBe('bytes of assets/aaa-small')
        expect(entryText('zzz-small')).toBe('bytes of assets/zzz-small')
        // The batch reader is never asked for the left-out asset: it would find it by index in the sized list.
        expect(sizedBox.batchReads.flat()).not.toContain('assets/huge-avatar')
        expect(outcome.status === 'saved' ? outcome.notices.join('\n') : '').toContain('huge-avatar')
        expect(alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')).toContain('4.00 GiB')
        expect(names.at(-1)).toBe('database.risudat')
    })

    test('names every item in one confirm: two assets, one of them used by a character', async () => {
        const page = await pageOf()
        ;(page.db.characters[0] as unknown as Obj).image = 'assets/huge-one'
        listAssets(['assets/huge-one', FOUR_GIB], ['assets/ok-small', 5], ['assets/huge-two', FOUR_GIB + 1])

        await SaveLocalBackup()

        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain(`'Main Image' from ${page.entries[0].name}`)
        expect(oversizePrompts()[0]).toContain('assets/huge-two')
        expect(oversizePrompts()[0]).not.toContain('ok-small')
        expect(oversizePrompts()[0]).toContain('2 item(s)')
    })

    test('names an oversize asset and an oversize stub entry together', async () => {
        const page = await pageOf()
        backupSink.writes.length = 0
        await SaveLocalBackup({ mode: 'stub' })
        const sizes = unitEntryNames().map((name) => writtenEntries().find((e) => e.name === name)?.data.length ?? 0)
        const limit = Math.max(...sizes)
        const bigger = sizes.indexOf(limit) + 1
        backupSink.writes.length = 0
        alertConfirmMock.mockClear()
        listAssets(['assets/huge-asset', limit], ['assets/tiny', 1])

        await SaveLocalBackup({ mode: 'stub', limitBytes: limit })

        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain('assets/huge-asset')
        expect(oversizePrompts()[0]).toContain(page.entries[bigger].name)
        expect(oversizePrompts()[0]).toContain('2 item(s)')
    })

    test('the limit is exact: 4 GiB less one byte is not named, 4 GiB is', async () => {
        await pageOf()
        listAssets(['assets/edge', FOUR_GIB - 1])

        await SaveLocalBackup()

        // Not named: it goes on to the export, and this fake store does not hold it, so it is reported missing.
        expect(oversizePrompts()).toEqual([])
        expect(alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')).toContain('assets/edge')

        backupSink.writes.length = 0
        backupSink.opened = 0
        listAssets(['assets/edge', FOUR_GIB])

        await SaveLocalBackup()

        expect(oversizePrompts()).toHaveLength(1)
    })

    test('guard: nothing too large asks nothing and writes everything', async () => {
        await pageOf()
        listAssets(['assets/aaa-small', 10], ['assets/zzz-small', 12])

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(oversizePrompts()).toEqual([])
        expect(entryText('aaa-small')).toBe('bytes of assets/aaa-small')
        expect(entryText('zzz-small')).toBe('bytes of assets/zzz-small')
    })

    test('new behaviour: a plain export lists nothing as omitted, reports its inlays and maps to committed', async () => {
        await pageOf()
        listAssets(['assets/aaa-small', 10])

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual({
            status: 'saved',
            notices: [],
            omitted: { assets: [], oversize: [], units: [], inlays: [], oldStoreUnlisted: false, repaired: null },
            inlays: { exported: 0, leftOut: [], oldStoreUnlisted: false },
        })
        expect(endOfExport('export', outcome)).toMatchObject({ operation: 'export', outcome: 'committed' })
    })

    test('new behaviour: an asset left out for its size is listed as omitted and the export maps to permitted-partial; the report is unchanged', async () => {
        await pageOf()
        listAssets(['assets/aaa-small', 10], ['assets/huge-avatar', FOUR_GIB])

        const outcome = await SaveLocalBackup()

        if (outcome.status !== 'saved') {
            throw new Error(`the export ended ${outcome.status}`)
        }
        expect(outcome.omitted.oversize).toHaveLength(1)
        expect(outcome.omitted.oversize[0]).toContain('huge-avatar')
        expect(outcome.omitted.assets).toEqual([])
        expect(endOfExport('export', outcome).outcome).toBe('permitted-partial')
        expect(alertMdMock.mock.calls.map((c) => String(c[0])).join('\n')).toContain('4.00 GiB')
    })

    test('new behaviour: an asset that could not be read is listed as omitted and the export maps to permitted-partial', async () => {
        await pageOf()
        // Just under the limit, so it is not left out for its size, and the fake store does not hold it.
        listAssets(['assets/edge', FOUR_GIB - 1])

        const outcome = await SaveLocalBackup()

        if (outcome.status !== 'saved') {
            throw new Error(`the export ended ${outcome.status}`)
        }
        expect(outcome.omitted.assets).toEqual(['assets/edge'])
        expect(outcome.omitted.oversize).toEqual([])
        expect(endOfExport('export', outcome).outcome).toBe('permitted-partial')
    })

    test('new behaviour: a failed export carries what became of its file, and the failure alert is unchanged', async () => {
        await pageOf()
        listAssets(['assets/aaa-small', 10])
        backupSink.failWrites = true

        const outcome = await SaveLocalBackup()

        if (outcome.status !== 'failed') {
            throw new Error(`the export ended ${outcome.status}`)
        }
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        const shown = String(alertErrorMock.mock.calls[0][0])
        const expectedByFile = { kept: language.backupFailedFileKept(null), deleted: language.backupFailedFileDeleted(null), untouched: language.backupFailedNothingWritten() }
        expect(shown).toBe(expectedByFile[outcome.file])
        expect(endOfExport('export', outcome)).toMatchObject({ outcome: 'failed', detail: { file: outcome.file } })
    })
})

describe('SavePartialLocalBackup facts', () => {
    test('new behaviour: the partial export lists no inlays, carries none, and its inlays never make it partial', async () => {
        await pageOf()
        listAssets()

        const outcome = await SavePartialLocalBackup()

        if (outcome.status !== 'saved') {
            throw new Error(`the export ended ${outcome.status}`)
        }
        expect(outcome.inlays).toBeNull()
        expect(outcome.omitted.inlays).toEqual([])
        expect(endOfExport('export-partial', outcome)).toMatchObject({ operation: 'export-partial', outcome: 'committed' })
    })
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s, units and stub entries sized from their bytes', (_name, run) => {
    /** The sizes of the two stub entries of a stub-form export of the page. */
    async function stubEntrySizes(): Promise<number[]> {
        backupSink.writes.length = 0
        await run({ mode: 'stub' })
        const sizes = unitEntryNames().map((name) => writtenEntries().find((e) => e.name === name)?.data.length ?? 0)
        backupSink.writes.length = 0
        backupSink.opened = 0
        alertConfirmMock.mockClear()
        return sizes
    }

    test('reproducer: a stub entry at the limit is named before the writer opens; the smaller one is not', async () => {
        const page = await pageOf()
        const sizes = await stubEntrySizes()
        expect(sizes).toHaveLength(2)
        expect(sizes[0]).not.toBe(sizes[1])
        const limit = Math.max(...sizes)
        const bigger = sizes.indexOf(limit) + 1
        const smaller = 3 - bigger
        let openedAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(OVERSIZE_PROMPT)) {
                openedAtPrompt = backupSink.opened
            }
            return true
        })

        const outcome = await run({ mode: 'stub', limitBytes: limit })

        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain(page.entries[bigger].name)
        expect(oversizePrompts()[0]).not.toContain(page.entries[smaller].name)
        expect(openedAtPrompt).toBe(0)
        // Continuing: the large character stays the page's own stub (a placeholder on import); the other keeps its entry.
        expect(outcome.status).toBe('saved')
        expect(unitEntryNames()).toHaveLength(1)
        const exported = await exportedCharacters()
        expect(exported[bigger].coldstorage).toBe(page.entries[bigger].u)
        expect(exported[smaller].coldstorage).toMatch(/^[0-9a-f-]{36}$/)
        expect(incompletePrompts()).toEqual([])
        const notices = outcome.status === 'saved' ? outcome.notices.join('\n') : ''
        expect(notices).toContain(page.entries[bigger].name)
        // The entity is settled: the late collection does not look for it in the legacy store and report it a second time.
        expect(notices).not.toContain(page.entries[bigger].u)
    })

    test('reproducer: a unit of the first collection at the limit is named, left out of the file, and not reported again as lost', async () => {
        const page = await pageOf()
        const big = '11111111-1111-4111-8111-111111111111'
        const small = '22222222-2222-4222-8222-222222222222'
        const bigValue = { text: 'x'.repeat(300) }
        const bigLength = new TextEncoder().encode(JSON.stringify(bigValue)).length
        page.db.pluginCustomStorage = { _coldplugin: { bigPrefs: big, smallPrefs: small }, [big]: bigValue, [small]: { text: 'y' } } as never

        const outcome = await run({ mode: 'inline', limitBytes: bigLength })

        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain(`Cold storage unit ${big}`)
        expect(oversizePrompts()[0]).not.toContain(small)
        expect(outcome.status).toBe('saved')
        expect(unitEntryNames()).toContain(`coldstorage_${small}.json`)
        expect(unitEntryNames()).not.toContain(`coldstorage_${big}.json`)

        backupSink.writes.length = 0
        alertConfirmMock.mockClear()
        await run({ mode: 'inline', limitBytes: bigLength + 1 })

        expect(oversizePrompts()).toEqual([])
        expect(unitEntryNames()).toContain(`coldstorage_${big}.json`)
    })

    test('reproducer: declining a payload warning writes nothing and never opens the writer', async () => {
        await pageOf()
        const sizes = await stubEntrySizes()
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(OVERSIZE_PROMPT))

        const outcome = await run({ mode: 'stub', limitBytes: Math.min(...sizes) })

        expect(outcome).toEqual({ status: 'declined', cause: 'oversize-declined' })
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
    })

    test('the limit is exact: a payload of the limit is named, one byte under is not', async () => {
        await pageOf()
        const sizes = await stubEntrySizes()
        const biggest = Math.max(...sizes)

        await run({ mode: 'stub', limitBytes: biggest + 1 })
        expect(oversizePrompts()).toEqual([])

        backupSink.writes.length = 0
        await run({ mode: 'stub', limitBytes: biggest })
        expect(oversizePrompts()).toHaveLength(1)
    })

    test('guard: with the real limit, a store2 page with stubs asks nothing about size', async () => {
        await pageOf()

        const outcome = await run({ mode: 'stub' })

        expect(outcome.status).toBe('saved')
        expect(oversizePrompts()).toEqual([])
    })

    test('guard: the inline form has no stub entry, so a lowered limit names nothing', async () => {
        await pageOf()

        await run({ mode: 'inline', limitBytes: 1 })

        expect(oversizePrompts()).toEqual([])
    })
})
