// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`: an error caught while scrolling to the held tile or to a new folder is recorded in the
 * caught-error record (`window.__risuTaniumErrors`) and does not disturb the edit session. Assertions read only
 * that record, so a build whose catches do not record fails on a missing entry.
 *
 * Fixture: twenty characters then a closed folder F1 among the last ones; at four columns (a 312 px container)
 * and the 64 px fallback row height My order is six rows, [F1, Char 17, Char 18, Char 19] in row 4. The scroller's
 * scroll position refuses every write except the reset to 0, so the centring write of the continuation throws.
 *
 * MOCKED: the module set of `GridCatalog.group.svelte.test.ts` (same directory). Pointer events are synthetic and
 * the long press runs on fake timers.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, folder } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

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

const { alertSelectSpy } = vi.hoisted(() => ({
    alertSelectSpy: vi.fn(),
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

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
        removeChar: vi.fn(),
        trashCharacters: vi.fn(async () => 0),
    }
})

vi.mock(import('../../ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertSelect: alertSelectSpy,
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { language } from '../../lang'
import { setLiveKeysBlockedReader } from '../../ts/keyEventBlocked'
import { GRID_SORT_KEY } from './gridMemory'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type OrderFixture = Database['characterOrder']

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function makeFolder(id: string, name: string, data: string[]): folder {
    return { id, name, data, color: '' }
}

function tallFixture(): void {
    const names = Array.from({ length: 20 }, (_, i) => `Char ${String(i + 1).padStart(2, '0')}`)
    const characters = [
        ...names.map((name, i) => makeCharacter(`N${i + 1}`, name)),
        makeCharacter('M1', 'Member 1'),
        makeCharacter('M2', 'Member 2'),
    ]
    const ids = names.map((_, i) => `N${i + 1}`)
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        characterOrder: [...ids.slice(0, 16), makeFolder('f1', 'F1', ['M1', 'M2']), ...ids.slice(16)] as unknown as OrderFixture,
        hideAllImages: false,
    } as unknown as Database
}

const NEW_FOLDER = language.sidebarUi.defaultFolderName
const FOUR_COLUMNS = 312
const VIEW = 128
const CONTENT = 448

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

const endGridSpy = vi.fn()

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text.trim())

function clickButton(root: ParentNode, text: string): void {
    const button = buttonByText(root, text)
    if (!button) {
        throw new Error(`no button "${text}"`)
    }
    button.click()
    flushSync()
}

async function withMounted(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid: endGridSpy } }) as Record<string, unknown>
    try {
        await settle()
        clickButton(target, language.grid)
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

const isEditing = (root: ParentNode): boolean => buttonByText(root, language.othersUi.editDone) !== undefined
const tileNames = (root: ParentNode): string[] =>
    Array.from(root.querySelectorAll('[data-charlist-key]')).map((card) => card.querySelector('button')?.getAttribute('aria-label') ?? '')
const scrollerOf = (root: ParentNode): HTMLElement => root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')!

function firePointer(type: 'pointerdown' | 'pointerup', target: EventTarget, x: number, y: number): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: 'touch' },
        isPrimary: { value: true },
    })
    target.dispatchEvent(event)
}

/** The centre of tile `n` of a row of `count` tiles in row `row` of a 312 px container, at scroll position 0. */
const tileCentre = (count: number, n: number, row: number): { x: number, y: number } => ({
    x: (312 - (count * 56 + (count - 1) * 8)) / 2 + n * 64 + 28,
    y: row * 64 + 28,
})

/** A hold on the scroller itself at (x, y), so tiles outside the mounted rows are reachable. */
async function holdAt(scroller: HTMLElement, x: number, y: number): Promise<void> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
        firePointer('pointerdown', scroller, x, y)
        vi.advanceTimersByTime(600)
        flushSync()
        await settle()
        firePointer('pointerup', window, x, y)
        await settle()
    } finally {
        vi.useRealTimers()
    }
}

/** A scroller that reports a 128 px view over 448 px of content and refuses every scroll write except the reset to 0. */
function refuseScrolling(scroller: HTMLElement, message: string): void {
    Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => 0,
        set: (value: number) => {
            if (value !== 0) {
                throw new Error(message)
            }
        },
    })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEW })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => CONTENT })
    scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: FOUR_COLUMNS, bottom: VIEW, width: FOUR_COLUMNS, height: VIEW, x: 0, y: 0, toJSON: () => ({}) })
}

const recordedMessages = (): string[] => (window.__risuTaniumErrors ?? []).map((record) => record.message)

let menus: string[][] = []
let answerOpenMenu: ((value: string) => void) | null = null
let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    localStorage.clear()
    endGridSpy.mockClear()
    menus = []
    answerOpenMenu = null
    alertSelectSpy.mockReset()
    alertSelectSpy.mockImplementation((labels: string[]) => {
        menus.push(labels)
        return new Promise<string>((resolve) => {
            answerOpenMenu = resolve
        })
    })
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => FOUR_COLUMNS })
    vi.stubGlobal('ResizeObserver', undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetBackHandlersForTests()
    vi.useRealTimers()
    setLiveKeysBlockedReader(() => false)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

describe('Grid scrolling: caught errors are recorded', () => {
    test('(R) a scroll to the held tile that throws is recorded and edit mode stays entered', async () => {
        tallFixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            refuseScrolling(scroller, 'T9 held scroll refused')
            const { x, y } = tileCentre(4, 1, 4)
            await holdAt(scroller, x, y)
            expect(isEditing(target)).toBe(true)
            expect(recordedMessages()).toContain('T9 held scroll refused')
        })
    })

    test('(R) a scroll to the new folder that throws is recorded and the group stands', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            refuseScrolling(scroller, 'T9 folder scroll refused')
            const first = tileCentre(4, 2, 4)
            await holdAt(scroller, first.x, first.y)
            const second = tileCentre(1, 0, 5)
            await holdAt(scroller, second.x, second.y)
            expect(menus).toHaveLength(1)
            answerOpenMenu!('0')
            await settle()
            expect(tileNames(target)).toContain(NEW_FOLDER)
            expect(recordedMessages()).toContain('T9 folder scroll refused')
        })
    })
})
