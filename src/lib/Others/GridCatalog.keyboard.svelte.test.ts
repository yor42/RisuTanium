// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Grid tab: Alt+Left and Alt+Right on a focused tile in edit mode move that one
 * tile one place, through the rail's `keyboardMove`, and write the saved order the way a drop does (the
 * assignment of `characterOrder` followed by `checkCharOrder`, here a spy). The result is announced with
 * the rail's words and focus stays on the moved tile.
 *
 * Labels: R = the intended behaviour, which fails by assertion on the code without the keyboard handler
 * (nothing moves there, and a handled key is not kept from the browser); R through a control = the same,
 * failing there through an assertion on a control step that does move; F = a guard that passes before and
 * after, its negative half evidenced by the named mutant (K-M1 to K-M19 are the mutation run recorded in
 * the stage report, on scratch copies of the component reached through a vite alias). Geometry:
 * four columns (a 312 px container) and 64 px rows; happy-dom measures nothing. Synthetic key events do
 * not prove the native key path (Alt+Left is history Back in a real browser; `defaultPrevented` is the
 * observable stand-in).
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

const { changeCharSpy, removeCharSpy, trashCharactersSpy, checkCharOrderSpy, alertSelectSpy, alertConfirmSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    trashCharactersSpy: vi.fn(),
    checkCharOrderSpy: vi.fn(),
    alertSelectSpy: vi.fn(),
    alertConfirmSpy: vi.fn(),
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
            checkCharOrder: checkCharOrderSpy,
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
        changeChar: changeCharSpy,
        removeChar: removeCharSpy,
        trashCharacters: trashCharactersSpy,
    }
})

vi.mock(import('../../ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertSelect: alertSelectSpy,
        alertConfirm: alertConfirmSpy,
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

import { recordKeyEventBlocked } from '../../ts/keyEventBlocked'
import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
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

function install(characters: CharacterFixture[], order: Array<string | folder>): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        characterOrder: order as unknown as OrderFixture,
        hideAllImages: false,
    } as unknown as Database
}

/** Characters `ids`, each named `Char <id>`, and the order given. */
function world(ids: string[], order: Array<string | folder>): void {
    install(ids.map((id) => makeCharacter(id, `Char ${id}`)), order)
}

/** Eight characters A to H in one flat order: two rows of four. */
function flat(): void {
    world(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
}

/** Twenty-four characters N01 to N24 in one flat order: six rows of four. */
function tall(): string[] {
    const ids = Array.from({ length: 24 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`)
    world(ids, [...ids])
    return ids
}

/** The saved order as text: a character as its id, a folder as `name[members]`. */
const shape = (): string[] =>
    (DBState.db.characterOrder as unknown as Array<string | folder>).map((entry) =>
        typeof entry === 'string' ? entry : `${entry.name}[${entry.data.join(',')}]`)

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

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

const editButton = (root: ParentNode): HTMLButtonElement | undefined =>
    buttonByText(root, language.othersUi.editMode) ?? buttonByText(root, language.othersUi.editDone)
const isEditing = (root: ParentNode): boolean => buttonByText(root, language.othersUi.editDone) !== undefined
const picked = (root: ParentNode): number => root.querySelectorAll('[data-charlist-picked]').length
const charTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`[data-charlist-key] button[aria-label="${name}"]`)
const folderTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-expanded][aria-label="${name}"]`)
const chevrons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>(`button[aria-label="${language.othersUi.editFolderToggle}"]`))
const scrollerOf = (root: ParentNode): HTMLElement => root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')!
const pressedOf = (root: ParentNode, name: string): string | null =>
    (charTile(root, name) ?? folderTile(root, name))?.getAttribute('aria-pressed') ?? null
const liveText = (): string => document.querySelector('[data-grid-live]')?.textContent?.trim() ?? ''

/**
 * A tap on a tile. The click a real browser sends after a drag is swallowed once by the gesture machine;
 * the test releases without it, so a click on the scroller itself first consumes that suppression.
 */
async function tap(root: ParentNode, name: string): Promise<void> {
    const tile = charTile(root, name) ?? folderTile(root, name)
    if (!tile) {
        throw new Error(`no tile "${name}"`)
    }
    scrollerOf(root).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    tile.click()
    await settle()
}

async function openAllFolders(root: ParentNode): Promise<void> {
    for (;;) {
        const closed = chevrons(root).find((chevron) => chevron.getAttribute('aria-expanded') === 'false')
        if (!closed) {
            return
        }
        closed.click()
        await settle()
    }
}

/** A pointer event with the fields the gesture machine reads. */
function firePointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', target: EventTarget, p: Pt, pointerType = 'touch'): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0 })
    Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: pointerType },
        isPrimary: { value: true },
    })
    target.dispatchEvent(event)
}

interface Pt { x: number, y: number }

const COLUMNS_WIDTH = 312
/** Left edge of a row of `count` tiles in the 312 px container. */
const inset = (count: number): number => (COLUMNS_WIDTH - (count * 56 + (count - 1) * 8)) / 2
/** The centre of the tile at (row, col) of a row holding `count` tiles. */
const centre = (row: number, col: number, count = 4): Pt => ({ x: inset(count) + col * 64 + 28, y: row * 64 + 28 })

const VIEW = 640

interface ScrollStub {
    writes: number[]
    top: () => number
}

/** Element geometry the scroller reports in a real layout: happy-dom reports zeros. */
function stubScroller(scroller: HTMLElement, view: number, content: number): ScrollStub {
    let top = 0
    const writes: number[] = []
    Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value: number) => {
            writes.push(value)
            top = value
        },
    })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => view })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => content })
    scroller.getBoundingClientRect = () => ({
        left: 0, top: 0, right: COLUMNS_WIDTH, bottom: view, width: COLUMNS_WIDTH, height: view, x: 0, y: 0, toJSON: () => ({}),
    })
    return { writes, top: () => top }
}

interface Rig {
    target: HTMLElement
    scroller: HTMLElement
    stub: ScrollStub
    /** Unmounts the screen now; the cleanup afterwards does nothing more. */
    unmountNow: () => Promise<void>
}

interface RigOptions {
    edit?: boolean
    view?: number
    content?: number
}

let containerWidth = COLUMNS_WIDTH
let clientWidthDescriptor: PropertyDescriptor | undefined
const endGridSpy = vi.fn()

/**
 * Mounts the Grid tab with the scroller stubbed, enters edit mode (unless `edit` is false) and runs
 * `body` under fake timers (setTimeout and clearTimeout only), so a hold, a dwell and the search
 * debounce are driven by `advanceTimersByTime`.
 */
async function withGrid(options: RigOptions, body: (rig: Rig) => Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid: endGridSpy } }) as Record<string, unknown>
    let unmounted = false
    const unmountNow = async (): Promise<void> => {
        if (!unmounted) {
            unmounted = true
            await unmount(app as never)
        }
    }
    try {
        await settle()
        clickButton(target, language.grid)
        await settle()
        const scroller = scrollerOf(target)
        const view = options.view ?? VIEW
        const stub = stubScroller(scroller, view, options.content ?? view)
        if (options.edit !== false) {
            editButton(target)!.click()
            await settle()
        }
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            await body({ target, scroller, stub, unmountNow })
        } finally {
            vi.useRealTimers()
        }
    } finally {
        await unmountNow()
        target.remove()
    }
}

function typeSearch(root: ParentNode, value: string): void {
    const input = root.querySelector<HTMLInputElement>('input[type="text"]')
    if (!input) {
        throw new Error('search input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

/** Types `value` and lets the 150 ms debounce pass, so the query has landed. */
async function search(root: ParentNode, value: string): Promise<void> {
    typeSearch(root, value)
    vi.advanceTimersByTime(150)
    await settle()
}

interface Gesture {
    from: Pt
    /** Points visited before `to`, in order. */
    path?: Pt[]
    to: Pt
    type?: 'touch' | 'mouse'
    /** Milliseconds the touch stays down before the first move (default: the 500 ms hold). */
    hold?: number
    /** Milliseconds the pointer rests at `to` before the release. */
    dwell?: number
    /** False leaves the finger down. */
    release?: boolean
}

/** Press, hold (touch), move through the path, rest, release. */
async function gesture(rig: Rig, g: Gesture): Promise<void> {
    const type = g.type ?? 'touch'
    firePointer('pointerdown', rig.scroller, g.from, type)
    if (type === 'touch') {
        vi.advanceTimersByTime(g.hold ?? 500)
        flushSync()
        await settle()
    }
    for (const p of [...(g.path ?? []), g.to]) {
        firePointer('pointermove', window, p, type)
        await settle()
    }
    if (g.dwell) {
        vi.advanceTimersByTime(g.dwell)
        flushSync()
        await settle()
    }
    if (g.release !== false) {
        firePointer('pointerup', window, g.to, type)
        await settle()
    }
}

/** The resolvers of the confirmation prompts still open. */
let confirmOpen: Array<(value: boolean) => void> = []

async function answerConfirm(yes: boolean): Promise<void> {
    const resolve = confirmOpen.shift()
    if (!resolve) {
        throw new Error('no confirmation is open')
    }
    resolve(yes)
    await settle()
}

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    checkCharOrderSpy.mockClear()
    endGridSpy.mockClear()
    trashCharactersSpy.mockReset()
    trashCharactersSpy.mockImplementation(async () => 0)
    confirmOpen = []
    alertConfirmSpy.mockReset()
    alertConfirmSpy.mockImplementation(() => new Promise<boolean>((resolve) => {
        confirmOpen.push(resolve)
    }))
    alertSelectSpy.mockReset()
    alertSelectSpy.mockImplementation(() => new Promise<string>(() => {}))
    containerWidth = COLUMNS_WIDTH
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => containerWidth })
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'vibrate')
    Reflect.deleteProperty(document, 'visibilityState')
    document.querySelectorAll('[data-grid-ghost]').forEach((el) => el.remove())
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

//#region keyboard helpers

type ArrowKey = 'ArrowLeft' | 'ArrowRight'

/** A keydown on `target` with Alt held; `init` overrides or adds fields. */
function altArrow(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
}

function tileButton(root: ParentNode, name: string): HTMLElement {
    const tile = charTile(root, name) ?? folderTile(root, name)
    if (!tile) {
        throw new Error(`no tile "${name}"`)
    }
    return tile
}

/** Focuses the tile named `name` and presses Alt+`key` on it. */
async function moveTile(root: ParentNode, name: string, key: ArrowKey, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
    const tile = tileButton(root, name)
    tile.focus()
    const event = altArrow(tile, key, init)
    await settle()
    return event
}

const focusedLabel = (): string => document.activeElement?.getAttribute('aria-label') ?? ''

function threeUp(): void {
    world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E'])])
}

//#endregion

describe('Grid keyboard: one place', () => {
    test('(R) K-1 Alt+Right moves the focused tile one place, announces its position and keeps focus on it', async () => {
        flat()
        const before = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            const event = await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(event.defaultPrevented).toBe(true)
            expect(shape()).toEqual(['A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'])
            expect(DBState.db.characterOrder).not.toBe(before)
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(liveText()).toBe(language.sidebarUi.movePosition(3, 8))
            expect(focusedLabel()).toBe('Char B')
            expect(isEditing(rig.target)).toBe(true)
            // The tile was in view: nothing scrolled.
            expect(rig.stub.writes).toEqual([])
        })
    })

    test('(R) K-1 Alt+Left mirrors it', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const event = await moveTile(rig.target, 'Char C', 'ArrowLeft')
            expect(event.defaultPrevented).toBe(true)
            expect(shape()).toEqual(['A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'])
            expect(liveText()).toBe(language.sidebarUi.movePosition(2, 8))
            expect(focusedLabel()).toBe('Char C')
        })
    })

    test('(R) K-1 a tile that crosses into the next row keeps focus after the rows are rebuilt', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await moveTile(rig.target, 'Char D', 'ArrowRight')
            expect(shape()).toEqual(['A', 'B', 'C', 'E', 'D', 'F', 'G', 'H'])
            expect(focusedLabel()).toBe('Char D')
            expect(document.activeElement?.isConnected).toBe(true)
            expect(liveText()).toBe(language.sidebarUi.movePosition(5, 8))
        })
    })

    test('(R) K-1 repeated presses walk the tile along, one place each', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await moveTile(rig.target, 'Char A', 'ArrowRight')
            await moveTile(rig.target, 'Char A', 'ArrowRight')
            expect(shape()).toEqual(['B', 'C', 'A', 'D', 'E', 'F', 'G', 'H'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(2)
            expect(liveText()).toBe(language.sidebarUi.movePosition(3, 8))
        })
    })

    test('(R) K-1 only the focused tile moves, not the selection', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'Char C')
            await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(shape()).toEqual(['A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'])
            // The selection is view state and stays as it was.
            expect(pressedOf(rig.target, 'Char A')).toBe('true')
            expect(pressedOf(rig.target, 'Char C')).toBe('true')
            expect(pressedOf(rig.target, 'Char B')).toBe('false')
        })
    })

    test('(R) K-1 a move to a row out of view scrolls it into view; one in view does not', async () => {
        tall()
        await withGrid({ view: 64, content: 384 }, async (rig) => {
            await moveTile(rig.target, 'Char N04', 'ArrowRight')
            expect(rig.stub.writes.length).toBeGreaterThan(0)
            expect(rig.stub.top()).toBe(64)
            expect(focusedLabel()).toBe('Char N04')
        })
    })

    test('(R) K-1 at the ends nothing is written and the rail words are announced', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            const first = await moveTile(rig.target, 'Char A', 'ArrowLeft')
            expect(first.defaultPrevented).toBe(true)
            expect(liveText()).toBe(language.sidebarUi.moveAtStart)
            const last = await moveTile(rig.target, 'Char H', 'ArrowRight')
            expect(last.defaultPrevented).toBe(true)
            expect(liveText()).toBe(language.sidebarUi.moveAtEnd)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            // The control: the same tile one step from the end does move.
            await moveTile(rig.target, 'Char G', 'ArrowRight')
            expect(shape()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'H', 'G'])
        })
    })
})

describe('Grid keyboard: folders and members', () => {
    test('(R) K-2 a member leaves its folder at the end of the section', async () => {
        world(['A', 'B', 'C', 'D'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await moveTile(rig.target, 'Char C', 'ArrowRight')
            expect(shape()).toEqual(['A', 'F1[B]', 'C', 'D'])
            expect(liveText()).toBe(language.sidebarUi.movePosition(3, 4))
            expect(focusedLabel()).toBe('Char C')
        })
    })

    test('(R) K-2 a member moves inside its open folder and the place is named with the folder', async () => {
        world(['A', 'B', 'C'], ['A', makeFolder('f1', 'F1', ['B', 'C'])])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(shape()).toEqual(['A', 'F1[C,B]'])
            expect(liveText()).toBe(language.sidebarUi.movePositionInFolder(2, 2, 'F1'))
            expect(focusedLabel()).toBe('Char B')
        })
    })

    test('(R) K-5 a selected folder whose member is moved out stays selected although its object is rewritten', async () => {
        world(['A', 'B', 'C', 'D'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await tap(rig.target, 'F1')
            expect(pressedOf(rig.target, 'F1')).toBe('true')
            await moveTile(rig.target, 'Char C', 'ArrowRight')
            expect(shape()).toEqual(['A', 'F1[B]', 'C', 'D'])
            expect(pressedOf(rig.target, 'F1')).toBe('true')
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(R through a control) K-5 a selected folder whose id is shared with another folder is not picked again', async () => {
        world(['A', 'B', 'C', 'D', 'E'], [makeFolder('f', 'First', ['B', 'C']), 'A', makeFolder('f', 'Second', ['D', 'E'])])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await tap(rig.target, 'First')
            expect(pressedOf(rig.target, 'First')).toBe('true')
            await moveTile(rig.target, 'Char C', 'ArrowRight')
            expect(shape()).toEqual(['First[B]', 'C', 'A', 'Second[D,E]'])
            // The folder now at that key could be a look-alike the user never picked.
            expect(pressedOf(rig.target, 'First')).not.toBe('true')
            expect(pressedOf(rig.target, 'Second')).not.toBe('true')
        })
    })

    test('(R) K-2 a folder tile passes an open folder as a unit', async () => {
        world(['A', 'B', 'C', 'D'], [makeFolder('f1', 'F1', ['A']), makeFolder('f2', 'F2', ['B', 'C']), 'D'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await moveTile(rig.target, 'F1', 'ArrowRight')
            expect(shape()).toEqual(['F2[B,C]', 'F1[A]', 'D'])
            expect(liveText()).toBe(language.sidebarUi.movePosition(2, 3))
            expect(focusedLabel()).toBe('F1')
        })
    })

    test('(R) K-2 a sole member is refused with the folder named, and nothing is written', async () => {
        world(['A', 'B'], [makeFolder('f1', 'F1', ['B']), 'A'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            const before = DBState.db.characterOrder
            const event = await moveTile(rig.target, 'Char B', 'ArrowLeft')
            expect(event.defaultPrevented).toBe(true)
            expect(liveText()).toBe(language.sidebarUi.moveWouldRemoveFolder('F1'))
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(focusedLabel()).toBe('Char B')
        })
    })

    test('(R) K-2 an unnamed folder is named with the default folder name in a refusal', async () => {
        world(['A', 'B'], [makeFolder('f1', '', ['B']), 'A'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            const before = DBState.db.characterOrder
            await moveTile(rig.target, 'Char B', 'ArrowLeft')
            expect(language.sidebarUi.defaultFolderName).not.toBe('')
            expect(liveText()).toBe(language.sidebarUi.moveWouldRemoveFolder(language.sidebarUi.defaultFolderName))
            expect(DBState.db.characterOrder).toBe(before)
        })
    })

    test('(R) K-2 an unnamed folder is named with the default folder name in a position announcement', async () => {
        world(['A', 'B', 'C'], ['A', makeFolder('f1', '', ['B', 'C'])])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(shape()).toEqual(['A', '[C,B]'])
            expect(liveText()).toBe(language.sidebarUi.movePositionInFolder(2, 2, language.sidebarUi.defaultFolderName))
        })
    })

    test('(R) K-2 the last visible member is refused although a hidden id keeps the folder in the saved order', async () => {
        world(['A', 'B'], ['A', makeFolder('f1', 'F1', ['B', 'ghost'])])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            const before = DBState.db.characterOrder
            await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(liveText()).toBe(language.sidebarUi.moveWouldRemoveFolder('F1'))
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(R) K-2 passing an identical duplicate moves focus only and writes nothing', async () => {
        install([makeCharacter('A', 'First A'), makeCharacter('A', 'Second A'), makeCharacter('B', 'Char B')], ['A', 'A', 'B'])
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            const event = await moveTile(rig.target, 'First A', 'ArrowRight')
            expect(event.defaultPrevented).toBe(true)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(focusedLabel()).toBe('Second A')
            expect(liveText()).toBe(language.sidebarUi.movePosition(2, 3))
        })
    })
})

describe('Grid keyboard: what is left alone', () => {
    const others: Array<[string, string, KeyboardEventInit]> = [
        ['a plain ArrowRight', 'ArrowRight', { altKey: false }],
        ['a plain ArrowLeft', 'ArrowLeft', { altKey: false }],
        ['Alt+Shift+ArrowRight', 'ArrowRight', { shiftKey: true }],
        ['Alt+Ctrl+ArrowRight', 'ArrowRight', { ctrlKey: true }],
        ['Alt+Meta+ArrowLeft', 'ArrowLeft', { metaKey: true }],
        ['Alt+ArrowDown', 'ArrowDown', {}],
        ['Alt+ArrowUp', 'ArrowUp', {}],
        ['Alt+Enter', 'Enter', {}],
    ]

    test.each(others)('(F) K-3 %s does nothing and keeps the key for the page', async (_name, key, init) => {
        flat()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            const tile = tileButton(rig.target, 'Char B')
            tile.focus()
            const event = altArrow(tile, key, init)
            await settle()
            expect(event.defaultPrevented).toBe(false)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(liveText()).toBe('')
        })
    })

    test('(F) K-3 outside edit mode the key is the page\'s', async () => {
        flat()
        await withGrid({ edit: false }, async (rig) => {
            const before = DBState.db.characterOrder
            const event = await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(event.defaultPrevented).toBe(false)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(R through a control) K-3 under a search the key is the page\'s', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await search(rig.target, 'Char')
            const before = DBState.db.characterOrder
            const event = await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(event.defaultPrevented).toBe(false)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            // The control: without the query the same press moves the tile.
            await search(rig.target, '')
            await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(shape()).toEqual(['A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'])
        })
    })

    test('(F) K-3 a key during text composition is the input method\'s', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            const event = await moveTile(rig.target, 'Char B', 'ArrowRight', { isComposing: true })
            expect(event.defaultPrevented).toBe(false)
            expect(DBState.db.characterOrder).toBe(before)
        })
    })

    test('(R) K-3 a key recorded as blocked (a dialog covers the page) writes nothing but is still kept from the browser', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            const tile = tileButton(rig.target, 'Char B')
            tile.focus()
            const event = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true })
            recordKeyEventBlocked(event, true)
            tile.dispatchEvent(event)
            await settle()
            expect(event.defaultPrevented).toBe(true)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(R) K-3 a tile with no order entry is handled and does nothing', async () => {
        world(['A', 'B', 'X'], ['A', 'B'])
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            const left = await moveTile(rig.target, 'Char X', 'ArrowLeft')
            const right = await moveTile(rig.target, 'Char X', 'ArrowRight')
            expect(left.defaultPrevented).toBe(true)
            expect(right.defaultPrevented).toBe(true)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(liveText()).toBe('')
        })
    })

    test('(R through a control) K-3 a handled press stops at the Grid, an unhandled one reaches the page', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const seen: string[] = []
            const onKey = (event: KeyboardEvent) => { seen.push(`${event.altKey ? 'Alt+' : ''}${event.key}`) }
            window.addEventListener('keydown', onKey)
            try {
                const tile = tileButton(rig.target, 'Char B')
                tile.focus()
                altArrow(tile, 'ArrowRight', { altKey: false })
                altArrow(tile, 'ArrowRight')
                altArrow(rig.scroller, 'ArrowRight')
                await settle()
                expect(seen).toEqual(['ArrowRight', 'Alt+ArrowRight'])
            } finally {
                window.removeEventListener('keydown', onKey)
            }
        })
    })

    test('(F) K-3 a key whose target is not a tile is left alone', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const event = altArrow(rig.scroller, 'ArrowRight')
            await settle()
            expect(event.defaultPrevented).toBe(false)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })
})

describe('Grid keyboard: held back', () => {
    test('(R through a control) K-4 a repeating key moves once', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const first = await moveTile(rig.target, 'Char B', 'ArrowRight')
            const repeat = await moveTile(rig.target, 'Char B', 'ArrowRight', { repeat: true })
            expect(first.defaultPrevented).toBe(true)
            expect(repeat.defaultPrevented).toBe(true)
            expect(shape()).toEqual(['A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R through a control) K-4 while a pointer gesture is down the key is kept from the browser but moves nothing', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            firePointer('pointerdown', rig.scroller, centre(0, 1), 'touch')
            await settle()
            const event = await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(event.defaultPrevented).toBe(true)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            firePointer('pointerup', window, centre(0, 1), 'touch')
            await settle()
            await moveTile(rig.target, 'Char B', 'ArrowRight')
            expect(shape()).toEqual(['A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'])
        })
    })

    test('(R through a control) K-4 while a drop waits for its confirmation the key moves nothing', async () => {
        threeUp()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
            const before = DBState.db.characterOrder
            const event = await moveTile(rig.target, 'Char A', 'ArrowRight')
            expect(event.defaultPrevented).toBe(true)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            await answerConfirm(false)
            // The prompt is over: the same key now moves the tile.
            await moveTile(rig.target, 'Char A', 'ArrowRight')
            expect(shape()).toEqual(['F1[B,C]', 'A', 'F2[D,E]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })
})
