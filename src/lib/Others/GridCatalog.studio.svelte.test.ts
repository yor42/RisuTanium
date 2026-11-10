// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`, Open in Studio from the Home library (stage G2). The optional `studio` prop is
 * what the Home library passes; without it no Studio control exists (the App-level grid host). Controls:
 * the List tab's icon button beside each row's trash button (T14), and, in the Grid tab under My order in
 * edit mode, the first item of the tile menu when exactly one available character is picked (T16, T16b).
 * The Simple tab's controls are tested in `CharacterSimpleList.studio.svelte.test.ts`.
 *
 * Fixture: characters A, B, C, U; the order is `A, folder F1 (B, C), U`, so the closed Grid shows the tiles
 * `Char A`, `F1`, `Char U` (slots 0, 3 for the characters shown). Test labels: `(F)` is new behaviour (fails
 * on the code before the stage by assertion), `(G)` is a compatibility guard that may pass before and after.
 *
 * MOCKED: the module set of `GridCatalog.group.svelte.test.ts` (same directory), with `alertSelect` an
 * answer-controlled spy, and `studio` a plain object of spies. Geometry is faked and pointer events are
 * synthetic; a device behaves differently in ways no jsdom-like run shows.
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

const { changeCharSpy, removeCharSpy, trashCharactersSpy, alertSelectSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    trashCharactersSpy: vi.fn(),
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
import { LIBRARY_TAB_KEY } from './gridMemory'
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
function fixture(extra: Record<string, Record<string, unknown>> = {}): void {
    install(
        [
            makeCharacter('A', 'Char A', extra.A),
            makeCharacter('B', 'Char B', extra.B),
            makeCharacter('C', 'Char C', extra.C),
            makeCharacter('U', 'Char U', extra.U),
        ],
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

interface StudioProp {
    available: (index: number) => boolean
    open: (index: number, opener: HTMLElement) => void
}

const availableSpy = vi.fn<(index: number) => boolean>()
const openSpy = vi.fn<(index: number, opener: HTMLElement) => void>()
const STUDIO: StudioProp = { available: (index) => availableSpy(index), open: (index, opener) => openSpy(index, opener) }

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

async function withMounted(tab: 'grid' | 'list' | 'trash', studio: StudioProp | undefined, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: studio ? { endGrid: () => {}, studio } : { endGrid: () => {} } }) as Record<string, unknown>
    try {
        await settle()
        clickButton(target, tab === 'grid' ? language.grid : tab === 'list' ? language.list : language.trash)
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

const studioButtons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('[data-part="library-studio"]'))
const studioButtonOf = (root: ParentNode, chaId: string): HTMLButtonElement | undefined =>
    studioButtons(root).find((button) => button.getAttribute('data-cha-id') === chaId)

const editButton = (root: ParentNode): HTMLButtonElement | undefined =>
    buttonByText(root, language.othersUi.editMode) ?? buttonByText(root, language.othersUi.editDone)
const charTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`[data-charlist-key] button[aria-label="${name}"]`)
const folderTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`button[aria-expanded][aria-label="${name}"]`)

async function enter(root: ParentNode): Promise<void> {
    editButton(root)!.click()
    await settle()
}

async function tap(root: ParentNode, name: string): Promise<void> {
    const tile = charTile(root, name) ?? folderTile(root, name)
    if (!tile) {
        throw new Error(`no tile "${name}"`)
    }
    tile.click()
    await settle()
}

function contextMenu(target: Element): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
}

/** Every menu that was put up, in order, and the resolver of the one still open. */
let menus: string[][] = []
let answerOpenMenu: ((value: string) => void) | null = null

async function answer(choice: string): Promise<void> {
    answerOpenMenu!(choice)
    answerOpenMenu = null
    await settle()
}

const OPEN_IN_STUDIO = language.studioOpenIn
const GROUP = language.othersUi.editGroup
const TRASH = language.othersUi.editMoveToTrash
const CANCEL = language.cancel

const FOUR_COLUMNS = 312
let clientWidthDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    trashCharactersSpy.mockReset()
    trashCharactersSpy.mockImplementation(async () => 0)
    availableSpy.mockReset()
    availableSpy.mockReturnValue(true)
    openSpy.mockReset()
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
    vi.unstubAllGlobals()
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

describe('List tab: the row control', { timeout: 60_000 }, () => {
    test('(F) T14 every available row has a named icon button right before its trash button', async () => {
        fixture()
        await withMounted('list', STUDIO, (target) => {
            const buttons = studioButtons(target)
            expect(buttons.map((button) => button.getAttribute('data-cha-id')).sort()).toEqual(['A', 'B', 'C', 'U'])
            const a = studioButtonOf(target, 'A')!
            expect(a.getAttribute('aria-label')).toBe(language.studioOpenInNamed('Char A'))
            expect(a.getAttribute('title')).toBe(language.studioOpenInNamed('Char A'))
            // The trash button follows it in the same row, so the two sit together.
            expect(a.nextElementSibling?.tagName).toBe('BUTTON')
            expect(a.nextElementSibling?.getAttribute('data-part')).toBeNull()
        })
    })

    test('(F) T14 a click opens that slot with the button as opener and neither picks the row nor trashes it', async () => {
        fixture()
        await withMounted('list', STUDIO, async (target) => {
            const u = studioButtonOf(target, 'U')
            expect(u).toBeDefined()
            u!.click()
            await settle()
            expect(openSpy).toHaveBeenCalledTimes(1)
            expect(openSpy.mock.calls[0][0]).toBe(3)
            expect(openSpy.mock.calls[0][1]).toBe(u!)
            // The row's own click would have picked the character.
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(removeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(G) T14 a click elsewhere on the row still picks the character', async () => {
        fixture()
        await withMounted('list', STUDIO, async (target) => {
            // The row is found through its name button, which exists with or without a Studio control.
            const name = Array.from(target.querySelectorAll<HTMLElement>('h4 button')).find((button) => button.textContent?.includes('Char U'))
            const row = name!.closest('.cursor-pointer') as HTMLElement
            row.click()
            await settle()
            expect(changeCharSpy.mock.calls).toEqual([[3]])
            expect(openSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) T17 a character that is not available has no row button; the others keep theirs', async () => {
        fixture()
        availableSpy.mockImplementation((index) => index !== 1)
        await withMounted('list', STUDIO, (target) => {
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id')).sort()).toEqual(['A', 'C', 'U'])
        })
    })
})

describe('without the studio prop (the App-level grid host)', { timeout: 60_000 }, () => {
    test('(G) T17 the List tab has no Studio control', async () => {
        fixture()
        await withMounted('list', undefined, (target) => {
            expect(studioButtons(target)).toEqual([])
        })
    })

    test('(G) T17 the Grid tile menu has no Open in Studio item', async () => {
        fixture()
        await withMounted('grid', undefined, async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(menus).toEqual([[GROUP, TRASH, CANCEL]])
        })
    })

    test('(G) T17 the Trash tab has no Studio control', async () => {
        fixture({ U: { trashTime: 5 } })
        await withMounted('trash', STUDIO, (target) => {
            expect(studioButtons(target)).toEqual([])
            expect(target.textContent).toContain('Char U')
        })
    })

    test('(F) T17 a trashed character has no row control in the List tab', async () => {
        fixture({ U: { trashTime: 5 } })
        await withMounted('list', STUDIO, (target) => {
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id')).sort()).toEqual(['A', 'B', 'C'])
        })
    })
})

describe('Grid tab: the tile menu item', { timeout: 60_000 }, () => {
    test('(F) T16 one available character picked: Open in Studio is the first item and opens that slot', async () => {
        fixture()
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(menus).toEqual([[OPEN_IN_STUDIO, GROUP, TRASH, CANCEL]])
            await answer('0')
            expect(openSpy).toHaveBeenCalledTimes(1)
            expect(openSpy.mock.calls[0][0]).toBe(3)
            expect(openSpy.mock.calls[0][1]).toBeInstanceOf(HTMLElement)
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) T16 the other items still act on the selection when Open in Studio comes first', async () => {
        fixture()
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            await answer('2')
            expect(trashCharactersSpy).toHaveBeenCalledTimes(1)
            expect(openSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) T16 two characters picked: the item is absent', async () => {
        fixture()
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            await tap(target, 'Char A')
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(menus).toEqual([[GROUP, TRASH, CANCEL]])
        })
    })

    test('(F) T16 a character and a folder picked: the item is absent', async () => {
        fixture()
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            await tap(target, 'F1')
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(menus).toHaveLength(1)
            expect(menus[0]).not.toContain(OPEN_IN_STUDIO)
        })
    })

    test('(F) T16 an unavailable character (a group, an archived one) picked: the item is absent', async () => {
        fixture()
        availableSpy.mockImplementation((index) => index !== 3)
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(menus).toEqual([[GROUP, TRASH, CANCEL]])
        })
    })

    test('(F) T16b the index is read after the menu answers: a character inserted before the picked one moves it and the open follows', async () => {
        fixture()
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            expect(menus[0][0]).toBe(OPEN_IN_STUDIO)
            // While the menu waits, a new character takes slot 0: U moves from slot 3 to slot 4.
            const picked = DBState.db.characters[3]
            DBState.db.characters.unshift(makeCharacter('Z', 'Char Z'))
            ;(DBState.db.characterOrder as unknown as unknown[]).unshift('Z')
            await settle()
            expect(DBState.db.characters.indexOf(picked)).toBe(4)
            await answer('0')
            expect(openSpy).toHaveBeenCalledTimes(1)
            expect(openSpy.mock.calls[0][0]).toBe(4)
        })
    })

    test('(F) T16b the character is checked again after the menu answers: one that became unavailable or left is not opened', async () => {
        fixture()
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            availableSpy.mockReturnValue(false)
            await answer('0')
            expect(openSpy).not.toHaveBeenCalled()
        })
        availableSpy.mockReturnValue(true)
        menus = []
        fixture()
        await withMounted('grid', STUDIO, async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Char U')!)
            await settle()
            const gone = DBState.db.characters.findIndex((candidate) => candidate.chaId === 'U')
            DBState.db.characters.splice(gone, 1)
            await settle()
            await answer('0')
            expect(openSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) T18 the remembered tab is untouched by an open: the List choice is still stored', async () => {
        fixture()
        await withMounted('list', STUDIO, async (target) => {
            const a = studioButtonOf(target, 'A')
            expect(a).toBeDefined()
            a!.click()
            await settle()
            expect(openSpy).toHaveBeenCalledTimes(1)
        })
        expect(localStorage.getItem(LIBRARY_TAB_KEY)).toBe('list')
    })
})

describe('Grid tab: the back button', { timeout: 60_000 }, () => {
    test('(F) T19 the library Back button carries the part name the Home focus step looks for', async () => {
        fixture()
        await withMounted('grid', STUDIO, (target) => {
            const back = target.querySelector<HTMLButtonElement>('[data-part="library-back"]')
            expect(back).not.toBeNull()
            expect(back!.getAttribute('title')).toBe(language.settingsPage.back)
        })
    })
})
