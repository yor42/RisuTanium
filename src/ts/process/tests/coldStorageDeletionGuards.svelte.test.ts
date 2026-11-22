/**
 * CHORE-07 stage 7a step 2 -- "stop deleting" tests.
 * Agents/Reports/13-chore07-cold-read-failure-plan.md.
 *
 * These tests pin that a cold-storage read failure or an ambiguous read never
 * costs a live character or chat its data: the backup collector keeps the unit
 * a chat's legacy error text names, and `preLoadChat` and
 * `retryLegacyColdChatLoad` leave a chat untouched on a failed or unusable read.
 * A blob that was never written or a read that throws must be treated as
 * "keep, don't delete" -- never as proof that the underlying data is gone.
 *
 * Tests and assertions marked CHAR are compatibility guards: they hold
 * regardless of that failure handling.
 *
 * This file drives the REAL seams, not a replica:
 *   - `getColdStorageItem` / `setColdStorageItem` / `preLoadChat` /
 *     `collectColdStorageBackupPayloads` from
 *     `src/ts/process/coldstorage.svelte.ts` (real, unmocked).
 * Every other module reachable from those is mocked below. Only the
 * STORAGE BACKEND underneath `getColdStorageItem` is faked (Tauri
 * `@tauri-apps/plugin-fs` under the real desktop store, and the key/value
 * store behind `forageStorage` as the web page store, beside a
 * `navigator.storage` stand-in that fails if it is ever called) --
 * `getColdStorageItem` itself is never mocked directly, so a read failure
 * has to go through its own real try/catch-swallows-errors path, exactly as
 * it does in production.
 *
 * Mock sets are reused, one-for-one, from the two harnesses this plan
 * cites: `Agents/Tools/save-gen/asset-gc-cold-read-repro.svelte.harness.ts`
 * (the asset-sweep group, a1/a3/a4/a5) and
 * `Agents/Tools/save-gen/cold-storage-orphan-repro.svelte.harness.ts` (the
 * cold-storage-cleanup group, of which a9 remains). Per
 * Agents/Tools/README.md's "keep every rune-touching mock in ONE file",
 * both harnesses' mocks live together here.
 *
 * PLATFORM TOGGLE: unlike either harness (each fixes `isTauri` for its
 * whole file), this file needs BOTH the Tauri backend (a1/a3/a4/a5)
 * and the web backend (a9 and the `preLoadChat` groups) in the same run.
 * `src/ts/platform` is mocked with a GETTER backed by a `vi.hoisted` mutable
 * flag (`platformState.isTauri`), so `getColdStorageItem`'s live `isTauri`
 * read (it re-reads the imported binding on every call, it does not cache
 * it) observes whichever value each test sets before running. Verified in
 * isolation before writing this file: a throwaway two-test scratch file
 * confirmed a consumer module that imports `isTauri` once at its own
 * top-level, then reads it inside a function body, does see a
 * `platformState.isTauri` mutation made after that import -- both tests
 * passed. The scratch file was deleted; this comment is the record of
 * that check.
 *
 * a9 and the `preLoadChat` groups need the web backend, because
 * `preLoadChat` reads `DBState.db` directly (no injected `db` seam exists
 * for them yet), so this file switches `platformState.isTauri` to `false`
 * for that whole group.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'

//#region module mocks -- one-for-one copy of both harnesses' mock sets,
// merged. See file header for why each group is mocked vs. left real.

const platformState = vi.hoisted(() => ({ isTauri: true }))

// The key/value store behind `forageStorage`: the committed main file that
// units are stored in on the web build.
const forageMem = vi.hoisted(() => new Map<string, Uint8Array>())
// Hooks on the reads of that key/value store: a key that fails once, and a
// callback run before every read.
const storeHooks = vi.hoisted(() => ({ throwOnce: new Set<string>(), onRead: null as null | ((key: string) => void) }))

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

// Constructed directly in the factory (no cross-file dynamic import) --
// splitting this across files reproduces the documented "split vi.mock
// factory" trap.
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

// CHORE-07 stage 7c-2: `retryLegacyColdChatLoad` (coldstorage.svelte.ts)
// reads the real `doingChat` store from `index.svelte.ts` for its busy
// check. `index.svelte.ts` itself pulls in a huge, separately-mocked import
// graph (tokenizer, scripts, request/request, memory/*, etc.) that this
// file has no reason to load for real -- it never drives `sendChat` here
// (`sendChatColdGuard.svelte.test.ts` does that) -- so the whole module is
// replaced with just the one export this file's tests control directly.
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

// `write_durable` puts the whole body at the key in one step, as the Rust command does when it succeeds.
vi.mock('@tauri-apps/api/core', async () => {
    const { createDurableInvoke } = await import('src/ts/storage/tests/tauriFsFake')
    return {
        convertFileSrc: vi.fn((p: string) => p),
        invoke: createDurableInvoke((key, data) => { fsStore.set(key, data) }),
    }
})

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
        async getItem(key: string) {
            storeHooks.onRead?.(key)
            if (storeHooks.throwOnce.delete(key)) {
                throw new Error(`simulated transient store read failure for ${key}`)
            }
            return forageMem.get(key) ?? null
        }
        async setItem(key: string, value: Uint8Array) { forageMem.set(key, value) }
        async keys() { return Array.from(forageMem.keys()) }
        async removeItem(key: string) { forageMem.delete(key) }
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

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

//#endregion

//#region Tauri fs backend mock (asset files under assets/, cold blobs under
// coldstorage/<key>.json) -- copied from asset-gc-cold-read-repro.

type FsEntry = { name: string; isFile: boolean; isDirectory: boolean }

const fsStore = new Map<string, Uint8Array>()
const throwOnceReadPaths = new Set<string>()

function normalizePath(path: string): string {
    return path.replace(/^\.\//, '').replace(/\\/g, '/')
}

function armTransientTauriReadFailure(coldKey: string): void {
    throwOnceReadPaths.add(normalizePath('./coldstorage/' + coldKey + '.json'))
}

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: vi.fn(async (dir: string) => {
        const prefix = normalizePath(dir).replace(/\/$/, '') + '/'
        const names = new Set<string>()
        for (const key of fsStore.keys()) {
            if (key.startsWith(prefix)) {
                const rest = key.slice(prefix.length)
                if (!rest.includes('/')) {
                    names.add(rest)
                }
            }
        }
        const entries: FsEntry[] = Array.from(names).map((name) => ({ name, isFile: true, isDirectory: false }))
        return entries
    }),
    readFile: vi.fn(async (path: string) => {
        const p = normalizePath(path)
        if (throwOnceReadPaths.has(p)) {
            throwOnceReadPaths.delete(p)
            throw new Error(`simulated transient Tauri fs read failure for ${p}`)
        }
        if (!fsStore.has(p)) {
            throw new Error(`ENOENT (mock): ${p} (os error 2)`)
        }
        return fsStore.get(p)!
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
        fsStore.set(normalizePath(path), data)
    }),
    remove: vi.fn(async (path: string) => {
        const p = normalizePath(path)
        if (!fsStore.has(p)) {
            throw new Error(`ENOENT (mock, remove): ${p}`)
        }
        fsStore.delete(p)
    }),
    exists: vi.fn(async (path: string) => fsStore.has(normalizePath(path))),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async (from: string, to: string) => {
        const source = normalizePath(from)
        const bytes = fsStore.get(source)
        if (!bytes) {
            throw new Error(`ENOENT (mock, rename): ${source} (os error 2)`)
        }
        fsStore.set(normalizePath(to), bytes)
        fsStore.delete(source)
    }),
}))

function seedTauriAssets(): void {
    fsStore.set('assets/main-image.png', new TextEncoder().encode('main-image-bytes'))
    fsStore.set('assets/emotion-happy.png', new TextEncoder().encode('emotion-happy-bytes'))
    fsStore.set('assets/emotion-sad.png', new TextEncoder().encode('emotion-sad-bytes'))
    fsStore.set('assets/additional-bg.png', new TextEncoder().encode('additional-bg-bytes'))
}

function resetTauriFs(): void {
    fsStore.clear()
    throwOnceReadPaths.clear()
    seedTauriAssets()
}

function tauriFsHas(path: string): boolean {
    return fsStore.has(normalizePath(path))
}

//#endregion

//#region web unit storage: the key/value store behind `forageStorage` (page
// store, `coldstorage/<key>`) and a `navigator.storage` stand-in that must stay uncalled.

/** The next read of unit `key` from the web page store fails once. */
function armTransientStoreFailure(key: string): void {
    storeHooks.throwOnce.add('coldstorage/' + key)
}

// A cold unit is never read from or deleted in the browser's private file system: any call
// to `getDirectory` here is a regression.
const getDirectoryMock = vi.fn(async () => {
    throw new Error('the browser private file system must not be touched')
})

Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: getDirectoryMock,
    },
})

function resetColdUnits(): void {
    getDirectoryMock.mockClear()
    storeHooks.throwOnce.clear()
    storeHooks.onRead = null
    for (const key of Array.from(forageMem.keys())) {
        if (key.startsWith('coldstorage/')) {
            forageMem.delete(key)
        }
    }
}

//#endregion

import { forageStorage } from '../../globalApi.svelte'
import { injectAppStore } from '../../storage/store/appStore'
import { createTauriFilesStore } from '../../storage/store/tauriFilesStore'
import { createForageBackedStore, createSwitchedStore, type ForageLike } from '../../storage/tests/forageBackedStore'
import {
    setColdStorageItem,
    preLoadChat,
    collectColdStorageBackupPayloads,
    coldStorageHeader,
    readColdStorageItem,
    retryLegacyColdChatLoad,
} from '../coldstorage.svelte'
import { isColdChat, formatColdStorageLoadError, mergeRetriedColdChatSideFields } from '../coldstorageData'
import type { RetryLegacyColdChatSideFields } from '../coldstorageData'
import { doingChat as doingChatStore } from '../index.svelte'
import { registerWork } from '../chatOrigin'
import { readFile as tauriReadFile, exists as tauriExists } from '@tauri-apps/plugin-fs'
import { DBState, selectedCharID } from '../../stores.svelte'
import type { Writable } from 'svelte/store'
const doingChat = doingChatStore as Writable<boolean>

// Units are read and written through the page's byte store: the key/value model
// behind `forageStorage` on the web build, the desktop store over the file model
// on Tauri. Which one applies is the platform of each test.
const webByteStore = createForageBackedStore(forageStorage as unknown as ForageLike)
const tauriByteStore = createTauriFilesStore({ platform: 'posix' })
beforeEach(() => {
    injectAppStore(createSwitchedStore(() => platformState.isTauri ? tauriByteStore : webByteStore))
})

//#region shared fixture helpers

type CharacterFixture = Database['characters'][number]

function makeFullCharacter(chaId: string): CharacterFixture {
    return {
        chaId,
        name: 'Full Character',
        type: 'character',
        chatPage: 0,
        image: 'assets/main-image.png',
        emotionImages: [
            ['happy', 'assets/emotion-happy.png'],
            ['sad', 'assets/emotion-sad.png'],
        ],
        additionalAssets: [
            ['bg', 'assets/additional-bg.png', ''],
        ],
        chats: [],
    } as unknown as CharacterFixture
}

/** A cold-storage stub as a character is replaced by it in the list -- keeps
 * only `image`, not emotionImages/additionalAssets. */
function makeColdStub(chaId: string, coldKey: string): CharacterFixture {
    return {
        chaId,
        name: 'Full Character',
        type: 'character',
        chatPage: 0,
        image: 'assets/main-image.png',
        coldstorage: coldKey,
        chats: [{
            message: [{ time: Date.now(), data: '', role: 'char' }],
            note: '',
            name: '',
            localLore: [],
        }],
    } as unknown as CharacterFixture
}

function makeDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        coldstorage: false,
    } as unknown as Database
}

function makeColdChat(id: string, coldKey: string) {
    return {
        id,
        message: [{ time: 1_690_000_000_000, data: coldStorageHeader + coldKey, role: 'char' }],
        note: '',
        name: '',
        localLore: [],
    }
}

function makeErrorTextChat(id: string, coldKey: string) {
    return {
        id,
        message: [{ time: 1, data: `[Cold storage data could not be loaded. Key: ${coldKey}]`, role: 'char' }],
        note: '',
        name: '',
        localLore: [],
    }
}

/** A single-character db holding exactly one chat, for the
 * `retryLegacyColdChatLoad` group below. */
function makeRetryDb(chaId: string, chat: unknown): Database {
    return makeDb([{
        chaId,
        name: 'Retry Character',
        type: 'character',
        chatPage: 0,
        chats: [chat],
    } as unknown as CharacterFixture])
}

//#endregion

describe('CHORE-07 stage 7a: the backup collector keeps the units that cold-storage text names', () => {
    test("a9: collectColdStorageBackupPayloads carries the unit a live chat's legacy error text names", async () => {
        platformState.isTauri = false
        resetColdUnits()

        // Real unit ids are UUIDs, the only names a restore places.
        const REAL_KEY = '00000000-0000-4000-8000-0000000000a1'
        await setColdStorageItem(REAL_KEY, { message: [{ time: 1, data: 'kept', role: 'user' }] })
        const ERROR_KEY = '00000000-0000-4000-8000-0000000000a2'
        await setColdStorageItem(ERROR_KEY, { message: [{ time: 1, data: 'still referenced by the visible error text', role: 'user' }] })

        const db = makeDb([{
            chaId: 'a9-char',
            name: 'A9 Character',
            type: 'character',
            chatPage: 0,
            chats: [
                makeColdChat('a9-chat-0', REAL_KEY),
                makeErrorTextChat('a9-chat-1', ERROR_KEY),
            ],
        } as unknown as CharacterFixture])

        const { payloads, missingKeys, invalidKeys } = await collectColdStorageBackupPayloads(db)
        const allSeenKeys = new Set([...payloads.map((p) => p.key), ...missingKeys, ...invalidKeys])

        // A chat whose message[0] holds the legacy error text still refers to
        // ERROR_KEY's unit, so the backup carries it beside the pointer's unit.
        expect(payloads.map((p) => p.key)).toContain(ERROR_KEY)
        expect(payloads.map((p) => p.key)).toContain(REAL_KEY)
        expect(allSeenKeys.size).toBe(2)
        expect(missingKeys).toEqual([])
        expect(invalidKeys).toEqual([])
    })
})

/**
 * CHORE-07 stage 7b -- "preLoadChat must never destroy data on a failed or
 * unusable read, and must never reject". Agents/Reports/13-chore07-cold-read-failure-plan.md.
 *
 * On a falsy, invalid or unreadable cold-storage read, `preLoadChat` must
 * leave `chat.message` and every side field (`hypaV2Data`, `hypaV3Data`,
 * `scriptstate`, `localLore`, `lastDate`) completely untouched and resolve a
 * status ('error' or 'none', as covered below) instead of overwriting them
 * with `formatColdStorageLoadError(key)`. C1/C2 pin only the message/
 * side-field restore behaviour on a successful read; they do not assert on
 * `preLoadChat`'s return value.
 */
describe('CHORE-07 stage 7b: preLoadChat must not reject and must not mutate a chat on a failed/invalid read', () => {
    // CHORE-07 stage 7c-1 added a character-switch race check to
    // `preLoadChat`: after the read, it now also requires
    // that `get(selectedCharID)` still points at a character whose `chaId`
    // matches the character being loaded, else it returns 'none' with no
    // mutation. Every fixture in this describe block loads character index
    // 0 and expects the pre-existing (pointer-only) race check to be the
    // only thing gating the mutation, so `selectedCharID` must be pointed at
    // that same character here for those assertions to still hold.
    beforeEach(() => {
        selectedCharID.set(0)
    })
    afterEach(() => {
        selectedCharID.set(-1)
    })

    test('R1: a transient store read failure leaves the chat untouched and resolves "error"', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'r1-cold-key'
        await setColdStorageItem(coldKey, {
            message: [{ time: 1, data: 'archived', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })

        DBState.db = makeDb([{
            chaId: 'r1-char',
            name: 'R1 Character',
            type: 'character',
            chatPage: 0,
            chats: [makeColdChat('r1-chat-0', coldKey)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as {
            message: { data: string }[]
            hypaV2Data?: unknown
            hypaV3Data?: unknown
            scriptstate?: unknown
            localLore?: unknown
            lastDate?: number
        }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))
        const hypaV2Before = chat.hypaV2Data
        const hypaV3Before = chat.hypaV3Data
        const scriptstateBefore = chat.scriptstate
        const localLoreBefore = chat.localLore
        const lastDateBefore = chat.lastDate

        armTransientStoreFailure(coldKey)
        const result = await preLoadChat(0, 0)

        // A transient store read failure must resolve 'error' without ever
        // overwriting `chat.message` with the error text.
        expect(result).toBe('error')
        expect(chat.message).toEqual(messageBefore)
        expect(chat.hypaV2Data).toBe(hypaV2Before)
        expect(chat.hypaV3Data).toBe(hypaV3Before)
        expect(chat.scriptstate).toBe(scriptstateBefore)
        expect(chat.localLore).toBe(localLoreBefore)
        expect(chat.lastDate).toBe(lastDateBefore)
    })

    test('R2a: a blob shaped {message: string} resolves "damaged" with no mutation', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'r2a-string-message-key'
        await setColdStorageItem(coldKey, { message: 'not-an-array' })

        DBState.db = makeDb([{
            chaId: 'r2a-char',
            name: 'R2a Character',
            type: 'character',
            chatPage: 0,
            chats: [makeColdChat('r2a-chat-0', coldKey)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const result = await preLoadChat(0, 0)

        expect(result).toBe('damaged')
        expect(chat.message).toEqual(messageBefore)
    })

    test('R2b: a blob shaped {character: {...}} (no message array) resolves "damaged" with no mutation', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'r2b-character-only-key'
        await setColdStorageItem(coldKey, {
            character: { chaId: 'r2b-someone', name: 'r2b', type: 'character', chatPage: 0, chats: [] },
        })

        DBState.db = makeDb([{
            chaId: 'r2b-char',
            name: 'R2b Character',
            type: 'character',
            chatPage: 0,
            chats: [makeColdChat('r2b-chat-0', coldKey)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const result = await preLoadChat(0, 0)

        expect(result).toBe('damaged')
        expect(chat.message).toEqual(messageBefore)
    })

    test('R4: a pointer replaced during the read is left as the newer value, resolving "none"', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'r4-cold-key'
        await setColdStorageItem(coldKey, {
            message: [{ time: 1, data: 'archived', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })

        DBState.db = makeDb([{
            chaId: 'r4-char',
            name: 'R4 Character',
            type: 'character',
            chatPage: 0,
            chats: [makeColdChat('r4-chat-0', coldKey)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { time: number, data: string, role: string }[] }

        const resultPromise = preLoadChat(0, 0)
        // Synchronously, before any microtask from the read runs, the chat
        // pointer was replaced -- e.g. the user switched away and a new
        // chat/message took over message[0].
        chat.message = [{ time: 999, data: 'a brand new user message', role: 'user' }]

        const result = await resultPromise

        // If the chat pointer is replaced before the read resolves, the
        // read's result must not overwrite `chat.message` again -- the
        // replacement must be left as the newer value.
        expect(result).toBe('none')
        expect(chat.message).toEqual([{ time: 999, data: 'a brand new user message', role: 'user' }])
    })

    test('R5: a message pushed during the read is preserved after the restored messages', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'r5-cold-key'
        await setColdStorageItem(coldKey, {
            message: [{ time: 1, data: 'archived', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })

        DBState.db = makeDb([{
            chaId: 'r5-char',
            name: 'R5 Character',
            type: 'character',
            chatPage: 0,
            chats: [makeColdChat('r5-chat-0', coldKey)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { time: number, data: string, role: string }[] }

        const resultPromise = preLoadChat(0, 0)
        // Synchronously, before the read settles, the user (or a
        // trigger/plugin) appended a message into this still-pointer chat.
        chat.message.push({ time: 2, data: 'sent while still loading', role: 'user' })

        const result = await resultPromise

        // A message pushed while the read is still pending must be
        // preserved after the restored messages -- the restore must not
        // replace `chat.message` wholesale and lose it.
        expect(result).toBe('ok')
        expect(chat.message).toEqual([
            { time: 1, data: 'archived', role: 'user' },
            { time: 2, data: 'sent while still loading', role: 'user' },
        ])
    })

    test('C1 CHAR: a legacy array cold blob restores messages only, leaving side fields untouched', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'c1-cold-key'
        const legacyMessages = [{ time: 1, data: 'legacy restored message', role: 'user' }]
        await setColdStorageItem(coldKey, legacyMessages)

        DBState.db = makeDb([{
            chaId: 'c1-char',
            name: 'C1 Character',
            type: 'character',
            chatPage: 0,
            chats: [{
                ...makeColdChat('c1-chat-0', coldKey),
                hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            }],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as {
            message: unknown[]
            hypaV2Data: unknown
            lastDate?: number
        }
        const hypaV2Before = chat.hypaV2Data

        await preLoadChat(0, 0)

        // CHAR: unchanged before and after the fix -- a legacy array blob
        // has always replaced only `chat.message` (plus `lastDate`), never
        // touching hypaV2Data/hypaV3Data/scriptstate/localLore.
        expect(chat.message).toEqual(legacyMessages)
        expect(chat.hypaV2Data).toBe(hypaV2Before)
        expect(typeof chat.lastDate).toBe('number')
    })

    test('C2 CHAR: an object cold blob restores messages and every side field', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'c2-cold-key'
        const payload = {
            message: [{ time: 1, data: 'restored', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 5 },
            hypaV3Data: { summaries: ['s'] },
            scriptstate: { flag: true },
            localLore: [{ key: 'k', value: 'v' }],
        }
        await setColdStorageItem(coldKey, payload)

        DBState.db = makeDb([{
            chaId: 'c2-char',
            name: 'C2 Character',
            type: 'character',
            chatPage: 0,
            chats: [makeColdChat('c2-chat-0', coldKey)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as {
            message: unknown[]
            hypaV2Data: unknown
            hypaV3Data: unknown
            scriptstate: unknown
            localLore: unknown
            lastDate?: number
        }

        await preLoadChat(0, 0)

        // CHAR: unchanged before and after the fix -- an object blob has
        // always restored messages plus every side field.
        expect(chat.message).toEqual(payload.message)
        expect(chat.hypaV2Data).toEqual(payload.hypaV2Data)
        expect(chat.hypaV3Data).toEqual(payload.hypaV3Data)
        expect(chat.scriptstate).toEqual(payload.scriptstate)
        expect(chat.localLore).toEqual(payload.localLore)
        expect(typeof chat.lastDate).toBe('number')
    })
})

/**
 * CHORE-07 stage 7b -- `isColdChat` (`coldstorageData.ts`) reports whether a
 * chat's first message is still a live cold-storage pointer, as opposed to
 * ordinary text, text produced by `formatColdStorageLoadError`, or an
 * empty/missing chat.
 */
describe('CHORE-07 stage 7b: isColdChat', () => {
    test('true for a chat whose first message is a live cold-storage pointer', () => {
        const chat = makeColdChat('ic-1', 'ic-key')
        expect(isColdChat(chat as never)).toBe(true)
    })

    test('false for a chat with ordinary text', () => {
        expect(isColdChat({ message: [{ data: 'hello', role: 'user' }] } as never)).toBe(false)
    })

    test('false for a chat holding the cold-storage load-error text', () => {
        expect(isColdChat({ message: [{ data: formatColdStorageLoadError('ic-key'), role: 'char' }] } as never)).toBe(false)
    })

    test('false for an empty or missing chat', () => {
        expect(isColdChat(undefined)).toBe(false)
        expect(isColdChat(null)).toBe(false)
        expect(isColdChat({ message: [] } as never)).toBe(false)
    })
})

/**
 * `readColdStorageItem` end to end on the web page store (same mock as the
 * `preLoadChat` and collector groups above). The page store's own absent/error
 * classification is pinned in `coldUnitsThroughStore.test.ts`.
 */
describe('CHORE-07 stage 7c-1: readColdStorageItem (web page store)', () => {
    test('a stored null value is ok, not missing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const key = 'reader-7c1-null-key'
        const writeOk = await setColdStorageItem(key, null)
        expect(writeOk).toBe(true)

        const result = await readColdStorageItem(key)
        expect(result).toEqual({ status: 'ok', value: null })
    })

    test('a {character} blob is ok', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const key = 'reader-7c1-character-key'
        const payload = { character: { chaId: 'reader-7c1-char', name: 'Reader', type: 'character', chatPage: 0, chats: [] } }
        await setColdStorageItem(key, payload)

        const result = await readColdStorageItem(key)
        expect(result).toEqual({ status: 'ok', value: payload })
    })

    test('a never-stored key is missing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const result = await readColdStorageItem('reader-7c1-never-stored-key')
        expect(result).toEqual({ status: 'missing' })
    })

    test('4b-G1: an absent unit reads missing without any getDirectory call, and a stored unit does not touch it either', async () => {
        platformState.isTauri = false
        resetColdUnits()

        expect(await readColdStorageItem('reader-4b-absent-key')).toEqual({ status: 'missing' })
        await setColdStorageItem('reader-4b-stored-key', { message: [] })
        expect(await readColdStorageItem('reader-4b-stored-key')).toEqual({ status: 'ok', value: { message: [] } })
        expect(getDirectoryMock).not.toHaveBeenCalled()
    })
})

/**
 * CHORE-07 stage 7c-1 -- `preLoadChat`'s `'missing'` result and the
 * character-switch race fix.
 */
describe('CHORE-07 stage 7c-1: preLoadChat missing result and the character-switch race', () => {
    beforeEach(() => {
        selectedCharID.set(0)
    })
    afterEach(() => {
        selectedCharID.set(-1)
    })

    test('a positively missing blob resolves "missing" and mutates nothing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'missing-7c1-key' // deliberately never written
        DBState.db = makeDb([{
            chaId: 'missing-7c1-char',
            name: 'Missing 7c1 Character',
            type: 'character',
            chatPage: 0,
            chats: [makeColdChat('missing-7c1-chat-0', coldKey)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const result = await preLoadChat(0, 0)

        // A positively missing blob (the key was never written) must
        // resolve 'missing', distinguished from any other unusable read,
        // which resolves 'error'.
        expect(result).toBe('missing')
        expect(chat.message).toEqual(messageBefore)
    })

    test('switching the selected character during the read resolves "none" and mutates nothing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'race-7c1-key'
        await setColdStorageItem(coldKey, {
            message: [{ time: 1, data: 'archived', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })

        DBState.db = makeDb([
            {
                chaId: 'race-7c1-char-0',
                name: 'Race 7c1 Character 0',
                type: 'character',
                chatPage: 0,
                chats: [makeColdChat('race-7c1-chat-0', coldKey)],
            },
            {
                chaId: 'race-7c1-char-1',
                name: 'Race 7c1 Character 1',
                type: 'character',
                chatPage: 0,
                chats: [{ message: [{ time: 1, data: 'unrelated', role: 'user' }], note: '', name: '', localLore: [] }],
            },
        ] as unknown as CharacterFixture[])

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { time: number, data: string, role: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        selectedCharID.set(0)
        const resultPromise = preLoadChat(0, 0)
        // Synchronously, before the read settles, the user switches to a
        // DIFFERENT CHARACTER entirely (not just a different chat on the
        // same character) -- character index 0 is no longer selected.
        selectedCharID.set(1)

        const result = await resultPromise

        // Checking only whether the pointer string changed is not enough:
        // if the selected character itself changes while the read is
        // pending, the restore must not proceed into character 0's chat --
        // it must resolve 'none' and leave `chat.message` untouched,
        // regardless of which character is now selected.
        expect(result).toBe('none')
        expect(chat.message).toEqual(messageBefore)
    })
})

/**
 * CHORE-07 stage 7c-2 -- `mergeRetriedColdChatSideFields` (`coldstorageData.ts`),
 * a brand-new, pure, dependency-free function.
 */
describe('CHORE-07 stage 7c-2: mergeRetriedColdChatSideFields (pure)', () => {
    test('hypaV3 takes the blob wholesale when live has no summaries, even with a live modalSettings set', () => {
        const live = {
            hypaV3Data: { summaries: [], modalSettings: { displayMode: 'all', displayRangeFrom: 0, displayRangeTo: 0, displayRecentCount: 0, displayImportant: false, displaySelected: false } },
        } as unknown as RetryLegacyColdChatSideFields
        const blob = {
            hypaV3Data: { summaries: [{ text: 'blob summary', chatMemos: ['b1'], isImportant: false }] },
        } as unknown as RetryLegacyColdChatSideFields

        const result = mergeRetriedColdChatSideFields(live, blob, undefined)

        // Semantic emptiness is judged on summaries.length alone -- a live
        // modalSettings does not stop the wholesale replacement.
        expect((result.hypaV3Data as { summaries: unknown[] }).summaries).toEqual(blob.hypaV3Data.summaries)
    })

    test('hypaV3 concatenates blob before live, unions categories by id, and strips the dropped memo from a live summary', () => {
        const live = {
            hypaV3Data: {
                summaries: [
                    { text: 'live1', chatMemos: ['keep-1', 'dropped-memo'], isImportant: false },
                    { text: 'live2', chatMemos: ['keep-2'], isImportant: true },
                ],
                categories: [{ id: 'catB', name: 'Live Cat' }],
            },
        } as unknown as RetryLegacyColdChatSideFields
        const blob = {
            hypaV3Data: {
                summaries: [{ text: 'blob1', chatMemos: ['b1'], isImportant: false }],
                categories: [{ id: 'catA', name: 'Blob Cat' }],
            },
        } as unknown as RetryLegacyColdChatSideFields

        const result = mergeRetriedColdChatSideFields(live, blob, 'dropped-memo')
        const hypaV3Data = result.hypaV3Data as { summaries: { text: string, chatMemos: string[] }[], categories: { id: string }[] }

        expect(hypaV3Data.summaries).toEqual([
            { text: 'blob1', chatMemos: ['b1'], isImportant: false },
            { text: 'live1', chatMemos: ['keep-1'], isImportant: false },
            { text: 'live2', chatMemos: ['keep-2'], isImportant: true },
        ])
        expect(hypaV3Data.categories).toEqual([{ id: 'catA', name: 'Blob Cat' }, { id: 'catB', name: 'Live Cat' }])
    })

    test('hypaV3 drops a live summary entirely when stripping the dropped memo leaves it with no memos', () => {
        const live = {
            hypaV3Data: {
                summaries: [
                    // This summary's ONLY memo is the one being dropped --
                    // stripping it would leave `chatMemos: []`, and
                    // such a summary covers nothing and contributes no
                    // position to hypav3.ts's resume point. It must be
                    // removed outright instead.
                    { text: 'live1-emptied-by-strip', chatMemos: ['dropped-memo'], isImportant: false },
                    { text: 'live2', chatMemos: ['keep-2'], isImportant: true },
                ],
            },
        } as unknown as RetryLegacyColdChatSideFields
        const blob = {
            hypaV3Data: { summaries: [{ text: 'blob1', chatMemos: ['b1'], isImportant: false }] },
        } as unknown as RetryLegacyColdChatSideFields

        const result = mergeRetriedColdChatSideFields(live, blob, 'dropped-memo')
        const hypaV3Data = result.hypaV3Data as { summaries: { text: string, chatMemos: string[] }[] }

        expect(hypaV3Data.summaries).toEqual([
            { text: 'blob1', chatMemos: ['b1'], isImportant: false },
            { text: 'live2', chatMemos: ['keep-2'], isImportant: true },
        ])
    })

    test('hypaV2 takes the blob wholesale when it has mainChunks', () => {
        const live = { hypaV2Data: { chunks: [], mainChunks: [{ id: 1, text: 'live', chatMemos: [], lastChatMemo: '' }], lastMainChunkID: 1 } } as unknown as RetryLegacyColdChatSideFields
        const blob = { hypaV2Data: { chunks: [], mainChunks: [{ id: 5, text: 'blob', chatMemos: [], lastChatMemo: '' }], lastMainChunkID: 5 } } as unknown as RetryLegacyColdChatSideFields

        const result = mergeRetriedColdChatSideFields(live, blob, undefined)

        expect(result.hypaV2Data).toBe(blob.hypaV2Data)
    })

    // Regression coverage: hypaV2 must keep the live value untouched when
    // the blob has no mainChunks.
    test('CHAR: hypaV2 keeps live untouched when the blob has no mainChunks', () => {
        const live = { hypaV2Data: { chunks: [], mainChunks: [{ id: 2, text: 'live', chatMemos: [], lastChatMemo: '' }], lastMainChunkID: 2 } } as unknown as RetryLegacyColdChatSideFields
        const blob = { hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 } } as unknown as RetryLegacyColdChatSideFields

        const result = mergeRetriedColdChatSideFields(live, blob, undefined)

        expect(result.hypaV2Data).toBe(live.hypaV2Data)
    })

    test('localLore concatenates blob then live, and scriptstate lets live win on a shallow merge', () => {
        const live = { localLore: [{ key: 'l', value: 'live-value' }], scriptstate: { b: 99, c: 3 } } as unknown as RetryLegacyColdChatSideFields
        const blob = { localLore: [{ key: 'b', value: 'blob-value' }], scriptstate: { a: 1, b: 2 } } as unknown as RetryLegacyColdChatSideFields

        const result = mergeRetriedColdChatSideFields(live, blob, undefined)

        expect(result.localLore).toEqual([{ key: 'b', value: 'blob-value' }, { key: 'l', value: 'live-value' }])
        expect(result.scriptstate).toEqual({ a: 1, b: 99, c: 3 })
    })
})

/**
 * CHORE-07 stage 7c-2 -- `retryLegacyColdChatLoad` (`coldstorage.svelte.ts`),
 * a brand-new, exported function. Cases marked CHAR/Guard pin behaviour
 * that has no legacy equivalent to regress from (e.g. "not an error-text
 * chat" or "a near-miss string") -- new coverage, not a guard against an
 * existing wrong behaviour.
 */
describe('CHORE-07 stage 7c-2: retryLegacyColdChatLoad', () => {
    beforeEach(() => {
        selectedCharID.set(0)
        doingChat.set(false)
    })
    afterEach(() => {
        selectedCharID.set(-1)
        doingChat.set(false)
    })

    test('RL1: ok with an object blob gives the restored messages followed by the tail, and empty live side fields take the blob\'s', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl1-cold-key'
        const blobPayload = {
            message: [{ time: 1, data: 'restored message', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [{ id: 1, text: 'chunk', chatMemos: ['m1'], lastChatMemo: 'm1' }], lastMainChunkID: 1 },
            hypaV3Data: { summaries: [{ text: 'blob summary', chatMemos: ['b1'], isImportant: false }] },
            scriptstate: { flag: 'blob' },
            localLore: [{ key: 'blob-lore', value: 'v' }],
        }
        await setColdStorageItem(coldKey, blobPayload)

        const errorChat = {
            ...makeErrorTextChat('rl1-chat-0', coldKey),
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
        }
        errorChat.message.push({ time: 2, data: 'sent after the error', role: 'user' } as never)
        DBState.db = makeRetryDb('rl1-char', errorChat)

        const result = await retryLegacyColdChatLoad(0, 0)

        const chat = DBState.db.characters[0].chats[0] as unknown as {
            message: { time: number, data: string, role: string }[]
            hypaV2Data: unknown
            hypaV3Data: { summaries: unknown[] }
            scriptstate: unknown
            localLore: unknown
            lastDate?: number
        }
        expect(result).toBe('ok')
        expect(chat.message).toEqual([
            { time: 1, data: 'restored message', role: 'user' },
            { time: 2, data: 'sent after the error', role: 'user' },
        ])
        expect(chat.hypaV2Data).toEqual(blobPayload.hypaV2Data)
        expect(chat.hypaV3Data.summaries).toEqual(blobPayload.hypaV3Data.summaries)
        expect(chat.scriptstate).toEqual(blobPayload.scriptstate)
        expect(chat.localLore).toEqual(blobPayload.localLore)
        expect(typeof chat.lastDate).toBe('number')
    })

    test('RL2: ok keeps non-empty live side fields when the blob\'s are the cold-storage reset state', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl2-cold-key'
        await setColdStorageItem(coldKey, {
            message: [{ time: 1, data: 'restored message', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })

        const liveHypaV2 = { chunks: [], mainChunks: [{ id: 9, text: 'live chunk', chatMemos: ['x'], lastChatMemo: 'x' }], lastMainChunkID: 9 }
        const liveHypaV3 = { summaries: [{ text: 'live summary', chatMemos: ['live-memo'], isImportant: false }] }
        const liveScriptstate = { flag: 'live' }
        const liveLocalLore = [{ key: 'live-lore', value: 'v' }]

        const errorChat = {
            ...makeErrorTextChat('rl2-chat-0', coldKey),
            hypaV2Data: liveHypaV2,
            hypaV3Data: liveHypaV3,
            scriptstate: liveScriptstate,
            localLore: liveLocalLore,
        }
        DBState.db = makeRetryDb('rl2-char', errorChat)
        // Captured through the reactive DBState proxy, NOT the plain
        // `liveHypaV2` object above -- Svelte 5's $state proxy wraps every
        // nested plain object it's given, so DBState.db's own view of this
        // field is a different (though deep-equal) reference from the bare
        // object literal. A reference-identity assertion below must compare
        // proxy-to-proxy, matching this file's C1/C2 convention.
        const hypaV2Ref = (DBState.db.characters[0].chats[0] as unknown as { hypaV2Data: unknown }).hypaV2Data

        const result = await retryLegacyColdChatLoad(0, 0)
        const chat = DBState.db.characters[0].chats[0] as unknown as {
            hypaV2Data: unknown
            hypaV3Data: { summaries: unknown[] }
            scriptstate: unknown
            localLore: unknown
        }

        expect(result).toBe('ok')
        // hypaV2 has no non-empty mainChunks in the blob, so the merge keeps
        // the live value BY REFERENCE (no spread) -- unlike hypaV3Data/
        // scriptstate/localLore below, which the merge always rebuilds into
        // a new object/array regardless of path, so those are asserted by
        // value (toEqual), not identity.
        expect(chat.hypaV2Data).toBe(hypaV2Ref)
        expect(chat.hypaV3Data.summaries).toEqual(liveHypaV3.summaries)
        expect(chat.scriptstate).toEqual(liveScriptstate)
        expect(chat.localLore).toEqual(liveLocalLore)
    })

    test('RL3: ok with a legacy array blob restores messages only, leaving every live side field untouched', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl3-cold-key'
        const legacyMessages = [{ time: 1, data: 'legacy restored message', role: 'user' }]
        await setColdStorageItem(coldKey, legacyMessages)

        const liveHypaV2 = { chunks: [], mainChunks: [{ id: 3, text: 'x', chatMemos: [], lastChatMemo: '' }], lastMainChunkID: 3 }
        const liveScriptstate = { untouched: true }
        const liveLocalLore = [{ key: 'k', value: 'v' }]
        const errorChat = {
            ...makeErrorTextChat('rl3-chat-0', coldKey),
            hypaV2Data: liveHypaV2,
            scriptstate: liveScriptstate,
            localLore: liveLocalLore,
        }
        errorChat.message.push({ time: 2, data: 'after error', role: 'user' } as never)
        DBState.db = makeRetryDb('rl3-char', errorChat)
        // See RL2's comment: captured through the reactive proxy, not the
        // bare objects above, so the "untouched" identity checks below
        // compare proxy-to-proxy.
        const chatBefore = DBState.db.characters[0].chats[0] as unknown as { hypaV2Data: unknown, scriptstate: unknown, localLore: unknown }
        const hypaV2Ref = chatBefore.hypaV2Data
        const scriptstateRef = chatBefore.scriptstate
        const localLoreRef = chatBefore.localLore

        const result = await retryLegacyColdChatLoad(0, 0)
        const chat = DBState.db.characters[0].chats[0] as unknown as {
            message: unknown[]
            hypaV2Data: unknown
            scriptstate: unknown
            localLore: unknown
        }

        expect(result).toBe('ok')
        expect(chat.message).toEqual([...legacyMessages, { time: 2, data: 'after error', role: 'user' }])
        expect(chat.hypaV2Data).toBe(hypaV2Ref)
        expect(chat.scriptstate).toBe(scriptstateRef)
        expect(chat.localLore).toBe(localLoreRef)
    })

    test('RL4: a positively missing blob resolves "missing" and mutates nothing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl4-missing-key' // deliberately never written
        const errorChat = makeErrorTextChat('rl4-chat-0', coldKey)
        DBState.db = makeRetryDb('rl4-char', errorChat)
        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('missing')
        expect(chat.message).toEqual(messageBefore)
    })

    test('RL5: an ambiguous read failure resolves "error" and mutates nothing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl5-error-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        armTransientStoreFailure(coldKey)
        const errorChat = makeErrorTextChat('rl5-chat-0', coldKey)
        DBState.db = makeRetryDb('rl5-char', errorChat)
        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('error')
        expect(chat.message).toEqual(messageBefore)
    })

    test('RL6: "busy" when a reply is already being written into this chat before the read starts', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl6-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl6-chat-0', coldKey)
        DBState.db = makeRetryDb('rl6-char', errorChat)

        const reply = registerWork({ chaId: 'rl6-char', chatId: 'rl6-chat-0' }, undefined, 'reply')
        doingChat.set(true)
        const result = await retryLegacyColdChatLoad(0, 0)
        reply.end()

        expect(result).toBe('busy')
    })

    test('RL6b (T16): a reply being written into another chat does not hold the retry', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl6b-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl6b-chat-0', coldKey)
        DBState.db = makeRetryDb('rl6b-char', errorChat)

        const reply = registerWork({ chaId: 'rl6b-other-char', chatId: 'rl6b-other-chat' }, undefined, 'reply')
        doingChat.set(true)
        const result = await retryLegacyColdChatLoad(0, 0)
        reply.end()

        expect(result).toBe('ok')
    })

    test('RL7: "busy" when the chat\'s own isStreaming is set before the read starts', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl7-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = { ...makeErrorTextChat('rl7-chat-0', coldKey), isStreaming: true }
        DBState.db = makeRetryDb('rl7-char', errorChat)

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('busy')
    })

    test('RL8: "busy" when a reply starts in this chat during the read', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl8-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl8-chat-0', coldKey)
        DBState.db = makeRetryDb('rl8-char', errorChat)

        const resultPromise = retryLegacyColdChatLoad(0, 0)
        // Synchronously, before the read settles, a send starts in this chat.
        const reply = registerWork({ chaId: 'rl8-char', chatId: 'rl8-chat-0' }, undefined, 'reply')
        doingChat.set(true)
        const result = await resultPromise
        reply.end()

        expect(result).toBe('busy')
    })

    // Guard, not proof the race check is real: a bare `result === 'none'`
    // assertion would also pass against a naive stub that always returns
    // 'none', so this test alone cannot fail against such a stub.
    test('RL9 Guard: switching the selected character during the read resolves "none" and mutates nothing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl9-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl9-chat-0', coldKey)
        DBState.db = makeDb([
            {
                chaId: 'rl9-char-0',
                name: 'RL9 Character 0',
                type: 'character',
                chatPage: 0,
                chats: [errorChat],
            },
            {
                chaId: 'rl9-char-1',
                name: 'RL9 Character 1',
                type: 'character',
                chatPage: 0,
                chats: [{ message: [{ time: 1, data: 'unrelated', role: 'user' }], note: '', name: '', localLore: [] }],
            },
        ] as unknown as CharacterFixture[])
        selectedCharID.set(0)

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const resultPromise = retryLegacyColdChatLoad(0, 0)
        // Synchronously, before the read settles, the user switches to a
        // DIFFERENT CHARACTER entirely.
        selectedCharID.set(1)
        const result = await resultPromise

        expect(result).toBe('none')
        expect(chat.message).toEqual(messageBefore)
    })

    // Same caveat as RL9 above.
    test('RL10 Guard: message[0] changing during the read (a double retry) resolves "none" and mutates nothing further', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl10-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl10-chat-0', coldKey)
        DBState.db = makeRetryDb('rl10-char', errorChat)
        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { time: number, data: string, role: string }[] }

        const resultPromise = retryLegacyColdChatLoad(0, 0)
        // Synchronously, before the read settles, a concurrent retry (or
        // anything else) already restored this chat.
        chat.message = [{ time: 999, data: 'restored by a concurrent retry', role: 'user' }]
        const result = await resultPromise

        expect(result).toBe('none')
        expect(chat.message).toEqual([{ time: 999, data: 'restored by a concurrent retry', role: 'user' }])
    })

    test('RL11: an ok read with a shape this function does not recognize resolves "damaged" and mutates nothing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl11-bad-shape-key'
        await setColdStorageItem(coldKey, { message: 'not-an-array' })
        const errorChat = makeErrorTextChat('rl11-chat-0', coldKey)
        DBState.db = makeRetryDb('rl11-char', errorChat)
        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('damaged')
        expect(chat.message).toEqual(messageBefore)
    })

    test('RL12 Guard: a chat with ordinary text resolves "none"', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const errorChat = { message: [{ time: 1, data: 'ordinary text', role: 'char' }], note: '', name: '', localLore: [] }
        DBState.db = makeRetryDb('rl12-char', errorChat)

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('none')
    })

    test('RL13 Guard: a near-miss error-text string resolves "none"', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const errorChat = {
            message: [{
                time: 1,
                data: 'note: [Cold storage data could not be loaded. Key: rl13-key] (seen by support)',
                role: 'char',
            }],
            note: '', name: '', localLore: [],
        }
        DBState.db = makeRetryDb('rl13-char', errorChat)

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('none')
    })

    // Same caveat as RL9 above.
    test('RL14: a chat reordered to a different index during the read resolves "none" and mutates nothing', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl14-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl14-chat-0', coldKey)
        const otherChat = { message: [{ time: 1, data: 'unrelated', role: 'user' }], note: '', name: '', localLore: [] }
        DBState.db = makeRetryDb('rl14-char', errorChat)
        // Read through the reactive DBState proxy, not the raw `errorChat`
        // object built above -- Svelte 5's $state proxy wraps every nested
        // plain object it's given, so a write made through the proxy (or
        // the ABSENCE of one) would never be observable on the bare object
        // that was only used to construct the initial value. This assertion
        // must go through DBState.db, or it can never fail either way.
        const messageBefore = JSON.parse(JSON.stringify(
            (DBState.db.characters[0].chats[0] as unknown as { message: unknown[] }).message
        ))

        const resultPromise = retryLegacyColdChatLoad(0, 0)
        // Synchronously, before the read settles, a new chat is inserted at
        // index 0 -- the captured chat object is still IN the array, just no
        // longer at chatIndex 0 (it's now at index 1).
        ;(DBState.db.characters[0].chats as unknown[]).unshift(otherChat)
        const result = await resultPromise

        expect(result).toBe('none')
        expect((DBState.db.characters[0].chats[1] as unknown as { message: unknown[] }).message).toEqual(messageBefore)
    })

    // Same caveat as RL9 above.
    test('RL15: the character being replaced (same chaId, a new chats array) during the read resolves "none"', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl15-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl15-chat-0', coldKey)
        DBState.db = makeRetryDb('rl15-char', errorChat)

        const resultPromise = retryLegacyColdChatLoad(0, 0)
        // Synchronously, before the read settles, a plugin replaces the
        // whole character object (same chaId, a brand-new chats array) --
        // e.g. via setCharacterToIndex.
        DBState.db.characters[0] = {
            chaId: 'rl15-char',
            name: 'Replaced',
            type: 'character',
            chatPage: 0,
            chats: [{ message: [{ time: 1, data: 'replacement', role: 'user' }], note: '', name: '', localLore: [] }],
        } as unknown as CharacterFixture
        const result = await resultPromise

        expect(result).toBe('none')
    })

    test('RL16: the tail is kept by identity, chatId included', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl16-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'restored', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl16-chat-0', coldKey)
        DBState.db = makeRetryDb('rl16-char', errorChat)
        const chat = DBState.db.characters[0].chats[0] as unknown as {
            message: { time: number, data: string, role: string, chatId?: string }[]
        }

        const resultPromise = retryLegacyColdChatLoad(0, 0)
        const pushedMessage = { time: 2, data: 'sent while retrying', role: 'user', chatId: 'rl16-memo' }
        // Synchronously, before the read settles, a message is sent.
        chat.message.push(pushedMessage)
        // Captured through the reactive array itself, not `pushedMessage`
        // (see RL2/RL3's comment) -- pushing a plain object into a $state
        // array wraps it, so this is the reference retryLegacyColdChatLoad's
        // own `.slice(1)` must preserve.
        const pushedRef = chat.message[chat.message.length - 1]
        const result = await resultPromise

        expect(result).toBe('ok')
        expect(chat.message[chat.message.length - 1]).toBe(pushedRef)
        expect(chat.message[chat.message.length - 1].chatId).toBe('rl16-memo')
    })

    test('RL17: the error message\'s chatId is stripped from a live summary\'s chatMemos during retry', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl17-cold-key'
        await setColdStorageItem(coldKey, {
            message: [{ time: 1, data: 'restored', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })

        const baseChat = makeErrorTextChat('rl17-chat-0', coldKey)
        const errorChat = {
            ...baseChat,
            message: [{ ...baseChat.message[0], chatId: 'rl17-error-memo' }],
            hypaV3Data: {
                summaries: [
                    { text: 'live summary', chatMemos: ['rl17-error-memo', 'rl17-other-memo'], isImportant: false },
                ],
            },
        }
        DBState.db = makeRetryDb('rl17-char', errorChat)

        const result = await retryLegacyColdChatLoad(0, 0)
        const chat = DBState.db.characters[0].chats[0] as unknown as {
            hypaV3Data: { summaries: { chatMemos: string[] }[] }
        }

        expect(result).toBe('ok')
        expect(chat.hypaV3Data.summaries[0].chatMemos).toEqual(['rl17-other-memo'])
    })

    test('RL18: a malformed side field in the blob resolves "error" and leaves the chat completely untouched', async () => {
        platformState.isTauri = false
        resetColdUnits()

        const coldKey = 'rl18-malformed-key'
        await setColdStorageItem(coldKey, {
            message: [{ time: 1, data: 'restored', role: 'user' }],
            // Passes the shape check (the blob still has a message array),
            // but `localLore` is truthy and non-iterable -- spreading it
            // inside the merge (`[...blob.localLore, ...]`) throws.
            localLore: 5,
        })
        const errorChat = makeErrorTextChat('rl18-chat-0', coldKey)
        DBState.db = makeRetryDb('rl18-char', errorChat)
        const chatBefore = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chatBefore.message))

        const result = await retryLegacyColdChatLoad(0, 0)

        // A throw from the merge must not leave the chat half-mutated
        // (message replaced, side fields not), and must not propagate out
        // of retryLegacyColdChatLoad as a rejection -- it must resolve
        // 'error' with the chat completely untouched.
        expect(result).toBe('error')
        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        expect(chat.message).toEqual(messageBefore)
        expect(chat.message[0].data).toBe(`[Cold storage data could not be loaded. Key: ${coldKey}]`)
    })
})
