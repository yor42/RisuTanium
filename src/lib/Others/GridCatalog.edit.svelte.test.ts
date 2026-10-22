// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Grid tab: edit mode. A floating button (or a touch long press on a tile)
 * enters it, a tap selects instead of opening, a folder tile has a corner chevron for opening and
 * closing, a count bar offers the bulk move to the trash, and every way out clears the selection.
 * Edit mode only works under My order. The screen writes only through the bulk trash, the group and the drag drop (the drag drop is tested in `GridCatalog.drag.svelte.test.ts`); the bulk trash is
 * `trashCharacters` (tested against the real save machinery in `characters.trashCharacters.test.ts`);
 * here it is a spy that records what it was handed.
 *
 * Fixture: characters A, B, C, U; the order is `A, folder F1 (B, C), U`, so the closed Grid shows the
 * tiles `Char A`, `F1`, `Char U`. Four columns (a 312 px container) with 56 px tiles and 8 px gaps put
 * a row of three tiles at x = 64 + 64 * n, so a press is placed from that arithmetic, written out by hand.
 *
 * Test labels: `(F)` is a feature test of the new behaviour (edit mode does not exist on the earlier
 * base, so a failure there is a setup failure and proves nothing); the safety-critical ones are backed
 * by mutation proofs of the component recorded in the stage report. `(G)` is a guard that may pass
 * before and after.
 *
 * MOCKED: the module set of `GridCatalog.folders.svelte.test.ts` (same directory), with `changeChar`,
 * `removeChar` and `trashCharacters` bare spies. Geometry is faked as there: the container's width is a
 * mutable value every element reports. Pointer events are synthetic and the long press runs on fake
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

const { changeCharSpy, removeCharSpy, trashCharactersSpy, checkCharOrderSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    trashCharactersSpy: vi.fn(),
    checkCharOrderSpy: vi.fn(),
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

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

import { alertStore, DBState } from '../../ts/stores.svelte'
import type { alertData } from '../../ts/alert'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { promptWaiting, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { language } from '../../lang'
import { setLiveKeysBlockedReader } from '../../ts/keyEventBlocked'
import { GRID_SORT_KEY } from './gridMemory'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type OrderFixture = Database['characterOrder']

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
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

/** A, folder F1 (B, C), U: the closed Grid shows `Char A`, `F1`, `Char U`. */
function fixture(): void {
    install(
        [makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B'), makeCharacter('C', 'Char C'), makeCharacter('U', 'Char U')],
        ['A', makeFolder('f1', 'F1', ['B', 'C']), 'U'] as unknown as OrderFixture,
    )
}

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

const editButton = (root: ParentNode): HTMLButtonElement | undefined =>
    buttonByText(root, language.othersUi.editMode) ?? buttonByText(root, language.othersUi.editDone)
const isEditing = (root: ParentNode): boolean => buttonByText(root, language.othersUi.editDone) !== undefined
const countBar = (root: ParentNode): HTMLElement | null => root.querySelector('[aria-live="polite"]')?.parentElement ?? null
const countText = (root: ParentNode): string => root.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? ''
const trashButton = (root: ParentNode): HTMLButtonElement | null => buttonByText(countBar(root) ?? root, language.othersUi.editMoveToTrash) ?? null
const picked = (root: ParentNode): number => root.querySelectorAll('[data-charlist-picked]').length

const charTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`[data-charlist-key] button[aria-label="${name}"]`)
const folderTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-expanded][aria-label="${name}"]`)
const chevron = (root: ParentNode): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${language.othersUi.editFolderToggle}"]`)
const tileNames = (root: ParentNode): string[] =>
    Array.from(root.querySelectorAll('[data-charlist-key]')).map((card) => card.querySelector('button')?.getAttribute('aria-label') ?? '')
const scrollerOf = (root: ParentNode): HTMLElement => root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')!

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

function pressKey(target: EventTarget, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
}

/** A pointer event with the fields the gesture machine reads. */
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

const dbJson = (): string => JSON.stringify(DBState.db)

const FOUR_COLUMNS = 312
let containerWidth = FOUR_COLUMNS
let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    checkCharOrderSpy.mockClear()
    endGridSpy.mockClear()
    trashCharactersSpy.mockReset()
    trashCharactersSpy.mockImplementation(async () => 0)
    containerWidth = FOUR_COLUMNS
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => containerWidth })
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    // A hold in edit mode opens a menu that nothing answers here; it must not cover the page for the next test.
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
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

describe('Grid edit mode: entering and leaving', () => {
    test('(F) the floating Edit button enters edit mode and reads Done; Done leaves it and clears the selection', async () => {
        fixture()
        await withMounted(async (target) => {
            expect(editButton(target)!.textContent?.trim()).toBe(language.othersUi.editMode)
            expect(countBar(target)).toBeNull()
            await enter(target)
            expect(isEditing(target)).toBe(true)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
            await tap(target, 'Char A')
            expect(picked(target)).toBe(1)

            clickButton(target, language.othersUi.editDone)
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(countBar(target)).toBeNull()
            expect(picked(target)).toBe(0)
            await enter(target)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) the button is a Grid-tab control: other tabs do not show it', async () => {
        fixture()
        await withMounted(async (target) => {
            clickButton(target, language.list)
            await settle()
            expect(editButton(target)).toBeUndefined()
            clickButton(target, language.grid)
            await settle()
            expect(editButton(target)).toBeDefined()
        })
    })

    test('(F) Escape leaves edit mode and clears the selection', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            pressKey(document.body, 'Escape')
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(picked(target)).toBe(0)
            await enter(target)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) Escape does nothing while an alert covers the page, and nothing from a text field', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')

            setLiveKeysBlockedReader(() => true)
            pressKey(document.body, 'Escape')
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(picked(target)).toBe(1)

            setLiveKeysBlockedReader(() => false)
            pressKey(target.querySelector('input')!, 'Escape')
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(picked(target)).toBe(1)

            pressKey(document.body, 'Enter')
            await settle()
            expect(isEditing(target)).toBe(true)
        })
    })

    test('(F) Back while editing exits edit mode and clears the selection', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            expect(picked(target)).toBe(1)

            expect(window.__risuTaniumBack?.()).toBe(true)
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(picked(target)).toBe(0)
            await enter(target)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) Back is not handled outside edit mode and after Done, so it falls to the quit guard', async () => {
        fixture()
        await withMounted(async (target) => {
            expect(dispatchBack()).toBe(false)
            await enter(target)
            clickButton(target, language.othersUi.editDone)
            await settle()
            expect(dispatchBack()).toBe(false)
        })
    })

    test('(F) Back does not leave edit mode while a dialog covers the page', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            alertStore.set({ type: 'normal', msg: 'hello' } as alertData)
            expect(dispatchBack()).toBe(false)
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(picked(target)).toBe(1)
            alertStore.set({ type: 'none', msg: '' })
        })
    })

    test('(F) Back leaves edit mode while a toast is up', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            alertStore.set({ type: 'toast', msg: 'Press Back again to quit' } as alertData)
            expect(dispatchBack()).toBe(true)
            await settle()
            expect(isEditing(target)).toBe(false)
            alertStore.set({ type: 'none', msg: '' })
        })
    })

    test('(F) closing the screen while editing unregisters the Back handler', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
        })
        expect(dispatchBack()).toBe(false)
    })

    test('(F) a tab switch leaves edit mode and clears the selection; the same tab does not', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            clickButton(target, language.grid)
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(picked(target)).toBe(1)

            clickButton(target, language.list)
            await settle()
            clickButton(target, language.grid)
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(picked(target)).toBe(0)
            await enter(target)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) closing the screen leaves nothing behind: a new mount is not editing and selects nothing', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
        })
        await withMounted(async (target) => {
            expect(isEditing(target)).toBe(false)
            expect(picked(target)).toBe(0)
            await enter(target)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
        // The Escape listener went with the screen.
        expect(() => pressKey(document.body, 'Escape')).not.toThrow()
    })
})

describe('Grid edit mode: My order only', () => {
    const select = (root: ParentNode): HTMLSelectElement => root.querySelector('select')!

    async function choose(root: ParentNode, value: string): Promise<void> {
        select(root).value = value
        select(root).dispatchEvent(new Event('change', { bubbles: true }))
        await settleFrame()
    }

    test('(F) Edit under Recent or Name switches to My order, remembered on this device, and then enters', async () => {
        fixture()
        for (const sort of ['recent', 'name']) {
            await withMounted(async (target) => {
                await choose(target, sort)
                expect(select(target).value).toBe(sort)
                await enter(target)
                expect(isEditing(target)).toBe(true)
                expect(target.querySelector('select')).toBeNull()
                expect(localStorage.getItem(GRID_SORT_KEY)).toBe('order')
                expect(folderTile(target, 'F1')).not.toBeNull()
                clickButton(target, language.othersUi.editDone)
                await settle()
                expect(select(target).value).toBe('order')
            })
        }
    })

    test('(F) the sort select is not offered while editing, and comes back on Done with the selection cleared', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            expect(target.querySelector('select')).toBeNull()
            expect(picked(target)).toBe(1)

            clickButton(target, language.othersUi.editDone)
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(picked(target)).toBe(0)
            expect(select(target).value).toBe('order')
        })
    })
})

describe('Grid edit mode: the header row keeps one height', () => {
    // The Sort select and the count row share one wrapper of a fixed height, so entering or leaving
    // edit mode moves no tile. The wrapper is found from the control it holds in each mode.
    const sortRow = (root: ParentNode): HTMLElement | null => root.querySelector('select')?.closest('label')?.parentElement ?? null
    const editRow = (root: ParentNode): HTMLElement | null => countBar(root)

    test('(F) edit mode shows the count and Move to trash in place of the Sort select, and Done restores the select', async () => {
        fixture()
        await withMounted(async (target) => {
            expect(target.querySelector('select')).not.toBeNull()
            expect(countBar(target)).toBeNull()
            await enter(target)
            expect(target.querySelector('select')).toBeNull()
            expect(target.textContent).not.toContain(language.othersUi.sortLabel)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
            expect(trashButton(target)!.textContent?.trim()).toBe(language.othersUi.editMoveToTrash)
            clickButton(target, language.othersUi.editDone)
            await settle()
            expect(target.querySelector('select')).not.toBeNull()
            expect(countBar(target)).toBeNull()
        })
    })

    test('(F) both modes sit in the same wrapper element with one fixed height and no text selection', async () => {
        fixture()
        await withMounted(async (target) => {
            const normal = sortRow(target)
            expect(normal).not.toBeNull()
            await enter(target)
            const editing = editRow(target)
            expect(editing).not.toBeNull()
            expect(editing).toBe(normal)
            for (const row of [normal!, editing!]) {
                const classes = (row.getAttribute('class') ?? '').split(/\s+/)
                expect(classes).toContain('h-8')
                expect(classes).toContain('select-none')
                expect(classes).toContain('[-webkit-touch-callout:none]')
            }
        })
    })
})

describe('Grid edit mode: selecting', () => {
    test('(F) a tap selects instead of opening, a second tap deselects, and the tile says so', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGridSpy).not.toHaveBeenCalled()
            expect(charTile(target, 'Char A')!.getAttribute('aria-pressed')).toBe('true')
            expect(charTile(target, 'Char U')!.getAttribute('aria-pressed')).toBe('false')
            expect(folderTile(target, 'F1')!.getAttribute('aria-pressed')).toBe('false')
            expect(picked(target)).toBe(1)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))

            await tap(target, 'Char A')
            expect(charTile(target, 'Char A')!.getAttribute('aria-pressed')).toBe('false')
            expect(picked(target)).toBe(0)
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) outside edit mode a tap still opens the character and leaves the screen, and tiles carry no pressed state', async () => {
        fixture()
        await withMounted(async (target) => {
            expect(charTile(target, 'Char A')!.hasAttribute('aria-pressed')).toBe(false)
            expect(folderTile(target, 'F1')!.hasAttribute('aria-pressed')).toBe(false)
            await tap(target, 'Char A')
            expect(changeCharSpy).toHaveBeenCalledTimes(1)
            expect(changeCharSpy).toHaveBeenCalledWith(0)
            expect(endGridSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) a folder tile is selected by a tap on the tile and opened by its corner chevron, which does not select it', async () => {
        fixture()
        await withMounted(async (target) => {
            expect(chevron(target)).toBeNull()
            await enter(target)
            expect(chevron(target)).not.toBeNull()

            await tap(target, 'F1')
            expect(folderTile(target, 'F1')!.getAttribute('aria-pressed')).toBe('true')
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('false')
            expect(picked(target)).toBe(1)

            await tap(target, 'F1')
            expect(picked(target)).toBe(0)

            chevron(target)!.click()
            await settle()
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('true')
            expect(picked(target)).toBe(0)
            expect(tileNames(target)).toEqual(['Char A', 'F1', 'Char B', 'Char C', 'Char U'])
            chevron(target)!.click()
            await settle()
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('false')
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) a normal-mode tap on a folder tile still opens it', async () => {
        fixture()
        await withMounted(async (target) => {
            await tap(target, 'F1')
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('true')
            expect(picked(target)).toBe(0)
        })
    })

    test('(F) a selected member leaves the selection when its folder closes, because its tile is gone', async () => {
        fixture()
        await withMounted(async (target) => {
            await tap(target, 'F1')
            await enter(target)
            await tap(target, 'Char B')
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))
            chevron(target)!.click()
            await settle()
            expect(tileNames(target)).toEqual(['Char A', 'F1', 'Char U'])
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) selecting works while searching', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            const input = target.querySelector('input')!
            input.value = 'Char B'
            input.dispatchEvent(new Event('input'))
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settleFrame()
            expect(tileNames(target)).toEqual(['Char B'])
            await tap(target, 'Char B')
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) a pick whose slot now holds another character leaves the selection instead of re-pointing at it', async () => {
        install(
            [makeCharacter('A', 'First holder'), makeCharacter('A', 'Second holder'), makeCharacter('U', 'Char U')],
            ['A', 'A', 'U'] as unknown as OrderFixture,
        )
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'First holder')
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))

            // Deleting the first holder makes the second one the first holder of that id.
            DBState.db.characters.splice(0, 1)
            await settle()
            expect(tileNames(target)).toContain('Second holder')
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
            expect(charTile(target, 'Second holder')!.getAttribute('aria-pressed')).toBe('false')
            expect(trashButton(target)!.disabled).toBe(true)
        })
    })

    test('(F) the pick overlay is painted over the tile\'s own box and takes no clicks (absolutely positioned, pointer-events-none)', async () => {
        fixture()
        await withMounted(async (target) => {
            const before = scrollerOf(target).getAttribute('data-charlist-total')
            await enter(target)
            await tap(target, 'Char A')
            await tap(target, 'F1')
            const marks = Array.from(target.querySelectorAll('[data-charlist-picked]'))
            expect(marks).toHaveLength(2)
            for (const mark of marks) {
                expect(mark.className).toContain('absolute')
                expect(mark.className).toContain('inset-0')
                expect(mark.className).toContain('pointer-events-none')
            }
            expect(scrollerOf(target).getAttribute('data-charlist-total')).toBe(before)
        })
    })
})

describe('Grid edit mode: the bulk move to the trash', () => {
    test('(F) the count bar shows the count, and Trash is disabled at zero', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            expect(trashButton(target)!.disabled).toBe(true)
            expect(trashButton(target)!.textContent?.trim()).toBe(language.othersUi.editMoveToTrash)
            await tap(target, 'Char A')
            await tap(target, 'F1')
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(2))
            expect(trashButton(target)!.disabled).toBe(false)
            trashButton(target)!.click()
            await settle()
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
        })
        trashCharactersSpy.mockClear()
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            trashButton(target)!.click()
            await settle()
            expect(trashCharactersSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) the action receives the picked character and folder objects themselves, each resolved from the selection', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            await tap(target, 'F1')
            await tap(target, 'Char U')
            trashButton(target)!.click()
            await settle()
            const handed = trashCharactersSpy.mock.calls[0][0] as { characters: unknown[], folders: unknown[] }
            expect(handed.characters).toHaveLength(2)
            expect(handed.characters[0]).toBe(DBState.db.characters[0])
            expect(handed.characters[1]).toBe(DBState.db.characters[3])
            expect(handed.folders).toHaveLength(1)
            expect(handed.folders[0]).toBe(DBState.db.characterOrder[1])
        })
    })

    test('(F) after a trash the selection is cleared and edit mode stays; a declined or empty result keeps the selection', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            trashCharactersSpy.mockImplementation(async () => 0)
            trashButton(target)!.click()
            await settle()
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))

            trashCharactersSpy.mockImplementation(async () => 1)
            trashButton(target)!.click()
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
            expect(picked(target)).toBe(0)
        })
    })

    test('(F) a second press while the first confirmation is open does not start another', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            let release: (count: number) => void = () => {}
            trashCharactersSpy.mockImplementation(() => new Promise<number>((resolve) => { release = resolve }))
            trashButton(target)!.click()
            await settle()
            expect(trashButton(target)!.disabled).toBe(true)
            trashButton(target)!.click()
            await settle()
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
            release(0)
            await settle()
            expect(trashButton(target)!.disabled).toBe(false)
        })
    })

    test('(F) a character removed before the press is not handed over, and with nothing left nothing is asked', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            DBState.db.characters.splice(0, 1)
            DBState.db.characterOrder.splice(0, 1)
            await settle()
            trashButton(target)!.click()
            await settle()
            expect(trashCharactersSpy).not.toHaveBeenCalled()
        })
    })
})

describe('Grid edit mode: long press', () => {
    test('(F) a touch long press on a tile enters edit mode with that tile selected, and the release does not open it', async () => {
        fixture()
        await withMounted(async (target) => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            const vibrate = vi.fn()
            Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
            const { x, y } = tileAt(3, 0)
            try {
                firePointer('pointerdown', charTile(target, 'Char A')!, x, y)
                vi.advanceTimersByTime(499)
                flushSync()
                expect(isEditing(target)).toBe(false)
                vi.advanceTimersByTime(2)
                flushSync()
            } finally {
                vi.useRealTimers()
            }
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(charTile(target, 'Char A')!.getAttribute('aria-pressed')).toBe('true')
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))
            expect(vibrate).toHaveBeenCalledWith(15)

            firePointer('pointerup', window, x, y)
            charTile(target, 'Char A')!.click()
            await settle()
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGridSpy).not.toHaveBeenCalled()
            expect(picked(target)).toBe(1)
            // The one click after the hold is swallowed; the next tap toggles as usual.
            await tap(target, 'Char A')
            expect(picked(target)).toBe(0)
        })
    })

    test('(F) a touch long press on a folder tile enters edit mode with the folder selected and does not open it', async () => {
        fixture()
        await withMounted(async (target) => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            const { x, y } = tileAt(3, 1)
            try {
                firePointer('pointerdown', folderTile(target, 'F1')!, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
            } finally {
                vi.useRealTimers()
            }
            await settle()
            firePointer('pointerup', window, x, y)
            folderTile(target, 'F1')!.click()
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(folderTile(target, 'F1')!.getAttribute('aria-pressed')).toBe('true')
            expect(folderTile(target, 'F1')!.getAttribute('aria-expanded')).toBe('false')
        })
    })

    async function holdUnderRecent(target: HTMLElement, name: string, column: number): Promise<void> {
        // Recent lists the live characters flat (A, B, C, U with equal interactions: by name).
        expect(tileNames(target)).toEqual(['Char A', 'Char B', 'Char C', 'Char U'])
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const { x, y } = tileAt(4, column)
        try {
            firePointer('pointerdown', charTile(target, name)!, x, y)
            vi.advanceTimersByTime(600)
            flushSync()
        } finally {
            vi.useRealTimers()
        }
        await settle()
        firePointer('pointerup', window, x, y)
        await settle()
    }

    test('(F) a long press under Recent switches to My order and enters with the held tile selected', async () => {
        fixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            await holdUnderRecent(target, 'Char U', 3)
            expect(isEditing(target)).toBe(true)
            expect(localStorage.getItem(GRID_SORT_KEY)).toBe('order')
            expect(tileNames(target)).toEqual(['Char A', 'F1', 'Char U'])
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(1))
            expect(charTile(target, 'Char U')!.getAttribute('aria-pressed')).toBe('true')
        })
    })

    test('(F) a long press under Recent on a member of a closed folder enters My order with nothing selected, because that tile is not shown there', async () => {
        fixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            await holdUnderRecent(target, 'Char B', 1)
            expect(isEditing(target)).toBe(true)
            expect(tileNames(target)).toEqual(['Char A', 'F1', 'Char U'])
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
        })
    })

    test('(F) a tap, a move past the slop and a mouse hold do not enter edit mode', async () => {
        fixture()
        await withMounted(async (target) => {
            const { x, y } = tileAt(3, 0)

            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                firePointer('pointerdown', charTile(target, 'Char A')!, x, y)
                vi.advanceTimersByTime(300)
                firePointer('pointerup', window, x, y)
                vi.advanceTimersByTime(600)

                firePointer('pointerdown', charTile(target, 'Char A')!, x, y)
                vi.advanceTimersByTime(100)
                firePointer('pointermove', window, x, y + 20)
                vi.advanceTimersByTime(600)
                firePointer('pointerup', window, x, y + 20)

                firePointer('pointerdown', charTile(target, 'Char A')!, x, y, 'mouse')
                vi.advanceTimersByTime(1500)
                flushSync()
                firePointer('pointerup', window, x, y, 'mouse')
            } finally {
                vi.useRealTimers()
            }
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(picked(target)).toBe(0)

            // The mouse hold left no suppressed click: the click opens the character.
            charTile(target, 'Char A')!.click()
            await settle()
            expect(changeCharSpy).toHaveBeenCalledTimes(1)

            // A mouse that moves past its drag threshold never lifts, so it enters nothing either.
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                firePointer('pointerdown', charTile(target, 'Char A')!, x, y, 'mouse')
                firePointer('pointermove', window, x + 20, y, 'mouse')
                vi.advanceTimersByTime(1500)
                firePointer('pointerup', window, x + 20, y, 'mouse')
            } finally {
                vi.useRealTimers()
            }
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(picked(target)).toBe(0)
        })
    })

    test('(F) a long press in edit mode selects the held tile and offers the menu, keeping the earlier pick', async () => {
        fixture()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            // Char U is not selected: the hold selects it and opens the menu (covered in the group suite).
            const { x, y } = tileAt(3, 2)
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                firePointer('pointerdown', charTile(target, 'Char U')!, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
            } finally {
                vi.useRealTimers()
            }
            firePointer('pointerup', window, x, y)
            await settle()
            expect(isEditing(target)).toBe(true)
            expect(picked(target)).toBe(2)
            expect(charTile(target, 'Char U')!.getAttribute('aria-pressed')).toBe('true')
            expect(promptWaiting()).toBe(true)
        })
    })

    test('(F) the Grid scroller keeps vertical panning and turns the callout and text selection off', async () => {
        fixture()
        await withMounted((target) => {
            const classes = scrollerOf(target).getAttribute('class') ?? ''
            expect(classes).toContain('[touch-action:pan-y]')
            expect(classes).toContain('[-webkit-touch-callout:none]')
            expect(classes).toContain('select-none')
        })
    })
})

describe('Grid edit mode: where a long press leaves the scroll', () => {
    // Twenty characters, then a closed folder F1 (Member 1, Member 2) among the last ones. At four
    // columns and the 64 px fallback row height, My order is six rows: Char 01..16 in rows 0..3,
    // [F1, Char 17, Char 18, Char 19] in row 4 (offset 256) and [Char 20] in row 5. Recent lists the
    // 22 live characters flat, four per row, so Char 18 sits in row 4 and Member 1 in row 5.
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

    /** Element geometry the scroller reports in a real layout: happy-dom reports zeros. */
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

    /** The centre of tile `n` of a row of `count` tiles in row `row`, at scroll position 0. */
    const rowTile = (count: number, n: number, row: number): { x: number, y: number } => ({ x: tileAt(count, n).x, y: row * 64 + 28 })

    /** Fake timers stay installed for the whole body: a suppression window that expired is visible. */
    async function underFakeTimers(body: () => Promise<void>): Promise<void> {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            await body()
        } finally {
            vi.useRealTimers()
        }
    }

    test('(F) the scroll stub reads back what is written and the viewport it reports', async () => {
        tallFixture()
        await withMounted((target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            scroller.scrollTop = 100
            expect(scroller.scrollTop).toBe(100)
            expect(stub.top()).toBe(100)
            expect(scroller.clientHeight).toBe(VIEW)
            expect(scroller.scrollHeight - scroller.clientHeight).toBe(CONTENT - VIEW)
            expect(scroller.getBoundingClientRect().height).toBe(VIEW)
            expect(scrollerOf(target).getAttribute('data-charlist-total')).toBe(String(6 * 64))
        })
    })

    test('(R) a long press under Recent on a lower-row tile scrolls My order so its row is centred, and the tile stays selected', async () => {
        tallFixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            const { x, y } = rowTile(4, 1, 4)
            await underFakeTimers(async () => {
                firePointer('pointerdown', scroller, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
                await settle()
                firePointer('pointerup', window, x, y)
                await settle()
            })
            expect(isEditing(target)).toBe(true)
            expect(localStorage.getItem(GRID_SORT_KEY)).toBe('order')
            expect(charTile(target, 'Char 18')!.getAttribute('aria-pressed')).toBe('true')
            // Row 4 spans 256..320; centred in a 128 px view: 256 + 32 - 64.
            expect(stub.top()).toBe(224)
            // A synchronous flush after the write keeps the position.
            flushSync()
            expect(stub.top()).toBe(224)
            expect(charTile(target, 'Char 18')!.getAttribute('aria-pressed')).toBe('true')
        })
    })

    test('(R) a long press under Recent on a member of a closed folder centres the folder row, selects nothing and swallows the release click', async () => {
        tallFixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            const { x, y } = rowTile(2, 0, 5)
            let click: MouseEvent | null = null
            await underFakeTimers(async () => {
                firePointer('pointerdown', scroller, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
                await settle()
                // The finger stays down well past the click suppression window of a cancelled press.
                vi.advanceTimersByTime(1200)
                firePointer('pointerup', window, x, y)
                click = new MouseEvent('click', { bubbles: true, cancelable: true })
                scroller.dispatchEvent(click)
                await settle()
            })
            expect(isEditing(target)).toBe(true)
            expect(tileNames(target).slice(-4)).toEqual(['Char 17', 'Char 18', 'Char 19', 'Char 20'])
            expect(stub.top()).toBe(224)
            expect(picked(target)).toBe(0)
            expect(countText(target)).toBe(language.othersUi.editSelectedCount(0))
            expect(click!.defaultPrevented).toBe(true)
        })
    })

    test('(G) a held tile whose row is already in view does not scroll', async () => {
        tallFixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            const { x, y } = rowTile(4, 1, 1)
            await underFakeTimers(async () => {
                firePointer('pointerdown', scroller, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
                await settle()
                firePointer('pointerup', window, x, y)
                await settle()
            })
            expect(isEditing(target)).toBe(true)
            expect(charTile(target, 'Char 06')!.getAttribute('aria-pressed')).toBe('true')
            // Only the window's own reset to the top writes; centring row 1 would have written 32.
            expect(stub.top()).toBe(0)
            expect(stub.writes.every((value) => value === 0)).toBe(true)
        })
    })

    test('(G) a long press under My order does not scroll, even on a tile far below the view', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            // Row 4 lies outside the 128 px view: only a scroll made without a sort switch would write.
            const { x, y } = rowTile(4, 1, 4)
            await underFakeTimers(async () => {
                firePointer('pointerdown', scroller, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
                await settle()
                firePointer('pointerup', window, x, y)
                await settle()
            })
            expect(isEditing(target)).toBe(true)
            expect(charTile(target, 'Char 17')!.getAttribute('aria-pressed')).toBe('true')
            expect(stub.top()).toBe(0)
            expect(stub.writes).toEqual([])
        })
    })

    test('(G) leaving and re-entering edit mode before the scroll continuation runs cancels that scroll', async () => {
        tallFixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            const { x, y } = rowTile(4, 1, 4)
            await underFakeTimers(async () => {
                firePointer('pointerdown', scroller, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
                // The continuation of the hold is still waiting for the layout; Done and Edit overtake it.
                clickButton(target, language.othersUi.editDone)
                clickButton(target, language.othersUi.editMode)
                await settle()
                firePointer('pointerup', window, x, y)
                await settle()
            })
            expect(isEditing(target)).toBe(true)
            expect(stub.top()).toBe(0)
            expect(stub.writes.every((value) => value === 0)).toBe(true)
        })
    })

    test('(G) after a hold that entered edit mode, the next press whose tile vanishes is cancelled again', async () => {
        tallFixture()
        localStorage.setItem(GRID_SORT_KEY, 'recent')
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            stubScroller(scroller)
            await underFakeTimers(async () => {
                // First gesture: a hold on a member of a closed folder, kept down past its suppression window.
                const member = rowTile(2, 0, 5)
                firePointer('pointerdown', scroller, member.x, member.y)
                vi.advanceTimersByTime(600)
                flushSync()
                await settle()
                firePointer('pointerup', window, member.x, member.y)
                await settle()
                expect(isEditing(target)).toBe(true)
                clickButton(target, language.othersUi.editDone)
                await settle()
                expect(isEditing(target)).toBe(false)

                // Second gesture, at scroll position 224: Char 18 is pressed and removed before the hold completes.
                const { x } = tileAt(4, 2)
                const y = 4 * 64 + 28 - 224
                firePointer('pointerdown', scroller, x, y)
                vi.advanceTimersByTime(300)
                const order = DBState.db.characterOrder as unknown as Array<string | folder>
                order.splice(order.indexOf('N18'), 1)
                DBState.db.characters.splice(17, 1)
                await settle()
                vi.advanceTimersByTime(300)
                flushSync()
                firePointer('pointerup', window, x, y)
                await settle()
            })
            expect(isEditing(target)).toBe(false)
            // A cancelled press arms no click suppression, so the next tap opens its character.
            charTile(target, 'Char 02')!.click()
            await settle()
            expect(changeCharSpy).toHaveBeenCalledTimes(1)
        })
    })

    test('(R) a finger held in the bottom edge band of the Grid never scrolls it', async () => {
        tallFixture()
        await withMounted(async (target) => {
            const scroller = scrollerOf(target)
            const stub = stubScroller(scroller)
            const frames: Array<(time: number) => void> = []
            const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
            // Row 1 spans 64..120 as a tile; 114 lies inside the bottom band of the 128 px view.
            const { x } = rowTile(4, 0, 1)
            const y = 114
            try {
                await underFakeTimers(async () => {
                    firePointer('pointerdown', scroller, x, y)
                    vi.advanceTimersByTime(600)
                    flushSync()
                    await settle()
                    for (let i = 1; i <= 12; i++) {
                        for (const run of frames.splice(0)) {
                            run(i * 16)
                        }
                        await settle()
                    }
                    firePointer('pointerup', window, x, y)
                    await settle()
                })
            } finally {
                requestFrame.mockRestore()
            }
            expect(isEditing(target)).toBe(true)
            expect(stub.top()).toBe(0)
            expect(stub.writes).toEqual([])
        })
    })
})

describe('Grid edit mode: the screen only writes through the bulk trash, the group and the drag drop', () => {
    test('(G) entering, selecting, toggling a folder, leaving, a sort switch and a declined trash change nothing in the database and call no checkCharOrder', async () => {
        fixture()
        const characters = DBState.db.characters
        const order = DBState.db.characterOrder
        const snapshot = dbJson()
        await withMounted(async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            await tap(target, 'F1')
            chevron(target)!.click()
            await settle()
            await tap(target, 'Char B')
            trashCharactersSpy.mockImplementation(async () => 0)
            trashButton(target)!.click()
            await settle()
            // Sorting is offered only outside edit mode; Edit then returns to My order.
            clickButton(target, language.othersUi.editDone)
            await settle()
            const sortSelect = target.querySelector('select')!
            sortSelect.value = 'recent'
            sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
            await settleFrame()
            expect(isEditing(target)).toBe(false)
            expect(sortSelect.value).toBe('recent')
            await enter(target)
            expect(target.querySelector('select')).toBeNull()
            clickButton(target, language.othersUi.editDone)
            await settle()
            expect(target.querySelector('select')!.value).toBe('order')
            await enter(target)
            pressKey(document.body, 'Escape')
            await settle()
        })
        expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
        expect(DBState.db.characters).toBe(characters)
        expect(DBState.db.characterOrder).toBe(order)
        expect(dbJson()).toBe(snapshot)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })

    test('(G) a long press that enters edit mode writes nothing', async () => {
        fixture()
        const order = DBState.db.characterOrder
        const snapshot = dbJson()
        await withMounted(async (target) => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            const { x, y } = tileAt(3, 0)
            try {
                firePointer('pointerdown', charTile(target, 'Char A')!, x, y)
                vi.advanceTimersByTime(600)
                flushSync()
            } finally {
                vi.useRealTimers()
            }
            firePointer('pointerup', window, x, y)
            await settle()
            expect(isEditing(target)).toBe(true)
        })
        expect(DBState.db.characterOrder).toBe(order)
        expect(dbJson()).toBe(snapshot)
        expect(checkCharOrderSpy).not.toHaveBeenCalled()
    })
})
