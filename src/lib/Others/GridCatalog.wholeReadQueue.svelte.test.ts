// @vitest-environment jsdom

/**
 * The Grid tab's folder tiles on Android: a folder picture of 8 MiB or more (a whole file, because its thumbnail is
 * missing or skipped) waits in the app-wide whole-read queue instead of being put on the tiles together with the others.
 * Off Android the tile keeps its per-instance lookup memo and the two-argument `getCharImage` call.
 *
 * The real `GridCatalog.svelte`, the REAL `getCharImage` behind a spy, the REAL size verdict and queue; `getFileSrc` is the
 * kit's Android mirror, `Image` the kit's fake, and the thumbnail lookup answers `null` (no thumbnail), as in
 * `GridCatalog.folders.svelte.test.ts`, whose mount and mock pattern this file follows.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix grid), `(G)` a compatibility guard.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, folder } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import type { CharImageOptions } from '../../ts/characters'

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

const { getCharImageSpy } = vi.hoisted(() => ({ getCharImageSpy: vi.fn() }))

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
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
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

// `getCharImage` is the real one behind a spy, so the arguments of every call are on record.
vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    getCharImageSpy.mockImplementation((loc: string, type: Parameters<typeof actual.getCharImage>[1], options?: CharImageOptions) =>
        options === undefined ? actual.getCharImage(loc, type) : actual.getCharImage(loc, type, options),
    )
    return { ...actual, changeChar: vi.fn(), removeChar: vi.fn(), getCharImage: getCharImageSpy }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

// The Grid tab builds no tile until its container reports a width: every element reports 312 px, room for four tiles.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'
import { resetAndroidWholeReadQueueForTest, resetAssetUrlGateForTest } from '../../ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from '../../ts/media/queuedWholeRead'
import {
    FakeImage, MIB, WHOLE_READ_BUDGET_BYTES, androidFileSrc, androidTransport, domUrls, exposedBytes, resetAndroidTransport, seedSizes, urlOf,
} from '../../ts/media/wholeReadQueue.testKit'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type OrderFixture = Database['characterOrder']

const READ_MIN = 8 * MIB
const pictureOf = (i: number): string => `assets/folder${i}.webp`

function makeCharacter(chaId: string): CharacterFixture {
    return {
        chaId,
        name: `Char ${chaId}`,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function makeFolder(id: string, name: string, data: string[], extra: Partial<folder> = {}): folder {
    return { id, name, data, color: '', ...extra }
}

/** Four folders, each with one member and a picture of its own. */
function installFolders(count = 4): string[] {
    const pictures = Array.from({ length: count }, (_, i) => pictureOf(i))
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: pictures.map((_, i) => makeCharacter(`c${i}`)),
        characterOrder: pictures.map((picture, i) => makeFolder(`f${i}`, `F${i}`, [`c${i}`], { imgFile: picture })) as unknown as OrderFixture,
        hideAllImages: false,
    } as unknown as Database
    return pictures
}

async function settleReads(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        flushSync()
        await Promise.resolve()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

let mounted: { target: HTMLElement, app: Record<string, unknown> } | null = null

async function mountGrid(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid: () => {} } }) as Record<string, unknown>
    mounted = { target, app }
    await settleReads()
    const label = language.grid.trim()
    const button = Array.from(target.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label)
    if (!button) {
        throw new Error('grid tab button not found')
    }
    button.click()
    await settleReads()
    return target
}

async function unmountGrid(): Promise<void> {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
}

const folderTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-expanded][aria-label="${name}"]`)

const exposed = (): number => exposedBytes(document.body, { minBytes: READ_MIN })

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

const thumbCalls = (): unknown[][] => (getCharImageSpy.mock.calls as unknown[][]).filter((call) => call[1] === 'thumbcss')

//#endregion

beforeEach(() => {
    resetAndroidTransport(true)
    getCharImageSpy.mockClear()
    FakeImage.all = []
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetAndroidWholeReadQueueForTest()
    resetQueuedWholeReadsForTest()
    localStorage.clear()
})

afterEach(async () => {
    await unmountGrid()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
})

describe('folder pictures on Android', () => {
    test('(R) T11 four folders with a 20 MiB picture: the tiles stay within 64 MiB in flight, all paint in the end, no read is held after unmount', async () => {
        const pictures = installFolders()
        seedSizes(pictures, 20)
        const target = await mountGrid()
        expect(folderTile(target, 'F0')).not.toBeNull()
        expect(folderTile(target, 'F3')).not.toBeNull()

        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)
        await drainReads()
        for (const picture of pictures) {
            expect(domUrls(target)).toContain(urlOf(picture))
        }

        await unmountGrid()
        await settleReads()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T11 a folder that opens and closes does not ask for its picture again, and the picture stays', async () => {
        const pictures = installFolders(2)
        seedSizes(pictures, 20)
        const target = await mountGrid()
        await drainReads()
        const asked = thumbCalls().length
        const images = FakeImage.all.length

        folderTile(target, 'F0')!.click()
        await settleReads()
        folderTile(target, 'F0')!.click()
        await settleReads()

        expect(thumbCalls()).toHaveLength(asked)
        expect(FakeImage.all).toHaveLength(images)
        expect(domUrls(target)).toContain(urlOf(pictures[0]))
        expect(domUrls(target)).toContain(urlOf(pictures[1]))
    })
})

describe('folder pictures off Android', () => {
    test('(G) T11g every picture paints at once with no Image, and an entries rebuild repeats no two-argument call', async () => {
        resetAndroidTransport(false)
        const pictures = installFolders()
        seedSizes(pictures, 20)
        const target = await mountGrid()

        expect(FakeImage.all).toHaveLength(0)
        for (const picture of pictures) {
            expect(domUrls(target)).toContain(urlOf(picture))
        }
        const before = thumbCalls().map((call) => [...call])
        expect(before).toHaveLength(4)
        expect(before.every((call) => call.length === 2)).toBe(true)
        expect(before.map((call) => call[0]).sort()).toEqual([...pictures].sort())

        folderTile(target, 'F1')!.click()
        await settleReads()
        folderTile(target, 'F1')!.click()
        await settleReads()
        expect(thumbCalls().map((call) => [...call])).toEqual(before)
    })
})
