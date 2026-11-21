/**
 * The chat keys through the composed `.bin` export: a profile goes through the real `SaveLocalBackup` (the one `.bin` writer
 * route) and the database entry is decoded as upstream reads it. The export must be upstream-shaped: the legacy key fields
 * carry the values the fork uses after its next migration, and the fork's own store (`connections`, every reference) is
 * absent. The page's database is never changed by an export.
 *
 * The harness is the one `backuplocalCharacterIdsExport.test.ts` documents (the real writer, collector and byte store, every
 * dialog mocked), except that `database.svelte` is the real module with only `getDatabase` replaced, so `setDatabase` is the
 * production load. A passing test here is not evidence about the Tauri or Node backends or an upstream build opening the file:
 * the upstream side is the transcription in `upstreamPresetMirror.ts`. Keys are synthetic.
 *
 * Compat file: it imports no module that is new with connections (the fixture module `connectionsRoundTripLiteral.ts` imports
 * only the upstream preset mirror), so it also runs against the tree before connections existed. T7, T7c and T11 and the
 * preset `openAIKey` part of T-RT are reproducers; T7w, T8, T9, T10 and the identity part of T-RT are guards that pass before
 * and after.
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
import { setMirrorPresetApplier, upstreamChangeToPreset, upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'
import { LEGACY_ROOT_KEYS, roundTripLiteral } from 'src/ts/drive/tests/connectionsRoundTripLiteral'

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

const THREE_PAIRS: Array<[string, string]> = [['https://u0.invalid/v1', 'K0'], ['https://u1.invalid/v1', 'K1'], ['https://u2.invalid/v1', 'K2']]

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

describe('the export carries the upstream key fields and no store of its own', () => {
    // regression reproducer: T7
    test('T7: a migrated database exports its key in the legacy field and leaves out the store and every reference', async () => {
        const { exported } = await exportOf({
            connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-a' }],
            openAIKey: '',
            proxyConnectionId: '',
            botPresets: [{ name: 'P0', proxyConnectionId: '' }],
        }, { load: false })

        expect(exported.openAIKey).toBe('sk-a')
        expect(exported.connections).toBeUndefined()
        expect(Object.hasOwn(exported, 'proxyConnectionId')).toBe(false)
        expect(exported.botPresets.every((preset) => !Object.hasOwn(preset, 'proxyConnectionId'))).toBe(true)
    })

    // compatibility guard (passes before and after): T7w
    test('T7w: a pending legacy value wins over the stored key, as the next boot would make it', async () => {
        const { exported } = await exportOf({
            connections: [{ id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-old' }],
            openAIKey: 'sk-new',
        }, { load: false })

        expect(exported.openAIKey).toBe('sk-new')
    })

    // regression reproducer: T7c
    test('T7c: a custom model without a connection and without key or url fields exports string key and url', async () => {
        const { exported } = await exportOf({
            customModels: [{ id: 'xcustom:::m1', name: 'M1', internalId: 'm1', format: 0, flags: [], tokenizer: 0 }],
        }, { load: false })

        expect(exported.customModels?.[0]).toMatchObject({ key: '', url: '' })
        expect(Object.hasOwn(exported.customModels?.[0] ?? {}, 'connectionId')).toBe(false)
    })

    // compatibility guard (passes before and after): T9
    test('T9: an export leaves the page database as it was, nested slots and presets included', async () => {
        const { before, after } = await exportOf({
            connections: [
                { id: 'conn-1', name: 'OpenAI', provider: 'openai', key: 'sk-a' },
                { id: 'conn-2', name: 'Google', provider: 'google', key: 'g-key' },
            ],
            openAIKey: '',
            google: { accessToken: '', projectId: 'proj' },
            ...producerBuilt(THREE_PAIRS),
        }, { load: false })

        expect(after).toBe(before)
    })
})

describe('an upstream build reads the key of the preset it switches to', () => {
    // compatibility guard (passes before and after): T8
    test('T8: a legacy database loaded, exported and switched to preset B by upstream steps works with the pair of B', async () => {
        const { exported } = await exportOf(producerBuilt(THREE_PAIRS), { load: true })
        // Upstream's own setPreset copies the preset's proxy pair; the fork's copy restores a reference instead.
        setMirrorPresetApplier((db, preset) => {
            db.temperature = preset.temperature ?? db.temperature
            db.forceReplaceUrl = preset.forceReplaceUrl ?? db.forceReplaceUrl
            db.proxyKey = preset.proxyKey ?? db.proxyKey
        })

        upstreamChangeToPreset(exported as unknown as StoredDatabase, 1)

        expect(exported.proxyKey).toBe('K1')
        expect(exported.forceReplaceUrl).toBe('https://u1.invalid/v1')
    })

    // compatibility guard (passes before and after): T10
    test('T10: the root pair is the working pair and the active preset keeps its own stored pair', async () => {
        const seed = producerBuilt([['https://stale.invalid/v1', 'K-stale'], ['https://other.invalid/v1', 'K-other']])
        seed.forceReplaceUrl = 'https://live.invalid/v1'
        seed.proxyKey = 'K-live'

        const { exported } = await exportOf(seed, { load: true })

        expect({ url: exported.forceReplaceUrl, key: exported.proxyKey }).toEqual({ url: 'https://live.invalid/v1', key: 'K-live' })
        expect({ url: exported.botPresets[0].forceReplaceUrl, key: exported.botPresets[0].proxyKey }).toEqual({ url: 'https://stale.invalid/v1', key: 'K-stale' })
    })

    // regression reproducer: T11
    test('T11: the exported database loaded again gives each distinct pair a connection', async () => {
        const { exported } = await exportOf(producerBuilt(THREE_PAIRS), { load: true })
        const reloaded = { pluginCustomStorage: {}, ...structuredClone(exported) } as unknown as StoredDatabase

        setDatabase(reloaded)

        expect(reloaded.connections).toHaveLength(3)
    })
})

describe('T-RT: every in-scope key survives load, export and decode', () => {
    test('T-RT: each key position equals the original, and the own openAIKey of a preset is exported empty', async () => {
        const original = roundTripLiteral()
        const { exported } = await exportOf(roundTripLiteral(), { load: true })

        // identity part (a guard: passes before and after)
        for (const field of ['openAIKey', 'claudeAPIKey', 'openrouterKey', 'nanogptKey', 'mistralKey', 'cohereAPIKey', 'ollamaApiKey', 'novellistAPI', 'mancerHeader', 'vertexPrivateKey'] as const) {
            expect(exported[field], field).toBe(LEGACY_ROOT_KEYS[field])
        }
        expect(exported.novelai?.token).toBe(LEGACY_ROOT_KEYS.novelai.token)
        expect(exported.hordeConfig?.apiKey).toBe(LEGACY_ROOT_KEYS.hordeConfig.apiKey)
        expect(exported.google?.accessToken).toBe(LEGACY_ROOT_KEYS.google.accessToken)
        expect(exported.OaiCompAPIKeys).toMatchObject(LEGACY_ROOT_KEYS.OaiCompAPIKeys)
        expect(exported.forceReplaceUrl).toBe(original.forceReplaceUrl)
        expect(exported.proxyKey).toBe(original.proxyKey)
        const originalPresets = original.botPresets as Preset[]
        exported.botPresets.forEach((preset, index) => {
            expect({ url: preset.forceReplaceUrl, key: preset.proxyKey }, `preset ${index}`).toEqual({ url: originalPresets[index].forceReplaceUrl, key: originalPresets[index].proxyKey })
        })
        const originalModels = original.customModels as Model[]
        exported.customModels?.forEach((model, index) => {
            expect({ key: model.key, url: model.url }, `model ${index}`).toEqual({ key: originalModels[index].key, url: originalModels[index].url })
        })
        expect(exported.connections).toBeUndefined()

        // reproducer part: the preset copy of the OpenAI key is never exported (the migration clears it)
        expect(exported.botPresets.map((preset) => preset.openAIKey)).toEqual(['', '', ''])
    })
})
