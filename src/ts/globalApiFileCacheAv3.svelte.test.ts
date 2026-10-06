/**
 * AV-3: tests T1-T8, T12-T13 for `getFileSrc`'s plain-HTTP branch and its
 * `fileCache` (see the `fileCache`/`touchFileCache`/`getFileSrc`/
 * `__fileCacheTestHooks` definitions in `src/ts/globalApi.svelte.ts`, real,
 * unmocked -- these tests drive the actual cache/eviction logic through the
 * test-only `__fileCacheTestHooks` seam). T9/T10 (the
 * parser's `getFileSrcCached`) live in
 * `src/ts/parser/tests/fileSrcCacheAv3.test.ts` instead, because that side
 * needs `getFileSrc` itself (and the predicate) mocked, not real.
 *
 * `globalApi.svelte.ts` implements the AV-3 behaviour; every test below
 * passes against it. Tests labelled "guard" pin pre-existing behaviour
 * (mainly the orphaned-retry identity guard in `touchFileCache`/
 * `getFileSrc`) that AV-3 must not break, not a new requirement.
 *
 * This file drives the REAL `globalApi.svelte.ts` (unmocked). Every other
 * module it transitively imports is mocked below so only its own
 * `fileCache`/`getFileSrc` logic runs for real. The mock set is copied,
 * one-for-one where shapes match, from the mock set already proven to load
 * this module for real in
 * `src/ts/process/tests/coldStorageDeletionGuards.svelte.test.ts`, minus the
 * Tauri-fs/OPFS backend detail that file needs and this one doesn't
 * (`isTauri` is fixed `false` here, never toggled), minus
 * `src/ts/process/coldstorage.svelte` (mocked away here instead of loaded
 * for real -- `getFileSrc` doesn't reach it, only some unrelated chat-load
 * helpers in `globalApi.svelte.ts` do), and with `forageStorage.getItem`
 * exposed as a freely controllable spy instead of a fixed stub.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks

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

// The one real export this file needs (`forageStorage.getItem`) exposed as a
// freely controllable spy, instead of the real AutoStorage backend (which
// would otherwise pull in localforage/OPFS setup unrelated to getFileSrc's
// own caching logic).
vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => {})
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

// `getFileSrc` reads through the page's byte store. The store here forwards to
// the `forageStorage` spies above, looked up at call time because the module
// under test is still loading when this factory runs.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const forage = async () => (await import('src/ts/globalApi.svelte')).forageStorage as unknown as ForageLike
    return appStoreModuleOver(() => ({
        getItem: async (key) => (await forage()).getItem(key),
        setItem: async (key, value) => (await forage()).setItem(key, value),
        keys: async () => (await forage()).keys(),
        removeItem: async (key) => (await forage()).removeItem(key),
    })) as unknown as typeof import('src/ts/storage/store/appStore')
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

// Not on getFileSrc's own path (only some unrelated chat-load helpers in
// globalApi.svelte.ts reach it) -- mocked away rather than loaded for real to
// avoid its own heavy import graph (fflate, process/index.svelte...).
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import {
    getFileSrc,
    forageStorage,
    setUsingSw,
    __fileCacheTestHooks,
} from 'src/ts/globalApi.svelte'

const bytes = (n: number): Uint8Array => {
    const arr = new Uint8Array(n)
    arr.fill(65) // 'A' -- content doesn't matter, only length
    return arr
}

const expectedSrc = (raw: Uint8Array): string =>
    `data:image/png;base64,${Buffer.from(raw).toString('base64')}`

function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

let toStringSpy: ReturnType<typeof vi.spyOn>

function base64EncodeCount(): number {
    return toStringSpy.mock.calls.filter((call) => call[0] === 'base64').length
}

beforeEach(() => {
    // The `globalThis.Buffer = BufferPolyfill` assignment in
    // `src/ts/polyfill.ts` (not imported by this file) is what replaces
    // globalThis.Buffer in the real app; under vitest, Node's own global
    // Buffer is already present at import time, so spying here (after this
    // file's own imports have run) observes every base64 encode `getFileSrc`
    // performs.
    toStringSpy = vi.spyOn(globalThis.Buffer.prototype, 'toString')
    __fileCacheTestHooks.reset()
    setUsingSw(false)
    vi.mocked(forageStorage.getItem).mockReset()
    vi.mocked(forageStorage.getItem).mockResolvedValue(null as unknown as never)
})

afterEach(() => {
    toStringSpy.mockRestore()
    __fileCacheTestHooks.reset()
    setUsingSw(false)
    vi.unstubAllGlobals()
})

describe('AV-3 plain-HTTP getFileSrc cache', () => {
    test('T1: 3 calls for one loc produce one read and one encode', async () => {
        const loc = 't1-plain-http'
        vi.mocked(forageStorage.getItem).mockResolvedValue(bytes(10) as unknown as never)

        const r1 = await getFileSrc(loc)
        const r2 = await getFileSrc(loc)
        const r3 = await getFileSrc(loc)

        expect(forageStorage.getItem).toHaveBeenCalledTimes(1)
        expect(base64EncodeCount()).toBe(1)
        expect(r1).toBe(expectedSrc(bytes(10)))
        expect(r2).toBe(r1)
        expect(r3).toBe(r1)

        const stats = __fileCacheTestHooks.stats()
        expect(stats.bytes).toBe(stats.recomputedBytes)
    })

    test('T2: 5 concurrent first calls produce one read and one encode, and all return equal strings', async () => {
        const loc = 't2-plain-http'
        vi.mocked(forageStorage.getItem).mockResolvedValue(bytes(7) as unknown as never)

        const results = await Promise.all([
            getFileSrc(loc),
            getFileSrc(loc),
            getFileSrc(loc),
            getFileSrc(loc),
            getFileSrc(loc),
        ])

        expect(forageStorage.getItem).toHaveBeenCalledTimes(1)
        expect(base64EncodeCount()).toBe(1)
        for (const r of results) {
            expect(r).toBe(expectedSrc(bytes(7)))
        }

        const stats = __fileCacheTestHooks.stats()
        expect(stats.bytes).toBe(stats.recomputedBytes)
    })

    test('T3: a byte budget for ~2.5 entries evicts the oldest on the third load (HEAD uses a count cap only)', async () => {
        // Each entry here is 3 raw bytes -> 4 base64 chars. A budget of 10
        // holds 2 entries (8) but not a 3rd (12), i.e. "~2.5 entries".
        __fileCacheTestHooks.setLimits({ maxEntries: 100, maxBytes: 10 })
        const locA = 't3-a'
        const locB = 't3-b'
        const locC = 't3-c'
        vi.mocked(forageStorage.getItem).mockImplementation(async () => bytes(3) as unknown as never)

        await getFileSrc(locA)
        await getFileSrc(locB)
        expect(forageStorage.getItem).toHaveBeenCalledTimes(2)

        // Loading a 3rd entry should evict the oldest (locA) to stay within
        // the byte budget -- HEAD has no byte budget, so this does nothing.
        await getFileSrc(locC)

        // Re-requesting the (supposedly evicted) oldest entry must read again.
        await getFileSrc(locA)
        expect(forageStorage.getItem).toHaveBeenCalledTimes(4)

        const stats = __fileCacheTestHooks.stats()
        expect(stats.bytes).toBeLessThanOrEqual(10)
        expect(stats.bytes).toBe(stats.recomputedBytes)
    })

    test('T4: an entry larger than the budget is returned correctly, is not cached, and does not evict others', async () => {
        // Normal entry: 3 raw bytes -> 4 base64 chars, fits a budget of 5.
        // Oversized entry: 6 raw bytes -> 8 base64 chars, exceeds it.
        __fileCacheTestHooks.setLimits({ maxEntries: 100, maxBytes: 5 })
        const locNormal = 't4-normal'
        const locBig = 't4-big'
        vi.mocked(forageStorage.getItem).mockImplementation(async (key: string) => {
            if (key === locNormal) return bytes(3) as unknown as never
            if (key === locBig) return bytes(6) as unknown as never
            return null as unknown as never
        })

        await getFileSrc(locNormal)
        expect(__fileCacheTestHooks.stats().entries).toBe(1)

        const bigResult = await getFileSrc(locBig)
        expect(bigResult).toBe(expectedSrc(bytes(6)))

        // The oversized entry must not land in the cache, and the normal
        // entry it was loaded alongside must survive untouched.
        expect(__fileCacheTestHooks.stats().entries).toBe(1)

        // The normal entry is still cached -- re-requesting it must not read again.
        await getFileSrc(locNormal)
        expect(forageStorage.getItem).toHaveBeenCalledTimes(2)

        const stats = __fileCacheTestHooks.stats()
        expect(stats.bytes).toBe(stats.recomputedBytes)
    })

    test('T5 (guard): service-worker entries cost 0 bytes and obey the count cap without throwing', async () => {
        setUsingSw(true)
        __fileCacheTestHooks.setLimits({ maxEntries: 2, maxBytes: 5 })
        const fetchMock = vi.fn(async (url: string) => {
            if (typeof url === 'string' && url.startsWith('/sw/check/')) {
                return { json: async () => ({ able: false }) } as Response
            }
            return { json: async () => ({}) } as Response
        })
        vi.stubGlobal('fetch', fetchMock)
        vi.mocked(forageStorage.getItem).mockResolvedValue(bytes(3) as unknown as never)

        await getFileSrc('t5-a')
        await getFileSrc('t5-b')
        await getFileSrc('t5-c') // 3rd entry -- count cap (2) must evict the oldest

        const stats = __fileCacheTestHooks.stats()
        expect(stats.entries).toBeLessThanOrEqual(2)
        expect(stats.bytes).toBe(0)
        expect(stats.bytes).toBe(stats.recomputedBytes)
        setUsingSw(false)
    })

    test('T6 (guard): a throwing read removes the entry and leaves the byte total correct; a retry succeeds', async () => {
        const loc = 't6-retry'
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(forageStorage.getItem).mockRejectedValueOnce(new Error('simulated read failure'))

        const first = await getFileSrc(loc)
        expect(first).toBe('')
        let stats = __fileCacheTestHooks.stats()
        expect(stats.entries).toBe(0)
        expect(stats.bytes).toBe(stats.recomputedBytes)

        vi.mocked(forageStorage.getItem).mockResolvedValueOnce(bytes(3) as unknown as never)
        const second = await getFileSrc(loc)
        expect(second).toBe(expectedSrc(bytes(3)))
        stats = __fileCacheTestHooks.stats()
        expect(stats.entries).toBe(1)
        expect(stats.bytes).toBe(stats.recomputedBytes)

        consoleSpy.mockRestore()
    })

    test('T7 (guard, unchanged output): a missing file still returns data:image/png;base64,', async () => {
        vi.mocked(forageStorage.getItem).mockResolvedValueOnce(null as unknown as never)
        const result = await getFileSrc('t7-missing')
        expect(result).toBe('data:image/png;base64,')
    })

    test('T12 (guard): an orphaned retry after a count-cap eviction does not corrupt the cache', async () => {
        // maxBytes=8: the orphan's 9 raw bytes -> 12 base64 chars is over
        // budget (oversized), while the retry's/filler's 3 raw bytes -> 4
        // base64 chars each fit, so the retry actually commits into the
        // budgeted cache below (not the oversized memo) -- exercising the
        // "committed result must still be there" assertion below for real.
        __fileCacheTestHooks.setLimits({ maxEntries: 1, maxBytes: 8 })
        const orphanRead = deferred<Uint8Array>()
        const fillerRead = deferred<Uint8Array>()
        const retryRead = deferred<Uint8Array>()
        const getItemMock = vi.mocked(forageStorage.getItem)
        getItemMock.mockImplementationOnce(() => orphanRead.promise as unknown as Promise<never>)
        getItemMock.mockImplementationOnce(() => fillerRead.promise as unknown as Promise<never>)
        getItemMock.mockImplementationOnce(() => retryRead.promise as unknown as Promise<never>)

        // 1st in-flight load, alone in the (size-1) cache.
        const orphanPromise = getFileSrc('t12-key')
        // 2nd in-flight load for a different key -- the count cap's fallback
        // (both entries are still 'loading', so the normal eviction pass finds
        // nothing to remove and falls back to evicting the oldest loading
        // entry too) orphans the 1st load's cache entry.
        const fillerPromise = getFileSrc('t12-filler')
        // A retry for the same key as the 1st load -- its old entry is gone
        // from the map, so this starts a brand-new one.
        const retryPromise = getFileSrc('t12-key')

        // The orphan resolves with an oversized result. Even once AV-3's
        // budget exists, this must not commit -- its own cache entry is no
        // longer the current one for its key.
        orphanRead.resolve(bytes(9))
        const orphanResult = await orphanPromise
        expect(orphanResult).toBe(expectedSrc(bytes(9)))

        // The retry's own entry must resolve and commit normally.
        retryRead.resolve(bytes(3))
        const retryResult = await retryPromise
        expect(retryResult).toBe(expectedSrc(bytes(3)))

        fillerRead.resolve(bytes(3))
        await fillerPromise

        // The retry's result committed into the real budgeted cache (not the
        // oversized memo) -- confirmed by entries === 1 here, before the
        // no-further-read check below.
        const midStats = __fileCacheTestHooks.stats()
        expect(midStats.entries).toBe(1)
        expect(midStats.bytes).toBe(midStats.recomputedBytes)

        // The retry's committed result must still be there -- a further call
        // for the same key must not read again.
        const callsSoFar = getItemMock.mock.calls.length
        const cached = await getFileSrc('t12-key')
        expect(cached).toBe(expectedSrc(bytes(3)))
        expect(getItemMock.mock.calls.length).toBe(callsSoFar)

        const stats = __fileCacheTestHooks.stats()
        expect(stats.bytes).toBe(stats.recomputedBytes)
    })

    test('T13: two calls for one oversized loc produce one read and one encode; a second oversized loc replaces the memo', async () => {
        // 30 raw bytes -> 40 base64 chars; 60 raw bytes -> 80 base64 chars.
        // Both exceed the budget of 10, so both are "oversized".
        __fileCacheTestHooks.setLimits({ maxEntries: 100, maxBytes: 10 })
        const locA = 't13-a'
        const locB = 't13-b'
        vi.mocked(forageStorage.getItem).mockImplementation(async (key: string) => {
            if (key === locA) return bytes(30) as unknown as never
            if (key === locB) return bytes(60) as unknown as never
            return null as unknown as never
        })

        const a1 = await getFileSrc(locA)
        const a2 = await getFileSrc(locA)
        expect(forageStorage.getItem).toHaveBeenCalledTimes(1)
        expect(base64EncodeCount()).toBe(1)
        expect(a1).toBe(expectedSrc(bytes(30)))
        expect(a2).toBe(a1)

        const b1 = await getFileSrc(locB)
        expect(b1).toBe(expectedSrc(bytes(60)))

        // Only the most recent oversized result is memoized -- a second
        // oversized loc replaces it, so re-requesting locA must read again.
        await getFileSrc(locA)
        expect(forageStorage.getItem).toHaveBeenCalledTimes(3)

        // The oversized memo never counts toward the budget.
        const stats = __fileCacheTestHooks.stats()
        expect(stats.bytes).toBeLessThanOrEqual(10)
        expect(stats.bytes).toBe(stats.recomputedBytes)
    })
})
