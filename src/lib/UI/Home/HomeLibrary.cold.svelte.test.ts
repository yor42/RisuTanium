// @vitest-environment happy-dom

/**
 * `HomeLibrary.svelte` with the REAL `homeStudio.svelte` module, for an archived character: the Studio control
 * is drawn for a stub row (Simple and List tabs), the Grid edit-mode menu offers Open in Studio for one stub
 * picked, and the library's teardown and Back end a load that is still running. The mechanism itself is in
 * `homeStudio.cold.svelte.test.ts`; `HomeLibrary.studio.svelte.test.ts` mocks the whole module, so it cannot
 * show any of this.
 *
 * REAL: `HomeLibrary`, `GridCatalog`, `CharacterSimpleList`, `homeStudio.svelte`, `characters.ts` (`changeChar`,
 * `characterFormatUpdate`), `coldCharacterRestore`, `backHandlers`, `homeView`, `studioSwitch`. MOCKED: the module
 * set of `HomeLibrary.studio.svelte.test.ts`, with `selIdState` mirrored from `selectedCharID`, the database
 * module gaining the setters `characterFormatUpdate` writes through, `readColdStorageItem` a deferred promise the
 * test settles, and `alertSelect` and `alertError` spies (the menu answers when the test says so). Fixtures are
 * built like the real producer: the stub comes from `buildColdStub(full, key, [])` and the unit value is
 * `{ character: coldUnitCharacter(full) }`; `full` omits `scenario`, which `characterFormatUpdate` fills.
 * happy-dom has no layout, so every element reports a 312 px width.
 *
 * Classes: R = regression reproducer (fails on the code before the stage by assertion); F = new behaviour.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import type { Database, character } from '../../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../../ts/platform'

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

const { readSpy, alertSelectSpy, alertErrorSpy } = vi.hoisted(() => ({
    readSpy: vi.fn(),
    alertSelectSpy: vi.fn(),
    alertErrorSpy: vi.fn(),
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
    const { DBState } = await import('../../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        getCurrentChat: vi.fn(() => undefined),
        getCharacterByIndex: vi.fn((index: number) => DBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            DBState.db.characters[index] = char as never
        }),
        defaultSdDataFunc: vi.fn(() => ({})),
        saveImage: vi.fn(),
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

vi.mock(import('../../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selection = $state({ selId: -1 })
    const selectedCharID = writable(-1)
    // The app's own first subscriber: `selIdState` is current before any other subscriber runs.
    selectedCharID.subscribe((value) => {
        selection.selId = value
    })
    return {
        DBState: state,
        selectedCharID,
        selIdState: selection,
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable(false),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
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
        ReloadChatPointer: writable({} as Record<number, number>),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../../ts/stores.svelte')
})

vi.mock(import('../../../ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertSelect: alertSelectSpy,
        alertError: alertErrorSpy,
    }
})

vi.mock(import('../../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('../../../ts/process/coldstorage.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        readColdStorageItem: readSpy,
    }
})

//#endregion

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

import { DBState, selectedCharID } from '../../../ts/stores.svelte'
import { dispatchBack, resetBackHandlersForTests } from '../../../ts/backHandlers'
import { language } from '../../../lang'
import { buildColdStub, coldUnitCharacter } from '../../../ts/process/coldCharacter'
import { resetRetainedForTest } from '../../../ts/process/coldRetained'
import { setStudioEnabled } from '../../../ts/studio/studioSwitch.svelte'
import { resetStudioScreenForTests } from '../../../ts/studio/studioScreen.svelte'
import { studioOpen } from '../../../ts/studio/studioOpen'
import { LIBRARY_TAB_KEY } from '../../Others/gridMemory'
import { openHomeLibrary, showHomeLanding, takeHomeReturnFocus } from './homeView.svelte'
import { resetHomeStudioForTests } from './homeStudio.svelte'
import HomeLibrary from './HomeLibrary.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function fullCharacter(chaId: string, name: string, lastInteraction: number): character {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        firstMsgIndex: 0,
        lastInteraction,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

/** The unit's characters by chaId: `b` and `c` are archived, `a` is loaded. */
let fulls: Record<string, character> = {}

/** Slots a (loaded), b and c (archived); the Simple list shows c, b, a (most recent first). */
function installDb(): void {
    fulls = { b: fullCharacter('b', 'Bob', 2000), c: fullCharacter('c', 'Cy', 3000) }
    const characters = [
        { ...fullCharacter('a', 'Ann', 1000), scenario: '' },
        buildColdStub(fulls.b, 'unit-b', []),
        buildColdStub(fulls.c, 'unit-c', []),
    ] as unknown as CharacterFixture[]
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

const slot = (index: number): character => DBState.db.characters[index] as unknown as character

function unitRead(chaId: string): { status: 'ok', value: { character: character } } {
    return { status: 'ok', value: { character: coldUnitCharacter(fulls[chaId]) } }
}

const throwingUnit = { status: 'ok', value: { get character(): never { throw new Error('boom') } } }

interface PendingRead {
    key: string
    resolve: (result: unknown) => void
    settled: boolean
}

let reads: PendingRead[] = []

function holdReads(): void {
    reads = []
    readSpy.mockImplementation((key: string) => new Promise((resolve) => {
        reads.push({ key, resolve, settled: false })
    }))
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function drain(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await settle()
}

/** Settles the oldest unsettled read of `chaId`'s unit and lets everything that follows run. */
async function land(chaId: string, result: unknown = unitRead(chaId)): Promise<void> {
    const read = reads.find((candidate) => candidate.key === `unit-${chaId}` && !candidate.settled)
    expect(read, `the unit read of ${chaId} is pending`).toBeDefined()
    read!.settled = true
    read!.resolve(result)
    await drain()
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

async function mountLibrary(): Promise<{ target: HTMLElement, close: () => Promise<void> }> {
    openHomeLibrary()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HomeLibrary, { target }) as Record<string, unknown>
    await settle()
    let closed = false
    return {
        target,
        close: async () => {
            if (closed) {
                return
            }
            closed = true
            await unmount(app as never)
            target.remove()
        },
    }
}

async function withLibrary(tab: 'simple' | 'list' | 'grid', body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const library = await mountLibrary()
    try {
        clickButton(library.target, tab === 'simple' ? language.simple : tab === 'list' ? language.list : language.grid)
        await settle()
        await body(library.target)
    } finally {
        await library.close()
    }
}

const studioButtons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('[data-part="library-studio"]'))
const studioButtonOf = (root: ParentNode, chaId: string): HTMLButtonElement | undefined =>
    studioButtons(root).find((button) => button.getAttribute('data-cha-id') === chaId)

/** A click on the character's Studio control; a missing control fails the test by assertion. */
function clickStudioControl(root: ParentNode, chaId: string): void {
    const button = studioButtonOf(root, chaId)
    expect(button, `the Studio control of ${chaId} is drawn`).toBeDefined()
    button!.click()
}

const editButton = (root: ParentNode): HTMLButtonElement | undefined =>
    buttonByText(root, language.othersUi.editMode) ?? buttonByText(root, language.othersUi.editDone)
const charTile = (root: ParentNode, name: string): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>(`[data-charlist-key] button[aria-label="${name}"]`)

async function enter(root: ParentNode): Promise<void> {
    editButton(root)!.click()
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

/** A click on a List row outside its buttons: the row pick. */
async function pickRow(root: ParentNode, name: string): Promise<void> {
    const label = Array.from(root.querySelectorAll<HTMLElement>('h4 button')).find((button) => button.textContent?.includes(name))
    const row = label!.closest('.cursor-pointer') as HTMLElement
    row.click()
    await settle()
}

const OPEN_IN_STUDIO = language.studioOpenIn
const GROUP = language.othersUi.editGroup
const TRASH = language.othersUi.editMoveToTrash
const CANCEL = language.cancel

let errorSpy: MockInstance<typeof console.error>

beforeEach(() => {
    localStorage.clear()
    readSpy.mockReset()
    alertErrorSpy.mockReset()
    alertSelectSpy.mockReset()
    alertSelectSpy.mockImplementation((labels: string[]) => {
        menus.push(labels)
        return new Promise<string>((resolve) => {
            answerOpenMenu = resolve
        })
    })
    menus = []
    answerOpenMenu = null
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    showHomeLanding()
    // A request left over from another test must not reach this one.
    takeHomeReturnFocus()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetHomeStudioForTests()
    resetRetainedForTest()
    setStudioEnabled(true)
    selectedCharID.set(-1)
    installDb()
    holdReads()
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
    takeHomeReturnFocus()
    resetHomeStudioForTests()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    resetRetainedForTest()
    setStudioEnabled(false)
    selectedCharID.set(-1)
    showHomeLanding()
    document.body.replaceChildren()
    errorSpy.mockRestore()
})

//#endregion

describe('HomeLibrary: the controls for an archived character', { timeout: 60_000 }, () => {
    test('R T31: the Simple and List tabs draw one named Studio control per row, the archived rows included', async () => {
        await withLibrary('simple', (target) => {
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id'))).toEqual(['c', 'b', 'a'])
            expect(studioButtonOf(target, 'b')!.getAttribute('aria-label')).toBe(language.studioOpenInNamed('Bob'))
        })
        await withLibrary('list', (target) => {
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id')).sort()).toEqual(['a', 'b', 'c'])
            expect(studioButtonOf(target, 'c')!.getAttribute('aria-label')).toBe(language.studioOpenInNamed('Cy'))
        })
    })

    test('R T32: the Grid edit-mode menu for one archived character picked offers Open in Studio first', async () => {
        await withLibrary('grid', async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Bob')!)
            await settle()

            expect(menus).toEqual([[OPEN_IN_STUDIO, GROUP, TRASH, CANCEL]])
        })
    })

    test('F: a tap on the control of an archived row loads it and opens Studio on it', async () => {
        await withLibrary('simple', async (target) => {
            clickStudioControl(target, 'b')
            await drain()
            expect(get(studioOpen)).toBe(false)

            await land('b')

            expect(get(studioOpen)).toBe(true)
            expect(get(selectedCharID)).toBe(1)
            expect(slot(1).coldstorage).toBeUndefined()
        })
    })
})

describe('HomeLibrary: a load that is still running', { timeout: 60_000 }, () => {
    test('F T36c: Back during a load started from the Grid edit-mode menu cancels it; edit mode stays and the pick is cleared once the character is installed', async () => {
        await withLibrary('grid', async (target) => {
            await enter(target)
            contextMenu(charTile(target, 'Bob')!)
            await settle()
            expect(menus[0]?.[0]).toBe(OPEN_IN_STUDIO)
            await answer('0')
            expect(charTile(target, 'Bob')!.getAttribute('aria-pressed')).toBe('true')

            expect(dispatchBack()).toBe(true)
            await land('b')

            expect(get(studioOpen)).toBe(false)
            expect(get(selectedCharID)).toBe(-1)
            expect(slot(1).coldstorage).toBeUndefined()
            expect(buttonByText(target, language.othersUi.editDone)).toBeDefined()
            expect(charTile(target, 'Bob')!.getAttribute('aria-pressed')).toBe('false')
        })
    })

    test('F T37b: unmounting the library during the load opens and selects nothing; the character is installed and formatted', async () => {
        const library = await mountLibrary()
        try {
            clickButton(library.target, language.simple)
            await settle()
            clickStudioControl(library.target, 'b')
            await drain()

            await library.close()
            await land('b')

            expect(get(studioOpen)).toBe(false)
            expect(get(selectedCharID)).toBe(-1)
            expect(slot(1).coldstorage).toBeUndefined()
            expect(slot(1).scenario).toBe('')
        } finally {
            await library.close()
        }
    })
})

describe('HomeLibrary: a throw while the unit is read (accepted limitation, one visible dialog)', { timeout: 60_000 }, () => {
    test('F T46c: the Studio control, then a row pick of the same stub: one alert', async () => {
        localStorage.setItem(LIBRARY_TAB_KEY, 'list')
        await withLibrary('list', async (target) => {
            clickStudioControl(target, 'b')
            await drain()
            await pickRow(target, 'Bob')
            await land('b', throwingUnit)

            expect(alertErrorSpy).toHaveBeenCalledTimes(1)
            expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
            expect(get(studioOpen)).toBe(false)
            expect(get(selectedCharID)).toBe(-1)
        })
    })

    test('F T46c: a row pick, then the Studio control of the same stub: two calls with the same text (the alert is one store slot)', async () => {
        await withLibrary('list', async (target) => {
            await pickRow(target, 'Bob')
            clickStudioControl(target, 'b')
            await drain()
            await land('b', throwingUnit)

            expect(alertErrorSpy).toHaveBeenCalledTimes(2)
            expect(alertErrorSpy.mock.calls.map((call) => call[0])).toEqual([
                language.errors.coldStorageRestoreUnreadable,
                language.errors.coldStorageRestoreUnreadable,
            ])
            expect(get(studioOpen)).toBe(false)
            expect(get(selectedCharID)).toBe(-1)
        })
    })
})
