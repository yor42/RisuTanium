/**
 * The `.bin` export is a pure projection: it sets no boot-write flag, and the round-trip literal covers every slot of the
 * slot table.
 *
 * Post-fix file: it imports the connections modules by value, so it makes no claim against the tree before connections existed.
 * The harness is that of `connectionsBinRoundTrip.svelte.test.ts` (T7f reuses its export route).
 */
import { describe, test, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, StoredDatabase } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation:
    // without it restore takes its no-Web-Locks branch and never waits on
    // another tab, which is outside what this file exercises.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
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
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                    close: async () => { },
                }),
            },
        }),
    },
}))

// The real module, so `setDatabase` is the production one; only the database the export reads is the test's own.
vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    getDatabase: getDatabaseMock,
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

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeFullscreen: vi.fn(),
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

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
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
        setItem = forageSetItemMock
        keys = forageKeysMock
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), async (importOriginal) => ({
    ...(await importOriginal()),
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

// The real polyfill replaces the global Buffer, which breaks the msgpack encoder the export uses; only its clone helper is needed.
vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => structuredClone(v)),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))


//#region the legacy OPFS stand-in

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

/** The legacy OPFS unit files: no test here places one, so every read falls through to "not found". */
const mockDirectoryHandle = {
    async getFileHandle(name: string) {
        throw new MockNotFoundError("not found: " + name)
    },
    async removeEntry() { },
    entries() {
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        return { done: true as const, value: undefined }
                    },
                }
            },
        }
    },
}
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => mockDirectoryHandle,
    },
})

//#endregion

import { SaveLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { setDatabase } from 'src/ts/storage/database.svelte'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'
import { roundTripLiteral, PRESET_PAIRS } from 'src/ts/drive/tests/connectionsRoundTripLiteral'
import { takeConnectionsMigrated } from 'src/ts/connections/migrate'
import { GLOBAL_ROWS } from 'src/ts/connections/slotTable'

//#region helpers

const decoder = new TextDecoder()

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** The database entry the real `LocalWriter` emitted into the sink. */
function writtenDatabaseEntry(): Uint8Array {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        if (name === 'database.risudat') {
            return bytes.slice(offset, offset + dataLength)
        }
        offset += dataLength
    }
    throw new Error('the export wrote no database entry')
}

type Tree = Record<string, unknown>
type Preset = { name?: string, proxyKey?: string, forceReplaceUrl?: string, openAIKey?: string, proxyConnectionId?: string }
type Model = { id?: string, key?: unknown, url?: unknown, connectionId?: unknown }
type Exported = {
    openAIKey?: string
    proxyKey?: string
    forceReplaceUrl?: string
    connections?: unknown
    proxyConnectionId?: unknown
    botPresets: Preset[]
    customModels?: Model[]
    google?: { accessToken?: string }
    novelai?: { token?: string }
    hordeConfig?: { apiKey?: string }
    OaiCompAPIKeys?: Record<string, string>
} & Tree

type Trip = {
    /** The database entry of the export, decoded as upstream reads it. */
    exported: Exported
    /** The page's database as JSON, just before and just after the export. */
    before: string
    after: string
}

/**
 * Exports `seed` through the real `SaveLocalBackup` and decodes the database entry. With `load`, the real `setDatabase` ran over
 * the seed first, as a boot leaves it.
 */
async function exportOf(seed: Tree, options: { load: boolean }): Promise<Trip> {
    const db = { characters: [], personas: [], characterOrder: [], botPresets: [], pluginCustomStorage: {}, ...structuredClone(seed) } as unknown as Database
    if (options.load) {
        setDatabase(db as unknown as StoredDatabase)
    }
    getDatabaseMock.mockImplementation(() => db)
    const before = JSON.stringify(db)
    await SaveLocalBackup()
    const after = JSON.stringify(db)
    return { exported: await decodeRisuSave(writtenDatabaseEntry()) as unknown as Exported, before, after }
}

/** Presets saved by upstream's own `saveCurrentPreset`, one per pair; the working pair is left as preset `active`'s. */
function producerBuilt(pairs: Array<[string, string]>, active = 0): Tree {
    const db: Tree = { botPresets: pairs.map((_, index) => ({ name: `P${index}` })), botPresetsId: 0, forceReplaceUrl: '', proxyKey: '' }
    pairs.forEach(([url, key], index) => {
        db.botPresetsId = index
        db.forceReplaceUrl = url
        db.proxyKey = key
        upstreamSaveCurrentPreset(db as unknown as StoredDatabase)
    })
    db.botPresetsId = active
    db.forceReplaceUrl = pairs[active][0]
    db.proxyKey = pairs[active][1]
    return db
}

//#endregion

// msgpackr 1.10.1 passes a length past the buffer's end to Buffer.prototype.utf8Write for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no Buffer, so production is unaffected.
// Clamping the length to the room left changes no byte written.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
})

afterAll(() => { utf8WriterProto.utf8Write = nativeUtf8Write })

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    injectAppStore(createForageBackedStore({
        getItem: async () => null,
        setItem: async () => { },
        keys: async () => [],
        removeItem: async () => { },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the export is a projection', () => {
    // T7f. Kills an export projection that runs the load hook, which would mark the next boot write.
    test('T7f: an export of a database with a pending legacy key sets no boot-write flag', async () => {
        takeConnectionsMigrated()

        await exportOf({ openAIKey: 'sk-pending' }, { load: false })

        expect(takeConnectionsMigrated()).toBe(false)
    })
})

describe('the round-trip literal covers the slot table', () => {
    // T-RTcov. Keeps T-RT honest: a slot row the literal leaves empty could not fail a translation that skips it.
    test('T-RTcov: the literal holds a non-empty value at every row of the slot table', () => {
        const literal = roundTripLiteral()
        for (const row of GLOBAL_ROWS) {
            expect(row.legacyGet(literal as never), row.slot).not.toBe('')
        }
        const oaiComp = literal.OaiCompAPIKeys as Record<string, string>
        expect(Object.values(oaiComp).every((key) => key !== '') && Object.keys(oaiComp).length > 0).toBe(true)
        const models = literal.customModels as Array<{ key: string, url: string }>
        expect(models.length).toBeGreaterThan(0)
        expect(models.every((model) => model.key !== '' && model.url !== '')).toBe(true)
        expect(literal.proxyKey).not.toBe('')
        expect(literal.forceReplaceUrl).not.toBe('')
        const presets = literal.botPresets as Array<{ proxyKey: string, forceReplaceUrl: string }>
        expect(presets).toHaveLength(PRESET_PAIRS.length)
        expect(presets.every((preset) => preset.proxyKey !== '' && preset.forceReplaceUrl !== '')).toBe(true)
    })
})
