// @vitest-environment happy-dom

/**
 * The Home library restyle of `GridCatalog.svelte` (stage E2): the view buttons expose their state,
 * every listed name renders inside one `CharacterNameRow`, and a Trash row names its icon buttons and
 * shows the days left before the purge. The mount, the module mocks and the helpers are those of
 * `GridCatalog.emptyTrash.svelte.test.ts` (same directory); `src/ts/characters` is REAL and nothing
 * here clicks a restore or a delete.
 *
 * Invariants exercised here:
 * - T20: a trashed row shows how many whole days are left (the clock is the only faked value).
 * - T21: the Restore and Delete icon buttons are reachable by an accessible name.
 * - T22: the Simple, List and Trash rows render the name inside `[data-part=character-name-row]`, and
 *   the List and Trash `h4` keep the bare name as their text.
 * - T23: each view button's `aria-pressed` follows the open view; a plain `Button` sets none.
 * - T24: the segmented wrapper `[data-part=library-views]` is present in both hosts of the library.
 * - T25a (guard): the row-pitch fallbacks equal their base values; the restyle is not a density change.
 *
 * Tests whose title starts with `guard:` pass with or without the restyle (compatibility).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, test, expect, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
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
            changeChatTo: vi.fn(),
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            fetchNative: vi.fn(),
            toGetter: vi.fn((obj: unknown) => obj),
            aiWatermarkingLawApplies: vi.fn(() => false),
            aiLawApplies: vi.fn(() => false),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        ...actual,
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
    }
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
        OpenRealmStore: writable(false),
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

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'
import HomeLibrary from '../UI/Home/HomeLibrary.svelte'
import { GRID_ROW_FALLBACK_PX, LIST_ROW_FALLBACK_PX, SIMPLE_ROW_FALLBACK_PX } from './charListRows'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const T0 = 1_700_000_000_000
const DAY = 86_400_000

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat-0-${name}`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.filter((c) => !c.trashTime).map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

type Mounted = { target: HTMLElement; app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountComponent(component: typeof GridCatalog | typeof HomeLibrary): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const { target, app } of mounted) {
        await unmount(app as never)
        target.remove()
    }
    mounted = []
    vi.useRealTimers()
    // Each test mounts on the default tab, because the library remembers its tab on this device.
    localStorage.clear()
})

function viewButton(root: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label.trim())
    if (!found) {
        throw new Error(`no button "${label}"`)
    }
    return found
}

function openView(root: HTMLElement, label: string): void {
    viewButton(root, label).click()
    flushSync()
}

const nameRows = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('[data-part="character-name-row"]')) as HTMLElement[]

//#endregion

describe('T20: a trashed row shows the days left', () => {
    test('now minus 10 days shows 20 days left, in whole days', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0 - 10 * DAY), makeCharacter('b', 'Bob', T0 - DAY)])
        const root = mountComponent(GridCatalog)
        openView(root, language.trash)
        const lines = Array.from(root.querySelectorAll('[data-part="trash-days-left"]')).map((el) => el.textContent?.trim())
        expect(lines).toEqual(['20 days left', '29 days left'])
    })

    test('one day left is singular', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0 - 29 * DAY)])
        const root = mountComponent(GridCatalog)
        openView(root, language.trash)
        expect(root.querySelector('[data-part="trash-days-left"]')?.textContent?.trim()).toBe('1 day left')
    })

    test('class guard: days-left text stays on one line and its action row wraps (jsdom does no layout)', () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0 - 10 * DAY)])
        const root = mountComponent(GridCatalog)
        openView(root, language.trash)
        const span = root.querySelector('[data-part="trash-days-left"]')
        expect(span?.classList.contains('whitespace-nowrap')).toBe(true)
        expect(span?.parentElement?.classList.contains('flex-wrap')).toBe(true)
    })
})

describe('T21: the Trash row buttons have accessible names', () => {
    test('Restore and Delete permanently are reachable by name and title', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0)])
        const root = mountComponent(GridCatalog)
        openView(root, language.trash)
        const restore = root.querySelector('button[aria-label="Restore"]')
        const del = root.querySelector('button[aria-label="Delete permanently"]')
        expect(restore).not.toBeNull()
        expect(del).not.toBeNull()
        expect(restore?.getAttribute('title')).toBe('Restore')
        expect(del?.getAttribute('title')).toBe('Delete permanently')
    })
})

describe('T22: every listed name renders inside the one name-row component', () => {
    test('Simple: the row component holds the name', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])
        const root = mountComponent(GridCatalog)
        expect(nameRows(root).map((el) => el.textContent?.trim()).sort()).toEqual(['Ann', 'Bob'])
    })

    test('List: h4 > button > name row, and the h4 text is still the bare name', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])
        const root = mountComponent(GridCatalog)
        openView(root, language.list)
        const rows = nameRows(root)
        expect(rows.map((el) => el.textContent)).toEqual(['Ann'])
        const h4 = root.querySelector('h4') as HTMLElement
        expect(h4.textContent?.trim()).toBe('Ann')
        expect(rows[0].parentElement?.tagName).toBe('BUTTON')
        expect(rows[0].parentElement?.parentElement).toBe(h4)
    })

    test('Trash: h4 > name row, and the h4 text is still the bare name', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0)])
        const root = mountComponent(GridCatalog)
        openView(root, language.trash)
        const rows = nameRows(root)
        expect(rows.map((el) => el.textContent)).toEqual(['Ann'])
        const h4 = root.querySelector('h4') as HTMLElement
        expect(h4.textContent?.trim()).toBe('Ann')
        expect(rows[0].parentElement).toBe(h4)
    })

    test('an unnamed character shows the unnamed label inside the row component', () => {
        DBState.db = buildDb([makeCharacter('a', '')])
        const root = mountComponent(GridCatalog)
        openView(root, language.list)
        expect(nameRows(root).map((el) => el.textContent)).toEqual([language.settingsPage.unnamed])
    })
})

describe('T23: the view buttons expose which view is open', () => {
    const labels = () => [language.simple, language.grid, language.list, language.trash]

    test('aria-pressed is true on the open view only and follows a switch', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])
        const root = mountComponent(GridCatalog)
        const pressed = () => labels().map((label) => viewButton(root, label).getAttribute('aria-pressed'))
        expect(pressed()).toEqual(['true', 'false', 'false', 'false'])
        openView(root, language.list)
        expect(pressed()).toEqual(['false', 'false', 'true', 'false'])
        openView(root, language.trash)
        expect(pressed()).toEqual(['false', 'false', 'false', 'true'])
        openView(root, language.grid)
        expect(pressed()).toEqual(['false', 'true', 'false', 'false'])
    })

    test('guard: a Button that is not a view button carries no aria-pressed', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0)])
        const root = mountComponent(GridCatalog)
        openView(root, language.trash)
        expect(viewButton(root, language.emptyTrash).hasAttribute('aria-pressed')).toBe(false)
    })
})

describe('T24: the view group wrapper is in both hosts of the library', () => {
    test('GridCatalog (the App host) holds the four view buttons in the wrapper', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])
        const root = mountComponent(GridCatalog)
        const group = root.querySelector('[data-part="library-views"]')
        expect(group).not.toBeNull()
        expect(group?.querySelectorAll('button').length).toBe(4)
    })

    test('HomeLibrary renders the same wrapper', () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])
        const root = mountComponent(HomeLibrary)
        expect(root.querySelector('[data-part="library-views"]')).not.toBeNull()
    })
})

describe('T25a: the density fence holds', () => {
    test('guard: the row-pitch fallbacks equal their base values', () => {
        expect(SIMPLE_ROW_FALLBACK_PX).toBe(73)
        expect(LIST_ROW_FALLBACK_PX).toBe(130)
        expect(GRID_ROW_FALLBACK_PX).toBe(64)
    })
})
