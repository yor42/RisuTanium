/**
 * Compatibility guard: the `.bin` golden fixtures under `binGoldens/` restore
 * through `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) to the logical
 * content they were built from. It holds before and after any change to how a
 * backup is imported or exported, so a later rewrite can show that the same
 * files still import to the same characters, units, plugin value, module,
 * preset and asset.
 *
 * `fork-*.bin` were written by the real `SaveLocalBackup` and `upstream-*.bin`
 * were assembled from the shapes upstream's `makeColdDataForCharacter` and
 * `makeColdDataForChat` leave behind (`Agents/Tools/save-gen/binGoldens.harness.ts`,
 * `binGoldens/README.md`). The real `LoadLocalBackup`, collector, cold-storage
 * reader and writer, decoder and restore replace run; the page's byte store is
 * an in-memory map, `setDatabase` records the database the restore installs,
 * and dialogs are mocks. A pass says nothing about the Tauri or Node backends
 * or a real browser's storage.
 *
 * The missing-unit goldens hold a chat pointer whose unit is in no entry: the
 * restore today keeps the pointer text in the chat's first message, leaves the
 * unit absent and asks the incomplete-restore question naming the character.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { gzipSync } from 'fflate'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const setDatabaseMock = vi.hoisted(() => vi.fn())
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())

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
    setDatabase: setDatabaseMock,
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

import { LoadLocalBackup, SaveLocalBackup } from 'src/ts/drive/backuplocal'
import { decodeRisuSave, isBlockFormatSave } from 'src/ts/storage/risuSave'
import { overrideBackupWindowBytes } from 'src/ts/drive/backupContainer'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { readColdStorageItem } from 'src/ts/process/coldstorage.svelte'
import { coldStorageHeader, formatColdStorageLoadError } from 'src/ts/process/coldstorageData'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { injectRestoreStore } from './restoreSupport'
import { createHypaV3Preset, normalizeHypaV3Presets } from 'src/ts/process/memory/hypaV3Presets'

//#region helpers

const ID = {
    stubBlob: '00000000-0000-4000-8000-0000000000a1',
    inlineChatUnit: '00000000-0000-4000-8000-0000000000a2',
    blobChatUnit: '00000000-0000-4000-8000-0000000000a3',
    pluginUnit: '00000000-0000-4000-8000-0000000000a4',
    missingChatUnit: '00000000-0000-4000-8000-0000000000a5',
    errorTextUnit: '00000000-0000-4000-8000-0000000000a6',
} as const

const ASSET_KEY = 'assets/golden-avatar.png'
const ASSET_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x47, 0x4f, 0x4c, 0x44])

// The run command's working directory is the repo root; BIN_GOLDENS_DIR points the guard at another directory of the same file names.
const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

interface RestoredChat {
    message: { data: string }[]
}

interface RestoredCharacter {
    chaId: string
    name: string
    chats: RestoredChat[]
    coldstorage?: string
    coldStoragedChats?: string[]
    image?: string
}

interface RestoredDatabase {
    characters: RestoredCharacter[]
    modules: Record<string, unknown>[]
    botPresets: Record<string, unknown>[]
    pluginCustomStorage?: { _coldplugin?: Record<string, string>, _coldpluginIndex?: unknown }
    upstreamKvBlocks?: Record<string, unknown>
}

/** The unit ids of the plugin-index goldens (`Agents/Tools/save-gen/binGoldens.harness.ts`). */
const INDEX_ID = {
    index: '00000000-0000-4000-8000-0000000000b1',
    large: '00000000-0000-4000-8000-0000000000b2',
    shadowed: '00000000-0000-4000-8000-0000000000b3',
    kept: '00000000-0000-4000-8000-0000000000b4',
} as const

function readGolden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

const assetMem = new Map<string, Uint8Array>()
const unitMem = new Map<string, Uint8Array>()

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

/** Restores `bytes` through the real `LoadLocalBackup` and returns the database it installed. */
async function restoreBytes(bytes: Uint8Array): Promise<RestoredDatabase> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    const file = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    expect(alertErrorMock).not.toHaveBeenCalled()
    expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    return setDatabaseMock.mock.calls[0][0] as RestoredDatabase
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** The `database.risudat` entry of a written backup: entries are `[u32 nameLength][name][u32 dataLength][data]`. */
function databaseEntryOf(container: Uint8Array): Uint8Array {
    const view = new DataView(container.buffer, container.byteOffset, container.byteLength)
    let offset = 0
    while (offset < container.length) {
        const nameLength = view.getUint32(offset, true)
        const name = new TextDecoder().decode(container.subarray(offset + 4, offset + 4 + nameLength))
        const dataLength = view.getUint32(offset + 4 + nameLength, true)
        const start = offset + 8 + nameLength
        if (name === 'database.risudat') {
            return container.slice(start, start + dataLength)
        }
        offset = start + dataLength
    }
    throw new Error('the backup has no database entry')
}

function character(db: RestoredDatabase, chaId: string): RestoredCharacter {
    const found = db.characters.find((c) => c.chaId === chaId)
    if (!found) {
        throw new Error(`restored database has no character ${chaId}`)
    }
    return found
}

function firstMessages(c: RestoredCharacter): string[] {
    return c.chats.map((chat) => chat.message[0].data)
}

async function unitJson(key: string): Promise<unknown> {
    const read = await readColdStorageItem(key)
    return read.status === 'ok' ? read.value : `unit is ${read.status}`
}

function incompleteRestorePrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.startsWith('Cold storage data') && t.includes('incomplete restore'))
}

/** The questions that name left-out (unreadable) blocks of the file being restored. */
function leftOutPrompts(): string[] {
    return alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((t) => t.includes('part(s) of the backup this version cannot read'))
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    assetMem.clear()
    unitMem.clear()
    setDatabaseMock.mockReset()
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    backupSink.writes.length = 0
    alertConfirmMock.mockClear()
    alertErrorMock.mockClear()
    injectRestoreStore(createForageBackedStore({
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
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
    capturedInput = null
    const realCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
})

afterEach(() => {
    createElementSpy.mockRestore()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

// The goldens restore at the default windows and again at windows so small that every golden crosses window edges in both
// passes of the import.
const GOLDEN_WINDOWS = [{ label: 'default windows', bytes: null }, { label: '4-byte windows', bytes: 4 }, { label: '64-byte windows', bytes: 64 }] as const

describe.each(GOLDEN_WINDOWS)('at $label', ({ bytes }) => {
    beforeEach(() => {
        overrideBackupWindowBytes(bytes === null ? null : { walk: bytes, copy: bytes })
    })
    afterEach(() => {
        overrideBackupWindowBytes(null)
    })

    /** The full module and preset records every full golden carries. */
    const GOLDEN_MODULE = {
        id: 'module-golden',
        name: 'Golden Module',
        description: 'golden module',
        lorebook: [{ key: 'golden-key', comment: 'golden entry', content: 'golden lore', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false }],
        regex: [{ comment: 'golden regex', in: 'gold', out: 'GOLD', type: 'editdisplay' }],
        trigger: [],
    }
    const GOLDEN_PRESET = { name: 'Golden Preset', id: 'preset-golden', temperature: 80, maxContext: 4000, maxResponse: 300 }

    interface FullCase {
        file: string
        pluginUnit: unknown
        /** The inline character's first messages, in chat order. */
        inlineFirstMessages: string[]
    }

    const FULL_CASES: FullCase[] = [
        {
            file: 'fork-full.bin',
            pluginUnit: { theme: 'dark', count: 3 },
            inlineFirstMessages: ['inline hello', coldStorageHeader + ID.inlineChatUnit],
        },
        {
            // An array is the plugin value shape upstream's collector writes; the third chat holds the text upstream's `preLoadChat` writes for an unreadable unit.
            file: 'upstream-full.bin',
            pluginUnit: ['dark', 3],
            inlineFirstMessages: ['inline hello', coldStorageHeader + ID.inlineChatUnit, formatColdStorageLoadError(ID.errorTextUnit)],
        },
    ]

    describe.each(FULL_CASES)('guard: $file restores to the logical content it was built from', ({ file, pluginUnit, inlineFirstMessages }) => {
        test('characters, archived stub, pointer chats, plugin value, module, preset and asset', async () => {
            const db = await restoreBytes(readGolden(file))

            const inline = character(db, 'cha-inline')
            expect(inline.name).toBe('Inline Alice')
            expect(inline.image).toBe(ASSET_KEY)
            expect(firstMessages(inline)).toEqual(inlineFirstMessages)

            const stub = character(db, 'cha-stub')
            expect(stub.name).toBe('Stub Bob')
            expect(stub.coldstorage).toBe(ID.stubBlob)
            expect(stub.coldStoragedChats).toEqual([ID.blobChatUnit])

            expect(db.modules).toHaveLength(1)
            expect(db.modules[0]).toMatchObject(GOLDEN_MODULE)
            expect(db.botPresets.find((p) => p.name === 'Golden Preset')).toMatchObject(GOLDEN_PRESET)
            expect(db.pluginCustomStorage?._coldplugin).toEqual({ prefs: ID.pluginUnit })

            expect(assetMem.get(ASSET_KEY)).toEqual(ASSET_BYTES)

            const blob = await unitJson(ID.stubBlob) as { character: RestoredCharacter }
            expect(blob.character.chaId).toBe('cha-stub')
            expect(firstMessages(blob.character)).toEqual(['blob hello', coldStorageHeader + ID.blobChatUnit])
            expect(await unitJson(ID.inlineChatUnit)).toMatchObject({ message: [{ data: 'archived inline chat', role: 'user' }] })
            expect(await unitJson(ID.blobChatUnit)).toMatchObject({ message: [{ data: 'archived blob chat', role: 'user' }] })
            expect(await unitJson(ID.pluginUnit)).toEqual(pluginUnit)

            expect(incompleteRestorePrompts()).toEqual([])
        })
    })

    describe.each(['fork-missing-unit.bin', 'upstream-missing-unit.bin'])('guard: %s keeps a pointer chat whose unit is in no entry', (fileName) => {
        test('the pointer text stays in the first message, the unit stays absent and the character is named in the question', async () => {
            const db = await restoreBytes(readGolden(fileName))

            const inline = character(db, 'cha-inline')
            expect(firstMessages(inline)).toEqual(['inline hello', coldStorageHeader + ID.missingChatUnit])
            expect((await readColdStorageItem(ID.missingChatUnit)).status).toBe('missing')
            expect(db.characters).toHaveLength(1)

            const prompts = incompleteRestorePrompts()
            expect(prompts).toHaveLength(1)
            expect(prompts[0]).toContain('Inline Alice')
        })
    })

    /**
     * Upstream's SaveKV: `kv:<namespace>` blocks (type 12) of a block-format database entry. The restore carries each
     * block's content verbatim in `upstreamKvBlocks`, and an export writes the namespaces back as `kv:` blocks in
     * upstream's block format, so upstream reads them again.
     */
    describe('upstream-kv.bin carries upstream SaveKV namespaces', () => {
        const KV_A_CONTENT = {
            version: 1,
            entries: [
                { k: 'zeta', v: 1 },
                { k: '0', v: 'zero' },
                { k: 'alpha', v: { list: [1, { deep: true }, null], text: 'x' } },
                { k: '한글🙂', v: 'unicode value' },
                { k: 'nothing', v: null },
            ],
        }
        const KV_B_CONTENT = { version: 1, entries: [{ k: 'second', v: [false, 'b'] }, { k: 'first', v: 0 }] }

        test('guard: the restore keeps both namespaces with their entry order and asks nothing', async () => {
            const db = await restoreBytes(readGolden('upstream-kv.bin'))

            expect(db.upstreamKvBlocks).toEqual({ 'ns-a': KV_A_CONTENT, 'ns-b': KV_B_CONTENT })
            expect(Object.keys(db.upstreamKvBlocks ?? {})).toEqual(['ns-a', 'ns-b'])
            expect(db.characters.map((c) => c.chaId)).toEqual(['cha-inline'])
            expect(incompleteRestorePrompts()).toEqual([])
            expect(leftOutPrompts()).toEqual([])
        })

        test('guard: a kv block that is not JSON is the one thing left out, after one question, and the valid namespace is kept', async () => {
            const db = await restoreBytes(readGolden('upstream-kv-unreadable.bin'))

            expect(db.upstreamKvBlocks).toEqual({ 'ns-b': KV_B_CONTENT })
            expect(db.characters.map((c) => c.chaId)).toEqual(['cha-inline'])
            const questions = leftOutPrompts()
            expect(questions).toHaveLength(1)
            expect(questions[0]).toContain('- 1 part(s) of the backup this version cannot read')
        })

        test('reproducer: an export of the restored tree is upstream block format that decodes to the same namespaces', async () => {
            const db = await restoreBytes(readGolden('upstream-kv.bin'))
            const restoredKv = structuredClone(db.upstreamKvBlocks)
            getDatabaseMock.mockImplementation(() => db as unknown as Database)
            backupSink.writes.length = 0
            await SaveLocalBackup()

            const entry = databaseEntryOf(concatBytes(backupSink.writes))
            expect(isBlockFormatSave(entry)).toBe(true)
            const decoded = await decodeRisuSave(entry, { strict: true })
            expect(decoded.upstreamKvBlocks).toEqual(restoredKv)
            expect(Object.keys(decoded.upstreamKvBlocks ?? {})).toEqual(['ns-a', 'ns-b'])
            expect(decoded.characters.map((c) => c.chaId)).toEqual(['cha-inline'])
            // The root block is the only uncompressed one: it names the directory and does not hold the field.
            const text = new TextDecoder().decode(entry)
            expect(text).toContain('"__directory"')
            expect(text).not.toContain('upstreamKvBlocks')
            // The live tree the page holds is not changed by the export.
            expect(db.upstreamKvBlocks).toEqual(restoredKv)
        })

        test('reproducer: a character with a numeric id and kv namespaces exports, and the number survives', async () => {
            const db = await restoreBytes(readGolden('upstream-kv.bin'))
            const restoredKv = structuredClone(db.upstreamKvBlocks)
            ;(db.characters[0] as unknown as { chaId: number }).chaId = 5
            getDatabaseMock.mockImplementation(() => db as unknown as Database)
            backupSink.writes.length = 0
            await SaveLocalBackup()

            expect(alertErrorMock).not.toHaveBeenCalled()
            const entry = databaseEntryOf(concatBytes(backupSink.writes))
            expect(isBlockFormatSave(entry)).toBe(true)
            const decoded = await decodeRisuSave(entry, { strict: true })
            expect(decoded.characters.map((c) => c.chaId)).toEqual([5])
            expect(decoded.upstreamKvBlocks).toEqual(restoredKv)
        })

        test('reproducer: a tree whose field is empty or undefined exports the same msgpack entry as a tree without the field', async () => {
            const restored = await restoreBytes(readGolden('upstream-kv.bin'))
            const { upstreamKvBlocks: _field, ...withoutField } = restored

            async function exportedEntry(db: RestoredDatabase): Promise<Uint8Array> {
                getDatabaseMock.mockImplementation(() => db as unknown as Database)
                backupSink.writes.length = 0
                await SaveLocalBackup()
                return databaseEntryOf(concatBytes(backupSink.writes))
            }
            const plain = await exportedEntry(withoutField)
            const emptyField = await exportedEntry({ ...withoutField, upstreamKvBlocks: {} })
            const undefinedField = await exportedEntry({ ...withoutField, upstreamKvBlocks: undefined })

            expect(isBlockFormatSave(plain)).toBe(false)
            expect(Array.from(emptyField)).toEqual(Array.from(plain))
            expect(Array.from(undefinedField)).toEqual(Array.from(plain))
            expect('upstreamKvBlocks' in await decodeRisuSave(plain)).toBe(false)
        })
    })

    describe('guard: upstream-plugin-object-no-entry.bin keeps an object-valued plugin mapping whose unit upstream did not export', () => {
        test('the mapping stays, the unit stays absent and one question is asked about an item that cannot be linked to a character', async () => {
            const db = await restoreBytes(readGolden('upstream-plugin-object-no-entry.bin'))

            expect(db.pluginCustomStorage?._coldplugin).toEqual({ prefs: ID.pluginUnit })
            expect((await readColdStorageItem(ID.pluginUnit)).status).toBe('missing')
            expect(db.characters.map((c) => c.chaId)).toEqual(['cha-inline'])

            const prompts = incompleteRestorePrompts()
            expect(prompts).toHaveLength(1)
            expect(prompts[0]).toContain('1 item(s) could not be linked to a character')
            expect(prompts[0]).toContain('1 cold storage item(s) will remain unavailable')
        })
    })

    /**
     * Upstream's plugin storage index. The fork stores plugin values as `_coldplugin` slots only, so a legacy-page restore
     * converts the pointer: the installed tree holds slots whose units equal the index's values, and never the pointer.
     * The database entry of these two files is upstream's block format.
     */
    describe('upstream-plugin-index.bin converts the plugin storage index on a legacy page', () => {
        test('the installed tree holds slots equal to the index values, the index wins over the fork map, and there is no pointer', async () => {
            const db = await restoreBytes(readGolden('upstream-plugin-index.bin'))

            expect(Object.keys(db.pluginCustomStorage ?? {})).toEqual(['_coldplugin'])
            const slots = db.pluginCustomStorage?._coldplugin ?? {}
            const values: Record<string, unknown> = {}
            for (const [key, id] of Object.entries(slots)) {
                values[key] = await unitJson(id)
            }
            expect(values).toEqual({
                objKey: { theme: 'dark', nested: { list: [1, 2, null], flag: false } },
                nullKey: null,
                numKey: 42,
                textKey: 'hello',
                falseKey: false,
                emptyTextKey: '',
                bigKey: { big: ['a', 'b', 'c'] },
                shared: { from: 'index' },
                kept: ['kept'],
            })
            expect(slots.bigKey).toBe(INDEX_ID.large)
            expect(slots.kept).toBe(INDEX_ID.kept)
            expect(slots.shared).not.toBe(INDEX_ID.shadowed)
            for (const id of Object.values(slots)) {
                expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
            }
            expect(db.characters.map((c) => c.chaId)).toEqual(['cha-inline'])
            expect(incompleteRestorePrompts()).toEqual([])
        })

        test('an index unit that is in no entry asks the incomplete-restore question and leaves no pointer', async () => {
            const db = await restoreBytes(readGolden('upstream-plugin-index-missing.bin'))

            expect(db.pluginCustomStorage).toEqual({ _coldplugin: { kept: INDEX_ID.kept } })
            expect((await readColdStorageItem(INDEX_ID.index)).status).toBe('missing')
            const prompts = incompleteRestorePrompts()
            expect(prompts).toHaveLength(1)
            expect(prompts[0]).toContain('1 item(s) could not be linked to a character')
            expect(prompts[0]).toContain('1 cold storage item(s) will remain unavailable')
        })
    })

    /**
     * The restore today installs a stub character exactly as the database holds it
     * (its `coldstorage` key, its `coldStoragedChats` and its one empty placeholder
     * chat) whatever the blob entry is, and asks the incomplete-restore question
     * naming the character. These record that behaviour only; they are not a rule
     * for any later importer.
     *
     *  - no entry, or an entry that is not JSON: the blob unit is not stored, so the
     *    blob and the chat unit its `coldStoragedChats` names are both unavailable.
     *  - an entry that is JSON of another shape, under the name the exporter writes:
     *    stored as a unit (any JSON is a unit under that name), so only the chat
     *    unit is unavailable.
     */
    describe.each([
        ['fork-stub-missing-entry.bin', 'missing', 2],
        ['fork-stub-bad-json.bin', 'missing', 2],
        ['fork-stub-wrong-shape.bin', 'ok', 1],
        ['upstream-stub-missing-entry.bin', 'missing', 2],
        ['upstream-stub-bad-json.bin', 'missing', 2],
        ['upstream-stub-wrong-shape.bin', 'ok', 1],
    ] as const)('guard: %s restores a stub whose blob entry cannot be used', (fileName, blobStatus, unavailable) => {
        test('the stub is installed as stored, the blob unit is as noted and one question names the character', async () => {
            const db = await restoreBytes(readGolden(fileName))

            expect(db.characters).toHaveLength(1)
            const stub = character(db, 'cha-stub')
            expect(stub.name).toBe('Stub Bob')
            expect(stub.coldstorage).toBe(ID.stubBlob)
            expect(stub.coldStoragedChats).toEqual([ID.blobChatUnit])
            expect(firstMessages(stub)).toEqual([''])

            expect((await readColdStorageItem(ID.stubBlob)).status).toBe(blobStatus)
            expect((await readColdStorageItem(ID.blobChatUnit)).status).toBe('missing')

            const prompts = incompleteRestorePrompts()
            expect(prompts).toHaveLength(1)
            expect(prompts[0]).toContain('Stub Bob')
            expect(prompts[0]).toContain(`${unavailable} cold storage item(s) will remain unavailable`)
        })
    })
})

/**
 * HypaV3 presets across the `.bin` round trip. The container is hand-built in
 * the test, upstream-shaped and synthetic (not upstream writer output): the
 * block framing is written out below and shares no code with a production
 * writer, and no golden file is read or changed. Upstream's block writer keeps
 * every database key except `characters`, `botPresets` and `modules` in the
 * root block, so the preset list, the active index and the five engine fields
 * sit there, and its `setDatabase` writes presets back as `{name, settings}`
 * without an id.
 *
 * Leg 1 (restore keeps the fields) is a compatibility guard. The block as a
 * whole imports `normalizeHypaV3Presets`, so no pre-change run of it is
 * claimed. `setDatabase` is mocked in this file, so the normalize legs call the
 * function `setDatabase` calls; the load itself is proven by
 * `databaseHypaV3Presets.test.ts`. The last leg models upstream's load: no
 * upstream code runs.
 */
describe('HypaV3 presets through the upstream-shaped .bin round trip', () => {
    const framing = new TextEncoder()

    function u32(n: number): Uint8Array {
        const buf = new Uint8Array(4)
        new DataView(buf.buffer).setUint32(0, n, true)
        return buf
    }

    function join(parts: Uint8Array[]): Uint8Array {
        return concatBytes(parts)
    }

    /** One block as upstream frames it: `[type u8][compression u8][nameLength u8][name][dataLength u32 LE][data]`; gzip has a zero header time. */
    function block(type: number, name: string, value: unknown, gzip: boolean): Uint8Array {
        const nameBuf = framing.encode(name)
        const raw = framing.encode(JSON.stringify(value))
        const data = gzip ? gzipSync(raw, { mtime: 0 }) : raw
        return join([Uint8Array.of(type, gzip ? 1 : 0, nameBuf.length), nameBuf, u32(data.length), data])
    }

    const TYPE = { config: 0, root: 1, preset: 4, modules: 5, character: 7, plugins: 9, loadouts: 10, pluginStorage: 11 } as const

    function presetOf(name: string, recent: number, similar: number) {
        return {
            name,
            settings: {
                summarizationModel: 'subModel',
                summarizationPrompt: `prompt of ${name}`,
                reSummarizationPrompt: '',
                memoryTokensRatio: 0.2,
                extraSummarizationRatio: 0,
                maxChatsPerSummary: 6,
                recentMemoryRatio: recent,
                similarMemoryRatio: similar,
                enableSimilarityCorrection: false,
                preserveOrphanedMemory: false,
                processRegexScript: false,
                doNotSummarizeUserMessage: false,
                summaryChunkSeparator: '\\n\\n',
                useExperimentalImpl: false,
                summarizationRequestsPerMinute: 20,
                summarizationMaxConcurrent: 1,
                embeddingRequestsPerMinute: 100,
                embeddingMaxConcurrent: 1,
                alwaysToggleOn: false,
                queryChatCount: 3,
            },
        }
    }

    const BUILT_PRESETS = [presetOf('Zeta', 0.4, 0.4), presetOf('Alpha', 0.4, 0.4), presetOf('Mid', 0.3, 0.5)]
    /** What the fork holds for the same presets: it adds its two recency settings on every load. */
    const RECENCY_DEFAULTS = { enableRecencyWeighting: false, recencyHalfLifeDays: 30 }
    const BUILT_PRESETS_FORK = BUILT_PRESETS.map((p) => ({ name: p.name, settings: { ...p.settings, ...RECENCY_DEFAULTS } }))

    /**
     * The 20 default settings of upstream's `createHypaV3Preset` (upstream/main 7be37f64f, hypav3.ts). Refresh this
     * model if upstream's defaults change.
     */
    const UPSTREAM_HYPAV3_DEFAULTS: Record<string, string | number | boolean> = {
        summarizationModel: 'subModel',
        summarizationPrompt: '',
        reSummarizationPrompt: '',
        memoryTokensRatio: 0.2,
        extraSummarizationRatio: 0,
        maxChatsPerSummary: 6,
        recentMemoryRatio: 0.4,
        similarMemoryRatio: 0.4,
        enableSimilarityCorrection: false,
        preserveOrphanedMemory: false,
        processRegexScript: false,
        doNotSummarizeUserMessage: false,
        summaryChunkSeparator: '\\n\\n',
        useExperimentalImpl: false,
        summarizationRequestsPerMinute: 20,
        summarizationMaxConcurrent: 1,
        embeddingRequestsPerMinute: 100,
        embeddingMaxConcurrent: 1,
        alwaysToggleOn: false,
        queryChatCount: 3,
    }

    /**
     * Models upstream's load of every preset (`setDatabase` calling `createHypaV3Preset`): start from the defaults, copy a
     * stored value only when its key is a default and the type matches, and keep `{name, settings}` with no id.
     */
    function upstreamLoad(presets: { name?: string, settings?: object }[]) {
        return presets.map((p, i) => {
            const settings = { ...UPSTREAM_HYPAV3_DEFAULTS }
            for (const [key, value] of Object.entries(p.settings || {})) {
                if (key in settings && typeof value === typeof settings[key]) {
                    settings[key] = value
                }
            }
            return { name: p.name || `Preset ${i + 1}`, settings }
        })
    }
    const BUILT_FIELDS = { hypav2: true, hanuraiEnable: false, hypaV3: false, supaModelType: 'subModel', memoryAlgorithmType: 'hypaMemoryV2' }
    const BUILT_ROOT = { ...BUILT_FIELDS, hypaV3Presets: BUILT_PRESETS, hypaV3PresetId: 2, characterOrder: [], personas: [] }

    function upstreamContainer(chatExtras: object = {}): Uint8Array {
        const blocks = [
            { type: TYPE.character, name: 'cha-inline', value: { type: 'character', chaId: 'cha-inline', name: 'Inline Alice', chatPage: 0, chats: [{ id: 'chat-1', message: [{ time: 1, data: 'hello', role: 'char' }], note: '', name: '', localLore: [], ...chatExtras }] } },
            { type: TYPE.preset, name: 'preset', value: [{ name: 'Golden Preset', id: 'preset-golden', temperature: 80, maxContext: 4000, maxResponse: 300 }] },
            { type: TYPE.modules, name: 'modules', value: [] },
            { type: TYPE.loadouts, name: 'loadouts', value: [] },
            { type: TYPE.plugins, name: 'plugins', value: [] },
            { type: TYPE.pluginStorage, name: 'pluginStorage', value: {} },
            { type: TYPE.config, name: 'config', value: { version: 1 } },
        ]
        const database = join([
            framing.encode('RISUSAVE\0'),
            ...blocks.map((b) => block(b.type, b.name, b.value, true)),
            block(TYPE.root, 'root', { ...BUILT_ROOT, __directory: blocks.map((b) => b.name) }, false),
        ])
        const nameBuf = framing.encode('database.risudat')
        return join([u32(nameBuf.length), nameBuf, u32(database.length), database])
    }

    type PresetRoot = RestoredDatabase & {
        hypav2: boolean, hanuraiEnable: boolean, hypaV3: boolean, supaModelType: string, memoryAlgorithmType: string,
        hypaV3Presets: { id?: string, name: string, settings: object }[], hypaV3PresetId: number,
    }

    function fieldsOf(root: PresetRoot) {
        return {
            hypav2: root.hypav2, hanuraiEnable: root.hanuraiEnable, hypaV3: root.hypaV3,
            supaModelType: root.supaModelType, memoryAlgorithmType: root.memoryAlgorithmType,
        }
    }

    function nameAndSettings(root: PresetRoot) {
        return root.hypaV3Presets.map((p) => ({ name: p.name, settings: p.settings }))
    }

    test('the restore keeps the five fields, the preset order, {name, settings} and the index; normalize, export and decode keep them and the ids', async () => {
        // Leg 1: restore (real LoadLocalBackup).
        const root = await restoreBytes(upstreamContainer()) as PresetRoot
        expect(fieldsOf(root)).toEqual(BUILT_FIELDS)
        expect(root.hypaV3Presets).toEqual(BUILT_PRESETS)
        expect(root.hypaV3PresetId).toBe(2)

        // Leg 2: the function setDatabase calls on every load.
        normalizeHypaV3Presets(root as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        expect(nameAndSettings(root)).toEqual(BUILT_PRESETS_FORK)
        expect(root.hypaV3PresetId).toBe(2)
        const ids = root.hypaV3Presets.map((p) => p.id)
        expect(new Set(ids).size).toBe(3)
        for (const id of ids) {
            expect(typeof id).toBe('string')
            expect(id).not.toBe('')
        }

        // Leg 3: export through the real SaveLocalBackup, then decode.
        getDatabaseMock.mockImplementation(() => root as unknown as Database)
        backupSink.writes.length = 0
        await SaveLocalBackup()
        expect(alertErrorMock).not.toHaveBeenCalled()
        const decoded = await decodeRisuSave(databaseEntryOf(concatBytes(backupSink.writes)), { strict: true }) as unknown as PresetRoot
        expect(fieldsOf(decoded)).toEqual(BUILT_FIELDS)
        expect(decoded.hypaV3Presets.map((p) => Object.keys(p).sort())).toEqual([['id', 'name', 'settings'], ['id', 'name', 'settings'], ['id', 'name', 'settings']])
        expect(nameAndSettings(decoded)).toEqual(BUILT_PRESETS_FORK)
        expect(decoded.hypaV3Presets.map((p) => p.id)).toEqual(ids)
        expect(decoded.hypaV3PresetId).toBe(2)

        // Leg 4: a second normalize keeps the ids.
        normalizeHypaV3Presets(decoded as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        expect(decoded.hypaV3Presets.map((p) => p.id)).toEqual(ids)

        // Modelled upstream leg: upstream's load turns the exported presets back into exactly the upstream-shaped ones.
        expect(Object.keys(UPSTREAM_HYPAV3_DEFAULTS).sort()).toEqual(Object.keys(presetOf('x', 0.4, 0.4).settings).sort())
        const upstreamLoaded = upstreamLoad(decoded.hypaV3Presets)
        expect(upstreamLoaded).toEqual(BUILT_PRESETS)
        expect(decoded.hypaV3PresetId).toBe(2)

        // Fork return: the fork mints the ids again and reads the two recency settings as off/30.
        const forkReturn = {
            hypaV3Presets: upstreamLoaded,
            hypaV3PresetId: decoded.hypaV3PresetId,
            hypaV3Settings: {},
            supaMemoryPrompt: '',
        }
        normalizeHypaV3Presets(forkReturn as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        const returned = forkReturn.hypaV3Presets as unknown as { id: string, name: string, settings: object }[]
        expect(returned.map((p) => ({ name: p.name, settings: p.settings }))).toEqual(BUILT_PRESETS_FORK)
        expect(forkReturn.hypaV3PresetId).toBe(2)
        expect(new Set(returned.map((p) => p.id)).size).toBe(3)
        for (const p of returned) {
            expect(typeof p.id).toBe('string')
            expect(p.id).not.toBe('')
        }
    })

    // compatibility guard: the summary time is opaque chat data, so it passes before and after
    test('B2: a summary time on a chat survives restore, export and decode', async () => {
        const T = 1_763_424_000_000
        const summaries = [
            { text: 'legacy', chatMemos: ['m0'], isImportant: false, tags: [] },
            { text: 'dated', chatMemos: ['m1'], isImportant: false, tags: [], createdAt: T },
        ]
        const root = await restoreBytes(upstreamContainer({ hypaV3Data: { summaries } }))
        getDatabaseMock.mockImplementation(() => root as unknown as Database)
        backupSink.writes.length = 0
        await SaveLocalBackup()
        expect(alertErrorMock).not.toHaveBeenCalled()
        const decoded = await decodeRisuSave(databaseEntryOf(concatBytes(backupSink.writes)), { strict: true })
        const chat = decoded.characters[0].chats[0] as unknown as { hypaV3Data: { summaries: object[] } }
        expect(chat.hypaV3Data.summaries).toEqual(summaries)
    })

    // regression reproducer: base normalize drops the two recency keys, so the option resets to off on load
    test('B3: a fork .bin keeps the recency settings through restore, normalize, export and decode; upstream drops them', async () => {
        const forkPreset = {
            id: 'preset-fork',
            name: 'Fork',
            settings: { ...presetOf('Fork', 0.4, 0.4).settings, enableRecencyWeighting: true, recencyHalfLifeDays: 14 },
        }

        // B3-0: the fork .bin is written by the real exporter.
        const first = await restoreBytes(upstreamContainer()) as PresetRoot
        first.hypaV3Presets = [forkPreset]
        first.hypaV3PresetId = 0
        getDatabaseMock.mockImplementation(() => first as unknown as Database)
        backupSink.writes.length = 0
        await SaveLocalBackup()
        expect(alertErrorMock).not.toHaveBeenCalled()
        const forkBin = concatBytes(backupSink.writes)

        // B3-1: raw restore of the fork .bin.
        setDatabaseMock.mockClear()
        const root = await restoreBytes(forkBin) as PresetRoot
        expect(root.hypaV3Presets).toEqual([forkPreset])

        // B3-2: the function setDatabase calls on every load.
        normalizeHypaV3Presets(root as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        const settingsOf = (db: PresetRoot) => db.hypaV3Presets[0].settings as { enableRecencyWeighting?: boolean, recencyHalfLifeDays?: number }
        expect(settingsOf(root).enableRecencyWeighting).toBe(true)
        expect(settingsOf(root).recencyHalfLifeDays).toBe(14)

        // B3-3: export and decode keep both keys.
        getDatabaseMock.mockImplementation(() => root as unknown as Database)
        backupSink.writes.length = 0
        await SaveLocalBackup()
        const decoded = await decodeRisuSave(databaseEntryOf(concatBytes(backupSink.writes)), { strict: true }) as unknown as PresetRoot
        expect(decoded.hypaV3Presets.map((p) => Object.keys(p).sort())).toEqual([['id', 'name', 'settings']])
        expect(settingsOf(decoded)).toEqual(forkPreset.settings)

        // B3-4: upstream's load drops the two keys and the id, and every other value is equal.
        const upstreamLoaded = upstreamLoad(decoded.hypaV3Presets)
        expect(upstreamLoaded).toEqual([{ name: 'Fork', settings: presetOf('Fork', 0.4, 0.4).settings }])

        // B3-5: fork return: the option is off again (fork -> upstream -> fork resets it).
        const forkReturn = { hypaV3Presets: upstreamLoaded, hypaV3PresetId: 0, hypaV3Settings: {}, supaMemoryPrompt: '' }
        normalizeHypaV3Presets(forkReturn as unknown as Parameters<typeof normalizeHypaV3Presets>[0])
        const returned = forkReturn.hypaV3Presets[0] as unknown as { settings: object }
        expect(returned.settings).toEqual({ ...presetOf('Fork', 0.4, 0.4).settings, ...RECENCY_DEFAULTS })

        // B3-6: the fixture equals what the fork's own preset constructor produces for the same input.
        expect(createHypaV3Preset('Fork', forkPreset.settings).settings).toEqual(forkPreset.settings)
    })
})
