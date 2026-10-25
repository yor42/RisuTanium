// @vitest-environment happy-dom

/**
 * The 100 MiB warning of a `.bin` export (MC-532 2, MC-533 2, MC-534 1): before the writer opens, every asset
 * strictly larger than 100 MiB (what an upstream Node server cannot restore) is named in one confirmation. Confirming
 * keeps the items in the file; declining ends the export as declined with no file. The 4 GiB leave-out prompt stays
 * first and keeps its items. A plain-HTTP page whose user activation has lapsed after the size pass and the prompts is
 * asked for one click before the writer opens.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real together with the REAL `LocalWriter`; only its sink
 * (`streamsaver`) and the dialogs are replaced. Sizes are faked: the desktop listing reports a size as metadata, and a
 * browser value reports a `length` it does not hold, so no test allocates 100 MiB. A passing test here is no evidence
 * about a real browser store, a real Tauri listing or the Node server (`nodeListSized.test.ts` covers the route).
 *
 * Titles: `reproducer` fails on the code before the warning existed; `guard` passes before and after and pins what
 * must not move.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], opened: 0, useBlobFallback: false }))
const sizedBox = vi.hoisted(() => ({ items: [] as Array<{ key: string, size: number }>, batchReads: [] as string[][], available: true }))
const webFiles = vi.hoisted(() => new Map<string, Uint8Array>())
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertNormalWaitMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<void> => { }))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
}) as unknown as typeof import('src/ts/reloadGuard'))

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
        get useBlobFallback() { return backupSink.useBlobFallback },
        createWriteStream: () => {
            backupSink.opened++
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
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
    isAssetBatchAvailable: () => sizedBox.available,
    isAssetBatchReadAvailable: () => sizedBox.available,
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
    alertNormalWait: alertNormalWaitMock,
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

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

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

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData: vi.fn(() => true),
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { UPSTREAM_HARD_LIMIT_BYTES } from 'src/ts/drive/exportInline'
import { webWriterNeedsGesture } from 'src/ts/exportWriters'
import { getAppStore, injectAppStore, type AppStoreKind } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { inlayBodyKey, inlayMetaKey } from 'src/ts/process/files/inlayKeys'

//#region helpers

const MIB = 1024 * 1024
const LIMIT = 100 * MIB
const FOUR_GIB = UPSTREAM_HARD_LIMIT_BYTES
const UPSTREAM_PROMPT = 'larger than 100 MiB'
const FOUR_GIB_PROMPT = '4 GiB or more'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A value that reports `length` bytes and holds one. */
function lengthLike(length: number): Uint8Array {
    const value = new Uint8Array(1)
    Object.defineProperty(value, 'length', { value: length })
    return value
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

function entryNames(): string[] {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const names: string[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        names.push(decoder.decode(bytes.subarray(offset, offset + nameLength)))
        offset += nameLength
        if (offset + 4 > bytes.length) {
            break
        }
        offset += 4 + view.getUint32(offset, true)
    }
    return names
}

const upstreamPrompts = (): string[] => alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((text) => text.includes(UPSTREAM_PROMPT))
const fourGibPrompts = (): string[] => alertConfirmMock.mock.calls.map((c) => String(c[0])).filter((text) => text.includes(FOUR_GIB_PROMPT))

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
}

/** Reads of the page's store, by key, in order. */
const storeReads: string[] = []

function injectStore(kind: AppStoreKind): void {
    const base = createForageBackedStore({
        getItem: async (key) => webFiles.get(key) ?? null,
        setItem: async (key, value) => { webFiles.set(key, value) },
        keys: async () => [...webFiles.keys()],
        removeItem: async (key) => { webFiles.delete(key) },
    })
    // Only `read` is logged: `has` answers without transferring the value.
    injectAppStore({
        ...base,
        read: async (key) => {
            storeReads.push(key)
            return await base.read(key)
        },
    }, kind)
}

function setActivation(isActive: boolean | undefined): void {
    Object.defineProperty(navigator, 'userActivation', { value: isActive === undefined ? undefined : { isActive }, configurable: true })
}

function setSecureContext(secure: boolean): void {
    Object.defineProperty(globalThis, 'isSecureContext', { value: secure, configurable: true })
}

/** The desktop listing of a full backup: assets with their sizes (metadata only), in listing order. */
function listAssets(...items: Array<[string, number]>): void {
    sizedBox.items = items.map(([key, size]) => ({ key, size }))
    // The listing reports the size as metadata; the bytes an asset above the batch size is read from stay small.
    for (const [key] of items) {
        webFiles.set(key, encoder.encode(`bytes of ${key}`))
    }
}

/** Browser-store assets: a number is a faked size, a string the real content. */
function plantAssets(...items: Array<[string, number]>): void {
    for (const [key, size] of items) {
        webFiles.set(key, lengthLike(size))
    }
}

function plantInlay(id: string, length: number): void {
    const bodyKey = inlayBodyKey(id, '0123456789abcdef')
    const metaKey = inlayMetaKey(id)
    if (bodyKey === null || metaKey === null) {
        throw new Error('the fixture inlay id has no key')
    }
    webFiles.set(bodyKey, new Uint8Array(4))
    webFiles.set(metaKey, encoder.encode(JSON.stringify({ v: 1, repr: 'blob', mime: 'image/png', len: length, body: bodyKey, fields: {} })))
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.opened = 0
    backupSink.useBlobFallback = false
    sizedBox.items = []
    sizedBox.batchReads.length = 0
    sizedBox.available = true
    webFiles.clear()
    storeReads.length = 0
    alertConfirmMock.mockReset().mockImplementation(async () => true)
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    setActivation(true)
    setSecureContext(true)
    getDatabaseMock.mockImplementation(() => databaseWith({}))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('SaveLocalBackup, assets sized by the desktop listing', () => {
    beforeEach(() => {
        injectStore('tauri')
        getDatabaseMock.mockImplementation(() => databaseWith({ customBackground: 'assets/big-bg' }))
    })

    test('reproducer: an asset above 100 MiB is named once, with its size and what uses it, before the writer opens', async () => {
        listAssets(['assets/aaa-small', 10], ['assets/big-bg', 150 * MIB], ['assets/zzz-small', 12])
        let openedAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(UPSTREAM_PROMPT)) {
                openedAtPrompt = backupSink.opened
            }
            return true
        })

        await SaveLocalBackup()

        expect(upstreamPrompts()).toHaveLength(1)
        expect(upstreamPrompts()[0]).toContain("'Custom Background' from User Settings (150.0 MiB)")
        expect(upstreamPrompts()[0]).not.toContain('aaa-small')
        expect(openedAtPrompt).toBe(0)
    })

    test('reproducer: declining ends the export as declined with no file, no writer and no asset read', async () => {
        listAssets(['assets/aaa-small', 10], ['assets/big-bg', LIMIT + 1])
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(UPSTREAM_PROMPT))

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual({ status: 'declined', cause: 'oversize-declined' })
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
        expect(sizedBox.batchReads).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('reproducer: confirming keeps the asset in the file and reports nothing as left out', async () => {
        listAssets(['assets/aaa-small', 10], ['assets/big-bg', 150 * MIB])

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved', omitted: { oversize: [] } })
        expect(entryNames()).toContain('big-bg')
        expect(entryNames()).toContain('aaa-small')
    })

    test('the limit is exact: 100 MiB is not named, one byte more is (the first half passes before the warning too)', async () => {
        listAssets(['assets/at-limit', LIMIT])
        await SaveLocalBackup()
        expect(upstreamPrompts()).toEqual([])

        alertConfirmMock.mockClear()
        listAssets(['assets/at-limit', LIMIT], ['assets/one-more', LIMIT + 1])
        await SaveLocalBackup()
        expect(upstreamPrompts()).toHaveLength(1)
        expect(upstreamPrompts()[0]).toContain('one-more')
        expect(upstreamPrompts()[0]).not.toContain('at-limit')
    })

    test('reproducer (4 GiB precedence): with a 4 GiB asset and a 101 MiB asset the 4 GiB prompt comes first and keeps its item, then the 100 MiB prompt names only the other', async () => {
        listAssets(['assets/huge', FOUR_GIB], ['assets/mid', 101 * MIB], ['assets/small', 3])

        const outcome = await SaveLocalBackup()

        const prompts = alertConfirmMock.mock.calls.map((c) => String(c[0]))
        const fourIndex = prompts.findIndex((p) => p.includes(FOUR_GIB_PROMPT))
        const upstreamIndex = prompts.findIndex((p) => p.includes(UPSTREAM_PROMPT))
        expect(fourIndex).toBeGreaterThanOrEqual(0)
        expect(upstreamIndex).toBeGreaterThan(fourIndex)
        expect(prompts[fourIndex]).toContain('huge')
        expect(prompts[fourIndex]).not.toContain('mid')
        expect(prompts[upstreamIndex]).toContain('mid')
        expect(prompts[upstreamIndex]).not.toContain('huge')
        expect(outcome).toMatchObject({ status: 'saved' })
        expect(entryNames()).not.toContain('huge')
        expect(entryNames()).toContain('mid')
    })

    test('guard: only a 4 GiB asset asks the 4 GiB prompt alone, and only one prompt of each kind ever shows', async () => {
        listAssets(['assets/huge', FOUR_GIB], ['assets/small', 3])

        await SaveLocalBackup()

        expect(fourGibPrompts()).toHaveLength(1)
        expect(upstreamPrompts()).toEqual([])
    })

    test('guard: nothing oversize asks nothing and writes everything', async () => {
        listAssets(['assets/a', 10], ['assets/b', 20])

        const outcome = await SaveLocalBackup()

        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(outcome).toMatchObject({ status: 'saved' })
        expect(entryNames()).toEqual(expect.arrayContaining(['a', 'b', 'database.risudat']))
    })

    test('a long list is cut to 20 names with the count of the rest', async () => {
        listAssets(...Array.from({ length: 25 }, (_, i): [string, number] => [`assets/big-${String(i).padStart(2, '0')}`, LIMIT + 1 + i]))

        await SaveLocalBackup()

        const prompt = upstreamPrompts()[0]
        expect(prompt).toContain('25 item(s)')
        expect(prompt).toContain('big-19')
        expect(prompt).not.toContain('big-20')
        expect(prompt).toContain('...and 5 more')
    })
})

describe('SaveLocalBackup, browser store', () => {
    beforeEach(() => {
        sizedBox.available = false
        injectStore('indexeddb')
    })

    test('reproducer: an asset above 100 MiB is found by reading it once before the writer opens, and is named', async () => {
        plantAssets(['assets/small', 10], ['assets/big', 150 * MIB])
        let openedAtPrompt = -1
        let readsAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(UPSTREAM_PROMPT)) {
                openedAtPrompt = backupSink.opened
                readsAtPrompt = storeReads.filter((key) => key === 'assets/big').length
            }
            return true
        })

        await SaveLocalBackup()

        expect(upstreamPrompts()).toHaveLength(1)
        expect(upstreamPrompts()[0]).toContain("'assets/big' (150.0 MiB)")
        expect(openedAtPrompt).toBe(0)
        expect(readsAtPrompt).toBe(1)
        expect(entryNames()).toContain('big')
    })

    test('reproducer: declining ends the export as declined with no file', async () => {
        plantAssets(['assets/small', 10], ['assets/big', LIMIT + 1])
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(UPSTREAM_PROMPT))

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual({ status: 'declined', cause: 'oversize-declined' })
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
    })

    test('guard: exactly 100 MiB is not named', async () => {
        plantAssets(['assets/at-limit', LIMIT])

        await SaveLocalBackup()

        expect(upstreamPrompts()).toEqual([])
        expect(entryNames()).toContain('at-limit')
    })

    test('reproducer: an inlay above 100 MiB is not named and asks nothing (the backup holds it in entries of at most 64 MiB, which an upstream Node server takes)', async () => {
        plantAssets(['assets/small', 10])
        plantInlay('chat-video', 150 * MIB)
        plantInlay('chat-small', 5)

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual(expect.objectContaining({ status: 'saved' }))
        expect(upstreamPrompts()).toEqual([])
        expect(alertConfirmMock).not.toHaveBeenCalled()
    })

    test('reproducer: an oversize asset is named alone when an inlay is over 100 MiB too', async () => {
        plantAssets(['assets/big', LIMIT + 1])
        plantInlay('chat-video', LIMIT + 2)

        await SaveLocalBackup()

        expect(upstreamPrompts()).toHaveLength(1)
        expect(upstreamPrompts()[0]).toContain('1 item(s)')
        expect(upstreamPrompts()[0]).toContain('assets/big')
        expect(upstreamPrompts()[0]).not.toContain('chat-video')
    })
})

describe('SaveLocalBackup, Node store', () => {
    test('reproducer: the oversize assets come from the server listing and the pre-pass reads no asset', async () => {
        injectStore('node')
        plantAssets(['assets/small', 10], ['assets/big', 150 * MIB])
        const store = await getAppStore()
        const listSized = vi.fn(async () => [{ key: 'assets/big', size: 150 * MIB }])
        store.listSized = listSized
        let assetReadsAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(UPSTREAM_PROMPT)) {
                assetReadsAtPrompt = storeReads.filter((key) => key.startsWith('assets/')).length
            }
            return true
        })

        await SaveLocalBackup()

        expect(listSized).toHaveBeenCalledExactlyOnceWith('assets/', LIMIT)
        expect(upstreamPrompts()).toHaveLength(1)
        expect(upstreamPrompts()[0]).toContain('150.0 MiB')
        expect(assetReadsAtPrompt).toBe(0)
    })

    test('guard: a server that cannot answer the sized listing asks nothing', async () => {
        injectStore('node')
        plantAssets(['assets/small', 10])
        const store = await getAppStore()
        store.listSized = async () => null

        await SaveLocalBackup()

        expect(alertConfirmMock).not.toHaveBeenCalled()
    })

    test('guard: a sized listing that rejects (a server error) fails the export with no writer opened and no file', async () => {
        injectStore('node')
        plantAssets(['assets/small', 10])
        const store = await getAppStore()
        store.listSized = async () => { throw new Error('the server answered 502') }

        const outcome = await SaveLocalBackup()

        expect(outcome).toEqual(expect.objectContaining({ status: 'failed' }))
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
        expect(upstreamPrompts()).toEqual([])
    })
})

describe('SavePartialLocalBackup', () => {
    beforeEach(() => {
        getDatabaseMock.mockImplementation(() => databaseWith({ userIcon: 'assets/icon' }))
    })

    test('reproducer: a profile image above 100 MiB is named (and an unreferenced oversize asset is not) before the writer opens; desktop listing', async () => {
        injectStore('tauri')
        listAssets(['assets/icon', 150 * MIB], ['assets/unreferenced', 200 * MIB])
        let openedAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(UPSTREAM_PROMPT)) {
                openedAtPrompt = backupSink.opened
            }
            return true
        })

        await SavePartialLocalBackup()

        expect(upstreamPrompts()).toHaveLength(1)
        expect(upstreamPrompts()[0]).toContain("'User Icon' from User Settings (150.0 MiB)")
        expect(upstreamPrompts()[0]).not.toContain('unreferenced')
        expect(openedAtPrompt).toBe(0)
    })

    test('reproducer: declining ends a partial export as declined with no file', async () => {
        injectStore('tauri')
        listAssets(['assets/icon', LIMIT + 1])
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(UPSTREAM_PROMPT))

        const outcome = await SavePartialLocalBackup()

        expect(outcome).toEqual({ status: 'declined', cause: 'oversize-declined' })
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
    })

    test('reproducer: on a browser store only the profile image is read to size it', async () => {
        sizedBox.available = false
        injectStore('indexeddb')
        plantAssets(['assets/icon', 150 * MIB], ['assets/other', 300 * MIB])

        const outcome = await SavePartialLocalBackup()

        expect(upstreamPrompts()).toHaveLength(1)
        expect(upstreamPrompts()[0]).toContain('150.0 MiB')
        expect(storeReads.filter((key) => key === 'assets/other')).toEqual([])
        expect(outcome).toMatchObject({ status: 'saved' })
        expect(entryNames()).toContain('icon')
    })

    test('guard: with nothing oversize the partial export asks nothing about size', async () => {
        sizedBox.available = false
        injectStore('indexeddb')
        plantAssets(['assets/icon', 10])

        await SavePartialLocalBackup()

        expect(upstreamPrompts()).toEqual([])
    })
})

describe('the ready-to-save prompt', () => {
    beforeEach(() => {
        sizedBox.available = false
        injectStore('indexeddb')
        plantAssets(['assets/small', 10])
        setSecureContext(false)
    })

    const readyCalls = () => alertNormalWaitMock.mock.calls.filter((c) => String(c[0]).includes('ready to save'))

    test('reproducer: a plain-HTTP page whose activation has lapsed is asked for a click before the writer opens', async () => {
        setActivation(false)
        let openedAtPrompt = -1
        alertNormalWaitMock.mockImplementation(async () => {
            openedAtPrompt = backupSink.opened
            setActivation(true)
        })

        const outcome = await SaveLocalBackup()

        expect(readyCalls()).toHaveLength(1)
        expect(openedAtPrompt).toBe(0)
        expect(outcome).toMatchObject({ status: 'saved' })
    })

    test('reproducer: activation that lapses after the size confirmation is checked after it, not before', async () => {
        plantAssets(['assets/big', LIMIT + 1])
        setActivation(true)
        alertConfirmMock.mockImplementation(async () => {
            setActivation(false)
            return true
        })
        alertNormalWaitMock.mockImplementation(async () => { setActivation(true) })

        await SaveLocalBackup()

        expect(upstreamPrompts()).toHaveLength(1)
        expect(readyCalls()).toHaveLength(1)
        expect(alertConfirmMock.mock.invocationCallOrder[0]).toBeLessThan(alertNormalWaitMock.mock.invocationCallOrder[0])
    })

    test('reproducer: a partial export asks too', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith({ userIcon: 'assets/small' }))
        setActivation(false)

        await SavePartialLocalBackup()

        expect(readyCalls()).toHaveLength(1)
    })

    test('guard: live activation asks nothing', async () => {
        setActivation(true)
        await SaveLocalBackup()
        expect(readyCalls()).toHaveLength(0)
    })

    test('guard: a secure page (hidden frame and service worker) needs no click even if activation lapsed', async () => {
        setSecureContext(true)
        setActivation(false)
        await SaveLocalBackup()
        expect(readyCalls()).toHaveLength(0)
    })

    test('guard: a page that keeps the download in memory needs no click', async () => {
        backupSink.useBlobFallback = true
        setActivation(false)
        await SaveLocalBackup()
        expect(readyCalls()).toHaveLength(0)
    })

    test('guard: a browser without the activation API is treated as active', async () => {
        setActivation(undefined)
        await SaveLocalBackup()
        expect(readyCalls()).toHaveLength(0)
    })
})

describe('webWriterNeedsGesture', () => {
    test('new behaviour: only the popup helper of a plain-HTTP page that does not collect in memory needs a gesture', () => {
        const cases: Array<[boolean, boolean, boolean, boolean]> = [
            // isTauri, secure, blob fallback, needs a gesture
            [false, false, false, true],
            [false, true, false, false],
            [false, false, true, false],
            [true, false, false, false],
        ]
        for (const [tauri, secure, fallback, expected] of cases) {
            platformBox.isTauri = tauri
            setSecureContext(secure)
            backupSink.useBlobFallback = fallback
            expect(webWriterNeedsGesture()).toBe(expected)
        }
    })
})
