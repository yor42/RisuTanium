/**
 * Compatibility guards: a character the one-character archive wrote is read as the upstream application reads an
 * archived character, and the local backup carries its unit.
 *
 * The engine, `buildColdStub`, the real `setColdStorageItem` / `readColdStorageItem` and
 * `collectColdStorageBackupPayloads` run together; only the page's byte store underneath is a stand-in. The
 * upstream reader below is a MODEL written from what upstream's stub handling does (a slot is a stub when
 * `coldstorage` is truthy; opening it replaces the slot with the unit's character when the `chaId`s agree), not
 * upstream code. Every test here passes with or without later changes to the engine's internals: they pin the shape.
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
    readColdStorageItem,
    collectColdStorageBackupPayloads,
    setColdStorageItem,
} from '../coldstorage.svelte'
import { archiveCharacterNow } from '../coldCharacterArchive'
import { DBState } from 'src/ts/stores.svelte'
import { noteBootArchiveSession, resetBootArchiveStateForTest } from '../memory/bootArchiveState'
import { resetRetainedForTest } from '../coldRetained'
import { resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { character } from 'src/ts/storage/database.svelte'

function fullCharacter(chaId: string): character {
    return {
        type: 'character',
        name: 'Alice',
        image: 'assets/alice.png',
        chaId,
        chatPage: 0,
        creatorNotes: 'A short note',
        tags: ['a'],
        creator: 'Top',
        chats: [{ id: 'c1', name: 'One', note: '', localLore: [], message: [{ role: 'user', data: 'hello', time: 1 }] }],
        globalLore: [],
    } as unknown as character
}

/** Model: opening a stub replaces the slot wholesale with the unit's character when the `chaId`s agree. */
async function upstreamOpen(slot: character): Promise<character | 'restore-failed'> {
    if (!slot.coldstorage) {
        return slot
    }
    const read = await readColdStorageItem(slot.coldstorage)
    const unit = read.status === 'ok' ? (read.value as { character?: character }) : undefined
    return unit?.character && unit.character.chaId === slot.chaId ? unit.character : 'restore-failed'
}

beforeEach(() => {
    unitStore.clear()
    unitReadLog.length = 0
    resetRetainedForTest()
    resetCharacterSaveMarksForTest()
    resetBootArchiveStateForTest()
    noteBootArchiveSession(true)
    DBState.db = { formatversion: 5, archiveCharacters: true, plugins: [], characters: [], pluginCustomStorage: {} } as unknown as Database
})

describe('a character the one-character archive wrote', () => {
    test('guard: upstream sees a stub, opens it from the unit and gets the full character back', async () => {
        const original = fullCharacter('cha-alice')
        const before = JSON.stringify(original)

        const result = await archiveCharacterNow({ kind: 'new', character: original })
        expect(result.ok).toBe(true)
        if (result.ok === false) {
            return
        }
        const stub = DBState.db.characters[result.index] as unknown as character

        expect(stub.coldstorage).toBeTruthy()
        expect(stub.chaId).toBe('cha-alice')
        expect(stub.name).toBe('Alice')
        expect(stub.coldStoragedChats).toEqual([])
        const opened = await upstreamOpen(stub)
        expect(opened).not.toBe('restore-failed')
        expect(JSON.stringify(opened)).toBe(before)
    })

    test('guard: the local backup carries the unit the stub points at, with nothing missing', async () => {
        const result = await archiveCharacterNow({ kind: 'new', character: fullCharacter('cha-alice') })
        expect(result.ok).toBe(true)
        if (result.ok === false) {
            return
        }
        const stub = DBState.db.characters[result.index] as unknown as character

        const collected = await collectColdStorageBackupPayloads(DBState.db)

        expect(collected.missingKeys).toEqual([])
        expect(collected.invalidKeys).toEqual([])
        expect(collected.payloads.map((payload) => payload.key)).toContain(stub.coldstorage)
    })
})

describe('a loaded character the engine archived again', () => {
    /** A character that is in the list as a full object, as a restored or never archived one is. */
    function loadedCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
        const cha = { ...fullCharacter(chaId), ...extra } as character
        DBState.db.characters.push(cha)
        return DBState.db.characters[DBState.db.characters.length - 1] as unknown as character
    }

    test('guard: after an edit and a trash-then-untrash, upstream opens the stub as the edited character without trashTime, and lists it from the stub', async () => {
        const live = loadedCharacter('cha-alice')
        live.name = 'Alice edited'
        live.creatorNotes = 'An edited note'
        live.chats.push({ id: 'c2', name: 'Two', note: '', localLore: [], message: [{ role: 'user', data: 'again', time: 2 }] } as never)
        live.trashTime = 1234
        delete live.trashTime
        const edited = JSON.parse(JSON.stringify(live)) as character

        const result = await archiveCharacterNow({ kind: 'loaded', character: live, previousUnitKey: 'older-unit' })

        expect(result.ok).toBe(true)
        const stub = DBState.db.characters[0] as unknown as character
        expect(stub.coldstorage).toBeTruthy()
        expect(stub.trashTime).toBeUndefined()
        expect(stub.name).toBe('Alice edited')
        expect(stub.image).toBe('assets/alice.png')
        expect(stub.creatorNotes).toBe('An edited note')
        expect(stub.coldChatCount).toBe(2)
        expect(stub.chats[0].message[0].data).toBe('')
        const opened = await upstreamOpen(stub)
        expect(opened).not.toBe('restore-failed')
        expect(opened).toEqual(edited)
        expect((opened as character).trashTime).toBeUndefined()
    })

    test('guard: a trashed character keeps its trash state on the stub only and the unit never holds trashTime; catches writing the live object instead of coldUnitCharacter(live)', async () => {
        const live = loadedCharacter('cha-alice', { trashTime: Date.now() })

        const result = await archiveCharacterNow({ kind: 'loaded', character: live })

        expect(result.ok).toBe(true)
        const stub = DBState.db.characters[0] as unknown as character
        expect(stub.trashTime).toBeGreaterThan(0)
        const opened = await upstreamOpen(stub) as character
        expect(opened.trashTime).toBeUndefined()
    })

    test('guard (MC-175, MC-223): the export carries the new unit and not the superseded one, and a fork import of that export restores the edited character', async () => {
        const first = await archiveCharacterNow({ kind: 'new', character: fullCharacter('cha-alice') })
        expect(first.ok).toBe(true)
        if (first.ok === false) {
            return
        }
        const oldKey = (DBState.db.characters[first.index] as unknown as character).coldstorage as string
        // The user opens it: the slot now holds the unit's full character, which is then edited.
        const restored = await upstreamOpen(DBState.db.characters[first.index] as unknown as character) as character
        DBState.db.characters[first.index] = restored as never
        const live = DBState.db.characters[first.index] as unknown as character
        live.name = 'Alice edited'

        const second = await archiveCharacterNow({ kind: 'loaded', character: live, previousUnitKey: oldKey })

        expect(second.ok).toBe(true)
        if (second.ok === false) {
            return
        }
        expect(second.unitKey).not.toBe(oldKey)
        const stub = DBState.db.characters[second.index] as unknown as character
        const collected = await collectColdStorageBackupPayloads(DBState.db)
        expect(collected.missingKeys).toEqual([])
        expect(collected.payloads.map((payload) => payload.key)).toContain(stub.coldstorage)
        expect(collected.payloads.map((payload) => payload.key)).not.toContain(oldKey)

        // A fork import writes each payload's unit back before the stub is opened.
        unitStore.clear()
        for (const payload of collected.payloads) {
            expect(await setColdStorageItem(payload.key, JSON.parse(new TextDecoder().decode(payload.encoded)))).toBe(true)
        }
        const opened = await upstreamOpen(stub) as character
        expect(opened.name).toBe('Alice edited')
    })
})
