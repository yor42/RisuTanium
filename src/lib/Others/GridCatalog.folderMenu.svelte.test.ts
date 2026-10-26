// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Grid tab: the folder menu. In edit mode, a right-click, the context-menu key or a
 * touch hold released in place on a folder tile that is alone in the selection offers the sidebar's
 * folder menu [Rename, Change color, Change image, Ungroup, Delete, Cancel]; the code of the menu is the
 * rail's (`runFolderMenu`) and is REAL here, as are the sidebar order operations and the folder colour
 * list. The Grid wiring is what these tests pin: which menu opens, the selection after each action,
 * the open-folder set, the shared guard and the native file chooser.
 *
 * Test labels: `(R)` is a regression reproducer of the accepted gap "no folder menu in the Grid" (it
 * fails on the base without the menu), `(F)` is a feature test (on the base it fails only because no menu
 * opens, so a failure there proves nothing; the evidence is the mutation proof recorded in the stage
 * report), `(G)` is a guard that may pass before and after.
 *
 * Fixture: characters A, B, C, U; the order is `A, folder F1 (B, C), U`, so the closed Grid shows the
 * tiles `Char A`, `F1`, `Char U`. Four columns (a 312 px container) with 56 px tiles and 8 px gaps; the
 * drag rig (`withGrid`, `gesture`, `centre`) is the one of `GridCatalog.drag.svelte.test.ts`.
 *
 * MOCKED: the module set of `GridCatalog.group.svelte.test.ts`, with `alertSelect` an answer-controlled
 * spy, `alertInput` answering from `nextInput`, `alertConfirm` an answer-controlled spy, `saveAsset` and
 * `selectSingleFile` (the native chooser) spies, and `checkCharOrder` a spy. Pointer events are
 * synthetic, on fake timers; a device behaves differently in ways no jsdom-like run shows. A throw in
 * the Grid's voided menu chain is observed only as vitest reporting an unhandled rejection or a run
 * error.
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

const { changeCharSpy, removeCharSpy, trashCharactersSpy, checkCharOrderSpy, alertSelectSpy, alertConfirmSpy, alertInputSpy, saveAssetSpy, selectSingleFileSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    trashCharactersSpy: vi.fn(),
    checkCharOrderSpy: vi.fn(),
    alertSelectSpy: vi.fn(),
    alertConfirmSpy: vi.fn(),
    alertInputSpy: vi.fn(),
    saveAssetSpy: vi.fn(),
    selectSingleFileSpy: vi.fn(),
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
            saveAssetFromBlob: saveAssetSpy,
            pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024 * 1024),
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
        alertInput: alertInputSpy,
    }
})

vi.mock(import('../../ts/util'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        selectSingleFileObject: selectSingleFileSpy,
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
import { setLiveKeysBlockedReader } from '../../ts/keyEventBlocked'
import { GRID_TOUCH_MERGE_DWELL_MS } from '../SideBars/railConstants'
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

function makeFolder(id: string, name: string, data: string[], extra: Partial<folder> = {}): folder {
    return { id, name, data, color: '', ...extra }
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

/** A, folder F1 (B, C), U: the closed Grid shows `Char A`, `F1`, `Char U`. */
function fixture(extra: Partial<folder> = {}): void {
    world(['A', 'B', 'C', 'U'], ['A', makeFolder('f1', 'F1', ['B', 'C'], extra), 'U'])
}

/** The saved order as text: a character as its id, a folder as `name[members]`. */
const shape = (): string[] =>
    (DBState.db.characterOrder as unknown as Array<string | folder>).map((entry) =>
        typeof entry === 'string' ? entry : `${entry.name}[${entry.data.join(',')}]`)

/** The folder of the saved order with this id (the first one). */
const folderOf = (id: string): folder =>
    (DBState.db.characterOrder as unknown as Array<string | folder>).find((entry): entry is folder => typeof entry !== 'string' && entry.id === id)!

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
const openSet = (): string[] => JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY) ?? '[]')

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

/** Element geometry the scroller reports in a real layout: happy-dom reports zeros. */
function stubScroller(scroller: HTMLElement, view: number): void {
    let top = 0
    Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value: number) => {
            top = value
        },
    })
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => view })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => view })
    scroller.getBoundingClientRect = () => ({
        left: 0, top: 0, right: COLUMNS_WIDTH, bottom: view, width: COLUMNS_WIDTH, height: view, x: 0, y: 0, toJSON: () => ({}),
    })
}

interface Rig {
    target: HTMLElement
    scroller: HTMLElement
    /** Unmounts the screen now; the cleanup afterwards does nothing more. */
    unmountNow: () => Promise<void>
}

let clientWidthDescriptor: PropertyDescriptor | undefined
const endGridSpy = vi.fn()

/**
 * Mounts the Grid tab with the scroller stubbed, enters edit mode (unless `edit` is false) and runs
 * `body` under fake timers (setTimeout and clearTimeout only), so a hold and a dwell are driven by
 * `advanceTimersByTime`.
 */
async function withGrid(options: { edit?: boolean }, body: (rig: Rig) => Promise<void>): Promise<void> {
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
        stubScroller(scroller, VIEW)
        if (options.edit !== false) {
            editButton(target)!.click()
            await settle()
        }
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            await body({ target, scroller, unmountNow })
        } finally {
            vi.useRealTimers()
        }
    } finally {
        await unmountNow()
        target.remove()
    }
}

interface Gesture {
    from: Pt
    to: Pt
    /** Milliseconds the pointer rests at `to` before the release. */
    dwell?: number
    /** False leaves the finger down. */
    release?: boolean
}

/** Press, hold 500 ms (touch), move to `to`, rest, release. */
async function gesture(rig: Rig, g: Gesture): Promise<void> {
    firePointer('pointerdown', rig.scroller, g.from)
    vi.advanceTimersByTime(500)
    flushSync()
    await settle()
    firePointer('pointermove', window, g.to)
    await settle()
    if (g.dwell) {
        vi.advanceTimersByTime(g.dwell)
        flushSync()
        await settle()
    }
    if (g.release !== false) {
        firePointer('pointerup', window, g.to)
        await settle()
    }
}

/** Holds the finger down at `p` for the long-press time and releases it in place. */
async function holdRelease(rig: Rig, p: Pt): Promise<void> {
    firePointer('pointerdown', rig.scroller, p)
    vi.advanceTimersByTime(600)
    flushSync()
    await settle()
    firePointer('pointerup', window, p)
    await settle()
}

function contextMenu(target: Element): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
}

interface Deferred<T> {
    promise: Promise<T>
    resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

/** Every menu that was put up, in order, and the resolvers of the ones still open. */
let menus: string[][] = []
let openMenus: Array<(value: string) => void> = []
let confirms: string[] = []
let openConfirms: Array<(value: boolean) => void> = []
let nextInput: string | Promise<string> = ''

async function answer(choice: string): Promise<void> {
    const resolve = openMenus.shift()
    if (!resolve) {
        throw new Error('no menu is open')
    }
    resolve(choice)
    await settle()
}

async function answerConfirm(yes: boolean): Promise<void> {
    const resolve = openConfirms.shift()
    if (!resolve) {
        throw new Error('no confirmation is open')
    }
    resolve(yes)
    await settle()
}

const FOLDER_MENU = [
    language.renameFolder,
    language.changeFolderColor,
    language.changeFolderImage,
    language.ungroupFolder,
    language.deleteFolder,
    language.cancel,
]
const GROUP = language.othersUi.editGroup
const TRASH = language.othersUi.editMoveToTrash
const CANCEL = language.cancel
const RENAME = '0'
const COLOUR = '1'
const PICTURE = '2'
const UNGROUP = '3'
const DELETE = '4'
const CANCEL_TOP = '5'
const BLUE = '2'

const file = new File([new Uint8Array([1, 2, 3])], 'p.png')

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    checkCharOrderSpy.mockClear()
    endGridSpy.mockClear()
    trashCharactersSpy.mockReset()
    trashCharactersSpy.mockImplementation(async () => 0)
    menus = []
    openMenus = []
    confirms = []
    openConfirms = []
    nextInput = ''
    alertSelectSpy.mockReset()
    alertSelectSpy.mockImplementation((labels: string[]) => {
        menus.push(labels)
        return new Promise<string>((resolve) => {
            openMenus.push(resolve)
        })
    })
    alertConfirmSpy.mockReset()
    alertConfirmSpy.mockImplementation((message: string) => {
        confirms.push(message)
        return new Promise<boolean>((resolve) => {
            openConfirms.push(resolve)
        })
    })
    alertInputSpy.mockReset()
    alertInputSpy.mockImplementation(async () => nextInput)
    saveAssetSpy.mockReset()
    saveAssetSpy.mockResolvedValue('asset-1')
    selectSingleFileSpy.mockReset()
    selectSingleFileSpy.mockResolvedValue(file)
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => COLUMNS_WIDTH })
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.useRealTimers()
    setLiveKeysBlockedReader(() => false)
    vi.unstubAllGlobals()
    document.querySelectorAll('[data-grid-ghost]').forEach((el) => el.remove())
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

describe('Grid folder menu: opening', () => {
    test('(R) a right-click on a folder tile in edit mode prevents the browser menu, selects the folder and offers the six folder items', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            const event = contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(event.defaultPrevented).toBe(true)
            expect(menus).toEqual([FOLDER_MENU])
            expect(pressedOf(rig.target, 'F1')).toBe('true')
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(F) a context-menu event on a folder tile that is already selected keeps it selected and opens the folder menu', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'F1')
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(menus).toEqual([FOLDER_MENU])
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(G) a folder selected beside another tile opens the bulk menu, not the folder menu', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'F1')
            contextMenu(charTile(rig.target, 'Char U')!)
            await settle()
            expect(menus).toEqual([[GROUP, TRASH, CANCEL]])
            expect(picked(rig.target)).toBe(2)
        })
    })

    test('(F) a right-click on a folder tile while a character is selected opens the bulk menu for both, not the folder menu', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char U')
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(menus).toHaveLength(1)
            expect(menus[0]).not.toEqual(FOLDER_MENU)
            expect(menus[0]).toContain(TRASH)
            expect(picked(rig.target)).toBe(2)
        })
    })

    test('(F) a hold on a folder tile while a character is selected, released in place, opens the bulk menu for both, not the folder menu', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            await tap(rig.target, 'Char U')
            await holdRelease(rig, centre(0, 1, 3))
            expect(menus).toHaveLength(1)
            expect(menus[0]).not.toEqual(FOLDER_MENU)
            expect(menus[0]).toContain(TRASH)
            expect(picked(rig.target)).toBe(2)
        })
    })

    test('(F) a right-click on the chevron button of a folder tile opens the folder menu with the folder selected', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            const event = contextMenu(chevrons(rig.target)[0])
            await settle()
            expect(event.defaultPrevented).toBe(true)
            expect(menus).toEqual([FOLDER_MENU])
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(G) a character alone still opens the bulk menu', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(charTile(rig.target, 'Char U')!)
            await settle()
            expect(menus).toEqual([[GROUP, TRASH, CANCEL]])
        })
    })

    test('(G) outside edit mode the browser menu stays on a folder tile', async () => {
        fixture()
        await withGrid({ edit: false }, async (rig) => {
            const event = contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(event.defaultPrevented).toBe(false)
            expect(alertSelectSpy).not.toHaveBeenCalled()
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(G) the press that enters edit mode on a folder tile opens no menu', async () => {
        fixture()
        await withGrid({ edit: false }, async (rig) => {
            await holdRelease(rig, centre(0, 1, 3))
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) a hold on a folder tile in edit mode, released in place, opens the folder menu with the folder selected', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            await holdRelease(rig, centre(0, 1, 3))
            expect(menus).toEqual([FOLDER_MENU])
            expect(pressedOf(rig.target, 'F1')).toBe('true')
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(G) a hold on a folder tile that is cancelled, blurs or is ended by Escape opens no menu and writes nothing', async () => {
        fixture()
        const order = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            const p = centre(0, 1, 3)
            const press = async () => {
                firePointer('pointerdown', rig.scroller, p)
                vi.advanceTimersByTime(600)
                flushSync()
                await settle()
            }
            await press()
            firePointer('pointercancel', window, p)
            firePointer('pointerup', window, p)
            await settle()

            await press()
            window.dispatchEvent(new Event('blur'))
            firePointer('pointerup', window, p)
            await settle()

            await press()
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
            firePointer('pointerup', window, p)
            await settle()
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
        expect(DBState.db.characterOrder).toBe(order)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('(G) a drop onto a folder tile and a lifted folder dropped onto a character open no menu', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 2, 3), to: centre(0, 1, 3) })
            expect(shape()).toEqual(['A', 'F1[B,C,U]'])
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
        fixture()
        await withGrid({}, async (rig) => {
            await gesture(rig, { from: centre(0, 1, 3), to: edge(0, 0, 'before', 3) })
            expect(shape()).toEqual(['F1[B,C]', 'A', 'U'])
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) a second request while a menu is open does not stack, whichever menu is open', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            contextMenu(folderTile(rig.target, 'F1')!)
            contextMenu(charTile(rig.target, 'Char U')!)
            await settle()
            expect(menus).toEqual([FOLDER_MENU])
            await answer(CANCEL_TOP)
            contextMenu(charTile(rig.target, 'Char U')!)
            await settle()
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(menus).toHaveLength(2)
        })
    })
})

describe('Grid folder menu: the actions', () => {
    test('(F) Rename writes the new name without a repair, announces nothing and the tile carries the new name', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            nextInput = 'Renamed'
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(RENAME)
            expect(shape()).toEqual(['A', 'Renamed[B,C]', 'U'])
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(folderTile(rig.target, 'Renamed')).not.toBeNull()
            expect(folderTile(rig.target, 'F1')).toBeNull()
            expect(liveText()).toBe('')
        })
    })

    test('(F) Change color stores the chosen color value and offers the color list', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(COLOUR)
            expect(menus[1]).toEqual([
                language.sidebarUi.folderColorRed,
                language.sidebarUi.folderColorGreen,
                language.sidebarUi.folderColorBlue,
                language.sidebarUi.folderColorYellow,
                language.sidebarUi.folderColorIndigo,
                language.sidebarUi.folderColorPurple,
                language.sidebarUi.folderColorPink,
                language.sidebarUi.folderColorDefault,
            ])
            await answer(BLUE)
            expect(folderOf('f1').color).toBe('blue')
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) Change image to the default picture clears the folder picture without a repair', async () => {
        fixture({ imgFile: 'old-asset', img: 'old' })
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(PICTURE)
            expect(menus[1]).toEqual([language.alerts.resetToDefaultImage, language.alerts.selectImageFile])
            await answer('0')
            expect(folderOf('f1').imgFile).toBeNull()
            expect(folderOf('f1').img).toBe('')
            expect(selectSingleFileSpy).not.toHaveBeenCalled()
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) Change image to a file saves the asset first and writes the folder only after the save resolves', async () => {
        fixture()
        const save = deferred<string>()
        saveAssetSpy.mockReturnValue(save.promise)
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(PICTURE)
            await answer('1')
            expect(selectSingleFileSpy).toHaveBeenCalledWith(['png', 'jpg', 'webp'])
            expect(saveAssetSpy).toHaveBeenCalledWith(file)
            expect(folderOf('f1').imgFile).toBeUndefined()
            save.resolve('asset-9')
            await settle()
            expect(folderOf('f1').imgFile).toBe('asset-9')
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) Ungroup puts the members at the folder place, repairs once and closes the folder in the open set', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            chevrons(rig.target)[0].click()
            await settle()
            expect(openSet()).toEqual(['f1'])
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(UNGROUP)
            expect(shape()).toEqual(['A', 'B', 'C', 'U'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(openSet()).toEqual([])
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(F) Delete then Keep equals Ungroup', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            chevrons(rig.target)[0].click()
            await settle()
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(DELETE)
            expect(menus[1]).toEqual([language.deleteFolderKeep, language.deleteFolderTrash(2), CANCEL])
            await answer('0')
            expect(shape()).toEqual(['A', 'B', 'C', 'U'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(openSet()).toEqual([])
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(F) Delete then Trash names the folder and the visible count and trashes only the visible untrashed members', async () => {
        world(['A', 'B', 'C', '§temp', 'U'], ['A', makeFolder('f1', 'F1', ['B', 'C', '§temp']), 'U'])
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(DELETE)
            expect(menus[1]).toEqual([language.deleteFolderKeep, language.deleteFolderTrash(2), CANCEL])
            await answer('1')
            expect(confirms).toEqual([language.deleteFolderTrashConfirm('F1', 2)])
            await answerConfirm(true)
            const trashed = DBState.db.characters.filter((c) => c.trashTime).map((c) => c.chaId).sort()
            expect(trashed).toEqual(['B', 'C'])
            expect(shape()).toEqual(['A', '§temp', 'U'])
            // One pass removes the trashed ids and the folder it just emptied.
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(picked(rig.target)).toBe(0)
        })
    })
})

describe('Grid folder menu: the selection after the menu', () => {
    test('(F) after Rename, Change color and Change image the folder tile is still selected, picked exactly once', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            nextInput = 'Renamed'
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(RENAME)
            expect(pressedOf(rig.target, 'Renamed')).toBe('true')
            expect(picked(rig.target)).toBe(1)

            contextMenu(folderTile(rig.target, 'Renamed')!)
            await settle()
            await answer(COLOUR)
            await answer(BLUE)
            expect(folderOf('f1').color).toBe('blue')
            expect(pressedOf(rig.target, 'Renamed')).toBe('true')
            expect(picked(rig.target)).toBe(1)

            contextMenu(folderTile(rig.target, 'Renamed')!)
            await settle()
            await answer(PICTURE)
            await answer('0')
            expect(pressedOf(rig.target, 'Renamed')).toBe('true')
            expect(picked(rig.target)).toBe(1)

            contextMenu(folderTile(rig.target, 'Renamed')!)
            await settle()
            await answer(PICTURE)
            await answer('1')
            await settle()
            expect(folderOf('f1').imgFile).toBe('asset-1')
            expect(pressedOf(rig.target, 'Renamed')).toBe('true')
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(F) after Ungroup and after Delete then Keep or Trash the folder is gone and nothing stays selected', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(UNGROUP)
            expect(picked(rig.target)).toBe(0)
        })
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(DELETE)
            await answer('0')
            expect(picked(rig.target)).toBe(0)
        })
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(DELETE)
            await answer('1')
            await answerConfirm(true)
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(F) Cancel at the top list and at every sub-prompt leaves the folder selected and writes nothing', async () => {
        fixture()
        const order = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            const ask = async (...choices: string[]) => {
                contextMenu(folderTile(rig.target, 'F1')!)
                await settle()
                for (const choice of choices) {
                    await answer(choice)
                }
                expect(pressedOf(rig.target, 'F1')).toBe('true')
                expect(picked(rig.target)).toBe(1)
            }
            await ask(CANCEL_TOP)
            await ask(COLOUR, '99')
            await ask(PICTURE, '99')
            await ask(DELETE, '2')
            nextInput = ''
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(RENAME)
            await settle()
            expect(picked(rig.target)).toBe(1)
            selectSingleFileSpy.mockResolvedValue(null)
            await ask(PICTURE, '1')
            await ask(DELETE, '1')
            await answerConfirm(false)
            expect(picked(rig.target)).toBe(1)
        })
        expect(DBState.db.characterOrder).toBe(order)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(saveAssetSpy).not.toHaveBeenCalled()
    })
})

describe('Grid folder menu: twin folder ids', () => {
    // Two folders carry the id `dup`; the closed Grid shows `Char A`, `Twin one`, `Twin two`, `Char U`.
    function twins(): void {
        world(['A', 'B', 'C', 'U'], ['A', makeFolder('dup', 'Twin one', ['B']), makeFolder('dup', 'Twin two', ['C']), 'U'])
    }

    test('(F) Rename, Change color and the picture edits are silent no-ops and the pick is unchanged', async () => {
        twins()
        const order = DBState.db.characterOrder
        await withGrid({}, async (rig) => {
            nextInput = 'Renamed'
            contextMenu(folderTile(rig.target, 'Twin two')!)
            await settle()
            await answer(RENAME)
            contextMenu(folderTile(rig.target, 'Twin two')!)
            await settle()
            await answer(COLOUR)
            await answer(BLUE)
            contextMenu(folderTile(rig.target, 'Twin two')!)
            await settle()
            await answer(PICTURE)
            await answer('0')
            contextMenu(folderTile(rig.target, 'Twin two')!)
            await settle()
            await answer(PICTURE)
            await answer('1')
            await settle()
            expect(DBState.db.characterOrder).toBe(order)
            expect(saveAssetSpy).not.toHaveBeenCalled()
            expect(pressedOf(rig.target, 'Twin two')).toBe('true')
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(F) Ungroup acts on the held twin by reference and closes the shared id in the open set', async () => {
        twins()
        await withGrid({}, async (rig) => {
            chevrons(rig.target)[0].click()
            await settle()
            expect(openSet()).toEqual(['dup'])
            contextMenu(folderTile(rig.target, 'Twin two')!)
            await settle()
            await answer(UNGROUP)
            expect(shape()).toEqual(['A', 'Twin one[B]', 'C', 'U'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(openSet()).toEqual([])
            expect(folderTile(rig.target, 'Twin one')!.getAttribute('aria-expanded')).toBe('false')
        })
    })

    test('(F) Delete then Keep and Delete then Trash act on the held twin only', async () => {
        twins()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'Twin one')!)
            await settle()
            await answer(DELETE)
            await answer('0')
            expect(shape()).toEqual(['A', 'B', 'Twin two[C]', 'U'])
        })
        twins()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'Twin two')!)
            await settle()
            await answer(DELETE)
            await answer('1')
            await answerConfirm(true)
            expect(DBState.db.characters.filter((c) => c.trashTime).map((c) => c.chaId)).toEqual(['C'])
            expect(shape()).toEqual(['A', 'Twin one[B]', 'U'])
        })
    })
})

describe('Grid folder menu: what changes while a prompt is open', () => {
    test('(F) a folder replaced while the rename prompt is open is not edited', async () => {
        fixture()
        const input = deferred<string>()
        nextInput = input.promise
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            await answer(RENAME)
            DBState.db.characterOrder = ['A', 'U'] as unknown as OrderFixture
            await settle()
            input.resolve('Renamed')
            await settle()
            expect(shape()).toEqual(['A', 'U'])
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) Ungroup acts on the folder as it is when the choice is made, by its reference', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            DBState.db.characterOrder = [makeFolder('f1', 'F1', ['B', 'C']), 'U', 'A'] as unknown as OrderFixture
            await settle()
            await answer(UNGROUP)
            expect(shape()).toEqual(['B', 'C', 'U', 'A'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) Done before the answer: the answer still ungroups by reference and leaves nothing selected', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            clickButton(rig.target, language.othersUi.editDone)
            await settle()
            await answer(UNGROUP)
            expect(isEditing(rig.target)).toBe(false)
            expect(picked(rig.target)).toBe(0)
        })
    })
})

describe('Grid folder menu: the guard and the native file chooser', () => {
    async function openPictureFile(rig: Rig, name = 'F1'): Promise<void> {
        contextMenu(folderTile(rig.target, name)!)
        await settle()
        await answer(PICTURE)
        await answer('1')
    }

    test('(F) a chooser answered with no file ends the chain, and the next right-click opens a menu', async () => {
        fixture()
        selectSingleFileSpy.mockResolvedValue(null)
        await withGrid({}, async (rig) => {
            await openPictureFile(rig)
            await settle()
            expect(saveAssetSpy).not.toHaveBeenCalled()
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(menus).toHaveLength(3)
        })
    })

    test('(F) a chooser that never settles does not lock the folder menu or the bulk menu', async () => {
        fixture()
        selectSingleFileSpy.mockReturnValue(new Promise(() => {}))
        await withGrid({}, async (rig) => {
            await openPictureFile(rig)
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(menus).toHaveLength(3)
            await answer(CANCEL_TOP)
            contextMenu(charTile(rig.target, 'Char U')!)
            await settle()
            expect(menus).toHaveLength(4)
            expect(menus[3]).toEqual([GROUP, TRASH, CANCEL])
        })
    })

    test('(F) a chain whose chooser answers late does not clear the guard of a menu opened after it', async () => {
        fixture()
        const picker = deferred<typeof file | null>()
        selectSingleFileSpy.mockReturnValue(picker.promise)
        await withGrid({}, async (rig) => {
            await openPictureFile(rig)
            // A newer chain opens and waits at its first prompt.
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(menus).toHaveLength(3)
            picker.resolve(null)
            await settle()
            // The abandoned chain has ended; the newer menu is still open, so a third request cannot stack.
            contextMenu(charTile(rig.target, 'Char U')!)
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(menus).toHaveLength(3)
        })
    })
})

describe('Grid folder menu: the window after the chooser answers', () => {
    // The chooser is a test-held promise, so the chain waits after the answer with no alert up and the
    // page interactive. Each test acts in that window, then lets the chooser and the asset save finish.
    async function pictureWindow(rig: Rig, picker: Deferred<typeof file>): Promise<void> {
        selectSingleFileSpy.mockReturnValue(picker.promise)
        contextMenu(folderTile(rig.target, 'F1')!)
        await settle()
        await answer(PICTURE)
        await answer('1')
    }

    async function finish(picker: Deferred<typeof file>): Promise<void> {
        picker.resolve(file)
        await settle()
        await settle()
    }

    test('(F) Done in the window: the picture is written and, back in edit mode, nothing is selected', async () => {
        fixture()
        const picker = deferred<typeof file>()
        await withGrid({}, async (rig) => {
            await pictureWindow(rig, picker)
            clickButton(rig.target, language.othersUi.editDone)
            await settle()
            await finish(picker)
            expect(folderOf('f1').imgFile).toBe('asset-1')
            editButton(rig.target)!.click()
            await settle()
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(F) a tap that deselects the folder in the window: the picture is written and the folder stays deselected', async () => {
        fixture()
        const picker = deferred<typeof file>()
        await withGrid({}, async (rig) => {
            await pictureWindow(rig, picker)
            await tap(rig.target, 'F1')
            expect(picked(rig.target)).toBe(0)
            await finish(picker)
            expect(folderOf('f1').imgFile).toBe('asset-1')
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(F) a merge drop in the window clears the selection: the picture is written, the new folder exists and nothing is selected', async () => {
        world(['A', 'B', 'C', 'D'], [makeFolder('f1', 'F1', ['B']), 'A', 'C', 'D'])
        const picker = deferred<typeof file>()
        await withGrid({}, async (rig) => {
            await pictureWindow(rig, picker)
            expect(picked(rig.target)).toBe(1)
            // Rows: [F1 A C D]; the dragged character A is not selected.
            await gesture(rig, { from: centre(0, 1), to: centre(0, 2), dwell: GRID_TOUCH_MERGE_DWELL_MS })
            expect(shape()).toEqual(['F1[B]', `${language.sidebarUi.defaultFolderName}[A,C]`, 'D'])
            expect(picked(rig.target)).toBe(0)
            await finish(picker)
            expect(folderOf('f1').imgFile).toBe('asset-1')
            expect(picked(rig.target)).toBe(0)
        })
    })

    test('(F) a move drop in the window keeps the folder selected, once, after the picture is written', async () => {
        world(['A', 'B', 'C', 'D'], [makeFolder('f1', 'F1', ['B']), 'A', 'C', 'D'])
        const picker = deferred<typeof file>()
        await withGrid({}, async (rig) => {
            await pictureWindow(rig, picker)
            await gesture(rig, { from: centre(0, 1), to: edge(0, 3, 'after') })
            expect(shape()).toEqual(['F1[B]', 'C', 'D', 'A'])
            expect(picked(rig.target)).toBe(1)
            await finish(picker)
            expect(folderOf('f1').imgFile).toBe('asset-1')
            expect(pressedOf(rig.target, 'F1')).toBe('true')
            expect(picked(rig.target)).toBe(1)
        })
    })

    test('(F) the chooser answered after the Grid is closed still writes the picture and does not throw', async () => {
        fixture()
        const picker = deferred<typeof file>()
        await withGrid({}, async (rig) => {
            await pictureWindow(rig, picker)
            await rig.unmountNow()
            await finish(picker)
            expect(folderOf('f1').imgFile).toBe('asset-1')
        })
    })
})

describe('Grid folder menu: keys blocked', () => {
    test('(G) a context menu on a folder tile while keys are blocked opens no menu and selects nothing', async () => {
        fixture()
        await withGrid({}, async (rig) => {
            setLiveKeysBlockedReader(() => true)
            contextMenu(folderTile(rig.target, 'F1')!)
            await settle()
            expect(alertSelectSpy).not.toHaveBeenCalled()
            expect(picked(rig.target)).toBe(0)
        })
    })
})
