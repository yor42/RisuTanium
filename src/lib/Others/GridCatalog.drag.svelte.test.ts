// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Grid tab: dragging tiles in edit mode. A touch hold of 500 ms lifts a tile
 * (a mouse drag starts after 5 px), the finger or mouse moves, and the release writes the saved order
 * once: a gap move, an append onto a folder tile, or a 400 ms dwell merge into a new folder. A dragged
 * folder that the drop would remove asks first (`alertConfirm`). The only write stays the assignment
 * of `characterOrder` followed by `checkCharOrder`, here a spy.
 *
 * Labels follow the plan: R = the intended behaviour, which fails by assertion on the code without
 * the drag (nothing is dropped there); F = a guard that may pass before and after, its negative half
 * evidenced by the named mutant; R through a control = a nothing-written test whose positive control
 * in the same test does write. The mutant ids (U1 to U46) are the in-memory mutation run recorded in
 * the stage report.
 *
 * Geometry: four columns (a 312 px container), 56 px tiles, 8 px gaps and 64 px rows (happy-dom
 * measures nothing, so every row has the fallback height). The scroller reports a fixed client rect.
 * Pointer events are synthetic and the hold runs on fake timers; the real hit test is covered by the
 * `gridDrop` unit tests and the device pass, and mocked pointer success does not prove the native
 * Android path (hold, capture, contextmenu, touchmove cancelability).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, folder } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import type { toSaveType } from '../../ts/storage/risuSave'

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

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { registerDbChangeEffects } from '../../ts/storage/dbChangeEffects.svelte'
import { OPEN_FOLDERS_KEY } from '../SideBars/railMemory'
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
const countText = (root: ParentNode): string => root.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? ''
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
const ghosts = (): number => document.querySelectorAll('[data-grid-ghost]').length
const dropBars = (root: ParentNode): number => root.querySelectorAll('[data-grid-drop-bar]').length
const dropRings = (root: ParentNode): number => root.querySelectorAll('[data-grid-drop-ring]').length

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

function pressKey(target: EventTarget, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
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
/** A point in the left (`before`) or right (`after`) half of that tile, near its top, outside the merge zone. */
const edge = (row: number, col: number, side: 'before' | 'after', count = 4): Pt =>
    ({ x: inset(count) + col * 64 + (side === 'before' ? 8 : 48), y: row * 64 + 4 })

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

/** Runs the band frames the machine asked for, one per 16 ms step. */
async function runFrames(frames: Array<(time: number) => void>, count: number): Promise<void> {
    for (let i = 1; i <= count; i++) {
        for (const run of frames.splice(0)) {
            run(i * 16)
        }
        await settle()
    }
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

/** The confirmation prompts put up, and the resolvers of the ones still open. */
let confirmOpen: Array<(value: boolean) => void> = []
let menuOpen: Array<(value: string) => void> = []

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
    menuOpen = []
    alertConfirmSpy.mockReset()
    alertConfirmSpy.mockImplementation(() => new Promise<boolean>((resolve) => {
        confirmOpen.push(resolve)
    }))
    alertSelectSpy.mockReset()
    alertSelectSpy.mockImplementation(() => new Promise<string>((resolve) => {
        menuOpen.push(resolve)
    }))
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

const NEW_FOLDER = language.sidebarUi.defaultFolderName

//#endregion

describe('Grid drag: a gap move', () => {
    test('(R) B-1 a touch hold on an unselected tile, a move to another gap and a release move only that tile, once', async () => {
        flat()
        const before = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before') })
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
            expect(DBState.db.characterOrder).not.toBe(before)
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(picked(rig.target)).toBe(0)
            expect(isEditing(rig.target)).toBe(true)
            expect(alertConfirmSpy).not.toHaveBeenCalled()
            // The release opened no tile menu.
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
    })

    test('(R) B-2 a hold on a selected tile moves the whole selection, in current order', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char C')
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'Char F')
            await gesture(rig, { from: centre(1, 1), to: edge(1, 3, 'after') })
            expect(shape()).toEqual(['B', 'D', 'E', 'G', 'H', 'A', 'C', 'F'])
            // A move keeps the selection (Q7).
            expect(picked(rig.target)).toBe(3)
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(3))
            expect(liveText()).toBe(language.othersUi.editMoved(3))
        })
    })

    test('(R) B-2 a selection holding a folder tile and a member of it moves the folder once', async () => {
        world(['A', 'B', 'C', 'D', 'E', 'F'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D', 'E', 'F'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await tap(rig.target, 'F1')
            await tap(rig.target, 'Char B')
            // Rows: [A], [F1 B C], [D E F].
            await gesture(rig, { from: centre(1, 0, 3), to: edge(2, 2, 'after', 3) })
            expect(shape()).toEqual(['A', 'D', 'E', 'F', 'F1[B,C]'])
            // A folder moved whole asks nothing, and counts once however many members ride with it.
            expect(alertConfirmSpy).not.toHaveBeenCalled()
            expect(liveText()).toBe(language.othersUi.editMoved(1))
        })
    })

    test('(R) B-5 a mouse press and a 5 px move in edit mode drag and drop; outside edit mode nothing is written', async () => {
        flat()
        const untouched = DBState.db.characterOrder
        await withGrid({ edit: false }, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), type: 'mouse' })
            expect(DBState.db.characterOrder).toBe(untouched)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(isEditing(rig.target)).toBe(false)
            editButton(rig.target)!.click()
            await settle()
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), type: 'mouse' })
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })
})

describe('Grid drag: onto a folder tile and the dwell merge', () => {
    test('(R) B-3 a drop on a closed folder tile appends at the end of the folder, hidden trailing member included', async () => {
        // "Z" is a member id with no character: no tile, but part of the folder's data.
        world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C', 'Z']), 'D', 'E'])
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 2), to: centre(0, 1) })
            expect(shape()).toEqual(['A', 'F1[B,C,Z,D]', 'E'])
            expect(alertConfirmSpy).not.toHaveBeenCalled()
        })
    })

    test('(R) B-3 a drop on an open folder tile appends at the end and the folder stays open', async () => {
        world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C', 'Z']), 'D', 'E'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            // Rows: [A], [F1 B C], [D E].
            await gesture(rig, { from: centre(2, 1, 2), to: centre(1, 0, 3) })
            expect(shape()).toEqual(['A', 'F1[B,C,Z,E]', 'D'])
            expect(folderTile(rig.target, 'F1')!.getAttribute('aria-expanded')).toBe('true')
        })
    })

    test('(R) B-4 a 400 ms dwell on a character makes one new folder at its slot with it and every dragged tile', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 0), to: centre(1, 0), dwell: 400 })
            expect(shape()).toEqual(['B', 'C', 'D', `${NEW_FOLDER}[A,E]`, 'F', 'G', 'H'])
            expect(alertConfirmSpy).not.toHaveBeenCalled()
            // The new folder starts closed.
            expect(folderTile(rig.target, NEW_FOLDER)!.getAttribute('aria-expanded')).toBe('false')
        })
    })

    test('(R) B-4 released at 399 ms the same drag is a gap move, not a merge', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 0), to: centre(1, 0), dwell: 399 })
            expect(shape()).toEqual(['B', 'C', 'D', 'E', 'A', 'F', 'G', 'H'])
        })
    })

    test('(R) B-28 a loose character and a member of T dropped on T append both; only T\'s own members get no target on T', async () => {
        world(['A', 'B', 'C', 'D'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await tap(rig.target, 'Char B')
            await tap(rig.target, 'Char D')
            // Rows: [A], [F1 B C], [D].
            await gesture(rig, { from: centre(2, 0, 1), to: centre(1, 0, 3) })
            expect(shape()).toEqual(['A', 'F1[C,B,D]'])
        })
        world(['A', 'B', 'C', 'D'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D'])
        checkCharOrderSpy.mockClear()
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await tap(rig.target, 'Char B')
            await tap(rig.target, 'Char C')
            await gesture(rig, { from: centre(1, 1, 3), to: centre(1, 0, 3), release: false })
            expect(dropRings(rig.target)).toBe(0)
            firePointer('pointerup', window, centre(1, 0, 3))
            await settle()
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(shape()).toEqual(['A', 'F1[B,C]', 'D'])
        })
    })
})

describe('Grid drag: the dragged tiles', () => {
    test('(R) B-29 a picked folder that a drop edits stays selected; a dissolved dragged folder leaves the selection', async () => {
        world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E'])])
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'F1')
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(1))
            // Row: [A F1 F2]. Char A, unselected, is dropped on the picked folder.
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            expect(shape()).toEqual(['F1[B,C,A]', 'F2[D,E]'])
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(1))
            expect(pressedOf(rig.target, 'F1')).toBe('true')
        })
        // The picked folder F2 is dragged onto F1: it is dissolved and leaves the selection.
        world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E'])])
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'F2')
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(1))
            await gesture(rig, { from: centre(0, 2, 3), to: centre(0, 1, 3) })
            await answerConfirm(true)
            expect(shape()).toEqual(['A', 'F1[B,C,D,E]'])
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(0))
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(R through a control) B-29b a twin folder with the same id is never adopted into the selection', async () => {
        // Two folders share the id "dup". Beta is picked and moved before Alpha: Beta's old key now names Alpha.
        world(['cx', 'cm', 'cy'], [makeFolder('dup', 'Alpha', ['cx']), 'cm', makeFolder('dup', 'Beta', ['cy'])])
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Beta')
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(1))
            // Row: [Alpha, Char cm, Beta].
            await gesture(rig, { from: centre(0, 2, 3), to: edge(0, 0, 'before', 3) })
            expect(shape()).toEqual(['Beta[cy]', 'Alpha[cx]', 'cm'])
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(0))
            expect(pressedOf(rig.target, 'Alpha')).toBe('false')
            expect(pressedOf(rig.target, 'Beta')).toBe('false')
            expect(picked(rig.target)).toBe(0)
        })
        // Alpha is picked and its only member dragged out: Alpha is removed and Beta takes its occurrence.
        world(['ca', 'cb', 'cm'], [makeFolder('dup', 'Alpha', ['ca']), makeFolder('dup', 'Beta', ['cb']), 'cm'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await tap(rig.target, 'Alpha')
            // Rows: [Alpha, Char ca], [Beta, Char cb], [Char cm]; the end of the list is below the content.
            await gesture(rig, { from: centre(0, 1, 2), to: { x: 156, y: 400 } })
            expect(shape()).toEqual(['Beta[cb]', 'cm', 'ca'])
            expect(countText(rig.target)).toBe(language.othersUi.editSelectedCount(0))
            expect(pressedOf(rig.target, 'Beta')).toBe('false')
        })
        // Control (the B-29 rule): with a unique id the pick is kept.
        world(['ca', 'cb', 'cm'], [makeFolder('one', 'Alpha', ['ca']), makeFolder('two', 'Beta', ['cb']), 'cm'])
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Alpha')
            await gesture(rig, { from: centre(0, 2, 3), to: edge(0, 0, 'before', 3) })
            expect(shape()).toEqual(['cm', 'Alpha[ca]', 'Beta[cb]'])
            expect(pressedOf(rig.target, 'Alpha')).toBe('true')
        })
    })

    test('(R) B-7 a dragged tile other than the pressed one vanishing leaves the moved set; the rest still drops', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'Char C')
            await gesture(rig, { from: centre(0, 0), to: edge(1, 2, 'before'), release: false })
            const order = DBState.db.characterOrder as unknown as string[]
            order.splice(2, 1)
            DBState.db.characters.splice(2, 1)
            await settle()
            firePointer('pointerup', window, edge(1, 2, 'before'))
            await settle()
            // C's removal re-chunks the rows ([A B D E] [F G H]); the pointer stays where it was and now
            // lies over the right half of G, so the write is evaluated against the rows as they are now.
            expect(shape()).toEqual(['B', 'D', 'E', 'F', 'G', 'A', 'H'])
        })
    })

    test('(F) B-7 a real tile drag whose pressed tile is removed mid-drag ends with no write, and the later release does nothing (U8)', async () => {
        flat()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), release: false })
            const order = DBState.db.characterOrder as unknown as string[]
            order.splice(1, 1)
            DBState.db.characters.splice(1, 1)
            await settle()
            const after = JSON.stringify(shape())
            firePointer('pointerup', window, edge(1, 2, 'before'))
            await settle()
            expect(JSON.stringify(shape())).toBe(after)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) a dragged tile is never its own drop target: no ring on it, not even after the dwell (U11)', async () => {
        world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E'])])
        const before = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            // A character: moves 12 px inside its own centre zone and rests past the 400 ms dwell.
            await gesture(rig, { from: centre(0, 0, 3), to: { x: centre(0, 0, 3).x + 12, y: 28 }, dwell: 450, release: false })
            expect(dropRings(rig.target)).toBe(0)
            firePointer('pointerup', window, { x: centre(0, 0, 3).x + 12, y: 28 })
            await settle()
            // A folder tile: the same on its own centre zone.
            await gesture(rig, { from: centre(0, 1, 3), to: { x: centre(0, 1, 3).x + 12, y: 28 }, dwell: 450, release: false })
            expect(dropRings(rig.target)).toBe(0)
            firePointer('pointerup', window, { x: centre(0, 1, 3).x + 12, y: 28 })
            await settle()
            expect(DBState.db.characterOrder).toBe(before)
            expect(alertConfirmSpy).not.toHaveBeenCalled()
        })
    })

    test('(R through a control) B-8 a tile with no order entry cannot be lifted to a drop, and a selection holding one refuses the whole drag', async () => {
        // D is in the characters but not in the order: its tile has no order entry.
        world(['A', 'B', 'C', 'D'], ['A', 'B', 'C'])
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 3), to: edge(0, 0, 'before') })
            expect(shape()).toEqual(['A', 'B', 'C'])
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            // A selected with D: the pressed tile A is selected, but the moved set holds a tile with no entry.
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'Char D')
            await gesture(rig, { from: centre(0, 0), to: edge(0, 3, 'after') })
            expect(shape()).toEqual(['A', 'B', 'C'])
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            // Control: A alone moves.
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'Char D')
            await gesture(rig, { from: centre(0, 0), to: edge(0, 2, 'after') })
            expect(shape()).toEqual(['B', 'C', 'A'])
        })
    })
})

describe('Grid drag: edge scroll and key scroll', () => {
    /** The animation frames the machine asks for, held until the test runs them. */
    function holdFrames(): Array<(time: number) => void> {
        const frames: Array<(time: number) => void> = []
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
        return frames
    }

    test('(R) B-6 a touch drag that has travelled and is held in the bottom band scrolls the Grid; the drop uses the scrolled position', async () => {
        const ids = tall()
        const frames = holdFrames()
        await withGrid({ view: 128, content: 384 }, async (rig) => {
            // Row 1 spans 64..120 as a tile; 114 lies inside the bottom band of the 128 px view.
            const spot = { x: centre(0, 0).x, y: 114 }
            await gesture(rig, { from: centre(0, 0), to: spot, release: false })
            await runFrames(frames, 12)
            const top = rig.stub.top()
            expect(top).toBeGreaterThan(0)
            firePointer('pointerup', window, spot)
            await settle()
            // The pointer lies over the first tile of this row, at its centre: the gap after that tile.
            const row = Math.floor((spot.y + top) / 64)
            const expected = ids.slice(1)
            expected.splice(row * 4, 0, ids[0])
            expect(row).toBeGreaterThan(1)
            expect(shape()).toEqual(expected)
        })
    })

    test('(F) B-27 an edit-mode hold with no travel never scrolls, even held in the bottom band (U32)', async () => {
        tall()
        const frames = holdFrames()
        await withGrid({ view: 128, content: 384 }, async (rig) => {
            const spot = { x: centre(1, 0).x, y: 114 }
            await gesture(rig, { from: spot, to: spot, release: false })
            await runFrames(frames, 12)
            expect(rig.stub.top()).toBe(0)
            expect(rig.stub.writes).toEqual([])
            firePointer('pointerup', window, spot)
            await settle()
        })
    })

    test('(R) B-27 a mouse drag held in the bottom band scrolls', async () => {
        tall()
        const frames = holdFrames()
        await withGrid({ view: 128, content: 384 }, async (rig) => {
            const spot = { x: centre(0, 0).x, y: 114 }
            await gesture(rig, { from: centre(0, 0), to: spot, type: 'mouse', release: false })
            await runFrames(frames, 12)
            expect(rig.stub.top()).toBeGreaterThan(0)
            firePointer('pointerup', window, spot, 'mouse')
            await settle()
        })
    })

    test('(F) B-6 a drag that cannot drop (search active) never scrolls', async () => {
        tall()
        const frames = holdFrames()
        await withGrid({ view: 128, content: 384 }, async (rig) => {
            await search(rig.target, 'Char')
            const spot = { x: centre(0, 0).x, y: 114 }
            await gesture(rig, { from: centre(0, 0), to: spot, release: false })
            await runFrames(frames, 12)
            expect(rig.stub.top()).toBe(0)
            firePointer('pointerup', window, spot)
            await settle()
        })
    })

    test('(F) B-9a a hold released in place after a PageDown writes nothing and opens the tile menu as before', async () => {
        tall()
        holdFrames()
        const before = DBState.db.characterOrder
        await withGrid({ view: 128, content: 384 }, async (rig) => {
            const spot = centre(0, 0)
            await gesture(rig, { from: spot, to: spot, release: false })
            pressKey(document.body, 'PageDown')
            await settle()
            firePointer('pointerup', window, spot)
            await settle()
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(alertSelectSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R) B-9b a drag that has travelled, then PageDown and a release without further movement, drops at the key-scrolled target', async () => {
        const ids = tall()
        holdFrames()
        await withGrid({ view: 128, content: 384 }, async (rig) => {
            const spot = edge(0, 1, 'after')
            await gesture(rig, { from: centre(0, 0), to: spot, release: false })
            pressKey(document.body, 'PageDown')
            await settle()
            expect(rig.stub.top()).toBeCloseTo(115.2, 1)
            firePointer('pointerup', window, spot)
            await settle()
            // Content y 119 is row 1, over the right half of its second tile (N06): the gap after it.
            const expected = ids.slice(1)
            expected.splice(5, 0, ids[0])
            expect(shape()).toEqual(expected)
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
    })

    test('(R through a control) B-26 a release over the header above the Grid or below it writes nothing, and the band still scrolls there', async () => {
        tall()
        const frames = holdFrames()
        await withGrid({ view: 128, content: 384 }, async (rig) => {
            const before = DBState.db.characterOrder
            // Scrolled by 100: viewport y 56 is content y 156, the tile row 2.
            const press = { x: centre(0, 0).x, y: 56 }
            rig.scroller.scrollTop = 100
            const header = { x: centre(0, 2).x, y: -10 }
            await gesture(rig, { from: press, to: header, release: false })
            await runFrames(frames, 6)
            expect(rig.stub.top()).toBeLessThan(100)
            firePointer('pointerup', window, header)
            await settle()
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()

            // Below the scroller (the band frames are held, so the scroll position stays).
            rig.scroller.scrollTop = 100
            await gesture(rig, { from: press, to: { x: centre(0, 2).x, y: 128 + 20 } })
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()

            // Control: a release inside the scroller after the same scroll writes.
            rig.scroller.scrollTop = 100
            await gesture(rig, { from: press, to: { x: edge(0, 1, 'after').x, y: 28 } })
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(DBState.db.characterOrder).not.toBe(before)
        })
    })
})

describe('Grid drag: the confirmation before a dragged folder is removed', () => {
    /** A, F1 (B C), F2 (D E): the closed row is [A F1 F2]. */
    function threeUp(): void {
        world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E'])])
    }

    const openIds = (): string[] => (JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) ?? '[]') as string[]).sort()

    test('(R) B-16 a folder dropped on a member slot of an open folder asks once with the exact text; Yes writes and prunes the open state', async () => {
        world(['A', 'B', 'C', 'D', 'E', 'F'], ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E']), 'F'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            expect(openIds()).toEqual(['f1', 'f2'])
            const before = DBState.db.characterOrder
            // Rows: [A], [F1 B C], [F2 D E], [F]. F1 is dropped before E, a member slot of F2.
            await gesture(rig, { from: centre(1, 0, 3), to: edge(2, 2, 'before', 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
            expect(alertConfirmSpy.mock.calls[0][0]).toBe(language.othersUi.editFolderRemoveConfirm(['F1']))
            expect(alertConfirmSpy.mock.calls[0][0]).toBe('Remove the folder "F1" and move its characters here? Its name, colour and picture are not kept.')
            // Nothing is written while the prompt is open.
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            await answerConfirm(true)
            expect(shape()).toEqual(['A', 'F2[D,B,C,E]', 'F'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(openIds()).toEqual(['f2'])
            expect(liveText()).toBe(language.othersUi.editMoved(1))
        })
    })

    test('(R) B-16 No and a dismissed prompt write nothing', async () => {
        threeUp()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            await answerConfirm(false)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(liveText()).toBe('')
            expect(isEditing(rig.target)).toBe(true)
            // A No leaves drops working: the same drop asks again and Yes writes.
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(2)
            await answerConfirm(true)
            expect(shape()).toEqual(['F1[B,C,A,D,E]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R) B-17 a folder dragged with a loose character onto a closed folder tile asks, then appends both at its end', async () => {
        threeUp()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
            expect(alertConfirmSpy.mock.calls[0][0]).toBe(language.othersUi.editFolderRemoveConfirm(['F2']))
            await answerConfirm(true)
            expect(shape()).toEqual(['F1[B,C,A,D,E]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R) B-17 the same onto an open folder tile: the target keeps its open state', async () => {
        threeUp()
        await withGrid({}, async (rig) => {
            chevrons(rig.target)[0].click()
            await settle()
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            // Rows: [A], [F1 B C], [F2].
            await gesture(rig, { from: centre(0, 0, 1), to: centre(1, 0, 3) })
            await answerConfirm(true)
            expect(shape()).toEqual(['F1[B,C,A,D,E]'])
            expect(folderTile(rig.target, 'F1')!.getAttribute('aria-expanded')).toBe('true')
        })
    })

    test('(R) B-18 a dwell merge with a dragged folder asks, then makes one closed folder at the target character\'s slot', async () => {
        world(['A', 'B', 'C', 'D', 'E'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D', 'E'])
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F1')
            await gesture(rig, { from: centre(0, 1), to: centre(0, 2), dwell: 400 })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
            expect(alertConfirmSpy.mock.calls[0][0]).toBe(language.othersUi.editFolderRemoveConfirm(['F1']))
            await answerConfirm(true)
            expect(shape()).toEqual([`${NEW_FOLDER}[A,B,C,D]`, 'E'])
            expect(folderTile(rig.target, NEW_FOLDER)!.getAttribute('aria-expanded')).toBe('false')
            // A merge clears the selection (Q7); edit mode stays.
            expect(picked(rig.target)).toBe(0)
            expect(isEditing(rig.target)).toBe(true)
        })
    })

    test('(R) B-19 no prompt without a dragged folder: a member dropped on a slot of another open folder', async () => {
        world(['A', 'B', 'C', 'D', 'E'], [makeFolder('f1', 'F1', ['A', 'B']), 'C', makeFolder('f2', 'F2', ['D', 'E'])])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            // Rows: [F1 A B], [C], [F2 D E]. Member A is dropped before E.
            await gesture(rig, { from: centre(0, 1, 3), to: edge(2, 2, 'before', 3) })
            expect(alertConfirmSpy).not.toHaveBeenCalled()
            expect(shape()).toEqual(['F1[B]', 'C', 'F2[D,A,E]'])
        })
    })

    test('(R through a control) B-20 the order changes while the prompt is open: a target or folder that is gone writes nothing; a vanished loose character only leaves the set', async () => {
        const dropWithPrompt = async (rig: Rig): Promise<void> => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await gesture(rig, { from: centre(0, 2, 3), to: centre(0, 1, 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
        }

        // The target folder is gone.
        threeUp()
        await withGrid({}, async (rig) => {
            await dropWithPrompt(rig)
            ;(DBState.db.characterOrder as unknown as Array<string | folder>).splice(1, 1)
            await settle()
            const after = JSON.stringify(shape())
            await answerConfirm(true)
            expect(JSON.stringify(shape())).toBe(after)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })

        // The dragged folder was replaced by another object.
        threeUp()
        alertConfirmSpy.mockClear()
        await withGrid({}, async (rig) => {
            await dropWithPrompt(rig)
            const order = DBState.db.characterOrder as unknown as Array<string | folder>
            order[2] = { ...(order[2] as folder) }
            await settle()
            await answerConfirm(true)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })

        // A loose dragged character (not the pressed tile) vanishes: the rest still drops.
        threeUp()
        alertConfirmSpy.mockClear()
        await withGrid({}, async (rig) => {
            await dropWithPrompt(rig)
            ;(DBState.db.characterOrder as unknown as Array<string | folder>).splice(0, 1)
            DBState.db.characters.splice(0, 1)
            await settle()
            await answerConfirm(true)
            expect(shape()).toEqual(['F1[B,C,D,E]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R through a control) B-20 the member next to the drop slot moves into another open folder while the prompt is open: Yes writes nothing', async () => {
        const fourOpen = (): void => world(['A', 'B', 'C', 'D', 'E', 'G'],
            ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E']), makeFolder('f3', 'F3', ['G'])])
        // Rows: [A], [F1 B C], [F2 D E], [F3 G]. F2 is dropped before member C of F1.
        const dropWithPrompt = async (rig: Rig): Promise<void> => {
            await openAllFolders(rig.target)
            await gesture(rig, { from: centre(2, 0, 3), to: edge(1, 2, 'before', 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
        }

        // Control: the same drop with no change during the prompt writes.
        fourOpen()
        await withGrid({}, async (rig) => {
            await dropWithPrompt(rig)
            await answerConfirm(true)
            expect(shape()).toEqual(['A', 'F1[B,D,E,C]', 'F3[G]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })

        fourOpen()
        alertConfirmSpy.mockClear()
        checkCharOrderSpy.mockClear()
        await withGrid({}, async (rig) => {
            await dropWithPrompt(rig)
            const order = DBState.db.characterOrder as unknown as Array<string | folder>
            ;(order[1] as folder).data.splice(1, 1)
            ;(order[3] as folder).data.push('C')
            await settle()
            const after = JSON.stringify(shape())
            await answerConfirm(true)
            expect(JSON.stringify(shape())).toBe(after)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(R through a control) B-20 a named dissolved folder other than the pressed one is replaced while the prompt is open: Yes writes nothing', async () => {
        const fourClosed = (): void => world(['A', 'B', 'C', 'D', 'E', 'G', 'H'],
            ['A', makeFolder('f1', 'F1', ['B', 'C']), makeFolder('f2', 'F2', ['D', 'E']), makeFolder('f3', 'F3', ['G', 'H'])])
        // A, F2 and F3 are appended to F1; the prompt names F2 and F3, and F3 is not the pressed tile.
        const dropWithPrompt = async (rig: Rig): Promise<void> => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await tap(rig.target, 'F3')
            await gesture(rig, { from: centre(0, 0), to: centre(0, 1) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
            expect(alertConfirmSpy.mock.calls[0][0]).toBe(language.othersUi.editFolderRemoveConfirm(['F2', 'F3']))
        }

        // Control: the same drop with no change during the prompt writes.
        fourClosed()
        await withGrid({}, async (rig) => {
            await dropWithPrompt(rig)
            await answerConfirm(true)
            expect(shape()).toEqual(['F1[B,C,A,D,E,G,H]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })

        fourClosed()
        alertConfirmSpy.mockClear()
        checkCharOrderSpy.mockClear()
        await withGrid({}, async (rig) => {
            await dropWithPrompt(rig)
            const order = DBState.db.characterOrder as unknown as Array<string | folder>
            order[3] = { ...(order[3] as folder) }
            await settle()
            const after = JSON.stringify(shape())
            await answerConfirm(true)
            expect(JSON.stringify(shape())).toBe(after)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    const exits: Array<[string, (rig: Rig) => Promise<void>]> = [
        ['Done', async (rig) => {
            clickButton(rig.target, language.othersUi.editDone)
            await settle()
        }],
        ['Escape', async () => {
            pressKey(document.body, 'Escape')
            await settle()
        }],
        ['a tab switch', async (rig) => {
            clickButton(rig.target, language.list)
            await settle()
            clickButton(rig.target, language.grid)
            await settle()
        }],
        ['leaving and re-entering edit mode (and picking the same tiles again)', async (rig) => {
            clickButton(rig.target, language.othersUi.editDone)
            await settle()
            editButton(rig.target)!.click()
            await settle()
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
        }],
        ['unmounting the screen', async (rig) => {
            await rig.unmountNow()
        }],
    ]

    test.each(exits)('(R through a control) B-21 %s while the prompt is open: Yes writes nothing', async (_name, leave) => {
        threeUp()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
            await leave(rig)
            await answerConfirm(true)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(R through a control) B-21 a second drop while the prompt is open is ignored, and Yes writes once', async () => {
        threeUp()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            // A new gesture while the answer is pending: its release is refused, so no second prompt and no write.
            await gesture(rig, { from: centre(0, 0, 3), to: edge(0, 2, 'after', 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
            expect(DBState.db.characterOrder).toBe(before)
            await answerConfirm(true)
            expect(shape()).toEqual(['F1[B,C,A,D,E]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R) B-30 a prompt that rejects logs the error, clears the in-flight guard, writes nothing, and the next drop works', async () => {
        threeUp()
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        alertConfirmSpy.mockImplementationOnce(() => Promise.reject(new Error('prompt failed')))
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'F2')
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            await settle()
            expect(logged).toHaveBeenCalled()
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            // The guard is clear: the same drop asks again and writes on Yes.
            await gesture(rig, { from: centre(0, 0, 3), to: centre(0, 1, 3) })
            expect(alertConfirmSpy).toHaveBeenCalledTimes(2)
            await answerConfirm(true)
            expect(shape()).toEqual(['F1[B,C,A,D,E]'])
        })
    })

    test('(R) B-24 a confirmed append keeps the selection of a character that still has a tile and drops one that does not', async () => {
        world(['A', 'B', 'C', 'D'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D'])
        await withGrid({}, async (rig) => {
            await openAllFolders(rig.target)
            await tap(rig.target, 'Char D')
            // Rows: [A], [F1 B C], [D]. D joins the open folder and keeps its tile.
            await gesture(rig, { from: centre(2, 0, 1), to: centre(1, 0, 3) })
            expect(shape()).toEqual(['A', 'F1[B,C,D]'])
            expect(pressedOf(rig.target, 'Char D')).toBe('true')
            expect(isEditing(rig.target)).toBe(true)
        })
        world(['A', 'B', 'C', 'D'], ['A', makeFolder('f1', 'F1', ['B', 'C']), 'D'])
        localStorage.clear()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char D')
            // The folder is closed: D has no tile afterwards, so its pick leaves with it.
            await gesture(rig, { from: centre(0, 2, 3), to: centre(0, 1, 3) })
            expect(shape()).toEqual(['A', 'F1[B,C,D]'])
            expect(picked(rig.target)).toBe(0)
            expect(isEditing(rig.target)).toBe(true)
        })
    })

    test('(R through a control) B-25 a pressed folder whose key names another folder after an in-place removal writes nothing', async () => {
        const scene = (): void => world(['cA', 'cB', 'cC', 'cD'], [
            makeFolder('dup', 'First', ['cA']),
            makeFolder('dup', 'Second', ['cB']),
            makeFolder('dup', 'Third', ['cC']),
            'cD',
        ])
        // Control: nothing removed, the second folder moves to the end.
        scene()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(0, 3, 'after') })
            expect(shape()).toEqual(['First[cA]', 'Third[cC]', 'cD', 'Second[cB]'])
        })
        scene()
        checkCharOrderSpy.mockClear()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(0, 3, 'after'), release: false })
            ;(DBState.db.characterOrder as unknown as Array<string | folder>).splice(0, 1)
            await settle()
            const after = JSON.stringify(shape())
            firePointer('pointerup', window, edge(0, 3, 'after'))
            await settle()
            expect(JSON.stringify(shape())).toBe(after)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })
})

describe('Grid drag: gating, the hold menu, announcements and the no-op oracle', () => {
    test('(F) B-10 under an active search there is no drag target; selection and the hold menu still work', async () => {
        flat()
        const before = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            await search(rig.target, 'Char')
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before') })
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            await tap(rig.target, 'Char A')
            expect(picked(rig.target)).toBe(1)
            await gesture(rig, { from: centre(0, 2), to: centre(0, 2) })
            expect(alertSelectSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R) B-22 a hold released in place with a scattered selection opens the menu and writes nothing; 9 px has no target, 10 px writes', async () => {
        flat()
        const before = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'Char C')
            const press = centre(0, 0)
            await gesture(rig, { from: press, to: press })
            expect(alertSelectSpy).toHaveBeenCalledTimes(1)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            menuOpen.shift()!('2')
            await settle()

            await gesture(rig, { from: press, to: { x: press.x, y: press.y + 9 } })
            expect(alertSelectSpy).toHaveBeenCalledTimes(2)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            menuOpen.shift()!('2')
            await settle()

            // 10 px to the right of A's centre is the gap after A: the selection gathers there.
            await gesture(rig, { from: press, to: { x: press.x + 10, y: press.y } })
            expect(alertSelectSpy).toHaveBeenCalledTimes(2)
            expect(shape()).toEqual(['A', 'C', 'B', 'D', 'E', 'F', 'G', 'H'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) B-23 the long press that enters edit mode does not continue into a drag: no target, no ghost, no write', async () => {
        flat()
        const before = DBState.db.characterOrder
        await withGrid({ edit: false }, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), release: false })
            expect(isEditing(rig.target)).toBe(true)
            expect(ghosts()).toBe(0)
            expect(dropBars(rig.target)).toBe(0)
            firePointer('pointerup', window, edge(1, 2, 'before'))
            await settle()
            expect(isEditing(rig.target)).toBe(true)
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) B-23 a search that lands mid-drag leaves nothing to write', async () => {
        flat()
        const before = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), release: false })
            await search(rig.target, 'Char')
            firePointer('pointerup', window, edge(1, 2, 'before'))
            await settle()
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(R) B-11 the live region announces the moved count once per write, again for identical text, and nothing for a cancel, a noop or a write that did not happen', async () => {
        flat()
        await withGrid({}, async (rig) => {
            expect(liveText()).toBe('')
            // A cancelled drag.
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), release: false })
            pressKey(document.body, 'Escape')
            await settle()
            expect(liveText()).toBe('')
            // A noop drop (B's own place).
            await gesture(rig, { from: centre(0, 1), to: edge(0, 2, 'before') })
            expect(liveText()).toBe('')
            // A drop whose write finds nothing to change: the order is edited in place before the release, so
            // A already stands after B when the write is built.
            await gesture(rig, { from: centre(0, 0), to: edge(0, 1, 'after'), release: false })
            ;(DBState.db.characterOrder as unknown as string[]).splice(0, 2, 'B', 'A')
            firePointer('pointerup', window, edge(0, 1, 'after'))
            await settle()
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(liveText()).toBe('')

            // A real drop.
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before') })
            expect(liveText()).toBe(language.othersUi.editMoved(1))
            // The same text again is cleared first, then set.
            await gesture(rig, { from: centre(1, 1), to: edge(0, 0, 'before'), release: false })
            firePointer('pointerup', window, edge(0, 0, 'before'))
            flushSync()
            expect(liveText()).toBe('')
            await settle()
            expect(liveText()).toBe(language.othersUi.editMoved(1))
        })
    })

    test('(R) B-31 a no-op slot becomes a real move after the order is edited in place; the release there writes', async () => {
        // Z is in the characters but not in the order, so its tile is the tail.
        world(['A', 'B', 'C', 'D', 'E', 'Z'], ['A', 'B', 'C', 'D', 'E'])
        await withGrid({}, async (rig) => {
            // C right after B is C's own place: a no-op.
            await gesture(rig, { from: centre(0, 2), to: edge(0, 1, 'after'), release: false })
            // Z is listed between B and C in place; the anchor tile B and the slot key do not change.
            ;(DBState.db.characterOrder as unknown as string[]).splice(2, 0, 'Z')
            await settle()
            firePointer('pointerup', window, edge(0, 1, 'after'))
            await settle()
            expect(shape()).toEqual(['A', 'B', 'C', 'Z', 'D', 'E'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R through a control) B-12 outside the column writes nothing; the same drag released inside writes', async () => {
        flat()
        const before = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            for (const x of [COLUMNS_WIDTH + 33, -33]) {
                await gesture(rig, { from: centre(0, 1), to: { x, y: 100 } })
                expect(DBState.db.characterOrder).toBe(before)
            }
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            await gesture(rig, { from: centre(0, 1), to: { x: COLUMNS_WIDTH + 30, y: 100 } })
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R through a control) B-12 Escape, pointercancel, blur, a hidden page and the noop gap write nothing', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const before = DBState.db.characterOrder
            const start = centre(0, 1)
            const target = edge(1, 2, 'before')

            await gesture(rig, { from: start, to: target, release: false })
            pressKey(document.body, 'Escape')
            await settle()
            firePointer('pointerup', window, target)
            await settle()
            expect(DBState.db.characterOrder).toBe(before)

            await gesture(rig, { from: start, to: target, release: false })
            firePointer('pointercancel', window, target)
            await settle()
            expect(DBState.db.characterOrder).toBe(before)

            await gesture(rig, { from: start, to: target, release: false })
            window.dispatchEvent(new Event('blur'))
            await settle()
            firePointer('pointerup', window, target)
            await settle()
            expect(DBState.db.characterOrder).toBe(before)

            await gesture(rig, { from: start, to: target, release: false })
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
            document.dispatchEvent(new Event('visibilitychange'))
            await settle()
            Reflect.deleteProperty(document, 'visibilityState')
            firePointer('pointerup', window, target)
            await settle()
            expect(DBState.db.characterOrder).toBe(before)

            // The gap between B and C is B's own place.
            await gesture(rig, { from: start, to: edge(0, 2, 'before') })
            expect(DBState.db.characterOrder).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()

            // Control: the same travelled drag released over a real gap writes.
            await gesture(rig, { from: start, to: target })
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R through a control) B-15 a Grid drop marks the database changed through registerDbChangeEffects; a cancelled drag does not', async () => {
        flat()
        const markChanged = vi.fn()
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const stop = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        try {
            flushSync()
            await withGrid({}, async (rig) => {
                await settle()
                markChanged.mockClear()
                // Cancelled: a release on the noop gap and a pointercancel.
                await gesture(rig, { from: centre(0, 1), to: edge(0, 2, 'before') })
                await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), release: false })
                firePointer('pointercancel', window, edge(1, 2, 'before'))
                await settle()
                expect(markChanged).not.toHaveBeenCalledWith(true)

                await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before') })
                flushSync()
                expect(markChanged).toHaveBeenCalledWith(true)
            })
        } finally {
            stop()
        }
    })
})

describe('Grid drag: the origin of the content box', () => {
    /** Gives the scroller a 2 px border and 12 px of left padding: the content box starts 14 px in. */
    function padScroller(rig: Rig, paddingLeft: string, clientLeft: number): void {
        Object.defineProperty(rig.scroller, 'clientLeft', { configurable: true, value: clientLeft })
        const original = window.getComputedStyle.bind(window)
        vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string | null) => element === rig.scroller
            ? ({ paddingLeft, paddingRight: '0px', columnGap: '0px' } as unknown as CSSStyleDeclaration)
            : original(element, pseudo))
    }

    // Row 0 is A B C D at content x 32..88, 96..152, 160..216, 224..280; row 1 is E F G H likewise.
    test.each<[string, string, number, number]>([
        ['with a 2 px border and 12 px of padding', '12px', 2, 14],
        ['with none (control)', '0px', 0, 0],
    ])('(R) B-14 %s: the press at a tile\'s right edge minus 4 names that tile, the drop at a tile\'s midpoint minus 4 is its before-slot', async (_name, padding, border, offset) => {
        flat()
        await withGrid({}, async (rig) => {
            padScroller(rig, padding, border)
            // (a) B's content right edge is 152; minus 4 is 148. Without the offset the client x names C.
            await gesture(rig, { from: { x: 148 + offset, y: 28 }, to: { x: 168 + offset, y: 68 } })
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
        })
        flat()
        await withGrid({}, async (rig) => {
            padScroller(rig, padding, border)
            // (b) G's content midpoint is 188; minus 4 is 184: the left half, the gap after F.
            await gesture(rig, { from: { x: 60 + offset, y: 28 }, to: { x: 184 + offset, y: 68 } })
            expect(shape()).toEqual(['B', 'C', 'D', 'E', 'F', 'A', 'G', 'H'])
        })
    })
})

describe('Grid drag: the lift haptic', () => {
    function stubVibrate(impl: () => boolean = () => true): ReturnType<typeof vi.fn> {
        const vibrate = vi.fn(impl)
        Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
        return vibrate
    }

    test('(R) B-32a an edit-mode touch hold vibrates once at 500 ms, before any movement; travel, a key scroll and the drop add none', async () => {
        flat()
        const vibrate = stubVibrate()
        await withGrid({}, async (rig) => {
            firePointer('pointerdown', rig.scroller, centre(0, 1))
            vi.advanceTimersByTime(499)
            expect(vibrate).not.toHaveBeenCalled()
            vi.advanceTimersByTime(1)
            flushSync()
            expect(vibrate).toHaveBeenCalledTimes(1)
            expect(vibrate).toHaveBeenCalledWith(15)
            firePointer('pointermove', window, edge(1, 2, 'before'))
            await settle()
            pressKey(document.body, 'PageDown')
            await settle()
            firePointer('pointerup', window, edge(1, 2, 'before'))
            await settle()
            expect(vibrate).toHaveBeenCalledTimes(1)
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
        })
    })

    test('(F) B-32b a touch released before 500 ms does not vibrate (U45)', async () => {
        flat()
        const vibrate = stubVibrate()
        await withGrid({}, async (rig) => {
            firePointer('pointerdown', rig.scroller, centre(0, 1))
            vi.advanceTimersByTime(300)
            firePointer('pointerup', window, centre(0, 1))
            await settle()
            expect(vibrate).not.toHaveBeenCalled()
        })
    })

    test('(R through a control) B-32c a mouse drag in edit mode does not vibrate (U45)', async () => {
        flat()
        const vibrate = stubVibrate()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), type: 'mouse' })
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
            expect(vibrate).not.toHaveBeenCalled()
        })
    })

    test('(R through a control) B-32d under an active search, or a tile with no order entry, the hold lifts nothing and stays silent; the menu still opens', async () => {
        world(['A', 'B', 'C', 'D'], ['A', 'B', 'C'])
        const vibrate = stubVibrate()
        await withGrid({}, async (rig) => {
            // D has no order entry: the hold cannot drag it.
            await gesture(rig, { from: centre(0, 3), to: centre(0, 3) })
            expect(vibrate).not.toHaveBeenCalled()
            expect(alertSelectSpy).toHaveBeenCalledTimes(1)
            menuOpen.shift()!('2')
            await settle()
            // Control: a draggable tile vibrates.
            await gesture(rig, { from: centre(0, 0), to: centre(0, 0) })
            expect(vibrate).toHaveBeenCalledTimes(1)
            expect(alertSelectSpy).toHaveBeenCalledTimes(2)
            menuOpen.shift()!('2')
            await settle()
            await search(rig.target, 'Char')
            await gesture(rig, { from: centre(0, 1), to: centre(0, 1) })
            expect(vibrate).toHaveBeenCalledTimes(1)
            expect(alertSelectSpy).toHaveBeenCalledTimes(3)
        })
    })

    test('(F) B-32e the long press that enters edit mode vibrates exactly once and not again at its release', async () => {
        flat()
        const vibrate = stubVibrate()
        await withGrid({ edit: false }, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: centre(0, 1) })
            expect(isEditing(rig.target)).toBe(true)
            expect(vibrate).toHaveBeenCalledTimes(1)
            expect(vibrate).toHaveBeenCalledWith(15)
        })
    })

    test('(R through a control) B-32f a vibrate that throws, or none at all, leaves the hold, the menu and the drag working (U46)', async () => {
        flat()
        stubVibrate(() => {
            throw new Error('refused')
        })
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before') })
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
            await gesture(rig, { from: centre(0, 0), to: centre(0, 0) })
            expect(alertSelectSpy).toHaveBeenCalledTimes(1)
        })
        Reflect.deleteProperty(navigator, 'vibrate')
        flat()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before') })
            expect(shape()).toEqual(['A', 'C', 'D', 'E', 'F', 'B', 'G', 'H'])
        })
    })
})

describe('Grid drag: what the drag looks like', () => {
    const dimmed = (root: ParentNode): number => root.querySelectorAll('.opacity-40').length

    test('(R) the look starts after 10 px of travel: dimmed tiles, a body-level ghost with a count badge, a gap bar or a ring; all gone at the end (U17, U18)', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const base = dimmed(rig.target)
            await tap(rig.target, 'Char A')
            await tap(rig.target, 'Char B')
            // Held in place: no look yet.
            await gesture(rig, { from: centre(0, 0), to: centre(0, 0), release: false })
            expect(ghosts()).toBe(0)
            expect(dimmed(rig.target)).toBe(base)
            firePointer('pointerup', window, centre(0, 0))
            await settle()
            menuOpen.shift()!('2')
            await settle()

            await gesture(rig, { from: centre(0, 0), to: edge(1, 2, 'before'), release: false })
            expect(ghosts()).toBe(1)
            expect(document.querySelector('[data-grid-ghost]')!.textContent).toContain('2')
            expect(dimmed(rig.target) - base).toBe(2)
            expect(dropBars(rig.target)).toBe(1)
            expect(dropRings(rig.target)).toBe(0)

            // A dwell on a character shows the ring instead of the bar.
            firePointer('pointermove', window, centre(1, 3))
            await settle()
            vi.advanceTimersByTime(400)
            flushSync()
            await settle()
            expect(dropRings(rig.target)).toBe(1)
            expect(dropBars(rig.target)).toBe(0)

            firePointer('pointerup', window, centre(1, 3))
            await settle()
            expect(ghosts()).toBe(0)
            expect(dimmed(rig.target)).toBe(base)
            expect(dropBars(rig.target)).toBe(0)
            expect(dropRings(rig.target)).toBe(0)
        })
    })

    test('(R) a cancelled drag removes the ghost, the dimming and the painted target', async () => {
        flat()
        await withGrid({}, async (rig) => {
            const base = dimmed(rig.target)
            await gesture(rig, { from: centre(0, 1), to: edge(1, 2, 'before'), release: false })
            expect(ghosts()).toBe(1)
            pressKey(document.body, 'Escape')
            await settle()
            expect(ghosts()).toBe(0)
            expect(dimmed(rig.target)).toBe(base)
            expect(dropBars(rig.target)).toBe(0)
        })
    })
})

describe('Grid drag: the selection after a merge', () => {
    test('(R) B-29c a merge clears the selection, a picked folder that was not dragged included', async () => {
        world(['A', 'B', 'C', 'D'], [makeFolder('f1', 'F1', ['B']), 'A', 'C', 'D'])
        await withGrid({}, async (rig) => {
            // Rows: [F1 A C D]. F1 is picked; the dragged character A is not.
            await tap(rig.target, 'F1')
            expect(pressedOf(rig.target, 'F1')).toBe('true')
            await gesture(rig, { from: centre(0, 1), to: centre(0, 2), dwell: 400 })
            expect(shape()).toEqual(['F1[B]', `${NEW_FOLDER}[A,C]`, 'D'])
            expect(alertConfirmSpy).not.toHaveBeenCalled()
            expect(picked(rig.target)).toBe(0)
            expect(isEditing(rig.target)).toBe(true)
            // Control: a plain move of an unselected character keeps the picked folder.
            await tap(rig.target, 'F1')
            expect(pressedOf(rig.target, 'F1')).toBe('true')
            await gesture(rig, { from: centre(0, 2, 3), to: edge(0, 0, 'before', 3) })
            expect(shape()).toEqual(['D', 'F1[B]', `${NEW_FOLDER}[A,C]`])
            expect(pressedOf(rig.target, 'F1')).toBe('true')
        })
    })
})
