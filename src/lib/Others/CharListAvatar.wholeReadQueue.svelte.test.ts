// @vitest-environment happy-dom

/**
 * `CharListAvatar.svelte` through the REAL `getCharImage`, the REAL thumbnail module, the REAL size cache and the REAL
 * app-wide whole-read queue: on Android an animated avatar whose thumbnail was skipped paints its full-size file, and
 * the reads of 8 MiB or more of such avatars share the queue with the chat images.
 *
 * MOCKED: `localforage` (inert), `src/ts/globalApi.svelte` (`getFileSrc` mirrors the Android 'whole' path: it probes the
 * size through the real `androidAssetSizeVerdict` and registers the URL with the real `rememberWholeReadUrl` only while
 * the mocked transport is Android), `src/ts/storage/tauriByteTransport` (the platform flag and the stored sizes),
 * `src/ts/storage/database.svelte`, `src/ts/platform`, `@tauri-apps/plugin-fs` and `src/ts/stores.svelte`.
 * `Image` is a fake that records the sources it was given and fires `load` or `error` on demand. The skip record is the
 * one `schedulePersist` writes, `{ v: THUMB_VERSION, skip: true }`, served through the thumbnail store hook.
 *
 * "Exposed bytes" = the stored sizes of the URLs that are in flight: set as the source of a fake `Image` that has not
 * settled, or present in a tile's `style` without a settled read behind them.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { getFileSrcSpy, transport } = vi.hoisted(() => ({
    getFileSrcSpy: vi.fn(async (loc: string) => `http://asset.localhost/${loc}`),
    transport: { android: true, sizes: {} as Record<string, number> },
}))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => transport.android,
    statStoredSize: async (key: string) => transport.sizes[key] ?? 0,
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getFileSrc: getFileSrcSpy,
    checkCharOrder: vi.fn(),
    requiresFullEncoderReload: { state: false },
    AppendableBuffer: class {},
    VirtualWriter: class {},
    LocalWriter: class {},
    BlankWriter: class {},
    downloadFile: vi.fn(),
    openURL: vi.fn(),
    loadAsset: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
    globalFetch: vi.fn(),
    aiWatermarkingLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    hubURL: '',
    usingSw: false,
    getFetchLogs: vi.fn(() => []),
    getFetchData: vi.fn(() => ({})),
    aiLawApplies: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
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

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false } as unknown as Database })
    return {
        DBState: state,
        selectedCharID: { subscribe: () => () => {} },
        MobileGUIStack: { subscribe: () => () => {} },
        CharEmotion: { subscribe: () => () => {} },
        OpenRealmStore: { subscribe: () => () => {} },
        selIdState: { state: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

import CharListAvatar, { resetCharListAvatarCacheForTest } from './CharListAvatar.svelte'
import { __avatarThumbTestHooks, THUMB_VERSION } from 'src/ts/media/avatarThumb'
import { getCharImage } from 'src/ts/characters'
import { DBState } from 'src/ts/stores.svelte'
import {
    DEFERRED_IMAGE_PLACEHOLDER_SRC, DEFERRED_IMAGE_SRC_ATTRIBUTE, androidAssetSizeVerdict, rememberWholeReadUrl, resetAssetUrlGateForTest,
} from 'src/ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from 'src/ts/media/queuedWholeRead'
import { createDeferredImageLoader, resetDeferredImagesForTest } from '../ChatScreens/deferredAssetImages'

const MIB = 1024 * 1024
const URL_OF = (key: string) => `http://asset.localhost/${key}`
const FULL_STYLE_OF = (key: string) => `background: url("${URL_OF(key)}");background-size: cover;`
// The DOM serializes the `style` attribute without `background-size`, so a tile is compared on the part it keeps;
// the full string is compared on `getCharImage`'s own return value.
const STYLE_OF = (key: string) => `background: url("${URL_OF(key)}");`

class FakeImage {
    static all: FakeImage[] = []
    crossOrigin = ''
    settled = false
    private source = ''
    private listeners = new Map<string, Set<() => void>>()
    constructor() {
        FakeImage.all.push(this)
    }
    get src(): string { return this.source }
    set src(value: string) { this.source = value }
    addEventListener(type: string, listener: () => void) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set())
        }
        this.listeners.get(type)!.add(listener)
    }
    removeEventListener(type: string, listener: () => void) {
        this.listeners.get(type)?.delete(listener)
    }
    fire(type: 'load' | 'error') {
        this.settled = true
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener()
        }
    }
}

class FakeObserver {
    static instances: FakeObserver[] = []
    constructor(public callback: IntersectionObserverCallback) {
        FakeObserver.instances.push(this)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    fire(element: Element) {
        this.callback([{ target: element, isIntersecting: true }] as never, this as never)
    }
}
Object.defineProperty(FakeObserver.prototype, 'scrollMargin', { get: () => '' })

let tiles: { app: Record<string, unknown>; target: HTMLElement }[] = []

beforeEach(async () => {
    transport.android = true
    transport.sizes = {}
    FakeImage.all = []
    FakeObserver.instances = []
    ;(DBState.db as { hideAllImages: boolean }).hideAllImages = false
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    resetAssetUrlGateForTest()
    resetDeferredImagesForTest()
    resetQueuedWholeReadsForTest()
    resetCharListAvatarCacheForTest()
    __avatarThumbTestHooks.reset()
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setStore({
        getItem: async () => ({ v: THUMB_VERSION, skip: true }),
        setItem: async () => {},
        removeItem: async () => {},
        iterate: async () => {},
    })
    __avatarThumbTestHooks.setGenerator(async () => null)
    getFileSrcSpy.mockReset()
    getFileSrcSpy.mockImplementation(async (loc: string) => {
        const url = URL_OF(loc)
        if (transport.android) {
            await androidAssetSizeVerdict(loc)
            rememberWholeReadUrl(url, loc)
        }
        return url
    })
})

afterEach(async () => {
    for (const tile of tiles) {
        await unmount(tile.app as never)
        tile.target.remove()
    }
    tiles = []
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __avatarThumbTestHooks.reset()
})

function mountTile(src: string): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    tiles.push({ app: mount(CharListAvatar, { target, props: { src } as never }) as Record<string, unknown>, target })
    flushSync()
    return target
}

async function unmountTile(target: HTMLElement): Promise<void> {
    const index = tiles.findIndex((tile) => tile.target === target)
    await unmount(tiles[index].app as never)
    target.remove()
    tiles.splice(index, 1)
}

async function settle(): Promise<void> {
    for (let i = 0; i < 30; i++) {
        await Promise.resolve()
        flushSync()
    }
}

const styleOf = (target: HTMLElement): string => target.querySelector('.ico')?.getAttribute('style') ?? ''
const sizeOfUrl = (url: string): number => transport.sizes[url.slice('http://asset.localhost/'.length)] ?? 0

/** Stored sizes of the distinct URLs in flight: an unsettled fake `Image`, or a tile style with no settled read behind it. */
function exposedBytes(): number {
    const settledUrls = new Set(FakeImage.all.filter((image) => image.settled).map((image) => image.src))
    const inFlight = new Set<string>(FakeImage.all.filter((image) => !image.settled).map((image) => image.src))
    for (const tile of tiles) {
        const url = /url\("([^"]*)"\)/.exec(styleOf(tile.target))?.[1]
        if (url !== undefined && !settledUrls.has(url)) {
            inFlight.add(url)
        }
    }
    let total = 0
    for (const url of inFlight) {
        total += sizeOfUrl(url)
    }
    return total
}

const unsettledSources = (): string[] => FakeImage.all.filter((image) => !image.settled).map((image) => image.src)

function seed(locs: string[], mib: number) {
    for (const loc of locs) {
        transport.sizes[loc] = mib * MIB
    }
}

const FOUR = ['assets/a.webp', 'assets/b.webp', 'assets/c.webp', 'assets/d.webp']

describe('animated avatars whose thumbnail was skipped, on Android', () => {
    test('T1 four 20 MiB avatars expose at most three reads before any settles; the fourth starts after one settles', async () => {
        seed(FOUR, 20)
        const targets = FOUR.map(mountTile)
        await settle()

        expect(exposedBytes()).toBeLessThanOrEqual(64 * MIB)
        expect(FakeImage.all.map((image) => image.src)).toEqual(FOUR.slice(0, 3).map(URL_OF))
        expect(targets.map(styleOf)).toEqual(['', '', '', ''])

        FakeImage.all[0].fire('load')
        await settle()
        expect(FakeImage.all.map((image) => image.src)).toEqual(FOUR.map(URL_OF))
        expect(exposedBytes()).toBeLessThanOrEqual(64 * MIB)
    })

    test('T2 each tile ends with exactly the style it had before, after load, after error and after the 30 s timer', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        seed(FOUR, 20)
        const targets = FOUR.map(mountTile)
        await settle()

        // Where no read is queued there is no Image to settle; the final styles are the same either way.
        FakeImage.all[0]?.fire('load')
        await settle()
        FakeImage.all[1]?.fire('error')
        await settle()
        vi.advanceTimersByTime(30_000)
        await settle()
        FakeImage.all[3]?.fire('load')
        await settle()

        expect(targets.map(styleOf)).toEqual(FOUR.map(STYLE_OF))
        for (const image of FakeImage.all) {
            expect(image.crossOrigin).toBe('')
        }
    })

    test('T3 guard: off Android the four tiles paint at once and no Image is made', async () => {
        transport.android = false
        seed(FOUR, 20)
        const targets = FOUR.map(mountTile)
        await settle()

        expect(FakeImage.all).toHaveLength(0)
        expect(targets.map(styleOf)).toEqual(FOUR.map(STYLE_OF))
    })

    test('T4 guard: a 4 MiB avatar paints at once with no Image, and a re-mounted tile paints at once from the cache', async () => {
        seed(['assets/small.webp'], 4)
        const first = mountTile('assets/small.webp')
        await settle()
        expect(FakeImage.all).toHaveLength(0)
        expect(styleOf(first)).toBe(STYLE_OF('assets/small.webp'))

        await unmountTile(first)
        const again = mountTile('assets/small.webp')
        expect(styleOf(again)).toBe(STYLE_OF('assets/small.webp'))
        await settle()
        expect(FakeImage.all).toHaveLength(0)
    })

    test('T5 a tile unmounted while waiting gets no Image; a tile unmounted mid-read keeps its slot until the read settles', async () => {
        seed(FOUR, 20)
        const [a, b, c, d] = FOUR.map(mountTile)
        await settle()
        expect(FakeImage.all).toHaveLength(3)

        await unmountTile(d)
        FakeImage.all[0].fire('load')
        await settle()
        expect(FakeImage.all).toHaveLength(3)

        await unmountTile(b)
        seed(['assets/e.webp'], 20)
        mountTile('assets/e.webp')
        seed(['assets/f.webp'], 20)
        mountTile('assets/f.webp')
        await settle()
        // b's read is still in flight and keeps its 20 MiB: c and b hold 40, so only e fits (60); f waits.
        expect(FakeImage.all.map((image) => image.src)).toEqual(['a', 'b', 'c', 'e'].map((key) => URL_OF(`assets/${key}.webp`)))

        FakeImage.all[1].fire('load')
        await settle()
        expect(FakeImage.all.map((image) => image.src).at(-1)).toBe(URL_OF('assets/f.webp'))
        expect(styleOf(a)).toBe(STYLE_OF('assets/a.webp'))
        expect(styleOf(c)).toBe('')
    })

    test('T6 a re-mounted tile for a queued avatar paints nothing until a new queued read settles', async () => {
        seed(['assets/a.webp'], 20)
        const first = mountTile('assets/a.webp')
        await settle()
        FakeImage.all[0]?.fire('load')
        await settle()
        expect(styleOf(first)).toBe(STYLE_OF('assets/a.webp'))

        await unmountTile(first)
        const again = mountTile('assets/a.webp')
        expect(styleOf(again)).toBe('')
        await settle()
        expect(styleOf(again)).toBe('')
        expect(FakeImage.all).toHaveLength(2)

        FakeImage.all[1].fire('load')
        await settle()
        expect(styleOf(again)).toBe(STYLE_OF('assets/a.webp'))
    })

    test('T9 a chat image that holds 60 MiB keeps a 20 MiB avatar waiting until that read settles', async () => {
        transport.sizes['assets/chat.webp'] = 60 * MIB
        await androidAssetSizeVerdict('assets/chat.webp')
        rememberWholeReadUrl(URL_OF('assets/chat.webp'), 'assets/chat.webp')
        const chatImage = document.createElement('img')
        chatImage.setAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE, URL_OF('assets/chat.webp'))
        chatImage.setAttribute('src', DEFERRED_IMAGE_PLACEHOLDER_SRC)
        document.body.appendChild(chatImage)
        const loader = createDeferredImageLoader()
        loader.scan(document.body)
        FakeObserver.instances[FakeObserver.instances.length - 1].fire(chatImage)
        await settle()
        expect(chatImage.getAttribute('src')).toBe(URL_OF('assets/chat.webp'))

        seed(['assets/a.webp'], 20)
        const tile = mountTile('assets/a.webp')
        await settle()
        const chatBytes = 60 * MIB
        const avatarBytes = [...FakeImage.all.map((image) => image.src), ...(styleOf(tile) ? [URL_OF('assets/a.webp')] : [])]
            .filter((url) => url === URL_OF('assets/a.webp')).length * 20 * MIB
        expect(chatBytes + avatarBytes).toBeLessThanOrEqual(64 * MIB)
        expect(styleOf(tile)).toBe('')

        chatImage.dispatchEvent(new Event('load'))
        await settle()
        expect(FakeImage.all.map((image) => image.src)).toEqual([URL_OF('assets/a.webp')])
        FakeImage.all[0].fire('load')
        await settle()
        expect(styleOf(tile)).toBe(STYLE_OF('assets/a.webp'))
        loader.dispose()
    })

    test('T12 an error still applies the style and gives the slot back', async () => {
        seed(FOUR, 20)
        const targets = FOUR.map(mountTile)
        await settle()
        FakeImage.all[0].fire('error')
        await settle()
        expect(styleOf(targets[0])).toBe(STYLE_OF('assets/a.webp'))
        expect(FakeImage.all).toHaveLength(4)
    })

    test('T13 guard: getCharImage without options on Android returns the style at once and queues nothing', async () => {
        seed(['assets/big.webp'], 20)
        const result = await getCharImage('assets/big.webp', 'thumbcss')
        expect(result).toBe(FULL_STYLE_OF('assets/big.webp'))
        expect(FakeImage.all).toHaveLength(0)
    })

    test('T14 guard: a thumbnail hit and hide-all-images queue nothing', async () => {
        seed(['assets/big.webp'], 20)
        __avatarThumbTestHooks.setStore({
            getItem: async () => ({ v: THUMB_VERSION, src: 'data:image/webp;base64,AAAA' }),
            setItem: async () => {},
            removeItem: async () => {},
            iterate: async () => {},
        })
        const hit = mountTile('assets/big.webp')
        await settle()
        expect(styleOf(hit)).toContain('data:image/webp;base64,AAAA')
        expect(FakeImage.all).toHaveLength(0)

        ;(DBState.db as { hideAllImages: boolean }).hideAllImages = true
        const hidden = await getCharImage('assets/other.webp', 'thumbcss', { signal: new AbortController().signal })
        expect(hidden).toBe('')
        expect(FakeImage.all).toHaveLength(0)
    })

    test('S10 the Image of a queued tile is released after the tile unmounts', async () => {
        seed(['assets/a.webp'], 20)
        const tile = mountTile('assets/a.webp')
        await settle()
        FakeImage.all[0].fire('load')
        await settle()
        expect(heldQueuedWholeReadsForTest()).toBe(1)
        await unmountTile(tile)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })
})
