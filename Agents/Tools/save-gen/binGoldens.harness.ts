/**
 * Generator for the `.bin` golden fixtures under src/ts/drive/tests/binGoldens/.
 *
 * The fork-shaped goldens are written by today's real `SaveLocalBackup`
 * (`src/ts/drive/backuplocal.ts`) with the real collector, `LocalWriter`,
 * cold-storage writer and `encodeRisuSaveLegacy`; only platform I/O is
 * replaced (the page's byte store is an in-memory map, the download sink
 * captures the bytes, dialogs are mocks). The upstream-shaped goldens are
 * assembled by hand from the shapes upstream's `makeColdDataForCharacter` and
 * `makeColdDataForChat` produce, around a database entry encoded by the same
 * `encodeRisuSaveLegacy`.
 *
 * Every id, time and byte is fixed, so a second run reproduces identical
 * files. The guard `src/ts/drive/tests/binGoldens.test.ts` loads the committed
 * files; regenerate only when the fixture set itself is meant to change.
 *
 * Run from the repo root (output directory defaults to the golden directory;
 * BIN_GOLDENS_OUT redirects it, which the double-run check uses):
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/binGoldens.harness.ts
 *
 * Named `*.harness.ts`, so `pnpm test` never discovers it. A passing run
 * proves nothing about the Tauri or Node backends.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))

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
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
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
        getItem = vi.fn(async () => null)
        setItem = vi.fn(async () => { })
        keys = vi.fn(async () => [])
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

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

// No legacy OPFS unit file exists: every read falls through to "not found".
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

//#endregion

import { SaveLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { setColdStorageItem } from 'src/ts/process/coldstorage.svelte'
import { coldStorageHeader, formatColdStorageLoadError } from 'src/ts/process/coldstorageData'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'

// msgpackr 1.10.1 calls `Buffer.prototype.utf8Write(string, position, 0xffffffff)` for a longer
// string, and the Node running this harness rejects a length past the buffer's end. Clamping the
// length to the room left changes no byte written; it only lets the real encoder run here.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write
utf8WriterProto.utf8Write = function (text, position, length) {
    return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
}

//#region fixture definition

const encoder = new TextEncoder()

/** Fixed unit ids; a unit key must be a UUID for a restore to place it. */
const ID = {
    stubBlob: '00000000-0000-4000-8000-0000000000a1',
    inlineChatUnit: '00000000-0000-4000-8000-0000000000a2',
    blobChatUnit: '00000000-0000-4000-8000-0000000000a3',
    pluginUnit: '00000000-0000-4000-8000-0000000000a4',
    missingChatUnit: '00000000-0000-4000-8000-0000000000a5',
    errorTextUnit: '00000000-0000-4000-8000-0000000000a6',
} as const

const ASSET_NAME = 'golden-avatar.png'
const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x47, 0x4f, 0x4c, 0x44])
const T = 1700000000000

function plainChat(id: string, text: string) {
    return { id, message: [{ time: T, data: text, role: 'char' }], note: '', name: '', localLore: [] }
}

function pointerChat(id: string, key: string) {
    return {
        id,
        message: [{ time: T, data: coldStorageHeader + key, role: 'char' }],
        note: '',
        name: '',
        localLore: [],
        hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
        hypaV3Data: { summaries: [] },
        scriptstate: {},
    }
}

function chatUnitValue(text: string) {
    return {
        message: [{ time: T, data: text, role: 'user' }],
        hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
        hypaV3Data: { summaries: [] },
        scriptstate: {},
        localLore: [],
    }
}

/** A plugin value the fork accepts and upstream's collector would drop (not an array, and no `character` or `message`). */
const FORK_PLUGIN_VALUE = { theme: 'dark', count: 3 }
/** A plugin value upstream's collector writes: an array passes its `isColdStorageBackupData`. */
const UPSTREAM_PLUGIN_VALUE = ['dark', 3]

/** The shared module and preset records both families carry; every field is asserted by the guard. */
function moduleAndPreset() {
    return {
        modules: [{
            id: 'module-golden',
            name: 'Golden Module',
            description: 'golden module',
            lorebook: [{ key: 'golden-key', comment: 'golden entry', content: 'golden lore', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false }],
            regex: [{ comment: 'golden regex', in: 'gold', out: 'GOLD', type: 'editdisplay' }],
            trigger: [],
        }],
        botPresets: [{ name: 'Golden Preset', id: 'preset-golden', temperature: 80, maxContext: 4000, maxResponse: 300 }],
    }
}

function assetOwner() {
    return { image: 'assets/' + ASSET_NAME }
}

/** Fork shape: ids and fields as today's archive and export code write them. */
function forkDatabase(opts: { missingPointer: boolean }): Database {
    const inlineChats = opts.missingPointer
        ? [plainChat('chat-inline-1', 'inline hello'), pointerChat('chat-missing-1', ID.missingChatUnit)]
        : [plainChat('chat-inline-1', 'inline hello'), pointerChat('chat-pointer-1', ID.inlineChatUnit)]
    const characters: unknown[] = [
        { chaId: 'cha-inline', name: 'Inline Alice', type: 'character', chatPage: 0, ...assetOwner(), chats: inlineChats },
    ]
    if (!opts.missingPointer) {
        characters.push({
            chaId: 'cha-stub',
            name: 'Stub Bob',
            type: 'character',
            chatPage: 0,
            firstMsgIndex: 0,
            coldstorage: ID.stubBlob,
            coldStoragedChats: [ID.blobChatUnit],
            chats: [{ id: 'cha-stub-stub-chat', message: [{ time: T, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        })
    }
    return {
        characters,
        personas: [],
        characterOrder: [],
        ...moduleAndPreset(),
        pluginCustomStorage: opts.missingPointer ? {} : { _coldplugin: { prefs: ID.pluginUnit } },
    } as unknown as Database
}

/** The archived character a stub's blob unit holds. */
function stubBlobValue() {
    return {
        character: {
            chaId: 'cha-stub',
            name: 'Stub Bob',
            type: 'character',
            chatPage: 0,
            chats: [plainChat('chat-blob-plain', 'blob hello'), pointerChat('chat-blob-pointer', ID.blobChatUnit)],
        },
    }
}

/** A database with only a stub character: the blob its `coldstorage` names is the unit under test. */
function stubOnlyDatabase(stub: unknown): Database {
    return { characters: [stub], personas: [], characterOrder: [], botPresets: [], modules: [] } as unknown as Database
}

function forkStub() {
    return {
        chaId: 'cha-stub',
        name: 'Stub Bob',
        type: 'character',
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: ID.stubBlob,
        coldStoragedChats: [ID.blobChatUnit],
        chats: [{ id: 'cha-stub-stub-chat', message: [{ time: T, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
    }
}

/** The stub `makeColdDataForCharacter` leaves behind: its placeholder chat has no `id`. */
function upstreamStub() {
    return {
        type: 'character',
        name: 'Stub Bob',
        chats: [{ message: [{ time: T, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        chaId: 'cha-stub',
        firstMsgIndex: 0,
        coldstorage: ID.stubBlob,
        coldStoragedChats: [ID.blobChatUnit],
    }
}

type UpstreamCase = 'full' | 'missing-pointer' | 'plugin-object-no-entry' | 'stub-only'

/**
 * Upstream shape: the objects `makeColdDataForCharacter` and
 * `makeColdDataForChat` leave behind. Upstream's `makeColdDataForChat` mutates
 * a chat in place, so a real chat keeps its `id`, `note` and `name`; the
 * fixture's chats model a chat that has no `id` (an older chat), which the
 * restore gives one. A stub has no chat id. The `full` case also carries a
 * chat holding the text upstream's `preLoadChat` writes when a unit cannot be
 * read.
 */
function upstreamDatabase(variant: UpstreamCase): Database {
    const upstreamPointerChat = (key: string) => ({
        message: [{ time: T, data: coldStorageHeader + key, role: 'char' }],
        note: '',
        name: '',
        localLore: [],
        hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
        hypaV3Data: { summaries: [] },
        scriptstate: {},
    })
    const plainUpstreamChat = (data: string) => ({ message: [{ time: T, data, role: 'char' }], note: '', name: '', localLore: [] })
    if (variant === 'stub-only') {
        return stubOnlyDatabase(upstreamStub())
    }
    const chats: unknown[] = [plainUpstreamChat('inline hello')]
    if (variant === 'full') {
        chats.push(upstreamPointerChat(ID.inlineChatUnit), plainUpstreamChat(formatColdStorageLoadError(ID.errorTextUnit)))
    } else if (variant === 'missing-pointer') {
        chats.push(upstreamPointerChat(ID.missingChatUnit))
    }
    const characters: unknown[] = [
        { type: 'character', chaId: 'cha-inline', name: 'Inline Alice', chatPage: 0, ...assetOwner(), chats },
    ]
    if (variant === 'full') {
        characters.push(upstreamStub())
    }
    return {
        characters,
        personas: [],
        characterOrder: [],
        ...moduleAndPreset(),
        pluginCustomStorage: variant === 'missing-pointer' ? {} : { _coldplugin: { prefs: ID.pluginUnit } },
    } as unknown as Database
}

//#endregion

//#region container helpers

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** One `[nameLength][name][dataLength][data]` entry, the container `LoadLocalBackup` reads. */
function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = encoder.encode(name)
    return concat([u32le(nameBuf.length), nameBuf, u32le(data.length), data])
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

function unitEntry(key: string, value: unknown): Uint8Array {
    return buildChunk(`coldstorage_${key}.json`, encoder.encode(JSON.stringify(value)))
}

function databaseChunk(db: Database): Uint8Array {
    return buildChunk('database.risudat', encodeRisuSaveLegacy(db, 'compression'))
}

function upstreamContainer(variant: UpstreamCase): Uint8Array {
    const parts: Uint8Array[] = []
    if (variant !== 'stub-only') {
        parts.push(buildChunk(ASSET_NAME, ASSET_BYTES))
    }
    if (variant === 'full') {
        parts.push(
            unitEntry(ID.stubBlob, stubBlobValue()),
            unitEntry(ID.inlineChatUnit, chatUnitValue('archived inline chat')),
            unitEntry(ID.blobChatUnit, chatUnitValue('archived blob chat')),
            unitEntry(ID.errorTextUnit, chatUnitValue('archived error-text chat')),
            unitEntry(ID.pluginUnit, UPSTREAM_PLUGIN_VALUE),
        )
    }
    parts.push(databaseChunk(upstreamDatabase(variant)))
    return concat(parts)
}

/** A stub-only container whose blob entry holds `body`, or has no blob entry when `body` is null. */
function stubContainer(db: Database, body: Uint8Array | null): Uint8Array {
    return concat([
        ...(body === null ? [] : [buildChunk(`coldstorage_${ID.stubBlob}.json`, body)]),
        databaseChunk(db),
    ])
}

const BAD_JSON_BODY = encoder.encode('not json {')
const WRONG_SHAPE_BODY = encoder.encode(JSON.stringify({ a: 1 }))

//#endregion

const unitMem = new Map<string, Uint8Array>()
const assetMem = new Map<string, Uint8Array>()

beforeEach(() => {
    // The gzip header of a compressed database entry carries the clock's seconds; a fixed clock keeps the bytes reproducible.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    platformBox.isTauri = false
    backupSink.writes.length = 0
    unitMem.clear()
    assetMem.clear()
    injectAppStore(createForageBackedStore({
        getItem: async (key) => key.startsWith('coldstorage/') ? (unitMem.get(key) ?? null) : (assetMem.get(key) ?? null),
        setItem: async (key, value) => {
            if (key.startsWith('coldstorage/')) {
                unitMem.set(key, value)
            } else {
                assetMem.set(key, value)
            }
        },
        keys: async () => [...assetMem.keys(), ...unitMem.keys()].sort(),
        removeItem: async (key) => { unitMem.delete(key); assetMem.delete(key) },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function outDir(): string {
    const fromEnv = process.env.BIN_GOLDENS_OUT
    if (fromEnv) {
        return path.resolve(fromEnv)
    }
    // The run command's working directory is the repo root.
    return path.resolve(process.cwd(), 'src/ts/drive/tests/binGoldens')
}

function emit(fileName: string, bytes: Uint8Array): void {
    const dir = outDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, fileName), bytes)
}

/** Seeds the store, runs today's real export for `db`, and returns the bytes it wrote. */
async function exportWithSaveLocalBackup(db: Database, seed: () => Promise<void>): Promise<Uint8Array> {
    assetMem.set('assets/' + ASSET_NAME, ASSET_BYTES)
    await seed()
    getDatabaseMock.mockImplementation(() => db)
    backupSink.writes.length = 0
    await SaveLocalBackup()
    return concat(backupSink.writes)
}

describe('bin golden generator', () => {
    test('fork-full.bin', async () => {
        const bytes = await exportWithSaveLocalBackup(forkDatabase({ missingPointer: false }), async () => {
            expect(await setColdStorageItem(ID.stubBlob, stubBlobValue())).toBe(true)
            expect(await setColdStorageItem(ID.inlineChatUnit, chatUnitValue('archived inline chat'))).toBe(true)
            expect(await setColdStorageItem(ID.blobChatUnit, chatUnitValue('archived blob chat'))).toBe(true)
            expect(await setColdStorageItem(ID.pluginUnit, FORK_PLUGIN_VALUE)).toBe(true)
        })
        expect(bytes.length).toBeGreaterThan(0)
        emit('fork-full.bin', bytes)
    })

    test('fork-missing-unit.bin', async () => {
        const bytes = await exportWithSaveLocalBackup(forkDatabase({ missingPointer: true }), async () => { })
        expect(bytes.length).toBeGreaterThan(0)
        emit('fork-missing-unit.bin', bytes)
    })

    // The real export of a stub whose blob unit is absent from the store writes no blob entry.
    test('fork-stub-missing-entry.bin', async () => {
        const bytes = await exportWithSaveLocalBackup(stubOnlyDatabase(forkStub()), async () => { })
        expect(bytes.length).toBeGreaterThan(0)
        emit('fork-stub-missing-entry.bin', bytes)
    })

    // The real exporter never writes an unparsable entry, so these two hold a hand-placed blob entry around a fork-shaped database.
    test('fork-stub-bad-json.bin', () => {
        emit('fork-stub-bad-json.bin', stubContainer(stubOnlyDatabase(forkStub()), BAD_JSON_BODY))
    })

    test('fork-stub-wrong-shape.bin', () => {
        emit('fork-stub-wrong-shape.bin', stubContainer(stubOnlyDatabase(forkStub()), WRONG_SHAPE_BODY))
    })

    test('upstream-full.bin', () => {
        emit('upstream-full.bin', upstreamContainer('full'))
    })

    test('upstream-missing-unit.bin', () => {
        emit('upstream-missing-unit.bin', upstreamContainer('missing-pointer'))
    })

    // An object-valued `_coldplugin` unit is one upstream's collector leaves out, so the mapping is exported with no entry.
    test('upstream-plugin-object-no-entry.bin', () => {
        emit('upstream-plugin-object-no-entry.bin', upstreamContainer('plugin-object-no-entry'))
    })

    test('upstream-stub-missing-entry.bin', () => {
        emit('upstream-stub-missing-entry.bin', stubContainer(upstreamDatabase('stub-only'), null))
    })

    test('upstream-stub-bad-json.bin', () => {
        emit('upstream-stub-bad-json.bin', stubContainer(upstreamDatabase('stub-only'), BAD_JSON_BODY))
    })

    test('upstream-stub-wrong-shape.bin', () => {
        emit('upstream-stub-wrong-shape.bin', stubContainer(upstreamDatabase('stub-only'), WRONG_SHAPE_BODY))
    })
})
