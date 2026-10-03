/**
 * CHORE-07 stage 7a step 2 -- "stop deleting" tests.
 * Agents/Reports/13-chore07-cold-read-failure-plan.md.
 *
 * These tests pin that a cold-storage read failure, an ambiguous read, or a
 * mismatched character never causes `sweepTauriAssets`, `sweepForageAssetKey`
 * or `cleanColdStorage` to delete an asset or a cold-storage key that a live
 * character or chat still needs (`resolveUncleanableChars`/`buildAssetKeepSet`
 * in globalApi.svelte.ts for the startup sweep, and the manual clean-up in
 * storage/manualCleanup.ts). A blob that was never written, a read that
 * throws, or a `character.chaId` mismatch must all be treated as "keep, don't
 * delete" -- never as proof that the underlying data is gone.
 *
 * Tests and assertions marked CHAR are compatibility guards: they hold
 * regardless of that failure handling and pin that the ordinary
 * (non-failure) deletion paths still delete what they are supposed to.
 * a12/a13 are the describe-level instance.
 *
 * This file drives the REAL seams, not a replica:
 *   - `buildAssetKeepSet(db)`, `getBasename` from
 *     `src/ts/globalApi.svelte.ts` (real, unmocked).
 *   - `sweepTauriAssets` / `sweepForageAssetKey` from
 *     `src/ts/storage/assetSweep.ts` (real, unmocked, dependency-free).
 *   - `getColdStorageItem` / `setColdStorageItem` / `preLoadChat` /
 *     `cleanColdStorage` / `listColdStorageItems` /
 *     `collectColdStorageBackupPayloads` from
 *     `src/ts/process/coldstorage.svelte.ts` (real, unmocked).
 * Every other module reachable from those three is mocked below. Only the
 * STORAGE BACKEND underneath `getColdStorageItem` is faked (Tauri
 * `@tauri-apps/plugin-fs` and an OPFS `navigator.storage` stand-in) --
 * `getColdStorageItem` itself is never mocked directly, so a read failure
 * has to go through its own real try/catch-swallows-errors path, exactly as
 * it does in production.
 *
 * Mock sets are reused, one-for-one, from the two harnesses this plan
 * cites: `Agents/Tools/save-gen/asset-gc-cold-read-repro.svelte.harness.ts`
 * (the asset-sweep group, a1/a3/a4/a5) and
 * `Agents/Tools/save-gen/cold-storage-orphan-repro.svelte.harness.ts` (the
 * cold-storage-cleanup group, a7/a8/a9/a11/a11b/a12/a13). Per
 * Agents/Tools/README.md's "keep every rune-touching mock in ONE file",
 * both harnesses' mocks live together here.
 *
 * PLATFORM TOGGLE: unlike either harness (each fixes `isTauri` for its
 * whole file), this file needs BOTH the Tauri backend (a1/a3/a4/a5)
 * and the OPFS backend (a7/a8/a9/a11/a11b/a12/a13) in the same run.
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
 * a2's cold read still goes through the Tauri backend (platformState.isTauri
 * stays true) even though it exercises the WEB deletion path
 * (`sweepForageAssetKey`). That is deliberate, not a shortcut: the plan's
 * "same on the web branch" is about which of the two independent deletion
 * FUNCTIONS is under test (`sweepTauriAssets` vs `sweepForageAssetKey`),
 * not about which storage backend produced the incomplete keep-set --
 * neither sweep function's own behaviour depends on that. a7/a8/a9/a11/a11b/
 * a12/a13 DO need the real OPFS backend, because `cleanColdStorage` /
 * `preLoadChat` read `DBState.db` directly (no injected `db` seam exists
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
// `cleanColdStorage` reads lives here on the web build.
const forageMem = vi.hoisted(() => new Map<string, Uint8Array>())

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
            throw new Error(`ENOENT (mock): ${p}`)
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

//#region OPFS backend mock (navigator.storage) -- copied from
// cold-storage-orphan-repro.

const opfsStore = new Map<string, Uint8Array>()
const throwOnceFilenames = new Set<string>()

function opfsFilename(key: string): string {
    return 'coldstorage_' + key + '.json'
}

function armTransientOpfsFailure(key: string): void {
    throwOnceFilenames.add(opfsFilename(key))
}

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

// Used only by the CHORE-07 stage 7c-1 `classifyOpfsColdRead` group, far
// below -- declared here (module scope) alongside `MockNotFoundError` to
// avoid Svelte's "nested class" perf warning.
class FakeTypeMismatchError extends Error {
    name = 'TypeMismatchError'
}

const mockDirectoryHandle = {
    async getFileHandle(name: string, opts?: { create?: boolean }) {
        if (throwOnceFilenames.has(name)) {
            throwOnceFilenames.delete(name)
            throw new Error(`simulated transient OPFS read failure for ${name}`)
        }
        if (opts?.create) {
            return {
                async createWritable() {
                    return {
                        async write(data: Uint8Array) {
                            opfsStore.set(name, data)
                        },
                        async close() {},
                    }
                },
            }
        }
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

function resetOpfs(): void {
    opfsStore.clear()
    throwOnceFilenames.clear()
}

//#endregion

import { buildAssetKeepSet, forageStorage, getBasename } from '../../globalApi.svelte'
import { injectAppStore } from '../../storage/store/appStore'
import { createTauriFilesStore } from '../../storage/store/tauriFilesStore'
import { createForageBackedStore, createSwitchedStore, type ForageLike } from '../../storage/tests/forageBackedStore'
import {
    getColdStorageItem,
    setColdStorageItem,
    preLoadChat,
    cleanColdStorage,
    listColdStorageItems,
    collectColdStorageBackupPayloads,
    coldStorageHeader,
    readColdStorageItem,
    classifyTauriColdRead,
    classifyOpfsColdRead,
    classifyNodeColdRead,
    retryLegacyColdChatLoad,
} from '../coldstorage.svelte'
import { isColdChat, formatColdStorageLoadError, mergeRetriedColdChatSideFields } from '../coldstorageData'
import type { RetryLegacyColdChatSideFields } from '../coldstorageData'
import { doingChat } from '../index.svelte'
import { sweepTauriAssets, sweepForageAssetKey } from '../../storage/assetSweep'
import { RisuSaveEncoder } from '../../storage/risuSave'
import { recordLoadTimeListing } from '../../storage/loadTimeListing'
import { noteMainFileBytes } from '../../storage/mainFileRecord'
import { readDir, remove, BaseDirectory, readFile as tauriReadFile, exists as tauriExists } from '@tauri-apps/plugin-fs'
import { DBState, selectedCharID, frozenSaveKeysStore } from '../../stores.svelte'
import { alertError, alertClear } from 'src/ts/alert'

// The clean-up reads the committed main file through the page's byte store: the
// key/value model behind `forageStorage` on the web build, the desktop store over
// the file model on Tauri. Which one applies is the platform of each test.
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

/**
 * The state a page is in when the manual clean-up may run: the live tree has
 * been committed as the main file, this tab has recorded those bytes, and the
 * load-time listing has been taken. Called after the test has seeded its units
 * and set `DBState.db`, immediately before `cleanColdStorage()`.
 */
async function primeCleanupPreconditions(): Promise<void> {
    forageMem.clear()
    const encoder = new RisuSaveEncoder()
    await encoder.init(DBState.db, {})
    const committed = new Uint8Array(encoder.encode()!)
    forageMem.set('database/database.bin', committed)
    noteMainFileBytes(committed.slice())
    await recordLoadTimeListing()
}

//#endregion

describe('CHORE-07 stage 7a: boot-time asset sweep must skip on an incomplete cold read', () => {
    test('a1: Tauri sweep must not delete assets when the cold read is a transient failure', async () => {
        platformState.isTauri = true
        resetTauriFs()
        const coldKey = 'a1-cold-key'
        const chaId = 'a1-char'
        const writeOk = await setColdStorageItem(coldKey, { character: makeFullCharacter(chaId) })
        expect(writeOk).toBe(true)
        const db = makeDb([makeColdStub(chaId, coldKey)])

        armTransientTauriReadFailure(coldKey)

        // Drive the REAL wiring exactly the way bootstrap.ts's cleanChunks
        // does: buildAssetKeepSet, then spread its result into
        // sweepTauriAssets.
        const keepSet = await buildAssetKeepSet(db)
        await sweepTauriAssets({
            ...keepSet,
            listAssets: () => readDir('assets', { baseDir: BaseDirectory.AppData }),
            removeAsset: (relativePath) => remove(relativePath, { baseDir: BaseDirectory.AppData }),
            getBasename,
        })

        // A transient cold-read failure leaves the stub (no
        // emotionImages/additionalAssets) as the only view of this
        // character; the sweep must treat that as an incomplete read and
        // skip deleting these still-in-use asset files.
        expect(tauriFsHas('assets/emotion-happy.png')).toBe(true)
        expect(tauriFsHas('assets/emotion-sad.png')).toBe(true)
        expect(tauriFsHas('assets/additional-bg.png')).toBe(true)
    })

    test('a2: the web/forage sweep must not delete assets when the cold read is a transient failure', async () => {
        platformState.isTauri = true // see file header: the cold-read backend here is orthogonal to which deletion path is under test
        resetTauriFs()
        const forageAssetStore = new Map<string, Uint8Array>([
            ['assets/main-image.png', new TextEncoder().encode('x')],
            ['assets/emotion-happy.png', new TextEncoder().encode('x')],
            ['assets/emotion-sad.png', new TextEncoder().encode('x')],
            ['assets/additional-bg.png', new TextEncoder().encode('x')],
        ])
        const coldKey = 'a2-cold-key'
        const chaId = 'a2-char'
        await setColdStorageItem(coldKey, { character: makeFullCharacter(chaId) })
        const db = makeDb([makeColdStub(chaId, coldKey)])

        armTransientTauriReadFailure(coldKey)

        const keepSet = await buildAssetKeepSet(db)
        // Matches bootstrap.ts's web/Node asset-sweep loop: one
        // sweepForageAssetKey call per 'assets/'-prefixed key.
        for (const key of Array.from(forageAssetStore.keys())) {
            await sweepForageAssetKey(key, {
                ...keepSet,
                removeAsset: async (k) => { forageAssetStore.delete(k) },
                getBasename,
            })
        }

        // Same failure, same wrong outcome, on the OTHER deletion path.
        expect(forageAssetStore.has('assets/emotion-happy.png')).toBe(true)
        expect(forageAssetStore.has('assets/emotion-sad.png')).toBe(true)
        expect(forageAssetStore.has('assets/additional-bg.png')).toBe(true)
    })

    test('a3: the sweep must not delete assets when the cold blob was never written', async () => {
        platformState.isTauri = true
        resetTauriFs()
        const coldKey = 'a3-cold-key-never-written'
        const chaId = 'a3-char'
        // Deliberately never call setColdStorageItem for this key.
        const db = makeDb([makeColdStub(chaId, coldKey)])

        const keepSet = await buildAssetKeepSet(db)
        await sweepTauriAssets({
            ...keepSet,
            listAssets: () => readDir('assets', { baseDir: BaseDirectory.AppData }),
            removeAsset: (relativePath) => remove(relativePath, { baseDir: BaseDirectory.AppData }),
            getBasename,
        })

        // A genuinely missing blob is indistinguishable from a transient
        // failure at this layer -- it must be kept, not deleted, the same
        // way.
        expect(tauriFsHas('assets/emotion-happy.png')).toBe(true)
        expect(tauriFsHas('assets/emotion-sad.png')).toBe(true)
        expect(tauriFsHas('assets/additional-bg.png')).toBe(true)
    })

    test("a4: the sweep must not delete assets when the blob's character.chaId does not match", async () => {
        platformState.isTauri = true
        resetTauriFs()
        const coldKey = 'a4-cold-key'
        const chaId = 'a4-char'
        // The blob is readable, but for a DIFFERENT character -- the exact
        // check this fails is the chaId check in `resolveUncleanableChars`.
        await setColdStorageItem(coldKey, { character: makeFullCharacter('a4-someone-else') })
        const db = makeDb([makeColdStub(chaId, coldKey)])

        const keepSet = await buildAssetKeepSet(db)
        await sweepTauriAssets({
            ...keepSet,
            listAssets: () => readDir('assets', { baseDir: BaseDirectory.AppData }),
            removeAsset: (relativePath) => remove(relativePath, { baseDir: BaseDirectory.AppData }),
            getBasename,
        })

        // A chaId mismatch must be treated the same as "coldData?.character"
        // being falsy -- the stub's view is kept, and its emotion/additional
        // assets must not be deleted.
        expect(tauriFsHas('assets/emotion-happy.png')).toBe(true)
        expect(tauriFsHas('assets/emotion-sad.png')).toBe(true)
        expect(tauriFsHas('assets/additional-bg.png')).toBe(true)
    })

    test('a5 CHAR: a healthy cold read still deletes exactly the unreferenced assets', async () => {
        platformState.isTauri = true
        resetTauriFs()
        fsStore.set('assets/truly-orphaned.png', new TextEncoder().encode('orphan-bytes'))
        const coldKey = 'a5-cold-key'
        const chaId = 'a5-char'
        await setColdStorageItem(coldKey, { character: makeFullCharacter(chaId) })
        const db = makeDb([makeColdStub(chaId, coldKey)])

        const keepSet = await buildAssetKeepSet(db)
        await sweepTauriAssets({
            ...keepSet,
            listAssets: () => readDir('assets', { baseDir: BaseDirectory.AppData }),
            removeAsset: (relativePath) => remove(relativePath, { baseDir: BaseDirectory.AppData }),
            getBasename,
        })

        // CHAR: unchanged before and after the fix -- a fully successful cold
        // read protects every referenced asset and deletes only the orphan.
        expect(tauriFsHas('assets/main-image.png')).toBe(true)
        expect(tauriFsHas('assets/emotion-happy.png')).toBe(true)
        expect(tauriFsHas('assets/emotion-sad.png')).toBe(true)
        expect(tauriFsHas('assets/additional-bg.png')).toBe(true)
        expect(tauriFsHas('assets/truly-orphaned.png')).toBe(false)
    })

    // a6 (CHAR, "remotes/ cleanup still runs when the asset sweep is
    // skipped") is SKIPPED: the remotes/ loop lives inline inside
    // bootstrap.ts's non-exported cleanChunks and has
    // no extracted seam (unlike the two asset-deletion loops, which
    // src/ts/storage/assetSweep.ts already isolates). Reaching it for a test
    // would mean importing bootstrap.ts itself, which pulls in its own large,
    // separately-mocked import graph (loadPlugins,
    // characterURLImport, model/modellist,
    // registerModelDynamic, etc.) well beyond this file's scope. Per the
    // task's instruction, this is reported rather than faked.
    test.skip('a6 SKIPPED: remotes/ cleanup coverage requires bootstrap.ts, out of scope for this seam-only file', () => {})

})

describe('CHORE-07 stage 7a: manual cold-storage cleanup must not delete recoverable blobs', () => {
    test('a7 / C3 CHAR: cleanColdStorage must keep a blob referenced only by an error-text message[0], with later messages too', async () => {
        platformState.isTauri = false
        resetOpfs()

        const MAIN_KEY = 'a7-main-key'
        const coldPayload = {
            message: [{ time: 1000, data: 'archived message', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        }
        const writeOk = await setColdStorageItem(MAIN_KEY, coldPayload)
        expect(writeOk).toBe(true)

        // A chat that already holds the pre-7b error text -- this is the
        // shape a chat can be left in by a failed cold read on an install
        // from before CHORE-07 stage 7b. Built directly with
        // `formatColdStorageLoadError` rather than by driving the real
        // `preLoadChat` under a simulated failure, because `preLoadChat`
        // does not write this text on a failed read (see the R1-R5 group
        // below, which pins that it leaves the pointer untouched instead).
        DBState.db = makeDb([{
            chaId: 'a7-char',
            name: 'A7 Character',
            type: 'character',
            chatPage: 0,
            chats: [makeErrorTextChat('a7-chat-0', MAIN_KEY)],
        } as unknown as CharacterFixture])

        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }

        // The user kept chatting after the error -- push further messages so
        // the fixture also covers a chat with live messages behind the
        // stale error-text pointer.
        chat.message.push({ data: 'a later message the user sent after the error' } as never)
        chat.message.push({ data: 'and one more' } as never)

        // Note: whether sendChat's risuChatParser leaves this error text
        // unchanged is NOT exercised here -- parser.svelte.ts is mocked
        // wholesale in this file (it transitively hits the stores.svelte
        // $effect.root trap), so testing the real parser would need a
        // separate, differently-mocked file.

        // Sanity: the blob is still physically present at cleanup time --
        // the earlier failure was transient, not real loss.
        const beforeItems = (await listColdStorageItems()).items
        expect(beforeItems).toContain(MAIN_KEY)

        await primeCleanupPreconditions()
        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        const afterRead = await getColdStorageItem(MAIN_KEY)
        // A blob referenced only by a chat whose message[0] carries the
        // stale error text (not a coldStorageHeader-prefixed pointer) is
        // still in use and must not be deleted as "unused".
        expect(afterItems).toContain(MAIN_KEY)
        expect(afterRead).not.toBeNull()
    })

    test("a11: cleanColdStorage must not delete a chat's key when it is referenced only inside a cold-stored character's own blob", async () => {
        platformState.isTauri = false
        resetOpfs()

        const CHAT_KEY = 'a11-chat-key'
        const chatWriteOk = await setColdStorageItem(CHAT_KEY, {
            message: [{ time: 1, data: 'archived', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })
        expect(chatWriteOk).toBe(true)

        // The character's full data (as cold-stored) already contains a chat
        // whose pointer was corrupted to the error text BEFORE the character
        // itself went cold -- a stub's `coldStoragedChats` lists only chats whose
        // message[0] still started with coldStorageHeader when the character was
        // cold-stored, so this key is silently absent from the stub's
        // coldStoragedChats.
        const CHAR_CHA_ID = 'a11-char'
        const COLD_CHAR_KEY = 'a11-cold-char-key'
        await setColdStorageItem(COLD_CHAR_KEY, {
            character: {
                type: 'character',
                chaId: CHAR_CHA_ID,
                name: 'A11 Character',
                chatPage: 0,
                chats: [makeErrorTextChat('a11-inner-chat-0', CHAT_KEY)],
            },
        })

        // The stub left in DBState.db, in the shape a cold-stored character
        // leaves in the list.
        DBState.db = makeDb([{
            chaId: CHAR_CHA_ID,
            name: 'A11 Character',
            type: 'character',
            chatPage: 0,
            coldstorage: COLD_CHAR_KEY,
            coldStoragedChats: [],
            chats: [{
                message: [{ time: Date.now(), data: '', role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        } as unknown as CharacterFixture])

        const beforeItems = (await listColdStorageItems()).items
        expect(beforeItems).toContain(CHAT_KEY)

        await primeCleanupPreconditions()
        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        const afterRead = await getColdStorageItem(CHAT_KEY)
        // cleanColdStorage must read a cold CHARACTER's own blob looking for
        // such chats too, or this key looks unused and gets deleted even
        // though it is still referenced there.
        expect(afterItems).toContain(CHAT_KEY)
        expect(afterRead).not.toBeNull()

        // Sanity: the character's own cold blob remains protected via
        // character.coldstorage.
        expect(afterItems).toContain(COLD_CHAR_KEY)
    })

    test("a11b: cleanColdStorage must abort entirely, deleting nothing, when a cold character's own blob cannot be read", async () => {
        platformState.isTauri = false
        resetOpfs()

        // Genuinely unreferenced anywhere in DBState.db -- under the fix's
        // normal rules this WOULD be a legitimate delete, except the abort
        // rule below must block the whole run.
        const ORPHAN_KEY = 'a11b-orphan-key'
        await setColdStorageItem(ORPHAN_KEY, { message: [{ time: 1, data: 'unrelated leftover data', role: 'user' }] })

        // Never written -- the cold character's blob is simply gone.
        const BROKEN_CHAR_KEY = 'a11b-broken-char-key'
        DBState.db = makeDb([{
            chaId: 'a11b-char',
            name: 'Broken Cold Character',
            type: 'character',
            chatPage: 0,
            coldstorage: BROKEN_CHAR_KEY,
            coldStoragedChats: [],
            chats: [{
                message: [{ time: Date.now(), data: '', role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        } as unknown as CharacterFixture])

        const beforeItems = (await listColdStorageItems()).items
        expect(beforeItems).toContain(ORPHAN_KEY)

        await primeCleanupPreconditions()
        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        // cleanColdStorage must attempt to read cold characters' own blobs,
        // and abort deleting anything when that read is unusable -- an
        // unreadable cold character means the "used" view is incomplete, so
        // ORPHAN_KEY must survive even though it looks ordinarily unused.
        expect(afterItems).toContain(ORPHAN_KEY)
    })

    test("a12 CHAR: cleanColdStorage aborts, deleting nothing, when a cold character blob's chaId does not match", async () => {
        platformState.isTauri = false
        resetOpfs()

        // Genuinely unreferenced anywhere in DBState.db -- would be a
        // legitimate delete under the normal rules, except the abort below
        // must block the whole run, the same as a11b's missing-blob case.
        const ORPHAN_KEY = 'a12-orphan-key'
        await setColdStorageItem(ORPHAN_KEY, { message: [{ time: 1, data: 'unrelated leftover data', role: 'user' }] })

        // The blob is readable, but for a DIFFERENT character -- this fails
        // the manual clean-up's chaId check, exactly the way it fails
        // resolveUncleanableChars's own check (a4).
        const MISMATCHED_CHAR_KEY = 'a12-mismatched-char-key'
        await setColdStorageItem(MISMATCHED_CHAR_KEY, {
            character: {
                type: 'character',
                chaId: 'a12-someone-else',
                name: 'Mismatched Character',
                chatPage: 0,
                chats: [],
            },
        })

        DBState.db = makeDb([{
            chaId: 'a12-char',
            name: 'Mismatched Cold Character',
            type: 'character',
            chatPage: 0,
            coldstorage: MISMATCHED_CHAR_KEY,
            coldStoragedChats: [],
            chats: [{
                message: [{ time: Date.now(), data: '', role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        } as unknown as CharacterFixture])

        const beforeItems = (await listColdStorageItems()).items
        expect(beforeItems).toContain(ORPHAN_KEY)
        expect(beforeItems).toContain(MISMATCHED_CHAR_KEY)

        await primeCleanupPreconditions()
        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        // CHAR: a chaId mismatch is treated the same as an unreadable blob --
        // the whole cleanup aborts, so even the unrelated genuinely-orphaned
        // key survives this run.
        expect(afterItems).toContain(ORPHAN_KEY)
        expect(afterItems).toContain(MISMATCHED_CHAR_KEY)
    })

    test("a13 CHAR: cleanColdStorage keeps a cold character's own still-pointer-formatted chat key even when the stub has no coldStoragedChats", async () => {
        platformState.isTauri = false
        resetOpfs()

        const POINTER_CHAT_KEY = 'a13-pointer-chat-key'
        await setColdStorageItem(POINTER_CHAT_KEY, {
            message: [{ time: 1, data: 'archived', role: 'user' }],
            hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
            hypaV3Data: { summaries: [] },
            scriptstate: {},
            localLore: [],
        })

        // The cold character's own blob has a chat whose message[0] is
        // STILL a live coldStorageHeader pointer (never corrupted) -- the
        // pointer-key case, not the error-text case a11 exercises.
        const CHAR_CHA_ID = 'a13-char'
        const COLD_CHAR_KEY = 'a13-cold-char-key'
        await setColdStorageItem(COLD_CHAR_KEY, {
            character: {
                type: 'character',
                chaId: CHAR_CHA_ID,
                name: 'A13 Character',
                chatPage: 0,
                chats: [makeColdChat('a13-inner-chat-0', POINTER_CHAT_KEY)],
            },
        })

        // The stub predates coldStoragedChats entirely (the F1 plan's
        // "backstop stubs written between 52aee0d1 and c4783544" case) --
        // the field is omitted, not just an empty array, so
        // listColdDataKeysFromDb's own `character.coldStoragedChats ?? []`
        // has nothing to read either.
        DBState.db = makeDb([{
            chaId: CHAR_CHA_ID,
            name: 'A13 Character',
            type: 'character',
            chatPage: 0,
            coldstorage: COLD_CHAR_KEY,
            chats: [{
                message: [{ time: Date.now(), data: '', role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        } as unknown as CharacterFixture])

        await primeCleanupPreconditions()
        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        // CHAR: a pointer inside a cold character's own blob keeps its target
        // unit alive. The stub lists no coldStoragedChats and carries no
        // pointer of its own, so the only reference to POINTER_CHAT_KEY is the
        // chat inside the blob; a clean-up that reads only the stub, or only
        // the error-text form of a reference, would delete it.
        expect(afterItems).toContain(POINTER_CHAT_KEY)
    })

    test('a8 CHAR: a near-miss error-text string is not treated as a recoverable pointer', async () => {
        platformState.isTauri = false
        resetOpfs()

        const NEAR_MISS_KEY = 'a8-near-miss-key'
        await setColdStorageItem(NEAR_MISS_KEY, { message: [{ time: 1, data: 'unrelated leftover', role: 'user' }] })

        DBState.db = makeDb([{
            chaId: 'a8-char',
            name: 'A8 Character',
            type: 'character',
            chatPage: 0,
            chats: [{
                message: [{
                    time: 1,
                    // Extra text around an otherwise-exact match -- a near
                    // miss, not the anchored template.
                    data: `note: [Cold storage data could not be loaded. Key: ${NEAR_MISS_KEY}] (seen by support)`,
                    role: 'char',
                }],
                note: '',
                name: '',
                localLore: [],
            }],
        } as unknown as CharacterFixture])

        await primeCleanupPreconditions()
        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        // CHAR: a prefixed/suffixed near-miss is plain chat text, not a
        // recognized pointer, both before and after the fix -- its blob
        // stays ordinarily unused and gets cleaned up.
        expect(afterItems).not.toContain(NEAR_MISS_KEY)
    })

    test("a9: collectColdStorageBackupPayloads carries the unit a live chat's legacy error text names", async () => {
        platformState.isTauri = false
        resetOpfs()

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
 * a7 above was re-fixtured into a C3-equivalent CHAR test for the same
 * reason -- see its own comment.
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

    test('R1: a transient OPFS read failure leaves the chat untouched and resolves "error"', async () => {
        platformState.isTauri = false
        resetOpfs()

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

        armTransientOpfsFailure(coldKey)
        const result = await preLoadChat(0, 0)

        // A transient OPFS read failure must resolve 'error' without ever
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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
 * CHORE-07 stage 7c-1 -- `readColdStorageItem`'s per-backend classification
 * seams (`classifyTauriColdRead`/`classifyOpfsColdRead`/
 * `classifyNodeColdRead`), Agents/Reports/13-chore07-cold-read-failure-plan.md.
 * Each classifies a raw read outcome for its backend as `missing` (the
 * file, key or directory genuinely doesn't exist) or `error` (anything else
 * -- permission, corruption, an unrelated OS error), so a caller can tell a
 * transient or ambiguous failure apart from a confirmed absence. No
 * platform mocking is needed for these -- every dependency is a plain
 * injected function.
 */
describe('CHORE-07 stage 7c-1: classifyTauriColdRead', () => {
    test('"(os error 2)" with exists() false is missing', async () => {
        const readFileFn = vi.fn(async () => { throw new Error('reading file failed: (os error 2)') })
        const existsFn = vi.fn(async () => false)
        const result = await classifyTauriColdRead('./coldstorage/x.json', readFileFn, existsFn)
        expect(result).toEqual({ status: 'missing' })
        expect(existsFn).toHaveBeenCalledTimes(1)
    })

    test('"(os error 2)" with exists() true is error, not missing', async () => {
        const readError = new Error('reading file failed: (os error 2)')
        const readFileFn = vi.fn(async () => { throw readError })
        const existsFn = vi.fn(async () => true)
        const result = await classifyTauriColdRead('./coldstorage/x.json', readFileFn, existsFn)
        expect(result.status).toBe('error')
        expect((result as { error: unknown }).error).toBe(readError)
    })

    test('an exists() throw is error, not missing', async () => {
        const readFileFn = vi.fn(async () => { throw new Error('reading file failed: (os error 2)') })
        const existsError = new Error('simulated Tauri fs scope violation')
        const existsFn = vi.fn(async () => { throw existsError })
        const result = await classifyTauriColdRead('./coldstorage/x.json', readFileFn, existsFn)
        expect(result.status).toBe('error')
        expect((result as { error: unknown }).error).toBe(existsError)
    })

    test('"(os error 3)" is error, and never calls exists()', async () => {
        const readFileFn = vi.fn(async () => { throw new Error('reading file failed: (os error 3)') })
        const existsFn = vi.fn(async () => false)
        const result = await classifyTauriColdRead('./coldstorage/x.json', readFileFn, existsFn)
        expect(result.status).toBe('error')
        expect(existsFn).not.toHaveBeenCalled()
    })
})

describe('CHORE-07 stage 7c-1: classifyOpfsColdRead', () => {
    test('a NotFoundError from getFileHandle() is missing', async () => {
        const getDirectoryFn = vi.fn(async () => ({
            getFileHandle: vi.fn(async () => { throw new MockNotFoundError('not found') }),
        }))
        const result = await classifyOpfsColdRead(getDirectoryFn as never, 'coldstorage_x.json')
        expect(result).toEqual({ status: 'missing' })
    })

    test('a TypeMismatchError from getFileHandle() is error, not missing', async () => {
        const getDirectoryFn = vi.fn(async () => ({
            getFileHandle: vi.fn(async () => { throw new FakeTypeMismatchError('type mismatch') }),
        }))
        const result = await classifyOpfsColdRead(getDirectoryFn as never, 'coldstorage_x.json')
        expect(result.status).toBe('error')
    })

    test('a NotFoundError from getDirectory() is error, not missing', async () => {
        // A NotFoundError here is about OPFS's root directory, not about
        // `filename` -- it must never be conflated with "this file doesn't
        // exist". Distinguishing the two error sites is the whole point of
        // this seam having a separate try/catch around `getDirectoryFn()`.
        const getDirectoryFn = vi.fn(async () => { throw new MockNotFoundError('directory not found') })
        const result = await classifyOpfsColdRead(getDirectoryFn as never, 'coldstorage_x.json')
        expect(result.status).toBe('error')
        expect(getDirectoryFn).toHaveBeenCalledTimes(1)
    })
})

describe('CHORE-07 stage 7c-1: classifyNodeColdRead', () => {
    test('a null getItem is missing', async () => {
        const getItemFn = vi.fn(async () => null)
        const result = await classifyNodeColdRead(getItemFn, 'coldstorage/x')
        expect(result).toEqual({ status: 'missing' })
    })

    test('a throw is error', async () => {
        const thrown = new Error('simulated Node getItem failure')
        const getItemFn = vi.fn(async () => { throw thrown })
        const result = await classifyNodeColdRead(getItemFn, 'coldstorage/x')
        expect(result.status).toBe('error')
        expect((result as { error: unknown }).error).toBe(thrown)
    })
})

/**
 * CHORE-07 stage 7c-1 -- `readColdStorageItem` end to end, real OPFS
 * backend (same mock as the `preLoadChat`/a7-a14 groups above).
 */
describe('CHORE-07 stage 7c-1: readColdStorageItem (OPFS backend)', () => {
    test('a stored null value is ok, not missing', async () => {
        platformState.isTauri = false
        resetOpfs()

        const key = 'reader-7c1-null-key'
        const writeOk = await setColdStorageItem(key, null)
        expect(writeOk).toBe(true)

        const result = await readColdStorageItem(key)
        expect(result).toEqual({ status: 'ok', value: null })
    })

    test('a {character} blob is ok', async () => {
        platformState.isTauri = false
        resetOpfs()

        const key = 'reader-7c1-character-key'
        const payload = { character: { chaId: 'reader-7c1-char', name: 'Reader', type: 'character', chatPage: 0, chats: [] } }
        await setColdStorageItem(key, payload)

        const result = await readColdStorageItem(key)
        expect(result).toEqual({ status: 'ok', value: payload })
    })

    test('a never-stored key is missing', async () => {
        platformState.isTauri = false
        resetOpfs()

        const result = await readColdStorageItem('reader-7c1-never-stored-key')
        expect(result).toEqual({ status: 'missing' })
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
        resetOpfs()

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
        resetOpfs()

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
                    // hypav3.ts's startIdx computation reads
                    // `[...lastSummary.chatMemos].at(-1)`, which is
                    // `undefined` for an empty list if this summary ends up
                    // last. It must be removed outright instead.
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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

        const coldKey = 'rl5-error-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        armTransientOpfsFailure(coldKey)
        const errorChat = makeErrorTextChat('rl5-chat-0', coldKey)
        DBState.db = makeRetryDb('rl5-char', errorChat)
        const chat = DBState.db.characters[0].chats[0] as unknown as { message: { data: string }[] }
        const messageBefore = JSON.parse(JSON.stringify(chat.message))

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('error')
        expect(chat.message).toEqual(messageBefore)
    })

    test('RL6: "busy" when doingChat is already set before the read starts', async () => {
        platformState.isTauri = false
        resetOpfs()

        const coldKey = 'rl6-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl6-chat-0', coldKey)
        DBState.db = makeRetryDb('rl6-char', errorChat)

        doingChat.set(true)
        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('busy')
    })

    test('RL7: "busy" when the chat\'s own isStreaming is set before the read starts', async () => {
        platformState.isTauri = false
        resetOpfs()

        const coldKey = 'rl7-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = { ...makeErrorTextChat('rl7-chat-0', coldKey), isStreaming: true }
        DBState.db = makeRetryDb('rl7-char', errorChat)

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('busy')
    })

    test('RL8: "busy" when doingChat turns true during the read', async () => {
        platformState.isTauri = false
        resetOpfs()

        const coldKey = 'rl8-cold-key'
        await setColdStorageItem(coldKey, { message: [{ time: 1, data: 'x', role: 'user' }] })
        const errorChat = makeErrorTextChat('rl8-chat-0', coldKey)
        DBState.db = makeRetryDb('rl8-char', errorChat)

        const resultPromise = retryLegacyColdChatLoad(0, 0)
        // Synchronously, before the read settles, a send starts.
        doingChat.set(true)
        const result = await resultPromise

        expect(result).toBe('busy')
    })

    // Guard, not proof the race check is real: a bare `result === 'none'`
    // assertion would also pass against a naive stub that always returns
    // 'none', so this test alone cannot fail against such a stub.
    test('RL9 Guard: switching the selected character during the read resolves "none" and mutates nothing', async () => {
        platformState.isTauri = false
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

        const errorChat = { message: [{ time: 1, data: 'ordinary text', role: 'char' }], note: '', name: '', localLore: [] }
        DBState.db = makeRetryDb('rl12-char', errorChat)

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('none')
    })

    test('RL13 Guard: a near-miss error-text string resolves "none"', async () => {
        platformState.isTauri = false
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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
        resetOpfs()

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

// MC-078, MC-079, MC-082: a kept block for a frozen chaId can reference a
// cold-storage entry that the in-memory character does not currently
// reference, so cleanColdStorage refuses outright while any chaId is frozen
// -- checked once at entry, and again immediately before anything is
// removed, since verifying every cold-stored character in between is itself
// awaited and can outlast the entry check.
describe('cleanColdStorage refuses while a chaId is frozen against a save-file rewrite', () => {
    beforeEach(() => {
        frozenSaveKeysStore.set([])
        ;(alertError as ReturnType<typeof vi.fn>).mockClear()
        ;(alertClear as ReturnType<typeof vi.fn>).mockClear()
    })

    test('refuses at entry and deletes nothing when a chaId is already frozen', async () => {
        platformState.isTauri = false
        resetOpfs()
        const ORPHAN_KEY = 'g12-entry-orphan-key'
        await setColdStorageItem(ORPHAN_KEY, { message: [{ time: 1, data: 'unrelated leftover', role: 'user' }] })
        DBState.db = makeDb([])
        await primeCleanupPreconditions()
        frozenSaveKeysStore.set([{ chaId: 'g12-dup-id', names: ['A', 'B'] }])

        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        expect(afterItems).toContain(ORPHAN_KEY)
        expect(alertError).toHaveBeenCalledTimes(1)
    })

    test('refuses when a chaId becomes frozen during verification, after the entry check already passed', async () => {
        platformState.isTauri = false
        resetOpfs()
        const ORPHAN_KEY = 'g12-mid-orphan-key'
        await setColdStorageItem(ORPHAN_KEY, { message: [{ time: 1, data: 'unrelated leftover', role: 'user' }] })

        const CHAR_CHA_ID = 'g12-mid-char'
        const COLD_CHAR_KEY = 'g12-mid-cold-char-key'
        await setColdStorageItem(COLD_CHAR_KEY, {
            character: { type: 'character', chaId: CHAR_CHA_ID, name: 'G12 Character', chatPage: 0, chats: [] },
        })
        DBState.db = makeDb([{
            chaId: CHAR_CHA_ID,
            name: 'G12 Character',
            type: 'character',
            chatPage: 0,
            coldstorage: COLD_CHAR_KEY,
            coldStoragedChats: [],
            chats: [{
                message: [{ time: Date.now(), data: '', role: 'char' }],
                note: '',
                name: '',
                localLore: [],
            }],
        } as unknown as CharacterFixture])

        // Entry check passes: nothing is frozen yet (reset in beforeEach).
        await primeCleanupPreconditions()
        const originalGetFileHandle = mockDirectoryHandle.getFileHandle.bind(mockDirectoryHandle)
        const spy = vi.spyOn(mockDirectoryHandle, 'getFileHandle').mockImplementation(async (name: string, opts?: { create?: boolean }) => {
            if (name === opfsFilename(COLD_CHAR_KEY)) {
                // A duplicate chaId appears while this cold character's own
                // blob is being verified -- after the entry check, before
                // anything is removed.
                frozenSaveKeysStore.set([{ chaId: 'g12-dup-id-2', names: ['C', 'D'] }])
            }
            return originalGetFileHandle(name, opts)
        })

        await cleanColdStorage()
        spy.mockRestore()

        const afterItems = (await listColdStorageItems()).items
        expect(afterItems).toContain(ORPHAN_KEY)
        expect(afterItems).toContain(COLD_CHAR_KEY)
        expect(alertClear).toHaveBeenCalled()
        expect(alertError).toHaveBeenCalledTimes(1)
    })

    test('cleans normally once no chaId is frozen', async () => {
        platformState.isTauri = false
        resetOpfs()
        const ORPHAN_KEY = 'g12-clean-orphan-key'
        await setColdStorageItem(ORPHAN_KEY, { message: [{ time: 1, data: 'unrelated leftover', role: 'user' }] })
        DBState.db = makeDb([])
        frozenSaveKeysStore.set([])

        await primeCleanupPreconditions()
        await cleanColdStorage()

        const afterItems = (await listColdStorageItems()).items
        expect(afterItems).not.toContain(ORPHAN_KEY)
        expect(alertError).not.toHaveBeenCalled()
    })
})
