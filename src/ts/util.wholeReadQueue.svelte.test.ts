// @vitest-environment happy-dom

/**
 * `getCustomBackground` and `getEmotion` of `util.ts` on Android: with a lookups object they read their images through a
 * hold (a slot of `charImageLookups`), so a file of 8 MiB or more waits in the app-wide whole-read queue; without one, and
 * off Android, they make today's two-argument `getCharImage` calls.
 *
 * The REAL `getCharImage` (behind a spy that calls it), the REAL `util.ts`, the REAL size verdict and queue; `Image` is the
 * kit's fake. The last test pins the kit's `getCharImage` mirror (used by the component tests that cannot load
 * `characters.ts`) against the real function.
 *
 * "Held grant": the test takes 60 MiB of the 64 MiB queue itself, as a chat image would, so any larger read must wait.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix util), `(G)` a compatibility guard, `(U)` a rule test.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from './storage/database.svelte'
import type { RisuEnvironmentLabel } from './platform'
import type { CharImageOptions } from './characters'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { getCharImageSpy } = vi.hoisted(() => ({ getCharImageSpy: vi.fn() }))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => androidTransport.android,
    statStoredSize: async (key: string) => androidTransport.sizes[key] ?? 0,
}))

vi.mock(import('src/ts/globalApi.svelte'), () =>
    ({
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
        getFileSrc: async (loc: string) => androidFileSrc(loc),
        checkCharOrder: vi.fn(),
        requiresFullEncoderReload: { state: false },
        AppendableBuffer: class {},
        VirtualWriter: class {},
        LocalWriter: class {},
        BlankWriter: class {},
        downloadFile: vi.fn(),
        openURL: vi.fn(),
        loadAsset: vi.fn(),
        saveAsset: vi.fn(async () => 'asset-1'),
        readImage: vi.fn(),
        globalFetch: vi.fn(),
        aiWatermarkingLawApplies: vi.fn(() => false),
        changeChatTo: vi.fn(),
        hubURL: '',
        usingSw: false,
        getFetchLogs: vi.fn(() => []),
        getFetchData: vi.fn(() => ({})),
        aiLawApplies: vi.fn(() => false),
    }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('./stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (path: string) => path.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))

vi.mock(import('./stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('./stores.svelte')
})

// `getCharImage` is the real one behind a spy, so the arguments of every call are on record.
vi.mock(import('./characters'), async (importOriginal) => {
    const actual = await importOriginal()
    getCharImageSpy.mockImplementation((loc: string, type: Parameters<typeof actual.getCharImage>[1], options?: CharImageOptions) =>
        options === undefined ? actual.getCharImage(loc, type) : actual.getCharImage(loc, type, options),
    )
    return { ...actual, getCharImage: getCharImageSpy }
})

import { DBState, selectedCharID } from './stores.svelte'
import { getCustomBackground, getEmotion } from './util'
import { createCharImageLookups, type CharImageLookups } from './media/charImageLookups'
import { __avatarThumbTestHooks } from './media/avatarThumb'
import { androidWholeReadQueue, resetAndroidWholeReadQueueForTest, resetAssetUrlGateForTest } from './storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from './media/queuedWholeRead'
import {
    FakeImage, MIB, androidFileSrc, androidTransport, createMirroredGetCharImage, resetAndroidTransport, seedSizes, skipRecordStore, urlOf,
} from './media/wholeReadQueue.testKit'

const BACKGROUND_A = 'assets/backgroundA.webp'
const BACKGROUND_B = 'assets/backgroundB.webp'
const EMOTION = 'assets/emotion.webp'
const HAPPY = 'assets/happy.webp'
const PORTRAIT = 'assets/portrait.webp'
const styleOf = (key: string): string => `background: url("${urlOf(key)}"); background-size: cover;`

let lookups: CharImageLookups | null = null

async function settleReads(): Promise<void> {
    for (let i = 0; i < 30; i++) {
        await Promise.resolve()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Takes 60 MiB of the app-wide queue, as a chat image in flight would. */
async function holdBudget(): Promise<{ release: () => void }> {
    return androidWholeReadQueue().acquire(60 * MIB)
}

/** Settles a call: true once its promise has an outcome. */
function watch<T>(promise: Promise<T>): { settled: () => boolean, value: () => T | undefined } {
    let done = false
    let result: T | undefined
    void promise.then((value) => {
        done = true
        result = value
    })
    return { settled: () => done, value: () => result }
}

async function fireAllImages(): Promise<void> {
    for (let guard = 0; guard < 20; guard++) {
        const next = FakeImage.all.find((image) => !image.settled)
        if (!next) {
            return
        }
        next.fire('load')
        await settleReads()
    }
    throw new Error('reads never drained')
}

function setCharacter(character: Record<string, unknown>): void {
    DBState.db = {
        characters: [{ chaId: 'cha1', name: 'Cha', type: 'character', viewScreen: 'emotion', emotionImages: [], image: '', chats: [], chatPage: 0, ...character }],
        hideAllImages: false,
    } as unknown as Database
    selectedCharID.set(0)
}

beforeEach(() => {
    resetAndroidTransport(true)
    getCharImageSpy.mockClear()
    FakeImage.all = []
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetAndroidWholeReadQueueForTest()
    resetQueuedWholeReadsForTest()
    __avatarThumbTestHooks.reset()
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setStore(skipRecordStore)
    __avatarThumbTestHooks.setGenerator(async () => null)
    DBState.db = { characters: [], hideAllImages: false } as unknown as Database
    lookups = createCharImageLookups()
})

afterEach(() => {
    lookups?.dispose()
    lookups = null
    vi.unstubAllGlobals()
    __avatarThumbTestHooks.reset()
})

describe('getCustomBackground on Android', () => {
    test('(R) T12a a 60 MiB background waits while a chat image holds the queue, and paints after its read settles', async () => {
        seedSizes([BACKGROUND_A], 60)
        const grant = await holdBudget()
        const call = watch(getCustomBackground(BACKGROUND_A, lookups!))
        await settleReads()
        expect(call.settled()).toBe(false)
        expect(FakeImage.all).toHaveLength(0)

        grant.release()
        await settleReads()
        expect(FakeImage.all.map((image) => image.src)).toEqual([urlOf(BACKGROUND_A)])
        expect(call.settled()).toBe(false)
        await fireAllImages()
        expect(call.value()).toBe(styleOf(BACKGROUND_A))
    })

    test('(R) T12e a background that is cleared while its read waits stays empty, and its waiting read is given back without an Image', async () => {
        seedSizes([BACKGROUND_A], 60)
        const grant = await holdBudget()
        const first = watch(getCustomBackground(BACKGROUND_A, lookups!))
        await settleReads()
        expect(first.settled()).toBe(false)

        const cleared = await getCustomBackground('', lookups!)
        expect(cleared).toBe('')
        grant.release()
        await settleReads()
        await fireAllImages()

        expect(first.value()).toBe('')
        expect(FakeImage.all).toHaveLength(0)
        lookups!.dispose()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(U) T12e a background that changes while its read waits ends with the newer one', async () => {
        seedSizes([BACKGROUND_A, BACKGROUND_B], 60)
        const grant = await holdBudget()
        const first = watch(getCustomBackground(BACKGROUND_A, lookups!))
        const second = watch(getCustomBackground(BACKGROUND_B, lookups!))
        await settleReads()
        grant.release()
        await settleReads()
        await fireAllImages()

        expect(second.value()).toBe(styleOf(BACKGROUND_B))
        expect(first.value()).toBe(styleOf(BACKGROUND_B))
        expect(FakeImage.all.map((image) => image.src)).toEqual([urlOf(BACKGROUND_B)])
    })
})

describe('getEmotion on Android', () => {
    test('(R) T12b the default emotion image waits while a chat image holds the queue', async () => {
        seedSizes([EMOTION], 20)
        setCharacter({ emotionImages: [['neutral', EMOTION]] })
        const grant = await holdBudget()
        const call = watch(getEmotion(DBState.db, {}, 'plain', lookups!))
        await settleReads()
        expect(call.settled()).toBe(false)

        grant.release()
        await settleReads()
        await fireAllImages()
        expect(call.value()).toEqual(['normal', urlOf(EMOTION)])
    })

    test('(R) T12c the latest emotion image waits while a chat image holds the queue', async () => {
        seedSizes([HAPPY], 20)
        setCharacter({ emotionImages: [['happy', HAPPY]] })
        const grant = await holdBudget()
        const call = watch(getEmotion(DBState.db, { cha1: [['happy', HAPPY, 1]] }, 'plain', lookups!))
        await settleReads()
        expect(call.settled()).toBe(false)

        grant.release()
        await settleReads()
        await fireAllImages()
        expect(call.value()).toEqual(['normal', urlOf(HAPPY)])
    })

    test('(R) T12d the portrait of an image-generation character without an emotion waits while a chat image holds the queue', async () => {
        seedSizes([PORTRAIT], 20)
        setCharacter({ viewScreen: 'imggen', image: PORTRAIT })
        const grant = await holdBudget()
        const call = watch(getEmotion(DBState.db, {}, 'plain', lookups!))
        await settleReads()
        expect(call.settled()).toBe(false)

        grant.release()
        await settleReads()
        await fireAllImages()
        expect(call.value()).toEqual(['normal', urlOf(PORTRAIT)])
    })

    test('(U) two emotion calls with the same key share one read, and disposing the lookups leaves no read held', async () => {
        seedSizes([EMOTION], 20)
        setCharacter({ emotionImages: [['neutral', EMOTION]] })
        const first = getEmotion(DBState.db, {}, 'plain', lookups!)
        const second = getEmotion(DBState.db, {}, 'plain', lookups!)
        await settleReads()
        expect(FakeImage.all).toHaveLength(1)
        await fireAllImages()
        expect(await first).toEqual(['normal', urlOf(EMOTION)])
        expect(await second).toEqual(['normal', urlOf(EMOTION)])
        expect(heldQueuedWholeReadsForTest()).toBe(1)
        lookups!.dispose()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })
})

describe('off Android and without lookups', () => {
    test('(G) T17 off Android the calls are the two-argument ones, the same as without lookups', async () => {
        resetAndroidTransport(false)
        seedSizes([BACKGROUND_A, EMOTION, HAPPY, PORTRAIT], 60)
        setCharacter({ emotionImages: [['neutral', EMOTION]] })

        expect(await getCustomBackground('', lookups!)).toBe('')
        expect(await getCustomBackground(BACKGROUND_A, lookups!)).toBe(styleOf(BACKGROUND_A))
        expect(await getEmotion(DBState.db, {}, 'plain', lookups!)).toEqual(['normal', urlOf(EMOTION)])
        expect(await getEmotion(DBState.db, { cha1: [['happy', HAPPY, 1]] }, 'plain', lookups!)).toEqual(['normal', urlOf(HAPPY)])
        setCharacter({ viewScreen: 'imggen', image: PORTRAIT })
        expect(await getEmotion(DBState.db, {}, 'plain', lookups!)).toEqual(['normal', urlOf(PORTRAIT)])
        const withLookups = (getCharImageSpy.mock.calls as unknown[][]).map((call) => [...call])

        getCharImageSpy.mockClear()
        setCharacter({ emotionImages: [['neutral', EMOTION]] })
        expect(await getCustomBackground('')).toBe('')
        expect(await getCustomBackground(BACKGROUND_A)).toBe(styleOf(BACKGROUND_A))
        expect(await getEmotion(DBState.db, {}, 'plain')).toEqual(['normal', urlOf(EMOTION)])
        expect(await getEmotion(DBState.db, { cha1: [['happy', HAPPY, 1]] }, 'plain')).toEqual(['normal', urlOf(HAPPY)])
        setCharacter({ viewScreen: 'imggen', image: PORTRAIT })
        expect(await getEmotion(DBState.db, {}, 'plain')).toEqual(['normal', urlOf(PORTRAIT)])
        const withoutLookups = (getCharImageSpy.mock.calls as unknown[][]).map((call) => [...call])

        expect(withLookups).toEqual(withoutLookups)
        expect(withLookups).toHaveLength(4)
        expect(withLookups.every((call) => call.length === 2)).toBe(true)
        expect(FakeImage.all).toHaveLength(0)
    })

    test('(G) on Android without lookups the calls stay two-argument and queue nothing', async () => {
        seedSizes([BACKGROUND_A], 60)
        expect(await getCustomBackground(BACKGROUND_A)).toBe(styleOf(BACKGROUND_A))
        expect((getCharImageSpy.mock.calls as unknown[][]).every((call) => call.length === 2)).toBe(true)
        expect(FakeImage.all).toHaveLength(0)
    })
})

describe('the kit mirror of getCharImage', () => {
    interface Case {
        name: string
        loc: string
        type: 'plain' | 'css' | 'contain' | 'lgcss'
        hide?: boolean
        size?: number
        signal?: 'live' | 'aborted'
    }
    const cases: Case[] = [
        { name: 'small plain', loc: 'assets/small.webp', type: 'plain', size: 1 },
        { name: 'small css', loc: 'assets/small.webp', type: 'css', size: 1 },
        { name: 'empty plain', loc: '', type: 'plain' },
        { name: 'empty css', loc: '', type: 'css' },
        { name: 'hidden plain', loc: 'assets/small.webp', type: 'plain', hide: true, size: 1 },
        { name: 'hidden css', loc: 'assets/small.webp', type: 'css', hide: true, size: 1 },
        { name: 'contain', loc: 'assets/small.webp', type: 'contain', size: 1 },
        { name: 'lgcss', loc: 'assets/small.webp', type: 'lgcss', size: 1 },
        { name: 'small with a signal', loc: 'assets/small.webp', type: 'plain', size: 1, signal: 'live' },
        { name: 'large with a signal', loc: 'assets/large.webp', type: 'css', size: 20, signal: 'live' },
        { name: 'large with an aborted signal', loc: 'assets/large.webp', type: 'plain', size: 20, signal: 'aborted' },
        { name: 'empty with a signal', loc: '', type: 'css', signal: 'live' },
    ]

    async function run(call: (loc: string, type: Case['type'], options?: CharImageOptions) => Promise<unknown>, entry: Case) {
        FakeImage.all = []
        resetQueuedWholeReadsForTest()
        resetAndroidWholeReadQueueForTest()
        resetAssetUrlGateForTest()
        resetAndroidTransport(true)
        if (entry.size !== undefined) {
            seedSizes([entry.loc], entry.size)
        }
        ;(DBState.db as { hideAllImages: boolean }).hideAllImages = entry.hide === true
        const controller = new AbortController()
        if (entry.signal === 'aborted') {
            controller.abort()
        }
        const pending = entry.signal === undefined ? call(entry.loc, entry.type) : call(entry.loc, entry.type, { signal: controller.signal })
        await settleReads()
        const imagesBeforeLoad = FakeImage.all.map((image) => image.src)
        await fireAllImages()
        return { result: await pending, imagesBeforeLoad, held: heldQueuedWholeReadsForTest() }
    }

    test('(G) the mirror returns the same result and queues the same reads as the real function', async () => {
        const mirror = createMirroredGetCharImage(() => (DBState.db as { hideAllImages: boolean }).hideAllImages)
        const { getCharImage: realGetCharImage } = await vi.importActual<typeof import('./characters')>('./characters')
        for (const entry of cases) {
            const real = await run((loc, type, options) => options === undefined ? realGetCharImage(loc, type) : realGetCharImage(loc, type, options), entry)
            const mirrored = await run((loc, type, options) => mirror(loc, type, options), entry)
            expect({ name: entry.name, ...mirrored }).toEqual({ name: entry.name, ...real })
        }
    })
})
