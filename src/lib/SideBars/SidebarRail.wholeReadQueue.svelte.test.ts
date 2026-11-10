// @vitest-environment happy-dom

/**
 * The character rail (the REAL `Sidebar.svelte`, so the real `SidebarRail.svelte` and `SidebarAvatar.svelte`) through
 * the REAL `getCharImage`, the REAL thumbnail module, the REAL size cache and the REAL app-wide whole-read queue: on
 * Android the whole-file avatars of 8 MiB or more that the rail shows wait in the queue, so a reload with the rail
 * closed no longer puts every large avatar in flight together.
 *
 * MOCKED: `localforage` (inert), `src/ts/globalApi.svelte` (`getFileSrc` is the kit's Android mirror),
 * `src/ts/storage/tauriByteTransport` (the platform flag and the stored sizes, from the kit), `src/ts/storage/database.svelte`,
 * `src/ts/platform`, `@tauri-apps/plugin-fs`, `src/ts/stores.svelte`, and `getCharImage` is wrapped in a spy that calls the
 * real one. `Image` is the kit's fake. Fixture and exposure counting: `src/ts/media/wholeReadQueue.testKit.ts`.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix rail), `(G)` a compatibility guard, `(U)` a rule test of
 * the new `loc` and `backgroundLoc` props, which the pre-fix avatar does not have.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import type { CharImageOptions } from '../../ts/characters'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { checkCharOrderSpy, changeCharSpy, getCharImageSpy } = vi.hoisted(() => ({
    checkCharOrderSpy: vi.fn(),
    changeCharSpy: vi.fn(),
    getCharImageSpy: vi.fn(),
}))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => androidTransport.android,
    statStoredSize: async (key: string) => androidTransport.sizes[key] ?? 0,
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: async (loc: string) => androidFileSrc(loc),
            checkCharOrder: checkCharOrderSpy,
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
    const { DBState } = await import('../../ts/stores.svelte')
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

vi.mock(import('../../ts/stores.svelte'), () => {
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
    } as unknown as typeof import('../../ts/stores.svelte')
})

// The chat list of a selected character is not under test here.
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))

// `getCharImage` is the real one behind a spy, so the arguments of every call are on record.
vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    getCharImageSpy.mockImplementation((loc: string, type: Parameters<typeof actual.getCharImage>[1], options?: CharImageOptions) =>
        options === undefined ? actual.getCharImage(loc, type) : actual.getCharImage(loc, type, options),
    )
    return { ...actual, changeChar: changeCharSpy, getCharImage: getCharImageSpy }
})

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async () => '3'),
    alertInput: vi.fn(async () => ''),
}))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import Sidebar from './Sidebar.svelte'
import SidebarAvatar from './SidebarAvatar.svelte'
import { DEFAULT_HEIGHTS } from './railConstants'
import { charKey } from './railTestKit'
import { defaultSettle, folderAvatars, installGeometry, resetRailMemory, settleFrame, type Geometry } from './sidebarDnd.testKit'
import { __avatarThumbTestHooks, THUMB_VERSION } from 'src/ts/media/avatarThumb'
import { androidWholeReadQueue, resetAssetUrlGateForTest } from 'src/ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from 'src/ts/media/queuedWholeRead'
import {
    FakeImage, MIB, WHOLE_READ_BUDGET_BYTES, androidFileSrc, androidTransport, domUrls, exposedBytes, resetAndroidTransport, seedSizes,
    skipRecordStore, unsettledSources, urlOf,
} from 'src/ts/media/wholeReadQueue.testKit'

//#region fixture and helpers

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
    imgFile?: string
}
type OrderFixture = Array<string | FolderFixture>

const folderOf = (id: string, data: string[], imgFile?: string): FolderFixture => ({ id, name: `Name ${id}`, color: '', data, imgFile })
const ids = (count: number, from = 0): string[] => Array.from({ length: count }, (_, i) => `c${from + i}`)
const ROW_PITCH = DEFAULT_HEIGHTS.char + DEFAULT_HEIGHTS.gap
const rowTop = (index: number): number => DEFAULT_HEIGHTS.gap + index * ROW_PITCH
const bigOf = (i: number): string => `assets/big${i}.webp`
const smallOf = (i: number): string => `assets/small${i}.webp`
const READ_MIN = 8 * MIB

/** Character `chaId` -> image location; a missing entry is an imageless character. */
type Images = Record<string, string>

function setDb(order: OrderFixture, characterCount: number, images: Images): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: ids(characterCount).map((chaId) => ({ chaId, name: chaId, image: images[chaId] ?? '', type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null
let root: HTMLElement
let geo: Geometry

async function settleReads(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        await Promise.resolve()
        flushSync()
    }
    await tick()
    await defaultSettle()
}

async function mountRail(order: OrderFixture, images: Images, characters = order.length, height = 600): Promise<HTMLElement> {
    setDb(order, characters, images)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settleReads()
    root = target
    geo = installGeometry(target, height)!
    await settleFrame()
    await settleReads()
    return target
}

async function unmountRail(): Promise<void> {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
}

beforeEach(() => {
    resetRailMemory()
    resetAndroidTransport(true)
    checkCharOrderSpy.mockClear()
    changeCharSpy.mockClear()
    getCharImageSpy.mockClear()
    selectedCharID.set(-1)
    FakeImage.all = []
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetQueuedWholeReadsForTest()
    __avatarThumbTestHooks.reset()
    __avatarThumbTestHooks.setReadbackCheck(() => true)
    __avatarThumbTestHooks.setStore(skipRecordStore)
    __avatarThumbTestHooks.setGenerator(async () => null)
})

afterEach(async () => {
    vi.useRealTimers()
    try {
        await unmountRail()
    } catch {
        // a sidebar that failed half way through mounting is torn down best effort
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    __avatarThumbTestHooks.reset()
})

const entries = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-rail-entry]'))
const entryOf = (key: string): HTMLElement | null => entries().find((el) => el.getAttribute('data-rail-entry') === key) ?? null
const imgSrcs = (): string[] => Array.from(root.querySelectorAll('img')).map((image) => image.getAttribute('src') ?? '')
const exposed = (): number => exposedBytes(root, { minBytes: READ_MIN })

/** Fires `load` on the oldest unsettled fake image until none is left, checking the cap after every step. */
async function drainReads(): Promise<void> {
    for (let guard = 0; guard < 40; guard++) {
        const next = FakeImage.all.find((image) => !image.settled)
        if (!next) {
            return
        }
        next.fire('load')
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
    }
    throw new Error('reads never drained')
}

//#endregion

describe('rail burst on Android', () => {
    test('(R) T1 eight 20 MiB skipped avatars among 22 rail rows: at most 64 MiB of large files in flight, the 3 MiB files paint at once, all large avatars paint in the end', async () => {
        const images: Images = {}
        const big = ids(8).map((id, i) => {
            images[id] = bigOf(i)
            return bigOf(i)
        })
        const small = ids(14, 8).map((id, i) => {
            images[id] = smallOf(i)
            return smallOf(i)
        })
        seedSizes(big, 20)
        seedSizes(small, 3)
        // A viewport tall enough that the window (the viewport plus one overscan band below) holds all 22 rows.
        await mountRail(ids(22), images, 22, 1000)
        expect(entries().length).toBe(22)

        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
        const painted = imgSrcs()
        for (const key of small) {
            expect(painted).toContain(urlOf(key))
        }
        expect(unsettledSources()).toHaveLength(3)
        for (const source of unsettledSources()) {
            expect(big.map(urlOf)).toContain(source)
        }

        await drainReads()
        for (const key of big) {
            expect(imgSrcs()).toContain(urlOf(key))
        }
        expect(exposed()).toBe(0)
    })

    test('(R) T5f four folders with a 20 MiB picture: the backgrounds stay within 64 MiB and all paint in the end', async () => {
        const images: Images = {}
        const pictures = [0, 1, 2, 3].map(bigOf)
        seedSizes(pictures, 20)
        const order: OrderFixture = [0, 1, 2, 3].map((i) => folderOf(`f${i}`, [`c${i}`], pictures[i]))
        await mountRail(order, images, 4)
        expect(folderAvatars(root)).toHaveLength(4)

        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
        await drainReads()
        for (const key of pictures) {
            expect(domUrls(root)).toContain(urlOf(key))
        }
    })

    test('(R) T5m four members of an opened folder with a 20 MiB avatar: the member images stay within 64 MiB and all paint in the end', async () => {
        const images: Images = {}
        const files = [0, 1, 2, 3].map(bigOf)
        files.forEach((file, i) => {
            images[`c${i}`] = file
        })
        seedSizes(files, 20)
        await mountRail([folderOf('f1', ids(4))], images, 4)
        folderAvatars(root)[0].click()
        await settleReads()
        expect(root.querySelectorAll('[data-rail-kind="member"]')).toHaveLength(4)

        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
        await drainReads()
        for (const key of files) {
            expect(imgSrcs()).toContain(urlOf(key))
        }
    })

    test('(G) T2 rows scrolled out while waiting get no Image; after the reads settle and the rail unmounts no read is held', async () => {
        const images: Images = {}
        const big = ids(8).map((id, i) => {
            images[id] = bigOf(i)
            return bigOf(i)
        })
        ids(52, 8).forEach((id, i) => {
            images[id] = smallOf(i)
        })
        seedSizes(big, 20)
        seedSizes(ids(52).map((_, i) => smallOf(i)), 3)
        await mountRail(ids(60), images)
        // c0 is the Tab stop and stays pinned while it is outside the window; c1 is an ordinary row.
        expect(entryOf(charKey('c1'))).not.toBeNull()

        await geo.scrollAndSettle(rowTop(45))
        await settleReads()
        expect(entryOf(charKey('c1'))).toBeNull()

        for (const image of FakeImage.all.filter((candidate) => !candidate.settled)) {
            image.fire('load')
        }
        await settleReads()
        expect(FakeImage.all.length).toBeLessThanOrEqual(3)
        expect(unsettledSources()).toEqual([])

        await unmountRail()
        await settleReads()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })
})

describe('guards', () => {
    test('(G) T3 off Android every row paints at once with no Image, and getCharImage gets the same two-argument calls as before', async () => {
        resetAndroidTransport(false)
        const images: Images = { c0: bigOf(0), c2: bigOf(1), c3: smallOf(0) }
        seedSizes([bigOf(0), bigOf(1), smallOf(0), bigOf(2)], 20)
        const order: OrderFixture = ['c0', 'c1', folderOf('f1', ['c2'], bigOf(2)), folderOf('f2', ['c3'])]
        await mountRail(order, images, 4)
        folderAvatars(root)[0].click()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        const calls = getCharImageSpy.mock.calls as unknown[][]
        expect(calls.every((call) => call.length === 2)).toBe(true)
        expect(calls.map((call) => `${call[0]}|${call[1]}`).sort()).toEqual([bigOf(0), bigOf(1), bigOf(2)].map((loc) => `${loc}|thumb`).sort())
        expect(imgSrcs()).toContain(urlOf(bigOf(0)))
        expect(imgSrcs()).toContain(urlOf(bigOf(1)))
        expect(imgSrcs()).toContain('/none.webp')
        expect(domUrls(root)).toContain(urlOf(bigOf(2)))
    })

    test('(G) T4 a thumbnail hit paints at once with no Image, whatever the size of the file', async () => {
        const images: Images = {}
        const files = [0, 1, 2, 3].map(bigOf)
        files.forEach((file, i) => {
            images[`c${i}`] = file
        })
        seedSizes(files, 20)
        __avatarThumbTestHooks.setStore({ ...skipRecordStore, getItem: async () => ({ v: THUMB_VERSION, src: 'data:image/webp;base64,AAAA' }) })
        await mountRail(ids(4), images)

        expect(FakeImage.all).toHaveLength(0)
        expect(imgSrcs().filter((src) => src === 'data:image/webp;base64,AAAA')).toHaveLength(4)
    })

    test('(G) T4 a 4 MiB file paints at once with no Image', async () => {
        const images: Images = {}
        const files = [0, 1, 2, 3].map(bigOf)
        files.forEach((file, i) => {
            images[`c${i}`] = file
        })
        seedSizes(files, 4)
        await mountRail(ids(4), images)

        expect(FakeImage.all).toHaveLength(0)
        for (const key of files) {
            expect(imgSrcs()).toContain(urlOf(key))
        }
    })
})

describe('SidebarAvatar loc and backgroundLoc', () => {
    let target: HTMLElement | null = null
    let app: Record<string, unknown> | null = null

    afterEach(async () => {
        if (app) {
            await unmount(app as never)
        }
        target?.remove()
        app = null
        target = null
    })

    function mountAvatar(props: Record<string, unknown>): HTMLElement {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(SidebarAvatar, { target, props: props as never }) as unknown as Record<string, unknown>
        flushSync()
        return target
    }

    const imgOf = (element: HTMLElement): string | null => element.querySelector('img')?.getAttribute('src') ?? null

    test('(U) T6 a loc that changes while its read waits gives the old hold back, never paints the old image and ends with the new one', async () => {
        seedSizes(['assets/a.webp', 'assets/b.webp'], 20)
        androidTransport.sizes['assets/blocker.webp'] = 60 * MIB
        const blocker = await androidWholeReadQueue().acquire(60 * MIB)
        const props = $state({ loc: 'assets/a.webp', rounded: true, size: '56' })
        const element = mountAvatar(props)
        await settleReads()
        expect(FakeImage.all).toHaveLength(0)

        props.loc = 'assets/b.webp'
        await settleReads()
        blocker.release()
        await settleReads()
        expect(FakeImage.all.map((image) => image.src)).toEqual([urlOf('assets/b.webp')])
        expect(imgOf(element)).toBeNull()
        FakeImage.all[0].fire('load')
        await settleReads()
        expect(imgOf(element)).toBe(urlOf('assets/b.webp'))
        expect(element.innerHTML).not.toContain('Symbol')
        expect(element.innerHTML).not.toContain(urlOf('assets/a.webp'))
    })

    test('(U) T6 a loc that changes to an empty one while its read waits gives the hold back and shows the placeholder', async () => {
        seedSizes(['assets/a.webp'], 20)
        const blocker = await androidWholeReadQueue().acquire(60 * MIB)
        const props = $state({ loc: 'assets/a.webp', rounded: true, size: '56' })
        const element = mountAvatar(props)
        await settleReads()

        props.loc = ''
        await settleReads()
        expect(imgOf(element)).toBe('/none.webp')
        blocker.release()
        await settleReads()
        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
        expect(element.innerHTML).not.toContain('Symbol')
    })

    test('(U) T6 a backgroundLoc that changes to an empty one while its read waits gives the hold back and paints no background', async () => {
        seedSizes(['assets/f.webp'], 20)
        const blocker = await androidWholeReadQueue().acquire(60 * MIB)
        const props = $state({ src: 'slot', backgroundLoc: 'assets/f.webp', rounded: true, size: '56' })
        const element = mountAvatar(props)
        await settleReads()

        props.backgroundLoc = ''
        await settleReads()
        blocker.release()
        await settleReads()
        expect(FakeImage.all).toHaveLength(0)
        expect(domUrls(element)).toEqual([])
        expect(element.innerHTML).not.toContain('Symbol')
    })

    test('(U) destroying the avatar while its read waits gives the hold back without an Image', async () => {
        seedSizes(['assets/a.webp'], 20)
        const blocker = await androidWholeReadQueue().acquire(60 * MIB)
        mountAvatar({ loc: 'assets/a.webp', rounded: true, size: '56' })
        await settleReads()
        await unmount(app as never)
        app = null
        blocker.release()
        await settleReads()
        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })
})
