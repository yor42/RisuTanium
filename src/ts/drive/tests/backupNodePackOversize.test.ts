// @vitest-environment happy-dom

/**
 * A full `.bin` export on a Node server page never names an installed theme pack's archive in the 100 MiB upstream
 * warning, even when the server's sized listing answers one above the limit: the Node route lists the server again
 * instead of reading the export's filtered listing, so the warning filters pack keys itself. No pack entry reaches the file.
 *
 * `SaveLocalBackup` runs for real together with the REAL `LocalWriter`; only its sink (`streamsaver`) and the dialogs are
 * replaced, and the sized answer is faked metadata. Mirrors the `SaveLocalBackup, Node store` harness of
 * `backupUpstreamWarning.test.ts`. A passing test here is no evidence about the real Node server.
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

import { SaveLocalBackup } from 'src/ts/drive/backuplocal'
import { getAppStore, injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'

//#region helpers

const MIB = 1024 * 1024
const UPSTREAM_PROMPT = 'larger than 100 MiB'
const PACK_KEY = `assets/tp-${'ab'.repeat(32)}.risutheme`
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

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.opened = 0
    sizedBox.items = []
    sizedBox.batchReads.length = 0
    sizedBox.available = true
    webFiles.clear()
    alertConfirmMock.mockReset().mockImplementation(async () => true)
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: true }, configurable: true })
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true })
    getDatabaseMock.mockImplementation(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('SaveLocalBackup, Node store, an installed pack archive above 100 MiB', () => {
    test('reproducer: the server listing answers the pack at 150 MiB; no upstream-oversize prompt names it and the file holds no pack entry', async () => {
        injectAppStore({
            ...createForageBackedStore({
                getItem: async (key) => webFiles.get(key) ?? null,
                setItem: async (key, value) => { webFiles.set(key, value) },
                keys: async () => [...webFiles.keys()],
                removeItem: async (key) => { webFiles.delete(key) },
            }),
        }, 'node')
        webFiles.set('assets/small', lengthLike(10))
        webFiles.set(PACK_KEY, lengthLike(150 * MIB))
        const store = await getAppStore()
        store.listSized = vi.fn(async () => [{ key: PACK_KEY, size: 150 * MIB }])

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(upstreamPrompts()).toEqual([])
        expect(entryNames()).toContain('small')
        expect(entryNames().filter((name) => name.startsWith('tp-'))).toEqual([])
        expect(webFiles.has(PACK_KEY)).toBe(true)
    })
})
