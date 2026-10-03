/**
 * Memory stage 1 step 4: the local backup carries every cold-storage unit it
 * needs (Agents/Reports/49-memory-stage-1-plan.md, D13; MC-147).
 *
 * `collectColdStorageBackupPayloads` runs for real over the real
 * `setColdStorageItem` / `readColdStorageItem`; only the page's byte store
 * underneath is a stand-in, and it records every read so a test can tell how
 * often a unit was read. A passing test here says nothing about the real
 * IndexedDB, Tauri or Node stores.
 *
 * Invariants pinned here:
 *   - the unit set is closed under "refers to": from every character blob and
 *     chat unit the collector reads, the pointer keys and the legacy
 *     error-text keys it contains are carried too, each unit read once;
 *   - an error-text key whose unit is absent is left out without a prompt, one
 *     whose unit cannot be read or is not chat or character shaped is
 *     reported, and a key reached by any pointer is never treated as an
 *     error-text key;
 *   - a key found inside an archive or named by error text that the restore
 *     could not place (not a UUID) is never read or carried;
 *   - every plugin storage unit that reads is carried whatever its JSON value;
 *   - a chat or character unit that reads, or a plugin storage unit that
 *     reads, is always carried however malformed its inner fields are;
 *   - a collected payload holds no parsed value.
 *
 * Tests whose title starts with `guard:` hold both before and after the
 * change; every other test fails without it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'

//#region module mocks

const platformState = vi.hoisted(() => ({ isTauri: false }))
const forageMem = vi.hoisted(() => new Map<string, Uint8Array>())
/** The page store's content (`coldstorage/<key>`) and every key read from it, in order. */
const unitStore = vi.hoisted(() => new Map<string, Uint8Array>())
const unitReadLog = vi.hoisted(() => [] as string[])

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformState.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { state: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(false),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../index.svelte'))

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
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
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
    open: vi.fn(async () => {}),
}))

vi.mock('streamsaver', () => ({
    default: {},
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    parseMarkdownSafe: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        async getItem(key: string) { return forageMem.get(key) ?? null }
        async setItem(key: string, value: Uint8Array) { forageMem.set(key, value) }
        async keys() { return Array.from(forageMem.keys()) }
        async removeItem(key: string) { forageMem.delete(key) }
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async (key) => { unitReadLog.push(key); return unitStore.get(key) ?? null },
        setItem: async (key, value) => { unitStore.set(key, value) },
        keys: async () => Array.from(unitStore.keys()),
        removeItem: async (key) => { unitStore.delete(key) },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

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

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: vi.fn(async () => []),
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    writeFile: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
}))

//#endregion

//#region legacy OPFS unit files stand-in (navigator.storage); no test here places one, so a read falls through to "not found"

const opfsStore = new Map<string, Uint8Array>()

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

const mockDirectoryHandle = {
    async getFileHandle(name: string) {
        if (!opfsStore.has(name)) {
            throw new MockNotFoundError(`not found: ${name}`)
        }
        return {
            async getFile() {
                const bytes = opfsStore.get(name)!
                return {
                    async arrayBuffer() {
                        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
                    },
                }
            },
        }
    },
    async removeEntry(name: string) {
        if (!opfsStore.has(name)) {
            throw new MockNotFoundError(`not found: ${name}`)
        }
        opfsStore.delete(name)
    },
    entries() {
        const iter = opfsStore.keys()
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        const r = iter.next()
                        if (r.done) {
                            return { done: true as const, value: undefined }
                        }
                        return { done: false as const, value: [r.value, {}] as [string, unknown] }
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

import {
    setColdStorageItem,
    readColdStorageItem,
    collectColdStorageBackupPayloads,
    confirmIncompleteColdStorageOperation,
    coldStorageHeader,
} from '../coldstorage.svelte'
import type { ColdStorageBackupPayload } from '../coldstorage.svelte'
import { formatColdStorageLoadError } from '../coldstorageData'
import { alertConfirm } from 'src/ts/alert'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type CollectResult = Awaited<ReturnType<typeof collectColdStorageBackupPayloads>>

/** Deterministic version-4-shaped ids; the restore only places `<uuid>.json` names. */
function uid(n: number): string {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

const encoder = new TextEncoder()

function makeDb(characters: CharacterFixture[], coldPlugin?: Record<string, string>): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: coldPlugin ? { _coldplugin: coldPlugin } : {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        coldstorage: false,
    } as unknown as Database
}

interface MessageFixture {
    time: number
    data: unknown
    role: string
}

function makeChat(id: string, firstMessageData: unknown) {
    const message: MessageFixture[] = [{ time: 1, data: firstMessageData, role: 'char' }]
    return { id, message, note: '', name: '', localLore: [] }
}

function pointerChat(id: string, key: string) {
    return makeChat(id, coldStorageHeader + key)
}

function errorTextChat(id: string, key: string) {
    return makeChat(id, formatColdStorageLoadError(key))
}

/** A character as it is live in memory. */
function makeLiveCharacter(chaId: string, name: string, chats: unknown[]): CharacterFixture {
    return { chaId, name, type: 'character', chatPage: 0, chats } as unknown as CharacterFixture
}

/** The stub left in the database when a character was archived to `blobKey`. */
function makeStub(chaId: string, name: string, blobKey: string, coldStoragedChats?: string[]): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        coldstorage: blobKey,
        ...(coldStoragedChats ? { coldStoragedChats } : {}),
        chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

/** Stores a character blob holding `chats`. */
async function putBlob(key: string, chaId: string, chats: unknown[]): Promise<void> {
    const ok = await setColdStorageItem(key, {
        character: { chaId, name: 'Archived', type: 'character', chatPage: 0, chats },
    })
    expect(ok).toBe(true)
}

/** Stores a chat unit whose first message holds `firstMessageData`. */
async function putChatUnit(key: string, firstMessageData: unknown = 'archived'): Promise<void> {
    const ok = await setColdStorageItem(key, {
        message: [{ time: 1, data: firstMessageData, role: 'user' }],
        hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
        hypaV3Data: { summaries: [] },
        scriptstate: {},
        localLore: [],
    })
    expect(ok).toBe(true)
}

function carriedKeys(result: CollectResult): string[] {
    return result.payloads.map((p) => p.key)
}

function unavailableKeys(result: CollectResult): string[] {
    return [...result.missingKeys, ...result.invalidKeys]
}

function readCount(key: string): number {
    return unitReadLog.filter((n) => n === 'coldstorage/' + key).length
}

/** Places raw bytes as the page store's unit `key`. */
function putRawUnit(key: string, bytes: Uint8Array): void {
    unitStore.set('coldstorage/' + key, bytes)
}

function payloadOf(result: CollectResult, key: string): ColdStorageBackupPayload {
    const found = result.payloads.find((p) => p.key === key)
    if (!found) {
        throw new Error(`key ${key} was not carried`)
    }
    return found
}

function promptTexts(): string[] {
    return vi.mocked(alertConfirm).mock.calls.map((c) => String(c[0]))
}

//#endregion

beforeEach(() => {
    platformState.isTauri = false
    opfsStore.clear()
    unitStore.clear()
    unitReadLog.length = 0
    vi.mocked(alertConfirm).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the backup follows pointers found inside the archives it reads', () => {
    test('a pointer chat inside a blob that the stub does not list in coldStoragedChats is carried', async () => {
        const BLOB = uid(1)
        const P = uid(2)
        await putChatUnit(P)
        await putBlob(BLOB, 'c1', [pointerChat('inner-1', P)])
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toContain(BLOB)
        expect(carriedKeys(result)).toContain(P)
        expect(unavailableKeys(result)).toEqual([])
    })

    test('a pointer to an absent unit inside a blob is reported as unavailable', async () => {
        const BLOB = uid(3)
        const P = uid(4)
        await putBlob(BLOB, 'c1', [pointerChat('inner-1', P)])
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toContain(BLOB)
        expect(unavailableKeys(result)).toContain(P)
    })

    test('a chat unit that is reached through the chain of legacy error texts is carried at every step', async () => {
        const A = uid(5)
        const B = uid(6)
        const C = uid(7)
        await putChatUnit(A, formatColdStorageLoadError(B))
        await putChatUnit(B, formatColdStorageLoadError(C))
        await putChatUnit(C)
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [errorTextChat('chat-1', A)])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result).sort()).toEqual([A, B, C].sort())
        expect(unavailableKeys(result)).toEqual([])
    })

    test('a chat unit reached by a pointer carries the unit its own legacy error text names', async () => {
        const CHAT = uid(8)
        const Y = uid(9)
        await putChatUnit(Y)
        await putChatUnit(CHAT, formatColdStorageLoadError(Y))
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [pointerChat('chat-1', CHAT)])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toContain(CHAT)
        expect(carriedKeys(result)).toContain(Y)
    })

    test('guard: a key reached by several routes is read once and carried once', async () => {
        const BLOB1 = uid(10)
        const BLOB2 = uid(11)
        const P = uid(12)
        await putChatUnit(P)
        await putBlob(BLOB1, 'c1', [pointerChat('inner-1', P)])
        await putBlob(BLOB2, 'c2', [pointerChat('inner-2', P)])
        const db = makeDb([
            makeStub('c1', 'Alice', BLOB1, [P]),
            makeStub('c2', 'Bob', BLOB2, []),
        ])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result).filter((k) => k === P)).toHaveLength(1)
        expect(readCount(P)).toBe(1)
    })

    test('two chat units whose legacy error texts name each other are each read exactly once and the collection ends', async () => {
        const A = uid(13)
        const B = uid(14)
        await putChatUnit(A, formatColdStorageLoadError(B))
        await putChatUnit(B, formatColdStorageLoadError(A))
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [errorTextChat('chat-1', A)])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(readCount(A)).toBe(1)
        expect(readCount(B)).toBe(1)
        expect(carriedKeys(result).sort()).toEqual([A, B].sort())
    })
})

describe('the backup carries the unit a legacy error text names', () => {
    test('a legacy error-text chat inside a blob carries the unit it names', async () => {
        const BLOB = uid(20)
        const X = uid(21)
        await putChatUnit(X)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toContain(X)
        expect(unavailableKeys(result)).toEqual([])
    })

    test('guard: an error-text key whose unit is absent from the device is left out and raises no prompt', async () => {
        const BLOB = uid(22)
        const X = uid(23)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)
        await confirmIncompleteColdStorageOperation(db, unavailableKeys(result), 'backup')

        expect(carriedKeys(result)).toEqual([BLOB])
        expect(unavailableKeys(result)).toEqual([])
        expect(promptTexts()).toEqual([])
    })

    test('an error-text key whose unit exists but cannot be read is reported as unavailable', async () => {
        const BLOB = uid(24)
        const X = uid(25)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        putRawUnit(X, encoder.encode('bytes that are not a compressed unit'))
        expect((await readColdStorageItem(X)).status).toBe('error')
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).not.toContain(X)
        expect(unavailableKeys(result)).toContain(X)
    })
})

describe('the tie-break between an error-text reach and a normal reach does not depend on the order', () => {
    const K = uid(40)

    test('guard: a key in coldStoragedChats that is also another live chat\'s error text is listed when that character comes first', async () => {
        const BLOB = uid(41)
        await putBlob(BLOB, 'stub', [])
        const live = makeLiveCharacter('live', 'Live', [errorTextChat('chat-live', K)])
        const db = makeDb([live, makeStub('stub', 'Stub', BLOB, [K])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(unavailableKeys(result)).toContain(K)
    })

    test('guard: a key in coldStoragedChats that is also another live chat\'s error text is listed when the stub comes first', async () => {
        const BLOB = uid(42)
        await putBlob(BLOB, 'stub', [])
        const live = makeLiveCharacter('live', 'Live', [errorTextChat('chat-live', K)])
        const db = makeDb([makeStub('stub', 'Stub', BLOB, [K]), live])

        const result = await collectColdStorageBackupPayloads(db)

        expect(unavailableKeys(result)).toContain(K)
    })

    test('guard: a key mapped by plugin storage that is also a live chat\'s error text is listed', async () => {
        const live = makeLiveCharacter('live', 'Live', [errorTextChat('chat-live', K)])
        const db = makeDb([live], { someKey: K })

        const result = await collectColdStorageBackupPayloads(db)

        expect(unavailableKeys(result)).toContain(K)
    })

    test('a key named by error text in one blob and by a pointer in another blob is listed in either order', async () => {
        const BLOB_E = uid(43)
        const BLOB_P = uid(44)
        await putBlob(BLOB_E, 'e', [errorTextChat('inner-e', K)])
        await putBlob(BLOB_P, 'p', [pointerChat('inner-p', K)])
        const errorFirst = makeDb([makeStub('e', 'E', BLOB_E, []), makeStub('p', 'P', BLOB_P, [])])
        const pointerFirst = makeDb([makeStub('p', 'P', BLOB_P, []), makeStub('e', 'E', BLOB_E, [])])

        expect(unavailableKeys(await collectColdStorageBackupPayloads(errorFirst))).toContain(K)
        expect(unavailableKeys(await collectColdStorageBackupPayloads(pointerFirst))).toContain(K)
    })
})

describe('a key found inside an archive or named by error text that the restore could not place is never read or carried', () => {
    const NAME = '../x'

    test('guard: a non-UUID error-text key on a live chat is neither read nor carried and raises no prompt', async () => {
        putRawUnit(NAME, encoder.encode('would be carried by a naive follow'))
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [errorTextChat('chat-1', NAME)])])

        const result = await collectColdStorageBackupPayloads(db)
        await confirmIncompleteColdStorageOperation(db, unavailableKeys(result), 'backup')

        expect(readCount(NAME)).toBe(0)
        expect(carriedKeys(result)).not.toContain(NAME)
        expect(unavailableKeys(result)).toEqual([])
        expect(promptTexts()).toEqual([])
    })

    test('guard: a non-UUID error-text key inside a blob is neither read nor carried and raises no prompt', async () => {
        const BLOB = uid(50)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', NAME)])
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(readCount(NAME)).toBe(0)
        expect(carriedKeys(result)).not.toContain(NAME)
        expect(unavailableKeys(result)).toEqual([])
    })

    test('a non-UUID pointer key found inside a blob is neither read nor carried and is reported as unavailable', async () => {
        const BLOB = uid(51)
        await putBlob(BLOB, 'c1', [pointerChat('inner-1', NAME)])
        putRawUnit(NAME, encoder.encode('would be carried by a naive follow'))
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toContain(BLOB)
        expect(readCount(NAME)).toBe(0)
        expect(carriedKeys(result)).not.toContain(NAME)
        expect(unavailableKeys(result)).toContain(NAME)
    })
})

describe('plugin storage units are carried whatever their JSON value', () => {
    const UNSHAPED: [string, unknown][] = [
        ['an object', { a: 1 }],
        ['a string', 's'],
        ['the number zero', 0],
        ['a nonzero number', 7],
        ['null', null],
        ['false', false],
        ['an empty string', ''],
    ]

    test.each(UNSHAPED)('a plugin value that is %s is carried with its JSON bytes and raises no prompt', async (_label, value) => {
        const KEY = uid(60)
        expect(await setColdStorageItem(KEY, value)).toBe(true)
        const db = makeDb([], { stored: KEY })

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([KEY])
        expect(new TextDecoder().decode(payloadOf(result, KEY).encoded)).toBe(JSON.stringify(value))
        expect(unavailableKeys(result)).toEqual([])
    })

    test('guard: a plugin value that is an array is carried and raises no prompt', async () => {
        const KEY = uid(61)
        expect(await setColdStorageItem(KEY, [1])).toBe(true)
        const db = makeDb([], { stored: KEY })

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([KEY])
        expect(unavailableKeys(result)).toEqual([])
    })

    test('guard: a plugin mapping whose unit is absent is reported as unavailable', async () => {
        const KEY = uid(62)
        const db = makeDb([], { stored: KEY })

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([])
        expect(unavailableKeys(result)).toEqual([KEY])
    })

    test('guard: a plugin unit that holds a pointer-looking value is carried and not followed', async () => {
        const KEY = uid(63)
        const OTHER = uid(64)
        await putChatUnit(OTHER)
        expect(await setColdStorageItem(KEY, { message: [{ data: coldStorageHeader + OTHER }] })).toBe(true)
        const db = makeDb([], { stored: KEY })

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([KEY])
        expect(readCount(OTHER)).toBe(0)
    })
})

describe('a collected payload holds no parsed value and keeps the bytes it always had', () => {
    test('no payload has a value property', async () => {
        const BLOB = uid(70)
        const CHAT = uid(71)
        const PLUGIN = uid(72)
        await putChatUnit(CHAT)
        await putBlob(BLOB, 'c1', [])
        expect(await setColdStorageItem(PLUGIN, [1])).toBe(true)
        const db = makeDb([makeStub('c1', 'Alice', BLOB, []), makeLiveCharacter('c2', 'Bob', [pointerChat('chat-1', CHAT)])], { stored: PLUGIN })

        const result = await collectColdStorageBackupPayloads(db)

        expect(result.payloads.length).toBeGreaterThanOrEqual(3)
        for (const payload of result.payloads) {
            expect(Object.keys(payload)).not.toContain('value')
        }
    })

    test('guard: a chat unit and a character blob are carried as coldstorage_<key>.json with the UTF-8 JSON of the stored value', async () => {
        const BLOB = uid(73)
        const CHAT = uid(74)
        const chatValue = {
            message: [{ time: 1, data: 'non-ASCII: é中文 😀', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            scriptstate: {},
            localLore: [],
        }
        const blobValue = { character: { chaId: 'c1', name: 'Alice', type: 'character', chatPage: 0, chats: [] } }
        expect(await setColdStorageItem(CHAT, chatValue)).toBe(true)
        expect(await setColdStorageItem(BLOB, blobValue)).toBe(true)
        const db = makeDb([makeStub('c1', 'Alice', BLOB, []), makeLiveCharacter('c2', 'Bob', [pointerChat('chat-1', CHAT)])])

        const result = await collectColdStorageBackupPayloads(db)

        const chatPayload = payloadOf(result, CHAT)
        const blobPayload = payloadOf(result, BLOB)
        expect(chatPayload.backupName).toBe(`coldstorage_${CHAT}.json`)
        expect(blobPayload.backupName).toBe(`coldstorage_${BLOB}.json`)
        expect(Array.from(chatPayload.encoded)).toEqual(Array.from(encoder.encode(JSON.stringify(chatValue))))
        expect(Array.from(blobPayload.encoded)).toEqual(Array.from(encoder.encode(JSON.stringify(blobValue))))
    })
})

describe('a chat or character unit that reads is always carried however malformed its inner fields are', () => {
    const GOOD_P = uid(80)
    const GOOD_X = uid(81)

    async function seedGoodTargets(): Promise<void> {
        await putChatUnit(GOOD_P)
        await putChatUnit(GOOD_X)
    }

    test('guard: a blob whose chats hold malformed first messages is carried without an exception', async () => {
        const BLOB = uid(82)
        await putBlob(BLOB, 'c1', [
            makeChat('numeric', 5),
            makeChat('object', { x: 1 }),
            null,
            { id: 'no-message' },
            { id: 'empty-message', message: [] },
            { id: 'null-message', message: [null] },
        ])
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([BLOB])
        expect(unavailableKeys(result)).toEqual([])
    })

    test('the pointer and error-text chats beside malformed chats in a blob are still followed', async () => {
        const BLOB = uid(83)
        await seedGoodTargets()
        await putBlob(BLOB, 'c1', [
            makeChat('numeric', 5),
            makeChat('object', { x: 1 }),
            null,
            { id: 'no-message' },
            pointerChat('good-pointer', GOOD_P),
            errorTextChat('good-error', GOOD_X),
        ])
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toContain(BLOB)
        expect(carriedKeys(result)).toContain(GOOD_P)
        expect(carriedKeys(result)).toContain(GOOD_X)
    })

    const ODD_UNITS: [string, unknown][] = [
        ['a character with a null chats field', { character: { chats: null } }],
        ['a character with a string chats field', { character: { chats: 'not-an-array' } }],
        ['a null character', { character: null }],
        ['a chat unit with a string message field', { message: 'not-an-array' }],
        ['a chat unit whose first message is null', { message: [null] }],
        ['a chat unit whose first message has a numeric data field', { message: [{ data: 3 }] }],
        ['a legacy array of garbage elements', [null, 5, 'x']],
        ['an empty legacy array', []],
    ]

    test.each(ODD_UNITS)('guard: %s is carried without an exception', async (_label, value) => {
        const BLOB = uid(84)
        expect(await setColdStorageItem(BLOB, value)).toBe(true)
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([BLOB])
        expect(unavailableKeys(result)).toEqual([])
    })

    test('a chat unit whose first message has a numeric data field is carried and its siblings are still followed', async () => {
        const CHAT = uid(85)
        await seedGoodTargets()
        await putChatUnit(CHAT, 5)
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [
            pointerChat('chat-1', CHAT),
            pointerChat('chat-2', GOOD_P),
            errorTextChat('chat-3', GOOD_X),
        ])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toContain(CHAT)
        expect(carriedKeys(result)).toContain(GOOD_P)
        expect(carriedKeys(result)).toContain(GOOD_X)
    })
})

describe('listing the roots of the live database is total', () => {
    test('a live chat whose first message data is not a string is skipped beside a normal pointer chat', async () => {
        const P = uid(90)
        await putChatUnit(P)
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [
            makeChat('numeric', 5),
            makeChat('object', { x: 1 }),
            pointerChat('pointer', P),
        ])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([P])
        expect(unavailableKeys(result)).toEqual([])
    })
})

describe('a character whose name is not a string does not stop the collection', () => {
    const NON_STRING_NAMES: [string, unknown][] = [
        ['a number', 5],
        ['an object', { a: 1 }],
    ]

    /** A live character whose `name` field holds `name`, whatever its type. */
    function namedLive(name: unknown, chats: unknown[]): CharacterFixture {
        return { ...makeLiveCharacter('c1', 'unused', chats), name } as unknown as CharacterFixture
    }

    function namedStub(name: unknown, blobKey: string): CharacterFixture {
        return { ...makeStub('c1', 'unused', blobKey, []), name } as unknown as CharacterFixture
    }

    test.each(NON_STRING_NAMES)('guard: a live character named by %s carries the unit its pointer chat names', async (_label, name) => {
        const P = uid(100)
        await putChatUnit(P)
        const db = makeDb([namedLive(name, [pointerChat('chat-1', P)])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([P])
        expect(unavailableKeys(result)).toEqual([])
    })

    test.each(NON_STRING_NAMES)('guard: a stub named by %s carries its blob', async (_label, name) => {
        const BLOB = uid(101)
        await putBlob(BLOB, 'c1', [])
        const db = makeDb([namedStub(name, BLOB)])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([BLOB])
        expect(unavailableKeys(result)).toEqual([])
    })

    test.each(NON_STRING_NAMES)('a stub named by %s carries the unit its blob names', async (_label, name) => {
        const BLOB = uid(106)
        const P = uid(102)
        await putChatUnit(P)
        await putBlob(BLOB, 'c1', [pointerChat('inner-1', P)])
        const db = makeDb([namedStub(name, BLOB)])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result).sort()).toEqual([BLOB, P].sort())
        expect(unavailableKeys(result)).toEqual([])
    })

    test.each(NON_STRING_NAMES)('the incomplete-backup prompt is still shown when the unit of a character named by %s is absent', async (_label, name) => {
        const P = uid(103)
        const db = makeDb([namedLive(name, [pointerChat('chat-1', P)])])

        const result = await collectColdStorageBackupPayloads(db)
        const accepted = await confirmIncompleteColdStorageOperation(db, unavailableKeys(result), 'backup', result.owners)

        expect(unavailableKeys(result)).toEqual([P])
        expect(accepted).toBe(true)
        expect(promptTexts()).toHaveLength(1)
    })

    test.each(NON_STRING_NAMES)('the incomplete-backup prompt is still shown when the blob of a stub named by %s is absent', async (_label, name) => {
        const BLOB = uid(104)
        const db = makeDb([namedStub(name, BLOB)])

        const result = await collectColdStorageBackupPayloads(db)
        const accepted = await confirmIncompleteColdStorageOperation(db, unavailableKeys(result), 'backup', result.owners)

        expect(unavailableKeys(result)).toEqual([BLOB])
        expect(accepted).toBe(true)
        expect(promptTexts()).toHaveLength(1)
    })

    test('guard: a live character with a null name carries the unit its pointer chat names', async () => {
        const P = uid(105)
        await putChatUnit(P)
        const db = makeDb([namedLive(null, [pointerChat('chat-1', P)])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result)).toEqual([P])
        expect(unavailableKeys(result)).toEqual([])
    })
})

describe('an error-text key whose unit reads but is not chat or character shaped is reported', () => {
    const UNSHAPED_UNITS: [string, unknown][] = [
        ['an object', { a: 1 }],
        ['a string', 's'],
        ['the number zero', 0],
        ['null', null],
    ]

    test.each(UNSHAPED_UNITS)('a blob chat naming a unit that holds %s reports the key as invalid and names the character', async (_label, value) => {
        const BLOB = uid(110)
        const X = uid(111)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', X)])
        expect(await setColdStorageItem(X, value)).toBe(true)
        expect((await readColdStorageItem(X)).status).toBe('ok')
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)
        await confirmIncompleteColdStorageOperation(db, unavailableKeys(result), 'backup', result.owners)

        expect(result.invalidKeys).toContain(X)
        expect(carriedKeys(result)).not.toContain(X)
        expect(promptTexts()).toHaveLength(1)
        expect(promptTexts()[0]).toContain('Alice')
    })

    test.each(UNSHAPED_UNITS)('a live chat naming a unit that holds %s reports the key as invalid and names the character', async (_label, value) => {
        const X = uid(112)
        expect(await setColdStorageItem(X, value)).toBe(true)
        expect((await readColdStorageItem(X)).status).toBe('ok')
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [errorTextChat('chat-1', X)])])

        const result = await collectColdStorageBackupPayloads(db)
        await confirmIncompleteColdStorageOperation(db, unavailableKeys(result), 'backup', result.owners)

        expect(result.invalidKeys).toContain(X)
        expect(carriedKeys(result)).not.toContain(X)
        expect(promptTexts()).toHaveLength(1)
        expect(promptTexts()[0]).toContain('Alice')
    })

    test('an error-text key whose unit is absent is still left out without a prompt beside an unshaped one', async () => {
        const BLOB = uid(113)
        const ABSENT = uid(114)
        const UNSHAPED = uid(115)
        await putBlob(BLOB, 'c1', [errorTextChat('inner-1', ABSENT), errorTextChat('inner-2', UNSHAPED)])
        expect(await setColdStorageItem(UNSHAPED, { a: 1 })).toBe(true)
        const db = makeDb([makeStub('c1', 'Alice', BLOB, [])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(unavailableKeys(result)).toEqual([UNSHAPED])
    })
})

describe('a legacy bare-array unit reached by a pointer is searched for references', () => {
    test('a unit that is an array of messages whose first message holds the legacy error text carries the unit it names', async () => {
        const LEGACY = uid(120)
        const Y = uid(121)
        await putChatUnit(Y)
        expect(await setColdStorageItem(LEGACY, [
            { time: 1, data: formatColdStorageLoadError(Y), role: 'char' },
            { time: 2, data: 'a later message', role: 'user' },
        ])).toBe(true)
        const db = makeDb([makeLiveCharacter('c1', 'Alice', [pointerChat('chat-1', LEGACY)])])

        const result = await collectColdStorageBackupPayloads(db)

        expect(carriedKeys(result).sort()).toEqual([LEGACY, Y].sort())
        expect(unavailableKeys(result)).toEqual([])
    })
})
