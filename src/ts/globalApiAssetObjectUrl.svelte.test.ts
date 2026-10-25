// @vitest-environment node
/**
 * `getFileSrc` for an `assets/` key whose stored value is a Blob: the page gets a `blob:` URL
 * from the real IndexedDB adapter (over `fake-indexeddb`), the URL lives outside `fileCache`
 * and its LRU, and `releaseAssetObjectUrl` revokes it. `URL.createObjectURL` and
 * `revokeObjectURL` are spies, so a pass says nothing about a real browser's Blob handling,
 * media playback or memory use.
 *
 * Titles say what a test pins: `reproducer` fails on the code before the change, `guard`
 * holds before and after. Every module `globalApi.svelte.ts` imports other than the store
 * is mocked, as in `globalApiFileCacheAv3.svelte.test.ts`.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

// `globalApi.svelte.ts` reads `localStorage` while it loads; the node environment has none.
vi.hoisted(() => {
    const entries = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => entries.get(key) ?? null,
            setItem: (key: string, value: string) => { entries.set(key, String(value)) },
            removeItem: (key: string) => { entries.delete(key) },
            clear: () => { entries.clear() },
        },
    })
})

//#region module mocks

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
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

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
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
    } as unknown as typeof import('src/ts/stores.svelte')
})

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

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
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
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => {})
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

// The page's store is the real IndexedDB adapter, one instance for the whole file.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createIndexedDbStore } = await import('src/ts/storage/store/indexedDbStore')
    const store = createIndexedDbStore()
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

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
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import {
    getFileSrc,
    releaseAssetObjectUrl,
    setUsingSw,
    __fileCacheTestHooks,
} from 'src/ts/globalApi.svelte'
import { getAppStore } from 'src/ts/storage/store/appStore'

const upstream = localforage.createInstance({ name: 'risuai' })

function pattern(length: number, seed: number): Uint8Array<ArrayBuffer> {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

let createdBlobs: Blob[]
let createdUrls: string[]
let createSpy: ReturnType<typeof vi.spyOn>
let revokeSpy: ReturnType<typeof vi.spyOn>
let getSpy: ReturnType<typeof vi.spyOn>
let fetchMock: ReturnType<typeof vi.fn>

/** How many raw IndexedDB `get` calls asked for `key`. */
function rawGetCount(key: string): number {
    return getSpy.mock.calls.filter((call) => call[0] === key).length
}

async function seedBlob(key: string, size = 600, type = ''): Promise<void> {
    const store = await getAppStore()
    await store.writeBlob!(key, new File([pattern(size, 3)], 'x', { type }), 'unconditional')
}

async function seedBytes(key: string, size = 600): Promise<void> {
    const store = await getAppStore()
    await store.write(key, pattern(size, 5), 'unconditional')
}

beforeEach(async () => {
    await upstream.clear()
    createdBlobs = []
    createdUrls = []
    createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
        createdBlobs.push(blob as Blob)
        const url = `blob:test/${createdUrls.length}`
        createdUrls.push(url)
        return url
    })
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    getSpy = vi.spyOn(IDBObjectStore.prototype, 'get')
    fetchMock = vi.fn(async (input: string) => {
        if (String(input).startsWith('/sw/check/')) {
            return new Response(JSON.stringify({ able: false }))
        }
        return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    __fileCacheTestHooks.reset()
    setUsingSw(false)
})

afterEach(() => {
    __fileCacheTestHooks.reset()
    setUsingSw(false)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('getFileSrc for a Blob-valued asset without the service worker', () => {
    test('reproducer: the page gets a blob: URL, the Blob is handed over unread, and the cache holds no bytes', async () => {
        await seedBlob('assets/a.png')

        const src = await getFileSrc('assets/a.png')

        expect(src).toBe(createdUrls[0])
        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(createdBlobs[0].size).toBe(600)
        const stats = __fileCacheTestHooks.stats()
        expect(stats.bytes).toBe(0)
        expect(stats.recomputedBytes).toBe(0)
    })

    test('reproducer: a later call for the same asset answers with the same URL and reads nothing more', async () => {
        await seedBlob('assets/a.png')

        const first = await getFileSrc('assets/a.png')
        const reads = rawGetCount('assets/a.png')
        const second = await getFileSrc('assets/a.png')

        expect(second).toBe(first)
        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(rawGetCount('assets/a.png')).toBe(reads)
    })

    test('reproducer: a File typed text/html under a .svg key reaches createObjectURL as application/octet-stream', async () => {
        await seedBlob('assets/evil.svg', 600, 'text/html')

        await getFileSrc('assets/evil.svg')

        expect(createdBlobs[0].type).toBe('application/octet-stream')
    })

    test('reproducer: the stored type is dropped and the key extension decides the shown type', async () => {
        await seedBlob('assets/pic.png', 600, 'text/html')
        await seedBlob('assets/clip.mp4', 600, 'application/x-evil')

        await getFileSrc('assets/pic.png')
        await getFileSrc('assets/clip.mp4')

        expect(createdBlobs.map((blob) => blob.type)).toEqual(['image/png', 'video/mp4'])
    })

    test('guard: a bytes-valued asset still becomes a data: URL, from exactly one raw get', async () => {
        await seedBytes('assets/b.png', 10)

        const src = await getFileSrc('assets/b.png')

        expect(src).toBe(`data:image/png;base64,${Buffer.from(pattern(10, 5)).toString('base64')}`)
        expect(createSpy).not.toHaveBeenCalled()
        expect(rawGetCount('assets/b.png')).toBe(1)
    })

    test.each(['assets/x//y.png', 'assets/.hidden.png'])('guard: bytes upstream stored under the key %s that the store can address but not create still display, from one raw get', async (key) => {
        await upstream.setItem(key, pattern(10, 5))

        const src = await getFileSrc(key)

        expect(src).toBe(`data:image/png;base64,${Buffer.from(pattern(10, 5)).toString('base64')}`)
        expect(rawGetCount(key)).toBe(1)
        expect(createSpy).not.toHaveBeenCalled()
    })

    test('guard: an absent asset gives the empty data: URL without a URL being made', async () => {
        const src = await getFileSrc('assets/none.png')

        expect(src).toBe('data:image/png;base64,')
        expect(createSpy).not.toHaveBeenCalled()
    })

    test('reproducer: forcing the LRU to evict the entry makes no second URL and no second read', async () => {
        await seedBlob('assets/a.png')
        await seedBlob('assets/b.png')
        await seedBlob('assets/c.png')
        __fileCacheTestHooks.setLimits({ maxEntries: 1 })

        const first = await getFileSrc('assets/a.png')
        await getFileSrc('assets/b.png')
        await getFileSrc('assets/c.png')
        const again = await getFileSrc('assets/a.png')

        expect(again).toBe(first)
        expect(createSpy).toHaveBeenCalledTimes(3)
        expect(revokeSpy).not.toHaveBeenCalled()
        expect(rawGetCount('assets/a.png')).toBe(1)
    })

    test('reproducer: two concurrent first calls share one URL', async () => {
        await seedBlob('assets/a.png')

        const [one, two] = await Promise.all([getFileSrc('assets/a.png'), getFileSrc('assets/a.png')])

        expect(one).toBe(two)
        expect(one.startsWith('blob:')).toBe(true)
        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(rawGetCount('assets/a.png')).toBe(1)
    })

    test('reproducer: a producer orphaned by LRU eviction joins the read in flight instead of starting another', async () => {
        await seedBlob('assets/a.png')
        await seedBlob('assets/b.png')
        __fileCacheTestHooks.setLimits({ maxEntries: 1 })

        const firstCall = getFileSrc('assets/a.png')
        // The second location's loading entry pushes the first out of the cache while its read is still pending.
        const otherCall = getFileSrc('assets/b.png')
        const orphanedRetry = getFileSrc('assets/a.png')
        const results = await Promise.all([firstCall, otherCall, orphanedRetry])

        expect(results[2]).toBe(results[0])
        expect(createSpy).toHaveBeenCalledTimes(2)
        expect(rawGetCount('assets/a.png')).toBe(1)
    })

    test('reproducer: a failed read leaves no stuck in-flight entry, so the next call succeeds', async () => {
        await seedBlob('assets/a.png')
        const store = await getAppStore()
        vi.spyOn(store, 'readValue').mockRejectedValueOnce(new Error('read failed'))
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await getFileSrc('assets/a.png')).toBe('')
        const retry = await getFileSrc('assets/a.png')

        expect(retry.startsWith('blob:')).toBe(true)
    })

    test('reproducer: releasing the asset revokes its URL, drops the cache entry, and a later call makes a new URL', async () => {
        await seedBlob('assets/a.png')
        const first = await getFileSrc('assets/a.png')

        releaseAssetObjectUrl(['assets/a.png'])

        expect(revokeSpy).toHaveBeenCalledTimes(1)
        expect(revokeSpy).toHaveBeenCalledWith(first)
        expect(__fileCacheTestHooks.stats().entries).toBe(0)
        const second = await getFileSrc('assets/a.png')
        expect(second).not.toBe(first)
        expect(createSpy).toHaveBeenCalledTimes(2)
    })

    // Passes on the code before the change only in the sense that the export did not exist: a contract guard.
    test('guard: releasing a key with no URL revokes nothing', () => {
        releaseAssetObjectUrl(['assets/never-shown.png'])

        expect(revokeSpy).not.toHaveBeenCalled()
    })

    // A test-seam contract, not a defect reproducer: the seam must not leak a URL between tests.
    test('guard: the test reset revokes every URL it clears', async () => {
        await seedBlob('assets/a.png')
        const url = await getFileSrc('assets/a.png')

        __fileCacheTestHooks.reset()

        expect(revokeSpy).toHaveBeenCalledWith(url)
        await getFileSrc('assets/a.png')
        expect(createSpy).toHaveBeenCalledTimes(2)
    })
})

describe('getFileSrc for a Blob-valued asset with the service worker', () => {
    beforeEach(() => {
        setUsingSw(true)
    })

    test('reproducer: the page gets a blob: URL and nothing is registered with the service worker', async () => {
        await seedBlob('assets/a.png')

        const src = await getFileSrc('assets/a.png')

        expect(src).toBe(createdUrls[0])
        expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
            `/sw/check/${Buffer.from('assets/a.png').toString('hex')}`,
        ])
        expect(__fileCacheTestHooks.stats().bytes).toBe(0)
    })

    test('reproducer: two concurrent first calls both get the one blob: URL', async () => {
        await seedBlob('assets/a.png')

        const [one, two] = await Promise.all([getFileSrc('assets/a.png'), getFileSrc('assets/a.png')])

        expect(one).toBe(two)
        expect(one.startsWith('blob:')).toBe(true)
        expect(createSpy).toHaveBeenCalledTimes(1)
        expect(rawGetCount('assets/a.png')).toBe(1)
    })

    test.each(['assets/x//y.png', 'assets/.hidden.png'])('guard: bytes upstream stored under the key %s that the store can address but not create are registered with the service worker, from one raw get', async (key) => {
        await upstream.setItem(key, pattern(10, 5))

        const src = await getFileSrc(key)

        const encoded = Buffer.from(key).toString('hex')
        expect(src).toBe(`/sw/img/${encoded}`)
        expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([`/sw/check/${encoded}`, `/sw/register/${encoded}`])
        expect(rawGetCount(key)).toBe(1)
    })

    test('guard: an asset the service worker already holds is answered without any read', async () => {
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ able: true })))
        await seedBlob('assets/a.png')

        const src = await getFileSrc('assets/a.png')

        expect(src).toBe(`/sw/img/${Buffer.from('assets/a.png').toString('hex')}`)
        expect(rawGetCount('assets/a.png')).toBe(0)
        expect(createSpy).not.toHaveBeenCalled()
    })

    test('guard: a bytes-valued asset is registered with the service worker from exactly one raw get', async () => {
        await seedBytes('assets/b.png', 10)

        const src = await getFileSrc('assets/b.png')

        const encoded = Buffer.from('assets/b.png').toString('hex')
        expect(src).toBe(`/sw/img/${encoded}`)
        expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([`/sw/check/${encoded}`, `/sw/register/${encoded}`])
        expect(rawGetCount('assets/b.png')).toBe(1)
        expect(createSpy).not.toHaveBeenCalled()
    })
})
