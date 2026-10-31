// CHORE-478 S1c: the cold-storage collection a `.bin` export runs carries no chat alternatives.
//
// `collectColdStorageBackupPayloads` runs for real over the real `setColdStorageItem` / `readColdStorageItem`; only the
// page's byte store underneath is a stand-in. A passing test here says nothing about the real IndexedDB, Tauri or Node
// stores.
//
// Titles: `reproducer` fails on the code before the strip existed; `guard` passes before and after and pins what must not
// move.
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

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
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

//#region fixtures

const decoder = new TextDecoder()

function uid(n: number): string {
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

function makeDb(characters: unknown[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: [],
        characters,
        coldstorage: false,
    } as unknown as Database
}

function stub(chaId: string, name: string, key: string): unknown {
    return { chaId, name, type: 'character', chatPage: 0, coldstorage: key, chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }] }
}

function chatWith(name: string, alt?: unknown): Record<string, unknown> {
    return {
        id: `id-${name}`,
        name,
        message: [{ time: 1, data: `${name} message`, role: 'char' }],
        note: '',
        localLore: [],
        ...(alt === undefined ? {} : { alt }),
    }
}

const ALTERNATIVE = [{ m: { time: 2, data: 'ALTERNATIVE-REPLY-MARK', role: 'char' }, p: null, a: 1 }]

function parsedPayload(result: Awaited<ReturnType<typeof collectColdStorageBackupPayloads>>, key: string): Record<string, unknown> {
    const found = result.payloads.find((payload) => payload.key === key)
    if (!found) {
        throw new Error(`key ${key} was not carried`)
    }
    return JSON.parse(decoder.decode(found.encoded)) as Record<string, unknown>
}

//#endregion

beforeEach(() => {
    platformState.isTauri = false
    opfsStore.clear()
    unitStore.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the cold-storage payloads of a .bin export carry no chat alternatives', () => {
    test('reproducer: an archived character unit is carried without the alt of its chats, and the chats are named', async () => {
        const KEY = uid(1)
        await setColdStorageItem(KEY, { character: { chaId: 'c1', name: 'Alice', type: 'character', chatPage: 0, chats: [chatWith('First', ALTERNATIVE), chatWith('Second')] } })

        const result = await collectColdStorageBackupPayloads(makeDb([stub('c1', 'Alice', KEY)]))

        const chats = (parsedPayload(result, KEY).character as { chats: Record<string, unknown>[] }).chats
        expect(chats).toHaveLength(2)
        expect(chats.every((chat) => !('alt' in chat))).toBe(true)
        expect(chats[0].message).toEqual([{ time: 1, data: 'First message', role: 'char' }])
        expect(new TextDecoder().decode(result.payloads[0].encoded)).not.toContain('ALTERNATIVE-REPLY-MARK')
        expect(result.omittedAlternatives).toEqual(['Alice / First'])
    })

    test('reproducer: a chat unit that holds alt is carried without it', async () => {
        const KEY = uid(2)
        await setColdStorageItem(KEY, { message: [{ time: 1, data: 'archived', role: 'user' }], name: 'Loose', alt: ALTERNATIVE })

        const result = await collectColdStorageBackupPayloads(makeDb([stub('c1', 'Alice', KEY)]))

        const unit = parsedPayload(result, KEY)
        expect('alt' in unit).toBe(false)
        expect(unit.message).toEqual([{ time: 1, data: 'archived', role: 'user' }])
        expect(result.omittedAlternatives).toEqual(['Unknown Character / Loose'])
    })

    test('reproducer: the stored value is not changed by the strip', async () => {
        const KEY = uid(3)
        await setColdStorageItem(KEY, { character: { chaId: 'c1', name: 'Alice', type: 'character', chatPage: 0, chats: [chatWith('First', ALTERNATIVE)] } })
        const before = await readColdStorageItem(KEY)

        await collectColdStorageBackupPayloads(makeDb([stub('c1', 'Alice', KEY)]))

        const after = await readColdStorageItem(KEY)
        expect(after).toEqual(before)
        expect(JSON.stringify(after)).toContain('ALTERNATIVE-REPLY-MARK')
    })

    test('guard: a unit with no alt is carried as before and the collection names no omitted alternatives', async () => {
        const KEY = uid(4)
        const original = { character: { chaId: 'c1', name: 'Alice', type: 'character', chatPage: 0, chats: [chatWith('First'), chatWith('Second')] } }
        await setColdStorageItem(KEY, original)

        const result = await collectColdStorageBackupPayloads(makeDb([stub('c1', 'Alice', KEY)]))

        expect('omittedAlternatives' in result).toBe(false)
        expect(parsedPayload(result, KEY)).toEqual(original)
    })

    test('reproducer: an empty alt list is removed too, without naming the chat', async () => {
        const KEY = uid(5)
        await setColdStorageItem(KEY, { character: { chaId: 'c1', name: 'Alice', type: 'character', chatPage: 0, chats: [chatWith('First', [])] } })

        const result = await collectColdStorageBackupPayloads(makeDb([stub('c1', 'Alice', KEY)]))

        expect('alt' in (parsedPayload(result, KEY).character as { chats: Record<string, unknown>[] }).chats[0]).toBe(false)
        expect('omittedAlternatives' in result).toBe(false)
    })
})
