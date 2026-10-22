// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Grid tab: grouping the edit-mode selection into a new folder. A touch hold
 * released in place, a right-click or the context-menu key on a character tile (in edit mode) selects
 * the tile if it is not selected and offers [Group into new folder, Move to trash, Cancel] for the whole
 * selection; an icon button in the edit row does the same Group. The write is one assignment of
 * `characterOrder` plus one `checkCharOrder` (a spy here); `trashCharacters` is a spy too.
 *
 * Fixture: characters A, B, C, U; the order is `A, folder F1 (B, C), U`, so the closed Grid shows the
 * tiles `Char A`, `F1`, `Char U`. Four columns (a 312 px container) with 56 px tiles and 8 px gaps put
 * a row of three tiles at x = 64 + 64 * n, so a press is placed from that arithmetic, written out by hand.
 *
 * Test labels: `(F)` is a feature test (the feature does not exist on the earlier base, so a failure
 * there is a setup failure and proves nothing; the evidence is the mutation proof recorded in the stage
 * report), `(G)` is a guard that may pass before and after.
 *
 * MOCKED: the module set of `GridCatalog.edit.svelte.test.ts` (same directory), with `alertSelect` an
 * answer-controlled spy: the menu stays open until the test answers it, so the order, the picks or the
 * characters can change while it is open. Geometry is faked and pointer events are synthetic, on fake
 * timers; a device behaves differently in ways no jsdom-like run shows.
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

const { changeCharSpy, removeCharSpy, trashCharactersSpy, checkCharOrderSpy, alertSelectSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    trashCharactersSpy: vi.fn(),
    checkCharOrderSpy: vi.fn(),
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
import { OPEN_FOLDERS_KEY } from '../SideBars/railMemory'
import { listRows } from '../SideBars/sidebarOrder'
import { buildGridEntries } from './charListOrder'
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

function install(characters: CharacterFixture[], order: OrderFixture): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        characterOrder: order,
        hideAllImages: false,
    } as unknown as Database
}

const NEW_FOLDER = language.sidebarUi.defaultFolderName

/** A, folder F1 (B, C), U: the closed Grid shows `Char A`, `F1`, `Char U`. */
function fixture(): void {
    install(
        [makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B'), makeCharacter('C', 'Char C'), makeCharacter('U', 'Char U')],
        ['A', makeFolder('f1', 'F1', ['B', 'C']), 'U'] as unknown as OrderFixture,
    )
}

/** The saved order as text: a character as its id, a folder as `name[members]`. */
const shape = (order: OrderFixture = DBState.db.characterOrder): string[] =>
    order.map((entry) => (typeof entry === 'string' ? entry : `${entry.name}[${entry.data.join(',')}]`))

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function settleFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await settle()
}

const endGridSpy = vi.fn()

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
const groupButton = (root: ParentNode): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${language.othersUi.editGroup}"]`)
const trashButton = (root: ParentNode): HTMLButtonElement | undefined => buttonByText(root, language.othersUi.editMoveToTrash)

const charTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`[data-charlist-key] button[aria-label="${name}"]`)
const folderTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-expanded][aria-label="${name}"]`)
const chevron = (root: ParentNode): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${language.othersUi.editFolderToggle}"]`)
const tileNames = (root: ParentNode): string[] =>
    Array.from(root.querySelectorAll('[data-charlist-key]')).map((card) => card.querySelector('button')?.getAttribute('aria-label') ?? '')
const scrollerOf = (root: ParentNode): HTMLElement => root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')!
const pressed = (root: ParentNode, name: string): string | null => charTile(root, name)?.getAttribute('aria-pressed') ?? null

async function tap(root: ParentNode, name: string): Promise<void> {
    const tile = charTile(root, name) ?? folderTile(root, name)
    if (!tile) {
        throw new Error(`no tile "${name}"`)
    }
    tile.click()
    await settle()
}

async function enter(root: ParentNode): Promise<void> {
    editButton(root)!.click()
    await settle()
}

function firePointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', target: EventTarget, x: number, y: number, pointerType = 'touch'): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: pointerType },
        isPrimary: { value: true },
    })
    target.dispatchEvent(event)
}

/** The centre of tile `n` of a row of `count` tiles in the first row of a 312 px container. */
const tileAt = (count: number, n: number): { x: number, y: number } => ({
    x: (312 - (count * 56 + (count - 1) * 8)) / 2 + n * 64 + 28,
    y: 28,
})

/** Holds the finger down on `name` for the long-press time and releases it in place. */
async function hold(root: ParentNode, name: string, count: number, n: number): Promise<void> {
    const { x, y } = tileAt(count, n)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
        firePointer('pointerdown', charTile(root, name)!, x, y)
        vi.advanceTimersByTime(600)
        flushSync()
    } finally {
        vi.useRealTimers()
    }
    firePointer('pointerup', window, x, y)
    await settle()
}

function contextMenu(target: Element): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
}

const dbJson = (): string => JSON.stringify(DBState.db)

/** Every menu that was put up, in order, and the resolver of the one still open. */
let menus: string[][] = []
let answerOpenMenu: ((value: string) => void) | null = null

async function answer(choice: string): Promise<void> {
    answerOpenMenu!(choice)
    answerOpenMenu = null
    await settle()
}

const GROUP = language.othersUi.editGroup
const TRASH = language.othersUi.editMoveToTrash
const CANCEL = language.cancel

const FOUR_COLUMNS = 312
let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    checkCharOrderSpy.mockClear()
    endGridSpy.mockClear()
    trashCharactersSpy.mockReset()
    trashCharactersSpy.mockImplementation(async () => 0)
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
})

afterEach(() => {
    resetBackHandlersForTests()
    vi.useRealTimers()
    setLiveKeysBlockedReader(() => false)
    vi.unstubAllGlobals()
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

describe('Grid group: the hold menu', () => {
    test('(F) a hold on an unselected tile selects it and offers Group, Move to trash and Cancel; Cancel keeps it selected and writes nothing', async () => {
        fixture()
        const order = DBState.db.characterOrder
        const snapshot = dbJson()
        await withMounted(async (target) => {
            await enter(target)
            await hold(target, 'Char U', 3, 2)
            expect(menus).toEqual([[GROUP, TRASH, CANCEL]])
            expect(pressed(target, 'Char U')).toBe('true')
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))
            await answer('2')
            expect(pressed(target, 'Char U')).toBe('true')
            expect(isEditing(target)).toBe(true)
        })
        expect(DBState.db.characterOrder).toBe(order)
        expect(dbJson()).toBe(snapshot)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(trashCharactersSpy).not.toHaveBeenCalled()
    })

    test('(F) Group acts on the whole selection: one write, one repair, picks cleared, edit mode kept, the new folder closed and the open set untouched', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            const openBefore = localStorage.getItem(OPEN_FOLDERS_KEY)
            await hold(target, 'Char U', 3, 2)
            await answer('0')
            expect(shape()).toEqual([`${NEW_FOLDER}[A,U]`, 'F1[B,C]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(picked(target)).toBe(0)
            expect(isEditing(target)).toBe(true)
            expect(tileNames(target)).toEqual([NEW_FOLDER, 'F1'])
            expect(folderTile(target, NEW_FOLDER)!.getAttribute('aria-expanded')).toBe('false')
            expect(localStorage.getItem(OPEN_FOLDERS_KEY)).toBe(openBefore)
        })
    })

    test('(F) a hold on a selected tile keeps it selected, the count unchanged, and the menu acts on the whole selection', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            await tap(target, 'Char U')
            await hold(target, 'Char A', 3, 0)
            expect(menus).toHaveLength(1)
            expect(pressed(target, 'Char A')).toBe('true')
            expect(picked(target)).toBe(2)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(2))
            await answer('0')
            expect(shape()).toEqual([`${NEW_FOLDER}[A,U]`, 'F1[B,C]'])
        })
    })

    test('(F) one selected character is grouped into a folder of one at its own place', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await hold(target, 'Char U', 3, 2)
            await answer('0')
            expect(shape()).toEqual(['A', 'F1[B,C]', `${NEW_FOLDER}[U]`])
        })
    })

    test('(F) Move to trash from the menu hands the whole selection to the trash and writes no order itself', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            await hold(target, 'Char U', 3, 2)
            await answer('1')
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
            const acting = trashCharactersSpy.mock.calls[0][0] as { characters: { chaId: string }[], folders: unknown[] }
            expect(acting.characters.map((c) => c.chaId).sort()).toEqual(['A', 'U'])
            expect(shape()).toEqual(['A', 'F1[B,C]', 'U'])
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(G) the press that enters edit mode opens no menu and selects only the held tile', async () => {
        fixture()
        await withMounted(async (target) => {
            await hold(target, 'Char A', 3, 0)
            expect(isEditing(target)).toBe(true)
            expect(picked(target)).toBe(1)
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
    })

    test('(G) a hold that moves past the slop, is cancelled, blurs or is ended by Escape opens no menu and writes nothing', async () => {
        fixture()
        const order = DBState.db.characterOrder
        const snapshot = dbJson()
        await withMounted(async (target) => {
            await enter(target)
            const { x, y } = tileAt(3, 2)
            const press = () => {
                vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
                try {
                    firePointer('pointerdown', charTile(target, 'Char U')!, x, y)
                    vi.advanceTimersByTime(600)
                    flushSync()
                } finally {
                    vi.useRealTimers()
                }
            }
            press()
            firePointer('pointermove', window, x, y + 30)
            firePointer('pointerup', window, x, y + 30)
            await settle()

            press()
            firePointer('pointercancel', window, x, y)
            firePointer('pointerup', window, x, y)
            await settle()

            press()
            window.dispatchEvent(new Event('blur'))
            firePointer('pointerup', window, x, y)
            await settle()

            press()
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
            firePointer('pointerup', window, x, y)
            await settle()
            expect(alertSelectSpy).not.toHaveBeenCalled()
            expect(picked(target)).toBe(0)
        })
        expect(DBState.db.characterOrder).toBe(order)
        expect(dbJson()).toBe(snapshot)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('(G) a hold cancelled in edit mode leaves nothing that opens a menu for the next press, which enters edit mode', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            const { x, y } = tileAt(3, 2)
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                firePointer('pointerdown', charTile(target, 'Char U')!, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
            } finally {
                vi.useRealTimers()
            }
            firePointer('pointercancel', window, x, y)
            await settle()
            clickButton(target, language.othersUi.editDone)
            await settle()
            await hold(target, 'Char A', 3, 0)
            expect(isEditing(target)).toBe(true)
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
    })

    test('(R) a hold on a folder tile in edit mode, released in place, opens the folder menu and selects the folder', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            const { x, y } = tileAt(3, 1)
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                firePointer('pointerdown', folderTile(target, 'F1')!, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
            } finally {
                vi.useRealTimers()
            }
            firePointer('pointerup', window, x, y)
            await settle()
            expect(menus).toEqual([[
                language.renameFolder,
                language.changeFolderColor,
                language.changeFolderImage,
                language.ungroupFolder,
                language.deleteFolder,
                language.cancel,
            ]])
            expect(picked(target)).toBe(1)
        })
    })
})

describe('Grid group: right-click and the context-menu key', () => {
    test('(F) a right-click on an unselected character tile in edit mode selects it, prevents the browser menu and opens the same menu', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            const event = contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(event.defaultPrevented).toBe(true)
            expect(menus).toEqual([[GROUP, TRASH, CANCEL]])
            expect(pressed(target, 'Char U')).toBe('true')
            expect(picked(target)).toBe(2)
            await answer('0')
            expect(shape()).toEqual([`${NEW_FOLDER}[A,U]`, 'F1[B,C]'])
        })
    })

    test('(F) a context-menu event on an already selected tile keeps it selected', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char U')
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(menus).toHaveLength(1)
            expect(pressed(target, 'Char U')).toBe('true')
            expect(picked(target)).toBe(1)
        })
    })

    test('(G) outside edit mode the browser menu is left alone', async () => {
        fixture()
        await withMounted((target) => {
            const event = contextMenu(charTile(target, 'Char U')!)
            expect(event.defaultPrevented).toBe(false)
            expect(alertSelectSpy).not.toHaveBeenCalled()
        })
    })

    test('(G) on the empty scroller or while keys are blocked no menu opens', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(scrollerOf(target))
            await settle()
            expect(alertSelectSpy).not.toHaveBeenCalled()

            setLiveKeysBlockedReader(() => true)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(alertSelectSpy).not.toHaveBeenCalled()
            expect(picked(target)).toBe(0)
        })
    })

    test('(G) on a folder tile while keys are blocked no menu opens and nothing is selected', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            setLiveKeysBlockedReader(() => true)
            contextMenu(folderTile(target, 'F1')!)
            await settle()
            expect(alertSelectSpy).not.toHaveBeenCalled()
            expect(picked(target)).toBe(0)
        })
    })

    test('(G) a context menu the browser raises for a touch press never reaches the Grid listener', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            const { x, y } = tileAt(3, 2)
            firePointer('pointerdown', charTile(target, 'Char U')!, x, y)
            const event = contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(event.defaultPrevented).toBe(true)
            expect(alertSelectSpy).not.toHaveBeenCalled()
            expect(picked(target)).toBe(0)
            firePointer('pointerup', window, x, y)
        })
    })
})

describe('Grid group: the menu choice and what changes while it is open', () => {
    // A character that is in no folder row of the order has no order entry, so Group is not offered.
    function unlistedFixture(): void {
        install(
            [makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B'), makeCharacter('C', 'Char C'), makeCharacter('U', 'Char U'), makeCharacter('Z', 'Char Z')],
            ['A', makeFolder('f1', 'F1', ['B', 'C']), 'U'] as unknown as OrderFixture,
        )
    }

    test('(F) a selection with a tile that has no order entry omits Group; the first item then moves to the trash and the second cancels', async () => {
        unlistedFixture()
        await withMounted(async (target) => {
            await enter(target)
            // The unlisted character is the last tile; if the fixture lists it, the test cannot mean what it says.
            expect(tileNames(target)).toContain('Char Z')
            contextMenu(charTile(target, 'Char Z')!)
            await settle()
            expect(menus).toEqual([[TRASH, CANCEL]])
            await answer('0')
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)

            contextMenu(charTile(target, 'Char Z')!)
            await settle()
            await answer('1')
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
            expect(shape()).toEqual(['A', 'F1[B,C]', 'U'])
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) one tile without an order entry among valid picks still omits Group, in the menu and on the row button', async () => {
        unlistedFixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            expect(groupButton(target)!.disabled).toBe(false)
            contextMenu(charTile(target, 'Char Z')!)
            await settle()
            expect(menus).toEqual([[TRASH, CANCEL]])
            expect(groupButton(target)!.disabled).toBe(true)
        })
    })

    test('(G) an open folder picked, then a menu on one of its own members: the folder is alone, so the menu omits Group and nothing is written', async () => {
        fixture()
        const order = DBState.db.characterOrder
        await withMounted(async (target) => {
            await enter(target)
            chevron(target)!.click()
            await settle()
            await tap(target, 'F1')
            contextMenu(charTile(target, 'Char B')!)
            await settle()
            expect(picked(target)).toBe(2)
            expect(menus).toEqual([[TRASH, CANCEL]])
            await answer('2')
            expect(DBState.db.characterOrder).toBe(order)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) with Group offered, index 1 moves to the trash and index 2 cancels', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            await answer('1')
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            await answer('2')
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) the choice is read against the list the menu was opened with, even if Group became available meanwhile', async () => {
        unlistedFixture()
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char Z')!)
            await settle()
            expect(menus).toEqual([[TRASH, CANCEL]])
            // Drop the unlisted pick and pick a listed one: Group is available now, and index 0 was "Move to trash".
            await tap(target, 'Char Z')
            await tap(target, 'Char A')
            expect(groupButton(target)!.disabled).toBe(false)
            await answer('0')
            expect(shape()).toEqual(['A', 'F1[B,C]', 'U'])
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) the choice acts on the order and the picks as they are when it is made, not as they were when the menu opened', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            DBState.db.characterOrder = [makeFolder('f1', 'F1', ['B', 'C']), 'U', 'A'] as unknown as OrderFixture
            await settle()
            await answer('0')
            expect(shape()).toEqual(['F1[B,C]', `${NEW_FOLDER}[U,A]`])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) a member that became a top-level character while the menu was open is grouped from its place now', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            chevron(target)!.click()
            await settle()
            contextMenu(charTile(target, 'Char B')!)
            await settle()
            DBState.db.characterOrder = ['A', 'B', makeFolder('f1', 'F1', ['C']), 'U'] as unknown as OrderFixture
            await settle()
            await answer('0')
            expect(shape()).toEqual(['A', `${NEW_FOLDER}[B]`, 'F1[C]', 'U'])
        })
    })

    test('(F) a picked character removed while the menu is open: Group acts on the remaining picks, and with none left writes and clears nothing', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            DBState.db.characters = DBState.db.characters.filter((c) => c.chaId !== 'U')
            DBState.db.characterOrder = ['A', makeFolder('f1', 'F1', ['B', 'C'])] as unknown as OrderFixture
            await settle()
            await answer('0')
            expect(shape()).toEqual([`${NEW_FOLDER}[A]`, 'F1[B,C]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            const order = DBState.db.characterOrder
            DBState.db.characters = DBState.db.characters.filter((c) => c.chaId !== 'U')
            await settle()
            await answer('0')
            expect(DBState.db.characterOrder).toBe(order)
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) a pick whose slot now holds the other holder of its id is not grouped', async () => {
        install(
            [makeCharacter('A', 'Char A'), makeCharacter('D', 'First D'), makeCharacter('D', 'Second D')],
            ['A', 'D', 'D'] as unknown as OrderFixture,
        )
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Second D')!)
            await settle()
            const order = DBState.db.characterOrder
            DBState.db.characters.splice(1, 1)
            DBState.db.characterOrder = ['A', 'D'] as unknown as OrderFixture
            await settle()
            const before = DBState.db.characterOrder
            await answer('0')
            expect(DBState.db.characterOrder).toBe(before)
            expect(order).not.toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(G) with no saved order the choice writes nothing and does not throw', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            DBState.db.characterOrder = undefined as unknown as OrderFixture
            await settle()
            await answer('0')
            expect(DBState.db.characterOrder).toBeUndefined()
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
        })
    })

    test('(G) every way of not choosing leaves the whole database and the order untouched: Cancel, a dismissed menu, Done before the answer, a refused Group', async () => {
        fixture()
        const order = DBState.db.characterOrder
        const snapshot = dbJson()
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            await answer('2')
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            await answer('')
            // A menu that is answered after Done: nothing is selected any more.
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            clickButton(target, language.othersUi.editDone)
            await settle()
            await answer('0')
            // A lone folder is not groupable: the row button is disabled and a click does nothing.
            await enter(target)
            await tap(target, 'F1')
            expect(groupButton(target)!.disabled).toBe(true)
            groupButton(target)!.click()
            await settle()
        })
        expect(DBState.db.characterOrder).toBe(order)
        expect(dbJson()).toBe(snapshot)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
        expect(trashCharactersSpy).not.toHaveBeenCalled()
    })

    test('(G) a second request while a menu is open does not stack a second menu', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            contextMenu(charTile(target, 'Char A')!)
            await settle()
            expect(menus).toHaveLength(1)
        })
    })
})

describe('Grid group: the edit row button', () => {
    test('(F) the button exists only in edit mode, is named for Group, and keeps the row one line high beside Move to trash', async () => {
        fixture()
        await withMounted(async (target) => {
            expect(groupButton(target)).toBeNull()
            await enter(target)
            const button = groupButton(target)!
            expect(button.getAttribute('aria-label')).toBe(GROUP)
            expect(button.getAttribute('title')).toBe(GROUP)
            expect(button.textContent?.trim()).toBe('')
            expect(button.className).toContain('h-8')
            expect(button.className).toContain('shrink-0')
            const row = button.parentElement!
            expect(row.className).toContain('h-8')
            expect(row.className).not.toContain('flex-wrap')
            expect(trashButton(target)!.className).toContain('shrink-0')
            expect(trashButton(target)!.className).toContain('whitespace-nowrap')
            expect(row.querySelector('[aria-hidden="true"].truncate')).not.toBeNull()
        })
    })

    test('(F) it is disabled with nothing selected, with one folder alone and with a folder and its own member, and enabled otherwise', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            expect(groupButton(target)!.disabled).toBe(true)
            await tap(target, 'Char A')
            expect(groupButton(target)!.disabled).toBe(false)
            await tap(target, 'Char A')
            await tap(target, 'F1')
            expect(groupButton(target)!.disabled).toBe(true)
            chevron(target)!.click()
            await settle()
            await tap(target, 'Char B')
            expect(groupButton(target)!.disabled).toBe(true)
            await tap(target, 'Char A')
            expect(groupButton(target)!.disabled).toBe(false)
        })
    })

    test('(F) a click groups the selection without a menu', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            await tap(target, 'Char U')
            groupButton(target)!.click()
            await settle()
            expect(alertSelectSpy).not.toHaveBeenCalled()
            expect(shape()).toEqual([`${NEW_FOLDER}[A,U]`, 'F1[B,C]'])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) a folder tile and a character: the folder members join in member order, the old folder is gone and its tile with it', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'F1')
            await tap(target, 'Char U')
            groupButton(target)!.click()
            await settle()
            expect(shape()).toEqual(['A', `${NEW_FOLDER}[B,C,U]`])
            expect(tileNames(target)).toEqual(['Char A', NEW_FOLDER])
            expect(checkCharOrderSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) a dissolved open folder leaves the open set, and the new folder is not in it', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            chevron(target)!.click()
            await settle()
            expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY)!)).toEqual(['f1'])
            await tap(target, 'F1')
            await tap(target, 'Char U')
            groupButton(target)!.click()
            await settle()
            expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY)!)).toEqual([])
            expect(folderTile(target, NEW_FOLDER)!.getAttribute('aria-expanded')).toBe('false')
        })
    })

    test('(F) all members of an open folder plus a character: the new folder takes the character place and the old folder disappears', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            chevron(target)!.click()
            await settle()
            await tap(target, 'Char A')
            await tap(target, 'Char B')
            await tap(target, 'Char C')
            groupButton(target)!.click()
            await settle()
            expect(shape()).toEqual([`${NEW_FOLDER}[A,B,C]`, 'U'])
        })
    })

    test('(F) under search the results are flat: a member of a closed folder and a character group into the order', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            const input = target.querySelector('input')!
            input.value = 'Char'
            input.dispatchEvent(new Event('input'))
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settleFrame()
            expect(tileNames(target)).toEqual(['Char A', 'Char B', 'Char C', 'Char U'])
            await tap(target, 'Char B')
            await tap(target, 'Char U')
            groupButton(target)!.click()
            await settle()
            expect(shape()).toEqual(['A', `${NEW_FOLDER}[B,U]`, 'F1[C]'])
            // The result tiles are still on screen, so only the explicit clear empties the selection.
            expect(tileNames(target)).toEqual(['Char A', 'Char B', 'Char U', 'Char C'])
            expect(picked(target)).toBe(0)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) afterwards the rail rows and the Grid tiles show the same folder at the same place', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            await tap(target, 'Char U')
            groupButton(target)!.click()
            await settle()
            const order = DBState.db.characterOrder
            const rows = listRows(order, () => true)
            expect(rows.map((row) => row.kind === 'folder' ? `${row.entry.name}[${row.members.map((m) => m.id).join(',')}]` : row.id)).toEqual([`${NEW_FOLDER}[A,U]`, 'F1[B,C]'])
            const live = DBState.db.characters.map((c, index) => ({ index, chaId: c.chaId, key: JSON.stringify(['s', c.chaId, 0]) }))
            const tiles = buildGridEntries({ live, order, openFolderIds: new Set(), sort: 'order', searching: false })
            expect(tiles.map((tile) => tile.kind === 'folder' ? `${tile.name}:${tile.count}` : tile.key)).toEqual([`${NEW_FOLDER}:2`, 'F1:2'])
            expect(tiles[0].kind === 'folder' && tiles[0].id).toBe(rows[0].kind === 'folder' && rows[0].ref.id)
        })
    })
})

describe('Grid group: the count in the edit row', () => {
    const visibleCount = (root: ParentNode): string => root.querySelector('[aria-hidden="true"].text-textcolor2')?.textContent?.trim() ?? ''
    const rowOf = (root: ParentNode): HTMLElement => groupButton(root)!.parentElement!
    const probesOf = (root: ParentNode): HTMLElement[] => Array.from(rowOf(root).querySelectorAll<HTMLElement>('span.invisible'))
    const iconTrash = (root: ParentNode): HTMLButtonElement | null =>
        root.querySelector<HTMLButtonElement>(`button[aria-label="${language.othersUi.editMoveToTrash}"]`)
    const rect = (width: number) => () => ({ left: 0, top: 0, right: width, bottom: 0, width, height: 0, x: 0, y: 0, toJSON: () => ({}) })

    /** Reports these widths for the row, the Group button and the three invisible copies (full text, number, label). */
    function stubWidths(root: ParentNode, widths: { row: number, group: number, full: number, number: number, label: number }): void {
        const [full, number, label] = probesOf(root)
        rowOf(root).getBoundingClientRect = rect(widths.row)
        groupButton(root)!.getBoundingClientRect = rect(widths.group)
        full.getBoundingClientRect = rect(widths.full)
        number.getBoundingClientRect = rect(widths.number)
        label.getBoundingClientRect = rect(widths.label)
    }

    // German at 360 dp: row 280, Group 32, label 224, two gaps (jsdom reports a 0 gap, so the room is smaller here).
    const GERMAN = { row: 280, group: 32, full: 90, number: 17, label: 224 }

    let observed: Array<() => void>
    let disconnects: number
    function stubObserver(): void {
        observed = []
        disconnects = 0
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: () => void) {
                observed.push(callback)
            }
            observe(): void {}
            disconnect(): void {
                disconnects++
            }
        })
    }
    const resize = async (): Promise<void> => {
        observed.forEach((callback) => callback())
        await settle()
    }

    test('(F) the full text shows when it fits, the number alone when it does not, and the full text again when room returns', async () => {
        fixture()
        await withMounted(async (target) => {
            stubObserver()
            await enter(target)
            await tap(target, 'Char A')
            const full = language.othersUi.editSelectedCount(1)
            // Unmeasured: the full text and the labelled button.
            expect(visibleCount(target)).toBe(full)
            expect(iconTrash(target)).toBeNull()

            // Full text beside the label.
            stubWidths(target, { ...GERMAN, label: 100 })
            await resize()
            expect(visibleCount(target)).toBe(full)
            expect(trashButton(target)).toBeDefined()

            // Only the number beside the label.
            stubWidths(target, GERMAN)
            await resize()
            expect(visibleCount(target)).toBe('1')
            expect(trashButton(target)).toBeDefined()
            expect(iconTrash(target)).toBeNull()

            // Not even the number beside the label: the trash is an icon and the full text fits beside it.
            stubWidths(target, { ...GERMAN, label: 260 })
            await resize()
            expect(trashButton(target)).toBeUndefined()
            expect(iconTrash(target)).not.toBeNull()
            expect(visibleCount(target)).toBe(full)

            // Beside the icon only the number fits.
            stubWidths(target, { ...GERMAN, label: 260, full: 300 })
            await resize()
            expect(iconTrash(target)).not.toBeNull()
            expect(visibleCount(target)).toBe('1')

            // Room returns: the label and the full text come back.
            stubWidths(target, { ...GERMAN, label: 100 })
            await resize()
            expect(iconTrash(target)).toBeNull()
            expect(trashButton(target)).toBeDefined()
            expect(visibleCount(target)).toBe(full)
        })
    })

    test('(F) the icon trash keeps its name and tooltip, its disabled state and the trash flow, and the number is never cut short beside it', async () => {
        fixture()
        await withMounted(async (target) => {
            stubObserver()
            await enter(target)
            stubWidths(target, { ...GERMAN, label: 260, full: 300 })
            await resize()
            expect(iconTrash(target)!.disabled).toBe(true)
            expect(iconTrash(target)!.getAttribute('title')).toBe(language.othersUi.editMoveToTrash)
            await tap(target, 'Char A')
            await resize()
            const icon = iconTrash(target)!
            expect(icon.disabled).toBe(false)
            expect(icon.className).toContain('h-8')
            expect(icon.className).toContain('shrink-0')
            expect(icon.textContent?.trim()).toBe('')
            const number = target.querySelector('[aria-hidden="true"].text-textcolor2')!
            expect(number.textContent?.trim()).toBe('1')
            expect(number.className).not.toContain('truncate')
            expect(number.parentElement!.className).toContain('flex-none')
            icon.click()
            await settle()
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
            const acting = trashCharactersSpy.mock.calls[0][0] as { characters: { chaId: string }[] }
            expect(acting.characters.map((c) => c.chaId)).toEqual(['A'])
        })
    })

    test('(G) a change of form triggers no measuring: the forms do not flip back by themselves', async () => {
        fixture()
        await withMounted(async (target) => {
            stubObserver()
            await enter(target)
            await tap(target, 'Char A')
            let reads = 0
            const counting = (width: number) => () => {
                reads++
                return { left: 0, top: 0, right: width, bottom: 0, width, height: 0, x: 0, y: 0, toJSON: () => ({}) }
            }
            stubWidths(target, { ...GERMAN, label: 260 })
            const [full, number, label] = probesOf(target)
            full.getBoundingClientRect = counting(GERMAN.full)
            number.getBoundingClientRect = counting(GERMAN.number)
            label.getBoundingClientRect = counting(260)
            await resize()
            expect(iconTrash(target)).not.toBeNull()
            const afterMeasure = reads
            expect(afterMeasure).toBeGreaterThan(0)
            await settle()
            await settle()
            expect(reads).toBe(afterMeasure)
            expect(iconTrash(target)).not.toBeNull()
        })
    })

    test('(F) a changed count is measured again without a resize', async () => {
        fixture()
        await withMounted(async (target) => {
            stubObserver()
            await enter(target)
            // Widths follow the text, as a real layout would: the count probe is wide only once something is selected.
            const follow = () => {
                const [full, number, label] = probesOf(target)
                full.getBoundingClientRect = () => rect((full.textContent ?? '').startsWith('0') ? 20 : 300)()
                number.getBoundingClientRect = rect(17)
                label.getBoundingClientRect = rect(100)
                rowOf(target).getBoundingClientRect = rect(280)
                groupButton(target)!.getBoundingClientRect = rect(32)
            }
            follow()
            await resize()
            expect(visibleCount(target)).toBe(language.othersUi.editSelectedCount(0))
            await tap(target, 'Char A')
            expect(visibleCount(target)).toBe('1')
        })
    })

    test('(F) screen readers get one live element with the full count in both forms, and the visible form is hidden from them', async () => {
        fixture()
        await withMounted(async (target) => {
            stubObserver()
            await enter(target)
            await tap(target, 'Char A')
            const full = language.othersUi.editSelectedCount(1)
            for (const widths of [{ ...GERMAN, label: 100 }, GERMAN, { ...GERMAN, label: 260 }, { ...GERMAN, label: 260, full: 300 }]) {
                stubWidths(target, widths)
                await resize()
                expect(target.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
                expect(countText(target)).toBe(full)
                expect(target.querySelector('[aria-hidden="true"].text-textcolor2')).not.toBeNull()
                expect(probesOf(target).every((probe) => probe.getAttribute('aria-hidden') === 'true')).toBe(true)
            }
        })
    })

    test('(F) the observer is disconnected when edit mode ends', async () => {
        fixture()
        await withMounted(async (target) => {
            stubObserver()
            await enter(target)
            await tap(target, 'Char A')
            const before = disconnects
            clickButton(target, language.othersUi.editDone)
            await settle()
            expect(disconnects).toBeGreaterThan(before)
        })
    })
})

describe('Grid group: scrolling to the new folder', () => {
    // Twenty characters, then a closed folder F1 (Member 1, Member 2) among the last ones: My order is
    // six rows of 64 px, [F1, Char 17, Char 18, Char 19] in row 4. The view shows two rows.
    function tallFixture(): void {
        const names = Array.from({ length: 20 }, (_, i) => `Char ${String(i + 1).padStart(2, '0')}`)
        const characters = [
            ...names.map((name, i) => makeCharacter(`N${i + 1}`, name)),
            makeCharacter('M1', 'Member 1'),
            makeCharacter('M2', 'Member 2'),
        ]
        const ids = names.map((_, i) => `N${i + 1}`)
        install(characters, [...ids.slice(0, 16), makeFolder('f1', 'F1', ['M1', 'M2']), ...ids.slice(16)] as unknown as OrderFixture)
    }

    const VIEW = 128
    const CONTENT = 448

    function stubScroller(scroller: HTMLElement): { writes: number[], top: () => number } {
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
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEW })
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => CONTENT })
        scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: FOUR_COLUMNS, bottom: VIEW, width: FOUR_COLUMNS, height: VIEW, x: 0, y: 0, toJSON: () => ({}) })
        return { writes, top: () => top }
    }

    const rowTile = (count: number, n: number, row: number): { x: number, y: number } => ({ x: tileAt(count, n).x, y: row * 64 + 28 })

    /** A hold on the scroller at (x, y) on the scroller itself, so tiles outside the mounted rows are reachable. */
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

    /** Selects Char 18 (row 4) by the entering hold and opens the menu on Char 20 (row 5). */
    async function farSelection(target: HTMLElement, scroller: HTMLElement): Promise<void> {
        const first = rowTile(4, 2, 4)
        await holdAt(scroller, first.x, first.y)
        const second = rowTile(1, 0, 5)
        await holdAt(scroller, second.x, second.y)
        expect(menus).toHaveLength(1)
        expect(isEditing(target)).toBe(true)
    }

    test('(F) a new folder below the view is scrolled to once, centred', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            await farSelection(target, scroller)
            await answer('0')
            await settle()
            expect(tileNames(target)).toContain(NEW_FOLDER)
            // Row 4 spans 256..320; centred in a 128 px view: 256 + 32 - 64.
            expect(stub.top()).toBe(224)
            expect(stub.writes.filter((value) => value !== 0)).toEqual([224])
        })
    })

    test('(G) a new folder already fully in view does not scroll', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            // Row 1 spans 64..128, fully inside the 128 px view; centring it would write 32.
            const first = rowTile(4, 1, 1)
            await holdAt(scroller, first.x, first.y)
            const second = rowTile(4, 2, 1)
            await holdAt(scroller, second.x, second.y)
            expect(menus).toHaveLength(1)
            await answer('0')
            await settle()
            expect(tileNames(target)).toContain(NEW_FOLDER)
            expect(stub.top()).toBe(0)
            expect(stub.writes.every((value) => value === 0)).toBe(true)
        })
    })

    test('(G) a cancelled or refused Group does not scroll', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            await farSelection(target, scroller)
            await answer('2')
            await settle()
            expect(stub.writes.every((value) => value === 0)).toBe(true)
        })
    })

    test('(G) Done before the scroll runs cancels it', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            await farSelection(target, scroller)
            const before = DBState.db.characterOrder
            answerOpenMenu!('0')
            answerOpenMenu = null
            for (let i = 0; i < 10 && DBState.db.characterOrder === before; i++) {
                await Promise.resolve()
            }
            expect(DBState.db.characterOrder).not.toBe(before)
            clickButton(target, language.othersUi.editDone)
            await settle()
            expect(stub.writes.every((value) => value === 0)).toBe(true)
        })
    })

    test('(G) leaving and re-entering edit mode before the scroll runs also cancels it', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            await farSelection(target, scroller)
            const before = DBState.db.characterOrder
            answerOpenMenu!('0')
            answerOpenMenu = null
            for (let i = 0; i < 10 && DBState.db.characterOrder === before; i++) {
                await Promise.resolve()
            }
            expect(DBState.db.characterOrder).not.toBe(before)
            clickButton(target, language.othersUi.editDone)
            clickButton(target, language.othersUi.editMode)
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(stub.writes.every((value) => value === 0)).toBe(true)
        })
    })

    test('(G) under search there is no folder tile to scroll to, so nothing scrolls', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            await enter(target)
            const input = target.querySelector('input')!
            input.value = 'Member'
            input.dispatchEvent(new Event('input'))
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settleFrame()
            expect(tileNames(target)).toEqual(['Member 1', 'Member 2'])
            await tap(target, 'Member 1')
            await tap(target, 'Member 2')
            groupButton(target)!.click()
            await settle()
            expect(DBState.db.characterOrder.some((entry) => typeof entry === 'object' && entry.name === NEW_FOLDER)).toBe(true)
            expect(stub.writes.every((value) => value === 0)).toBe(true)
        })
    })
})
