/**
 * The asset functions of `globalApi.svelte.ts` (`getFileSrc`, `readImage`,
 * `loadAsset`, `saveAsset`) on each platform, with the real module graph from
 * the facade down to the byte store:
 *
 * - Tauri: the real desktop files store over the in-memory file system in
 *   `tauriFsFake.ts` and the path/URL stand-in in `tauriPathFake.ts`.
 * - Node server: the real `NodeStorage` and Node HTTP store behind the
 *   `FakeNodeServer` stand-in.
 * - Web: a store injected through `injectAppStore`, over a `Map`.
 *
 * Everything else the facade imports is mocked. A pass here says nothing about
 * the native plugin, the real server or a browser.
 *
 * Titles say what a test pins: `guard` tests assert behaviour that holds before
 * and after the assets moved behind the byte store, `new behaviour` tests
 * assert what only the store-based facade does.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { FakeNodeServer } from './manualCleanupHarness'
import { OS_ERROR_ACCESS_DENIED } from './tauriFsFake'
import type { ByteStore, ReadResult } from 'src/ts/storage/store/contract'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    os: 'linux' as 'linux' | 'windows',
    keyPair: null as CryptoKeyPair | null,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())
const desktop = await vi.hoisted(async () => {
    const fake = await import('src/ts/storage/tests/tauriDesktopFake')
    const CAP = 4 * 1024 * 1024
    const bounded = fake.createBoundedFs(fakeFs, { cap: CAP })
    // The plugin module gains `open` (a desktop user-file read opens the file and reads it in pieces), and its
    // whole-file `readFile` and `writeFile` refuse a payload above the per-call bound; `writeFile` also appends.
    const readFile = fakeFs.module.readFile as (path: string, ...rest: unknown[]) => Promise<Uint8Array>
    const writeFile = fakeFs.module.writeFile as (path: string, data: Uint8Array, options?: { append?: boolean }) => Promise<void>
    const written: number[] = []
    Object.assign(fakeFs.module, {
        open: bounded.module.open,
        readFile: async (path: string, ...rest: unknown[]) => {
            const bytes = await readFile(path, ...rest)
            if (bytes.length > CAP) {
                throw new Error(`readFile carries ${bytes.length} bytes, above the per-call bound`)
            }
            return bytes
        },
        writeFile: async (path: string, data: Uint8Array, options?: { append?: boolean }) => {
            written.push(data.length)
            if (data.length > CAP) {
                throw new Error(`writeFile carries ${data.length} bytes, above the per-call bound`)
            }
            if (options?.append === true) {
                const held = fakeFs.files.get(path) ?? new Uint8Array(0)
                const next = new Uint8Array(held.length + data.length)
                next.set(held, 0)
                next.set(data, held.length)
                fakeFs.files.set(path, next)
                return
            }
            await writeFile(path, data, options)
        },
    })
    return { invoke: fake.createDesktopInvoke(fakeFs), bounded, written }
})

//#region module mocks

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
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
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

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as Record<string, unknown> },
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
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({ ...fakePaths.coreModule, invoke: desktop.invoke.invoke }))
vi.mock('@tauri-apps/api/path', () => ({ ...fakePaths.pathModule, basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => { }) }))
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
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))

vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

// The real `hasher` hashes with `crypto.subtle.digest`, which refuses a string.
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: async (data: Uint8Array) => {
        if (!(data instanceof Uint8Array) && !ArrayBuffer.isView(data) && Object.prototype.toString.call(data) !== '[object ArrayBuffer]') {
            throw new TypeError('digest data is binary')
        }
        const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data as ArrayBuffer)
        return createHash('sha256').update(view).digest('hex')
    },
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

const PNG = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4])
const OTHER = Uint8Array.from([9, 9, 9])

function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

const PNG_KEY = `assets/${sha256Hex(PNG)}.png`

type Api = typeof import('src/ts/globalApi.svelte')
type AppStoreModule = typeof import('src/ts/storage/store/appStore')

interface World {
    api: Api
    appStore: AppStoreModule
}

/** A fresh module graph: a fresh page load for every memory the facade and the store keep. */
async function loadWorld(): Promise<World> {
    vi.resetModules()
    const api = await import('src/ts/globalApi.svelte')
    const appStore = await import('src/ts/storage/store/appStore')
    return { api, appStore }
}

interface MapStoreHandle {
    store: ByteStore
    files: Map<string, Uint8Array>
    read: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    has: ReturnType<typeof vi.fn>
}

/** A web-shaped store over a `Map` that refuses the empty key like the IndexedDB store does. */
async function mapStore(): Promise<MapStoreHandle> {
    // The error class of the module graph `loadWorld` just built, so the
    // facade's `instanceof` test sees this store's errors as its own.
    const { StoreInvalidKeyError } = await import('src/ts/storage/store/errors')
    const files = new Map<string, Uint8Array>()
    const read = vi.fn(async (key: string): Promise<ReadResult> => {
        if (key === '') {
            throw new StoreInvalidKeyError(key, 'a key is a non-empty string')
        }
        return { bytes: files.get(key) ?? null, version: null }
    })
    const write = vi.fn(async (key: string, bytes: Uint8Array) => {
        files.set(key, bytes)
        return { version: null }
    })
    const has = vi.fn(async (key: string) => files.has(key))
    const store: ByteStore = {
        capabilities: { conditionalWrites: false },
        read,
        write,
        has,
        delete: async (key) => { files.delete(key) },
        deleteMany: async (entries) => { for (const entry of entries) { files.delete(entry.key) } },
        list: async (prefix) => Array.from(files.keys()).filter((key) => key.startsWith(prefix)),
    }
    return { store, files, read, write, has }
}

function useWeb(): void {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
}

function useNode(): void {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
}

function useTauri(os: 'linux' | 'windows'): void {
    h.platform.isTauri = true
    h.platform.isNodeServer = false
    h.os = os
    const platform = os === 'windows' ? 'windows' : 'posix'
    fakeFs.setPlatform(platform)
    fakePaths.setPlatform(platform)
    fakeFs.setAppDataRoot(fakePaths.appDataDirectory(platform))
    fakeFs.directories.add('assets')
}

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.os = 'linux'
    h.keyPair = null
    fakeFs.reset()
    fakePaths.reset()
    desktop.invoke.reset()
    desktop.bounded.reset()
    desktop.written.length = 0
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('saveAsset on Tauri', () => {
    test('reproducer: a write that fails after the temp is written leaves no file at the key of a new asset and lists no temp', async () => {
        useTauri('linux')
        const { api } = await loadWorld()
        const fault = fakeFs.failWritesOf(() => true)

        await expect(api.saveAsset(PNG)).rejects.toBeDefined()

        expect(fault.fired).toBeGreaterThan(0)
        expect(fakeFs.files.has(PNG_KEY)).toBe(false)
        expect(fakeFs.listing('assets')).toEqual([])
    })

    test('reproducer: saving bytes whose asset exists succeeds without a write or a rename reaching the file', async () => {
        useTauri('linux')
        fakeFs.plant(PNG_KEY, PNG)
        const { api } = await loadWorld()
        // A rename over a file that something holds open is refused on Windows.
        fakeFs.failRenames(OS_ERROR_ACCESS_DENIED)

        await expect(api.saveAsset(PNG)).resolves.toBe(PNG_KEY)

        expect(fakeFs.writeLog).toEqual([])
        expect(fakeFs.renameLog).toEqual([])
        expect(Array.from(fakeFs.files.get(PNG_KEY) ?? [])).toEqual(Array.from(PNG))
    })

    test('new behaviour: a save of a new asset writes it through a temp in assets and returns its key', async () => {
        useTauri('windows')
        const { api } = await loadWorld()

        const key = await api.saveAsset(PNG)

        expect(key).toBe(PNG_KEY)
        expect(Array.from(fakeFs.files.get(PNG_KEY) ?? [])).toEqual(Array.from(PNG))
        expect(fakeFs.renameLog.at(-1)?.to).toBe(`./${PNG_KEY}`)
        expect(fakeFs.listing('assets')).toEqual([`${sha256Hex(PNG)}.png`])
    })

    test('new behaviour: the key is recorded as written this page load before the store is touched, and stays when the write fails', async () => {
        useTauri('linux')
        const { api } = await loadWorld()
        fakeFs.failWritesOf(() => true)
        const seenWhileWriting: boolean[] = []
        const realWrite = fakeFs.module.writeFile
        fakeFs.module.writeFile = async (path, data, options) => {
            seenWhileWriting.push(api.wasAssetWrittenThisPage(PNG_KEY))
            return await realWrite(path, data, options)
        }

        try {
            await expect(api.saveAsset(PNG)).rejects.toBeDefined()
        } finally {
            fakeFs.module.writeFile = realWrite
        }

        expect(seenWhileWriting).toEqual([true])
        expect(api.wasAssetWrittenThisPage(PNG_KEY)).toBe(true)
        expect(api.wasAssetWrittenThisPage(`assets/${sha256Hex(OTHER)}.png`)).toBe(false)
    })

    test('new behaviour: the key of a save that was skipped because the file exists is recorded too', async () => {
        useTauri('linux')
        fakeFs.plant(PNG_KEY, PNG)
        const { api } = await loadWorld()

        await api.saveAsset(PNG)

        expect(api.wasAssetWrittenThisPage(PNG_KEY)).toBe(true)
    })
})

describe('saveAsset extension', () => {
    const stem = sha256Hex(PNG)

    test.each([
        ['mp4', `assets/${stem}.mp4`],
        ['svg', `assets/${stem}.svg`],
        ['webp', `assets/${stem}.webp`],
        ['x.webp', `assets/${stem}.webp`],
        ['', `assets/${stem}.png`],
    ])('guard: the extension argument %j gives %s', async (fileName, expected) => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        expect(await api.saveAsset(PNG, '', fileName)).toBe(expected)
    })

    test('guard: the case of an extension is kept', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        expect(await api.saveAsset(PNG, '', 'x.PNG')).toBe(`assets/${stem}.PNG`)
    })

    test.each(['a/b', 'png ', 'a.', 'x.a/b', 'p?g', 'a'.repeat(17), 'übung'])(
        'reproducer: the extension argument %j is replaced by png, so the key stays one path segment',
        async (fileName) => {
            const { api, appStore } = await loadWorld()
            const handle = await mapStore()
            appStore.injectAppStore(handle.store)

            const key = await api.saveAsset(PNG, '', fileName)

            expect(key).toBe(`assets/${stem}.png`)
            expect(Array.from(handle.files.keys())).toEqual([`assets/${stem}.png`])
        },
    )

    test('new behaviour: a 16-character extension is kept', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        expect(await api.saveAsset(PNG, '', 'x.abcdef0123456789')).toBe(`assets/${stem}.abcdef0123456789`)
    })
})

describe('saveAsset input', () => {
    test('new behaviour: a string is refused with a TypeError before anything is written or recorded', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store)

        await expect(api.saveAsset('not bytes' as unknown as Uint8Array)).rejects.toBeInstanceOf(TypeError)
        await expect(api.saveAsset(null as unknown as Uint8Array)).rejects.toBeInstanceOf(TypeError)
        await expect(api.saveAsset({ length: 3 } as unknown as Uint8Array)).rejects.toBeInstanceOf(TypeError)

        expect(handle.write).not.toHaveBeenCalled()
    })

    test('new behaviour: an ArrayBuffer and another view are stored as the same bytes without a copy', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store)
        const buffer = PNG.slice().buffer
        const view = new DataView(OTHER.slice().buffer)

        const fromBuffer = await api.saveAsset(buffer)
        const fromView = await api.saveAsset(view)

        expect(fromBuffer).toBe(PNG_KEY)
        expect(fromView).toBe(`assets/${sha256Hex(OTHER)}.png`)
        const [bufferArgs, viewArgs] = handle.write.mock.calls
        expect((bufferArgs[1] as Uint8Array).buffer).toBe(buffer)
        expect((viewArgs[1] as Uint8Array).buffer).toBe(view.buffer)
        expect(bufferArgs[2]).toBe('unconditional')
    })

    test('new behaviour: a save on the web never asks the store whether the key exists', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store)

        await api.saveAsset(PNG)
        await api.saveAsset(PNG)

        expect(handle.has).not.toHaveBeenCalled()
        expect(handle.write).toHaveBeenCalledTimes(2)
    })

    test('new behaviour: the key is recorded before the store write starts', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        const seen: boolean[] = []
        handle.write.mockImplementation(async (key: string) => {
            seen.push(api.wasAssetWrittenThisPage(key))
            return { version: null }
        })
        appStore.injectAppStore(handle.store)

        await api.saveAsset(PNG)

        expect(seen).toEqual([true])
    })
})

describe('saveAsset on the Node server', () => {
    let server: FakeNodeServer

    beforeEach(() => {
        server = new FakeNodeServer()
        vi.stubGlobal('fetch', server.fetch)
    })

    test('reproducer: after a read, a peer delete and a re-save of the same asset the save succeeds', async () => {
        useNode()
        server.seed(PNG_KEY, PNG)
        const { api } = await loadWorld()
        expect(Array.from(await api.readImage(PNG_KEY))).toEqual(Array.from(PNG))
        server.peerRemove(PNG_KEY)

        await expect(api.saveAsset(PNG)).resolves.toBe(PNG_KEY)

        expect(Array.from(server.files.get(PNG_KEY)?.bytes ?? [])).toEqual(Array.from(PNG))
    })

    test('reproducer: after a read and a peer rewrite the save of the same asset still succeeds', async () => {
        useNode()
        server.seed(PNG_KEY, PNG)
        const { api } = await loadWorld()
        await api.readImage(PNG_KEY)
        server.peerWrite(PNG_KEY, OTHER)

        await expect(api.saveAsset(PNG)).resolves.toBe(PNG_KEY)

        expect(Array.from(server.files.get(PNG_KEY)?.bytes ?? [])).toEqual(Array.from(PNG))
    })
})

describe('readImage and loadAsset', () => {
    test.each(['readImage', 'loadAsset'] as const)('guard: %s of a missing asset resolves null on the web', async (name) => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        expect(await api[name]('assets/missing.png')).toBeNull()
    })

    test.each(['readImage', 'loadAsset'] as const)('new behaviour: %s of a present asset on the web reads through the store and returns a Buffer over the stored bytes', async (name) => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        handle.files.set(PNG_KEY, PNG)
        appStore.injectAppStore(handle.store)

        const result = await api[name](PNG_KEY)

        expect(handle.read).toHaveBeenCalledWith(PNG_KEY)
        expect(Buffer.isBuffer(result)).toBe(true)
        expect(Array.from(result)).toEqual(Array.from(PNG))
        expect(result.buffer).toBe(PNG.buffer)
    })

    test('new behaviour: a key the store cannot address reads as absent on the web', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        expect(await api.readImage('')).toBeNull()
    })

    test('new behaviour: a read error from the store that is not an absent key rejects on the web', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        handle.read.mockRejectedValue(new Error('storage failed'))
        appStore.injectAppStore(handle.store)

        await expect(api.readImage(PNG_KEY)).rejects.toThrow('storage failed')
        await expect(api.loadAsset(PNG_KEY)).rejects.toThrow('storage failed')
    })

    test.each(['readImage', 'loadAsset'] as const)('guard: %s of a missing asset resolves null on the Node server and of a present one returns a Buffer', async (name) => {
        useNode()
        const server = new FakeNodeServer()
        vi.stubGlobal('fetch', server.fetch)
        server.seed(PNG_KEY, PNG)
        const { api } = await loadWorld()

        expect(await api[name]('assets/missing.png')).toBeNull()
        const present = await api[name](PNG_KEY)
        expect(Buffer.isBuffer(present)).toBe(true)
        expect(Array.from(present)).toEqual(Array.from(PNG))
    })

    test.each(['readImage', 'loadAsset'] as const)('guard: %s of a missing asset rejects on Tauri and of a present one returns its bytes', async (name) => {
        useTauri('linux')
        fakeFs.plant(PNG_KEY, PNG)
        const { api } = await loadWorld()

        await expect(api[name]('assets/missing.png')).rejects.toBeDefined()
        const present = await api[name](PNG_KEY)
        expect(Array.from(present)).toEqual(Array.from(PNG))
        expect(Buffer.isBuffer(present)).toBe(false)
    })

    test('readImage of a path outside assets on Tauri reads that path as given', async () => {
        useTauri('linux')
        fakeFs.plant('/legacy/photo.png', OTHER)
        const { api } = await loadWorld()

        expect(Array.from(await api.readImage('/legacy/photo.png'))).toEqual(Array.from(OTHER))
        expect(desktop.bounded.opened).toEqual(['/legacy/photo.png'])
        expect(fakeFs.calls.filter((call) => call.op === 'readFile')).toEqual([])
    })
})

describe('getFileSrc', () => {
    const WINDOWS_ASSET_URL = `http://asset.localhost/C%3A%5CUsers%5Ctester%5CAppData%5CRoaming%5Ccom.risuai.app%5Cassets%5C${sha256Hex(PNG)}.png`
    const POSIX_ASSET_URL = `asset://localhost/%2Fhome%2Ftester%2F.local%2Fshare%2Fcom.risuai.app%2Fassets%2F${sha256Hex(PNG)}.png`

    test.each([['windows', WINDOWS_ASSET_URL], ['linux', POSIX_ASSET_URL]] as const)(
        'guard: on Tauri (%s) an asset URL is the asset-protocol URL of its path under AppData, and no file is read',
        async (os, expected) => {
            useTauri(os)
            const { api } = await loadWorld()

            expect(await api.getFileSrc(PNG_KEY)).toBe(expected)
            expect(await api.getFileSrc(PNG_KEY)).toBe(expected)

            expect(fakeFs.calls).toEqual([])
        },
    )

    test('guard: on Tauri a location outside assets is converted as it is, and not read', async () => {
        useTauri('windows')
        const { api } = await loadWorld()

        expect(await api.getFileSrc('C:\\old\\x.png')).toBe('http://asset.localhost/C%3A%5Cold%5Cx.png')
        expect(fakeFs.calls).toEqual([])
    })

    test.each(['assets/../database/database.bin', 'assets//x.png', 'assets/../../x.png'])(
        'reproducer: on Tauri a key that leaves the data directory resolves an empty string and does not reject: %j',
        async (key) => {
            useTauri('linux')
            const { api } = await loadWorld()
            const logged = vi.spyOn(console, 'error').mockImplementation(() => { })

            await expect(api.getFileSrc(key)).resolves.toBe('')

            expect(logged).toHaveBeenCalled()
            expect(fakeFs.calls).toEqual([])
        },
    )

    test('new behaviour: with a service worker the bytes come from the store and are registered under the hex of the key', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        handle.files.set(PNG_KEY, PNG)
        appStore.injectAppStore(handle.store)
        const registered: { path: string, body: Uint8Array }[] = []
        vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
            if (path.startsWith('/sw/check/')) {
                return new Response(JSON.stringify({ able: false }))
            }
            registered.push({ path, body: init?.body as Uint8Array })
            return new Response('ok')
        }))
        api.setUsingSw(true)
        const hex = Buffer.from(PNG_KEY, 'utf-8').toString('hex')

        expect(await api.getFileSrc(PNG_KEY)).toBe(`/sw/img/${hex}`)

        expect(handle.read).toHaveBeenCalledWith(PNG_KEY)
        expect(registered.map((entry) => entry.path)).toEqual([`/sw/register/${hex}`])
        expect(Array.from(registered[0].body)).toEqual(Array.from(PNG))
    })

    test('guard: with a service worker a missing asset still gets the same URL and nothing is registered', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)
        const paths: string[] = []
        vi.stubGlobal('fetch', vi.fn(async (path: string) => {
            paths.push(path)
            return new Response(JSON.stringify({ able: false }))
        }))
        api.setUsingSw(true)
        const hex = Buffer.from('assets/none.png', 'utf-8').toString('hex')

        expect(await api.getFileSrc('assets/none.png')).toBe(`/sw/img/${hex}`)

        expect(paths).toEqual([`/sw/check/${hex}`])
    })

    test('new behaviour: without a service worker the data URL is made from the bytes the store read', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        handle.files.set(PNG_KEY, PNG)
        appStore.injectAppStore(handle.store)

        expect(await api.getFileSrc(PNG_KEY)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
        await api.getFileSrc(PNG_KEY)

        expect(handle.read).toHaveBeenCalledTimes(1)
    })

    test('guard: without a service worker a missing asset gives the empty data URL', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        expect(await api.getFileSrc('assets/none.png')).toBe('data:image/png;base64,')
    })

    test('new behaviour: a key the store cannot address is a miss, not a failure', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        expect(await api.getFileSrc('')).toBe('data:image/png;base64,')
    })

    test('guard: on the Node server without a service worker the data URL is the same string as on the web', async () => {
        useNode()
        const server = new FakeNodeServer()
        vi.stubGlobal('fetch', server.fetch)
        server.seed(PNG_KEY, PNG)
        const { api } = await loadWorld()

        expect(await api.getFileSrc(PNG_KEY)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
        expect(server.requestsTo('/api/read')).toHaveLength(1)
    })

    test('guard: the plain-HTTP predicate follows the branch getFileSrc takes on every platform and service worker state', async () => {
        const { api } = await loadWorld()

        h.platform.isTauri = false
        api.setUsingSw(false)
        expect(api.isPlainHttpFileSrc(PNG_KEY)).toBe(true)
        api.setUsingSw(true)
        expect(api.isPlainHttpFileSrc(PNG_KEY)).toBe(false)
        h.platform.isTauri = true
        api.setUsingSw(false)
        expect(api.isPlainHttpFileSrc(PNG_KEY)).toBe(false)
        api.setUsingSw(true)
        expect(api.isPlainHttpFileSrc(PNG_KEY)).toBe(false)
    })
})

describe('user files above one plugin call on Tauri', () => {
    const CAP = 4 * 1024 * 1024

    function patterned(length: number): Uint8Array {
        return Uint8Array.from({ length }, (_, i) => (i * 17 + 3) % 251)
    }

    test('per-call bound: readImage of a path outside assets reads a file of several pieces with calls of at most 4 MiB and returns every byte', async () => {
        useTauri('linux')
        const big = patterned(CAP * 2 + 5)
        fakeFs.plant('/legacy/big.png', big)
        const { api } = await loadWorld()

        const read = await api.readImage('/legacy/big.png')

        expect(Buffer.compare(Buffer.from(read), Buffer.from(big))).toBe(0)
        expect(Math.max(...desktop.bounded.readSizes)).toBeLessThanOrEqual(CAP)
        expect(desktop.bounded.openHandles()).toBe(0)
    })

    test('per-call bound: downloadFile of a body above 4 MiB writes it in calls of at most 4 MiB, in order, into Downloads', async () => {
        useTauri('linux')
        const big = patterned(CAP * 2 + 5)
        const { api } = await loadWorld()

        await api.downloadFile('export.bin', big)

        expect(desktop.written).toEqual([CAP, CAP, 5])
        expect(Buffer.compare(Buffer.from(fakeFs.files.get('export.bin') ?? []), Buffer.from(big))).toBe(0)
    })

    test('guard: downloadFile of a small body is one write call', async () => {
        useTauri('linux')
        const { api } = await loadWorld()

        await api.downloadFile('small.bin', OTHER)

        expect(desktop.written).toEqual([OTHER.length])
        expect(Array.from(fakeFs.files.get('small.bin') ?? [])).toEqual(Array.from(OTHER))
    })
})