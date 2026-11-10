// @vitest-environment jsdom

/**
 * The surfaces the user opens on Android: the character picker of `AlertComp.svelte` and the expanded rows of
 * `BookmarkList.svelte` read their avatars through a hold, so a file of 8 MiB or more waits in the app-wide whole-read
 * queue instead of being put on the page together with the other large images.
 *
 * The real components are mounted. `getCharImage` is the kit's mirror (`wholeReadQueue.testKit.ts`; the util test checks it
 * against the real function) behind a spy; the queue, the size verdict and the detached `Image` are the real ones. The
 * picker's `nearViewport` action is replaced by a registry so a test decides which rows are in view. `Chat.svelte` is a
 * stand-in whose icon is a `div` that takes the awaited `img` prop as its style, which is how the real `Chat` consumes it.
 *
 * "Held grant": the test takes 60 MiB of the 64 MiB queue itself, as a chat image would, so any larger read must wait.
 *
 * Labels: `(R)` is a regression reproducer (fails at the pre-fix components), `(G)` a compatibility guard, `(U)` a rule test.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import { language } from 'src/lang'
import 'src/ts/polyfill'

const h = vi.hoisted(() => ({
    getCharImageSpy: vi.fn(),
    userIcon: '',
    // One entry per mounted picker row, in render order.
    pickerRows: [] as Array<{ node: Element, onChange: (visible: boolean, node: Element) => void }>,
}))

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

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
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
    const scrollToMessage = $state({ value: -1 })
    return {
        DBState: state,
        selectedCharID: writable(0),
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
        bookmarkListOpen: writable(true),
        alertGenerationInfoStore: writable(null),
        createSimpleCharacter: vi.fn(() => ({ name: 'A' })),
        ScrollToMessageStore: scrollToMessage,
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getCharImage: h.getCharImageSpy,
    } as unknown as typeof import('../../ts/characters')
})

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isAndroidTransport: () => androidTransport.android,
    statStoredSize: async (key: string) => androidTransport.sizes[key] ?? 0,
}))

vi.mock('src/ts/gui/nearViewport.svelte', () => ({
    nearViewport: (node: Element, options: { onChange: (visible: boolean, node: Element) => void }) => {
        const row = { node, onChange: options.onChange }
        h.pickerRows.push(row)
        return {
            destroy: () => {
                const at = h.pickerRows.indexOf(row)
                if (at !== -1) {
                    h.pickerRows.splice(at, 1)
                }
            },
        }
    },
}))

// The icon of a row is a `div` that takes the awaited `img` prop as its style, as the real `Chat` does.
vi.mock('../ChatScreens/Chat.svelte', () => ({
    default: (anchor: ChildNode, props: { img?: string | Promise<string | null>, expectedId?: string }) => {
        const icon = document.createElement('div')
        icon.setAttribute('data-test-icon', props.expectedId ?? '')
        anchor.before(icon)
        void Promise.resolve(props.img).then((style) => icon.setAttribute('style', style ?? ''))
        return {}
    },
}))

vi.mock('src/ts/process/composerActions.svelte', () => ({
    branchAt: vi.fn(),
    isComposerBusy: vi.fn(() => false),
}))

vi.mock('src/ts/process/index.svelte', () => ({
    doingChat: writable(false),
}))

vi.mock(import('src/ts/util'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getUserName: vi.fn(() => 'User'),
        getUserIcon: vi.fn(() => h.userIcon),
    } as unknown as typeof import('src/ts/util')
})

//#endregion

import { alertStore, DBState, bookmarkListOpen } from '../../ts/stores.svelte'
import AlertComp from './AlertComp.svelte'
import BookmarkList from './BookmarkList.svelte'
import { androidWholeReadQueue, resetAndroidWholeReadQueueForTest, resetAssetUrlGateForTest } from 'src/ts/storage/assetUrlGate'
import { heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from 'src/ts/media/queuedWholeRead'
import {
    FakeImage, MIB, WHOLE_READ_BUDGET_BYTES, androidTransport, createMirroredGetCharImage, domUrls, exposedBytes, resetAndroidTransport,
    seedSizes, urlOf,
} from 'src/ts/media/wholeReadQueue.testKit'

const READ_MIN = 8 * MIB
const cssStyleOf = (key: string): string => `background: url("${urlOf(key)}");background-size: cover;`

const mounted: Array<{ instance: unknown, target: HTMLElement }> = []

function show(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(component, { target, props })
    mounted.push({ instance, target })
    flushSync()
    return target
}

async function settleReads(): Promise<void> {
    for (let i = 0; i < 40; i++) {
        await Promise.resolve()
        flushSync()
    }
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function unmountAll(): Promise<void> {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
}

/** Takes 60 MiB of the app-wide queue, as a chat image in flight would. */
async function holdBudget(): Promise<{ release: () => void }> {
    return androidWholeReadQueue().acquire(60 * MIB)
}

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

const loadedSources = (): string[] => FakeImage.all.map((image) => image.src)

beforeEach(() => {
    resetAndroidTransport(true)
    h.getCharImageSpy.mockReset()
    h.getCharImageSpy.mockImplementation(createMirroredGetCharImage(() => false))
    h.pickerRows.length = 0
    h.userIcon = ''
    FakeImage.all = []
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetAndroidWholeReadQueueForTest()
    resetQueuedWholeReadsForTest()
    bookmarkListOpen.set(true)
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    await unmountAll()
    document.body.innerHTML = ''
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

//#region AlertComp

interface PickerCharacter { chaId: string, image: string }

function installPickerDb(characters: PickerCharacter[]): void {
    DBState.db = {
        hideAllImages: false,
        characters: characters.map((character) => ({
            type: 'character', name: character.chaId, chaId: character.chaId, image: character.image, chats: [],
        })),
    } as unknown as Database
}

function showPicker(): HTMLElement {
    alertStore.set({ type: 'selectChar', msg: '' } as never)
    return show(AlertComp)
}

function setVisible(row: number, visible: boolean): void {
    const entry = h.pickerRows[row]
    entry.onChange(visible, entry.node)
    flushSync()
}

const pickerIcons = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>('button.ico'))
const styleOfRow = (target: HTMLElement, row: number): string => pickerIcons(target)[row]?.getAttribute('style') ?? ''

// The number of `getCharImage` calls the picker makes for two visible rows off Android; it is the count of the
// component before the hold, so the migrated component must not add or drop a call.
const PICKER_CALLS_OFF_ANDROID = 2

const PICKER_IMAGES = ['assets/p0.webp', 'assets/p1.webp', 'assets/p2.webp', 'assets/p3.webp']
const pickerFour = (): PickerCharacter[] => PICKER_IMAGES.map((image, index) => ({ chaId: `cha-${index}`, image }))

describe('AlertComp character picker on Android', () => {
    test('(R) T13 four visible 20 MiB avatars stay within 64 MiB in flight, and all paint in the end', async () => {
        installPickerDb(pickerFour())
        seedSizes(PICKER_IMAGES, 20)
        const target = showPicker()
        for (let row = 0; row < 4; row++) {
            setVisible(row, true)
        }
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        for (let row = 0; row < 4; row++) {
            expect(styleOfRow(target, row)).toContain(urlOf(PICKER_IMAGES[row]))
        }

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T13 rows that are scrolled out while their read waits give the entry back without an Image', async () => {
        installPickerDb(pickerFour())
        seedSizes(PICKER_IMAGES, 20)
        const grant = await holdBudget()
        const target = showPicker()
        for (let row = 0; row < 4; row++) {
            setVisible(row, true)
        }
        await settleReads()
        expect(domUrls(target)).toEqual([])

        setVisible(0, false)
        setVisible(1, false)
        await settleReads()
        grant.release()
        await settleReads()
        await drainReads()

        expect(loadedSources()).not.toContain(urlOf(PICKER_IMAGES[0]))
        expect(loadedSources()).not.toContain(urlOf(PICKER_IMAGES[1]))
        expect(styleOfRow(target, 0)).toBe('')
        expect(styleOfRow(target, 1)).toBe('')
        expect(styleOfRow(target, 2)).toContain(urlOf(PICKER_IMAGES[2]))
        expect(styleOfRow(target, 3)).toContain(urlOf(PICKER_IMAGES[3]))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T13 closing the alert while rows wait gives every waiting entry back without an Image', async () => {
        installPickerDb(pickerFour())
        seedSizes(PICKER_IMAGES, 20)
        const grant = await holdBudget()
        showPicker()
        for (let row = 0; row < 4; row++) {
            setVisible(row, true)
        }
        await settleReads()

        await unmountAll()
        grant.release()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(G) T13d two visible rows that share a chaId paint their own images, and scrolling one out leaves the other read alone', async () => {
        const shared = [
            { chaId: 'same-id', image: 'assets/dupA.webp' },
            { chaId: 'same-id', image: 'assets/dupB.webp' },
        ]
        installPickerDb(shared)
        seedSizes(['assets/dupA.webp', 'assets/dupB.webp'], 20)
        const grant = await holdBudget()
        const target = showPicker()
        setVisible(0, true)
        setVisible(1, true)
        await settleReads()
        grant.release()
        await settleReads()
        await drainReads()
        expect(styleOfRow(target, 0)).toContain(urlOf('assets/dupA.webp'))
        expect(styleOfRow(target, 1)).toContain(urlOf('assets/dupB.webp'))
        await unmountAll()

        FakeImage.all = []
        resetQueuedWholeReadsForTest()
        installPickerDb(shared)
        const grantAgain = await holdBudget()
        const again = showPicker()
        setVisible(0, true)
        setVisible(1, true)
        await settleReads()
        setVisible(1, false)
        await settleReads()
        grantAgain.release()
        await settleReads()
        await drainReads()
        expect(styleOfRow(again, 0)).toContain(urlOf('assets/dupA.webp'))
        expect(loadedSources()).not.toContain(urlOf('assets/dupB.webp'))
    })

    test('(G) T17 off Android the visible rows paint at once with two-argument calls and no Image', async () => {
        resetAndroidTransport(false)
        installPickerDb(pickerFour())
        seedSizes(PICKER_IMAGES, 20)
        const target = showPicker()
        setVisible(0, true)
        setVisible(2, true)
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(styleOfRow(target, 0)).toContain(urlOf(PICKER_IMAGES[0]))
        expect(styleOfRow(target, 1)).toBe('')
        expect(styleOfRow(target, 2)).toContain(urlOf(PICKER_IMAGES[2]))
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBe(PICKER_CALLS_OFF_ANDROID)
        expect(calls.every((call) => call.length === 2 && call[1] === 'thumbcss')).toBe(true)
        expect(new Set(calls.map((call) => call[0]))).toEqual(new Set([PICKER_IMAGES[0], PICKER_IMAGES[2]]))
    })
})

//#endregion

//#region BookmarkList

const SPEAKER_IMAGES = ['assets/sp0.webp', 'assets/sp1.webp', 'assets/sp2.webp', 'assets/sp3.webp']

function installBookmarkDb(options: { group: boolean, speakerOfMessage?: string[], image?: string }): void {
    const speakers = SPEAKER_IMAGES.map((image, index) => ({
        type: 'character', chaId: `sp-${index}`, name: `sp-${index}`, image, chats: [], largePortrait: false,
    }))
    const sayings = options.speakerOfMessage ?? ['sp-0', 'sp-1', 'sp-2', 'sp-3', 'sp-0']
    const messages = options.group
        ? sayings.map((saying, index) => ({ role: 'char', data: `m${index}`, chatId: `b${index}`, saying }))
        : [
            { role: 'user', data: 'hello', chatId: 'b0' },
            { role: 'char', data: 'hi', chatId: 'b1' },
        ]
    const first = {
        type: options.group ? 'group' : 'character',
        chaId: 'host', name: 'host', image: options.image ?? '', largePortrait: false,
        chatPage: 0,
        chats: [{
            message: messages,
            bookmarks: messages.map((message) => message.chatId),
            bookmarkNames: {},
        }],
        characters: [],
    }
    DBState.db = { hideAllImages: false, characters: [first, ...speakers] } as unknown as Database
}

function showBookmarks(): HTMLElement {
    const target = show(BookmarkList)
    const toggle = Array.from(target.querySelectorAll('button')).find((button) => button.getAttribute('title') === language.expandAll)
    toggle!.click()
    flushSync()
    return target
}

const styleOfRowIcon = (name: string): string => document.body.querySelector(`[data-test-icon="${name}"]`)?.getAttribute('style') ?? ''

describe('BookmarkList expanded rows on Android', () => {
    test('(R) T14 expand-all of four 20 MiB speakers, one of them twice, stays within 64 MiB and reads each image once', async () => {
        installBookmarkDb({ group: true })
        seedSizes(SPEAKER_IMAGES, 20)
        showBookmarks()
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        expect(styleOfRowIcon('b0')).toBe(cssStyleOf(SPEAKER_IMAGES[0]))
        expect(styleOfRowIcon('b1')).toBe(cssStyleOf(SPEAKER_IMAGES[1]))
        expect(styleOfRowIcon('b2')).toBe(cssStyleOf(SPEAKER_IMAGES[2]))
        expect(styleOfRowIcon('b3')).toBe(cssStyleOf(SPEAKER_IMAGES[3]))
        expect(styleOfRowIcon('b4')).toBe(cssStyleOf(SPEAKER_IMAGES[0]))
        expect(loadedSources().filter((source) => source === urlOf(SPEAKER_IMAGES[0]))).toHaveLength(1)

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T14 a closed list gives every waiting speaker entry back without an Image', async () => {
        installBookmarkDb({ group: true })
        seedSizes(SPEAKER_IMAGES, 20)
        const grant = await holdBudget()
        showBookmarks()
        await settleReads()
        expect(styleOfRowIcon('b0')).toBe('')

        await unmountAll()
        grant.release()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(R) T14 the user and character icons of a single-character chat stay within the cap', async () => {
        h.userIcon = 'assets/user.webp'
        installBookmarkDb({ group: false, image: 'assets/host.webp' })
        seedSizes(['assets/user.webp', 'assets/host.webp'], 40)
        showBookmarks()
        await settleReads()
        expect(exposed()).toBeLessThanOrEqual(WHOLE_READ_BUDGET_BYTES)

        await drainReads()
        expect(styleOfRowIcon('b0')).toBe(cssStyleOf('assets/user.webp'))
        expect(styleOfRowIcon('b1')).toBe(cssStyleOf('assets/host.webp'))

        await unmountAll()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('(U) a message without a speaker asks for the empty location, never for undefined', async () => {
        installBookmarkDb({ group: true, speakerOfMessage: ['', 'sp-0'] })
        seedSizes(SPEAKER_IMAGES, 20)
        showBookmarks()
        await settleReads()
        await drainReads()

        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBeGreaterThan(0)
        expect(calls.every((call) => typeof call[0] === 'string')).toBe(true)
        expect(calls.map((call) => call[0])).toContain('')
    })

    test('(G) T17 off Android the rows paint at once with two-argument calls and no Image', async () => {
        resetAndroidTransport(false)
        h.userIcon = 'assets/user.webp'
        installBookmarkDb({ group: false, image: 'assets/host.webp' })
        seedSizes(['assets/user.webp', 'assets/host.webp'], 40)
        showBookmarks()
        await settleReads()

        expect(FakeImage.all).toHaveLength(0)
        expect(styleOfRowIcon('b0')).toBe(cssStyleOf('assets/user.webp'))
        expect(styleOfRowIcon('b1')).toBe(cssStyleOf('assets/host.webp'))
        const calls = h.getCharImageSpy.mock.calls as unknown[][]
        expect(calls.length).toBe(2)
        expect(calls.every((call) => call.length === 2 && call[1] === 'css')).toBe(true)
        expect(calls.map((call) => call[0]).sort()).toEqual(['assets/host.webp', 'assets/user.webp'])
    })
})

//#endregion
